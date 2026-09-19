"""Source-level guards for stored-XSS fixes in browser JS.

sanitize_text() does not strip HTML, so any user-chosen string that another
user's browser renders must be escaped at render time. Two were live:

  - The org name went raw into every member's sidebar row (js/app.js
    spaceRenderSidebar), so an org owner could run script in each member.
  - The "you've been invited" prompt put the inviting org's name raw into
    siModal.confirm(), so anyone able to create an org could run script in
    any invitee's browser the moment they logged in.

siModal.input()/form() also dropped placeholders raw into an attribute, so a
name containing a quote broke out of the attribute.

Same style as tests/test_url_safety.py: cheap string checks that fail loudly
if someone reverts to interpolating the raw value. The behavioural check
(hostile org/task/goal/announcement/doc/chat data opened as a member, no
script executing) was run in a real browser when this was fixed.
"""

from pathlib import Path


def _read(p):
    return Path(p).read_text(encoding="utf-8")


def test_sidebar_space_row_escapes_the_space_name():
    app = _read("js/app.js")
    assert 'data-tip="${esc(sp.name)}"' in app
    assert '<span class="si-lb">${esc(sp.name)}</span>' in app
    assert 'data-tip="${sp.name}"' not in app
    assert '<span class="si-lb">${sp.name}</span>' not in app


def test_org_invite_prompt_escapes_the_inviting_orgs_name():
    org = _read("js/features/org.js")
    assert "${esc(inv.org_name)}" in org
    assert "invited to join ${inv.org_name} as ${inv.role}.`" not in org


def test_simodal_placeholders_are_escaped():
    app = _read("js/app.js")
    assert 'placeholder="${esc(placeholder)}"' in app
    assert 'placeholder="${placeholder}"' not in app
    assert 'placeholder="${f.placeholder || ""}"' not in app
    assert app.count('placeholder="${esc(f.placeholder || "")}"') == 2


def test_key_result_unit_is_escaped_in_its_modal_label():
    org = _read("js/features/org.js")
    assert "${esc(unit)}" in org
    assert "target: ${target}${unit}" not in org


def test_there_is_one_escape_helper():
    """acEsc and mktEsc were byte-for-byte copies of dom.js's esc()."""
    for f in ("js/features/academic.js", "js/features/marketplace.js"):
        src = _read(f)
        assert "function acEsc" not in src and "function mktEsc" not in src
        assert "acEsc(" not in src and "mktEsc(" not in src
    assert _read("js/core/dom.js").count("const esc = ") == 1
