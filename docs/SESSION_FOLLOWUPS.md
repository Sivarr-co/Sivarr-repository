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
| 19 | CSP: remove `unsafe-inline` | Partial — first group (26/~565 handlers) done 2026-08-24, rest deferred |
| 20 | User-facing two-factor auth | **Done** — verified 2026-08-24 |

**Run 16 and 17 together. Then 18. Then 19 and 20 sequentially.**

17 and 18 both edit `js/app.js` and **must not run at the same time**. 16 is
isolated (`database.py`, `routes/search.py`, `tests/`) and is safe alongside
either. 18 is small — a single function move — so it slots in cheaply after 17
lands. 19 needs a window with nothing else in flight at all.

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

### Session 17 — Extend the existing import UI to Notion and Trello/Asana

**Owns:** `js/app.js` (the import-handlers block, ~line 6842), `templates/_panels_core.html`

**Conflicts with Session 18 — do not run them concurrently.** Both edit `js/app.js`.

`POST /api/import/notion` and `POST /api/import/trello` both work — verified end
to end — and **no user can reach either one.**

Note this is *extending*, not building from scratch. An import UI already exists:
`stImportTasks`, `stImportGoals` and `stImportNotes` live in `js/app.js` around
line 6842, with `_parseCSV`/`_splitCSVLine` helpers beside them, and they are
wired into `templates/_panels_core.html`. Follow that established pattern rather
than inventing a parallel one, and reuse `_parseCSV` for the Asana CSV path.

The two new endpoints differ from the existing three: they take
`{token, files: [{filename, content}]}` (a list of files, not one parsed payload)
and return counts. So the handler needs to accept a multi-file selection and read
each file's text before posting.

Respect the existing limits — 50 files per request, 500 task rows per import — and
surface them to the user rather than silently truncating.

Reuse `_setImportStatus` for progress feedback, exactly as the current handlers do.

**Done when:** a user can import a real Notion export and a real Trello JSON
export through the existing Settings import UI and see the resulting docs and
tasks, confirmed in a browser, not just by calling the endpoint.

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

### Session 20 — User-facing two-factor authentication — ✅ DONE

> **Verified 2026-08-24.** Implemented directly in `app.py` (not a new routes
> file — login/change-password/reset-password already live there, and 2FA is
> tightly coupled to that same login flow). New endpoints
> `/api/auth/2fa/{status,setup,confirm,disable}`; `LoginRequest.totp` and a
> `totp_required`/recovery-code branch inside `/api/login` itself. Reuses
> `_totp_verify` (RFC 6238) — no second implementation. `database.py` gained
> `totp_secret`/`totp_enabled`/`totp_recovery_codes` columns (migration run
> for real against an embedded Postgres, not just read) plus
> `get_user_totp`/`set_user_totp_pending`/`enable_user_totp`/
> `disable_user_totp`/`remove_user_recovery_code`; JSON-file fallback carries
> the same fields directly on the user dict. QR via `qrcode` (pure Python,
> SVG output, no Pillow/system libs) added to `requirements.txt`, degrades to
> manual secret entry if generation fails — **not yet verified against a real
> Railway deploy** per this file's own verification standard #5. Settings UI
> in `_panels_core.html`'s Security section (`js/app.js`'s `st2fa*`
> functions); login form in `_login.html` reveals a code field on
> `totp_required`. 15 new tests (`tests/test_auth_2fa.py`) cover enrol,
> wrong/correct code, recovery-code use-once, disable requiring password, and
> login gating — run against the JSON-storage path. The DB-backed path was
> separately verified end-to-end (setup → confirm → login-with-code →
> login-with-recovery-code → burned-code rejected → disable) against a real
> embedded Postgres, and the whole flow was also click-through tested in a
> real browser (Playwright) against a running dev server, including the QR
> SVG actually rendering and the login page's totp field genuinely
> appearing/disappearing.
>
> Found and fixed one real bug along the way: the initial rate-limit on the
> three new endpoints was IP-keyed, which both broke this file's own test
> suite (shared IP bucket exhausted across enrolments) and would have let
> one NAT/shared IP's legitimate users lock each other out — moved to
> per-account (post-auth, keyed by sid) instead.
>
> **Discovered, not fixed (out of scope for this session):** `change_password`
> (`app.py`, pre-existing) resolves the user via
> `db.get_user(sid) if db.is_available() else None` with no JSON-file
> fallback, so it 404s unconditionally whenever `DATABASE_URL` is unset —
> broken today in local/no-DB dev, unrelated to 2FA. The new
> `_resolve_authed_user` helper this session added does the fallback
> correctly and could replace that line directly.
>
> Also fixed in passing: a stray semicolon inside a SQL comment in the new
> `_SCHEMA` migration block (the `--` comments here are plain text to
> `_SCHEMA.split(";")`, so a semicolon inside comment prose truncates the
> next statement) — caught by actually running `init_db()` against a real
> Postgres, not by reading the diff.

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
