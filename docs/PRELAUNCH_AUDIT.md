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

## Disposition
- **B1** → fix in Phase 3/4 (or now as a quick win if approved).
- **I1–I3** → routed into their owning phases (5/6, 4).
- **P1–P4** → no action beyond confirming copy in Phase 2 (nav) / Phase 6 (consistency).
