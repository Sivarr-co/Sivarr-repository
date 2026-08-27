"""
/api/org/delete — owner-only, permanent, requires the caller to echo the
org's exact current name back as confirm_name (checked server-side, not just
trusted from the client's typed-confirmation modal in js/app.js's
orgDeleteFlow()/siModal.confirmTyped()).

Postgres-only, same as every other org.py endpoint (no JSON-file fallback):
mocks database.py's is_available/get_org_by_member/delete_org, same pattern
tests/test_realtime.py already uses for this module.
"""

import pytest
from fastapi.testclient import TestClient

import app as app_module
import core
import database as db


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


def _token(sid: str) -> str:
    return core.create_session_token(sid, sid, f"{sid}@example.invalid")


def test_org_delete_requires_auth(client):
    r = client.post("/api/org/delete", json={"confirm_name": "Anything"})
    assert r.status_code == 401


def test_org_delete_503s_without_db(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: False)
    token = _token("orgdel_no_db")
    r = client.post("/api/org/delete", json={"token": token, "confirm_name": "x"})
    assert r.status_code == 503


def test_org_delete_404s_when_not_in_an_org(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: None)
    token = _token("orgdel_no_org")
    r = client.post("/api/org/delete", json={"token": token, "confirm_name": "x"})
    assert r.status_code == 404


def test_org_delete_403s_for_non_owner(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    org = {"id": "org_1", "name": "Acme Inc", "owner_sid": "owner_sid", "member_role": "admin"}
    monkeypatch.setattr(db, "get_org_by_member", lambda sid: org)
    token = _token("orgdel_admin_not_owner")
    r = client.post("/api/org/delete", json={"token": token, "confirm_name": "Acme Inc"})
    assert r.status_code == 403


def test_org_delete_400s_on_name_mismatch(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    sid = "orgdel_owner_wrong_name"
    org = {"id": "org_2", "name": "Acme Inc", "owner_sid": sid, "member_role": "owner"}
    monkeypatch.setattr(db, "get_org_by_member", lambda s: org)
    called = []
    monkeypatch.setattr(db, "delete_org", lambda org_id, owner_sid: called.append((org_id, owner_sid)) or True)
    token = _token(sid)
    r = client.post("/api/org/delete", json={"token": token, "confirm_name": "acme inc"})
    assert r.status_code == 400
    assert not called, "delete_org must never be called on a name mismatch"


def test_org_delete_succeeds_for_owner_with_matching_name(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    sid = "orgdel_owner_ok"
    org = {"id": "org_3", "name": "Acme Inc", "owner_sid": sid, "member_role": "owner"}
    monkeypatch.setattr(db, "get_org_by_member", lambda s: org)
    called = []
    monkeypatch.setattr(db, "delete_org", lambda org_id, owner_sid: called.append((org_id, owner_sid)) or True)
    token = _token(sid)
    r = client.post("/api/org/delete", json={"token": token, "confirm_name": "Acme Inc"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert called == [("org_3", sid)]


def test_org_delete_owner_via_owner_sid_without_member_role(client, monkeypatch):
    """owner_sid match alone (not just member_role == 'owner') must also
    pass -- same either/or ownership check js/features/org.js's own client
    logic and _org_admin_check use elsewhere in this codebase."""
    monkeypatch.setattr(db, "is_available", lambda: True)
    sid = "orgdel_owner_via_sid"
    org = {"id": "org_4", "name": "Acme Inc", "owner_sid": sid, "member_role": "member"}
    monkeypatch.setattr(db, "get_org_by_member", lambda s: org)
    monkeypatch.setattr(db, "delete_org", lambda org_id, owner_sid: True)
    token = _token(sid)
    r = client.post("/api/org/delete", json={"token": token, "confirm_name": "Acme Inc"})
    assert r.status_code == 200


def test_org_delete_500s_when_db_delete_fails(client, monkeypatch):
    monkeypatch.setattr(db, "is_available", lambda: True)
    sid = "orgdel_db_fail"
    org = {"id": "org_5", "name": "Acme Inc", "owner_sid": sid, "member_role": "owner"}
    monkeypatch.setattr(db, "get_org_by_member", lambda s: org)
    monkeypatch.setattr(db, "delete_org", lambda org_id, owner_sid: False)
    token = _token(sid)
    r = client.post("/api/org/delete", json={"token": token, "confirm_name": "Acme Inc"})
    assert r.status_code == 500
