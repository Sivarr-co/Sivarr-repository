# SIVARR Build Blueprint — Living Tracker

> Maps the 11-stage Build Blueprint to current code state and tracks progress.
> Updated as work ships. Status: ✅ done · 🟡 partial · ❌ not started · 🔵 in progress.
> Rule: don't rebuild what exists; fill gaps + unify. Verify (node --check + VM harness
> + prod browser pass) before/after each change. Commit per sub-item.

Started 2026-06-19. HEAD at start: `83339c0`.

---

## Stage 1 — Redesign tab layout (Org / Academic / Personal)  ✅ DONE (`b9bf8be`, 2026-06-19)
**Decisions (Hunter):** visual-unify scope (keep the 3 JS switchers + injection host); KEEP Academic v3 dual-role tabs; Personal OS = extensions/space-type (not new tabs).
**Shipped:**
- [x] One shared tab **visual language** across `.os-tab` / `.acad-tab` / `.sp-tab` — flat horizontal-scroll bar + animated active underline. Academic (was pills) brought into the underline language. CSS-only; switchers + accents + injection host untouched.
- [x] Mobile **overflow / horizontal scroll** on all three bars (`overflow-x:auto`).
- [x] Active-tab **underline animation** (.18s transition) consistent across spaces.
- [x] Founder tab → **owner-only** (`_founderTabVisibility`, was owner+admin).
- [x] Org tab order: Tasks before Goals (blueprint order).
- [x] Extensions tab slot: already provided by `SPACE_HOSTS` injection (Stage-4 infra).
**Verified:** VM founder-gate 3/3 (owner shows, admin/member hidden); PROD browser pass — academic active tab computed `border-bottom 2px / radius 0 / transparent bg` (underline, not pill), all 3 bars `overflow-x:auto`, Org 12 / Personal 7 / Academic 6 tabs, **0 console errors**, app.js v=20260619a / styles v=20260619a live.
**Folded into Stage 6** (content-level, not the tab system): per-tab empty-state + CTA polish. **Doc:** tab-behaviour rule = all space tab-bars use `.{os,sp,acad}-tab` sharing the unified CSS; new spaces/extensions reuse a host descriptor in `SPACE_HOSTS`.

## Stage 2 — Edit & reduce the sidebar  ✅ DONE (`388687f`, 2026-06-19)
**Decision (Hunter):** collapsible sections, Life+Connect collapsed by default.
**Shipped:**
- [x] Work/Life/Connect labels → collapsible headers (caret), persisted per-section (`sbSecToggle`/`sbRestoreSections`); Life+Connect collapsed by default, Work open → ~8 always-visible (under <12 target). Nothing removed; expand + ⌘K still reach all.
- [x] ⌘K "Recent" section (top, empty query) of last 6 visited destinations (`cmdPushRecent` in `nav()`, `cmdRecentHTML`; real sidebar dests only, dedup).
- [x] Icon-only collapsed sidebar already existed; Document Hub already removed in orphan cleanup (merge moot).
- [ ] Deferred (needs analytics): remove zero-usage items.
**Verified:** VM harness 7/7 (defaults, toggle/persist, recents dedup/order, unknown guard). Cache-bust app.js/styles v=20260619b.

## Stage 3 — General & organisation settings  ✅ DONE (`afb8940` + `47147b8`, 2026-06-19)
**Completion slice (`47147b8`):** Data & Privacy section (Export ZIP via `/api/export`, Clear chat via new `/api/chat/clear`, self-serve Delete account via new `/api/account/delete` — distinct from admin delete); notification **channels** (in-app/email on; WhatsApp coming-soon); **timezone** in Profile; `docs/PERMISSIONS.md` (Owner/Admin/Manager/Member/Guest matrix + server invariants). VM 8/8 + PROD pass (section/tz/channels present, 0 errors), app.js v=20260619d.
**Deferred (org-backend-heavy → later):** departments/sub-teams, org invoice history, connected-accounts summary.

