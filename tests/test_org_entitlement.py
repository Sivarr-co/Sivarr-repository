"""
Org space is supposed to require a Pro/Team plan or an active org
subscription (js/app.js's _hasPlan()/_PAYWALL_CFG.org), but until now that
was enforced client-side only -- every org write endpoint accepted any
authenticated session regardless of plan. These tests cover the server-side
gate added in routes/org.py (_require_org_entitled, wired into org_create
directly and into every other write endpoint either via _org_check -- the
shared choke point 13+ admin/settings/paystack routes already go through --
or a one-line call added at each of the handful of routes that don't).

Same mocking pattern tests/test_org_delete.py already uses for this module:
monkeypatch database.py's functions directly, TestClient over the real app.
has_plan/load_progress are monkeypatched on routes.org itself (the module
globals _require_org_entitled reads), not on app.py, since build_router()
only wires them into routes.org's globals once at import time.
"""

import pytest
from fastapi.testclient import TestClient

import app as app_module
import core
import database as db
import routes.org as org_module


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


def _token(sid: str) -> str:
    return core.create_session_token(sid, sid, f"{sid}@example.invalid")


def _mock_plan(monkeypatch, has_plan_result: bool):
    monkeypatch.setattr(org_module, "_ORG_HAS_PLAN", lambda progress, tier: has_plan_result)
    monkeypatch.setattr(org_module, "_ORG_LOAD_PROGRESS", lambda sid: {})


# ── /api/org/create ──────────────────────────────────────────────────────

def test_org_create_402s_without_a_plan(client, monkeypatch):
    monkeypatch.setattr(db, "db_test", lambda: {"ping": True})
    monkeypatch.setattr(db, "init_db", lambda: None)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: None)
    _mock_plan(monkeypatch, False)
    token = _token("orgcreate_free")
    r = client.post("/api/org/create", json={"token": token, "name": "Acme Inc"})
    assert r.status_code == 402


def test_org_create_succeeds_with_a_pro_plan(client, monkeypatch):
    monkeypatch.setattr(db, "db_test", lambda: {"ping": True})
    monkeypatch.setattr(db, "init_db", lambda: None)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: None)
    monkeypatch.setattr(db, "create_org", lambda sid, name, org_id, owner_name: (True, None))
    _mock_plan(monkeypatch, True)
    token = _token("orgcreate_pro")
    r = client.post("/api/org/create", json={"token": token, "name": "Acme Inc"})
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ── a write endpoint that uses the inline pattern (not _org_check) ───────

def test_org_task_create_402s_for_free_tier_member_of_unsubscribed_org(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    org = {"id": "org_1", "name": "Acme Inc", "settings": {}}
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    _mock_plan(monkeypatch, False)
    token = _token("orgtask_free_unsub")
    r = client.post("/api/org/tasks/create", json={"token": token, "title": "Ship it"})
    assert r.status_code == 402


def test_org_task_create_succeeds_for_free_tier_member_of_a_subscribed_org(client, monkeypatch):
    """A free-tier user invited into an org that itself has an active seat
    subscription must NOT be locked out of an org they legitimately belong
    to -- org_sub_active unlocks it regardless of the member's own plan."""
    monkeypatch.setattr(db, "is_available", lambda: True)
    org = {"id": "org_2", "name": "Acme Inc",
           "settings": {"subscription": {"status": "active", "seats": 10}}}
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    monkeypatch.setattr(db, "create_org_task", lambda *a, **k: True)
    async def _noop_publish(*a, **k):
        return None
    monkeypatch.setattr(org_module, "_publish_org_task_event", _noop_publish)
    _mock_plan(monkeypatch, False)
    token = _token("orgtask_free_sub")
    r = client.post("/api/org/tasks/create", json={"token": token, "title": "Ship it"})
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_org_task_create_succeeds_for_pro_member_of_unsubscribed_org(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    org = {"id": "org_3", "name": "Acme Inc", "settings": {}}
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    monkeypatch.setattr(db, "create_org_task", lambda *a, **k: True)
    async def _noop_publish(*a, **k):
        return None
    monkeypatch.setattr(org_module, "_publish_org_task_event", _noop_publish)
    _mock_plan(monkeypatch, True)
    token = _token("orgtask_pro")
    r = client.post("/api/org/tasks/create", json={"token": token, "title": "Ship it"})
    assert r.status_code == 200


# ── the shared _org_check choke point (13+ admin/settings/paystack routes) ─

def test_org_check_choke_point_402s_free_tier(client, monkeypatch):
    org = {"id": "org_4", "name": "Acme Inc", "settings": {}}
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    _mock_plan(monkeypatch, False)
    token = _token("orgcheck_free")
    r = client.get("/api/org/paystack/status", params={"token": token})
    assert r.status_code == 402


def test_org_check_choke_point_allows_pro_tier(client, monkeypatch):
    org = {"id": "org_5", "name": "Acme Inc", "settings": {}}
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    monkeypatch.setattr(db, "get_org_integration", lambda org_id, provider: None)
    _mock_plan(monkeypatch, True)
    token = _token("orgcheck_pro")
    r = client.get("/api/org/paystack/status", params={"token": token})
    assert r.status_code == 200
    assert r.json() == {"connected": False}


# ── the client-only dev bypass must grant nothing server-side ────────────

def test_localstorage_dev_bypass_grants_no_real_server_access(client, monkeypatch):
    """js/app.js's localStorage.sivarr_dev='1' only ever affects the CLIENT's
    own nav guard -- it has no representation in a request at all, so a
    direct API call from a free-tier session must still 402 regardless of
    whatever the caller's browser has in localStorage."""
    monkeypatch.setattr(db, "db_test", lambda: {"ping": True})
    monkeypatch.setattr(db, "init_db", lambda: None)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: None)
    _mock_plan(monkeypatch, False)
    token = _token("orgcreate_bypass_attempt")
    # No client-side flag has any server-visible representation to send --
    # the point being proven is that there is nothing to send.
    r = client.post("/api/org/create", json={"token": token, "name": "Free Org"})
    assert r.status_code == 402
