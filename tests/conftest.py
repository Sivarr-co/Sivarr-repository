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
