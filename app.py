"""
Sivarr AI Web App — FastAPI Backend v4.2
Added: Rate limiting, Input validation, Error logging
"""

import ast
import collections
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
import threading
import time
import traceback
import uuid
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

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
import asyncio, json, time
from collections import defaultdict

# ── Real-time chat: in-memory SSE queues per org ──────────────
_ORG_SSE: dict[str, list[asyncio.Queue]] = defaultdict(list)

async def _sse_broadcast(org_id: str, payload: str):
    dead = []
    for q in list(_ORG_SSE.get(org_id, [])):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        try: _ORG_SSE[org_id].remove(q)
        except ValueError: pass

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

VERSION       = "3"
CACHE_EXPIRY  = 30
HISTORY_LIMIT = 40
BANK_LIMIT    = 20
# Use Railway persistent volume if available, else local
# Set RAILWAY_VOLUME_MOUNT_PATH in Railway environment variables
_BASE = Path(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "."))
DATA_DIR    = _BASE / "data"
UPLOADS_DIR = _BASE / "uploads"
SHARES_DIR  = _BASE / "shares"
LOG_DIR     = _BASE / "logs"

for d in [DATA_DIR, UPLOADS_DIR, SHARES_DIR, LOG_DIR]:
    d.mkdir(parents=True, exist_ok=True)

ADMIN_PASSWORD     = os.environ.get("ADMIN_PASSWORD", "")
LECTURER_PASSWORD  = os.environ.get("LECTURER_PASSWORD", "")
if not ADMIN_PASSWORD:
    import sys
    print("CRITICAL: ADMIN_PASSWORD env var is not set. Admin login is disabled.", file=sys.stderr)
if not LECTURER_PASSWORD:
    import sys
    print("CRITICAL: LECTURER_PASSWORD env var is not set. Lecturer login is disabled.", file=sys.stderr)
