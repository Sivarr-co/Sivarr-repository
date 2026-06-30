# Sivarr Pre-Launch Functionality Audit (Phase 1)

> Single tracked list: **Broken / Incomplete / Placeholder**. Started 2026-06-30.
> Method: **static sweep** of `templates/index.html`, `js/app.js`, `app.py` (read-only).
> Runtime click-through items (visual blanks, redirects, empty-state rendering) are
> tagged **[runtime]** for Hunter's gate — the sandbox can't run the app.

## Static checks run (and their results)
| Check | Method | Result |
|---|---|---|
| Surface size | route + panel enumeration | 327 backend routes · 30 panels · 298 handlers |
| **Dead buttons** | every `on*=` handler vs 2,673 defined fns | ✅ **0** — all handlers resolve |
| **Silent 404s** | 183 frontend `/api/` paths vs 318 routes | ⚠️ **1** — `/api/leaderboard` |
| **Nav to nowhere** | 29 `nav()` targets vs `panel-<id>` | ✅ **0** — all resolve |
| Placeholder markers | "coming soon"/stub/TODO scan | 8 (mostly intentional) |

**Headline:** the app is in strong shape — no dead handlers, no broken nav, exactly one missing endpoint.

---

## 🔴 BROKEN (must fix before launch)
| # | Item | Detail | Owner |
|---|---|---|---|
| B1 | **Leaderboard panel** | `loadLeaderboard()` (js:10381) → `fetch('/api/leaderboard')` (js:10388), but **no `/api/leaderboard` route exists** in app.py. Panel always lands in the "Couldn't load leaderboard — try again" error state. Fix = add the endpoint (aggregate student quiz/exam scores) or retire the panel. | Claude |

## 🟡 INCOMPLETE (started, partially wired — verify or finish)
| # | Item | Detail | Owner |
|---|---|---|---|
| I1 | Org chat **file attachments** | Button disabled, `title="coming soon"` (html:3000). Decide: build (Phase 5) or hide. | Hunter scope |
| I2 | Marketplace **extension injection** | "Injection into the dashboard is coming soon" (html:4334) — install works, in-dashboard mount deferred. | Phase 5/6 |
| I3 | Org **departments & invoices** | "coming soon" note (html:1923) — org settings shell present, backend deferred. | Phase 4 |

## ⚪ PLACEHOLDER (intentional "coming soon" — confirm copy/visibility only)
| # | Item | Detail |
|---|---|---|
| P1 | Locked agent chips (Claude/GPT-4/Perplexity) | `agentSelectLocked()` + `title="Coming soon"` (html:633–641). Intentional — gated alt models. |
| P2 | WhatsApp notification channel | disabled toggle (html:1753) + WhatsApp Business card (js:1102). Gated on Meta API. |
| P3 | Lecturer stub | hidden element kept for JS compat (html:215). Harmless. |
| P4 | Generic integration "coming soon" toast | `mktInstall`/integration cards for unbuilt integrations (js:2500). Ties to Phase 5 scope. |

---

## [runtime] Checklist for Hunter's gate (static can't see these)
Run on a deploy / local server, click through and confirm:
- [ ] Every panel renders content (no blank white screens) on first open
- [ ] Empty states show a friendly message (not a blank list) — leaderboard, notes, docs, flashcards, etc.
- [ ] No redirect loops or 404 HTML pages from any in-app link
- [ ] Browser console: **0 errors** on each panel open
- [ ] The 8 placeholder items above read as intentional (correct "coming soon" copy), not broken

## Disposition
- **B1** → fix in Phase 3/4 (or now as a quick win if approved).
- **I1–I3** → routed into their owning phases (5/6, 4).
- **P1–P4** → no action beyond confirming copy in Phase 2 (nav) / Phase 6 (consistency).
