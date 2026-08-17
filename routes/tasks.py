import datetime as _dt
import uuid

from fastapi import APIRouter, HTTPException

from core import get_session_from_token, sanitize_text, _load_user_list, _save_user_list

router = APIRouter()


# ── Personal tasks — server-side mirror of localStorage ───────────────────────
def load_tasks(sid: str) -> list:
    return _load_user_list(sid, "tasks")

def save_tasks(sid: str, tasks: list):
    _save_user_list(sid, "tasks", tasks)

@router.post("/api/tasks/sync")
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

@router.get("/api/tasks/restore")
async def restore_tasks(token: str = ""):
    """Return the server-stored task list so the client can sync back after a spawn."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"tasks": load_tasks(sess["sid"])}


@router.post("/api/import/tasks")
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