BASE_URL           = os.environ.get("BASE_URL", "https://sivarr.up.railway.app")
RESEND_API_KEY     = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM        = os.environ.get("RESEND_FROM_EMAIL", "Sivarr <noreply@sivarr.app>")
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
NAIRA_RATE          = int(os.environ.get("NAIRA_RATE", "1650"))  # USD→NGN
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
SIVARR_PLANS = {
    "pro_monthly":  {"name": "Pro",  "label": "Monthly", "amount_ngn": 2500,  "period": "monthly"},
    "pro_yearly":   {"name": "Pro",  "label": "Yearly",  "amount_ngn": 25000, "period": "yearly"},
    "team_monthly": {"name": "Team", "label": "Monthly", "amount_ngn": 8000,  "period": "monthly"},
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
    tmp = str(USERS_PATH) + ".tmp"
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
RATE_LIMIT_CHAT     = int(os.environ.get("RATE_LIMIT_CHAT", 20))      # max chat msgs per window
FREE_DAILY_CHAT     = int(os.environ.get("FREE_DAILY_CHAT", 20))      # free-tier AI messages per day (server-enforced)
AI_DAILY_FREE       = int(os.environ.get("AI_DAILY_FREE", 40))        # free-tier non-chat AI actions per day (study/write/review/etc.)
RATE_LIMIT_QUIZ     = int(os.environ.get("RATE_LIMIT_QUIZ", 5))      # max quiz questions per window
RATE_LIMIT_UPLOAD   = int(os.environ.get("RATE_LIMIT_UPLOAD", 5))     # max uploads per window
RATE_LIMIT_WINDOW   = int(os.environ.get("RATE_LIMIT_WINDOW", 60))    # window in seconds
RATE_LIMIT_LOGIN    = int(os.environ.get("RATE_LIMIT_LOGIN", 10))     # max login attempts per window
RATE_LIMIT_VERIFY   = int(os.environ.get("RATE_LIMIT_VERIFY", 3))      # max verify-email resends per window

# ── Input validation config ───────────────────────────────────
MAX_MESSAGE_LEN  = 2000    # max characters in a chat message
MAX_NAME_LEN     = 80      # max student name length
MAX_MATRIC_LEN   = 30      # max matric number length
MAX_FILE_SIZE    = 5 * 1024 * 1024  # 5MB max file size

GEMINI_MODELS = [
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-pro",
    "gemini-pro",
    "gemini-1.0-pro",
]

MATH_TRIGGERS = [
    "solve", "calculate", "differentiate", "integrate", "expand",
    "factorise", "factorize", "simplify", "equation", "algebra",
    "quadratic", "derivative", "integral", "calculus", "gradient",
    "inequality", "simultaneous", "matrix", "fraction", "percentage",
    "ratio", "proof", "theorem", "logarithm", "log", "sin", "cos",
    "tan", "trigonometry", "polynomial", "find x", "find the value",
    "work out", "volume", "perimeter", "probability", "statistics",
    "mean", "median", "mode",
]

UNCERTAINTY_PHRASES = [
    "i'm not sure", "i am not sure", "i'm not certain", "i cannot verify",
    "i don't know", "i do not know", "may not be accurate", "cannot confirm",
    "you should verify", "double check", "consult a", "limited information",
]

TOPIC_STRIP = ["what is", "define", "explain", "solve", "calculate"]

SYSTEM_PROMPT = f"""You are Sivarr — a brilliant, context-aware AI built into the Sivarr platform.
You are not a generic assistant. You live inside the user's personal workspace and know their tasks, goals, habits, journal, and progress.
Sivarr was founded by a Lead City University student. Mission: student → skilled professional → employed talent → career growth. Version: {VERSION}

Personality:
- Warm, direct, and energetic — like the smartest friend in the room, not a textbook.
- Reference the user's actual data naturally when it's relevant (e.g. "Since you have 3 overdue tasks today...").
- Celebrate wins. Call out patterns. Be proactive, not just reactive.

Rules:
1. Keep answers SHORT — 2 to 4 sentences by default. Expand only when asked.
2. Show step-by-step working ONLY when explicitly requested.
3. Answer ANY question — academics, career, life, creativity, strategy.
4. For math: state the final answer only unless asked for working.
5. If unsure, say so — never confidently guess wrong.
6. Format cleanly — use line breaks for readability when helpful.
7. When user context is provided at the start of a message, use it to personalise your response naturally. Do NOT echo it back verbatim.
8. Address the user by their first name occasionally for warmth.
"""

MATH_PROMPT = """You are Sivarr's math expert.
1. State the final answer clearly and concisely.
2. Do NOT show steps unless asked.
3. One line is enough for simple problems e.g. x = 5.
4. Be casual.
5. If unsure, say so.
"""

QUIZ_PROMPT = """Generate a {difficulty} multiple choice question about: {topic}
Difficulty: easy=basic recall, medium=application, hard=analysis
Reply ONLY with valid JSON:
{{
  "question": "...",
  "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
  "answer": "A",
  "explanation": "One sentence."
}}"""

SUGGESTION_PROMPT = """You are Sivarr study advisor.
Student: {name} | Studied: {topics} | Weakest: {weak} | Quiz: {quiz_summary} | Difficulty: {difficulty}
Recommend exactly 3 specific topics. Numbered list, one sentence each. Be encouraging."""

FILE_SUMMARY_PROMPT = """A student uploaded a document. Here is the extracted text:

{text}

Please:
1. Give a brief summary (3-5 sentences)
2. List 5 key topics or concepts from the document
3. Suggest 3 quiz questions based on the content

Format clearly with headers."""

FILE_QUIZ_PROMPT = """Based on this document content:
{text}

Generate a {difficulty} multiple choice question.
Reply ONLY with valid JSON:
{{
  "question": "...",
  "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
  "answer": "A",
  "explanation": "One sentence."
}}"""

# ═══════════════════════════════════════════════════════════════
#  RATE LIMITER
# ═══════════════════════════════════════════════════════════════

class RateLimiter:
    """
    Persistent rate limiter using sliding window.
    Backed by a JSON file so limits survive server restarts.
    In-memory cache for speed, flushed to disk periodically.
    """
    def __init__(self):
        self._counts   = collections.defaultdict(list)
        self._dirty    = False
        self._path     = None   # set after DATA_DIR is defined
        self._last_save = time.time()
        self._save_interval = 30  # seconds between disk flushes

    def _set_path(self, path: Path):
        self._path = path
        self._load()

    def _load(self):
        """Load persisted rate limit state from disk."""
        if self._path and self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                now  = time.time()
                # Only load recent entries — discard old ones
                self._counts = collections.defaultdict(list, {
                    k: [t for t in v if now - t < RATE_LIMIT_WINDOW * 2]
                    for k, v in data.items()
                })
            except Exception:
                self._counts = collections.defaultdict(list)

    def _save(self):
        """Flush rate limit state to disk."""
        if self._path and self._dirty:
            try:
                tmp = str(self._path) + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(dict(self._counts), f)
                shutil.move(tmp, str(self._path))
                self._dirty = False
                self._last_save = time.time()
            except Exception:
                pass

    def is_allowed(self, key: str, limit: int, window: int = RATE_LIMIT_WINDOW) -> bool:
        now   = time.time()
        calls = self._counts[key]
        self._counts[key] = [t for t in calls if now - t < window]
        if len(self._counts[key]) >= limit:
            return False
        self._counts[key].append(now)
        self._dirty = True
        # Periodic save
        if now - self._last_save > self._save_interval:
            self._save()
        return True

    def remaining(self, key: str, limit: int, window: int = RATE_LIMIT_WINDOW) -> int:
        now = time.time()
        self._counts[key] = [t for t in self._counts[key] if now - t < window]
        return max(0, limit - len(self._counts[key]))


limiter = RateLimiter()


def get_client_key(request: Request, sid: str = "") -> str:
    """Get a unique key for rate limiting — prefer student ID, fall back to IP."""
    if sid:
        return f"student_{sid}"
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else request.client.host
    return f"ip_{ip}"


def check_rate_limit(key: str, limit: int, endpoint: str) -> None:
    """Raise 429 if rate limit exceeded. Uses PostgreSQL when available (multi-worker safe)."""
    full_key = f"{endpoint}_{key}"
    if db.is_available():
        allowed = db.db_check_rate_limit(full_key, limit, RATE_LIMIT_WINDOW)
    else:
        allowed = limiter.is_allowed(full_key, limit)
    if not allowed:
        log.warning(f"Rate limit exceeded | key={key} | endpoint={endpoint}")
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Please wait {RATE_LIMIT_WINDOW} seconds before trying again.",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )

# ═══════════════════════════════════════════════════════════════
#  INPUT VALIDATION
# ═══════════════════════════════════════════════════════════════

def sanitize_text(text: str, max_len: int = MAX_MESSAGE_LEN) -> str:
    """
    Clean and validate text input.
    - Strips whitespace
    - Removes null bytes and control characters
    - Enforces max length

    NOTE: this does NOT strip path-traversal sequences (../, /, \\). For any
    value interpolated into a filesystem path (e.g. sid), use validate_sid().
    """
    if not text:
        return ""
    # Remove null bytes and non-printable control chars (keep newlines/tabs)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = text.strip()
    if len(text) > max_len:
        text = text[:max_len]
        log.info(f"Input truncated to {max_len} chars")
    return text


def validate_sid(sid: str) -> str:
    """
    Validate and sanitize student session ID.
    - Must be alphanumeric + underscores only
    - Max 100 chars
    - Prevents path traversal (no dots, slashes)
    """
    sid = sanitize_text(sid, 100)
    # Remove any path traversal characters
    sid = re.sub(r"[^a-z0-9_]", "_", sid.lower())
    if not sid or len(sid) < 3:
        raise HTTPException(400, "Invalid session ID.")
    # Block traversal patterns
    if ".." in sid or "/" in sid or "\\" in sid:
        raise HTTPException(400, "Invalid session ID.")
    return sid


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
API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

# ═══════════════════════════════════════════════════════════════
#  GEMINI
# ═══════════════════════════════════════════════════════════════

_model_name = None
_chat_sessions: dict = {}          # sid → {chat, math, last_used}
_session_tokens:    dict = {}   # token → {sid, name, email, expires}
# Admin/lecturer sessions are now stateless HMAC tokens — no in-memory dicts needed
_failed_logins:     dict = {}   # email → {count, locked_until}

LOGIN_LOCK_ATTEMPTS = 10
LOGIN_LOCK_MINUTES  = 15


def _check_account_lockout(email: str) -> None:
    """Raise 429 if the account is currently locked out."""
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
    rec = _failed_logins.setdefault(email, {"count": 0, "locked_until": None})
    rec["count"] += 1
    if rec["count"] >= LOGIN_LOCK_ATTEMPTS:
        rec["locked_until"] = datetime.datetime.utcnow() + datetime.timedelta(minutes=LOGIN_LOCK_MINUTES)
        log.warning(f"Account locked after {LOGIN_LOCK_ATTEMPTS} failed attempts: {email}")


def _clear_failed_login(email: str) -> None:
    _failed_logins.pop(email, None)

SESSION_TTL_DAYS  = 30             # auth token lifetime
CHAT_SESSION_TTL  = 4 * 3600      # evict idle AI sessions after 4 hours
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
    expected = _hmac_sign(f"admin:{ts}", ADMIN_PASSWORD or "unset")
    return hmac.compare_digest(sig, expected)


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
    expected = _hmac_sign(f"lec:{ts}", LECTURER_PASSWORD or "unset")
    return hmac.compare_digest(sig, expected)


def _evict_stale_chat_sessions():
    cutoff = time.time() - CHAT_SESSION_TTL
    stale  = [k for k, v in _chat_sessions.items() if v.get("last_used", 0) < cutoff]
    for k in stale:
        del _chat_sessions[k]
    if stale:
        log.info(f"Evicted {len(stale)} stale AI chat sessions")


# ── Token-based session management ────────────────────────────────

def create_session_token(sid: str, name: str, email: str) -> str:
    token   = secrets.token_urlsafe(32)
    expires = datetime.datetime.utcnow() + datetime.timedelta(days=SESSION_TTL_DAYS)
    _session_tokens[token] = {"sid": sid, "name": name, "email": email, "expires": expires}
    if db.is_available():
        db.create_db_session(token, sid, name, email, expires)
    return token


def create_session_token_for_existing(token: str, sid: str, name: str, email: str) -> None:
    """Register an already-issued token on this worker (cross-worker session recovery)."""
    expires = datetime.datetime.utcnow() + datetime.timedelta(days=SESSION_TTL_DAYS)
    _session_tokens[token] = {"sid": sid, "name": name, "email": email, "expires": expires}
    if db.is_available():
        db.create_db_session(token, sid, name, email, expires)


def get_session_from_token(token: str) -> dict | None:
    if not token:
        return None
    # Check in-memory first
    entry = _session_tokens.get(token)
    if entry:
        if datetime.datetime.utcnow() < entry["expires"]:
            return entry
        del _session_tokens[token]
        return None
    # Fallback: check DB and warm this worker's cache for subsequent requests
    if db.is_available():
        db_entry = db.get_db_session(token)
        if not db_entry:
            return None
        # Normalise the DB row to the in-memory shape before caching. get_db_session
        # returns a tz-aware "expires_at" (TIMESTAMPTZ); the in-memory cache + the
        # stale-eviction sweep expect a naive-UTC "expires". Caching the raw DB shape
        # makes the next lookup KeyError on entry["expires"] and the eviction sweep
        # treat the entry as already-expired (v.get("expires", now) <= now) — both of
        # which silently log the user out on reload. Map the key and drop the tzinfo.
        exp = db_entry.get("expires_at")
        if exp is not None and exp.tzinfo is not None:
            exp = exp.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        entry = {
            "sid":     db_entry["sid"],
            "name":    db_entry["name"],
            "email":   db_entry["email"],
            "expires": exp,
        }
        _session_tokens[token] = entry
        return entry
    return None


def delete_session_token(token: str) -> None:
    _session_tokens.pop(token, None)
    if db.is_available():
        db.delete_db_session(token)


def send_email(to: str, subject: str, html_body: str) -> tuple[bool, str]:
    """Send a transactional email. Uses Gmail SMTP if configured, falls back to Resend."""
    # ── Gmail SMTP (primary — no domain registration needed) ──────────────
    if GMAIL_USER and GMAIL_APP_PASSWORD:
        return _send_email_gmail(to, subject, html_body)
    # ── Resend (fallback — requires verified sender domain) ───────────────
    if not RESEND_AVAILABLE:
        msg = "No email provider configured (set GMAIL_USER + GMAIL_APP_PASSWORD)"
        log.warning(f"Email skipped: '{subject}' → {to} | {msg}")
        return False, msg
    if not RESEND_API_KEY:
        msg = "No email provider configured (set GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY)"
        log.warning(f"Email skipped: '{subject}' → {to} | {msg}")
        return False, msg
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
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Reset your password</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    Someone requested a password reset for your Sivarr account.<br>
    Click below to set a new password. This link expires in <strong>1 hour</strong>.
  </p>
  <a href="{reset_url}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Reset Password →
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
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Welcome, {name} 👋</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    Verify your email address to complete your Sivarr account setup.<br>
    This link expires in <strong>24 hours</strong>.
  </p>
  <a href="{verify_url}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Verify Email →
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
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">You're invited to join <strong>{org_name}</strong></h2>
  <p style="color:#555;line-height:1.6;margin:0 0 8px">
    <strong>{inviter_name}</strong> has invited you to join their organization on Sivarr as a <strong>{role}</strong>.
  </p>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    Sivarr is an all-in-one OS for work — tasks, projects, docs, AI, and team chat in one place.
    This invite expires in <strong>7 days</strong>.
  </p>
  <a href="{join_url}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
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
    url = "https://sivarr-repository-production.up.railway.app/"
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
          <span style="font-size:1.4rem;font-weight:900;color:#0D7A5F;letter-spacing:-.04em">Sivarr</span>
        </td></tr>

        <!-- Greeting -->
        <tr><td style="font-size:1rem;color:#1a1a1a;padding-bottom:16px;line-height:1.6">
          Hello {first},
        </td></tr>

        <!-- Opening line -->
        <tr><td style="font-size:1rem;color:#1a1a1a;padding-bottom:28px;line-height:1.6">
          You now have access to your Sivarr workspace.
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
          Once you do, you will find that you can;
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
          And what&rsquo;s more?
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
          Here&rsquo;s your access link again;
        </td></tr>

        <!-- CTA Button 2 -->
        <tr><td style="padding-bottom:28px">
          <a href="{url}" style="display:inline-block;color:#C0392B;font-weight:800;font-size:.95rem;text-decoration:none;letter-spacing:.04em">
            OPEN MY Sivarr WORKSPACE
          </a>
        </td></tr>

        <!-- Closing -->
        <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:20px;line-height:1.6">
          We can&rsquo;t wait to see what you do with Sivarr !
        </td></tr>
        <tr><td style="font-size:.92rem;color:#555;font-style:italic;padding-bottom:28px;line-height:1.8">
          See you Inside,<br>Sivarr Team
        </td></tr>

        <tr><td style="font-size:.88rem;color:#1a1a1a;padding-bottom:32px;line-height:1.6">
          PS; If you run into any issue, simply reply to this email and our team will help you out.
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
        colour = "#0D7A5F" if t.get("date") == today else "#E8614A"
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
            f'<span style="color:#534AB7;font-size:.78rem;margin-left:6px">'
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
    <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#0D7A5F,#534AB7);
                display:inline-flex;align-items:center;justify-content:center">
      <span style="color:#fff;font-weight:900;font-size:.75rem">S</span>
    </div>
    <span style="font-size:1.1rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
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
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
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
        f'<span style="color:#888;font-size:.8rem"> — due {t.get("due","today")}</span></li>'
        for t in tasks[:5]
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Tasks due soon, {name}</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 16px">
    You have <strong>{len(tasks)}</strong> task(s) due today or tomorrow:
  </p>
  <ul style="padding-left:20px;margin:0 0 28px;line-height:1.8">{rows}</ul>
  <a href="{BASE_URL}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Open Tasks
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_billing_receipt_html(name: str, plan: str, amount: str, ref: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Payment confirmed</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 8px">Hi {name}, your payment was successful.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0 28px">
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Plan</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600">{plan}</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Amount</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600">{amount}</td></tr>
    <tr><td style="padding:10px 0;color:#888">Reference</td>
        <td style="padding:10px 0;font-size:.78rem;color:#555">{ref}</td></tr>
  </table>
  <a href="{BASE_URL}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Open Sivarr
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_org_mention_html(recipient_name: str, sender_name: str, org_name: str,
                            channel: str, preview: str) -> str:
    first = recipient_name.split()[0] if recipient_name else recipient_name
    safe_preview = preview[:300].replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:24px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 6px;font-size:1.3rem;font-weight:800">You were mentioned, {first}</h2>
  <p style="color:#666;font-size:.9rem;margin:0 0 20px">
    <strong>{sender_name}</strong> mentioned you in <strong>#{channel}</strong> · {org_name}
  </p>
  <div style="background:#f6f6f6;border-left:3px solid #0D7A5F;border-radius:4px;
              padding:14px 16px;margin-bottom:28px;font-size:.95rem;line-height:1.6;color:#333">
    {safe_preview}
  </div>
  <a href="{BASE_URL}/app"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:12px 28px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.92rem">
    View in Sivarr →
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.7rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_org_announcement_html(recipient_name: str, org_name: str,
                                  author_name: str, title: str, body: str) -> str:
    first = recipient_name.split()[0] if recipient_name else recipient_name
    safe_body = body[:1000].replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:24px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <div style="font-size:.75rem;font-weight:700;color:#534AB7;text-transform:uppercase;
              letter-spacing:.06em;margin-bottom:8px">📢 Announcement · {org_name}</div>
  <h2 style="margin:0 0 6px;font-size:1.3rem;font-weight:800">{title}</h2>
  <p style="color:#888;font-size:.82rem;margin:0 0 20px">Posted by {author_name}</p>
  {"<div style='background:#f6f6f6;border-radius:8px;padding:16px;margin-bottom:28px;font-size:.95rem;line-height:1.7;color:#333'>" + safe_body + "</div>" if body else ""}
  <p style="color:#555;font-size:.9rem;line-height:1.6;margin:0 0 24px">
    Hi {first}, there's a new announcement waiting for you in your workspace.
  </p>
  <a href="{BASE_URL}/app"
     style="display:inline-block;background:#534AB7;color:#fff;padding:12px 28px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.92rem">
    View Announcement →
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.7rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
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
        f'<span style="color:#0D7A5F;font-weight:700">{g.get("progress",0)}%</span></td>'
        f'</tr>'
        for g in goals[:5]
    ) if goals else '<tr><td colspan="2" style="padding:8px 0;color:#aaa;font-size:.85rem">No active goals this week.</td></tr>'

    contrib_rows = "".join(
        f'<li style="margin-bottom:6px;font-size:.88rem;color:#333">'
        f'<strong>{c["name"]}</strong> — {c["done"]} task{"s" if c["done"]!=1 else ""} completed</li>'
        for c in top_contributors[:5]
    ) if top_contributors else '<li style="color:#aaa;font-size:.85rem">No activity data yet.</li>'

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:24px;display:flex;align-items:center;gap:10px">
    <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#0D7A5F,#534AB7);
                display:inline-flex;align-items:center;justify-content:center">
      <span style="color:#fff;font-weight:900;font-size:.75rem">S</span>
    </div>
    <span style="font-size:1.1rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <div style="font-size:.75rem;font-weight:700;color:#0D7A5F;text-transform:uppercase;
              letter-spacing:.06em;margin-bottom:8px">Weekly Progress Report · {org_name}</div>
  <h2 style="margin:0 0 4px;font-size:1.35rem;font-weight:800">Here's how the team did, {first} 📊</h2>
  <p style="color:#888;font-size:.82rem;margin:0 0 28px">{period}</p>

  <!-- Task completion -->
  <h3 style="font-size:.88rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
             color:#888;margin:0 0 10px">Task Completion</h3>
  <div style="background:#f0f0f0;border-radius:6px;height:10px;overflow:hidden;margin-bottom:8px">
    <div style="width:{bar_w}%;height:100%;background:linear-gradient(90deg,#0D7A5F,#534AB7);border-radius:6px"></div>
  </div>
  <p style="font-size:.88rem;color:#555;margin:0 0 28px">
    <strong>{tasks_done}</strong> of <strong>{tasks_total}</strong> tasks completed this week
    <span style="color:#0D7A5F;font-weight:700;margin-left:6px">({completion_pct}%)</span>
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
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
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

def get_model():
    global _model_name
    if _model_name:
        return _model_name
    if not API_KEY or not GEMINI_AVAILABLE:
        return GEMINI_MODELS[0]
    genai.configure(api_key=API_KEY)
    try:
        available = [
            m.name.replace("models/", "") for m in genai.list_models()
            if "generateContent" in m.supported_generation_methods
        ]
        for m in GEMINI_MODELS:
            if m in available:
                _model_name = m
                log.info(f"Gemini model selected: {m}")
                return m
        _model_name = available[0] if available else GEMINI_MODELS[0]
    except Exception as e:
        log.error(f"Gemini model selection failed: {e}")
        _model_name = GEMINI_MODELS[0]
    return _model_name


def get_sessions(sid, memory=""):
    if len(_chat_sessions) > 500:
        _evict_stale_chat_sessions()
    if sid not in _chat_sessions:
        model  = get_model()
        system = SYSTEM_PROMPT + (f"\n\n{memory}" if memory else "")
        def mk(sys):
            m = genai.GenerativeModel(
                model_name=model,
                system_instruction=sys,
                generation_config=genai.GenerationConfig(temperature=0.7, max_output_tokens=400),
            )
            return m.start_chat(history=[])
        _chat_sessions[sid] = {"chat": mk(system), "math": mk(MATH_PROMPT), "last_used": time.time()}
        log.info(f"New chat session created for: {sid}")
    else:
        _chat_sessions[sid]["last_used"] = time.time()
    return _chat_sessions[sid]


def friendly_gemini_error(e):
    """Convert raw Gemini exceptions into short readable messages."""
    msg = str(e).lower()
    if "quota" in msg or "429" in msg or "resource_exhausted" in msg:
        return "Sivarr is taking a short break — free tier quota reached. Please wait a minute and try again! ⏳"
    if "api key" in msg or "invalid" in msg or "401" in msg or "403" in msg:
        return "API key issue — please contact support."
    if "network" in msg or "connection" in msg or "timeout" in msg or "unavailable" in msg:
        return "Connection issue — check your internet and try again."
    if "404" in msg or "not found" in msg:
        return "AI model unavailable — try again in a moment."
    return "Something went wrong — please try again shortly."

_AI_ERROR_PREFIXES = (
    "Sivarr is taking a short break",
    "API key issue",
    "Connection issue",
    "AI model unavailable",
    "Something went wrong",
)

def _is_ai_error(text: str) -> bool:
    return any(text.startswith(p) for p in _AI_ERROR_PREFIXES)


def gemini_ask(session, question):
    try:
        return session.send_message(question).text.strip()
    except Exception as e:
        log.error(f"Gemini ask error: {e}")
        return friendly_gemini_error(e)


def gemini_once(prompt, temp=0.8, tokens=600):
    try:
        model = genai.GenerativeModel(
            model_name=get_model(),
            generation_config=genai.GenerationConfig(temperature=temp, max_output_tokens=tokens),
        )
        return model.generate_content(prompt).text.strip()
    except Exception as e:
        log.error(f"Gemini once error: {e}")
        return None


# ── AI circuit breaker ────────────────────────────────────────────────────────
# Per-worker breaker: after repeated Gemini failures (outage / quota wall), stop
# hammering the API for a short cooldown so failing calls don't tie up worker
# threads and cascade into slow requests for everyone. In-memory per worker is
# fine — each worker protects its own thread pool. All AI flows through the two
# wrappers below, so this covers every endpoint at once.
_AI_BREAKER = {"fails": 0, "open_until": 0.0}
_AI_BREAK_THRESHOLD = int(os.environ.get("AI_BREAK_THRESHOLD", 8))   # consecutive fails to trip
_AI_BREAK_COOLDOWN  = int(os.environ.get("AI_BREAK_COOLDOWN", 30))   # seconds to stay open


def _ai_breaker_open() -> bool:
    return time.time() < _AI_BREAKER["open_until"]


def _ai_breaker_record(ok: bool) -> None:
    if ok:
        _AI_BREAKER["fails"] = 0
        return
    _AI_BREAKER["fails"] += 1
    if _AI_BREAKER["fails"] >= _AI_BREAK_THRESHOLD:
        _AI_BREAKER["open_until"] = time.time() + _AI_BREAK_COOLDOWN
        _AI_BREAKER["fails"] = 0
        log.error(f"AI circuit breaker OPEN for {_AI_BREAK_COOLDOWN}s after repeated Gemini failures")


async def async_gemini_once(prompt, temp=0.8, tokens=600):
    """Non-blocking wrapper — runs gemini_once in a thread so the event loop stays free."""
    if _ai_breaker_open():
        return None
    result = await asyncio.to_thread(gemini_once, prompt, temp, tokens)
    _ai_breaker_record(result is not None)
    return result


async def async_gemini_ask(session, question):
    """Non-blocking wrapper — runs gemini_ask in a thread so the event loop stays free."""
    if _ai_breaker_open():
        return friendly_gemini_error(Exception("AI temporarily unavailable — please retry shortly."))
    answer = await asyncio.to_thread(gemini_ask, session, question)
    _ai_breaker_record(not _is_ai_error(answer))
    return answer

# ═══════════════════════════════════════════════════════════════
#  MATH
# ═══════════════════════════════════════════════════════════════

def _safe_eval_node(node):
    """Recursive arithmetic evaluator — no eval() call, only safe AST nodes."""
    if isinstance(node, ast.Expression):
        return _safe_eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        v = _safe_eval_node(node.operand)
        return -v if isinstance(node.op, ast.USub) else v
    if isinstance(node, ast.BinOp):
        left  = _safe_eval_node(node.left)
        right = _safe_eval_node(node.right)
        if isinstance(node.op, ast.Add):  return left + right
        if isinstance(node.op, ast.Sub):  return left - right
        if isinstance(node.op, ast.Mult): return left * right
        if isinstance(node.op, ast.Div):
            if right == 0: raise ZeroDivisionError
            return left / right
        if isinstance(node.op, ast.Pow):
            if abs(right) > 100: raise ValueError("exponent too large")
            return left ** right
    raise ValueError(f"unsafe node: {type(node).__name__}")


def solve_local(text):
    if not re.fullmatch(r"[\d+\-*/().^ \s]+", text.strip()):
        return None
    for c in [text] + re.findall(r"[\d+\-*/().^ ]+", text):
        try:
            tree = ast.parse(c.strip(), mode="eval")
            r = _safe_eval_node(tree)
            display = int(r) if isinstance(r, float) and r.is_integer() else round(r, 6)
            return f"Result = {display}"
        except Exception:
            continue
    return None


def is_math(text):
    return any(t in text.lower() for t in MATH_TRIGGERS)


def is_uncertain(text):
    return any(p in text.lower() for p in UNCERTAINTY_PHRASES)

# ═══════════════════════════════════════════════════════════════
#  DATA HELPERS
# ═══════════════════════════════════════════════════════════════

def ppath(sid):  return DATA_DIR / f"{sid}_progress.json"
def lpath():     return DATA_DIR / "library.json"
def bpath():     return DATA_DIR / "bank.json"


def load_json(p):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def save_json(p, data):
    tmp = str(p) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    shutil.move(tmp, str(p))


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


def get_cached(lib, topic):
    e = lib.get(topic)
    if not e:
        return None
    if isinstance(e, str):
        return e
    age = (datetime.date.today() - datetime.date.fromisoformat(e.get("date","2000-01-01"))).days
    return e["answer"] if age <= CACHE_EXPIRY else None


def set_cached(lib, topic, ans):
    lib[topic] = {"answer": ans, "date": datetime.date.today().isoformat()}


def strip_topic(q):
    for w in TOPIC_STRIP:
        q = q.lower().replace(w, "")
    return q.strip()


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

def parse_quiz_json(raw: str, topic: str) -> dict:
    """
    Robustly parse a quiz question from Gemini output.
    Handles markdown fences, extra text, partial JSON, and
    common formatting issues Gemini produces.
    """
    if not raw:
        return None
    try:
        # Step 1 — strip markdown code fences
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()

        # Step 2 — extract just the JSON object if there's extra text around it
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            raw = match.group(0)

        # Step 3 — parse
        q = json.loads(raw)

        # Step 4 — validate required fields
        required = ["question", "options", "answer", "explanation"]
        if not all(k in q for k in required):
            log.warning(f"Quiz JSON missing fields: {list(q.keys())}")
            return None

        # Step 5 — validate options has A B C D
        opts = q.get("options", {})
        if not all(k in opts for k in ["A", "B", "C", "D"]):
            log.warning(f"Quiz options incomplete: {list(opts.keys())}")
            return None

        # Step 6 — normalize answer to uppercase single letter
        q["answer"] = str(q["answer"]).strip().upper()[:1]
        if q["answer"] not in ["A", "B", "C", "D"]:
            q["answer"] = "A"

        q["topic"] = topic
        return q

    except json.JSONDecodeError as e:
        log.error(f"Quiz JSON parse error: {e} | raw: {raw[:200]}")
        return None
    except Exception as e:
        log.error(f"Quiz parse unexpected error: {e}")
        return None


# ═══════════════════════════════════════════════════════════════
#  FASTAPI APP
# ═══════════════════════════════════════════════════════════════

app = FastAPI(title="Sivarr AI", version=VERSION)
_START_TIME    = time.time()
_health_cache: dict = {"result": None, "ts": 0.0}
_db_health_cache: dict = {"info": None, "ts": 0.0}


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
        release=VERSION,
        environment=os.environ.get("RAILWAY_ENVIRONMENT", "production"),
    )
    log.info("Sentry initialized")

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/css",    StaticFiles(directory="css"),    name="css")
app.mount("/js",     StaticFiles(directory="js"),     name="js")

