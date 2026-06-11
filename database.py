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
import time
import traceback
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pgpool

log = logging.getLogger("sivarr")

SLOW_QUERY_MS = 200  # log any DB function that takes longer than this

@contextmanager
def _timed(label: str):
    """Context manager — logs a warning when a DB call exceeds SLOW_QUERY_MS."""
    t = time.monotonic()
    yield
    ms = (time.monotonic() - t) * 1000
    if ms > SLOW_QUERY_MS:
        log.warning(f"SLOW_QUERY [{ms:.0f}ms] {label}")

_DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
# Railway sometimes prepends the word "railway" to the URL value (e.g. "railwaypostgresql://...")
# Strip it so psycopg2 receives a valid "postgresql://" URL.
if _DATABASE_URL.startswith("railway") and "://" in _DATABASE_URL:
    _DATABASE_URL = _DATABASE_URL[len("railway"):]
# Supabase and some providers use postgres:// — psycopg2 needs postgresql://
if _DATABASE_URL.startswith("postgres://"):
    _DATABASE_URL = _DATABASE_URL.replace("postgres://", "postgresql://", 1)

_pool: pgpool.SimpleConnectionPool | None = None


def is_available() -> bool:
    return bool(_DATABASE_URL)


_pool_error: str = ""   # stores the last pool creation failure reason


def _get_pool() -> pgpool.SimpleConnectionPool | None:
    global _pool, _pool_error
    if _pool is not None:
        return _pool
    if not _DATABASE_URL:
        return None
    # Try plain URL first, then with sslmode=require (needed on some Railway configs)
    sep = "&" if "?" in _DATABASE_URL else "?"
    variants = [_DATABASE_URL]
    if "sslmode=" not in _DATABASE_URL:
        variants.append(_DATABASE_URL + sep + "sslmode=require")
        variants.append(_DATABASE_URL + sep + "sslmode=disable")
    for url in variants:
        try:
            _pool = pgpool.SimpleConnectionPool(1, 5, url, connect_timeout=10)
            _pool_error = ""
            log.info(f"DB connection pool ready (variant: {'plain' if url == _DATABASE_URL else url.split(sep)[-1]})")
            return _pool
        except Exception as exc:
            _pool_error = str(exc)
            log.error(f"DB pool init failed [{url.split(sep)[-1] if sep in url else 'plain'}]: {exc}")
            _pool = None
    return _pool


def _get_conn():
    global _pool
    p = _get_pool()
    if not p:
        return None
    last_exc = None
    for attempt in range(3):
        try:
            return p.getconn()
        except pgpool.PoolError as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(0.05 * (2 ** attempt))  # 50 ms → 100 ms
                log.warning(f"DB pool exhausted (attempt {attempt + 1}/3) — retrying")
        except Exception as exc:
            log.error(f"_get_conn: {exc}")
            return None
    log.error(f"_get_conn: pool exhausted after 3 attempts: {last_exc}")
    return None


def _release(conn):
    p = _get_pool()
    if not p or not conn:
        return
    try:
        if not conn.closed:
            conn.rollback()
    except Exception:
        try: p.putconn(conn, close=True)
        except Exception: pass
        return
    p.putconn(conn)


def db_test() -> dict:
    """Return diagnostics: pool state + a live SELECT 1."""
    result = {
        "pool": _pool is not None,
        "db_url_set": bool(_DATABASE_URL),
        "pool_error": _pool_error or None,
        "ping": False,
        "error": None,
    }

    # If pool is broken, try a raw direct connect to surface the real error
    if not _pool and _DATABASE_URL:
        sep = "&" if "?" in _DATABASE_URL else "?"
        for label, url in [
            ("plain", _DATABASE_URL),
            ("sslmode=require", _DATABASE_URL + sep + "sslmode=require"),
            ("sslmode=disable", _DATABASE_URL + sep + "sslmode=disable"),
        ]:
            try:
                import psycopg2 as _pg
                c = _pg.connect(url, connect_timeout=8)
                c.cursor().execute("SELECT 1")
                c.close()
                result[f"direct_{label}"] = "OK"
                result["error"] = f"direct connect works with {label} but pool failed"
            except Exception as e:
                result[f"direct_{label}"] = str(e)

    conn = _get_conn()
    if not conn:
        if not result["error"]:
            result["error"] = result["pool_error"] or "could not get connection from pool"
        return result
    try:
        t0 = time.monotonic()
        conn.cursor().execute("SELECT 1")
        conn.rollback()
        result["ping"] = True
        result["latency_ms"] = round((time.monotonic() - t0) * 1000, 1)
    except Exception as exc:
        result["error"] = str(exc)
    finally:
        _release(conn)
    return result


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
CREATE INDEX IF NOT EXISTS idx_spaces_user ON spaces(user_sid);

CREATE TABLE IF NOT EXISTS space_data (
    space_id   TEXT NOT NULL,
    user_sid   TEXT NOT NULL REFERENCES users(sid) ON DELETE CASCADE,
    data       JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ    DEFAULT NOW(),
    PRIMARY KEY (space_id, user_sid)
);
CREATE INDEX IF NOT EXISTS idx_space_data_user ON space_data(user_sid);

-- ── Agents Marketplace ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
    id                TEXT PRIMARY KEY,
    user_sid          TEXT REFERENCES users(sid) ON DELETE CASCADE,
    display_name      TEXT NOT NULL DEFAULT '',
    bio               TEXT DEFAULT '',
    speciality        JSONB DEFAULT '[]',
    profile_photo_url TEXT,
    stripe_account_id TEXT,
    status            TEXT DEFAULT 'applied',
    verified          BOOLEAN DEFAULT false,
    follower_count    INTEGER DEFAULT 0,
    total_downloads   INTEGER DEFAULT 0,
    avg_rating        NUMERIC(3,2) DEFAULT 0.0,
    pending_earnings  NUMERIC(10,2) DEFAULT 0.0,
    total_earned      NUMERIC(10,2) DEFAULT 0.0,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_user   ON agents(user_sid);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

