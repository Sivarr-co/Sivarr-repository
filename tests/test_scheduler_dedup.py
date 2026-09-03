"""
Regression test for the APScheduler 4x-duplicate-execution bug: gunicorn
runs 4 identical worker processes (Procfile: `-w 4`), each with its own
independent APScheduler on the same schedule, with no coordination — every
scheduled job (streak reminders, task-due alerts, embeddings indexing, ...)
was firing 4x per tick, confirmed live from production logs during a 2026-09
audit. database.claim_scheduler_tick() is the fix: a transaction-scoped
Postgres advisory lock so only one worker's firing wins a given tick.

Uses a fake cursor/connection (same shape tests/test_user_store.py and
friends use elsewhere for database.py functions) since there's no local
Postgres to exercise pg_try_advisory_xact_lock for real.
"""

import database as db


class _FakeCursor:
    def __init__(self, result):
        self._result = result
        self.executed = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.executed = (sql, params)

    def fetchone(self):
        return (self._result,)


class _FakeConn:
    def __init__(self, result):
        self._cursor = _FakeCursor(result)
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class _ErrorCursor:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a, **k):
        raise RuntimeError("boom")


class _ErrorConn:
    def __init__(self):
        self.rolled_back = False

    def cursor(self):
        return _ErrorCursor()

    def commit(self):
        raise AssertionError("must not commit on error")

    def rollback(self):
        self.rolled_back = True


def test_claim_scheduler_tick_wins_when_lock_acquired(monkeypatch):
    conn = _FakeConn(True)
    monkeypatch.setattr(db, "_get_conn", lambda: conn)
    monkeypatch.setattr(db, "_release", lambda c: None)
    assert db.claim_scheduler_tick("some_job") is True
    assert conn.committed is True


def test_claim_scheduler_tick_loses_when_another_worker_already_holds_it(monkeypatch):
    conn = _FakeConn(False)
    monkeypatch.setattr(db, "_get_conn", lambda: conn)
    monkeypatch.setattr(db, "_release", lambda c: None)
    assert db.claim_scheduler_tick("some_job") is False


def test_claim_scheduler_tick_fails_open_with_no_db(monkeypatch):
    monkeypatch.setattr(db, "_get_conn", lambda: None)
    assert db.claim_scheduler_tick("some_job") is True


def test_claim_scheduler_tick_fails_open_on_error(monkeypatch):
    conn = _ErrorConn()
    monkeypatch.setattr(db, "_get_conn", lambda: conn)
    monkeypatch.setattr(db, "_release", lambda c: None)
    assert db.claim_scheduler_tick("some_job") is True
    assert conn.rolled_back is True


def test_claim_scheduler_tick_uses_a_stable_key_per_job_name(monkeypatch):
    """Same job_name -> same lock key every call (needed for the dedup to
    actually work across 4 separate worker processes, each computing the
    key independently for the same tick)."""
    conn = _FakeConn(True)
    monkeypatch.setattr(db, "_get_conn", lambda: conn)
    monkeypatch.setattr(db, "_release", lambda c: None)
    db.claim_scheduler_tick("streak_reminders")
    key1 = conn._cursor.executed[1][0]
    db.claim_scheduler_tick("streak_reminders")
    key2 = conn._cursor.executed[1][0]
    assert key1 == key2

    db.claim_scheduler_tick("task_due_alerts")
    key3 = conn._cursor.executed[1][0]
    assert key3 != key1, "different job names must use different lock keys"
