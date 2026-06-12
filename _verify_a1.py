"""A1 verification: subscription verify now checks amount/currency/owner + idempotency.
Mocks the Paystack/Flutterwave verify HTTP call with canned responses."""
import app
from fastapi.testclient import TestClient

# ── Mock the provider HTTP client ────────────────────────────────────
HOLDER = {"payload": {}}
class _Resp:
    def json(self): return HOLDER["payload"]
class _Client:
    def __init__(self, *a, **k): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get(self, *a, **k): return _Resp()
    async def post(self, *a, **k): return _Resp()
app._httpx.AsyncClient = _Client
app.PAYSTACK_AVAILABLE = True
app.FLUTTERWAVE_AVAILABLE = True
app.HTTPX_AVAILABLE = True

c = TestClient(app.app, raise_server_exceptions=False)
def check(n, cond): print(f"[{'PASS' if cond else 'FAIL'}] {n}"); return cond
ok = True

SID = "a1probe_" + "x" * 8
TOK = app.create_session_token(SID, "A1 Probe", "a1@example.com")

def ps(ref, payload):
    HOLDER["payload"] = payload
    return c.get(f"/api/billing/verify/{ref}?token={TOK}")
def flw(ref, payload, qp=""):
    HOLDER["payload"] = payload
    return c.get(f"/api/billing/flutterwave/verify/{ref}?token={TOK}{qp}")

def ps_payload(amount, cur="NGN", plan="pro_monthly", owner=SID):
    return {"status": True, "data": {"status": "success", "amount": amount, "currency": cur,
            "metadata": {"sivarr_sid": owner, "plan_id": plan}}}
def flw_payload(amount, cur="NGN", plan="pro_monthly", owner=SID):
    return {"status": "success", "data": {"status": "successful", "amount": amount,
            "currency": cur, "meta": {"plan_id": plan, "sid": owner}}}

# ── Paystack ─────────────────────────────────────────────────────────
r = ps("PS-OK", ps_payload(250000))                  # ₦2,500 in kobo, full
ok &= check(f"PS full pro_monthly -> 200 (got {r.status_code})", r.status_code == 200)
ok &= check("PS grants pro_monthly", r.json().get("plan") == "pro_monthly")

r = ps("PS-LOW", ps_payload(100))                    # ₦1 paid, claim pro
ok &= check(f"PS underpayment -> 400 (got {r.status_code})", r.status_code == 400)

r = ps("PS-CUR", ps_payload(250000, cur="USD"))      # wrong currency
ok &= check(f"PS wrong currency -> 400 (got {r.status_code})", r.status_code == 400)

r = ps("PS-CLAIM-TEAM", ps_payload(250000, plan="team_monthly"))  # ₦2,500 but claims Team(₦8,000)
ok &= check(f"PS claim Team with pro amount -> 400 (got {r.status_code})", r.status_code == 400)

r = ps("PS-OTHER", ps_payload(250000, owner="someone_else_sid"))  # replay another user's ref
ok &= check(f"PS cross-user reference -> 403 (got {r.status_code})", r.status_code == 403)

r = ps("PS-OK", ps_payload(250000))                  # same ref as first -> idempotent
ok &= check(f"PS idempotent replay -> 200 (got {r.status_code})", r.status_code == 200)
ok &= check("PS idempotent flagged", r.json().get("idempotent") is True)

# ── Flutterwave (the directly-exploitable one) ──────────────────────
# Pay for pro (meta), try to claim team via ?plan_id=team_monthly query param
r = flw("FLW-EXPLOIT", flw_payload(2500, plan="pro_monthly"), qp="&plan_id=team_monthly")
ok &= check(f"FLW ?plan_id swap -> 200 (got {r.status_code})", r.status_code == 200)
granted = (r.json().get("plan") or {}).get("plan")
ok &= check(f"FLW ignores query plan_id, grants pro_monthly (got {granted!r})",
            granted == "pro_monthly")

r = flw("FLW-CLAIM-TEAM", flw_payload(2500, plan="team_monthly"))  # ₦2,500 but meta says Team(₦8,000)
ok &= check(f"FLW underpay for Team -> 400 (got {r.status_code})", r.status_code == 400)

r = flw("FLW-OTHER", flw_payload(2500, owner="someone_else_sid"))  # cross-user
ok &= check(f"FLW cross-user reference -> 403 (got {r.status_code})", r.status_code == 403)

r = flw("FLW-TEAM-OK", flw_payload(8000, plan="team_monthly"))     # legit Team payment
ok &= check(f"FLW full Team payment -> 200 (got {r.status_code})", r.status_code == 200)

# cleanup local progress file for the probe sid
import os
try:
    pth = app.ppath(SID)
    if os.path.exists(pth): os.remove(pth)
    bk = str(pth).replace(".json", ".backup.json")
    if os.path.exists(bk): os.remove(bk)
except Exception as e:
    print("cleanup warn:", e)

print("\nALL_GREEN" if ok else "\nSOME_FAILED")
