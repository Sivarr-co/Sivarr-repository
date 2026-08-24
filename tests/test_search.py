"""
Search: routes/search.py's unified_search, extracted from app.py this
session and backed by real Postgres full-text search (tasks/community posts)
where the underlying storage makes that possible — see routes/search.py's
module docstring for why goals/docs/skills/finance stay on a substring scan.

Tests are split by what they need:
- Always run, exercising the JSON-fallback path (no DATABASE_URL in this
  sandbox/CI, same as every other test in this suite — see test_smoke.py's
  own module docstring).
- Skipped at runtime when db.is_available() is False: real ts_rank ranking
  and the previously-broken community-post search (db.search_community_posts
  did not exist before this session; every call silently AttributeError'd).
  These are real, correct tests — they just can't execute without a real
  Postgres, which this environment doesn't have. Reported explicitly rather
  than a fake-passing empty test, per this project's standing rule 5 for
  reporting a Session Brief done.
"""

import pytest

import core
import database as db


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    import app as app_module
    return TestClient(app_module.app)


@pytest.fixture
def session_token():
    sid = "search_test_sid"
    name, email = "Search Tester", "searchtest@example.invalid"
    if db.is_available():
        # tasks.sid REFERENCES users(sid) — a session token alone is not a
        # real user row, so /api/tasks/add would 500 on the foreign key
        # without this when a real DB is configured (only reachable in this
        # sandbox by pointing DATABASE_URL at a scratch Postgres by hand;
        # CI has none, so this branch never runs there).
        db.create_user({"sid": sid, "name": name, "email": email})
    return core.create_session_token(sid, name, email)


# ── Always run — JSON-fallback path ─────────────────────────────────────

def test_search_excludes_deleted_task(client, session_token):
    """Same shape as test_smoke.py's test_search_excludes_deleted_goal —
    unified_search's task branch reads load_tasks(sid) directly in the
    no-DB fallback, bypassing whatever filtering /api/tasks itself does, so
    it needs its own regression coverage."""
    unique = "Zzyzx9SearchTask"
    add = client.post("/api/tasks/add", json={"token": session_token, "title": unique})
    assert add.status_code == 200
    task_id = add.json()["task"]["id"]

    found = client.get(f"/api/search?q={unique}&token={session_token}").json()["results"]
    assert any(r["title"] == unique and r["type"] == "task" for r in found)

    client.post("/api/tasks/delete", json={"token": session_token, "id": task_id})

    found_after = client.get(f"/api/search?q={unique}&token={session_token}").json()["results"]
    assert not any(r["title"] == unique and r["type"] == "task" for r in found_after)


def test_search_requires_auth(client):
    r = client.get("/api/search?q=anything&token=not-a-real-token")
    assert r.status_code == 401


def test_search_short_query_returns_empty(client, session_token):
    r = client.get(f"/api/search?q=a&token={session_token}")
    assert r.json() == {"results": []}


def test_search_results_have_original_response_shape(client, session_token):
    """The brief this session for search work under required the response
    shape to stay {type, icon, title, meta, id} unchanged so js/app.js (not
    touched this session) keeps working. `score` is new and additive —
    check it doesn't replace or rename anything, not that it's absent."""
    unique = "Zzyzx9ShapeCheck"
    client.post("/api/tasks/add", json={"token": session_token, "title": unique})
    found = client.get(f"/api/search?q={unique}&token={session_token}").json()["results"]
    hit = next(r for r in found if r["title"] == unique)
    for key in ("type", "icon", "title", "meta", "id"):
        assert key in hit
    assert isinstance(hit["score"], float)


# ── Skipped without a real Postgres connection ──────────────────────────

def test_task_search_ranks_stronger_match_first(client, session_token):
    if not db.is_available():
        pytest.skip("needs a real Postgres connection for ts_rank — see module docstring")
    unique = "Zzyzx9Ranking"
    # Weak match: the term appears once, in a longer, more generic title.
    client.post("/api/tasks/add", json={
        "token": session_token,
        "title": f"Random notes mentioning {unique} only in passing",
    })
    # Strong match: the term dominates a short title — higher term frequency
    # relative to document length, which ts_rank weights higher.
    client.post("/api/tasks/add", json={
        "token": session_token,
        "title": f"{unique} {unique}",
    })
    found = client.get(f"/api/search?q={unique}&token={session_token}").json()["results"]
    task_titles = [r["title"] for r in found if r["type"] == "task"]
    assert task_titles[0] == f"{unique} {unique}", (
        f"expected the higher-term-frequency title ranked first, got order: {task_titles}"
    )


def test_community_post_search_returns_real_results(client, session_token):
    """Regression test for the bug found this session: db.search_community_posts
    did not exist, so every /api/search call silently AttributeError'd inside
    a bare except Exception: pass and posts never appeared in results."""
    if not db.is_available():
        pytest.skip("needs a real Postgres connection — see module docstring")
    unique = "Zzyzx9CommunityPost"
    create = client.post("/api/community/posts", json={
        "token": session_token, "body": f"A post about {unique} for testing search",
    })
    assert create.status_code == 200

    found = client.get(f"/api/search?q={unique}&token={session_token}").json()["results"]
    assert any(r["type"] == "post" and unique in r["title"] for r in found)
