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

import database as db


@pytest.fixture(scope="session", autouse=True)
def _init_db_schema():
    if db.is_available():
        db.init_db()


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
