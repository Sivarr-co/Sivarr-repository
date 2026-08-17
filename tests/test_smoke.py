"""
Boot + contract smoke tests.

These are deliberately behavioural, not syntactic. `python -c "import app"` and
`node --check` only prove the files parse; every regression this codebase has
actually shipped was semantic (a strict-equality comparison that silently no-op'd,
a CSS rule that won the cascade unexpectedly, an asset URL that could never be
busted). This file covers the parts of that surface a test can reach without a
browser: the app boots, the pages render, every asset URL is content-hashed and
resolves to a real file, and the extracted route modules round-trip real data.

Runs against JSON-file fallback storage — no database required.
"""

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as app_module
import core
import database as db

REPO = Path(__file__).resolve().parent.parent

# Matches href="/css/..." src="/js/..." content="/static/..."
ASSET_REF = re.compile(r'(?:href|src|content)="(/(?:css|js|static)/[^"]*)"')


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


# ── Boot ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/", "/app", "/health", "/sw.js", "/terms", "/privacy"])
def test_page_serves(client, path):
    assert client.get(path).status_code == 200


def test_health_reports_ok(client):
    assert client.get("/health").json().get("status") in ("ok", "healthy", "degraded")


# ── Asset integrity ───────────────────────────────────────────────────────────
#
# Guards the specific bug this suite was written alongside: /css/, /js/ and
# /static/ are served immutable for a year, so an asset referenced WITHOUT a
# content hash can never be updated in a browser that already loaded it. Three
# js/features/*.js and three css/features/*.css files shipped in exactly that
# state. These tests fail the build if it happens again.

@pytest.mark.parametrize("page", ["/", "/app"])
def test_every_asset_reference_is_content_hashed(client, page):
    unversioned = [u for u in set(ASSET_REF.findall(client.get(page).text)) if "?v=" not in u]
    assert not unversioned, (
        f"{page} references assets with no content hash: {unversioned}. "
        f"Use {{{{ asset('/path') }}}} in the template — see core.py:asset()."
    )


@pytest.mark.parametrize("page", ["/", "/app"])
def test_every_asset_reference_resolves_to_a_real_file(client, page):
    missing = [
        u for u in set(ASSET_REF.findall(client.get(page).text))
        if not (REPO / u.split("?")[0].lstrip("/")).is_file()
    ]
    assert not missing, f"{page} references files that do not exist: {missing}"


def test_hash_changes_when_content_changes(tmp_path):
    probe = REPO / "css" / "base.css"
    original = probe.read_text(encoding="utf-8")
    try:
        before = core.asset("/css/base.css")
        probe.write_text(original + "\n/* ci probe */\n", encoding="utf-8")
        core._ASSET_HASHES.clear()
        after = core.asset("/css/base.css")
        assert before != after, "asset() returned the same URL after the file changed"
    finally:
        probe.write_text(original, encoding="utf-8")
        core._ASSET_HASHES.clear()


def test_missing_asset_degrades_instead_of_raising():
    assert core.asset("/css/does-not-exist.css") == "/css/does-not-exist.css"


def test_cache_policy_matches_versioning(client):
    versioned = client.get("/css/base.css?v=deadbeef").headers.get("cache-control", "")
    plain = client.get("/css/base.css").headers.get("cache-control", "")
    assert "immutable" in versioned
    assert "immutable" not in plain, (
        "An unversioned asset URL must not be immutable — it could never be updated."
    )


def test_service_worker_fully_renders(client):
    sw = client.get("/sw.js").text
    assert "{{" not in sw, "sw.js shipped with unrendered Jinja placeholders"
    assert re.search(r"const CACHE = 'sivarr-[0-9a-f]{10}'", sw), "SW cache name not hash-derived"

    # Only inspect the PRECACHE array itself — the surrounding comments mention
    # historical paths (/css/styles.css) that are not real entries.
    precache = re.search(r"const PRECACHE = \[(.*?)\];", sw, re.S)
    assert precache, "PRECACHE array not found in rendered sw.js"
    for url in re.findall(r"'(/(?:css|js|static)/[^']*)'", precache.group(1)):
        assert "?v=" in url, f"service worker precaches an unversioned URL: {url}"


# ── Extracted route modules ───────────────────────────────────────────────────
#
# routes/tasks.py, routes/habits.py and routes/docs_notes.py import their helpers
# from core.py. These round-trips prove the wiring works end to end, which is what
# would break if a future extraction reintroduced an app.py import cycle.

@pytest.fixture
def session_token():
    """A real session, minted directly — sidesteps the email-verification gate."""
    return core.create_session_token("ci_test_sid", "CI", "ci@example.com")


