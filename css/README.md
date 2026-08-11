# css/ — SIVARR Stylesheet Structure

> Rewritten 2026-08 after a full read-through — the previous version of this
> file described a `styles.css`-based structure that no longer exists (it
> predates the base/layout/panels/mobile split below, which itself has since
> shipped and is what's actually live).

## How styles are organised

```
css/
├── base.css       ← Design tokens (:root, light + dark), global reset, base
│                     typography, boot-loader animation. Loaded first.
├── layout.css      ← App shell: topbar, sidebar, login screen, mobile shell,
│                     responsive breakpoint ladder.
├── panels.css      ← All per-feature panel styling (~18,000 lines — by far
│                     the largest file: Home, Chat, Tasks, Notes, Calendar,
│                     Org Space, Marketplace, Academic Space, etc.)
├── mobile.css      ← Remaining @media overrides for the ≤900px breakpoints.
└── README.md       ← This file
```

Loaded in that exact order by `templates/index.html`. There is no
`css/styles.css`, no `css/base/` subdirectory, and no `css/components/` — an
earlier split attempt (the "Path A restructure" referenced in several
in-file comments) lost rules during the split and had to be patched back in
by hand in at least three places (search for `PARITY PATCH` / `recovered`
comments in `panels.css` and `layout.css`). Treat this file's history as
unreliable — if you touch it, diff the rendered page, not just the source.

## Design system quick reference (verified against the live `:root` in base.css)
- Primary/brand colour: `var(--teal)` = `#41076B` (purple — rebranded from
  the earlier teal/green `#0D7A5F`; some older docs and `mobile/src/theme.ts`
  still reference the old colour and haven't been updated)
- `--accent` / `--accent2` are aliases for `--teal`, and are currently
  identical values with no dark-mode re-tint (a real bug, not intentional —
  see the audit notes)
- Font: `var(--font)` / `var(--font-display)` = Plus Jakarta Sans (self-hosted)
- Shape: `var(--radius)` = 9px, `var(--radius2)` = 14px, `var(--radius3)` = 18px
- Dark mode: `[data-theme="dark"]` on `<body>`, redefining the same token set

## Known issues (from the 2026-08 full read-through)
Several custom properties are referenced throughout `panels.css` but never
defined anywhere live (`--shadow1`, `--surface2`, `--font-body`, `--hover`)
— they silently no-op wherever used. There's also a widespread invalid
`var(--token) NN` pattern (an attempted hex-alpha suffix that isn't valid
CSS) that silently drops ~24 declarations. Both are worth a dedicated
follow-up pass; not fixed as part of this cleanup beyond the highest-impact
cases (see the audit artifact / Phase 5 of the remediation plan).
