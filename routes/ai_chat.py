"""
/api/chat, /api/chat/stream, /api/chat/clear.

WHY build_router() IS A FACTORY, NOT A BARE ROUTER
-----------------------------------------------------
Every other router in routes/ imports its dependencies as plain module-level
names from core.py (`from core import get_session_from_token, ...`). Chat
can't quite do that: _chat_authorize() and _ai_meter()-style gating need
load_progress()/save_progress()/add_history() — app.py's central user-state
accessor (60+ call sites app-wide) and its billing plan-tier logic. Those are
genuinely app.py-resident, not AI-domain, and moving them is out of scope for
this pass (see ai_core.py's module docstring for the fuller reasoning).

Rather than `from app import load_progress` (which reintroduces the exact
partial-load ordering problem core.py exists to avoid), this module takes
them as explicit constructor arguments. app.py calls build_router(...) with
its own _chat_authorize/load_progress/save_progress/add_history once those
are defined, then include_router()s the result — the same 12,000-line-file
ordering constraint as before Pass 0, but now scoped to one well-justified
router instead of all of them, and declared in a function signature instead
of an import comment.
"""

import asyncio
import json
import logging
import os
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, validator

import database as db

from core import sanitize_text, save_json, MAX_MESSAGE_LEN, get_client_key, check_rate_limit, _resolve_token
from ai_core import (
    solve_local, is_math, is_uncertain, _is_ai_error,
    get_sessions, async_gemini_ask, async_gemini_once, friendly_gemini_error,
    load_json, lpath, strip_topic, get_cached, set_cached,
    build_retrieval_context, forget_sid,
)

RATE_LIMIT_CHAT = int(os.environ.get("RATE_LIMIT_CHAT", 20))      # max chat msgs per window

log = logging.getLogger("sivarr")


class ChatRequest(BaseModel):
    sid: str
    message: str
    context: str = ""
    token: str = ""
    want_suggestions: bool = True

    @validator("message")
    def msg_valid(cls, v):
        v = sanitize_text(v, MAX_MESSAGE_LEN)
        if not v:
            raise ValueError("Message cannot be empty.")
        return v

    @validator("sid")
    def sid_valid(cls, v):
        v = sanitize_text(v, 100)
        if not v:
            raise ValueError("Session ID required.")
        return v