def test_routes_reject_missing_session(client):
    for path in ["/api/tasks/sync", "/api/habits/sync", "/api/docs/sync", "/api/journal/sync",
                 "/api/skills/sync", "/api/finance/sync"]:
        assert client.post(path, json={"token": "not-a-real-token"}).status_code == 401
    assert client.post("/api/goals/add", json={"token": "not-a-real-token", "title": "x"}).status_code == 401


def test_tasks_round_trip(client, session_token):
    r = client.post("/api/tasks/sync", json={
        "token": session_token,
        "tasks": [{"id": "t1", "title": "Ship Pass 0", "status": "todo"}],
    })
    assert r.status_code == 200 and r.json()["ok"]

    back = client.get(f"/api/tasks/restore?token={session_token}")
    assert back.status_code == 200
    titles = [t["title"] for t in back.json()["tasks"]]
    assert "Ship Pass 0" in titles


def test_tasks_sync_rejects_wrong_shape(client, session_token):
    r = client.post("/api/tasks/sync", json={"token": session_token, "tasks": "not-a-list"})
    assert r.status_code == 400


def test_habits_round_trip(client, session_token):
    r = client.post("/api/habits/sync", json={
        "token": session_token,
        "habits": [{"id": "h1", "name": "Read", "streak": 3}],
    })
    assert r.status_code == 200

    back = client.get(f"/api/habits/restore?token={session_token}")
    assert back.status_code == 200
    assert isinstance(back.json().get("habits"), list)


def test_docs_round_trip(client, session_token):
    r = client.post("/api/docs/sync", json={
        "token": session_token,
        "docs": [{"id": "d1", "title": "Brief", "content": "hello"}],
    })
    assert r.status_code == 200

    back = client.get(f"/api/docs/restore?token={session_token}")
    assert back.status_code == 200
    assert isinstance(back.json().get("docs"), list)


def test_journal_round_trip(client, session_token):
    r = client.post("/api/journal/sync", json={
        "token": session_token,
        "entries": [{"date": "2026-08-16", "text": "Shipped Pass 1.", "mood": "good"}],
    })
    assert r.status_code == 200 and r.json()["count"] == 1

    back = client.get(f"/api/journal/restore?token={session_token}")
    assert back.status_code == 200
    texts = [e["text"] for e in back.json()["entries"]]
    assert "Shipped Pass 1." in texts


def test_journal_prompt_is_stable_within_a_day(client):
    r1 = client.get("/api/journal/prompt")
    r2 = client.get("/api/journal/prompt")
    assert r1.status_code == 200
    assert r1.json()["prompt"] == r2.json()["prompt"]


def test_goals_round_trip(client, session_token):
    add = client.post("/api/goals/add", json={"token": session_token, "title": "Ship Pass 1"})
    assert add.status_code == 200
    goal_id = add.json()["goal"]["id"]

    listed = client.get(f"/api/goals?token={session_token}")
    assert goal_id in [g["id"] for g in listed.json()["goals"]]

    upd = client.post("/api/goals/update", json={
        "token": session_token, "id": goal_id, "progress": 60, "completed": False,
    })
    assert upd.status_code == 200

    goals_after = client.get(f"/api/goals?token={session_token}").json()["goals"]
    assert next(g for g in goals_after if g["id"] == goal_id)["progress"] == 60


def test_goal_key_results_drive_progress(client, session_token):
    add = client.post("/api/goals/add", json={"token": session_token, "title": "Read 10 books"})
    goal_id = add.json()["goal"]["id"]

    kr = client.post("/api/goals/kr/add", json={
        "token": session_token, "goal_id": goal_id,
        "title": "Books read", "target": 10, "current": 0,
    })
    assert kr.status_code == 200

    goals = client.get(f"/api/goals?token={session_token}").json()["goals"]
    kr_id = next(g for g in goals if g["id"] == goal_id)["key_results"][0]["id"]

    client.post("/api/goals/kr/update", json={
        "token": session_token, "goal_id": goal_id, "kr_id": kr_id, "current": 10,
    })
    goals = client.get(f"/api/goals?token={session_token}").json()["goals"]
    g = next(g for g in goals if g["id"] == goal_id)
    assert g["progress"] == 100 and g["completed"] is True


def test_goals_add_rejects_empty_title(client, session_token):
    r = client.post("/api/goals/add", json={"token": session_token, "title": ""})
    assert r.status_code == 400


# ── core.py contracts ─────────────────────────────────────────────────────────

def test_sanitize_text_strips_control_chars_and_truncates():
    assert core.sanitize_text("hi\x00there") == "hithere"
    assert core.sanitize_text("  padded  ") == "padded"
    assert len(core.sanitize_text("x" * 500, max_len=10)) == 10
    assert core.sanitize_text("") == ""
    assert core.sanitize_text(None) == ""


