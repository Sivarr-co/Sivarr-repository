"""
config.py — SIVARR centralised configuration
All environment variables, constants, and AI prompts live here.
Import from this module everywhere — never read os.environ directly in routes.
"""

import os
import sys
import logging
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

# ── Third-party optional imports ─────────────────────────────────
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
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
    import sentry_sdk
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    SENTRY_AVAILABLE = True
except ImportError:
    sentry_sdk = None
    SENTRY_AVAILABLE = False

# ── Logging ──────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[logging.StreamHandler()],
)
log = logging.getLogger("sivarr")

# ── App version ──────────────────────────────────────────────────
VERSION      = "3"
CACHE_EXPIRY = 30    # days before cached AI answers expire
HISTORY_LIMIT = 40   # max messages kept in chat history
BANK_LIMIT    = 20   # max cached answers per topic bank

# ── File storage paths ───────────────────────────────────────────
# Set RAILWAY_VOLUME_MOUNT_PATH in Railway env vars for persistent storage
_BASE       = Path(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "."))
DATA_DIR    = _BASE / "data"
UPLOADS_DIR = _BASE / "uploads"
SHARES_DIR  = _BASE / "shares"
LOG_DIR     = _BASE / "logs"

for _d in [DATA_DIR, UPLOADS_DIR, SHARES_DIR, LOG_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# JSON data file paths
ANN_PATH           = DATA_DIR / "announcements.json"
TOPICS_PATH        = DATA_DIR / "class_topics.json"
EXAMS_PATH         = DATA_DIR / "exams.json"
CLASSES_PATH       = DATA_DIR / "classes.json"
USERS_PATH         = DATA_DIR / "users.json"
COMMUNITY_PATH     = DATA_DIR / "community_posts.json"
OPPORTUNITIES_PATH = DATA_DIR / "opportunities.json"

# ── Credentials & secrets ─────────────────────────────────────────
ADMIN_PASSWORD    = os.environ.get("ADMIN_PASSWORD", "")
LECTURER_PASSWORD = os.environ.get("LECTURER_PASSWORD", "")

if not ADMIN_PASSWORD:
    print("CRITICAL: ADMIN_PASSWORD env var is not set. Admin login is disabled.", file=sys.stderr)
if not LECTURER_PASSWORD:
    print("CRITICAL: LECTURER_PASSWORD env var is not set. Lecturer login is disabled.", file=sys.stderr)

BASE_URL          = os.environ.get("BASE_URL", "https://sivarr.up.railway.app")
RESEND_API_KEY    = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM       = os.environ.get("RESEND_FROM_EMAIL", "Sivarr <noreply@sivarr.app>")
RESEND_REPLY_TO   = os.environ.get("RESEND_REPLY_TO", "Connectsivarr@gmail.com")

STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# ── Paystack (NGN payments) ───────────────────────────────────────
PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")
PAYSTACK_PUBLIC_KEY = os.environ.get("PAYSTACK_PUBLIC_KEY", "")
PAYSTACK_AVAILABLE  = bool(PAYSTACK_SECRET_KEY)
NAIRA_RATE          = int(os.environ.get("NAIRA_RATE", "1650"))
PAYSTACK_API        = "https://api.paystack.co"

# ── Flutterwave (NGN/GHS/KES payments) ───────────────────────────
FLUTTERWAVE_SECRET_KEY = os.environ.get("FLUTTERWAVE_SECRET_KEY", "")
FLUTTERWAVE_PUBLIC_KEY = os.environ.get("FLUTTERWAVE_PUBLIC_KEY", "")
FLUTTERWAVE_AVAILABLE  = bool(FLUTTERWAVE_SECRET_KEY)
FLUTTERWAVE_API        = "https://api.flutterwave.com/v3"

# ── Mono (African open banking) ──────────────────────────────────
MONO_SECRET_KEY = os.environ.get("MONO_SECRET_KEY", "")
MONO_PUBLIC_KEY = os.environ.get("MONO_PUBLIC_KEY", "")
MONO_AVAILABLE  = bool(MONO_SECRET_KEY)
MONO_API        = "https://api.withmono.com"

# ── Google OAuth + Calendar ──────────────────────────────────────
GOOGLE_CLIENT_ID       = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET   = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_OAUTH_AVAILABLE = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)
GOOGLE_AUTH_URL        = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL       = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL    = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_CAL_API         = "https://www.googleapis.com/calendar/v3"

