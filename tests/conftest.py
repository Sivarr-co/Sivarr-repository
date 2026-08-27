"""
Session 14 — the missing piece that makes a CI Postgres actually usable.

Setting DATABASE_URL alone is not enough. app.py's own schema-init call
(`db.init_db()`) runs from `@app.on_event("startup")`, and Starlette's
TestClient only fires startup/shutdown lifespan events when used as a
context manager (`with TestClient(app) as c:`). Every fixture in this
suite constructs it bare (`TestClient(app_module.app)`, no `with` --
see tests/test_search.py, tests/test_realtime.py, tests/test_focus.py),
so that handler never runs during the test suite, regardless of whether
DATABASE_URL is set. Without this fixture, a CI Postgres service
container would sit there completely un-migrated: db.is_available()
would correctly report True, but every table-touching query would fail
against a database with no tables -- a different-looking failure than
"no DB configured" that would be easy to misdiagnose as a real bug.

db.init_db() is idempotent and single-flight per process (its own
_schema_ready/_schema_attempted guards), so calling it here is safe even
though individual test modules may also happen to trigger it indirectly.
session-scoped + autouse so it runs at most once, automatically, no
per-file opt-in needed.

No-ops entirely when DATABASE_URL is unset (db.is_available() is False)
-- local runs without a database are unaffected, same as every test in
this suite already assumes.
"""

import pytest

import core

import database as db


@pytest.fixture(scope="session", autouse=True)
def _init_db_schema():
    if db.is_available():
        db.init_db()


@pytest.fixture
def clean_progress():
    """Reset a sid's persisted progress before use, and delete it afterward.

    Session 21: tests/test_embeddings.py's two chat tests POST to /api/chat
    as a fixed sid, and app.py's real save_progress() (DB row when available,
    always also a data/{sid}_progress.json file) persists the free-plan daily
    chat quota (chat_daily, checked at app.py:3307's _chat_authorize) across
    runs. After 15 real runs in one day both tests permanently 429 until the
    date rolls over -- reproduced locally as data/chat_isolation_sid_a_progress.json
    and data/chat_inject_sid_progress.json both sitting at questions=15,
    chat_daily.count=15. CI only looked hermetic because every run started on
    a clean checkout.

    Calls the real save_progress()/DATA_DIR -- not a second reset mechanism --
    so this clears the actual state _chat_authorize reads, in both the DB
    path (when DATABASE_URL is set, e.g. CI) and the JSON-file path (local),
    rather than a test-local double that could drift from what production
    actually persists. Deliberately does NOT touch chat_authorize's sid
    resolution itself, since that's the thing the isolation test exists to
    exercise for real.
    """
    import app as app_module

    touched = set()

    def _reset(sid: str) -> str:
        app_module.save_progress(sid, dict(app_module._PROGRESS_DEFAULTS))
        touched.add(sid)
        return sid

    yield _reset

    for sid in touched:
        # save_progress() itself just wrote defaults (above, or inside the
        # test) -- delete outright afterward so no file is left behind at
        # all, not merely reset to zero. save_progress() also copies
        # whatever was there into a .backup.json before overwriting, so
        # that needs clearing too.
        for suffix in ("_progress.json", "_progress.backup.json"):
            try:
                (app_module.DATA_DIR / f"{sid}{suffix}").unlink()
            except FileNotFoundError:
                pass


@pytest.fixture
def no_db(monkeypatch):
    """Force the genuine 'no database configured' code path for one test,
    regardless of whether DATABASE_URL is actually set in this environment.

    Before Session 14, DATABASE_URL was never set in CI at all, so a dozen
    tests across this suite verified graceful no-DB degradation (routes
    that 503, db.* functions that no-op) by ambient default -- no mocking
    needed, because there was never a database to accidentally hit. Adding
    a real Postgres service container to CI (this session) silently broke
    every one of them: the behavior they test for was no longer the actual
    environment, so is_available() started returning True and each
    assertion failed, not because anything is broken but because their
    premise quietly stopped holding. Caught by watching a real CI run
    fail, not by reading the change.

    Blanking is_available() alone is not enough: _get_conn()/_get_pool()
    check the module-level _DATABASE_URL directly, not is_available(), and
    _get_pool() short-circuits on an already-cached _pool before it would
    even re-check the URL -- by the time any test runs, the session-scoped
    _init_db_schema fixture above has already triggered real pool creation
    once DATABASE_URL is set. All three are reset together so every code
    path that branches on DB availability (is_available() checks, and
    direct _get_conn()/_get_pool() callers) sees the same "no DB" state."""
    monkeypatch.setattr(db, "_DATABASE_URL", "")
    monkeypatch.setattr(db, "_pool", None)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear the in-memory rate limiter before every test.

    core.limiter keys on client IP, and every TestClient request presents the
    same one ("testclient"). Without this, tests that hit a rate-limited
    endpoint (/api/login, /api/chat, ...) accumulate against a shared counter,
    so a test passes alone and 429s once the suite grows past the limit. That
    is a false failure that looks like a product bug and moves depending on
    test ordering -- the same non-hermetic pattern Session 21 fixed for the
    chat quota. Autouse because no test ever wants inherited limiter state.
    """
    try:
        core.limiter._counts.clear()
    except Exception:
        pass
    yield
    try:
        core.limiter._counts.clear()
    except Exception:
        pass
