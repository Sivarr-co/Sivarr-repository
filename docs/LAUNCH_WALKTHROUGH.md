# Sivarr — Launch Walkthrough & Readiness Map

> Complete surface-by-surface map of the Sivarr web app for final launch review.
> Covers every route, shell element, tab, icon, dashboard, and modal — plus a
> **responsiveness** and **load-performance** audit with a tick-box checklist.
>
> **Stack:** FastAPI ([app.py](../app.py)) · Gemini AI · Stripe/Paystack · Supabase Postgres · Sentry · Plausible.
> **Frontend:** single-page app — [templates/index.html](../templates/index.html) (288 KB) + [js/app.js](../js/app.js) (868 KB) + [css/styles.css](../css/styles.css) (356 KB).
> **Icons:** Tabler webfont (`ti ti-*`), self-hosted.
>
> Legend: ✅ verified in code · 🟡 built, not browser-verified · 🚩 known issue / launch blocker.

---

## How the app loads (performance audit)

| Aspect | Status | Detail |
|---|---|---|
| Gzip compression | ✅ | `GZipMiddleware(minimum_size=1000)` — 868 KB app.js → ~200 KB on the wire; 356 KB CSS → ~60 KB; 288 KB HTML → ~50 KB. |
| Static cache headers | ✅ | `Cache-Control: public, max-age=31536000, immutable` on versioned `/static`, `/css`, `/js`. Repeat loads are instant. |
| JS execution | ✅ | `app.js` loaded with `defer` at end of body — non-blocking. |
| Panel hydration | ✅ | Panels are static `display:none` shells; each hydrates **on nav** via its own `init()` (`loadHome`, `finInit`, `orgInit`, …). Fast first paint — only the active panel fetches data. |
| Self-hosted critical deps | ✅ | Tabler icons + DOMPurify are now self-hosted under `/static/vendor/` (resolves the old jsdelivr `CRYPT_E_NO_REVOCATION_CHECK` blank-icon bug). |
| HSTS / security headers | ✅ | `Strict-Transport-Security: max-age=31536000; includeSubDomains`. |
| **Logo asset weight** | 🚩 | `static/sivarrai.png` is **256 KB** but is only ever rendered at 16–24 px. PNG is already compressed, so gzip won't help. **Fix:** resize to ~48 px @2x or ship an SVG → saves ~250 KB on every cold load. |
| Resource hints | ✅ | `preconnect` for `fonts.googleapis.com` + `fonts.gstatic.com` (crossorigin); `dns-prefetch` for `esm.sh` + `js.sentry-cdn.com`. Added to `<head>` for faster first paint. |
| **TipTap from esm.sh** | 🚩 | Docs/Notes editor imports `@tiptap/*` from `https://esm.sh` at module load. External CDN = single point of failure for the Docs editor (same risk class as the old jsdelivr issue). **Fix:** self-host the TipTap bundle under `/static/vendor/`. |
| Index served uncached | 🟡 | `_serve_app()` re-reads 288 KB from disk + does a string `.replace()` on **every** `/app` request. Minor, but cache the templated HTML in memory at startup. |
| Sentry session replay | 🟡 | `replaysSessionSampleRate: 0.1` + replay bundle adds weight via `js.sentry-cdn.com`. Fine for launch; revisit sampling if first-paint budget is tight. |

**Load verdict:** Fundamentals (gzip, immutable cache, defer, lazy hydration, self-hosted icons) are in place. Three quick wins before launch: **shrink the logo PNG**, **add preconnect hints**, **self-host TipTap**.

---

## Responsiveness audit

`css/styles.css` carries **45+ media queries**. Coverage:

- **Mobile/tablet down-steps:** 480, 560, 600, 640, 700, 720, 768, 800, 900, 960 px.
- **Ultra-wide up-steps:** 1280, 1440, 1920, 2560 px (large-monitor layouts handled).
- **Per-feature responsive grids:** shell (`768px`), Org stats (`gl-stats`), Academic (`acad-metric-row`, `acad-split`, `acad-kanban`, `acad-research-layout`, `acad-ai-tutor-layout`, `acad-ai-tools-grid`), Marketplace (`mkt-metric-row`), Skills (`sk-summary-grid`).
- **Mobile shell:** hamburger (`tb-ham`), slide-in sidebar + dim `overlay` (`toggleMobileSidebar`), bottom **tab-bar** (`navTab`, `.tab-pill`, `mn-*`), and a dedicated mobile **"Me"** panel (`panel-me-mobile`).

**Responsive verdict:** ✅ Broadly covered phone→ultrawide. Recommended manual spot-checks before launch: **Org Space 12-tab bar** and **Academic dual-role tab bars** at 360–414 px (tab overflow), and the **Add-Task / Marketplace-Publish modals** at small heights.

