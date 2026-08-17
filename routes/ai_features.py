"""
/api/ai/extract-tasks, /api/ai/write, /api/ai/weekly-review,
/api/ai/weekly-review/latest, /api/ai/parse-intent, /api/ai/voice-to-task.

WHY build_router() TAKES ai_meter, NOT load_progress/save_progress
--------------------------------------------------------------------
Unlike quiz or chat, none of these six endpoints read or write
load_progress()/save_progress() directly — only _ai_meter(sid) does (three of
the six call it: extract-tasks, write, weekly-review; the other three are
either read-only or unmetered by design). _ai_meter is itself a thin
billing-gated wrapper defined in app.py (needs _plan_caps()/_plan_is_active()
— see ai_core.py's module docstring for why that stays there), so it's the
one thing this module needs injected. Everything else — Gemini calls, the
`database` module for skills/finance/org context — is a normal leaf import.
"""

import datetime as _dt
import json

from fastapi import APIRouter, HTTPException, Request

import database as db
from core import sanitize_text, DATA_DIR, save_json, get_session_from_token, _resolve_token, get_client_key, check_rate_limit
from ai_core import async_gemini_once


def build_router(ai_meter) -> APIRouter:
    router = APIRouter()

    @router.post("/api/ai/extract-tasks")
    async def ai_extract_tasks(data: dict, request: Request):
        """Extract actionable tasks from free-form text using AI."""
        sess = get_session_from_token(data.get("token",""))
        if not sess:
            raise HTTPException(401, "Invalid session.")
        check_rate_limit(get_client_key(request), 15, "ai_extract")
        ai_meter(sess["sid"])
        text = sanitize_text(str(data.get("text","")), 3000)
        if len(text.strip()) < 10:
            raise HTTPException(400, "Text too short.")
        prompt = f"""Extract all actionable tasks from the text below.
Return ONLY a JSON array of objects, each with:
  "title": short task title (max 60 chars)
  "priority": "high", "medium", or "low"
  "due": ISO date string if mentioned, else null

Text:
{text}

Return only valid JSON. No explanation. No markdown. Example:
[{{"title":"Reply to John","priority":"high","due":null}}]"""
        raw = await async_gemini_once(prompt, temp=0.2, tokens=400)
        tasks = []
        if raw:
            try:
                import re as _re
                m = _re.search(r'\[.*\]', raw, _re.DOTALL)
                if m:
                    tasks = json.loads(m.group(0))
            except Exception:
                pass
        return {"tasks": tasks[:20]}


    @router.post("/api/ai/write")
    async def ai_write_assist(data: dict, request: Request):
        """AI writing assistant — improve, shorten, expand, or reformat text."""
        sess = get_session_from_token(data.get("token",""))
        if not sess:
            raise HTTPException(401, "Invalid session.")
        check_rate_limit(get_client_key(request), 20, "ai_write")
        ai_meter(sess["sid"])
        text   = sanitize_text(str(data.get("text","")), 4000)
        action = sanitize_text(str(data.get("action","improve")), 20)
        tone   = sanitize_text(str(data.get("tone","professional")), 20)
        if len(text.strip()) < 5:
            raise HTTPException(400, "Text too short.")
        actions = {
            "improve":   "Rewrite to improve clarity, flow, and impact.",
            "shorten":   "Shorten significantly while keeping the core message.",
            "expand":    "Expand with relevant detail and depth.",
            "formal":    "Rewrite in a formal, professional tone.",
            "casual":    "Rewrite in a warm, conversational tone.",
            "bullets":   "Convert into clear, concise bullet points.",
            "email":     "Rewrite as a professional email.",
            "summarise": "Summarise in 2-3 sentences.",
        }
        instruction = actions.get(action, actions["improve"])
        prompt = f"""{instruction}

Text:
{text}

Respond with ONLY the rewritten text. No preamble, no explanation."""
        result = await async_gemini_once(prompt, temp=0.7, tokens=600)
        if not result:
            raise HTTPException(502, "AI unavailable. Try again.")
        return {"result": result}


    @router.post("/api/ai/weekly-review")
    async def weekly_review(data: dict, request: Request):
        """Generate a personalised AI weekly review digest."""
        sid, name = _resolve_token(data)
        check_rate_limit(get_client_key(request), 10, "weekly_review")
        ai_meter(sid)
        first_name    = name.split()[0] if name else "there"
        week_end      = _dt.date.today()
        week_start    = week_end - _dt.timedelta(days=6)
        week_range    = f"{week_start.strftime('%b %d')}–{week_end.strftime('%b %d')}"

        tasks_done    = max(0, int(data.get("tasks_done", 0)))
        tasks_total   = max(0, int(data.get("tasks_total", 0)))
        habits_pct    = max(0, min(100, int(data.get("habits_pct", 0))))
        mood          = sanitize_text(str(data.get("mood", "")), 20)
        raw_goals     = data.get("goals", [])
        goals         = [g for g in raw_goals if isinstance(g, dict)][:5]

        goals_txt = "\n".join(
            f"  - {sanitize_text(str(g.get('title','')),60)}: {int(g.get('progress',0))}%"
            for g in goals
        ) if goals else "  - No active goals"

        # Skills context
        skills_txt = ""
        if db.is_available():
            sk_blob = db.get_user_blob(sid, "skills") or {}
            sk_list = (sk_blob.get("skills") or [])[:5]
            if sk_list:
                skills_txt = "\n".join(
                    f"  - {sanitize_text(str(s.get('name','?')),40)}: {s.get('level',0)}% proficiency, {s.get('sessions',0)} sessions"
                    for s in sk_list
                )

        # Finance context
        finance_txt = ""
        if db.is_available():
            fin_blob = db.get_user_blob(sid, "finance") or {}
            fin_txs  = (fin_blob.get("transactions") or [])
            month    = str(week_end)[:7]
            m_txs    = [t for t in fin_txs if str(t.get("date","")).startswith(month)]
            if m_txs:
                inc = sum(t.get("amount",0) for t in m_txs if t.get("type")=="income")
                exp = sum(t.get("amount",0) for t in m_txs if t.get("type")=="expense")
                finance_txt = f"  - This month: ₦{inc:,.0f} income, ₦{exp:,.0f} expenses, ₦{inc-exp:,.0f} net"

        extras = ""
        if skills_txt:  extras += f"\n- Skills tracked:\n{skills_txt}"
        if finance_txt: extras += f"\n- Finance:\n{finance_txt}"

        prompt = f"""You are Sivarr AI. Write a warm, insightful weekly review for {first_name} covering {week_range}.

Data:
- Tasks completed: {tasks_done} of {tasks_total}
- Habits completion rate: {habits_pct}%
- Goals:
{goals_txt}{extras}
{"- Dominant mood: " + mood if mood else ""}

Format your response in exactly 4 labelled sections:

**This Week**
2 sentences summarising their overall performance. Be honest and specific.

**Wins**
- [win 1]
- [win 2]
Two genuine achievements based on the data.

**Focus Next Week**
- [action 1]
- [action 2]
Two specific, actionable recommendations tied to their data.

**Closing**
One energising sentence using their first name.

Keep it concise, personal, and grounded in the actual numbers. No generic filler.
Never use em dashes. Use commas or periods instead."""

        review = await async_gemini_once(prompt, temp=0.72, tokens=380)
        if not review:
            review = f"Great effort this week, {first_name}! You completed {tasks_done} tasks and maintained {habits_pct}% of your habits. Keep building that momentum, next week push one goal past its current mark."
        # Cache the review server-side for auto-display next time
        week_start_str = str(_dt.date.today() - _dt.timedelta(days=_dt.date.today().weekday()))
        reviews_dir = DATA_DIR / "weekly_reviews"
        reviews_dir.mkdir(exist_ok=True)
        review_path = reviews_dir / f"{sid}_{week_start_str}.json"
        save_json(review_path, {"review": review, "week_start": week_start_str, "generated_at": str(_dt.date.today())})

        return {"review": review, "week": week_range}


    @router.get("/api/ai/weekly-review/latest")
    async def weekly_review_latest(token: str = ""):
        """Return the most recent auto-generated or manual review for the current week."""
        sess = get_session_from_token(token)
        if not sess:
            raise HTTPException(401, "Invalid session.")
        sid = sess["sid"]
        today      = _dt.date.today()
        week_start = str(today - _dt.timedelta(days=today.weekday()))
        review_path = DATA_DIR / "weekly_reviews" / f"{sid}_{week_start}.json"
        if not review_path.exists():
            return {"review": None, "week_start": week_start}
        data = json.loads(review_path.read_text(encoding="utf-8"))
        return {"review": data.get("review",""), "week_start": data.get("week_start", week_start)}


    @router.post("/api/ai/parse-intent")
    async def parse_intent(data: dict, request: Request):
        """Parse a natural-language string into a structured action (task, goal, or note)."""
        sid, _ = _resolve_token(data)
        check_rate_limit(get_client_key(request), 30, "parse_intent")
        text = sanitize_text(str(data.get("text", "")), 300)
        if not text.strip():
            raise HTTPException(400, "Text required.")
        today = str(__import__('datetime').date.today())
        prompt = f"""Parse the following natural-language input into a structured action. Today is {today}.

Input: "{text}"

Respond with a single JSON object — no explanation, no markdown fences. Schema:
{{"action":"task"|"goal"|"note","title":"string","priority":"high"|"normal"|"low","due":"YYYY-MM-DD"|null,"subject":"string"|null}}

Rules:
- action = "task" if it describes something to do, complete, or finish
- action = "goal" if it describes a target, aim, score, or achievement
- action = "note" for everything else
- Extract any explicit date or relative date (tomorrow, Friday, next week) and convert to YYYY-MM-DD
- Keep title concise (max 70 chars), remove filler words like "remind me to" or "I need to"
- subject is only for goals (the subject area, e.g. "Physics")"""

        raw = await async_gemini_once(prompt, temp=0.1, tokens=1200)
        parsed = None
        if raw:
            try:
                import re as _re, json as _json
                m = _re.search(r'\{.*\}', raw, _re.DOTALL)
                if m:
                    parsed = _json.loads(m.group(0))
            except Exception:
                pass
        if not parsed:
            parsed = {"action": "task", "title": text[:70], "priority": "normal", "due": None, "subject": None}
        return {"ok": True, "parsed": parsed}


    @router.post("/api/ai/voice-to-task")
    async def voice_to_task(data: dict, request: Request):
        """Convert a voice-note transcript into structured tasks."""
        sid, _ = _resolve_token(data)
        check_rate_limit(get_client_key(request), 20, "voice_to_task")
        transcript = sanitize_text(str(data.get("transcript", "")), 600)
        if not transcript.strip():
            raise HTTPException(400, "Transcript required.")
        today = str(__import__('datetime').date.today())
        prompt = f"""Extract all actionable tasks from this voice note. Today is {today}.

Voice note: "{transcript}"

Return a JSON array of task objects (max 5). Each object:
{{"title":"string","priority":"high"|"normal"|"low","due":"YYYY-MM-DD"|null}}

Rules:
- Only extract clear action items — skip context-setting or general remarks
- Keep titles concise (max 60 chars)
- Respond with the JSON array only, no explanation"""

        raw = await async_gemini_once(prompt, temp=0.15, tokens=250)
        tasks = []
        if raw:
            try:
                import re as _re, json as _json
                m = _re.search(r'\[.*\]', raw, _re.DOTALL)
                if m:
                    result = _json.loads(m.group(0))
                    if isinstance(result, list):
                        tasks = result[:5]
            except Exception:
                pass
        if not tasks:
            tasks = [{"title": transcript[:60], "priority": "normal", "due": None}]
        return {"ok": True, "tasks": tasks}

    return router
