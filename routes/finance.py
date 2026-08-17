from fastapi import APIRouter, HTTPException

import database as db
from core import DATA_DIR, get_session_from_token, sanitize_text, _load_json_file, _save_json_file

router = APIRouter()


@router.post("/api/finance/sync")
async def sync_finance(data: dict):
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid     = sess["sid"]
    payload = data.get("data", {})
    if not isinstance(payload, dict):
        raise HTTPException(400, "data must be an object.")
    txs     = payload.get("transactions", [])
    budgets = payload.get("budgets", {})
    clean_txs = [
        {
            "id":       sanitize_text(str(t.get("id", "")), 30),
            "type":     sanitize_text(str(t.get("type", "expense")), 10),
            "amount":   float(t.get("amount", 0)),
            "category": sanitize_text(str(t.get("category", "other")), 30),
            "note":     sanitize_text(str(t.get("note", "")), 200),
            "date":     sanitize_text(str(t.get("date", "")), 20),
        }
        for t in (txs if isinstance(txs, list) else [])[:2000]
    ]
    clean_budgets = { sanitize_text(str(k), 30): float(v) for k, v in (budgets if isinstance(budgets, dict) else {}).items() if v }
    blob = {"transactions": clean_txs, "budgets": clean_budgets}
    if db.is_available():
        db.save_user_blob(sid, "finance", blob)
    else:
        _save_json_file(DATA_DIR / f"finance_{sid}.json", blob)
    return {"ok": True, "synced": len(clean_txs)}


@router.get("/api/finance/restore")
async def restore_finance(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid  = sess["sid"]
    blob = db.get_user_blob(sid, "finance") if db.is_available() else _load_json_file(DATA_DIR / f"finance_{sid}.json", {})
    return {"ok": True, "data": blob or {"transactions": [], "budgets": {}}}
