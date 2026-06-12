# SIVARR — Security Fixes
> Session: 2026-06-12 | Author: Claude (Opus 4.8) | Branch: `main`

Two auth-audit findings (P4, P5) were implemented, tested in-process, and pushed to `origin/main` this session.

| Fix | Severity | Commit | Files |
|---|---|---|---|
| P4 — Org Paystack endpoints gated by admin/owner role | HIGH | `b941ce1` | `app.py` |
| P5 — Authenticate AI chat path + enforce free cap server-side | MED-HIGH | `57561ea` | `app.py`, `js/app.js`, `templates/index.html` |

---

## P4 — Org Paystack endpoints gated by admin/owner role
**Commit:** `b941ce1` · **File:** `app.py`

### Problem
Nine org Paystack endpoints checked only that the caller was *a member* of the org
(`_org_check`), not that they were an admin/owner. Any member could:
- Overwrite or delete the org's Paystack secret key (payment-flow takeover / DoS).
- Read all financial data — transactions with customer emails + card last-4, balances,
  settlements, refunds, analytics.

### Fix applied
- Switched 9 endpoints from `_org_check` → `_org_admin_check`:
  `connect`, `disconnect`, `overview`, `transactions`, `balance`, `settlements`,
  `customers`, `refunds`, `analytics`.
- Removed a dead `db.get_org_integration(org_id, "_role_check")` call in
  `_org_admin_check` — its result was overwritten before use (a wasted DB round-trip
  on every admin check).

### How it works
- `_org_check(token)` — validates the session token, loads the caller's progress,
  reads their `org_id`, and confirms they belong to an org. Returns `(session, org_id)`.
- `_org_admin_check(token)` — calls `_org_check` first, **then** queries `org_members`
  for the caller's `role` and checks the `orgs` table `owner_sid`. If the caller is
  neither `owner` nor `admin`, raises `403 "Admin access required."`
- `/status` was **deliberately left** at `_org_check` (member level). It only returns a
  `{"connected": bool}` flag, and keeping it member-accessible avoids breaking the
  member-facing UI.

### Notes / leftovers
- Org Paystack secret key is still stored plaintext via `save_org_integration`
  (sensitive-at-rest — out of scope for this fix).

---

## P5 — Authenticate the AI chat path + enforce the free cap server-side
**Commit:** `57561ea` · **Files:** `app.py`, `js/app.js`, `templates/index.html`

### Problem
`/api/chat` and `/api/chat/stream` took `sid` straight from the request body with
**no authentication**, and the "20 messages/day free" limit lived **only in `app.js`**.
Consequences:
- Anyone could POST an arbitrary `sid` → unlimited free AI, and **write into another
  user's chat history/progress**.
- The free-tier cap was trivially bypassed (clear localStorage, or call the API
  directly), blocking the planned "gate Claude behind Pro."

### Fix applied — Backend (`app.py`)

| Added | Purpose |
|---|---|
| `FREE_DAILY_CHAT` constant | Free-tier AI messages per day (default 20, env-overridable) |
| `chat_daily` in `_PROGRESS_DEFAULTS` | Per-user daily usage `{"date": "YYYY-MM-DD", "count": N}` |
| `token` field on `ChatRequest` | Carries the session token from the client |
| `_plan_is_active(p)` | True only for a non-expired paid subscription |
| `_chat_authorize(token)` | Auth + daily-cap gate for both chat endpoints |

**`_plan_is_active(p)`** returns `True` only if:
- `plan` is not `free`/empty, **and**
- `status` (if set) is `active`, **and**
- `expires` (if set) is in the future.

**`_chat_authorize(token)`** — the keystone:
1. Resolves the session token → `401 "Sign in to chat with Sivarr."` if missing/expired.
2. Derives the **authoritative `sid` from the token** (the body `sid` is never trusted
   for auth or writes).
3. Loads progress. If the user is **not** on an active paid plan:
   - Reads `chat_daily`; if its `date` isn't today, resets to `{date: today, count: 0}`.
   - If `count >= FREE_DAILY_CHAT` → `429` with an upgrade message.
   - Otherwise increments `count`.
4. Returns `(sid, progress)`. Paid plans skip metering entirely.

Both chat handlers now open with `sid, p = _chat_authorize(req.token)` and use that `sid`
everywhere (rate-limit key, history writes, `save_progress`) instead of `req.sid`.

**Quota persistence detail:** the increment is written when the handler calls
`save_progress` (on success, and on cached/local-math replies). On an AI error the handler
doesn't save, so a failed message isn't charged against the daily count — intentionally
generous; the per-minute rate limit still guards against abuse.

### Fix applied — Frontend (`js/app.js`, `templates/index.html`)
- The chat-stream `fetch` and the `/api/chat` doc-assist call now include
  `token: localStorage.getItem('sivarr_token')`.
- `429` handling shows the server's `detail` (the daily-cap / upgrade text) instead of the
  generic "wait 60 seconds" message; a `401` shows a "session expired — sign in again"
  prompt.
- Bumped the `app.js` cache-bust version `v=20260612a` → `v=20260612b`.

### How it works end-to-end
A logged-in user sends a message → frontend attaches the session token → `_chat_authorize`
verifies it, identifies the real user, checks/increments their server-side daily count (or
waves through Pro users) → the handler answers and persists the count. An unauthenticated
caller gets `401`; a free user past 20/day gets `429` with an upgrade nudge; nobody can
spend or write against an `sid` they don't own.

### Verification
In-process tests (JSON mode, mocked sessions, local-math solver to avoid real Gemini)
confirmed:
- `401` without a token,
- attacker-supplied body `sid` ignored in favor of the token's sid (other account untouched),
- `429` exactly at the cap,
- counter reset on a new day,
- Pro users unmetered past the cap.

Test scaffolding was removed after the run. Not yet tested against live Railway + Supabase.

### Notes / leftovers
- `/api/ai/*` endpoints were already authenticated (`get_session_from_token`), so they were
  out of scope — but they are **not** daily-capped (candidate for later metering).
- The client-side counter (`CHAT_LIMIT = 20`, `app.js`) is now purely cosmetic and still
  counts down for Pro users — a minor pre-existing UX gap, not a security issue.

---

## Still open (auth audit)
- **P2 MEDIUM** — DB read fns lack query-level try/except → can 500 all auth when the DB is flaky.
- **P6 LOW** — admin login uses a non-constant-time password compare.
- **Round-1** — `_applyLoginData` frontend single-point-of-failure (`app.js`).
