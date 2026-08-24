"""
Trello / Asana export importer.

Follows routes/import_notion.py exactly: classify each uploaded file by
extension and hand it straight to the existing routes.tasks.import_tasks —
no duplicated sanitization/storage logic, no new task-creation path.

Trello exports a single board as JSON (Menu -> More -> Print and Export ->
Export JSON): {"lists": [{"id","name",...}], "cards": [{"name","idList",
"due","closed",...}]}. A card's list membership becomes its status; the
list name is also checked against the same "looks done" word set
import_notion.py uses, since Trello (unlike Asana) has no dedicated
completion timestamp to key off.

Asana exports a CSV per project (Project -> ... -> Export -> CSV) with
(at minimum) Name/Assignee/Due Date/Section/Column columns, plus a
Completed At column that's non-empty exactly when the task is done — a
more reliable completion signal than word-matching, so it's preferred here.

Neither format's Assignee/Section carries through to a stored field beyond
`status` — routes.tasks.import_tasks's row schema (title/status/done/date/
time/priority/type/goal_id) has no assignee column, and extending it is
out of this module's scope (see routes/tasks.py's own per-entity endpoints
if that's ever wanted); this matches import_notion.py's own CSV import,
which drops columns the target schema has no slot for.
"""

import csv
import io
import json

from fastapi import APIRouter, HTTPException

from core import get_session_from_token
from routes.tasks import import_tasks

router = APIRouter()

_DONE_WORDS = {"done", "complete", "completed", "finished", "closed", "shipped"}


def _trello_json_to_task_rows(text: str) -> list:
    try:
        board = json.loads(text)
    except (ValueError, TypeError):
        return []
    if not isinstance(board, dict):
        return []

    lists = board.get("lists") or []
    list_names = {l.get("id"): str(l.get("name", "")).strip() for l in lists if isinstance(l, dict)}

    rows = []
    for c in board.get("cards") or []:
        if not isinstance(c, dict):
            continue
        title = str(c.get("name", "")).strip()
        if not title:
            continue
        list_name = list_names.get(c.get("idList"), "")
        # Trello's `due` is a full ISO timestamp ("2026-01-15T00:00:00.000Z")
        # or null; import_tasks wants just the date portion.
        due = str(c.get("due") or "").split("T")[0]
        rows.append({
            "title":    title,
            "status":   list_name or "todo",
            "done":     list_name.lower() in _DONE_WORDS,
            "date":     due,
            "priority": "normal",
        })
    return rows


def _asana_csv_to_task_rows(text: str) -> list:
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        # Unlike Notion's CSV (where the title column name genuinely varies
        # by database view), Asana's export always has a real "Name" column
        # — no need for import_notion.py's `next(iter(r.values()))` catch-
        # all, which would otherwise pick up "Task ID" or whatever column
        # happens to be first and give an empty-name row a bogus title.
        title = (r.get("Name") or r.get("Title") or "").strip()
        if not title:
            continue
        section = (r.get("Section/Column") or r.get("Section") or "").strip()
        completed_at = (r.get("Completed At") or "").strip()
        rows.append({
            "title":    title,
            "status":   section or "todo",
            "done":     bool(completed_at),
            "date":     (r.get("Due Date") or r.get("Due") or "").strip(),
            "priority": "normal",
        })
    return rows


@router.post("/api/import/trello")
async def import_trello(data: dict):
    token = data.get("token", "")
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")

    files = data.get("files", [])
    if not isinstance(files, list) or not files:
        raise HTTPException(400, "files must be a non-empty list.")

    tasks_imported = 0

    for f in files[:50]:
        filename = str(f.get("filename", "")).strip()
        content = str(f.get("content", ""))
        if not filename or not content.strip():
            continue

        if filename.lower().endswith(".json"):
            rows = _trello_json_to_task_rows(content)
        elif filename.lower().endswith(".csv"):
            rows = _asana_csv_to_task_rows(content)
        else:
            continue

        if rows:
            result = await import_tasks({"token": token, "tasks": rows})
            tasks_imported += result["imported"]

    return {"ok": True, "tasks_imported": tasks_imported}
