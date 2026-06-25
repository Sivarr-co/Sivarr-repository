# Google Calendar — OAuth App Verification Guide

Sivarr requests the **sensitive** scope `https://www.googleapis.com/auth/calendar.events`.
Sensitive scopes require Google's **OAuth app verification** (brand verification).
Until approved, users see a "Google hasn't verified this app" screen and there is a
**100-user cap**.

Good news: `calendar.events` is *sensitive*, **not restricted**, so **no paid
third-party security assessment (CASA)** is required — only the brand/verification
review.

---

## 1. Integration audit (done 2026-06-25)

The OAuth/Calendar flow lives in `app.py`:
- Connect:   `GET /auth/google/calendar` → scope `calendar.events`, `access_type=offline`, `prompt=consent`
- Callback:  `GET /auth/google/calendar/callback` → stores refresh/access token on the user's progress record
- Refresh:   `_gcal_access_token()` → refreshes within 5 min of expiry
- Read:      `GET /api/integrations/gcal/events` → `calendars/primary/events`
- Write:     `POST /api/integrations/gcal/push` → creates an event the user chose to push
- Status:    `GET /api/integrations/gcal/status`
- Disconnect:`POST /api/integrations/gcal/disconnect` (added in audit)

### Fixed in the audit
- **Disconnect/revoke** endpoint added — revokes the token at Google and clears it
  locally. Backs the privacy-policy promise and gives reviewers the revocation path
  they look for. Disconnect button shows in the Calendar header when connected.
- **Read scope now visibly used** in the main calendar. `gcalLoadEvents()` previously
  called a non-existent `renderCal()`, so fetched Google events never displayed
  (they only appeared in the marketplace Calendar extension). It now calls
  `calRender()` and `_calNormalize()` merges Google events (under the Meetings filter).
- **Stale "connected" state** cleared on `invalid_grant`/`invalid_token`.
- **Privacy policy** updated with the scope, data use/storage, and the **Limited Use**
  affirmation (required by verification).

### Recommended follow-ups (NOT approval blockers — your call)
1. **Session token in the URL.** `gcalConnect()` sends `/auth/google/calendar?token=<sessionToken>`
   and passes it back as the OAuth `state`. The token lands in browser history, server
   access logs, and the `Referer` sent to Google. This contradicts the earlier
   "tokens-out-of-URLs" hardening. Fix: issue a short-lived signed nonce mapped to the
   sid server-side, pass the nonce as `state`, and resolve sid from it in the callback.
   (Deferred because it changes the auth round-trip and can't be fully tested without
   live Google credentials.)
2. **CSRF state validation** on the calendar callback (the sign-in flow already does this
   via `_google_check_state`; the calendar flow does not).
3. **Encrypt the refresh token at rest** (currently stored plaintext in the progress
   record / DB).
4. **Push timezone** is hardcoded to UTC in `gcal_push`; pass the user's timezone so
   pushed events land at the right local time.

---

## 2. Console checklist (you must do these — I can't access the console)

**console.cloud.google.com → APIs & Services**

### OAuth consent screen
- [ ] Publishing status → **In production** (not "Testing")
- [ ] User type: **External**
- [ ] App name: **Sivarr**
- [ ] User support email: (your support address)
- [ ] App logo: upload the Sivarr mark (120×120+, on the verified domain)
- [ ] App home page: `https://sivarr.com`
- [ ] Privacy policy: `https://sivarr.com/privacy`
- [ ] Terms of service: `https://sivarr.com/terms`
- [ ] Authorized domains: `sivarr.com`
- [ ] Developer contact email

### Scopes
- [ ] Confirm only these are added: `openid`, `email`, `profile`,
      `…/auth/calendar.events`
- [ ] Remove any scope you don't actually use (reviewers reject over-broad requests)

### Credentials → OAuth 2.0 Client ID
- [ ] Authorized redirect URIs include **both**:
  - `https://sivarr.com/auth/google/callback`  (sign-in)
  - `https://sivarr.com/auth/google/calendar/callback`  (calendar)
- [ ] Authorized JavaScript origins: `https://sivarr.com`

### Domain ownership
- [ ] Verify `sivarr.com` in **Google Search Console** using the **same Google
      account** that owns the Cloud project (DNS TXT or HTML file). Required before
      the consent screen will accept the domain.

### Submit for verification
- [ ] Click **Publish app** / **Prepare for verification** and submit.
- [ ] Provide the **scope justification** (below) and a **demo video** (below).

---

## 3. Scope justification (paste into the form)

> Sivarr is a productivity workspace. The `calendar.events` scope is used for two
> user-initiated features in the Calendar section:
> (1) reading the user's upcoming events so we can display their schedule inside
> Sivarr's calendar alongside their tasks and goals, and
> (2) creating events the user explicitly chooses to push from Sivarr to their Google
> Calendar.
> This is the minimal scope needed for read + write of events. We request no broader
> Calendar scope and no other Google API scopes beyond sign-in (openid, email,
> profile). Users connect and disconnect the integration explicitly, and disconnecting
> revokes our access.

---

## 4. Demo video script (record + upload unlisted to YouTube)

Keep it ~1–3 min, screen-recorded on `https://sivarr.com` (must show the real domain
in the address bar).

1. Show the Sivarr home page at `https://sivarr.com` (address bar visible).
2. Sign in, go to **Calendar**, click **Connect Google**.
3. Show the Google consent screen — the OAuth client (app name "Sivarr") and the
   `calendar.events` permission being granted.
4. Back in Sivarr: show your **Google events appearing in the calendar** (the read use).
5. Create an event in Sivarr and **push it to Google Calendar**; then show it in Google
   Calendar (the write use).
6. Click **Disconnect** in the Calendar header to show access can be revoked.
7. Briefly show `https://sivarr.com/privacy` scrolled to the Google Calendar / Limited
   Use section.

---

## 5. Timeline expectation
Brand verification for a sensitive scope typically takes a few days to a few weeks.
You can keep operating in "Testing" with up to 100 added test users while you wait.
