"""
Sivarr Agents -- the agent-template marketplace: browse/install templates,
agent creator profiles, creator dashboard (create/publish/earnings/payouts),
reviews/follows, admin moderation, and both payment gateways (Stripe
Checkout for USD, Paystack for NGN) including their webhooks.

This is NOT the same system as routes/marketplace.py's installed-extensions
Marketplace -- confirmed zero cross-calls on any layer (backend, frontend,
CSS, templates). They share the "Marketplace" label in product copy only.

WHY build_router() IS A FACTORY, NOT A BARE ROUTER
-----------------------------------------------------
Same reasoning as routes/org.py (see that file's module docstring). Six
names here are genuinely app.py-resident, not agents-domain:
  load_progress            -- central per-user state accessor
  _plan_caps                -- shared plan-quota cap lookup (also used by
                                spaces/integrations/ai_chat/ai_actions/
                                analytics caps elsewhere in app.py)
  _is_valid_admin_session   -- the general admin-session check, 26+ other
                                call sites in app.py
  get_naira_rate            -- shared USD->NGN FX-rate cache, also used by
                                billing/admin/dashboard code not yet
                                extracted
  _rc_get/_rc_set/_rc_bust  -- generic per-worker/Redis response cache,
                                also used by other not-yet-extracted
                                domains (comm:/opp: prefixes)
All five are taken as constructor arguments rather than imported, exactly
like org.py takes load_progress/send_email/send_push/_is_valid_admin_session.

PAYMENTS
--------
ag_checkout/ag_stripe_webhook handle Stripe (USD); payment_config/
paystack_initialize/paystack_verify/paystack_webhook handle Paystack (NGN).
Both webhook handlers independently verify their own signature
(stripe.Webhook.construct_event against STRIPE_WEBHOOK_SECRET; a manual
hmac.compare_digest HMAC-SHA512 check against PAYSTACK_SECRET_KEY) before
trusting any payload. STRIPE_*/PAYSTACK_*/BASE_URL/httpx are duplicated as
module-level constants here rather than imported from app.py, matching the
precedent routes/org.py already set for BASE_URL/PAYSTACK_API/httpx --
they're pure env-var-derived config, not mutable app.py state, so
duplication carries zero drift risk.

_ag_demo_templates() is fallback/demo data used only when db.is_available()
is False -- mutually exclusive with the real DB-backed query at both call
sites, not a competing data source.
"""

import asyncio
import datetime
import hashlib
import hmac
import json
import logging
import os
import uuid

from fastapi import APIRouter, HTTPException, Request

import database as db
from core import sanitize_text, get_session_from_token, _resolve_token

log = logging.getLogger(__name__)

try:
    import stripe as _stripe
    _stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
    STRIPE_AVAILABLE = bool(_stripe.api_key)
    stripe = _stripe
except ImportError:
    STRIPE_AVAILABLE = False
    stripe = None

try:
    import httpx as _httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    _httpx = None

BASE_URL              = os.environ.get("BASE_URL", "https://sivarr.up.railway.app")
STRIPE_WEBHOOK_SECRET  = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
PAYSTACK_SECRET_KEY    = os.environ.get("PAYSTACK_SECRET_KEY", "")
PAYSTACK_PUBLIC_KEY    = os.environ.get("PAYSTACK_PUBLIC_KEY", "")
PAYSTACK_AVAILABLE     = bool(PAYSTACK_SECRET_KEY)
PAYSTACK_API           = "https://api.paystack.co"


