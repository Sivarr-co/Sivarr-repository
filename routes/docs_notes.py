import datetime
import json
import re as _re

from fastapi import APIRouter, HTTPException

from core import get_session_from_token, sanitize_text, save_json, DATA_DIR

router = APIRouter()


# ── Personal docs — server-side mirror of localStorage ────────────────────────
def load_docs(sid: str) -> list:
    p = DATA_DIR / f"{sid}_docs.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

def save_docs(sid: str, docs: list):
    p = DATA_DIR / f"{sid}_docs.json"
    save_json(p, docs)

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
        clean.append({
            "id":       sanitize_text(str(d.get("id", "")),    50),
            "title":    sanitize_text(str(d.get("title", "")), 200),
            "content":  text_only,
            "updated":  sanitize_text(str(d.get("updated", "")), 30),
            # Soft delete — see routes/tasks.py's identical field for the full
            # rationale (client sets this instead of removing the row).
            "deleted_at": sanitize_text(str(d.get("deleted_at","") or ""), 30) or None,
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