_cors_origins = list({o.strip() for o in [
    BASE_URL.rstrip('/'),
    "https://sivarr.up.railway.app",
    "https://sivarr.app",
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
class _StaticCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith(("/css/", "/js/", "/static/")):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

app.add_middleware(_StaticCacheMiddleware)

# Security headers on every response
class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    _CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://plausible.io https://cdn.jsdelivr.net "
        "  https://js.sentry-cdn.com https://browser.sentry-cdn.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; "
        "img-src 'self' data: blob: https:; "
        "media-src 'self' blob:; "
        "connect-src 'self' https://plausible.io https://o*.ingest.sentry.io "
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

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        h = response.headers
        framable = request.url.path.startswith("/static/templates/")
        h["X-Frame-Options"]           = "SAMEORIGIN" if framable else "DENY"
        h["X-Content-Type-Options"]    = "nosniff"
        h["Referrer-Policy"]           = "strict-origin-when-cross-origin"
        h["Permissions-Policy"]        = "camera=(), microphone=(), geolocation=()"
        h["Content-Security-Policy"]   = self._CSP_FRAME_SELF if framable else self._CSP
        # Only send HSTS over HTTPS (Railway always proxies via HTTPS)
        if request.headers.get("x-forwarded-proto") == "https":
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(_SecurityHeadersMiddleware)

# ── Per-worker in-memory response cache with TTL ─────────────────
_rcache: dict[str, tuple] = {}  # key → (payload, expires_at)

def _rc_get(key: str):
    entry = _rcache.get(key)
    if entry and time.time() < entry[1]:
        return entry[0]
    _rcache.pop(key, None)
    return None

def _rc_set(key: str, value, ttl: int = 60) -> None:
    _rcache[key] = (value, time.time() + ttl)

def _rc_bust(prefix: str) -> None:
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

        # Seed community/opportunities JSON files
        try:
            _seed_community_and_opps()
        except Exception as exc:
            log.warning(f"Seed community/opps skipped: {exc}")

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
     "content": "For anyone building in public from Lagos — the Opportunities board just dropped new remote roles from EU companies open to Nigerian applicants. Go check it. 🇳🇬"},
    {"id": "seed_n03", "author": "Tunde Fashola", "category": "general", "likes": 42, "tags": ["productivity", "africa"],
     "content": "Hot take: the problem with Nigerian productivity isn't motivation, it's systems. Most of us never had access to proper tools that fit our context. Sivarr is the first thing that feels like it was built for us."},
    {"id": "seed_n04", "author": "Ngozi Adeyemi", "category": "qa", "likes": 9, "tags": ["spaces", "workflow"],
     "content": "Question for the community — how are you all using the Spaces feature? I've set up a Personal space for my freelance work and an Org space for my agency. What's your setup?"},
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
    {"id": "opp_1", "title": "Frontend Developer — Remote", "description": "Build interfaces for a Lagos-based fintech. 2+ years React required.", "category": "job", "organisation": "PaystackHQ", "location": "Remote / Lagos", "deadline": "", "url": "#"},
    {"id": "opp_2", "title": "Google Africa Developer Scholarship", "description": "Scholarship for African developers to upskill in cloud and mobile development.", "category": "scholarship", "organisation": "Google", "location": "Africa-wide", "deadline": "", "url": "#"},
    {"id": "opp_3", "title": "Tony Elumelu Foundation Grant", "description": "₦5M grant for early-stage African entrepreneurs. Applications open now.", "category": "grant", "organisation": "TEF", "location": "Africa-wide", "deadline": "", "url": "#"},
    {"id": "opp_4", "title": "UI/UX Design Internship", "description": "3-month paid internship at a product studio in Yaba, Lagos. Stipend provided.", "category": "internship", "organisation": "Studio Yaba", "location": "Lagos, Nigeria", "deadline": "", "url": "#"},
    {"id": "opp_5", "title": "Binance Africa Web3 Hackathon", "description": "Build on-chain tools for African markets. Prizes up to $50,000.", "category": "grant", "organisation": "Binance", "location": "Remote", "deadline": "", "url": "#"},
    # ── Sprint C: Nigerian-context listings. Pay is folded into the description
    # because the opportunities schema has no salary column. ──
    {"id": "opp_001", "title": "Senior Backend Engineer (Remote)", "category": "job", "organisation": "Andela", "location": "Remote — Open to Nigeria", "deadline": "2026-07-15", "url": "#",
     "description": "Build scalable microservices for global tech clients. Python/Go experience required. Pay: ₦800,000 – ₦1,200,000/month."},
    {"id": "opp_002", "title": "ALX Africa Tech Scholarship 2026", "category": "scholarship", "organisation": "ALX Africa", "location": "Online", "deadline": "2026-07-01", "url": "#",
     "description": "12-month software engineering program. No prior experience required. Nigerian applicants encouraged. Full scholarship — ₦0 tuition."},
    {"id": "opp_003", "title": "Product Design Intern", "category": "internship", "organisation": "Flutterwave", "location": "Lagos, Nigeria (Hybrid)", "deadline": "2026-06-30", "url": "#",
     "description": "6-month internship with Nigeria's leading fintech. Figma skills required. Stipend: ₦150,000/month."},
    {"id": "opp_004", "title": "Data Analyst — Growth Team", "category": "job", "organisation": "Paystack", "location": "Lagos, Nigeria", "deadline": "2026-07-20", "url": "#",
     "description": "Drive growth insights using SQL and Python. Help scale Africa's leading payment stack. Pay: ₦500,000 – ₦700,000/month."},
    {"id": "opp_005", "title": "Google Africa Developer Scholarship", "category": "scholarship", "organisation": "Google / Pluralsight", "location": "Online", "deadline": "2026-08-01", "url": "#",
     "description": "Mobile Web Specialist or Android Developer tracks. Open to all Nigerians 18+. Full scholarship."},
    {"id": "opp_006", "title": "Technical Content Writer (Remote)", "category": "job", "organisation": "Hashnode", "location": "Remote — Global", "deadline": "Rolling", "url": "#",
     "description": "Write in-depth technical tutorials on web development, AI, or DevOps. Nigerian writers welcome. Pay: $500 – $800/article."},
    {"id": "opp_007", "title": "Business Development Intern", "category": "internship", "organisation": "Cowrywise", "location": "Lagos, Nigeria", "deadline": "2026-07-10", "url": "#",
     "description": "Support the BD team in growing Cowrywise's B2B partnerships across Nigeria. Stipend: ₦120,000/month."},
    {"id": "opp_008", "title": "Tony Elumelu Foundation Entrepreneurship Programme", "category": "grant", "organisation": "TEF", "location": "Pan-Africa", "deadline": "2026-09-01", "url": "#",
     "description": "Annual programme for African entrepreneurs. Includes seed capital, mentorship, and training. $5,000 seed funding + mentorship."},
    {"id": "opp_009", "title": "DevOps / Cloud Engineer", "category": "job", "organisation": "Kuda Bank", "location": "Lagos, Nigeria (Hybrid)", "deadline": "2026-07-25", "url": "#",
     "description": "AWS-focused DevOps role at Nigeria's leading digital bank. Kubernetes and Terraform preferred. Pay: ₦600,000 – ₦900,000/month."},
    {"id": "opp_010", "title": "Software Engineering Intern — Mobile", "category": "internship", "organisation": "Interswitch", "location": "Lagos, Nigeria", "deadline": "2026-07-05", "url": "#",
     "description": "Work on mobile banking SDKs used by millions of Nigerians. React Native or Flutter a plus. Stipend: ₦100,000/month."},
    {"id": "opp_011", "title": "UI/UX Designer — Consumer Products", "category": "job", "organisation": "OPay", "location": "Lagos, Nigeria", "deadline": "2026-08-15", "url": "#",
     "description": "Design digital financial products for 30M+ Nigerian users. Portfolio required. Pay: ₦450,000 – ₦650,000/month."},
    {"id": "opp_012", "title": "Access Bank Women in Tech Scholarship", "category": "scholarship", "organisation": "Access Bank + CcHUB", "location": "Lagos + Online", "deadline": "2026-07-31", "url": "#",
     "description": "12-week intensive training for women in software development. No prior coding experience required. Full funding + ₦50,000/month stipend."},
    {"id": "opp_013", "title": "AI / ML Engineer (Remote-first)", "category": "job", "organisation": "Recursion (African Hub)", "location": "Remote — Nigeria preferred", "deadline": "2026-08-01", "url": "#",
     "description": "Work on drug-discovery ML models. Python, PyTorch, and bioinformatics background useful. Pay: $2,000 – $3,500/month."},
    {"id": "opp_014", "title": "Marketing & Growth Intern", "category": "internship", "organisation": "Piggyvest", "location": "Lagos, Nigeria", "deadline": "2026-06-28", "url": "#",
     "description": "Support growth and brand marketing at Nigeria's #1 personal finance app. Ideal for marketing students. Stipend: ₦90,000/month."},
    {"id": "opp_015", "title": "MTN Nigeria Digital Skills Fund", "category": "scholarship", "organisation": "MTN Foundation", "location": "Online", "deadline": "Rolling", "url": "#",
     "description": "Data science, cybersecurity, and cloud computing tracks. Available to 18–35 year olds across Nigeria. Full scholarship — ₦0 cost."},
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
                                title="Sivarr — Streak at risk",
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

    # ── Register jobs and start — wrapped so a failure never crashes the app ──
    try:
        import datetime as _tz_dt
        scheduler = AsyncIOScheduler(timezone=_tz_dt.timezone.utc)
        scheduler.add_job(_auto_weekly_reviews, CronTrigger(day_of_week="mon", hour=6, minute=0))
        scheduler.add_job(_streak_reminders,    CronTrigger(hour=19, minute=0))
        scheduler.add_job(_task_due_alerts,     IntervalTrigger(minutes=15))
        scheduler.start()
        log.info("APScheduler started — weekly review (Mon 06:00 UTC) + push jobs registered")
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
        content={"detail": "Invalid request data — check your input and try again."}
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
    def email_valid(cls, v):
        v = sanitize_text(v, 200).lower().strip()
        if not v:
            raise ValueError("Email is required.")
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Enter a valid email address.")
        return v


class ChatRequest(BaseModel):
    sid: str
    message: str
    context: str = ""
    token: str = ""

    @validator("message")
    def msg_valid(cls, v):
        v = sanitize_text(v, MAX_MESSAGE_LEN)
        if not v:
            raise ValueError("Message cannot be empty.")
        return v

    @validator("sid")
    def sid_valid(cls, v):
        v = sanitize_text(v, 100)
        if not v:
            raise ValueError("Session ID required.")
        return v


class QuizRequest(BaseModel):
    sid: str = ""
    token: str = ""
    topic: str
    difficulty: str
    answer: str
    question: str
    correct: str
    explanation: str

    @validator("difficulty")
    def diff_valid(cls, v):
        if v not in ["easy", "medium", "hard"]:
            raise ValueError("Invalid difficulty.")
        return v

    @validator("answer", "correct")
    def answer_valid(cls, v):
        v = v.strip().upper()
        if v not in ["A", "B", "C", "D"]:
            raise ValueError("Answer must be A, B, C, or D.")
        return v


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
    """Public landing page — served to everyone at the root URL."""
    if Path("templates/landing.html").exists():
        return Path("templates/landing.html").read_text(encoding="utf-8")
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
    """Inject runtime config and return the main SPA HTML."""
    html = Path("templates/index.html").read_text(encoding="utf-8")
    config = json.dumps({
        "sentry_dsn":       SENTRY_DSN,
        "paystack_pk":      PAYSTACK_PUBLIC_KEY,
        "version":          VERSION,
        "environment":      os.environ.get("RAILWAY_ENVIRONMENT", "production"),
        "plausible_domain": PLAUSIBLE_DOMAIN,
    })
    inject = f'<script>window.SIVARR_CONFIG={config};</script>'
    html = html.replace('<meta charset="UTF-8">', f'<meta charset="UTF-8">\n{inject}', 1)
    return HTMLResponse(html)


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
    return Response(
        content=Path("js/sw.js").read_text(encoding="utf-8"),
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


@app.post("/api/login")
async def login(req: LoginRequest, request: Request, bg: BackgroundTasks):
    key = get_client_key(request)
    check_rate_limit(key, RATE_LIMIT_LOGIN, "login")

    email = req.email  # already normalised by validator
    _check_account_lockout(email)   # raise 429 early if account is locked
    users = load_users()

    # ── REGISTER ──────────────────────────────────────────────
    if req.action == "register":
        # Validate name
        name = sanitize_text(req.name.strip(), MAX_NAME_LEN)
        if not name or len(name) < 2:
            raise HTTPException(400, "Full name is required.")
        if not re.match(r"^[a-zA-Z\s\-'.]+$", name):
            raise HTTPException(400, "Name contains invalid characters.")

        # Validate password
        if not req.password or len(req.password) < 8:
            raise HTTPException(400, "Password must be at least 8 characters.")
        if req.confirm_password and req.confirm_password != req.password:
            raise HTTPException(400, "Passwords do not match.")

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
            "phone":    sanitize_text(req.phone, 30),
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
        bg.add_task(send_email, email,
                    "Welcome to Sivarr AI",
                    _email_welcome_html(user['name']))

    # ── LOGIN ──────────────────────────────────────────────────
    else:
        # Look up by email — no name required
        user = next((u for u in users.values() if u.get("email", "").lower() == email), None)
        # Fallback to DB lookup
        if not user and db.is_available():
            user = db.get_user_by_email(email)

        if not user:
            raise HTTPException(401, "No account found with this email. Sign up first.")

        stored = user.get("password", "")
        if not stored:
            raise HTTPException(401, "google_only_account")
        if not req.password:
            raise HTTPException(401, "Password required.")
        if not bcrypt.checkpw(req.password.encode(), stored.encode()):
            _record_failed_login(email)
            raise HTTPException(401, "Incorrect password.")

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
async def session_restore(data: dict):
    """
    Restore a session from a saved token — no password re-entry needed.
    Called on page reload when the client has a stored token.
    """
    token = sanitize_text(str(data.get("token", "")), 100)
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
async def logout(data: dict):
    """Invalidate a session token."""
    token = sanitize_text(str(data.get("token", "")), 100)
    if token:
        delete_session_token(token)
    return {"ok": True}


@app.post("/api/admin/test-email")
async def test_email(data: dict):
    """Email diagnostic. Send POST {\"to\": \"email\", \"key\": \"ADMIN_PASSWORD\"}"""
    key = sanitize_text(str(data.get("key", "")), 200)
    to  = sanitize_text(str(data.get("to", "")), 200)
    if not ADMIN_PASSWORD or not hmac.compare_digest(key, ADMIN_PASSWORD):
        raise HTTPException(403, "Wrong key.")
    target = to or "djhunterd712@gmail.com"
    provider = "gmail" if (GMAIL_USER and GMAIL_APP_PASSWORD) else ("resend" if RESEND_API_KEY else "none")
    ok, detail = send_email(
        target,
        "Sivarr email test",
        "<h2>Email is working ✓</h2><p>Transactional email is configured correctly on your Railway deployment.</p>"
    )
    return {
        "sent": ok,
        "detail": detail,
        "provider": provider,
        "gmail_configured": bool(GMAIL_USER and GMAIL_APP_PASSWORD),
        "gmail_user": GMAIL_USER or "(not set)",
        "resend_api_key_set": bool(RESEND_API_KEY),
        "to": target,
    }


@app.post("/api/auth/forgot-password")
async def forgot_password(data: dict, bg: BackgroundTasks):
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
    db.update_user_password(sid, hashed)
    return {"ok": True, "message": "Password updated successfully."}


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
    db.update_user_password(rec["sid"], hashed)
    db.mark_reset_token_used(token)
    return {"ok": True, "message": "Password updated. You can now sign in."}


@app.get("/api/auth/verify-email/{token}")
async def verify_email_endpoint(token: str):
    rec = db.get_email_verify_token(token)
    if not rec:
        return RedirectResponse(url="/app?verified=error", status_code=302)
    db.mark_email_verified(rec["sid"])
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
    return {
        "status": "ok",
        "db": db.is_available(),
        "active_sessions": len(_session_tokens),
        "chat_sessions": len(_chat_sessions),
        "version": VERSION,
    }


# ── Spaces API ────────────────────────────────────────────────────

def _resolve_token(data: dict) -> tuple[str, str]:
    """Return (sid, name) from a token or raise 401."""
    token = sanitize_text(str(data.get("token", "")), 100)
    if not token:
        raise HTTPException(401, "Token required.")
    entry = get_session_from_token(token)
    if not entry:
        raise HTTPException(401, "Session expired.")
    return entry["sid"], entry["name"]


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
    db.save_space(sid, {
        "id":   sanitize_text(str(space["id"]), 60),
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
    if not _plan_is_active(p):
        today = datetime.date.today().isoformat()
        dc = p.get("chat_daily") or {}
        if dc.get("date") != today:
            dc = {"date": today, "count": 0}
        if dc["count"] >= FREE_DAILY_CHAT:
            raise HTTPException(
                429,
                f"You've reached today's free limit of {FREE_DAILY_CHAT} messages. "
                f"Upgrade to Pro for unlimited chat.",
            )
        dc["count"] += 1
        p["chat_daily"] = dc
    return sid, p


def _ai_meter(sid: str) -> None:
    """Per-user daily cap across the non-chat AI endpoints (study deck/plan, write
    assist, task extraction, weekly review). Free tier only — paid plans unmetered.
    Raises 429 when the day's allowance is spent. The 'ai_daily' counter is separate
    from chat_daily and persisted immediately so it holds across requests/workers."""
    if not sid:
        return
    p = load_progress(sid)
    if _plan_is_active(p):
        return
    today = datetime.date.today().isoformat()
    dc = p.get("ai_daily") or {}
    if dc.get("date") != today:
        dc = {"date": today, "count": 0}
    if dc["count"] >= AI_DAILY_FREE:
        raise HTTPException(
            429,
            f"You've reached today's free limit of {AI_DAILY_FREE} AI actions. "
            f"Upgrade to Pro for unlimited AI.",
        )
    dc["count"] += 1
    p["ai_daily"] = dc
    save_progress(sid, p)


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    sid, p = _chat_authorize(req.token)
    key = get_client_key(request, sid)
    check_rate_limit(key, RATE_LIMIT_CHAT, "chat")

    msg = req.message
    # Prepend user context snapshot if provided (injected by frontend on first message)
    if req.context:
        msg = f"{req.context}\n\nUser: {req.message}"
    cmd = msg.lower()

    log.info(f"Chat: {sid[:20]} | {req.message[:60]}")

    local = solve_local(msg)
    if local:
        add_history(p, sid, "user", msg)
        add_history(p, sid, "sivarr", local)
        p["questions"] += 1
        p["topics"]["math"] = p["topics"].get("math", 0) + 1
        save_progress(sid, p)
        return {"reply": local, "uncertain": False, "error": False}

    sessions = get_sessions(sid)

    if is_math(cmd):
        ans = await async_gemini_ask(sessions["math"], msg)
        uncertain = is_uncertain(ans)
        is_err = _is_ai_error(ans)
        if not is_err:
            p["questions"] += 1
            p["topics"]["math"] = p["topics"].get("math", 0) + 1
            add_history(p, sid, "user", msg)
            add_history(p, sid, "sivarr", ans)
            save_progress(sid, p)
        return {"reply": ans, "uncertain": uncertain, "error": is_err}

    lib    = load_json(lpath())
    topic  = strip_topic(cmd)
    cached = get_cached(lib, topic)
    if cached:
        p["questions"] += 1
        p["topics"][topic] = p["topics"].get(topic, 0) + 1
        save_progress(sid, p)
        return {"reply": cached, "uncertain": False, "error": False}

    ans       = await async_gemini_ask(sessions["chat"], msg)
    uncertain = is_uncertain(ans)
    is_err    = _is_ai_error(ans)

    if not is_err:
        if topic and any(kw in cmd for kw in ["what is","define","explain"]) and not uncertain:
            set_cached(lib, topic, ans)
            save_json(lpath(), lib)
        p["questions"] += 1
        p["topics"][topic or "general"] = p["topics"].get(topic or "general", 0) + 1
        add_history(p, sid, "user", msg)
        add_history(p, sid, "sivarr", ans)
        save_progress(sid, p)

    return {"reply": ans, "uncertain": uncertain, "error": is_err}


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    sid, p = _chat_authorize(req.token)
    key = get_client_key(request, sid)
    check_rate_limit(key, RATE_LIMIT_CHAT, "chat")

    msg = req.message
    if req.context:
        msg = f"{req.context}\n\nUser: {req.message}"

    # Local math solver — stream the single result
    local = solve_local(msg)
    if local:
        add_history(p, sid, "user", msg)
        add_history(p, sid, "sivarr", local)
        p["questions"] += 1
        save_progress(sid, p)
        async def _math():
            yield f"data: {json.dumps({'token': local})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(_math(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    sessions = get_sessions(sid)
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()

    def _run_gemini():
        try:
            resp = sessions["chat"].send_message(msg, stream=True)
            for chunk in resp:
                txt = getattr(chunk, "text", None)
                if txt:
                    loop.call_soon_threadsafe(q.put_nowait, {"token": txt})
        except Exception as e:
            loop.call_soon_threadsafe(q.put_nowait, {"token": friendly_gemini_error(e), "error": True})
        loop.call_soon_threadsafe(q.put_nowait, None)

    loop.run_in_executor(None, _run_gemini)

    async def _stream():
        full: list[str] = []
        while True:
            item = await q.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"
            if not item.get("error"):
                full.append(item["token"])

        full_text = "".join(full)
        if full_text and not _is_ai_error(full_text):
            add_history(p, sid, "user", req.message)
            add_history(p, sid, "sivarr", full_text)
            p["questions"] += 1
            save_progress(sid, p)

        # Generate 3 follow-up suggestions (fast, non-blocking)
        suggestions: list[str] = []
        if full_text and not _is_ai_error(full_text):
            try:
                raw = await async_gemini_once(
                    f"Based on this AI response, suggest exactly 3 short follow-up questions a user might ask next. "
                    f"Return ONLY a JSON array of 3 strings, no other text.\n\nResponse:\n{full_text[:800]}",
                    temp=0.7, tokens=120
                )
                if raw:
                    raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`")
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        suggestions = [str(s).strip() for s in parsed[:3] if s]
            except Exception:
                pass

        yield f"data: {json.dumps({'done': True, 'suggestions': suggestions})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/quiz/question")
async def quiz_question(request: Request, sid: str, topic: str = "", difficulty: str = "medium", file_id: str = ""):
    sid = validate_sid(sid)  # strips path-traversal chars; sid is interpolated into the upload path
    key = get_client_key(request, sid)
    check_rate_limit(key, RATE_LIMIT_QUIZ, "quiz")

    if difficulty not in ["easy","medium","hard"]:
        difficulty = "medium"

    p = load_progress(sid)

    if file_id:
        file_id = re.sub(r"[^a-z0-9]", "", file_id.lower())[:20]  # alnum only; file_id is interpolated into the path
        fpath = UPLOADS_DIR / f"{sid}_{file_id}.txt"
        if fpath.exists():
            content = fpath.read_text(encoding="utf-8")[:3000]
            raw = await async_gemini_once(FILE_QUIZ_PROMPT.format(text=content, difficulty=difficulty), temp=0.9, tokens=300)
            if raw:
                try:
                    raw = re.sub(r"```(?:json)?","",raw).strip().rstrip("`")
                    q   = json.loads(raw)
                    q["topic"] = "uploaded document"
                    return q
                except Exception as e:
                    log.error(f"File quiz parse error: {e}")
        return {"error": "Could not generate question from file."}

    topics = list(p["topics"].keys())

    # Allow quiz even with no studied topics if a topic was provided
    if not topics and not topic:
        topic = "general knowledge"

    t = topic if topic else (random.choice(topics) if topics else "general knowledge")
    bank = load_json(bpath())
    key2 = f"{t}_{difficulty}"

    stored = bank.get(key2, [])
    if stored:
        q = random.choice(stored)
        q["topic"] = t
        return q

    raw = await async_gemini_once(QUIZ_PROMPT.format(topic=t, difficulty=difficulty), temp=0.9, tokens=300)
    if not raw:
        log.warning(f"Gemini unavailable for quiz — using fallback question bank")
        return get_fallback_question(t, [])

    q = parse_quiz_json(raw, t)
    if not q:
        # Retry once with lower temperature
        raw2 = await async_gemini_once(QUIZ_PROMPT.format(topic=t, difficulty=difficulty), temp=0.5, tokens=300)
        q = parse_quiz_json(raw2 or "", t)
    if not q:
        log.warning(f"Quiz parse failed twice — using fallback question bank")
        return get_fallback_question(t, [])

    bank.setdefault(key2, [])
    if q["question"] not in [x["question"] for x in bank[key2]]:
        bank[key2] = (bank[key2] + [q])[-BANK_LIMIT:]
    save_json(bpath(), bank)
    return q


@app.post("/api/quiz/submit")
async def quiz_submit(req: QuizRequest):
    # Auth is by session token only; the body `sid` is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(req.token, 100)) if req.token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid     = sess["sid"]
    p       = load_progress(sid)
    correct = req.answer.upper() == req.correct.upper()
    if not correct:
        p.setdefault("wrong_answers", []).append({
            "topic": sanitize_text(req.topic, 100),
            "question": sanitize_text(req.question, 500),
            "your_answer": req.answer,
            "correct": req.correct,
            "explanation": sanitize_text(req.explanation, 500),
            "difficulty": req.difficulty,
            "date": datetime.date.today().isoformat(),
        })
    save_progress(sid, p)
    return {"correct": correct, "correct_answer": req.correct}


@app.post("/api/quiz/complete")
async def quiz_complete(data: dict):
    sid, _ = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
    score = min(max(int(data.get("score",0)), 0), 5)
    topic = sanitize_text(str(data.get("topic","general")), 100)
    diff  = data.get("difficulty","medium")
    if diff not in ["easy","medium","hard"]:
        diff = "medium"
    p = load_progress(sid)
    p.setdefault("quizzes", []).append({
        "topic": topic, "score": score / 5,
        "pct": int(score / 5 * 100), "difficulty": diff,
        "date": datetime.date.today().isoformat(),
    })
    save_progress(sid, p)
    log.info(f"Quiz complete: {sid[:20]} | {score}/5 | {topic} | {diff}")
    return {"ok": True}


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
    idx   = int(data.get("index", -1))
    p     = load_progress(sid)
    wrong = p.get("wrong_answers",[])
    if 0 <= idx < len(wrong):
        wrong.pop(idx)
    p["wrong_answers"] = wrong
    save_progress(sid, p)
    return {"ok": True, "remaining": len(wrong)}


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
async def upload_file(request: Request, sid: str = Form(...), file: UploadFile = File(...)):
    sid = validate_sid(sid)  # strips path-traversal chars; sid is interpolated into the upload path
    key = get_client_key(request, sid)
    check_rate_limit(key, RATE_LIMIT_UPLOAD, "upload")

    allowed = [".txt", ".pdf", ".md"]
    ext     = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, "Use .txt, .pdf, or .md files only.")

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
<title>Sivarr AI — {d['name']}'s Results</title>
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
    log.info(f"Admin login successful from {key}")
    token = _create_admin_session()
    return {"ok": True, "token": token}


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
#  LECTURER ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.get("/lecturer", response_class=HTMLResponse)
async def lecturer_page():
    return Path("templates/lecturer.html").read_text(encoding="utf-8")


class LecturerLoginRequest(BaseModel):
    name: str
    password: str


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
    log.info(f"Lecturer login: {req.name}")
    token = _create_lecturer_session()
    return {"ok": True, "token": token}


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


@app.post("/api/lecturer/exam")
async def save_exam(data: dict):
    verify_lecturer(data.get("token",""))
    exams = load_exams()
    exam  = {
        "id":                   str(uuid.uuid4())[:10],
        "title":                sanitize_text(str(data.get("title","")), 200),
        "questions":            [sanitize_text(str(q), 500) for q in data.get("questions",[])[:100]],
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
    if sid not in cls["students"]:
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
    if code in classes and sid in classes[code]["students"]:
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
    if sid not in groups[gid]["members"]:
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
    member_of = [
        {"id": gid, "name": g["name"], "member_count": len(g["members"]),
         "last_msg": g["messages"][-1]["message"][:50] if g["messages"] else "",
         "last_date": g["messages"][-1]["date"] if g["messages"] else g["created_at"]}
        for gid, g in groups.items() if sid in g["members"]
    ]
    return {"groups": member_of}


@app.post("/api/group/message")
async def send_group_message(data: dict, request: Request):
    sid, tok_name = _resolve_token(data)   # IDOR fix: identity from session token, not body
    gid     = sanitize_text(str(data.get("group_id","")), 20)
    message = sanitize_text(str(data.get("message","")), 1000)
    name    = sanitize_text(str(tok_name or "Student"), MAX_NAME_LEN)
    groups  = load_groups()
    if gid not in groups: raise HTTPException(404, "Group not found")
    if sid not in groups[gid]["members"]: raise HTTPException(403, "Not a member")
    msg = {
        "id":      str(uuid.uuid4())[:8],
        "sid":     sid,
        "name":    name,
        "message": message,
        "date":    datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    groups[gid]["messages"].append(msg)
    groups[gid]["messages"] = groups[gid]["messages"][-300:]
    save_groups(groups)
    return {"ok": True, "msg": msg}


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
    return {"messages": groups[gid]["messages"][-100:], "name": groups[gid]["name"]}


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

STUDY_DECK_PROMPT = """You are Sivarr's Study Haven — an expert at turning raw lecture content into clean, structured study material.

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

(continue for all major topics — use actual topic names from the content)

---
## ❓ PRACTICE QUESTIONS
Generate exactly 5 practice questions based on the content. Mix question types:
1. [Question]
2. [Question]
3. [Question]
4. [Question]
5. [Question]

Keep everything concise, clear and student-friendly. Use the actual content — don't make things up.
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
        raise HTTPException(503, "AI is busy right now — try again in a moment.")

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
    tmp = str(path) + ".tmp"
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
        raise HTTPException(503, "AI unavailable — try again")

    # Parse JSON from AI response
    try:
        # Strip markdown fences if present
        clean = re.sub(r"```json|```", "", result).strip()
        questions = json.loads(clean)
        if not isinstance(questions, list):
            raise ValueError("Not a list")
    except Exception:
        raise HTTPException(500, "AI returned invalid format — try again")

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
        raise HTTPException(404, "Exam session not found — may have expired")

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
Make tasks specific and actionable. Each day must have 2-4 tasks."""

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

# ── Goals ─────────────────────────────────────────────────────
GOALS_PATH = DATA_DIR / "goals.json"


def _load_user_list(sid: str, key: str) -> list:
    """Load a per-user JSON list (goals/tasks/journal). DB-first via the user_blobs
    table — atomic row writes, shared across workers/instances, included in Supabase
    backups, and free of the whole-file read-modify-write races the per-user JSON
    files had. Lazily migrates a legacy `{sid}_{key}.json` file into the DB on first
    access. Falls back to the file only when no DB is configured."""
    legacy = DATA_DIR / f"{sid}_{key}.json"
    if db.is_available():
        blob = db.get_user_blob(sid, key)
        if isinstance(blob, list):
            return blob
        if legacy.exists():
            try:
                items = json.loads(legacy.read_text(encoding="utf-8"))
                if isinstance(items, list):
                    db.save_user_blob(sid, key, items)
                    return items
            except Exception as exc:
                log.warning(f"{key} file→DB migrate failed for {sid[:8]}: {exc}")
        return []
    return json.loads(legacy.read_text(encoding="utf-8")) if legacy.exists() else []


def _save_user_list(sid: str, key: str, items: list) -> None:
    if db.is_available():
        db.save_user_blob(sid, key, items)
        return
    save_json(DATA_DIR / f"{sid}_{key}.json", items)


def load_goals(sid: str) -> list:
    return _load_user_list(sid, "goals")

def save_goals(sid: str, goals: list):
    _save_user_list(sid, "goals", goals)

# ── Personal tasks — server-side mirror of localStorage ───────────────────────
def load_tasks(sid: str) -> list:
    return _load_user_list(sid, "tasks")

def save_tasks(sid: str, tasks: list):
    _save_user_list(sid, "tasks", tasks)

@app.post("/api/tasks/sync")
async def sync_tasks(data: dict):
    """Bulk-sync personal tasks from client localStorage to server. Called silently on every save."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid   = sess["sid"]
    tasks = data.get("tasks", [])
    if not isinstance(tasks, list):
        raise HTTPException(400, "tasks must be a list.")
    clean = []
    for t in tasks[:500]:
        clean.append({
            "id":                 sanitize_text(str(t.get("id","")), 50),
            "title":              sanitize_text(str(t.get("title","")), 200),
            "status":             sanitize_text(str(t.get("status","todo")), 20),
            "done":               bool(t.get("done", False)),
            "date":               sanitize_text(str(t.get("date","")), 20),
            "time":               sanitize_text(str(t.get("time","")), 10),
            "priority":           sanitize_text(str(t.get("priority","normal")), 20),
            "type":               sanitize_text(str(t.get("type","other")), 30),
            "goal_id":            sanitize_text(str(t.get("goal_id","")), 50),
            "parent_id":          sanitize_text(str(t.get("parent_id","")), 50),
            "recurrence":         sanitize_text(str(t.get("recurrence","")), 20) or None,
            "recurrence_spawned": bool(t.get("recurrence_spawned", False)),
        })

    # ── Recurring task spawn ──────────────────────────────────────────────────
    # When a recurring task is marked done, create the next occurrence and mark
    # the original as spawned so we don't create duplicates on the next sync.
    import datetime as _dt
    existing_ids = {t["id"] for t in clean}
    new_occurrences = []
    _RECUR_INTERVALS = {
        "daily":   _dt.timedelta(days=1),
        "weekly":  _dt.timedelta(weeks=1),
        "monthly": _dt.timedelta(days=30),
    }
    for t in clean:
        if (t.get("done")
                and t.get("recurrence") and t["recurrence"] not in ("", "none", None)
                and not t.get("recurrence_spawned")
                and t.get("date")):
            interval = _RECUR_INTERVALS.get(t["recurrence"])
            if not interval:
                continue
            try:
                base_due = _dt.date.fromisoformat(t["date"])
            except ValueError:
                continue
            new_due = str(base_due + interval)
            new_id  = f"rec_{t['id']}_{int(_dt.datetime.utcnow().timestamp() * 1000)}"
            new_occurrences.append({
                "id":                 new_id,
                "title":              t["title"],
                "status":             "todo",
                "done":               False,
                "date":               new_due,
                "time":               t.get("time", ""),
                "priority":           t.get("priority", "normal"),
                "type":               t.get("type", "other"),
                "goal_id":            t.get("goal_id", ""),
                "parent_id":          t["id"],
                "recurrence":         t["recurrence"],
                "recurrence_spawned": False,
            })
            t["recurrence_spawned"] = True  # prevent re-creation on next sync

    clean.extend(new_occurrences)
    save_tasks(sid, clean)
    spawned = [o["id"] for o in new_occurrences]
    return {"ok": True, "count": len(clean), "spawned": spawned}

@app.get("/api/tasks/restore")
async def restore_tasks(token: str = ""):
    """Return the server-stored task list so the client can sync back after a spawn."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"tasks": load_tasks(sess["sid"])}

# ── Personal docs — server-side mirror of localStorage ────────────────────────
def load_docs(sid: str) -> list:
    p = DATA_DIR / f"{sid}_docs.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

def save_docs(sid: str, docs: list):
    p = DATA_DIR / f"{sid}_docs.json"
    save_json(p, docs)

@app.post("/api/docs/sync")
async def sync_docs(data: dict):
    """Bulk-sync personal docs from client localStorage to server."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    docs = data.get("docs", [])
    if not isinstance(docs, list):
        raise HTTPException(400, "docs must be a list.")
    import re as _re
    clean = []
    for d in docs[:200]:
        raw_content = str(d.get("content", ""))
        text_only   = _re.sub(r'<[^>]+>', ' ', raw_content)[:5000]
        clean.append({
            "id":       sanitize_text(str(d.get("id", "")),    50),
            "title":    sanitize_text(str(d.get("title", "")), 200),
            "content":  text_only,
            "updated":  sanitize_text(str(d.get("updated", "")), 30),
        })
    save_docs(sid, clean)
    return {"ok": True, "count": len(clean)}

# ── Personal habits — server-side mirror ──────────────────────
def load_habits(sid: str) -> list:
    p = DATA_DIR / f"{sid}_habits.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

def save_habits(sid: str, habits: list):
    p = DATA_DIR / f"{sid}_habits.json"
    save_json(p, habits)

@app.post("/api/habits/sync")
async def sync_habits(data: dict):
    """Bulk-sync habits from client localStorage to server."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid    = sess["sid"]
    habits = data.get("habits", [])
    if not isinstance(habits, list):
        raise HTTPException(400, "habits must be a list.")
    clean = []
    for h in habits[:200]:
        clean.append({
            "id":          sanitize_text(str(h.get("id","")),    50),
            "title":       sanitize_text(str(h.get("title","")), 100),
            "emoji":       sanitize_text(str(h.get("emoji","")), 10),
            "frequency":   sanitize_text(str(h.get("frequency","daily")), 20),
            "streak":      int(h.get("streak", 0)),
            "completions": [sanitize_text(str(d), 12) for d in (h.get("completions") or [])[:400]],
        })
    save_habits(sid, clean)
    return {"ok": True, "count": len(clean)}

# ── Personal journal — server-side mirror ─────────────────────
def load_journal(sid: str) -> list:
    return _load_user_list(sid, "journal")

def save_journal(sid: str, entries: list):
    _save_user_list(sid, "journal", entries)

@app.post("/api/journal/sync")
async def sync_journal(data: dict):
    """Bulk-sync journal entries from client localStorage to server."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid     = sess["sid"]
    entries = data.get("entries", [])
    if not isinstance(entries, list):
        raise HTTPException(400, "entries must be a list.")
    clean = []
    for e in entries[:1000]:
        clean.append({
            "date":    sanitize_text(str(e.get("date","")),    20),
            "text":    sanitize_text(str(e.get("text","") or e.get("content","") or e.get("entry","")), 10000),
            "mood":    sanitize_text(str(e.get("mood","")),    10),
        })
    save_journal(sid, clean)
    return {"ok": True, "count": len(clean)}

@app.post("/api/skills/sync")
async def sync_skills(data: dict):
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid    = sess["sid"]
    skills = data.get("skills", [])
    if not isinstance(skills, list):
        raise HTTPException(400, "skills must be a list.")
    clean = []
    for s in skills[:500]:
        clean.append({
            "id":             sanitize_text(str(s.get("id", "")), 30),
            "name":           sanitize_text(str(s.get("name", "")), 80),
            "emoji":          sanitize_text(str(s.get("emoji", "💡")), 10),
            "category":       sanitize_text(str(s.get("category", "Other")), 30),
            "level":          min(100, max(0, int(s.get("level", 0)))),
            "target":         min(100, max(0, int(s.get("target", 80)))),
            "sessions":       int(s.get("sessions", 0)),
            "total_mins":     int(s.get("total_mins", 0)),
            "created":        sanitize_text(str(s.get("created", "")), 20),
            "last_practiced": sanitize_text(str(s.get("last_practiced") or ""), 20),
        })
    if db.is_available():
        db.save_user_blob(sid, "skills", {"skills": clean})
    return {"ok": True, "synced": len(clean)}


# ═══════════════════════════════════════════════════════════════
@app.post("/api/finance/sync")
async def sync_finance(data: dict):
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid     = sess["sid"]
    payload = data.get("data", {})
    if not isinstance(payload, dict):
        raise HTTPException(400, "data must be an object.")
    txs     = payload.get("transactions", [])
    budgets = payload.get("budgets", {})
    clean_txs = [
        {
            "id":       sanitize_text(str(t.get("id", "")), 30),
            "type":     sanitize_text(str(t.get("type", "expense")), 10),
            "amount":   float(t.get("amount", 0)),
            "category": sanitize_text(str(t.get("category", "other")), 30),
            "note":     sanitize_text(str(t.get("note", "")), 200),
            "date":     sanitize_text(str(t.get("date", "")), 20),
        }
        for t in (txs if isinstance(txs, list) else [])[:2000]
    ]
    clean_budgets = { sanitize_text(str(k), 30): float(v) for k, v in (budgets if isinstance(budgets, dict) else {}).items() if v }
    blob = {"transactions": clean_txs, "budgets": clean_budgets}
    if db.is_available():
        db.save_user_blob(sid, "finance", blob)
    else:
        _save_json_file(DATA_DIR / f"finance_{sid}.json", blob)
    return {"ok": True, "synced": len(clean_txs)}


@app.get("/api/finance/restore")
async def restore_finance(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    blob = db.get_user_blob(sid, "finance") if db.is_available() else _load_json_file(DATA_DIR / f"finance_{sid}.json", {})
    return {"ok": True, "data": blob or {"transactions": [], "budgets": {}}}


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

@app.get("/api/goals")
async def get_goals(sid: str = "", token: str = ""):
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"goals": load_goals(sess["sid"])}

@app.post("/api/goals/add")
async def add_goal(data: dict):
    sid, _    = _resolve_token(data)
    title     = sanitize_text(str(data.get("title","")), 100)
    subject   = sanitize_text(str(data.get("subject","")), 100)
    target    = int(data.get("target_score", 70))
    deadline  = sanitize_text(str(data.get("deadline","")), 20)
    goal_type = sanitize_text(str(data.get("goal_type", "okr")), 20)
    if goal_type not in ("okr", "score"):
        goal_type = "okr"
    if not title:
        raise HTTPException(400, "Goal title required.")
    goals = load_goals(sid)
    goal = {
        "id":           str(uuid.uuid4())[:8],
        "title":        title,
        "subject":      subject,
        "target_score": min(max(target, 1), 100),
        "deadline":     deadline,
        "created":      datetime.date.today().isoformat(),
        "progress":     0,
        "completed":    False,
        "goal_type":    goal_type,
    }
    goals.append(goal)
    save_goals(sid, goals)
    return {"goal": goal}

@app.post("/api/goals/update")
async def update_goal(data: dict):
    sid, _   = _resolve_token(data)
    goal_id  = sanitize_text(str(data.get("id","")), 20)
    progress = int(data.get("progress", 0))
    completed = bool(data.get("completed", False))
    goals = load_goals(sid)
    for g in goals:
        if g["id"] == goal_id:
            g["progress"]  = min(max(progress, 0), 100)
            g["completed"] = completed
            break
    save_goals(sid, goals)
    return {"ok": True}

@app.post("/api/goals/delete")
async def delete_goal(data: dict):
    sid, _  = _resolve_token(data)
    goal_id = sanitize_text(str(data.get("id","")), 20)
    goals   = [g for g in load_goals(sid) if g["id"] != goal_id]
    save_goals(sid, goals)
    return {"ok": True}


@app.post("/api/goals/edit")
async def edit_goal(data: dict):
    sid, _  = _resolve_token(data)
    goal_id = sanitize_text(str(data.get("id","")), 20)
    goals   = load_goals(sid)
    for g in goals:
        if g["id"] == goal_id:
            if data.get("title"):
                g["title"] = sanitize_text(str(data["title"]), 200)
            if "subject" in data:
                g["subject"] = sanitize_text(str(data.get("subject", "")), 100)
            if "deadline" in data:
                dl = data.get("deadline") or None
                g["deadline"] = sanitize_text(str(dl), 20) if dl else None
            break
    save_goals(sid, goals)
    return {"ok": True}


def _calc_goal_progress(g: dict) -> int:
    krs = g.get("key_results", [])
    if not krs:
        return g.get("progress", 0)
    pcts = [min(100.0, (kr["current"] / max(0.01, kr["target"])) * 100) for kr in krs]
    return round(sum(pcts) / len(pcts))


@app.post("/api/goals/kr/add")
async def add_goal_kr(data: dict):
    sid, _  = _resolve_token(data)
    goal_id = sanitize_text(str(data.get("goal_id","")), 20)
    title   = sanitize_text(str(data.get("title","")), 200)
    target  = float(data.get("target", 100))
    current = float(data.get("current", 0))
    unit    = sanitize_text(str(data.get("unit","")), 50)
    if not title:
        raise HTTPException(400, "KR title required.")
    goals = load_goals(sid)
    for g in goals:
        if g["id"] == goal_id:
            kr = {"id": str(uuid.uuid4())[:8], "title": title,
                  "target": max(0.1, target), "current": max(0.0, current), "unit": unit}
            g.setdefault("key_results", []).append(kr)
            g["progress"] = _calc_goal_progress(g)
            break
    save_goals(sid, goals)
    return {"ok": True}


@app.post("/api/goals/kr/update")
async def update_goal_kr(data: dict):
    sid, _  = _resolve_token(data)
    goal_id = sanitize_text(str(data.get("goal_id","")), 20)
    kr_id   = sanitize_text(str(data.get("kr_id","")), 20)
    current = float(data.get("current", 0))
    goals   = load_goals(sid)
    for g in goals:
        if g["id"] == goal_id:
            for kr in g.get("key_results", []):
                if kr["id"] == kr_id:
                    kr["current"] = max(0.0, current)
                    break
            g["progress"] = _calc_goal_progress(g)
            if g["progress"] >= 100:
                g["completed"] = True
            break
    save_goals(sid, goals)
    return {"ok": True}


@app.post("/api/goals/kr/delete")
async def delete_goal_kr(data: dict):
    sid, _  = _resolve_token(data)
    goal_id = sanitize_text(str(data.get("goal_id","")), 20)
    kr_id   = sanitize_text(str(data.get("kr_id","")), 20)
    goals   = load_goals(sid)
    for g in goals:
        if g["id"] == goal_id:
            g["key_results"] = [kr for kr in g.get("key_results", []) if kr["id"] != kr_id]
            g["progress"] = _calc_goal_progress(g)
            break
    save_goals(sid, goals)
    return {"ok": True}


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
            "id": "demo_2", "name": "Exam Prep Deck — STEM",
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
            "id": "demo_4", "name": "AI Prompt Pack — Essays",
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
        "naira_rate":          NAIRA_RATE,
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
    price_ngn = t.get("price_ngn") or round(price_usd * NAIRA_RATE, 2)
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
        "email":       email or f"buyer_{sid}@sivarr.app",
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
    price_usd   = price_ngn / NAIRA_RATE

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
        price_usd   = price_ngn / NAIRA_RATE

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
    sid, _ = _resolve_token(data)
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
    return {"ok": True, **updates}


@app.post("/api/org/invite")
async def org_invite(data: dict, bg: BackgroundTasks):
    sid, uname = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    org = db.get_org_by_member(sid)
    if not org:
        raise HTTPException(404, "You don't belong to an organization.")
    if org.get("member_role") not in ("owner", "admin", "manager"):
        raise HTTPException(403, "Only owners, admins, and managers can invite members.")
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
    log.info(f"Org invite: {email} → {org['name']} as {role}")
    return {"ok": True}


@app.get("/api/org/join/{token}")
async def org_join_link(token: str):
    """Redirect invite links to the app — the client handles actual join."""
    return RedirectResponse(url=f"/?org_invite={token}", status_code=302)


@app.post("/api/org/join")
async def org_join(data: dict):
    """Accept an org invite — called by the client after the user logs in."""
    sid, _ = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    token = sanitize_text(str(data.get("token", "")), 100)
    if not token:
        raise HTTPException(400, "Invite token required.")
    invite = db.get_org_invite(token)
    if not invite:
        raise HTTPException(404, "Invite not found or already used.")
    if invite["expires_at"] < datetime.datetime.utcnow():
        raise HTTPException(410, "This invite link has expired.")
    ok = db.use_org_invite(token, sid)
    if not ok:
        raise HTTPException(500, "Failed to join organization.")
    org = db.get_org_by_member(sid)
    return {"ok": True, "org_name": org["name"] if org else ""}


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
async def org_task_create(data: dict):
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
    updates = {k: sanitize_text(str(v), 2000) for k, v in data.items() if k in allowed}
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
    color = sanitize_text(str(data.get("color", "#0D7A5F")), 20)
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
                    f"{uname} mentioned you in #{channel} — {org['name']}",
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
        while True:
            if request and await request.is_disconnected():
                break
            msgs = await asyncio.to_thread(db.get_org_messages_since, org_id, cursor)
            if msgs:
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
            else:
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

Write a 3–5 sentence executive briefing. Be direct and actionable. Highlight risks, wins, and the #1 priority today. No bullet points — flowing prose."""

    sessions = get_sessions(sid)
    briefing = await async_gemini_ask(sessions.get("main", []), context)
    return {"briefing": briefing}


@app.post("/api/home/brief")
async def home_brief(data: dict):
    """Generate a personalised AI morning brief for the Home dashboard."""
    sid, uname = _resolve_token(data)
    import datetime as _dt
    first_name = uname.split()[0] if uname else "there"
    today      = str(_dt.date.today())
    hr         = _dt.datetime.now().hour
    tod        = "morning" if hr < 12 else "afternoon" if hr < 17 else "evening"

    # Personal data sent from the client
    open_tasks    = int(data.get("open_tasks", 0))
    overdue_tasks = int(data.get("overdue_tasks", 0))
    top_goal      = sanitize_text(str(data.get("top_goal", "")), 80)
    goal_pct      = int(data.get("goal_pct", 0))
    streak        = int(data.get("streak", 0))
    events_today  = int(data.get("events_today", 0))
    journalled    = bool(data.get("journalled", False))
    high_pri      = sanitize_text(str(data.get("high_priority_task", "")), 80)

    # Org data (if user is in an org)
    org_name      = ""
    org_tasks     = 0
    if db.is_available():
        try:
            org = db.get_org_by_member(sid)
            if org:
                org_name  = org["name"]
                org_tasks = db.count_org_tasks(org["id"], exclude_status="done")
        except Exception:
            pass

    lines = [
        f"Generate a 2-3 sentence {tod} brief for {first_name}. Today is {today}.",
        "",
        "Workspace data:",
        f"- Open tasks: {open_tasks}" + (f" ({overdue_tasks} overdue)" if overdue_tasks else ""),
    ]
    if high_pri:
        lines.append(f"- Highest priority: \"{high_pri}\"")
    if top_goal:
        lines.append(f"- Top goal: \"{top_goal}\" at {goal_pct}%")
    if streak > 1:
        lines.append(f"- Activity streak: {streak} days")
    if events_today:
        lines.append(f"- Events scheduled today: {events_today}")
    if not journalled:
        lines.append("- Has NOT journalled today")
    if org_name:
        lines.append(f"- Organisation: {org_name} ({org_tasks} open org tasks)")

    lines += [
        "",
        "Rules:",
        "1. Be warm and direct — like the smartest friend in the room.",
        "2. Reference 1-2 real data points naturally, not as a list.",
        "3. End with one sharp, specific action suggestion.",
        "4. Max 3 sentences. No bullet points. No headers.",
    ]

    prompt  = "\n".join(lines)
    brief   = await async_gemini_once(prompt, temp=0.75, tokens=120)
    if not brief:
        brief = f"Good {tod}, {first_name}. Your workspace is ready — make today count."
    return {"brief": brief, "date": today}


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


JOURNAL_PROMPTS = [
    "What's one decision you made this week you'd make differently?",
    "What's something you've been avoiding that needs your attention?",
    "Describe a moment today where you felt fully present.",
    "What would you do this week if you weren't afraid of failing?",
    "What's one thing you learned today that surprised you?",
    "Who made a positive impact on you recently, and have you told them?",
    "What does success look like for you one year from now?",
    "What habit is quietly holding you back?",
    "What are you most grateful for right now?",
    "What's one thing you want to stop doing? One thing to start?",
    "Describe your energy level today. What drained you? What filled you?",
    "What problem have you been overthinking that needs a decision, not more thought?",
    "What did you build, create, or contribute today?",
    "If today was the only evidence someone had of who you are, what would it say?",
    "What's been on your mind that you haven't written down yet?",
    "Where did you spend the most focus today? Was it worth it?",
    "What's one conversation you need to have that you've been putting off?",
    "What's working well right now that you should protect?",
    "Name one thing you're proud of this week, however small.",
    "What boundary did you hold or fail to hold today?",
    "How has your thinking on a big goal shifted recently?",
    "What would you tell yourself 3 months ago?",
    "What's one thing you want to remember about today?",
    "Where are you being too hard on yourself?",
    "What would make next week significantly better than this one?",
    "Describe your ideal version of tomorrow.",
    "What are you currently building, and why does it matter to you?",
    "What's one relationship you want to invest more in?",
    "What does your gut say about a decision you're facing?",
    "What's the most important thing you didn't do today, and why?",
]

@app.get("/api/journal/prompt")
async def journal_prompt():
    """Return today's journal prompt — consistent for all users on the same day."""
    import datetime as _dt
    day_of_year = _dt.date.today().timetuple().tm_yday
    prompt = JOURNAL_PROMPTS[day_of_year % len(JOURNAL_PROMPTS)]
    return {"prompt": prompt}


@app.get("/api/analytics/mood")
async def analytics_mood(token: str = "", days: int = 30):
    """Return mood data from journal entries for the last N days."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    import datetime as _dt
    days   = max(7, min(days, 90))
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


@app.post("/api/ai/extract-tasks")
async def ai_extract_tasks(data: dict, request: Request):
    """Extract actionable tasks from free-form text using AI."""
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    check_rate_limit(get_client_key(request), 15, "ai_extract")
    _ai_meter(sess["sid"])
    text = sanitize_text(str(data.get("text","")), 3000)
    if len(text.strip()) < 10:
        raise HTTPException(400, "Text too short.")
    prompt = f"""Extract all actionable tasks from the text below.
Return ONLY a JSON array of objects, each with:
  "title": short task title (max 60 chars)
  "priority": "high", "medium", or "low"
  "due": ISO date string if mentioned, else null

Text:
{text}

Return only valid JSON. No explanation. No markdown. Example:
[{{"title":"Reply to John","priority":"high","due":null}}]"""
    raw = await async_gemini_once(prompt, temp=0.2, tokens=400)
    tasks = []
    if raw:
        try:
            import re as _re
            m = _re.search(r'\[.*\]', raw, _re.DOTALL)
            if m:
                tasks = json.loads(m.group(0))
        except Exception:
            pass
    return {"tasks": tasks[:20]}


@app.post("/api/ai/write")
async def ai_write_assist(data: dict, request: Request):
    """AI writing assistant — improve, shorten, expand, or reformat text."""
    sess = get_session_from_token(data.get("token",""))
    if not sess:
        raise HTTPException(401, "Invalid session.")
    check_rate_limit(get_client_key(request), 20, "ai_write")
    _ai_meter(sess["sid"])
    text   = sanitize_text(str(data.get("text","")), 4000)
    action = sanitize_text(str(data.get("action","improve")), 20)
    tone   = sanitize_text(str(data.get("tone","professional")), 20)
    if len(text.strip()) < 5:
        raise HTTPException(400, "Text too short.")
    actions = {
        "improve":   "Rewrite to improve clarity, flow, and impact.",
        "shorten":   "Shorten significantly while keeping the core message.",
        "expand":    "Expand with relevant detail and depth.",
        "formal":    "Rewrite in a formal, professional tone.",
        "casual":    "Rewrite in a warm, conversational tone.",
        "bullets":   "Convert into clear, concise bullet points.",
        "email":     "Rewrite as a professional email.",
        "summarise": "Summarise in 2-3 sentences.",
    }
    instruction = actions.get(action, actions["improve"])
    prompt = f"""{instruction}

Text:
{text}

Respond with ONLY the rewritten text. No preamble, no explanation."""
    result = await async_gemini_once(prompt, temp=0.7, tokens=600)
    if not result:
        raise HTTPException(502, "AI unavailable. Try again.")
    return {"result": result}


@app.post("/api/ai/weekly-review")
async def weekly_review(data: dict, request: Request):
    """Generate a personalised AI weekly review digest."""
    sid, name = _resolve_token(data)
    check_rate_limit(get_client_key(request), 10, "weekly_review")
    _ai_meter(sid)
    import datetime as _dt
    first_name    = name.split()[0] if name else "there"
    week_end      = _dt.date.today()
    week_start    = week_end - _dt.timedelta(days=6)
    week_range    = f"{week_start.strftime('%b %d')}–{week_end.strftime('%b %d')}"

    tasks_done    = max(0, int(data.get("tasks_done", 0)))
    tasks_total   = max(0, int(data.get("tasks_total", 0)))
    habits_pct    = max(0, min(100, int(data.get("habits_pct", 0))))
    mood          = sanitize_text(str(data.get("mood", "")), 20)
    raw_goals     = data.get("goals", [])
    goals         = [g for g in raw_goals if isinstance(g, dict)][:5]

    goals_txt = "\n".join(
        f"  - {sanitize_text(str(g.get('title','')),60)}: {int(g.get('progress',0))}%"
        for g in goals
    ) if goals else "  - No active goals"

    # Skills context
    skills_txt = ""
    if db.is_available():
        sk_blob = db.get_user_blob(sid, "skills") or {}
        sk_list = (sk_blob.get("skills") or [])[:5]
        if sk_list:
            skills_txt = "\n".join(
                f"  - {sanitize_text(str(s.get('name','?')),40)}: {s.get('level',0)}% proficiency, {s.get('sessions',0)} sessions"
                for s in sk_list
            )

    # Finance context
    finance_txt = ""
    if db.is_available():
        fin_blob = db.get_user_blob(sid, "finance") or {}
        fin_txs  = (fin_blob.get("transactions") or [])
        month    = str(week_end)[:7]
        m_txs    = [t for t in fin_txs if str(t.get("date","")).startswith(month)]
        if m_txs:
            inc = sum(t.get("amount",0) for t in m_txs if t.get("type")=="income")
            exp = sum(t.get("amount",0) for t in m_txs if t.get("type")=="expense")
            finance_txt = f"  - This month: ₦{inc:,.0f} income, ₦{exp:,.0f} expenses, ₦{inc-exp:,.0f} net"

    extras = ""
    if skills_txt:  extras += f"\n- Skills tracked:\n{skills_txt}"
    if finance_txt: extras += f"\n- Finance:\n{finance_txt}"

    prompt = f"""You are Sivarr AI. Write a warm, insightful weekly review for {first_name} covering {week_range}.

Data:
- Tasks completed: {tasks_done} of {tasks_total}
- Habits completion rate: {habits_pct}%
- Goals:
{goals_txt}{extras}
{"- Dominant mood: " + mood if mood else ""}

Format your response in exactly 4 labelled sections:

**This Week**
2 sentences summarising their overall performance — be honest and specific.

**Wins**
- [win 1]
- [win 2]
Two genuine achievements based on the data.

**Focus Next Week**
- [action 1]
- [action 2]
Two specific, actionable recommendations tied to their data.

**Closing**
One energising sentence using their first name.

Keep it concise, personal, and grounded in the actual numbers. No generic filler."""

    review = await async_gemini_once(prompt, temp=0.72, tokens=380)
    if not review:
        review = f"Great effort this week, {first_name}! You completed {tasks_done} tasks and maintained {habits_pct}% of your habits. Keep building that momentum — next week, push one goal past its current mark."
    # Cache the review server-side for auto-display next time
    import datetime as _dt2
    week_start_str = str(_dt2.date.today() - _dt2.timedelta(days=_dt2.date.today().weekday()))
    reviews_dir = DATA_DIR / "weekly_reviews"
    reviews_dir.mkdir(exist_ok=True)
    review_path = reviews_dir / f"{sid}_{week_start_str}.json"
    save_json(review_path, {"review": review, "week_start": week_start_str, "generated_at": str(_dt2.date.today())})

    return {"review": review, "week": week_range}


@app.get("/api/ai/weekly-review/latest")
async def weekly_review_latest(token: str = ""):
    """Return the most recent auto-generated or manual review for the current week."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    import datetime as _dt
    today      = _dt.date.today()
    week_start = str(today - _dt.timedelta(days=today.weekday()))
    review_path = DATA_DIR / "weekly_reviews" / f"{sid}_{week_start}.json"
    if not review_path.exists():
        return {"review": None, "week_start": week_start}
    data = json.loads(review_path.read_text(encoding="utf-8"))
    return {"review": data.get("review",""), "week_start": data.get("week_start", week_start)}


@app.post("/api/ai/parse-intent")
async def parse_intent(data: dict, request: Request):
    """Parse a natural-language string into a structured action (task, goal, or note)."""
    sid, _ = _resolve_token(data)
    check_rate_limit(get_client_key(request), 30, "parse_intent")
    text = sanitize_text(str(data.get("text", "")), 300)
    if not text.strip():
        raise HTTPException(400, "Text required.")
    today = str(__import__('datetime').date.today())
    prompt = f"""Parse the following natural-language input into a structured action. Today is {today}.

Input: "{text}"

Respond with a single JSON object — no explanation, no markdown fences. Schema:
{{"action":"task"|"goal"|"note","title":"string","priority":"high"|"normal"|"low","due":"YYYY-MM-DD"|null,"subject":"string"|null}}

Rules:
- action = "task" if it describes something to do, complete, or finish
- action = "goal" if it describes a target, aim, score, or achievement
- action = "note" for everything else
- Extract any explicit date or relative date (tomorrow, Friday, next week) and convert to YYYY-MM-DD
- Keep title concise (max 70 chars), remove filler words like "remind me to" or "I need to"
- subject is only for goals (the subject area, e.g. "Physics")"""

    raw = await async_gemini_once(prompt, temp=0.1, tokens=120)
    parsed = None
    if raw:
        try:
            import re as _re, json as _json
            m = _re.search(r'\{.*\}', raw, _re.DOTALL)
            if m:
                parsed = _json.loads(m.group(0))
        except Exception:
            pass
    if not parsed:
        parsed = {"action": "task", "title": text[:70], "priority": "normal", "due": None, "subject": None}
    return {"ok": True, "parsed": parsed}


@app.post("/api/ai/voice-to-task")
async def voice_to_task(data: dict, request: Request):
    """Convert a voice-note transcript into structured tasks."""
    sid, _ = _resolve_token(data)
    check_rate_limit(get_client_key(request), 20, "voice_to_task")
    transcript = sanitize_text(str(data.get("transcript", "")), 600)
    if not transcript.strip():
        raise HTTPException(400, "Transcript required.")
    today = str(__import__('datetime').date.today())
    prompt = f"""Extract all actionable tasks from this voice note. Today is {today}.

Voice note: "{transcript}"

Return a JSON array of task objects (max 5). Each object:
{{"title":"string","priority":"high"|"normal"|"low","due":"YYYY-MM-DD"|null}}

Rules:
- Only extract clear action items — skip context-setting or general remarks
- Keep titles concise (max 60 chars)
- Respond with the JSON array only, no explanation"""

    raw = await async_gemini_once(prompt, temp=0.15, tokens=250)
    tasks = []
    if raw:
        try:
            import re as _re, json as _json
            m = _re.search(r'\[.*\]', raw, _re.DOTALL)
            if m:
                result = _json.loads(m.group(0))
                if isinstance(result, list):
                    tasks = result[:5]
        except Exception:
            pass
    if not tasks:
        tasks = [{"title": transcript[:60], "priority": "normal", "due": None}]
    return {"ok": True, "tasks": tasks}


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
async def google_oauth_callback(code: str = "", error: str = "", state: str = ""):
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
                log.error(f"Google token exchange error: {tokens.get('error_description', tokens)}")
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
async def google_token_exchange(code: str = ""):
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

@app.get("/auth/google/calendar")
async def google_cal_connect(token: str = ""):
    """Start OAuth flow for Google Calendar (offline, to get refresh token)."""
    if not GOOGLE_OAUTH_AVAILABLE:
        return RedirectResponse("/app?gcal_error=not_configured")
    from urllib.parse import urlencode
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  f"{BASE_URL}/auth/google/calendar/callback",
        "response_type": "code",
        "scope":         "https://www.googleapis.com/auth/calendar.events",
        "access_type":   "offline",
        "prompt":        "consent",
        "state":         token,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@app.get("/auth/google/calendar/callback")
async def google_cal_callback(code: str = "", state: str = "", error: str = ""):
    """Store Google Calendar refresh token for the Sivarr user."""
    if error or not code:
        return RedirectResponse("/app?gcal_error=denied")
    if not GOOGLE_OAUTH_AVAILABLE or not HTTPX_AVAILABLE:
        return RedirectResponse("/app?gcal_error=not_configured")
    sess = get_session_from_token(state)
    if not sess:
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

    sid = sess["sid"]
    p   = load_progress(sid)
    p["google_cal_tokens"] = {
        "access_token":  tokens.get("access_token",""),
        "refresh_token": tokens.get("refresh_token",""),
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
    if not gcal.get("refresh_token"):
        return None
    if time.time() < gcal.get("expiry", 0) - 300:
        return gcal["access_token"]
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(GOOGLE_TOKEN_URL, data={
                "client_id":     GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": gcal["refresh_token"],
                "grant_type":    "refresh_token",
            })
            data = resp.json()
            if "access_token" not in data:
                return None
            gcal["access_token"] = data["access_token"]
            gcal["expiry"]       = time.time() + data.get("expires_in", 3600)
            p["google_cal_tokens"] = gcal
            save_progress(sid, p)
            return gcal["access_token"]
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

    if all_day:
        body = {"summary": title, "description": desc,
                "start": {"date": start[:10]}, "end": {"date": end[:10]}}
    else:
        if "T" not in start:
            start = start + "T09:00:00"
            end   = end   + "T10:00:00"
        body = {"summary": title, "description": desc,
                "start": {"dateTime": start, "timeZone": "UTC"},
                "end":   {"dateTime": end,   "timeZone": "UTC"}}
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


# ═══════════════════════════════════════════════════════════════
#  PAYSTACK SUBSCRIPTION BILLING
# ═══════════════════════════════════════════════════════════════

@app.get("/api/billing/plans")
async def billing_plans():
    return {
        "plans": SIVARR_PLANS,
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
    payload = {
        "email":        email or f"user_{sid}@sivarr.app",
        "amount":       plan["amount_ngn"] * 100,
        "currency":     "NGN",
        "reference":    reference,
        "callback_url": f"{BASE_URL.rstrip('/')}/billing/callback",
        "metadata": {
            "sivarr_sid": sid, "plan_id": plan_id,
            "plan_name": plan["name"], "period": plan["period"],
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
        "reference": reference, "plan_id": plan_id, "amount_ngn": plan["amount_ngn"],
    }


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

    # Derive the plan from the server-set metadata, then verify the amount and
    # currency actually cover it — never trust a client-supplied plan or amount.
    plan_id = meta.get("plan_id", "")
    plan    = SIVARR_PLANS.get(plan_id)
    if not plan:
        log.error(f"Paystack verify: unknown plan_id {plan_id!r} ref={reference}")
        raise HTTPException(400, "Could not determine the plan for this payment.")
    paid_kobo = int(tx.get("amount", 0) or 0)
    if (tx.get("currency") or "").upper() != "NGN" or paid_kobo < plan["amount_ngn"] * 100:
        log.warning(f"Paystack verify amount mismatch ref={reference}: paid {paid_kobo} kobo "
                    f"{tx.get('currency')}, need {plan['amount_ngn'] * 100} kobo for {plan_id}")
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
        "amount": f"₦{plan.get('amount_ngn',0):,}",
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


def _load_json_file(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def _save_json_file(path: Path, data):
    tmp = str(path) + ".tmp"
    Path(tmp).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    Path(tmp).replace(path)


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
    if len(title) < 3:
        raise HTTPException(400, "Title required.")
    opp = {
        "id": uuid.uuid4().hex[:14], "title": title, "desc": desc, "link": link,
        "category": category, "deadline": deadline, "organisation": org,
        "submitted_by": sess["sid"],
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
    amount_ngn = plan["amount_ngn"]
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
    if (data.get("currency") or "").upper() != "NGN" or paid < plan["amount_ngn"]:
        log.warning(f"Flutterwave verify amount mismatch ref={reference}: paid {paid} "
                    f"{data.get('currency')}, need {plan['amount_ngn']} NGN for {plan_id}")
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
        send_email(email, f"Sivarr {plan['name']} — Payment Confirmed",
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
    await _sse_broadcast(org_id, json.dumps({"type": "announcement", "ann": ann}))

    # ── Email all org members (except the author) ─────────────────
    members = db.get_org_members(org_id)
    for m in members:
        if m["sid"] == sid or not m.get("email"):
            continue
        bg.add_task(
            send_email,
            m["email"],
            f"📢 {title} — {org['name']}",
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
    """Validate token and return (session, org_id). Raises HTTPException on failure."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    p = load_progress(sess["sid"])
    org_id = p.get("org_id", "")
    if not org_id:
        raise HTTPException(403, "Not in an organisation.")
    return sess, org_id


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
    ok, detail = send_email(email, f"Tasks due soon — Sivarr",
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
        ok, _ = send_email(email, f"Good morning, {name} — your Sivarr daily briefing", html)
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
                f"Weekly progress report — {org_name}",
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
                header = f"## {date}" + (f" — {mood}" if mood else "")
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

@app.post("/api/import/tasks")
async def import_tasks(data: dict):
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    rows = data.get("tasks", [])
    if not isinstance(rows, list):
        raise HTTPException(400, "tasks must be a list.")
    existing = load_tasks(sid)
    imported = []
    for r in rows[:500]:
        title = sanitize_text(str(r.get("title", "")), 200).strip()
        if not title:
            continue
        imported.append({
            "id":       str(uuid.uuid4())[:8],
            "title":    title,
            "status":   sanitize_text(str(r.get("status", "todo")), 20),
            "done":     str(r.get("done", "")).lower() in ("yes", "true", "1"),
            "date":     sanitize_text(str(r.get("date", "")), 20),
            "time":     sanitize_text(str(r.get("time", "")), 10),
            "priority": sanitize_text(str(r.get("priority", "normal")), 20),
            "type":     sanitize_text(str(r.get("type", "other")), 30),
            "goal_id":  "",
        })
    save_tasks(sid, existing + imported)
    return {"ok": True, "imported": len(imported)}


@app.post("/api/import/goals")
async def import_goals(data: dict):
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    rows = data.get("goals", [])
    if not isinstance(rows, list):
        raise HTTPException(400, "goals must be a list.")
    existing = load_goals(sid)
    imported = []
    for r in rows[:200]:
        title = sanitize_text(str(r.get("title", "")), 100).strip()
        if not title:
            continue
        try:
            target = min(max(int(float(r.get("target_score", 70))), 1), 100)
        except (ValueError, TypeError):
            target = 70
        imported.append({
            "id":           str(uuid.uuid4())[:8],
            "title":        title,
            "subject":      sanitize_text(str(r.get("subject", "")), 100),
            "target_score": target,
            "deadline":     sanitize_text(str(r.get("deadline", "")), 20),
            "created":      datetime.date.today().isoformat(),
            "progress":     0,
            "completed":    str(r.get("completed", "")).lower() in ("yes", "true", "1"),
        })
    save_goals(sid, existing + imported)
    return {"ok": True, "imported": len(imported)}


@app.post("/api/import/notes")
async def import_notes(data: dict):
    """Accept markdown text and create a doc from it."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid      = sess["sid"]
    markdown = sanitize_text(str(data.get("markdown", "")), 200000)
    filename = sanitize_text(str(data.get("filename", "Imported note")), 100)
    if not markdown.strip():
        raise HTTPException(400, "Empty content.")

    # Convert markdown to simple HTML for the doc editor
    lines    = markdown.split("\n")
    html_parts = []
    for line in lines:
        if line.startswith("### "): html_parts.append(f"<h3>{line[4:]}</h3>")
        elif line.startswith("## "): html_parts.append(f"<h2>{line[3:]}</h2>")
        elif line.startswith("# "):  html_parts.append(f"<h1>{line[2:]}</h1>")
        elif line.strip() == "---": html_parts.append("<hr>")
        elif line.strip():           html_parts.append(f"<p>{line}</p>")
    html_content = "\n".join(html_parts)

    existing = load_docs(sid)
    doc = {
        "id":      int(datetime.datetime.now().timestamp() * 1000),
        "title":   filename.replace(".md", ""),
        "content": html_content,
        "updated": int(datetime.datetime.now().timestamp() * 1000),
    }
    existing.insert(0, doc)
    save_docs(sid, existing)
    return {"ok": True, "doc_id": doc["id"]}


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
