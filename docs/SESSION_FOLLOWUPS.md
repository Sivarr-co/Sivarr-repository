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
| 16 | Make search coverage uniform | **Done** — verified 2026-08-25 |
| 17 | Extend the import UI | **Done** — verified 2026-08-25 |
| 18 | Small cleanups left behind | **Done** — verified 2026-08-25 |
| 19 | CSP: remove `unsafe-inline` | **In progress** — 492 migrated, 198 inline left |
| 20 | User-facing two-factor auth | **Done** — verified 2026-08-25 |
| 21 | Make the two chat tests hermetic | **Done** — verified 2026-08-25 |

**13-18 and 20 are complete. Two remain: Session 21 and continuing Session 19.**

**They can run in parallel.** 21 owns only `tests/`; 19 owns templates, `js/` and
the CSP lines in `app.py`. No overlap. 19's "run alone" rule applies to other
*template*-touching sessions, not to 21. Start 21 first either way — it is small,
and until it lands one security test is in a state where the tempting fix removes
the check.

**Session 19 is not one session.** The first group did 26 handlers and built the
`js/core/delegate.js` helper; roughly 561 remain. Expect **10-20 more sessions**,
each reporting its remaining count. `unsafe-inline` only comes out of the CSP when
that count reaches zero.

Superseded sequencing, kept for reference:
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

## Priority 0 (new) — found while verifying Sessions 16-20

### Session 21 — Make the two chat tests hermetic — ✅ DONE

> **Verified 2026-08-25.** Reproduced first: both tests genuinely 429'd
> locally (`data/chat_isolation_sid_a_progress.json` and
> `data/chat_inject_sid_progress.json` both sitting at
> `questions: 15, chat_daily.count: 15`). Added a `clean_progress` fixture
> (`tests/conftest.py`) that calls the real `app.save_progress(sid, defaults)`
> before each test (resets the actual DB row when available, always the JSON
> file — not a second/parallel reset mechanism) and deletes both the
> `_progress.json` and `_progress.backup.json` files afterward. Both tests
> now call it for their own sid before posting to `/api/chat`.
> `chat_authorize`'s real sid-resolution path is untouched — the fixture
> only pre-clears state, never mocks the authorization itself.
>
> `pytest tests/test_embeddings.py` run 5x consecutively: 8 passed / 2
> skipped every time, zero leftover files under `data/` after each run.
> Deliberately broke the sid assertion (`chat_isolation_sid_a` →
> `WRONG_SID_ON_PURPOSE`) and confirmed it fails for the right reason, then
> reverted. Also verified against a real embedded Postgres (not just the
> JSON-fallback path) — 3 consecutive runs, all 10 tests passing (the 2
> pgvector-only tests un-skip with a real DB), no leftover files there
> either.
>
> Hit the same pre-existing `org_docs` migration-ordering bug found while
> verifying Session 20 (`ALTER TABLE org_docs ADD COLUMN ... yjs_state`
> fails because `org_docs` doesn't exist yet on a fresh schema) — confirms
> it's real and reproducible, still out of scope here (this session owns
> only `tests/test_embeddings.py` and `tests/conftest.py`).

**Owns:** `tests/test_embeddings.py`, `tests/conftest.py`

`test_chat_retrieval_never_leaks_across_sids` and
`test_chat_actually_injects_retrieved_context_into_the_prompt` **fail locally**
while passing in CI. Reproduce with `pytest tests/test_embeddings.py` — each fails
alone, in a fresh process, on a single request:

```
assert 429 == 200
{"detail":"You've reached today's free limit of 15 messages. Upgrade to Pro for more."}
```

**Root cause, and it is not the rate limiter.** It is the free-plan daily chat
quota (`FREE_DAILY_CHAT = 15`, `app.py:362`, enforced at `app.py:3322`). Both
tests POST to `/api/chat` as a *fixed* sid (`chat_isolation_sid_a`) and leave
persistent progress behind in `data/chat_isolation_sid_a_progress.json` — that
file currently reads `"questions": 15`. Every run increments it, so after 15 runs
in one day the tests 429 permanently until the date rolls over. CI passes only
because every run starts on a clean filesystem.

**Why this matters more than an ordinary flake.** The isolation test is the IDOR
guard for AI retrieval. When it 429s, execution never reaches the assertion that
the caller's own sid was used. It fails loudly today, which is fine — but the
obvious "fix" of accepting 429 as a pass would silently delete a security check
and leave a green tick behind.

Fix by making the tests hermetic. Any of:

- a fixture that clears the sid's progress file (and DB row) before and after
- a unique per-run sid so state is never reused
- monkeypatching the quota check, the way these tests already monkeypatch
  `async_gemini_ask` and `build_retrieval_context`