CREATE TABLE IF NOT EXISTS agent_templates (
    id                TEXT PRIMARY KEY,
    agent_id          TEXT REFERENCES agents(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    short_description TEXT DEFAULT '',
    full_description  TEXT DEFAULT '',
    category          TEXT NOT NULL DEFAULT 'workspace',
    tags              JSONB DEFAULT '[]',
    thumbnail_color   TEXT DEFAULT '#4f6ef7',
    price             NUMERIC(8,2) DEFAULT 0.00,
    price_ngn         NUMERIC(10,2),
    contents          JSONB NOT NULL DEFAULT '{}',
    included_items    JSONB DEFAULT '[]',
    status            TEXT DEFAULT 'draft',
    download_count    INTEGER DEFAULT 0,
    avg_rating        NUMERIC(3,2) DEFAULT 0.0,
    review_count      INTEGER DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_tpl_agent  ON agent_templates(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tpl_status ON agent_templates(status);

CREATE TABLE IF NOT EXISTS template_downloads (
    id                TEXT PRIMARY KEY,
    template_id       TEXT REFERENCES agent_templates(id),
    buyer_sid         TEXT REFERENCES users(sid),
    agent_id          TEXT REFERENCES agents(id),
    gross_amount      NUMERIC(8,2) DEFAULT 0.00,
    sivarr_fee        NUMERIC(8,2) DEFAULT 0.00,
    agent_earnings    NUMERIC(8,2) DEFAULT 0.00,
    stripe_session_id TEXT,
    status            TEXT DEFAULT 'completed',
    downloaded_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dl_buyer    ON template_downloads(buyer_sid);
CREATE INDEX IF NOT EXISTS idx_dl_template ON template_downloads(template_id);

CREATE TABLE IF NOT EXISTS template_reviews (
    id           TEXT PRIMARY KEY,
    template_id  TEXT REFERENCES agent_templates(id),
    reviewer_sid TEXT REFERENCES users(sid),
    rating       INTEGER CHECK (rating BETWEEN 1 AND 5),
    review_text  TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(template_id, reviewer_sid)
);

CREATE TABLE IF NOT EXISTS agent_follows (
    follower_sid TEXT REFERENCES users(sid),
    agent_id     TEXT REFERENCES agents(id),
    followed_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (follower_sid, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_follows_agent ON agent_follows(agent_id);

CREATE TABLE IF NOT EXISTS agent_payouts (
    id                 TEXT PRIMARY KEY,
    agent_id           TEXT REFERENCES agents(id),
    amount             NUMERIC(10,2) NOT NULL,
    stripe_transfer_id TEXT,
    status             TEXT DEFAULT 'pending',
    period_month       INTEGER,
    period_year        INTEGER,
    paid_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_payouts_agent ON agent_payouts(agent_id);

-- ── Migrations for existing installs ──────────────────────────
ALTER TABLE agent_templates ADD COLUMN IF NOT EXISTS price_ngn NUMERIC(10,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token      TEXT PRIMARY KEY,
    sid        TEXT NOT NULL,
    email      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS email_verify_tokens (
    token      TEXT PRIMARY KEY,
    sid        TEXT NOT NULL,
    email      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS feedback (
    id         SERIAL PRIMARY KEY,
    sid        TEXT NOT NULL,
    rating     SMALLINT,
    text       TEXT NOT NULL,
    page       TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Multi-user Organisations ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS orgs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_sid   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    logo        TEXT DEFAULT '',
    description TEXT DEFAULT '',
    plan        TEXT DEFAULT 'free',
    settings    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs(owner_sid);

CREATE TABLE IF NOT EXISTS org_members (
    id          SERIAL PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_sid    TEXT NOT NULL REFERENCES users(sid) ON DELETE CASCADE,
    role        TEXT DEFAULT 'member',
    invited_by  TEXT,
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, user_sid)
);
CREATE INDEX IF NOT EXISTS idx_org_members_org  ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_sid);

CREATE TABLE IF NOT EXISTS org_invites (
    token       TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    role        TEXT DEFAULT 'member',
    invited_by  TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org   ON org_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(email);

CREATE TABLE IF NOT EXISTS org_tasks (
    id           TEXT PRIMARY KEY,
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    status       TEXT DEFAULT 'todo',
    priority     TEXT DEFAULT 'normal',
    assignee_sid TEXT REFERENCES users(sid) ON DELETE SET NULL,
    created_by   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    project_id   TEXT,
    due_date     DATE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_tasks_org      ON org_tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_org_tasks_project  ON org_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_org_tasks_assignee ON org_tasks(assignee_sid);

CREATE TABLE IF NOT EXISTS org_projects (
    id           TEXT PRIMARY KEY,
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    status       TEXT DEFAULT 'active',
    color        TEXT DEFAULT '#0D7A5F',
    created_by   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_projects_org ON org_projects(org_id);

CREATE TABLE IF NOT EXISTS org_docs (
    id           TEXT PRIMARY KEY,
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    content      TEXT DEFAULT '',
    created_by   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    updated_by   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_docs_org ON org_docs(org_id);

CREATE TABLE IF NOT EXISTS org_messages (
    id           SERIAL PRIMARY KEY,
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    channel      TEXT DEFAULT 'general',
    content      TEXT NOT NULL,
    author_sid   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    author_name  TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_messages_org     ON org_messages(org_id);
CREATE INDEX IF NOT EXISTS idx_org_messages_channel ON org_messages(org_id, channel);

CREATE TABLE IF NOT EXISTS org_goals (
    id           TEXT PRIMARY KEY,
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    type         TEXT DEFAULT 'okr',
    status       TEXT DEFAULT 'active',
    owner_sid    TEXT REFERENCES users(sid) ON DELETE SET NULL,
    due_date     DATE,
    progress     INTEGER DEFAULT 0,
    created_by   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_goals_org ON org_goals(org_id);

CREATE TABLE IF NOT EXISTS org_key_results (
    id            TEXT PRIMARY KEY,
    goal_id       TEXT NOT NULL REFERENCES org_goals(id) ON DELETE CASCADE,
    org_id        TEXT NOT NULL,
    title         TEXT NOT NULL,
    target_value  FLOAT DEFAULT 100,
    current_value FLOAT DEFAULT 0,
    unit          TEXT DEFAULT '%',
    status        TEXT DEFAULT 'active',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_kr_goal ON org_key_results(goal_id);
CREATE INDEX IF NOT EXISTS idx_org_kr_org  ON org_key_results(org_id);

CREATE TABLE IF NOT EXISTS org_founder (
    org_id        TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    burn_rate     FLOAT DEFAULT 0,
    cash_balance  FLOAT DEFAULT 0,
    mrr           FLOAT DEFAULT 0,
    arr           FLOAT DEFAULT 0,
    funding_stage TEXT DEFAULT 'pre-seed',
    total_raised  FLOAT DEFAULT 0,
    investors     JSONB DEFAULT '[]',
    milestones    JSONB DEFAULT '[]',
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_announcements (
    id           TEXT PRIMARY KEY,
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    author_sid   TEXT REFERENCES users(sid) ON DELETE SET NULL,
    author_name  TEXT NOT NULL DEFAULT '',
    pinned       BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_ann_org ON org_announcements(org_id);

CREATE TABLE IF NOT EXISTS org_integrations (
    org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    secret_key  TEXT NOT NULL DEFAULT '',
    public_key  TEXT NOT NULL DEFAULT '',
    meta        JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (org_id, provider)
);

-- Multi-worker rate limiting: one row per request hit, pruned by window
CREATE TABLE IF NOT EXISTS rate_limit_hits (
    key  TEXT        NOT NULL,
    ts   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_hits_key_ts ON rate_limit_hits(key, ts);

-- Multi-worker presence: upserted on each heartbeat ping
CREATE TABLE IF NOT EXISTS user_presence (
    sid       TEXT        NOT NULL,
    org_id    TEXT        NOT NULL,
    name      TEXT        NOT NULL DEFAULT '',
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sid, org_id)
);
CREATE INDEX IF NOT EXISTS idx_presence_org_seen ON user_presence(org_id, last_seen);

-- Short-lived one-time codes for Google OAuth token exchange (multi-worker safe)
CREATE TABLE IF NOT EXISTS google_exchange_codes (
    code       TEXT PRIMARY KEY,
    token      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS user_blobs (
    sid        TEXT NOT NULL,
    key        TEXT NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (sid, key)
);

CREATE TABLE IF NOT EXISTS community_posts (
    id          TEXT PRIMARY KEY,
    author_name TEXT NOT NULL DEFAULT 'Sivarr User',
    author_sid  TEXT,
    body        TEXT NOT NULL,
    category    TEXT DEFAULT 'general',
    tags        JSONB DEFAULT '[]',
    likes       JSONB DEFAULT '[]',
    replies     JSONB DEFAULT '[]',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comm_posts_created  ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_posts_category ON community_posts(category);

CREATE TABLE IF NOT EXISTS opportunities (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    link         TEXT DEFAULT '',
    category     TEXT DEFAULT 'other',
    organisation TEXT DEFAULT '',
    location     TEXT DEFAULT '',
    deadline     TEXT DEFAULT '',
    submitted_by TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opps_created  ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opps_category ON opportunities(category);
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
    with _timed("get_db_session"):
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


# ── Password Reset & Email Verification Tokens ───────────────────

# In-memory fallback when DB is not available (tokens survive until server restart)
_reset_tokens_mem:  dict = {}
_verify_tokens_mem: dict = {}


def create_reset_token(sid: str, email: str) -> str:
    import secrets, datetime
    token   = secrets.token_urlsafe(32)
    expires = datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    _reset_tokens_mem[token] = {"sid": sid, "email": email, "expires": expires, "used": False}
    conn = _get_conn()
    if not conn:
        return token
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO password_reset_tokens (token, sid, email, expires_at, used) "
                "VALUES (%s, %s, %s, %s, FALSE)",
                (token, sid, email, expires)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"create_reset_token failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)
    return token


def get_reset_token(token: str) -> dict | None:
    import datetime
    # In-memory first
    entry = _reset_tokens_mem.get(token)
    if entry and not entry["used"] and datetime.datetime.utcnow() < entry["expires"]:
        return entry
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sid, email, expires_at, used FROM password_reset_tokens WHERE token = %s",
                (token,)
            )
            row = cur.fetchone()
        if not row:
            return None
        sid, email, expires_at, used = row
        if used or datetime.datetime.utcnow() > expires_at.replace(tzinfo=None):
            return None
        return {"sid": sid, "email": email, "expires": expires_at}
    finally:
        _release(conn)


def mark_reset_token_used(token: str) -> None:
    if token in _reset_tokens_mem:
        _reset_tokens_mem[token]["used"] = True
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE password_reset_tokens SET used = TRUE WHERE token = %s", (token,))
        conn.commit()
    except Exception as exc:
        log.error(f"mark_reset_token_used failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def create_email_verify_token(sid: str, email: str) -> str:
    import secrets, datetime
    token   = secrets.token_urlsafe(32)
    expires = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    _verify_tokens_mem[token] = {"sid": sid, "email": email, "expires": expires, "used": False}
    conn = _get_conn()
    if not conn:
        return token
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO email_verify_tokens (token, sid, email, expires_at, used) "
                "VALUES (%s, %s, %s, %s, FALSE)",
                (token, sid, email, expires)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"create_email_verify_token failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)
    return token


def get_email_verify_token(token: str) -> dict | None:
    import datetime
    entry = _verify_tokens_mem.get(token)
    if entry and not entry["used"] and datetime.datetime.utcnow() < entry["expires"]:
        return entry
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sid, email, expires_at, used FROM email_verify_tokens WHERE token = %s",
                (token,)
            )
            row = cur.fetchone()
        if not row:
            return None
        sid, email, expires_at, used = row
        if used or datetime.datetime.utcnow() > expires_at.replace(tzinfo=None):
            return None
        return {"sid": sid, "email": email}
    finally:
        _release(conn)


def mark_email_verified(sid: str) -> None:
    # Update in-memory verify token entries
    for entry in _verify_tokens_mem.values():
        if entry.get("sid") == sid:
            entry["used"] = True
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET email_verified = TRUE WHERE sid = %s", (sid,))
            cur.execute("UPDATE email_verify_tokens SET used = TRUE WHERE sid = %s", (sid,))
        conn.commit()
    except Exception as exc:
        log.error(f"mark_email_verified failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def is_email_verified(sid: str) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT email_verified FROM users WHERE sid = %s", (sid,))
            row = cur.fetchone()
        return bool(row and row[0])
    finally:
        _release(conn)


# ── Google OAuth exchange codes (multi-worker safe) ────────────────

def create_google_xcode(code: str, token: str) -> None:
    """Store a 10-minute one-time code that maps to a Sivarr session token."""
    import datetime
    conn = _get_conn()
    if not conn:
        raise RuntimeError("DB unavailable")
    expires = datetime.datetime.utcnow() + datetime.timedelta(seconds=600)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO google_exchange_codes (code, token, expires_at) VALUES (%s, %s, %s)",
                (code, token, expires)
            )
            # Also prune expired codes
            cur.execute("DELETE FROM google_exchange_codes WHERE expires_at < NOW()")
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise exc
    finally:
        _release(conn)


def pop_google_xcode(code: str) -> str | None:
    """Retrieve and delete a one-time exchange code. Returns the token or None."""
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT token FROM google_exchange_codes WHERE code = %s AND expires_at > NOW()",
                (code,)
            )
            row = cur.fetchone()
            if not row:
                return None
            cur.execute("DELETE FROM google_exchange_codes WHERE code = %s", (code,))
        conn.commit()
        return row[0]
    except Exception as exc:
        log.error(f"pop_google_xcode failed: {exc}")
        conn.rollback()
        return None
    finally:
        _release(conn)


def update_user_password(sid: str, hashed_pw: str) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET password_hash = %s WHERE sid = %s",
                (hashed_pw, sid)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"update_user_password failed: {exc}")
        conn.rollback()
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


# ═══════════════════════════════════════════════════════════════
#  AGENTS MARKETPLACE
# ═══════════════════════════════════════════════════════════════

def _row_to_agent(row) -> dict:
    if not row:
        return {}
    keys = ["id","user_sid","display_name","bio","speciality","profile_photo_url",
            "stripe_account_id","status","verified","follower_count","total_downloads",
            "avg_rating","pending_earnings","total_earned","created_at"]
    d = dict(zip(keys, row))
    d["speciality"] = d.get("speciality") or []
    d["avg_rating"] = float(d.get("avg_rating") or 0)
    d["pending_earnings"] = float(d.get("pending_earnings") or 0)
    d["total_earned"] = float(d.get("total_earned") or 0)
    if d.get("created_at"):
        d["created_at"] = str(d["created_at"])
    return d


def _row_to_template(row) -> dict:
    if not row:
        return {}
    keys = ["id","agent_id","name","short_description","full_description","category",
            "tags","thumbnail_color","price","price_ngn","contents","included_items","status",
            "download_count","avg_rating","review_count","created_at","updated_at"]
    d = dict(zip(keys, row))
    d["tags"] = d.get("tags") or []
    d["contents"] = d.get("contents") or {}
    d["included_items"] = d.get("included_items") or []
    d["price"] = float(d.get("price") or 0)
    d["price_ngn"] = float(d["price_ngn"]) if d.get("price_ngn") is not None else None
    d["avg_rating"] = float(d.get("avg_rating") or 0)
    for k in ("created_at","updated_at"):
        if d.get(k):
            d[k] = str(d[k])
    return d


# ── Agents ────────────────────────────────────────────────────

def get_agent_by_user(user_sid: str) -> dict:
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM agents WHERE user_sid = %s LIMIT 1", (user_sid,))
            return _row_to_agent(cur.fetchone())
    finally:
        _release(conn)


def get_agent_by_id(agent_id: str) -> dict:
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM agents WHERE id = %s LIMIT 1", (agent_id,))
            return _row_to_agent(cur.fetchone())
    finally:
        _release(conn)


def create_agent(agent: dict) -> dict:
    conn = _get_conn()
    if not conn:
        return agent
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO agents (id, user_sid, display_name, bio, speciality,
                    stripe_account_id, status)
                VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                agent["id"], agent["user_sid"], agent["display_name"],
                agent.get("bio",""), json.dumps(agent.get("speciality",[])),
                agent.get("stripe_account_id"), agent.get("status","applied"),
            ))
        conn.commit()
    except Exception as exc:
        log.error(f"create_agent: {exc}"); conn.rollback()
    finally:
        _release(conn)
    return agent


def update_agent(agent_id: str, fields: dict) -> bool:
    allowed = {"display_name","bio","speciality","profile_photo_url",
               "stripe_account_id","status","verified"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "speciality":
            sets.append(f"{k} = %s::jsonb")
            vals.append(json.dumps(v))
        else:
            sets.append(f"{k} = %s")
            vals.append(v)
    if not sets:
        return False
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE agents SET {', '.join(sets)} WHERE id = %s",
                vals + [agent_id]
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"update_agent: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_all_agents(sort: str = "downloads") -> list:
    conn = _get_conn()
    if not conn:
        return []
    order = {
        "downloads": "total_downloads DESC",
        "rating":    "avg_rating DESC",
        "newest":    "created_at DESC",
    }.get(sort, "total_downloads DESC")
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT * FROM agents WHERE status = 'active' ORDER BY {order} LIMIT 100"
            )
            return [_row_to_agent(r) for r in cur.fetchall()]
    finally:
        _release(conn)


# ── Templates ─────────────────────────────────────────────────

def get_templates(category: str = None, sort: str = "popular",
                  free_only: bool = False, limit: int = 60) -> list:
    """Fetch published templates with agent info in a single JOIN — no N+1."""
    conn = _get_conn()
    if not conn:
        return []
    wheres = ["at.status = 'published'"]
    vals = []
    if category and category != "all":
        wheres.append("at.category = %s")
        vals.append(category)
    if free_only:
        wheres.append("at.price = 0")
    order = {
        "popular": "at.download_count DESC",
        "newest":  "at.created_at DESC",
        "rating":  "at.avg_rating DESC",
        "price":   "at.price ASC",
    }.get(sort, "at.download_count DESC")
    where_clause = " AND ".join(wheres)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""SELECT at.*,
                           COALESCE(a.display_name, '') AS agent_name,
                           COALESCE(a.verified, FALSE)  AS agent_verified
                    FROM agent_templates at
                    LEFT JOIN agents a ON a.id = at.agent_id
                    WHERE {where_clause}
                    ORDER BY {order}
                    LIMIT %s""",
                vals + [limit]
            )
            rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            r.setdefault("tags", [])
            r.setdefault("contents", {})
            r.setdefault("included_items", [])
            r["price"]      = float(r.get("price") or 0)
            r["price_ngn"]  = float(r["price_ngn"]) if r.get("price_ngn") is not None else None
            r["avg_rating"] = float(r.get("avg_rating") or 0)
            for k in ("created_at", "updated_at"):
                if r.get(k):
                    r[k] = str(r[k])
        return rows
    finally:
        _release(conn)


def get_template_by_id(template_id: str) -> dict:
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM agent_templates WHERE id = %s LIMIT 1", (template_id,))
            return _row_to_template(cur.fetchone())
    finally:
        _release(conn)


def get_featured_template() -> dict:
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT at.*, a.display_name as agent_name, a.verified as agent_verified
                FROM agent_templates at
                JOIN agents a ON a.id = at.agent_id
                WHERE at.status = 'published'
                ORDER BY at.download_count DESC LIMIT 1
            """)
            row = cur.fetchone()
            if not row:
                return {}
            cols = [desc[0] for desc in cur.description]
            return dict(zip(cols, row))
    finally:
        _release(conn)


def get_agent_templates(agent_id: str, include_drafts: bool = False) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            if include_drafts:
                cur.execute(
                    "SELECT * FROM agent_templates WHERE agent_id = %s ORDER BY created_at DESC",
                    (agent_id,)
                )
            else:
                cur.execute(
                    "SELECT * FROM agent_templates WHERE agent_id=%s AND status='published' ORDER BY created_at DESC",
                    (agent_id,)
                )
            return [_row_to_template(r) for r in cur.fetchall()]
    finally:
        _release(conn)


def create_template(tpl: dict) -> dict:
    conn = _get_conn()
    if not conn:
        return tpl
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO agent_templates
                    (id, agent_id, name, short_description, full_description, category,
                     tags, thumbnail_color, price, price_ngn, contents, included_items, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s::jsonb,%s::jsonb,%s)
            """, (
                tpl["id"], tpl["agent_id"], tpl["name"],
                tpl.get("short_description",""), tpl.get("full_description",""),
                tpl.get("category","workspace"),
                json.dumps(tpl.get("tags",[])),
                tpl.get("thumbnail_color","#4f6ef7"),
                tpl.get("price",0),
                tpl.get("price_ngn"),  # None = auto-calculated client-side
                json.dumps(tpl.get("contents",{})),
                json.dumps(tpl.get("included_items",[])),
                tpl.get("status","draft"),
            ))
        conn.commit()
    except Exception as exc:
        log.error(f"create_template: {exc}"); conn.rollback()
    finally:
        _release(conn)
    return tpl


def update_template(template_id: str, agent_id: str, fields: dict) -> bool:
    allowed = {"name","short_description","full_description","category","tags",
               "thumbnail_color","price","price_ngn","contents","included_items","status"}
    json_cols = {"tags","contents","included_items"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k in json_cols:
            sets.append(f"{k} = %s::jsonb")
            vals.append(json.dumps(v))
        else:
            sets.append(f"{k} = %s")
            vals.append(v)
    if not sets:
        return False
    sets.append("updated_at = NOW()")
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE agent_templates SET {', '.join(sets)} WHERE id=%s AND agent_id=%s",
                vals + [template_id, agent_id]
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"update_template: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def delete_template(template_id: str, agent_id: str) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM agent_templates WHERE id=%s AND agent_id=%s",
                (template_id, agent_id)
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"delete_template: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


# ── Downloads ─────────────────────────────────────────────────

def check_download(buyer_sid: str, template_id: str) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM template_downloads WHERE buyer_sid=%s AND template_id=%s LIMIT 1",
                (buyer_sid, template_id)
            )
            return cur.fetchone() is not None
    finally:
        _release(conn)


def record_download(dl: dict) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO template_downloads
                    (id, template_id, buyer_sid, agent_id, gross_amount, sivarr_fee,
                     agent_earnings, stripe_session_id, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT DO NOTHING
            """, (
                dl["id"], dl["template_id"], dl["buyer_sid"], dl["agent_id"],
                dl.get("gross_amount",0), dl.get("sivarr_fee",0), dl.get("agent_earnings",0),
                dl.get("stripe_session_id"), dl.get("status","completed"),
            ))
            # Increment download_count on the template
            cur.execute(
                "UPDATE agent_templates SET download_count = download_count + 1 WHERE id = %s",
                (dl["template_id"],)
            )
            # Increment total_downloads on the agent
            cur.execute(
                "UPDATE agents SET total_downloads = total_downloads + 1 WHERE id = %s",
                (dl["agent_id"],)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"record_download: {exc}"); conn.rollback()
    finally:
        _release(conn)


def check_payment_reference(reference: str) -> bool:
    """Return True if this payment reference was already processed."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM template_downloads WHERE stripe_session_id = %s LIMIT 1",
                (reference,)
            )
            return cur.fetchone() is not None
    finally:
        _release(conn)


def add_agent_earnings(agent_id: str, amount: float) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE agents
                SET pending_earnings = pending_earnings + %s,
                    total_earned     = total_earned + %s
                WHERE id = %s
            """, (amount, amount, agent_id))
        conn.commit()
    except Exception as exc:
        log.error(f"add_agent_earnings: {exc}"); conn.rollback()
    finally:
        _release(conn)


def get_agent_earnings(agent_id: str) -> dict:
    """Monthly earnings breakdown per template."""
    conn = _get_conn()
    if not conn:
        return {"monthly": [], "by_template": []}
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DATE_TRUNC('month', downloaded_at) as month,
                       COUNT(*) as downloads,
                       SUM(gross_amount) as gross,
                       SUM(sivarr_fee) as fee,
                       SUM(agent_earnings) as net
                FROM template_downloads
                WHERE agent_id = %s AND status = 'completed'
                GROUP BY 1 ORDER BY 1 DESC LIMIT 12
            """, (agent_id,))
            monthly = []
            for r in cur.fetchall():
                monthly.append({
                    "month": str(r[0])[:7] if r[0] else "",
                    "downloads": r[1], "gross": float(r[2] or 0),
                    "fee": float(r[3] or 0), "net": float(r[4] or 0),
                })
            cur.execute("""
                SELECT t.id, t.name, COUNT(*) as downloads,
                       SUM(d.agent_earnings) as net
                FROM template_downloads d
                JOIN agent_templates t ON t.id = d.template_id
                WHERE d.agent_id = %s AND d.status = 'completed'
                GROUP BY t.id, t.name ORDER BY net DESC
            """, (agent_id,))
            by_tpl = [{"id": r[0], "name": r[1],
                       "downloads": r[2], "net": float(r[3] or 0)}
                      for r in cur.fetchall()]
        return {"monthly": monthly, "by_template": by_tpl}
    finally:
        _release(conn)


def get_payouts(agent_id: str) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id,amount,stripe_transfer_id,status,period_month,period_year,paid_at,created_at "
                "FROM agent_payouts WHERE agent_id=%s ORDER BY created_at DESC LIMIT 24",
                (agent_id,)
            )
            cols = ["id","amount","stripe_transfer_id","status",
                    "period_month","period_year","paid_at","created_at"]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        _release(conn)


# ── Reviews ───────────────────────────────────────────────────

def add_review(review: dict) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO template_reviews (id, template_id, reviewer_sid, rating, review_text)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (template_id, reviewer_sid) DO UPDATE
                SET rating=EXCLUDED.rating, review_text=EXCLUDED.review_text
            """, (review["id"], review["template_id"], review["reviewer_sid"],
                  review["rating"], review.get("review_text","")))
            # Recompute avg_rating + review_count on the template
            cur.execute("""
                UPDATE agent_templates SET
                    avg_rating   = (SELECT AVG(rating) FROM template_reviews WHERE template_id=%s),
                    review_count = (SELECT COUNT(*) FROM template_reviews WHERE template_id=%s)
                WHERE id = %s
            """, (review["template_id"], review["template_id"], review["template_id"]))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"add_review: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_template_reviews(template_id: str, limit: int = 10) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.id, r.rating, r.review_text, r.created_at,
                       u.name as reviewer_name
                FROM template_reviews r
                JOIN users u ON u.sid = r.reviewer_sid
                WHERE r.template_id = %s
                ORDER BY r.created_at DESC LIMIT %s
            """, (template_id, limit))
            cols = ["id","rating","review_text","created_at","reviewer_name"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                # Anonymise: first name + last initial
                parts = (d.get("reviewer_name") or "").split()
                if len(parts) >= 2:
                    d["reviewer_name"] = f"{parts[0]} {parts[-1][0]}."
                d["created_at"] = str(d["created_at"])
                rows.append(d)
            return rows
    finally:
        _release(conn)


def get_agent_reviews(agent_id: str) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT r.id, r.rating, r.review_text, r.created_at,
                       u.name as reviewer_name, t.name as template_name
                FROM template_reviews r
                JOIN users u ON u.sid = r.reviewer_sid
                JOIN agent_templates t ON t.id = r.template_id
                WHERE t.agent_id = %s
                ORDER BY r.created_at DESC LIMIT 50
            """, (agent_id,))
            cols = ["id","rating","review_text","created_at","reviewer_name","template_name"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                parts = (d.get("reviewer_name") or "").split()
                if len(parts) >= 2:
                    d["reviewer_name"] = f"{parts[0]} {parts[-1][0]}."
                d["created_at"] = str(d["created_at"])
                rows.append(d)
            return rows
    finally:
        _release(conn)


# ── Follows ───────────────────────────────────────────────────

def follow_agent(follower_sid: str, agent_id: str) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO agent_follows (follower_sid, agent_id)
                VALUES (%s,%s) ON CONFLICT DO NOTHING
            """, (follower_sid, agent_id))
            cur.execute(
                "UPDATE agents SET follower_count = follower_count + 1 WHERE id=%s",
                (agent_id,)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"follow_agent: {exc}"); conn.rollback()
    finally:
        _release(conn)


def unfollow_agent(follower_sid: str, agent_id: str) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM agent_follows WHERE follower_sid=%s AND agent_id=%s",
                (follower_sid, agent_id)
            )
            cur.execute(
                "UPDATE agents SET follower_count = GREATEST(0, follower_count - 1) WHERE id=%s",
                (agent_id,)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"unfollow_agent: {exc}"); conn.rollback()
    finally:
        _release(conn)


def is_following(follower_sid: str, agent_id: str) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM agent_follows WHERE follower_sid=%s AND agent_id=%s LIMIT 1",
                (follower_sid, agent_id)
            )
            return cur.fetchone() is not None
    finally:
        _release(conn)


def get_agents_with_pending_earnings(min_amount: float = 10.0) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, stripe_account_id, pending_earnings FROM agents "
                "WHERE status='active' AND pending_earnings >= %s",
                (min_amount,)
            )
            return [{"id": r[0], "stripe_account_id": r[1], "pending_earnings": float(r[2])}
                    for r in cur.fetchall()]
    finally:
        _release(conn)


def record_payout(payout: dict) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO agent_payouts
                    (id, agent_id, amount, stripe_transfer_id, status, period_month, period_year, paid_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())
            """, (
                payout["id"], payout["agent_id"], payout["amount"],
                payout.get("stripe_transfer_id"), payout.get("status","paid"),
                payout.get("period_month"), payout.get("period_year"),
            ))
            cur.execute(
                "UPDATE agents SET pending_earnings = 0 WHERE id=%s",
                (payout["agent_id"],)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"record_payout: {exc}"); conn.rollback()
    finally:
        _release(conn)


# ── Org functions ────────────────────────────────────────────────

def create_org(owner_sid: str, name: str, org_id: str, owner_name: str = "") -> tuple[bool, str]:
    """Create org + add owner as member. Returns (ok, error_message)."""
    conn = _get_conn()
    if not conn:
        return False, "could not get DB connection"
    try:
        with conn.cursor() as cur:
            # Ensure owner row exists in users to avoid FK violation
            cur.execute(
                "INSERT INTO users (sid, name) VALUES (%s, %s) ON CONFLICT (sid) DO NOTHING",
                (owner_sid, owner_name or owner_sid)
            )
            cur.execute(
                "INSERT INTO orgs (id, name, owner_sid) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
                (org_id, name, owner_sid)
            )
            cur.execute(
                "INSERT INTO org_members (org_id, user_sid, role, invited_by) VALUES (%s, %s, 'owner', %s) ON CONFLICT (org_id, user_sid) DO NOTHING",
                (org_id, owner_sid, owner_sid)
            )
        conn.commit()
        return True, ""
    except Exception as exc:
        err = str(exc)
        log.error(f"create_org: {err}\n{traceback.format_exc()}")
        conn.rollback()
        return False, err
    finally:
        _release(conn)


# ── User blobs (generic key/value JSON store per user) ────────

def save_user_blob(sid: str, key: str, data: dict) -> None:
    import json as _json
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_blobs (sid, key, data, updated_at)
                   VALUES (%s, %s, %s, NOW())
                   ON CONFLICT (sid, key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                (sid, key, _json.dumps(data))
            )
        conn.commit()
    except Exception as exc:
        log.error(f"save_user_blob failed [{sid}/{key}]: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def get_user_blob(sid: str, key: str) -> dict | None:
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM user_blobs WHERE sid = %s AND key = %s", (sid, key))
            row = cur.fetchone()
        return row[0] if row else None
    finally:
        _release(conn)


# ── User profile ─────────────────────────────────────────────

def update_user_profile(sid: str, name: str, phone: str) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET name = %s, phone = %s WHERE sid = %s",
                (name, phone, sid)
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"update_user_profile failed: {exc}")
        conn.rollback()
        return False
    finally:
        _release(conn)


# ── Community posts ───────────────────────────────────────────

def get_community_posts(category: str = "all", limit: int = 40) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            if category == "all":
                cur.execute(
                    "SELECT id, author_name, author_sid, body, category, tags, likes, replies, created_at "
                    "FROM community_posts ORDER BY created_at DESC LIMIT %s",
                    (limit,)
                )
            else:
                cur.execute(
                    "SELECT id, author_name, author_sid, body, category, tags, likes, replies, created_at "
                    "FROM community_posts WHERE category = %s ORDER BY created_at DESC LIMIT %s",
                    (category, limit)
                )
            rows = cur.fetchall()
        return [
            {"id": r[0], "author": r[1], "sid": r[2], "body": r[3], "category": r[4],
             "tags": r[5] or [], "likes": r[6] or [], "replies": r[7] or [],
             "created": r[8].strftime("%Y-%m-%dT%H:%M:%SZ") if r[8] else ""}
            for r in rows
        ]
    finally:
        _release(conn)


def create_community_post(post_id: str, author_name: str, author_sid: str,
                          body: str, category: str, tags: list) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        import json as _json
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO community_posts (id, author_name, author_sid, body, category, tags) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (post_id, author_name, author_sid, body, category, _json.dumps(tags))
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"create_community_post failed: {exc}")
        conn.rollback()
        return False
    finally:
        _release(conn)


def toggle_community_like(post_id: str, user_sid: str) -> tuple[bool, int]:
    """Toggle like. Returns (liked: bool, new_count: int)."""
    conn = _get_conn()
    if not conn:
        return False, 0
    try:
        import json as _json
        with conn.cursor() as cur:
            cur.execute("SELECT likes FROM community_posts WHERE id = %s FOR UPDATE", (post_id,))
            row = cur.fetchone()
            if not row:
                return False, 0
            likes = row[0] or []
            if user_sid in likes:
                likes.remove(user_sid)
                liked = False
            else:
                likes.append(user_sid)
                liked = True
            cur.execute(
                "UPDATE community_posts SET likes = %s WHERE id = %s",
                (_json.dumps(likes), post_id)
            )
        conn.commit()
        return liked, len(likes)
    except Exception as exc:
        log.error(f"toggle_community_like failed: {exc}")
        conn.rollback()
        return False, 0
    finally:
        _release(conn)


def add_community_reply(post_id: str, reply: dict) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        import json as _json
        with conn.cursor() as cur:
            cur.execute("SELECT replies FROM community_posts WHERE id = %s FOR UPDATE", (post_id,))
            row = cur.fetchone()
            if not row:
                return False
            replies = row[0] or []
            replies.append(reply)
            cur.execute(
                "UPDATE community_posts SET replies = %s WHERE id = %s",
                (_json.dumps(replies), post_id)
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"add_community_reply failed: {exc}")
        conn.rollback()
        return False
    finally:
        _release(conn)


def seed_community_posts(posts: list) -> None:
    """Insert seed posts only when the table is empty."""
    conn = _get_conn()
    if not conn:
        return
    try:
        import json as _json
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM community_posts")
            if cur.fetchone()[0] > 0:
                return
            for p in posts:
                cur.execute(
                    "INSERT INTO community_posts (id, author_name, body, category, created_at) "
                    "VALUES (%s, %s, %s, %s, NOW() - INTERVAL '1 hour' * %s) ON CONFLICT (id) DO NOTHING",
                    (p["id"], p.get("author","Sivarr Team"), p.get("content", p.get("body","")),
                     p.get("category","general"), posts.index(p) * 2)
                )
        conn.commit()
    except Exception as exc:
        log.error(f"seed_community_posts failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)


# ── Opportunities ─────────────────────────────────────────────

def get_opportunities(category: str = "all", limit: int = 50) -> list:
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            if category == "all":
                cur.execute(
                    "SELECT id, title, description, link, category, organisation, location, deadline, submitted_by, created_at "
                    "FROM opportunities ORDER BY created_at DESC LIMIT %s",
                    (limit,)
                )
            else:
                cur.execute(
                    "SELECT id, title, description, link, category, organisation, location, deadline, submitted_by, created_at "
                    "FROM opportunities WHERE category = %s ORDER BY created_at DESC LIMIT %s",
                    (category, limit)
                )
            rows = cur.fetchall()
        return [
            {"id": r[0], "title": r[1], "desc": r[2], "link": r[3], "category": r[4],
             "organisation": r[5], "location": r[6], "deadline": r[7],
             "submitted_by": r[8],
             "created": r[9].strftime("%Y-%m-%dT%H:%M:%SZ") if r[9] else ""}
            for r in rows
        ]
    finally:
        _release(conn)


def create_opportunity(opp: dict) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO opportunities (id, title, description, link, category, organisation, location, deadline, submitted_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (opp["id"], opp["title"], opp.get("desc",""), opp.get("link",""),
                 opp.get("category","other"), opp.get("organisation",""), opp.get("location",""),
                 opp.get("deadline",""), opp.get("submitted_by",""))
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"create_opportunity failed: {exc}")
        conn.rollback()
        return False
    finally:
        _release(conn)


def seed_opportunities(opps: list) -> None:
    """Insert seed opportunities only when the table is empty."""
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM opportunities")
            if cur.fetchone()[0] > 0:
                return
            for o in opps:
                cur.execute(
                    "INSERT INTO opportunities (id, title, description, link, category, organisation, location, deadline) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                    (o["id"], o["title"], o.get("description",""), o.get("url", o.get("link","")),
                     o.get("category","other"), o.get("organisation",""), o.get("location",""),
                     o.get("deadline",""))
                )
        conn.commit()
    except Exception as exc:
        log.error(f"seed_opportunities failed: {exc}")
        conn.rollback()
    finally:
        _release(conn)


def update_org(org_id: str, owner_sid: str, updates: dict) -> bool:
    """Update allowed org fields. Only the owner can do this."""
    allowed = {"name", "description", "logo"}
    fields  = {k: v for k, v in updates.items() if k in allowed}
    if not fields:
        return False
    conn = _get_conn()
    if not conn:
        return False
    try:
        set_clause = ", ".join(f"{k} = %s" for k in fields)
        vals       = list(fields.values()) + [org_id, owner_sid]
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE orgs SET {set_clause} WHERE id = %s AND owner_sid = %s",
                vals
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"update_org failed: {exc}")
        conn.rollback()
        return False
    finally:
        _release(conn)


def get_all_orgs() -> list:
    """Return all orgs — used by cron jobs to iterate every org."""
    conn = _get_conn()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, name FROM orgs ORDER BY created_at ASC")
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        log.error(f"get_all_orgs: {exc}"); return []
    finally:
        _release(conn)


def get_org_by_member(user_sid: str) -> dict | None:
    conn = _get_conn()
    if not conn: return None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT o.*, om.role AS member_role
                FROM orgs o
                JOIN org_members om ON om.org_id = o.id
                WHERE om.user_sid = %s
                ORDER BY o.created_at ASC
                LIMIT 1
            """, (user_sid,))
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as exc:
        log.error(f"get_org_by_member: {exc}"); return None
    finally:
        _release(conn)


def get_org_members(org_id: str) -> list:
    conn = _get_conn()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT om.role, om.joined_at, u.sid, u.name, u.email
                FROM org_members om
                JOIN users u ON u.sid = om.user_sid
                WHERE om.org_id = %s
                ORDER BY om.joined_at ASC
            """, (org_id,))
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        log.error(f"get_org_members: {exc}"); return []
    finally:
        _release(conn)


def create_org_invite(org_id: str, email: str, role: str, invited_by: str, token: str, expires_at) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO org_invites (token, org_id, email, role, invited_by, expires_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (token, org_id, email.lower(), role, invited_by, expires_at)
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"create_org_invite: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_invite(token: str) -> dict | None:
    conn = _get_conn()
    if not conn: return None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM org_invites WHERE token = %s AND used = FALSE", (token,))
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as exc:
        log.error(f"get_org_invite: {exc}"); return None
    finally:
        _release(conn)


def use_org_invite(token: str, user_sid: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM org_invites WHERE token=%s AND used=FALSE", (token,))
            inv = cur.fetchone()
            if not inv: return False
            cur.execute("UPDATE org_invites SET used=TRUE WHERE token=%s", (token,))
            cur.execute(
                "INSERT INTO org_members (org_id, user_sid, role, invited_by) VALUES (%s,%s,%s,%s) ON CONFLICT (org_id, user_sid) DO NOTHING",
                (inv[1], user_sid, inv[3], inv[4])
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"use_org_invite: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_tasks(org_id: str, project_id: str = None,
                  limit: int = 500, offset: int = 0) -> list:
    with _timed("get_org_tasks"):
        conn = _get_conn()
        if not conn: return []
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if project_id:
                    cur.execute(
                        "SELECT * FROM org_tasks WHERE org_id=%s AND project_id=%s ORDER BY created_at DESC LIMIT %s OFFSET %s",
                        (org_id, project_id, limit, offset)
                    )
                else:
                    cur.execute(
                        "SELECT * FROM org_tasks WHERE org_id=%s ORDER BY created_at DESC LIMIT %s OFFSET %s",
                        (org_id, limit, offset)
                    )
                return [dict(r) for r in cur.fetchall()]
        except Exception as exc:
            log.error(f"get_org_tasks: {exc}"); return []
        finally:
            _release(conn)


def count_org_tasks(org_id: str, exclude_status: str = None) -> int:
    """COUNT query — avoids loading all rows just to get a number."""
    conn = _get_conn()
    if not conn: return 0
    try:
        with conn.cursor() as cur:
            if exclude_status:
                cur.execute("SELECT COUNT(*) FROM org_tasks WHERE org_id=%s AND status != %s",
                            (org_id, exclude_status))
            else:
                cur.execute("SELECT COUNT(*) FROM org_tasks WHERE org_id=%s", (org_id,))
            return cur.fetchone()[0]
    except Exception as exc:
        log.error(f"count_org_tasks: {exc}"); return 0
    finally:
        _release(conn)


def create_org_task(org_id: str, task_id: str, title: str, created_by: str,
                    status: str = "todo", priority: str = "normal",
                    description: str = "", assignee_sid: str = None,
                    project_id: str = None, due_date: str = None) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO org_tasks (id, org_id, title, description, status, priority, assignee_sid, created_by, project_id, due_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (task_id, org_id, title, description, status, priority, assignee_sid or None, created_by, project_id or None, due_date or None))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"create_org_task: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def update_org_task(task_id: str, updates: dict, org_id: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    allowed = {"title", "description", "status", "priority", "assignee_sid", "project_id", "due_date"}
    sets = {k: v for k, v in updates.items() if k in allowed}
    if not sets: return True
    try:
        with conn.cursor() as cur:
            cols = ", ".join(f"{k}=%s" for k in sets)
            cur.execute(f"UPDATE org_tasks SET {cols}, updated_at=NOW() WHERE id=%s AND org_id=%s",
                        (*sets.values(), task_id, org_id))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"update_org_task: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def delete_org_task(task_id: str, org_id: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM org_tasks WHERE id=%s AND org_id=%s", (task_id, org_id))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"delete_org_task: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_projects(org_id: str, limit: int = 100) -> list:
    conn = _get_conn()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM org_projects WHERE org_id=%s ORDER BY created_at DESC LIMIT %s", (org_id, limit))
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        log.error(f"get_org_projects: {exc}"); return []
    finally:
        _release(conn)


def create_org_project(org_id: str, project_id: str, name: str, created_by: str,
                       description: str = "", color: str = "#0D7A5F") -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO org_projects (id, org_id, name, description, color, created_by) VALUES (%s,%s,%s,%s,%s,%s)",
                (project_id, org_id, name, description, color, created_by)
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"create_org_project: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def update_org_project(project_id: str, updates: dict, org_id: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    allowed = {"name", "description", "status", "color"}
    sets = {k: v for k, v in updates.items() if k in allowed}
    if not sets: return True
    try:
        with conn.cursor() as cur:
            cols = ", ".join(f"{k}=%s" for k in sets)
            cur.execute(f"UPDATE org_projects SET {cols}, updated_at=NOW() WHERE id=%s AND org_id=%s",
                        (*sets.values(), project_id, org_id))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"update_org_project: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_docs(org_id: str, limit: int = 100) -> list:
    conn = _get_conn()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, org_id, title, created_by, created_at, updated_at FROM org_docs WHERE org_id=%s ORDER BY updated_at DESC LIMIT %s",
                (org_id, limit)
            )
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        log.error(f"get_org_docs: {exc}"); return []
    finally:
        _release(conn)


def save_org_doc(org_id: str, doc_id: str, title: str, content: str, user_sid: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO org_docs (id, org_id, title, content, created_by, updated_by)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO UPDATE SET title=%s, content=%s, updated_by=%s, updated_at=NOW()
            """, (doc_id, org_id, title, content, user_sid, user_sid, title, content, user_sid))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"save_org_doc: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_doc(doc_id: str) -> dict | None:
    conn = _get_conn()
    if not conn: return None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM org_docs WHERE id=%s", (doc_id,))
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as exc:
        log.error(f"get_org_doc: {exc}"); return None
    finally:
        _release(conn)


def delete_org_doc(doc_id: str, org_id: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM org_docs WHERE id=%s AND org_id=%s", (doc_id, org_id))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"delete_org_doc: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_messages(org_id: str, channel: str = "general", limit: int = 60) -> list:
    with _timed("get_org_messages"):
        conn = _get_conn()
        if not conn: return []
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM org_messages WHERE org_id=%s AND channel=%s ORDER BY created_at DESC LIMIT %s",
                    (org_id, channel, limit)
                )
                return list(reversed([dict(r) for r in cur.fetchall()]))
        except Exception as exc:
            log.error(f"get_org_messages: {exc}"); return []
        finally:
            _release(conn)


def send_org_message(org_id: str, channel: str, author_sid: str, author_name: str, content: str) -> dict | None:
    """Insert a message and return the full row (with id/created_at) or None on failure."""
    conn = _get_conn()
    if not conn: return None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO org_messages (org_id, channel, content, author_sid, author_name) VALUES (%s,%s,%s,%s,%s) RETURNING *",
                (org_id, channel, content, author_sid, author_name)
            )
            row = dict(cur.fetchone())
        conn.commit()
        return row
    except Exception as exc:
        log.error(f"send_org_message: {exc}"); conn.rollback(); return None
    finally:
        _release(conn)


def get_org_messages_since(org_id: str, since_id: int, limit: int = 30) -> list:
    """Return messages with id > since_id for the org, all channels, ascending order."""
    with _timed("get_org_messages_since"):
        conn = _get_conn()
        if not conn: return []
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM org_messages WHERE org_id=%s AND id > %s ORDER BY id ASC LIMIT %s",
                    (org_id, since_id, limit)
                )
                return [dict(r) for r in cur.fetchall()]
        except Exception as exc:
            log.error(f"get_org_messages_since: {exc}"); return []
        finally:
            _release(conn)


def prune_rate_limit_hits(older_than_seconds: int) -> None:
    """Delete rate_limit_hits rows older than the given age. Called by background cleanup task."""
    conn = _get_conn()
    if not conn: return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM rate_limit_hits WHERE ts < NOW() - INTERVAL '1 second' * %s",
                (older_than_seconds,)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"prune_rate_limit_hits: {exc}")
        try: conn.rollback()
        except Exception: pass
    finally:
        _release(conn)


def db_check_rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """Sliding-window rate check backed by PostgreSQL. Returns True if allowed."""
    with _timed("db_check_rate_limit"):
        conn = _get_conn()
        if not conn: return True  # fail open when DB unavailable
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM rate_limit_hits WHERE key=%s AND ts < NOW() - INTERVAL '1 second' * %s",
                    (key, window_seconds)
                )
                cur.execute("SELECT COUNT(*) FROM rate_limit_hits WHERE key=%s", (key,))
                count = cur.fetchone()[0]
                if count >= limit:
                    conn.rollback()
                    return False
                cur.execute("INSERT INTO rate_limit_hits (key) VALUES (%s)", (key,))
            conn.commit()
            return True
        except Exception as exc:
            log.error(f"db_check_rate_limit: {exc}")
            try: conn.rollback()
            except Exception: pass
            return True  # fail open
        finally:
            _release(conn)


def upsert_presence(sid: str, org_id: str, name: str) -> None:
    conn = _get_conn()
    if not conn: return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_presence (sid, org_id, name, last_seen)
                   VALUES (%s, %s, %s, NOW())
                   ON CONFLICT (sid, org_id) DO UPDATE SET name=EXCLUDED.name, last_seen=NOW()""",
                (sid, org_id, name)
            )
        conn.commit()
    except Exception as exc:
        log.error(f"upsert_presence: {exc}")
        try: conn.rollback()
        except Exception: pass
    finally:
        _release(conn)


def get_presence(org_id: str, cutoff_seconds: int = 90) -> list:
    conn = _get_conn()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT sid, name FROM user_presence WHERE org_id=%s AND last_seen > NOW() - INTERVAL '1 second' * %s",
                (org_id, cutoff_seconds)
            )
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        log.error(f"get_presence: {exc}"); return []
    finally:
        _release(conn)


# ── Goals & OKRs ──────────────────────────────────────────────────────────────

def get_org_goals(org_id: str) -> list:
    conn = _get_conn()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM org_goals WHERE org_id=%s ORDER BY created_at ASC", (org_id,))
            goals = [dict(r) for r in cur.fetchall()]
            for g in goals:
                cur.execute("SELECT * FROM org_key_results WHERE goal_id=%s ORDER BY created_at ASC", (g['id'],))
                g['key_results'] = [dict(r) for r in cur.fetchall()]
            return goals
    except Exception as exc:
        log.error(f"get_org_goals: {exc}"); return []
    finally:
        _release(conn)


def create_org_goal(org_id: str, goal_id: str, title: str, created_by: str,
                    description: str = "", goal_type: str = "okr",
                    owner_sid: str = None, due_date: str = None) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO org_goals (id, org_id, title, description, type, owner_sid, due_date, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (goal_id, org_id, title, description, goal_type, owner_sid, due_date or None, created_by)
            )
        conn.commit(); return True
    except Exception as exc:
        log.error(f"create_org_goal: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def update_org_goal(goal_id: str, org_id: str, title: str = None, description: str = None,
                    status: str = None, progress: int = None, due_date: str = None) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        fields, vals = [], []
        if title is not None:       fields.append("title=%s");       vals.append(title)
        if description is not None: fields.append("description=%s"); vals.append(description)
        if status is not None:      fields.append("status=%s");      vals.append(status)
        if progress is not None:    fields.append("progress=%s");    vals.append(progress)
        if due_date is not None:    fields.append("due_date=%s");    vals.append(due_date or None)
        if not fields: return True
        fields.append("updated_at=NOW()")
        vals.extend([goal_id, org_id])
        with conn.cursor() as cur:
            cur.execute(f"UPDATE org_goals SET {','.join(fields)} WHERE id=%s AND org_id=%s", vals)
        conn.commit(); return True
    except Exception as exc:
        log.error(f"update_org_goal: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def delete_org_goal(goal_id: str, org_id: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM org_goals WHERE id=%s AND org_id=%s", (goal_id, org_id))
        conn.commit(); return True
    except Exception as exc:
        log.error(f"delete_org_goal: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def create_org_key_result(kr_id: str, goal_id: str, org_id: str, title: str,
                          target_value: float = 100, unit: str = "%") -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO org_key_results (id, goal_id, org_id, title, target_value, unit) VALUES (%s,%s,%s,%s,%s,%s)",
                (kr_id, goal_id, org_id, title, target_value, unit)
            )
        conn.commit(); return True
    except Exception as exc:
        log.error(f"create_org_key_result: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def update_org_key_result(kr_id: str, org_id: str, current_value: float = None, status: str = None) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        fields, vals = [], []
        if current_value is not None: fields.append("current_value=%s"); vals.append(current_value)
        if status is not None:        fields.append("status=%s");        vals.append(status)
        if not fields: return True
        vals.extend([kr_id, org_id])
        with conn.cursor() as cur:
            cur.execute(f"UPDATE org_key_results SET {','.join(fields)} WHERE id=%s AND org_id=%s", vals)
        conn.commit(); return True
    except Exception as exc:
        log.error(f"update_org_key_result: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


# ── Founder Mode ──────────────────────────────────────────────────────────────

def get_org_founder(org_id: str) -> dict:
    conn = _get_conn()
    if not conn: return {}
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM org_founder WHERE org_id=%s", (org_id,))
            row = cur.fetchone()
            return dict(row) if row else {}
    except Exception as exc:
        log.error(f"get_org_founder: {exc}"); return {}
    finally:
        _release(conn)


def save_org_founder(org_id: str, burn_rate: float = 0, cash_balance: float = 0,
                     mrr: float = 0, arr: float = 0, funding_stage: str = "pre-seed",
                     total_raised: float = 0, investors: list = None,
                     milestones: list = None) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO org_founder (org_id, burn_rate, cash_balance, mrr, arr, funding_stage, total_raised, investors, milestones)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (org_id) DO UPDATE SET
                  burn_rate=%s, cash_balance=%s, mrr=%s, arr=%s,
                  funding_stage=%s, total_raised=%s, investors=%s, milestones=%s, updated_at=NOW()
            """, (
                org_id, burn_rate, cash_balance, mrr, arr, funding_stage, total_raised,
                json.dumps(investors or []), json.dumps(milestones or []),
                burn_rate, cash_balance, mrr, arr, funding_stage, total_raised,
                json.dumps(investors or []), json.dumps(milestones or [])
            ))
        conn.commit(); return True
    except Exception as exc:
        log.error(f"save_org_founder: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


# ── Announcements ────────────────────────────────────────────────────────────

def create_org_announcement(org_id: str, ann_id: str, title: str, body: str,
                             author_sid: str, author_name: str, pinned: bool = False) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO org_announcements (id, org_id, title, body, author_sid, author_name, pinned) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (ann_id, org_id, title, body, author_sid, author_name, pinned)
            )
        conn.commit(); return True
    except Exception as exc:
        log.error(f"create_org_announcement: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_announcements(org_id: str, limit: int = 50) -> list:
    conn = _get_conn()
    if not conn: return []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM org_announcements WHERE org_id=%s ORDER BY pinned DESC, created_at DESC LIMIT %s",
                (org_id, limit)
            )
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        log.error(f"get_org_announcements: {exc}"); return []
    finally:
        _release(conn)


def delete_org_announcement(ann_id: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM org_announcements WHERE id=%s", (ann_id,))
        conn.commit(); return True
    except Exception as exc:
        log.error(f"delete_org_announcement: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


# ── Analytics ────────────────────────────────────────────────────────────────

def get_org_analytics(org_id: str) -> dict:
    conn = _get_conn()
    if not conn: return {}
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM org_members WHERE org_id=%s", (org_id,))
            members = cur.fetchone()['cnt']

            cur.execute("SELECT COUNT(*) AS cnt FROM org_tasks WHERE org_id=%s", (org_id,))
            tasks_total = cur.fetchone()['cnt']

            cur.execute("SELECT COUNT(*) AS cnt FROM org_tasks WHERE org_id=%s AND status='done'", (org_id,))
            tasks_done = cur.fetchone()['cnt']

            cur.execute("SELECT COUNT(*) AS cnt FROM org_messages WHERE org_id=%s", (org_id,))
            messages = cur.fetchone()['cnt']

            cur.execute("SELECT COUNT(*) AS cnt FROM org_docs WHERE org_id=%s", (org_id,))
            docs = cur.fetchone()['cnt']

            cur.execute(
                "SELECT status, COUNT(*) AS cnt FROM org_tasks WHERE org_id=%s GROUP BY status",
                (org_id,)
            )
            status_breakdown = {r['status']: r['cnt'] for r in cur.fetchall()}

            cur.execute(
                "SELECT DATE(created_at) AS day, COUNT(*) AS cnt FROM org_messages WHERE org_id=%s AND created_at > NOW() - INTERVAL '7 days' GROUP BY day ORDER BY day",
                (org_id,)
            )
            msg_trend = [dict(r) for r in cur.fetchall()]

        completion_rate = round((tasks_done / tasks_total * 100) if tasks_total else 0, 1)
        return {
            "members": members,
            "tasks_total": tasks_total,
            "tasks_done": tasks_done,
            "completion_rate": completion_rate,
            "messages": messages,
            "docs": docs,
            "status_breakdown": status_breakdown,
            "msg_trend": msg_trend,
        }
    except Exception as exc:
        log.error(f"get_org_analytics: {exc}"); return {}
    finally:
        _release(conn)


# ── Org Integrations (Paystack, Mono, etc.) ──────────────────────────────────

def save_org_integration(org_id: str, provider: str, secret_key: str,
                          public_key: str = "", meta: dict | None = None) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO org_integrations (org_id, provider, secret_key, public_key, meta, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (org_id, provider) DO UPDATE
                SET secret_key = EXCLUDED.secret_key,
                    public_key = EXCLUDED.public_key,
                    meta = EXCLUDED.meta,
                    updated_at = NOW()
            """, (org_id, provider, secret_key, public_key, json.dumps(meta or {})))
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"save_org_integration: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def get_org_integration(org_id: str, provider: str) -> dict | None:
    conn = _get_conn()
    if not conn: return None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM org_integrations WHERE org_id=%s AND provider=%s",
                (org_id, provider)
            )
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as exc:
        log.error(f"get_org_integration: {exc}"); return None
    finally:
        _release(conn)


def delete_org_integration(org_id: str, provider: str) -> bool:
    conn = _get_conn()
    if not conn: return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM org_integrations WHERE org_id=%s AND provider=%s",
                (org_id, provider)
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"delete_org_integration: {exc}"); conn.rollback(); return False
    finally:
        _release(conn)


def save_feedback(sid: str, rating: int, text: str, page: str = "") -> bool:
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO feedback (sid, rating, text, page) VALUES (%s, %s, %s, %s)",
                (sid, rating, text, page)
            )
        conn.commit()
        return True
    except Exception as exc:
        log.error(f"save_feedback: {exc}"); conn.rollback()
        return False
    finally:
        _release(conn)


# ── MP3: Marketplace seed data ────────────────────────────────────────────────

_SEED_AGENT_ID = "sivarr_seed_agent"

_SEED_TEMPLATES = [
    {
        "id": "seed_copy_assistant",
        "name": "Copy Assistant",
        "short_description": "Writes social captions, emails, product descriptions, and ad copy from a brief.",
        "category": "writing",
        "price": 0.0,
        "price_ngn": 0.0,
        "thumbnail_color": "#4f6ef7",
        "tags": ["copywriting", "social media", "email"],
    },
    {
        "id": "seed_startup_analyst",
        "name": "Startup Analyst",
        "short_description": "Analyses your metrics and writes weekly founder briefings from your data.",
        "category": "finance",
        "price": 0.0,
        "price_ngn": 500.0,
        "thumbnail_color": "#22c55e",
        "tags": ["founders", "metrics", "briefing"],
    },
    {
        "id": "seed_study_coach",
        "name": "Study Coach",
        "short_description": "Creates personalised study plans, flashcards, and quizzes you on weak areas.",
        "category": "academic",
        "price": 0.0,
        "price_ngn": 0.0,
        "thumbnail_color": "#f59e0b",
        "tags": ["study", "flashcards", "quiz"],
    },
    {
        "id": "seed_outreach_pro",
        "name": "Outreach Pro",
        "short_description": "Writes cold emails, follow-ups, and investor updates from bullet-point notes.",
        "category": "writing",
        "price": 0.0,
        "price_ngn": 1200.0,
        "thumbnail_color": "#7c3aed",
        "tags": ["outreach", "email", "investors"],
    },
    {
        "id": "seed_daily_planner",
        "name": "Daily Planner",
        "short_description": "Builds a prioritised daily schedule from your tasks and calendar each morning.",
        "category": "workspace",
        "price": 0.0,
        "price_ngn": 0.0,
        "thumbnail_color": "#0D7A5F",
        "tags": ["planning", "productivity", "schedule"],
    },
    {
        "id": "seed_research_digest",
        "name": "Research Digest",
        "short_description": "Summarises articles, PDFs, and web pages into key points and action items.",
        "category": "academic",
        "price": 0.0,
        "price_ngn": 800.0,
        "thumbnail_color": "#ef4444",
        "tags": ["research", "summary", "reading"],
    },
]


def seed_marketplace_templates() -> None:
    """Insert seed agent + templates if the templates table is empty. Safe to call on every startup."""
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM agent_templates")
            count = cur.fetchone()[0]
            if count > 0:
                return  # already seeded

            # Create a seed agent row first (templates FK to agents)
            cur.execute("""
                INSERT INTO agents (id, user_sid, display_name, bio, status, verified)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, (_SEED_AGENT_ID, _SEED_AGENT_ID, "Sivarr Team", "Official Sivarr workspace templates.", "active", True))

            for t in _SEED_TEMPLATES:
                cur.execute("""
                    INSERT INTO agent_templates
                        (id, agent_id, name, short_description, category, price, price_ngn,
                         thumbnail_color, tags, contents, included_items, status, download_count, avg_rating)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,'{}','[]','published',0,0.0)
                    ON CONFLICT (id) DO NOTHING
                """, (
                    t["id"], _SEED_AGENT_ID, t["name"], t["short_description"],
                    t["category"], t["price"], t["price_ngn"], t["thumbnail_color"],
                    json.dumps(t["tags"]),
                ))
        conn.commit()
        log.info(f"Seeded {len(_SEED_TEMPLATES)} marketplace templates")
    except Exception as exc:
        log.error(f"seed_marketplace_templates: {exc}")
        conn.rollback()
    finally:
        _release(conn)
