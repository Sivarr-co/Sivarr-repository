# Live-prod auth smoke test

Verifies the June-2026 auth audit fixes against the **real Railway + Supabase**
deploy (so far they were only verified in-process). Run this after any deploy
that touches auth, and right now to close out the audit's "not yet tested live"
gap. ~10 minutes.

Each step names the finding/commit it covers and the **red flag** that means a
regression. The original production complaint was: sign-in, sign-up, **and**
Google all failing in a lockout loop — steps A, B, D, E, G are exactly that loop.

## Setup
- `BASE` = your prod origin. **Currently the Railway URL** —
  `https://sivarr-repository-production.up.railway.app` — `BASE_URL` has NOT
  been cut over to `sivarr.com` yet (the custom domain isn't routed). Test the
  Railway URL until the cutover, and keep `BASE` == whatever `BASE_URL` is set
  to (email/OAuth links use `BASE_URL`).
- A **fresh** email you control (real inbox — verification + reset links go there).
  Use a `+tag` alias so you can repeat, e.g. `you+smoke1@gmail.com`.
- A **real Google account** for the OAuth step (use one NOT already registered).
- `curl` examples use `curl.exe` (works in PowerShell + bash). In PowerShell,
  `curl` is an alias for `Invoke-WebRequest` and behaves differently — type
  `curl.exe` explicitly, or run these from Git Bash / WSL.

```bash
BASE=https://sivarr-repository-production.up.railway.app   # ← current prod (Railway)
EMAIL=you+smoke1@gmail.com       # ← a fresh real inbox
PW='Smoke!2345'
```

---

## 0. Pre-flight — infra is up
Covers: #6 honest health (`4e3cf68`), Redis (#3), `APP_ENCRYPTION_KEY`.

- [ ] `curl.exe $BASE/health` → `200`, `{"status":"ok"...}` (Railway healthcheck).
- [ ] `curl.exe $BASE/api/health` and confirm:
  - [ ] `"db": true` and a sane `"db_ms"` (not null, not seconds).
  - [ ] `"redis": true` — **red flag if false**: `REDIS_URL` isn't set, so the
        rate-limiter + shared cache silently fell back to per-worker memory.
  - [ ] `"db_pool"` present; `"status":"ok"` (not `"degraded"`).
- [ ] Railway logs at boot show **no** `DB schema init failed` line.
  **Red flag:** if present, later tables may be missing (see step E / §Logs).

---

## A. Email sign-up — brand-new account
Covers: register path (`app.py:2364`), per-statement schema init (`d041903`),
new-user DB persist (`app.py:2414`).

- [ ] ```bash
      curl.exe -s -X POST $BASE/api/login -H "Content-Type: application/json" \
        -d "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"$PW\",\"confirm_password\":\"$PW\",\"action\":\"register\"}"
      ```
  → `200` JSON containing **`"token"`** and **`"sid"`** (20-hex). Save the token.
  (Register logs you in immediately via this token — but a *fresh* sign-in in
  step B requires email verification first; see A.5.)
- [ ] Verification email arrives in the inbox (background send).
- [ ] **Red flag:** `409` on a genuinely new email → an orphaned/duplicate row
      exists for it (the old lockout cause). Note it and move to step D/G.

## A.5. Verify the email (required before step B)
Covers: email-verification gate (`app.py:2456`).

- [ ] Click the **verify** link in the inbox (`$BASE/api/auth/verify-email/<token>`)
      → confirmation page. Login is blocked until this is done.

## B. Email sign-in — existing account
Covers: login path (`app.py:2431`), login decoupled from Gemini (`d041903`),
DB-read defensive defaults (`2723eb6`).

- [ ] ```bash
      curl.exe -s -X POST $BASE/api/login -H "Content-Type: application/json" \
        -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"action\":\"login\"}"
      ```
  → `200` with a fresh `token` + `sid`.
- [ ] **Expected before A.5:** `403 email_not_verified` (and a fresh verify
      email is auto-sent). After clicking the verify link it should be `200`.
- [ ] **Red flag:** `500` here = DB/Gemini coupling regressed (login should
      never 500 on a flaky DB or AI init).

## C. Wrong password rejected
- [ ] Same as B with a wrong password → **`401`** "Incorrect password" (not 500,
      not 200). Confirms bcrypt check + constant-time compare are intact.

## D. Duplicate email handled cleanly
Covers: register collision branch (`app.py:2394`).

- [ ] Re-run step A with the **same** email → **`409`**, detail
      `"An account with this email already exists. Sign in instead."`
- [ ] **Red flag:** `409` with detail `account_is_passwordless` here means this
      account has no password (Google-only) — that's correct *only* if you
      registered it via Google; for a password account it's a regression.

---

## E. Google sign-in — THE keystone fix
Covers: stateless signed Google code (`d041903`, fix #1) — the cross-worker
exchange failure that caused "Google sign-in failed, try again".

Do this **in a browser** (OAuth can't be curl'd):
- [ ] Open `$BASE`, click **Sign in with Google**, pick the real Google account.
- [ ] Redirects back and lands you **logged in on the dashboard**.
- [ ] **Red flag:** "Google sign-in failed, try again" after the redirect, or the
      URL stuck with `?google_code=…`. That's the exchange failing — the exact
      bug the stateless-code fix was meant to kill. If it happens, check §Logs.
- [ ] Repeat 2–3 times (Gunicorn has 4 workers; the old bug was intermittent
      because the exchange landed on a different worker than the callback).

## F. Session survives reload — "logged out after reload" fix
Covers: session-restore shape mismatch (`195194b`), `/api/session/restore`.

- [ ] While logged in (from B or E), **hard-reload** the page (Ctrl+Shift+R).
- [ ] You stay logged in — no bounce to the sign-in screen.
- [ ] Reload **5+ times** (hits different workers; the old KeyError evicted the
      session only on workers that had warmed their cache from the DB).
- [ ] API check: ```bash
      curl.exe -s -X POST $BASE/api/session/restore -H "Content-Type: application/json" \
        -d "{\"token\":\"<TOKEN_FROM_B>\"}"
      ``` → `200` with your `sid`/`name`. **Red flag:** `401`/`500` on a token
      that's minutes old = restore regressed.

## G. Passwordless (Google-only) account can claim a password
Covers: passwordless recovery (`15b75e7`, fix #3) — the other half of the
lockout loop.

Use the **Google account from step E** (it has no password):
- [ ] Try **email** sign-in with that Google email + any password →
      **`401 google_only_account`** (the client should show a "set a password"
      prompt, not a dead error).
- [ ] Trigger reset: ```bash
      curl.exe -s -X POST $BASE/api/auth/forgot-password -H "Content-Type: application/json" \
        -d "{\"email\":\"<google-email>\"}"
      ``` → `200` (always 200, even if absent — no account enumeration).
- [ ] Reset link arrives → set a password via the link → succeeds.
- [ ] Now email sign-in (step B) with that email + new password → **`200`**.
- [ ] **Red flag:** can't ever set a password / link errors = recovery path
      broken, account stays locked out.

## H. Logout invalidates the token
- [ ] Log out in the UI (or `POST $BASE/api/logout` with `{"token":...}`).
- [ ] Re-running step F's `/api/session/restore` with that token → **`401`**.

---

## §Logs / DB — only if a step above fails
Covers: schema-init root cause (auth-audit) — `google_exchange_codes` table.

- [ ] Railway logs for: `DB schema init failed`, `google_xcode store failed`,
      `pop_google_xcode failed`, `failed to persist new user`.
- [ ] In Supabase SQL editor, confirm the table exists (the stateless-code fix
      should make exchange independent of it, but a missing table still signals
      a broken schema init):
      ```sql
      select to_regclass('public.google_exchange_codes');   -- non-null = exists
      select count(*) from users where password_hash is null or password_hash = '';
      ```
      The second query counts passwordless (Google-only) accounts — expected to
      be > 0; a spike of them with email accounts mixed in is the lockout smell.

## Cleanup
Delete the synthetic rows when done:
```sql
delete from users where email in ('you+smoke1@gmail.com');  -- your test emails
```

---

### Pass = audit closed live
A–H all green ⇒ the production sign-in / sign-up / Google lockout loop is
genuinely resolved on the live deploy (not just in-process). Record the date +
commit `git rev-parse HEAD` next to your run.
