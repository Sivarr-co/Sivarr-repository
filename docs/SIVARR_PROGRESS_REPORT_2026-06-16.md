# SIVARR — Development Progress Report (Continuation)

> **Purpose:** Account of everything built, fixed, and shipped since the last report.
> **Window covered:** 2026-06-13 → 2026-06-16 (continues `SIVARR_PROGRESS_REPORT.md`, which ended 2026-06-12)
> **Commits in window:** 42 · **HEAD:** `093303c`
> **Prepared:** 2026-06-16
> **Source of truth:** git history + verified codebase state (not assumptions)

---

## 1. Executive Summary

The previous report closed with a working multi-user platform that had just passed a security-remediation pass. This window turned that into a **launch-hardened** product and then added a major new capability surface.

Three arcs:

1. **Scale & reliability hardening** — made Sivarr ready for a 1000-concurrent push: thread-safe DB pooling sized for the Supabase free plan, a Redis layer for cross-worker rate-limiting and caching, AI cost caps + circuit breaker, and a full migration of every flat-file store into Postgres (per-record, so concurrent writers no longer clobber each other). `/api/health` became an honest live probe.

2. **Launch blockers cleared** — resolved the production auth/email pain: self-hosted the front-end CDN assets that were failing on some networks, hardened email with cross-provider fallback + diagnostics, and added the go-live tooling (prod-readiness gate, live auth smoke test, k6 load-test script). Live auth smoke test passed on prod.

3. **Academic Space v3 — a real classroom** — replaced the single Academic panel with a **dual-role (Lecturer / Student) dashboard**, then built a shared lecturer↔student class system on top: join codes, live attendance with a register, announcements with web-push, a gradebook with submissions, and live sessions with in-class polls.

**Where it stands today:** the same FastAPI + Vanilla JS + PostgreSQL app on Railway, now with Redis, all-Postgres persistence, a launch-readiness gate, and an Academic Space that functions as a live classroom. Remaining work is infra/verification (load test on staging, Supabase Pro, 2-account browser pass of the classroom) rather than missing features.

---

## 2. Scale & Reliability Hardening (Jun 13)

The "#-numbered" scale program to support 1000+ concurrent members.

| Area | What changed | Commit |
|---|---|---|
| Health-check timeout | Railway healthcheck 30s → 120s | `2ed4915` |
| Async startup | Blocking DB startup moved off the event loop (was timing out health checks) | `6680394` |
| Org load | Stopped re-running schema per request; parallelized reads | `28b606a` |
| DB pool | `SimpleConnectionPool` → **`ThreadedConnectionPool`** (thread-safe), env-tunable size | `b64c54b` |
| Pool sizing | Sized for Supabase free pooler (15-conn ceiling) | `c6b6307` |
| AI cost control | Per-user **daily meter + circuit breaker** on AI endpoints | `0dd7a34` |
| File → Postgres | Personal stores (goals / tasks / journal) migrated off JSON files | `be0c477` |
| File → Postgres | Generic **`collections`** table + per-record CRUD (migration base) | `1508355` |
| File → Postgres | Exam results & sessions → per-record (grades-safe under concurrency) | `a9239e5` |
| File → Postgres | classes / exams / topics / groups / announcements migrated | `49597a7` |
| Redis | **`rcache.py`** — cross-worker rate-limiting + shared response cache (graceful fallback) | `826d52c` |
| Observability | `/api/health` now does a **live DB ping** + reports Redis / pool / AI | `4e3cf68` |

Net effect: no flat-file stores remain in the hot path; rate-limits and cache are cross-worker; the app can be scaled to ≥2 instances once load-tested.

---

## 3. Security (audit item #5b + follow-ups) (Jun 13–14)

| Fix | Commit |
|---|---|
| `/api/study-deck` token-auth (was a spoofable `sid` form field) — backend + client | `78c62de`, `0da5e02` |
| Atomic class-join (no last-writer-wins) + **encrypt third-party secrets at rest** | `0e915e2` |
| Account-delete now purges the user's PII (blobs, exam results/sessions) | `78c62de` |
| `/api/upload` token-auth (was spoofable `sid` → IDOR) | `f1b5ca2` |
| Removed dead `/api/clear-history` + client `/api/reset-progress` calls | `6f7e382` |
| Self-host DOMPurify + token-authed `/api/reset-progress` (real server-side wipe) | `3ec5e59` |

---

## 4. Launch Readiness: CDN, Email, Tooling (Jun 13–14)

**Front-end resilience (CDN):** some clients (and Nonso's own machine) couldn't load assets from `cdn.jsdelivr.net` (TLS revocation failures). Fixed by self-hosting:
- Tabler icon webfont self-hosted — fixes blank icons on jsdelivr-unreachable clients (`9ce78c9`; CSP stopgap `195194b`).
- DOMPurify self-hosted (`3ec5e59`).

**Email hardening (`dddf215`):** cross-provider fallback (Gmail SMTP ↔ Resend) so one misconfigured provider can't silently drop verification/reset mail; `/api/admin/test-email` now returns an actionable diagnostic. *(Operational note: Railway blocks outbound SMTP, so production email must go via Resend's HTTPS API with a verified sender domain — Gmail SMTP fails with "network unreachable" on Railway.)*

