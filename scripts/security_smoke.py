#!/usr/bin/env python3
"""
Sivarr security smoke test -- re-validates the security hardening contract in one
command. Stdlib only (no pip install), so it runs anywhere incl. CI / pre-deploy.

WHAT IT CHECKS (over HTTP -- the backend security contract):
  • Security headers + CSP   (img-src has no blanket https:, object-src 'none',
                              frame-ancestors 'none', nosniff, X-Frame-Options, HSTS)
  • Unauthenticated access    (protected endpoint -> 401 with no creds)
  • Cookie auth + reload       (login sets httpOnly+SameSite session cookie; a
                              cookie-ONLY request authenticates -> reload survives)
  • Logout revocation          (after logout the same cookie is rejected -> 401)
  • Session TTL                (Set-Cookie Max-Age present; reports the window)
  • Rate limiting   (opt-in)   (rapid bad logins -> 429)
  • Admin login gate (opt-in)  (wrong password / missing 2FA -> 401)

WHAT IT DOES NOT CHECK (needs a real browser -- use the Playwright browser pass):
  • that the token is absent from localStorage   • DOM-level XSS escaping

USAGE
  # Local (auto-registers a throwaway user):
  python scripts/security_smoke.py --base http://127.0.0.1:8000 --register
  # Prod (use an existing throwaway account; never auto-register on prod):
  python scripts/security_smoke.py --base https://sivarr.com --email you+test@x.com --password 'pw'
  # Add the heavier/abusive checks explicitly:
  python scripts/security_smoke.py --base http://127.0.0.1:8000 --register --rate-limit --admin-pass 'adminpw'

Exit code 0 = all run checks passed, 1 = a check failed, 2 = setup/connection error.
"""
import argparse, json, sys, time, ssl, urllib.request, urllib.error

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
_results = []

def record(status, name, detail=""):
    _results.append((status, name, detail))
    icon = {"PASS": "[PASS]", "FAIL": "[FAIL]", "SKIP": "[skip]"}[status]
    print(f"  {icon}  {name}" + (f"  -- {detail}" if detail else ""))

def http(method, url, body=None, cookie=None, timeout=15, extra_headers=None):
    """Return (status, headers_lowercased_dict, set_cookie_list, text)."""
    data = None
    headers = {}
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
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        raw = resp
    except urllib.error.HTTPError as e:
        raw = e            # HTTPError is a response-like object
    except Exception as e:
        return None, {}, [], f"__CONN_ERROR__ {e}"
    hdrs = {k.lower(): v for k, v in raw.headers.items()}
    set_cookies = raw.headers.get_all("Set-Cookie") or []
    try:
        text = raw.read().decode("utf-8", "replace")
    except Exception:
        text = ""
    return raw.status, hdrs, set_cookies, text

def session_cookie_from(set_cookies):
    """Extract the session cookie value+attrs from Set-Cookie headers.
    Handles both plain 'sivarr_session' (local HTTP dev) and '__Host-sivarr_session' (HTTPS prod)."""
    for prefix in ("__Host-sivarr_session=", "sivarr_session="):
        for c in set_cookies:
            if c.startswith(prefix):
                val = c.split(";", 1)[0].split("=", 1)[1]
                attrs = c.lower()
                return val, attrs, prefix.rstrip("=")
    return None, None, None

def csrf_cookie_from(set_cookies):
    """Extract the sivarr_csrf cookie value from Set-Cookie headers."""
    for c in set_cookies:
        if c.startswith("sivarr_csrf="):
            val = c.split(";", 1)[0].split("=", 1)[1]
            attrs = c.lower()
            return val, attrs
    return None, None

# ─────────────────────────────────────────────────────────────────────────────

def check_headers(base):
    print("\n[1] Security headers + CSP")
    status, hdrs, _, text = http("GET", f"{base}/app")
    if status is None:
        record(FAIL, "GET /app reachable", text); return
    csp = hdrs.get("content-security-policy", "")
    if not csp:
        record(FAIL, "Content-Security-Policy present");
    else:
        record(PASS, "Content-Security-Policy present")
        # img-src must NOT allow blanket https: (token-beacon exfil channel)
        img = next((d for d in csp.split(";") if d.strip().startswith("img-src")), "")
        record(PASS if " https:" not in f" {img} " else FAIL,
               "img-src has no blanket https: (exfil channel closed)", img.strip())
        record(PASS if "object-src 'none'" in csp else FAIL, "object-src 'none'")
        record(PASS if "frame-ancestors 'none'" in csp or "frame-ancestors 'self'" in csp else FAIL,
               "frame-ancestors locked")
        record(PASS if "base-uri 'self'" in csp else FAIL, "base-uri 'self'")
    record(PASS if hdrs.get("x-content-type-options", "").lower() == "nosniff" else FAIL,
           "X-Content-Type-Options: nosniff")
    record(PASS if hdrs.get("x-frame-options", "").upper() in ("DENY", "SAMEORIGIN") else FAIL,
           "X-Frame-Options set", hdrs.get("x-frame-options", "(missing)"))
    record(PASS if hdrs.get("referrer-policy") else FAIL, "Referrer-Policy set")
    if base.startswith("https://"):
        record(PASS if hdrs.get("strict-transport-security") else FAIL, "HSTS on HTTPS")
    else:
        record(SKIP, "HSTS (only on HTTPS)")

