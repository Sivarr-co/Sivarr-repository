import json

from fastapi import APIRouter, HTTPException

from core import get_session_from_token, sanitize_text, save_json, DATA_DIR

router = APIRouter()


# ── Personal habits — server-side mirror ──────────────────────
def load_habits(sid: str) -> list:
    p = DATA_DIR / f"{sid}_habits.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

def save_habits(sid: str, habits: list):
    p = DATA_DIR / f"{sid}_habits.json"
    save_json(p, habits)

@router.post("/api/habits/sync")
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
            # Soft delete — see routes/tasks.py's identical field for the full
            # rationale (client sets this instead of removing the row).
            "deleted_at":  sanitize_text(str(h.get("deleted_at","") or ""), 30) or None,
        })
    save_habits(sid, clean)
    return {"ok": True, "count": len(clean)}

@router.get("/api/habits/restore")
async def restore_habits(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"habits": load_habits(sess["sid"])}
