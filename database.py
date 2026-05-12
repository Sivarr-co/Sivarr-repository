"""
Sivarr database layer — PostgreSQL via psycopg2.
Set DATABASE_URL to a Supabase (or any Postgres) connection string.
Tables are created automatically on startup.
Falls back silently to JSON file storage when DATABASE_URL is not set.
"""

import json
import logging
import os
import pathlib

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pgpool

log = logging.getLogger("sivarr")

_DATABASE_URL = os.environ.get("DATABASE_URL", "")
# Supabase and some providers use postgres:// — SQLAlchemy / psycopg2 need postgresql://
if _DATABASE_URL.startswith("postgres://"):
    _DATABASE_URL = _DATABASE_URL.replace("postgres://", "postgresql://", 1)

_pool: pgpool.SimpleConnectionPool | None = None


def is_available() -> bool:
    return bool(_DATABASE_URL)


def _get_pool() -> pgpool.SimpleConnectionPool | None:
    global _pool
    if _pool is not None:
        return _pool
    if not _DATABASE_URL:
        return None
    try:
        _pool = pgpool.SimpleConnectionPool(1, 10, _DATABASE_URL)
        log.info("DB connection pool ready")
    except Exception as exc:
        log.error(f"DB pool init failed: {exc}")
        _pool = None
    return _pool


def _get_conn():
    p = _get_pool()
    return p.getconn() if p else None


def _release(conn):
    p = _get_pool()
    if p and conn:
        p.putconn(conn)


# ── Schema ────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    sid           TEXT PRIMARY KEY,
    name          TEXT NOT NULL DEFAULT '',
    matric        TEXT NOT NULL DEFAULT '',
    email         TEXT          DEFAULT '',
    phone         TEXT          DEFAULT '',
    password_hash TEXT          DEFAULT '',
    created_at    TIMESTAMPTZ   DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_progress (
    sid        TEXT PRIMARY KEY REFERENCES users(sid) ON DELETE CASCADE,
    data       JSONB NOT NULL   DEFAULT '{}',
    updated_at TIMESTAMPTZ      DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    sid        TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ   DEFAULT NOW(),
    expires_at TIMESTAMPTZ   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_sid     ON user_sessions(sid);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS spaces (
    id         TEXT PRIMARY KEY,
    user_sid   TEXT REFERENCES users(sid) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    icon       TEXT DEFAULT '🧩',
    color      TEXT DEFAULT '#4f6ef7',
    space_type TEXT DEFAULT 'personal',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS space_data (
    space_id   TEXT NOT NULL,
    user_sid   TEXT NOT NULL REFERENCES users(sid) ON DELETE CASCADE,
    data       JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ    DEFAULT NOW(),
    PRIMARY KEY (space_id, user_sid)
);
CREATE INDEX IF NOT EXISTS idx_space_data_user ON space_data(user_sid);
"""


def init_db() -> bool:
    """Create tables if they don't exist. Returns True on success."""
    if not is_available():
        log.info("DATABASE_URL not set — running on JSON file storage")
        return False
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA)
        conn.commit()
        log.info("DB schema ready")
        return True
    except Exception as exc:
        log.error(f"DB schema init failed: {exc}")
        conn.rollback()
        return False
    finally:
        _release(conn)


# ── Users ─────────────────────────────────────────────────────────

def user_exists(sid: str) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM users WHERE sid = %s", (sid,))
            return cur.fetchone() is not None
    finally:
        _release(conn)


def get_user(sid: str) -> dict | None:
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sid, name, matric, email, phone, password_hash FROM users WHERE sid = %s",
                (sid,)
            )
            row = cur.fetchone()
        if not row:
            return None
        return {
            "sid": row[0], "name": row[1], "matric": row[2],
            "email": row[3], "phone": row[4], "password": row[5],
        }
    finally:
        _release(conn)


def create_user(user: dict) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO users (sid, name, matric, email, phone, password_hash)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (sid) DO NOTHING
            """, (
                user["sid"], user.get("name", ""), user.get("matric", ""),
                user.get("email", ""), user.get("phone", ""),
                user.get("password", ""),
            ))
        conn.commit()
    except Exception as exc:
        log.error(f"create_user failed [{user.get('sid')}]: {exc}")
        conn.rollback()
    finally:
        _release(conn)


# ── User Progress ──────────────────────────────────────────────────

def db_load_progress(sid: str) -> dict | None:
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM user_progress WHERE sid = %s", (sid,))
            row = cur.fetchone()
        if not row:
            return None
        return row[0] if isinstance(row[0], dict) else json.loads(row[0])
    finally:
        _release(conn)


def db_save_progress(sid: str, data: dict) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_progress (sid, data, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (sid) DO UPDATE SET
                    data       = EXCLUDED.data,
                    updated_at = NOW()
            """, (sid, json.dumps(data)))
        conn.commit()
    except Exception as exc:
        log.error(f"db_save_progress failed [{sid}]: {exc}")
        conn.rollback()
    finally:
        _release(conn)


