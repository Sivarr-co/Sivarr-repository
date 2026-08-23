"""
Notion export importer.

Notion's "Export" produces a mix of .md files (one per page) and .csv files
(one per database view). Rather than reimplementing doc/task creation, this
module classifies each uploaded file by extension and hands it straight to
the existing single-purpose importers: routes.docs_notes.import_notes for
markdown pages, routes.tasks.import_tasks for CSV databases. Those are plain
async functions, not HTTP-only handlers, so they're called in-process here —
no round trip, no duplicated sanitization/storage logic.
"""

import csv
import io
import re

from fastapi import APIRouter, HTTPException

from core import get_session_from_token
from routes.docs_notes import import_notes
from routes.tasks import import_tasks

router = APIRouter()

# Notion appends a 32-char hex export id to every filename, e.g.
# "Project Plan 1a2b3c4d5e6f7890abcd1234ef567890.md" — strip it so the
# imported doc's title is the page title a human actually gave it.
_EXPORT_ID_RE = re.compile(r"\s+[0-9a-f]{32}$", re.IGNORECASE)

_DONE_WORDS = {"done", "complete", "completed", "finished", "yes", "true", "checked"}


def _notion_csv_to_task_rows(text: str) -> list:
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        title = (r.get("Name") or r.get("Title") or next(iter(r.values()), "") or "").strip()
        if not title:
            continue
        status = (r.get("Status") or r.get("Done") or "").strip()
        date = (r.get("Due Date") or r.get("Date") or r.get("Due") or "").split("→")[0].strip()
        rows.append({
            "title":    title,
            "status":   status or "todo",
            "done":     status.lower() in _DONE_WORDS,
            "date":     date,
            "priority": (r.get("Priority") or "normal").strip(),
        })
    return rows


@router.post("/api/import/notion")
async def import_notion(data: dict):
    token = data.get("token", "")
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")

    files = data.get("files", [])
    if not isinstance(files, list) or not files:
        raise HTTPException(400, "files must be a non-empty list.")

    docs_imported = 0
    tasks_imported = 0

    for f in files[:50]:
        filename = str(f.get("filename", "")).strip()
        content = str(f.get("content", ""))
        if not filename or not content.strip():
            continue

        if filename.lower().endswith(".csv"):
            rows = _notion_csv_to_task_rows(content)
            if rows:
                result = await import_tasks({"token": token, "tasks": rows})
                tasks_imported += result["imported"]
        elif filename.lower().endswith(".md"):
            clean_name = _EXPORT_ID_RE.sub("", filename[:-3]).strip() or "Imported note"
            await import_notes({"token": token, "markdown": content, "filename": clean_name})
            docs_imported += 1

    return {"ok": True, "docs_imported": docs_imported, "tasks_imported": tasks_imported}
