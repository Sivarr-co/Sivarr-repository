#!/usr/bin/env python3
"""
Comprehensive auth + security test suite for Sivarr.
Stdlib only — no pip deps. Run against a local server (file-mode or pgserver).

Usage:
  python scripts/test_auth_security.py --base http://127.0.0.1:8000

Checks:
  1. Input validation  — injection payloads, oversized fields, bad formats
  2. Anti-enumeration  — identical message + comparable timing for missing vs wrong-pw
  3. Cookie attributes — HttpOnly, SameSite, Secure, TTL, __Host- on HTTPS
  4. CSRF protection   — double-submit validation, exempt paths
  5. Session lifecycle — create / cookie-only auth / reload / revocation
  6. Password policy   — min 8 chars enforced, max-length bound
  7. Rate limiting     — rapid attempts trip 429 (opt-in)

Rate-limit note: the test waits briefly between requests so normal validation
tests don't exhaust the per-IP rate limit window.
"""
import argparse, json, sys, time, ssl, urllib.request, urllib.error, secrets

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
_results = []

def record(status, name, detail=""):
    _results.append((status, name, detail))
    icon = {"PASS": "[PASS]", "FAIL": "[FAIL]", "SKIP": "[skip]"}[status]
    print(f"  {icon}  {name}" + (f"  -- {detail}" if detail else ""))

