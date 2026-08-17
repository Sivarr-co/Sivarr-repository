import datetime
import uuid

from fastapi import APIRouter, HTTPException

from core import get_session_from_token, sanitize_text, _load_user_list, _save_user_list, _resolve_token

router = APIRouter()


# ── Personal goals — server-side mirror ────────────────────────────────────
def load_goals(sid: str) -> list:
    return _load_user_list(sid, "goals")

def save_goals(sid: str, goals: list):
    _save_user_list(sid, "goals", goals)


@router.get("/api/goals")
async def get_goals(sid: str = "", token: str = ""):
    # Auth is by session token only; the `sid` query param is ignored (IDOR fix).
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    # Soft-deleted goals stay in storage (see delete_goal below) but never show
    # up in the normal list — only in /api/goals/trash.
    goals = [g for g in load_goals(sess["sid"]) if not g.get("deleted_at")]
    return {"goals": goals}


@router.get("/api/goals/trash")
async def get_goals_trash(token: str = ""):
    sess = get_session_from_token(sanitize_text(token, 100)) if token else None
    if not sess:
        raise HTTPException(401, "Invalid session.")
    trashed = [g for g in load_goals(sess["sid"]) if g.get("deleted_at")]
    trashed.sort(key=lambda g: g.get("deleted_at", ""), reverse=True)
    return {"goals": trashed}


@router.post("/api/goals/add")
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


@router.post("/api/goals/update")
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


@router.post("/api/goals/delete")
async def delete_goal(data: dict):
    """Soft delete — marks the goal deleted_at instead of removing it, so it
    can be recovered from Trash for 30 days. Actually purged by the
    _purge_deleted_goals background job in app.py."""
    sid, _  = _resolve_token(data)
    goal_id = sanitize_text(str(data.get("id","")), 20)
    goals   = load_goals(sid)
    for g in goals:
        if g["id"] == goal_id:
            g["deleted_at"] = datetime.datetime.utcnow().isoformat()
            break
    save_goals(sid, goals)
    return {"ok": True}


@router.post("/api/goals/restore")
async def restore_goal(data: dict):
    sid, _  = _resolve_token(data)
    goal_id = sanitize_text(str(data.get("id","")), 20)
    goals   = load_goals(sid)
    for g in goals:
        if g["id"] == goal_id:
            g["deleted_at"] = None
            break
    save_goals(sid, goals)
    return {"ok": True}


@router.post("/api/goals/edit")
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
    return round(sum(pcts) / len(krs))


@router.post("/api/goals/kr/add")
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


@router.post("/api/goals/kr/update")
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


@router.post("/api/goals/kr/delete")
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


@router.post("/api/import/goals")
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
