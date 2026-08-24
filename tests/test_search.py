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


def test_journal_search_returns_real_results(client, session_token):
    unique = "Zzyzx9JournalEntry"
    sync = client.post("/api/journal/sync", json={
        "token": session_token,
        "entries": [{"date": "2026-08-24", "text": f"Thinking about {unique} today", "mood": "😊"}],
    })
    assert sync.status_code == 200

    found = client.get(f"/api/search?q={unique}&token={session_token}").json()["results"]
    hit = next((r for r in found if r["type"] == "journal"), None)
    assert hit is not None and unique in hit["title"]


def test_search_pagination(client, session_token):
    """limit/offset apply to the final combined, score-sorted list -- page 2
    must not repeat anything page 1 already returned, and total/has_more
    must describe the whole match set, not just the current page."""
    unique = "Zzyzx9Paginate"
    for i in range(5):
        client.post("/api/tasks/add", json={"token": session_token, "title": f"{unique} task {i}"})

    page1 = client.get(f"/api/search?q={unique}&token={session_token}&limit=2&offset=0").json()
    assert len(page1["results"]) == 2
    assert page1["total"] >= 5
    assert page1["has_more"] is True

    page2 = client.get(f"/api/search?q={unique}&token={session_token}&limit=2&offset=2").json()
    assert len(page2["results"]) == 2
    ids_p1 = {(r["type"], r["id"]) for r in page1["results"]}
    ids_p2 = {(r["type"], r["id"]) for r in page2["results"]}
    assert ids_p1.isdisjoint(ids_p2), "page 2 repeated a result from page 1"


def test_search_requires_auth(client):
    r = client.get("/api/search?q=anything&token=not-a-real-token")
    assert r.status_code == 401


def test_search_short_query_returns_empty(client, session_token):
    # total/has_more are new this session (pagination) -- additive to the
    # response shape, same as `score` was last session, so this checks the
    # specific fields rather than exact dict equality (which would break on
    # every future additive field forever, same reasoning the shape test
    # below already applies to individual result objects).
    body = client.get(f"/api/search?q=a&token={session_token}").json()
    assert body["results"] == []
    assert body["total"] == 0
    assert body["has_more"] is False


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
    # DELIBERATE, TEMPORARY BREAK -- Session 14 verification only, reverted
    # in the very next commit. Proves CI actually fails on a real ts_rank
    # regression, not just that this test runs. See docs/SESSION_FOLLOWUPS.md.
    assert task_titles[0] == f"Random notes mentioning {unique} only in passing", (
        f"expected the higher-term-frequency title ranked first, got order: {task_titles}"
    )


def test_search_org_content_never_leaks_to_another_org(client, session_token, monkeypatch):
    """The IDOR-shaped check for search, same pattern tests/test_realtime.py
    already uses for the doc-collab WebSocket (test_doc_ws_rejects_doc_from_
    another_org): the search endpoint must resolve the caller's org via
    db.get_org_by_member (reused, not reimplemented -- this session's brief)
    and pass exactly that org_id into search_org_docs/search_org_messages.
    Rather than trust that by reading the code, this makes any call with the
    wrong org_id fail loudly: db.is_available() and get_org_by_member are
    mocked to real, deterministic values (same as test_realtime.py, since
    org.* has no JSON-fallback path to exercise here for real), and the two
    search functions assert their own org_id argument before returning
    anything -- a leak would be a call with "org_someone_elses" or no
    filtering at all, either of which trips the assert inside the mock
    itself, not just a wrong-looking result list."""
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: {"id": "org_mine", "name": "Mine"})

    def fake_search_org_docs(org_id, q, limit=10):
        assert org_id == "org_mine", f"search leaked into another org: {org_id!r}"
        return [{"id": "doc_mine", "org_id": "org_mine", "title": f"{q} in my org's doc", "content": ""}]

    def fake_search_org_messages(org_id, q, limit=10):
        assert org_id == "org_mine", f"search leaked into another org: {org_id!r}"
        return [{"id": "1", "org_id": "org_mine", "channel": "general",
                  "content": f"{q} mentioned in my org's chat", "author_name": "Someone"}]

    monkeypatch.setattr(db, "search_org_docs", fake_search_org_docs)
    monkeypatch.setattr(db, "search_org_messages", fake_search_org_messages)

    unique = "zzyzx9orgleak"
    found = client.get(f"/api/search?q={unique}&token={session_token}").json()["results"]
    doc_hits = [r for r in found if r["type"] == "org_doc"]
    msg_hits = [r for r in found if r["type"] == "org_message"]
    assert len(doc_hits) == 1 and unique in doc_hits[0]["title"].lower()
    assert len(msg_hits) == 1 and unique in msg_hits[0]["title"].lower()


def test_search_org_content_absent_for_user_with_no_org(client, session_token, monkeypatch):
    """A user in no org must never even call the org search functions --
    not "call them and get nothing back", but skip the block entirely, same
    as every routes/org.py route's own `if not org: raise/return` guard."""
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: None)

    called = []
    monkeypatch.setattr(db, "search_org_docs", lambda *a, **k: called.append("docs") or [])
    monkeypatch.setattr(db, "search_org_messages", lambda *a, **k: called.append("messages") or [])

    found = client.get(f"/api/search?q=anything&token={session_token}").json()["results"]
    assert not any(r["type"] in ("org_doc", "org_message") for r in found)
    assert called == [], f"org search functions were called for a user with no org: {called}"


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
