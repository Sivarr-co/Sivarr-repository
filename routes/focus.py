"""
Focus sessions (Pomodoro-style timer log) — mobile-only for now.

Session 2's mobile sync pass wired Today/Habits/Journal to the server but
deliberately left FocusScreen local-only (AsyncStorage), since no
/api/focus endpoint existed. This is that endpoint.

Unlike routes/habits.py's dedicated Postgres table, a focus session is an
append-only historical log entry, not a live entity with fields that get
edited after creation (a completed 25-minute session doesn't change) --
there's nothing to justify a real schema migration for. Rides the generic
`collections` table (database.py, PRIMARY KEY (collection, item_id)) via
db.coll_put/coll_list, same pattern routes/marketplace.py already uses for
its own simple per-user records (mkt_installs/mkt_reviews/mkt_listings),
in a "focus_sessions" namespace, item_id = "{sid}:{uuid}" so ids can't
collide across users in the shared collection.

No update/delete endpoints: nothing about a logged session is ever edited,
and a correction/removal affordance wasn't asked for -- add later if
Hunter wants one, following routes/habits.py's soft-delete shape as the
model then, not this file's.

Postgres-only, same as org.py/academic.py -- collections has no JSON-file
fallback. Both endpoints check db.is_available() up front and raise 503
rather than letting coll_put/coll_list's own silent no-op-when-no-connection
behavior through: coll_put returns None either way, so without this check
add_focus_session would return {"ok": True} for a write that never happened
-- a real bug this had (caught by actually round-tripping add-then-list
locally, where no DATABASE_URL is set, not by reading the code) before this
check was added. Matches routes/org.py's own `if not db.is_available():
raise HTTPException(503, ...)` convention exactly, not a new one.
"""

import uuid

from fastapi import APIRouter, HTTPException

import database as db
from core import get_session_from_token, _resolve_token, sanitize_text

router = APIRouter()


@router.get("/api/focus")
async def list_focus_sessions(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    sid = sess["sid"]
    # coll_list only returns each row's `data` blob (see database.py) --
    # item_id/owner aren't in it, so id has to be stored inside data itself
    # (same reason routes/marketplace.py's mkt_listings does "id": lid).
    rows = db.coll_list("focus_sessions", owner=sid)
    sessions = [r for r in rows if r.get("id")]
    sessions.sort(key=lambda s: s.get("date", ""), reverse=True)
    return {"sessions": sessions[:50]}


@router.post("/api/focus/add")
async def add_focus_session(data: dict):
    sid, _ = _resolve_token(data)
    if not db.is_available():
        raise HTTPException(503, "Database unavailable.")
    task = sanitize_text(str(data.get("task", "")).strip(), 200) or "Focus Session"
    date = sanitize_text(str(data.get("date", "")), 12)
    if not date:
        raise HTTPException(400, "date is required.")
    try:
        duration = max(0, int(data.get("duration", 0)))
    except (TypeError, ValueError):
        duration = 0

    session_id = uuid.uuid4().hex[:20]
    entry = {"id": session_id, "task": task, "duration": duration, "date": date}
    db.coll_put("focus_sessions", f"{sid}:{session_id}", entry, owner=sid)
    return {"ok": True, "session": entry}
