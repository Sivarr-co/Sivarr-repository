# Sivarr Pre-Launch Functionality Audit (Phase 1)

> Single tracked list: **Broken / Incomplete / Placeholder**. Started 2026-06-30.
> Method: **static sweep** of `templates/index.html`, `js/app.js`, `app.py` (read-only).
> Runtime click-through items (visual blanks, redirects, empty-state rendering) are
> tagged **[runtime]** for Hunter's gate — the sandbox can't run the app.

## Static checks run (and their results)
| Check | Method | Result |
|---|---|---|
| Surface size | route + panel enumeration | 327 backend routes · 30 panels · 298 handlers |
| **Dead buttons** | every `on*=` handler vs 2,673 defined fns | ✅ **0** — all handlers resolve |
| **Silent 404s** | 183 frontend `/api/` paths vs 318 routes | ⚠️ **1** — `/api/leaderboard` |
| **Nav to nowhere** | 29 `nav()` targets vs `panel-<id>` | ✅ **0** — all resolve |
| Placeholder markers | "coming soon"/stub/TODO scan | 8 (mostly intentional) |

**Headline:** the app is in strong shape — no dead handlers, no broken nav, exactly one missing endpoint.

---

## 🔴 BROKEN (must fix before launch)
| # | Item | Detail | Owner |
|---|---|---|---|
| B1 | **Leaderboard panel** | `loadLeaderboard()` (js:10381) → `fetch('/api/leaderboard')` (js:10388), but **no `/api/leaderboard` route exists** in app.py. Panel always lands in the "Couldn't load leaderboard — try again" error state. Fix = add the endpoint (aggregate student quiz/exam scores) or retire the panel. | Claude |

## 🟡 INCOMPLETE (started, partially wired — verify or finish)
| # | Item | Detail | Owner |
|---|---|---|---|
| I1 | Org chat **file attachments** | Button disabled, `title="coming soon"` (html:3000). Decide: build (Phase 5) or hide. | Hunter scope |
| I2 | Marketplace **extension injection** | "Injection into the dashboard is coming soon" (html:4334) — install works, in-dashboard mount deferred. | Phase 5/6 |
| I3 | Org **departments & invoices** | "coming soon" note (html:1923) — org settings shell present, backend deferred. | Phase 4 |

## ⚪ PLACEHOLDER (intentional "coming soon" — confirm copy/visibility only)
| # | Item | Detail |
|---|---|---|
| P1 | Locked agent chips (Claude/GPT-4/Perplexity) | `agentSelectLocked()` + `title="Coming soon"` (html:633–641). Intentional — gated alt models. |
| P2 | WhatsApp notification channel | disabled toggle (html:1753) + WhatsApp Business card (js:1102). Gated on Meta API. |
| P3 | Lecturer stub | hidden element kept for JS compat (html:215). Harmless. |
| P4 | Generic integration "coming soon" toast | `mktInstall`/integration cards for unbuilt integrations (js:2500). Ties to Phase 5 scope. |

---

## [runtime] Checklist for Hunter's gate (static can't see these)
Run on a deploy / local server, click through and confirm:
- [ ] Every panel renders content (no blank white screens) on first open
- [ ] Empty states show a friendly message (not a blank list) — leaderboard, notes, docs, flashcards, etc.
- [ ] No redirect loops or 404 HTML pages from any in-app link
- [ ] Browser console: **0 errors** on each panel open
- [ ] The 8 placeholder items above read as intentional (correct "coming soon" copy), not broken

## Phase 3 — Space Functionality (static sweep, 2026-06-30)
Verified each space's promised core actions are wired to a real persisting endpoint/store (not stubs):

| Space | Core actions | Status |
|---|---|---|
| **Personal** | tasks (`psNewTask`→`d.tasks` save), goals, habits, notes, projects (`/api/org/projects/create`), finance | ✅ all persist |
| **Org** | create (`/api/org/create`), tasks/goals/docs (`/api/org/*/create`), invite (`orgSendInvite`→`/api/org/invite`), role (`/api/org/member/role`), remove (`/api/org/member/remove`), team chat (SSE) | ✅ all wired |
| **Academic** | class create/join, assignment, exam, announce, poll, grade — all `/api/acad/*` | ✅ all wired |

