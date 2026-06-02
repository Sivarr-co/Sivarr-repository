# SIVARR — Codebase Guide for Engineers
> Read this first. It tells you where everything is and how it all connects.

---

## Project structure

```
Sivarr-repository/
│
├── app.py                  ← FastAPI entry point. Creates the app, registers routers,
│                             mounts static files, configures middleware. ~100 lines when done.
│
├── config.py               ← ALL env vars, constants, AI prompts. Never read os.environ
│                             directly in route files — always import from here.
│
├── models.py               ← ALL Pydantic request body models (LoginRequest, ChatRequest, etc.)
│
├── database.py             ← PostgreSQL connection + all DB queries (CRUD operations)
│
├── routes/                 ← FastAPI APIRouter modules — one file per domain
│   ├── __init__.py         ← Documents which file owns which URL prefix
│   ├── pages.py            ← HTML pages: /, /admin, /lecturer, /billing/callback
│   ├── auth.py             ← /api/login, /api/logout, /api/session/restore, /api/auth/*
│   ├── oauth.py            ← /auth/google/*, /auth/github/*
│   ├── billing.py          ← /api/billing/*, /api/payments/*, /api/webhooks/*
│   ├── chat.py             ← /api/chat, /api/quiz/*, /api/suggest, /api/progress
│   ├── community.py        ← /api/community/*, /api/opportunities, /api/profile/*
│   ├── ai.py               ← /api/ai/*, /api/home/brief, /api/org/ai/*
│   ├── files.py            ← /api/upload, /api/share, /share/*
│   ├── org.py              ← /api/org/* (30+ endpoints)
│   ├── academic.py         ← /api/class/*, /api/exam/*, /api/study-*, /api/group/*
│   ├── admin.py            ← /api/admin/*, /api/lecturer/*
│   ├── integrations.py     ← /api/integrations/gcal, /api/integrations/github, /api/integrations/mono
│   └── notifications.py    ← /api/notify/*
│
├── utils/                  ← Shared Python utilities. No FastAPI routes here.
│   ├── __init__.py
│   ├── auth.py             ← Session tokens, admin sessions, account lockout
│   ├── email.py            ← send_email() + all HTML email templates
│   ├── storage.py          ← load/save progress, users, goals, classes, groups
│   ├── rate_limit.py       ← RateLimiter class + check_rate_limit()
│   └── helpers.py          ← sanitize_text, validation, Gemini AI calls
│
├── js/
│   ├── app.js              ← Main JS file (14,000 lines — monolith, being split)
│   ├── sw.js               ← Service worker (PWA offline support)
│   ├── core/               ← Shared JS loaded before all features
│   │   ├── README.md       ← Documents what each core file should contain
│   │   ├── state.js        ← Global state (S, _BILLING_STATUS, etc.) [TODO: extract]
│   │   ├── api.js          ← API() wrapper, esc(), renderMarkdown() [TODO: extract]
│   │   ├── ui.js           ← toast, nav, siModal, paywall [TODO: extract]
│   │   └── auth.js         ← doLogin, restoreSession, checkAuthParams [TODO: extract]
│   └── features/           ← One file per feature [TODO: extract from app.js]
│       ├── README.md        ← Documents which app.js lines each feature maps to
│       ├── billing.js      ← Billing, pricing modal, plan management
│       ├── chat.js         ← AI chat panel
│       ├── community.js    ← Community feed + opportunities
│       ├── tasks.js        ← Task management
│       ├── goals.js        ← Goals and OKRs
│       ├── habits.js       ← Habits tracker
│       ├── calendar.js     ← Calendar view
│       ├── journal.js      ← Journal
│       ├── notes.js        ← Notes and document hub
│       ├── org.js          ← Organisation space
│       ├── ai.js           ← AI tools (extract tasks, write assistant)
│       ├── settings.js     ← Settings panel
│       ├── spaces.js       ← Spaces system
│       ├── academic.js     ← Academic space (flashcards, quizzes)
│       ├── agents.js       ← Agent/template marketplace
│       └── notifications.js← In-app notification bell
│
├── css/
│   ├── styles.css          ← Full stylesheet (5,700 lines — monolith, partially split)
│   ├── README.md           ← Documents all sections and how to split
│   └── base/
│       └── variables.css   ← CSS design tokens (already extracted)
│
├── templates/
│   ├── index.html          ← Main SPA (the entire frontend HTML)
│   ├── admin.html          ← Admin panel
│   └── lecturer.html       ← Lecturer panel
│
├── static/                 ← Static files: images, favicon, manifest
├── mobile/                 ← Expo React Native app
├── data/                   ← JSON file storage (fallback when DB unavailable)
├── uploads/                ← User-uploaded files
│
├── CODEBASE.md             ← This file
├── CHANGES.md              ← Recent change log + setup guide
├── SIVARR_PRODUCT_ROADMAP.md ← Full product roadmap
├── requirements.txt        ← Python dependencies
├── Procfile                ← Railway start command
└── railway.toml            ← Railway build config
```

