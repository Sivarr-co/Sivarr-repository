"""
Academic space — classes, attendance, announcements, assignments, exams,
grading, live sessions and polls. The lecturer<->student class bridge behind
"Create Space -> Academic" (js/features/academic.js's acadInit/lInit/sInit).

There used to be a legacy, parallel /api/lecturer + /api/class + /api/exam
system in app.py (GET /lecturer served a standalone templates/lecturer.html
page) that this one deliberately replaced rather than migrated from. It was
confirmed unreachable from any current UI and deleted outright -- see the
"Delete the legacy /api/lecturer..." commit for the full removal. A few of
its helpers (load_announcements/save_announcements, get_all_students) were
genuinely shared with the admin panel and the public announcements banner,
so those stayed in app.py rather than being deleted or moved here.

WHY build_router() IS A FACTORY, NOT A BARE ROUTER
-----------------------------------------------------
Same reasoning as routes/org.py (see that file's module docstring). Only one
of these routes needs anything app.py-resident: send_push (used by the
_acad_push_members background-task helper, itself only reachable from
inside build_router so it can close over send_push directly rather than
threading it through every call site). Everything else below build_router
is a pure helper (only touches db, stdlib) and lives at module level.

Class records, membership, attendance, announcements, assignments,
submissions, exams, grades, live sessions and polls all ride on the
generic `collections` table (database.py, PRIMARY KEY (collection,
item_id)) via db.coll_get/coll_put/coll_list/coll_delete, in the
"acad_*"-prefixed collection namespace -- no dedicated SQL tables, no
JSON-file fallback (Postgres-only, unlike Tasks/Habits/Goals).
"""

import asyncio
import datetime
import hashlib
import logging
import mimetypes
import random
import re
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

import database as db
from config import MATERIALS_DIR
from core import (
    sanitize_text, _resolve_token,
    check_rate_limit, get_client_key, get_session_from_token, validate_sid,
)

log = logging.getLogger("sivarr")

# httpx is optional app-wide (see app.py's own try/except at import time) --
# mirrored here rather than injected since it's a pure library import with
# no app-state dependency. Used only by the real literature-search endpoint.
try:
    import httpx as _httpx
except ImportError:
    _httpx = None

# ── Materials: lecturer-posted class files/doc references ────────────────
# Real uploads live on MATERIALS_DIR (config.py) -- the same Railway
# persistent-volume pattern DATA_DIR/UPLOADS_DIR already use, chosen instead
# of standing up a new cloud storage provider (Hunter's call). A doc-type
# material is a content SNAPSHOT of one of the lecturer's own Docs & Notes
# entries at attach time, not a live share -- Docs are personal-space data
# with no sharing/permission model of their own, and a stable "posted notes"
# copy is simpler and sufficient here.
_MATERIAL_MAGIC = {".pdf": b"%PDF"}
_MATERIAL_TEXT_EXTS = {".txt", ".md"}
_MATERIAL_ALLOWED_EXTS = {".pdf", ".md", ".txt"}
MATERIAL_MAX_SIZE = 20 * 1024 * 1024  # 20MB -- lecture PDFs run bigger than quiz-upload text
_MATERIAL_RATE_LIMIT = 10  # uploads per window, per acad_upload key

# ── Real literature search: PubMed (NCBI E-utilities) + Semantic Scholar's
# public Graph API -- both free, no key needed at this volume. Rate-limited
# server-side so Sivarr's own aggregate traffic doesn't get throttled by
# either free public API on top of whatever limits they already impose.
_RESEARCH_RATE_LIMIT = 20  # searches per window, per acad_research key


def _validate_material_magic(content: bytes, ext: str) -> bool:
    magic = _MATERIAL_MAGIC.get(ext)
    if magic and not content.startswith(magic):
        return False
    if ext in _MATERIAL_TEXT_EXTS:
        sample = content[:512]
        if sample:
            non_text = sum(1 for b in sample if b < 32 and b not in (9, 10, 13))
            if non_text / len(sample) > 0.30:
                return False
    return True

# Mirrors app.py's own MAX_NAME_LEN (a plain int=80 module constant shared
# across many unrelated domains) -- not worth injecting for the 2 call sites
# below that need it.
MAX_NAME_LEN = 80

def _acad_gen_code() -> str:
    import string
    chars = string.ascii_uppercase + string.digits
    for _ in range(50):
        code = "".join(random.choices(chars, k=6))
        if not db.coll_get("acad_classes", code):
            return code
    return "".join(random.choices(chars, k=8))


def _acad_class_or_404(code: str) -> dict:
    cls = db.coll_get("acad_classes", code)
    if not cls:
        raise HTTPException(404, "Class not found. Check the join code.")
    return cls


def _acad_is_member(code: str, sid: str) -> bool:
    return db.coll_get("acad_members", f"{code}:{sid}") is not None


def _acad_require_owner(code: str, sid: str) -> dict:
    cls = _acad_class_or_404(code)
    if cls.get("owner_sid") != sid:
        raise HTTPException(403, "Only the class owner can do that.")
    return cls


# ── Recurring weekly class schedule (stored directly on acad_classes) ────
#  One entry per weekday max -- re-adding the same day replaces its time
#  rather than duplicating, giving add/edit/remove without a separate
#  collection. Not the same thing as a "Live" session (acad_live_set/clear
#  below), which is an ad-hoc "go live now" event, not a recurring time.
_ACAD_SCHEDULE_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_ACAD_SCHEDULE_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


# ── Live attendance (built on the class bridge) ──────────────────
#  Sessions in `acad_att_sessions` (owner=code); check-in records in
#  `acad_att_records` (owner=session_id). Attendance % counts ended
#  sessions only, so an in-progress session never penalises a student.
ACAD_ATT_WINDOW_MIN = 30   # how long a check-in code stays valid
ACAD_ATT_LATE_MIN   = 10   # checking in after this many minutes = "late"


def _acad_session_expired(s: dict) -> bool:
    try:
        return datetime.datetime.utcnow() >= datetime.datetime.fromisoformat(s.get("expires", ""))
    except Exception:
        return True


def _acad_open_session(code: str) -> dict | None:
    for s in db.coll_list("acad_att_sessions", owner=code):
        if s.get("open") and not _acad_session_expired(s):
            return s
    return None


# ── Acad exam student take-flow ────────────────────────────────
#  acad_class_exams (owner=code) = the assignment; acad_exams (owner=lecturer
#  sid) holds the question bank; acad_exam_results (owner="{code}:{exam_id}",
#  id="{code}:{exam_id}:{sid}") = one student's answers. Each student gets a
#  deterministic random subset of the bank (questions_per_student).

def _parse_exam_q(raw: str):
    """One bank line. Pipe syntax 'Question? | optA | *optB | optC' → an MCQ
    question (the *-prefixed option is the correct one); any line without a pipe
    stays a plain free-text question string (backward-compatible)."""
    raw = str(raw).strip()
    if "|" in raw:
        parts = [p.strip() for p in raw.split("|")]
        q = sanitize_text(parts[0], 500)
        opts, correct = [], 0
        for o in parts[1:]:
            o = o.strip()
            if not o:
                continue
            if o.startswith("*"):
                correct = len(opts)
                o = o[1:].strip()
            if o:
                opts.append(sanitize_text(o, 200))
        opts = opts[:8]
        if q and len(opts) >= 2:
            return {"q": q, "type": "mcq", "options": opts, "correct": min(correct, len(opts) - 1)}
    return sanitize_text(raw, 500)


