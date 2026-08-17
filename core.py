"""
Shared primitives used by app.py and every module under routes/.

WHY THIS FILE EXISTS
--------------------
Route modules used to do `from app import get_session_from_token, sanitize_text, ...`,
which imports from a *partially loaded* app module. That only works if app.py's
`include_router(...)` calls sit physically below every helper the routers need —
an ordering constraint on a 12,000-line file that gets more fragile with every
router added (see the comment that used to live at the top of routes/tasks.py).

Everything here is leaf-level: it imports database.py and the standard library,
never app.py. That makes the dependency direction one-way

    core.py  ←  app.py
    core.py  ←  routes/*.py

so routers can be imported at the top of app.py like any normal module, and a
new router never needs to think about where in app.py it gets included.

NOTE ON _session_tokens: app.py does `from core import _session_tokens` and then
mutates it in ~20 places (admin session listing, revoke-on-logout, the stale
eviction sweep). That works because the import binds the *same dict object* —
mutation is shared. Never rebind it (`_session_tokens = {}`); clear it in place
(`.clear()`) if that is ever needed.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import uuid
from pathlib import Path

import database as db

log = logging.getLogger("sivarr")

# ═══════════════════════════════════════════════════════════════
#  PATHS & LIMITS
# ═══════════════════════════════════════════════════════════════

# Railway persistent volume if mounted, else the repo root.
_BASE       = Path(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "."))
DATA_DIR    = _BASE / "data"
UPLOADS_DIR = _BASE / "uploads"
SHARES_DIR  = _BASE / "shares"
LOG_DIR     = _BASE / "logs"

MAX_MESSAGE_LEN = 2000    # max characters in a chat message

SESSION_TTL_DAYS = max(1, min(int(os.environ.get("SESSION_TTL_DAYS", "30")), 90))
SESSION_REVALIDATE_SECONDS = 30    # how often a cached session is re-checked against the DB


# ═══════════════════════════════════════════════════════════════
#  INPUT VALIDATION
# ═══════════════════════════════════════════════════════════════

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_text(text: str, max_len: int = MAX_MESSAGE_LEN) -> str:
    """
    Clean and validate text input.
    - Strips whitespace
    - Removes null bytes and control characters
    - Enforces max length

    NOTE: this does NOT strip path-traversal sequences (../, /, \\). For any
    value interpolated into a filesystem path (e.g. sid), use validate_sid().
    """
    if not text:
        return ""
    # Remove null bytes and non-printable control chars (keep newlines/tabs)
    text = _CONTROL_CHARS_RE.sub("", text)
    text = text.strip()
    if len(text) > max_len:
        text = text[:max_len]
        log.info(f"Input truncated to {max_len} chars")
    return text


# ═══════════════════════════════════════════════════════════════
#  ATOMIC JSON WRITE
# ═══════════════════════════════════════════════════════════════

def save_json(p, data):
    tmp = str(p) + f".{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    shutil.move(tmp, str(p))


# ═══════════════════════════════════════════════════════════════
#  TOKEN-BASED SESSION MANAGEMENT
# ═══════════════════════════════════════════════════════════════

_session_tokens: dict = {}   # token → {sid, name, email, expires, checked}


def create_session_token(sid: str, name: str, email: str) -> str:
    token   = secrets.token_urlsafe(32)
    expires = datetime.datetime.utcnow() + datetime.timedelta(days=SESSION_TTL_DAYS)
    _session_tokens[token] = {"sid": sid, "name": name, "email": email, "expires": expires,
                              "checked": datetime.datetime.utcnow()}
    if db.is_available():
        db.create_db_session(token, sid, name, email, expires)
    return token


def create_session_token_for_existing(token: str, sid: str, name: str, email: str) -> None:
    """Register an already-issued token on this worker (cross-worker session recovery)."""
    expires = datetime.datetime.utcnow() + datetime.timedelta(days=SESSION_TTL_DAYS)
    _session_tokens[token] = {"sid": sid, "name": name, "email": email, "expires": expires,
                              "checked": datetime.datetime.utcnow()}
    if db.is_available():
        db.create_db_session(token, sid, name, email, expires)


def delete_all_sessions(sid: str, except_token: str | None = None) -> None:
    """Revoke every session for a user (optionally keeping the current one).
    Called on password change/reset. The DB delete is authoritative across workers;
    other workers drop their cached copy within SESSION_REVALIDATE_SECONDS via the
    re-check in get_session_from_token."""
    if db.is_available():
        db.delete_sessions_for_sid(sid, except_token)
    # Purge this worker's in-memory cache immediately.
    for tok in [t for t, e in list(_session_tokens.items())
                if e.get("sid") == sid and t != except_token]:
        _session_tokens.pop(tok, None)


def get_session_from_token(token: str) -> dict | None:
    if not token:
        return None
    # Check in-memory first
    entry = _session_tokens.get(token)
    if entry:
        if datetime.datetime.utcnow() >= entry["expires"]:
            del _session_tokens[token]
            return None
        # Periodically re-validate against the DB so a session revoked on another
        # worker (e.g. password reset) stops working within SESSION_REVALIDATE_SECONDS
        # instead of lingering in this worker's cache until its 30-day TTL.
        if db.is_available():
            checked = entry.get("checked")
            if checked is None or (datetime.datetime.utcnow() - checked).total_seconds() > SESSION_REVALIDATE_SECONDS:
                if db.get_db_session(token) is None:
                    del _session_tokens[token]
                    return None
                entry["checked"] = datetime.datetime.utcnow()
        return entry
    # Fallback: check DB and warm this worker's cache for subsequent requests
    if db.is_available():
        db_entry = db.get_db_session(token)
        if not db_entry:
            return None
        # Normalise the DB row to the in-memory shape before caching. get_db_session
        # returns a tz-aware "expires_at" (TIMESTAMPTZ); the in-memory cache + the
        # stale-eviction sweep expect a naive-UTC "expires". Caching the raw DB shape
        # makes the next lookup KeyError on entry["expires"] and the eviction sweep
        # treat the entry as already-expired (v.get("expires", now) <= now) — both of
        # which silently log the user out on reload. Map the key and drop the tzinfo.
        exp = db_entry.get("expires_at")
        if exp is not None and exp.tzinfo is not None:
            exp = exp.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        entry = {
            "sid":     db_entry["sid"],
            "name":    db_entry["name"],
            "email":   db_entry["email"],
            "expires": exp,
            "checked": datetime.datetime.utcnow(),
        }
        _session_tokens[token] = entry
        return entry
    return None


def delete_session_token(token: str) -> None:
    _session_tokens.pop(token, None)
    if db.is_available():
        db.delete_db_session(token)


# ═══════════════════════════════════════════════════════════════
#  PER-USER JSON LISTS  (goals / tasks / habits / journal / docs)
# ═══════════════════════════════════════════════════════════════

def _load_user_list(sid: str, key: str) -> list:
    """Load a per-user JSON list (goals/tasks/journal). DB-first via the user_blobs
    table — atomic row writes, shared across workers/instances, included in Supabase
    backups, and free of the whole-file read-modify-write races the per-user JSON
    files had. Lazily migrates a legacy `{sid}_{key}.json` file into the DB on first
    access. Falls back to the file only when no DB is configured."""
    legacy = DATA_DIR / f"{sid}_{key}.json"
    if db.is_available():
        blob = db.get_user_blob(sid, key)
        if isinstance(blob, list):
            return blob
        if legacy.exists():
            try:
                items = json.loads(legacy.read_text(encoding="utf-8"))
                if isinstance(items, list):
                    db.save_user_blob(sid, key, items)
                    return items
            except Exception as exc:
                log.warning(f"{key} file→DB migrate failed for {sid[:8]}: {exc}")
        return []
    return json.loads(legacy.read_text(encoding="utf-8")) if legacy.exists() else []


def _save_user_list(sid: str, key: str, items: list) -> None:
    if db.is_available():
        db.save_user_blob(sid, key, items)
        return
    save_json(DATA_DIR / f"{sid}_{key}.json", items)


# ═══════════════════════════════════════════════════════════════
#  CONTENT-HASHED STATIC ASSETS
# ═══════════════════════════════════════════════════════════════
#
# /css/, /js/ and /static/ are served with `Cache-Control: immutable,
# max-age=31536000` (_StaticCacheMiddleware in app.py), so a browser that has
# loaded `/js/app.js?v=X` will NEVER re-check the server for that exact URL.
# The version string is the only thing that busts it.
#
# That used to be a hand-maintained date string (`?v=20260815a`) repeated across
# every <link>/<script> tag in index.html. Forgetting to bump it shipped a fix
# that silently never reached anyone who had opened the app before — which looks
# exactly like the fix not working, and cost several debugging rounds. Worse, the
# js/features/*.js and css/features/*.css tags added during the first extraction
# pass carried NO version string at all, so those files could never be updated in
# a returning user's browser.
#
# asset() replaces that with a hash of the file's actual bytes. Change a file and
# its URL changes automatically; don't change it and the URL stays stable so the
# cached copy keeps being used. There is nothing left to remember to bump.

_ASSET_HASHES: dict[str, str] = {}

# Re-stat files on every call in development so edits show up without a restart.
# In production the hash is computed once per worker and cached forever.
_ASSET_DEV_MODE = os.environ.get("RAILWAY_ENVIRONMENT", "production") == "development"


def _hash_file(fs_path: Path) -> str:
    h = hashlib.sha256()
    with open(fs_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:10]


def asset(url_path: str) -> str:
    """Return `url_path` with a content-hash cache-buster appended.

        asset("/js/app.js")  ->  "/js/app.js?v=3f9a2b1c04"

    Falls back to the bare path if the file is missing, so a typo in a template
    degrades to an un-busted (but still working) URL rather than a 500.
    """
    if not _ASSET_DEV_MODE and url_path in _ASSET_HASHES:
        return f"{url_path}?v={_ASSET_HASHES[url_path]}"

    fs_path = Path(url_path.lstrip("/"))
    try:
        digest = _hash_file(fs_path)
    except OSError:
        log.warning(f"asset() — file not found, serving unversioned: {url_path}")
        return url_path

    _ASSET_HASHES[url_path] = digest
    return f"{url_path}?v={digest}"


# The set of assets the service worker precaches. Kept here so sw_cache_version()
# and js/sw.js's PRECACHE list can never drift apart.
SW_PRECACHE_ASSETS = [
    "/static/sivarrai.png",
    "/static/manifest.json",
    "/css/base.css",
    "/css/layout.css",
    "/css/panels.css",
    "/css/mobile.css",
    "/js/app.js",
]


def sw_cache_version() -> str:
    """A short hash over every precached asset's content hash.

    js/sw.js names its Cache Storage bucket `sivarr-<this>`, so changing any
    precached file changes the bucket name, which makes the service worker's
    activate handler drop the old bucket and re-fetch everything. That used to be
    a hand-incremented `sivarr-v8` that was easy to forget.
    """
    combined = "|".join(asset(p) for p in SW_PRECACHE_ASSETS)
    return hashlib.sha256(combined.encode()).hexdigest()[:10]
