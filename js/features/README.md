# js/features/ — One file per product feature

Each file is self-contained for its feature. They depend on js/core/ being loaded first.
All functions remain global (no ES modules) — load as separate <script> tags in index.html.

**Status**: `tasks.js`, `habits.js`, and `docs_notes.js` are implemented (see their
entries below, marked DONE) — everything else in this file is still the original
aspirational plan, not yet carried out. `js/core/` doesn't exist yet either; the
three done files currently load directly before `app.js` in `templates/index.html`,
depending on app.js's shared globals (`S`/`API`/`$`/`toast`/`_queueMutation`) rather
than a `js/core/` module.

## Load order in index.html (after core/)
```html
<script src="/js/features/billing.js"></script>
<script src="/js/features/chat.js"></script>
<script src="/js/features/community.js"></script>
<script src="/js/features/tasks.js"></script>
<script src="/js/features/goals.js"></script>
<script src="/js/features/habits.js"></script>
<script src="/js/features/calendar.js"></script>
<script src="/js/features/journal.js"></script>
<script src="/js/features/notes.js"></script>
<script src="/js/features/org.js"></script>
<script src="/js/features/ai.js"></script>
<script src="/js/features/settings.js"></script>
<script src="/js/features/spaces.js"></script>
<script src="/js/features/academic.js"></script>
<script src="/js/features/agents.js"></script>
<script src="/js/features/notifications.js"></script>
<script src="/js/app.js"></script>             <!-- entry point + DOMContentLoaded last -->
```

## File responsibilities

### billing.js (app.js lines ~740–1105)
- `_planLevel()`, `_hasPlan()`, `_PLAN_LEVELS`
- `billingLoadStatus()`, `billingSubscribe()`, `billingVerify()`
- `showPricing()`, `closePricing()`
- `_unlockAfterPayment()`, `billingCancelConfirm()`
- `stLoadBillingHistory()`, `stUpdateUsage()`
- `flutterwaveSubscribe()`, `flutterwaveVerify()`

### chat.js (app.js lines ~1780–2020)
- `addMsg(role, text)`, `addTyping()`
- `send()`, `retryChat()`, `quickPrompt()`
- `chatCounterInit()`, `chatCounterRender()`
- `chatCopyMsg()`, `chatExport()`, `chatClearConfirm()`
- `_chatSetStatus()`, `scrollMsgs()`
- `chatSaveTask()`, `chatSaveNote()`
- `ckd(event)` — keyboard handler

### community.js (app.js lines ~5177–5392)
- `communityInit()`, `commLoadFeed()`
- `communityPost()`, `commLike()`, `commReply()`
- `commFilter()`, `commSetMode()`
- `commLoadOpportunities()`, `oppFilter()`, `oppSubmit()`
- `_commRenderPost()`, `_timeAgo()`

### tasks.js — DONE (2026-08-14)
Internal name "flux"/`SH_` prefix. Task board/list/overview views, detail panel,
bulk actions, filter/sort, drag-drop. Focus mode (`focusStart()`/`focusEnd()`)
stays in app.js — it's a separate feature that happens to read task data.

### goals.js (app.js lines ~2510–2630)
- `glRender()`, `glToggleForm()`
- `glLoad()`, `glAdd()`, `glUpdate()`, `glDelete()`

### habits.js — DONE (2026-08-14)
- `habitInit()`, `habitAdd()`, `habitEdit()`, `habitToggle()`, `habitDelete()`
- Streak/best-streak calculation, 28-day completion rate
- `.habit-cb` (the checkbox class) stays in css/panels.css — shared with the
  Home "Today" widget's habit checkboxes, not habits.js-exclusive.

### calendar.js (app.js lines ~4784–4900)
- `calInit()`, `calRender()`
- Google Calendar sync functions

### journal.js (app.js lines ~4976–5050)
- `journalInit()`, `journalSave()`, `journalRender()`
- `reflectWithAI()`

### docs_notes.js — DONE (2026-08-14), named docs_notes.js not notes.js
Docs & Notes panel: Tiptap rich-text editor + slash-command menu.
- `docInit()`, `docFromTemplate()`, doc list/search/rename/delete
- Slash-command menu (`_slashOpen()`, `_slashExec()`, etc.)
- An earlier "Document Hub" (`dh*` functions, `DH_KEY`) and a separate orphaned
  `loadNotes()`/`renderNotes()` block were found to be dead code — not wired to
  any template, colliding with this feature's localStorage keys — and were
  deleted rather than migrated. If you're looking for `dhNewDoc()`-style
  functions from an earlier version of this doc, they no longer exist.

### org.js (app.js — org space functions)
- Org chat, channels, members, presence
- Projects kanban, HR, automations
- Founder mode, OKR goals

### ai.js (app.js lines ~5049–5177)
- `aiTaskExtractor()`, `_aiShowExtractedTasks()`, `_aiAddTask()`
- `aiWriteAssist()`, `_aiShowWriteResult()`, `_aiCopyResult()`

### settings.js (app.js lines ~3311–3800)
- `stInit()`, `stLoad()`, `stSave()`
- `stSaveProfile()`, `stChangePassword()`
- `stToggleTheme()`, `stSetAccent()`
- `stToggleSection()`, `stUpdateUsage()`

### spaces.js (app.js lines ~10554–10813)
- `getSpaces()`, `saveSpaces()`
- `spaceRenderSidebar()`, `openSpace()`
- `openCreateSpaceModal()`, `cspCreate()`

### academic.js (app.js lines ~11082–11550)
- Academic space: flashcards, timer, quiz, study groups
- `acInit()`, `acLoadCards()`, `acStartQuiz()`

### agents.js (app.js lines ~11547–13070)
- Template marketplace: browse, install, build, publish
- Paystack checkout for templates
- Agent dashboard, earnings, reviews

### notifications.js (app.js lines ~13216–13450)
- `_buildNotifs()`, `notifToggle()`
- `_renderNotifList()`, `notifAction()`
- In-app notification bell
