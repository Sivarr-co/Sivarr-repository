"""
Content-Security-Policy for the SPA (app.py _SecurityHeadersMiddleware).

script-src 'unsafe-inline' is what lets an injected attribute or <script> run on
the workspace page. The SPA is now free of inline handlers and executable inline
scripts (js/core/delegate.js, js/boot/*.js), so CSP_STRICT_APP=1 drops the
keyword for /app and every deep-link slug -- while landing, /admin* and
/static/templates/* keep it until their own inline code is migrated.

The HTML-content tests below are the durable guard: if someone adds an inline
handler or <script> to index.html or a fragment, the strict policy would
silently break that control for every user, so it must fail here first.
"""

import re

import pytest
from fastapi.testclient import TestClient

import app as app_module

MW = app_module._SecurityHeadersMiddleware


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


def _directive(csp: str, name: str) -> str:
    return next(d.strip() for d in csp.split(";") if d.strip().startswith(name + " "))


def _csp(client, path):
    return client.get(path, follow_redirects=False).headers["content-security-policy"]


def test_flag_off_keeps_the_existing_policy_everywhere(client, monkeypatch):
    monkeypatch.setattr(MW, "_CSP_STRICT_ENABLED", False)
    assert "'unsafe-inline'" in _directive(_csp(client, "/app"), "script-src")
    assert "'unsafe-inline'" in _directive(_csp(client, "/marketplace"), "script-src")


def test_flag_on_strips_unsafe_inline_from_every_spa_route(client, monkeypatch):
    monkeypatch.setattr(MW, "_CSP_STRICT_ENABLED", True)
    for path in ("/app", "/marketplace", "/chat", "/org"):
        csp = _csp(client, path)
        assert "'unsafe-inline'" not in _directive(csp, "script-src"), path
        assert "'self'" in _directive(csp, "script-src")
        # style-src is a separate, much larger project and must be untouched
        assert "'unsafe-inline'" in _directive(csp, "style-src"), path


def test_flag_on_leaves_non_spa_pages_alone(client, monkeypatch):
    monkeypatch.setattr(MW, "_CSP_STRICT_ENABLED", True)
    for path in ("/", "/static/templates/habit_tracker.html"):
        assert "'unsafe-inline'" in _directive(_csp(client, path), "script-src"), path


def test_strict_policy_keeps_frame_ancestors_and_third_party_hosts(client, monkeypatch):
    monkeypatch.setattr(MW, "_CSP_STRICT_ENABLED", True)
    csp = _csp(client, "/app")
    # /app is same-origin framable (device-preview harness), like before
    assert "frame-ancestors 'self'" in csp
    assert "https://js.sentry-cdn.com" in _directive(csp, "script-src")
    assert "https://plausible.io" in _directive(csp, "script-src")


def test_paystack_inline_script_host_is_allowed(client):
    # agLoadPaystackScript() injects https://js.paystack.co/v1/inline.js; the host
    # used to be only in frame-src, so the browser blocked the script itself.
    csp = _csp(client, "/app")
    assert "https://js.paystack.co" in _directive(csp, "script-src")
    assert "https://checkout.paystack.com" in _directive(csp, "frame-src")


# ── the durable guard: the SPA HTML must stay CSP-strict-clean ────────────

def _spa_html(client):
    return client.get("/app").text


def test_spa_html_has_no_executable_inline_script(client):
    tags = re.findall(r"<script\b([^>]*)>", _spa_html(client))
    offenders = [t for t in tags if "src=" not in t and "application/json" not in t]
    assert offenders == [], (
        "Inline <script> in the SPA breaks CSP_STRICT_APP -- move it to js/boot/ "
        f"or a feature file: {offenders}"
    )


def test_spa_html_has_no_inline_event_handler_attributes(client):
    hits = re.findall(r'(?<![-\w])on[a-z]+\s*=\s*["\']', _spa_html(client))
    assert hits == [], (
        "Inline on*= handler in the SPA breaks CSP_STRICT_APP -- use "
        f"data-on* via js/core/delegate.js instead: {hits[:5]}"
    )


def test_config_json_block_cannot_be_closed_early(client, monkeypatch):
    """SIVARR_CONFIG is rendered into <script type="application/json">, so an env
    value containing </script> must never terminate the tag."""
    monkeypatch.setattr(app_module, "PLAUSIBLE_DOMAIN", "x</script><b>y")
    monkeypatch.setattr(app_module, "_APP_HTML_CACHE", None)
    try:
        html = client.get("/app").text
    finally:
        app_module._APP_HTML_CACHE = None
    m = re.search(r'<script type="application/json" id="sivarr-config">(.*?)</script>', html, re.S)
    assert m, "config block missing"
    assert "<" not in m.group(1)
    assert "\\u003c/script" in m.group(1)
