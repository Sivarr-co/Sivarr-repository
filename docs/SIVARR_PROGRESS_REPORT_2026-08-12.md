# SIVARR — Development Progress Report

> **Purpose:** Account of everything built, fixed, and pushed in this window — for Hunter to track work done.
> **Window covered:** 2026-08-10 → 2026-08-12
> **Commits in window:** 10 · **HEAD:** `9d143aa`
> **Source of truth:** git history (`git log`/`git show`) cross-checked against the actual codebase — not assumptions.
> **Prepared by:** Claude, working directly with Hunter across this window.

---

## 1. Executive Summary

Three arcs, in the order they landed:

1. **Full codebase audit → remediation pass** (`6e96dd7`) — a read-through of the entire
   codebase (backend, frontend, CSS, templates, mobile) turned up real security/privacy
   bugs, data-integrity bugs, fabricated-data mislabeled as real, and dead code. All fixed
   in one large commit: `utils/`, `models.py`, and `css/base/variables.css` deleted
   (confirmed unused), `templates/workspace.html` (2,579 lines of mislabeled dead CSS)
   deleted, security/correctness fixes across `app.py`/`database.py`/`js/app.js`, and a
   legacy mobile sidebar (453 lines) removed from `templates/_modals.html`.
2. **Sidebar redesign + brand unification** (`5522652` → `de23957`) — a from-scratch
   Pinned / Recents / Starred sidebar (replacing a "Watchlist" section that was just two
   hardcoded links), made collapsible, plus a full purple-only rebrand that hunted down
   and fixed the old pre-rebrand teal color (`#0D7A5F`/`#534AB7`) everywhere it was still
   hardcoded — CSS tokens, transactional emails, the PWA manifest, legal pages, the
   mobile app, marketplace templates. Also a mobile-app remediation pass: 3 dead
   duplicate screens deleted, 7 orphaned-but-real screens wired into navigation, missing
   build assets generated, brand colors fixed.
3. **Teammate merge + follow-up bug sweep** (`cd1a8c5` → `9d143aa`) — merged a teammate's
   (`Chibistenofe16`) landing-page rewrite that had been pushed directly to `main`, then
   fixed three more real, verified bugs found while working: a "Customize Sidebar" sheet
   that silently didn't customize most of the sidebar, Google Calendar OAuth tokens
   stored in plaintext, and a 291-line duplicated CSS block that made editing one copy of
   54 mobile style rules silently do nothing.

