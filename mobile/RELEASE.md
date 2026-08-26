# Mobile release — what is ready, and what needs your accounts

Everything that can be prepared without your credentials is done. Two steps
remain and both require accounts only you can sign into.

## Already done

- `eas.json` is configured for `development`, `preview` and `production` builds,
  plus Play Store submission on the `internal` track.
- `app.json` carries the bundle identifier (`app.sivarr.mobile`), Android
  permissions, notification config, and the dark theme.
- **App icons are real.** `icon.png`, `adaptive-icon.png`, `favicon.png` and
  `splash.png` are generated from the actual Sivarr mark on the `#0a0a0a`
  background. The adaptive icon keeps its art inside Android's inner 66% safe
  zone so the launcher mask cannot clip it.
- **The API base URL is fixed.** It pointed at
  `https://sivarr-repository-production.up.railway.app` in both `app.json` and
  `src/api/client.ts`. It is now `https://sivarr.com`. This mattered: an
  installed binary cannot be repointed quickly, so shipping against Railway's
  generated domain would strand every install if that hostname ever changed.

## Step 1 — EAS project id (needs your Expo account)

`app.json` currently has the placeholder:

```json
"eas": { "projectId": "replace-with-your-eas-project-id" }
```

From the `mobile/` directory:

```bash
npm install -g eas-cli      # if not already installed
eas login                   # your Expo account
eas init                    # creates the project, writes the real id into app.json
```

`eas init` fills in `projectId` itself. Commit the change it makes.

Then a first build to confirm the pipeline works end to end:

```bash
eas build --profile preview --platform android
```

That produces an installable APK. Put it on a real device and check sign-in
works against `https://sivarr.com` before going further.

## Step 2 — Play Store service account (needs your Google Play Console)

`eas.json` expects the key at `./google-service-account.json`:

```json
"submit": { "production": { "android": {
    "serviceAccountKeyPath": "./google-service-account.json",
    "track": "internal" } } }
```

To create it:

1. Google Play Console → **Setup → API access**.
2. Create a new Google Cloud service account, or link an existing project.
3. Grant it the **Release manager** role (enough to upload and submit builds).
4. In Google Cloud Console, create a **JSON key** for that service account.
5. Save it as `mobile/google-service-account.json`.

**Do not commit that file.** Confirm it is ignored before you do anything else:

```bash
git check-ignore -v mobile/google-service-account.json
```

If that prints nothing, add it to `.gitignore` first. It grants upload rights to
your Play listing.

Then:

```bash
eas build --profile production --platform android
eas submit --profile production --platform android
```

## Before the store listing

- The Play listing needs screenshots, a feature graphic, a short and full
  description, and a privacy policy URL. Use `https://sivarr.com/privacy`.
- Android requires a data-safety declaration. Sivarr collects account data
  (name, email), user content, and device/technical data for security and
  debugging. `https://sivarr.com/security` and `/privacy` describe what is
  actually collected.
- Bump `version`, `ios.buildNumber` and `android.versionCode` in `app.json` for
  every subsequent submission.

## Known gap, not a blocker

Tasks, habits, journal and focus now sync to the server. Some remaining screens
still read only from on-device storage. That is a completeness gap, not a
release blocker, and it does not affect sign-in or the core flows.

---

## PARKED — 2026-08-26

Mobile is deprioritised until the rest of launch is done. Picking it back up:

### Done already

- EAS project created and linked: `@sivarrs-team/sivarr`,
  id `9440e362-1050-4a4e-aa71-a7ad5b17419b`. `owner` is pinned to
  `sivarrs-team` in `app.json` so a future `eas init` cannot silently create a
  second project under a personal account.
- Icons regenerated from the real brand mark; API base URL corrected to
  `https://sivarr.com`; the Play service-account key is gitignored.

### Two real bugs found and fixed, not yet verified on a device

Both were found while debugging a failed sign-in. Both are fixed in the working
tree and confirmed against a running server (register and login each return
HTTP 200 with a token), but **no device build has been made since**, so neither
is confirmed on a real handset.

1. **Sign-in failed for any account with 2FA enabled.** `app.py:2750-2756`
   returns `401 "totp_required"` when the account has 2FA on and no code is
   sent. The mobile client sent no `totp` and had no field for one, so the app
   showed a dialog reading literally `totp_required`. `LoginScreen.tsx` now
   catches that, reveals a code field, and resubmits. Recovery codes work too.
2. **Registration had never worked.** `client.ts` posted to `/api/register`,
   which does not exist and returns 404 in production. The server registers via
   `/api/login` with `action: "register"` plus `confirm_password`. Fixed.

### Next step when this resumes

```bash
cd mobile
eas build --profile preview --platform android
```

Install on a real device and confirm: sign-in with 2FA on, sign-in with 2FA off,
and registration. The previously installed APK predates every fix above, so
testing it proves nothing.

### Still blocked on Hunter

Play Store service account JSON (step 2 above). Nothing else.
