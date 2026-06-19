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

## Stage 3 — General & organisation settings  🔵 IN PROGRESS (org slice done `afb8940`, 2026-06-19)
**Found already built (personal):** Profile, Appearance + accent picker, Notifications (category toggles), Billing (plan/usage/history/cancel). Decision (Hunter): build **Org settings first**; dependent items as shells.
**Shipped (org settings slice):**
- [x] Backend: `set_org_member_role`/`remove_org_member` (owner row immutable); `/api/org/member/role` (owner), `/api/org/member/remove` (owner/admin, role-aware), `/api/org/audit` (owner/admin); `_org_audit()` → collections `org_audit`; org/update audited.
- [x] Frontend: gated "Organisation" section in Settings (only when in an org) — org profile edit (owner), member list + role-select (owner) + remove (role-aware), recent admin-activity, invite. Permission gating mirrors server.
- [x] Verified: VM 12/12 (owner/admin/member gating, owner-row protection); PROD pass — settings opens, section wired, hidden-without-org, 0 errors. app.js v=20260619c.
**Still to-do (deferred):** departments/sub-teams; org invoice history; personal data controls (export ZIP / delete account / clear history); notification channels (email/WhatsApp/in-app — WhatsApp pending Stage 5/7); timezone; formal Guest role + permissions-model doc. **Note:** org section render with real members needs an owner session to browser-verify (logic VM-verified).

## Stage 4 — Org Space extensions  🟡 (infra done, content missing)
Done: extension infra (marketplace, install/uninstall, injection, registry, generic host); Founder mode (investor pipeline + milestones).
To-do: real **Startup OS** (investor CRM, runway calc, roadmap, metrics), **Agency OS** (client workspace, brief intake, revision tracker, invoices); post-install onboarding checklist.

## Stage 5 — Templates & Integrations redesign  🟡
Done: Marketplace Templates tab; real integrations — Google Calendar, GitHub, Paystack, Flutterwave, Mono.
To-do: template preview + **real install/duplicate** (currently a toast), free/paid purchase, 5 real priority templates; integrations grid connected/not/upgrade states, **WhatsApp Business**, per-integration settings + health status.

## Stage 6 — Academic & Personal actually work  🟡→🟢
Done: Academic v3 (classes, study deck, quiz, planner, timer, groups, lecturer attendance/grading/assignments/live/polls); Personal tasks/goals/habits/journal/finance/analytics persist.
To-do: exam builder (old one deleted), calendar drag-drop scheduling, SIVA personal daily briefing on real data, charts-from-real-data polish.

## Stage 7 — Trading Journal extension (Personal)  ❌ (largest new build)
MT5/MT4 EA, TradingView webhook, broker API, CSV+Claude parse; journal + psychology + risk calc + rules adherence; SIVA pattern detection, WhatsApp reports. Depends on extension infra (have) + WhatsApp integration (missing).

## Stage 8 — Integration layout standardization  ❌
Unified linked-item pattern, merged activity feed, per-category layouts (finance/calendar/dev/comms). Depends on Stage 5.

## Stage 9 — Agents marketplace  🟡 (verify + complete)
Done: `panel-agents` browse/marketplace.
To-do (verify first): creator submission + approval queue, creator dashboard, revenue split + payout, reviews, safety/takedown.

## Stage 10 — Finalise payment plans  🟡 (engine done)
Done: Paystack/Flutterwave subscribe+verify (amount/currency/idempotency), billing_history, NAIRA_RATE.
To-do (needs Hunter's pricing decisions): tier naming (code free/pro/team vs Blueprint Free/Pro/Business/Enterprise), Free limits, founding-user offer, prorated upgrade/downgrade, dunning/retry, invoice UI, gating matrix, upgrade prompts.

## Stage 11 — Test → launch 1,000  ❌ (mostly Hunter infra)
= `docs/LAUNCH_CHECKLIST_NONSO.md` (email domain, k6 load test, Supabase Pro, ≥2 instances+CDN, VAPID) + closed testing + waitlist. Strictly last.

---

### Cross-cutting prerequisites (Hunter)
- Final **pricing numbers** (gates Stage 10)
- **sivarr.com** cutover: BASE_URL + Resend DKIM + Google OAuth authorized domain/redirect (gates Stage 5 calendar/whatsapp + 11)
- Launch-gate infra (Stage 11)