**Where it stands today:** same FastAPI + Vanilla JS + PostgreSQL stack. All 10 commits
in this window are pushed to `origin/main`. Working tree is clean. Three investigated
items (an old "DB schema statement fails" note, an "org-invite/forgot-password has no
rate limit" note, a "Google Calendar timezone bug" note) turned out to already be fixed
or non-reproducible — removed from the open-issues tracker rather than re-fixed, so they
don't get chased again next time. See §7 for what's still genuinely open.

---

## 2. Full codebase audit & remediation pass

**Commit:** `6e96dd7` (2026-08-10 19:36) · 23 files, +628/−5,706

A full read-through of every file in the repo, done before any changes, specifically to
build complete understanding and flag anything unclear — user privacy/security held as
the standing priority throughout. Findings were fixed with Hunter's sign-off on four
scoping decisions: hold all pricing/copy changes until a new pricing file arrives, delete
`utils/` (confirmed unimported), treat `acad/*` as the canonical academic system over the
legacy `/api/lecturer/*` + `/api/class/*` system, and clearly label mocked/fabricated
data instead of presenting it as real.

**Deleted (confirmed dead or duplicate, not just unused-looking):**
- `utils/` (`__init__.py`, `auth.py`, `email.py`, `helpers.py`, `rate_limit.py`, `storage.py`) — unimported anywhere.
- `models.py` — unused.
- `css/base/variables.css` — a dead, conflicting design-token file.
- `templates/workspace.html` (2,579 lines) — pure CSS mislabeled as `.html`, zero references.
- 453 lines of self-documented dead legacy mobile sidebar markup from `templates/_modals.html`.

**Fixed (security/correctness):**
- `_org_check()`/`_org_admin_check()` — now resolve org membership correctly via `db.get_org_by_member(sid)`.
- Exam save/sanitize path — MCQ question structure was being silently destroyed on save; fixed with a new `questions_full` field and a real `_sanitize_exam_question()`.
- `delete_user_cascade()` — rewritten to anonymize+detach an ex-user's public `agents` row instead of destructively cascading it away, and to actually clean up `template_downloads`/`template_reviews`/`agent_follows`/`community_posts`/`feedback` rows that were being orphaned.
- Admin/lecturer session revocation — `signOut()` now calls a real revoke endpoint instead of just clearing local state.
- `S.token` → `getToken()` fixed at 59 call sites in `js/app.js` (stale-token bug).
- Several `esc()`-missing XSS gaps closed in Personal Space rendering; password fields given `autocomplete="new-password"`.
- Fabricated data labeled honestly instead of presented as real: rickroll placeholder videos replaced with "coming soon," demo marketplace items marked "Example," a fake `Math.random()` analytics chart in Org Space replaced with a real computation from actual task data.

Full detail (every file touched, every finding, every "why") is in the two published
audit artifacts from this window and in the `project_sivarr_known_gaps` memory tracker.

---

## 3. Sidebar redesign: Pinned / Recents / Starred

**Commits:** `5522652`, `2695080`, `94e7d8c` (2026-08-10, same evening)

Reported bug: starring a tab via the ⌘K palette saved correctly to `localStorage`
(`toggleNavTab`/`getNavTabs`) but `navRenderSidebar()` never actually painted that list
anywhere — starring a tab had zero visible effect. Iterated into a full redesign per
Hunter's spec:

- **Pinned** — the permanent core group (Sivarr AI / Home / Inbox), `sb-favs`.
- **Recents** — new. Last 3 visited panels, most-recent-first (`getRecentPanels()`/
  `pushRecentPanel()`, called from `nav()` on every navigation, live-updating).
- **Starred** — the original star-toggle fix, renamed from an initial "Pinned" label
  after Hunter's clarification, `sgi-starred`.
- **Watchlist section removed entirely** — it was hardcoded to exactly two links
  (Trading Journal → Marketplace, Finance Tracker → Finance panel), not a real per-user
  system, and fully redundant with Starred. Both destinations stayed reachable.
- **Collapsible** — Pinned hides fully; Recents collapses to just the single most-recent
  item instead of hiding, expanding back to 3 when reopened.

**Root cause also found and partially addressed:** navigating via ⌘K search to a panel
with no permanent sidebar row (most of the old `work`/`life` section panels — Calendar,
etc.) couldn't highlight anything in the sidebar, because those section containers
(`sgi-work`/`sgi-grow`) had been removed from the template in an earlier redesign and
never replaced. Recents incidentally fixes this for the last 3 panels visited; panels
visited longer ago still have nowhere to highlight. (This surfaced again in §6 below.)

**Caching gotcha hit twice** during this work: `/js/` and `/css/` are served
`Cache-Control: immutable, max-age=31536000` — a fix doesn't appear for anyone who
already loaded the app until the `?v=` query string in `templates/index.html` is bumped.
Cost two rounds of "my fix isn't showing up" before being identified and documented as a
standing operational note.

---

## 4. Brand unification: purple only, teal fully removed

**Commit:** `de23957` (2026-08-12 10:01) · 34 files, +13,255/−13,384

Hunter's explicit call: **SIVARR's brand is purple only, no teal.** What started as an
expected small CSS-variable fix turned out to be a pre-rebrand color (`#0D7A5F` teal /
`#534AB7` purple) hardcoded in 70+ places well beyond CSS tokens:

- `css/base.css` — `--accent`/`--accent2` were literally identical (a real bug breaking
  ~19 gradients that expected two different shades), fixed to a real light/dark pair;
  `--teal`/`--teal2`/`--teal3`/`--teal4` kept as pure aliases of the purple tokens rather
  than renamed at every one of their hundreds of call sites in `panels.css`.
- **`app.py`'s transactional emails** — ~33 occurrences across password
  reset/verify/welcome/receipt/task-reminder templates. These were shipping the old
  brand to real users' inboxes.
- `database.py` — org-project color defaults, marketplace seed thumbnail colors.
- The Settings "Sivarr" default-color preset button was found to be *actively wrong*
  (showed the old teal, but clicking it set a *third*, unrelated color matching neither
  brand) — fixed consistently across the swatch, the `_ACCENT_MAP` table, and the
  color-wheel fallback defaults, which had all drifted independently of each other.
- `static/manifest.json`'s PWA install color, the Focus Mode SVG gradient,
  `templates/landing.html`/`landing_demo.html`/`legal/terms.html`/`legal/privacy.html`'s
  embedded style blocks, all 4 marketplace `static/templates/*.html` files.
- `mobile/src/theme.ts` — required revising twice: the first pass matched mobile to the
  web app's *dark-mode* teal/purple pairing, before the "no teal at all" directive
  clarified that pairing itself was the thing to remove.

Left untouched, deliberately: `landing.html`'s green "Done" status tag and the habit
planner's priority colors — legitimate semantic red/orange/green, not brand color.

---

## 5. Mobile app remediation

**Commit:** `de23957` (same commit as §4, mobile-specific portion)

Flagged in the original audit as the single biggest gap between what the docs claimed
and what actually shipped: **11 of 15 screen files were completely unreachable** from
the running app, and the app **could not build at all**.

- Deleted 3 confirmed-dead duplicate screens (`ChatScreen.tsx`, `HomeScreen.tsx`,
  `TasksScreen.tsx` — each a strictly inferior, superseded version of a screen already
  wired in).
- Added a 4th "More" tab and registered 7 real, previously-orphaned screens (`Goals`,
  `Habits`, `Journal`, `Focus`, `Community`, `WeeklyReview`, `Settings`) as proper routes
  — `MoreScreen`'s existing `navigation.navigate(...)` calls had been crashing on every
  tap since none of those routes existed. Each got a real native header + back button,
  since the root stack hides headers globally and none of these screens had their own.
- Generated placeholder build assets (`icon.png`, `adaptive-icon.png`, `splash.png`,
  `favicon.png`) — `app.json` referenced an `assets/` directory that didn't exist at all,
  which meant the app could not be built, period. Explicitly flagged as placeholder
  quality in `mobile/assets/README.md`, not final design.
- Fixed the same pre-rebrand brand-color drift as §4.

**Not done, flagged for Hunter:** real server sync for Tasks/Habits/Journal/Focus
(currently `AsyncStorage`-only — only Goals syncs to the server); a real EAS project ID
and Play Store service-account file (need Hunter's own Expo/Google accounts, can't be
generated); de-duplicating `MeScreen`'s inline sections against the newly-reachable full
screens.

---

## 6. Teammate merge

**Commits:** `45622e7` (Chibistenofe16) → `cd1a8c5` (merge)

`git status` reported local `main` and `origin/main` had diverged one commit each.
Diagnosis: `Chibistenofe16` had pushed `45622e7` directly to `main` on 2026-08-11 22:58 —
a near-total rewrite of `templates/landing.html` (2,027 insertions / 859 deletions,
mostly a prettier-style reformat plus real copy/structure changes). Hunter confirmed this
was legitimate teammate work and authorized merging.

**Resolution:** took the teammate's content as the base (their branch predated the §4
brand sweep), then re-applied that sweep on top — their `:root` still had the old
`--teal: #534ab7; --purple: #534ab7` pairing and 23 `rgba(83, 74, 183,` literals, both
converted to the current brand values the same way the rest of the sweep was done.
Verified with a `TestClient` boot test before committing. Merged as `cd1a8c5`, pushed
clean (no force needed, no other files conflicted).