def http(method, url, body=None, cookie=None, extra_headers=None, timeout=15):
    data, headers = None, {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    ctx = ssl.create_default_context()
    try:
        raw = urllib.request.urlopen(req, timeout=timeout, context=ctx)
    except urllib.error.HTTPError as e:
        raw = e
    except Exception as e:
        return None, {}, [], str(e)
    hdrs = {k.lower(): v for k, v in raw.headers.items()}
    sc = raw.headers.get_all("Set-Cookie") or []
    try: text = raw.read().decode("utf-8", "replace")
    except: text = ""
    return raw.status, hdrs, sc, text

def post(base, path, body=None, cookie=None, extra_headers=None):
    return http("POST", f"{base}{path}", body=body, cookie=cookie, extra_headers=extra_headers)

def session_cookie(set_cookies):
    """Return (cookie_str, attrs_lower) — handles __Host- and plain names."""
    for prefix in ("__Host-sivarr_session=", "sivarr_session="):
        for c in set_cookies:
            if c.startswith(prefix):
                val = c.split(";", 1)[0].split("=", 1)[1]
                name = prefix.rstrip("=")
                return f"{name}={val}", c.lower()
    return None, None

def csrf_val_from(set_cookies):
    for c in set_cookies:
        if c.startswith("sivarr_csrf="):
            return c.split(";", 1)[0].split("=", 1)[1], c.lower()
    return None, None

def register_user(base, name="Auth Test", password="TestPassword!1"):
    """Register a throwaway user; return (cookie_str, csrf_val, sid, email)."""
    email = f"auth_{secrets.token_hex(6)}@test.local"
    s, _, sc, txt = post(base, "/api/login", {
        "action": "register", "name": name, "email": email,
        "password": password, "confirm_password": password
    })
    if s != 200:
        return None, None, None, f"register failed {s}: {txt[:120]}"
    c, _ = session_cookie(sc)
    csrf, _ = csrf_val_from(sc)
    try: sid = json.loads(txt).get("sid", "")
    except: sid = ""
    return c, csrf, sid, email

# ─── 1. Input validation ──────────────────────────────────────────────────────

def check_input_validation(base):
    print("\n[1] Input validation — injection + format + length")

    # These MUST return 400 (format/length rejected before any auth attempt)
    must_reject_400 = [
        ("email missing @",           {"action":"login","email":"notanemail","password":"pw"}),
        ("empty email",               {"action":"login","email":"","password":"pw"}),
        ("whitespace-only email",     {"action":"login","email":"   ","password":"pw"}),
        ("password over max (201+)",  {"action":"login","email":"ok@test.com","password":"x"*201}),
        ("script tag in name (reg)",  {"action":"register","name":"<script>alert</script>",
                                       "email":f"n{secrets.token_hex(4)}@test.local",
                                       "password":"ValidPw!1","confirm_password":"ValidPw!1"}),
        ("name too short (reg)",      {"action":"register","name":"X",
                                       "email":f"n{secrets.token_hex(4)}@test.local",
                                       "password":"ValidPw!1","confirm_password":"ValidPw!1"}),
        ("digits-only name (reg)",    {"action":"register","name":"12345",
                                       "email":f"n{secrets.token_hex(4)}@test.local",
                                       "password":"ValidPw!1","confirm_password":"ValidPw!1"}),
        ("email too long (255+ raw)", {"action":"login","email":"a"*250+"@x.com",  # 256 raw > 254
                                       "password":"pw"}),
    ]
    for label, body in must_reject_400:
        time.sleep(0.5)
        s, _, _, txt = post(base, "/api/login", body)
        if s == 429:
            record(SKIP, f"Validation: {label} (rate-limited — rerun with higher RATE_LIMIT_LOGIN)")
        else:
            record(PASS if s in (400, 422) else FAIL,
                   f"Validation rejects (400/422): {label}", f"got {s}: {txt[:70]}")

    # HTML-in-email: strip_html removes the tags leaving a valid email format → normal 401/429.
    # This is correct behaviour — verify we do NOT get 500 or 200 (no crash, no bypass).
    time.sleep(0.4)
    s, _, _, txt = post(base, "/api/login",
                         {"action":"login","email":"<script>alert(1)</script>@x.com","password":"pw"})
    record(PASS if s in (400, 401, 429) else FAIL,
           "HTML-injected email handled safely (400/401, no 200/500)",
           f"got {s}: {txt[:70]}")

    time.sleep(0.4)
    s, _, _, txt = post(base, "/api/login",
                         {"action":"login","email":"a'--@x.com","password":"pw"})
    record(PASS if s in (400, 401, 429) else FAIL,
           "SQL-style email handled safely (no 500/200)", f"got {s}: {txt[:70]}")

    # Valid input must NOT be rejected as malformed
    time.sleep(0.4)
    s, _, _, _ = post(base, "/api/login", {"action":"login","email":"valid@example.com","password":"validpw"})
    record(PASS if s not in (400, 422) else FAIL,
           "Valid login input not rejected as malformed",
           f"got {s} (401=no account, 403=unverified — both fine)")

# ─── 2. Anti-enumeration ──────────────────────────────────────────────────────

def check_anti_enumeration(base, real_email):
    print("\n[2] Anti-enumeration — same message + timing for missing-user vs wrong-password")

    ghost = f"no_such_{secrets.token_hex(8)}@ghost.invalid"
    N = 2

    t0 = time.monotonic()
    msgs_ghost = []
    for _ in range(N):
        time.sleep(0.4)
        s, _, _, txt = post(base, "/api/login", {"action":"login","email":ghost,"password":"anything123"})
        try: msgs_ghost.append(json.loads(txt).get("detail",""))
        except: msgs_ghost.append(txt[:60])
    t_ghost = (time.monotonic() - t0) / N

    t0 = time.monotonic()
    msgs_wrong = []
    for _ in range(N):
        time.sleep(0.4)
        s, _, _, txt = post(base, "/api/login", {"action":"login","email":real_email,"password":"definitelywrong99"})
        try: msgs_wrong.append(json.loads(txt).get("detail",""))
        except: msgs_wrong.append(txt[:60])
    t_wrong = (time.monotonic() - t0) / N

    same_msg = len(set(msgs_ghost + msgs_wrong)) == 1
    record(PASS if same_msg else FAIL,
           "Identical error message for non-existent vs wrong-password",
           f"ghost={msgs_ghost[0]!r} wrong={msgs_wrong[0]!r}")

    ratio = min(t_ghost, t_wrong) / max(t_ghost, t_wrong) if max(t_ghost, t_wrong) > 0 else 1
    record(PASS if ratio >= 0.4 else FAIL,
           f"Comparable timing (ratio={ratio:.2f} >= 0.4, dummy-bcrypt equalisation)",
           f"ghost={t_ghost*1000:.0f}ms wrong={t_wrong*1000:.0f}ms")

    for msg in msgs_ghost[:1] + msgs_wrong[:1]:
        leaks_account = ("no account" in msg.lower() or "sign up" in msg.lower()
                         or "not found" in msg.lower())
        record(PASS if not leaks_account else FAIL,
               "Error message does not reveal account existence", msg[:80])

# ─── 3. Cookie attributes ──────────────────────────────────────────────────────

def check_cookie_attributes(base, set_cookies):
    print("\n[3] Cookie attributes")
    c_str, sess_attrs = session_cookie(set_cookies)
    csrf, csrf_attrs = csrf_val_from(set_cookies)

    if sess_attrs:
        record(PASS if "httponly" in sess_attrs else FAIL, "Session cookie: HttpOnly")
        record(PASS if "samesite=lax" in sess_attrs else FAIL, "Session cookie: SameSite=Lax")
        record(PASS if "max-age=" in sess_attrs else FAIL, "Session cookie: Max-Age TTL present")
        record(PASS if "path=/" in sess_attrs else FAIL, "Session cookie: Path=/")
        if base.startswith("https://"):
            record(PASS if "secure" in sess_attrs else FAIL, "Session cookie: Secure on HTTPS")
            is_host = bool(c_str and c_str.startswith("__Host-"))
            record(PASS if is_host else FAIL,
                   "Session cookie: __Host- prefix on HTTPS (prevents subdomain hijack)")
        else:
            record(SKIP, "Session cookie: Secure + __Host- (HTTP dev mode — plain name expected)")
    else:
        record(FAIL, "Session cookie found in Set-Cookie", "not found")

    if csrf_attrs:
        record(PASS if "httponly" not in csrf_attrs else FAIL,
               "CSRF cookie: NOT httpOnly (JS-readable for double-submit)")
        record(PASS if "samesite=strict" in csrf_attrs else FAIL, "CSRF cookie: SameSite=Strict")
        record(PASS if "max-age=" in csrf_attrs else FAIL, "CSRF cookie: Max-Age TTL present")
        record(PASS if (csrf and len(csrf) >= 20) else FAIL,
               "CSRF cookie: sufficient entropy (>=20 chars)")
    else:
        record(FAIL, "CSRF cookie (sivarr_csrf) found in Set-Cookie", "not found")

# ─── 4. CSRF validation ───────────────────────────────────────────────────────

def check_csrf(base, cookie, csrf_val):
    print("\n[4] CSRF double-submit validation")
    if not cookie:
        record(SKIP, "CSRF tests (no session)"); return
    if not csrf_val:
        record(SKIP, "CSRF tests (no CSRF cookie in response — feature not deployed?)"); return

    full_cookie = f"{cookie}; sivarr_csrf={csrf_val}"

    # Correct header -> 200
    s, _, _, _ = post(base, "/api/spaces/list", body={}, cookie=full_cookie,
                       extra_headers={"X-CSRF-Token": csrf_val})
    record(PASS if s == 200 else FAIL, "POST with correct X-CSRF-Token -> 200", f"got {s}")

    # Wrong token -> 403
    s, _, _, _ = post(base, "/api/spaces/list", body={}, cookie=full_cookie,
                       extra_headers={"X-CSRF-Token": "bad-token-xyz-000"})
    record(PASS if s == 403 else FAIL, "POST with wrong X-CSRF-Token -> 403", f"got {s}")

    # No CSRF header (cookie present) -> 403
    s, _, _, _ = post(base, "/api/spaces/list", body={}, cookie=full_cookie)
    record(PASS if s == 403 else FAIL, "POST without X-CSRF-Token (cookie present) -> 403", f"got {s}")

    # Empty header -> 403
    s, _, _, _ = post(base, "/api/spaces/list", body={}, cookie=full_cookie,
                       extra_headers={"X-CSRF-Token": ""})
    record(PASS if s == 403 else FAIL, "POST with empty X-CSRF-Token -> 403", f"got {s}")

    # GET requests: never CSRF-checked
    s, _, _, _ = http("GET", f"{base}/api/health", cookie=full_cookie)
    record(PASS if s in (200, 404) else FAIL, "GET requests exempt from CSRF", f"got {s}")

    # /api/login is CSRF-exempt (no session established yet on login)
    time.sleep(0.4)
    s, _, _, _ = post(base, "/api/login",
                       body={"action":"login","email":"x@x.com","password":"wrong"},
                       cookie=full_cookie)
    record(PASS if s in (400, 401, 429) else FAIL,
           "/api/login CSRF-exempt (no X-CSRF-Token required)", f"got {s}")

    # /api/auth/* routes exempt
    s, _, _, _ = post(base, "/api/auth/forgot-password",
                       body={"email":"x@test.com"}, cookie=full_cookie)
    record(PASS if s in (200, 400, 404, 429) else FAIL,
           "/api/auth/* routes CSRF-exempt", f"got {s}")

# ─── 5. Session lifecycle ─────────────────────────────────────────────────────

def check_session_lifecycle(base, cookie, csrf_val):
    print("\n[5] Session lifecycle")
    if not cookie:
        record(FAIL, "Session lifecycle (no session)"); return

    full_cookie = f"{cookie}; sivarr_csrf={csrf_val}" if csrf_val else cookie
    extra = {"X-CSRF-Token": csrf_val} if csrf_val else {}

    # Cookie-only POST (reload simulation: no body token, no Bearer header)
    s, _, _, _ = post(base, "/api/spaces/list", body={}, cookie=full_cookie, extra_headers=extra)
    record(PASS if s == 200 else FAIL, "Cookie-only POST authenticates (reload simulation)", f"got {s}")

    # Session restore endpoint with cookie only
    s, _, sc, txt = post(base, "/api/session/restore", body={},
                          cookie=full_cookie, extra_headers=extra)
    record(PASS if s == 200 else FAIL, "POST /api/session/restore cookie-only -> 200", f"got {s}")
    if s == 200:
        try:
            d = json.loads(txt)
            record(PASS if d.get("sid") and d.get("name") else FAIL,
                   "Session restore returns sid + name fields")
            # Restore re-issues CSRF cookie
            new_csrf, _ = csrf_val_from(sc)
            record(PASS if new_csrf else FAIL,
                   "Session restore re-issues CSRF cookie for new in-memory session")
        except Exception:
            record(FAIL, "Session restore response is valid JSON")

    # No auth -> 401
    s, _, _, _ = post(base, "/api/spaces/list", body={})
    record(PASS if s == 401 else FAIL, "No auth -> 401 (unauthenticated access blocked)", f"got {s}")

    # Logout
    s, _, _, _ = post(base, "/api/logout", body={"token":""}, cookie=full_cookie, extra_headers=extra)
    record(PASS if s == 200 else FAIL, "Logout -> 200", f"got {s}")

    # Same cookie rejected after logout
    s, _, _, _ = post(base, "/api/spaces/list", body={}, cookie=full_cookie, extra_headers=extra)
    record(PASS if s == 401 else FAIL, "Cookie rejected after logout -> 401 (revoked)", f"got {s}")

# ─── 6. Password policy ───────────────────────────────────────────────────────

def check_password_policy(base):
    print("\n[6] Password policy")

    def reg(pw, cpw=None, name="Policy Test"):
        time.sleep(0.5)
        e = f"pw_{secrets.token_hex(4)}@test.local"
        s, _, _, txt = post(base, "/api/login", {
            "action":"register", "name":name, "email":e,
            "password":pw, "confirm_password": cpw if cpw is not None else pw
        })
        return s, txt[:80]

    for label, pw, cpw, expected in [
        ("Password <8 chars rejected (400)", "short", None, 400),
        ("Password >200 chars rejected (400)", "x"*201, None, 400),
        ("Password confirmation mismatch rejected (400)", "ValidPass!1", "ValidPass!2", 400),
        ("Valid 8-char password accepted (200)", "Abcdef!1", None, 200),
    ]:
        s, t = reg(pw, cpw)
        if s == 429:
            record(SKIP, f"{label} (rate-limited — rerun with higher RATE_LIMIT_LOGIN)")
        else:
            record(PASS if s == expected else FAIL, label, f"got {s}: {t}")

# ─── 7. Rate limiting ─────────────────────────────────────────────────────────

def check_rate_limit(base):
    print("\n[7] Rate limiting")
    codes = []
    for i in range(14):
        s, _, _, _ = post(base, "/api/login",
                          body={"action":"login","email":f"rl_{secrets.token_hex(4)}@smoke.local",
                                "password":"wrong"})
        codes.append(s)
        if s == 429:
            break
    record(PASS if 429 in codes else FAIL,
           f"Rapid bad-login attempts trip 429 (after {len(codes)} tries)", f"codes={codes[-6:]}")

# ─── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Sivarr comprehensive auth+security tests")
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--skip-rate-limit", action="store_true",
                    help="Skip rate-limit probe (avoids tripping lockouts for other tests)")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    print(f"=== Sivarr auth+security test suite -> {base} ===")
    s, _, _, txt = http("GET", f"{base}/health")
    if s is None:
        print(f"  Cannot reach {base}: {txt}"); sys.exit(2)
    print(f"  /health -> {s}")

    # Register one user once and reuse throughout (minimises /api/login calls)
    print("\n[setup] Registering test user...")
    cookie, csrf_val, sid, user_info = register_user(base)
    if not cookie:
        print(f"  FATAL: could not register test user — {user_info}")
        print("  (Is the server running? Is it rate-limiting? Wait 60s and retry.)")
        sys.exit(2)
    print(f"  Registered: {user_info} | cookie={'yes' if cookie else 'no'} csrf={'yes' if csrf_val else 'no'}")

    # Fetch raw Set-Cookie headers for cookie-attribute checks
    _, _, sc_raw, _ = post(base, "/api/login", {
        "action":"register", "name":"CookieAttr", "email":f"ca_{secrets.token_hex(4)}@test.local",
        "password":"TestPassword!1", "confirm_password":"TestPassword!1"
    })

    # Run checks that DON'T fire many bad requests first (avoid rate limiting for later tests)
    check_cookie_attributes(base, sc_raw)
    check_csrf(base, cookie, csrf_val)
    check_session_lifecycle(base, cookie, csrf_val)  # note: this logs out the user

    # These re-register for their own session or send bad-credential requests
    real_email = user_info if isinstance(user_info, str) and "@" in user_info else ""
    check_anti_enumeration(base, real_email)

    # Validation test fires many login calls — run AFTER tests that need a clean rate-limit window
    time.sleep(2)   # brief pause to let any short rate-limit window clear before validation tests
    check_input_validation(base)

    if not args.skip_rate_limit:
        check_rate_limit(base)
    else:
        print("\n[7] Rate limiting -- SKIPPED")

    check_password_policy(base)

    passed  = sum(1 for s, *_ in _results if s == PASS)
    failed  = sum(1 for s, *_ in _results if s == FAIL)
    skipped = sum(1 for s, *_ in _results if s == SKIP)
    print(f"\n{'='*50}")
    print(f"  {passed} passed  |  {failed} failed  |  {skipped} skipped")
    print(f"{'='*50}")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
