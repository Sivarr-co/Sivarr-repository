// Habits panel — extracted from js/app.js. Depends on app.js's shared globals
// (S, API, $, toast, _queueMutation) which load before this file. See
// templates/index.html for script load order.

// ════════════ HABITS ════════════
const HAB_KEY = () => `sivarr_habits_${S.sid || "guest"}`;

function _habFreqLabel(freq) {
  return (
    {
      daily: "Every day",
      weekdays: "Weekdays (M–F)",
      weekends: "Weekends",
      weekly: "Once a week",
    }[freq] || "Every day"
  );
}

function _habHeatmap(h) {
  const today = new Date();
  const cells = [];
  for (let d = 27; d >= 0; d--) {
    const dt = new Date();
    dt.setDate(today.getDate() - d);
    const ds = dt.toISOString().split("T")[0];
    const done = (h.completions || []).includes(ds);
    cells.push(
      `<div class="hm-cell${done ? " done" : ""}" title="${ds}"></div>`,
    );
  }
  return `<div class="hab-heatmap-grid">${cells.join("")}</div>`;
}

// habitToggle/habitEdit/habitDelete all address habits by their position in
// the FULL localStorage array, not a stable id (unlike tasks/goals/docs) —
// pre-existing, not something this pass changes. So when soft-deleted habits
// are filtered out of what's rendered, each visible card must still carry
// its ORIGINAL index from the full array, not its position in the filtered
// list, or clicking a button would silently act on the wrong habit.
function _habVisible(habits) {
  return (habits || [])
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !h.deleted_at);
}

