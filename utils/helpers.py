"""
utils/helpers.py — Input sanitization, validation, Gemini AI calls, misc utilities.
"""

import re
import json
import time
import logging
import database as db
from fastapi import HTTPException
from config import (
    MAX_MESSAGE_LEN, MAX_NAME_LEN, MAX_MATRIC_LEN,
    GEMINI_AVAILABLE, GEMINI_MODELS, API_KEY,
    MATH_TRIGGERS, UNCERTAINTY_PHRASES,
    MATH_PROMPT, SYSTEM_PROMPT,
    CACHE_EXPIRY, log, genai,
)

_model_name = None   # cached Gemini model name


# ── Input sanitization ────────────────────────────────────────────

def sanitize_text(text: str, max_len: int = MAX_MESSAGE_LEN) -> str:
    """Strip, remove control chars, enforce max length."""
    if not text:
        return ""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text).strip()
    if len(text) > max_len:
        text = text[:max_len]
    return text


def validate_sid(sid: str) -> str:
    sid = sanitize_text(sid, 100)
    sid = re.sub(r"[^a-z0-9_]", "_", sid.lower())
    if not sid or len(sid) < 3 or ".." in sid or "/" in sid:
        raise HTTPException(400, "Invalid session ID.")
    return sid


def safe_path(base_dir, filename: str):
    """Return a safe path inside base_dir — prevents path traversal."""
    from pathlib import Path
    safe_name = re.sub(r"[^a-zA-Z0-9_\-.]", "_", filename)
    full_path  = (Path(base_dir) / safe_name).resolve()
    try:
        full_path.relative_to(Path(base_dir).resolve())
    except ValueError:
        log.warning(f"Path traversal attempt: {filename}")
        raise HTTPException(400, "Invalid file path.")
    return full_path


def validate_name(name: str) -> str:
    name = sanitize_text(name, MAX_NAME_LEN)
    if not name or len(name) < 2:
        raise HTTPException(400, "Name must be at least 2 characters.")
    if not re.match(r"^[a-zA-Z\s\-'.]+$", name):
        raise HTTPException(400, "Name contains invalid characters.")
    return name


def validate_matric(matric: str) -> str:
    matric = sanitize_text(matric, MAX_MATRIC_LEN)
    if not matric or len(matric) < 3:
        raise HTTPException(400, "Matric number too short.")
    if not re.match(r"^[a-zA-Z0-9\-/]+$", matric):
        raise HTTPException(400, "Matric number contains invalid characters.")
    return matric


def validate_message(msg: str) -> str:
    msg = sanitize_text(msg, MAX_MESSAGE_LEN)
    if not msg:
        raise HTTPException(400, "Message cannot be empty.")
    return msg


# ── Gemini AI helpers ─────────────────────────────────────────────

def get_model() -> str:
    global _model_name
    if _model_name:
        return _model_name
    if not API_KEY or not GEMINI_AVAILABLE:
        return GEMINI_MODELS[0]
    genai.configure(api_key=API_KEY)
    try:
        available = [
            m.name.replace("models/", "") for m in genai.list_models()
            if "generateContent" in m.supported_generation_methods
        ]
        for m in GEMINI_MODELS:
            if m in available:
                _model_name = m
                log.info(f"Using Gemini model: {m}")
                return m
    except Exception as e:
        log.error(f"Model list failed: {e}")
    _model_name = GEMINI_MODELS[0]
    return _model_name


def friendly_gemini_error(e) -> str:
    msg = str(e).lower()
    if "quota" in msg or "429" in msg:
        return "I'm getting a lot of questions right now. Please try again in a moment."
    if "safety" in msg or "blocked" in msg:
        return "That question triggered a content filter. Try rephrasing it."
    if "timeout" in msg or "deadline" in msg:
        return "Response took too long. Please try again."
    return "Something went wrong with the AI. Please try again."


def gemini_ask(session: list, question: str) -> str:
    """Send a question to Gemini using an existing chat session."""
    if not GEMINI_AVAILABLE or not API_KEY:
        return "AI is not configured. Please set GOOGLE_API_KEY."
    try:
        genai.configure(api_key=API_KEY)
        model  = get_model()
        chat   = genai.GenerativeModel(model).start_chat(history=session or [])
        resp   = chat.send_message(question)
        return resp.text.strip() if resp.text else "I couldn't generate a response."
    except Exception as e:
        log.error(f"gemini_ask error: {e}")
        return friendly_gemini_error(e)


def gemini_once(prompt: str, temp: float = 0.8, tokens: int = 600) -> str:
    """One-shot Gemini call with no session history."""
    if not GEMINI_AVAILABLE or not API_KEY:
        return ""
    try:
        genai.configure(api_key=API_KEY)
        model  = get_model()
        config = genai.types.GenerationConfig(temperature=temp, max_output_tokens=tokens)
        resp   = genai.GenerativeModel(model).generate_content(prompt, generation_config=config)
        return resp.text.strip() if resp.text else ""
    except Exception as e:
        log.error(f"gemini_once error: {e}")
        return ""


def solve_local(text: str) -> str | None:
    """Attempt simple arithmetic locally before hitting Gemini."""
    import ast, operator
    allowed = {ast.Add: operator.add, ast.Sub: operator.sub,
               ast.Mult: operator.mul, ast.Div: operator.truediv}
    expr = re.sub(r"[^0-9+\-*/().\s]", "", text.split("=")[-1]).strip()
    if not expr:
        return None
    try:
        tree = ast.parse(expr, mode="eval")
        def _eval(node):
            if isinstance(node, ast.Expression): return _eval(node.body)
            if isinstance(node, ast.Constant):   return node.value
            if isinstance(node, ast.BinOp):
                op = allowed.get(type(node.op))
                if not op: raise ValueError
                return op(_eval(node.left), _eval(node.right))
            raise ValueError
        result = _eval(tree)
        return f"{expr} = {round(result, 6)}" if isinstance(result, float) else f"{expr} = {result}"
    except Exception:
        return None


def is_math(text: str) -> bool:
    lower = text.lower()
    return any(t in lower for t in MATH_TRIGGERS)


def is_uncertain(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in UNCERTAINTY_PHRASES)


def parse_quiz_json(raw: str, topic: str) -> dict | None:
    """Parse Gemini quiz JSON output, with basic repair."""
    if not raw:
        return None
    try:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group(0))
    except Exception:
        pass
    return None


# ── Misc helpers ──────────────────────────────────────────────────

def _resolve_token(data: dict) -> tuple[str, str]:
    """Extract (sid, name) from a request dict containing a token."""
    from utils.auth import get_session_from_token
    token = data.get("token", "")
    sess  = get_session_from_token(token)
    if not sess:
        raise HTTPException(401, "Invalid session.")
    return sess["sid"], sess.get("name", "User")


def load_env():
    from pathlib import Path
    env = Path(".env")
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        import os
        os.environ.setdefault(k.strip(), v.strip())