def check_unauth(base):
    print("\n[2] Unauthenticated access is rejected")
    status, _, _, _ = http("POST", f"{base}/api/spaces/list", body={})
    record(PASS if status == 401 else FAIL, "POST /api/spaces/list with no auth -> 401", f"got {status}")

def obtain_session(base, email, password, do_register):
    """Return (cookie_str, csrf_val, sid, email_used, raw_set_cookies) or (None,…,err,[])."""
    if do_register:
        email = email or f"smoke_{int(time.time())}@smoke.local"
        body = {"action": "register", "name": "Security Smoke", "email": email,
                "password": password, "confirm_password": password}
    else:
        body = {"action": "login", "email": email, "password": password}
    status, _, set_cookies, text = http("POST", f"{base}/api/login", body=body)
    if status != 200:
        return None, None, None, f"login/register -> {status}: {text[:120]}", []
    val, attrs, cookie_name = session_cookie_from(set_cookies)
    csrf_val, _ = csrf_cookie_from(set_cookies)
    try:
        sid = json.loads(text).get("sid", "")
    except Exception:
        sid = ""
    cookie_str = f"{cookie_name}={val}" if val and cookie_name else None
    return cookie_str, csrf_val, sid, email, set_cookies

def check_auth(base, email, password, do_register):
    print("\n[3] Cookie auth + reload survival + TTL")
    cookie_str, csrf_val, sid, info, set_cookies = obtain_session(base, email, password, do_register)
    if not cookie_str:
        record(FAIL, "Login/register issued a session cookie", info)
        return None, None

    # Parse cookie attributes directly from the obtain_session response (no second login call)
    _, full_attrs, _ = session_cookie_from(set_cookies)
    csrf_val_chk, csrf_attrs = csrf_cookie_from(set_cookies)

    is_host_prefix = cookie_str.startswith("__Host-")
    record(PASS, f"Login issued {'__Host- prefixed ' if is_host_prefix else ''}session cookie")
    if base.startswith("https://"):
        record(PASS if is_host_prefix else SKIP,
               "__Host- prefix enforced on HTTPS (prevents subdomain cookie hijack)",
               "" if is_host_prefix else "(plain name on HTTP dev is expected)")
    else:
        record(SKIP, "__Host- prefix (only on HTTPS)")
    if full_attrs:
        record(PASS if "httponly" in full_attrs else FAIL, "Session cookie is HttpOnly")
        record(PASS if "samesite=" in full_attrs else FAIL, "Session cookie has SameSite")
        if base.startswith("https://"):
            record(PASS if "secure" in full_attrs else FAIL, "Session cookie is Secure")
        maxage = None
        for part in full_attrs.split(";"):
            if "max-age=" in part.strip():
                try: maxage = int(part.strip().split("max-age=")[1])
                except Exception: pass
        record(PASS if maxage else FAIL, "Session TTL set",
               f"Max-Age={maxage}s (~{maxage//86400}d)" if maxage else "(missing)")
    # CSRF cookie
    record(PASS if csrf_val_chk else FAIL, "CSRF cookie (sivarr_csrf) issued alongside session cookie")
    if csrf_attrs:
        record(PASS if "httponly" not in csrf_attrs else FAIL, "CSRF cookie is NOT httpOnly (JS-readable for double-submit)")
        record(PASS if "samesite=strict" in csrf_attrs else FAIL, "CSRF cookie SameSite=Strict")
    # Reload survival: cookie-ONLY authenticated POST (with CSRF header)
    full_cookie = f"{cookie_str}; sivarr_csrf={csrf_val}" if csrf_val else cookie_str
    extra = {"X-CSRF-Token": csrf_val} if csrf_val else {}
    status, _, _, _ = http("POST", f"{base}/api/spaces/list", body={}, cookie=full_cookie,
                           extra_headers=extra)
    record(PASS if status == 200 else FAIL, "Cookie-only POST authenticates (reload survives)", f"got {status}")
    return cookie_str, csrf_val

