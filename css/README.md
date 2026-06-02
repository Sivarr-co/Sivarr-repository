# css/ — SIVARR Stylesheet Structure

## How styles are organised

```
css/
├── styles.css              ← Main file loaded by index.html (5,700 lines — full app)
├── base/
│   └── variables.css       ← CSS custom properties / design tokens ONLY
├── components/
│   └── (future splits)     ← One file per component when splitting begins
├── layout/
│   └── (future splits)     ← Sidebar, topbar, panel grid
└── README.md               ← This file
```

## Current state
`styles.css` is the single source of truth. All styles are in this file.
The sections inside styles.css are clearly marked with comment headers:

| Section | Approx Lines | Description |
|---|---|---|
| Design Tokens | 7–57 | CSS variables (already extracted to base/variables.css) |
| Base/Reset | 58–84 | html, body, box-sizing reset |
| Topbar | 85–182 | Top navigation bar |
| Sidebar | 199–422 | Left sidebar, nav items, spaces |
| Panels | 430–437 | Panel container system |
| Buttons | 447–471 | .btn, .btn-primary, variants |
| Login | 588–840 | Auth page, login card, Google button |
| Chat | 906–1366 | Chat messages, input bar, welcome, typing |
| Quiz | 1367–1407 | Quiz panel |
| Notes | 1436–1463 | Notes panel |
| Tasks (Flux) | 1464–1561 | Task list, kanban |
| Settings | 1643–1716 | Settings panel, toggles |
| Modals | 1717–1743 | siModal dialog system |
| Toast | 1744–1753 | Notification toast |
| Command Palette | 1754–1785 | Cmd+K overlay |
| Home Panel | 1949–2074 | Dashboard home |
| Habits | 2075–2100 | Habit tracker |
| Journal | 2101–2129 | Journal entries |
| Calendar | 2130–2176 | Calendar grid |
| Community/Feed | 2239–2275 | Posts, likes, feed |
| Doc Editor | 2406–2572 | Rich text editor |
| Daily Brief | 2573–2648 | Morning brief overlay |
| Org Space | 3428–3646 | Team chat, org analytics, OKRs |
| Responsive | 3118–3162 | Mobile breakpoints |

## How to split a component (for future engineers)
1. Find the section in styles.css using the comment header
2. Cut the CSS block
3. Create `css/components/component-name.css` with that content
4. Add `@import './components/component-name.css';` at the top of styles.css
5. Test in browser — hot-reload confirms nothing broke

## Design system quick reference
- Primary colour: `var(--teal)` = `#0D7A5F`
- Accent colour:  `var(--accent2)` = `#534AB7` (purple)
- Font heading:   `var(--font-head)` = Syne
- Font body:      `var(--font)` = Plus Jakarta Sans
- Dark mode:      Applied via `[data-theme="dark"]` on `<body>`
- Border radius:  `var(--radius)` = 10px, `var(--radius2)` = 16px
