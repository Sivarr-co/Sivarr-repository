"""
Real-time layer: routes/org.py's two WebSocket endpoints (org presence and
live document co-editing). Neither has any prior test coverage.

Both endpoints hard-require db.is_available() (no JSON-file fallback, unlike
the rest of the app) and, in production, use Redis pub/sub so a join/leave/
doc-update on one Gunicorn worker reaches clients connected to another. CI has
neither a real Postgres nor a reachable Redis, so every test here mocks
database.py's specific calls each endpoint makes (is_available/
get_org_by_member/get_org_doc/upsert_presence/get_presence) and forces
routes.org._get_presence_redis() to return None. That second part isn't
just convenience — it's the same "no Redis" path the module already falls
back to in production when REDIS_URL is unset or unreachable (see
_publish_org_event's docstring), so these tests exercise a real, supported
code path, not a synthetic one. It also makes fan-out deterministic and fast:
with no Redis, _publish_org_event calls the local fan-out directly, so two
TestClient WebSocket connections in the same test process see each other's
messages synchronously, no network or timing races involved.

One behavior worth calling out since it shapes several assertions below: the
local fan-out sends to every socket registered for that org/doc, including
the sender's own — a client always gets its own message echoed back (Yjs
updates are idempotent so this is harmless; the real client-side code keys
off from_sid to skip its own echoes). Tests that expect to see someone
else's event first drain their own echo/snapshot before asserting on it.

Each test uses a unique sid/org_id/doc_id so tests can't cross-contaminate
routes.org's module-level _PRESENCE_LOCAL/_DOC_LOCAL registries even though
those persist for the lifetime of the test process.
"""

import queue
import time
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import app as app_module
import core
import database as db
import routes.org as org_mod


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


@pytest.fixture
def no_redis(monkeypatch):
    """Force the "Redis unavailable" fan-out path — see module docstring."""
    monkeypatch.setattr(org_mod, "_get_presence_redis", AsyncMock(return_value=None))


def _token(sid: str) -> str:
    return core.create_session_token(sid, sid, f"{sid}@example.invalid")


# ── Presence: auth / precondition rejects ──────────────────────────────────
# The endpoint closes with a specific 4xxx code at each failure point, before
# ever calling websocket.accept() — TestClient surfaces that as
# WebSocketDisconnect(code=...) from the websocket_connect() context manager
# itself, not from a subsequent receive.

