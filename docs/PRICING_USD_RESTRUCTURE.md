# Sivarr Pricing — USD-Anchored Restructure (implementation spec)

Status: **draft for approval**. Supersedes the NGN-anchored `SIVARR_PLANS`
(`Pro ₦2,500 / Team ₦8,000`). Based on `SIVARR_Pricing_Restructured.html`.

## 0. Principles
1. **USD is the only anchor.** Every plan is priced in USD. There is **no regional
   price discounting** — a user in Lagos and a user in London see the same $ number.
2. **Localisation is a payment-layer concern, not a price-layer concern.** We display
   the USD price *and* the amount the user's payment processor will actually charge,
   converted at the current FX rate.
3. **Paystack charges in NGN.** So for Paystack users the displayed conversion is NGN,
   computed `round(amount_usd × NAIRA_RATE)`. (Flutterwave can charge other currencies
   later — same pattern, different rate source.)
4. **Show both numbers before charging.** e.g. `$12 / mo  (≈ ₦19,800 billed via Paystack)`.

> All ₦ figures below are **illustrative at the current `NAIRA_RATE` of 1650**
> ([app.py:168](../app.py)). They must be computed live at checkout, never hard-coded.

---

## 1. The conversion / display mechanic

```
USD anchor ──(× live NAIRA_RATE)──► NGN charge ──► Paystack (kobo = NGN × 100)
     │                                   │
     └── shown to user ──────────────────┘   "$12/mo  (≈ ₦19,800)"
```

**API change** — `/api/billing/plans` (new or extend `/api/billing/status`) returns
for each plan:
```json
{ "id": "personal_pro_monthly", "name": "Pro", "space": "personal",
  "amount_usd": 12, "period": "monthly",
  "display_usd": "$12", "fx": { "currency": "NGN", "rate": 1650,
  "amount_local": 19800, "display_local": "≈ ₦19,800" } }
```
The pricing UI renders `display_usd` as the headline and `display_local` as a muted
sub-line. The checkout button passes only the `plan_id` (+ `seats` where relevant);
the server is the source of truth for the charged amount.

**Critical billing-integrity rule:** at `initialize`, compute `amount_ngn =
round(amount_usd × NAIRA_RATE)`, **store it on the transaction record**, and at
`verify` compare the paid amount against the **stored** `amount_ngn` — never recompute
from the rate (the rate can drift between init and verify). This is a change from
today's `plan["amount_ngn"] * 100` recompute at verify ([app.py:10267](../app.py)).

---

## 2. Plan catalog (USD anchor · ≈NGN @1650)

### 🧠 Personal Space
| Plan | USD | ≈ NGN | Notes |
|---|---|---|---|
| Free | $0 | ₦0 | 10 AI msgs/day*, 3 active templates, 7-day analytics, 1 space |
| **Pro** ⭐ | **$12/mo** · $108/yr (−25%) | ₦19,800 · ₦178,200 | Unlimited core AI, all templates, full analytics, 5 integrations |
| Creator | $22/mo · $198/yr (−25%) | ₦36,300 · ₦326,700 | Top model**, unlimited spaces, sell on marketplace, creator analytics |
| Trading Journal (add-on) | +$6/mo | +₦9,900 | Add-on to Pro/Creator — MT5 sync, AI patterns, risk log |

### 🎓 Academic Space
| Plan | USD | ≈ NGN | Notes |
|---|---|---|---|
| Free Student | $0 | ₦0 | Courses, flashcards, limited quizzes/AI, study plans |
| **Student Pro** ⭐ | **$4.99/mo** · $35/yr (−42%) | ₦8,234 · ₦57,750 | More AI, unlimited quizzes, study groups, storage |
| Educator Pro | $12/mo · $108/yr (−25%) | ₦19,800 · ₦178,200 | Unlimited classes, AI exam gen, student analytics |
| Institution | $4 / student / mo | ₦6,600 / student | First semester free; volume discount 5,000+ students |

### 🏢 Organisation Space (per-seat base + split extensions)
| Item | USD | ≈ NGN | Billing |
|---|---|---|---|
| **Org Base** ⭐ | **$10/seat/mo** · $96/seat/yr (−20%) | ₦16,500 · ₦158,400 | per seat — 2 integrations free |
| Extra Integration | +$3/seat/mo | +₦4,950 | per seat — beyond the 2 free |
| Founder Mode | $39/mo | ₦64,350 | **flat** per org |
| AI Executive Assistant | $49/mo | ₦80,850 | **flat** per org |
| Team-Wide Extension (CRM, adv. analytics) | +$4/seat/mo | +₦6,600 | per seat |

**Seat discounts:** 11–50 seats → 10% off base (auto). 51+ → custom enterprise.
**Founding users (first 100):** Pro locked at **$6/mo for life** (≈ ₦9,900) — a real
billing cohort, not a coupon.

### 🤝 Agent Marketplace (revenue split)
| Creator monthly earnings | Split (creator / Sivarr) |
|---|---|
| First $1,000/mo | **90 / 10** |
| Above $1,000/mo | **80 / 20** |

\* *Free AI/day = 10 in the proposal vs **20 today** — see Open Decision #2.*
\** *"Top model" — the proposal's "Claude Opus" copy does not match the live backend
(Gemini 1.5). See Open Decision #1.*

---

## 3. Proposed `SIVARR_PLANS` (USD-anchored) — Phase 1 shape

