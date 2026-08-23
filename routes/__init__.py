# routes/ — FastAPI APIRouter modules
#
# Each file owns one domain. Import the router and include it in app.py:
#
#   from routes.billing  import router as billing_router
#   app.include_router(billing_router)
#
# Route file  → Endpoints it owns
# ─────────────────────────────────────────────────────────────────
# pages.py        / (index), /admin, /sw.js, /billing/callback, /api/config, /api/health
# auth.py         /api/login, /api/session/restore, /api/logout, /api/auth/*
# oauth.py        /auth/google/*, /auth/github/*
# billing.py      /api/billing/*, /api/payments/*
# chat.py         /api/chat, /api/quiz/*, /api/suggest, /api/progress, /api/difficulty
# community.py    /api/community/*, /api/opportunities, /api/profile/*
# ai.py           /api/ai/*, /api/home/brief
# files.py        /api/upload, /api/share, /share/*
# org.py          /api/org/*
# academic.py     /api/acad/*                                   (implemented)
# admin.py        /api/admin/*
# integrations.py /api/integrations/*, /api/integrations/mono/*
# notifications.py /api/notify/*
# tasks.py        / /api/tasks/*, /api/import/tasks   (implemented)
# habits.py       / /api/habits/*                       (implemented)
# docs_notes.py   / /api/docs/*, /api/import/notes      (implemented)
