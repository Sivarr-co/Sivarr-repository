# Sivarr production readiness — go/no-go gate

One page. Tie-together of the auth smoke test, the load test, and the env/infra
TODOs into a single go-live gate. Don't ship with a **REQUIRED** box unchecked.
Record date + `git rev-parse HEAD` at the bottom when you sign off.

Companion docs: [`AUTH_SMOKE_TEST.md`](AUTH_SMOKE_TEST.md) ·
[`../loadtest/README.md`](../loadtest/README.md)

---

## Gate 1 — Secrets & env vars (Railway)
Var names are exact (`app.py` / `config.py` / `database.py` / `rcache.py`).

### REQUIRED — app is broken or insecure without these
- [ ] **`DATABASE_URL`** — Supabase **pooler** (port **6543**, user `postgres.<ref>`).
- [ ] **`GEMINI_API_KEY`** — all AI features (`/api/health` → `ai:true`).
- [ ] **`BASE_URL`** — the **prod** origin. Wrong value silently breaks email
      verify links, password-reset links, and the Google OAuth redirect.
- [ ] **`APP_ENCRYPTION_KEY`** ⚠️ — activates secrets-at-rest (Fernet). **Unset =
      org/payment secret keys stored PLAINTEXT** (logs a warning). The code is
      shipped; this just turns it on.
- [ ] **`REDIS_URL`** ⚠️ — rate-limit + shared cache. Unset = silent per-worker
      fallback (no cross-instance limiting; blocks horizontal scaling).
      Confirm `/api/health` → `redis:true`.
- [ ] **`GOOGLE_CLIENT_ID`** + **`GOOGLE_CLIENT_SECRET`** ⚠️ — Google sign-in.
      `GOOGLE_CLIENT_SECRET` also keys the stateless Google-code HMAC; unset
      falls back to a hardcoded constant (predictable signing key — insecure).
- [ ] **Email sender** — REQUIRED because sign-in is gated on email verification
      (`403 email_not_verified`) and password reset needs it. Set **either**
      `RESEND_API_KEY` (+ `RESEND_FROM_EMAIL`) **or** `GMAIL_USER` +
      `GMAIL_APP_PASSWORD`. No email ⇒ new users can't verify ⇒ locked out.
- [ ] **`ADMIN_PASSWORD`**, **`LECTURER_PASSWORD`** — set intentionally. Empty =
      that login is disabled by design (the P6 fix), which may be what you want.

### REQUIRED IF monetizing (payments)
- [ ] `PAYSTACK_SECRET_KEY` + `PAYSTACK_PUBLIC_KEY` (secret also verifies the
      webhook HMAC) · and/or `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_PUBLIC_KEY`.
- [ ] `NAIRA_RATE` if you rely on USD→NGN conversion.
- [ ] Sandbox-test the subscription flow (see Gate 3) — the amount/currency/
      idempotency fix (A1/P1) was only verified with mocks.

### TUNING — has defaults, set deliberately for scale
- [ ] `DB_POOL_MIN` / `DB_POOL_MAX` — size so `workers × DB_POOL_MAX ≤` your
      Supabase connection ceiling (**free pooler = 15**). Raise only after Pro.
- [ ] `RATE_LIMIT_CHAT` / `_QUIZ` / `_UPLOAD` / `_LOGIN` / `_VERIFY` / `_WINDOW`,
      `FREE_DAILY_CHAT`, `AI_DAILY_FREE`, `AI_BREAK_THRESHOLD` / `_COOLDOWN`.

### OPTIONAL
- [ ] `SENTRY_DSN` (errors), `PLAUSIBLE_DOMAIN` (analytics),
      `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_EMAIL` (web push), `CRON_SECRET`,
      `GITHUB_CLIENT_ID`/`_SECRET`, `MONO_*`, `STRIPE_*`.

---

## Gate 2 — Infra & scaling
- [ ] `GET /api/health` → `status:"ok"`, `db:true`, **`redis:true`**, sane
      `db_ms`, `db_pool` reported (not `degraded`).
- [ ] `GET /health` → `200` and Railway healthcheck passes (timeout is 120s).
- [ ] Boot logs clean — **no** `DB schema init failed`.
- [ ] **Load test passed on STAGING** (never prod): run `loadtest/k6-sivarr.js`
      (`PROFILE=peak`), thresholds green — `sivarr_errors < 1%`, db-read p95
      `< 800ms`, no pool exhaustion in `db_pool` during the run.
- [ ] After a green load test: Railway bumped to **≥ 2 instances**;
      **Cloudflare CDN** in front of `app.js` / `styles.css`.
- [ ] Capacity plan: free Supabase pooler (15 conns) is the hard ceiling for
      sustained 1000+ — **Supabase Pro** is the real lift; raise `DB_POOL_MAX`
      after upgrading.

---

## Gate 3 — Functional verification (on live prod)
- [ ] **Auth smoke test A–H green** — [`AUTH_SMOKE_TEST.md`](AUTH_SMOKE_TEST.md).
      This is the original sign-in/sign-up/Google lockout loop. **Highest
      priority** — the audit fixes were only verified in-process.
- [ ] **Payment sandbox** — subscribe to a plan, confirm verify enforces
      amount ≥ price + currency NGN + idempotency (can't re-grant on replay,
      can't upgrade by tampering the plan param).
- [ ] **Per-record grades** — create class + exam → student submits → lecturer
      sees the grade (concurrent submits must not clobber).
- [ ] **Templates Library** — opens, iframes render (CSP `frame-src` change).
- [ ] **Mood chart** — renders from real journal data.
- [ ] **Marketplace** — populates (not empty).

---

## Gate 4 — Security posture
- [ ] Secrets-at-rest **active** — save an org integration secret, confirm the
      stored value in the DB is ciphertext (needs `APP_ENCRYPTION_KEY`).
- [ ] IDOR class closed — `/api/upload`, `/api/study-deck`, goals/exam/class
      endpoints require a **session token**; a raw `sid` is rejected (`401`).
- [ ] Admin/lecturer login is constant-time and disabled when its secret is
      unset (P6).
- [ ] Org Paystack endpoints are admin/owner-gated, not any-member (P4).

---

## Gate 5 — Observability & rollback
- [ ] Sentry receiving events (if `SENTRY_DSN` set).
- [ ] You know the rollback: Railway → redeploy the previous green build.
- [ ] A backup/restore path for Supabase is confirmed.

---

## Known gaps (acceptable to ship with, track as follow-ups)
- `/api/reset-progress` has **no backend** — "Reset Progress" only clears local
  state + signs out; server stats are not wiped. (TODO in code.)
- classes/groups concurrent **leave** is last-writer-wins (join is atomic).
- `quiz/question` + `class/detail` expose generated questions / class metadata
  via `?sid=` (not private user data).

---

## Sign-off
```
Date:        ____________________
Commit:      ____________________   (git rev-parse HEAD)
Gates 1–5:   [ ] all REQUIRED green
Signed:      ____________________
```