---

## 0. Routes

| Route | Serves | Purpose |
|---|---|---|
| `/` | `landing.html` | Marketing landing |
| `/app` | `index.html` | Main product (SPA) |
| `/lecturer` | `lecturer.html` | Standalone lecturer console |
| `/admin`, `/admin/metrics` | `admin.html`, `admin_metrics.html` | Internal admin |
| `/terms`, `/privacy` | `legal/*.html` | Legal |
| `/share/{id}` | inline HTML | Public share links |
| `/billing/callback`, `/sw.js`, `/api/*` | — | Payment return, service worker, ~200 API endpoints |

---

## 1. Landing page (`/`)

Order: **Nav bar** (logo + CTA) → **Hero** (badge, headline, sub, 2 CTAs, glow + mockup, `fade-up` reveals) → **Features grid** → **Spaces** (3 cards: Personal / Org / Academic) → **Pricing** (3-tier grid, middle card `featured`) → **CTA section** (email capture) → **Footer** (brand + link columns).

---

## 2. Auth

Single card, tab toggle **Login / Register**:

- **Login:** email, password (`ti-eye` toggle), "Forgot password?", **Sign in**, **Google sign-in**.
- **Register:** name, email, password + confirm (both with visibility toggles).
- **Forgot password** → email → "sent" confirmation view.
- **Reset password** (token link) → new password + confirm.
- **Email verification** resend view.

🚩 **Prod auth (memory / auth audit A1–A7):** Google cross-worker token exchange has failed → orphaned passwordless accounts → email lockout loop. **Verify on live before launch.**

---

## 3. App shell

**Top bar** (`ti-` icons): `menu-2` hamburger (mobile) · brand logo + sidebar toggle · **Search** `⌘K` · autosave status · `plus` Quick-Add (Alt+A) · `maximize` fullscreen · `sun` theme · `bell` notifications (red-dot badge + dropdown w/ "Mark all read") · profile avatar menu (theme toggle, logout).

**Sidebar** — logo + `ti-search` new button; scrollable; collapsible groups:

| Group | Item | Icon | Panel |
|---|---|---|---|
| **Pinned** | Sivarr AI | `sparkles` | chat |
| | Home | `home` | home |
| | Inbox | `inbox` | announcements (+ unread dot) |
| **Work** | Tasks | `checkbox` | flux |
| | Goals | `target` | goals |
| | Calendar | `calendar` | calendar |
| | Docs & Notes | `notebook` | notes |
| | Templates | `layout-grid` | templates |
| **Life** | Skills | `atom` | skills |
| | Finance | `wallet` | finance |
| | Habits | `flame` | habits |
| | Journal | `writing` | journal |
| | Analytics | `chart-bar` | stats |
| | Weekly Review | `calendar-stats` | review |
| **Connect** | Community | `users` | community |
| | Opportunities | `briefcase` | opportunities |
| | Marketplace 🆕 | `building-store` | marketplace |
| | Integrations | `plug-connected` | library |
| | Agents 🆕 | `robot` | agents |
| **Spaces** | dynamic list + `plus` new | — | org / personal / academic |

**Footer:** `bolt` Upgrade (plan label) · user row (avatar, name, plan) · `message-2` Feedback · `settings` Settings.

**Mobile nav:** bottom tab-bar (`navTab` + `.tab-pill`, horizontal-scroll, auto-centers active) + `panel-me-mobile`.

---

## 4. Pinned

### Sivarr AI — chat ✅
Header: title + `ti-trash` clear + `ti-download` export. Model selector: **Siva** (active) + locked Claude / GPT-4 / Perplexity pills. Empty state: 4 quick-prompt cards (Brainstorm / Write / Plan / Summarize). Composer: attach menu (`image` / `pdf` / `file` / `doc`), `toggleVoice`, send. *(AI backend is Gemini; locked model pills are aspirational.)*

### Home ✅
- **AI Daily Briefing** card (`refreshHomeBrief`).
- **Getting-Started** guide (auto-hides 7 days post-signup): 6 video cards w/ progress bar (Welcome, AI Chat, Tasks & Goals, Notes & Docs, Org Space, Billing) + 4 tip cards (⌘K, Extract Tasks, Dark Mode, Install as App).
- 7 **shortcut pills:** Ask Sivarr, Tasks, Goals, Finance, Skills, Journal, **Extract Tasks** (AI).
- 4 **stat cards:** AI Questions · Focus Sessions · Day Streak · Active Goals.

### Inbox — announcements ✅
Announcement list (`annLoad`), empty state "No announcements yet."

---

## 5. Work

