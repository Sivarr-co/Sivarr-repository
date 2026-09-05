import datetime
import re as _re

from fastapi import APIRouter, HTTPException

import database as db
from core import get_session_from_token, sanitize_text, _load_user_list, _save_user_list

router = APIRouter()


# ── Personal docs — server-side mirror of localStorage ────────────────────────
# Was DATA_DIR / f"{sid}_docs.json", unconditionally — a raw per-sid JSON file
# on local disk regardless of whether a database is configured, unlike
# Tasks/Goals/Journal which already went through _load_user_list/
# _save_user_list (DB-backed when available, JSON-file fallback otherwise).
# Found while scoping Pass 2 of the decomposition brief; a Railway persistent
# volume is confirmed mounted so this was never silently losing data on
# redeploy, but it's still a real single point of failure (no documented
# backup story for the volume itself, unlike Supabase) and an inconsistency
# with every other personal-space data type. Same storage swap as habits.py.
#
# Session 16: moved one layer further, off the user_blobs JSONB blob onto a
# real `docs` table (same migration tasks/habits/goals already went
# through), so docs can get real tsvector full-text search instead of an
# in-memory substring scan. sync_docs/restore_docs below are unchanged --
# they still only ever call load_docs()/save_docs(), same as before.
def load_docs(sid: str) -> list:
    if not db.is_available():
        return _load_user_list(sid, "docs")
    existing = db.get_docs(sid, include_deleted=True)
    if not existing:
        legacy = _load_user_list(sid, "docs")
        if legacy:
            db.replace_all_docs(sid, legacy)
            return db.get_docs(sid, include_deleted=True)
    return existing

def save_docs(sid: str, docs: list):
    if not db.is_available():
        _save_user_list(sid, "docs", docs)
        return
    db.replace_all_docs(sid, docs)

@router.post("/api/docs/sync")
async def sync_docs(data: dict):
    """Bulk-sync personal docs from client localStorage to server."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    docs = data.get("docs", [])
    if not isinstance(docs, list):
        raise HTTPException(400, "docs must be a list.")
    clean = []
    for d in docs[:200]:
        raw_content = str(d.get("content", ""))
        text_only   = _re.sub(r'<[^>]+>', ' ', raw_content)[:5000]
        # Public doc pages (GET /doc/{slug}) — slug is client-generated
        # (js/features/docs_notes.js's _docGenSlug), opaque, never derived
        # from title/content. Validated here since it's looked up globally
        # (not scoped by sid, see db.get_public_doc) — a malformed slug must
        # never silently become public with a value that doesn't round-trip.
        # public_slug MUST be None (SQL NULL), not "", when absent -- the
        # unique index (database.py) is a partial index that only excludes
        # NULL, so every never-published doc storing "" instead would
        # collide with every other one on the unique constraint the moment
        # a second such doc (any user, not just this one) got inserted.
        raw_slug = str(d.get("public_slug", "") or "")
        slug_ok  = bool(_re.fullmatch(r"[a-z0-9]{6,32}", raw_slug))
        clean.append({
            "id":       sanitize_text(str(d.get("id", "")),    50),
            "title":    sanitize_text(str(d.get("title", "")), 200),
            "content":  text_only,
            "updated":  sanitize_text(str(d.get("updated", "")), 30),
            # Soft delete — see routes/tasks.py's identical field for the full
            # rationale (client sets this instead of removing the row).
            "deleted_at": sanitize_text(str(d.get("deleted_at","") or ""), 30) or None,
            "is_public": bool(d.get("is_public")) and slug_ok,
            "public_slug": raw_slug if slug_ok else None,
        })
    save_docs(sid, clean)
    return {"ok": True, "count": len(clean)}

@router.get("/api/docs/restore")
async def restore_docs(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"docs": load_docs(sess["sid"])}


@router.post("/api/import/notes")
async def import_notes(data: dict):
    """Accept markdown text and create a doc from it."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid      = sess["sid"]
    markdown = sanitize_text(str(data.get("markdown", "")), 200000)
    filename = sanitize_text(str(data.get("filename", "Imported note")), 100)
    if not markdown.strip():
        raise HTTPException(400, "Empty content.")

    # Convert markdown to simple HTML for the doc editor
    lines    = markdown.split("\n")
    html_parts = []
    for line in lines:
        if line.startswith("### "): html_parts.append(f"<h3>{line[4:]}</h3>")
        elif line.startswith("## "): html_parts.append(f"<h2>{line[3:]}</h2>")
        elif line.startswith("# "):  html_parts.append(f"<h1>{line[2:]}</h1>")
        elif line.strip() == "---": html_parts.append("<hr>")
        elif line.strip():           html_parts.append(f"<p>{line}</p>")
    html_content = "\n".join(html_parts)

    existing = load_docs(sid)
    doc = {
        "id":      int(datetime.datetime.now().timestamp() * 1000),
        "title":   filename.replace(".md", ""),
        "content": html_content,
        "updated": int(datetime.datetime.now().timestamp() * 1000),
    }
    existing.insert(0, doc)
    save_docs(sid, existing)
    return {"ok": True, "doc_id": doc["id"]}
