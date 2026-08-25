"""
Session 20 — user-facing TOTP 2FA (app.py's /api/auth/2fa/* endpoints + the
totp check inside /api/login). TOTP exists already but was admin-only
(ADMIN_TOTP_SECRET); this reuses _totp_verify (RFC 6238, stdlib-only, no
pyotp) rather than a second implementation.

Runs against the JSON-file storage path (no_db fixture, tests/conftest.py) --
the natural local environment, and forced explicitly so this suite behaves
the same locally and in CI's real-Postgres job (Session 14). The DB-backed
path (database.py's get_user_totp/set_user_totp_pending/enable_user_totp/
disable_user_totp/remove_user_recovery_code) is exercised by hand against a
real embedded Postgres, not by this file -- see the session's own report for
what that covered.

Never touches the real data/users.json (local dev already has 100+ real
users accumulated from other manual testing) or sends a real email: the
fake_users fixture monkeypatches app.load_users/save_users onto a
module-local dict, matching test_focus.py's approach of monkeypatching
database.py calls rather than hitting real storage.
"""

import base64
import hashlib
import hmac
import time

import bcrypt
import pytest

import app as app_module
import core


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    return TestClient(app_module.app)


@pytest.fixture
def fake_users(monkeypatch):
    store = {}
    monkeypatch.setattr(app_module, "load_users", lambda: store)
    monkeypatch.setattr(app_module, "save_users", lambda users: store.update(users))
    return store


def _make_user(store: dict, sid: str, email: str, password: str = "TestPass123!") -> str:
    store[sid] = {
        "sid": sid, "name": "Test User", "email": email, "phone": "",
        "password": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
        "created": "2026-08-24 00:00", "role": "student",
    }
    return password


def _token(sid: str, email: str) -> str:
    return core.create_session_token(sid, "Test User", email)


