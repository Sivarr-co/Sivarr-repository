"""
Personal tasks.

WHY THIS FILE HAS TWO STORAGE PATHS
------------------------------------
Tasks moved from one JSONB blob per user (user_blobs, key='tasks') to a real
Postgres table (one row per task — see database.py's `tasks` DDL and its
get_task/create_task/update_task/soft_delete_task/undelete_task/
replace_all_tasks/purge_expired_tasks functions) so a single-field edit no
longer has to re-upload and rewrite a user's entire task list. That's a
Postgres-specific capability: when no database is configured (local dev,
JSON-file fallback), there's no equivalent "real table," so this file falls
back to the exact blob-of-one-list behavior it always had via
_load_user_list/_save_user_list. Every endpoint below branches on
`db.is_available()` for this reason — the DB branch does true per-row SQL,
the fallback branch does read-modify-write on the one JSON blob.

MIGRATION
---------
Existing users' data lives in the old user_blobs blob (or a legacy per-sid
JSON file, one level further back — _load_user_list already knows how to find
that). `load_tasks()` below lazily migrates a user's blob into the new table
the first time it's read post-deploy: if the table has zero rows for that sid
but the old blob has data, it's copied in via replace_all_tasks() and never
consulted again. Same lazy-on-first-read shape _load_user_list itself already
uses one layer down (JSON file -> blob) — this is that same pattern applied
one more time (blob -> table).
"""

import datetime as _dt
import uuid

from fastapi import APIRouter, HTTPException

import database as db
from core import get_session_from_token, _resolve_token, sanitize_text, _load_user_list, _save_user_list

router = APIRouter()

_RECUR_INTERVALS = {
    "daily":   _dt.timedelta(days=1),
    "weekly":  _dt.timedelta(weeks=1),
    "monthly": _dt.timedelta(days=30),
}

def _s(v, maxlen: int) -> str:
    """None-safe sanitize_text. str(None) is the literal text "None", not "" —
    without this, a client explicitly clearing a field with JSON null (e.g.
    unassigning a task: {"assignee": null}) would store the four characters
    "None" instead of an empty value. Caught via a live HTTP round trip
    against a real database, where a freshly-created task's recurrence field
    came back as the string "None" instead of JSON null."""
    return sanitize_text(str(v), maxlen) if v is not None else ""


# Every real task field, and how to sanitize one incoming value for it.
# Shared by full-object cleaning (create/replace-all) and partial-update
# cleaning (only the keys actually present in a request) so the two paths
# can't drift out of sync with different length limits or types.
_TASK_FIELD_SANITIZERS = {
    "title":              lambda v: _s(v, 200),
    "status":             lambda v: _s(v, 20),
    "done":               lambda v: bool(v),
    "date":               lambda v: _s(v, 20),
    "time":               lambda v: _s(v, 10),
    "priority":           lambda v: _s(v, 20),
    "type":               lambda v: _s(v, 30),
    "goal_id":            lambda v: _s(v, 50),
    "parent_id":          lambda v: _s(v, 50),
    "recurrence":         lambda v: _s(v, 20) or None,
    "recurrence_spawned": lambda v: bool(v),
    # Fields the old whole-array sync silently dropped every save (its
    # per-item rebuild whitelist never included them, even though the
    # client's modal/detail-panel UI has always written them onto the local
    # task object) — real columns now, closing that gap as part of this
    # migration. attachName is the client's field name; attach_name is the
    # server column, mapped in _clean_partial below.
    "description":        lambda v: _s(v, 4000),
    "assignee":           lambda v: _s(v, 100),
    "summary":            lambda v: _s(v, 4000),
    "attach_name":        lambda v: _s(v, 200),
    "notes":              lambda v: _s(v, 4000),
    # Soft delete: an ISO timestamp string, or None if not deleted. The
    # client sets this instead of removing the task from the array so a
    # sync doesn't permanently destroy it — see js/features/tasks.js's
    # deleteSHTask()/restoreSHTask() and the Trash panel.
    "deleted_at":         lambda v: _s(v, 30) or None,
}

_TASK_DEFAULTS = {
    "title": "", "status": "todo", "done": False, "date": "", "time": "",
    "priority": "normal", "type": "other", "goal_id": "", "parent_id": "",
    "recurrence": None, "recurrence_spawned": False,
    "description": "", "assignee": "", "summary": "", "attach_name": "",
    "notes": "", "deleted_at": None,
}

