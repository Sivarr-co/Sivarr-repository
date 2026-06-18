# SIVARR — Product Roadmap & Gap Analysis
**Document Type:** Internal Team Reference  
**Date:** June 2026  
**Author:** Founder + Claude (Sonnet 4.6)  
**Status:** Working Draft — For Team Review

---

## 1. Where SIVARR Stands Today

SIVARR is a live, deployed web application at `sivarr-repository-production.up.railway.app`.  
It is built on FastAPI (Python) + Vanilla JS/HTML/CSS + PostgreSQL, deployed on Railway.

### What is fully working right now

| Feature | Status | Notes |
|---|---|---|
| User registration & login | ✅ Live | Email/password + Google OAuth |
| Email verification | ✅ Live | Requires RESEND_API_KEY set on Railway |
| SIVARR AI chat | ✅ Live | Gemini API, session history, file attachments |
| Tasks system | ✅ Live | Add, complete, priority, focus mode |
| Goals tracking | ✅ Live | Progress %, milestones |
| Habits tracker | ✅ Live | Streaks, daily check-ins |
| Calendar | ✅ Live | Google Calendar sync integration |
| Journal | ✅ Live | AI reflection feature |
| Notes / Docs | ✅ Live | Basic contenteditable editor |
| Study tools | ✅ Live | Quiz builder, study plans, flashcards |
| Community feed | ✅ Live | Posts, likes, replies — server-backed |
| Opportunity board | ✅ Live | Jobs, internships, scholarships |
| Organisation Space | ✅ Live | Org chat, projects kanban, team goals |
| Billing — Paystack | ✅ Live | Pro (₦2,500/mo), Pro Yearly, Team |
| Billing — Flutterwave | ✅ Live | Alternative payment gateway |
| Billing history | ✅ Live | Viewable in Settings |
| Plan cancellation | ✅ Live | Self-serve in Settings |
| AI task extractor | ✅ Live | Paste text → AI pulls out tasks |
| AI writing assistant | ✅ Live | 8 modes: improve, shorten, email, etc. |
| GitHub integration | ✅ Live | Repo linking |
| Admin panel | ✅ Live | Password-protected internal tools |
| Mobile scaffold | ✅ Built | Expo React Native — needs screens |
| Dark / light mode | ✅ Live | User-selectable |
| PWA install | ✅ Live | Service worker registered |
| Analytics (Paystack) | ✅ Live | Revenue analytics in Founder mode |

### What the current stack is

```
Backend:    FastAPI (Python 3.11)
Frontend:   Vanilla JS + HTML + CSS (no framework)
AI:         Google Gemini API
Database:   PostgreSQL via Railway + JSON file fallback
Payments:   Paystack + Flutterwave
Email:      Resend API
Hosting:    Railway (auto-deploy from GitHub)
Mobile:     Expo / React Native (scaffold only)
Analytics:  Plausible (page views only)
Auth:       Email/password (bcrypt) + Google OAuth
```

---

## 2. The 10 Gaps — Honest Assessment

These are the things SIVARR lacks compared to products like Notion, Linear, Slack, ClickUp, and Monday.com that are actively used by teams today. Each gap has been verified against the actual codebase.

---

### Gap 1 — Real-Time Collaboration

**What it means:**  
When two people in the same organisation open the same document, task board, or goal tracker — nothing syncs between them in real time. One person's changes don't appear for the other until they refresh. There are no live cursors, no presence indicators, no conflict resolution.

**Why it matters:**  
SIVARR's pitch is "replace Slack + Notion + Jira." That pitch fails immediately the moment two teammates try to work on something together and one person's changes vanish. This is table stakes for any collaborative workspace. Teams will revert to Notion within a week without it.

**Current state in code:**  
Presence dots are styled in CSS and partially wired in the Org Space UI, but the WebSocket layer behind them doesn't exist. The org chat works (server-sent events) but documents and tasks don't sync live.

**Technical approach:**

Step 1 — WebSocket infrastructure (FastAPI has native support):
```python
# FastAPI already supports this pattern
@app.websocket("/ws/presence/{room_id}")
async def presence_ws(websocket: WebSocket, room_id: str, token: str = ""):
    # Broadcast join/leave/cursor events to all room members
```

