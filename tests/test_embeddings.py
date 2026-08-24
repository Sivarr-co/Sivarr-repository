"""
Embeddings (Session 9) and retrieval-augmented chat (Session 13).

Same split as tests/test_search.py's module docstring: some of this always
runs, some needs a real Postgres with the pgvector extension and is skipped
here with an explicit reason rather than silently passing empty.

The "no-op rather than a crash when pgvector is unavailable" requirement
*is* the always-runnable part — every database.py function under test here
is expected to degrade to an empty/False/None default, never raise, when
there's no DATABASE_URL at all (a stronger condition than "pgvector missing
on an otherwise-configured Postgres," but exercises the same code path:
embeddings_available() returning False and every other function short-
circuiting on it). Session 14 added a real Postgres to CI, so "no
DATABASE_URL" is no longer this suite's ambient default there -- these use
the `no_db` fixture (tests/conftest.py) to force that state deliberately
instead of relying on the environment, the same fix every other test in
this repo that assumed the same thing needed once CI stopped being
DB-less by default.

test_chat_retrieval_never_leaks_across_sids below is Session 13's
non-negotiable, written before the rest of the wiring per its own
instruction. It mirrors test_search.py's
test_search_org_content_never_leaks_to_another_org: mock the call one layer
below the endpoint so a wrong sid trips an assert inside the mock itself,
not just a wrong-looking reply, and specifically attempts the IDOR shape
(spoof `sid` in the request body while authenticating as someone else) —
the same class of bug chat_clear's _resolve_token pattern already guards
against elsewhere in this codebase.
"""

import pytest

import core
import database as db


def test_embeddings_available_false_without_database_url(no_db):
    assert db.is_available() is False, "this suite runs without DATABASE_URL — see test_search.py"
    assert db.embeddings_available() is False


def test_get_embedding_chunk_noop_without_db(no_db):
    assert db.get_embedding_chunk("sid", "task", "1") is None


def test_upsert_embedding_noop_without_db(no_db):
    assert db.upsert_embedding("sid", "task", "1", "some text", [0.1] * 768) is False


def test_prune_embeddings_noop_without_db(no_db):
    assert db.prune_embeddings("sid", "task", []) == 0


def test_search_embeddings_noop_without_db(no_db):
    assert db.search_embeddings("sid", [0.1] * 768) == []


def test_get_sids_with_tasks_noop_without_db(no_db):
    assert db.get_sids_with_tasks() == []


# ── Session 13: retrieval-augmented chat never crosses sids ────────────────

def test_chat_retrieval_never_leaks_across_sids(monkeypatch):
    """Always runs (no real Postgres needed) — this checks Python-level
    wiring in routes/ai_chat.py, not pgvector itself. async_gemini_ask is
    also mocked so this exercises real chat_authorize -> sid resolution
    without a real (unconfigured in this sandbox, network-dependent)
    Gemini call."""
    from fastapi.testclient import TestClient
    import app as app_module
    import routes.ai_chat as ai_chat_module

    client = TestClient(app_module.app)

    seen_sids = []

    async def fake_build_retrieval_context(sid, query, k=5):
        seen_sids.append(sid)
        assert sid == "chat_isolation_sid_a", f"retrieval used the wrong sid: {sid!r}"
        return ""

    async def fake_async_gemini_ask(session, question):
        return "ok"

    monkeypatch.setattr(ai_chat_module, "build_retrieval_context", fake_build_retrieval_context)
    monkeypatch.setattr(ai_chat_module, "async_gemini_ask", fake_async_gemini_ask)

    token_a = core.create_session_token("chat_isolation_sid_a", "A", "chatisoa@example.invalid")

    # The IDOR attempt: authenticate as A (a real, valid token) but spoof
    # `sid` in the body as someone else. chat_authorize must derive sid from
    # the token alone and ignore req.sid entirely -- if it doesn't, the
    # assert inside fake_build_retrieval_context above catches it.
    r = client.post("/api/chat", json={
        "sid": "chat_isolation_sid_b",   # attacker-controlled, must be ignored
        "token": token_a,
        "message": "Summarize my recent progress on things I've been working on",
    })
    assert r.status_code == 200
    assert seen_sids == ["chat_isolation_sid_a"]