# The client (js/features/tasks.js) uses its own field names for a few
# columns — desc/goalId/attachName rather than description/goal_id/
# attach_name. Accepted here so /api/tasks/sync (still fed raw localStorage
# task objects for CSV import and full-resync) and the per-entity endpoints
# both take either spelling without silently dropping the field.
_CLIENT_FIELD_ALIASES = {
    "desc": "description",
    "goalId": "goal_id",
    "attachName": "attach_name",
}


def _clean_partial(fields: dict) -> dict:
    """Sanitize only the keys present in `fields` — the partial-update shape.
    Unknown keys are silently dropped (whitelist, not blacklist)."""
    out = {}
    for k, v in fields.items():
        key = _CLIENT_FIELD_ALIASES.get(k, k)
        sanitizer = _TASK_FIELD_SANITIZERS.get(key)
        if sanitizer:
            out[key] = sanitizer(v)
    return out


def _clean_task(t: dict) -> dict:
    """Full-object sanitize, every field present with a safe default — for
    create and whole-array-replace paths."""
    merged = {**_TASK_DEFAULTS, **t}
    result = {"id": sanitize_text(str(t.get("id","")), 50)}
    result.update(_clean_partial(merged))
    return result


def _spawn_next_occurrence(t: dict) -> dict | None:
    """If `t` is a just-completed, not-yet-spawned recurring task, build its
    next occurrence. Returns None if nothing should spawn. Pure — caller is
    responsible for persisting both the returned task and marking `t`'s own
    recurrence_spawned=True."""
    if not (t.get("done")
            and t.get("recurrence") and t["recurrence"] not in ("", "none", None)
            and not t.get("recurrence_spawned")
            and not t.get("deleted_at")
            and t.get("date")):
        return None
    interval = _RECUR_INTERVALS.get(t["recurrence"])
    if not interval:
        return None
    try:
        base_due = _dt.date.fromisoformat(t["date"])
    except ValueError:
        return None
    new_due = str(base_due + interval)
    new_id  = f"rec_{t['id']}_{int(_dt.datetime.utcnow().timestamp() * 1000)}"
    return {
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
    }


# ── Compatibility layer — used by every other reader in app.py (weekly
# review, Home briefing, the daily digest email, /api/export, unified search)
# via `from routes.tasks import load_tasks, save_tasks`. Keeping this contract
# identical (sid in, list of dicts out) meant none of those callers needed to
# change for this migration. ──────────────────────────────────────────────

def load_tasks(sid: str) -> list:
    if not db.is_available():
        return _load_user_list(sid, "tasks")
    existing = db.get_tasks(sid, include_deleted=True)
    if not existing:
        legacy = _load_user_list(sid, "tasks")
        if legacy:
            db.replace_all_tasks(sid, [_clean_task(t) for t in legacy])
            return db.get_tasks(sid, include_deleted=True)
    return existing

def save_tasks(sid: str, tasks: list):
    if not db.is_available():
        _save_user_list(sid, "tasks", tasks)
        return
    db.replace_all_tasks(sid, [_clean_task(t) for t in tasks])


@router.post("/api/tasks/sync")
async def sync_tasks(data: dict):
    """Bulk-sync personal tasks from client localStorage to server. Kept for
    CSV import and as a full-resync fallback — live single-task edits go
    through the per-entity endpoints below instead."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid   = sess["sid"]
    tasks = data.get("tasks", [])
    if not isinstance(tasks, list):
        raise HTTPException(400, "tasks must be a list.")
    clean = [_clean_task(t) for t in tasks[:500]]

    # ── Recurring task spawn ──────────────────────────────────────────────
    new_occurrences = []
    for t in clean:
        spawned = _spawn_next_occurrence(t)
        if spawned:
            new_occurrences.append(spawned)
            t["recurrence_spawned"] = True  # prevent re-creation on next sync

    clean.extend(new_occurrences)
    save_tasks(sid, clean)
    spawned_ids = [o["id"] for o in new_occurrences]
    return {"ok": True, "count": len(clean), "spawned": spawned_ids}


@router.get("/api/tasks/restore")
async def restore_tasks(token: str = ""):
    """Return the server-stored task list — cross-device pull, and used
    after a sync spawns a new recurring occurrence to refresh local state.
    Same data as GET /api/tasks; kept as a separate name since existing
    clients already call it."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"tasks": [t for t in load_tasks(sess["sid"]) if not t.get("deleted_at")]}


