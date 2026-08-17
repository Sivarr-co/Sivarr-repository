from fastapi import APIRouter, HTTPException

import database as db
from core import get_session_from_token, sanitize_text

router = APIRouter()


@router.post("/api/skills/sync")
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


@router.get("/api/skills/restore")
async def restore_skills(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    blob = db.get_user_blob(sid, "skills") if db.is_available() else {}
    return {"skills": (blob or {}).get("skills", [])}