---

## How the Python backend works

### Request lifecycle
```
Browser → Railway → FastAPI app (app.py)
  → Middleware (CORS, Sentry, rate limiting)
  → Router (routes/billing.py, routes/chat.py, etc.)
  → Handler function
    → utils/auth.py      (verify token)
    → utils/helpers.py   (sanitize input)
    → utils/storage.py   (load_progress / save_progress)
    → database.py        (PostgreSQL queries)
    → utils/email.py     (send email if needed)
  → JSON response
```

### Adding a new API endpoint
1. Find the right router file in `routes/`
2. Import what you need from `utils/` and `config.py`
3. Add the route with `@router.post("/api/your-endpoint")`
4. If it's a new router file, `include_router()` it in `app.py`

### Authentication pattern (every protected route does this)
```python
from utils.auth import get_session_from_token
from fastapi import HTTPException

sess = get_session_from_token(data.get("token",""))
if not sess:
    raise HTTPException(401, "Invalid session.")
sid  = sess["sid"]
name = sess.get("name","")
```

### Rate limiting pattern
```python
from utils.rate_limit import check_rate_limit, get_client_key

check_rate_limit(get_client_key(request), limit=20, endpoint="feature_name")
```

### Storage pattern
```python
from utils.storage import load_progress, save_progress

p = load_progress(sid)
p["some_key"] = new_value
save_progress(sid, p)
```

---

## How the frontend works

### Technology
- Vanilla JavaScript (no framework, no build step required)
- HTML panels — each `<div class="panel" id="panel-chat">` is a full-screen view
- CSS custom properties for theming
- Service worker for PWA/offline support

### Navigation
`nav('chat')` in JS hides all panels and shows `panel-chat`. Every nav call goes through this function.

### Global state (`S` object)
```javascript
S = {
  sid:       "user-session-id",
  name:      "Nonso",
  email:     "nonso@example.com",
  plan:      "free",        // "free" | "pro" | "team"
  topics:    [...],         // studied topics
  // ... more fields
}
```

### API calls from JS
```javascript
const result = await API('/api/some-endpoint', { token, ...payload });
// API() is defined in core/api.js — handles auth token injection automatically
```

### Adding a new feature panel
1. Add `<div class="panel" id="panel-yourfeature">` to `templates/index.html`
2. Add CSS in `css/styles.css` (or a new component file)
3. Add JS function `yourFeatureInit()` called from `nav()` in app.js
4. Add sidebar button in the nav section of index.html

---

## Key environment variables

Set all of these in Railway → your service → Variables:

