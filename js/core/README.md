# js/core/ — Shared foundation loaded before all features

These files must load BEFORE any js/features/ file.
They define global state, utilities, and auth that everything else depends on.

## Load order in index.html
```html
<script src="/js/core/state.js"></script>     <!-- 1st: global state -->
<script src="/js/core/api.js"></script>        <!-- 2nd: API wrapper, esc() -->
<script src="/js/core/ui.js"></script>         <!-- 3rd: toast, nav, siModal -->
<script src="/js/core/auth.js"></script>       <!-- 4th: login, session -->
```

## File responsibilities

### state.js
All global variables — the single source of truth for app state.
- `S` object: sid, name, email, plan, topics, stats
- `_BILLING_STATUS`, `_PLAN_LEVELS`, `_PAYWALL_CFG`
- `AUTH_TAB`, `CURRENT_ROLE`
- Feature-specific state: `_chatMsgCount`, `GL_GOALS`, `DH_ACTIVE`, etc.
- Currently in app.js lines 1–560

### api.js
Network layer — everything that talks to the backend.
- `API(path, body)` — authenticated POST wrapper
- `esc(text)` — XSS-safe HTML escaping
- `renderMarkdown(text)` — markdown renderer
- Currently in app.js lines 9–45

### ui.js
Pure UI utilities — no network calls, no auth.
- `toast(msg)` — notification toasts
- `siModal` — the entire modal system (input, confirm, form, alert)
- `nav(name, btn)` — panel navigation
- `$('id')` — querySelector shorthand
- `_showPaywall()`, `_removePaywall()`, `_hasPlan()`
- Currently in app.js lines 35–810

### auth.js
Authentication and session management on the client side.
- `doLogin()`, `doRegister()` — form handlers
- `restoreSession(token)` — restore from localStorage
- `saveSession()`, `clearSession()`, `getSavedSession()`
- `logout()`
- `checkAuthParams()` — handles ?google_code=, ?billing=success, etc.
- `_postLoginIntegrations()` — runs after login (billing verify, gcal, github)
- `googleSignInStart(e)`, `_googleCheckAvailable()`
- Currently in app.js lines 530–1370
