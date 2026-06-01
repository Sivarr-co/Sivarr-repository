# SIVARR — Changes & Setup Guide
> Session: 2026-06-01 | Author: Claude (Sonnet 4.6)

---

## What Was Built

### Bug Fix — Paystack 404 After Payment
**Problem:** After completing a Paystack subscription payment, the browser showed `{"detail":"Not Found"}`.

**Root cause:** The old `callback_url` had query params baked in (`/?billing=success&plan=...&ref=...`). When Paystack appended its own `?reference=...`, some environments created a double-`?` URL that FastAPI could not route.

**Fix applied:**
- `app.py` — `callback_url` is now a clean path: `{BASE_URL}/billing/callback`
- `app.py` — New `GET /billing/callback` route reads Paystack's `reference` param and redirects to `/?billing=success&ref={reference}`

**Action required:**
- Confirm `BASE_URL` is set in Railway environment variables:
  ```
  BASE_URL=https://sivarr-repository-production.up.railway.app
  ```
  If unset, Paystack callbacks will go to the wrong domain.

---

## Phase 1 — Polish & Monetization

### Files changed
- `app.py`
- `templates/index.html`
- `js/app.js`

### What was added

#### Backend (`app.py`)
| Endpoint | Method | Description |
|---|---|---|
| `GET /api/billing/history` | GET | Returns user's payment history array |
| `POST /api/billing/cancel` | POST | Cancels subscription (user keeps access until expiry) |
| `GET /billing/callback` | GET | Paystack redirect handler (new — replaces query-param approach) |

Billing history is now automatically recorded on every successful Paystack **and** Flutterwave payment. Each entry contains: date, plan name, amount (₦), reference, gateway, status.

#### Frontend — Settings "My Plan" section
- Shows real plan name, expiry date, payment gateway, and status (Active / Cancelled)
- **Upgrade to Pro** button now opens the actual pricing modal (`showPricing()`) instead of a toast
- **Cancel subscription** button appears for paid users — confirms with a dialog before calling the API
- **Payment history** section appears below the plan info once payments exist

#### New JS functions
- `stUpdateUsage()` — extended to render real subscription data from `_BILLING_STATUS`
- `stLoadBillingHistory()` — fetches and renders payment history in settings
- `billingCancelConfirm()` — shows confirm dialog then calls `POST /api/billing/cancel`

### No new environment variables required

---

## Phase 2 — Growth Layer

### Files changed
- `app.py`
- `templates/index.html`
- `js/app.js`

### What was added

#### New data files (auto-created on first use)
- `data/community_posts.json` — stores all community posts (max 200)
- `data/opportunities.json` — stores all opportunity board entries (max 300)

#### Backend (`app.py`)
| Endpoint | Method | Description |
|---|---|---|
| `GET /api/community/posts` | GET | Fetch posts, filter by `?category=` |
| `POST /api/community/posts` | POST | Create a new post |
| `POST /api/community/posts/{id}/like` | POST | Toggle like on a post |
| `POST /api/community/posts/{id}/reply` | POST | Add a reply to a post |
| `GET /api/opportunities` | GET | Fetch opportunities, filter by `?category=` |
| `POST /api/opportunities` | POST | Submit a new opportunity |
| `GET /api/profile/{sid}` | GET | Get a user's public profile by session ID |

Post categories: `study`, `career`, `qa`, `general`
Opportunity categories: `job`, `internship`, `scholarship`, `grant`, `other`

#### Frontend — Community Panel
- Feed is now server-backed (persists across users, real-time)
- Like and reply buttons are functional
- New **Opportunities tab** — full board for jobs, internships, scholarships, grants
- Users can submit opportunities via a form modal
- Filter tabs work on both feed and opportunities

#### New JS functions
- `communityInit()` — called when Community panel opens, loads feed
- `commLoadFeed(category)` — fetches and renders posts from backend
- `commSetMode(mode)` — switches between Feed and Opportunities views
- `commLike(postId)` — toggles like
- `commReply(postId)` — adds a reply
- `commLoadOpportunities(category)` — fetches and renders opportunities
- `oppSubmit()` — opens form modal and submits a new opportunity
- `_timeAgo(iso)` — utility: converts ISO timestamp to "2h ago" format

### No new environment variables required

---

## Phase 3 — Advanced AI

### Files changed
- `app.py`
- `templates/index.html`
- `js/app.js`

### What was added