# ── Sessions ──────────────────────────────────────────────────────

def create_db_session(token: str, sid: str, name: str, email: str, expires_at) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_sessions (token, sid, name, email, expires_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at
            """, (token, sid, name, email, expires_at))
        conn.commit()
    except Exception as exc:
        log.error(f"create_db_session failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def get_db_session(token: str) -> dict | None:
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT sid, name, email, expires_at FROM user_sessions
                WHERE token = %s AND expires_at > NOW()
            """, (token,))
            row = cur.fetchone()
        if not row:
            return None
        return {"sid": row[0], "name": row[1], "email": row[2], "expires_at": row[3]}
    finally:
        _release(conn)


def delete_db_session(token: str) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_sessions WHERE token = %s", (token,))
        conn.commit()
    finally:
        _release(conn)


def cleanup_db_sessions() -> int:
    """Delete expired sessions. Returns number removed."""
    conn = _get_conn()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_sessions WHERE expires_at <= NOW()")
            count = cur.rowcount
        conn.commit()
        if count:
            log.info(f"Cleaned up {count} expired sessions")
        return count
    except Exception as exc:
        log.error(f"cleanup_db_sessions failed: {exc}")
        conn.rollback()
        return 0
    finally:
        _release(conn)


def update_user(user: dict) -> None:
    """Update an existing user row (name, phone, etc.)."""
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE users SET name=%s, phone=%s
                WHERE sid=%s
            """, (user.get("name", ""), user.get("phone", ""), user["sid"]))
        conn.commit()
    except Exception as exc:
        log.error(f"update_user failed [{user.get('sid')}]: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def get_user_by_email(email: str) -> dict | None:
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sid, name, email, phone, password_hash FROM users WHERE email = %s",
                (email.lower().strip(),)
            )
            row = cur.fetchone()
        if not row:
            return None
        return {"sid": row[0], "name": row[1], "email": row[2], "phone": row[3], "password": row[4]}
    finally:
        _release(conn)


# ── Spaces ────────────────────────────────────────────────────────

def get_spaces(user_sid: str) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, icon, color, space_type FROM spaces "
                "WHERE user_sid = %s ORDER BY created_at",
                (user_sid,)
            )
            return [
                {"id": r[0], "name": r[1], "icon": r[2], "color": r[3], "type": r[4]}
                for r in cur.fetchall()
            ]
    finally:
        _release(conn)


def save_space(user_sid: str, space: dict) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO spaces (id, user_sid, name, icon, color, space_type)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name       = EXCLUDED.name,
                    icon       = EXCLUDED.icon,
                    color      = EXCLUDED.color,
                    space_type = EXCLUDED.space_type
            """, (
                space["id"], user_sid, space["name"],
                space.get("icon", "🧩"), space.get("color", "#4f6ef7"),
                space.get("type", "personal"),
            ))
        conn.commit()
    except Exception as exc:
        log.error(f"save_space failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def delete_space(user_sid: str, space_id: str) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM space_data WHERE space_id = %s AND user_sid = %s", (space_id, user_sid))
            cur.execute("DELETE FROM spaces WHERE id = %s AND user_sid = %s", (space_id, user_sid))
        conn.commit()
    finally:
        _release(conn)


# ── Space data ────────────────────────────────────────────────────

def get_all_spaces_with_data(user_sid: str) -> list:
    """Return all spaces for a user, each with its data blob."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.name, s.icon, s.color, s.space_type, sd.data
                FROM spaces s
                LEFT JOIN space_data sd
                       ON sd.space_id = s.id AND sd.user_sid = s.user_sid
                WHERE s.user_sid = %s
                ORDER BY s.created_at
            """, (user_sid,))
            return [
                {
                    "id": r[0], "name": r[1], "icon": r[2], "color": r[3],
                    "type": r[4], "data": (r[5] if isinstance(r[5], dict) else json.loads(r[5])) if r[5] else {}
                }
                for r in cur.fetchall()
            ]
    finally:
        _release(conn)


