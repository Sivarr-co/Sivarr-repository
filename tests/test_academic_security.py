"""
Regression tests for the 3 live IDOR/oracle bugs found in a 2026-09 security
audit of routes/academic.py (51 endpoints, previously zero test coverage) and
independently corroborated by two separate audit passes:

1. /api/acad/attendance/session and /api/acad/attendance/end never checked
   that the session_id belonged to the class the caller owns — a lecturer
   could poll (session) or close-and-silently-re-own (end) another
   lecturer's live attendance session just by knowing/guessing a session_id.
2. /api/acad/submit checked that the assignment existed but not that it
   belonged to the caller's own class — a student could submit into another
   class's assignment queue.
3. /api/acad/exam/submit computed mcq_total from whatever the client
   submitted rather than from the student's actually-assigned questions, and
   had no cap on resubmission attempts — together a working "submit one
   answer, read auto_pct back" brute-force oracle on exam answers.

Same in-memory coll_* shim pattern as tests/test_focus.py / test_realtime.py
(no local Postgres available; routes/academic.py is Postgres-only, no
JSON-file fallback, so is_available() must be forced True).
"""

import pytest

import core
import database as db


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    import app as app_module
    return TestClient(app_module.app)


def _token(sid: str) -> str:
    return core.create_session_token(sid, sid, f"{sid}@example.invalid")


@pytest.fixture
def acad_db(monkeypatch):
    """In-memory stand-in for the generic `collections` table that
    routes/academic.py rides on entirely (db.coll_get/coll_list/coll_put/
    coll_delete) — real owner-scoping semantics (coll_list(..., owner=X)
    only returns rows written with that owner), same as the real table."""
    store: dict = {}
    owners: dict = {}

    def _coll_get(collection, item_id):
        return store.get((collection, str(item_id)))

    def _coll_list(collection, owner=None):
        return [data for (c, iid), data in store.items()
                if c == collection and (owner is None or owners.get((c, iid)) == owner)]

    def _coll_put(collection, item_id, data, owner=""):
        key = (collection, str(item_id))
        store[key] = data
        owners[key] = owner

    def _coll_delete(collection, item_id):
        key = (collection, str(item_id))
        store.pop(key, None)
        owners.pop(key, None)

    monkeypatch.setattr(db, "is_available", lambda: True)
    monkeypatch.setattr(db, "coll_get", _coll_get)
    monkeypatch.setattr(db, "coll_list", _coll_list)
    monkeypatch.setattr(db, "coll_put", _coll_put)
    monkeypatch.setattr(db, "coll_delete", _coll_delete)
    return store


def _make_class(acad_db, code, owner_sid):
    acad_db[("acad_classes", code)] = {"code": code, "owner_sid": owner_sid, "name": code}


def _make_member(acad_db, code, sid):
    acad_db[("acad_members", f"{code}:{sid}")] = {"code": code, "sid": sid, "name": sid}


# ── 1. Attendance session hijack ─────────────────────────────────────────

def test_attendance_session_rejects_foreign_session(client, acad_db):
    _make_class(acad_db, "CLSA", "att_owner_a")
    _make_class(acad_db, "CLSB", "att_owner_b")
    acad_db[("acad_att_sessions", "sess_b1")] = {
        "session_id": "sess_b1", "code": "CLSB", "open": True,
    }
    # Class B's roster/records — must never be visible to A's owner.
    acad_db[("acad_att_records", "rec_b1")] = {"sid": "secret_b_student"}

    r = client.post("/api/acad/attendance/session", json={
        "token": _token("att_owner_a"), "code": "CLSA", "session_id": "sess_b1",
    })
    assert r.status_code == 404


def test_attendance_end_rejects_foreign_session_and_does_not_reown_it(client, acad_db):
    _make_class(acad_db, "CLSA", "att_owner_a2")
    _make_class(acad_db, "CLSB", "att_owner_b2")
    acad_db[("acad_att_sessions", "sess_b2")] = {
        "session_id": "sess_b2", "code": "CLSB", "open": True,
    }

    r = client.post("/api/acad/attendance/end", json={
        "token": _token("att_owner_a2"), "code": "CLSA", "session_id": "sess_b2",
    })
    assert r.status_code == 404

    # The session must be untouched — still open, still owned by CLSB. Before
    # the fix this call would set open=False and rewrite it under owner=CLSA,
    # silently transferring the record to the attacking lecturer's class.
    still_there = acad_db[("acad_att_sessions", "sess_b2")]
    assert still_there["open"] is True
    assert still_there["code"] == "CLSB"


def test_attendance_session_and_end_still_work_for_the_real_owner(client, acad_db):
    _make_class(acad_db, "CLSC", "att_owner_c")
    acad_db[("acad_att_sessions", "sess_c1")] = {
        "session_id": "sess_c1", "code": "CLSC", "open": True,
    }

    poll = client.post("/api/acad/attendance/session", json={
        "token": _token("att_owner_c"), "code": "CLSC", "session_id": "sess_c1",
    })
    assert poll.status_code == 200

    end = client.post("/api/acad/attendance/end", json={
        "token": _token("att_owner_c"), "code": "CLSC", "session_id": "sess_c1",
    })
    assert end.status_code == 200
    assert end.json()["ok"] is True