def build_router(chat_authorize, load_progress, save_progress, add_history, build_memory) -> APIRouter:
    router = APIRouter()

    @router.post("/api/chat")
    async def chat(req: ChatRequest, request: Request):
        sid, p = chat_authorize(req.token)
        key = get_client_key(request, sid)
        check_rate_limit(key, RATE_LIMIT_CHAT, "chat")

        msg = req.message
        # Prepend user context snapshot if provided (injected by frontend on first message)
        if req.context:
            msg = f"{req.context}\n\nUser: {req.message}"
        cmd = msg.lower()

        log.info(f"Chat: {sid[:20]} | {req.message[:60]}")

        local = solve_local(msg)
        if local:
            add_history(p, sid, "user", req.message)
            add_history(p, sid, "sivarr", local)
            p["questions"] += 1
            p["topics"]["math"] = p["topics"].get("math", 0) + 1
            save_progress(sid, p)
            return {"reply": local, "uncertain": False, "error": False}

        sessions = get_sessions(sid)

        if is_math(cmd):
            ans = await async_gemini_ask(sessions["math"], msg)
            uncertain = is_uncertain(ans)
            is_err = _is_ai_error(ans)
            if not is_err:
                p["questions"] += 1
                p["topics"]["math"] = p["topics"].get("math", 0) + 1
                add_history(p, sid, "user", req.message)
                add_history(p, sid, "sivarr", ans)
                save_progress(sid, p)
            return {"reply": ans, "uncertain": uncertain, "error": is_err}

        lib    = load_json(lpath())
        topic  = strip_topic(cmd)
        cached = get_cached(lib, topic)
        if cached:
            p["questions"] += 1
            p["topics"][topic] = p["topics"].get(topic, 0) + 1
            save_progress(sid, p)
            return {"reply": cached, "uncertain": False, "error": False}

        # Retrieval-augmented context (Session 13): grounded in this sid's
        # own indexed workspace only (see build_retrieval_context's own
        # docstring for why that's structural, not just usually-true).
        # Embeds req.message, not msg — msg may already carry req.context
        # prepended, and diluting the retrieval query with that would hurt
        # match quality for no benefit. Kept in a separate gemini_msg rather
        # than folded into msg: add_history below saves req.message (the raw
        # text the user actually typed), never msg or gemini_msg — a user
        # re-opening this conversation should see what they typed, not a
        # wall of req.context/[task:...]/[doc:...] tags prepended to it.
        retrieval_ctx = await build_retrieval_context(sid, req.message, enabled=p.get("ai_retrieval_enabled", True))
        gemini_msg = f"{retrieval_ctx}\n\n{msg}" if retrieval_ctx else msg

        ans       = await async_gemini_ask(sessions["chat"], gemini_msg)
        uncertain = is_uncertain(ans)
        is_err    = _is_ai_error(ans)

        if not is_err:
            if topic and any(kw in cmd for kw in ["what is","define","explain"]) and not uncertain:
                set_cached(lib, topic, ans)
                save_json(lpath(), lib)
            p["questions"] += 1
            p["topics"][topic or "general"] = p["topics"].get(topic or "general", 0) + 1
            add_history(p, sid, "user", req.message)
            add_history(p, sid, "sivarr", ans)
            save_progress(sid, p)

        return {"reply": ans, "uncertain": uncertain, "error": is_err}


    @router.post("/api/chat/stream")
    async def chat_stream(req: ChatRequest, request: Request):
        sid, p = chat_authorize(req.token)
        key = get_client_key(request, sid)
        check_rate_limit(key, RATE_LIMIT_CHAT, "chat")

        msg = req.message
        if req.context:
            msg = f"{req.context}\n\nUser: {req.message}"

        # Local math solver — stream the single result
        local = solve_local(msg)
        if local:
            add_history(p, sid, "user", req.message)
            add_history(p, sid, "sivarr", local)
            p["questions"] += 1
            save_progress(sid, p)
            async def _math():
                yield f"data: {json.dumps({'token': local})}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(_math(), media_type="text/event-stream",
                                     headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

        sessions = get_sessions(sid)

        # Retrieval-augmented context (Session 13) — see /api/chat's own copy
        # of this comment for why req.message (not msg) is what gets embedded,
        # and why it's kept out of msg itself (add_history below logs req.message
        # already, but _run_gemini's closure needs the augmented text separately).
        retrieval_ctx = await build_retrieval_context(sid, req.message, enabled=p.get("ai_retrieval_enabled", True))
        gemini_msg = f"{retrieval_ctx}\n\n{msg}" if retrieval_ctx else msg

        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()

        def _run_gemini():
            try:
                resp = sessions["chat"].send_message(gemini_msg, stream=True)
                for chunk in resp:
                    txt = getattr(chunk, "text", None)
                    if txt:
                        loop.call_soon_threadsafe(q.put_nowait, {"token": txt})
            except Exception as e:
                loop.call_soon_threadsafe(q.put_nowait, {"token": friendly_gemini_error(e), "error": True})
            loop.call_soon_threadsafe(q.put_nowait, None)

        loop.run_in_executor(None, _run_gemini)

        async def _stream():
            full: list[str] = []
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
                if not item.get("error"):
                    full.append(item["token"])

            full_text = "".join(full)
            if full_text and not _is_ai_error(full_text):
                add_history(p, sid, "user", req.message)
                add_history(p, sid, "sivarr", full_text)
                p["questions"] += 1
                save_progress(sid, p)

            # Generate 3 follow-up suggestions (fast, non-blocking) — skippable
            # via want_suggestions=False for callers that never render them
            # (the Academic quick-chat popup), so they don't pay for a Gemini
            # call whose result is thrown away on every single message.
            suggestions: list[str] = []
            if req.want_suggestions and full_text and not _is_ai_error(full_text):
                try:
                    raw = await async_gemini_once(
                        f"Based on this AI response, suggest exactly 3 short follow-up questions a user might ask next. "
                        f"Return ONLY a JSON array of 3 strings, no other text.\n\nResponse:\n{full_text[:800]}",
                        temp=0.7, tokens=1200
                    )
                    if raw:
                        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`")
                        parsed = json.loads(raw)
                        if isinstance(parsed, list):
                            suggestions = [str(s).strip() for s in parsed[:3] if s]
                except Exception:
                    pass

            yield f"data: {json.dumps({'done': True, 'suggestions': suggestions})}\n\n"

        return StreamingResponse(_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


    @router.post("/api/chat/clear")
    async def chat_clear(data: dict):
        """Clear only the authenticated user's chat history (token-authed, IDOR-safe)."""
        sid, _ = _resolve_token(data)
        p = load_progress(sid)
        p["chat_history"] = []
        save_progress(sid, p)
        return {"ok": True}

    @router.post("/api/ai/memory")
    async def ai_memory(data: dict):
        """What would actually be fed to Gemini as this user's prior-session
        context — the real build_memory() output, not a paraphrase. Also
        returns the caller's current response mode/tone so Settings doesn't
        need extra round-trips to show them."""
        sid, _ = _resolve_token(data)
        p = load_progress(sid)
        return {
            "memory": build_memory(p) or "",
            "mode": p.get("ai_mode", "fast"),
            "tone": p.get("ai_tone", "warm"),
            "retrieval_enabled": p.get("ai_retrieval_enabled", True),
            "proactive_enabled": p.get("ai_proactive_enabled", True),
        }

    @router.post("/api/ai/forget")
    async def ai_forget(data: dict):
        """The real 'forget me': clears the visible history (same effect as
        /api/chat/clear) AND evicts the live Gemini session so the model
        itself stops remembering, not just the UI. Per-worker immediate;
        other workers' copies age out via the existing idle TTL."""
        sid, _ = _resolve_token(data)
        p = load_progress(sid)
        p["chat_history"] = []
        save_progress(sid, p)
        forget_sid(sid)
        return {"ok": True}

    @router.post("/api/ai/mode")
    async def ai_set_mode(data: dict):
        """Fast vs. Thorough response mode. Saves the preference, then evicts
        the live session (same forget_sid used for 'forget me') so the very
        next message picks it up instead of waiting on the idle TTL or a
        fresh login — get_sessions() only reads mode when (re)creating a
        session, not on every call."""
        sid, _ = _resolve_token(data)
        mode = sanitize_text(str(data.get("mode", "")), 20)
        if mode not in ("fast", "thorough"):
            raise HTTPException(400, "mode must be 'fast' or 'thorough'.")
        p = load_progress(sid)
        p["ai_mode"] = mode
        save_progress(sid, p)
        forget_sid(sid)
        return {"ok": True}

    @router.post("/api/ai/tone")
    async def ai_set_tone(data: dict):
        """How Sivarr AI talks to you. Same shape as /api/ai/mode: save, then
        forget_sid() so the next message picks it up right away."""
        sid, _ = _resolve_token(data)
        tone = sanitize_text(str(data.get("tone", "")), 20)
        if tone not in ("warm", "direct", "formal"):
            raise HTTPException(400, "tone must be 'warm', 'direct', or 'formal'.")
        p = load_progress(sid)
        p["ai_tone"] = tone
        save_progress(sid, p)
        forget_sid(sid)
        return {"ok": True}

    @router.post("/api/ai/retrieval")
    async def ai_set_retrieval(data: dict):
        """Real opt-out for workspace-data grounding (tasks/goals/docs/journal
        embedded and pulled into chat answers -- see ai_core.build_retrieval_context
        and app.py's _index_embeddings). No forget_sid() needed here: unlike
        mode/tone, retrieval is read fresh per message, not baked into the
        Gemini session at creation time, so this takes effect on the very next
        message with no eviction required. Disabling immediately deletes the
        already-indexed chunks (real text, not just vectors) rather than
        leaving them to quietly age out of a 30-minute background job."""
        sid, _ = _resolve_token(data)
        enabled = bool(data.get("enabled", True))
        p = load_progress(sid)
        p["ai_retrieval_enabled"] = enabled
        save_progress(sid, p)
        if not enabled:
            for source_type in ("task", "goal", "doc", "journal"):
                db.prune_embeddings(sid, source_type, [])
        return {"ok": True}

    @router.post("/api/ai/proactive")
    async def ai_set_proactive(data: dict):
        """Pause/resume Sivarr AI's unprompted Home daily summary. Saves the
        preference only -- no forget_sid() (unrelated to the chat session)
        and no data to delete (unlike /api/ai/retrieval, nothing is stored
        ahead of time here). Enforced server-side in routes/home_brief.py."""
        sid, _ = _resolve_token(data)
        enabled = bool(data.get("enabled", True))
        p = load_progress(sid)
        p["ai_proactive_enabled"] = enabled
        save_progress(sid, p)
        return {"ok": True}

    return router