Step 2 — Yjs for conflict-free document editing:
- Yjs is a CRDT (Conflict-free Replicated Data Type) library — the same technology used by Notion and Figma
- It handles two people typing in the same doc simultaneously without losing either person's changes
- Tiptap (the doc editor, see Gap 2) has a native Yjs integration — they are designed to work together
- The `y-websocket` provider connects Yjs to our FastAPI WebSocket endpoint

Step 3 — Sequencing:
- **Week 1:** Presence only — green dots on org member avatars showing who is online in the same space
- **Week 2:** Live task updates — when one person checks off a task, it checks off for everyone in the org
- **Week 3–4:** Live document co-editing with Yjs + Tiptap

**Effort estimate:** 3–4 weeks for full implementation. Presence alone is 3–4 days.

**Dependencies:** Gap 2 (Tiptap editor) should be done first before real-time doc editing.

**Risk:** Medium-high. WebSocket infrastructure at scale requires testing under load. Start with presence (low risk) and progress to doc editing (higher risk) after validation.

---

### Gap 2 — A Real Document Editor

**What it means:**  
The current notes/docs editor in SIVARR is a `contenteditable` div using deprecated `document.execCommand` browser APIs. There are no slash commands, no block types (headings, callouts, toggles, tables), no drag-and-drop blocks, no embeds. It is functionally a styled textarea.

**Why it matters:**  
Notion's entire product is built around its block editor. When someone evaluates SIVARR against Notion specifically for docs and notes — which is SIVARR's explicit positioning — the editor is the product. A textarea loses that comparison in 10 seconds. Additionally, `document.execCommand` is deprecated in all modern browsers and will eventually stop working.

**Current state in code:**  
`dhFormat(cmd)` calls `document.execCommand(cmd)` directly. Content is saved as raw HTML innerHTML. No structured schema.

**Technical approach:**

Use **Tiptap** — an open-source headless editor framework (MIT licence) built on ProseMirror. It works with vanilla JS, requires no React or Vue, and has:
- First-class Yjs integration for real-time collaboration (Gap 1)
- Slash commands extension
- All standard block types out of the box
- Table support
- Code blocks with syntax highlighting
- Mention support (`@user`)
- AI autocomplete (we can wire SIVARR AI directly into the editor)

Migration plan:
1. Load Tiptap via CDN (no build step required)
2. Replace the `dh-editor` contenteditable div with a Tiptap instance
3. Store content as Tiptap JSON (structured) instead of raw HTML
4. Add a migration function that converts existing HTML notes to Tiptap JSON on first load
5. Implement slash command menu with 8–10 block types: heading, bullet list, numbered list, to-do, quote, code, divider, image

**Slash commands to ship in v1:**
```
/heading1    /heading2    /heading3
/bullet      /numbered    /todo
/quote       /code        /divider
/ai          (triggers SIVARR AI inline)
```

**Effort estimate:** 1–1.5 weeks. The editor install is 1–2 hours. The slash command menu is the hard part (3–4 days). The AI inline integration is another 2 days.

**Risk:** Low. Tiptap is extremely well-documented and used in production by hundreds of companies. The risk is content migration from existing HTML notes — needs careful testing.

---

### Gap 3 — Offline Support and Speed

**What it means:**  
Every action in SIVARR — loading your tasks, checking a habit, reading your notes — requires a live internet connection and a server round-trip. If the connection is slow or drops, the app either hangs or shows nothing.

**Why it matters:**  
Nigeria's internet infrastructure is inconsistent. A productivity app that stops working when connectivity dips is not a productivity app — it's a liability. In Lagos specifically, users switch between WiFi and mobile data constantly. The target market has lower average connection quality than US/EU users that Notion and Linear are designed for. Offline support is a competitive advantage in Africa, not just a nice-to-have.

**Current state in code:**  
A service worker (`sw.js`) exists and caches the app shell (HTML, CSS, static images). It handles navigation requests gracefully. However, it does NOT cache any user data — tasks, goals, notes, habits. The app renders empty when offline.