```python
# USD is the anchor. Local charge = round(amount_usd * NAIRA_RATE) at checkout time.
SIVARR_PLANS = {
  # ── Personal ──
  "personal_pro_monthly":    {"space":"personal","name":"Pro","label":"Monthly","amount_usd":12,  "period":"monthly"},
  "personal_pro_yearly":     {"space":"personal","name":"Pro","label":"Yearly","amount_usd":108, "period":"yearly"},
  "personal_creator_monthly":{"space":"personal","name":"Creator","label":"Monthly","amount_usd":22,"period":"monthly"},
  "personal_creator_yearly": {"space":"personal","name":"Creator","label":"Yearly","amount_usd":198,"period":"yearly"},
  "addon_trading_monthly":   {"space":"personal","name":"Trading Journal","amount_usd":6,"period":"monthly","addon":True},
  # ── Academic ──
  "student_pro_monthly":     {"space":"academic","name":"Student Pro","label":"Monthly","amount_usd":4.99,"period":"monthly"},
  "student_pro_yearly":      {"space":"academic","name":"Student Pro","label":"Yearly","amount_usd":35,"period":"yearly"},
  "educator_pro_monthly":    {"space":"academic","name":"Educator Pro","label":"Monthly","amount_usd":12,"period":"monthly"},
  "educator_pro_yearly":     {"space":"academic","name":"Educator Pro","label":"Yearly","amount_usd":108,"period":"yearly"},
  # ── Founding cohort (first 100) ──
  "founding_pro_monthly":    {"space":"personal","name":"Pro (Founding)","amount_usd":6,"period":"monthly","cohort":"founding_100"},
  # ── Org (Phase 2 — needs per-seat engine) ──
  "org_base_seat_monthly":   {"space":"org","name":"Org Base","amount_usd":10,"period":"monthly","per_seat":True},
  "org_base_seat_yearly":    {"space":"org","name":"Org Base","amount_usd":96,"period":"yearly","per_seat":True},
  "institution_seat":        {"space":"academic","name":"Institution","amount_usd":4,"period":"monthly","per_seat":True},
  "org_extra_integration":   {"space":"org","name":"Extra Integration","amount_usd":3,"period":"monthly","per_seat":True,"addon":True},
  "org_ext_team_wide":       {"space":"org","name":"Team-Wide Extension","amount_usd":4,"period":"monthly","per_seat":True,"addon":True},
  "org_ext_founder":         {"space":"org","name":"Founder Mode","amount_usd":39,"period":"monthly","flat":True,"addon":True},
  "org_ext_ai_assistant":    {"space":"org","name":"AI Executive Assistant","amount_usd":49,"period":"monthly","flat":True,"addon":True},
}

def plan_charge_ngn(plan: dict, seats: int = 1) -> int:
    """USD anchor → NGN charge for Paystack. Per-seat plans multiply by seats."""
    usd = plan["amount_usd"] * (seats if plan.get("per_seat") else 1)
    return round(usd * NAIRA_RATE)
```

---

## 4. Implementation phasing (what's actually go-through-able now)

**Phase 1 — single-subscription USD tiers (low risk, ships on current engine):**
- Personal Free / Pro / Creator, Academic Free / Student Pro / Educator Pro, Founding.
- These map 1:1 onto today's "one subscription per user" model. Only changes:
  `amount_usd` field, `plan_charge_ngn()` at initialize, store-and-verify the NGN
  amount, and the conversion display in the pricing UI + `/api/billing/plans`.
- Plan-level gating: extend `_PLAN_LEVELS` ([js/app.js:915](../js/app.js)) to recognise
  the new names (`Creator > Pro > Free`, `Educator Pro`, `Student Pro`).

**Phase 2 — needs new billing primitives (build before Org/add-ons go live):**
- **Per-seat billing** (Org Base, Institution, Team-Wide): seat count, proration,
  seat-discount tiers (11–50 = −10%).
- **Add-ons** as separate recurring line items attached to a base sub (Trading Journal,
  Extra Integration).
- **Flat org-wide extensions** (Founder $39, AI Exec $49) — one charge per org, not per seat.
- **Quota gating** the proposal implies but doesn't exist yet: "3 active templates",
  "5 integrations", "7-day analytics window".

**Phase 3 — growth mechanics:**
- Founding-100 cohort counter + lifetime lock.
- Student→Educator referral = permanent 50% personal discount (tracked, auto-applied).
- Marketplace tiered split (90/10 → 80/20 above $1k/mo) — today it's a flat 0.90.

---

## 5. Grandfathering (testers are on ~$1.50 Pro today)
Going from ₦2,500 (~$1.52) to $12 is ~8×. Decide one:
- **(a) Grandfather** all current paid testers at their current rate indefinitely, or
- **(b) Auto-enrol** current testers into the **Founding $6/mo-for-life** cohort (still
  an increase, but a permanent discount and a clean story), or
- **(c) Honour current price until renewal**, then move to new pricing.
Recommended: **(b)** — it consumes the founding-100 slots meaningfully and frames the
increase as a reward.

---

## 6. Decisions (settled 2026-06-29)
1. **Creator "top model" copy → "Claude Opus — coming soon".** Backend stays Gemini 1.5;
   the tier advertises Claude Opus as a coming-soon perk, not a live feature.
2. **Free AI/day = 15.** `FREE_DAILY_CHAT` moves 20 → 15.
3. **Founding-100 opens fresh at launch** — no auto-enrol. Since there are no paying
   customers yet (testers only), **no grandfathering is required**; everyone starts on the
   new pricing at launch (§5 is moot for now).
4. **NAIRA_RATE stays a static, team-set rate** (FX fluctuates) but is **runtime-editable
   by an admin without a redeploy**; conversion + charge read it live.
```
