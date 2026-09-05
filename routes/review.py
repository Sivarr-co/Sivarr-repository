"""
Spaced repetition (review cards).

A real, server-authoritative SM-2-lite schedule (ease factor / interval /
repetitions / due date) shared by Study Deck's AI-generated flashcards and
cards a user creates from a Notes doc or a Journal entry (source_type/
source_id just record provenance -- a card never reads live content back
from its source, so an edited or deleted note/journal entry doesn't need to
touch its cards). The scheduling math lives here, not the client, so a
client can't just set its own due_date/ease and skip the queue.

Real Postgres table (database.py's review_cards) when available; a single
JSON blob (one list, via _load_user_list/_save_user_list) otherwise, same
fallback convention every other personal-data type in this app uses. Unlike
tasks/goals/habits there's no legacy blob to lazily migrate from -- this is
a brand-new feature with no pre-existing client-side data.
"""

import datetime
import uuid

from fastapi import APIRouter, HTTPException

import database as db
from core import get_session_from_token, sanitize_text, _load_user_list, _save_user_list

router = APIRouter()

_SOURCE_TYPES = {"custom", "note", "journal", "flashcard"}
_TODAY = lambda: datetime.date.today().isoformat()


def _sm2_next(card: dict, quality: str) -> dict:
    """SM-2-lite: a simplified SM-2 collapsed onto a 2-button (again/good)
    rating instead of the original's 0-5 quality scale, since that's the
    rating granularity Study Deck's existing flashcard flip UI already
    uses. Not spec-accurate SM-2, but a real, persisted, working schedule --
    which is the whole point (nothing before this stored a schedule at
    all, see the project memory this feature came out of)."""
    ease = float(card.get("ease") or 2.5)
    reps = int(card.get("repetitions") or 0)
    interval = int(card.get("interval_days") or 0)

    if quality == "again":
        reps = 0
        interval = 1
        ease = max(1.3, ease - 0.2)
    else:
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 6
        else:
            interval = max(1, round(interval * ease))
        reps += 1
        ease = min(3.0, ease + 0.05)

    due = (datetime.date.today() + datetime.timedelta(days=interval)).isoformat()
    return {"ease": ease, "repetitions": reps, "interval_days": interval, "due_date": due}


# ── JSON-fallback storage (no DATABASE_URL) ────────────────────
def _load_cards_blob(sid: str) -> list:
    return _load_user_list(sid, "review_cards")


def _save_cards_blob(sid: str, cards: list):
    _save_user_list(sid, "review_cards", cards)


@router.post("/api/review/create")
async def create_review_card(data: dict):
    """Create a new card, due immediately (due_date=today) so it shows up
    the next time the user opens the review queue rather than waiting a
    full cycle before it's ever seen once."""
    token = data.get("token", "")
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]

    front = sanitize_text(str(data.get("front", "")), 500)
    back = sanitize_text(str(data.get("back", "")), 2000)
    if not front.strip() or not back.strip():
        raise HTTPException(400, "Both front and back are required.")
    source_type = str(data.get("source_type", "custom"))
    if source_type not in _SOURCE_TYPES:
        source_type = "custom"
    source_id = sanitize_text(str(data.get("source_id", "") or ""), 100)

    card_id = uuid.uuid4().hex
    today = _TODAY()

    if db.is_available():
        card = db.create_review_card(sid, card_id, front, back, source_type, source_id, today)
        if not card:
            raise HTTPException(500, "Could not create review card.")
        return {"ok": True, "card": card}

    cards = _load_cards_blob(sid)
    card = {
        "id": card_id, "front": front, "back": back,
        "source_type": source_type, "source_id": source_id,
        "ease": 2.5, "interval_days": 0, "repetitions": 0,
        "due_date": today, "deleted_at": None,
    }
    cards.append(card)
    _save_cards_blob(sid, cards)
    return {"ok": True, "card": card}


@router.get("/api/review/due")
async def get_due_review_cards(token: str = ""):
    """Cards due today or earlier, across every source_type -- the one
    queue Study Deck flashcards, Notes cards, and Journal cards all share."""
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    today = _TODAY()

    if db.is_available():
        cards = db.get_due_review_cards(sid, today)
    else:
        cards = [
            c for c in _load_cards_blob(sid)
            if not c.get("deleted_at") and (c.get("due_date") or "") <= today
        ]
        cards.sort(key=lambda c: c.get("due_date") or "")
    return {"cards": cards, "count": len(cards)}


@router.post("/api/review/answer")
async def answer_review_card(data: dict):
    """Grade one card (quality: 'again' | 'good'), persist the new SM-2-lite
    schedule server-side, and return it. This is the one endpoint that must
    never trust a client-supplied schedule -- it always recomputes from the
    card's own last-known state."""
    token = data.get("token", "")
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    card_id = sanitize_text(str(data.get("card_id", "")), 100)
    quality = "again" if str(data.get("quality", "")) == "again" else "good"
    if not card_id:
        raise HTTPException(400, "card_id is required.")

    if db.is_available():
        card = db.get_review_card(sid, card_id)
        if not card:
            raise HTTPException(404, "Card not found.")
        nxt = _sm2_next(card, quality)
        db.update_review_schedule(sid, card_id, nxt["ease"], nxt["interval_days"],
                                   nxt["repetitions"], nxt["due_date"])
        card.update(nxt)
        return {"ok": True, "card": card}

    cards = _load_cards_blob(sid)
    card = next((c for c in cards if str(c.get("id")) == card_id and not c.get("deleted_at")), None)
    if not card:
        raise HTTPException(404, "Card not found.")
    nxt = _sm2_next(card, quality)
    card.update(nxt)
    _save_cards_blob(sid, cards)
    return {"ok": True, "card": card}


@router.post("/api/review/delete")
async def delete_review_card(data: dict):
    token = data.get("token", "")
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid = sess["sid"]
    card_id = sanitize_text(str(data.get("card_id", "")), 100)
    if not card_id:
        raise HTTPException(400, "card_id is required.")

    if db.is_available():
        db.soft_delete_review_card(sid, card_id)
        return {"ok": True}

    cards = _load_cards_blob(sid)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for c in cards:
        if str(c.get("id")) == card_id:
            c["deleted_at"] = now
    _save_cards_blob(sid, cards)
    return {"ok": True}
