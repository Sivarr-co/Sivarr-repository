"""Optional Redis layer for Sivarr — rate limiting + shared response cache.

Enabled when REDIS_URL is set, the `redis` package is importable, and a ping
succeeds. Everything degrades gracefully: if Redis is unavailable at any point,
callers fall back to the existing Postgres / in-memory paths. These functions
never raise — a Redis hiccup must never break a request.

Why it matters on the free Supabase tier: rate-limit checks used to hit Postgres
on EVERY request and the response cache was per-worker. Moving both to Redis
removes most of that Postgres traffic and shares cache across workers/instances,
so the limited DB connection pool stretches much further.
"""
import json
import logging
import os

log = logging.getLogger("sivarr")

_REDIS_URL = os.environ.get("REDIS_URL", "").strip()
_client = None
_enabled = False


def _connect():
    global _client, _enabled
    if not _REDIS_URL:
        return
    try:
        import redis  # added to requirements.txt
        c = redis.from_url(
            _REDIS_URL,
            socket_connect_timeout=3, socket_timeout=3,
            retry_on_timeout=True, decode_responses=True,
            health_check_interval=30,
        )
        c.ping()
        _client = c
        _enabled = True
        log.info("Redis cache layer ready")
    except Exception as exc:
        _client = None
        _enabled = False
        log.warning(f"Redis unavailable — falling back to DB/in-memory: {exc}")


_connect()


def available() -> bool:
    return _enabled and _client is not None


# ── Rate limiting (atomic fixed-window INCR + EXPIRE) ─────────────────────────
def rate_allow(key: str, limit: int, window: int):
    """True/False if allowed, or None when Redis is unavailable (caller falls back).
    First hit in a window sets the TTL; subsequent hits just INCR."""
    if not available():
        return None
    try:
        rk = f"rl:{key}"
        n = _client.incr(rk)
        if n == 1:
            _client.expire(rk, window)
        return n <= limit
    except Exception as exc:
        log.warning(f"redis rate_allow failed ({exc}) — falling back")
        return None


# ── Shared counters (account lockout, etc.) ──────────────────────────────────
# Cross-worker failed-login tracking. Returns None when Redis is unavailable so
# callers fall back to the in-memory counter.
def get_int(key: str):
    if not available():
        return None
    try:
        v = _client.get(f"lk:{key}")
        return int(v) if v is not None else 0
    except Exception:
        return None


def bump(key: str, ttl: int):
    """Atomic INCR with a TTL set on the first hit. Returns the new count, or None."""
    if not available():
        return None
    try:
        rk = f"lk:{key}"
        n = _client.incr(rk)
        if n == 1:
            _client.expire(rk, ttl)
        return n
    except Exception:
        return None


def clear(key: str) -> None:
    if not available():
        return
    try:
        _client.delete(f"lk:{key}")
    except Exception:
        pass


# ── Shared response cache ────────────────────────────────────────────────────
def cache_get(key: str):
    if not available():
        return None
    try:
        v = _client.get(f"rc:{key}")
        return json.loads(v) if v is not None else None
    except Exception:
        return None


def cache_set(key: str, value, ttl: int = 60) -> bool:
    if not available():
        return False
    try:
        _client.set(f"rc:{key}", json.dumps(value), ex=max(1, int(ttl)))
        return True
    except Exception:
        return False


def cache_bust(prefix: str) -> None:
    if not available():
        return
    try:
        for k in _client.scan_iter(match=f"rc:{prefix}*", count=300):
            _client.delete(k)
    except Exception:
        pass
