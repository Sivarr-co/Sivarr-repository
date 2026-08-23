# Session Briefs — parallel work queue

**How to use this file:** Hunter assigns a session by number. Start by reading this
file, find your numbered brief, and do only that brief.

Say to a new session: *"Read docs/SESSION_BRIEFS.md and do Session 6."*

---

## Standing rules — every session, no exceptions

1. **`git fetch && git status` before you touch anything.** Three parties push to
   `main`: Hunter, Chibistenofe16, and other Claude sessions. Assume you are behind.

2. **Never hand-write a `?v=` cache-buster.** `core.py`'s `asset()` content-hashes
   automatically, and CI fails the build if you bypass it. Templates use
   `{{ asset('/path') }}`.

3. **Stay inside the files your brief lists.** These four are shared by nearly
   everything and are the collision risk:

   - `app.py`
   - `js/app.js`
   - `templates/index.html`
   - `css/panels.css`

   If your work seems to require editing one of these and it is not named in your
   brief, **stop and report** rather than editing it.

4. **Do not commit or push.** Hunter commits himself. Leave work in the tree and
   report what you changed.

5. **Verify before reporting done.** Minimum: `python -c "import app"` clean,
   `python -m pytest tests/ -q` green, `node --check` on any JS you touched. If you
   skipped part of the brief, say so explicitly — a partial result reported as done
   costs more than an honest gap.

---

## Completed — do not redo

| # | Unit | Result |
|---|------|--------|
| 1 | Real-time test coverage | `tests/test_realtime.py`, 16 tests, suite 55 → 71 |
| 2 | Mobile server sync | Today/Habits/Journal wired. **FocusScreen outstanding — see Session 12** |
| 3 | Notion importer | `routes/import_notion.py`, verified end to end |
| 4 | Memory refresh | Both memory files current through 2026-08-23 |

---

## Session 5 — Search backend: move to Postgres full-text

**Owns:** `app.py` (the `/api/search` block only), new `routes/search.py`, `database.py`

`unified_search` at `app.py:4406` lowercases the query and runs `if q in title`
across records loaded into memory. No index, no ranking, no pagination, no typo
tolerance.

Extract it into `routes/search.py` following the pattern of any existing router
(see `routes/goals.py` for the simplest example), then back it with Postgres
full-text search: a `tsvector` column with a GIN index, `plainto_tsquery` for the
query, `ts_rank` for ordering. Keep the existing JSON response shape so the
frontend keeps working untouched — the shape is `{"results": [{type, icon, title,
meta, id}]}`.

Preserve the current soft-delete filtering (`if t.get("deleted_at"): continue`) —
there is a test covering it.

**Done when:** `/api/search` returns ranked results from an index, the response
shape is unchanged, `tests/` still passes, and you have added tests for ranking
and for the deleted-record exclusion.

**Do not** touch `js/app.js` — that is Session 6.

---

## Session 6 — Search coverage and frontend

**Depends on Session 5. Do not start until it has landed.**

**Owns:** `routes/search.py`, `js/app.js` (the search block near line 8302 only)

Search currently covers tasks, goals, docs, community posts and skills. Extend it
to journal entries, calendar events, org docs and org messages. Org content must
be scoped to orgs the user is actually a member of — check how `routes/org.py`
resolves membership and reuse it; do not invent a new check.

On the frontend, surface the ranking Session 5 added: order by score, show which
type each hit is, and paginate rather than dumping everything.

**Done when:** all listed sources are searchable, org results never leak across
orgs (add a test for this specifically), and results are ranked and paginated.

---

## Session 7 — De-duplicate flashcards and Pomodoro

**Owns:** `js/app.js`, `js/features/academic.js`, `js/features/marketplace.js`, `css/panels.css`

Two duplicated systems, and they share files, so they must be done together.

- **Flashcards:** `js/app.js` has a `_flash*` family (`_flashBuild`, `_flashRender`,
  `flashFlip`, ~8 references). `js/features/academic.js` has its own with ~33
  references. Decide which is canonical — academic.js is the better home since
  flashcards are an Academic feature — migrate any behaviour the other has that it
  lacks, then delete the loser and its orphaned CSS.
- **Pomodoro:** references in `js/features/marketplace.js` (8),
  `js/features/academic.js` (3), `js/app.js` (1). Consolidate to one implementation.

Confirm zero remaining references with grep before deleting anything. After any
line-range deletion in CSS or JS, brace-count check the file (`grep -c '{'` vs
`'}'`) — a past cleanup in this repo cut a rule in half and left an orphaned brace.

**Done when:** one implementation of each remains, no dead references, brace
balance verified, `node --check` clean on every touched file.

---

## Session 8 — Bundler and minification