**Technical approach:**

Two layers:

**Layer 1 — Instant load with IndexedDB** (3 days):
- On every data fetch (tasks, goals, habits), store the result in IndexedDB using the `idb` library (1.1kb, no dependencies)
- On app load, immediately render from IndexedDB while the network fetch runs in the background
- When the network response arrives, update the UI if data has changed
- Result: app feels instant even on slow connections — data is there before the server responds

**Layer 2 — Offline writes with sync queue** (2 days):
- When a user adds a task / checks a habit / writes a note while offline, store the mutation in an IndexedDB "pending queue" instead of failing
- Register a `Background Sync` event in the service worker
- When connectivity returns, the service worker processes the queue and sends pending mutations to the server
- Show a subtle "syncing…" badge on the sidebar when there are pending items

Data to cache in v1 (everything else can wait):
- Tasks list
- Goals + progress
- Habits
- Today's journal entry
- The last 20 chat messages

**Effort estimate:** 3–4 days for Layer 1. 2 more days for Layer 2. Total: 5–6 days.

**Risk:** Low for Layer 1. Medium for Layer 2 — conflict resolution when offline changes and server changes diverge needs careful handling. Defer Layer 2 to after Layer 1 is validated.

---

### Gap 4 — Native Mobile

**What it means:**  
SIVARR has no mobile app on the Play Store or App Store. The Expo scaffold was built (June 2026 session) with 5 screens (Login, Home, Chat, Tasks, Community, Settings) but it is not submitted anywhere and the screens are minimal.

**Why it matters:**  
In Nigeria and across Africa, mobile is the primary computing device for a large percentage of the working population. Students in particular do most of their work on Android phones. A web app that isn't on the Play Store is invisible to this audience. WhatsApp, Excel, and Google Drive are their reference points — all available on Android.

**Current state:**  
`mobile/` directory exists with:
- `App.tsx` — navigation structure (Login → Tab bar)
- `src/api/client.ts` — complete API client covering all endpoints
- `src/screens/` — Login, Home (AI brief), Chat, Tasks, Community, Settings
- `package.json` — Expo 51 dependencies

What it lacks:
- Goals screen
- Habits screen
- Calendar screen
- Journal screen
- Org space screen
- App icons and splash screen assets
- Any submission to Play Store or App Store

**Technical approach:**

Phase 1 — Play Store ready (2 weeks):
1. Build 4 remaining key screens: Goals, Habits, Journal, Notifications
2. Design and export app icon (1024×1024) and splash screen
3. Configure EAS Build for Android production APK
4. Submit to Google Play (review takes 1–3 days for first submission)
5. Internal test track first — share with 20 users before public

Phase 2 — App Store (1 additional week):
1. Configure iOS bundle ID and signing certificates
2. Submit to App Store (review takes 1–7 days)

Screen priority for Phase 1:
```
Must have:      Goals, Habits, Notifications
Good to have:   Journal, Calendar view
Can wait:       Org space, Founder mode, Templates
```

**Effort estimate:** 2 weeks for Android Play Store submission. 1 more week for iOS.

**Risk:** Low technical risk — the API layer is complete. Risk is in App Store review process, which can reject for policy reasons. Submit to Play Store first.

---

### Gap 5 — Public Landing Page

**What it means:**  
When someone hears about SIVARR and types the URL, they land on a login screen with no context about what SIVARR is, why it exists, who it's for, or what it costs. There is nothing to read, nothing to share, no social proof, no conversion flow.

**Why it matters:**  
Acquisition doesn't happen without a landing page. Word of mouth sends someone to a URL — if that URL doesn't tell the story, the lead is lost. Every competitor (Notion, Linear, ClickUp, Lemon Squeezy, even small African SaaS companies) has a landing page before the product. This is a day-one requirement for real user growth, not a nice-to-have.

**Current state in code:**  
The `@app.get("/")` route serves `index.html` (the app) directly to everyone, logged-in or not. There is no distinction between marketing and product.

**Technical approach:**

