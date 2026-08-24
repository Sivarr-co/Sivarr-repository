# Session Follow-ups — misses, loopholes, and what "done" actually requires

Companion to [SESSION_BRIEFS.md](SESSION_BRIEFS.md). That file held Sessions 1-12.
This one holds everything that came out of cross-checking them: work that was
skipped, work that was reported done but is only partly done, and gaps in
verification that let both happen unnoticed.

**How to use:** Hunter assigns a session by number. Read this file, find your
number, do only that brief.

Say to a new session: *"Read docs/SESSION_FOLLOWUPS.md and do Session 14."*

The standing rules in SESSION_BRIEFS.md still apply in full. The verification
standard below is additional, and it is not optional.

---

## Status at a glance

| # | Session | State |
|---|---------|-------|
| 13 | Wire AI retrieval into chat | **Done** — verified 2026-08-24 |
| 14 | Get Postgres into CI | **Done** — verified 2026-08-24 |
| 15 | Verify the production deploy | **Done** — verified 2026-08-24 |
| 16 | Make search coverage uniform | Open — unblocked by 14 |
| 17 | Give the importers a UI | Open |
| 18 | Small cleanups left behind | Open |
| 19 | CSP: remove `unsafe-inline` | Open — run alone |
| 20 | User-facing two-factor auth | Open |

**16, 17 and 18 own different files and can run in parallel.** 19 and 20 are
sequential, and 19 needs a window with nothing else in flight.

Sessions marked Done are kept below for context. **Do not redo them.**

---

## Verification standard — read this before claiming anything is done

Every miss found in the Session 1-12 review traces back to one of these. They are
listed as concrete failures that actually happened in this repo, not as general
advice.

**1. Run it. Do not just read it.**
The Notion and Trello importers were confirmed working by POSTing real sample
files and asserting on what landed in storage. Reading the code would have missed
whether the callee signatures matched. If your work exposes an endpoint, call it.
If it changes a page, render it.

**2. A skipped test is not a passing test.**
`pytest` currently reports `93 passed, 4 skipped`. Those 4 skips are the only
tests covering Postgres full-text search and the entire pgvector path — the two
newest subsystems. Green output concealed that. Run `pytest -rs` and read the skip
reasons before you believe a suite.

**3. Grep counts lie. Read the lines.**
A review of Session 7 initially concluded Pomodoro was still duplicated because
`marketplace.js` had 8 matches. Reading those lines showed they were catalog
metadata for a marketplace listing plus a delegation to the single engine in
`academic.js` — correct, not duplicated. Never conclude from a count alone.

**4. Report partial work as partial.**
Session 2 wired three of four mobile screens and reported done. The fourth
(`FocusScreen`) had no server endpoint to sync to, which was a legitimate blocker
and a perfectly good thing to say. Saying nothing cost a full extra session to
rediscover. If you skipped something, name it.

**5. Config changes are not verified until the platform runs them.**
Session 8's `package.json` changed Nixpacks provider auto-detection and broke
every production deploy with `gunicorn: command not found`. Local success proved
nothing. The first attempted fix did not work either. Anything touching
`nixpacks.toml`, `railway.toml`, `Procfile`, `requirements.txt` or `package.json`
is unverified until a real deploy passes its healthcheck.

**6. State what you did not verify.**
An honest "I could not test X because Y" is worth more than silence. Silence reads
as verified.

---

## Priority 0 — COMPLETE (2026-08-24). Kept for context; do not redo.

### Session 13 — Wire AI retrieval into chat — ✅ DONE