# ── GitHub OAuth ─────────────────────────────────────────────────
GITHUB_CLIENT_ID       = os.environ.get("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET   = os.environ.get("GITHUB_CLIENT_SECRET", "")
GITHUB_OAUTH_AVAILABLE = bool(GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)
GITHUB_AUTH_URL        = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL       = "https://github.com/login/oauth/access_token"
GITHUB_API             = "https://api.github.com"

# ── Gemini AI ────────────────────────────────────────────────────
API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODELS = [
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-pro",
    "gemini-pro",
    "gemini-1.0-pro",
]

# ── SIVARR subscription plans ────────────────────────────────────
SIVARR_PLANS = {
    "pro_monthly":  {"name": "Pro",  "label": "Monthly", "amount_ngn": 2500,  "period": "monthly"},
    "pro_yearly":   {"name": "Pro",  "label": "Yearly",  "amount_ngn": 25000, "period": "yearly"},
    "team_monthly": {"name": "Team", "label": "Monthly", "amount_ngn": 8000,  "period": "monthly"},
}

# ── Sentry error tracking ─────────────────────────────────────────
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")

# ── Analytics ────────────────────────────────────────────────────
PLAUSIBLE_DOMAIN = os.environ.get("PLAUSIBLE_DOMAIN", "")

# ── Rate limiting ────────────────────────────────────────────────
RATE_LIMIT_CHAT   = int(os.environ.get("RATE_LIMIT_CHAT",   20))
RATE_LIMIT_QUIZ   = int(os.environ.get("RATE_LIMIT_QUIZ",    5))
RATE_LIMIT_UPLOAD = int(os.environ.get("RATE_LIMIT_UPLOAD",  5))
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", 60))
RATE_LIMIT_LOGIN  = int(os.environ.get("RATE_LIMIT_LOGIN",  10))

# ── Input validation limits ───────────────────────────────────────
MAX_MESSAGE_LEN = 2000
MAX_NAME_LEN    = 80
MAX_MATRIC_LEN  = 30
MAX_FILE_SIZE   = 5 * 1024 * 1024   # 5 MB

# ── Session lifetimes ────────────────────────────────────────────
SESSION_TTL_DAYS  = 30
CHAT_SESSION_TTL  = 3600 * 6   # 6 hours of inactivity clears chat memory

# ── Account lockout ───────────────────────────────────────────────
LOGIN_LOCK_ATTEMPTS = 10
LOGIN_LOCK_MINUTES  = 30

# ── Real-time org chat: default channels ─────────────────────────
DEFAULT_CHANNELS = [
    {"id": "general",     "name": "general",     "desc": "Team-wide announcements"},
    {"id": "engineering", "name": "engineering", "desc": "Engineering discussions"},
    {"id": "product",     "name": "product",     "desc": "Product and design"},
    {"id": "sales",       "name": "sales",       "desc": "Sales and growth"},
    {"id": "design",      "name": "design",      "desc": "Design assets and feedback"},
    {"id": "random",      "name": "random",      "desc": "Off-topic conversations"},
]

# ── AI trigger lists ──────────────────────────────────────────────
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

# ── AI system prompts ─────────────────────────────────────────────
SYSTEM_PROMPT = f"""You are SIVARR — a brilliant, context-aware AI built into the SIVARR platform.
You are not a generic assistant. You live inside the user's personal workspace and know their tasks, goals, habits, journal, and progress.
SIVARR was founded by a Lead City University student. Mission: student → skilled professional → employed talent → career growth. Version: {VERSION}

Personality:
- Warm, direct, and energetic — like the smartest friend in the room, not a textbook.
- Reference the user's actual data naturally when it's relevant.
- Celebrate wins. Call out patterns. Be proactive, not just reactive.

Rules:
1. Keep answers SHORT — 2 to 4 sentences by default. Expand only when asked.
2. Show step-by-step working ONLY when explicitly requested.
3. Answer ANY question — academics, career, life, creativity, strategy.
4. For math: state the final answer only unless asked for working.
5. If unsure, say so — never confidently guess wrong.
6. Format cleanly — use line breaks for readability when helpful.
7. When user context is provided at the start of a message, use it naturally. Do NOT echo it back verbatim.
8. Address the user by their first name occasionally for warmth.
"""

MATH_PROMPT = """You are SIVARR's math expert.
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
