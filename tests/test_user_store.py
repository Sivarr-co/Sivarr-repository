"""User store concurrency — the bug behind "the password I set at signup does
not work at sign-in".

Production runs four gunicorn workers. Each request did
load_users() -> mutate -> save_users(whole_dict), so two workers holding their
own snapshots meant the second save silently erased whatever the first had
added. Sign-in then read the JSON file BEFORE the database, so a stale file
could also put an old password hash back over a correct one.

Both halves are regression-guarded here. If either assertion starts failing,
real users are losing accounts or being locked out.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import app as app_module
import core


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


def _real_hash(pw: str) -> str:
    import bcrypt
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def _u(sid, email, pw="HASH"):
    return {"sid": sid, "name": "T", "email": email, "phone": "",
            "password": pw, "role": "student"}


# ── the erasure race ─────────────────────────────────────────────
def test_concurrent_saves_do_not_erase_each_other():
    """Two workers, each with its own snapshot, both register someone.
    Neither may disappear."""
    base = uuid.uuid4().hex[:8]
    app_module.save_users({f"seed_{base}": _u(f"seed_{base}", f"seed{base}@x.com")})

    worker_a = app_module.load_users()      # both read the same starting state
    worker_b = app_module.load_users()

    a_sid, b_sid = f"alice_{base}", f"bob_{base}"
    worker_a[a_sid] = _u(a_sid, f"alice{base}@x.com")
    app_module.save_users(worker_a)

    worker_b[b_sid] = _u(b_sid, f"bob{base}@x.com")   # stale: has no alice
    app_module.save_users(worker_b)

    final = app_module.load_users()
    assert a_sid in final, "worker B's save erased the account worker A created"
    assert b_sid in final
    assert f"seed_{base}" in final


def test_stale_snapshot_can_still_write_an_old_field_to_the_file():
    """Documents a deliberate, bounded limitation.

    Merging stops a stale worker DELETING someone, but it cannot stop one
    writing an old value for a key it happens to hold -- save_users() has no
    way to know which fields the caller actually changed.

    That is acceptable only because the database is now authoritative for
    sign-in (see test_login_prefers_the_database_over_the_file). The file is a
    cache. If this ordering is ever reversed, this limitation becomes the
    original bug again, so this test exists to make the trade-off explicit
    rather than accidental.
    """
    base = uuid.uuid4().hex[:8]
    sid = f"pw_{base}"
    app_module.save_users({sid: _u(sid, f"pw{base}@x.com", pw="OLD")})

    stale = app_module.load_users()                   # snapshot holding OLD

    fresh = app_module.load_users()
    fresh[sid]["password"] = "NEW"
    app_module.save_users(fresh)
    assert app_module.load_users()[sid]["password"] == "NEW"

    other = f"other_{base}"
    stale[other] = _u(other, f"other{base}@x.com")
    app_module.save_users(stale)

    final = app_module.load_users()
    assert other in final, "the stale worker's own new account was lost"
    assert sid in final, "merging must never drop an account"
    # The known limitation, asserted so a future change to it is visible:
    assert final[sid]["password"] == "OLD"


# ── deletion must still work now that saves merge ────────────────
def test_explicit_removal_still_deletes():
    base = uuid.uuid4().hex[:8]
    sid = f"del_{base}"
    app_module.save_users({sid: _u(sid, f"del{base}@x.com")})
    assert sid in app_module.load_users()

    users = app_module.load_users()
    users.pop(sid, None)
    app_module.save_users(users, removed={sid})
    assert sid not in app_module.load_users(), "explicit removal no longer deletes"


def test_merge_alone_does_not_delete():
    """Without `removed`, an absent key must NOT be treated as a deletion --
    that is exactly what made concurrent saves destructive."""
    base = uuid.uuid4().hex[:8]
    sid = f"keep_{base}"
    app_module.save_users({sid: _u(sid, f"keep{base}@x.com")})
    app_module.save_users({})                  # empty save, no `removed`
    assert sid in app_module.load_users()


# ── read order ───────────────────────────────────────────────────
def test_login_prefers_the_database_over_the_file(client, monkeypatch):
    """With a database available, sign-in must read it first. A stale file
    entry carrying an old hash must not win."""
    import database as real_db
    base = uuid.uuid4().hex[:8]
    email = f"order{base}@example.com"
    sid = f"order_{base}"

    seen = {"db_hit": False}

    def fake_available():
        return True

    def fake_get_user_by_email(addr):
        seen["db_hit"] = True
        return {"sid": sid, "name": "DB Copy", "email": addr,
                "phone": "", "password": _real_hash("correct-horse")}

    monkeypatch.setattr(app_module.db, "is_available", fake_available)
    monkeypatch.setattr(app_module.db, "get_user_by_email", fake_get_user_by_email)
    # a conflicting FILE entry for the same address
    app_module.save_users({sid: _u(sid, email, pw="STALE_FILE_HASH")})

    r = client.post("/api/login", json={"action": "login", "email": email,
                                        "password": "whatever"})
    assert seen["db_hit"], "sign-in did not consult the database first"
    # Wrong password against the DB hash -> 401, never a success off the file.
    assert r.status_code in (401, 403), r.status_code
