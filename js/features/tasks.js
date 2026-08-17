// Tasks panel (internal name "flux"/SH_ prefix) — extracted from js/app.js.
// Depends on app.js's shared globals (S, API, $, toast, _queueMutation) which
// load before this file. See templates/index.html for script load order.

const SH_KEY = () => `sivarr_sh_${S.sid || "guest"}`;
let SH_DRAG = null;
let SH_VIEW = "board";
let SH_ADD_COL = "todo";
let SH_SELECTED = null;
const SH_BULK_SEL = new Set();

function _fmtDueDate(date, time) {
  if (!date) return { label: "–", color: "var(--muted)", overdue: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(date + "T00:00:00");
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due - today) / 86400000);
  const t = time ? `, ${time}` : "";
  if (diff < 0) return { label: "Overdue", color: "#ef4444", overdue: true };
  if (diff === 0)
    return { label: `Today${t}`, color: "#f59e0b", overdue: false };
  if (diff === 1)
    return { label: `Tomorrow${t}`, color: "var(--accent)", overdue: false };
  return { label: `${date}${t}`, color: "var(--text2)", overdue: false };
}

function _shSelectTask(id) {
  SH_SELECTED = id;
  document.querySelectorAll(".sh-overview-row").forEach((r) => {
    r.style.background =
      Number(r.dataset.id) === id ? "var(--teal2,rgba(13,122,95,.08))" : "";
  });
}

const SH_COLS = {
  todo: { label: "Not Started", color: "#94a3b8" },
  inprogress: { label: "In Progress", color: "#f59e0b" },
  done: { label: "Done", color: "#22c55e" },
};

function getSHData() {
  try {
    return JSON.parse(localStorage.getItem(SH_KEY()) || '{"tasks":[]}');
  } catch {
    return { tasks: [] };
  }
}

// Soft-deleted tasks (deleted_at set) stay in getSHData()'s full array forever
// — deleteSHTask() never removes them, only marks them — so any read-modify-
// write cycle through saveSHData() keeps preserving them. Every render/count/
// search/calendar site must filter through this instead of reading
// `.tasks` raw, or a trashed task would silently reappear in the UI. Mutation
// sites (edit/move/add-subtask) that look a task up by id don't need this:
// a deleted task has no rendered element to click in the first place.
function shActiveTasks(tasks) {
  return (tasks || []).filter((t) => !t.deleted_at);
}

function saveSHData(data) {
  localStorage.setItem(SH_KEY(), JSON.stringify(data));
  _syncTasksToServer(data.tasks || []);
}

// ── Silently mirror tasks to the server for digest + search ──
function _syncTasksToServer(tasks) {
  const token = getToken();
  if (!token || !S.sid) return;
  if (!navigator.onLine) {
    _queueMutation("/api/tasks/sync", { token, tasks });
    return;
  }
  fetch("/api/tasks/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, tasks }),
  })
    .then((r) => r.json())
    .then((d) => {
      // If the server spawned new recurring task occurrences, merge them into localStorage
      if (d.spawned && d.spawned.length > 0) {
        const data = getSHData();
        const ids = new Set((data.tasks || []).map((t) => t.id));
        // Reload all tasks from server to get the new occurrences
        fetch(`/api/tasks/restore?token=${encodeURIComponent(token)}`)
          .then((r2) => r2.json())
          .then((d2) => {
            if (d2.tasks && d2.tasks.length) {
              data.tasks = d2.tasks;
              localStorage.setItem(SH_KEY(), JSON.stringify(data));
              renderSHOverview();
              renderSHBoard();
              toast("New recurring task added ↻");
            }
          })
          .catch(() => {});
      }
    })
    .catch(() => _queueMutation("/api/tasks/sync", { token, tasks }));
}

// Permanently drops tombstones older than the 30-day Trash retention window.
// There's no server-side purge for tasks the way there is for Goals (see
// app.py's _purge_deleted_goals) — tasks only ever exist as whatever the
// client's own array contains, so the client has to be the one to let old
// deleted items go, or they'd sit in localStorage (and the server mirror)
// forever. Runs once per Tasks-panel visit; cheap and idempotent.
function _shPruneExpiredTrash() {
  const data = getSHData();
  const cutoff = Date.now() - 30 * 86400000;
  const kept = (data.tasks || []).filter((t) => {
    if (!t.deleted_at) return true;
    const ts = Date.parse(t.deleted_at);
    return Number.isNaN(ts) || ts >= cutoff; // malformed timestamp: keep, don't guess
  });
  if (kept.length !== (data.tasks || []).length) {
    data.tasks = kept;
    saveSHData(data);
  }
}

function loadStudyHelp() {
  _shPruneExpiredTrash();
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  const overviewBtn = $("sh-view-overview");
  setSHView("overview", overviewBtn);
  renderSHBoard();
}

// ── Filter / Sort state ───────────────────────────────────────
let _SH_FILTERS = {};
let _SH_SORT = "due_asc";

function shToggleFilter(e) {
  e.stopPropagation();
  const d = $("sh-filter-drop"),
    s = $("sh-sort-drop");
  if (s) s.style.display = "none";
  if (d) d.style.display = d.style.display === "none" ? "block" : "none";
}
function shToggleSort(e) {
  e.stopPropagation();
  const d = $("sh-filter-drop"),
    s = $("sh-sort-drop");
  if (d) d.style.display = "none";
  if (s) s.style.display = s.style.display === "none" ? "block" : "none";
}
document.addEventListener("click", () => {
  const fd = $("sh-filter-drop");
  if (fd) fd.style.display = "none";
  const sd = $("sh-sort-drop");
  if (sd) sd.style.display = "none";
});

