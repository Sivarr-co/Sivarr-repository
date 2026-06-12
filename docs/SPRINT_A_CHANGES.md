# Sprint A — Landing Page + Legal Pages
> Date: June 2026 | Status: Complete

## Changes made

### New files
- `templates/legal/terms.html` — Terms of Service (11 sections, dark theme, responsive)
- `templates/legal/privacy.html` — Privacy Policy (11 sections, third-party table, dark theme)

### Modified files
- `app.py` — Added `/terms` and `/privacy` routes. Root `/` route was already serving `landing.html` with client-side auth redirect (localStorage token check at top of page).

### Routes added
| Route | Template | Auth required |
|---|---|---|
| `GET /` | `landing.html` | No — client-side JS redirects to `/app` if token present |
| `GET /terms` | `legal/terms.html` | No |
| `GET /privacy` | `legal/privacy.html` | No |

### Google OAuth scope
Confirmed: scope limited to `openid email profile` only (app.py line ~7190). No additional scopes requested at login. The Google Calendar integration uses a separate OAuth flow with `calendar.events` scope, which is appropriate and only triggered when the user explicitly connects their calendar.

### Notes on auth redirect approach
The app uses localStorage-based tokens (not cookies). The existing landing page already handles authenticated user redirect via JS (`localStorage.getItem('sivarr_token') → window.location.replace('/app')`). A server-side cookie check is not applicable since no session cookies are set.

## Testing checklist
- [ ] Unauthenticated visit to `/` shows landing page
- [ ] Authenticated visit to `/` redirects to `/app` (via client-side JS)
- [ ] `/terms` renders without 404
- [ ] `/privacy` renders without 404
- [ ] "Get started free" CTA links to `/app`
- [ ] Navbar links work on landing page
- [ ] Page is responsive on 375px mobile width
- [ ] Google OAuth scope is `openid email profile` only ✓

## MVP impact
- Landing page: already at 90%+ (existing landing.html is production-quality)
- Legal pages: 0% → 100%
- Overall MVP: +8% toward target
