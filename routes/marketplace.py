"""
Marketplace persistence -- installed extensions/integrations, per-space
prefs, reviews, and creator listings for the simple install/uninstall side
of the Marketplace (the browse/discover Agent-template side lives in
routes/agents.py instead -- these are two independent systems that happen
to share the "Marketplace" label; zero function calls cross between them).

All state rides on the generic `collections` table (database.py) via
db.coll_get/coll_put/coll_list/coll_delete, in three namespaces:
  mkt_installs  (owner=sid, item_id="{sid}:{id}")
  mkt_reviews   (owner=item_id, item_id="{item}:{sid}")
  mkt_listings  (owner=sid, item_id=listing_id)

No app.py-resident closures needed (no load_progress/send_email/admin
checks) -- plain module-level router, like routes/tasks.py.
"""

import datetime
import uuid

from fastapi import APIRouter, HTTPException

import database as db
from core import sanitize_text, _resolve_token

router = APIRouter()


# ── Marketplace persistence (Postgres collections, per-user; token-gated) ──
#  mkt_installs  (owner=sid, item_id="{sid}:{id}")
#  mkt_reviews   (owner=item_id, item_id="{item}:{sid}")
#  mkt_listings  (owner=sid, item_id=listing_id)
@router.post("/api/marketplace/installed")
async def marketplace_installed(data: dict):
    sid, _ = _resolve_token(data)
    rows = db.coll_list("mkt_installs", owner=sid)
    return {"ok": True, "installed": [{"id": r.get("item_id"), "ts": r.get("ts", "")} for r in rows if r.get("item_id")]}


@router.post("/api/marketplace/install")
async def marketplace_install(data: dict):
    sid, _ = _resolve_token(data)
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    if iid:
        db.coll_put("mkt_installs", f"{sid}:{iid}",
                    {"item_id": iid, "sid": sid, "ts": datetime.datetime.utcnow().isoformat()}, owner=sid)
    return {"ok": True}


@router.post("/api/marketplace/uninstall")
async def marketplace_uninstall(data: dict):
    sid, _ = _resolve_token(data)
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    if iid:
        db.coll_delete("mkt_installs", f"{sid}:{iid}")
    return {"ok": True}


# ── Per-space marketplace prefs: which extensions/integrations are enabled for
#    each space. Persisted so they follow the user across devices (installs
#    already do). mkt_space_prefs (owner=sid, item_id="{sid}:{space_id}").
@router.post("/api/space/prefs/get")
async def space_prefs_get(data: dict):
    sid, _ = _resolve_token(data)
    prefs = {}
    for r in db.coll_list("mkt_space_prefs", owner=sid):
        spid = r.get("space_id")
        if spid:
            prefs[spid] = {"exts": r.get("exts", []) or [], "ints": r.get("ints", []) or []}
    return {"ok": True, "prefs": prefs}


@router.post("/api/space/prefs/set")
async def space_prefs_set(data: dict):
    sid, _ = _resolve_token(data)
    space_id = sanitize_text(str(data.get("space_id", "")), 60)
    if not space_id:
        raise HTTPException(400, "space_id is required.")
    rec = db.coll_get("mkt_space_prefs", f"{sid}:{space_id}") or {}
    rec["sid"] = sid
    rec["space_id"] = space_id
    if "exts" in data:
        rec["exts"] = [sanitize_text(str(x), 60) for x in (data.get("exts") or [])[:50] if str(x).strip()]
    if "ints" in data:
        rec["ints"] = [sanitize_text(str(x), 60) for x in (data.get("ints") or [])[:50] if str(x).strip()]
    rec.setdefault("exts", [])
    rec.setdefault("ints", [])
    db.coll_put("mkt_space_prefs", f"{sid}:{space_id}", rec, owner=sid)
    return {"ok": True}


@router.post("/api/marketplace/reviews/list")
async def marketplace_reviews_list(data: dict):
    _resolve_token(data)  # any signed-in user may read reviews
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    rows = sorted(db.coll_list("mkt_reviews", owner=iid), key=lambda r: r.get("ts", ""), reverse=True)
    return {"ok": True, "reviews": [{"author": r.get("author"), "rating": r.get("rating", 0),
                                     "body": r.get("body", ""), "date": r.get("date", "")} for r in rows]}


@router.post("/api/marketplace/reviews")
async def marketplace_review(data: dict):
    sid, name = _resolve_token(data)
    iid = sanitize_text(str(data.get("item_id", "")), 60)
    try:
        rating = max(1, min(5, int(data.get("rating", 0))))
    except Exception:
        rating = 0
    body = sanitize_text(str(data.get("body", "")), 2000)
    if not iid or not body or not rating:
        raise HTTPException(400, "item_id, rating (1-5) and body are required.")
    db.coll_put("mkt_reviews", f"{iid}:{sid}",
                {"item_id": iid, "sid": sid, "author": name, "rating": rating, "body": body,
                 "date": datetime.datetime.utcnow().strftime("%d %b %Y"),
                 "ts": datetime.datetime.utcnow().isoformat()}, owner=iid)
    return {"ok": True}


@router.post("/api/marketplace/my-listings")
async def marketplace_my_listings(data: dict):
    sid, _ = _resolve_token(data)
    return {"ok": True, "listings": db.coll_list("mkt_listings", owner=sid)}


@router.post("/api/marketplace/publish")
async def marketplace_publish(data: dict):
    """Queue a listing for Sivarr team review (stored; status=review)."""
    sid, name = _resolve_token(data)
    name_v = sanitize_text(str(data.get("name", "")), 120)
    if not name_v:
        raise HTTPException(400, "A listing name is required.")
    lid = uuid.uuid4().hex[:10]
    try:
        price = max(0, int(data.get("price", 0) or 0))
    except Exception:
        price = 0
    db.coll_put("mkt_listings", lid,
                {"id": lid, "sid": sid, "author": name, "type": sanitize_text(str(data.get("type", "extension")), 20),
                 "name": name_v, "description": sanitize_text(str(data.get("description", "")), 2000),
                 "category": sanitize_text(str(data.get("category", "")), 40),
                 "pricing": sanitize_text(str(data.get("pricing", "free")), 20), "price": price,
                 "repo_url": sanitize_text(str(data.get("repo_url", "")), 300),
                 "status": "review", "installs": 0, "rating": 0,
                 "ts": datetime.datetime.utcnow().isoformat()}, owner=sid)
    return {"ok": True, "message": "Submitted for review"}
