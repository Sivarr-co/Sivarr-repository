"""
Focus sessions: routes/focus.py, added this session (12) to close the gap
Session 2 deliberately left open (FocusScreen was AsyncStorage-only, no
/api/focus endpoint existed).

Rides the generic `collections` table, which has no JSON-file fallback --
same as org.py/academic.py. Locally, and in CI before Session 14, there was
never a DATABASE_URL at all, so the 503 tests below exercised the real
no-DB path ambiently. Session 14 added a real Postgres to CI, so they now
force it via the `no_db` fixture (tests/conftest.py) instead of relying on
the environment. The persistence-round-trip tests mock database.py's
collections calls (same pattern tests/test_realtime.py uses for org.py)
since there's no real Postgres to hit locally.

The 503 checks are a regression test for a real bug caught by actually
running add-then-list locally, not by reading the code: coll_put/coll_list
silently no-op with no DB connection, so add_focus_session used to return
{"ok": True} for a write that never happened. db.is_available() is checked
explicitly now, matching routes/org.py's own convention.
"""

import pytest

import core
import database as db


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    import app as app_module
    return TestClient(app_module.app)


def _token(sid: str) -> str:
    return core.create_session_token(sid, sid, f"{sid}@example.invalid")


# ── Auth / precondition ──────────────────────────────────────────────────

def test_focus_add_requires_auth(client):
    r = client.post("/api/focus/add", json={"task": "x", "date": "2026-08-24"})
    assert r.status_code == 401


def test_focus_list_requires_auth(client):
    r = client.get("/api/focus?token=not-a-real-token")
    assert r.status_code == 401


# ── No DB configured -- forced via the no_db fixture (tests/conftest.py),
# not ambient: Session 14 added a real Postgres to CI, so "no DATABASE_URL"
# is no longer this suite's default environment there. ─────────────────

def test_focus_add_503s_without_db_instead_of_lying(client, no_db):
    token = _token("focus_no_db_add")
    r = client.post("/api/focus/add", json={"token": token, "task": "x", "date": "2026-08-24"})
    assert r.status_code == 503
    assert not db.is_available()  # confirms this is exercising the real no-DB path, not a fluke


def test_focus_list_503s_without_db(client, no_db):
    token = _token("focus_no_db_list")
    r = client.get(f"/api/focus?token={token}")
    assert r.status_code == 503


# ── With a DB (mocked, same monkeypatch approach as tests/test_realtime.py) ─

def test_focus_add_then_list_round_trip(client, monkeypatch):
    store = {}
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "coll_put", lambda collection, item_id, data, owner="": store.__setitem__(item_id, data))
    monkeypatch.setattr(db, "coll_list", lambda collection, owner=None: [v for k, v in store.items() if k.startswith(f"{owner}:")])

    token = _token("focus_roundtrip")
    add = client.post("/api/focus/add", json={
        "token": token, "task": "Deep work", "duration": 25, "date": "2026-08-24",
    })
    assert add.status_code == 200
    assert add.json()["ok"] is True
    session_id = add.json()["session"]["id"]
    assert session_id

    found = client.get(f"/api/focus?token={token}").json()["sessions"]
    assert any(s["id"] == session_id and s["task"] == "Deep work" and s["duration"] == 25 for s in found)


def test_focus_add_defaults_task_when_blank(client, monkeypatch):
    store = {}
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "coll_put", lambda collection, item_id, data, owner="": store.__setitem__(item_id, data))
    monkeypatch.setattr(db, "coll_list", lambda collection, owner=None: [v for k, v in store.items() if k.startswith(f"{owner}:")])

    token = _token("focus_blank_task")
    add = client.post("/api/focus/add", json={"token": token, "task": "  ", "date": "2026-08-24"})
    assert add.json()["session"]["task"] == "Focus Session"


def test_focus_add_requires_date(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    token = _token("focus_no_date")
    r = client.post("/api/focus/add", json={"token": token, "task": "x"})
    assert r.status_code == 400


def test_focus_list_scoped_to_owner(client, monkeypatch):
    """coll_list is called with owner=sid -- a session belonging to a
    different sid must never appear, same IDOR-shaped concern every other
    per-user collection read in this codebase guards against."""
    all_rows_by_owner = {
        "focus_owner_a:s1": {"id": "s1", "task": "Owner A's session", "duration": 25, "date": "2026-08-24"},
        "focus_owner_b:s2": {"id": "s2", "task": "Owner B's session", "duration": 25, "date": "2026-08-24"},
    }
    monkeypatch.setattr(db, "is_available", lambda: True)

    def fake_coll_list(collection, owner=None):
        assert owner == "focus_owner_a", f"leaked query for another owner: {owner!r}"
        return [v for k, v in all_rows_by_owner.items() if k.startswith(f"{owner}:")]

    monkeypatch.setattr(db, "coll_list", fake_coll_list)

    token = _token("focus_owner_a")
    found = client.get(f"/api/focus?token={token}").json()["sessions"]
    assert any(s["id"] == "s1" for s in found)
    assert not any(s["id"] == "s2" for s in found)