**Go-live tooling:**
- `68ec023` — k6 load-test script for the 1000-concurrent validation (`loadtest/`).
- `4fde97b` — live-prod auth smoke-test checklist (`docs/AUTH_SMOKE_TEST.md`).
- `3357a29` — prod-readiness go/no-go gate (`docs/PROD_READINESS.md`).
- `bf0e791` — secrets-at-rest status surfaced in `/api/health`; `7e9c2a4` — docs point at the Railway prod URL.
- `81d73a2` — UnicodeDecodeError fix (explicit UTF-8 file I/O).

**Verification:** the live-prod auth smoke test passed (register / login-gated-on-verify / wrong-password / duplicate / session-restore / logout all correct across workers). Email delivery proven over Resend HTTPS; **a verified sender domain + paid tier is the remaining launch step** for real-user volume.

---

## 5. Spaces & Sprints polish (Jun 13–14)

- **Sprint B** — Naira currency fix for founder financials (`4df16cf`).
- **Mood chart** — map journal emoji moods to keyword scores so the chart renders (`6a46b0f`).
- **Sprint C** — seed community / opportunities / agents; fix empty marketplace (`cf6923e`); marketplace categories + opportunities byline fix (`462e0a5`).
- **Sprint D** — calendar week/day views documented (already implemented) (`9d55500`).
- **Templates** — replaced the old step-checklist Templates panel with an iframe-preview **Template Library** (4 generated HTML tools) (`f585b78`).
- **Spaces picker** — unified to a single 3-type picker (Personal / Organisation / Academic) and made Org pin beneath Spaces like the others (`0dc46c4`).

---

## 6. Academic Space v3 — Dual-Role Classroom (Jun 15–16) ★ headline

Replaced the single Academic panel with a **role-gated dual dashboard** chosen at space creation, then built a shared lecturer↔student class system on top. All persistence is per-record in Postgres (`acad_*` collections, keyed so per-class queries are a single read); AI features use the real `/api/chat`; notifications reuse the existing VAPID web-push.

| Phase | What it adds | Commit |
|---|---|---|
| **1 — Dual-role shell** | Lecturer vs Student dashboards (6 tabs each), brand-mapped UI, role persisted; AI tools (lesson plan / quiz / feedback / tutor / citation engine) on `/api/chat` | `9b718a5` (+ CSS cache-bust `5f35c5f`) |
| **2 — Lecturer CRUD + AI flashcards** | Add/Export students, create/delete quizzes & assignments; student "AI cards" generate Q/A flashcards into the Exam-Sprint drill | `6ecff18` |
| **3a — Class bridge** | Lecturer publishes a class → 6-char **join code**; students join → shared roster (no global lecturer password) | `1cf6b33` |
| **3b — Live attendance** | Start session → rolling check-in code + live roster (poll) → register; attendance % (late after 10 min) | `2fafe33` |
| **3c — Announcements + push** | Lecturer posts → **web-push** to members + aggregated student class feed | `aa7baaf` |
| **3d — Gradebook** | Shared assignments → student submit/resubmit → lecturer grade → student sees grade + feedback | `230630a` |
| **3e — Live session + polls** | "Go live" join link + in-class polls with live result bars (one-vote-per-student, no tally race) | `093303c` |

**Design decisions (with Nonso):** keep the Lecturer role **per-user** (the existing institutional class system is global-password-gated — a different product); **map to Sivarr brand** colors (green/amber, not the spec's cyan/indigo); **persist per-user to Postgres**.

**Verification:** every phase passed `py_compile` + `node --check` + a VM/DOM harness driving the real `app.js` (role render, tab switching, persistence, attendance polling, vote tallies). Phase 1 and Phase 2 were browser-verified on prod. The full 2-account classroom round-trip (publish → join → attend → announce → assign → grade → live/poll) is verified at the API level on prod; a 2-account **browser** pass is the remaining check.

---

## 7. What's left (carryover)

These are **infra / verification**, not missing features:

- **Load test at scale** on a *staging* env (k6 script ready) → then bump Railway to ≥2 instances + Cloudflare CDN.
- **Supabase Pro** — the free pooler's 15-conn ceiling is the real ceiling for sustained 1000+.
- **Email for real users** — verify the sender domain in Resend + paid tier (Railway blocks SMTP; Resend HTTPS is the path).
- **Web push env** — set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in Railway so classroom announcements fire OS notifications (graceful in-feed fallback otherwise).
- **Academic v3 browser pass** — 2-account classroom round-trip in a real browser.
- **Open security items** — see the auth-audit notes (subscription-verify amount/idempotency hardening, org/invite relay rate-limit + escaping).

---

## 8. Commit Index (this window)

42 commits, `2ed4915` → `093303c` (2026-06-13 → 2026-06-16). Themes: scale/reliability (§2), security (§3), launch readiness (§4), sprints/spaces polish (§5), Academic Space v3 (§6). Full list via `git log --since=2026-06-13`.