function habitInit() {
  _habPruneExpiredTrash();
  const allHabits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
  const habits = _habVisible(allHabits); // [{h, i}], i = index into allHabits
  const today = new Date().toISOString().split("T")[0];

  // Stats
  const bestEver = habits.reduce(
    (m, { h }) => Math.max(m, h.best_streak || h.streak || 0),
    0,
  );
  const doneToday = habits.filter(({ h }) =>
    (h.completions || []).includes(today),
  ).length;
  const hs = $("hab-streak");
  if (hs) hs.textContent = bestEver;
  const dt = $("hab-today");
  if (dt) dt.textContent = `${doneToday}/${habits.length}`;
  // 28-day rate
  if (habits.length) {
    const dateRange = [];
    for (let d = 27; d >= 0; d--) {
      const dt2 = new Date();
      dt2.setDate(dt2.getDate() - d);
      dateRange.push(dt2.toISOString().split("T")[0]);
    }
    const totalPossible = habits.length * 28;
    const totalDone = habits.reduce(
      (s, { h }) =>
        s + dateRange.filter((ds) => (h.completions || []).includes(ds)).length,
      0,
    );
    const rate = Math.round((totalDone / totalPossible) * 100);
    const rEl = $("hab-rate");
    if (rEl) rEl.textContent = `${rate}%`;
  }

  const list = $("habits-list");
  if (!list) return;
  if (!habits.length) {
    list.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;padding:2.5rem 1rem;gap:10px;color:var(--muted)">
      <div style="font-size:2rem">🔥</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--text)">No habits yet</div>
      <div style="font-size:.82rem;text-align:center;max-width:280px">Build consistency by tracking daily habits. Click <strong>+ Habit</strong> to get started.</div>
    </div>`;
    return;
  }

  list.innerHTML = habits
    .map(({ h, i }) => {
      const isToday = (h.completions || []).includes(today);
      const streak = h.streak || 0;
      const best = Math.max(h.best_streak || 0, streak);
      return `
    <div class="habit-card">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="habit-cb ${isToday ? "done" : ""}" data-onclick="habitToggle" data-onclick-args="${esc(JSON.stringify([i]))}" title="${isToday ? "Mark undone" : "Mark done today"}">${isToday ? "✓" : ""}</button>
        <div class="habit-emoji">${h.emoji || "📌"}</div>
        <div class="habit-info" style="flex:1;min-width:0">
          <div class="habit-title">${esc(h.title)}</div>
          <div class="habit-sub2">${_habFreqLabel(h.freq)} · 🔥 ${streak}${best > streak ? ` · best: ${best}` : ""}</div>
        </div>
        <div class="hab-card-actions">
          <button class="habit-action-btn" data-onclick="habitEdit" data-onclick-args="${esc(JSON.stringify([i]))}" title="Edit"><i class="ti ti-pencil"></i></button>
          <button class="habit-action-btn" data-onclick="habitDelete" data-onclick-args="${esc(JSON.stringify([i]))}" title="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      ${_habHeatmap(h)}
    </div>`;
    })
    .join("");
}

function habitToggle(idx) {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
  if (!habits[idx]) return;
  const today = new Date().toISOString().split("T")[0];
  habits[idx].completions = habits[idx].completions || [];
  if (habits[idx].completions.includes(today)) {
    habits[idx].completions = habits[idx].completions.filter(
      (d) => d !== today,
    );
    habits[idx].streak = Math.max(0, (habits[idx].streak || 0) - 1);
  } else {
    habits[idx].completions.push(today);
    habits[idx].streak = (habits[idx].streak || 0) + 1;
    habits[idx].best_streak = Math.max(
      habits[idx].best_streak || 0,
      habits[idx].streak,
    );
    const streak = habits[idx].streak;
    if (streak > 0 && streak % 7 === 0)
      _autoFire("habit_streak", {
        habitTitle: habits[idx].title,
        streak,
        journalPrompt: `${streak}-day streak on "${habits[idx].title}"! How does it feel? `,
        followUpTask: `Keep the ${streak}-day streak: ${habits[idx].title}`,
      });
  }
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  _recordActivity();
  habitInit();
}

async function habitAdd() {
  const emojis = ["📚", "🧘", "🏃", "💧", "🥗", "✍️", "🎯", "🛌", "🔔", "💡"];
  const d = await siModal.form(
    "Add Habit",
    [
      {
        id: "title",
        label: "Habit name",
        placeholder: "e.g. Morning Study",
        required: true,
      },
      {
        id: "emoji",
        label: "Pick an emoji",
        type: "emoji",
        options: emojis,
        default: emojis[Math.floor(Math.random() * emojis.length)],
      },
      {
        id: "freq",
        label: "Frequency",
        type: "select",
        options: [
          { value: "daily", label: "Every day" },
          { value: "weekdays", label: "Weekdays (Mon–Fri)" },
          { value: "weekends", label: "Weekends" },
          { value: "weekly", label: "Once a week" },
        ],
        default: "daily",
      },
    ],
    { confirmLabel: "Add Habit" },
  );
  if (!d || !d.title) return;
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
  habits.push({
    id: Date.now().toString(),
    title: d.title,
    emoji: d.emoji || "📌",
    freq: d.freq || "daily",
    completions: [],
    streak: 0,
    best_streak: 0,
  });
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  habitInit();
  toast("Habit added ✓");
}

async function habitEdit(idx) {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
  const h = habits[idx];
  if (!h) return;
  const emojis = ["📚", "🧘", "🏃", "💧", "🥗", "✍️", "🎯", "🛌", "🔔", "💡"];
  const d = await siModal.form(
    "Edit Habit",
    [
      {
        id: "title",
        label: "Habit name",
        placeholder: "e.g. Morning Study",
        required: true,
        default: h.title,
      },
      {
        id: "emoji",
        label: "Pick an emoji",
        type: "emoji",
        options: emojis,
        default: h.emoji || "📌",
      },
      {
        id: "freq",
        label: "Frequency",
        type: "select",
        options: [
          { value: "daily", label: "Every day" },
          { value: "weekdays", label: "Weekdays (Mon–Fri)" },
          { value: "weekends", label: "Weekends" },
          { value: "weekly", label: "Once a week" },
        ],
        default: h.freq || "daily",
      },
    ],
    { confirmLabel: "Save" },
  );
  if (!d || !d.title) return;
  habits[idx].title = d.title;
  habits[idx].emoji = d.emoji || h.emoji || "📌";
  habits[idx].freq = d.freq || "daily";
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  habitInit();
  toast("Habit updated ✓");
}

async function habitDelete(idx) {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
  const h = habits[idx];
  if (!h) return;
  if (
    !(await siModal.confirm(
      `Delete "${h.title}"? You can restore it from Trash within 30 days.`,
      { title: "Delete Habit", confirmLabel: "Delete", danger: true },
    ))
  )
    return;
  habits[idx].deleted_at = new Date().toISOString();
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  habitInit();
  toast("Habit moved to Trash");
}

function habitRestore(idx) {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
  if (!habits[idx]) return;
  delete habits[idx].deleted_at;
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  habitInit();
}

// ── Server sync — per-entity, not whole-array ───────────────────────────
// Same diff-against-a-snapshot approach as js/features/tasks.js's
// _syncTasksToServer — see that file for the full rationale. Habits are
// addressed by array index in the UI functions above (habitToggle/Edit/
// Delete/Restore all take `idx`), but every habit object still carries a
// stable `id` (set in habitAdd), which is what this diff keys off of.
const HAB_SYNCED_KEY = () => `sivarr_hab_synced_${S.sid || "guest"}`;

function _habGetSyncedSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(HAB_SYNCED_KEY()) || "{}");
  } catch {
    return {};
  }
}
function _habSetSyncedSnapshot(snap) {
  try {
    localStorage.setItem(HAB_SYNCED_KEY(), JSON.stringify(snap));
  } catch (_) {}
}

// The client has always used "freq"; the server column is "frequency" (see
// routes/habits.py's _CLIENT_FIELD_ALIASES for the write-side mapping and
// the bug this closes). This is the read-side mirror, for habit objects the
// server hands back (a hydrate/restore pull).
function _habServerHabitToLocal(h) {
  const out = { ...h };
  if ("frequency" in out) {
    out.freq = out.frequency;
    delete out.frequency;
  }
  return out;
}

function _habSendMutation(url, body) {
  const token = getToken();
  if (!token || !S.sid) return Promise.resolve(null);
  body = { token, ...body };
  if (!navigator.onLine) {
    _queueMutation(url, body);
    return Promise.resolve(null);
  }
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      _queueMutation(url, body);
      return null;
    });
}

function _syncHabitsToServer(habits) {
  const token = getToken();
  if (!token || !S.sid) return;

  const snap = _habGetSyncedSnapshot();
  const nextSnap = {};

  (habits || []).forEach((h) => {
    const id = String(h.id);
    const serial = JSON.stringify(h);
    nextSnap[id] = serial;
    if (snap[id] === serial) return; // unchanged since last sync

    if (!(id in snap)) {
      _habSendMutation("/api/habits/add", { ...h });
      return;
    }
    let was;
    try {
      was = JSON.parse(snap[id]);
    } catch {
      was = {};
    }
    if (!was.deleted_at && h.deleted_at) {
      _habSendMutation("/api/habits/delete", { id: h.id });
    } else if (was.deleted_at && !h.deleted_at) {
      _habSendMutation("/api/habits/undelete", { id: h.id });
      _habSendMutation("/api/habits/update", { id: h.id, ...h });
    } else {
      _habSendMutation("/api/habits/update", { id: h.id, ...h });
    }
  });

  _habSetSyncedSnapshot(nextSnap);
}

// Same reasoning as tasks' _shPruneExpiredTrash — app.py's
// _purge_deleted_habits job purges the server side but never touches this
// browser's own localStorage copy, so the client has to prune that itself.
// Runs once per Habits-panel visit.
function _habPruneExpiredTrash() {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
  const cutoff = Date.now() - 30 * 86400000;
  const kept = habits.filter((h) => {
    if (!h.deleted_at) return true;
    const ts = Date.parse(h.deleted_at);
    return Number.isNaN(ts) || ts >= cutoff;
  });
  if (kept.length !== habits.length) {
    localStorage.setItem(HAB_KEY(), JSON.stringify(kept));
    _syncHabitsToServer(kept);
  }
}