**New finding:**
| # | Item | Detail | Owner |
|---|---|---|---|
| I4 | Academic **course detail** view | `lOpenCourse()` → `"Course detail coming soon"` (js). Course create/list works; clicking into a course is a stub. | Phase 3/later |

**Verdict:** all three spaces deliver their promised core actions at the wiring level; only the course *detail* view is a stub. **[runtime]** Hunter walks each space end-to-end (create→persist→reload) on a deploy to confirm behavior + empty states.

## Phase 4 — Core Systems: Tasks / Projects / Teams (static sweep, 2026-06-30)
| Capability | Status |
|---|---|
| Task fields: title/desc/due/priority/status/assignee | ✅ (`/api/org/tasks/create`) |
| Status tracking: Not Started / In Progress / Done (kanban + drag-drop) | ✅ |
| Roles: Owner / Admin / Manager / Member (+guest) | ✅ (`/api/org/member/role`) |
| Invitations + lifecycle (create→get→use) | ✅ backend (`create/get/use_org_invite`) |
| Team chat from workspace | ✅ (org SSE) |

**Gaps (depth vs PDF):**
| # | Item | Detail | Fix (additive) |
|---|---|---|---|
| C1 | Task assignment sends **no notification** | `create_org_task` stores `assignee_sid` but never pushes/notifies the assignee. Academic assignments push; org tasks don't. PDF wants "notification on assignment." | Add `bg.add_task(notify, assignee, …)` on assign. |
| C2 | No **project % progress / milestones** | `orgRenderProjects` shows only a flat "N tasks" count — no done/total %, no progress bar, no milestones (upgrade card advertises both). | Compute done/total per project (`ORG_TASKS` already client-side) → progress bar. Client-only. |
| C3 | Invite **pending/accepted UI** | Backend tracks invite state; surfacing a "pending invites" list in the UI is unconfirmed. **[runtime]** check. | Verify on deploy; add list if missing. |

## Phase 5 — Chat & Integrations (static sweep, 2026-06-30)
**Chat:**
| Capability | Status |
|---|---|
| Team chat (org SSE) · Group chat (study groups SSE) | ✅ |
| DMs + channels (Slack-style) | ✅ (`oc-dm-*`, `ocSwitchChannel`) |
| Message → task ("Save as Task") + voice/email task extraction | ✅ |
| Project-specific chat (dedicated thread per project) | 🟡 not dedicated — channels approximate (PDF wanted 3 distinct types) |
| Unread-state accuracy across spaces | **[runtime]** confirm |

**Integrations:**
| Integration | Status |
|---|---|
| Google Calendar (2-way) · Google OAuth · GitHub · Paystack · Flutterwave · Mono | ✅ wired |
| **Drive · Slack · Zoom/Meet** | ❌ not built — **net-new (scope decision)** |
| WhatsApp | ⚪ coming-soon (P2) |

**New finding (cluster):**
| # | Item | Detail |
|---|---|---|
| I5 | **Academic detail-view stubs** | `lOpenCourse` (I4), `lViewStudent`, `lAddClass`, `sOpenModule`, `sUploadNotes`, `sConnectIndex`, `sOpenGroup` all → "coming soon" toasts. Core academic actions (class/assignment/exam/grade) work; drilling into detail is stubbed across the board. |

## Phase 6 — Templates & Interface Consistency (static sweep, 2026-06-30)
**Templates:** marketplace path ✅ (categories, search, `sort=popular`, real `mktUseTemplate`/`agFetchTemplates`). **T1:** standalone `useTemplate()` is a placeholder ("duplicate-to-workspace backend wiring out of scope") — confirm which path the live Templates panel uses; wire or remove the placeholder.

**Consistency — quantified scatter (the big Phase 6 finding):**
| Property | Distinct values | Target scale |
|---|---|---|
| border-radius | **25** (2→32px + 99/999) | ~5 (e.g. 4/8/12/16/full) |
| font-size | **56** rem values | ~8–10 type-scale steps |
| box-shadow | **102** declarations | ~3 (sm/md/lg) |
| CSS tokens defined | 93 (exist but **not enforced**) | — |

