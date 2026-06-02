"""
utils/storage.py — All JSON/DB read-write operations for user data.

Every function that persists or loads user data lives here.
Routes should import from this module — never read files directly.
"""

import json
import shutil
import datetime
import database as db
from pathlib import Path
from config import DATA_DIR, USERS_PATH, log

# ── Progress defaults (always merge on top of these) ─────────────
_PROGRESS_DEFAULTS = {
    "sessions": 0, "questions": 0, "topics": {},
    "quizzes": [], "wrong_answers": [], "chat_history": [],
    "difficulty": "medium", "name": "", "matric": "",
    "uploaded_files": [],
}


def _ppath(sid: str) -> Path:
    return DATA_DIR / f"{sid}_progress.json"


def _lpath() -> Path:
    return DATA_DIR / "learning_bank.json"


def _bpath() -> Path:
    return DATA_DIR / "question_bank.json"


# ── Atomic JSON write ────────────────────────────────────────────

def save_json(path: Path, data: dict) -> None:
    """Write JSON atomically — write to .tmp then rename."""
    tmp = str(path) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    shutil.move(tmp, str(path))


def load_json(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return {}
    return {}


# ── User progress ─────────────────────────────────────────────────

def load_progress(sid: str) -> dict:
    """Load user progress — DB first, JSON fallback."""
    if db.is_available():
        try:
            data = db.db_load_progress(sid)
            if data:
                return {**_PROGRESS_DEFAULTS, **data}
        except Exception as e:
            log.warning(f"DB load_progress fallback for {sid}: {e}")
    p = _ppath(sid)
    if p.exists():
        try:
            return {**_PROGRESS_DEFAULTS, **json.loads(p.read_text())}
        except Exception:
            pass
    return dict(_PROGRESS_DEFAULTS)


def save_progress(sid: str, p: dict) -> None:
    """Save user progress to DB + JSON backup."""
    if db.is_available():
        try:
            db.db_save_progress(sid, p)
        except Exception as e:
            log.warning(f"DB save_progress failed for {sid}: {e}")
    path = _ppath(sid)
    try:
        if path.exists():
            shutil.copy2(str(path), str(path).replace(".json", ".backup.json"))
        save_json(path, p)
    except Exception as e:
        log.warning(f"JSON save_progress failed for {sid}: {e}")


# ── Users ─────────────────────────────────────────────────────────

def load_users() -> dict:
    if USERS_PATH.exists():
        try:
            return json.loads(USERS_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_users(users: dict) -> None:
    tmp = str(USERS_PATH) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(users, f, indent=2)
    shutil.move(tmp, str(USERS_PATH))
    if db.is_available():
        for sid, u in users.items():
            try:
                if db.user_exists(sid):
                    db.update_user(u)
                else:
                    db.create_user(u)
            except Exception as e:
                log.warning(f"DB sync user {sid}: {e}")


def get_all_students() -> list:
    users = load_users()
    return [
        {"sid": u["sid"], "name": u.get("name",""), "email": u.get("email",""),
         "matric": u.get("matric",""), "phone": u.get("phone","")}
        for u in users.values() if u.get("role","student") == "student"
    ]


# ── Knowledge bank helpers ─────────────────────────────────────────

def get_cached(lib: dict, topic: str):
    e = lib.get(topic)
    if not e:
        return None
    if isinstance(e, str):
        return e
    from config import CACHE_EXPIRY
    age = (datetime.date.today() - datetime.date.fromisoformat(e.get("date","2000-01-01"))).days
    return e["answer"] if age <= CACHE_EXPIRY else None


def set_cached(lib: dict, topic: str, ans: str) -> None:
    lib[topic] = {"answer": ans, "date": str(datetime.date.today())}


def strip_topic(q: str) -> str:
    from config import TOPIC_STRIP
    q = q.lower().strip()
    for t in TOPIC_STRIP:
        if q.startswith(t):
            q = q[len(t):].strip()
    return q.strip("?").strip()


def build_memory(p: dict) -> str:
    topics = list(p.get("topics", {}).keys())[:10]
    wrongs = p.get("wrong_answers", [])[-3:]
    mem    = ""
    if topics:
        mem += f"Studied: {', '.join(topics)}. "
    if wrongs:
        mem += f"Weak: {', '.join(set(w.get('topic','') for w in wrongs))}."
    return mem.strip()


def add_history(p: dict, sid: str, role: str, msg: str) -> None:
    from config import HISTORY_LIMIT
    h = p.setdefault("chat_history", [])
    h.append({"role": role, "content": msg[:1500]})
    if len(h) > HISTORY_LIMIT:
        p["chat_history"] = h[-HISTORY_LIMIT:]


def weak_topics(p: dict) -> list:
    return list({w.get("topic","") for w in p.get("wrong_answers",[])})[:5]


# ── Goals ─────────────────────────────────────────────────────────

GOALS_PATH = DATA_DIR / "goals.json"


def load_goals(sid: str) -> list:
    p = load_progress(sid)
    return p.get("goals", [])


def save_goals(sid: str, goals: list) -> None:
    p = load_progress(sid)
    p["goals"] = goals
    save_progress(sid, p)


# ── Classes ───────────────────────────────────────────────────────

from config import CLASSES_PATH
import random, string


def load_classes() -> dict:
    if CLASSES_PATH.exists():
        try:
            return json.loads(CLASSES_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_classes(classes: dict) -> None:
    save_json(CLASSES_PATH, classes)


def generate_class_code() -> str:
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if code not in load_classes():
            return code


def get_student_classes(sid: str) -> list:
    classes = load_classes()
    return [c for c in classes.values() if sid in c.get("members", [])]


# ── Study groups ──────────────────────────────────────────────────

GROUPS_PATH = DATA_DIR / "study_groups.json"


def load_groups() -> dict:
    if GROUPS_PATH.exists():
        try:
            return json.loads(GROUPS_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_groups(groups: dict) -> None:
    save_json(GROUPS_PATH, groups)


# ── Exam results ──────────────────────────────────────────────────

EXAM_RESULTS_PATH   = DATA_DIR / "exam_results.json"
EXAM_SESSIONS_PATH  = DATA_DIR / "exam_sessions.json"


def load_exam_results() -> list:
    return json.loads(EXAM_RESULTS_PATH.read_text()) if EXAM_RESULTS_PATH.exists() else []


def save_exam_results(results: list) -> None:
    save_json(EXAM_RESULTS_PATH, results)


def load_exam_sessions() -> dict:
    return json.loads(EXAM_SESSIONS_PATH.read_text()) if EXAM_SESSIONS_PATH.exists() else {}


def save_exam_sessions(sessions: dict) -> None:
    save_json(EXAM_SESSIONS_PATH, sessions)