### Tasks — flux ✅
Board with **Status** (Not Started / In Progress / Done), **Priority**, **Due** columns; filter + sort (`shToggleFilter`, `shToggleSort`); **AI Tools** (`generateTaskStructure`, "Generate Steps"); **Add-Task modal** — full Task Detail form: name, description, assignee (`@username`), attach file, due date/time, priority, repeat (One time / Daily / Weekly / Monthly), link-to-goal, summary/notes, **Save Task**; **Download PDF** (`createStudyPDF`).

### Goals ✅
Goal list/tracker (`glLoad`, `glSaveGoal`). Add-form: goal type, deadline, **OKR / Key Results**, category. `target` icon.

### Calendar ✅
Month grid (`calInit`, `calNav`, Sun–Sat), per-day event list, `calAddEvent`, **Connect Google** (`gcalConnect`).

### Docs & Notes — notes 🟡
Two-pane: searchable doc list (`ti-plus` new, `ti-search`) + editor pane ("Select a doc or create a new one"). Editor is **TipTap** (esm.sh — see load flag).

### Templates ✅🟡
**Template Library** (`tplInit`): search + filter chips (All / Popular / New / Productivity / Finance / Habits / Focus / Charts / Daily / Weekly / Monthly / Tasks / Budget / Streaks / Interactive). Cards: Weekly Task Manager, Habit Tracker, Monthly Budget Tracker, etc. → **Preview modal** (iframe) → **Use template**. 🟡 *Rebuilt June 2026; required CSP `frame-src` fix; not browser-verified.*

---

## 6. Life

### Skills ✅
Skill list/tracker (`skillsInit`, `skillAdd`). `atom` icon.

### Finance ✅
Tabs: **Overview / Transactions / Budget** (`finTab`). Add income/expense (`finAdd`, `+`/`−`), bank sync (`finSyncMono` — Mono). Naira-aware. `building-bank` / `wallet` icons.

### Habits ✅
Streak tracker (`habitInit`, `habitAdd`): Done Today, Best Streak, weekly view. `flame`.

### Journal ✅🚩
Today's entry (`journalSave`) + Past Entries list + mood. 🚩 *Verify mood chart renders on live prod DB (memory: Sprint B/C/D open item).*

### Analytics — stats ✅
Charts/metrics dashboard (`loadStats`). `chart-bar`.

### Weekly Review — review ✅
Guided weekly reflection (`reviewInit`, `reviewGenerate`, "Ask AI"): tasks done, focus sessions, habits rate, active goals, exam countdown, quick study note. `calendar-stats`.

---

## 7. Connect

### Community ✅
**Feed** (`communityInit`, `communityPost`), filters (`commFilter`, All), post composer "Share something…". Report/flag safety added (Stage 9). `users`.

### Opportunities ✅
Board (`oppInit`, `oppPost`, `oppSetCat`, All filter) + **My Profile** tab.

### Marketplace 🆕 🟡
"Sivarr Marketplace · **Preview**" (`mktInit`). Views: **Browse / Featured / Installed / My Listings** (`mktSetView`). Types: Extensions / Integrations / Templates (`mktSetType`). Categories: All / Work / Productivity / Finance / Academic / Developer / Communication (`mktSetCategory`). Filters: Free only, Most installed. Stats: Active listings, Total installs, Installed items. **Publish modal** (`mktOpenPublish`): item type (Extension / Integration / Template), name, description, category, pricing (Free / Freemium / Paid), GitHub URL, changelog, reviews tab. 🟡 *Verified Stage 9; admin-queue UI deferred; not browser-verified.*

### Integrations — library ✅
Resource **Library** (`integrationsRender`, `libFilter`): Khan Academy, Coursera, Notion, Anki, YouTube Edu, Google Scholar; search; deep-links into real panels.

### Agents 🆕 🟡
"Sivarr Agents" (`agInit`, `agNav`): browse, **Become an Agent** (`agNavDashboardOrApply`), creator dashboard (templates, featured, earnings/payouts — full creator economy in API). 🟡 *Not browser-verified.* `robot`.

---

## 8. Spaces

### Personal ✅
Views: **Overview / Board / List / Analytics** (`spTab`). Surfaces Tasks (kanban/list), Goals (`psNewGoal`), Habits (`psNewHabit`), Notes (`psNewNote`), Journal (`psSaveJournal`, mood). Stat cards: active goals, goals on track, best streak, habit rate, journal entries, tasks/week. Icons: `layout-dashboard`, `layout-kanban`, `list`, `chart-bar`.