def build_router(load_progress, _plan_caps, _is_valid_admin_session, get_naira_rate, _rc_get, _rc_set, _rc_bust) -> APIRouter:
    router = APIRouter()

    #  AGENTS MARKETPLACE API
    # ═══════════════════════════════════════════════════════════════

    # ── Public marketplace endpoints ──────────────────────────────

    @router.get("/api/agents/templates")
    async def ag_list_templates(
        category: str = "all", sort: str = "popular",
        free_only: bool = False, limit: int = 60,
    ):
        ck = f"tmpl:{category}:{sort}:{free_only}:{limit}"
        cached = _rc_get(ck)
        if cached is not None:
            return cached
        if not db.is_available():
            result = {"templates": _ag_demo_templates()}
            _rc_set(ck, result, ttl=120)
            return result
        # agent_name + agent_verified come from the JOIN in get_templates — no N+1
        templates = await asyncio.to_thread(
            db.get_templates,
            None if category == "all" else category,
            sort, free_only, limit,
        )
        result = {"templates": templates}
        _rc_set(ck, result, ttl=120)
        return result


    @router.get("/api/agents/templates/{template_id}")
    async def ag_get_template(template_id: str):
        template_id = sanitize_text(template_id, 60)
        if not db.is_available():
            return {"template": {}}
        t = db.get_template_by_id(template_id)
        if not t:
            raise HTTPException(404, "Template not found.")
        agent = db.get_agent_by_id(t.get("agent_id",""))
        t["agent_name"]     = agent.get("display_name","") if agent else ""
        t["agent_verified"] = agent.get("verified", False) if agent else False
        t["reviews"] = db.get_template_reviews(template_id, limit=5)
        return {"template": t}


    @router.get("/api/agents/featured")
    async def ag_featured():
        if not db.is_available():
            demos = _ag_demo_templates()
            return {"template": demos[0] if demos else {}}
        t = db.get_featured_template()
        return {"template": t}


    @router.get("/api/agents")
    async def ag_list_agents(sort: str = "downloads"):
        if not db.is_available():
            return {"agents": []}
        agents = db.get_all_agents(sort=sort)
        return {"agents": agents}


    @router.get("/api/agents/{agent_id}")
    async def ag_get_agent(agent_id: str):
        agent_id = sanitize_text(agent_id, 60)
        if not db.is_available():
            raise HTTPException(404, "Agent not found.")
        agent = db.get_agent_by_id(agent_id)
        if not agent:
            raise HTTPException(404, "Agent not found.")
        agent["templates"] = db.get_agent_templates(agent_id)
        return {"agent": agent}


    # ── Template install ──────────────────────────────────────────

    @router.post("/api/agents/templates/{template_id}/install")
    async def ag_install_free(template_id: str, data: dict):
        sid, _ = _resolve_token(data)
        template_id = sanitize_text(template_id, 60)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        t = db.get_template_by_id(template_id)
        if not t:
            raise HTTPException(404, "Template not found.")
        if float(t.get("price", 0)) > 0:
            raise HTTPException(400, "This is a paid template. Use the checkout flow.")
        if db.check_download(sid, template_id):
            return {"ok": True, "already_owned": True}
        # Quota gating: cap installed templates on limited plans (re-installs above are free).
        _tpl_cap = _plan_caps(load_progress(sid)).get("templates")
        if _tpl_cap is not None and db.count_downloads(sid) >= _tpl_cap:
            raise HTTPException(402, f"Your plan includes {_tpl_cap} templates. Upgrade to install more.")
        dl_id = uuid.uuid4().hex[:20]
        db.record_download({
            "id": dl_id, "template_id": template_id, "buyer_sid": sid,
            "agent_id": t["agent_id"], "gross_amount": 0,
            "sivarr_fee": 0, "agent_earnings": 0, "status": "completed",
        })
        return {"ok": True, "contents": t.get("contents", {})}


    @router.get("/api/agents/templates/{template_id}/owned")
    async def ag_check_owned(template_id: str, token: str = ""):
        if not token or not db.is_available():
            return {"owned": False}
        entry = get_session_from_token(sanitize_text(token, 100))
        if not entry:
            return {"owned": False}
        return {"owned": db.check_download(entry["sid"], template_id)}


    # ── Safety: report / flag a template (Stage 9) ────────────────
    @router.post("/api/agents/templates/{template_id}/report")
    async def ag_report_template(template_id: str, data: dict):
        """A signed-in user flags a marketplace template for moderation review.
        Stored in the `agent_reports` collection (owner = template_id). One row per
        reporter+template (re-reporting updates the reason). Admin reviews via
        /api/admin/agents/reports."""
        sid, name = _resolve_token(data)
        template_id = sanitize_text(template_id, 60)
        reason = sanitize_text(str(data.get("reason", "")), 500)
        if not reason:
            raise HTTPException(400, "A reason is required.")
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        db.coll_put("agent_reports", f"{template_id}:{sid}", {
            "template_id": template_id,
            "reporter_sid": sid,
            "reporter_name": name,
            "reason": reason,
            "status": "open",
            "ts": datetime.datetime.now().isoformat(),
        }, owner=template_id)
        return {"ok": True}


    @router.get("/api/admin/agents/reports")
    async def ag_admin_list_reports(token: str = ""):
        if not _is_valid_admin_session(sanitize_text(token, 100)):
            raise HTTPException(401, "Unauthorized")
        if not db.is_available():
            return {"reports": []}
        return {"reports": db.coll_list("agent_reports")}


    # ── Agent application ─────────────────────────────────────────

    @router.post("/api/agents/apply")
    async def ag_apply(data: dict):
        sid, name = _resolve_token(data)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        existing = db.get_agent_by_user(sid)
        if existing:
            raise HTTPException(400, "You already have an agent profile.")
        display_name = sanitize_text(str(data.get("display_name", name)), 100)
        bio          = sanitize_text(str(data.get("bio", "")), 400)
        speciality   = [sanitize_text(str(s),50) for s in (data.get("speciality") or [])[:6]]
        stripe_email = sanitize_text(str(data.get("stripe_email", "")), 200)
        country      = sanitize_text(str(data.get("country","US")), 3)

        agent_id = uuid.uuid4().hex[:20]
        stripe_account_id = None
        onboarding_url = None

        if STRIPE_AVAILABLE and stripe_email:
            try:
                account = stripe.Account.create(
                    type="express", country=country, email=stripe_email,
                    capabilities={"transfers": {"requested": True}},
                )
                stripe_account_id = account.id
                link = stripe.AccountLink.create(
                    account=account.id,
                    refresh_url=f"{BASE_URL}/agents/apply?step=stripe",
                    return_url=f"{BASE_URL}/agents/dashboard?onboarded=true",
                    type="account_onboarding",
                )
                onboarding_url = link.url
            except Exception as e:
                log.warning(f"Stripe Connect create failed: {e}")

        db.create_agent({
            "id": agent_id, "user_sid": sid, "display_name": display_name,
            "bio": bio, "speciality": speciality,
            "stripe_account_id": stripe_account_id,
            "status": "stripe_pending" if stripe_account_id else "applied",
        })
        return {"ok": True, "agent_id": agent_id, "onboarding_url": onboarding_url}


    @router.get("/api/agents/me")
    async def ag_me(token: str = ""):
        if not token or not db.is_available():
            return {"agent": None}
        entry = get_session_from_token(sanitize_text(token, 100))
        if not entry:
            return {"agent": None}
        agent = db.get_agent_by_user(entry["sid"])
        return {"agent": agent or None}


    @router.put("/api/agents/me")
    async def ag_update_me(data: dict):
        sid, _ = _resolve_token(data)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        agent = db.get_agent_by_user(sid)
        if not agent:
            raise HTTPException(404, "No agent profile found.")
        fields = {}
        for k in ("display_name","bio","speciality"):
            if k in data:
                fields[k] = sanitize_text(str(data[k]),200) if isinstance(data[k],str) \
                            else data[k]
        db.update_agent(agent["id"], fields)
        return {"ok": True}


    # ── Agent's own templates ─────────────────────────────────────

    @router.get("/api/agents/me/templates")
    async def ag_my_templates(token: str = ""):
        if not token or not db.is_available():
            return {"templates": []}
        entry = get_session_from_token(sanitize_text(token,100))
        if not entry:
            return {"templates": []}
        agent = db.get_agent_by_user(entry["sid"])
        if not agent:
            return {"templates": []}
        return {"templates": db.get_agent_templates(agent["id"], include_drafts=True)}


    @router.post("/api/agents/me/templates")
    async def ag_create_template(data: dict):
        sid, _ = _resolve_token(data)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        agent = db.get_agent_by_user(sid)
        if not agent or agent.get("status") != "active":
            raise HTTPException(403, "Active agent account required.")
        tpl_id = uuid.uuid4().hex[:20]
        tpl = {
            "id":                tpl_id,
            "agent_id":          agent["id"],
            "name":              sanitize_text(str(data.get("name","Untitled")),100),
            "short_description": sanitize_text(str(data.get("short_description","")),200),
            "full_description":  sanitize_text(str(data.get("full_description","")),800),
            "category":          sanitize_text(str(data.get("category","workspace")),50),
            "tags":              [sanitize_text(str(t),50) for t in (data.get("tags") or [])[:5]],
            "thumbnail_color":   sanitize_text(str(data.get("thumbnail_color","#4f6ef7")),20),
            "price":             max(0.0, float(data.get("price",0))),
            "price_ngn":         float(data["price_ngn"]) if data.get("price_ngn") is not None else None,
            "contents":          data.get("contents") or {},
            "included_items":    data.get("included_items") or [],
            "status":            "draft",
        }
        db.create_template(tpl)
        return {"ok": True, "template_id": tpl_id}


    @router.put("/api/agents/me/templates/{template_id}")
    async def ag_update_template(template_id: str, data: dict):
        sid, _ = _resolve_token(data)
        template_id = sanitize_text(template_id, 60)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        agent = db.get_agent_by_user(sid)
        if not agent:
            raise HTTPException(403, "No agent profile.")
        fields = {}
        for k in ("name","short_description","full_description","category","tags",
                  "thumbnail_color","price","price_ngn","contents","included_items"):
            if k in data:
                fields[k] = data[k]
        if "price" in fields:
            fields["price"] = max(0.0, float(fields["price"]))
        if "price_ngn" in fields:
            fields["price_ngn"] = float(fields["price_ngn"]) if fields["price_ngn"] is not None else None
        db.update_template(template_id, agent["id"], fields)
        return {"ok": True}


    @router.delete("/api/agents/me/templates/{template_id}")
    async def ag_delete_template(template_id: str, data: dict):
        sid, _ = _resolve_token(data)
        template_id = sanitize_text(template_id, 60)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        agent = db.get_agent_by_user(sid)
        if not agent:
            raise HTTPException(403, "No agent profile.")
        db.delete_template(template_id, agent["id"])
        return {"ok": True}


    @router.post("/api/agents/me/templates/{template_id}/publish")
    async def ag_publish_template(template_id: str, data: dict):
        sid, _ = _resolve_token(data)
        template_id = sanitize_text(template_id, 60)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        agent = db.get_agent_by_user(sid)
        if not agent or agent.get("status") != "active":
            raise HTTPException(403, "Active agent account required.")
        db.update_template(template_id, agent["id"], {"status": "published"})
        _rc_bust("tmpl:")
        return {"ok": True}


    # ── Earnings & payouts ────────────────────────────────────────

    @router.get("/api/agents/me/earnings")
    async def ag_earnings(token: str = ""):
        if not token or not db.is_available():
            return {"monthly": [], "by_template": []}
        entry = get_session_from_token(sanitize_text(token,100))
        if not entry:
            return {"monthly": [], "by_template": []}
        agent = db.get_agent_by_user(entry["sid"])
        if not agent:
            return {"monthly": [], "by_template": []}
        data = db.get_agent_earnings(agent["id"])
        data["agent"] = agent
        return data


    @router.get("/api/agents/me/payouts")
    async def ag_payouts(token: str = ""):
        if not token or not db.is_available():
            return {"payouts": []}
        entry = get_session_from_token(sanitize_text(token,100))
        if not entry:
            return {"payouts": []}
        agent = db.get_agent_by_user(entry["sid"])
        if not agent:
            return {"payouts": []}
        return {"payouts": db.get_payouts(agent["id"])}


    @router.get("/api/agents/me/reviews")
    async def ag_my_reviews(token: str = ""):
        if not token or not db.is_available():
            return {"reviews": []}
        entry = get_session_from_token(sanitize_text(token,100))
        if not entry:
            return {"reviews": []}
        agent = db.get_agent_by_user(entry["sid"])
        if not agent:
            return {"reviews": []}
        return {"reviews": db.get_agent_reviews(agent["id"])}


    # ── Social ────────────────────────────────────────────────────

    @router.post("/api/agents/{agent_id}/follow")
    async def ag_follow(agent_id: str, data: dict):
        sid, _ = _resolve_token(data)
        agent_id = sanitize_text(agent_id, 60)
        if db.is_available():
            db.follow_agent(sid, agent_id)
        return {"ok": True}


    @router.delete("/api/agents/{agent_id}/follow")
    async def ag_unfollow(agent_id: str, data: dict):
        sid, _ = _resolve_token(data)
        agent_id = sanitize_text(agent_id, 60)
        if db.is_available():
            db.unfollow_agent(sid, agent_id)
        return {"ok": True}


    @router.post("/api/agents/templates/{template_id}/review")
    async def ag_add_review(template_id: str, data: dict):
        sid, _ = _resolve_token(data)
        template_id = sanitize_text(template_id, 60)
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        if not db.check_download(sid, template_id):
            raise HTTPException(403, "Must own template to review.")
        rating = int(data.get("rating", 5))
        if not (1 <= rating <= 5):
            raise HTTPException(400, "Rating must be 1–5.")
        review = {
            "id": uuid.uuid4().hex[:20],
            "template_id": template_id,
            "reviewer_sid": sid,
            "rating": rating,
            "review_text": sanitize_text(str(data.get("review_text","")), 500),
        }
        db.add_review(review)
        return {"ok": True}


    # ── Payment (Stripe) ──────────────────────────────────────────

    @router.post("/api/payments/checkout")
    async def ag_checkout(data: dict):
        sid, _ = _resolve_token(data)
        template_id = sanitize_text(str(data.get("template_id","")), 60)
        if not template_id or not db.is_available():
            raise HTTPException(400, "template_id required.")
        t = db.get_template_by_id(template_id)
        if not t:
            raise HTTPException(404, "Template not found.")
        if float(t.get("price",0)) == 0:
            # Free — install directly
            if not db.check_download(sid, template_id):
                dl_id = uuid.uuid4().hex[:20]
                db.record_download({
                    "id": dl_id, "template_id": template_id, "buyer_sid": sid,
                    "agent_id": t["agent_id"], "gross_amount": 0,
                    "sivarr_fee": 0, "agent_earnings": 0, "status": "completed",
                })
            return {"status": "installed", "contents": t.get("contents",{})}
        if not STRIPE_AVAILABLE:
            raise HTTPException(503, "Payment processing not configured.")
        agent = db.get_agent_by_id(t["agent_id"])
        try:
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[{
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": int(float(t["price"]) * 100),
                        "product_data": {
                            "name": t["name"],
                            "description": f"Sivarr template by {agent.get('display_name','') if agent else ''}",
                        },
                    },
                    "quantity": 1,
                }],
                mode="payment",
                success_url=f"{BASE_URL.rstrip('/')}/app?payment=success&template={template_id}",
                cancel_url=f"{BASE_URL}/?payment=cancelled&template={template_id}",
                metadata={
                    "template_id": template_id,
                    "buyer_sid":   sid,
                    "agent_id":    t["agent_id"],
                },
            )
            return {"checkout_url": session.url}
        except Exception as e:
            log.error(f"Stripe checkout error: {e}")
            raise HTTPException(500, "Payment session creation failed.")


    @router.post("/api/webhooks/stripe")
    async def ag_stripe_webhook(request: Request):
        payload    = await request.body()
        sig_header = request.headers.get("stripe-signature", "")
        if not STRIPE_AVAILABLE:
            raise HTTPException(503, "Stripe not configured.")
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except ValueError:
            raise HTTPException(400, "Invalid payload.")
        except Exception:
            raise HTTPException(400, "Invalid signature.")
        if event["type"] == "checkout.session.completed":
            session     = event["data"]["object"]
            template_id = session["metadata"].get("template_id","")
            buyer_sid   = session["metadata"].get("buyer_sid","")
            agent_id    = session["metadata"].get("agent_id","")
            amount_cents = int(session.get("amount_total",0))
            gross   = amount_cents / 100
            fee     = round(gross * 0.10, 2)
            net     = round(gross * 0.90, 2)
            if template_id and buyer_sid and not db.check_download(buyer_sid, template_id):
                dl_id = uuid.uuid4().hex[:20]
                db.record_download({
                    "id": dl_id, "template_id": template_id, "buyer_sid": buyer_sid,
                    "agent_id": agent_id, "gross_amount": gross, "sivarr_fee": fee,
                    "agent_earnings": net, "stripe_session_id": session.get("id",""),
                    "status": "completed",
                })
                if agent_id:
                    db.add_agent_earnings(agent_id, net)
        return {"received": True}


    # ── Admin — agents controls ───────────────────────────────────

    @router.post("/api/admin/agents/{agent_id}/verify")
    async def ag_admin_verify(agent_id: str, data: dict):
        if not _is_valid_admin_session(str(data.get("token",""))):
            raise HTTPException(401, "Unauthorized")
        agent_id = sanitize_text(agent_id, 60)
        if db.is_available():
            db.update_agent(agent_id, {"verified": True, "status": "active"})
        return {"ok": True}


    @router.post("/api/admin/agents/{agent_id}/suspend")
    async def ag_admin_suspend(agent_id: str, data: dict):
        if not _is_valid_admin_session(str(data.get("token",""))):
            raise HTTPException(401, "Unauthorized")
        agent_id = sanitize_text(agent_id, 60)
        if db.is_available():
            db.update_agent(agent_id, {"status": "suspended"})
        return {"ok": True}


    @router.post("/api/admin/templates/{template_id}/approve")
    async def ag_admin_approve_template(template_id: str, data: dict):
        if not _is_valid_admin_session(str(data.get("token",""))):
            raise HTTPException(401, "Unauthorized")
        template_id = sanitize_text(template_id, 60)
        if db.is_available():
            t = db.get_template_by_id(template_id)
            if t:
                db.update_template(template_id, t["agent_id"], {"status": "published"})
                _rc_bust("tmpl:")
        return {"ok": True}


    # ── Demo data (shown when DB unavailable) ─────────────────────

    def _ag_demo_templates() -> list:
        return [
            {
                "id": "demo_1", "name": "Student OS Pro",
                "short_description": "Complete workspace for high-achieving students",
                "category": "workspace", "price": 0, "download_count": 1240,
                "avg_rating": 4.8, "review_count": 94, "status": "published",
                "thumbnail_color": "#4f6ef7", "agent_name": "Sivarr Team",
                "agent_verified": True, "tags": ["workspace","productivity"],
                "agent_id": "demo_agent_1",
            },
            {
                "id": "demo_2", "name": "Exam Prep Deck: STEM",
                "short_description": "500 flashcards across Maths, Physics and Chemistry",
                "category": "study_decks", "price": 4.99, "download_count": 872,
                "avg_rating": 4.9, "review_count": 61, "status": "published",
                "thumbnail_color": "#d97706", "agent_name": "StudyMaster",
                "agent_verified": True, "tags": ["flashcards","stem"],
                "agent_id": "demo_agent_2",
            },
            {
                "id": "demo_3", "name": "90-Day Goal System",
                "short_description": "Pre-built goals, habit stack and weekly review",
                "category": "goals", "price": 2.99, "download_count": 563,
                "avg_rating": 4.7, "review_count": 38, "status": "published",
                "thumbnail_color": "#22c55e", "agent_name": "GrowthLab",
                "agent_verified": False, "tags": ["goals","habits"],
                "agent_id": "demo_agent_3",
            },
            {
                "id": "demo_4", "name": "AI Prompt Pack: Essays",
                "short_description": "100 prompts for academic writing and research",
                "category": "ai_prompts", "price": 1.99, "download_count": 421,
                "avg_rating": 4.6, "review_count": 29, "status": "published",
                "thumbnail_color": "#6b7280", "agent_name": "PromptCraft",
                "agent_verified": False, "tags": ["ai","writing"],
                "agent_id": "demo_agent_4",
            },
            {
                "id": "demo_5", "name": "Gratitude Journal System",
                "short_description": "31 journal prompts + reflection framework",
                "category": "journal", "price": 0, "download_count": 318,
                "avg_rating": 4.5, "review_count": 22, "status": "published",
                "thumbnail_color": "#7f77dd", "agent_name": "MindfulStudy",
                "agent_verified": False, "tags": ["journal","wellbeing"],
                "agent_id": "demo_agent_5",
            },
            {
                "id": "demo_6", "name": "Founder OS",
                "short_description": "Org space template for solo founders and small teams",
                "category": "workspace", "price": 9.99, "download_count": 247,
                "avg_rating": 4.9, "review_count": 18, "status": "published",
                "thumbnail_color": "#4f6ef7", "agent_name": "BuildFast",
                "agent_verified": True, "tags": ["founders","startup"],
                "agent_id": "demo_agent_6",
            },
        ]


    # ── Payment config (public) ───────────────────────────────────

    @router.get("/api/config/payment")
    async def payment_config():
        """Return public payment keys + Naira rate. Safe to expose."""
        return {
            "paystack_public_key": PAYSTACK_PUBLIC_KEY,
            "paystack_available":  PAYSTACK_AVAILABLE,
            "stripe_available":    STRIPE_AVAILABLE,
            "naira_rate":          get_naira_rate(),
        }


    # ── Paystack — NGN payments ───────────────────────────────────

    @router.post("/api/payments/paystack/initialize")
    async def paystack_initialize(data: dict):
        """Create a Paystack transaction and return the authorization URL + reference."""
        sid, _ = _resolve_token(data)
        if not PAYSTACK_AVAILABLE:
            raise HTTPException(503, "Paystack not configured.")
        template_id = sanitize_text(str(data.get("template_id","")), 60)
        email       = sanitize_text(str(data.get("email", "")), 200)
        if not template_id:
            raise HTTPException(400, "template_id required.")
        if not db.is_available():
            raise HTTPException(503, "DB unavailable.")
        t = db.get_template_by_id(template_id)
        if not t:
            raise HTTPException(404, "Template not found.")

        # Determine NGN price
        price_usd = float(t.get("price", 0))
        price_ngn = t.get("price_ngn") or round(price_usd * get_naira_rate(), 2)
        if price_ngn == 0:
            # Free — install directly
            if not db.check_download(sid, template_id):
                dl_id = uuid.uuid4().hex[:20]
                db.record_download({
                    "id": dl_id, "template_id": template_id, "buyer_sid": sid,
                    "agent_id": t["agent_id"], "gross_amount": 0,
                    "sivarr_fee": 0, "agent_earnings": 0, "status": "completed",
                })
            return {"status": "installed", "contents": t.get("contents", {})}

        amount_kobo = int(price_ngn * 100)  # Paystack uses kobo
        reference   = f"siv_{uuid.uuid4().hex[:16]}"

        payload = {
            "email":       email or f"buyer_{sid}@sivarr.com",
            "amount":      amount_kobo,
            "currency":    "NGN",
            "reference":   reference,
            "callback_url": f"{BASE_URL.rstrip('/')}/app?payment=success&template={template_id}&gateway=paystack&ref={reference}",
            "metadata": {
                "template_id": template_id,
                "buyer_sid":   sid,
                "agent_id":    t["agent_id"],
                "price_usd":   str(price_usd),
                "price_ngn":   str(price_ngn),
            },
        }
        headers = {
            "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
            "Content-Type":  "application/json",
        }
        if not HTTPX_AVAILABLE:
            raise HTTPException(503, "HTTP client unavailable.")
        try:
            async with _httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(f"{PAYSTACK_API}/transaction/initialize",
                                         json=payload, headers=headers)
            result = resp.json()
        except Exception as e:
            log.error(f"Paystack initialize error: {e}")
            raise HTTPException(502, "Paystack API unreachable.")
        if not result.get("status"):
            raise HTTPException(400, result.get("message", "Paystack error."))
        return {
            "authorization_url": result["data"]["authorization_url"],
            "access_code":       result["data"]["access_code"],
            "reference":         reference,
            "amount_kobo":       amount_kobo,
            "price_ngn":         price_ngn,
        }


    @router.get("/api/payments/paystack/verify/{reference}")
    async def paystack_verify(reference: str, token: str = ""):
        """Verify a Paystack transaction by reference and install the template."""
        reference = sanitize_text(reference, 80)
        if not PAYSTACK_AVAILABLE or not HTTPX_AVAILABLE:
            raise HTTPException(503, "Paystack not configured.")
        if not reference:
            raise HTTPException(400, "reference required.")

        # Resolve user
        sid = None
        if token:
            entry = get_session_from_token(sanitize_text(token, 100))
            if entry:
                sid = entry["sid"]

        # Call Paystack verify endpoint
        headers = {"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"}
        try:
            async with _httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(f"{PAYSTACK_API}/transaction/verify/{reference}",
                                        headers=headers)
            result = resp.json()
        except Exception as e:
            log.error(f"Paystack verify error: {e}")
            raise HTTPException(502, "Paystack API unreachable.")

        if not result.get("status"):
            raise HTTPException(400, result.get("message","Verification failed."))

        tx = result["data"]
        if tx.get("status") != "success":
            raise HTTPException(402, "Payment not completed.")

        meta        = tx.get("metadata", {})
        template_id = meta.get("template_id","") or sanitize_text(str(tx.get("template_id","")),60)
        # Never trust client-supplied buyer_sid from metadata; use only the authenticated session.
        buyer_sid   = sid or ""
        agent_id    = meta.get("agent_id","")
        amount_kobo = int(tx.get("amount", 0))
        price_ngn   = amount_kobo / 100
        price_usd   = price_ngn / get_naira_rate()

        if not template_id or not db.is_available():
            return {"ok": True, "verified": True, "contents": {}}

        # Idempotency — don't double-install
        if db.check_payment_reference(reference):
            t = db.get_template_by_id(template_id)
            return {"ok": True, "already_processed": True, "contents": t.get("contents",{}) if t else {}}

        if buyer_sid and not db.check_download(buyer_sid, template_id):
            t = db.get_template_by_id(template_id)
            agent_id = agent_id or (t.get("agent_id","") if t else "")
            net = round(price_usd * 0.90, 4)
            fee = round(price_usd * 0.10, 4)
            dl_id = uuid.uuid4().hex[:20]
            db.record_download({
                "id": dl_id, "template_id": template_id, "buyer_sid": buyer_sid,
                "agent_id": agent_id, "gross_amount": price_usd, "sivarr_fee": fee,
                "agent_earnings": net, "stripe_session_id": reference, "status": "completed",
            })
            if agent_id:
                db.add_agent_earnings(agent_id, net)
            t = db.get_template_by_id(template_id)
            return {"ok": True, "contents": t.get("contents",{}) if t else {}}

        t = db.get_template_by_id(template_id)
        return {"ok": True, "contents": t.get("contents",{}) if t else {}}


    @router.post("/api/webhooks/paystack")
    async def paystack_webhook(request: Request):
        """Paystack webhook — HMAC-SHA512 verified."""
        payload    = await request.body()
        sig_header = request.headers.get("x-paystack-signature", "")

        if not PAYSTACK_SECRET_KEY:
            raise HTTPException(503, "Paystack not configured.")

        expected = hmac.new(PAYSTACK_SECRET_KEY.encode(), payload, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(sig_header, expected):
            raise HTTPException(400, "Invalid signature.")

        try:
            event = json.loads(payload)
        except Exception:
            raise HTTPException(400, "Invalid JSON.")

        if event.get("event") == "charge.success":
            tx        = event.get("data", {})
            meta      = tx.get("metadata", {})
            reference = tx.get("reference","")
            template_id = meta.get("template_id","")
            buyer_sid   = meta.get("buyer_sid","")
            agent_id    = meta.get("agent_id","")
            amount_kobo = int(tx.get("amount", 0))
            price_ngn   = amount_kobo / 100
            price_usd   = price_ngn / get_naira_rate()

            if template_id and buyer_sid and db.is_available():
                if not db.check_payment_reference(reference):
                    if not db.check_download(buyer_sid, template_id):
                        t = db.get_template_by_id(template_id)
                        aid = agent_id or (t.get("agent_id","") if t else "")
                        net = round(price_usd * 0.90, 4)
                        fee = round(price_usd * 0.10, 4)
                        dl_id = uuid.uuid4().hex[:20]
                        db.record_download({
                            "id": dl_id, "template_id": template_id, "buyer_sid": buyer_sid,
                            "agent_id": aid, "gross_amount": price_usd, "sivarr_fee": fee,
                            "agent_earnings": net, "stripe_session_id": reference, "status": "completed",
                        })
                        if aid:
                            db.add_agent_earnings(aid, net)
                        log.info(f"Paystack: installed template {template_id} for {buyer_sid}")

        return {"received": True}

    return router