---

## 7. Post-merge bug sweep

Three more real bugs, found and fixed working down the open-issues list, each verified
and committed separately:

| Fix | Commit | What was actually wrong |
|---|---|---|
| Customize Sidebar | `dba6230` | The mobile "Customize Sidebar" bottom sheet was titled generically but had been silently narrowed to only reorder the 5 fixed Connect items — orphaned `.mob-cust-toggle` CSS proved a fuller version once existed. Users had no way to reorder or remove their actual daily tabs (Tasks/Goals/Calendar/Finance/Habits/Journal) from it. Extended it to cover Starred tabs too, wiring the dead toggle CSS to the existing `toggleNavTab()`. |
| Google Calendar OAuth tokens | `a33d235` | `access_token`/`refresh_token` were stored **fully in plaintext** — landing in Postgres, a JSON progress file, and a JSON backup file. A leak from any of the three grants standing calendar access. The codebase already had a working Fernet encrypt-at-rest utility (built for org integration keys) that was never wired up here — exposed it as `db.encrypt_secret()`/`db.decrypt_secret()` and used it at every read/write site. **Needs `APP_ENCRYPTION_KEY` set in production to actually take effect** — without it, it fails open to plaintext exactly as before, by design. Also fixed an adjacent bug in the admin panel that checked the wrong dict keys and always reported Google Calendar as disconnected. |
| Duplicate mobile CSS | `9d143aa` | `layout.css`'s 618-line "PARITY PATCH" media-query block had 54 of its 102 rules byte-for-byte duplicated in `mobile.css`'s own block, which loads after and always wins. Verified every one of the 54 overlaps was identical (not a diverged intentional override) before removing — net −291 lines, pure deletion, zero rendered-output change. This was a real "editing this file here does nothing" trap. |