def _exam_q_public(q):
    """Student-facing shape of a bank question — never includes the MCQ answer."""
    if isinstance(q, dict):
        return {"q": q.get("q", ""), "type": "mcq", "options": q.get("options", []) or []}
    return {"q": str(q), "type": "text"}


def _exam_questions_for(exam: dict, sid: str) -> list:
    """Deterministic per-student subset of the exam's question bank (stable on reload).
    MCQ questions are returned without their correct answer."""
    qs = exam.get("questions", []) or []
    if not qs:
        return []
    n = min(int(exam.get("questions_per_student", len(qs)) or len(qs)), len(qs))
    seed = int(hashlib.sha256(f"{exam.get('id','')}:{sid}".encode()).hexdigest(), 16) % (2**32)
    idxs = list(range(len(qs)))
    random.Random(seed).shuffle(idxs)
    return [{"i": i, **_exam_q_public(qs[i])} for i in sorted(idxs[:n])]


def _acad_poll_tally(poll: dict) -> dict:
    votes = db.coll_list("acad_poll_votes", owner=poll["id"])
    counts = [0] * len(poll.get("options", []))
    for v in votes:
        i = v.get("option", -1)
        if 0 <= i < len(counts):
            counts[i] += 1
    return {"id": poll["id"], "question": poll["question"], "options": poll["options"],
            "counts": counts, "total": len(votes), "open": poll.get("open", True)}


# ── Class stats: real per-student grade average + attendance % ──────
#  Grades are free text today (a lecturer can type "18/20", "92%", or "B+"),
#  so averaging them into a distribution chart needs a best-effort parse --
#  anything that doesn't look numeric is simply excluded from the average
#  rather than guessed at. Reuses the exact collections acad_grade/
#  acad_exam_grade/acad_att_register already read one item at a time; this
#  just aggregates them for the Students tab and Analytics.

_GRADE_FRACTION_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)$")
_GRADE_PERCENT_RE  = re.compile(r"^(\d+(?:\.\d+)?)\s*%$")
_GRADE_PLAIN_RE    = re.compile(r"^(\d+(?:\.\d+)?)$")


def _parse_grade_pct(grade: str) -> float | None:
    """'18/20' -> 90.0 · '92%' -> 92.0 · '85' -> 85.0 · 'B+' -> None (not
    guessed, just excluded from the numeric average)."""
    g = str(grade or "").strip()
    if not g:
        return None
    m = _GRADE_FRACTION_RE.match(g)
    if m:
        num, den = float(m.group(1)), float(m.group(2))
        return round(100 * num / den, 1) if den else None
    m = _GRADE_PERCENT_RE.match(g)
    if m:
        return round(float(m.group(1)), 1)
    m = _GRADE_PLAIN_RE.match(g)
    if m:
        val = float(m.group(1))
        return round(val, 1) if 0 <= val <= 100 else None
    return None


def _acad_attendance_pcts(code: str, members: list) -> tuple:
    """sid -> {present, total, pct} for every current member, across all
    ended sessions. Shared by acad_att_register and acad_class_stats so the
    two never drift apart on what "attendance %" means."""
    sessions = [s for s in db.coll_list("acad_att_sessions", owner=code) if not s.get("open")]
    total = len(sessions)
    present: dict = {}
    for s in sessions:
        for r in db.coll_list("acad_att_records", owner=s["session_id"]):
            present[r["sid"]] = present.get(r["sid"], 0) + 1
    out = {}
    for m in members:
        cnt = present.get(m["sid"], 0)
        out[m["sid"]] = {"present": cnt, "total": total,
                          "pct": round(cnt / total * 100) if total else 0}
    return out, total


def _acad_attendance_weekly(code: str, member_count: int) -> list:
    """Weekly attendance % trend across ended sessions, oldest first --
    each session's own present/member-count %, averaged per ISO week."""
    sessions = [s for s in db.coll_list("acad_att_sessions", owner=code)
                if not s.get("open") and s.get("ended")]
    weekly: dict = {}
    for s in sessions:
        try:
            dt = datetime.datetime.fromisoformat(s["ended"])
        except Exception:
            continue
        wk = dt.strftime("%G-W%V")
        present_count = len(db.coll_list("acad_att_records", owner=s["session_id"]))
        pct = round(present_count / member_count * 100) if member_count else 0
        weekly.setdefault(wk, []).append(pct)
    return [{"week": wk, "pct": round(sum(v) / len(v))} for wk, v in sorted(weekly.items())]


def _acad_class_grade_stats(code: str) -> tuple:
    """sid -> {avg_score, scored_count} across assignments + exams, plus the
    total gradable-item count for the class (used to compute "missing").
    An exam counts as scored if it has EITHER a parseable manual grade OR an
    auto_pct (an all-MCQ exam is a real score the moment it's submitted, even
    before a lecturer marks it "graded") -- an assignment only counts once
    manually graded, since assignments have no auto-grading path."""
    per_student: dict = {}

    def _record(sid: str, pct):
        row = per_student.setdefault(sid, {"pcts": [], "scored": 0})
        row["scored"] += 1
        if pct is not None:
            row["pcts"].append(pct)

    assignments = db.coll_list("acad_assignments", owner=code)
    for a in assignments:
        for sub in db.coll_list("acad_submissions", owner=a["id"]):
            if not sub.get("graded"):
                continue
            _record(sub.get("sid", ""), _parse_grade_pct(sub.get("grade", "")))

    class_exams = db.coll_list("acad_class_exams", owner=code)
    for ce in class_exams:
        for r in db.coll_list("acad_exam_results", owner=f"{code}:{ce['exam_id']}"):
            manual_pct = _parse_grade_pct(r.get("grade", "")) if r.get("graded") else None
            auto_pct = (r.get("auto") or {}).get("auto_pct")
            pct = manual_pct if manual_pct is not None else (float(auto_pct) if auto_pct is not None else None)
            if pct is None and not r.get("graded"):
                continue  # no usable score yet
            _record(r.get("sid", ""), pct)

    total_items = len(assignments) + len(class_exams)
    out = {
        sid: {
            "avg_score": round(sum(row["pcts"]) / len(row["pcts"]), 1) if row["pcts"] else None,
            "scored_count": row["scored"],
        }
        for sid, row in per_student.items()
    }
    return out, total_items


