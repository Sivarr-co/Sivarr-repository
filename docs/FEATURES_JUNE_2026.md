# Sivarr — Feature Reference (June 2026 Session)
> Documents every feature built, fixed, or improved in the June 2026 development session.
> **Covers:** commits `c3237af` → `present` on branch `main`

---

## Table of Contents
1. [Polish & Bug Fixes](#1-polish--bug-fixes)
2. [Onboarding Flow](#2-onboarding-flow)
3. [Skills Panel](#3-skills-panel)
4. [Personal Finance Panel](#4-personal-finance-panel)
5. [Home Dashboard Widgets](#5-home-dashboard-widgets)
6. [Academic Space — Assignment Grading](#6-academic-space--assignment-grading)
7. [User Profile Improvements](#7-user-profile-improvements)
8. [Community Depth](#8-community-depth)
9. [Agent Selector (SIVA AI)](#9-agent-selector-siva-ai)
10. [Weekly Review — Skills & Finance Context](#10-weekly-review--skills--finance-context)
11. [Unified Search — Skills & Finance](#11-unified-search--skills--finance)
12. [Framework Templates](#12-framework-templates)
13. [Org Space — Rename](#13-org-space--rename)
14. [Navigation & Export Completeness](#14-navigation--export-completeness)
15. [API Reference](#15-api-reference)
16. [Data Models](#16-data-models)

---

## 1. Polish & Bug Fixes

### Settings → Change Password
**Was:** Button showed "coming soon" toast.  
**Now:** Fully working — verifies current password with bcrypt before saving new one.

- UI: Added "Current Password" field to Settings → Security
- Backend: `POST /api/auth/change-password`
- Rejects social-auth accounts (no stored password)
- Min 8 characters enforced

### Settings → Profile Save
**Was:** Name and phone saved to localStorage only — lost on logout / other devices.  
**Now:** Saves to `users` table in PostgreSQL. In-memory session name updated immediately so topbar reflects change without re-login.

- Backend: `POST /api/user/update`
- Email field is now `readonly` — email is auth-tied and cannot be changed here

### Google OAuth Exchange — Retry Logic
**Was:** Single exchange attempt — failure showed error immediately.  
**Now:** Retries up to 5 times with 700ms × attempt backoff before giving up. Handles the multi-worker race where the worker that stored the code is different from the one handling the exchange.

### Community & Opportunities — DB Migration
**Was:** Stored in flat JSON files on Railway's ephemeral filesystem — wiped on every redeploy.  
**Now:** Stored in proper PostgreSQL tables (`community_posts`, `opportunities`). JSON file fallback retained for no-DB environments.

- Seed data moved to module-level constants, seeded idempotently on startup

### Org Space — Rename
**Was:** "Rename Space" modal showed then toasted "contact support".  
**Now:** Saves to DB via `POST /api/org/update`. Updates header live without reload.  
Only the org owner can rename.

### Analytics Panel — view-head
Added the standard `view-head` component (icon + "Analytics" title) to `panel-stats`. Was the only panel in the app without one.

---

## 2. Onboarding Flow

**Location:** Full-screen overlay, shown once after first login.  
**Storage:** `localStorage` key `si_onboarded_{sid}` + DB blob `user_blobs(sid, 'onboarding')`

### Steps (5 total)

| Step | Content |
|---|---|
| 1 | Welcome screen with user's first name |
| 2 | Role picker — 4 roles in 2×2 grid |
| 3 | Goal creation — title, category, optional deadline |
| 4 | Connect integrations — Google Calendar, GitHub, Mono |
| 5 | Done screen — 3 role-personalised action cards |

### Roles

| Role | ID | Target user | Done-screen actions |
|---|---|---|---|
| Student | `student` | Academic users | Chat, Courses, Goals |
| Founder | `founder` | Company builders | Org Space, Finance, Goals |
| Freelancer | `freelancer` | Independent workers | Tasks, Finance, Goals |
| Creator | `creator` | Content creators | Chat, Community, Goals |

### Goal creation (Step 3)
- Calls `POST /api/goals/add` — creates a real Goal in the user's Goals panel
- Has a **Skip** button so it's never blocking
- Category dropdown: Career, Education, Health, Financial, Personal Growth, Business, Creative, Other

### Role persistence
- `POST /api/user/onboarding` — saves `{done: true, role, completed_at}` to `user_blobs`
- `returning` flag on session restore now checks DB blob instead of quiz session counter (fixes the bug where non-academic users always saw onboarding)

---

## 3. Skills Panel

**Location:** Sidebar → Life → Skills  
**Storage:** `localStorage` key `sivarr_skills_{sid}` + DB via `POST /api/skills/sync` → `user_blobs(sid, 'skills')`  
**Also reachable:** ⌘K → "Skills", mobile nav → Grow section

### Features

**Add Skill**
- Fields: name, emoji (from 15 presets), category, starting level (0–100), target level (0–100)
- Categories: Technical, Language, Creative, Business, Physical, Academic, Other

**Log Session**
- Fields: duration (minutes), optional note, progress gain (+%)
- Updates: session count, total hours, level, last-practiced date

**Progress bar**
- Shows current level filled with level-colour
- Grey marker at target level
- 5 level labels: Beginner (0–20) / Learning (21–40) / Developing (41–60) / Proficient (61–80) / Expert (81–100)

**Ask SIVA**
- Pre-fills a study-plan prompt in SIVA AI chat with skill name, current level, target, sessions, and hours
- No extra navigation — goes to chat, textarea ready to send

**Category filter**
- Auto-built from user's actual skill categories
- Appears only when user has 2+ skills

**Summary stats**
- Total skills / Total hours practiced / Total sessions

### Data Model
```json
{
  "id": "abc123",
  "name": "Python",
  "emoji": "💻",
  "category": "Technical",
  "level": 65,
  "target": 90,
  "sessions": 12,
  "total_mins": 480,
  "created": "2026-06-01",
  "last_practiced": "2026-06-11"
}
```

---

## 4. Personal Finance Panel

**Location:** Sidebar → Life → Finance  
**Storage:** `localStorage` key `sivarr_finance_{sid}` + DB via `POST /api/finance/sync` → `user_blobs(sid, 'finance')`  
**Also reachable:** ⌘K → "Finance", mobile nav → Grow section

### Tabs

**Overview**
- Gradient balance card: net balance, savings rate, month name
- 3-stat row: income / expenses / all-time transactions
- Top 5 spending categories (bar chart)
- Last 5 transactions

**Transactions**
- Filter: All / Income / Expense
- Per transaction: category icon, name, date, amount (green for income, red for expense)
- Delete with confirm modal

**Budget**
- Monthly limit per expense category
- Progress bar — turns red when over budget
- Set/update per category independently

### Categories
**Expenses:** Food & Dining, Transport, Housing/Rent, Utilities, Health, Education, Entertainment, Shopping, Data/Airtime, Other  
**Income:** Salary, Freelance, Business, Investment, Gift/Transfer, Other Income

### Formatting
All amounts in Nigerian Naira (`₦`). Auto-formats: `₦50,000` → `₦50K`, `₦2,000,000` → `₦2.0M`

### Data Model
```json
{
  "transactions": [
    {
      "id": "abc1",
      "type": "expense",
      "amount": 5000,
      "category": "food",
      "note": "Lunch at Chicken Republic",
      "date": "2026-06-11"
    }
  ],
  "budgets": {
    "food": 30000,
    "transport": 15000
  }
}
```

---

## 5. Home Dashboard Widgets

Two new widgets added to the Home panel, both hidden when the user has no relevant data.

### Finance Widget
- Shows between Habit Check-in and Active Goals
- 3-stat row: income / expenses / surplus or deficit (current month)
- Top spending category line
- Tap → navigates to Finance panel

### Skills Widget
- Shows top 3 skills sorted by level
- Each row: emoji, name, level label, coloured progress bar
- "+N more skills" note when >3 exist
- Tap → navigates to Skills panel

### Quick-action Pills
Updated from academic-oriented pills to full personal-workspace pills:
Ask Sivarr / My Tasks / Goals / Finance / Skills / Journal / Extract Tasks

---

## 6. Academic Space — Assignment Grading

### Student side
**Was:** Always showed the submit form regardless of submission status.  
**Now:** Fetches student's own submission before rendering, shows status badge and appropriate UI.

| Status | Display |
|---|---|
| Not submitted | Submit form (textarea + button) |
| Overdue + not submitted | Same, but red "Overdue" badge |
| Submitted | Teal card with "✓ Submitted [date]", content preview, collapsible update form |
| Graded | Coloured card (green ≥70% / amber ≥50% / red <50%) with score, feedback, submission preview |

After any submission, the tab refreshes automatically to show the new status.

**New endpoint:** `GET /api/class/my-submissions?code=&sid=`  
Returns only the authenticated student's own submissions for a class (privacy fix — previously exposed all students' data).

### Lecturer side
**Was:** Could see submission text snippets but had no way to add grades.  
**Now:** Grade button per submission, grade modal with score + feedback.

**New endpoint:** `POST /api/class/grade`
```json
{
  "token": "...",
  "code": "ABC123",
  "assignment_id": "...",
  "student_sid": "...",
  "score": 85,
  "feedback": "Good work on the analysis section."
}
```
- Lecturer auth required
- Score must be 0–100
- Stored in the submission object as `{ score, feedback, graded_at }`

---

## 7. User Profile Improvements

**Location:** Sidebar → Profile  

### Stats row (6 stats)
Goals / Tasks done / Skills / Habits / Journal entries / Posts  
(Replaced the old: Goals / Tasks done / Focus hours / Journal entries — focus hours was empty for most users)

### Skills section
**Was:** Old text-tag system stored in `sivarr_profile_{sid}` localStorage — disconnected from the Skills panel.  
**Now:** Reads directly from `_skData()` (Skills panel data). Shows progress bars, level labels, emojis. "Manage →" link opens Skills panel.

### My Posts section
New section at the bottom of the profile. Fetches the user's community posts, shows:
- Post body preview (120 chars)
- Likes + reply count
- Time ago
- Category badge

### Achievement Badges (16 total, was 6)
| Badge | Trigger |
|---|---|
| ✅ First Task Done | 1 task completed |
| 🏆 10 Tasks Crushed | 10 tasks completed |
| 💎 50 Tasks Done | 50 tasks completed |
| 🎯 Goal Setter | 1 goal created |
| 🏅 Goal Achieved | 1 goal completed |
| 📓 First Journal Entry | 1 journal entry |
| ✍️ 10 Journal Entries | 10 journal entries |
| 🔥 N-Day Streak | Best habit streak ≥ 3 |
| 🌟 30-Day Streak | Best habit streak ≥ 30 |
| 🔁 Habit Builder | 1 habit created |
| 🧠 Skill Tracked | 1 skill added |
| 💡 5 Skills | 5 skills tracked |
| ⚡ 10h Practiced | 10+ hours of skill practice |
| 💰 Finance Tracker | First transaction logged |
| 👥 Community Member | First post made |
| 📢 Active Contributor | 5+ posts made |

---

## 8. Community Depth

### Inline composer
**Was:** `+ Post` button opened a siModal (extra click, lost category context).  
**Now:** Textarea + category dropdown sit directly above the feed. Character counter (0/800) updates live. Post button disabled when empty.

Avatar initial is shown next to the composer, personalised to the logged-in user.

### Delete own post
- Trash icon appears on posts authored by the current user (hover to reveal)
- Confirm modal before deleting
- `DELETE /api/community/posts/{post_id}` — auth-gated, only author can delete
- Works with both DB and JSON-file fallback

### Clickable author names
- Your own name → opens your Profile panel
- Another user's name → filters the feed to show only that user's posts

### Reply display
- Reply count shows total (not just 3)
- "↑ N earlier replies" link shown when >3 replies, allows seeing full context

---

## 9. Agent Selector (SIVA AI)

**Location:** SIVA AI chat panel, between header and message area.

A row of chips showing available and future AI agents:

| Chip | State | Behaviour |
|---|---|---|
| SIVA (Gemini) | Active | Selected by default, highlighted with accent gradient |
| Claude | Locked | Toast: "Claude (Anthropic) integration coming soon ✦" |
| GPT-4 | Locked | Toast: "GPT-4 (OpenAI) integration coming soon ✦" |
| Perplexity | Locked | Toast: "Perplexity integration coming soon ✦" |

**Future wire-up:** When Claude API is connected, set `_activeAgent = 'claude'` and branch in the `send()` function to call the appropriate API.

---

## 10. Weekly Review — Skills & Finance Context

The Weekly Review AI prompt now includes Skills and Finance data from the user's DB blobs.

**Skills added to prompt:** Top 5 skills with name, current proficiency %, and session count.  
**Finance added to prompt:** This month's income, expenses, and net balance in ₦.

The AI uses this to write more personalised "Focus Next Week" recommendations (e.g. "You're at 65% on Python — dedicate 3 sessions to complete that module" or "Your expenses exceeded income by ₦12,000 — consider cutting entertainment spend next week").

---

## 11. Unified Search — Skills & Finance

`GET /api/search?q=&token=`

Now searches 6 data types (was 4):

| Type | Icon | Matches on | Result meta |
|---|---|---|---|
| task | ✅/☐ | title | status |
| goal | 🎯 | title, subject | % complete |
| doc | 📄 | title, content | content snippet |
| post | 💬 | body | author name |
| skill | emoji | name, category | level% · category |
| transaction | 💰/💸 | note, category | ₦amount · date |

Results capped at 30. Skills and Finance read from `user_blobs` — no extra DB tables needed.

---

## 12. Framework Templates

**Location:** Command Centre → ⚡ Create Framework pane (4 buttons)

Each template prompts for parameters, creates a set of tasks in Flux, then navigates there.

| Template | Parameters | Tasks created |
|---|---|---|
| Study Routine | Subject, daily mins | 4: read, practice, flashcards, summarise |
| Project Pipeline | Project name | 6: plan → design → build → test → launch → retro |
| Exam Prep | Subject, exam date | 7: topic list, 3× weekly revision, past papers, weak spots, final |
| Team Sprint | Sprint goal, duration | 6: planning, milestones, build, check-in, review, retro |

All tasks are created with appropriate `type` and `priority` fields and appear at the top of the Flux task list.

---

## 13. Org Space — Rename

`POST /api/org/update`

```json
{ "token": "...", "name": "New Space Name" }
```

- Owner-only (403 if not owner)
- Updates `orgs.name` in DB
- In-memory ORG object updated → header reflects new name immediately
- Accessible via the ⋯ more menu in the Org Space header

---

## 14. Navigation & Export Completeness

### PANEL_SECTION_MAP additions
`finance`, `skills`, `review` all added to the `'grow'` section. Ensures the sidebar Life section correctly expands/collapses when navigating to these panels.

### CMD_ITEMS additions (⌘K palette)
Finance (💰 · Life), Skills (🧠 · Life), Weekly Review (📋 · Life)

### Mobile nav additions
Finance (💰) and Skills (🧠) added to the Grow section of the mobile slide-in nav.

### Export ZIP (`/api/export`)
Two new CSV files added to the export:
- `skills.csv` — name, category, level, target, sessions, total_mins, last_practiced
- `finance.csv` — date, type, category, amount, note

Data sourced from client-sent localStorage payload; falls back to DB blob if not provided.

---

## 15. API Reference

### New endpoints this session

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/change-password` | session token | Change password (verifies current first) |
| POST | `/api/user/update` | session token | Update display name + phone |
| POST | `/api/user/onboarding` | session token | Save onboarding role + mark complete |
| POST | `/api/org/update` | session token (owner) | Rename org / update description |
| POST | `/api/skills/sync` | session token | Sync skills blob to DB |
| POST | `/api/finance/sync` | session token | Sync finance blob to DB |
| GET | `/api/finance/restore` | session token | Restore finance data from DB |
| GET | `/api/class/my-submissions` | sid query param | Student's own submissions + grades |
| POST | `/api/class/grade` | lecturer token | Grade a student submission |
| DELETE | `/api/community/posts/{id}` | session token | Delete own post |

### Updated endpoints

| Method | Path | Change |
|---|---|---|
| GET | `/api/search` | Now returns `skill` and `transaction` result types |
| POST | `/api/ai/weekly-review` | Reads skills + finance from user_blobs for richer prompts |
| GET | `/api/community/posts` | Migrated from JSON file to DB |
| POST | `/api/community/posts` | Migrated from JSON file to DB |
| GET | `/api/opportunities` | Migrated from JSON file to DB |
| POST | `/api/opportunities` | Migrated from JSON file to DB |
| POST | `/api/export` | Now includes skills.csv + finance.csv |

---

## 16. Data Models

### DB tables added

#### `user_blobs`
Generic per-user JSON store. Used by Skills, Finance, and Onboarding.
```sql
CREATE TABLE user_blobs (
    sid        TEXT NOT NULL,
    key        TEXT NOT NULL,  -- 'skills' | 'finance' | 'onboarding'
    data       JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (sid, key)
);
```

#### `community_posts`
```sql
CREATE TABLE community_posts (
    id          TEXT PRIMARY KEY,
    author_name TEXT NOT NULL DEFAULT 'Sivarr User',
    author_sid  TEXT,
    body        TEXT NOT NULL,
    category    TEXT DEFAULT 'general',
    tags        JSONB DEFAULT '[]',
    likes       JSONB DEFAULT '[]',   -- array of sids
    replies     JSONB DEFAULT '[]',   -- array of reply objects
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### `opportunities`
```sql
CREATE TABLE opportunities (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    link         TEXT DEFAULT '',
    category     TEXT DEFAULT 'other',
    organisation TEXT DEFAULT '',
    location     TEXT DEFAULT '',
    deadline     TEXT DEFAULT '',
    submitted_by TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### Grade object (stored inside assignment submissions)
```json
{
  "score": 85,
  "feedback": "Great analysis in section 2.",
  "graded_at": "2026-06-12 14:30"
}
```

### Onboarding blob
```json
{
  "done": true,
  "role": "founder",
  "completed_at": "2026-06-12T10:00:00"
}
```