Prefer whichever keeps the real `chat_authorize` → sid resolution path exercised,
since that is the thing actually under test.

**Done when:** `pytest tests/test_embeddings.py` passes five times in a row — run
it five times and confirm — with no leftover files under `data/`, and the sid
assertion still genuinely reached (break it deliberately and watch it fail).

---

### Session 19 (continued) — CSP, remaining handler groups

**Status after the 2026-08-27 overnight run: 492 handlers migrated.**
Inline handlers across `templates/` went **655 -> 198**; `onclick` alone
**536 -> 94**. Groups 3-7 landed as five separate commits, each CI-green:
`_shell` (16), `_modals` (65), `_panels_core` (92), five panel templates (161),
then `_panels_extra`/`_panel_academic`/`_panel_notes`/`_login` (133).

Every batch was browser-verified the same way, and this is the check worth
repeating: enumerate every function named by a `data-on*` attribute, assert
**none is missing** from `window`, stub them all, then click every element and
audit the argument types actually received. The final pass covered 253 distinct
functions, 465 elements, 486 invocations, zero missing, zero page errors, and
arg types 248 string / 141 element / 29 null / 27 number / 11 event / 1 boolean.
A typo'd `data-onclick="fnName"` only logs a console warning and silently does
nothing, so the missing-function check is what actually catches a bad migration.

#### Counting them correctly

`grep -c 'onclick='` **overcounts** — `data-onclick="..."` contains the substring
`onclick="..."`. Use a negative lookbehind:

```
grep -rhoP '(?<![-\w])onclick="' templates/*.html | wc -l
```

#### What delegate.js supports

| Pattern | Attribute |
|---|---|
| `fn()` | `data-onclick="fn"` |
| `fn('a','b')` | `data-onclick-arg0="a" data-onclick-arg1="b"` (strings) |
| `fn('tasks', null)` / `fn(3)` | `data-onclick-args='["tasks", null]'` (**real types**) |
| `fn(event)` | `data-onclick-event` (Event first) |
| `fn(x, this)` | `data-onclick-this` (element last) |
| `if (event.target === this) fn()` | `data-onclick-self` |
| `onchange` / `oninput` / `onkeydown` / `onkeyup` / `onblur` / `onfocus` / `onsubmit` | `data-onchange="fn"` etc. |

**Non-string arguments MUST use `data-*-args`.** The positional form turns `null`
into the truthy string `"null"` and `3` into `"3"`. CI fails the build on
malformed `data-*-args` JSON.

A reusable, deliberately conservative migrator lives at
`scratchpad/migrate.py` in the session that wrote it — it rewrites only single
calls to a named global with literal arguments and leaves everything else
untouched. Re-deriving it is a few minutes' work if it is gone.

#### The 153 left in fragment templates

None are mechanical. Each needs a real named function written first:

| Count | Pattern | Example |
|---|---|---|
| 54 | `this.<property>` passed | `stSetFontScale(this.value)` |
| 47 | multi-statement | `nav('stats', null); closeProfile();` |
| 13 | element in **lead** position | `sSetFormat(this, 'apa')` |
| 12 | conditional | `if (event.key === 'Enter') doLogin();` |
| 12 | DOM expression | `$('pfp-input').click()` |
| 8 | method call | `siModal._bgClose(event)` |
| 7 | other | `acRenameByType ? spRenameByType('academic') : null` |

Two of these are worth a helper change rather than 67 hand-written wrappers:

- **`data-*-value`** — pass `el.value`. Clears most of the 54.
- **element in lead position** — the helper always appends. An explicit
  `data-*-this-first` would clear the 13.

The rest genuinely need named functions. `if (event.key === 'Enter') fn()` is
frequent enough to deserve one shared `data-onkeydown-enter="fn"` instead.

#### Do NOT migrate these three files

`admin.html` (41), `admin_metrics.html` (2) and `landing.html` (6) are
**standalone pages that never load `delegate.js`**. Migrating them silently
breaks every control on them. Either add the script to each page first, or leave
them and accept that `unsafe-inline` cannot be dropped until they are handled.

#### Before `unsafe-inline` can come out

All of the above, **plus** 10 inline `<script>` blocks (`index.html` has 5) —
those are governed by the same `script-src` directive. `style-src` at
`app.py:1549` carries its own `unsafe-inline` covering ~982 inline `style=`
attributes, and is a separate project.

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
- [x] Both importers are reachable by a real user in a browser — *Settings import UI, Session 17*
- [x] Search returns ranked results for goals and docs, not just tasks and posts — *4 tsvector columns, Session 16*
- [ ] No session has reported "done" on work it only partly finished — *broken: Session 13's tests pass in CI but fail locally, see Session 21*