**Fix (deferred — largest non-build refinement):** define radius/type/shadow **scale tokens**, then sweep hardcoded values → nearest token, **one component family at a time**, eyeballing before/after in `static/devices.html` (non-visual-diff refactor). Highest visual-regression risk in the program → smallest safe increments, each its own commit.

## Phase 7 — Mobile Optimization (static sweep, 2026-06-30)
✅ **Strong:** 30 `≤720px` media queries; **no element min-width overflow** on phones (all min-widths ≥721px are desktop-up breakpoints); only 2 fixed widths ≥400px; mobile launcher + drill-down built; home stat cards already compacted.
| # | Finding | Detail | Fix |
|---|---|---|---|
| M1 | **Touch targets <44px** | `.chat-hdr-btn` 28px, `.acad-topbar-btn` 32px, `.acad-webhook-btn` 24px, `.mkt-modal-close` 28px, etc. Below Apple 44 / Material 48 min. | Bump interactive els to ≥44px in `≤720px` (or larger tap padding). |
| M2 | **No dedicated mobile type scale** | Mobile reuses desktop font-sizes shrunk via `--font-scale`/per-element overrides; PDF wants a purpose-built mobile scale. | Fold into the Phase 6 consistency type-scale (add mobile steps). |
| — | Per-page reflow polish | **[runtime]** real-device walkthrough of each panel. | Hunter gate + targeted CSS. |

## Phase 8 — Auth & Onboarding (static sweep, 2026-06-30)
Auth fully hardened (baseline 33/0 green). **Onboarding already built** (not net-new as assumed):
| Capability | Status |
|---|---|
| First-login onboarding flow + completion tracking (`/api/user/onboarding`) | ✅ (js ~16178) |
| Getting Started Guide (dismissible, 7-day) | ✅ (js ~6170) |
| Sensible default landing (new user → Home, not blank) | ✅ |
| Minimal registration (name/email/password, phone optional) | ✅ |
| Password reset (one email, one click) · Google OAuth | ✅ (verified earlier) |

**[runtime]** Confirm the onboarding flow fires for a fresh account, is dismissible, and reaches a first action quickly. No net-new build required.

## Phase 9 — Final QA & Launch Readiness (verification-only)
No static sweep — this is the consolidated **runtime gate** (Hunter, on a deploy):
- [ ] Re-run `test_auth_security.py` → still green (regression anchor)
- [ ] 3 real devices: recent iPhone · recent Android · laptop
- [ ] All `[runtime]` items from Phases 1–8 (blank screens, empty states, console errors, space walk-throughs, unread accuracy, mobile reflow, onboarding fire)
- [ ] Loading/error states graceful everywhere
- [ ] Outside tester runs onboarding→first-action with zero guidance
- [ ] Final visual sweep (post-consistency-refactor): spacing/type/color/icons
- **Rollback plan:** every change is an atomic commit → revert-by-commit. ✅ in place.

## Bonus — Field-contract sweep (2026-06-30)
Triggered by the org-invite bug (FE sent `invite_token`, BE read `token`). Compared every frontend `API(path,{…})` body key vs the backend `data.get()` keys per endpoint. **Result: reassuring** — the invite bug was the only serious front/back contract mismatch. Of 13 deltas: **4 false positives** (handlers read via `"x" in data` or `data.items()`+allowed-set, invisible to a `data.get()` detector): `org_goal_update`, `org_kr_update`, `org_update`, `org_tasks_update`; **1 benign** (`goals/add` sent `type:'okr'` vs `goal_type`, value == default).
| # | Real finding | Fix |
|---|---|---|
| W1 | `wrong/clear` js:5100 sent `idx:'all'` but BE read `index` → "clear all wrong answers" was a no-op (BE also had no "all" mode) | ✅ FE→`index:'all'`, BE clears all on `"all"` + guards int parse |
| — | `goals/add` onboarding call sent `type:'okr'` (BE reads `goal_type`) | ✅ FE→`goal_type` (cleanup; was benign) |

## Disposition
- **B1** → fix in Phase 3/4 (or now as a quick win if approved).
- **I1–I3** → routed into their owning phases (5/6, 4).
- **P1–P4** → no action beyond confirming copy in Phase 2 (nav) / Phase 6 (consistency).
