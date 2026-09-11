"""
/api/home/brief — the AI-generated morning/afternoon/evening brief on the Home
dashboard. (/api/home/briefing, the non-AI structured-data sibling endpoint,
stays in app.py — it never calls Gemini, so it isn't part of this pass.)

Factory router (Settings > Sivarr AI > "Daily home summary" pause toggle): this
endpoint used to touch no billing-gated state at all, but honoring the user's
own ai_proactive_enabled preference means it now needs load_progress -- taken
as a constructor argument, same reasoning as routes/ai_chat.py's build_router
(avoids reimporting app.py's central user-state accessor directly, which is
the exact partial-load ordering problem core.py exists to avoid).

NOTE: as of the "Sivarr AI settings" pass, the Home dashboard's redesign
removed this brief's only display anchor (#home-brief-msg) without removing
the fetch code in js/app.js's loadHome() -- that fetch is gated behind
`if (briefMsg)`, and briefMsg is now always null, so in the shipped app this
endpoint currently receives zero real traffic. The pause toggle below is real
and correctly enforced regardless -- it's what makes this endpoint safe if
that fetch path is ever reconnected to a visible element again, not a control
for a feature that would silently ignore it.
"""

import datetime as _dt

from fastapi import APIRouter

import database as db
from core import sanitize_text, _resolve_token
from ai_core import async_gemini_once


def build_router(load_progress) -> APIRouter:
    router = APIRouter()

    @router.post("/api/home/brief")
    async def home_brief(data: dict):
        """Generate a personalised AI morning brief for the Home dashboard."""
        sid, uname = _resolve_token(data)
        today = str(_dt.date.today())
        p = load_progress(sid)
        if not p.get("ai_proactive_enabled", True):
            return {"brief": "", "date": today, "disabled": True}
        first_name = uname.split()[0] if uname else "there"
        hr         = _dt.datetime.now().hour
        tod        = "morning" if hr < 12 else "afternoon" if hr < 17 else "evening"

        # Personal data sent from the client
        open_tasks    = int(data.get("open_tasks", 0))
        overdue_tasks = int(data.get("overdue_tasks", 0))
        top_goal      = sanitize_text(str(data.get("top_goal", "")), 80)
        goal_pct      = int(data.get("goal_pct", 0))
        streak        = int(data.get("streak", 0))
        events_today  = int(data.get("events_today", 0))
        journalled    = bool(data.get("journalled", False))
        high_pri      = sanitize_text(str(data.get("high_priority_task", "")), 80)

        # Org data (if user is in an org)
        org_name      = ""
        org_tasks     = 0
        if db.is_available():
            try:
                org = db.get_org_by_member(sid)
                if org:
                    org_name  = org["name"]
                    org_tasks = db.count_org_tasks(org["id"], exclude_status="done")
            except Exception:
                pass

        lines = [
            f"Generate a 2-3 sentence {tod} brief for {first_name}. Today is {today}.",
            "",
            "Workspace data:",
            f"- Open tasks: {open_tasks}" + (f" ({overdue_tasks} overdue)" if overdue_tasks else ""),
        ]
        if high_pri:
            lines.append(f"- Highest priority: \"{high_pri}\"")
        if top_goal:
            lines.append(f"- Top goal: \"{top_goal}\" at {goal_pct}%")
        if streak > 1:
            lines.append(f"- Activity streak: {streak} days")
        if events_today:
            lines.append(f"- Events scheduled today: {events_today}")
        if not journalled:
            lines.append("- Has NOT journalled today")
        if org_name:
            lines.append(f"- Organisation: {org_name} ({org_tasks} open org tasks)")

        lines += [
            "",
            "Rules:",
            "1. Be warm and direct, like the smartest friend in the room.",
            "2. Reference 1-2 real data points naturally, not as a list.",
            "3. End with one sharp, specific action suggestion.",
            "4. Max 3 sentences. No bullet points. No headers.",
            f"5. Do NOT open with a greeting or salutation (no \"Good {tod}\", no \"{tod.capitalize()}, {first_name}\", no \"Hi\"/\"Hey\"). The page already shows a greeting above this text. Start directly with the substance.",
            "6. Never use em dashes. Use commas or periods instead.",
        ]

        prompt  = "\n".join(lines)
        brief   = await async_gemini_once(prompt, temp=0.75, tokens=1200)
        if not brief:
            brief = f"Good {tod}, {first_name}. Your workspace is ready, so make today count."
        return {"brief": brief, "date": today}

    return router