#### Backend (`app.py`)
| Endpoint | Method | Description |
|---|---|---|
| `POST /api/ai/extract-tasks` | POST | Extract actionable tasks from free-form text using Gemini AI |
| `POST /api/ai/write` | POST | AI writing assistant — rewrite text in 8 different modes |

**Task extractor** — sends text to Gemini, returns a JSON array of `{title, priority, due}` objects.

**Writing assistant modes:** `improve`, `shorten`, `expand`, `formal`, `casual`, `bullets`, `email`, `summarise`

Both endpoints require a valid session token and use the existing Gemini API key (`GOOGLE_API_KEY`).

#### Frontend — Home Panel
Two new AI action pills added to the home panel shortcut bar:
- **Extract Tasks** — paste any email, note, or message; AI extracts tasks as a checklist. Tick the ones you want and they're added to your task list.
- **Write AI** — opens a form with text input and mode selector; returns rewritten text with a one-click copy button.

#### New JS functions
- `aiTaskExtractor()` — opens input modal, calls extract-tasks API
- `_aiShowExtractedTasks(tasks)` — shows checklist modal with extracted tasks
- `_aiAddTask(task)` — saves a single extracted task to localStorage
- `aiWriteAssist()` — opens form modal, calls write API
- `_aiShowWriteResult(result)` — displays result with copy button
- `_aiCopyResult(text)` — copies text to clipboard
- `siModal._show_raw` — exposed the internal `_show` function for custom modal HTML

### Requirement
Gemini API key must be set:
```
GOOGLE_API_KEY=your_gemini_api_key
```
This is likely already set on Railway since the rest of the AI features work.

---

## Phase 4 — Mobile App (Expo React Native)

### New directory
```
mobile/
├── App.tsx                          # Root navigator (Login → Tab bar)
├── app.json                         # Expo config (bundle ID, splash, icons)
├── package.json                     # Dependencies
├── src/
│   ├── api/
│   │   └── client.ts                # Shared API client (all endpoints)
│   ├── hooks/
│   │   └── useAuth.ts               # Auth state hook (SecureStore)
│   ├── screens/
│   │   ├── LoginScreen.tsx          # Email/password login & register
│   │   ├── HomeScreen.tsx           # AI brief + quick actions
│   │   ├── ChatScreen.tsx           # SIVARR AI chat
│   │   ├── TasksScreen.tsx          # Task list (local + add/complete/delete)
│   │   ├── CommunityScreen.tsx      # Community feed with post composer
│   │   └── SettingsScreen.tsx       # Plan info, billing history, sign out
│   └── theme.ts                     # Dark colour tokens matching web app
```

### How to set up and run

**Prerequisites:**
- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- For physical device: Expo Go app (iOS or Android)
- For emulator: Android Studio or Xcode

**Steps:**
```bash
# 1. Navigate to the mobile directory
cd mobile

# 2. Install dependencies
npm install

# 3. Start the dev server
npx expo start

# 4. Scan the QR code with Expo Go on your phone
#    OR press 'a' for Android emulator, 'i' for iOS simulator
```

**To build a production APK (Android):**
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo account (create one at expo.dev if needed)
eas login

# Configure build
eas build:configure

# Build for Android
eas build --platform android
```

**API URL:**
The mobile app points to `https://sivarr-repository-production.up.railway.app` by default (set in `app.json` under `extra.apiUrl`).
To change it, update `app.json`:
```json
"extra": {
  "apiUrl": "https://your-railway-url.up.railway.app"
}
```

**Assets needed (placeholder until designed):**
- `mobile/assets/icon.png` — 1024×1024 app icon
- `mobile/assets/splash.png` — 1284×2778 splash screen
- `mobile/assets/adaptive-icon.png` — 1024×1024 Android adaptive icon

Create placeholder PNGs or copy from the web app's static folder for now.

---

## Cache Buster
CSS and JS versions bumped to `?v=20260601c` in `templates/index.html`. This forces browsers to reload the updated files after deployment.

---

## Deployment Checklist

- [ ] Push all changes to GitHub (triggers Railway auto-deploy)
- [ ] Confirm `BASE_URL` env var is set on Railway
- [ ] Confirm `GOOGLE_API_KEY` env var is set on Railway (for AI features)
- [ ] Confirm `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` are set
- [ ] Test Paystack subscription flow end-to-end (should no longer 404)
- [ ] Test Community feed — post, like, reply
- [ ] Test AI task extractor from home panel
- [ ] For mobile: run `npm install` in `/mobile`, then `npx expo start`