1. Create `templates/landing.html` — a standalone marketing page
2. Move the app to `/app` — `@app.get("/app")` serves `index.html`
3. Route logic: `@app.get("/")` checks if user has a valid session cookie, redirects to `/app` if yes, serves `landing.html` if no
4. Sections to include in `landing.html`:
   - Hero: headline, subheadline, CTA ("Get started free")
   - Feature showcase: 3 pillars (Personal, Org, Academic)
   - AI section: SIVARR AI capabilities
   - Pricing table: Free, Pro (₦2,500), Team (₦8,000)
   - Testimonials: placeholder for now, real ones as they come in
   - Footer: links to Terms, Privacy, Twitter/X, Contact

5. The design language is already established — dark premium aesthetic, teal (#0D7A5F) primary, Syne font for headings
6. No external CSS framework needed — build on the existing design system

**Effort estimate:** 2–3 days for v1. Can be iterated rapidly after launch.

**Risk:** None. This is HTML and CSS. The only risk is over-engineering it — ship a simple version first.

---

### Gap 6 — Data Portability (Import & Export)

**What it means:**  
Users cannot get their data out of SIVARR in a useful format, and cannot bring their data from other tools in. There is no export button, no CSV download, no Notion import, no backup.

**Why it matters:**  
Two problems: (1) Users are reluctant to commit to a new tool if they can't get their data back. This creates anxiety that slows adoption. (2) Users who are currently on Trello, Notion, or Asana have years of tasks and projects there — they won't migrate manually. Import removes the switching cost. Export removes the lock-in fear.

**Current state:**  
No import or export functionality exists anywhere in the codebase.

**Technical approach:**

Export (build this first, 2 days):
```
GET /api/export → returns a ZIP file containing:
  tasks.csv       (id, title, priority, due date, status, created)
  goals.csv       (id, title, target, deadline, progress %, created)
  habits.csv      (id, name, frequency, streak, created)
  notes.md        (all notes as markdown, separated by ----)
  journal.md      (all journal entries chronologically)
  billing.csv     (date, plan, amount, reference, gateway)
```

Available from Settings → Data & Privacy → "Export my data"

Import (build second, 2 days):
- **Tasks from CSV:** Accept any CSV with a "title" column. Map additional columns (due date, priority, status) optionally. Preview before import.
- **Tasks from Trello:** Trello export is JSON — parse the cards array
- **Notes from Notion:** Notion export is markdown — read `.md` files
- Show a preview of what will be imported before confirming
- Deduplicate by title to avoid double imports

**Effort estimate:** 2 days for export. 2 days for CSV import. Notion/Trello import is 1 more day each if prioritised.

**Risk:** Low. Export is read-only and has no risk. Import has risk of duplicating data — mitigate with preview + confirmation step.

---

### Gap 7 — Notifications That Actually Reach You

**What it means:**  
There is no mechanism to notify a user of anything outside the app. No email digests, no browser push notifications, no reminders. The notification toggle exists in Settings but nothing happens when it's turned on.

**Why it matters:**  
Retention is driven by habit formation. Users need reasons to open SIVARR every day. "3 tasks due today" at 8am is what makes a productivity app sticky. Without notifications, the app relies entirely on users remembering to open it — which they won't. Asana, Notion, and Linear all have strong notification systems that drive daily active use.

**Current state:**  
Settings has toggles for notifications (announcements, streak reminders, quiz results) stored in `localStorage`. None of these fire any actual notification. The service worker is registered but `PushManager` is not used.

**Technical approach:**

Three layers, build in order:

**Layer 1 — Email digest (2 days):**
- A Railway cron job runs at 7:00 AM WAT every day
- Calls `POST /api/internal/digest` (admin-protected endpoint)
- For each user: pull today's due tasks + goals + habit streak status
- Send a summary email via Resend: "Good morning, Nonso. You have 3 tasks due today: [list]. Your reading habit streak is at 5 days."
- User can unsubscribe via a link in the email

**Layer 2 — Browser push notifications (3 days):**
- On login, call `PushManager.subscribe()` to get a push subscription object
- Send the subscription object to `POST /api/push/subscribe` — store it in user progress
- Server sends push via Web Push API (using `pywebpush` Python library)
- Triggers: task due in 1 hour, habit not logged by 8pm, someone replies to your community post
- Service worker's `push` event handler shows the notification

**Layer 3 — In-app notification bell (1 day):**
- A `notifications` array in user progress stores unread events
- The sidebar notification button shows a count badge
- Clicking opens a dropdown list of recent notifications
- Mark as read on click

**Effort estimate:** 6 days total for all three layers.

**Risk:** Browser push notifications require HTTPS (already have it on Railway) and user permission. Some users will deny permission — email digest is the reliable fallback.

**Required library:** `pywebpush` for server-side Web Push (add to requirements.txt).

---

### Gap 8 — Search Across Everything

**What it means:**  
There is no way to search across tasks, notes, goals, docs, and community posts simultaneously. If a user saved a note about a meeting 3 weeks ago, they have no way to find it except scrolling. The Cmd+K command palette exists but only shows navigation shortcuts — it doesn't search content.

**Why it matters:**  
As users put more data into SIVARR, findability becomes critical. A workspace where you can't find things is a workspace you stop trusting with information. Notion, Linear, and Slack all have search as a core feature. It's the thing that makes "putting it in the app" feel worthwhile.

**Current state:**  
The command palette (`$('cmd-overlay')`) opens on Cmd+K and shows navigation items. It does not search user data. No server-side search endpoint exists.

**Technical approach:**

Phase 1 — Server-side text search (3 days):
```python
GET /api/search?q=keyword&types=tasks,notes,goals
```
- Searches task titles, note titles/content, goal names, community posts
- Returns results grouped by type: `{tasks: [...], notes: [...], goals: [...]}`
- Simple case-insensitive `in` check — no fancy indexing needed for 100 users

Phase 2 — Wire into Cmd+K (1 day):
- When user types in the command palette, if no navigation match, call `/api/search`
- Show results grouped by type with icons
- Arrow keys to navigate, Enter to open, Escape to close
- Result card shows: type icon, title, 1-line preview, keyboard shortcut to open

Phase 3 — Typesense (deferred until scale):
- At 1,000+ users with large amounts of data, replace the simple text search with Typesense (open-source Algolia alternative) for fast full-text search with typo tolerance
- Typesense has a Railway one-click deploy

**Effort estimate:** 4 days for Phase 1 + 2. Phase 3 is deferred.

**Risk:** Low. Text search over in-memory/DB data is straightforward. The main concern is performance at scale — handled by deferring Typesense to later.

---

### Gap 9 — Credibility Layer

**What it means:**  
There are no Terms of Service, Privacy Policy, or Security pages. When a paying user or a company asks "what happens to my data?" there is no answer anywhere on the product.

**Why it matters:**  
Multiple reasons: (1) Users paying ₦2,500/month have a reasonable expectation that a policy exists. (2) Google requires a Privacy Policy to maintain OAuth approval — without one, Google can revoke the "Sign in with Google" permission. (3) Enterprise buyers and institutions (universities, companies) will not use a tool without legal documentation. (4) It signals that SIVARR is serious and here to stay.

**Current state:**  
No legal pages exist anywhere in the codebase or on any route.

**Technical approach:**

1. Write three pages: Terms of Service, Privacy Policy, Cookie Policy
2. Serve them at `/terms`, `/privacy`, `/cookies` as simple HTML
3. Add them to the landing page footer and in-app Settings footer
4. Key sections for Privacy Policy:
   - What data is collected (email, name, usage data)
   - How it's stored (Railway servers, PostgreSQL)
   - Third-party services (Google, Paystack, Flutterwave, Resend, Gemini)
   - User rights (export, deletion — both supported)
   - Contact email for data requests

5. Add GDPR-compliant consent for Nigerian users (NDPR — Nigerian Data Protection Regulation applies)

**Effort estimate:** 1 day to write, 1 day to build and link. Total: 2 days.

**Risk:** Zero technical risk. Use a plain language generator (Termly or Iubenda) as a starting point, customise for SIVARR's specific data practices.

---

### Gap 10 — Internal Analytics for the Founder

**What it means:**  
Nonso currently has no visibility into how users are actually using SIVARR. Plausible shows page views, but not: how many users created a task this week, what percentage of signups converted to paid, which features are used most, what the 7-day retention rate is, or how revenue is trending.

**Why it matters:**  
Building a product without usage data is guessing. Every major decision — what to build next, what to fix, where to invest engineering time — should be informed by what users are actually doing. Without this, SIVARR will build features no one uses and miss the ones people need.

**Current state:**  
Plausible is configured for page view analytics. The admin panel exists but has no product metrics. No event tracking is in place.

**Technical approach:**

Phase 1 — Server-side metrics endpoint (2 days):
```python
GET /admin/metrics  (admin-password protected)
```
Returns:
- Total users / users registered today / this week
- Daily Active Users (DAU) — users who made any API call today
- Weekly Active Users (WAU)
- Feature usage: how many chat messages sent today, tasks created, habits logged
- Subscription breakdown: free vs pro vs team counts
- Revenue: MRR, total collected, this month
- Retention: of users who signed up 7 days ago, how many are still active

Implementation: write a lightweight daily summary to `data/metrics.json` via a cron job. The admin metrics page reads this file and renders charts.

Phase 2 — Event tracking (2 days):
- Add a `track_event(sid, event_name, properties)` function to app.py
- Call it at key moments: user registered, task created, payment completed, AI message sent, doc created
- Store events in a `events` table in PostgreSQL (just 4 columns: sid, event, properties JSON, timestamp)
- The metrics endpoint aggregates this table

Phase 3 — Simple dashboard UI (1 day):
- A clean admin-only page at `/admin/metrics` showing:
  - Line chart: signups per day (last 30 days)
  - Number cards: DAU, WAU, MAU, MRR
  - Bar chart: feature usage
  - User table: most active users

No external BI tool needed for 100 users — built-in is faster and free.

**Effort estimate:** 5 days total.

**Risk:** Low. This is read-only aggregation of existing data. The only risk is slow SQL queries at scale — add database indexes on `created_at` columns preventatively.

---

## 3. Implementation Sprints

Sequenced by **impact × speed to ship**.

### Sprint 1 — Trust & Acquisition
**Duration:** 4–5 days  
**Goal:** Someone who hears about SIVARR can find it, understand it, and sign up safely

| Task | Owner | Days |
|---|---|---|
| Public landing page (`/`) | Engineering | 3 |
| Move app to `/app` route | Engineering | 0.5 |
| Terms of Service page | Founder + Engineering | 1 |
| Privacy Policy page | Founder + Engineering | 1 |
| Link pages in footer | Engineering | 0.5 |

**Success metric:** A stranger who visits the URL can describe what SIVARR does and sign up without needing to ask anyone.

---

### Sprint 2 — Retention
**Duration:** 6–7 days  
**Goal:** Users who sign up come back the next day without being reminded manually

| Task | Owner | Days |
|---|---|---|
| Email digest (daily task summary at 7am WAT) | Engineering | 2 |
| Browser push notification subscription | Engineering | 2 |
| Push triggers: task due, habit reminder | Engineering | 1 |
| In-app notification bell + dropdown | Engineering | 1 |
| Notification preferences in Settings | Engineering | 0.5 |

**Success metric:** 7-day retention improves — users who get a notification on Day 2 return at higher rate than users who don't.

---

### Sprint 3 — Product Feel
**Duration:** 5 days  
**Goal:** Using SIVARR feels coherent and fast, not like separate modules stapled together

| Task | Owner | Days |
|---|---|---|
| Search endpoint (`GET /api/search`) | Engineering | 2 |
| Cmd+K search results (wire into existing palette) | Engineering | 1 |
| Internal metrics endpoint + daily cron | Engineering | 1 |
| Admin metrics dashboard page | Engineering | 1 |

**Success metric:** User can find anything they've put into SIVARR in under 5 seconds. Founder can see DAU and feature usage at a glance.

---

### Sprint 4 — Core Differentiation
**Duration:** 8–10 days  
**Goal:** SIVARR's document editor is better than a textarea and holds its own against Notion

| Task | Owner | Days |
|---|---|---|
| Tiptap installation (CDN, no build step) | Engineering | 1 |
| Replace contenteditable editor | Engineering | 1 |
| Slash command menu (8 block types) | Engineering | 3 |
| Content migration (existing HTML → Tiptap JSON) | Engineering | 1 |
| AI inline integration (`/ai` command) | Engineering | 2 |
| Mobile editor (basic Tiptap on mobile) | Engineering | 2 |

**Success metric:** Users create richer documents. Notes average length increases. Users stop opening Notion for docs.

---

### Sprint 5 — Data Portability
**Duration:** 4 days  
**Goal:** Getting into and out of SIVARR is frictionless

| Task | Owner | Days |
|---|---|---|
| Export endpoint (ZIP with CSVs + markdown) | Engineering | 2 |
| Export button in Settings | Engineering | 0.5 |
| CSV import (tasks) | Engineering | 1 |
| Notion markdown import (notes) | Engineering | 1 |

**Success metric:** A user migrating from Notion can import their notes in under 5 minutes. A user can export all their data in one click.

---

### Sprint 6 — Reliability
**Duration:** 5–6 days  
**Goal:** SIVARR works on a bad connection

| Task | Owner | Days |
|---|---|---|
| IndexedDB layer (idb library) | Engineering | 1 |
| Cache tasks, goals, habits on fetch | Engineering | 1 |
| Render from IndexedDB on load | Engineering | 1 |
| Offline write queue + Background Sync | Engineering | 2 |
| "Syncing..." badge when offline changes are pending | Engineering | 0.5 |

**Success metric:** A user on a 2G connection in Lagos sees their tasks immediately. A user who checks a habit while offline sees it sync automatically when they reconnect.

---

### Sprint 7 — Mobile Distribution
**Duration:** 2–3 weeks  
**Goal:** SIVARR is on the Google Play Store

| Task | Owner | Days |
|---|---|---|
| Goals screen | Engineering | 2 |
| Habits screen | Engineering | 2 |
| Journal screen | Engineering | 1 |
| Notifications screen | Engineering | 1 |
| App icon + splash screen assets | Design | 1 |
| EAS Build configuration | Engineering | 1 |
| Google Play Store submission | Founder | 1 |
| Play Store review & publish | Google (1–3 days) | — |

**Success metric:** SIVARR is publicly available on the Google Play Store and can be found by searching "SIVARR."

---

### Sprint 8 — Real-Time Collaboration
**Duration:** 3–4 weeks  
**Goal:** Two people in the same org can work on things together in real time

| Task | Owner | Days |
|---|---|---|
| FastAPI WebSocket infrastructure | Engineering | 2 |
| Presence — who is online in the same space | Engineering | 3 |
| Live task updates in Org kanban | Engineering | 3 |
| Yjs CRDT integration for documents | Engineering | 5 |
| Tiptap + Yjs collaborative editing | Engineering | 5 |
| Live cursors in documents | Engineering | 2 |
| Conflict resolution testing | Engineering | 3 |

**Success metric:** Two people can open the same document and type simultaneously with no conflicts and no data loss.

---

## 4. Technology Decisions

| Problem | Recommended Technology | Reason |
|---|---|---|
| Document editor | Tiptap (ProseMirror) | MIT licence, Yjs integration, works with vanilla JS |
| Real-time sync | Yjs + y-websocket | Industry standard CRDT, used by Notion, Figma |
| Offline data | IndexedDB via `idb` library | 1.1kb, no framework needed, works in service worker |
| Push notifications | Web Push API + pywebpush | No third-party service needed, works natively |
| Full-text search (v1) | Server-side text match | Fast enough for 100 users, zero infrastructure |
| Full-text search (v2) | Typesense | Deploy on Railway, Algolia-quality, open-source |
| Mobile | Expo (EAS Build) | Already scaffolded, fastest path to Play Store |
| Email digests | Resend + Railway cron | Already integrated, no new service needed |
| Legal pages | Custom HTML | Match SIVARR design language, no third-party needed |

---

## 5. What NOT to Build Yet

These are commonly requested but should wait:

| Feature | Why to wait |
|---|---|
| Video calls | Requires WebRTC infrastructure — massive complexity for unclear user demand |
| AI meeting transcription | No meetings happening yet — premature |
| Automation builder | No user research on what automations people actually want |
| Zapier/n8n integration | Only matters once power users exist |
| Advanced HR features | Org Space needs real-time first |
| Native desktop app (Electron) | Web + mobile is enough for the target market |
| Multiple AI providers | Gemini is working; switching cost > benefit at this stage |

---

## 6. Success Metrics — What "Ready for 100 Users" Looks Like

Before each sprint ships, confirm these are passing:

| Metric | Target |
|---|---|
| New user can sign up and log in | < 2 minutes, no errors |
| Verification email arrives | < 60 seconds |
| Paystack payment succeeds and unlocks plan | < 30 seconds end-to-end |
| Google OAuth flow | Sign in without any error |
| App loads on 3G connection | < 4 seconds |
| App loads with no connection (after first visit) | < 1 second (from cache) |
| Tasks created on mobile sync to web | < 5 seconds |
| 7-day retention | > 40% (aggressive — most SaaS is 20%) |
| Monthly paying conversion | > 5% of free signups |

---

## 7. Environment Variables Checklist

Before pushing to 100 users, confirm all of these are set in Railway:

```
# Core
BASE_URL                   = https://sivarr-repository-production.up.railway.app
ADMIN_PASSWORD             = (strong password)

# Email (required for signup to work)
RESEND_API_KEY             = re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL          = SIVARR <noreply@sivarr.com>
RESEND_REPLY_TO            = connectsivarr@gmail.com

# Google OAuth (required for "Sign in with Google")
GOOGLE_CLIENT_ID           = xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET       = xxxxx

# AI
GOOGLE_API_KEY             = (Gemini API key)

# Payments
PAYSTACK_SECRET_KEY        = sk_live_xxxxx (or sk_test_ for test mode)
PAYSTACK_PUBLIC_KEY        = pk_live_xxxxx

# Optional but recommended
SENTRY_DSN                 = (error tracking)
PLAUSIBLE_DOMAIN           = sivarr.com (or your domain)
STRIPE_SECRET_KEY          = sk_live_xxxxx (for agent marketplace)
STRIPE_WEBHOOK_SECRET      = whsec_xxxxx
```

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Railway outage | Low | High | Export data backup daily; consider multi-region |
| Gemini API quota exceeded | Medium | High | Add usage caps; cache AI responses per user per day |
| Paystack test mode in production | Medium | High | Verify live keys before launch; test end-to-end |
| User data loss from concurrent writes | Low | High | Primary path is PostgreSQL (handles concurrency); JSON is backup only |
| Google OAuth revoked (no Privacy Policy) | Medium | High | Publish Privacy Policy before scaling Google login |
| App Store rejection | Medium | Medium | Submit to Play Store first; have legal pages ready |
| Email deliverability (verification links) | Medium | High | Configure Resend sending domain (DKIM/SPF); test before launch |

---

## 9. Questions for the Team

Before starting implementation, align on:

1. **Pricing:** Is ₦2,500/month the final price for Pro, or will it change before 100 users?
2. **Target user at 100:** Students, founders, or both? Influences what to build in Sprint 4.
3. **Landing page copy:** Who writes it? Engineering can build the structure but the words need to come from the founder.
4. **Legal pages:** Does SIVARR have a registered business entity? The Privacy Policy needs a legal address.
5. **Mobile first launch:** Nigeria only, or other African markets from day one?
6. **Support channel:** When a user has a problem, where do they go? Email, WhatsApp, in-app chat?

---

*This document was prepared based on a full audit of the SIVARR codebase (app.py, js/app.js, templates/index.html, css/styles.css, mobile/) as of June 2026. All gap assessments are verified against actual code, not assumptions.*

*Next review: after Sprint 3 ships.*
