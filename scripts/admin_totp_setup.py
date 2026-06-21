#!/usr/bin/env python3
"""
Admin 2FA (TOTP) setup helper — Security Roadmap P4.

Generates the base32 secret you put in the ADMIN_TOTP_SECRET env var, plus the
otpauth:// URI to add to an authenticator app (Google Authenticator, Authy,
1Password, etc.). Stdlib-only TOTP (matches app.py's _totp_verify) — no pyotp.

Generate a new secret:
    python scripts/admin_totp_setup.py
    python scripts/admin_totp_setup.py --account ops@sivarr.com --issuer Sivarr

Verify a code against a secret (sanity-check before flipping the env var):
    python scripts/admin_totp_setup.py --verify 123456 --secret JBSWY3DPEHPK3PXP

Then set ADMIN_TOTP_SECRET=<secret> on the server and redeploy. Admin login
will require the 6-digit code in addition to ADMIN_PASSWORD. Leaving the env
var unset keeps password-only login (backward compatible).
"""
import argparse
import base64
import hashlib
import hmac
import secrets
import sys
import time
import urllib.parse


def gen_secret(n_bytes: int = 20) -> str:
    """Random base32 secret (20 bytes = 160 bits, the RFC 4226 recommendation)."""
    return base64.b32encode(secrets.token_bytes(n_bytes)).decode().rstrip("=")


def totp_now(secret_b32: str, when: int | None = None) -> str:
    """Current 6-digit TOTP for a base32 secret (SHA1, 30s step)."""
    s = secret_b32.strip().replace(" ", "").upper()
    s += "=" * ((8 - len(s) % 8) % 8)
    key = base64.b32decode(s)
    counter = (int(when or time.time()) // 30).to_bytes(8, "big")
    mac = hmac.new(key, counter, hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    val = (int.from_bytes(mac[o:o + 4], "big") & 0x7FFFFFFF) % 1_000_000
    return f"{val:06d}"


def verify(secret_b32: str, code: str, window: int = 1) -> bool:
    """True if `code` matches within ±window 30s steps (clock-drift tolerance)."""
    code = (code or "").strip().replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        return False
    now = int(time.time())
    return any(
        hmac.compare_digest(totp_now(secret_b32, now + off * 30), code)
        for off in range(-window, window + 1)
    )


def provisioning_uri(secret: str, account: str, issuer: str) -> str:
    label = urllib.parse.quote(f"{issuer}:{account}")
    params = urllib.parse.urlencode({"secret": secret, "issuer": issuer})
    return f"otpauth://totp/{label}?{params}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Admin TOTP (2FA) setup helper")
    ap.add_argument("--account", default="admin", help="account label for the authenticator entry")
    ap.add_argument("--issuer", default="Sivarr", help="issuer name shown in the authenticator")
    ap.add_argument("--verify", metavar="CODE", help="verify a 6-digit code instead of generating")
    ap.add_argument("--secret", help="existing base32 secret (used with --verify)")
    args = ap.parse_args()

    if args.verify:
        if not args.secret:
            print("--verify requires --secret <base32>", file=sys.stderr)
            return 2
        ok = verify(args.secret, args.verify)
        print(f"{'✓ VALID' if ok else '✗ INVALID'} — code {args.verify}")
        return 0 if ok else 1

    secret = gen_secret()
    uri = provisioning_uri(secret, args.account, args.issuer)
    print("=" * 64)
    print("Admin 2FA (TOTP) secret generated")
    print("=" * 64)
    print(f"\nADMIN_TOTP_SECRET = {secret}\n")
    print("Add to your authenticator app — scan the QR or enter the secret manually.")
    print(f"\notpauth URI:\n  {uri}\n")
    try:
        import qrcode  # optional; pip install qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(uri)
        qr.print_ascii(invert=True)
    except ImportError:
        print("(install `qrcode` for an inline QR, or paste the URI into a QR generator)")
    print(f"\nSanity check — current code right now: {totp_now(secret)}")
    print("Set the env var, redeploy, then log in with password + the 6-digit code.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
