import datetime as _dt

from fastapi import APIRouter, HTTPException

from core import get_session_from_token, sanitize_text, _load_user_list, _save_user_list

router = APIRouter()


# ── Personal journal — server-side mirror ──────────────────────────────────
def load_journal(sid: str) -> list:
    return _load_user_list(sid, "journal")

def save_journal(sid: str, entries: list):
    _save_user_list(sid, "journal", entries)


@router.post("/api/journal/sync")
async def sync_journal(data: dict):
    """Bulk-sync journal entries from client localStorage to server."""
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    sid     = sess["sid"]
    entries = data.get("entries", [])
    if not isinstance(entries, list):
        raise HTTPException(400, "entries must be a list.")
    clean = []
    for e in entries[:1000]:
        clean.append({
            "date":    sanitize_text(str(e.get("date","")),    20),
            "text":    sanitize_text(str(e.get("text","") or e.get("content","") or e.get("entry","")), 10000),
            "mood":    sanitize_text(str(e.get("mood","")),    10),
        })
    save_journal(sid, clean)
    return {"ok": True, "count": len(clean)}


@router.get("/api/journal/restore")
async def restore_journal(token: str = ""):
    sess = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return {"entries": load_journal(sess["sid"])}


# ── Daily journal prompt — consistent for every user on a given day ────────
JOURNAL_PROMPTS = [
    "What's one decision you made this week you'd make differently?",
    "What's something you've been avoiding that needs your attention?",
    "Describe a moment today where you felt fully present.",
    "What would you do this week if you weren't afraid of failing?",
    "What's one thing you learned today that surprised you?",
    "Who made a positive impact on you recently, and have you told them?",
    "What does success look like for you one year from now?",
    "What habit is quietly holding you back?",
    "What are you most grateful for right now?",
    "What's one thing you want to stop doing? One thing to start?",
    "Describe your energy level today. What drained you? What filled you?",
    "What problem have you been overthinking that needs a decision, not more thought?",
    "What did you build, create, or contribute today?",
    "If today was the only evidence someone had of who you are, what would it say?",
    "What's been on your mind that you haven't written down yet?",
    "Where did you spend the most focus today? Was it worth it?",
    "What's one conversation you need to have that you've been putting off?",
    "What's working well right now that you should protect?",
    "Name one thing you're proud of this week, however small.",
    "What boundary did you hold or fail to hold today?",
    "How has your thinking on a big goal shifted recently?",
    "What would you tell yourself 3 months ago?",
    "What's one thing you want to remember about today?",
    "Where are you being too hard on yourself?",
    "What would make next week significantly better than this one?",
    "Describe your ideal version of tomorrow.",
    "What are you currently building, and why does it matter to you?",
    "What's one relationship you want to invest more in?",
    "What does your gut say about a decision you're facing?",
    "What's the most important thing you didn't do today, and why?",
]

@router.get("/api/journal/prompt")
async def journal_prompt():
    """Return today's journal prompt — consistent for all users on the same day."""
    day_of_year = _dt.date.today().timetuple().tm_yday
    prompt = JOURNAL_PROMPTS[day_of_year % len(JOURNAL_PROMPTS)]
    return {"prompt": prompt}