# ── 2. Cross-class assignment submission ─────────────────────────────────

def test_acad_submit_rejects_assignment_from_another_class(client, acad_db):
    _make_class(acad_db, "SUBA", "sub_owner_a")
    _make_class(acad_db, "SUBB", "sub_owner_b")
    _make_member(acad_db, "SUBA", "sub_student")
    # An assignment that belongs to SUBB, guessed/known by a SUBA student.
    acad_db[("acad_assignments", "asg_other")] = {"id": "asg_other", "code": "SUBB", "title": "B's assignment"}

    r = client.post("/api/acad/submit", json={
        "token": _token("sub_student"), "code": "SUBA",
        "assignment_id": "asg_other", "text": "cross-class injection attempt",
    })
    assert r.status_code == 404
    # And it must not have landed in B's submissions queue either.
    assert ("acad_submissions", "asg_other:sub_student") not in acad_db


def test_acad_submit_still_works_for_the_real_class(client, acad_db):
    _make_class(acad_db, "SUBC", "sub_owner_c")
    _make_member(acad_db, "SUBC", "sub_student_c")
    acad_db[("acad_assignments", "asg_c1")] = {"id": "asg_c1", "code": "SUBC", "title": "Real assignment"}

    r = client.post("/api/acad/submit", json={
        "token": _token("sub_student_c"), "code": "SUBC",
        "assignment_id": "asg_c1", "text": "my real answer",
    })
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ── 3. Exam auto-grade oracle ────────────────────────────────────────────

def _make_exam(acad_db, code, exam_id, n_questions=4):
    questions = [
        {"q": f"Q{i}?", "type": "mcq", "options": ["a", "b", "c"], "correct": 0}
        for i in range(n_questions)
    ]
    acad_db[("acad_exams", exam_id)] = {
        "id": exam_id, "title": "Test Exam", "kind": "exam", "duration": 30,
        "questions": questions, "questions_per_student": n_questions,
    }
    acad_db[("acad_class_exams", f"{code}:{exam_id}")] = {"code": code, "exam_id": exam_id}


def test_exam_submit_mcq_total_counts_assigned_not_submitted(client, acad_db):
    """The oracle: previously submitting one correct answer on a 4-question
    exam reported mcq_total=1, mcq_correct=1 -> auto_pct=100. It must now be
    scored against the full assigned set."""
    _make_class(acad_db, "EXA", "exam_owner_a")
    _make_member(acad_db, "EXA", "exam_student_a")
    _make_exam(acad_db, "EXA", "exam_1", n_questions=4)

    r = client.post("/api/acad/exam/submit", json={
        "token": _token("exam_student_a"), "code": "EXA", "exam_id": "exam_1",
        "answers": [{"i": 0, "q": "Q0?", "a": "a"}],  # only 1 of 4, correct
    })
    assert r.status_code == 200
    auto = r.json()["auto"]
    assert auto["mcq_total"] == 4, "must be scored against all assigned questions, not just what was submitted"
    assert auto["mcq_correct"] == 1
    assert auto["auto_pct"] == 25


def test_exam_submit_ignores_answers_for_unassigned_indices(client, acad_db):
    _make_class(acad_db, "EXB", "exam_owner_b")
    _make_member(acad_db, "EXB", "exam_student_b")
    _make_exam(acad_db, "EXB", "exam_2", n_questions=2)

    r = client.post("/api/acad/exam/submit", json={
        "token": _token("exam_student_b"), "code": "EXB", "exam_id": "exam_2",
        "answers": [{"i": 0, "q": "Q0?", "a": "a"}, {"i": 99, "q": "forged", "a": "a"}],
    })
    assert r.status_code == 200
    assert r.json()["auto"]["mcq_total"] == 2


def test_exam_submit_caps_resubmission_attempts(client, acad_db):
    _make_class(acad_db, "EXC", "exam_owner_c")
    _make_member(acad_db, "EXC", "exam_student_c")
    _make_exam(acad_db, "EXC", "exam_3", n_questions=1)

    body = {
        "token": _token("exam_student_c"), "code": "EXC", "exam_id": "exam_3",
        "answers": [{"i": 0, "q": "Q0?", "a": "a"}],
    }
    for _ in range(3):
        r = client.post("/api/acad/exam/submit", json=body)
        assert r.status_code == 200

    fourth = client.post("/api/acad/exam/submit", json=body)
    assert fourth.status_code == 429, "unlimited resubmission is itself a guess-and-check oracle"


# ── 4. Unbounded free-text grade parsing ─────────────────────────────────

def test_parse_grade_pct_rejects_absurd_values():
    from routes.academic import _parse_grade_pct

    assert _parse_grade_pct("999%") is None
    assert _parse_grade_pct("100/1") is None  # would have been 10000.0
    assert _parse_grade_pct("92%") == 92.0
    assert _parse_grade_pct("18/20") == 90.0
    assert _parse_grade_pct("150") is None  # already excluded pre-fix; still must be
    assert _parse_grade_pct("B+") is None