> **Verified 2026-08-24.** `build_retrieval_context()` (`ai_core.py:335`) is wired
> into both chat endpoints (`routes/ai_chat.py:126` and `:171`); retrieval is
> sid-scoped at the DB layer via `search_embeddings()`. The isolation test is a
> real IDOR test (valid token for user A, spoofed `sid` for B in the body,
> asserts A's sid was used) and always runs without Postgres. Degradation
> confirmed: `build_retrieval_context` returns `''` with no DB and the call site
> falls through untouched. Commit `a1f66d4`.

**Owns:** `routes/ai_chat.py`, `ai_core.py`, `tests/test_embeddings.py`

Session 9 shipped the full pgvector foundation — extension, `embeddings` table,
an incremental indexing job on a 30-minute interval (`app.py:2202`), and
`database.py:4872 embeddings_available()` for graceful degradation. **Nothing
consumes any of it.** `routes/ai_chat.py` contains no embedding call, no
retrieval, no context injection. The infrastructure is inert.

Before calling Gemini: embed the user's message, retrieve top-k chunks **scoped to
that user's sid**, inject them as context with an instruction to cite which item
each claim came from.

Non-negotiable: a user must never retrieve another user's content. Write that test
first. Follow the pattern in `tests/test_search.py`'s
`test_search_org_content_never_leaks_to_another_org`, which does this correctly for
org scoping.

Chat must still work normally when `embeddings_available()` is False or nothing
relevant is found — never crash, never block the reply.

**Done when:** the assistant answers a question about the user's own tasks or docs
using retrieved context; cross-user retrieval is impossible and covered by a test
that actually runs (see Session 14); chat degrades cleanly with pgvector absent.

---

### Session 14 — Get Postgres into CI — ✅ DONE

> **Verified 2026-08-24.** CI on `main` reports **99 passed, zero skipped**
> (local 95 + 4 previously-skipped = 99). The workflow greps for a skip count and
> hard-fails the build if any test skips. The gate was proven, not asserted: the
> `session14-postgres-ci` branch has a run where a deliberately inverted
> `ts_rank` assertion genuinely failed CI (`1 failed, 96 passed`). Commits
> `e4b73c0`, `d205e74`.

**Owns:** `.github/workflows/ci.yml`, `tests/conftest.py` (or equivalent)

This is the loophole that hides all the others. Four tests skip without a real
Postgres:

- `tests/test_search.py:136` and `:214` — `ts_rank` ordering
- `tests/test_embeddings.py:48` and `:68` — pgvector

The effect: **Session 5's headline feature and 100% of Session 9's work have never
been executed by CI.** They are verified by reading only.

Add a Postgres service container to the CI workflow with the `pgvector` extension
available (`pgvector/pgvector:pg16` is the straightforward image), set
`DATABASE_URL` for the test job, and make the skip conditions resolve to "run".

Keep the skips working locally for anyone without a database — the goal is that CI
never skips, not that local developers are blocked.

**Done when:** CI reports zero skipped tests, and deliberately breaking a `ts_rank`
ordering assertion causes CI to fail. Prove the second point; a test that runs but
cannot fail is no better than a skip.

---

### Session 15 — Verify the production deploy actually recovers — ✅ DONE

> **Verified 2026-08-24 against live production.** `/health` returns 200 with
> `db: true`, `ai: true`. `/app` references 20 dist assets.
> `/js/dist/app.js?v=c2acd90c90` returns 200 with
> `cache-control: public, max-age=31536000, immutable` and a genuinely minified
> body. The Nixpacks provider fix held; `gunicorn: command not found` is
> resolved and minified assets are live, not silently falling back to raw
> source. No code artifact — verification task.

**Owns:** `nixpacks.toml`, `railway.toml`, `build.js` — read-only unless something is broken

**Requires Hunter's Railway access. Coordinate before starting.**

Adding `package.json` changed Nixpacks provider detection and every deploy since
failed its healthcheck with `gunicorn: command not found`. Two commits attempted
fixes: `4178c30` (stop a flaky esbuild fetch hard-failing the build) did not
resolve it; `80b8d01` added `nixpacks.toml` with
`providers = ["...", "python", "node"]`, which should.

This has only been verified by reading the config. Confirm on a real deploy that
the build completes, the healthcheck at `/health` passes, `gunicorn` is on PATH,
and `/js/dist/*` assets are actually served (not silently falling back to raw
source because the build step failed quietly).

**Done when:** a real deploy is green and minified assets are confirmed live in
the browser, with the response headers to show it.

---

## Priority 1 — completeness gaps. Real, but nothing is broken.

### Session 16 — Make search coverage uniform

**Owns:** `database.py`, `routes/search.py`, `tests/test_search.py`

Search is **hybrid, not uniformly indexed**, which the commit message
("tasks + community posts") reflects but the feature framing does not. Only
`tasks` and `community_posts` have generated `tsvector` columns with GIN indexes
(`database.py:854`). Goals, docs, journal, skills and finance still use substring
matching with a normalized score so they interleave with ranked hits.

Extend `tsvector` columns and GIN indexes to goals and docs at minimum — they are
the highest-volume user content after tasks. `routes/search.py:12` explains why
this was deferred (each needs a real storage migration); that is the work.

Two related notes already documented in `routes/search.py`, decide on each:
- **line 19** — org messages use a non-tsvector path; adding one is a schema change
- **line 23** — no calendar-event source exists to search at all

**Done when:** goals and docs return `ts_rank`-ordered results against real
Postgres, with tests that run in CI (depends on Session 14).

---

### Session 17 — Give the importers a UI

**Owns:** `templates/_modals.html`, `js/features/docs_notes.js` or a new
`js/features/import.js`, `css/features/` as needed

`POST /api/import/notion` and `POST /api/import/trello` both work — verified end
to end — and **no user can reach either one.** There is no upload UI anywhere.

Build a single import entry point: pick a source (Notion / Trello / Asana), drop
in the export files, show what was imported. Both endpoints take
`{token, files: [{filename, content}]}` and return counts, so one screen serves
both.

Respect the existing limits: 50 files per request, 500 task rows per import.
Surface those to the user rather than silently truncating.

**Do not** edit `js/app.js`, `templates/index.html` or `css/panels.css` beyond a
single registration line each, and prefer a new feature file.

**Done when:** a user can import a real Notion export through the UI and see the
resulting docs and tasks, confirmed in a browser.

---

### Session 18 — Small cleanups left behind

**Owns:** `js/app.js`, `js/features/academic.js`

Low-risk tidy-ups. Do all three in one pass, verify, stop.

1. `_parseFlashcards` still lives in `js/app.js:12890` with its only caller at
   `:13104` delegating into `academic.js`'s `sLoadFlashcards`. Move the parser into
   `academic.js` alongside the implementation it feeds.
2. Confirm no other orphaned flashcard or Pomodoro references survive Session 7 —
   read the lines, do not trust counts (see verification rule 3).
3. Brace-count check every file you touch before and after
   (`grep -c '{'` vs `grep -c '}'`). A past cleanup in this repo cut a CSS rule in
   half and left an orphaned brace.

**Done when:** `node --check` clean on every touched file, brace balance
unchanged, full suite green.

---

## Priority 2 — hardening. Schedule deliberately, do not squeeze in.

### Session 19 — CSP: remove `unsafe-inline`

**Owns:** every file in `templates/`, `app.py` (CSP header only), `js/`

`app.py:1405` still ships `script-src 'self' 'unsafe-inline'`, and there are 565
inline `onclick=` handlers across the templates. The header comment in `app.py`
acknowledges this directly.

**Run this alone.** It touches nearly every template and will collide with any
other session. Do not start it while anything else is in flight.

Migrate inline handlers to delegated listeners registered from JS, then drop
`unsafe-inline`. Expect this to take a full session per template group, not one
session total — scope it to a group and report honestly on what remains.

---

### Session 20 — User-facing two-factor authentication

**Owns:** `app.py` or a new `routes/auth_2fa.py`, `database.py`, settings UI

TOTP exists but is admin-only (`ADMIN_TOTP_SECRET`, `app.py:148`), and
`_totp_verify` at `app.py:837` is already a working RFC 6238 implementation.
Regular user accounts have no second factor at all.

Add opt-in TOTP for user accounts: enrolment with a QR code, recovery codes,
verification at login. Reuse `_totp_verify` rather than writing a second one.

**Done when:** a user can enrol, log in with a code, and recover with a backup
code, all covered by tests.

---

## Not for a session — needs Hunter

Unchanged from SESSION_BRIEFS.md, none resolved. Do not guess and do not fabricate
content for any of these.

- **Pricing.** Landing shows ₦0 / ₦19,800 / ₦36,300; `config.py` bills
  ₦2,500 / ₦25,000 / ₦8,000; Stripe is now in the stack for USD. Which set is
  canonical is Hunter's call, and it sits directly between a visitor and a payment.
- **NDPR section and registered business entity** on the legal pages.
- **Footer pages** (About, Blog, Careers, Changelog, Roadmap, Security, Cookies).
- **Mobile EAS project id and Play Store service account.**
- **Resend sending domain verification.**

---

## Definition of done for the whole programme

All of the following, simultaneously:

- [x] `pytest tests/ -q -rs` reports **zero skipped**, all passing — *CI: 99 passed, 0 skipped*
- [x] A real Railway deploy is green with minified assets confirmed live — *verified 2026-08-24*
- [x] AI chat answers from the user's own workspace, with a cross-user isolation test that runs in CI
- [ ] Both importers are reachable by a real user in a browser
- [ ] Search returns ranked results for goals and docs, not just tasks and posts
- [x] No session has reported "done" on work it only partly finished — *holds as of 2026-08-24*