def _acad_gradebook_items(code: str) -> tuple:
    """Per-item breakdown behind the Gradebook (lecturer, all students) and
    My Grades (student, own row only) tabs -- unlike _acad_class_grade_stats
    above (which only returns an average), this keeps one cell per gradable
    item so a table can actually show "Reading Response #4: 18/20" per
    student, not just their overall %.

    Returns (items, rows):
      items = [{id, type: "assignment"|"exam", title}, ...]
      rows  = {sid: {sid, name, cells: {item_id: {display, pct, grading,
               state}}, final_pct}}  -- state is "graded"/"pending"/"missing",
               grading is "manual"/"auto"/None (None when ungraded)."""
    members = {m["sid"]: m for m in db.coll_list("acad_members", owner=code)}
    items = []
    rows = {sid: {"sid": sid, "name": m.get("name", ""), "cells": {}}
            for sid, m in members.items()}

    def _cell(display, pct, grading, state):
        return {"display": display, "pct": pct, "grading": grading, "state": state}

    for a in db.coll_list("acad_assignments", owner=code):
        items.append({"id": a["id"], "type": "assignment", "title": a.get("title", "Assignment")})
        subs = {s["sid"]: s for s in db.coll_list("acad_submissions", owner=a["id"])}
        for sid in rows:
            sub = subs.get(sid)
            if not sub:
                rows[sid]["cells"][a["id"]] = _cell("—", None, None, "missing")
            elif not sub.get("graded"):
                rows[sid]["cells"][a["id"]] = _cell("Pending", None, None, "pending")
            else:
                grade = sub.get("grade", "")
                rows[sid]["cells"][a["id"]] = _cell(grade, _parse_grade_pct(grade), "manual", "graded")

    for ce in db.coll_list("acad_class_exams", owner=code):
        items.append({"id": ce["exam_id"], "type": ce.get("kind", "exam"), "title": ce.get("title", "Exam")})
        results = {r["sid"]: r for r in db.coll_list("acad_exam_results", owner=f"{code}:{ce['exam_id']}")}
        for sid in rows:
            res = results.get(sid)
            if not res:
                rows[sid]["cells"][ce["exam_id"]] = _cell("—", None, None, "missing")
                continue
            manual_pct = _parse_grade_pct(res.get("grade", "")) if res.get("graded") else None
            auto_pct = (res.get("auto") or {}).get("auto_pct")
            if manual_pct is not None:
                rows[sid]["cells"][ce["exam_id"]] = _cell(res.get("grade", ""), manual_pct, "manual", "graded")
            elif auto_pct is not None:
                rows[sid]["cells"][ce["exam_id"]] = _cell(f"{auto_pct}% auto", float(auto_pct), "auto", "graded")
            elif res.get("graded"):
                # Manually graded but the grade text didn't parse (e.g. "B+").
                rows[sid]["cells"][ce["exam_id"]] = _cell(res.get("grade", ""), None, "manual", "graded")
            else:
                rows[sid]["cells"][ce["exam_id"]] = _cell("Pending", None, None, "pending")

    for row in rows.values():
        pcts = [c["pct"] for c in row["cells"].values() if c["pct"] is not None]
        row["final_pct"] = round(sum(pcts) / len(pcts), 1) if pcts else None

    return items, rows


def _acad_log_activity(code: str, text: str) -> None:
    """Append one pre-rendered entry to a class's Recent Activity feed. Text
    is rendered here rather than a type code the frontend interprets, so the
    read side stays a plain list of strings + timestamps with no
    type-to-copy mapping to keep in sync. Deliberately not logged: grading
    actions (lecturer-facing only, they already know), polls/live sessions
    (already surfaced elsewhere) -- this is "what's new since I last
    looked," not a full audit trail."""
    entry = {
        "id": uuid.uuid4().hex[:10],
        "code": code,
        "text": sanitize_text(text, 300),
        "ts": datetime.datetime.utcnow().isoformat(),
    }
    db.coll_put("acad_activity", entry["id"], entry, owner=code)


