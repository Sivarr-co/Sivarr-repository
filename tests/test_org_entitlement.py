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


def _mock_org_get_reads(monkeypatch, org, founder=None):
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "init_db", lambda: None)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    monkeypatch.setattr(db, "get_org_members",  lambda org_id: [])
    monkeypatch.setattr(db, "get_org_tasks",    lambda org_id: [])
    monkeypatch.setattr(db, "get_org_projects", lambda org_id: [])
    monkeypatch.setattr(db, "get_org_docs",     lambda org_id: [])
    monkeypatch.setattr(db, "get_org_goals",    lambda org_id: [])
    monkeypatch.setattr(db, "get_org_founder",  lambda org_id: founder)


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


# ── /api/org/get: entitlement gate + the founder-data role leak fix ─────

def test_org_get_402s_for_free_tier_member_of_unsubscribed_org(client, monkeypatch):
    org = {"id": "org_get_1", "name": "Acme Inc", "member_role": "owner", "settings": {}}
    _mock_org_get_reads(monkeypatch, org)
    _mock_plan(monkeypatch, False)
    token = _token("orgget_free")
    r = client.post("/api/org/get", json={"token": token})
    assert r.status_code == 402


def test_org_get_withholds_founder_data_from_non_admin_member(client, monkeypatch):
    """Before this fix, /api/org/get returned founder financials (MRR, burn
    rate, cash, investors) to *any* member regardless of role -- the
    dedicated /api/org/founder/get endpoint already correctly restricts this
    to owner/admin, but this bulk endpoint didn't mirror that check."""
    org = {"id": "org_get_2", "name": "Acme Inc", "member_role": "member", "settings": {}}
    founder = {"mrr": 50000, "burn_rate": 10000, "cash_balance": 200000}
    _mock_org_get_reads(monkeypatch, org, founder=founder)
    _mock_plan(monkeypatch, True)
    token = _token("orgget_member")
    r = client.post("/api/org/get", json={"token": token})
    assert r.status_code == 200
    assert r.json()["founder"] is None


def test_org_get_includes_founder_data_for_admin_member(client, monkeypatch):
    org = {"id": "org_get_3", "name": "Acme Inc", "member_role": "admin", "settings": {}}
    founder = {"mrr": 50000, "burn_rate": 10000, "cash_balance": 200000}
    _mock_org_get_reads(monkeypatch, org, founder=founder)
    _mock_plan(monkeypatch, True)
    token = _token("orgget_admin")
    r = client.post("/api/org/get", json={"token": token})
    assert r.status_code == 200
    assert r.json()["founder"] == founder


# ── /api/org/ai/briefing: same founder-data leak, via the Gemini prompt ──

def test_ai_briefing_omits_finance_line_for_non_admin_member(client, monkeypatch):
    """Financials go into the Gemini prompt text itself here, not a JSON
    field -- a non-owner/admin member must never see MRR/burn/runway even
    indirectly through the generated briefing, so the fix omits the figures
    from the context before it ever reaches the model."""
    org = {"id": "org_brief_1", "name": "Acme Inc", "member_role": "member", "settings": {}}
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    monkeypatch.setattr(db, "get_org_tasks",    lambda org_id, limit=100: [])
    monkeypatch.setattr(db, "get_org_members",  lambda org_id: [])
    monkeypatch.setattr(db, "get_org_projects", lambda org_id: [])
    monkeypatch.setattr(db, "get_org_goals",    lambda org_id: [])
    monkeypatch.setattr(db, "get_org_founder",  lambda org_id: (_ for _ in ()).throw(
        AssertionError("get_org_founder must not be called for a non-admin member")))
    _mock_plan(monkeypatch, True)
    captured = {}
    async def _fake_ask(session, context):
        captured["context"] = context
        return "A briefing."
    monkeypatch.setattr(org_module, "async_gemini_ask", _fake_ask)
    monkeypatch.setattr(org_module, "get_sessions", lambda sid: {"chat": None})
    token = _token("orgbrief_member")
    r = client.post("/api/org/ai/briefing", json={"token": token})
    assert r.status_code == 200
    assert "MRR" not in captured["context"]
    assert "Burn rate" not in captured["context"]


# ── /api/org/presence (GET): soft-fails to empty rather than 402ing ──────

def test_org_presence_list_soft_fails_to_empty_for_free_tier(client, monkeypatch):
    """Presence is low-stakes and this route already soft-fails to {"online":
    []} when the caller has no org at all -- the entitlement gate matches
    that existing style rather than introducing a hard 402 for something
    this minor."""
    org = {"id": "org_pres_1", "name": "Acme Inc", "member_role": "member", "settings": {}}
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    _mock_plan(monkeypatch, False)
    token = _token("orgpresence_free")
    r = client.get("/api/org/presence", params={"token": token})
    assert r.status_code == 200
    assert r.json() == {"online": []}