def test_presence_ws_rejects_missing_token(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/org/presence/ws"):
            pass
    assert exc.value.code == 4401


def test_presence_ws_rejects_garbage_token(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/org/presence/ws?token=not-a-real-token"):
            pass
    assert exc.value.code == 4401


def test_presence_ws_rejects_when_db_unavailable(client, monkeypatch):
    # Default test environment: no DATABASE_URL, db.is_available() already
    # False — this is the real "no DB configured" path, not a mock.
    token = _token("ws_rej_db")
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/org/presence/ws?token={token}"):
            pass
    assert exc.value.code == 4503


def test_presence_ws_rejects_user_with_no_org(client, monkeypatch, no_redis):
    token = _token("ws_rej_noorg")
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: None)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/org/presence/ws?token={token}"):
            pass
    assert exc.value.code == 4404


# ── Presence: connect, snapshot, fan-out, disconnect ───────────────────────

@pytest.fixture
def presence_env(monkeypatch, no_redis):
    """A working org for presence tests, with real call tracking on
    upsert_presence so the ping-keeps-it-fresh test can assert on it."""
    org = {"id": "org_presence_env", "name": "Test Org"}
    calls = []
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    monkeypatch.setattr(db, "get_presence", lambda org_id, cutoff_seconds=90: [])
    monkeypatch.setattr(db, "upsert_presence", lambda sid, org_id, name: calls.append((sid, org_id, name)))
    return calls


def test_presence_ws_connects_and_sends_snapshot(client, presence_env):
    token = _token("ws_snap")
    with client.websocket_connect(f"/api/org/presence/ws?token={token}") as ws:
        msg = ws.receive_json()
        assert msg == {"type": "snapshot", "online": []}


def test_presence_ws_upserts_presence_on_connect_and_ping(client, presence_env):
    token = _token("ws_ping")
    with client.websocket_connect(f"/api/org/presence/ws?token={token}") as ws:
        ws.receive_json()  # snapshot
        assert len(presence_env) == 1, "upsert_presence should fire once on connect"
        ws.send_text("ping")
        # Give the server coroutine a moment to process the received frame —
        # send_text() only guarantees the client wrote it, not that the
        # server's `await websocket.receive_text()` has resumed and run the
        # upsert yet.
        for _ in range(50):
            if len(presence_env) == 2:
                break
            time.sleep(0.02)
        assert len(presence_env) == 2, "a client ping should upsert presence again"


def test_presence_ws_broadcasts_join_to_existing_connections(client, presence_env):
    token_a = _token("ws_fanout_a")
    token_b = _token("ws_fanout_b")
    with client.websocket_connect(f"/api/org/presence/ws?token={token_a}") as ws_a:
        ws_a.receive_json()  # snapshot
        with client.websocket_connect(f"/api/org/presence/ws?token={token_b}") as ws_b:
            ws_b.receive_json()  # snapshot
            # A's next message is its own join echo (see module docstring),
            # THEN B's join.
            own_echo = ws_a.receive_json()
            assert own_echo == {"type": "join", "sid": "ws_fanout_a", "name": "ws_fanout_a"}
            b_join = ws_a.receive_json()
            assert b_join == {"type": "join", "sid": "ws_fanout_b", "name": "ws_fanout_b"}


def test_presence_ws_broadcasts_leave_on_disconnect(client, presence_env):
    token_a = _token("ws_leave_a")
    token_b = _token("ws_leave_b")
    with client.websocket_connect(f"/api/org/presence/ws?token={token_a}") as ws_a:
        ws_a.receive_json()  # snapshot
        with client.websocket_connect(f"/api/org/presence/ws?token={token_b}") as ws_b:
            ws_b.receive_json()  # snapshot
            ws_a.receive_json()  # A's own join echo
            ws_a.receive_json()  # B's join
            # B disconnects here (end of inner `with`)
        leave = ws_a.receive_json()
        assert leave == {"type": "leave", "sid": "ws_leave_b", "name": "ws_leave_b"}


# ── Doc co-editing: auth / precondition rejects ────────────────────────────

def test_doc_ws_rejects_missing_token(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/org/docs/doc_x/ws"):
            pass
    assert exc.value.code == 4401


def test_doc_ws_rejects_when_db_unavailable(client):
    token = _token("ws_doc_rej_db")
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/org/docs/doc_x/ws?token={token}"):
            pass
    assert exc.value.code == 4503


def test_doc_ws_rejects_doc_from_another_org(client, monkeypatch, no_redis):
    """The IDOR-shaped check: a doc that exists but belongs to a different
    org than the caller's must reject exactly like a doc that doesn't exist
    at all — same 404, no distinction that would let a caller probe for
    other orgs' doc ids."""
    token = _token("ws_doc_rej_org")
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: {"id": "org_mine"})
    monkeypatch.setattr(db, "get_org_doc", lambda doc_id: {"id": doc_id, "org_id": "org_someone_elses"})
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/org/docs/doc_x/ws?token={token}"):
            pass
    assert exc.value.code == 4404


def test_doc_ws_rejects_nonexistent_doc(client, monkeypatch, no_redis):
    token = _token("ws_doc_rej_missing")
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: {"id": "org_mine"})
    monkeypatch.setattr(db, "get_org_doc", lambda doc_id: None)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/org/docs/doc_x/ws?token={token}"):
            pass
    assert exc.value.code == 4404


# ── Doc co-editing: relay, isolation, convergence ──────────────────────────

@pytest.fixture
def doc_env(monkeypatch, no_redis):
    """Two docs in the same org, so isolation tests can prove a message sent
    on one never reaches a client connected to the other."""
    org = {"id": "org_doc_env"}
    docs = {
        "doc_env_a": {"id": "doc_env_a", "org_id": "org_doc_env"},
        "doc_env_b": {"id": "doc_env_b", "org_id": "org_doc_env"},
    }
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    monkeypatch.setattr(db, "get_org_doc", lambda doc_id: docs.get(doc_id))


