# Sivarr — Docs

## Sprint change logs
- [Sprint A](./SPRINT_A_CHANGES.md) — Landing page, Terms, Privacy Policy
- [Sprint B](./SPRINT_B_CHANGES.md) — Unified search, mood chart, analytics, journal prompts, Naira currency fix
- [Sprint C](./SPRINT_C_CHANGES.md) — Community, Opportunities, Agents seeding (+ empty-marketplace FK fix)
- [Sprint D](./SPRINT_D_CHANGES.md) — Calendar week/day views

## Full changelog
See [CHANGELOG.md](./CHANGELOG.md)

## MVP progress
| Module | Before | After |
|---|---|---|
| Landing page | 5% | 90% |
| Search | 0% | 80% |
| Analytics | 35% | 65% |
| Journal | 40% | 70% |
| Community | 30% | 65% |
| Opportunities | 30% | 65% |
| Agents | 25% | 60% |
| Calendar | 50% | 80% |
| **Overall MVP** | **~55%** | **~70%** |

## Notes on these sprints

Several sprint targets (search, analytics, journal, calendar week/day views) were
found **already implemented** in the codebase when the sprint ran, often more
deeply integrated than the sprint sketches assumed. In those cases the work was
verification + documentation rather than new code, and parallel re-implementations
were deliberately avoided to prevent collisions with the working features.

The genuinely new/fixed work across the sprints:
- **Sprint B** — Naira currency fix (founder financials + AI briefing); fixed the
  mood chart, which scored journal moods by keyword while the UI stored emojis, so
  it always returned empty.
- **Sprint C** — Nigerian-context seed data for community/opportunities/agents;
  additive/idempotent seeders; **fixed a silent FK failure** (seed agent had no
  backing `users` row) that left the agents marketplace empty.
- **Sprint D** — verified the existing Month/Week/Day calendar; documentation only.

### Pre-existing issues — fixed (post-Sprint D)
- Opportunities byline showed "undefined" (`o.author` vs API's `submitted_by`) →
  now shows the `organisation` (which was previously never displayed).
- Marketplace seed templates with `writing`/`finance` categories (no matching tab)
  remapped to valid categories (`ai_prompts`/`workspace`), with an idempotent
  UPDATE to correct any already-seeded rows.

### Still open
- Mood-chart and marketplace-FK fixes are logic-verified, not yet confirmed
  against the live production DB.
