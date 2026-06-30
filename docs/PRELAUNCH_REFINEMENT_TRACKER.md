# Sivarr Pre-Launch Refinement — Living Tracker

> Maps the 9-stage Pre-Launch Refinement Plan (June 2026 PDF) to the real codebase.
> This is a **refinement** pass, not a rebuild — Build Blueprint Stages 1–9 already
> shipped (see `BUILD_BLUEPRINT_TRACKER.md`). Most work here is **audit → verify →
> polish → standardize → mobile → onboarding → QA**.
>
> Status: ✅ done · 🟡 partial · 🔵 in progress · ❌ not started.
> Started 2026-06-30.

## The "don't break anything" protocol (every change obeys this)
0. **Baseline** — `python scripts/test_auth_security.py --base <url>` is GREEN before code changes start (Hunter's env; sandbox can't run the app — no psycopg2/server).
   - ✅ **LOCKED 2026-06-30: `33 passed / 0 failed / 10 skipped`** (local file-mode, venv). The 10 skips are rate-limit artifacts (the suite trips the per-IP 429 limit mid-run), not failures. Re-run with `RATE_LIMIT_LOGIN` raised to un-skip them if 100% coverage is wanted. Local run = file-mode (`uvicorn app:app --port 8000`, no DATABASE_URL).
1. **Read-before-edit** — read exact lines, smallest diff.
2. **Static check** — `py_compile` + `node --check` on every change.
3. **Logic self-test** — prove testable logic offline with a stdlib harness (cf. TOTP RFC vector, exam `coll_*`).
4. **Additive-only backend** — new endpoints beside old; never change a working contract.
5. **Scoped CSS** — mobile changes only inside `@media (max-width:720px)`.
6. **Atomic commits + cache-bust** — one change per commit; bump `?v=` for JS/CSS. Revert-by-commit = rollback.
7. **Regression gate** — after each phase: re-run the suite + browser/device check on touched flows (Hunter).

## Division of labor
- **Claude (here):** static sweeps, code changes, syntax + logic verification, atomic commits, docs.
- **Hunter (his env):** baseline + per-phase regression run, redeploy, real-device checks, scope decisions.

---

## Phase 1 — Functionality Audit 🟡 (static done; runtime gate pending Hunter)
Static sweep done → `docs/PRELAUNCH_AUDIT.md`. Results: **0 dead handlers**, **0 nav-to-nowhere**, **1 silent 404** (`/api/leaderboard` → B1), 8 placeholder markers (mostly intentional). App is in strong shape. Remaining: Hunter's runtime click-through checklist (blank screens / empty states / console errors) on a deploy.

## Phase 2 — Navigation Cleanup ❌ (depends P1)
Exists: command-center sidebar, collapsible sections, top-bar cleanup. Work: hide zero-content sections, remove placeholder nav from P1, group academic tools. Verify: every real dest reachable, 0 console errors.

## Phase 3 — Space Functionality Review ❌
Exists: Personal / Org / Academic all built. Work: walk each as a new user end-to-end; route partials back to P1. Mostly verification + targeted fixes.

## Phase 4 — Core Systems (Tasks/Projects/Teams) ❌
Exists: tasks/goals/habits/projects + Org roles/invites/audit. Work: polish daily flows (fast create, assignee clarity, status, % view, sort/filter). Backend additive only.

## Phase 5 — Chat & Integrations ❌ (largest net-new)
Exists: Org/group SSE chat, integrations grid (Google OAuth/Calendar, GitHub, Paystack/Flutterwave/Mono). Net-new: Drive / Slack / Zoom-Meet bridges + msg→task. Each integration = additive module + card state; sub-phased, independently shippable. **Scope TBD (Hunter).**

## Phase 6 — Templates & Interface Consistency ❌ (depends nav/spaces stable)
Exists: Templates Library + marketplace. Net-new: consistency system — tokenize spacing/radius/shadow/type, sweep pages to tokens one component-family at a time (non-visual-diff refactor). No behavior change.

## Phase 7 — Mobile Optimization ❌ (depends P6)
Exists: mobile launcher (Phase 1) + stat-card resize started. Work: per-page reflow, touch targets, overflow, mobile type scale. All scoped to `@media (max-width:720px)`; verify via `scripts/device_screens.py` + real phone (NOT the iframe harness).

## Phase 8 — Auth & Onboarding ❌
Exists: auth fully hardened (security roadmap P1–P4, 2FA, cookies, CSRF). Net-new: first-run onboarding — sensible default space, dismissible tour/checklist, ≤60s to first action. Additive UI gated on a first-login flag; no auth-logic changes.

## Phase 9 — Final QA & Launch Readiness ❌ (verification only)
Re-run P1 audit list (all resolved), suite green, 3 real devices, loading/error states, outside-tester onboarding, final visual sweep, rollback plan (atomic commits). No new features.

---

### Open decisions (Hunter)
- Phase 5 integration must-haves vs post-launch.
- Audit seeds: known-broken/placeholder pages.
