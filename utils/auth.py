"""
utils/auth.py — Session management, token creation, account lockout
"""

import datetime
import secrets
import database as db
from config import SESSION_TTL_DAYS, CHAT_SESSION_TTL, LOGIN_LOCK_ATTEMPTS, LOGIN_LOCK_MINUTES, log

# ── In-memory stores (process lifetime) ──────────────────────────
_session_tokens:    dict = {}   # token → {sid, name, email, expires}
_admin_sessions:    dict = {}   # token → expiry datetime
_lecturer_sessions: dict = {}   # token → expiry datetime
_failed_logins:     dict = {}   # email → {count, locked_until}
_chat_sessions:     dict = {}   # sid → {chat, math, last_used}

_PRIV_SESSION_TTL = datetime.timedelta(hours=2)


# ── Account lockout ───────────────────────────────────────────────

def _check_account_lockout(email: str) -> None:
    """Raise 429 if account is currently locked."""
    from fastapi import HTTPException
    rec = _failed_logins.get(email)
    if not rec:
        return
    locked_until = rec.get("locked_until")
    if locked_until and datetime.datetime.utcnow() < locked_until:
        secs_left = int((locked_until - datetime.datetime.utcnow()).total_seconds())
        mins_left = max(1, (secs_left + 59) // 60)
        raise HTTPException(429, f"Account locked. Try again in {mins_left} minute(s).")
    if locked_until:
        _failed_logins.pop(email, None)


def _record_failed_login(email: str) -> None:
    rec = _failed_logins.setdefault(email, {"count": 0, "locked_until": None})
    rec["count"] += 1
    if rec["count"] >= LOGIN_LOCK_ATTEMPTS:
        rec["locked_until"] = datetime.datetime.utcnow() + datetime.timedelta(minutes=LOGIN_LOCK_MINUTES)
        log.warning(f"Account locked after {LOGIN_LOCK_ATTEMPTS} failed attempts: {email}")


def _clear_failed_login(email: str) -> None:
    _failed_logins.pop(email, None)


# ── User session tokens ───────────────────────────────────────────

def create_session_token(sid: str, name: str, email: str) -> str:
    token   = secrets.token_urlsafe(32)
    expires = datetime.datetime.utcnow() + datetime.timedelta(days=SESSION_TTL_DAYS)
    _session_tokens[token] = {"sid": sid, "name": name, "email": email, "expires": expires}
    if db.is_available():
        db.create_db_session(token, sid, name, email, expires)
    return token


def get_session_from_token(token: str) -> dict | None:
    if not token:
        return None
    entry = _session_tokens.get(token)
    if entry:
        if datetime.datetime.utcnow() < entry["expires"]:
            return entry
        del _session_tokens[token]
        return None
    if db.is_available():
        return db.get_db_session(token)
    return None


def delete_session_token(token: str) -> None:
    _session_tokens.pop(token, None)
    if db.is_available():
        db.delete_db_session(token)


def cleanup_expired_tokens():
    now   = datetime.datetime.utcnow()
    stale = [t for t, v in _session_tokens.items() if v.get("expires", now) <= now]
    for t in stale:
        del _session_tokens[t]
    if db.is_available():
        db.cleanup_db_sessions()


# ── Admin sessions (2-hour window) ────────────────────────────────

def _cleanup_priv_sessions(store: dict) -> None:
    now   = datetime.datetime.utcnow()
    stale = [t for t, exp in store.items() if exp <= now]
    for t in stale:
        del store[t]


def _create_admin_session() -> str:
    _cleanup_priv_sessions(_admin_sessions)
    token = "adm_" + secrets.token_urlsafe(32)
    _admin_sessions[token] = datetime.datetime.utcnow() + _PRIV_SESSION_TTL
    return token


def _is_valid_admin_session(token: str) -> bool:
    if not token:
        return False
    expiry = _admin_sessions.get(token)
    if not expiry:
        return False
    if datetime.datetime.utcnow() > expiry:
        del _admin_sessions[token]
        return False
    return True


# ── Lecturer sessions (2-hour window) ────────────────────────────

def _create_lecturer_session() -> str:
    _cleanup_priv_sessions(_lecturer_sessions)
    token = "lec_" + secrets.token_urlsafe(32)
    _lecturer_sessions[token] = datetime.datetime.utcnow() + _PRIV_SESSION_TTL
    return token


def _is_valid_lecturer_session(token: str) -> bool:
    if not token:
        return False
    expiry = _lecturer_sessions.get(token)
    if not expiry:
        return False
    if datetime.datetime.utcnow() > expiry:
        del _lecturer_sessions[token]
        return False
    return True


# ── AI chat session management ────────────────────────────────────

def get_chat_sessions() -> dict:
    return _chat_sessions


def evict_stale_chat_sessions():
    import time
    cutoff = time.time() - CHAT_SESSION_TTL
    stale  = [k for k, v in _chat_sessions.items() if v.get("last_used", 0) < cutoff]
    for k in stale:
        del _chat_sessions[k]
    if stale:
        log.info(f"Evicted {len(stale)} stale AI chat sessions")