function shApplyFilters() {
  const checked = [
    ...document.querySelectorAll("#sh-filter-drop input:checked"),
  ].map((el) => el.value);
  _SH_FILTERS = {};
  checked.forEach((v) => (_SH_FILTERS[v] = true));
  if (SH_VIEW === "overview") renderSHOverview();
  if (SH_VIEW === "list") renderSHListView();
}
function shApplySort() {
  const sel = document.querySelector("#sh-sort-drop input:checked");
  if (sel) _SH_SORT = sel.value;
  if (SH_VIEW === "overview") renderSHOverview();
  if (SH_VIEW === "list") renderSHListView();
}

function _shFilterAndSort(tasks) {
  const today = new Date().toISOString().split("T")[0];
  const weekEnd = new Date(Date.now() + 6 * 86400000)
    .toISOString()
    .split("T")[0];
  const PRI = { high: 4, medium: 3, normal: 2, low: 1 };
  const hasF = Object.keys(_SH_FILTERS).length > 0;

  let out = hasF
    ? tasks.filter((t) => {
        const s = t.status || (t.done ? "done" : "not_started");
        const p = t.priority || "normal";
        const d = t.date || t.due_date || "";
        if (
          _SH_FILTERS["not_started"] ||
          _SH_FILTERS["in_progress"] ||
          _SH_FILTERS["done"]
        ) {
          if (!_SH_FILTERS[s]) return false;
        }
        if (
          _SH_FILTERS["p_high"] ||
          _SH_FILTERS["p_medium"] ||
          _SH_FILTERS["p_normal"] ||
          _SH_FILTERS["p_low"]
        ) {
          if (!_SH_FILTERS[`p_${p}`]) return false;
        }
        if (
          _SH_FILTERS["due_overdue"] ||
          _SH_FILTERS["due_today"] ||
          _SH_FILTERS["due_week"] ||
          _SH_FILTERS["due_none"]
        ) {
          if (_SH_FILTERS["due_none"] && !d) return true;
          if (_SH_FILTERS["due_overdue"] && d && d < today) return true;
          if (_SH_FILTERS["due_today"] && d === today) return true;
          if (_SH_FILTERS["due_week"] && d > today && d <= weekEnd) return true;
          return false;
        }
        return true;
      })
    : [...tasks];

  out.sort((a, b) => {
    const da = a.date || a.due_date || "";
    const db = b.date || b.due_date || "";
    const pa = PRI[a.priority || "normal"] || 2;
    const pb = PRI[b.priority || "normal"] || 2;
    if (_SH_SORT === "due_asc") return (da || "9") < (db || "9") ? -1 : 1;
    if (_SH_SORT === "due_desc") return (da || "") > (db || "") ? -1 : 1;
    if (_SH_SORT === "priority") return pb - pa;
    if (_SH_SORT === "created") return (b.id || "") > (a.id || "") ? 1 : -1;
    if (_SH_SORT === "alpha")
      return (a.title || "").localeCompare(b.title || "");
    return 0;
  });
  return out;
}

function setSHView(view, btn) {
  SH_VIEW = view;
  document
    .querySelectorAll(".sh-view-btn")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  $("sh-overview-view").style.display = view === "overview" ? "flex" : "none";
  $("sh-board-view").style.display = view === "board" ? "flex" : "none";
  $("sh-list-view").style.display = view === "list" ? "block" : "none";
  if (view === "overview") renderSHOverview();
  if (view === "list") renderSHListView();
}

