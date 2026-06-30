# Billing / Pricing — Resume & Verification Tracker

Pause point (2026-06-30). Everything below is **shipped to `main`** unless marked
otherwise. Before building more, work the **Verification backlog** (§1) — several
money paths have never run against a real DB + Paystack. Full pricing spec:
`docs/PRICING_USD_RESTRUCTURE.md`.

---

## 0. What shipped this session (commit → feature)
| Commit | Feature |
|---|---|
| `ff64dad` | Calendar OAuth: session token out of the URL (cookie + signed state) |
| `8ae6406` | Google Calendar: disconnect/revoke + surface events in calendar + stale-token clear |
| `fd2325b` | CSRF: client echoes `X-CSRF-Token` (+ gcal push IANA tz) |
| `f3ea4aa`,`8b56d6e` | CSRF echo added to admin / lecturer / admin-metrics standalone pages |
| `cbe95fc` | **Pricing Phase 1** — USD anchor + live NGN conversion at checkout |
| `adebabd` | Admin USD→NGN rate editor (Revenue tab), durable in `app_config` DB table |
| `a7b022c`,`d800300` | **Quota gating** — spaces / templates / integrations / analytics caps |
| (063a677/f688b89) | Paid-tier daily AI fair-use ceilings (cost guard) |
| `3737c83` | **Per-seat Org billing** (Phase 2b) |

---

## 1. Verification backlog — DO THIS FIRST (money + prod-only paths)

### Verified locally 2026-06-30 (logic proven; raw SQL + money settlement still need prod)
- **CSRF round-trip ✓** — real local test: POST without `X-CSRF-Token` → **403**, with token → **200**,
  exempt `/api/login` → **200**. Mechanism sound; the earlier outage was deploy-ordering only.
- **Quota gating logic ✓** (mock-DB harness): 2nd space (Free) → 402, re-sync existing → OK;
  4th template (Free=3) → 402, under-cap → OK.
- **Org billing logic ✓** (mock-DB harness): quote(5 seats)=$50/≈₦82,500; subscribe non-owner → 403;
  51+ seats → 400 custom; join when seats full → 402, seat free → OK, **legacy org (no sub) not
  seat-limited** (transition-safe).

### Still needs PROD (cannot be done from the dev sandbox — no outbound net / Paystack / Postgres)
1. **CSRF on real HTTPS (P0)** — confirm the `__Host-` cookie + double-submit holds in a browser:
   hard-refresh → login → create/save (no 403) → admin panel while logged into the main app.
2. **Personal Paystack charge + verify (P0 — money settlement)** — real pay for Pro → ₦19,800
   charged, plan activates, store-and-verify amount lock holds.
3. **Org Paystack charge + verify (P0 — money + new flow)** — real org checkout → org unlocks,
   seat banner correct, invite past seats → 402. Exercises the raw `set_org_subscription` /
   `get_org` / `count_org_members` SQL against real Postgres.
4. **Admin rate persists across a redeploy (P1)** — `app_config` table write/read on prod DB.

Priority order for the prod pass:

1. **CSRF round-trip (P0 — affects ALL mutating requests).** A split deploy once put
   server enforcement live before the client echo (brief outage). Verify: hard-refresh →
   log in fresh → create a task / save → **no "Request blocked" 403**. Then open the
   **admin panel while also logged into the main app** (the case that motivated the
   panel patches) → admin actions must work. Code: `_BearerTokenMiddleware` CSRF block in
   app.py; echo in the global `fetch` wrapper (app.js ~line 25) + admin/lecturer/metrics
   inline wrappers.
2. **Personal USD checkout (P0 — money).** Real Paystack pay for **Pro $12** → confirm
   **₦19,800** charged (at rate 1650) and the plan activates + persists. Verify the
   **store-and-verify** integrity: the charged NGN is locked in metadata at init and
   checked at verify (`billing_subscribe` / `billing_verify`, app.py).
3. **Per-seat Org checkout (P0 — money + brand-new flow).** Create org → Members view →
   "Set up billing" → pay → org unlocks for all members, seat banner shows `used/paid`.
   Then try to invite past the seat count → **402**. Endpoints `/api/billing/org/{quote,subscribe}`,
   verify branch `_billing_apply_org_paystack`.
4. **Admin rate editor durability (P1).** Admin → Revenue → set rate → it persists, and
   **survives a redeploy** (stored in `app_config` DB table, not the ephemeral file).
   `get_naira_rate`/`set_naira_rate` in app.py, `db.get_config`/`set_config`.
5. **Quota gating with real DB (P1).** Free user: 2nd space → 402 + upgrade prompt;
   install a 4th template → 402; connect a 2nd integration → blocked (`?*_error=plan_limit`
   redirect or 402); mood analytics capped to 7 days. Grant a plan to confirm caps lift.
6. **AI fair-use ceiling (P2).** Confirm a paid account is metered (counter persists only
   on **successful** replies) and a Free account 429s at 15 chat/day.
7. **Calendar + gcal (P2).** Calendar redesign renders; Google Calendar connect → events
   show; Disconnect revokes; pushed events land at correct local tz.

---

## 2. Open product decisions (need Hunter's call)
- **Free spaces = 1 is aggressive for testers.** Existing testers keep their spaces but
  can't add new ones. One-line tunable in `_PLAN_CAPS["Free"]["spaces"]` (app.py). Bump to
  2–3 during testing if it's annoying.
- **AI fair-use numbers** (env-tunable): Free 15/40, Student 150/250, Pro 250/400,
  Creator 600/800 (chat/actions per day). Cost vs UX call.
