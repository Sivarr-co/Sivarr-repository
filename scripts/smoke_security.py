#!/usr/bin/env python3
"""
Multi-worker security smoke checks (run against STAGING, never prod).

These cover the paths that can't be verified on a single local worker:
  1. P1 cross-worker session revocation + 30s re-validation window
  2. P2 account lockout + whether it's Redis-shared across workers

Requires a PRE-VERIFIED staging account (register once, click the verify email),
so no DB access is needed. The account WILL be password-cycled and locked for
~15 min by check 2 — use a throwaway account on a throwaway DB.

Usage (PowerShell):
  $env:BASE_URL="https://sivarr-staging.up.railway.app"
  $env:TEST_EMAIL="smoketest@example.com"
  $env:TEST_PASS="password123"
  python scripts/smoke_security.py

Usage (bash):
  BASE_URL=... TEST_EMAIL=... TEST_PASS=... python scripts/smoke_security.py

Exit code 0 = all checks passed.
"""
import os, sys, time, json, urllib.request, urllib.error

BASE  = os.environ.get("BASE_URL", "").rstrip("/")
EMAIL = os.environ.get("TEST_EMAIL", "")
PASS  = os.environ.get("TEST_PASS", "")
if not (BASE and EMAIL and PASS):
    sys.exit("Set BASE_URL, TEST_EMAIL, TEST_PASS environment variables.")

def req(method, path, body=None, token=None, xff=None):
    r = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
    )
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", "Bearer " + token)   # also exercises the P3a Bearer middleware
    if xff:   r.add_header("X-Forwarded-For", xff)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}

def login(pw):
    s, d = req("POST", "/api/login", {"action": "login", "email": EMAIL, "password": pw})
    return d.get("token"), s, d

def authed(token):
    # GET endpoint that only needs a valid session; 200 = alive, 401 = revoked
    return req("GET", "/api/group/list", token=token)[0]

results = []
def record(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    results.append(ok)

print(f"== Target: {BASE} ==\n")

# ── Check 1: cross-worker session revocation + re-validation (P1) ──────────────
print("== Check 1: cross-worker session revocation (P1) ==")
tA, sA, dA = login(PASS)
tB, sB, dB = login(PASS)
if not (tA and tB):
    record("login as test account", False, f"got {sA}/{sB} {dA or dB} — is the account verified?")
else:
    record("two sessions issued + both valid", authed(tA) == 200 and authed(tB) == 200)
    NEW = PASS + "_smoke"
    sc, _ = req("POST", "/api/auth/change-password",
                {"token": tA, "current_password": PASS, "new_password": NEW}, token=tA)
    print(f"    change-password (revokes other sessions): HTTP {sc}")
    # Poll the OTHER token; LB round-robins so this hits multiple workers.
    killed = False
    for i in range(8):                      # up to ~35s (revalidation window is 30s)
        if authed(tB) == 401:
            killed = True
            print(f"    token B died after ~{i*5}s")
            break
        time.sleep(5)
    record("other-device token revoked within ~30s across workers", killed)
    record("current-device token still alive", authed(tA) == 200)
    # revert the password so the account is reusable
    req("POST", "/api/auth/change-password",
        {"token": tA, "current_password": NEW, "new_password": PASS}, token=tA)
    print("    (password reverted)")

# ── Check 2: account lockout + Redis-shared (P2) ──────────────────────────────
print("\n== Check 2: account lockout + Redis-shared (P2) ==")
print("  NOTE: this locks the test account for ~15 min and waits ~65s.")
n = 0
for i in range(15):
    _tok, s, d = login("wrong_" + str(i))
    n += 1
    if s == 429:
        break
print(f"  hit 429 after {n} attempts (IP rate-limit and lockout both ~10).")
print("  waiting 65s for the IP rate-limit window to clear...")
time.sleep(65)
_, s2, d2 = login("wrong_after_window")
msg = json.dumps(d2).lower()
still_locked = (s2 == 429 and "lock" in msg)
record("account still LOCKED after rate-limit window (=> Redis-shared lockout)",
       still_locked,
       "if this FAILS, REDIS_URL is unset or lockout isn't shared across workers")

print("\n== RESULT:", "ALL PASS ==" if all(results) else f"FAILURES ({results.count(False)}) ==")
sys.exit(0 if all(results) else 1)
