"""Password policy — core.password_policy_error() and the two endpoints that
enforce it.

The policy applies to ACCOUNT CREATION and PASSWORD RESET only. Sign-in must
never be gated by it: accounts created before the policy existed still have to
be able to log in, and the place to upgrade them is a reset, not a lockout.
test_existing_weak_password_can_still_sign_in below is the regression guard for
exactly that -- it is the failure mode that would lock real users out.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import app as app_module
import core
from core import password_policy_error


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


def _email():
    return f"pwpolicy_{uuid.uuid4().hex[:10]}@example.com"


# ── the pure function ────────────────────────────────────────────
@pytest.mark.parametrize("pw", [
    "Str0ngPass",
    "aB3aaaaa",          # exactly the 8-char minimum
    "Tr0ub4dor&3",
])
def test_compliant_passwords_pass(pw):
    assert password_policy_error(pw) is None


@pytest.mark.parametrize("pw,expect", [
    ("Ab1",         "at least 8"),
    ("abcdefgh1",   "uppercase"),
    ("ABCDEFGH1",   "lowercase"),
    ("Abcdefghi",   "number"),
    ("",            "at least 8"),
])
def test_noncompliant_passwords_are_rejected(pw, expect):
    msg = password_policy_error(pw)
    assert msg and expect in msg


def test_over_max_length_is_rejected():
    assert "or fewer" in (password_policy_error("Aa1" + "x" * core.MAX_PASSWORD_LEN) or "")


def test_unicode_password_is_handled_not_crashed():
    # str.isupper()/isdigit() are unicode-aware; a non-ASCII password must get a
    # verdict rather than raise.
    assert password_policy_error("Pässw0rdé") is None


# ── registration endpoint ────────────────────────────────────────
def test_register_rejects_weak_password(client):
    r = client.post("/api/login", json={
        "action": "register", "name": "Policy Test", "email": _email(),
        "password": "abcdefgh", "confirm_password": "abcdefgh",
    })
    assert r.status_code == 400


def test_register_accepts_compliant_password(client):
    r = client.post("/api/login", json={
        "action": "register", "name": "Policy Test", "email": _email(),
        "password": "Str0ngPass", "confirm_password": "Str0ngPass",
    })
    assert r.status_code == 200
    assert r.json().get("token")


def test_register_does_not_leak_which_rule_failed(client):
    """Registration returns one generic message -- the specific reason is
    logged, not returned, so the response cannot be used to probe the policy
    or to distinguish a password problem from an email/name problem."""
    r = client.post("/api/login", json={
        "action": "register", "name": "Policy Test", "email": _email(),
        "password": "abcdefgh", "confirm_password": "abcdefgh",
    })
    detail = (r.json() or {}).get("detail", "")
    for leak in ("uppercase", "lowercase", "number", "at least 8"):
        assert leak not in detail, f"registration leaked the failing rule: {detail!r}"


# ── the regression guard that matters ────────────────────────────
def test_existing_weak_password_can_still_sign_in(client, monkeypatch):
    """An account whose password predates the policy must still log in.
    Registration is done with the policy bypassed to simulate an old account,
    then sign-in must succeed with that weak password.
    """
    import app as A
    email, weak = _email(), "abcdefgh"

    monkeypatch.setattr(A, "password_policy_error", lambda pw: None)
    reg = client.post("/api/login", json={
        "action": "register", "name": "Legacy User", "email": email,
        "password": weak, "confirm_password": weak,
    })
    assert reg.status_code == 200, "setup failed: could not create the legacy account"
    monkeypatch.undo()

    # Policy is live again -- a new account with this password would be refused.
    assert password_policy_error(weak) is not None

    login = client.post("/api/login", json={
        "action": "login", "email": email, "password": weak,
    })
    assert login.status_code == 200, "policy is wrongly gating sign-in for existing accounts"
    assert login.json().get("token")