- **"Unlimited core AI" copy** now has a hidden fair-use ceiling (industry-standard).
  Leave as-is or change to "Generous daily limit".
- **Creator "Claude Opus — coming soon"** copy: backend is Gemini 1.5. Keep coming-soon,
  or wire a real Claude path before advertising.
- **Org model:** seats = current member count at subscribe; **no mid-cycle proration**
  (re-subscribe to change seats); 51+ = custom; **Paystack-only** for org so far.

---

## 3. Remaining work — Phase 2c / 3 (how to build each)

### 3a. Personal add-on — Trading Journal +$6/mo
- Plan id already exists: `addon_trading_monthly` in `SIVARR_PLANS` (app.py).
- **Model:** add-ons attach to a base personal sub. Store on the user as
  `p["subscription"]["addons"] = ["trading"]` (or a parallel `p["addons"]` list with own
  expiry). Don't let it be bought without an active Pro/Creator base.
- **Checkout:** new `kind:"addon"` branch (mirror the org branch) in `billing_subscribe`
  + `billing_verify`, or a dedicated `/api/billing/addon/subscribe`. On verify, append the
  add-on + set its expiry.
- **Gating:** the Trading Journal "Live" tab (MetaTrader, `project_metatrader_integration`)
  should require the add-on. Add an entitlement `caps.trading` / `entitlements.addons`
  and gate the tab client-side + the `/api/integrations/metatrader/*` endpoints server-side.

### 3b. Flat org extensions — Founder Mode $39/mo, AI Exec Assistant $49/mo
- **Reuse the org-billing foundation.** These are **flat per-org** (not per-seat).
- **Model:** store on `orgs.settings["extensions"] = {"founder": {...sub...}, ...}` via a
  new `db.set_org_extension(org_id, key, sub)`.
- **Checkout:** `/api/billing/org/extension/subscribe` {token, ext} (owner-only) →
  Paystack flat amount → verify branch `kind:"org_ext"` sets the extension.
- **Gating:** Founder Mode is currently gated to personal `'Team'` (`_GUARDED.founder`).
  Switch to: unlock if the org has the `founder` extension active (keep `'Team'` personal
  as transition fallback). **AI Executive Assistant: the feature itself may not exist yet —
  confirm/build the product before selling it.**

### 3c. Team-wide extensions +$4/seat (CRM, advanced analytics)
- Per-seat add-on on the org (price × member count, like org base).
- **Blocker:** a real **CRM** feature doesn't exist yet — build the feature first, then
  gate it behind this extension. Don't sell a non-existent feature.

### 3d. Founding-100 ($6/mo for life)
- `founding_monthly` plan exists but `hidden:True`. **At launch:** unhide it, gate
  availability behind a counter.
- **Model:** a counter in `app_config` (`db.get_config/set_config`) e.g. `founding_count`.
  On founding checkout, atomically check `< 100` then increment. Store
  `subscription.cohort="founding_100"` + a `lifetime:true` flag so renewal never bumps the
  price. Make the renewal/expiry logic honour the locked rate.

### 3e. Student→Educator referral (permanent 50% off Student Pro)
- **Model:** referral ledger (new `referrals` table or `app_config`): when a student's
  referred lecturer activates **Educator Pro**, mark the student `referral_discount=0.5`.
- **Apply:** in `plan_charge_ngn` (or a per-user discount lookup) halve the Student Pro
  charge for flagged users, permanently. Surface in the pricing UI for that user.

### 3f. Tiered marketplace split (90/10 → 80/20 above $1k/mo)
- **Currently flat 0.90** everywhere: app.py ~`7979`, `8230`, `8281`; js `~16004`.
- **Model:** compute the creator's trailing-30-day earnings; once over **$1,000/mo**, take
  20% on the portion above the threshold (or all subsequent sales that month). Centralise
  the split in one `creator_split(creator_sid, gross)` helper and replace the hard-coded
  `* 0.90` sites with it.

### 3g. Flutterwave org checkout
- Mirror the Paystack org branch: add `kind:"org"` handling in `flutterwave_verify` and an
  org Flutterwave subscribe (app.py). Currently org checkout is Paystack-only.

### 3h. Org per-space "2 core integrations free" (proposal)
- Not built. Per-space integration entitlement for orgs. Lower priority.

---

## 4. Key file map (for fast re-entry)
- **Plans / pricing:** `SIVARR_PLANS`, `plan_charge_ngn`, `org_seat_total_usd`,
  `org_seat_quote`, `get_naira_rate`/`set_naira_rate` — app.py (~line 213+).
- **Caps / gating:** `_PLAN_CAPS`, `_plan_caps`, `_plan_name`, `_integration_block`,
  `_org_sub_active` — app.py (after `_plan_is_active`).
- **AI metering:** `_chat_authorize`, `_ai_meter` — app.py.
- **Billing endpoints:** `/api/billing/{plans,subscribe,verify,status,entitlements,history}`
  + `/api/billing/org/{quote,subscribe}` + `_billing_apply_org_paystack` — app.py (~10440+).
- **Admin rate:** `/api/admin/billing/rate` (app.py) + Revenue tab UI (templates/admin.html).
- **DB:** `set_org_subscription`, `get_org`, `count_org_members`, `count_downloads`,
  `get_config`/`set_config`, `app_config` table — database.py.
- **Client:** pricing modal `showPricing`, `_ENTITLEMENTS` (billingLoadStatus), nav paywall
  `_GUARDED`, org billing `orgBilling`/`orgBillingSubscribe`/`_orgBillingBanner` — js/app.js.
- **Cache-bust:** bump `app.js?v=` in templates/index.html on every js change (see
  `feedback_asset_cache_bust`).