def build_router(send_push) -> APIRouter:
    router = APIRouter()

    # ── Announcements + web push + feed (built on the class bridge) ──
    def _acad_push_members(code: str, title: str, body: str, url: str = "/app") -> None:
        """Fire a web push to every member of a class (best-effort)."""
        for m in db.coll_list("acad_members", owner=code):
            try:
                send_push(m.get("sid", ""), title, body, url, f"acad_{code}")
            except Exception:
                pass


    @router.post("/api/acad/class/create")
    async def acad_class_create(data: dict):
        """Lecturer publishes a class from their academic space; returns a join code."""
        sid, name = _resolve_token(data)
        cname   = sanitize_text(str(data.get("name", "")), 100) or "My Class"
        subject = sanitize_text(str(data.get("subject", "")), 100)
        code = _acad_gen_code()
        cls = {
            "code": code, "owner_sid": sid, "owner_name": name,
            "name": cname, "subject": subject,
            "created": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "live": None,
        }
        db.coll_put("acad_classes", code, cls, owner=sid)
        log.info(f"Acad class created: {cname} ({code}) by {sid[:12]}")
        return {"ok": True, "code": code, "class": cls}


    @router.post("/api/acad/class/join")
    async def acad_class_join(data: dict):
        """Student links their space to a class by code."""
        sid, name = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        if cls.get("owner_sid") == sid:
            raise HTTPException(
                400,
                "You're the lecturer for this class, so it won't show up under "
                "Student view. Switch to Lecturer view to manage it.",
            )
        db.coll_put("acad_members", f"{code}:{sid}",
                    {"code": code, "sid": sid, "name": name,
                     "joined": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")},
                    owner=code)
        _acad_log_activity(code, f"{name} joined the class")
        return {"ok": True, "class": {"code": code, "name": cls.get("name"),
                                      "owner_name": cls.get("owner_name"), "subject": cls.get("subject")}}


    @router.post("/api/acad/class/get")
    async def acad_class_get(data: dict):
        """Fetch a class + roster. Visible to the owner or any member."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        is_owner = cls.get("owner_sid") == sid
        if not is_owner and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class to view it.")
        roster = db.coll_list("acad_members", owner=code)
        return {"ok": True, "class": cls, "is_owner": is_owner,
                "members": roster, "member_count": len(roster)}


    @router.post("/api/acad/class/mine")
    async def acad_class_mine(data: dict):
        """Classes owned by the caller (lecturer side)."""
        sid, _ = _resolve_token(data)
        return {"ok": True, "classes": db.coll_list("acad_classes", owner=sid)}


    @router.post("/api/acad/class/roster")
    async def acad_class_roster(data: dict):
        """Owner-only roster of joined students."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        return {"ok": True, "members": db.coll_list("acad_members", owner=code)}


    @router.post("/api/acad/class/leave")
    async def acad_class_leave(data: dict):
        """Student leaves a class; an owner may remove a member via member_sid."""
        sid, _ = _resolve_token(data)
        code   = sanitize_text(str(data.get("code", "")), 12).upper()
        target = sanitize_text(str(data.get("member_sid", "")), 40) or sid
        if target != sid:
            _acad_require_owner(code, sid)   # only the owner can remove others
        db.coll_delete("acad_members", f"{code}:{target}")
        return {"ok": True}


    @router.post("/api/acad/attendance/start")
    async def acad_att_start(data: dict):
        """Owner starts an attendance session → returns a check-in code."""
        import string
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        # Close any sessions still open for this class.
        for s in db.coll_list("acad_att_sessions", owner=code):
            if s.get("open"):
                s["open"] = False
                db.coll_put("acad_att_sessions", s["session_id"], s, owner=code)
        now = datetime.datetime.utcnow()
        sess = {
            "session_id":   uuid.uuid4().hex[:12],
            "code":         code,
            "checkin_code": "".join(random.choices(string.ascii_uppercase + string.digits, k=5)),
            "started":      now.isoformat(),
            "expires":      (now + datetime.timedelta(minutes=ACAD_ATT_WINDOW_MIN)).isoformat(),
            "open":         True,
        }
        db.coll_put("acad_att_sessions", sess["session_id"], sess, owner=code)
        return {"ok": True, "session_id": sess["session_id"], "checkin_code": sess["checkin_code"], "expires": sess["expires"]}


    @router.post("/api/acad/attendance/checkin")
    async def acad_att_checkin(data: dict):
        """Member checks in with the live code → present (or late)."""
        sid, name = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cc   = sanitize_text(str(data.get("checkin_code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        # Owner can check in too (so a single account testing both roles, or a lecturer
        # marking themselves present, isn't blocked). Otherwise must be a joined member.
        if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join the class first.")
        sess = _acad_open_session(code)
        if not sess:
            raise HTTPException(400, "No attendance session is open right now.")
        if sess.get("checkin_code") != cc:
            raise HTTPException(400, "Wrong check-in code.")
        now = datetime.datetime.utcnow()
        try:
            late = (now - datetime.datetime.fromisoformat(sess["started"])).total_seconds() > ACAD_ATT_LATE_MIN * 60
        except Exception:
            late = False
        status = "late" if late else "present"
        db.coll_put("acad_att_records", f"{sess['session_id']}:{sid}",
                    {"session_id": sess["session_id"], "code": code, "sid": sid, "name": name,
                     "ts": now.isoformat(), "status": status},
                    owner=sess["session_id"])
        return {"ok": True, "status": status}


    @router.post("/api/acad/attendance/session")
    async def acad_att_session(data: dict):
        """Owner polls the live roster for an active session."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        session_id = sanitize_text(str(data.get("session_id", "")), 20)
        recs   = db.coll_list("acad_att_records", owner=session_id)
        roster = db.coll_list("acad_members", owner=code)
        return {"ok": True, "records": recs, "present_count": len(recs), "total": len(roster)}


    @router.post("/api/acad/attendance/end")
    async def acad_att_end(data: dict):
        """Owner ends a session (records become part of the register)."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        session_id = sanitize_text(str(data.get("session_id", "")), 20)
        sess = db.coll_get("acad_att_sessions", session_id)
        if sess:
            sess["open"] = False
            sess["ended"] = datetime.datetime.utcnow().isoformat()
            db.coll_put("acad_att_sessions", session_id, sess, owner=code)
        present_count = len(db.coll_list("acad_att_records", owner=session_id))
        if sess:
            total_members = len(db.coll_list("acad_members", owner=code))
            _acad_log_activity(code, f"Attendance session closed — {present_count}/{total_members} present")
        return {"ok": True, "present_count": present_count}


    @router.post("/api/acad/attendance/register")
    async def acad_att_register(data: dict):
        """Owner-only register: per-student attendance % across ended sessions."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        members = db.coll_list("acad_members", owner=code)
        att, total = _acad_attendance_pcts(code, members)
        rows = [{"sid": m["sid"], "name": m["name"], **att[m["sid"]]} for m in members]
        return {"ok": True, "sessions": total, "rows": rows}


    @router.post("/api/acad/class/stats")
    async def acad_class_stats(data: dict):
        """Owner-only: real per-student attendance % + grade average, plus a
        class-level score distribution and at-risk list. Read-only aggregation
        over the same collections /attendance/register, /submissions, and
        /exam/results already expose one item at a time -- built so the
        Students tab and Analytics can show real numbers instead of the
        placeholders they previously carried."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)

        members = db.coll_list("acad_members", owner=code)
        att, att_sessions = _acad_attendance_pcts(code, members)
        grades, total_items = _acad_class_grade_stats(code)
        weekly = _acad_attendance_weekly(code, len(members))

        buckets = [0, 0, 0, 0, 0]
        at_risk = []
        students = {}
        for m in members:
            msid = m["sid"]
            a = att[msid]
            g = grades.get(msid, {"avg_score": None, "scored_count": 0})
            students[msid] = {
                "attendance_pct": a["pct"],
                "avg_score":      g["avg_score"],
                "scored_count":   g["scored_count"],
                "total_count":    total_items,
            }
            if g["avg_score"] is not None:
                buckets[min(int(g["avg_score"] // 20), 4)] += 1
            missing = max(0, total_items - g["scored_count"])
            if a["pct"] < 70 or missing >= 2:
                at_risk.append({"sid": msid, "name": m.get("name", ""),
                                 "attendance_pct": a["pct"], "missing_items": missing})

        return {"ok": True, "students": students, "score_buckets": buckets,
                "at_risk": at_risk, "attendance_sessions": att_sessions,
                "attendance_weekly": weekly}


    @router.post("/api/acad/gradebook")
    async def acad_gradebook(data: dict):
        """Owner-only: every student x every gradable item, one table. See
        _acad_gradebook_items for the shape."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        items, rows = _acad_gradebook_items(code)
        return {"ok": True, "items": items, "rows": list(rows.values())}


    @router.post("/api/acad/gradebook/mine")
    async def acad_gradebook_mine(data: dict):
        """Member-only: the same table, but only the caller's own row --
        never exposes other students' grades."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        if not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class first.")
        items, rows = _acad_gradebook_items(code)
        return {"ok": True, "items": items, "row": rows.get(sid)}


    @router.post("/api/acad/attendance/mine")
    async def acad_att_mine(data: dict):
        """Member's own attendance % for a class + whether a session is open now."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        if not _acad_is_member(code, sid):
            raise HTTPException(403, "Join the class first.")
        sessions = [s for s in db.coll_list("acad_att_sessions", owner=code) if not s.get("open")]
        total = len(sessions)
        present = sum(1 for s in sessions if db.coll_get("acad_att_records", f"{s['session_id']}:{sid}"))
        return {"ok": True, "present": present, "total": total,
                "pct": round(present / total * 100) if total else 0,
                "open_session": _acad_open_session(code) is not None}


    @router.post("/api/acad/announce")
    async def acad_announce(data: dict, bg: BackgroundTasks):
        """Owner posts an announcement; members get a web-push notification."""
        sid, name = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        text = sanitize_text(str(data.get("text", "")), 1000)
        if not text:
            raise HTTPException(400, "Announcement text is required.")
        ann = {"id": uuid.uuid4().hex[:10], "code": code, "text": text,
               "author": name, "ts": datetime.datetime.utcnow().isoformat()}
        db.coll_put("acad_announcements", ann["id"], ann, owner=code)
        preview = text if len(text) <= 60 else text[:57] + "..."
        _acad_log_activity(code, f"Announcement posted: {preview}")
        bg.add_task(_acad_push_members, code, f"📢 {cls.get('name', 'Class')}", text, "/app")
        return {"ok": True, "announcement": ann}


    @router.post("/api/acad/announce/delete")
    async def acad_announce_delete(data: dict):
        """Owner removes an announcement."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        ann_id = sanitize_text(str(data.get("id", "")), 20)
        ann = db.coll_get("acad_announcements", ann_id)
        if not ann or ann.get("code") != code:
            raise HTTPException(404, "Announcement not found.")
        db.coll_delete("acad_announcements", ann_id)
        return {"ok": True}


    @router.post("/api/acad/feed")
    async def acad_feed(data: dict):
        """Announcements for a class — visible to the owner or any member."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class to view its feed.")
        anns = sorted(db.coll_list("acad_announcements", owner=code),
                      key=lambda a: a.get("ts", ""), reverse=True)
        return {"ok": True, "class_name": cls.get("name"), "announcements": anns[:50]}


    # ── Gradebook: shared assignments + submissions + grading ────────
    #  acad_assignments (owner=code) · acad_submissions (owner=assignment_id,
    #  item_id="{aid}:{sid}").
    @router.post("/api/acad/assignment/create")
    async def acad_assignment_create(data: dict, bg: BackgroundTasks):
        """Owner posts a class assignment (members notified)."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        title = sanitize_text(str(data.get("title", "")), 200)
        if not title:
            raise HTTPException(400, "Assignment title is required.")
        a = {"id": uuid.uuid4().hex[:10], "code": code, "title": title,
             "due": sanitize_text(str(data.get("due", "")), 40),
             "points": sanitize_text(str(data.get("points", "")), 10),
             "created": datetime.datetime.utcnow().isoformat()}
        db.coll_put("acad_assignments", a["id"], a, owner=code)
        _acad_log_activity(code, f"New assignment: {title}")
        bg.add_task(_acad_push_members, code, f"📝 {cls.get('name', 'Class')}: new assignment", title, "/app")
        return {"ok": True, "assignment": a}


    @router.post("/api/acad/assignment/list")
    async def acad_assignment_list(data: dict):
        """Class assignments — owner or member."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class first.")
        items = sorted(db.coll_list("acad_assignments", owner=code), key=lambda a: a.get("created", ""), reverse=True)
        return {"ok": True, "assignments": items}


    @router.post("/api/acad/assignment/delete")
    async def acad_assignment_delete(data: dict):
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        aid = sanitize_text(str(data.get("id", "")), 20)
        a = db.coll_get("acad_assignments", aid)
        if not a or a.get("code") != code:
            raise HTTPException(404, "Assignment not found.")
        db.coll_delete("acad_assignments", aid)
        return {"ok": True}


    # ── Acad exams (Stage 6 rebuild) ───────────────────────────────
    # v3-native exam bank: per-lecturer (owner=sid), normal session token — fixes
    # the verify_lecturer()/lec_-token 401 that blocked the v3 Exam Builder (the old
    # /api/lecturer/exam* global-LECTURER_PASSWORD bank this replaced has since
    # been deleted entirely). Owner-scoped + id-based (no index-delete race).
    @router.post("/api/acad/exam/create")
    async def acad_exam_create(data: dict):
        """Lecturer creates an exam in their own bank (normal session token)."""
        sid, name = _resolve_token(data)
        title = sanitize_text(str(data.get("title", "")), 200)
        if not title:
            raise HTTPException(400, "Exam title is required.")
        questions = [_parse_exam_q(str(q)) for q in data.get("questions", [])[:100] if str(q).strip()]
        if not questions:
            raise HTTPException(400, "Add at least one question to the bank.")
        kind = str(data.get("kind", "exam"))
        kind = kind if kind in ("exam", "quiz") else "exam"
        exam = {
            "id":                   uuid.uuid4().hex[:10],
            "owner_sid":            sid,
            "title":                title,
            "kind":                 kind,
            "questions":            questions,
            "questions_per_student": min(max(int(data.get("questions_per_student", 30)), 1), 100),
            "duration":             min(max(int(data.get("duration", 60)), 1), 300),
            "lecturer":             sanitize_text(str(data.get("lecturer", name)), MAX_NAME_LEN),
            "created":              datetime.datetime.utcnow().isoformat(),
        }
        db.coll_put("acad_exams", exam["id"], exam, owner=sid)
        return {"ok": True, "exam": exam}


    @router.post("/api/acad/exam/list")
    async def acad_exam_list(data: dict):
        """The caller's own exam bank."""
        sid, _ = _resolve_token(data)
        exams = sorted(db.coll_list("acad_exams", owner=sid),
                       key=lambda e: e.get("created", ""), reverse=True)
        return {"ok": True, "exams": exams}


    @router.post("/api/acad/exam/delete")
    async def acad_exam_delete(data: dict):
        """Delete one of your own exams by id (owner-scoped)."""
        sid, _ = _resolve_token(data)
        exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
        exam = db.coll_get("acad_exams", exam_id)
        if not exam or exam.get("owner_sid") != sid:
            raise HTTPException(404, "Exam not found.")
        db.coll_delete("acad_exams", exam_id)
        return {"ok": True}


    @router.post("/api/acad/exam/assign")
    async def acad_exam_assign(data: dict, bg: BackgroundTasks):
        """Assign one of your exams to a class you own; members are notified."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
        exam = db.coll_get("acad_exams", exam_id)
        if not exam or exam.get("owner_sid") != sid:
            raise HTTPException(404, "Exam not found.")
        kind = exam.get("kind", "exam")
        rec = {
            "id":                   f"{code}:{exam_id}",
            "code":                 code,
            "exam_id":              exam_id,
            "title":                exam["title"],
            "kind":                 kind,
            "questions_per_student": exam.get("questions_per_student", 30),
            "duration":             exam.get("duration", 60),
            "assigned":             datetime.datetime.utcnow().isoformat(),
        }
        db.coll_put("acad_class_exams", rec["id"], rec, owner=code)
        _acad_log_activity(code, f"New {kind} assigned: {exam['title']}")
        bg.add_task(_acad_push_members, code, f"📝 {cls.get('name', 'Class')}: new {kind}", exam["title"], "/app")
        return {"ok": True, "assignment": rec}


    @router.post("/api/acad/exam/assigned")
    async def acad_exam_assigned(data: dict):
        """Exams assigned to a class — owner or member; annotated with the caller's status."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class first.")
        items = sorted(db.coll_list("acad_class_exams", owner=code),
                       key=lambda e: e.get("assigned", ""), reverse=True)
        out = []
        for it in items:
            res = db.coll_get("acad_exam_results", f"{code}:{it.get('exam_id','')}:{sid}")
            out.append({**it, "submitted": bool(res),
                        "graded": bool(res and res.get("graded")),
                        "grade": (res or {}).get("grade", ""),
                        "auto_pct": (res or {}).get("auto", {}).get("auto_pct")})
        return {"ok": True, "exams": out}


    @router.post("/api/acad/exam/take")
    async def acad_exam_take(data: dict):
        """Member fetches their question subset for an assigned exam (+ any prior submission)."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        if not _acad_is_member(code, sid):
            raise HTTPException(403, "Join the class first.")
        exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
        if not db.coll_get("acad_class_exams", f"{code}:{exam_id}"):
            raise HTTPException(404, "Exam not assigned to this class.")
        exam = db.coll_get("acad_exams", exam_id)
        if not exam:
            raise HTTPException(404, "Exam not found.")
        res = db.coll_get("acad_exam_results", f"{code}:{exam_id}:{sid}")
        return {"ok": True, "exam": {
            "id": exam_id, "title": exam.get("title", "Exam"),
            "kind": exam.get("kind", "exam"),
            "duration": exam.get("duration", 60),
            "questions": _exam_questions_for(exam, sid),
        }, "submission": res}


    @router.post("/api/acad/exam/submit")
    async def acad_exam_submit(data: dict):
        """Member submits exam answers (overwrites a prior ungraded attempt)."""
        sid, name = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        if not _acad_is_member(code, sid):
            raise HTTPException(403, "Join the class first.")
        exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
        if not db.coll_get("acad_class_exams", f"{code}:{exam_id}"):
            raise HTTPException(404, "Exam not assigned to this class.")
        prev = db.coll_get("acad_exam_results", f"{code}:{exam_id}:{sid}")
        if prev and prev.get("graded"):
            raise HTTPException(409, "This exam has already been graded.")
        answers = data.get("answers", []) or []
        clean = [{"i": int(a.get("i", 0)),
                  "q": sanitize_text(str(a.get("q", "")), 500),
                  "a": sanitize_text(str(a.get("a", "")), 3000)} for a in answers[:100]]
        # Auto-grade MCQ answers against the bank (free-text is left for manual grading).
        bank = (db.coll_get("acad_exams", exam_id) or {}).get("questions", []) or []
        mcq_total = mcq_correct = 0
        for ans in clean:
            i = ans["i"]
            q = bank[i] if 0 <= i < len(bank) else None
            if isinstance(q, dict) and q.get("type") == "mcq":
                mcq_total += 1
                opts = q.get("options", []) or []
                cidx = q.get("correct", -1)
                correct_text = opts[cidx] if isinstance(cidx, int) and 0 <= cidx < len(opts) else None
                ans["correct"] = (correct_text is not None and ans["a"] == correct_text)
                if ans["correct"]:
                    mcq_correct += 1
        auto = {"mcq_total": mcq_total, "mcq_correct": mcq_correct,
                "auto_pct": round(100 * mcq_correct / mcq_total) if mcq_total else None}
        db.coll_put("acad_exam_results", f"{code}:{exam_id}:{sid}",
                    {"exam_id": exam_id, "code": code, "sid": sid, "name": name, "answers": clean,
                     "auto": auto,
                     "submitted_at": datetime.datetime.utcnow().isoformat(),
                     "graded": False, "grade": "", "feedback": ""},
                    owner=f"{code}:{exam_id}")
        return {"ok": True, "auto": auto}


    @router.post("/api/acad/exam/results")
    async def acad_exam_results(data: dict):
        """Owner: all student results for an assigned exam."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
        return {"ok": True, "results": db.coll_list("acad_exam_results", owner=f"{code}:{exam_id}")}


    @router.post("/api/acad/exam/grade")
    async def acad_exam_grade(data: dict, bg: BackgroundTasks):
        """Owner grades an exam result; the student is notified."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        exam_id = sanitize_text(str(data.get("exam_id", "")), 20)
        target = sanitize_text(str(data.get("sid", "")), 40)
        res = db.coll_get("acad_exam_results", f"{code}:{exam_id}:{target}")
        if not res:
            raise HTTPException(404, "No submission found.")
        res["grade"]    = sanitize_text(str(data.get("grade", "")), 20)
        res["feedback"] = sanitize_text(str(data.get("feedback", "")), 2000)
        res["graded"]   = True
        db.coll_put("acad_exam_results", f"{code}:{exam_id}:{target}", res, owner=f"{code}:{exam_id}")
        bg.add_task(send_push, target, f"✅ {cls.get('name', 'Class')}: exam graded",
                    f"You scored {res['grade']}", "/app", f"acad_{code}")
        return {"ok": True}


    @router.post("/api/acad/submit")
    async def acad_submit(data: dict):
        """Member submits work for an assignment (re-submit overwrites)."""
        sid, name = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        if not _acad_is_member(code, sid):
            raise HTTPException(403, "Join the class first.")
        aid = sanitize_text(str(data.get("assignment_id", "")), 20)
        if not db.coll_get("acad_assignments", aid):
            raise HTTPException(404, "Assignment not found.")
        db.coll_put("acad_submissions", f"{aid}:{sid}",
                    {"assignment_id": aid, "code": code, "sid": sid, "name": name,
                     "text": sanitize_text(str(data.get("text", "")), 5000),
                     "ts": datetime.datetime.utcnow().isoformat(),
                     "graded": False, "grade": "", "feedback": ""},
                    owner=aid)
        return {"ok": True}


    @router.post("/api/acad/submissions")
    async def acad_submissions(data: dict):
        """Owner: all submissions for an assignment."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        aid = sanitize_text(str(data.get("assignment_id", "")), 20)
        a = db.coll_get("acad_assignments", aid)
        if not a or a.get("code") != code:
            raise HTTPException(404, "Assignment not found.")
        return {"ok": True, "submissions": db.coll_list("acad_submissions", owner=aid)}


    @router.post("/api/acad/grade")
    async def acad_grade(data: dict, bg: BackgroundTasks):
        """Owner grades a submission; the student is notified."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        aid = sanitize_text(str(data.get("assignment_id", "")), 20)
        a = db.coll_get("acad_assignments", aid)
        if not a or a.get("code") != code:
            raise HTTPException(404, "Assignment not found.")
        target = sanitize_text(str(data.get("sid", "")), 40)
        sub = db.coll_get("acad_submissions", f"{aid}:{target}")
        if not sub:
            raise HTTPException(404, "Submission not found.")
        sub["grade"]    = sanitize_text(str(data.get("grade", "")), 20)
        sub["feedback"] = sanitize_text(str(data.get("feedback", "")), 2000)
        sub["graded"]   = True
        db.coll_put("acad_submissions", f"{aid}:{target}", sub, owner=aid)
        bg.add_task(send_push, target, f"✅ {cls.get('name', 'Class')}: graded",
                    f"You scored {sub['grade']}", "/app", f"acad_{code}")
        return {"ok": True}


    @router.post("/api/acad/grades/mine")
    async def acad_grades_mine(data: dict):
        """Member: their submission + grade for each class assignment."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        if not _acad_is_member(code, sid):
            raise HTTPException(403, "Join the class first.")
        out = []
        for a in db.coll_list("acad_assignments", owner=code):
            sub = db.coll_get("acad_submissions", f"{a['id']}:{sid}")
            out.append({"assignment_id": a["id"], "title": a.get("title"), "due": a.get("due"),
                        "submitted": sub is not None, "graded": bool(sub and sub.get("graded")),
                        "grade": (sub or {}).get("grade", ""), "feedback": (sub or {}).get("feedback", "")})
        return {"ok": True, "items": out}


    # ── Live session + in-class polls (built on the class bridge) ────
    @router.post("/api/acad/live/set")
    async def acad_live_set(data: dict, bg: BackgroundTasks):
        """Owner marks the class live with a join link; members notified."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        cls["live"] = {"link": sanitize_text(str(data.get("link", "")), 500),
                       "title": sanitize_text(str(data.get("title", "")), 200) or "Live class",
                       "started": datetime.datetime.utcnow().isoformat()}
        db.coll_put("acad_classes", code, cls, owner=cls.get("owner_sid", sid))
        bg.add_task(_acad_push_members, code, f"🔴 {cls.get('name', 'Class')} is live", cls["live"]["title"], cls["live"]["link"] or "/app")
        return {"ok": True, "live": cls["live"]}


    @router.post("/api/acad/live/clear")
    async def acad_live_clear(data: dict):
        """Owner ends the live session."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        cls["live"] = None
        db.coll_put("acad_classes", code, cls, owner=cls.get("owner_sid", sid))
        return {"ok": True}


    @router.post("/api/acad/class/schedule")
    async def acad_class_schedule(data: dict):
        """Owner sets a recurring weekly class time. Re-adding the same day
        replaces that day's time rather than duplicating it."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        day = str(data.get("day", "")).strip().lower()
        time_str = str(data.get("time", "")).strip()
        if day not in _ACAD_SCHEDULE_DAYS or not _ACAD_SCHEDULE_TIME_RE.match(time_str):
            raise HTTPException(400, "Pick a valid day and time.")
        schedule = [s for s in (cls.get("schedule") or []) if s.get("day") != day]
        schedule.append({"day": day, "time": time_str})
        schedule.sort(key=lambda s: (_ACAD_SCHEDULE_DAYS.index(s["day"]), s["time"]))
        cls["schedule"] = schedule
        db.coll_put("acad_classes", code, cls, owner=cls.get("owner_sid", sid))
        return {"ok": True, "schedule": cls["schedule"]}


    @router.post("/api/acad/class/schedule/remove")
    async def acad_class_schedule_remove(data: dict):
        """Owner removes a class's schedule entry for a given day."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        day = str(data.get("day", "")).strip().lower()
        cls["schedule"] = [s for s in (cls.get("schedule") or []) if s.get("day") != day]
        db.coll_put("acad_classes", code, cls, owner=cls.get("owner_sid", sid))
        return {"ok": True, "schedule": cls["schedule"]}


    @router.post("/api/acad/poll/create")
    async def acad_poll_create(data: dict, bg: BackgroundTasks):
        """Owner opens a poll for the class."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_require_owner(code, sid)
        q = sanitize_text(str(data.get("question", "")), 300)
        opts = [sanitize_text(str(o), 120) for o in (data.get("options") or []) if str(o).strip()][:6]
        if not q or len(opts) < 2:
            raise HTTPException(400, "A question and at least 2 options are required.")
        poll = {"id": uuid.uuid4().hex[:10], "code": code, "question": q, "options": opts,
                "open": True, "created": datetime.datetime.utcnow().isoformat()}
        db.coll_put("acad_polls", poll["id"], poll, owner=code)
        bg.add_task(_acad_push_members, code, f"📊 {cls.get('name', 'Class')}: new poll", q, "/app")
        return {"ok": True, "poll": poll}


    @router.post("/api/acad/poll/list")
    async def acad_poll_list(data: dict):
        """Open polls for a class (with tallies) — owner or member."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class first.")
        polls = [p for p in db.coll_list("acad_polls", owner=code) if p.get("open")]
        polls.sort(key=lambda p: p.get("created", ""), reverse=True)
        mine = {}
        for p in polls:
            v = db.coll_get("acad_poll_votes", f"{p['id']}:{sid}")
            if v:
                mine[p["id"]] = v.get("option")
        return {"ok": True, "polls": [_acad_poll_tally(p) for p in polls], "my_votes": mine}


    @router.post("/api/acad/poll/vote")
    async def acad_poll_vote(data: dict):
        """Member votes (one vote per poll; re-voting moves the vote)."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        if not _acad_is_member(code, sid):
            raise HTTPException(403, "Join the class first.")
        pid = sanitize_text(str(data.get("poll_id", "")), 20)
        poll = db.coll_get("acad_polls", pid)
        if not poll or poll.get("code") != code:
            raise HTTPException(404, "Poll not found.")
        if not poll.get("open"):
            raise HTTPException(400, "Poll is closed.")
        try:
            idx = int(data.get("option_index", -1))
        except Exception:
            idx = -1
        if not (0 <= idx < len(poll.get("options", []))):
            raise HTTPException(400, "Invalid option.")
        db.coll_put("acad_poll_votes", f"{pid}:{sid}", {"poll_id": pid, "sid": sid, "option": idx}, owner=pid)
        return {"ok": True, "results": _acad_poll_tally(poll)}


    @router.post("/api/acad/poll/close")
    async def acad_poll_close(data: dict):
        """Owner closes a poll."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        pid = sanitize_text(str(data.get("poll_id", "")), 20)
        poll = db.coll_get("acad_polls", pid)
        if not poll or poll.get("code") != code:
            raise HTTPException(404, "Poll not found.")
        poll["open"] = False
        db.coll_put("acad_polls", pid, poll, owner=code)
        return {"ok": True}


    # ── Materials ──────────────────────────────────────────────────
    @router.post("/api/acad/materials/list")
    async def acad_materials_list(data: dict):
        """Every material for a class -- owner or member."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        cls = _acad_class_or_404(code)
        if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class to view its materials.")
        items = sorted(db.coll_list("acad_materials", owner=code),
                       key=lambda m: m.get("posted_at", ""), reverse=True)
        return {"ok": True, "materials": items}


    @router.post("/api/acad/materials/add_doc")
    async def acad_materials_add_doc(data: dict):
        """Owner attaches a snapshot of one of their own Docs & Notes entries."""
        sid, name = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        doc_id = sanitize_text(str(data.get("doc_id", "")), 40)
        doc = next((d for d in db.get_docs(sid) if str(d.get("id", "")) == doc_id), None)
        if not doc:
            raise HTTPException(404, "Doc not found.")
        m = {
            "id": uuid.uuid4().hex[:10], "code": code, "type": "doc",
            "title": sanitize_text(str(doc.get("title", "Untitled")), 200),
            "content": sanitize_text(str(doc.get("content", "")), 20000),
            "posted_by": name, "posted_at": datetime.datetime.utcnow().isoformat(),
        }
        db.coll_put("acad_materials", m["id"], m, owner=code)
        _acad_log_activity(code, f"New material posted: {m['title']}")
        log.info(f"Acad material (doc) posted: {m['title']} to {code} by {sid[:12]}")
        return {"ok": True, "material": m}


    @router.post("/api/acad/materials/upload")
    async def acad_materials_upload(
        request: Request, token: str = Form(""), code: str = Form(""),
        file: UploadFile = File(...),
    ):
        """Owner uploads a real file (PDF/MD/TXT for now). Same security
        discipline as app.py's /api/upload -- session-token auth, rate limit,
        extension allowlist, size pre-check, magic-byte validation -- but
        keeps the original bytes instead of discarding them for extracted
        text, since a student needs to download this one back."""
        sess = get_session_from_token(sanitize_text(token, 100))
        if not sess:
            raise HTTPException(401, "Sign in to upload files.")
        sid = validate_sid(sess["sid"])
        name = sess.get("name", "")
        key = get_client_key(request, sid)
        check_rate_limit(key, _MATERIAL_RATE_LIMIT, "acad_upload")

        code = sanitize_text(code, 12).upper()
        _acad_require_owner(code, sid)

        ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in _MATERIAL_ALLOWED_EXTS:
            raise HTTPException(400, "Use .pdf, .md, or .txt files only.")

        clen = request.headers.get("content-length")
        if clen and clen.isdigit() and int(clen) > MATERIAL_MAX_SIZE + 8192:
            raise HTTPException(400, "File too large. Maximum size is 20MB.")

        content = await file.read()
        if len(content) > MATERIAL_MAX_SIZE:
            raise HTTPException(400, "File too large. Maximum size is 20MB.")
        if not _validate_material_magic(content, ext):
            raise HTTPException(400, "File content does not match its extension.")

        material_id = uuid.uuid4().hex[:10]
        fpath = MATERIALS_DIR / f"{material_id}{ext}"
        await asyncio.to_thread(fpath.write_bytes, content)

        m = {
            "id": material_id, "code": code, "type": "file",
            "title": sanitize_text(file.filename, 200),
            "filename": sanitize_text(file.filename, 200),
            "ext": ext, "size": len(content),
            "posted_by": name, "posted_at": datetime.datetime.utcnow().isoformat(),
        }
        db.coll_put("acad_materials", material_id, m, owner=code)
        _acad_log_activity(code, f"New material posted: {file.filename}")
        log.info(f"Acad material (file) uploaded: {file.filename} to {code} by {sid[:12]}")
        return {"ok": True, "material": m}


    @router.post("/api/acad/materials/delete")
    async def acad_materials_delete(data: dict):
        """Owner removes a material (and its file on disk, if any)."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        material_id = sanitize_text(str(data.get("id", "")), 20)
        m = db.coll_get("acad_materials", material_id)
        if not m or m.get("code") != code:
            raise HTTPException(404, "Material not found.")
        if m.get("type") == "file":
            fpath = MATERIALS_DIR / f"{material_id}{m.get('ext', '')}"
            try:
                fpath.unlink(missing_ok=True)
            except Exception as exc:
                log.warning(f"Could not delete material file {fpath}: {exc}")
        db.coll_delete("acad_materials", material_id)
        return {"ok": True}


    @router.get("/api/acad/materials/{material_id}/file")
    async def acad_materials_file(material_id: str, token: str = "", code: str = ""):
        """Stream a file-type material back -- owner or member. token/code as
        query params (same style GET /api/docs/restore already uses) so this
        works as a plain link, not just an authenticated fetch()."""
        sess = get_session_from_token(sanitize_text(token, 100))
        if not sess:
            raise HTTPException(401, "Invalid session.")
        sid = validate_sid(sess["sid"])
        code = sanitize_text(code, 12).upper()
        cls = _acad_class_or_404(code)
        if cls.get("owner_sid") != sid and not _acad_is_member(code, sid):
            raise HTTPException(403, "Join this class to view its materials.")
        m = db.coll_get("acad_materials", sanitize_text(material_id, 20))
        if not m or m.get("code") != code or m.get("type") != "file":
            raise HTTPException(404, "Material not found.")
        fpath = MATERIALS_DIR / f"{material_id}{m.get('ext', '')}"
        if not fpath.exists():
            raise HTTPException(404, "File not found.")
        media_type = mimetypes.guess_type(m.get("filename", ""))[0] or "application/octet-stream"
        return FileResponse(fpath, media_type=media_type, filename=m.get("filename", "download"))


    @router.post("/api/acad/research/search")
    async def acad_research_search(data: dict, request: Request):
        """Real literature search against free, credential-free public APIs --
        PubMed and Semantic Scholar. Google Scholar has no public API at all
        and JSTOR needs a paid institutional agreement, so neither is offered
        here (unlike the AI citation generator elsewhere in this space, which
        never claimed to search a real index in the first place)."""
        sid, _ = _resolve_token(data)
        key = get_client_key(request, sid)
        check_rate_limit(key, _RESEARCH_RATE_LIMIT, "acad_research")
        query = sanitize_text(str(data.get("query", "")), 300)
        if not query:
            raise HTTPException(400, "Enter a search query.")
        if not _httpx:
            return {"ok": True, "results": []}

        results = []
        async with _httpx.AsyncClient(timeout=10) as client:
            try:
                r = await client.get(
                    "https://api.semanticscholar.org/graph/v1/paper/search",
                    params={"query": query, "limit": 8, "fields": "title,authors,year,venue,externalIds,url"},
                )
                if r.status_code == 200:
                    for p in r.json().get("data", []) or []:
                        doi = (p.get("externalIds") or {}).get("DOI")
                        results.append({
                            "source": "semantic_scholar",
                            "title": p.get("title") or "",
                            "authors": [a.get("name", "") for a in (p.get("authors") or [])],
                            "year": p.get("year"),
                            "venue": p.get("venue") or "",
                            "url": p.get("url") or (f"https://doi.org/{doi}" if doi else ""),
                        })
            except Exception as exc:
                log.warning(f"Semantic Scholar search failed: {exc}")

            try:
                r = await client.get(
                    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                    params={"db": "pubmed", "term": query, "retmax": 8, "retmode": "json", "tool": "sivarr-academic"},
                )
                ids = (r.json().get("esearchresult") or {}).get("idlist", []) if r.status_code == 200 else []
                if ids:
                    r2 = await client.get(
                        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                        params={"db": "pubmed", "id": ",".join(ids), "retmode": "json", "tool": "sivarr-academic"},
                    )
                    if r2.status_code == 200:
                        summary = r2.json().get("result", {}) or {}
                        for pmid in summary.get("uids", []):
                            doc = summary.get(pmid) or {}
                            results.append({
                                "source": "pubmed",
                                "title": doc.get("title") or "",
                                "authors": [a.get("name", "") for a in (doc.get("authors") or [])],
                                "year": (doc.get("pubdate") or "")[:4],
                                "venue": doc.get("fulljournalname") or doc.get("source") or "",
                                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                            })
            except Exception as exc:
                log.warning(f"PubMed search failed: {exc}")

        return {"ok": True, "results": results[:16]}


    @router.post("/api/acad/activity/list")
    async def acad_activity_list(data: dict):
        """Owner-only: the 20 most recent activity entries for a class."""
        sid, _ = _resolve_token(data)
        code = sanitize_text(str(data.get("code", "")), 12).upper()
        _acad_require_owner(code, sid)
        items = sorted(db.coll_list("acad_activity", owner=code),
                       key=lambda a: a.get("ts", ""), reverse=True)
        return {"ok": True, "activity": items[:20]}


    return router