def test_chat_actually_injects_retrieved_context_into_the_prompt(monkeypatch):
    """The isolation test above proves scoping; this proves the other half
    of the brief -- retrieved context must actually reach the Gemini call,
    not just be correctly scoped and then dropped. Captures the literal
    prompt text async_gemini_ask receives and asserts the retrieval block
    is in it, and that the persisted chat history stays clean (msg, not
    gemini_msg -- see the comment on that split in routes/ai_chat.py)."""
    from fastapi.testclient import TestClient
    import app as app_module
    import routes.ai_chat as ai_chat_module

    client = TestClient(app_module.app)

    FAKE_CONTEXT = "Relevant items from the user's own workspace:\n[task:abc123] Finish quarterly report"
    captured_prompts = []

    async def fake_build_retrieval_context(sid, query, k=5):
        return FAKE_CONTEXT

    async def fake_async_gemini_ask(session, question):
        captured_prompts.append(question)
        return "ok"

    monkeypatch.setattr(ai_chat_module, "build_retrieval_context", fake_build_retrieval_context)
    monkeypatch.setattr(ai_chat_module, "async_gemini_ask", fake_async_gemini_ask)

    sid = "chat_inject_sid"
    token = core.create_session_token(sid, "I", "chatinject@example.invalid")
    user_message = "What should I focus on this week?"
    r = client.post("/api/chat", json={"sid": sid, "token": token, "message": user_message})

    assert r.status_code == 200
    assert len(captured_prompts) == 1
    assert FAKE_CONTEXT in captured_prompts[0], "retrieved context never reached the Gemini prompt"
    assert user_message in captured_prompts[0]

    # add_history/save_progress run for real here (JSON-fallback, same as
    # every other test in this suite) -- so the persisted history can be
    # checked directly, not mocked: the retrieval block is prompt-only and
    # must never show up in what the user later sees as their own message
    # (see routes/ai_chat.py's gemini_msg/msg split).
    saved = app_module.load_progress(sid)
    user_turns = [h["message"] for h in saved.get("chat_history", []) if h["role"] == "user"]
    assert user_turns, "chat turn was never saved to history"
    assert user_turns[-1] == user_message
    assert FAKE_CONTEXT not in user_turns[-1], "retrieval context leaked into saved chat history"


@pytest.mark.skipif(not db.is_available(), reason="needs a real Postgres with pgvector — see module docstring")
def test_embeddings_round_trip():
    """Indexing writes a chunk, a query for the same sid finds it, and
    deleting it from the caller's keep-list (prune_embeddings) removes it —
    the same lifecycle the indexing job drives for every source item."""
    sid = "embed_test_sid"
    vec = [0.01] * 768
    assert db.upsert_embedding(sid, "task", "t1", "buy groceries", vec) is True
    assert db.get_embedding_chunk(sid, "task", "t1") == "buy groceries"

    results = db.search_embeddings(sid, vec, limit=5)
    assert any(r["source_id"] == "t1" and r["source_type"] == "task" for r in results)
    # sid-scoped: a different sid must never see this row.
    assert db.search_embeddings("someone_else", vec, limit=5) == []

    removed = db.prune_embeddings(sid, "task", keep_ids=[])
    assert removed >= 1
    assert db.get_embedding_chunk(sid, "task", "t1") is None


@pytest.mark.skipif(not db.is_available(), reason="needs a real Postgres with pgvector — see module docstring")
def test_upsert_is_incremental_update_not_duplicate():
    """Re-indexing the same (sid, source_type, source_id) updates the one
    row in place (ON CONFLICT DO UPDATE) rather than accumulating rows —
    this is what makes the indexing job's per-item upsert idempotent."""
    sid = "embed_test_sid_2"
    db.upsert_embedding(sid, "doc", "d1", "first version", [0.02] * 768)
    db.upsert_embedding(sid, "doc", "d1", "second version", [0.03] * 768)
    assert db.get_embedding_chunk(sid, "doc", "d1") == "second version"
    results = db.search_embeddings(sid, [0.03] * 768, limit=10)
    assert sum(1 for r in results if r["source_id"] == "d1") == 1
    db.prune_embeddings(sid, "doc", keep_ids=[])