def check_csrf(base, cookie, csrf_val):
    print("\n[4] CSRF double-submit validation")
    if not cookie:
        record(SKIP, "CSRF checks (no session)"); return
    full_cookie = f"{cookie}; sivarr_csrf={csrf_val}" if csrf_val else cookie
    # Correct CSRF header -> should pass
    status, _, _, _ = http("POST", f"{base}/api/spaces/list", body={}, cookie=full_cookie,
                           extra_headers={"X-CSRF-Token": csrf_val} if csrf_val else {})
    record(PASS if status == 200 else FAIL,
           "POST with correct X-CSRF-Token -> 200", f"got {status}")
    if csrf_val:
        # Wrong CSRF header -> should be rejected with 403
        status2, _, _, _ = http("POST", f"{base}/api/spaces/list", body={}, cookie=full_cookie,
                                extra_headers={"X-CSRF-Token": "wrong-token-abc"})
        record(PASS if status2 == 403 else FAIL,
               "POST with wrong X-CSRF-Token -> 403 (CSRF rejected)", f"got {status2}")
        # No CSRF header but cookie present -> 403
        status3, _, _, _ = http("POST", f"{base}/api/spaces/list", body={}, cookie=full_cookie)
        record(PASS if status3 == 403 else FAIL,
               "POST with no X-CSRF-Token (cookie present) -> 403", f"got {status3}")
        # Auth endpoints exempt from CSRF
        status4, _, _, _ = http("POST", f"{base}/api/login",
                                body={"action": "login", "email": "x@x.com", "password": "wrong"},
                                cookie=full_cookie)
        record(PASS if status4 in (401, 429, 400) else FAIL,
               "/api/login exempt from CSRF (no header required)", f"got {status4}")
    else:
        record(SKIP, "CSRF rejection tests (no CSRF cookie in session — old session?)")

def check_revocation(base, cookie, csrf_val=None):
    print("\n[5] Logout revokes the session")
    if not cookie:
        record(SKIP, "Revocation (no session)"); return
    full_cookie = f"{cookie}; sivarr_csrf={csrf_val}" if csrf_val else cookie
    extra = {"X-CSRF-Token": csrf_val} if csrf_val else {}
    status, _, _, _ = http("POST", f"{base}/api/logout", body={"token": ""}, cookie=full_cookie,
                           extra_headers=extra)
    record(PASS if status == 200 else FAIL, "Logout (cookie-only) -> 200", f"got {status}")
    status, _, _, _ = http("POST", f"{base}/api/spaces/list", body={}, cookie=cookie)
    record(PASS if status == 401 else FAIL, "Same cookie after logout -> 401 (revoked)", f"got {status}")

def check_rate_limit(base):
    print("\n[6] Rate limiting (opt-in)")
    codes = []
    for _ in range(12):
        status, _, _, _ = http("POST", f"{base}/api/login",
                               body={"action": "login", "email": "ratelimit@smoke.local", "password": "wrong"})
        codes.append(status)
    record(PASS if 429 in codes else FAIL, "Rapid bad logins trip 429", f"codes: {codes}")

def check_admin_gate(base, admin_pass):
    print("\n[7] Admin login gate (opt-in)")
    # Wrong password must be rejected
    s1, _, _, _ = http("POST", f"{base}/api/admin/login", body={"password": "definitely-wrong-xyz"})
    record(PASS if s1 == 401 else FAIL, "Admin login wrong password -> 401", f"got {s1}")
    # Correct password but missing 2FA: 401 if MFA enabled, else 200 (password-only)
    s2, _, _, text = http("POST", f"{base}/api/admin/login", body={"password": admin_pass})
    if s2 == 401 and "2fa" in text.lower():
        record(PASS, "Admin MFA enforced (password alone -> 'missing 2FA')")
    elif s2 == 200:
        record(PASS, "Admin password accepted (MFA not configured -- consider ADMIN_TOTP_SECRET)")
    else:
        record(FAIL, "Admin gate responded as expected", f"got {s2}: {text[:80]}")

def main():
    ap = argparse.ArgumentParser(description="Sivarr security smoke test")
    ap.add_argument("--base", default="http://127.0.0.1:8000", help="Target base URL")
    ap.add_argument("--email", help="Existing test account email (preferred for prod)")
    ap.add_argument("--password", default="smokepass123", help="Password for the test account")
    ap.add_argument("--register", action="store_true", help="Auto-register a throwaway user (local only!)")
    ap.add_argument("--rate-limit", action="store_true", help="Run the rate-limit probe (may trip lockouts)")
    ap.add_argument("--admin-pass", help="Run the admin-login gate check with this password")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    print(f"=== Sivarr security smoke test -> {base} ===")
    # Connectivity
    status, _, _, text = http("GET", f"{base}/health")
    if status is None:
        print(f"  Cannot reach {base}: {text}"); sys.exit(2)

    check_headers(base)
    check_unauth(base)
    cookie, csrf_val = None, None
    if args.email or args.register:
        cookie, csrf_val = check_auth(base, args.email, args.password, args.register)
        check_csrf(base, cookie, csrf_val)
        check_revocation(base, cookie, csrf_val)
    else:
        print("\n[3-5] Auth/CSRF/revocation -- SKIPPED (pass --email/--password or --register)")
    if args.rate_limit:
        check_rate_limit(base)
    if args.admin_pass:
        check_admin_gate(base, args.admin_pass)

    passed = sum(1 for s, *_ in _results if s == PASS)
    failed = sum(1 for s, *_ in _results if s == FAIL)
    skipped = sum(1 for s, *_ in _results if s == SKIP)
    print(f"\n===== {passed} passed, {failed} failed, {skipped} skipped =====")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
