# js/features/ — One file per product feature

Each file is self-contained for its feature. They depend on js/core/ being loaded first.
All functions remain global (no ES modules) — load as separate <script> tags in index.html.

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

### tasks.js (app.js — Flux panel + task helpers)
- Task add, complete, delete, priority toggle
- Focus mode (`focusStart()`, `focusEnd()`)
- Task filter + sort

### goals.js (app.js lines ~2510–2630)
- `glRender()`, `glToggleForm()`
- `glLoad()`, `glAdd()`, `glUpdate()`, `glDelete()`

### habits.js (app.js — habits panel)
- `habitInit()`, `habitRender()`
- Streak calculation, daily check-in

### calendar.js (app.js lines ~4784–4900)
- `calInit()`, `calRender()`
- Google Calendar sync functions

### journal.js (app.js lines ~4976–5050)
- `journalInit()`, `journalSave()`, `journalRender()`
- `reflectWithAI()`

### notes.js (app.js lines ~8193–8380 + docHub ~2625–2850)
- `docInit()`, `dhInit()`
- `dhNewDoc()`, `dhOpenDoc()`, `dhSaveDoc()`
- `dhFormat()`, `dhBlock()`

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
