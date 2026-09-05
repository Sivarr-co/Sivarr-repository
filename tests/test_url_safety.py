"""URL scheme validation.

Escaping is not enough for an href. acEsc/esc/mktEsc escape & < > " ' which stops
an attacker breaking OUT of the attribute, but leaves the SCHEME intact, so
`javascript:...` survives escaping and runs when a victim clicks. script-src
still carries 'unsafe-inline' (Session 19), which is what permits that.

Two stored values are chosen by users rather than by us:
  - a lecturer's live-class link, rendered to every student in the class
  - an opportunity's link, postable by any account and rendered to everyone
    browsing the board

Both are guarded server-side by core.safe_url and again at render by
js/core/dom.js's safeUrl().
"""

import pytest

from core import safe_url


@pytest.mark.parametrize("url", [
    "https://example.com/paper",
    "http://example.com",
    "mailto:someone@example.com",
    "/app/dashboard",
    "#section",
    "",
])
def test_safe_urls_pass_through(url):
    assert safe_url(url) == url


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",      # browsers ignore the tab when resolving
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
])
def test_dangerous_schemes_are_dropped(url):
    assert safe_url(url) == "", f"dangerous scheme survived: {url!r}"


def test_length_is_still_capped():
    assert len(safe_url("https://example.com/" + "a" * 999, 100)) <= 100


def test_the_two_user_controlled_call_sites_use_it():
    """Guards against someone reverting to a bare sanitize_text() later."""
    from pathlib import Path
    acad = Path("routes/academic.py").read_text()
    assert 'safe_url(str(data.get("link", "")), 500)' in acad, \
        "acad live/set no longer validates its link scheme"
    app_py = Path("app.py").read_text()
    assert 'link     = safe_url(str(data.get("link","")), 200)' in app_py, \
        "opportunity submission no longer validates its link scheme"


def test_every_rendered_href_goes_through_safeUrl():
    """Every href built from interpolated data must wrap it in safeUrl()."""
    import re
    from pathlib import Path
    offenders = []
    for f in ["js/app.js", "js/features/academic.js", "js/features/agents.js",
              "js/features/marketplace.js", "js/features/org.js",
              "js/features/docs_notes.js", "js/features/tasks.js"]:
        p = Path(f)
        if not p.exists():
            continue
        for m in re.finditer(r'href="\$\{([^}]{1,120})\}', p.read_text()):
            if "safeUrl" not in m.group(1):
                offenders.append(f"{f}: {m.group(1)[:60]}")
    assert not offenders, "href built from data without safeUrl():\n  " + "\n  ".join(offenders)
