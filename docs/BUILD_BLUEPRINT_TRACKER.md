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

## Stage 2 — Edit & reduce the sidebar  🟡
Done: Spaces dropdown collapse, orphan-panel removal, ⌘K reaches all, icon-only collapsed CSS.
To-do: cut to <12 visible, collapsible sections per group, recently-used in search, merge Docs&Notes/Document Hub.

## Stage 3 — General & organisation settings  🟡 (thinnest part)
Done: `panel-settings` (basic) + per-space Settings modal.
To-do: notification prefs, appearance accents, connected-accounts summary, data export ZIP, billing/plan screen; ORG settings (members/roles, departments, invoices, audit log); permissions model (Owner/Admin/Member/Guest) enforced.

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