**Owns:** new `package.json` + build config, `templates/index.html`, `core.py`, `.github/workflows/ci.yml`

The app ships ~1.05 MB of unminified JS and ~494 KB of CSS, plus a 415 KB Tiptap
bundle. There is no bundler. For a product targeting low-connectivity users this
is the positioning working against itself.

Add esbuild (simplest fit — no framework, no JSX, no transpilation needed).
Minify JS and CSS into hashed output files. `core.py`'s `asset()` already
content-hashes, so make the build write files that `asset()` can still resolve, or
extend `asset()` to map source paths to built ones. Add a CI step that runs the
build and fails if it errors.

Keep a dev path that serves unminified sources — `core.py` already has
`_ASSET_DEV_MODE` gated on `RAILWAY_ENVIRONMENT`.

**Done when:** production serves minified hashed bundles, the dev path still serves
readable sources, the app boots and renders, and CI builds successfully.

---

## Session 9 — pgvector infrastructure

**Owns:** `database.py`, `ai_core.py`, new indexing job

There is no embedding, vector store or retrieval anywhere in the codebase, so every
AI surface is prompt-and-respond and cannot answer questions about the user's own
data.

Add the `pgvector` extension and an `embeddings` table (owner sid, source type,
source id, chunk text, vector, updated timestamp). Write an embedding helper in
`ai_core.py` using Gemini's embedding model. Add a background job that indexes
tasks, docs, goals and journal entries — follow the existing APScheduler jobs
registered around `app.py:2097` for the pattern, and make it incremental rather
than reindexing everything on each run.

Guard everything on the extension being available, and degrade gracefully if it is
not — Supabase supports pgvector but the JSON-file fallback storage path does not.

**Done when:** content is indexed incrementally, embeddings persist, and the whole
thing is a no-op rather than a crash when pgvector is unavailable.

---

## Session 10 — Wire AI retrieval into chat

**Depends on Session 9.**

**Owns:** `routes/ai_chat.py`, `ai_core.py`

Before calling Gemini, embed the user's message, retrieve the top-k matching chunks
scoped to that user's sid, and inject them into the prompt as context with a rule
that the model cites which item it drew from.

Retrieval must be scoped by sid. A user must never retrieve another user's content
— add a test for this specifically.

**Done when:** the assistant can answer a question about the user's own tasks or
documents, cross-user retrieval is impossible and tested, and chat still works
normally when nothing relevant is found.

---

## Session 11 — Trello / Asana CSV importer

**Owns:** new `routes/import_trello.py`, one registration line in `app.py`

Follow `routes/import_notion.py` exactly — it is the reference implementation.
It classifies uploaded files and delegates to the existing `import_tasks` /
`import_notes` functions in-process rather than duplicating storage logic. Do the
same.

Handle Trello's JSON export (lists become status, cards become tasks, due dates
carry over) and Asana's CSV export (Name, Assignee, Due Date, Section/Column).

Your `app.py` edit is **one line**, matching the existing pattern at `app.py:1247`.

**Done when:** both formats import correctly, verified end to end with a real
sample file, not just by reading the code.

---

## Session 12 — Focus screen: decide and finish

**Owns:** `mobile/src/screens/FocusScreen.tsx`, `mobile/src/api/client.ts`, `routes/` (new focus router if needed)

Session 2 wired Today, Habits and Journal to the server but left FocusScreen
local-only, because there is no `/api/focus` endpoint anywhere server-side.

Either add focus-session endpoints (`/api/focus/add`, `/api/focus`) following
`routes/habits.py` as the closest model, then wire the screen — or confirm with
Hunter that focus logs stay device-local and remove them from the sync plan. Do
not leave it ambiguous a second time.

**Done when:** focus data either syncs, or is documented as deliberately local.

---

## Not for a session — needs Hunter

These are blocked on decisions or account access. Do not guess, and do not
fabricate content for them.

- **Pricing.** The landing page shows ₦0 / ₦19,800 / ₦36,300. `config.py` bills
  ₦2,500 / ₦25,000 / ₦8,000. Stripe is also now in the stack for USD. Which set is
  canonical is Hunter's call.
- **NDPR and business entity** on the legal pages — needs the registered entity
  name and address.
- **Footer pages** (About, Blog, Careers, Changelog, Roadmap, Security, Cookies) —
  needs real content. A missing link beats a fabricated page.
- **Mobile EAS project id and Play Store service account** — needs Hunter's Expo
  and Google Play Console accounts.
- **Resend sending domain verification.**

---

## Deliberately not parallelised

**CSP `unsafe-inline`.** 565 inline handlers across the templates plus `app.py`.
It touches nearly every file and will collide with everything. Save it for a
window when nothing else is running.
