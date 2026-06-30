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

## Phase 2 — Navigation Cleanup ✅ (2026-06-30)
Found the nav already strong (config-driven, grouped, 0 dead from P1, ⌘K-customizable). Shipped: (1) **rebalanced `NAV_DEFAULT`** toward daily-use — promoted Tasks + Docs&Notes into default Work, demoted Templates/Weekly Review + Community/Opportunities/Agents to ⌘K-only (default sidebar 14→12, the right 12); (2) **auto-hide a section header when its group is empty** (`_navRenderSec`: hides the preceding `.sb-sec-head` when 0 items). Additive, reversible, `node --check` clean, cache-bust `app.js v=20260630a`. Note: existing users keep their saved `sivarr_navtabs_<sid>`; the new default only applies to users who never customized.

## Phase 3 — Space Functionality Review 🟡 (static done; runtime gate pending Hunter)
Static sweep (`PRELAUNCH_AUDIT.md`): all 3 spaces' promised core actions wired to real persisting endpoints/stores. Personal (tasks/goals/habits/notes/projects/finance), Org (create/tasks/goals/docs/invite/role/remove/chat-SSE), Academic (class/assignment/exam/announce/poll/grade → `/api/acad/*`). One stub: **I4 academic course-detail view** (`lOpenCourse` → "coming soon"; create/list works). Remaining: Hunter walks each space create→reload end-to-end.

## Phase 4 — Core Systems (Tasks/Projects/Teams) 🟡 (static done)
Static sweep (`PRELAUNCH_AUDIT.md`): tasks have full fields + 3-state kanban (Not Started/In Progress/Done) drag-drop; 4 roles (owner/admin/manager/member +guest); invite lifecycle (create→get→use); team chat SSE. **Gaps:** C1 task-assign sends no notification, C2 no project %-progress/milestones (flat "N tasks" only), C3 invite pending/accepted UI [runtime]. Fixes deferred to post-phases pass (Hunter's call).

## Phase 5 — Chat & Integrations 🟡 (static done; scope decision pending)
Static sweep (`PRELAUNCH_AUDIT.md`): chat = team + group SSE, DMs + channels, msg→task all ✅ (gap: no dedicated project-chat). Integrations wired: Google Calendar 2-way + OAuth, GitHub, Paystack/Flutterwave/Mono. **Not built (net-new): Drive / Slack / Zoom-Meet** — awaiting Hunter's launch must-have scope. New finding I5: academic detail-view stubs cluster (course/student/schedule/module/notes/connect/group).

## Phase 6 — Templates & Interface Consistency 🟡 (static done; consistency refactor = big fix-pass item)
Static sweep (`PRELAUNCH_AUDIT.md`): templates marketplace path ✅ (categories/search/popular/use); T1 standalone `useTemplate()` placeholder. **Consistency quantified:** 25 border-radius values, 56 font-sizes, 102 box-shadows, 93 tokens defined-but-unenforced. Fix = define scale tokens + sweep hardcoded→token per component family (non-visual-diff, smallest increments). Largest non-build refinement; deferred to fix pass.

## Phase 7 — Mobile Optimization 🟡 (static done)
Static sweep (`PRELAUNCH_AUDIT.md`): strong (30 mobile queries, no overflow, launcher built, stat cards compacted). Findings: **M1** touch targets <44px (chat/acad/modal buttons), **M2** no dedicated mobile type scale (folds into Phase 6). Per-page reflow = [runtime]. All fixes scoped to `@media (max-width:720px)`, verify via `device_screens.py` + real phone. Deferred to fix pass.

## Phase 8 — Auth & Onboarding 🟡 (static done — onboarding already built)
Static sweep (`PRELAUNCH_AUDIT.md`): auth hardened (baseline green). **Onboarding already exists** — first-login flow (`/api/user/onboarding`), 7-day Getting Started Guide, sensible default landing (Home), minimal registration, password reset + Google OAuth. No net-new build needed; just [runtime] confirm the flow fires for a fresh account.

## Phase 9 — Final QA & Launch Readiness 🟡 (checklist defined; runtime-only)
The consolidated runtime gate (`PRELAUNCH_AUDIT.md` Phase 9): re-run suite green, 3 real devices, all [runtime] items from Phases 1–8, loading/error states, outside-tester onboarding, final visual sweep (post-consistency), rollback = atomic commits ✅. Runs last, after the fix pass.

---

### Decisions (Hunter)
- ✅ **Phase 5 integration scope (2026-06-30): Google Drive + Zoom/Meet = launch must-haves.** Slack → post-launch. (Build in the fix pass: each = additive OAuth + sync module + integration card state. Meet is easier given the existing Google ecosystem.)
- B1 leaderboard + findings: fix AFTER all phases (Hunter's call).

### FIX PASS backlog
**✅ Done (small real bugs, 2026-06-30):**
- **B1** leaderboard 404 → `/api/leaderboard` added (`ca65ff0`)
- **C1** task-assign notification → web-push to assignee (`063a677`)
- **C2** project %-progress → done/total + % + progress bar (`063a677`)

**Remaining (deferred):**
- **C3** invite pending/accepted UI · **I1** org file-attach · **I2** marketplace injection · **I3** org departments/invoices · **I4/I5** academic detail-view stubs · **T1** useTemplate placeholder
- **CONSISTENCY** scale-token refactor (largest) · **M1** touch targets <44px · **M2** mobile type scale
- **NEW BUILDS:** Google Drive · Zoom/Meet
