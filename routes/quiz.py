"""
/api/quiz/question, /api/quiz/submit, /api/quiz/complete.

Same factory-injection reasoning as routes/ai_chat.py: quiz_question and
quiz_submit read/write load_progress()/save_progress() directly (topic
counters, wrong-answer log, quiz score history) — app.py's central user-state
accessor, not something this pass moves. See ai_core.py's module docstring
for the fuller reasoning.
"""

import datetime
import json
import logging
import os
import random
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, validator

from core import (
    sanitize_text, validate_sid, save_json, UPLOADS_DIR,
    get_session_from_token, _resolve_token, get_client_key, check_rate_limit,
)
from ai_core import async_gemini_once, load_json, bpath

log = logging.getLogger("sivarr")

RATE_LIMIT_QUIZ = int(os.environ.get("RATE_LIMIT_QUIZ", 5))      # max quiz questions per window
BANK_LIMIT = 20


QUIZ_PROMPT = """Generate a {difficulty} multiple choice question about: {topic}
Difficulty: easy=basic recall, medium=application, hard=analysis
Reply ONLY with valid JSON:
{{
  "question": "...",
  "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
  "answer": "A",
  "explanation": "One sentence."
}}"""

FILE_QUIZ_PROMPT = """Based on this document content:
{text}

Generate a {difficulty} multiple choice question.
Reply ONLY with valid JSON:
{{
  "question": "...",
  "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
  "answer": "A",
  "explanation": "One sentence."
}}"""


def parse_quiz_json(raw: str, topic: str) -> dict:
    """
    Robustly parse a quiz question from Gemini output.
    Handles markdown fences, extra text, partial JSON, and
    common formatting issues Gemini produces.
    """
    if not raw:
        return None
    try:
        # Step 1 — strip markdown code fences
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()

        # Step 2 — extract just the JSON object if there's extra text around it
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            raw = match.group(0)

        # Step 3 — parse
        q = json.loads(raw)

        # Step 4 — validate required fields
        required = ["question", "options", "answer", "explanation"]
        if not all(k in q for k in required):
            log.warning(f"Quiz JSON missing fields: {list(q.keys())}")
            return None

        # Step 5 — validate options has A B C D
        opts = q.get("options", {})
        if not all(k in opts for k in ["A", "B", "C", "D"]):
            log.warning(f"Quiz options incomplete: {list(opts.keys())}")
            return None

        # Step 6 — normalize answer to uppercase single letter
        q["answer"] = str(q["answer"]).strip().upper()[:1]
        if q["answer"] not in ["A", "B", "C", "D"]:
            q["answer"] = "A"

        q["topic"] = topic
        return q

    except json.JSONDecodeError as e:
        log.error(f"Quiz JSON parse error: {e} | raw: {raw[:200]}")
        return None
    except Exception as e:
        log.error(f"Quiz parse unexpected error: {e}")
        return None


class QuizRequest(BaseModel):
    sid: str = ""
    token: str = ""
    topic: str
    difficulty: str
    answer: str
    question: str
    correct: str
    explanation: str

    @validator("difficulty")
    def diff_valid(cls, v):
        if v not in ["easy", "medium", "hard"]:
            raise ValueError("Invalid difficulty.")
        return v

    @validator("answer", "correct")
    def answer_valid(cls, v):
        v = v.strip().upper()
        if v not in ["A", "B", "C", "D"]:
            raise ValueError("Answer must be A, B, C, or D.")
        return v