### Org Space ✅ (Pro-gated)
Full team workspace, **12 tabs** (`orgTab`): **Overview · Tasks · Goals · Projects · Docs · Members · Insights · Chat · Announce · Analytics · Founder · Financials**. Overview = AI Daily Briefing (`orgGetBriefing`) + stat cards (open/completed tasks, projects active, members, OKRs) + priority tasks, top goals, team, projects. Header: logo edit, add-extension, new-task, more-menu. *(Also the DB-outage canary per memory.)* Paywall guards: `org`/`orgchat`/`team`/`projects` → Pro, `founder` → Team.

### Academic — dual-role 🚩
Role toggle (`lSwitchTab` / student tabs):

- **Lecturer:** stat cards (Total Students, Active Courses, Pending Submissions) + tabs **Overview / Courses / Students / Assessments / Analytics / AI Tools**.
- **Student:** tabs **Overview / Vault / Sprint / Research / Groups / Tutor** (`s-overview`, `s-vault`, `s-sprint`, `s-research`, `s-groups`, `s-tutor`).

🚩 **Known issue (Stage 6):** Lecturer **Exam Builder returns 401** — it wires to global `LECTURER_PASSWORD`-gated endpoints, so normal v3 lecturers can't use it. Fix deferred (rec: rebuild on the v3 blob pattern). **Most notable functional gap for launch.**

---

## 9. Settings — panel-settings ✅
Sub-tabs (`stInit`): **Profile · Appearance** (theme) **· Notifications · Security · My Plan** (current plan + billing/invoices). 🚩 *Account deletion now fails honestly instead of faking success (commit cff97d7). Stage 10 billing paused pending pricing — invoices shipped.*

---

## 10. Admin (`/admin`) ✅
Password-gated. Sidebar: **Overview** (Total Users, Active Sessions, Spaces Created, Questions Asked, Quizzes Taken, Avg Score; difficulty distribution; top topics; spaces-by-type; recent sessions) **· Users · Live Sessions · Spaces · Announcements · System Health**. Plus `/admin/metrics`.

---

## 11. Utility panels & modals

- **Quiz** (`panel-quiz`): knowledge test, difficulty selector (Easy/Medium/Hard), `startQuiz`.
- **Study Deck** (`panel-lab`).
- **Study Plan** (`panel-studyplan`): subject/course, date, `spLoadSaved`.
- **Content Hub** (`panel-contenthub`): connect platforms (`chInit`).
- **More** (`panel-more`): lecture file upload.
- **Profile** (`panel-profile`).
- **Command palette** (⌘K, `cmdOpen`): search panels, notes, actions.
- **Quick-Add / NL** (`nlOpen`, Alt+A): type anything → routed to the right panel.
- **Create Space** modal (`openCreateSpaceModal`): space name + type picker (`spPickType`).
- **Space Settings** modal (`spaceSettingsTab`): rename, add members, extensions, **Danger zone** (delete).
- **Pricing** modal (`showPricing`).
- **Feedback** modal (`openFeedback`).

---

## 12. Mobile app ([mobile/](../mobile/))
React Native (Expo / EAS), separate from the web SPA. Screens: Home, Today, Tasks, Goals, Habits, Focus, Journal, Community, AI, Chat, WeeklyReview, Settings, Me, More, Login. Push notifications service.

---

## Launch-readiness checklist

### Performance (quick wins)
- [ ] 🚩 Shrink `static/sivarrai.png` (256 KB → SVG/48px) — used at 16–24 px everywhere.
- [ ] 🚩 Add `<link rel="preconnect">` for `fonts.googleapis.com`, `fonts.gstatic.com`, `esm.sh`.
- [ ] 🚩 Self-host TipTap (remove `esm.sh` runtime dependency for Docs editor).
- [ ] 🟡 Cache templated index HTML in memory (avoid 288 KB disk read + replace per request).

### Responsiveness (manual spot-checks)
- [ ] Org Space 12-tab bar at 360–414 px (tab overflow / scroll).
- [ ] Academic dual-role tab bars at 360–414 px.
- [ ] Add-Task & Marketplace-Publish modals at short viewport heights.

### Functional (from memory + code)
- [ ] 🚩 **Academic Exam Builder 401** (Stage 6) — lecturer can't build exams.
- [ ] 🚩 Auth on prod: Google OAuth cross-worker + orphaned-account lockout.
- [ ] 🚩 Security (unfixed): org/invite HTML-injection phishing relay; forgot-password rate-limit gap; upload size-check ordering.
- [ ] 🟡 Browser-verify: Marketplace, Agents, Templates Library, Journal mood chart on prod DB.
- [ ] 🟡 Billing: finalize pricing → resume Stage 10.

---

*Generated for launch review. Cross-reference: `docs/PROD_READINESS.md`, `docs/AUTH_SMOKE_TEST.md`, `docs/BUILD_BLUEPRINT_TRACKER.md`.*
