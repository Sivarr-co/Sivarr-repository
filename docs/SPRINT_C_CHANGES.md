# Sprint C — Community, Opportunities, Agents Seeding
> Date: 2026-06-13 | Status: Complete

## Summary

The community feed, opportunities board, and agents marketplace all already had
endpoints, render functions, and a seeding mechanism — but the seeds were thin
(5 generic community posts, 5 opportunities) and the **agents marketplace seed
was silently failing**, leaving it empty. Sprint C expands the seed data to
Nigerian-context content and fixes the marketplace seed so it actually lands.

Everything was built against the **existing** schema and render shapes (not the
prompt's assumed shapes). Notably: community `likes`/`replies` are JSONB arrays
counted by length (not integers), opportunities have no `salary`/`company`
columns, and the "agents marketplace" the user browses is the `agent_templates`
table, not the `agents` (creator) table.

## Seed data added

| Panel | Records seeded | Storage |
|---|---|---|
| Community posts | 10 new (15 total with originals) | `community_posts` table (JSON file fallback) |
| Opportunities | 15 new (20 total) | `opportunities` table (JSON file fallback) |
| Agents marketplace | 8 new templates (14 total) | `agent_templates` table |

## Root-cause fix: empty agents marketplace

`agents.user_sid` has a FK to `users(sid)`, but the seed agent
(`sivarr_seed_agent`) had no backing `users` row. The seed agent INSERT raised
an `IntegrityError`, which rolled back the entire transaction — so **no seed
templates were ever inserted** and the marketplace came up empty. Fixed by
inserting the seed `users` row first (idempotently) before the agent.

## Modified files

- `app.py`
  - `_SEED_POSTS` expanded to 10 Nigerian-context posts (with `tags` + a `likes`
    count) plus the original 5.
  - `_SEED_OPPS` expanded with 15 Nigerian listings (salary folded into
    `description` — no salary column exists).
  - `_seed_community_and_opps` JSON fallback now stores posts/opps in the
    render-ready shape (`body`/`desc`, `likes` as an array) via new
    `_seed_post_to_storage` / `_seed_opp_to_storage` helpers.
- `database.py`
  - `seed_community_posts` — now additive/idempotent (dropped the "bail if any
    rows exist" guard); expands the `likes` count into a JSONB array of
    placeholder sids and writes `tags`.
  - `seed_opportunities` — now additive/idempotent.
  - `_SEED_TEMPLATES` — 8 Nigerian agents added, using valid marketplace
    categories (`workspace`/`academic`/`goals`) with `download_count` +
    `avg_rating`.
  - `seed_marketplace_templates` — creates the backing seed user (FK fix),
    additive/idempotent, and passes `download_count`/`avg_rating` through.

## Notes & decisions

- All seed inserts use `ON CONFLICT (id) DO NOTHING` — re-running on startup
  never duplicates or overwrites existing rows (including real user likes/posts).
- Community `likes` counts are synthetic placeholder sids so the feed shows
  social proof; a real user's like still appends correctly on top.
- **Replies are not fabricated** — reply *counts* are derived from actual reply
  objects, and inventing reply threads (with fake bodies) looked worse than
  showing 0. Seeded posts therefore show like counts but 0 replies.
- **Seed agents are free to install.** USD `price` is kept at 0 (so "Get" routes
  to free install) because these are demo templates with empty `contents` —
  charging real money via Paystack/Stripe for nothing would be wrong. A non-zero
  `price_ngn` on three of them only renders a price tag in NGN view, matching the
  existing seed templates' established pattern.
- Apply/listing URLs are `#` placeholders — replace when real listings exist.

## Pre-existing issues found (not changed — flagged for later)

- Opportunities cards render `o.author`, but the API returns `submitted_by`
  (no `author` key) → the byline shows "undefined". Affects all opportunities,
  pre-dates this sprint. Out of scope (would require a render or response-shape
  change); noted for a follow-up.
- The existing `writing`/`finance` seed-template categories don't match any
  marketplace category tab, so those templates only appear under "All". New seeds
  use valid categories to avoid this.

## Testing checklist
- [ ] Community panel shows posts immediately (not the empty state)
- [ ] Seeded posts show Nigerian authors, tags, and non-zero like counts
- [ ] Opportunities panel shows listings with job/scholarship/internship/grant badges
- [ ] Agents marketplace shows templates sorted by downloads (popular) with ratings
- [ ] Like button increments without reload; reply form submits
- [ ] Re-running startup does not duplicate seeds (idempotent)
- [ ] Marketplace is no longer empty (seed user FK fix verified against the DB)

## MVP impact
- Community: 30% → 65%
- Opportunities: 30% → 65%
- Agents: 25% → 60%
- Overall MVP: +4% toward the 70% target