def build_router(load_progress, save_progress) -> APIRouter:
    router = APIRouter()

    @router.get("/api/quiz/question")
    async def quiz_question(request: Request, sid: str, topic: str = "", difficulty: str = "medium", file_id: str = ""):
        sid = validate_sid(sid)  # strips path-traversal chars; sid is interpolated into the upload path
        key = get_client_key(request, sid)
        check_rate_limit(key, RATE_LIMIT_QUIZ, "quiz")

        if difficulty not in ["easy","medium","hard"]:
            difficulty = "medium"

        p = load_progress(sid)

        if file_id:
            file_id = re.sub(r"[^a-z0-9]", "", file_id.lower())[:20]  # alnum only; file_id is interpolated into the path
            fpath = UPLOADS_DIR / f"{sid}_{file_id}.txt"
            if fpath.exists():
                content = fpath.read_text(encoding="utf-8")[:3000]
                raw = await async_gemini_once(FILE_QUIZ_PROMPT.format(text=content, difficulty=difficulty), temp=0.9, tokens=300)
                if raw:
                    try:
                        raw = re.sub(r"```(?:json)?","",raw).strip().rstrip("`")
                        q   = json.loads(raw)
                        q["topic"] = "uploaded document"
                        return q
                    except Exception as e:
                        log.error(f"File quiz parse error: {e}")
            return {"error": "Could not generate question from file."}

        topics = list(p["topics"].keys())

        # Allow quiz even with no studied topics if a topic was provided
        if not topics and not topic:
            topic = "general knowledge"

        t = topic if topic else (random.choice(topics) if topics else "general knowledge")
        bank = load_json(bpath())
        key2 = f"{t}_{difficulty}"

        stored = bank.get(key2, [])
        if stored:
            q = random.choice(stored)
            q["topic"] = t
            return q

        raw = await async_gemini_once(QUIZ_PROMPT.format(topic=t, difficulty=difficulty), temp=0.9, tokens=300)
        if not raw:
            log.warning("Gemini unavailable for quiz — no question generated")
            # Was `return get_fallback_question(t, [])` — that function does not exist
            # anywhere in the codebase, so this path raised NameError instead of
            # degrading, precisely when the AI was already down. Returns the same
            # error shape the file-quiz path above uses.
            return {"error": "Could not generate a question right now. Please try again."}

        q = parse_quiz_json(raw, t)
        if not q:
            # Retry once with lower temperature
            raw2 = await async_gemini_once(QUIZ_PROMPT.format(topic=t, difficulty=difficulty), temp=0.5, tokens=300)
            q = parse_quiz_json(raw2 or "", t)
        if not q:
            log.warning("Quiz parse failed twice — no question generated")
            # See the note above: get_fallback_question() never existed.
            return {"error": "Could not generate a question right now. Please try again."}

        bank.setdefault(key2, [])
        if q["question"] not in [x["question"] for x in bank[key2]]:
            bank[key2] = (bank[key2] + [q])[-BANK_LIMIT:]
        save_json(bpath(), bank)
        return q


    @router.post("/api/quiz/submit")
    async def quiz_submit(req: QuizRequest):
        # Auth is by session token only; the body `sid` is ignored (IDOR fix).
        sess = get_session_from_token(sanitize_text(req.token, 100)) if req.token else None
        if not sess:
            raise HTTPException(401, "Invalid session.")
        sid     = sess["sid"]
        p       = load_progress(sid)
        correct = req.answer.upper() == req.correct.upper()
        if not correct:
            p.setdefault("wrong_answers", []).append({
                "topic": sanitize_text(req.topic, 100),
                "question": sanitize_text(req.question, 500),
                "your_answer": req.answer,
                "correct": req.correct,
                "explanation": sanitize_text(req.explanation, 500),
                "difficulty": req.difficulty,
                "date": datetime.date.today().isoformat(),
            })
        save_progress(sid, p)
        return {"correct": correct, "correct_answer": req.correct}


    @router.post("/api/quiz/complete")
    async def quiz_complete(data: dict):
        sid, _ = _resolve_token(data)   # IDOR fix: sid from session token, body sid ignored
        score = min(max(int(data.get("score",0)), 0), 5)
        topic = sanitize_text(str(data.get("topic","general")), 100)
        diff  = data.get("difficulty","medium")
        if diff not in ["easy","medium","hard"]:
            diff = "medium"
        p = load_progress(sid)
        p.setdefault("quizzes", []).append({
            "topic": topic, "score": score / 5,
            "pct": int(score / 5 * 100), "difficulty": diff,
            "date": datetime.date.today().isoformat(),
        })
        save_progress(sid, p)
        log.info(f"Quiz complete: {sid[:20]} | {score}/5 | {topic} | {diff}")
        return {"ok": True}

    return router
