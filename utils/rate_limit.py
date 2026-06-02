"""
utils/rate_limit.py — Sliding-window rate limiter + FastAPI helper.

Usage:
    from utils.rate_limit import check_rate_limit, get_client_key, limiter
    check_rate_limit(get_client_key(request), limit=20, endpoint="chat")
"""

import time
import json
import threading
from pathlib import Path
from fastapi import HTTPException, Request
from config import RATE_LIMIT_WINDOW, log


class RateLimiter:
    """Persistent rate limiter using sliding window per (endpoint, client) key."""

    def __init__(self):
        self._store: dict[str, list[float]] = {}
        self._lock  = threading.Lock()
        self._path: Path | None = None

    def _set_path(self, path: Path):
        self._path = path
        self._load()

    def _load(self):
        if self._path and self._path.exists():
            try:
                raw = json.loads(self._path.read_text())
                now = time.time()
                self._store = {
                    k: [t for t in v if now - t < RATE_LIMIT_WINDOW * 2]
                    for k, v in raw.items()
                }
            except Exception:
                self._store = {}

    def _flush(self):
        if self._path:
            try:
                self._path.write_text(json.dumps(self._store))
            except Exception:
                pass

    def is_allowed(self, key: str, limit: int, window: int = RATE_LIMIT_WINDOW) -> bool:
        with self._lock:
            now = time.time()
            hits = [t for t in self._store.get(key, []) if now - t < window]
            if len(hits) >= limit:
                self._store[key] = hits
                return False
            hits.append(now)
            self._store[key] = hits
            self._flush()
            return True

    def remaining(self, key: str, limit: int, window: int = RATE_LIMIT_WINDOW) -> int:
        now  = time.time()
        hits = [t for t in self._store.get(key, []) if now - t < window]
        return max(0, limit - len(hits))


limiter = RateLimiter()


def get_client_key(request: Request, sid: str = "") -> str:
    """Rate-limit key — prefer user ID, fall back to IP."""
    if sid:
        return f"student_{sid}"
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else request.client.host
    return f"ip_{ip}"


def check_rate_limit(key: str, limit: int, endpoint: str) -> None:
    """Raise HTTP 429 if the client has exceeded the rate limit."""
    full_key = f"{endpoint}_{key}"
    if not limiter.is_allowed(full_key, limit):
        log.warning(f"Rate limit exceeded | key={key} | endpoint={endpoint}")
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Please wait {RATE_LIMIT_WINDOW} seconds.",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )
