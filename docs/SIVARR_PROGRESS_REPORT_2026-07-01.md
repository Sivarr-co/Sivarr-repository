# SIVARR — Development Progress Report (Continuation)

> **Purpose:** Account of everything built, fixed, and shipped since the last report.
> **Window covered:** 2026-06-24 → 2026-07-01 (continues `SIVARR_PROGRESS_REPORT_2026-06-16.md`)
> **Commits in window:** 79 · **HEAD:** `1bdda5f` (+ continuation §9.1 through `666a6d3`)
> **Plus:** one uncommitted fix session (this doc's §5.2) sitting in the working tree as of 2026-07-01
> **Continuation (later 2026-07-01):** Org-invite tz-500 fixed, Org-space UX bugs fixed, per-seat Org billing finished on both gateways — see **§9.1**
> **Prepared:** 2026-07-01
> **Source of truth:** git history + verified codebase state (not assumptions)

---

## 1. Executive Summary

This window had five parallel arcs, roughly in the order they landed:

1. **Security hardening continued** — CSRF double-submit + `__Host-` cookies shipped and
   verified on live prod, generic login errors (account-enumeration fix), a repeatable
   auth security-test suite, Sentry stopped capturing request bodies/PII, and an
   email-length bypass closed.
2. **Mobile became a real second surface** — from a fit-to-screen/zoom pass through a
   full retractable sidebar drawer, a device-preview harness + Playwright emulation
   script for QA, and (today) a proper off-canvas channel drawer + cached chat for the
   Org space.
3. **Calendar + Google Calendar** — the calendar was rebuilt to a two-pane rail/timeline
   design, then wired to real Google Calendar (2-way sync, disconnect/revoke, token kept
   out of the URL) with a full OAuth-verification doc package for Google's review.
4. **Money went live** — USD-anchored pricing with live NGN conversion, quota gating
   (spaces/templates/integrations/AI fair-use), and per-seat Organisation billing all
   shipped and were **verified against live prod Postgres + real HTTPS** (CSRF, quota
   gating, USD pricing all confirmed working on `sivarr.com`).
5. **A 9-phase pre-launch refinement sweep** (Hunter's plan) audited every space,
   nav, chat/integrations, template/consistency, mobile, and onboarding surface against
   the live codebase — turning up and fixing several real bugs (leaderboard 404, silent
   task-assign, fake template seeding, org-invite members never actually added, org
   schema-retry causing multi-second hangs).

**Where it stands today:** the same FastAPI + Vanilla JS + PostgreSQL app on Railway.
Money paths are live and prod-verified for the core cases; the org-space slowness that
was blocking full billing verification was root-caused and fixed today. A same-day Sentry
triage (§5.2) found and fixed five more bugs, including one that made the AI org-briefing
feature fail on **every single call** — those fixes are in the working tree, not yet
committed.

---

## 2. Security & Auth Hardening (Jun 24–29)

| Fix | Commit |
|---|---|
| Cookie reload-survival in the bootstrap flow + valid Sentry CSP source | `3e202ed` |
| Server-side hardening of `/api/login` (login + register paths) | `feecde3` |
| Repeatable security smoke test (`scripts/security_smoke.py`) | `1bb9fa7` |
| Sentry: stop capturing request bodies + local variables (PII exposure); remove the temp verify route | `260370b`, `80961c3` |
| Keep the session token out of the Calendar OAuth URL (cookie + signed state) | `ff64dad` |
| Purge legacy `localStorage` token for returning users (P3b) | `3550310` |
| Generic login errors — closes an account-enumeration vector | `2e4d8e2` |
| **CSRF (P3b step d):** client echoes `X-CSRF-Token`, server enforces double-submit + `__Host-` cookie; gcal push now sends IANA tz | `fd2325b` |
| CSRF echo added to the standalone admin / lecturer / admin-metrics pages (they don't share the main app's fetch wrapper) | `f3ea4aa`, `8b56d6e` |
| Email-length bypass fix + comprehensive auth test suite | `e857e2f` |
| Escape org-controlled values (names, titles) in mention/announcement emails — closes an HTML-injection vector in outbound mail | `9642f6e` |

**Verified:** CSRF round-trip confirmed on **live HTTPS** — register sets
`__Host-sivarr_session` + `sivarr_csrf`; a mutating POST without `X-CSRF-Token` → `403`,
with it → `200`. The auth baseline suite (`scripts/test_auth_security.py`) is **locked
green: 33 passed / 0 failed / 10 skipped** (skips are rate-limit artifacts of the suite
itself, not failures) as of 2026-06-30 — this is now the baseline every refinement-sweep
change is gated against.

**Known still-open security items (carried over, not touched this window):**
- Org/invite phishing-relay endpoint still has no rate limit (escaping is now fixed,
  the rate-limit gap is not) — see `project_security_scan_email_relay` memory.
- Forgot-password rate-limit gap (same audit).
- P4 per-identity rate limiting (roadmap item, not started).
- Mozilla Observatory B+ (80/100) — the only failing check is CSP `unsafe-inline`
  (~1,075 inline handlers); this is a large, separate migration, tracked as a
  post-launch sprint.

---

## 3. Mobile Redesign & UX Polish (Jun 24 – Jul 1)

| Fix | Commit |
|---|---|
| Drop duplicate launcher header (doubled bar in fullscreen) | `b724b7c` |
| Weekly Review header overflow + non-functional Generate button | `3a1c6d9` |
| Fit-to-screen layout + Notion-style zoom across all tabs | `80bdae8` |
| Pin the chat composer to the bottom on all touch widths | `10c1465` |
| Switch to device-width viewport + fix panel stacking | `408611f` |
| Sidebar retract button + a "customize" sheet (add/remove/reorder tabs) | `dabc9dc` |
| Sidebar to 70% width + marketplace scroll fix + remove duplicate brand mark | `9243f04` |
| Tap-behind-the-70%-sidebar closes it | `5fd2eb8` |
| Top bar cleanup — actions moved into sidebar/dropdown, keep only the Notifications bell | `1a8a218`, `98336c2` |
| De-dupe sidebar (drop search icon + desktop logo duplication); top-bar brand uses the badge logo | `b31b87c`, `0afd25b` |
| Home stat cards compacted (twice) so the page scrolls faster on mobile | `92dc1be`, `0655e6d` |
| Recent-nav pills + compact Space modal on mobile + chat popover | `f9f68f0` |
| 5 mobile polish fixes across AI chat, sidebar, home | `7eb0a90` |
| Tooltips on all key buttons + more mobile polish + chat add-menu | `deda4b8` |
| **(today) Org Chat mobile:** cramped 48px channel bar → retractable off-canvas drawer (hamburger → slide-in, overlay, scrollable channel+DM list, larger tap targets) | `1bdda5f` |
| **(today) Org Chat perf:** channel switches used to show a frozen blank mid-round-trip; added a loading hint + per-channel message cache so a revisited channel paints instantly | `1bdda5f` |
| **(today) Org Tasks:** Board/List toggle buttons had no `onclick` — wired `orgSetTaskView()`, added a grouped List view (mirrors the personal Flux list) | `1bdda5f` |

**Not yet device-verified:** most of the above mobile work has only been checked via the
new device-preview harness / static review, not on a real phone — flagged in memory
(`project_mobile_fit_zoom`, `project_mobile_redesign`).

---

## 4. Calendar & Google Calendar Integration (Jun 25)

| Fix | Commit |
|---|---|
| Rebuild to the two-pane reference design (rail + weekly hourly timeline) | `fdc7baf` |
| Privacy doc: Google Calendar scope + Limited Use disclosure (needed for OAuth review) | `3e9d22a` |
| Disconnect/revoke + surface Google events in the calendar + clear stale tokens | `8ae6406` |
| Google OAuth verification guide (audit, console checklist, scope justification, demo script) | `e92d983` |
| Keep the session token out of the Calendar OAuth URL | `ff64dad` |

**Design decision:** timeless events stay all-day and are never auto-assigned a time.

**Still needed:**
- Google brand verification for the `calendar.events` (sensitive) scope — submitted
  documentation exists (`docs/GOOGLE_OAUTH_VERIFICATION.md`); no CASA assessment yet.
- Two minor follow-ups from the 2026-06-25 audit: plaintext OAuth token at rest, and
  push events use UTC instead of the user's local tz for calendar pushes.
- Calendar/gcal end-to-end browser check is still on the prod verification backlog
  (`docs/BILLING_RESUME.md` §1 item 7).

---

## 5. Observability: Sentry, Service Worker, and Today's Bug-Fix Session

### 5.1 Committed this window

| Fix | Commit |
|---|---|
| Sentry: stop capturing request bodies + local variables; remove temp verify route | `260370b`, `80961c3` |
| CSP: add `worker-src 'self' blob:` so Sentry's session-replay blob Worker isn't blocked | `ac7f728` |
| Service worker: don't intercept cross-origin requests — fixes "Sentry is not defined" and other SW errors caused by the SW trying to handle the Sentry CDN loader | `cf272b9` |
| `/api/org/join`: tz-aware `expires_at` comparison — was raising `TypeError` (offset-naive vs offset-aware datetimes) and **500ing on every single join**, which is why invitees saw "you're not part of an organization yet" | `8418dc4` |

### 5.2 Today's Sentry triage (2026-07-01) — ⚠️ UNCOMMITTED, in the working tree

Reviewed the live Sentry feed for `python-fastapi` (12 unresolved issues, 14-day window) and
root-caused/fixed 5 of them directly in `app.py`. **None of the below are committed yet** —
`git status` currently shows `app.py` modified. Recommend reviewing and committing before
they're lost or conflict with the concurrent work landing on `main`.

| # | Sentry issue | Root cause | Fix |
|---|---|---|---|
| 1 | `RuntimeError: No response returned.` on `/api/org/chat/stream` (32 events, still firing every ~49s) | `_StaticCacheMiddleware` and `_SecurityHeadersMiddleware` were built on Starlette's `BaseHTTPMiddleware`, which has a well-known bug: it raises this exact error when a client disconnects mid-stream on a `StreamingResponse` (our SSE chat/announcement endpoints hold connections open for minutes). | Converted both middlewares to pure-ASGI (matching the pattern `_BearerTokenMiddleware` already used, for a different reason — ContextVar propagation). Pure-ASGI middleware forwards `send()` directly instead of buffering through a background task, so it can't trigger the bug. |
| 2 | Same `RuntimeError: No response returned.` also seen on `/api/track` and `/api/space/prefs/get` (regular POST endpoints, not streams) | Same middleware bug — it can fire on **any** endpoint when a client aborts an in-flight request (tab close, nav-away cancelling a `fetch`), not just SSE. | Same fix as #1 covers these too. |
| 3 | `update_org_task: invalid input syntax for type date: "None"` on `/api/org/tasks/update` | Clearing a task's due date sends `due_date: null` from the client (`js/app.js:12803`); the endpoint ran `str(v)` on every field before sanitizing, turning Python `None` into the literal string `"None"`, which Postgres rejected for a `date` column. | Pass `None` through untouched instead of stringifying it (`app.py` ~9093-9096). |
| 4 | `FileNotFoundError` on `data/push_subscriptions.json.tmp` → `data/push_subscriptions.json` (5 events) | 4 Gunicorn workers (`Procfile: gunicorn -w 4 ...`) share one JSON file, and the atomic-write helper used a **fixed** `.tmp` filename. Two workers writing concurrently race: the second worker's `.replace()` finds the tmp file already consumed/renamed by the first → `FileNotFoundError`. | Unique per-call tmp filename (`pid + uuid4` suffix) in `_save_json_file`. The **same fixed-tmp-filename bug** existed in three sibling helpers (`save_json`, `save_users`, `_RateLimiter._save`, `_save_json_atomic`) that hadn't fired yet in Sentry — fixed all of them consistently since it's the identical one-line change. |
| 5 | Gemini `'list' object has no attribute 'send_message'` on `/api/org/ai/briefing` (1 event) | `get_sessions()` only ever creates `"chat"` and `"math"` keys — **never** `"main"`. The briefing endpoint did `sessions.get("main", [])`, which always fell through to the `[]` default, so `[].send_message(...)` was called on **every** invocation of this endpoint. | Changed to `sessions["chat"]` (the real, existing session), matching how every other AI endpoint in the file accesses it. |

**Verified locally** (app boots via the repo's `.venv`, JSON-file storage mode, no
`DATABASE_URL`/Gemini key available in this environment):
- App starts cleanly with the new pure-ASGI middlewares; no exceptions.
- Response headers on `/` and `/js/app.js` are byte-for-byte equivalent to before the
  middleware rewrite (CSP, `X-Frame-Options` SAMEORIGIN-vs-DENY logic, HSTS, static
  `Cache-Control: immutable`) — confirms no regression from the refactor.
- `update_org_task` None-passthrough logic confirmed directly.
- Hammered `_save_json_file` with 4 concurrent processes × 200 writes (800 total): **zero**
  `FileNotFoundError` occurred (the original crash mode is closed). Note: this exposed a
  *different*, Windows-only `PermissionError` from concurrent renames targeting the same
  destination on this dev machine — that's a Windows file-locking artifact and won't occur
  on production's Linux containers, where `os.replace()` is an atomic POSIX `rename()`.
- Confirmed via source that `get_sessions()` never creates a `"main"` key, so the fix
  is necessary and sufficient.

**Not verifiable locally** (need live DB/Gemini/Flutterwave credentials not present in
this dev environment): the real `/api/org/chat/stream` SSE-disconnect scenario end-to-end
against a live client, and a real Gemini API round-trip for the briefing feature.

### 5.3 Sentry issues reviewed but NOT code bugs (flagged for Hunter, no fix applied)
- `HTTPException: Flutterwave not configured` on `/api/billing/flutterwave/subscribe`
  (7 events) — this is an intentional `503` guard. Likely `FLUTTERWAVE_*` env vars are
  unset in prod, or the subscribe button should be hidden until configured. **Action
  needed: check Railway env vars, or hide the button.**
- `_get_conn: pool exhausted after 3 attempts` on `/api/billing/org/quote` (1 event) —
  the pool sizing is already documented as tight: 4 Gunicorn workers × `DB_POOL_MAX=5` =
  20 client connections vs. Supabase free-tier pooler's 15-connection ceiling. This is a
  known capacity constraint (see `project_scale_hardening` memory), not a code bug. **A
  transient blip is expected under this constraint; raise `DB_POOL_MAX` or upgrade the
  Supabase plan if it recurs.**
- `DB schema ready with 1 failed statement(s); 72 applied` — logged at `log.error`
  inside `init_db()` (`database.py`); the *specific* failing DDL statement is only logged
  at `log.warning` one line above and wasn't visible in the Sentry summary screenshot.
  **Action needed: pull the actual warning-level log line (or the Sentry breadcrumb) to
  identify which of the ~69 schema statements is persistently failing.** Note: this class
  of issue is exactly what `7c45eaa`/`28ecb59` (below, §6) fixed the *performance*
  consequence of — a failing statement no longer causes the schema to re-run (and hang)
  on every request — but the underlying failing statement itself is still unidentified.

---

## 6. Org Space, Templates, Marketplace, Tiptap (Jun 28–30)

| Fix | Commit |
|---|---|
| Self-host the Tiptap rich-text editor bundle — was CSP-blocked loading from `esm.sh`, breaking the docs/notes editor on prod | `d7b20ae` |
| Safety-net fallback if the Tiptap bundle fails to load | `645447a` |
| Per-space Integrations toggles now reflect real connection state (`intIsConnected()`) instead of always-on | `ca0917b` |
| Templates panel now seeds **real content** on "Use template" (was a fake success message) | `4c11e91` |
| **Org invites:** members now actually get added to the org + invite/join notifications fire (previously the invite flow silently failed to add the member) | `a4a3bdd` |
| **Org schema perf:** `init_db` no longer re-runs the full ~69-statement schema on every `org_get`/`org_create` when one statement is persistently failing; invites are now also surfaced in-app on sign-in (bell + pending-invite prompt), not just via email/push | `7c45eaa` |
| **Org schema perf (follow-up):** single-flight guard so `init_db` can never be re-entered/re-run mid-flight even under concurrent worker contention at boot | `28ecb59` |
| Org seats: buy multiple seats up front (was capped at 1-at-a-time, limited to current member count) | `f6413e4` |
| Skeleton loading for async panels (kept the SVG boot screen) + org space panel specifically | `adcaa12`, `d998d07` |

**This directly explains and fixes** the "org endpoints slow/timing out on prod" finding
recorded in `docs/BILLING_RESUME.md` §1 during the 2026-06-30 verification pass — the
root cause was a persistently-failing DDL statement causing the schema-apply guard to
never latch, so every `org_get`/`org_create` re-ran all 69 DDL statements. That specific
finding should now be considered **resolved**, though the *underlying* failing statement
is still unidentified (see §5.3 above — same failing statement, different symptom).

---

## 7. Email (Jun 25–28)

| Fix | Commit |
|---|---|
| Rewrite of the 5 user-facing transactional emails (copy) | `23fcb85` |
| Send the welcome email on first verification, not at signup (previously sent to unverified/never-verified addresses) | `6cbb381` |
| Polish pass on the 5 notification emails (light touch) | `3c076ce` |
| Escape org-controlled values (names/titles) in mention/announcement emails — closes an HTML-injection vector | `9642f6e` |

---

## 8. Dev Tooling (Jun 29)

| Fix | Commit |
|---|---|
| Device-preview harness for mobile/tablet QA (`static/devices.html`) | `0f63e79` |
| Playwright device-emulation script for accurate phone/tablet QA (`device_screens.py`) | `c2e4b66` |

These are the tools behind the Phase 7 mobile static sweep (§9) and should be the go-to
path for verifying the mobile fixes in §3 that are still marked not-device-verified.

---

## 9. Pricing & Billing (Jun 29–30) — money is live

| Fix | Commit |
|---|---|
| **Phase 1** — USD-anchored pricing with live NGN conversion at checkout | `cbe95fc` |
| Admin USD→NGN rate editor (Revenue tab), durable in the `app_config` DB table | `adebabd` |
| **Phase 2a** — quota gating: plan feature caps (spaces/templates/integrations/analytics) | `a7b022c` |
| Enforce template + integration caps (continuation of quota gating) | `d800300` |
| **Phase 2b** — per-seat Organisation billing | `3737c83` |
| Billing resume/verification tracker doc (pause point) | `4b84870` |
| Local verification recorded: CSRF + quota + org logic (mock-DB harness) | `78fc6a1` |
| **Live-prod verification recorded**: USD pricing live, CSRF on real HTTPS, quota gating on real Postgres — plus the org-endpoint-slowness finding (now fixed, §6) | `e73f7f5` |
| **Phase 2b completion** — Flutterwave parity for per-seat org checkout (both gateways) | `666a6d3` |

**Verified on live prod (`sivarr.com`, real HTTPS + Postgres), 2026-06-30:**
- USD pricing live: `/api/billing/plans` → rate 1650, Pro `$12 ≈ ₦19,800`, Creator
  `$22 ≈ ₦36,300`.
- CSRF (P0, cleared): register sets `__Host-sivarr_session` + `sivarr_csrf`; POST without
  `X-CSRF-Token` → `403`, with it → `200`.
- Quota gating on real Postgres: Free user's 2nd space → `402`;
  `/api/billing/entitlements` reports correct plan/caps/usage.

**Still needs prod verification (money-critical, blocked until now by the org slowness
finding — which is fixed, so these should be unblocked):**
1. Personal Paystack charge + verify — real payment for Pro, confirm ₦19,800 charged and
   the store-and-verify amount lock holds.
2. Org Paystack charge + verify — real org checkout, org unlocks, seat banner correct,
   inviting past the seat count → `402`.
3. Admin rate editor durability — confirm the rate survives a Railway redeploy
   (`app_config` table, not an ephemeral file).
4. Quota gating with real DB across all cap types (templates/integrations/AI ceiling),
   not just the spaces cap already confirmed.
5. Calendar + gcal end-to-end (renders, connect, disconnect revokes, tz-correct pushes).

**Open product decisions (need Hunter's call, unchanged since `BILLING_RESUME.md`):**
Free-tier space cap of 1 may be too aggressive for existing testers; AI fair-use numbers
are a cost-vs-UX call; "Unlimited core AI" copy has a hidden ceiling; Creator plan
advertises "Claude Opus — coming soon" while the backend is actually Gemini 1.5; org
seats have no mid-cycle proration.

**Not yet built** (scoped in `BILLING_RESUME.md` §3, no code written): Trading Journal
add-on billing, Founder Mode / AI Exec Assistant flat org extensions, per-seat team
extensions (blocked on a CRM feature that doesn't exist yet), Founding-100 cohort pricing,
Student→Educator referral discount, tiered marketplace revenue split.

---

## 9.1 Continuation session — 2026-07-01 (later)

Focused on finishing per-seat Org billing and clearing the Org-space bugs Hunter reported
after the invite/join flow started working.

**Org-invite root cause finally fixed (`8418dc4`).** The original "invited user clicks the
mail → still shows *you're not part of an organisation*" was **two** bugs: (a) the org
endpoints hanging (single-flight `init_db`, §6), and (b) `/api/org/join` throwing a **500
on every join** — it compared the invite's `expires_at` (tz-aware `TIMESTAMPTZ` from
Postgres) against a naive `datetime.utcnow()`, which raises `TypeError`. Because the join
always 500'd, the member was never added → the org never showed. Fixed by normalising both
sides to aware-UTC. In-app pending-invite surfacing (bell + prompt on sign-in) was also
added (`7c45eaa`) so invites aren't lost if the email is missed. **Confirmed working by
Hunter.**

**Org-space UX bugs fixed (`1bdda5f`).**
- **Mobile chat** — the channel sidebar was a cramped 48px horizontal bar. Replaced with a
  retractable off-canvas **drawer** (hamburger in the chat header → slide-in, overlay,
  scrollable channel + DM list, bigger tap targets; picking a channel closes it). Messages
  area scrolls on mobile.
- **"Chats display very slow"** — channel switch showed a frozen blank during the
  round-trip. Added a loading hint + **per-channel message cache** (`_OC_MSG_CACHE`) so a
  revisited channel paints instantly, then refreshes. (The bigger win was the org-wide
  `init_db` fix.)
- **Task section "List" button did nothing** — the Board/List buttons had **no `onclick`
  at all**. Wired `orgSetTaskView('board'|'list')` and built a grouped **List view**
  (mirrors the personal Flux list: status groups + coloured dots + assignee/due, click to
  edit). Board and List stay in sync via `orgRenderTasks()`.

**Per-seat Org billing — now COMPLETE on both gateways (`666a6d3`).** Audited the existing
Phase 2b implementation end-to-end (all correct) and added the one missing piece:
**Flutterwave parity.**
- `/api/billing/org/subscribe` takes a `gateway` param (`paystack` default | `flutterwave`).
- `flutterwave_verify` branches on `metadata.kind=='org'` → `_billing_apply_org_flutterwave`
  (owner check + amount lock — **FLW amount is major-unit NGN, not kobo** — + idempotency).
- Client: `orgBillingSubscribe(period,seats,gateway)` handles both `authorization_url` /
  `payment_url`; the org modal offers both gateways; **`flutterwaveVerify` now activates the
  org plan** (it was misapplying org payments as a personal "Pro").
- Verified locally (mock-DB harness): seat pricing incl. 11–50 −10% and 51+ custom; owner
  check (403), amount lock (400), idempotent re-verify, string-meta coercion — for **both**
  Paystack and Flutterwave apply paths.

**What's left for Org billing (future continuation):**
1. **Live-money round-trip on prod** — the only thing not verifiable from the dev box (no
   Paystack/Flutterwave keys). Test as an org owner: *Manage seats* → pick seats + gateway
   → pay → confirm the org plan activates, the seat count sticks, and inviting past the seat
   count → `402`. This is the last gate for Org billing.
2. **Phase 2c** (not started, scoped in `BILLING_RESUME.md`): flat org extensions (Founder
   Mode $39 / AI Exec Assistant $49), Trading Journal personal add-on (+$6), per-seat
   team-wide extensions (+$4, blocked on a CRM feature that doesn't exist yet).
3. **Phase 3 mechanics:** Founding-100 cohort counter + lifetime lock, Student→Educator
   referral discount, tiered marketplace split (flat 90/10 today).
4. **Open product decisions** (unchanged): mid-cycle seat proration (currently none —
   re-subscribe to change seats); Free space cap of 1; "Claude Opus — coming soon" vs the
   real Gemini backend.

---

## 10. Pre-Launch Refinement Sweep — 9 Phases (Jun 30)

A living tracker (`docs/PRELAUNCH_REFINEMENT_TRACKER.md`) mapping a 9-stage refinement
plan onto the real codebase. Protocol: baseline auth-security suite green → static sweep
→ fix → re-verify, one change per commit, cache-bust every JS/CSS touch.

| Phase | Status | Commit(s) | Key finding |
|---|---|---|---|
| 1 — Functionality Audit | 🟡 static done | `fce7a8c` | 0 dead handlers, 0 nav-to-nowhere, 1 silent 404 (`/api/leaderboard`) |
| 2 — Navigation Cleanup | ✅ done | `528fa55` | Rebalanced default sidebar toward daily-use tabs; auto-hide empty nav section headers |
| 3 — Space Functionality | 🟡 static done | `eb07325` | All 3 spaces' core actions wired to real persisting endpoints; 1 stub (academic course-detail view) |
| 4 — Core Systems (Tasks/Projects/Teams) | 🟡 static done | `1008f44` | Gaps found: no task-assign notification (C1), no project progress bar (C2) |
| 5 — Chat & Integrations | 🟡 static done | `682bcb6` | Chat solid; Drive/Slack/Zoom not built — scope decision needed |
| 6 — Templates & Consistency | 🟡 static done | `f23e225` | 25 border-radius values, 56 font-sizes, 102 box-shadows, 93 unused tokens — large fix-pass item |
| 7 — Mobile Optimization | 🟡 static done | `cc1af53` | Touch targets <44px in places; no dedicated mobile type scale |
| 8 — Auth & Onboarding | 🟡 static done | `f688b89` | Onboarding already exists and is solid; no net-new build needed |
| 9 — Final QA & Launch Readiness | 🟡 checklist defined | `f688b89` | Runtime-only; runs last, after the fix pass |

**Bugs found by the sweep and fixed the same day:**
| Fix | Commit |
|---|---|
| B1 — `/api/leaderboard` 404 (endpoint didn't exist) | `ca65ff0` |
| C1/C2 — task-assign notification + project progress bar | `063a677` |
| T1 — Templates panel fake-success fix (see §6) | `4c11e91` |
| W1 — field-contract sweep: wrong/clear-all + goals/add field-name mismatches | `874deb6` |

**Decisions locked (Hunter, 2026-06-30):** Phase 5 integration scope — Google Drive +
Zoom/Meet are launch must-haves, Slack is post-launch. B1 and other findings fixed
immediately rather than deferred.

**What's left from the sweep:** Phase 6's consistency refactor (token sweep across the
whole CSS) and Phase 7's mobile type-scale are both large, deferred fix-pass items. Phases
1, 3, 4, 5, 7, 9 all still need Hunter's **runtime** pass (click-through on a real deploy,
real devices) — the sweep itself was static-only by design.

---

## 11. Performance & Misc (Jun 30)

| Fix | Commit |
|---|---|
| Self-host Plus Jakarta Sans for the app — drop the Google Fonts CDN dependency | `4ffe515` |
| Add `worker-src 'self' blob:` to CSP so Sentry's replay Worker isn't blocked | `ac7f728` |
| `locustfile.py` created then deleted same day (Jun 28) — an abandoned load-test experiment, no lasting effect | `a81d069`, `a83edb3` |

**Note (from memory):** landing/legal/admin/lecturer pages still load Google Fonts and
share the app's global CSP — don't tighten `style-src`/`font-src` to `'self'` until those
pages are migrated to the self-hosted font too.

---

## 12. Consolidated "What's Left" (everything still open, in priority order)

### P0 — money / security, needs prod verification
1. **Personal + Org Paystack real-money charge and verify** (§9) — now unblocked by the
   org-slowness fix; this is the highest-priority remaining verification.
2. **Commit and deploy today's uncommitted Sentry fixes** (§5.2) — `app.py` has 5 real
   bug fixes sitting in the working tree; they should be reviewed, committed, and
   deployed before they're lost or conflict with other concurrent work on `main`.
3. **Identify the persistently-failing DB schema statement** (§5.3) — cosmetic/perf now,
   but worth knowing which of the ~69 DDL statements never applies.

### P1 — verification backlog (logic proven locally/mock-DB, not yet on real prod)
4. Admin USD→NGN rate durability across a Railway redeploy.
5. Quota gating across all cap types on real Postgres (only the spaces cap is
   prod-confirmed so far).
6. AI fair-use ceiling metering on a real paid + free account.
7. Calendar + Google Calendar end-to-end browser pass, including tz-correct pushes.
8. Mobile fixes across §3 are not device-verified — use the new device-preview harness /
   Playwright script (§8) to close this out.
9. Academic Space v3 2-account classroom browser pass (carried over from the 06-16 report).

### P2 — known gaps, acceptable to ship with
- Flutterwave subscribe 503s in prod — check env vars or hide the button (§5.3).
- DB connection pool sized tight (20 client conns vs Supabase free-tier's 15) — raise
  `DB_POOL_MAX` or upgrade Supabase plan if exhaustion recurs (§5.3).
- Org/invite relay + forgot-password rate-limit gaps (§2, carried over, unfixed).
- P4 per-identity rate limiting (security roadmap, not started).
- Mozilla Observatory CSP `unsafe-inline` (~1,075 inline handlers) — large migration,
  post-launch.
- GCal OAuth: plaintext token at rest, UTC-vs-local-tz push events (§4).
- Google brand verification for the sensitive `calendar.events` scope — no CASA yet.

### P3 — deferred, scoped but not started
- Phase 6 CSS consistency refactor (design-token sweep) and Phase 7 mobile type scale.
- Billing Phase 2c/3 features: Trading Journal add-on, Founder Mode/AI Exec Assistant
  flat org extensions, per-seat team extensions (needs a CRM feature first), Founding-100
  cohort pricing, Student→Educator referral discount, tiered marketplace split.
  (Per-seat Org billing itself is **done on both gateways** — `666a6d3`, §9.1; only the
  live-money prod round-trip remains.)
- Google Drive / Zoom-Meet integrations (Slack is explicitly post-launch).
- Academic course-detail view (currently "coming soon").

---

## 13. Commit Index (this window)

79 commits, `3e202ed` → `1bdda5f` (2026-06-24 → 2026-07-01). Themes: security hardening
(§2), mobile redesign (§3), calendar/gcal (§4), observability/Sentry (§5), org
space/templates/marketplace (§6), email (§7), dev tooling (§8), pricing/billing (§9),
pre-launch refinement sweep (§10), perf/misc (§11). Full list via
`git log --since=2026-06-24 --oneline`. Plus one uncommitted fix session (§5.2) as of
2026-07-01, sitting in the working tree on top of `1bdda5f`.