function renderSHOverview() {
  const data = getSHData();
  const tasks = _shFilterAndSort(shActiveTasks(data.tasks));
  const tbody = $("sh-overview-rows");
  if (!tbody) return;

  const STATUS = {
    todo: { label: "Not started", color: "#94a3b8", bg: "#94a3b815" },
    inprogress: { label: "In progress", color: "#4f6ef7", bg: "#4f6ef715" },
    done: { label: "Done", color: "#22c55e", bg: "#22c55e15" },
  };
  const PRIORITY = {
    high: { label: "🔴 High", color: "#ef4444" },
    medium: { label: "🟡 Medium", color: "#f59e0b" },
    low: { label: "🟢 Low", color: "#22c55e" },
    normal: { label: "Normal", color: "var(--muted)" },
  };
  const TYPE_ICONS = {
    assignment: "📋",
    exam: "📝",
    reading: "📖",
    project: "🗂",
    revision: "🔄",
    other: "⚙️",
  };

  if (!tasks.length) {
    tbody.innerHTML = `<tr><td colspan="12"><div style="display:flex;flex-direction:column;align-items:center;padding:3rem 1rem;gap:10px">
      <div style="font-size:2.2rem">✅</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--text)">No tasks yet</div>
      <div style="font-size:.82rem;color:var(--muted);text-align:center;max-width:340px;line-height:1.5">
        Capture everything you need to do. Press <kbd style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:.73rem;font-family:monospace">N</kbd> or click the button below to add your first task.
      </div>
      <button onclick="openAddTask('todo')" style="margin-top:6px;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-family:var(--font-body);font-size:.83rem;font-weight:600;cursor:pointer">+ New task</button>
    </div></td></tr>`;
    return;
  }

  // Group: top-level tasks first, subtasks indented beneath their parent
  const topLevel = tasks.filter((t) => !t.parent_id);
  const childMap = {};
  tasks
    .filter((t) => t.parent_id)
    .forEach((t) => {
      (childMap[String(t.parent_id)] =
        childMap[String(t.parent_id)] || []).push(t);
    });
  const ordered = [];
  topLevel.forEach((t) => {
    ordered.push({ task: t, indent: false });
    (childMap[String(t.id)] || []).forEach((c) =>
      ordered.push({ task: c, indent: true }),
    );
  });
  tasks
    .filter(
      (t) =>
        t.parent_id &&
        !topLevel.find((p) => String(p.id) === String(t.parent_id)),
    )
    .forEach((t) => ordered.push({ task: t, indent: false }));

  tbody.innerHTML = ordered
    .map(({ task: t, indent }) => {
      const st = STATUS[t.status] || STATUS.todo;
      const pr = PRIORITY[t.priority] || PRIORITY.normal;
      const ico = TYPE_ICONS[t.type] || "⚙️";
      const dueFmt = _fmtDueDate(t.date, t.time);
      const updated = t.updated || t.created || "–";
      const isDone = t.status === "done";
      const isSel = SH_SELECTED === t.id;

      return `<tr class="sh-overview-row" data-id="${t.id}"
      style="transition:background .1s;background:${isSel ? "var(--teal2,rgba(13,122,95,.08))" : ""};cursor:pointer"
      onclick="_shSelectTask(${t.id})"
      onmouseover="if(SH_SELECTED!==${t.id})this.style.background='var(--surface)'"
      onmouseout="this.style.background=SH_SELECTED===${t.id}?'var(--teal2,rgba(13,122,95,.08))':''">
      <td style="text-align:center;padding:4px;vertical-align:middle">
        <input type="checkbox" ${SH_BULK_SEL.has(t.id) ? "checked" : ""}
          onclick="event.stopPropagation();_shToggleBulk(${t.id},this.checked)"
          style="cursor:pointer;accent-color:var(--accent)">
      </td>
      <td><div class="sh-cell" style="display:flex;align-items:center;gap:5px;${indent ? "padding-left:12px" : ""}">
            ${indent ? '<span style="color:var(--border);font-size:.75rem;flex-shrink:0;margin-right:1px">↳</span>' : ""}
            <div class="sh-cell-title" style="flex:1;${isDone ? "text-decoration:line-through;opacity:.6" : ""};cursor:pointer"
                onclick="event.stopPropagation();shOpenDetail(${t.id})">${esc(t.title)}${t.recurrence ? ' <span title="Recurring" style="color:var(--teal);font-size:.8em">↻</span>' : ""}</div>
            <button class="task-focus-btn" onclick="event.stopPropagation();focusStart(${JSON.stringify(t.title)},25)" title="Focus on this task"><i class="ti ti-player-play" style="font-size:10px"></i></button>
            <button class="task-focus-btn" onclick="event.stopPropagation();inlineEdit(${t.id},'title',this.parentElement.querySelector('.sh-cell-title'))" title="Rename task"><i class="ti ti-pencil" style="font-size:10px"></i></button>
          </div></td>
      <td><div class="sh-cell" onclick="inlineEditSelect(${t.id},'status',this)">
            <span class="sh-status-pill" style="background:${st.bg};color:${st.color}">
              <span style="width:7px;height:7px;border-radius:50%;background:${st.color};flex-shrink:0"></span>
              ${st.label}
            </span></div></td>
      <td><div class="sh-cell editable" onclick="inlineEditSelect(${t.id},'type',this)">${ico} ${esc(t.type || "other")}</div></td>
      <td><div class="sh-cell editable" style="font-size:.75rem;color:var(--muted)"
            onclick="inlineEdit(${t.id},'desc',this)">${esc(t.desc || "–")}</div></td>
      <td><div class="sh-cell editable" onclick="inlineEdit(${t.id},'assignee',this)">${esc(t.assignee || "–")}</div></td>
      <td><div class="sh-cell editable" style="color:${isDone ? "var(--muted)" : dueFmt.color};font-size:.78rem;font-weight:${dueFmt.overdue ? "700" : "400"}"
            onclick="inlineEditDate(${t.id},this)">${dueFmt.label}</div></td>
      <td><div class="sh-cell" onclick="inlineEditSelect(${t.id},'priority',this)"
            style="color:${pr.color};font-weight:600;font-size:.78rem">${pr.label}</div></td>
      <td><div class="sh-cell" style="justify-content:center">
            ${
              t.attachName
                ? `<span style="font-size:.7rem;color:var(--accent)">📎 ${esc(t.attachName)}</span>`
                : `<button onclick="triggerSHAttach(${t.id})"
                  style="background:none;border:1px solid var(--border);border-radius:6px;
                         padding:2px 8px;color:var(--muted);font-size:.7rem;cursor:pointer">+ Attach</button>`
            }
          </div></td>
      <td><div class="sh-cell" style="font-size:.72rem;color:var(--muted)">${esc(updated)}</div></td>
      <td><div class="sh-cell editable" style="font-size:.75rem;color:var(--muted)"
            onclick="inlineEdit(${t.id},'summary',this)">${esc(t.summary || "–")}</div></td>
      <td style="text-align:center">
        <div class="sh-cell" style="justify-content:center">
          <button onclick="moveSHTask(${t.id}, '${isDone ? "todo" : "done"}')"
            style="width:22px;height:22px;border-radius:5px;cursor:pointer;font-size:.75rem;
                   background:${isDone ? "#22c55e" : "none"};
                   border:2px solid ${isDone ? "#22c55e" : "var(--border)"};
                   color:${isDone ? "#fff" : "transparent"}">${isDone ? "✓" : ""}</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// ── Inline editing ────────────────────────────────────────────────────────

function inlineEdit(id, field, cell) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;

  const cur = task[field] || "";
  const isMultiline = field === "desc" || field === "summary";

  if (isMultiline) {
    cell.innerHTML = `<textarea style="width:100%;background:var(--card);border:1px solid var(--accent);
      border-radius:5px;padding:4px 7px;color:var(--text);font-family:var(--font-body);font-size:.82rem;
      resize:none;outline:none;min-height:52px" onblur="saveInline(${id},'${field}',this.value)"
      onkeydown="if(event.key==='Escape')renderSHOverview()">${esc(cur)}</textarea>`;
    cell.querySelector("textarea").focus();
  } else {
    cell.innerHTML = `<input value="${esc(cur)}" style="width:100%;background:var(--card);border:1px solid var(--accent);
      border-radius:5px;padding:4px 7px;color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none"
      onblur="saveInline(${id},'${field}',this.value)"
      onkeydown="if(event.key==='Enter'||event.key==='Escape')this.blur()">`;
    cell.querySelector("input").focus();
    cell.querySelector("input").select();
  }
}

function inlineEditSelect(id, field, cell) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;

  const options = {
    status: [
      ["todo", "Not started"],
      ["inprogress", "In progress"],
      ["done", "Done"],
    ],
    priority: [
      ["normal", "Normal"],
      ["high", "🔴 High"],
      ["medium", "🟡 Medium"],
      ["low", "🟢 Low"],
    ],
    type: [
      ["assignment", "📋 Assignment"],
      ["exam", "📝 Exam prep"],
      ["reading", "📖 Reading"],
      ["project", "🗂 Project"],
      ["revision", "🔄 Revision"],
      ["other", "⚙️ Other"],
    ],
  };
  const opts = options[field] || [];

  cell.innerHTML = `<select style="width:100%;background:var(--card);border:1px solid var(--accent);
    border-radius:5px;padding:4px 7px;color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none"
    onblur="saveInline(${id},'${field}',this.value)"
    onchange="saveInline(${id},'${field}',this.value)">
    ${opts.map(([v, l]) => `<option value="${v}" ${task[field] === v ? "selected" : ""}>${l}</option>`).join("")}
  </select>`;
  cell.querySelector("select").focus();
}