**Investigated, found already fixed or non-reproducible (not re-fixed, removed from the tracker):**
- *Org-invite / forgot-password rate-limit gap* — both already properly rate-limited in
  current code via a real 3-tier limiter (Redis → Postgres sliding-window → in-memory).
  Invite tokens are 256-bit (`secrets.token_urlsafe(32)`), so brute-forcing is
  infeasible regardless.
- *Google Calendar UTC-vs-local-timezone bug* — already fixed; the frontend sends the
  browser's real IANA timezone and the backend validates + uses it correctly.
- *"Unidentified persistently-failing DB schema statement"* — installed a real local
  Postgres 16 instance (`pgserver`, no root needed) and ran the app's exact 73-statement
  schema DDL against it twice. Zero failures both times. Either already fixed, or
  specific to something in the live Supabase environment that isn't reproducible
  locally — if it's still happening, the next step needs the literal error text from
  production logs, not more local investigation.
- *`GEMINI_MODELS` possibly listing retired models* — the list does look dated, but
  `get_model()` already does a live `genai.list_models()` call at runtime and self-heals
  to whatever's actually available even if every hardcoded entry is retired. Not broken;
  left untouched rather than guess at real current model IDs without API access to verify them.

---

## 8. Known still-open items (carried forward)

Not touched this window — for the next pass:

- **Pricing reconciliation** — `landing.html` (USD) vs. `config.py`/legal pages (NGN).
  Waiting on Hunter's updated pricing file; nothing pricing-related touched until it arrives.
- **CSP `unsafe-inline`** (~1,075 inline handlers) — a real, large, separate migration.
- **Legal pages** (`terms.html`/`privacy.html`) — missing a registered business
  entity/address and any NDPR mention. Needs Hunter's actual business details, not something to fabricate.
- **The old `work`/`life` sidebar section system** (`NAV_ORDER`/`_getSectionOrder`) —
  confirmed dead/unused config, separate from the working Pinned/Recents/Starred system;
  not cleaned up yet.
- **Duplicate-implementation decisions** — 3 flashcard systems, 4 Pomodoro timers, 2
  "Create Space" modals, 2 command palettes, 4 HTML-escape helpers. Needs Hunter's call
  on which is canonical.
- **Mobile:** real server sync for Tasks/Habits/Journal/Focus; EAS project ID + Play
  Store service account (need Hunter's own accounts).
- **A second "PARITY PATCH" block** in `layout.css` (~line 2080, non-media-query rules)
  — noticed while fixing §7's CSS duplication but not checked for the same problem.
- Broader CSS magic-number sprawl (border-radius/font-size/shadow literals) beyond the
  specific bugs already fixed.
- Per-identity rate limiting (P4 roadmap item, not started).

---

*This report and the fuller day-to-day tracker live alongside each other: this file is
the durable, shareable record; `project_sivarr_known_gaps` (Claude's session memory) is
the actively-updated working list new sessions read first. When they'd disagree, trust
git history and the live codebase over either document.*
