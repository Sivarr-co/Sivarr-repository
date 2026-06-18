# Sivarr — Your action checklist (testing + infra)

> Prepared 2026-06-17. The code work is done & largely verified; this is the
> human/infra part that only you can do. Ordered by priority.
> Legend: 🔴 blocks a 1000-concurrent launch · 🟡 important · 🟢 nice-to-have.
> "Already verified by Claude" = don't redo unless you want to.

---

## A. Launch-gate INFRA (🔴 — the real path to 1000 concurrent)

### A1. 🔴 Email for real users (Resend domain + paid tier)
Right now prod sends via the Resend **sandbox** sender (`onboarding@resend.dev`) which
ONLY delivers to your own Resend account address. Real users get nothing.
1. resend.com/domains → add **`sivarr.app`** → add the shown **SPF + DKIM TXT** records to your DNS.
2. Wait for "Verified".
3. Railway → Variables → set **`RESEND_FROM_EMAIL = noreply@sivarr.app`** (off the sandbox).
4. Move Resend to a **paid tier** (free = 100 emails/day; a 1000 launch needs ~50k/mo).
5. Test: register a brand-new email → confirm the **verification email arrives**, click it, sign in.
   (Pipe already proven; this is the domain + volume step.)

### A2. 🔴 Load test on a STAGING env (never prod)
Script is ready: `loadtest/k6-sivarr.js`.
1. Stand up a **staging** Railway env with a **separate** Supabase DB.
2. Install k6 (the zip is already in your verify temp, or `choco install k6`).
3. Run `PROFILE=peak BASE_URL=<staging-url> k6 run loadtest/k6-sivarr.js`.
4. Green = `sivarr_errors < 1%`, db-read p95 `< 800ms`, no pool exhaustion.
   Tell me the output and I'll help read it.

### A3. 🔴 Supabase Pro (DB connection ceiling)
Free pooler caps at **15 connections** — the hard wall for sustained 1000+.
1. Upgrade Supabase to **Pro**.
2. Then in Railway raise **`DB_POOL_MAX`** (e.g. 10–15) — only after upgrading.

### A4. 🔴 Scale out (after A2 is green)
1. Railway → bump to **≥ 2 instances** (Redis already makes this safe).
2. Put **Cloudflare CDN** in front of `app.js` / `styles.css`.

### A5. 🟡 Web push env (classroom announcements fire as OS notifications)
Set in Railway: **`VAPID_PUBLIC_KEY`**, **`VAPID_PRIVATE_KEY`**, **`VAPID_EMAIL`**.
Without them, announcements still show in the in-app feed (graceful) — just no push.

### A6. 🟡 Rotate `ADMIN_PASSWORD`
It was exposed in an earlier chat transcript. Railway → Variables → set a fresh value.

### A7. 🟢 Investigate slow DB ping
Prod `/api/health` showed `db_ms ~502` (high for a bare ping). Likely Railway↔Supabase
region/pooler latency. Worth a look before launch; tell me and I'll dig in.

---

## B. Functional BROWSER tests (🟡 — confirm in real use)

> Note what Claude already verified so you can skip the redundant parts.

### B1. 🔴 Classroom — needs TWO real accounts (the human-facing bits)
*Claude verified the full API flow on prod (create→join→check-in→wrong-code→grade).
What still needs a human + 2 accounts:*
1. Account **L**: Academic space → role **Lecturer** → publish a class (get code).
2. Account **S** (different browser/device): Academic space → **Student** → join with the code.
3. L: **Take Attendance** → S: **Check in** with the code → confirm S shows "present", L's roster updates live.
4. L: post an **Announcement** → confirm S sees it in **Class Feed** *and* (if A5 done) gets a **push notification**.
5. L: create an **Assignment** → S **submits** → L **grades** → S sees grade/feedback.
6. L: **Go live** + run a **poll** → S sees the live banner + **votes** → results update.

### B2. 🟢 Marketplace + extensions  *(Claude browser-verified on prod — spot-check only)*
1. Open any space → sidebar **⋮ → Settings & extensions** → enable **Smart Flashcards**.
2. Confirm a **Flashcards tab** appears in that space → Add a card → **reload** → card persists.
3. **Citations** ext → generate one (AI) → reload → persists.
4. Marketplace → install an extension → **reload** → still "Installed"; leave a **review** → reload → persists.

### B3. 🟡 Google Calendar integration (real, end-to-end)
1. Enable the **Calendar** extension in a space → click **Connect Google Calendar** → complete OAuth.
2. Confirm your **real upcoming events** show in the Calendar tab.
   (Requires `GOOGLE_CLIENT_ID/SECRET` set + the calendar redirect URI authorized in Google Cloud.)

### B4. 🟢 Quick UI checks
- Sidebar **Spaces** header → collapses/expands the dropdown, state persists on reload.
- On your **Dell**: confirm icons render everywhere (Tabler is self-hosted now).

---

## C. Auth on prod (🟡)

### C1. Google sign-in (step E of docs/AUTH_SMOKE_TEST.md)
*Claude verified A–D, F–H on prod (register/login/wrong-pw/duplicate/session/logout).*
You do the browser-only one:
1. Sign out → **Sign in with Google** → confirm it lands you logged in (repeat 2–3×).
2. Requires `BASE_URL`, Google redirect URIs correct for the prod origin.

---

## D. Cleanup (🟢)

### D1. Delete synthetic test users (Supabase SQL editor)
```sql
delete from users where email like 'djhunterd712+smoke%'
   or email like 'djhunterd712+lec_%' or email like 'djhunterd712+stu_%';
```
(`hunnter9987@gmail.com` now has a password from testing — that's your real account, leave it
unless you want to reset it.)

---

## What Claude can still do (just ask)
- Wrap more extensions real (Kanban+ ← Flux board, Finance ← finance panel).
- Tiptap self-host (needs a machine that can reach npm/esm.sh — this one is TLS-blocked).
- Help read the k6 results; investigate db_ms; re-run the prod browser pass after any change.

**Bottom line:** the launch blockers are all in section **A** (email domain → load test → Supabase
Pro → scale out). Everything else is verification and polish.
