# Email setup for sivarr.com

Two separate problems. **Outbound** is why verification and password-reset emails
do not reach users. **Inbound** is why nobody can email you back.

DNS for `sivarr.com` is hosted at Namecheap (`dns1.registrar-servers.com`), so
every record below goes in Namecheap's Advanced DNS panel.

---

## Problem 1 — inbound mail does not exist

**Verified 2026-08-25 against both Cloudflare and Google resolvers:
`sivarr.com` has no MX records.**

That means these addresses, all of which are already published on the live site,
silently go nowhere:

- `support@sivarr.com` — the Contact link in the landing footer, Terms, and Privacy
- `security@sivarr.com` — the vulnerability-report address on the Security page

Someone reporting a security issue, or a customer replying about a payment, is
getting a bounce or a black hole. Fix this before any launch push.

Cheapest options:

- **Namecheap Private Email** — a few dollars a month, set up in the same panel
  as the DNS.
- **Google Workspace** — more expensive, but you get the rest of Workspace.
- **A forwarding-only service** (Namecheap offers free email forwarding) — routes
  `support@sivarr.com` to a personal inbox. Adequate to start, and by far the
  fastest to turn on.

Whichever you pick, it gives you MX records to add. Add them, then confirm:

```
curl -s "https://dns.google/resolve?name=sivarr.com&type=MX"
```

Then actually send a test email to `support@sivarr.com` from an outside account
and confirm it arrives. DNS resolving is not proof of delivery.

---

## Problem 2 — outbound mail via Resend

The app already supports Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, default
sender `Sivarr <noreply@sivarr.com>`), with Gmail SMTP as a fallback. What is
missing is a verified sending domain.

### Use a subdomain, not the root

Verify **`send.sivarr.com`** rather than `sivarr.com`. Two reasons: it keeps
Resend's SPF record from colliding with whatever SPF your inbound provider adds
when you fix Problem 1, and a deliverability problem on bulk app mail then cannot
damage the reputation of your root domain.

Currently `sivarr.com` has **no SPF record**, so there is nothing to collide with
today — but there will be the moment you set up inbound mail.

### Steps

1. Resend dashboard → **Domains → Add Domain** → enter `send.sivarr.com`.
2. Resend generates the exact records. They will look like this, but **use the
   values Resend shows you, not these** — the DKIM key is unique per domain:

   | Type | Host | Value |
   |---|---|---|
   | MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | `p=MIGfMA0GCSq…` (long, unique to you) |

3. Add them in Namecheap → Advanced DNS. Namecheap appends the domain
   automatically, so enter `send`, not `send.sivarr.com`.
4. Back in Resend, click **Verify**. Propagation is usually minutes.

### Then set these in Railway

```
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=Sivarr <noreply@send.sivarr.com>
```

Note the sender must be on the **verified** domain. The current default is
`noreply@sivarr.com`, which will not send once you verify the subdomain instead —
so set `RESEND_FROM_EMAIL` explicitly.

### Verify it actually works

Register a brand-new account on production and confirm the verification email
arrives. Then trigger a password reset and confirm that one arrives too. Check
the Resend dashboard for bounces.

---

## Tighten DMARC afterwards

`_dmarc.sivarr.com` already exists and is set to `v=DMARC1; p=none;` — monitoring
only, nothing is enforced. Once both problems above are fixed and mail is flowing
cleanly for a week or two, tighten it:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@sivarr.com; pct=100
```

Do not tighten before then. Enforcing DMARC while SPF or DKIM is misconfigured
will send your own legitimate mail to spam.
