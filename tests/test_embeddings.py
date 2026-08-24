"""
Embeddings (Session 9): pgvector-backed storage for AI retrieval.

Same split as tests/test_search.py's module docstring: some of this always
runs against the no-DATABASE_URL sandbox this test suite executes in, some
needs a real Postgres with the pgvector extension and is skipped here with
an explicit reason rather than silently passing empty.

The "no-op rather than a crash when pgvector is unavailable" requirement
*is* the always-runnable part — every database.py function under test here
is expected to degrade to an empty/False/None default, never raise, when
there's no DATABASE_URL at all (a stronger condition than "pgvector missing
on an otherwise-configured Postgres," but exercises the same code path:
embeddings_available() returning False and every other function short-
circuiting on it).
"""

import pytest

import database as db


def test_embeddings_available_false_without_database_url():
    assert db.is_available() is False, "this suite runs without DATABASE_URL — see test_search.py"
    assert db.embeddings_available() is False


def test_get_embedding_chunk_noop_without_db():
    assert db.get_embedding_chunk("sid", "task", "1") is None


def test_upsert_embedding_noop_without_db():
    assert db.upsert_embedding("sid", "task", "1", "some text", [0.1] * 768) is False


def test_prune_embeddings_noop_without_db():
    assert db.prune_embeddings("sid", "task", []) == 0


def test_search_embeddings_noop_without_db():
    assert db.search_embeddings("sid", [0.1] * 768) == []


def test_get_sids_with_tasks_noop_without_db():
    assert db.get_sids_with_tasks() == []


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