def test_session_lifecycle():
    token = core.create_session_token("sid_lifecycle", "N", "n@example.com")
    assert core.get_session_from_token(token)["sid"] == "sid_lifecycle"
    core.delete_session_token(token)
    assert core.get_session_from_token(token) is None
    assert core.get_session_from_token("") is None


def test_app_and_core_share_one_session_store():
    """app.py mutates core's _session_tokens by reference in ~20 places. If an
    import ever rebinds it instead, sessions silently split in two."""
    assert app_module._session_tokens is core._session_tokens


def test_skills_sync_and_restore_contract(client, session_token):
    """Skills has no JSON-file fallback (unlike every other feature here) — it
    only persists through db.save_user_blob/get_user_blob, so sync silently
    no-ops and restore returns empty when no database is configured, which is
    the environment this suite runs in. That's pre-existing behavior (verified
    byte-identical against the original code during extraction), not something
    this pass changes — asserting a round trip here would be testing a lie. This
    checks the parts of the contract that hold either way: the endpoint accepts
    the payload, echoes back a truthful count, and restore never 500s or returns
    a malformed shape."""
    r = client.post("/api/skills/sync", json={
        "token": session_token,
        "skills": [{"id": "s1", "name": "Piano", "level": 40, "target": 90}],
    })
    assert r.status_code == 200 and r.json()["synced"] == 1

    back = client.get(f"/api/skills/restore?token={session_token}")
    assert back.status_code == 200
    assert isinstance(back.json().get("skills"), list)

    if db.is_available():
        assert "Piano" in [s["name"] for s in back.json()["skills"]]


def test_finance_round_trip(client, session_token):
    r = client.post("/api/finance/sync", json={
        "token": session_token,
        "data": {
            "transactions": [{"id": "t1", "type": "expense", "amount": 500, "category": "food"}],
            "budgets": {"food": 5000},
        },
    })
    assert r.status_code == 200 and r.json()["synced"] == 1

    back = client.get(f"/api/finance/restore?token={session_token}")
    assert back.status_code == 200
    data = back.json()["data"]
    assert data["transactions"][0]["category"] == "food"
    assert data["budgets"]["food"] == 5000


def test_goals_and_journal_reexported_for_internal_callers():
    """load_goals/save_goals/load_journal/save_journal moved into routes/goals.py
    and routes/journal.py, but app.py's weekly review, Home brief, daily digest
    and /api/export still call them directly — confirms the re-export at the
    include_router import block still resolves."""
    assert callable(app_module.load_goals)
    assert callable(app_module.save_goals)
    assert callable(app_module.load_journal)
    assert callable(app_module.save_journal)


def test_chat_rejects_invalid_token(client):
    r = client.post("/api/chat", json={
        "sid": "x", "message": "hi", "token": "not-a-real-token",
    })
    assert r.status_code == 401


def test_chat_rejects_empty_message(client, session_token):
    r = client.post("/api/chat", json={"sid": "x", "message": "", "token": session_token})
    assert r.status_code == 422


def test_chat_solves_local_math_without_calling_gemini(client, session_token):
    """solve_local() short-circuits before any Gemini call, so this is safe to
    run with no GEMINI_API_KEY configured — deterministic, no network."""
    r = client.post("/api/chat", json={
        "sid": "x", "message": "12 + 30", "token": session_token,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == "Result = 42"
    assert body["error"] is False


def test_chat_clear_empties_history(client, session_token):
    client.post("/api/chat", json={"sid": "x", "message": "5 * 5", "token": session_token})
    r = client.post("/api/chat/clear", json={"token": session_token})
    assert r.status_code == 200 and r.json()["ok"]

    p = app_module.load_progress("ci_test_sid")
    assert p["chat_history"] == []


def test_ai_chat_router_is_wired(client):
    """Confirms build_router(...)'s output actually reached the app — a
    misconfigured factory call (wrong dependency order, forgotten
    include_router) would 404 here instead of 401/422."""
    r = client.post("/api/chat", json={"sid": "x", "message": "hi", "token": ""})
    assert r.status_code != 404


def test_routes_do_not_import_from_app():
    """The whole point of core.py: routers must not import a half-loaded app."""
    offenders = [
        p.name for p in (REPO / "routes").glob("*.py")
        if re.search(r"^from app import|^import app$", p.read_text(encoding="utf-8"), re.M)
    ]
    assert not offenders, (
        f"{offenders} import from app.py. Import shared helpers from core.py instead "
        f"— see core.py's module docstring."
    )