def _totp_code(secret: str, when: int | None = None) -> str:
    """RFC 6238 generator mirroring app._totp_verify's own check (and
    scripts/admin_totp_setup.py's totp_now) -- stdlib-only, no pyotp."""
    s = secret.strip().replace(" ", "").upper()
    s += "=" * ((8 - len(s) % 8) % 8)
    key = base64.b32decode(s)
    counter = (int(when or time.time()) // 30).to_bytes(8, "big")
    mac = hmac.new(key, counter, hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    val = (int.from_bytes(mac[o:o + 4], "big") & 0x7FFFFFFF) % 1_000_000
    return f"{val:06d}"


# ── Auth / precondition ────────────────────────────────────────────────

def test_2fa_status_requires_auth(client):
    r = client.post("/api/auth/2fa/status", json={})
    assert r.status_code == 401


def test_2fa_setup_requires_auth(client):
    r = client.post("/api/auth/2fa/setup", json={})
    assert r.status_code == 401


def test_2fa_confirm_requires_auth(client):
    r = client.post("/api/auth/2fa/confirm", json={"code": "123456"})
    assert r.status_code == 401


def test_2fa_disable_requires_auth(client):
    r = client.post("/api/auth/2fa/disable", json={"password": "x"})
    assert r.status_code == 401


# ── Enrolment ───────────────────────────────────────────────────────────

def test_2fa_setup_returns_secret_and_uri(client, fake_users, no_db):
    sid = "2fa_setup_1"
    _make_user(fake_users, sid, "setup1@example.invalid")
    token = _token(sid, "setup1@example.invalid")

    r = client.post("/api/auth/2fa/setup", json={"token": token})
    assert r.status_code == 200
    d = r.json()
    assert d["secret"]
    assert d["otpauth_url"].startswith("otpauth://totp/")
    assert "setup1%40example.invalid" in d["otpauth_url"] or "setup1@example.invalid" in d["otpauth_url"]
    # QR is best-effort (degrades to "" if qrcode isn't importable) -- just
    # check the field exists, not that it's non-empty.
    assert "qr_svg" in d

    status = client.post("/api/auth/2fa/status", json={"token": token}).json()
    assert status["enabled"] is False  # pending, not yet confirmed


def test_2fa_confirm_wrong_code_rejected(client, fake_users, no_db):
    sid = "2fa_wrong_code"
    _make_user(fake_users, sid, "wrongcode@example.invalid")
    token = _token(sid, "wrongcode@example.invalid")
    client.post("/api/auth/2fa/setup", json={"token": token})

    r = client.post("/api/auth/2fa/confirm", json={"token": token, "code": "000000"})
    assert r.status_code == 400
    status = client.post("/api/auth/2fa/status", json={"token": token}).json()
    assert status["enabled"] is False


def test_2fa_confirm_correct_code_enables_and_returns_recovery_codes(client, fake_users, no_db):
    sid = "2fa_confirm_ok"
    _make_user(fake_users, sid, "confirmok@example.invalid")
    token = _token(sid, "confirmok@example.invalid")
    setup = client.post("/api/auth/2fa/setup", json={"token": token}).json()

    code = _totp_code(setup["secret"])
    r = client.post("/api/auth/2fa/confirm", json={"token": token, "code": code})
    assert r.status_code == 200
    d = r.json()
    assert len(d["recovery_codes"]) == 8
    assert all("-" in c for c in d["recovery_codes"])

    status = client.post("/api/auth/2fa/status", json={"token": token}).json()
    assert status["enabled"] is True


def test_2fa_setup_blocked_when_already_enabled(client, fake_users, no_db):
    sid = "2fa_already_on"
    _make_user(fake_users, sid, "alreadyon@example.invalid")
    token = _token(sid, "alreadyon@example.invalid")
    setup = client.post("/api/auth/2fa/setup", json={"token": token}).json()
    code = _totp_code(setup["secret"])
    client.post("/api/auth/2fa/confirm", json={"token": token, "code": code})

    r = client.post("/api/auth/2fa/setup", json={"token": token})
    assert r.status_code == 400


# ── Login with 2FA enabled ──────────────────────────────────────────────

def _enroll(client, fake_users, sid: str, email: str, password: str = "TestPass123!"):
    """Register a user (fake store) and fully enrol 2FA, returning
    (token, secret, recovery_codes)."""
    _make_user(fake_users, sid, email, password)
    token = _token(sid, email)
    setup = client.post("/api/auth/2fa/setup", json={"token": token}).json()
    code = _totp_code(setup["secret"])
    confirm = client.post("/api/auth/2fa/confirm", json={"token": token, "code": code}).json()
    return token, setup["secret"], confirm["recovery_codes"]


def test_login_without_code_returns_totp_required(client, fake_users, no_db):
    email = "login_no_code@example.invalid"
    _enroll(client, fake_users, "2fa_login_no_code", email)

    r = client.post("/api/login", json={"email": email, "password": "TestPass123!", "action": "login"})
    assert r.status_code == 401
    assert r.json()["detail"] == "totp_required"


def test_login_with_correct_totp_code_succeeds(client, fake_users, no_db):
    email = "login_ok@example.invalid"
    _, secret, _ = _enroll(client, fake_users, "2fa_login_ok", email)

    r = client.post("/api/login", json={
        "email": email, "password": "TestPass123!", "action": "login",
        "totp": _totp_code(secret),
    })
    assert r.status_code == 200
    assert r.json()["email"] == email


def test_login_with_wrong_totp_code_rejected(client, fake_users, no_db):
    email = "login_wrong@example.invalid"
    _enroll(client, fake_users, "2fa_login_wrong", email)

    r = client.post("/api/login", json={
        "email": email, "password": "TestPass123!", "action": "login",
        "totp": "000000",
    })
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid 2FA code."


def test_login_with_recovery_code_succeeds_and_burns_it(client, fake_users, no_db):
    email = "login_recovery@example.invalid"
    token, _, recovery_codes = _enroll(client, fake_users, "2fa_login_recovery", email)
    used_code = recovery_codes[0]

    r = client.post("/api/login", json={
        "email": email, "password": "TestPass123!", "action": "login",
        "totp": used_code,
    })
    assert r.status_code == 200

    # One-time use: the same recovery code must not work a second time.
    r2 = client.post("/api/login", json={
        "email": email, "password": "TestPass123!", "action": "login",
        "totp": used_code,
    })
    assert r2.status_code == 401
    assert r2.json()["detail"] == "Invalid 2FA code."

    # A still-unused recovery code from the same batch keeps working.
    r3 = client.post("/api/login", json={
        "email": email, "password": "TestPass123!", "action": "login",
        "totp": recovery_codes[1],
    })
    assert r3.status_code == 200


def test_login_wrong_totp_still_requires_correct_password_first(client, fake_users, no_db):
    """A wrong password must fail as a wrong password, not leak whether 2FA
    is enabled by returning totp_required for a bad credential."""
    email = "login_badpw@example.invalid"
    _enroll(client, fake_users, "2fa_login_badpw", email)

    r = client.post("/api/login", json={
        "email": email, "password": "not-the-password", "action": "login",
    })
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid email or password."


# ── Disable ─────────────────────────────────────────────────────────────

def test_2fa_disable_requires_correct_password(client, fake_users, no_db):
    email = "disable_wrongpw@example.invalid"
    token, _, _ = _enroll(client, fake_users, "2fa_disable_wrongpw", email)

    r = client.post("/api/auth/2fa/disable", json={"token": token, "password": "not-it"})
    assert r.status_code == 400
    status = client.post("/api/auth/2fa/status", json={"token": token}).json()
    assert status["enabled"] is True  # unchanged


def test_2fa_disable_then_login_no_longer_requires_code(client, fake_users, no_db):
    email = "disable_ok@example.invalid"
    token, _, _ = _enroll(client, fake_users, "2fa_disable_ok", email)

    r = client.post("/api/auth/2fa/disable", json={"token": token, "password": "TestPass123!"})
    assert r.status_code == 200
    status = client.post("/api/auth/2fa/status", json={"token": token}).json()
    assert status["enabled"] is False

    r2 = client.post("/api/login", json={"email": email, "password": "TestPass123!", "action": "login"})
    assert r2.status_code == 200