@router.get("/api/tasks")
async def list_tasks(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"tasks": [t for t in load_tasks(sess["sid"]) if not t.get("deleted_at")]}


@router.get("/api/tasks/trash")
async def list_trashed_tasks(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    if db.is_available():
        trashed = db.get_trashed_tasks(sid)
    else:
        trashed = [t for t in load_tasks(sid) if t.get("deleted_at")]
    trashed.sort(key=lambda t: str(t.get("deleted_at") or ""), reverse=True)
    return {"tasks": trashed}


@router.post("/api/tasks/add")
async def add_task(data: dict):
    sid, _ = _resolve_token(data)
    title = sanitize_text(str(data.get("title", "")), 200).strip()
    if not title:
        raise HTTPException(400, "Task title required.")
    task = _clean_task(data)
    task["id"] = task["id"] or uuid.uuid4().hex[:20]
    task["title"] = title

    if db.is_available():
        ok = db.create_task(sid, task["id"], title, **{k: v for k, v in task.items() if k not in ("id", "title")})
        if not ok:
            raise HTTPException(500, "Failed to create task.")
    else:
        tasks = _load_user_list(sid, "tasks")
        tasks.append(task)
        _save_user_list(sid, "tasks", tasks)
    return {"ok": True, "task": task}


@router.post("/api/tasks/update")
async def update_task_endpoint(data: dict):
    """Partial update — only the fields present in `data` are changed. If the
    update marks a recurring task done for the first time, the response
    includes the newly-spawned next occurrence under "spawned" (or null),
    replacing the old flow where the client re-fetched the entire list after
    every sync to notice a spawn."""
    sid, _ = _resolve_token(data)
    task_id = sanitize_text(str(data.get("id", "")), 50)
    if not task_id:
        raise HTTPException(400, "Task id required.")
    cleaned = _clean_partial({k: v for k, v in data.items() if k not in ("token", "id")})
    if not cleaned:
        return {"ok": True, "spawned": None}

    spawned = None
    if db.is_available():
        current = db.get_task(task_id, sid)
        if not current:
            raise HTTPException(404, "Task not found.")
        merged = {**current, **cleaned}
        spawned = _spawn_next_occurrence(merged)
        if spawned:
            cleaned["recurrence_spawned"] = True  # fold into the one update below
        ok = db.update_task(task_id, sid, cleaned)
        if not ok:
            raise HTTPException(500, "Failed to update task.")
        if spawned:
            db.create_task(sid, spawned["id"], spawned["title"],
                            **{k: v for k, v in spawned.items() if k not in ("id", "title")})
    else:
        tasks = _load_user_list(sid, "tasks")
        current = next((t for t in tasks if t.get("id") == task_id), None)
        if not current:
            raise HTTPException(404, "Task not found.")
        current.update(cleaned)
        spawned = _spawn_next_occurrence(current)
        if spawned:
            current["recurrence_spawned"] = True
            tasks.append(spawned)
        _save_user_list(sid, "tasks", tasks)

    return {"ok": True, "spawned": spawned}


@router.post("/api/tasks/delete")
async def delete_task(data: dict):
    """Soft delete — sets deleted_at instead of removing the row, so it can
    be recovered from Trash for 30 days. Purged by the scheduled
    _purge_deleted_tasks job in app.py (mirrors _purge_deleted_goals)."""
    sid, _ = _resolve_token(data)
    task_id = sanitize_text(str(data.get("id", "")), 50)
    if not task_id:
        raise HTTPException(400, "Task id required.")
    if db.is_available():
        db.soft_delete_task(task_id, sid)
    else:
        tasks = _load_user_list(sid, "tasks")
        for t in tasks:
            if t.get("id") == task_id:
                t["deleted_at"] = _dt.datetime.utcnow().isoformat()
                break
        _save_user_list(sid, "tasks", tasks)
    return {"ok": True}


@router.post("/api/tasks/undelete")
async def undelete_task_endpoint(data: dict):
    sid, _ = _resolve_token(data)
    task_id = sanitize_text(str(data.get("id", "")), 50)
    if not task_id:
        raise HTTPException(400, "Task id required.")
    if db.is_available():
        db.undelete_task(task_id, sid)
    else:
        tasks = _load_user_list(sid, "tasks")
        for t in tasks:
            if t.get("id") == task_id:
                t["deleted_at"] = None
                break
        _save_user_list(sid, "tasks", tasks)
    return {"ok": True}


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