def save_space_data(user_sid: str, space_id: str, data: dict) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO space_data (space_id, user_sid, data, updated_at)
                VALUES (%s, %s, %s::jsonb, NOW())
                ON CONFLICT (space_id, user_sid) DO UPDATE SET
                    data       = EXCLUDED.data,
                    updated_at = NOW()
            """, (space_id, user_sid, json.dumps(data)))
        conn.commit()
    except Exception as exc:
        log.error(f"save_space_data failed [{space_id}]: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def get_space_data(user_sid: str, space_id: str) -> dict:
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT data FROM space_data WHERE space_id = %s AND user_sid = %s",
                (space_id, user_sid)
            )
            row = cur.fetchone()
        if not row:
            return {}
        return row[0] if isinstance(row[0], dict) else json.loads(row[0])
    finally:
        _release(conn)


# ── Admin queries ─────────────────────────────────────────────────

def get_all_spaces_admin() -> list:
    """All spaces across all users — for admin dashboard only."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.name, s.icon, s.space_type, s.user_sid,
                       u.name AS owner_name, u.email AS owner_email, s.created_at
                FROM spaces s
                LEFT JOIN users u ON u.sid = s.user_sid
                ORDER BY s.created_at DESC
            """)
            rows = cur.fetchall()
        return [
            {
                "id": r[0], "name": r[1], "icon": r[2], "type": r[3],
                "user_sid": r[4], "owner": r[5] or "Unknown",
                "owner_email": r[6] or "",
                "created_at": r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ]
    finally:
        _release(conn)


def get_all_sessions_admin() -> list:
    """All non-expired sessions — for admin dashboard only."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.token, s.sid, s.name, s.email, s.created_at, s.expires_at
                FROM user_sessions s
                WHERE s.expires_at > NOW()
                ORDER BY s.created_at DESC
            """)
            rows = cur.fetchall()
        return [
            {
                "token":      r[0][:12] + "…",
                "token_full": r[0],
                "sid":        r[1],
                "name":       r[2],
                "email":      r[3],
                "created_at": r[4].isoformat() if r[4] else None,
                "expires_at": r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ]
    finally:
        _release(conn)


def delete_user_cascade(sid: str) -> bool:
    """Delete a user and all associated data."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM space_data  WHERE user_sid = %s", (sid,))
            cur.execute("DELETE FROM spaces       WHERE user_sid = %s", (sid,))
            cur.execute("DELETE FROM user_sessions WHERE sid = %s", (sid,))
            cur.execute("DELETE FROM user_progress WHERE sid = %s", (sid,))
            cur.execute("DELETE FROM users         WHERE sid = %s", (sid,))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"delete_user_cascade failed [{sid}]: {exc}")
        conn.rollback()
        return False
    finally:
        _release(conn)


def get_platform_stats() -> dict:
    """Aggregate platform-wide stats for the admin overview."""
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users")
            total_users = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM spaces")
            total_spaces = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW()")
            active_sessions = cur.fetchone()[0]
            cur.execute("""
                SELECT COUNT(*), space_type FROM spaces GROUP BY space_type
            """)
            spaces_by_type = {r[1]: r[0] for r in cur.fetchall()}
        return {
            "total_users":     total_users,
            "total_spaces":    total_spaces,
            "active_sessions": active_sessions,
            "spaces_by_type":  spaces_by_type,
        }
    finally:
        _release(conn)


# ── One-time migration from JSON files ────────────────────────────

def migrate_from_json(users_path: str, data_dir: str) -> tuple[int, int]:
    """
    Import existing users.json and *_progress.json files into the DB.
    Uses ON CONFLICT DO NOTHING so it's safe to call on every startup.
    Returns (users_migrated, progress_migrated).
    """
    if not is_available():
        return 0, 0

    conn = _get_conn()
    if not conn:
        return 0, 0

    users_count = 0
    progress_count = 0

    try:
        with conn.cursor() as cur:
            # ── Users ──
            up = pathlib.Path(users_path)
            if up.exists():
                try:
                    users = json.loads(up.read_text())
                    for sid, u in users.items():
                        cur.execute("""
                            INSERT INTO users (sid, name, matric, email, phone, password_hash)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            ON CONFLICT (sid) DO NOTHING
                        """, (
                            u.get("sid", sid), u.get("name", ""), u.get("matric", ""),
                            u.get("email", ""), u.get("phone", ""), u.get("password", ""),
                        ))
                        users_count += 1
                except Exception as exc:
                    log.warning(f"User migration skipped: {exc}")

            # ── Progress ──
            for f in pathlib.Path(data_dir).glob("*_progress.json"):
                sid = f.stem.replace("_progress", "")
                try:
                    data = json.loads(f.read_text())
                except Exception:
                    continue
                # Ensure parent user row exists (FK requirement)
                cur.execute("""
                    INSERT INTO users (sid, name, matric)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (sid) DO NOTHING
                """, (sid, data.get("name", sid), data.get("matric", "")))
                cur.execute("""
                    INSERT INTO user_progress (sid, data)
                    VALUES (%s, %s::jsonb)
                    ON CONFLICT (sid) DO NOTHING
                """, (sid, json.dumps(data)))
                progress_count += 1

        conn.commit()
        if users_count or progress_count:
            log.info(f"JSON migration: {users_count} users, {progress_count} progress records imported")
    except Exception as exc:
        log.error(f"Migration failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)

    return users_count, progress_count