function inlineEditDate(id, cell) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;
  cell.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:3px;padding:4px">
      <input type="date" value="${task.date || ""}" style="background:var(--card);border:1px solid var(--accent);
        border-radius:5px;padding:3px 6px;color:var(--text);font-size:.78rem;outline:none"
        onblur="saveDateInline(${id},'date',this.value)"
        onchange="saveDateInline(${id},'date',this.value)">
      <input type="time" value="${task.time || ""}" style="background:var(--card);border:1px solid var(--accent);
        border-radius:5px;padding:3px 6px;color:var(--text);font-size:.78rem;outline:none"
        onblur="saveDateInline(${id},'time',this.value)"
        onchange="saveDateInline(${id},'time',this.value)">
    </div>`;
  cell.querySelector("input").focus();
}

function saveInline(id, field, value) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;
  task[field] = value.trim();
  task.updated = new Date().toLocaleDateString();
  saveSHData(data);
  renderSHOverview();
  renderSHBoard();
}

function saveDateInline(id, field, value) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;
  task[field] = value;
  task.updated = new Date().toLocaleDateString();
  saveSHData(data);
  // Don't re-render yet — user may still editing time field
}

function triggerSHAttach(id) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.style.display = "none";
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    const data = getSHData();
    const task = (data.tasks || []).find((t) => t.id === id);
    if (task) {
      task.attachName = file.name;
      task.updated = new Date().toLocaleDateString();
    }
    saveSHData(data);
    renderSHOverview();
    toast(`Attached: ${file.name}`);
  };
  document.body.appendChild(inp);
  inp.click();
  document.body.removeChild(inp);
}

function handleSHAttach(input) {
  const file = input.files[0];
  if (!file) return;
  const fn = $("sh-modal-file-name");
  if (fn) fn.textContent = file.name;
  input._filename = file.name;
}

function openEditTask(id) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;
  const modal = $("sh-modal-bg");
  modal._editId = id;
  const h = $("sh-modal-heading");
  if (h) h.textContent = "Edit Task";
  $("sh-modal-title").value = task.title || "";
  $("sh-modal-status").value = task.status || "todo";
  $("sh-modal-type").value = task.type || "other";
  $("sh-modal-desc").value = task.desc || "";
  $("sh-modal-assignee").value = task.assignee || "";
  $("sh-modal-date").value = task.date || "";
  $("sh-modal-time").value = task.time || "";
  $("sh-modal-priority").value = task.priority || "normal";
  $("sh-modal-summary").value = task.summary || "";
  if ($("sh-modal-recur")) $("sh-modal-recur").value = task.recurrence || "";
  _populateGoalPicker(task.goalId || "");
  const fn = $("sh-modal-file-name");
  if (fn) fn.textContent = task.attachName || "No file chosen";
  modal.style.display = "flex";
  setTimeout(() => $("sh-modal-title")?.focus(), 100);
}

function _populateGoalPicker(selectedId = "") {
  const sel = $("sh-modal-goal");
  if (!sel) return;
  const goals = JSON.parse(
    localStorage.getItem(`sivarr_goals_${S.sid}`) || "[]",
  ).filter((g) => !g.completed);
  sel.innerHTML =
    '<option value="">No goal</option>' +
    goals
      .map(
        (g) =>
          `<option value="${g.id}" ${String(g.id) === String(selectedId) ? "selected" : ""}>${esc(g.title)}</option>`,
      )
      .join("");
}

function openAddTask(col) {
  SH_ADD_COL = col || "todo";
  const modal = $("sh-modal-bg");
  if (!modal) return;
  modal._editId = null;
  const h = $("sh-modal-heading");
  if (h) h.textContent = "New Task";
  $("sh-modal-title").value = "";
  $("sh-modal-status").value = SH_ADD_COL;
  $("sh-modal-type").value = "other";
  $("sh-modal-desc").value = "";
  $("sh-modal-assignee").value = "";
  $("sh-modal-date").value = "";
  $("sh-modal-time").value = "";
  $("sh-modal-priority").value = "normal";
  $("sh-modal-summary").value = "";
  _populateGoalPicker("");
  const fn = $("sh-modal-file-name");
  if (fn) fn.textContent = "No file chosen";
  const fi = $("sh-modal-file");
  if (fi) {
    fi.value = "";
    fi._filename = "";
  }
  modal.style.display = "flex";
  setTimeout(() => $("sh-modal-title")?.focus(), 100);
}

function closeSHModal() {
  const modal = $("sh-modal-bg");
  if (modal) modal.style.display = "none";
}

function saveSHModal() {
  const title = $("sh-modal-title")?.value.trim();
  if (!title) {
    toast("Enter a task name.");
    return;
  }

  const now = new Date().toLocaleDateString();
  const data = getSHData();
  data.tasks = data.tasks || [];
  const editId = $("sh-modal-bg")._editId;

  const goalId = $("sh-modal-goal")?.value || "";
  const fields = {
    title,
    status: $("sh-modal-status")?.value || "todo",
    type: $("sh-modal-type")?.value || "other",
    desc: $("sh-modal-desc")?.value.trim() || "",
    assignee: $("sh-modal-assignee")?.value.trim() || "",
    date: $("sh-modal-date")?.value || "",
    time: $("sh-modal-time")?.value || "",
    priority: $("sh-modal-priority")?.value || "normal",
    summary: $("sh-modal-summary")?.value.trim() || "",
    recurrence: $("sh-modal-recur")?.value || null,
    attachName: $("sh-modal-file")?._filename || "",
    goalId: goalId,
    updated: now,
  };

  if (editId) {
    const task = data.tasks.find((t) => t.id === editId);
    if (task) Object.assign(task, fields);
    $("sh-modal-bg")._editId = null;
    toast("Task updated ✓");
  } else {
    data.tasks.push({ id: Date.now(), created: now, ...fields });
    toast("Task added ✓");
  }

  saveSHData(data);
  closeSHModal();
  renderSHBoard();
}

function deleteSHTask(id) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;
  task.deleted_at = new Date().toISOString();
  saveSHData(data);
  renderSHBoard();
  if (SH_VIEW === "list") renderSHListView();
  toast("Task moved to Trash");
}

function restoreSHTask(id) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;
  delete task.deleted_at;
  saveSHData(data);
  renderSHBoard();
  if (SH_VIEW === "list") renderSHListView();
}

function moveSHTask(id, newStatus) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (task) {
    task.status = newStatus;
    task.done = newStatus === "done";
    saveSHData(data);
    if (newStatus === "done") {
      _recordActivity();
      _autoFire("task_done", {
        taskTitle: task.title,
        journalPrompt: `Just completed: "${task.title}". Thoughts? `,
        followUpTask: `Review: ${task.title}`,
      });
      // Auto-bump linked goal progress
      if (task.goalId && S.sid) {
        try {
          const goals = JSON.parse(
            localStorage.getItem(`sivarr_goals_${S.sid}`) || "[]",
          );
          const g = goals.find((g) => String(g.id) === String(task.goalId));
          if (g && !g.completed) {
            g.progress = Math.min(100, (g.progress || 0) + 10);
            if (g.progress >= 100) g.completed = true;
            localStorage.setItem(
              `sivarr_goals_${S.sid}`,
              JSON.stringify(goals),
            );
            toast(`🎯 ${g.title}: ${g.progress}%`);
          }
        } catch (_) {}
      }
    }
  }
  renderSHBoard();
  if (SH_VIEW === "list") renderSHListView();
}

// Drag and drop
function shDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add("drag-over");
}

function shDrop(e, col) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  if (SH_DRAG !== null) {
    moveSHTask(SH_DRAG, col);
    SH_DRAG = null;
  }
}

document.addEventListener("keydown", function _shKeys(e) {
  if (!$("panel-flux")?.classList.contains("active")) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if ($("sh-modal-bg")?.style.display === "flex") return;

  if (e.key === "Escape") {
    shCloseDetail();
    return;
  }
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    openAddTask("todo");
    return;
  }
  if (!SH_SELECTED) return;
  if (e.key === "e" || e.key === "E") {
    e.preventDefault();
    shOpenDetail(SH_SELECTED);
  }
  if (e.key === " ") {
    e.preventDefault();
    const task = (getSHData().tasks || []).find((t) => t.id === SH_SELECTED);
    if (task) moveSHTask(SH_SELECTED, task.status === "done" ? "todo" : "done");
  }
  if (e.key === "Delete") {
    e.preventDefault();
    if (confirm("Delete this task?")) {
      deleteSHTask(SH_SELECTED);
      SH_SELECTED = null;
      shCloseDetail();
    }
  }
});

// ── Bulk actions ──────────────────────────────────────────────────────────────

function _shBulkUpdateBar() {
  const bar = $("sh-bulk-bar");
  const count = $("sh-bulk-count");
  const size = SH_BULK_SEL.size;
  if (bar) bar.style.display = size > 0 ? "flex" : "none";
  if (count)
    count.textContent = `${size} task${size !== 1 ? "s" : ""} selected`;
  const allCb = $("sh-bulk-all");
  if (allCb) {
    const total = shActiveTasks(getSHData().tasks).length;
    allCb.checked = size > 0 && size === total;
    allCb.indeterminate = size > 0 && size < total;
  }
}

function _shToggleBulk(id, checked) {
  if (checked) SH_BULK_SEL.add(id);
  else SH_BULK_SEL.delete(id);
  _shBulkUpdateBar();
}

function _shBulkSelectAll(checked) {
  // Active tasks only — selecting all must never sweep up an already-trashed
  // task (it has no checkbox to have been individually selected, so "all"
  // silently including it would let bulk-complete resurrect a deleted task).
  const tasks = shActiveTasks(getSHData().tasks);
  if (checked) tasks.forEach((t) => SH_BULK_SEL.add(t.id));
  else SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHOverview();
}

function _shBulkComplete() {
  if (!SH_BULK_SEL.size) return;
  const n = SH_BULK_SEL.size;
  const data = getSHData();
  (data.tasks || []).forEach((t) => {
    if (SH_BULK_SEL.has(t.id)) {
      t.status = "done";
      t.done = true;
      t.updated = new Date().toLocaleDateString();
    }
  });
  saveSHData(data);
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHBoard();
  toast(`✓ ${n} task${n !== 1 ? "s" : ""} completed`);
}

function _shBulkDelete() {
  if (!SH_BULK_SEL.size) return;
  const n = SH_BULK_SEL.size;
  if (!confirm(`Delete ${n} task${n !== 1 ? "s" : ""}?`)) return;
  const data = getSHData();
  const now = new Date().toISOString();
  (data.tasks || []).forEach((t) => {
    if (SH_BULK_SEL.has(t.id)) t.deleted_at = now;
  });
  saveSHData(data);
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHBoard();
  toast(`🗑 ${n} task${n !== 1 ? "s" : ""} moved to Trash`);
}

function _shBulkPriority(p) {
  if (!p || !SH_BULK_SEL.size) return;
  const data = getSHData();
  (data.tasks || []).forEach((t) => {
    if (SH_BULK_SEL.has(t.id)) {
      t.priority = p;
      t.updated = new Date().toLocaleDateString();
    }
  });
  saveSHData(data);
  renderSHOverview();
  const sel = document.querySelector("#sh-bulk-bar select");
  if (sel) sel.value = "";
  toast(`Priority → ${p}`);
}

function _shBulkClear() {
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHOverview();
}

// ── Task detail side panel ────────────────────────────────────────────────────

function shOpenDetail(id) {
  const data = getSHData();
  const task = (data.tasks || []).find((t) => t.id === id);
  if (!task) return;

  const ST = {
    todo: { label: "Not started", color: "#94a3b8" },
    inprogress: { label: "In progress", color: "#4f6ef7" },
    done: { label: "Done", color: "#22c55e" },
  };
  const PR = {
    high: "🔴 High",
    medium: "🟡 Medium",
    low: "🟢 Low",
    normal: "Normal",
  };
  const dueFmt = _fmtDueDate(task.date, task.time);
  const st = ST[task.status] || ST.todo;

  $("sh-detail-body").innerHTML = `
    <div contenteditable="true" spellcheck="false"
      style="font-size:1.05rem;font-weight:700;color:var(--text);line-height:1.45;margin-bottom:16px;
             outline:none;border-radius:6px;padding:4px 6px;margin:-4px -6px"
      onblur="saveInline(${task.id},'title',this.innerText.trim())"
      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
      >${esc(task.title)}</div>

    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px">
      <span style="background:${st.color}15;color:${st.color};border:1px solid ${st.color}30;
                   border-radius:6px;padding:3px 10px;font-size:.75rem;font-weight:600;cursor:pointer"
        onclick="inlineEditSelect(${task.id},'status',this)">${st.label}</span>
      <span style="background:var(--surface);border:1px solid var(--border);
                   border-radius:6px;padding:3px 10px;font-size:.75rem;font-weight:600;cursor:pointer;color:var(--text2)"
        onclick="inlineEditSelect(${task.id},'priority',this)">${PR[task.priority] || "Normal"}</span>
      <span style="background:var(--surface);border:1px solid var(--border);
                   border-radius:6px;padding:3px 10px;font-size:.75rem;color:${dueFmt.color};font-weight:${dueFmt.overdue ? "700" : "500"};cursor:pointer"
        onclick="inlineEditDate(${task.id},this)">📅 ${dueFmt.label}</span>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Description</div>
      <div contenteditable="true" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
           padding:10px 12px;font-size:.84rem;color:var(--text);min-height:72px;line-height:1.6;outline:none"
        onblur="saveInline(${task.id},'desc',this.innerText.trim())">${esc(task.desc || "")}<br></div>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Notes</div>
      <div contenteditable="true" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
           padding:10px 12px;font-size:.84rem;color:var(--text);min-height:72px;line-height:1.6;outline:none"
        onblur="saveInline(${task.id},'notes',this.innerText.trim())">${esc(task.notes || "")}<br></div>
    </div>

    <div style="margin-bottom:20px;display:flex;flex-direction:column;gap:5px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Activity</div>
      ${task.created ? `<div style="font-size:.76rem;color:var(--muted)">📌 Created: ${task.created}</div>` : ""}
      ${task.updated ? `<div style="font-size:.76rem;color:var(--muted)">✏️ Updated: ${task.updated}</div>` : ""}
    </div>

    ${(() => {
      const allTasks = shActiveTasks(getSHData().tasks);
      const subs = allTasks.filter(
        (c) => String(c.parent_id) === String(task.id),
      );
      const subsHTML = subs.length
        ? subs
            .map(
              (s) => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;background:var(--surface);margin-bottom:4px">
            <input type="checkbox" ${s.status === "done" ? "checked" : ""}
              onchange="moveSHTask(${s.id},this.checked?'done':'todo');shOpenDetail(${task.id})"
              style="cursor:pointer;accent-color:var(--accent);flex-shrink:0">
            <span style="flex:1;font-size:.82rem;${s.status === "done" ? "text-decoration:line-through;opacity:.5;" : ""}">${esc(s.title)}</span>
            <button onclick="if(confirm('Delete subtask?')){deleteSHTask(${s.id});shOpenDetail(${task.id})}"
              style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.75rem;padding:2px 4px">✕</button>
          </div>`,
            )
            .join("")
        : `<div style="font-size:.78rem;color:var(--muted);padding:4px 0">No subtasks yet</div>`;
      return `
    <div style="margin-bottom:16px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
        <span>Subtasks ${subs.length ? `(${subs.filter((s) => s.done).length}/${subs.length})` : ""}</span>
        <button onclick="addSubtask(${task.id})"
          style="background:none;border:1px solid var(--border);border-radius:6px;padding:2px 8px;
                 font-size:.72rem;color:var(--accent);cursor:pointer;font-weight:600">+ Add</button>
      </div>
      ${subsHTML}
    </div>`;
    })()}

    <div style="display:flex;gap:8px">
      <button onclick="moveSHTask(${task.id},'${task.status === "done" ? "todo" : "done"}');shOpenDetail(${task.id})"
        style="flex:1;background:${task.status === "done" ? "var(--surface)" : "#22c55e"};
               border:1px solid ${task.status === "done" ? "var(--border)" : "#22c55e"};
               color:${task.status === "done" ? "var(--text2)" : "#fff"};
               border-radius:8px;padding:9px;font-family:var(--font-body);font-size:.83rem;font-weight:600;cursor:pointer">
        ${task.status === "done" ? "↩ Reopen" : "✓ Mark Done"}
      </button>
      <button onclick="openEditTask(${task.id})"
        style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
               padding:9px 14px;color:var(--text2);font-size:.83rem;cursor:pointer" title="Edit in modal">✎</button>
      <button onclick="if(confirm('Delete task?')){deleteSHTask(${task.id});shCloseDetail()}"
        style="background:none;border:1px solid var(--border);border-radius:8px;
               padding:9px 12px;color:var(--muted);font-size:.83rem;cursor:pointer">🗑</button>
    </div>`;

  const panel = $("sh-detail-panel");
  const backdrop = $("sh-detail-backdrop");
  if (panel) panel.style.transform = "translateX(0)";
  if (backdrop) backdrop.style.display = "block";
  _shSelectTask(id);
}

function shCloseDetail() {
  const panel = $("sh-detail-panel");
  const backdrop = $("sh-detail-backdrop");
  if (panel) panel.style.transform = "translateX(100%)";
  if (backdrop) backdrop.style.display = "none";
}

async function addSubtask(parentId) {
  const title = await siModal.input("New Subtask", "Subtask name:", "", {
    confirmLabel: "Add",
  });
  if (!title?.trim()) return;
  const data = getSHData();
  const parent = (data.tasks || []).find((t) => t.id === parentId);
  const now = new Date().toLocaleDateString();
  data.tasks.push({
    id: Date.now(),
    title: title.trim(),
    status: "todo",
    done: false,
    parent_id: parentId,
    priority: parent?.priority || "normal",
    created: now,
    updated: now,
  });
  saveSHData(data);
  renderSHBoard();
  shOpenDetail(parentId);
  toast("Subtask added ✓");
}

function renderSHBoard() {
  const data = getSHData();
  const tasks = shActiveTasks(data.tasks);
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const tc = $("sh-total-count");
  if (tc) tc.textContent = total;
  const dc = $("sh-done-count");
  if (dc) dc.textContent = done;
  const pb = $("sh-progress-bar");
  if (pb) pb.style.width = pct + "%";
  const pp = $("sh-pct");
  if (pp) pp.textContent = pct + "%";

  Object.keys(SH_COLS).forEach((col) => {
    const colTasks = tasks.filter((t) => t.status === col);
    const body = $(`sh-col-${col}`);
    const count = $(`sh-col-count-${col}`);
    if (!body) return;
    if (count) count.textContent = colTasks.length;

    const allTasksForBoard = tasks;
    body.innerHTML = colTasks.length
      ? colTasks
          .filter((t) => !t.parent_id)
          .map((t) => {
            const dFmt = _fmtDueDate(t.date, t.time);
            const subs = allTasksForBoard.filter(
              (c) => String(c.parent_id) === String(t.id),
            );
            const subDone = subs.filter((c) => c.done).length;
            return `
      <div class="sh-card" draggable="true"
        ondragstart="SH_DRAG=${t.id}"
        ondragend="document.querySelectorAll('.sh-col-body').forEach(b=>b.classList.remove('drag-over'))">
        <div class="sh-card-title">${esc(t.title)}</div>
        ${t.notes ? `<div class="sh-card-notes">${esc(t.notes)}</div>` : ""}
        <div class="sh-card-footer">
          ${t.date ? `<span class="sh-card-date" style="color:${dFmt.color};font-weight:${dFmt.overdue ? "700" : "400"}">${dFmt.overdue ? "⚠️" : "📅"} ${dFmt.label}</span>` : ""}
          ${subs.length ? `<span style="font-size:.67rem;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 5px">${subDone}/${subs.length} ○</span>` : ""}
          <span class="sh-priority ${t.priority}">${
            t.priority === "high"
              ? "🔴 High"
              : t.priority === "medium"
                ? "🟡 Med"
                : t.priority === "low"
                  ? "🟢 Low"
                  : ""
          }</span>
          <div style="margin-left:auto;display:flex;gap:4px">
            ${
              col !== "done"
                ? `<button onclick="moveSHTask(${t.id},'done')"
              style="background:#22c55e20;border:1px solid #22c55e40;border-radius:5px;
                     color:#22c55e;font-size:.65rem;padding:1px 6px;cursor:pointer">✓</button>`
                : ""
            }
            <button onclick="deleteSHTask(${t.id})" class="sh-card-del"
              style="opacity:1;background:none;border:none;color:var(--muted);cursor:pointer;font-size:.75rem">✕</button>
          </div>
        </div>
      </div>`;
          })
          .join("")
      : `<div style="font-size:.75rem;color:var(--muted);padding:8px 4px;text-align:center">No tasks</div>`;
  });

  // Refresh overview if visible
  if (SH_VIEW === "overview") renderSHOverview();
  if (SH_VIEW === "list") renderSHListView();
}

function renderSHListView() {
  const data = getSHData();
  const tasks = shActiveTasks(data.tasks);
  const container = $("sh-list-container");
  if (!container) return;

  if (!tasks.length) {
    container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;padding:3rem 1rem;gap:10px">
      <div style="font-size:2.2rem">✅</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--text)">No tasks yet</div>
      <div style="font-size:.82rem;color:var(--muted);text-align:center;max-width:340px;line-height:1.5">
        Press <kbd style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:.73rem;font-family:monospace">N</kbd> to create your first task.
      </div>
      <button onclick="openAddTask('todo')" style="margin-top:6px;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-family:var(--font-body);font-size:.83rem;font-weight:600;cursor:pointer">+ New task</button>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;
                letter-spacing:.06em;padding:6px 12px;display:grid;
                grid-template-columns:12px 1fr 80px 80px 70px 40px;gap:8px;
                border-bottom:1px solid var(--border)">
      <span></span><span>Task</span><span>Status</span><span>Priority</span><span>Due</span><span></span>
    </div>
    ${tasks
      .map(
        (t) => `
    <div class="sh-list-item" style="display:grid;grid-template-columns:12px 1fr 80px 80px 70px 40px;gap:8px;align-items:center">
      <div class="sh-list-status" style="background:${SH_COLS[t.status]?.color || "#94a3b8"}"></div>
      <div>
        <div style="font-weight:600;font-size:.84rem">${esc(t.title)}</div>
        ${t.notes ? `<div style="font-size:.72rem;color:var(--muted)">${esc(t.notes)}</div>` : ""}
      </div>
      <div style="font-size:.72rem;color:${SH_COLS[t.status]?.color || "var(--muted)"};font-weight:600">${SH_COLS[t.status]?.label || ""}</div>
      <div><span class="sh-priority ${t.priority}">${
        t.priority === "high"
          ? "🔴 High"
          : t.priority === "medium"
            ? "🟡 Med"
            : t.priority === "low"
              ? "🟢 Low"
              : "–"
      }</span></div>
      ${(() => {
        const d = _fmtDueDate(t.date, t.time);
        return `<div style="font-size:.72rem;color:${d.color};font-weight:${d.overdue ? "700" : "400"}">${d.label}</div>`;
      })()}
      <button onclick="deleteSHTask(${t.id})"
        style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem">✕</button>
    </div>`,
      )
      .join("")}`;
}

async function generateTaskStructure() {
  const inp = $("sh-structure-input");
  const res = $("sh-structure-result");
  const btn = document.querySelector('[onclick="generateTaskStructure()"]');
  const text = inp?.value.trim();
  if (!text) {
    toast("Describe your task first.");
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Thinking...";
  }
  if (res) res.style.display = "none";
  try {
    const r = await API("/api/chat", {
      sid: S.sid,
      token: getToken() || "",
      message: `Break down this task into clear numbered steps a student can follow. Be concise. Task: "${text}"`,
    });
    if (res) {
      res.innerHTML = renderMarkdown(r.response || r.reply || r.message || "");
      res.style.display = "block";
    }
  } catch {
    toast("Could not generate. Try again.");
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Generate Steps";
  }
}

function createStudyPDF() {
  const title = $("sh-pdf-title")?.value.trim() || "Study Plan";
  const body = $("sh-pdf-content")?.value.trim();
  if (!body) {
    toast("Add some content first.");
    return;
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;color:#1a1a2e;line-height:1.7}
h1{font-size:1.6rem;color:#4f6ef7;border-bottom:2px solid #4f6ef7;padding-bottom:8px}
pre{white-space:pre-wrap;font-family:inherit;font-size:.95rem}
.meta{font-size:.8rem;color:#888;margin-bottom:2rem}</style></head>
<body><h1>${title}</h1><div class="meta">Generated by Sivarr AI · ${new Date().toLocaleDateString()}</div>
<pre>${body}</pre></body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// Close modal on background click
document.addEventListener("click", (e) => {
  const modal = $("sh-modal-bg");
  if (modal && e.target === modal) closeSHModal();
});

