"""
utils/email.py — Transactional email sending and all HTML templates.

Usage:
    from utils.email import send_email, _email_verify_html, _email_welcome_html
    bg.add_task(send_email, user_email, "Subject", _email_verify_html(url, name))
"""

from config import (
    RESEND_AVAILABLE, RESEND_API_KEY, RESEND_FROM, RESEND_REPLY_TO,
    BASE_URL, log, _resend,
)


def send_email(to: str, subject: str, html_body: str) -> tuple[bool, str]:
    """Send a transactional email via Resend. Returns (success, detail)."""
    if not RESEND_AVAILABLE:
        log.warning(f"Email skipped (resend not installed): '{subject}' → {to}")
        return False, "resend package not installed"
    if not RESEND_API_KEY:
        log.warning(f"Email skipped (no API key): '{subject}' → {to}")
        return False, "RESEND_API_KEY not set"
    try:
        _resend.api_key = RESEND_API_KEY
        _resend.Emails.send({
            "from":     RESEND_FROM,
            "to":       [to],
            "reply_to": [RESEND_REPLY_TO],
            "subject":  subject,
            "html":     html_body,
        })
        log.info(f"Email sent: '{subject}' → {to}")
        return True, "ok"
    except Exception as exc:
        log.error(f"Email send failed: {exc}")
        return False, str(exc)


# ── Email templates ───────────────────────────────────────────────

def _email_reset_html(reset_url: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Reset your password</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    Someone requested a password reset for your Sivarr account.<br>
    Click below to set a new password. This link expires in <strong>1 hour</strong>.
  </p>
  <a href="{reset_url}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Reset Password →
  </a>
  <p style="color:#999;font-size:.78rem;margin-top:32px;line-height:1.5">
    If you didn't request this, you can safely ignore this email.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_verify_html(verify_url: str, name: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Welcome, {name} 👋</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    Verify your email address to complete your Sivarr account setup.<br>
    This link expires in <strong>24 hours</strong>.
  </p>
  <a href="{verify_url}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Verify Email →
  </a>
  <p style="color:#999;font-size:.78rem;margin-top:32px;line-height:1.5">
    If you didn't create a Sivarr account, you can safely ignore this email.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_org_invite_html(inviter_name: str, org_name: str, join_url: str, role: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">You're invited to join <strong>{org_name}</strong></h2>
  <p style="color:#555;line-height:1.6;margin:0 0 8px">
    <strong>{inviter_name}</strong> has invited you to join their organization on Sivarr as a <strong>{role}</strong>.
  </p>
  <p style="color:#555;line-height:1.6;margin:0 0 28px">
    Sivarr is an all-in-one OS for work — tasks, projects, docs, AI, and team chat in one place.
    This invite expires in <strong>7 days</strong>.
  </p>
  <a href="{join_url}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Accept Invite &amp; Join {org_name} →
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_welcome_html(name: str) -> str:
    url   = f"{BASE_URL}/"
    first = name.split()[0] if name else name
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:system-ui,-apple-system,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">Your workspace is waiting for you.</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:40px 48px;max-width:520px;width:100%">
      <tr><td style="padding-bottom:32px">
        <span style="font-size:1.4rem;font-weight:900;color:#0D7A5F;letter-spacing:-.04em">Sivarr</span>
      </td></tr>
      <tr><td style="font-size:1rem;color:#1a1a1a;padding-bottom:16px;line-height:1.6">Hello {first},</td></tr>
      <tr><td style="font-size:1rem;color:#1a1a1a;padding-bottom:28px;line-height:1.6">
        You now have access to your Sivarr workspace.</td></tr>
      <tr><td style="padding-bottom:20px">
        <a href="{url}" style="display:inline-block;color:#C0392B;font-weight:800;font-size:.95rem;text-decoration:none;letter-spacing:.04em">
          OPEN MY Sivarr WORKSPACE</a></td></tr>
      <tr><td style="font-size:.92rem;color:#555;font-style:italic;padding-bottom:28px;line-height:1.6">
        Click the link above to get started.</td></tr>
      <tr><td style="font-size:.95rem;color:#1a1a1a;padding-bottom:12px;line-height:1.6">Once you do, you will find that you can;</td></tr>
      <tr><td style="padding-bottom:28px">
        <ul style="margin:0;padding-left:24px;color:#1a1a1a;font-size:.95rem;line-height:2">
          <li>Ask questions and have a personalized chat with your AI assistant.</li>
          <li>Process your emotions through daily logs in your personal journal.</li>
          <li>Set daily, weekly, monthly and yearly goals and track your progress.</li>
          <li>Study faster by creating notes and study materials.</li>
        </ul></td></tr>
      <tr><td style="font-size:.92rem;color:#555;font-style:italic;padding-bottom:28px;line-height:1.8">
        See you inside,<br>Sivarr Team</td></tr>
      <tr><td style="border-top:1px solid #eee;padding-top:20px">
        <p style="margin:0;font-size:.72rem;color:#bbb;text-align:center">Sivarr &middot; Your productivity OS</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def _email_task_reminder_html(name: str, tasks: list) -> str:
    rows = "".join(
        f'<li style="margin-bottom:8px;color:#333">{t["title"]}'
        f'<span style="color:#888;font-size:.8rem"> — due {t.get("due","today")}</span></li>'
        for t in tasks[:5]
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Tasks due soon, {name}</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 16px">
    You have <strong>{len(tasks)}</strong> task(s) due today or tomorrow:
  </p>
  <ul style="padding-left:20px;margin:0 0 28px;line-height:1.8">{rows}</ul>
  <a href="{BASE_URL}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Open Tasks
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""


def _email_billing_receipt_html(name: str, plan: str, amount: str, ref: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:28px">
    <span style="font-size:1.3rem;font-weight:800;color:#0D7A5F;letter-spacing:-.03em">Sivarr</span>
  </div>
  <h2 style="margin:0 0 10px;font-size:1.4rem">Payment confirmed</h2>
  <p style="color:#555;line-height:1.6;margin:0 0 8px">Hi {name}, your payment was successful.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0 28px">
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Plan</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600">{plan}</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#888">Amount</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600">{amount}</td></tr>
    <tr><td style="padding:10px 0;color:#888">Reference</td>
        <td style="padding:10px 0;font-size:.78rem;color:#555">{ref}</td></tr>
  </table>
  <a href="{BASE_URL}"
     style="display:inline-block;background:#0D7A5F;color:#fff;padding:13px 32px;
            border-radius:9px;text-decoration:none;font-weight:700;font-size:.95rem">
    Open Sivarr
  </a>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#bbb;font-size:.72rem;text-align:center;margin:0">Sivarr · Your productivity OS</p>
</body></html>"""