### (earlier) org slice `afb8940`
**Found already built (personal):** Profile, Appearance + accent picker, Notifications (category toggles), Billing (plan/usage/history/cancel). Decision (Hunter): build **Org settings first**; dependent items as shells.
**Shipped (org settings slice):**
- [x] Backend: `set_org_member_role`/`remove_org_member` (owner row immutable); `/api/org/member/role` (owner), `/api/org/member/remove` (owner/admin, role-aware), `/api/org/audit` (owner/admin); `_org_audit()` → collections `org_audit`; org/update audited.
- [x] Frontend: gated "Organisation" section in Settings (only when in an org) — org profile edit (owner), member list + role-select (owner) + remove (role-aware), recent admin-activity, invite. Permission gating mirrors server.
- [x] Verified: VM 12/12 (owner/admin/member gating, owner-row protection); PROD pass — settings opens, section wired, hidden-without-org, 0 errors. app.js v=20260619c.
**Still to-do (deferred):** departments/sub-teams; org invoice history; personal data controls (export ZIP / delete account / clear history); notification channels (email/WhatsApp/in-app — WhatsApp pending Stage 5/7); timezone; formal Guest role + permissions-model doc. **Note:** org section render with real members needs an owner session to browser-verify (logic VM-verified).

## Stage 4 — Org Space extensions  🔵 IN PROGRESS (Agency OS done `83d7d98`, 2026-06-19)
**Decisions (Hunter):** package Founder mode AS Startup OS (don't rebuild — it already has investor CRM + runway + milestones + metrics); build Agency OS first.
**Shipped:**
- [x] **Agency OS** extension (real, on existing infra): Clients (add/list/remove), Pipeline kanban (Brief→In progress→Review→Delivered; add/move/delete), Revisions (↻ per card + summary), invoices "coming soon". Per-space persistence (`_ext['ext-agency-os']`); registered in seed/inject/registry; mounts via generic host. VM 10/10 + PROD pass (mounts in a space, pipeline renders, 0 errors). app.js v=20260619e.
**Also shipped (`d6b8665`):** Org hero **"Extensions" button** → Space Settings (extensions) = the in-Org Add-Extension entry; **post-install onboarding** 3-step checklist (`extShowOnboarding` hooked into `mktInstall`). VM 3/3.
**Status:** Stage 4 ✅ for the build path (extension infra + Agency OS + Startup OS via Founder mode + Add-Extension entry + onboarding).
**NOTED for the post-stages polish pass (per Hunter):** Startup OS metrics dashboard (users/retention) + roadmap link to Projects; Agency OS invoices; Marketing/Ecom/Company OS (build only after validation per blueprint).

## Stage 5 — Templates & Integrations redesign  ✅ DONE (`88c8a7a`, 2026-06-19)
**Found already built:** Marketplace Templates tab; real integrations grid with connected/not-connected/upgrade states + per-integration actions (Google OAuth, Google Calendar, GitHub, Paystack, Flutterwave, Mono); `mktUseTemplate` already creates a **real space** from a template (academic→academic w/ role; else personal) — the summary's "it's a toast" was stale.
**Shipped:**
- [x] Templates now **pre-populate** the new space with the template's fitting **FREE** extensions (Freelance Hub → Agency OS; Academic OS Student → Flashcards + Citation), via `TMPL_EXTS` map → `mktExtEnabled` + `mktSaveExt`. Paid extensions are never auto-enabled (purchase still required).
- [x] **WhatsApp Business** integration card (coming-soon state, `.int-soon` dashed button) added to the integrations grid — the visible surface for SIVA reports/alerts + Stage-7 trading summaries.
- [x] Verified: VM 5/5 (freelance→agency-os; academic-student→flashcards+citation+role; weekly-review→no-auto-ext; WhatsApp card present; int-soon class present). node --check OK. Cache-bust v=20260619g.
**NOTED for the post-stages polish pass (per Hunter):** real WhatsApp Meta-API wiring (gated on sivarr.com cutover + Meta app); per-integration **settings panel** + live **health/last-sync** indicator; template **preview** before create; **paid templates** purchase flow (gated on Stage-10 pricing); `tmpl-startup` → real **Org** create (Startup OS = org Founder mode; currently lands a personal space).

## Stage 6 — Academic & Personal actually work  ✅ DONE (`7f6c859`, 2026-06-19)
**Found already built:** Academic v3 (classes, study deck, quiz, planner, timer, groups, lecturer attendance/grading/assignments/live/polls); Personal tasks/goals/habits/journal/finance/analytics persist; **SIVA personal daily briefing on real data** (`/api/home/briefing`); calendar (`calRender`); real-data charts (mood chart fixed earlier); per-tab empty states (leaderboard/notes/docs/flashcards).
**Shipped (the one real gap — exam builder):**
- [x] **Lecturer Exam Builder** rebuilt as an **Exams segment** in the Assessments tab, on the **intact backend** (decision Hunter: match existing free-text question-bank model — no backend changes). Add/list/delete exams (title, duration, questions-per-student, one-question-per-line bank), Assign-to-class. Wires `GET /api/lecturer/exams`, `POST /api/lecturer/exam`, `/api/lecturer/exam/delete`, `/api/class/assign-exam`.
- [x] Verified: VM 7/7 (render/count/Assign+Delete/create+question-parse/delete-index/assign-payload/seg-label); **prod browser pass** — `v=20260619h` live, Exams seg+panel render, `lAssessSegment('exams')` shows panel + "+ New Exam", **0 console errors**.
**NOTED for the post-stages polish pass (per Hunter):** calendar **drag-drop** scheduling (calRender is click/form-based today); richer **MCQ + auto-grade** exam model (deferred — would change the exam backend + student take-flow); per-tab empty-state CTA polish (folded from Stage 1).

## Stage 7 — Trading Journal extension (Personal)  ✅ CORE DONE (`cbeead4`, 2026-06-19)
**Decision (Hunter):** build the **in-app core now**; external ingestion + WhatsApp later.
**Shipped (on the existing extension infra, mirrors Agency OS — blob persistence + generic host mount):**
- [x] **Trades**: manual Add-trade form + single-line CSV import; per-trade direction, derived **R-multiple / P&L / win-loss**, emotion + date; delete.
- [x] **Journal**: trades with notes/emotion + emotion-frequency summary chips.
- [x] **Risk**: position-size calculator (account × risk% ÷ stop distance), persists account/risk defaults.
- [x] **Stats**: trades / win-rate / avg R / total R / net P&L tiles + cumulative-R **equity curve** (inline SVG).
- [x] Seeded (`ext-trading-journal`, finance) + injected (Trading Journal tab) + `EXT_REGISTRY`.
- [x] Verified: VM 11/11 (derive long/short/loser, add + CSV import, journal, stats+curve, risk calc, delete, seed+registry); fixed R-over-rounded-P&L for win/loss. **Prod browser pass** — `v=20260619i`, all 4 tabs render, derive math correct, **0 console errors**.
**NOTED for later (need external infra + the WhatsApp integration, currently a stub):** MT5/MT4 EA, TradingView webhook, broker API, AI CSV/statement parse (`/api/chat`), SIVA pattern detection, WhatsApp trade reports, rules-adherence scoring.

## Stage 8 — Integration layout standardization  ✅ DONE (`5cfb0a6`, 2026-06-19)
**Found already built:** the integration card is a single unified pattern (logo/name/status/action) shared across all integrations.
**Shipped:**
- [x] **Per-category layout**: integrations grid now grouped under full-width category headers in a fixed order — **Identity → Calendar → Developer → Payments & Finance → Communication** (`INT_CAT`/`CAT_ORDER` in `integrationsRender`, `.int-cat-head` spans the grid). Cache-bust `v=20260619j`.
- [x] Verified: VM 4/4 + **prod browser pass** — 5 headers in order, 7 cards, headers full-width, **0 console errors**.
**NOTED for later (Stage 8 depth):** merged cross-integration **activity feed**; richer per-category **detail layouts** (calendar agenda / dev commits / finance transactions) — need live per-integration data aggregation.

## Stage 9 — Agents marketplace  ✅ DONE (`410a147`, 2026-06-19)
**Found already built (verified on prod — renders cards, 0 errors):** full marketplace — browse/featured/search/filter (`agRenderMarketplace`), template detail + Stripe/Paystack checkout + free install, **creator application** (`agSubmitApplication` → `/api/agents/apply`), **creator dashboard** (overview/templates/earnings/reviews/settings), **template builder** (`agOpenBuilder`/`agSaveTemplate`), **reviews** (`agLeaveReview`), **revenue split + payouts** (`/api/agents/me/earnings`+`/payouts`, Stripe Connect). Admin moderation already exists: `/api/admin/templates/{id}/approve` (approval queue) + agent **suspend** (takedown).
**Shipped (the real gap — user-facing safety):**
- [x] **Report / flag a template**: `POST /api/agents/templates/{id}/report` (signed-in, stored in `agent_reports` collection, status "open") + `GET /api/admin/agents/reports` (admin queue). Frontend **"⚑ Report"** button on the template detail → `agReportTemplate()`.
- [x] Verified: VM 5/5 (POST url, token+reason body, success toast, empty-reason + signed-out no-ops); endpoints prod-live (401-gated, not 404/500); **prod browser pass** — opened a real template, Report button renders, **0 console errors**. Cache-bust `v=20260619k`.
**NOTED for later:** admin reports-queue **UI** (endpoint ready); auto-takedown thresholds.

## Stage 10 — Finalise payment plans  🟡 PAUSED (pending Hunter pricing) — invoices done (`3a7b1c5`)
Done: Paystack/Flutterwave subscribe+verify (amount/currency/idempotency), billing_history, NAIRA_RATE, `SIVARR_PLANS` (free/pro/team), server-enforced free-tier caps (`FREE_DAILY_CHAT`/`AI_DAILY_FREE`).
**Shipped this pass (pricing-independent):**
- [x] **Downloadable invoices** from billing history — per-row "Invoice" button → `stDownloadInvoice()` builds a self-contained printable HTML invoice (billed-to from `S.name/S.email`, plan/date/amount/reference/gateway, Print/Save-as-PDF). VM 4/4, code live `v=20260619l`.
**PAUSED — needs Hunter's decisions (chosen 2026-06-19: pause + decide pricing later):**
- [ ] Tier structure + names (kept open: 3× Free/Pro/Team vs 4× Free/Pro/Business/Enterprise) — **deferred**.
- [ ] Final price numbers (monthly/annual), Free-tier limits, founding-user offer.
- [ ] Prorated upgrade/downgrade, dunning/retry, gating matrix, upgrade prompts.
**Resume:** once Hunter supplies tiers + numbers, edit `SIVARR_PLANS`, then build gating matrix → upgrade prompts → prorate → dunning. (Engine-on-placeholders was offered and declined for now.)

## Stage 11 — Test → launch 1,000  ❌ (mostly Hunter infra)
= `docs/LAUNCH_CHECKLIST_NONSO.md` (email domain, k6 load test, Supabase Pro, ≥2 instances+CDN, VAPID) + closed testing + waitlist. Strictly last.

---

### Cross-cutting prerequisites (Hunter)
- Final **pricing numbers** (gates Stage 10)
- **sivarr.com** cutover: BASE_URL + Resend DKIM + Google OAuth authorized domain/redirect (gates Stage 5 calendar/whatsapp + 11)
- Launch-gate infra (Stage 11)