| Variable | Purpose | Required? |
|---|---|---|
| `BASE_URL` | Full app URL (no trailing slash) | YES |
| `ADMIN_PASSWORD` | Admin panel password | YES |
| `GOOGLE_API_KEY` | Gemini AI | YES |
| `RESEND_API_KEY` | Email sending | YES |
| `RESEND_FROM_EMAIL` | "From" address in emails | YES |
| `PAYSTACK_SECRET_KEY` | Payment processing | For billing |
| `PAYSTACK_PUBLIC_KEY` | Frontend Paystack init | For billing |
| `GOOGLE_CLIENT_ID` | Google OAuth | For Google login |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | For Google login |
| `GITHUB_CLIENT_ID` | GitHub OAuth | For GitHub integration |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth | For GitHub integration |
| `DATABASE_URL` | PostgreSQL connection string | YES (Railway auto-sets) |
| `SENTRY_DSN` | Error tracking | Recommended |
| `STRIPE_SECRET_KEY` | Agent marketplace payments | For agent marketplace |

---

## Running locally

```bash
# Install Python dependencies
pip install -r requirements.txt

# Set environment variables (copy .env.example → .env)
cp .env.example .env
# Edit .env with your values

# Start the server
uvicorn app:app --reload --port 8000

# Open http://localhost:8000
```

---

## Deployment (Railway)

Every push to `main` triggers a Railway auto-deploy:
1. Railway runs `pip install -r requirements.txt`
2. Starts `uvicorn app:app --host 0.0.0.0 --port $PORT` (from Procfile)
3. Health check at `/health`

---

## Key files for common tasks

| Task | File to edit |
|---|---|
| Change AI prompt | `config.py` → `SYSTEM_PROMPT` |
| Add a new subscription plan | `config.py` → `SIVARR_PLANS` |
| Change billing logic | `routes/billing.py` (currently in `app.py` at line 5660+) |
| Change email template | `utils/email.py` |
| Add a new feature panel | `templates/index.html` + `css/styles.css` + `js/app.js` |
| Change rate limits | `config.py` → `RATE_LIMIT_*` constants |
| Add a new org feature | `routes/org.py` + `js/features/org.js` |
| Debug a 401 error | Check `utils/auth.py` → `get_session_from_token()` |
| Debug a payment issue | `routes/billing.py` + Railway logs |

---

## Status of the split (as of June 2026)

| File | Status |
|---|---|
| `config.py` | ✅ Complete — all constants extracted |
| `models.py` | ✅ Complete — all Pydantic models extracted |
| `utils/auth.py` | ✅ Complete |
| `utils/email.py` | ✅ Complete — all email templates extracted |
| `utils/storage.py` | ✅ Complete — all storage functions extracted |
| `utils/rate_limit.py` | ✅ Complete |
| `utils/helpers.py` | ✅ Complete — sanitize, validate, Gemini calls |
| `routes/__init__.py` | ✅ Complete — documents all URL ownership |
| `routes/billing.py` | 🔄 In progress — handlers in app.py lines 5660–5900 |
| `routes/community.py` | 🔄 In progress — handlers in app.py lines 5833–5970 |
| `routes/ai.py` | 🔄 In progress — handlers in app.py lines 5137–5280 |
| `routes/auth.py` | 🔄 In progress — handlers in app.py lines 1455–1730 |
| `routes/org.py` | 🔄 In progress — handlers in app.py lines 4486–5060 |
| `routes/academic.py` | 🔄 In progress — handlers in app.py lines 2651–3590 |
| `routes/admin.py` | 🔄 In progress — handlers in app.py lines 2196–2530 |
| `routes/pages.py` | 🔄 In progress — handlers in app.py lines 1403–1450 |
| `app.py` | 🔄 Transitional — still contains all handlers pending route extraction |
| `js/core/*.js` | 📋 Mapped in js/core/README.md — pending extraction from app.js |
| `js/features/*.js` | 📋 Mapped in js/features/README.md — pending extraction from app.js |
| `css/base/variables.css` | ✅ Complete — design tokens extracted |
| `css/components/` | 📋 Mapped in css/README.md — pending extraction from styles.css |
