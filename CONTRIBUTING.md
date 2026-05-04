# Contributing to Sivarr

Welcome to the Sivarr team. This doc covers everything you need to get started, what you're responsible for, and how we work together without stepping on each other.

---

## Stack Overview

| Layer | Tech |
|---|---|
| Backend | FastAPI (Python) |
| AI | Gemini AI |
| Frontend | Vanilla JS, HTML, CSS (separated files) |
| Deployment | Railway |
| Live URL | sivarr.up.railway.app |

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/[org]/sivarr.git
cd sivarr
```

### 2. Set up your environment

Copy the example env file — never commit real keys:

```bash
cp .env.example .env
```

Fill in your local values. Ask Hunter for any keys you need.

### 3. Install & run

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

---

## Branch Strategy

```
main     ← production only. Never push directly.
dev      ← integration branch. All PRs go here first.
feat/    ← your working branch. Name it clearly.
```

**Branch naming:**

```bash
git checkout -b feat/goals-tracker-ui
git checkout -b feat/spaces-api-endpoint
git checkout -b fix/panel-layout-mobile
```

**Workflow:**

1. Branch off `dev`
2. Build your feature
3. Open a PR into `dev`
4. Hunter reviews and merges
5. Hunter promotes `dev` → `main` when stable

---

## Daily Async Check-in

Post a short update in the team channel each morning:

```
✅ Yesterday: what you shipped
🔨 Today: what you're working on
🚧 Blockers: anything you need help with
```

This keeps everyone unblocked without meetings.

---

## Task Ownership

### Engineer 1 — Panels & Core UI

You own the dashboard panel system. Each panel is a self-contained component.

**Current panel backlog:**
- Goals Tracker — polish interactions, persistence
- Document Hub — upload states, file type handling
- Study Groups — member list UI, invite flow
- Pomodoro Timer — session history, sound toggle

**How to work:**
- Each panel lives in its own section of `js/app.js` and `css/styles.css`
- Don't touch layout/dashboard wrapper code without checking with Hunter first
- Mobile wiring: every new panel must be connected to the mobile tab bar

**Definition of done for a panel:**
- [ ] Renders correctly on desktop
- [ ] Renders correctly on mobile
- [ ] State persists on refresh (localStorage or backend)
- [ ] No layout bleed outside the dashboard container

---

### Engineer 2 — Spaces System & Backend

You own the Spaces system and backend API endpoints.

**Current backlog:**
- Spaces: dynamic creation, rename, delete, reorder
- Backend: REST endpoints for spaces CRUD
- Learning Hub: content fetching and display
- Content Hub: feed structure and API integration

**How to work:**
- Backend changes go in clearly named route files
- Any new API endpoint needs a matching entry in the README API section
- For Spaces frontend logic, coordinate with Eng 1 if it touches the sidebar or modal

**Definition of done for a feature:**
- [ ] Backend endpoint tested with Postman or curl
- [ ] Frontend wired and functional
- [ ] Error states handled (empty, failed load, etc.)
- [ ] No console errors in the browser

---

## Code Rules

- **No full file rewrites** — make surgical edits to existing files
- **No inline styles** — CSS goes in `css/styles.css`
- **No inline scripts** — JS goes in `js/app.js`
- **Test before PR** — run `node --check js/app.js` to validate JS before pushing
- **Comment your work** — if you add a non-obvious function, add a one-line comment above it

---

## File Structure

```
/
├── main.py              ← FastAPI entry point
├── routes/              ← API route files
├── static/
│   ├── css/
│   │   └── styles.css   ← all styles here
│   └── js/
│       └── app.js       ← all frontend logic here
├── templates/
│   └── index.html       ← main template
├── .env.example         ← copy this to .env locally
└── requirements.txt
```

---

## What Hunter Owns

Don't modify these without a conversation first:

- Railway config / environment variables
- Gemini AI integration code
- `main.py` core app setup
- Authentication / security middleware
- `main` branch — Hunter handles all production merges

---

## Questions?

Ping Hunter directly. When in doubt, ask before you build — it's faster than rebuilding.