def test_doc_ws_relays_update_to_other_client_on_same_doc(client, doc_env):
    """This is the backend half of "concurrent edits converge": the server
    never decodes the Yjs payload (real CRDT merge happens client-side), so
    what the relay layer can and must guarantee is that every connected
    client receives every update, verbatim, with the sender's sid stamped —
    which is exactly what makes client-side convergence possible at all."""
    token_a = _token("ws_relay_a")
    token_b = _token("ws_relay_b")
    with client.websocket_connect(f"/api/org/docs/doc_env_a/ws?token={token_a}") as ws_a:
        with client.websocket_connect(f"/api/org/docs/doc_env_a/ws?token={token_b}") as ws_b:
            ws_a.send_json({"type": "update", "payload": "yjs-update-1"})

            own_echo = ws_a.receive_json()
            assert own_echo == {"type": "update", "payload": "yjs-update-1", "from_sid": "ws_relay_a"}

            relayed = ws_b.receive_json()
            assert relayed == {"type": "update", "payload": "yjs-update-1", "from_sid": "ws_relay_a"}


def test_doc_ws_relays_both_directions(client, doc_env):
    """Two clients editing "concurrently": each one's update reaches the
    other, both ending up with the same two messages in some order — the
    server-side precondition for the CRDT merge to converge client-side."""
    token_a = _token("ws_both_a")
    token_b = _token("ws_both_b")
    with client.websocket_connect(f"/api/org/docs/doc_env_a/ws?token={token_a}") as ws_a:
        with client.websocket_connect(f"/api/org/docs/doc_env_a/ws?token={token_b}") as ws_b:
            ws_a.send_json({"type": "update", "payload": "from-a"})
            ws_b.send_json({"type": "update", "payload": "from-b"})

            a_seen = {ws_a.receive_json()["payload"], ws_a.receive_json()["payload"]}
            b_seen = {ws_b.receive_json()["payload"], ws_b.receive_json()["payload"]}

            assert a_seen == {"from-a", "from-b"}
            assert b_seen == {"from-a", "from-b"}


def test_doc_ws_does_not_leak_across_documents(client, doc_env):
    """A client on doc_env_b must never see doc_env_a's traffic."""
    token_a = _token("ws_iso_a")
    token_b = _token("ws_iso_b")
    with client.websocket_connect(f"/api/org/docs/doc_env_a/ws?token={token_a}") as ws_a:
        with client.websocket_connect(f"/api/org/docs/doc_env_b/ws?token={token_b}") as ws_b:
            ws_a.send_json({"type": "update", "payload": "only-for-doc-a"})
            own_echo = ws_a.receive_json()
            assert own_echo["payload"] == "only-for-doc-a"

            # doc_env_b's own traffic still works...
            ws_b.send_json({"type": "update", "payload": "only-for-doc-b"})
            b_echo = ws_b.receive_json()
            assert b_echo["payload"] == "only-for-doc-b"

            # ...and never received doc_env_a's message. receive_json() has
            # no timeout and would block forever on an empty queue, so reach
            # into the underlying queue.Queue directly with a short timeout —
            # queue.Empty here means "isolation held," not "test setup broken."
            with pytest.raises(queue.Empty):
                ws_b._send_queue.get(timeout=0.3)


def test_doc_ws_ignores_malformed_frames(client, doc_env):
    """Non-JSON and non-dict-JSON frames are silently dropped (see
    org_doc_ws's `except Exception: continue` / `if not isinstance(msg, dict)`)
    rather than crashing the connection or the receiving client."""
    token_a = _token("ws_garbage_a")
    token_b = _token("ws_garbage_b")
    with client.websocket_connect(f"/api/org/docs/doc_env_a/ws?token={token_a}") as ws_a:
        with client.websocket_connect(f"/api/org/docs/doc_env_a/ws?token={token_b}") as ws_b:
            ws_a.send_text("this is not json{{{")
            ws_a.send_json(["also", "not", "a", "dict"])
            ws_a.send_json({"type": "update", "payload": "the-real-one"})

            # Only the well-formed dict message should ever arrive at B.
            relayed = ws_b.receive_json()
            assert relayed == {"type": "update", "payload": "the-real-one", "from_sid": "ws_garbage_a"}
