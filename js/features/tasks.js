// Tasks panel — rewritten to drive sivarr_tasks_v1.html (List / Kanban /
// Calendar / Focus / Insights views + Detail sheet + New Task sheet + Invite + WhatsApp).

(function () {
  "use strict";

  // ── Shims ─────────────────────────────────────────────────────────────
  if (typeof window.$ === "undefined") {
    window.$ = (id) => document.getElementById(id);
  }
  if (typeof window.esc === "undefined") {
    const MAP = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    window.esc = (s) =>
      String(s == null ? "" : s).replace(/[&<>"']/g, (c) => MAP[c]);
  }
  if (typeof window.toast === "undefined") {
    window.toast = (msg) => {
      let el = document.getElementById("_tasksToast");
      if (!el) {
        el = document.createElement("div");
        el.id = "_tasksToast";
        el.style.cssText =
          "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
          "background:#111;color:#f5f4f2;border:1px solid #262626;border-radius:10px;" +
          "padding:9px 16px;font-size:12.5px;z-index:999;opacity:0;transition:opacity .2s;" +
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;";
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.style.opacity = "1";
      clearTimeout(el._t);
      el._t = setTimeout(() => (el.style.opacity = "0"), 1800);
    };
  }
  if (typeof window.S === "undefined") window.S = { sid: "guest" };
  if (typeof window.getToken === "undefined") window.getToken = () => null;
  if (typeof window.API === "undefined") {
    window.API = async () => {
      throw new Error("API not available in standalone mode");
    };
  }
  if (typeof window._queueMutation === "undefined") {
    window._queueMutation = () => {};
  }

  // ── Global Search State ──────────────────────────────────────────────
  let SEARCH_QUERY = "";

  // ── Storage ───────────────────────────────────────────────────────────
  const TASKS_KEY = () => `sivarr_sh_${S.sid || "guest"}`;

  function getTasksData() {
    try {
      return JSON.parse(localStorage.getItem(TASKS_KEY()) || '{"tasks":[]}');
    } catch {
      return { tasks: [] };
    }
  }

  function activeTasks(tasks) {
    return (tasks || []).filter((t) => !t.deleted_at);
  }

  function saveTasksData(data) {
    localStorage.setItem(TASKS_KEY(), JSON.stringify(data));
    syncTasksToServer(data.tasks || []);
  }

  // ── Server Sync ──────────────────────────────────────────────────────
  const SYNCED_KEY = () => `sivarr_sh_synced_${S.sid || "guest"}`;

  function getSyncedSnapshot() {
    try {
      return JSON.parse(localStorage.getItem(SYNCED_KEY()) || "{}");
    } catch {
      return {};
    }
  }
  function setSyncedSnapshot(snap) {
    try {
      localStorage.setItem(SYNCED_KEY(), JSON.stringify(snap));
    } catch (_) {}
  }

  const SERVER_FIELD_ALIASES = {
    description: "desc",
    goal_id: "goalId",
    attach_name: "attachName",
  };
  function serverTaskToLocal(t) {
    const out = { ...t };
    for (const [serverKey, localKey] of Object.entries(SERVER_FIELD_ALIASES)) {
      if (serverKey in out) {
        out[localKey] = out[serverKey];
        delete out[serverKey];
      }
    }
    return out;
  }

  function sendMutation(url, body) {
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

  function mergeSpawned(spawned) {
    if (!spawned) return;
    const local = serverTaskToLocal(spawned);
    const data = getTasksData();
    if ((data.tasks || []).some((t) => String(t.id) === String(local.id)))
      return;
    data.tasks.push(local);
    localStorage.setItem(TASKS_KEY(), JSON.stringify(data));
    const snap = getSyncedSnapshot();
    snap[String(local.id)] = JSON.stringify(local);
    setSyncedSnapshot(snap);
    renderAll();
    toast("New recurring task added ↻");
  }

  function syncTasksToServer(tasks) {
    const token = getToken();
    if (!token || !S.sid) return;

    const snap = getSyncedSnapshot();
    const nextSnap = {};

    (tasks || []).forEach((t) => {
      const id = String(t.id);
      const serial = JSON.stringify(t);
      nextSnap[id] = serial;
      if (snap[id] === serial) return;

      if (!(id in snap)) {
        sendMutation("/api/tasks/add", { ...t });
        return;
      }
      let was;
      try {
        was = JSON.parse(snap[id]);
      } catch {
        was = {};
      }
      if (!was.deleted_at && t.deleted_at) {
        sendMutation("/api/tasks/delete", { id: t.id });
      } else if (was.deleted_at && !t.deleted_at) {
        sendMutation("/api/tasks/undelete", { id: t.id });
        sendMutation("/api/tasks/update", { id: t.id, ...t });
      } else {
        sendMutation("/api/tasks/update", { id: t.id, ...t }).then((d) => {
          if (d && d.spawned) mergeSpawned(d.spawned);
        });
      }
    });

    setSyncedSnapshot(nextSnap);
  }

  function pruneExpiredTrash() {
    const data = getTasksData();
    const cutoff = Date.now() - 30 * 86400000;
    const kept = (data.tasks || []).filter((t) => {
      if (!t.deleted_at) return true;
      const ts = Date.parse(t.deleted_at);
      return Number.isNaN(ts) || ts >= cutoff;
    });
    if (kept.length !== (data.tasks || []).length) {
      data.tasks = kept;
      saveTasksData(data);
    }
  }

  // ── Formatting ───────────────────────────────────────────────────────
  const STATUS = {
    todo: { label: "To Do", color: "var(--t3)" },
    inprogress: { label: "In Progress", color: "var(--blue)" },
    blocked: { label: "Blocked", color: "var(--red)" },
    done: { label: "Done", color: "var(--green)" },
  };
  const PRIORITY = {
    low: { label: "Low", color: "var(--green)" },
    medium: { label: "Medium", color: "var(--amber)" },
    high: { label: "High", color: "var(--red)" },
    normal: { label: "Medium", color: "var(--amber)" },
  };
  const REPEATS = {
    none: "Doesn't repeat",
    daily: "Daily",
    weekly: "Weekly",
    custom: "Custom",
  };

  function todayStr() {
    return new Date().toISOString().split("T")[0];
  }
  function weekEndStr() {
    return new Date(Date.now() + 6 * 86400000).toISOString().split("T")[0];
  }

  function dueMeta(date) {
    if (!date) return { label: "", overdue: false, has: false };
    const t = todayStr();
    if (date < t) return { label: "Overdue", overdue: true, has: true };
    if (date === t)
      return { label: "Due today", overdue: false, has: true, today: true };
    const d = new Date(date + "T00:00:00");
    const dayLbl = d.toLocaleDateString(undefined, { weekday: "short" });
    return {
      label:
        date <= weekEndStr()
          ? dayLbl
          : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      overdue: false,
      has: true,
    };
  }

  function priorityFlagHtml(p) {
    if (p === "high")
      return `<i class="ti ti-flag-filled priority-flag high"></i>`;
    if (p === "medium" || p === "normal")
      return `<i class="ti ti-flag-filled priority-flag med"></i>`;
    return "";
  }

  function subtasksOf(allTasks, parentId) {
    return allTasks.filter((t) => String(t.parent_id) === String(parentId));
  }

  // ── Search & Filter Helpers ──────────────────────────────────────────
  function filterBySearch(tasks) {
    if (!SEARCH_QUERY) return tasks;
    const q = SEARCH_QUERY.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.desc && t.desc.toLowerCase().includes(q)),
    );
  }

  window.promptSearch = function () {
    const val = prompt("Search tasks by keyword:", SEARCH_QUERY);
    if (val === null) return;
    SEARCH_QUERY = val.trim();
    renderAll();
    if (SEARCH_QUERY) toast(`Filtering by: "${SEARCH_QUERY}"`);
  };

  // ── CRUD Operations ─────────────────────────────────────────────────
  function addTask(fields) {
    const now = new Date().toISOString();
    const data = getTasksData();
    data.tasks = data.tasks || [];
    const task = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: "",
      status: "todo",
      priority: "medium",
      date: "",
      effort: "",
      repeat: "none",
      desc: "",
      done: false,
      created: now,
      updated: now,
      ...fields,
    };
    task.done = task.status === "done";
    data.tasks.push(task);
    saveTasksData(data);
    return task;
  }

  function updateTaskFields(id, fields) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    Object.assign(task, fields);
    if ("status" in fields) task.done = fields.status === "done";
    task.updated = new Date().toISOString();
    saveTasksData(data);
  }

  function deleteTask(id) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    task.deleted_at = new Date().toISOString();
    saveTasksData(data);
    renderAll();
    toast("Task deleted");
  }

  window.toggleTaskDone = function (id) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    const newStatus = task.status === "done" ? "todo" : "done";
    updateTaskFields(id, { status: newStatus });
    renderAll();
    if (DETAIL_OPEN_ID === id) renderDetailSheet(id);
  };

  window.setTaskStatus = function (id, status) {
    updateTaskFields(id, { status });
    renderAll();
    if (DETAIL_OPEN_ID === id) renderDetailSheet(id);
  };

  window.cycleStatus = function (id) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    const order = ["todo", "inprogress", "blocked", "done"];
    const next = order[(order.indexOf(task.status) + 1) % order.length];
    updateTaskFields(id, { status: next });
    renderAll();
    if (DETAIL_OPEN_ID === id) renderDetailSheet(id);
  };

  window.cyclePriority = function (id) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    const order = ["low", "medium", "high"];
    const cur = task.priority === "normal" ? "medium" : task.priority;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    updateTaskFields(id, { priority: next });
    renderAll();
    if (DETAIL_OPEN_ID === id) renderDetailSheet(id);
  };

  window.cycleRepeat = function (id) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    const order = ["none", "daily", "weekly", "custom"];
    const next =
      order[(order.indexOf(task.repeat || "none") + 1) % order.length];
    updateTaskFields(id, { repeat: next });
    renderAll();
    if (DETAIL_OPEN_ID === id) renderDetailSheet(id);
  };

  window.editDueDate = function (id) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    const val = prompt(
      "Due date (YYYY-MM-DD), leave blank for none:",
      task.date || "",
    );
    if (val === null) return;
    const clean = val.trim();
    if (clean && !/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      toast("Use YYYY-MM-DD format.");
      return;
    }
    updateTaskFields(id, { date: clean });
    renderAll();
    if (DETAIL_OPEN_ID === id) renderDetailSheet(id);
  };

  window.editEffort = function (id) {
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) return;
    const val = prompt("Estimated effort (e.g. 2 hours):", task.effort || "");
    if (val === null) return;
    updateTaskFields(id, { effort: val.trim() });
    renderAll();
    if (DETAIL_OPEN_ID === id) renderDetailSheet(id);
  };

  window.saveDetailField = function (id, field, value) {
    updateTaskFields(id, { [field]: (value || "").trim() });
    renderAll();
  };

  window.addSubtaskPrompt = function (parentId) {
    const title = prompt("Subtask name:", "");
    if (!title || !title.trim()) return;
    const data = getTasksData();
    const parent = (data.tasks || []).find(
      (t) => String(t.id) === String(parentId),
    );
    addTask({
      title: title.trim(),
      status: "todo",
      priority: parent?.priority || "medium",
      parent_id: parentId,
    });
    renderAll();
    if (DETAIL_OPEN_ID === parentId) renderDetailSheet(parentId);
    toast("Subtask added ✓");
  };

  window.toggleSubtaskDone = function (id, parentId) {
    toggleTaskDone(id);
    if (DETAIL_OPEN_ID === parentId) renderDetailSheet(parentId);
  };

  window.deleteSubtask = function (id, parentId) {
    if (!confirm("Delete this subtask?")) return;
    deleteTask(id);
    if (DETAIL_OPEN_ID === parentId) renderDetailSheet(parentId);
  };

  window.deleteTask = deleteTask;

  // ── List View ────────────────────────────────────────────────────────
  function renderListView() {
    const wrap = $("listWrap");
    if (!wrap) return;
    const all = activeTasks(getTasksData().tasks);
    const filtered = filterBySearch(all);
    const topLevel = filtered.filter((t) => !t.parent_id);

    const t = todayStr();
    const wk = weekEndStr();
    const groups = { Today: [], "This week": [], Later: [], Done: [] };
    topLevel.forEach((task) => {
      if (task.status === "done") groups.Done.push(task);
      else if (task.date && task.date < t) groups.Today.push(task);
      else if (task.date === t) groups.Today.push(task);
      else if (task.date && task.date > t && task.date <= wk)
        groups["This week"].push(task);
      else groups.Later.push(task);
    });

    if (!topLevel.length) {
      wrap.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;padding:3rem 1rem;gap:10px;">
        <div style="font-size:2.2rem;">✅</div>
        <div style="font-weight:700;font-size:.95rem;">${SEARCH_QUERY ? "No matching tasks" : "No tasks yet"}</div>
        <div style="font-size:.82rem;color:var(--t3);text-align:center;max-width:300px;line-height:1.5;">${
          SEARCH_QUERY
            ? "Try searching for a different term."
            : "Tap the + button above, or press N, to add your first task."
        }</div>
      </div>`;
      return;
    }

    wrap.innerHTML = Object.entries(groups)
      .filter(([, list]) => list.length)
      .map(([label, list]) => {
        list.sort((a, b) => ((a.date || "9999") < (b.date || "9999") ? -1 : 1));
        return `
      <div class="list-group">
        <div class="list-group-head"><div class="list-group-title">${esc(label)}</div><div class="list-group-count">${list.length}</div></div>
        ${list.map((task) => renderListRow(task, all)).join("")}
      </div>`;
      })
      .join("");
  }

  function renderListRow(task, allTasks) {
    const done = task.status === "done";
    const dm = dueMeta(task.date);
    const subs = subtasksOf(allTasks, task.id);
    const subDone = subs.filter((s) => s.status === "done").length;
    return `
    <div class="task-row" data-id="${task.id}" onclick="openDetail(${task.id})">
      <div class="task-check ${done ? "done" : ""}" onclick="event.stopPropagation();toggleTaskDone(${task.id})">${done ? '<i class="ti ti-check"></i>' : ""}</div>
      <div class="task-body">
        <div class="task-title-row">
          <div class="task-title ${done ? "done" : ""}">${esc(task.title)}</div>
          ${priorityFlagHtml(task.priority)}
        </div>
        <div class="task-meta-row">
          ${dm.has ? `<div class="task-meta-item ${dm.overdue ? "overdue" : ""}"><i class="ti ti-clock"></i>${esc(dm.label)}</div>` : ""}
          ${task.effort ? `<div class="task-meta-item"><i class="ti ti-hourglass"></i>${esc(task.effort)}</div>` : ""}
          ${task.repeat && task.repeat !== "none" ? `<div class="task-meta-item"><i class="ti ti-repeat"></i>${esc(REPEATS[task.repeat] || task.repeat)}</div>` : ""}
          ${subs.length ? `<div class="subtask-progress">${subDone}/${subs.length} subtasks</div>` : ""}
        </div>
      </div>
    </div>`;
  }

  // ── Kanban View ──────────────────────────────────────────────────────
  let KANBAN_DRAG_ID = null;

  function renderKanbanView() {
    const all = activeTasks(getTasksData().tasks);
    const filtered = filterBySearch(all);
    const topLevel = filtered.filter((t) => !t.parent_id);
    Object.keys(STATUS).forEach((status) => {
      const body = $(`kanbanBody-${status}`);
      const count = $(`kanbanCount-${status}`);
      if (!body) return;
      const list = topLevel.filter((t) => (t.status || "todo") === status);
      if (count) count.textContent = list.length;
      body.innerHTML = list.length
        ? list.map((task) => renderKanbanCard(task, all)).join("")
        : `<div style="font-size:.72rem;color:var(--t4);padding:8px 2px;">No tasks</div>`;
    });
  }

  function renderKanbanCard(task, allTasks) {
    const dm = dueMeta(task.date);
    const subs = subtasksOf(allTasks, task.id);
    const subDone = subs.filter((s) => s.status === "done").length;
    const done = task.status === "done";
    return `
    <div class="kanban-card" data-id="${task.id}" draggable="true" ${done ? 'style="opacity:.6;"' : ""}
      onclick="openDetail(${task.id})">
      <div class="kanban-card-title" ${done ? 'style="text-decoration:line-through;"' : ""}>${esc(task.title)}</div>
      <div class="kanban-card-meta">
        ${priorityFlagHtml(task.priority)}
        ${dm.has ? `<div class="task-meta-item ${dm.overdue ? "overdue" : ""}"><i class="ti ti-clock"></i>${esc(dm.label)}</div>` : ""}
        ${subs.length ? `<div class="subtask-progress">${subDone}/${subs.length}</div>` : ""}
      </div>
    </div>`;
  }

  function attachKanbanDropZones() {
    document.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".kanban-card");
      if (!card) return;
      KANBAN_DRAG_ID = Number(card.dataset.id);
      card.style.opacity = ".4";
    });
    document.addEventListener("dragend", (e) => {
      const card = e.target.closest(".kanban-card");
      if (card) card.style.opacity = "";
    });
    document.querySelectorAll(".kanban-col").forEach((col) => {
      const status = col.dataset.status;
      if (!status) return;
      col.addEventListener("dragover", (e) => e.preventDefault());
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        if (KANBAN_DRAG_ID === null) return;
        setTaskStatus(KANBAN_DRAG_ID, status);
        KANBAN_DRAG_ID = null;
      });
    });
  }

  // ── Calendar View Integration ────────────────────────────────────────
  function pxToTimeLabel(px, durationPx) {
    const totalMin = Math.round(((px / 50) * 60) / 30) * 30;
    const startMin = 7 * 60 + totalMin;
    const endMin = startMin + Math.round((durationPx / 50) * 60);
    const fmt = (m) => {
      let h = Math.floor(m / 60),
        mm = m % 60;
      const ap = h >= 12 ? "pm" : "am";
      let h12 = h % 12;
      if (h12 === 0) h12 = 12;
      return h12 + (mm ? ":" + String(mm).padStart(2, "0") : "") + ap;
    };
    return fmt(startMin) + "–" + fmt(endMin);
  }

  function renderCalendarView() {
    const tlDays = $("tlDays");
    if (!tlDays) return;
    const all = activeTasks(getTasksData().tasks).filter((t) => !t.parent_id);

    // Group tasks by scheduled date or bucket
    const unscheduled = all.filter((t) => !t.date && t.status !== "done");

    // Clear out existing dynamic chips
    document
      .querySelectorAll(".tl-unscheduled")
      .forEach((u) => (u.innerHTML = ""));

    // Populate unscheduled container on Monday column for quick scheduling
    const firstUnscheduledContainer = document.querySelector(
      '.tl-day-col[data-day="Wed"] .tl-unscheduled',
    );
    if (firstUnscheduledContainer) {
      unscheduled.forEach((t) => {
        const chip = document.createElement("div");
        chip.className = "tl-chip";
        chip.style.cssText =
          "background: var(--line2); color: var(--t2); margin-bottom: 4px;";
        chip.setAttribute("draggable", "true");
        chip.setAttribute("data-id", t.id);
        chip.textContent = t.title;
        chip.onclick = () => openDetail(t.id);
        chip.addEventListener("dragstart", (e) => {
          window.CALENDAR_DRAG_TASK = t;
        });
        firstUnscheduledContainer.appendChild(chip);
      });
    }
  }

  // ── Focus View ───────────────────────────────────────────────────────
  function pickFocusTask() {
    const all = activeTasks(getTasksData().tasks).filter(
      (t) => !t.parent_id && t.status !== "done",
    );
    if (!all.length) return null;
    const t = todayStr();
    const prScore = { high: 3, medium: 2, normal: 2, low: 1 };
    all.sort((a, b) => {
      const aOver = a.date && a.date < t ? 1 : 0;
      const bOver = b.date && b.date < t ? 1 : 0;
      if (aOver !== bOver) return bOver - aOver;
      const ad = a.date || "9999-99-99";
      const bd = b.date || "9999-99-99";
      if (ad !== bd) return ad < bd ? -1 : 1;
      return (prScore[b.priority] || 2) - (prScore[a.priority] || 2);
    });
    return all;
  }

  function renderFocusView() {
    const queue = pickFocusTask();
    const titleEl = $("focusTaskTitle");
    const subEl = $("focusTaskSub");
    const nextEl = $("focusNextLbl");
    const openBtn = $("focusOpenBtn");
    if (!titleEl) return;

    if (!queue) {
      titleEl.textContent = "You're all caught up";
      if (subEl) subEl.textContent = "No open tasks right now";
      if (nextEl) nextEl.textContent = "";
      if (openBtn) openBtn.onclick = () => openNewTask();
      return;
    }
    const task = queue[0];
    const all = activeTasks(getTasksData().tasks);
    const subs = subtasksOf(all, task.id);
    const subDone = subs.filter((s) => s.status === "done").length;
    const dm = dueMeta(task.date);
    titleEl.textContent = task.title;
    if (subEl) {
      const bits = [];
      if (subs.length) bits.push(`${subDone} of ${subs.length} subtasks done`);
      if (dm.has) bits.push(dm.label);
      subEl.textContent = bits.join(" · ") || "No due date";
    }
    if (nextEl) {
      nextEl.textContent = queue[1] ? `Next up: ${queue[1].title}` : "";
    }
    if (openBtn) openBtn.onclick = () => openDetail(task.id);
  }

  // ── Insights View ────────────────────────────────────────────────────
  window.renderInsightsView = function renderInsightsView() {
    const all = activeTasks(getTasksData().tasks).filter((t) => !t.parent_id);
    const total = all.length;
    const done = all.filter((t) => t.status === "done").length;
    const open = total - done;
    const t = todayStr();
    const overdue = all.filter(
      (t2) => t2.status !== "done" && t2.date && t2.date < t,
    ).length;
    const allWithSubs = activeTasks(getTasksData().tasks);
    const parents = all.filter(
      (task) => subtasksOf(allWithSubs, task.id).length,
    );
    const avgSubs = parents.length
      ? (
          parents.reduce(
            (sum, p) => sum + subtasksOf(allWithSubs, p.id).length,
            0,
          ) / parents.length
        ).toFixed(1)
      : "0";

    const set = (id, val) => {
      const el = $(id);
      if (el) el.textContent = val;
    };
    set(
      "statCompletionRate",
      total ? `${Math.round((done / total) * 100)}%` : "–",
    );
    set("statOpenCount", String(open));
    set("statOverdueCount", String(overdue));
    set("statAvgSubtasks", avgSubs);

    const patterns = $("insightPatterns");
    if (!patterns) return;
    const rows = [];
    if (overdue > 0) {
      rows.push(
        `<div class="insight-row"><i class="ti ti-alert-triangle" style="color:var(--amber);"></i><div class="insight-row-text">You have <b>${overdue} overdue task${overdue !== 1 ? "s" : ""}</b>. Reschedule or tackle them first!</div></div>`,
      );
    }
    if (done > 0 && total > 0) {
      rows.push(
        `<div class="insight-row"><i class="ti ti-trending-up" style="color:var(--green);"></i><div class="insight-row-text">You've completed <b>${done} of ${total}</b> tasks. Great job keeping momemtum.</div></div>`,
      );
    }
    if (parents.length) {
      rows.push(
        `<div class="insight-row"><i class="ti ti-list-check" style="color:var(--blue);"></i><div class="insight-row-text">Tasks with subtasks average <b>${avgSubs} subtasks</b> each.</div></div>`,
      );
    }
    patterns.innerHTML = rows.length
      ? rows.join("")
      : `<div class="insight-row" style="color:var(--t4);font-size:12px;">Complete a few tasks and SIVA will start surfacing patterns here.</div>`;
  };

  // ── Detail Sheet ─────────────────────────────────────────────────────
  let DETAIL_OPEN_ID = null;

  window.openDetail = function (id) {
    if (id === undefined || id === null) return;
    DETAIL_OPEN_ID = id;
    renderDetailSheet(id);
    openSheet("detailSheet", "detailOverlay");
  };

  window.closeDetail = function () {
    DETAIL_OPEN_ID = null;
    closeSheetEls("detailSheet", "detailOverlay");
  };

  function renderDetailSheet(id) {
    const scroll = $("detailScroll");
    if (!scroll) return;
    const data = getTasksData();
    const task = (data.tasks || []).find((t) => String(t.id) === String(id));
    if (!task) {
      scroll.innerHTML = `<div style="padding:20px;color:var(--t3);">Task not found.</div>`;
      return;
    }
    const done = task.status === "done";
    const prKey =
      task.priority === "normal" ? "medium" : task.priority || "medium";
    const pr = PRIORITY[prKey] || PRIORITY.medium;
    const st = STATUS[task.status] || STATUS.todo;
    const dm = dueMeta(task.date);
    const all = activeTasks(data.tasks);
    const subs = subtasksOf(all, task.id);
    const subDone = subs.filter((s) => s.status === "done").length;

    const subsHtml = subs.length
      ? subs
          .map(
            (s) => `
      <div class="subtask-row">
        <div class="subtask-check ${s.status === "done" ? "done" : ""}" onclick="toggleSubtaskDone(${s.id},${task.id})">${s.status === "done" ? '<i class="ti ti-check"></i>' : ""}</div>
        <div class="subtask-name ${s.status === "done" ? "done" : ""}">${esc(s.title)}</div>
        <button onclick="deleteSubtask(${s.id},${task.id})" style="background:none;border:none;color:var(--t4);cursor:pointer;font-size:12px;padding:2px 4px;">✕</button>
      </div>`,
          )
          .join("")
      : "";

    scroll.innerHTML = `
      <div class="detail-title-row">
        <div class="detail-check ${done ? "done" : ""}" onclick="toggleTaskDone(${task.id})">${done ? '<i class="ti ti-check"></i>' : ""}</div>
        <div class="detail-title" contenteditable="true" spellcheck="false"
          onblur="saveDetailField(${task.id},'title',this.innerText)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}">${esc(task.title)}</div>
      </div>
      <div class="detail-tags-row">
        <div class="detail-tag" onclick="cyclePriority(${task.id})" title="Tap to change"><i class="ti ti-flag-filled" style="color:${pr.color};font-size:11px;"></i>${pr.label} priority</div>
        <div class="detail-tag" onclick="editDueDate(${task.id})" title="Tap to change"><i class="ti ti-calendar" style="font-size:11px;"></i>${dm.has ? esc(dm.label) : "Add due date"}</div>
        <div class="detail-tag" onclick="editEffort(${task.id})" title="Tap to change"><i class="ti ti-hourglass" style="font-size:11px;"></i>${task.effort ? esc(task.effort) : "Add effort"}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-lbl">Description</div>
        <div class="detail-desc" contenteditable="true"
          onblur="saveDetailField(${task.id},'desc',this.innerText)"
          style="min-height:1.6em;">${esc(task.desc || "")}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-lbl" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Subtasks${subs.length ? ` · ${subDone} of ${subs.length}` : ""}</span>
        </div>
        ${subsHtml}
        <div class="add-subtask-row" onclick="addSubtaskPrompt(${task.id})"><i class="ti ti-plus" style="font-size:13px;"></i>Add subtask</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-lbl">Collaborators</div>
        <div class="invite-row" onclick="openInvite()">
          <div class="collab-full-av"><i class="ti ti-user-plus"></i></div>
          <div class="collab-full-info"><div class="collab-full-name" style="color:var(--accent);">Invite contributor</div></div>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-lbl">Details</div>
        <div class="detail-meta-grid">
          <div class="detail-meta-cell" onclick="editDueDate(${task.id})" style="cursor:pointer;"><div class="detail-meta-lbl"><i class="ti ti-calendar"></i>Due</div><div class="detail-meta-val">${dm.has ? esc(dm.label) : "None"}</div></div>
          <div class="detail-meta-cell" onclick="editEffort(${task.id})" style="cursor:pointer;"><div class="detail-meta-lbl"><i class="ti ti-hourglass"></i>Effort</div><div class="detail-meta-val">${task.effort ? esc(task.effort) : "–"}</div></div>
          <div class="detail-meta-cell" onclick="cyclePriority(${task.id})" style="cursor:pointer;"><div class="detail-meta-lbl"><i class="ti ti-flag"></i>Priority</div><div class="detail-meta-val">${pr.label}</div></div>
          <div class="detail-meta-cell" onclick="cycleStatus(${task.id})" style="cursor:pointer;"><div class="detail-meta-lbl"><i class="ti ti-progress"></i>Status</div><div class="detail-meta-val">${st.label}</div></div>
          <div class="detail-meta-cell" onclick="cycleRepeat(${task.id})" style="cursor:pointer;"><div class="detail-meta-lbl"><i class="ti ti-repeat"></i>Repeats</div><div class="detail-meta-val">${REPEATS[task.repeat || "none"]}</div></div>
          <div class="detail-meta-cell"><div class="detail-meta-lbl"><i class="ti ti-clock"></i>Updated</div><div class="detail-meta-val" style="color:var(--t3);font-weight:500;">${task.updated ? new Date(task.updated).toLocaleDateString() : "–"}</div></div>
        </div>
      </div>

      <div class="detail-section">
        <button class="cta-ghost block" style="color:var(--red);border-color:#2a0a0a;"
          onclick="if(confirm('Delete this task?')){deleteTask(${task.id});closeDetail();}">
          <i class="ti ti-trash" style="font-size:13px;"></i>Delete task
        </button>
      </div>
    `;
  }

  // ── New Task & AI Breakdown ─────────────────────────────────────────
  let NEW_TASK_PARENT = null;
  let GENERATED_SUBTASKS = [];

  window.openNewTask = function (parentId) {
    NEW_TASK_PARENT = parentId || null;
    GENERATED_SUBTASKS = [];
    if ($("newTaskAiPrompt")) $("newTaskAiPrompt").value = "";
    if ($("newTaskTitle")) $("newTaskTitle").value = "";
    if ($("newTaskDesc")) $("newTaskDesc").value = "";
    if ($("newTaskDate")) $("newTaskDate").value = "";
    if ($("newTaskEffort")) $("newTaskEffort").value = "";
    if ($("newTaskRepeat")) $("newTaskRepeat").value = "none";
    if ($("newTaskStatus")) $("newTaskStatus").value = "todo";
    const list = $("aiGeneratedList");
    if (list) {
      list.style.display = "none";
      list.innerHTML = "";
    }
    document
      .querySelectorAll("#newTaskPriorityRow .priority-pill")
      .forEach((p) => {
        p.classList.toggle("sel", p.dataset.priority === "medium");
      });
    openSheet("newTaskSheet", "newTaskOverlay");
    setTimeout(() => $("newTaskAiPrompt")?.focus(), 100);
  };

  window.closeNewTask = function () {
    closeSheetEls("newTaskSheet", "newTaskOverlay");
    const list = $("aiGeneratedList");
    if (list) list.style.display = "none";
  };

  window.showAiBreakdown = function () {
    const promptEl = $("newTaskAiPrompt");
    const titleEl = $("newTaskTitle");
    const val = promptEl ? promptEl.value.trim() : "";

    if (!val) {
      toast("Enter what you want to do in the AI field!");
      promptEl?.focus();
      return;
    }

    if (titleEl && !titleEl.value.trim()) {
      titleEl.value = val;
    }

    // Dynamic SIVA AI breakdown suggestions simulation
    GENERATED_SUBTASKS = [
      `Initial planning & research for ${val}`,
      `Draft outline & requirements`,
      `Execute primary implementation steps`,
      `Final review & verification`,
    ];

    const list = $("aiGeneratedList");
    if (list) {
      list.style.display = "block";
      list.innerHTML = `
        <div class="ai-generated-head">
          <i class="ti ti-sparkles" style="font-size: 13px"></i>SIVA suggested breakdown:
        </div>
        ${GENERATED_SUBTASKS.map(
          (s) => `
          <div class="subtask-row" style="border:none;padding:4px 0;">
            <i class="ti ti-check" style="color:var(--accent);font-size:12px;"></i>
            <div style="font-size:12px;color:var(--t2);">${esc(s)}</div>
          </div>
        `,
        ).join("")}
      `;
    }
    toast("SIVA breakdown created ✨");
  };

  window.saveNewTaskFromSheet = function () {
    const title = $("newTaskTitle")?.value.trim();
    if (!title) {
      toast("Enter a task name.");
      $("newTaskTitle")?.focus();
      return;
    }
    const selPill = document.querySelector(
      "#newTaskPriorityRow .priority-pill.sel",
    );
    const parentTask = addTask({
      title,
      desc: $("newTaskDesc")?.value.trim() || "",
      date: $("newTaskDate")?.value || "",
      effort: $("newTaskEffort")?.value.trim() || "",
      priority: selPill?.dataset.priority || "medium",
      repeat: $("newTaskRepeat")?.value || "none",
      status: $("newTaskStatus")?.value || "todo",
      parent_id: NEW_TASK_PARENT,
    });

    // Add generated AI subtasks if present
    if (GENERATED_SUBTASKS.length) {
      GENERATED_SUBTASKS.forEach((subTitle) => {
        addTask({
          title: subTitle,
          status: "todo",
          priority: parentTask.priority,
          parent_id: parentTask.id,
        });
      });
    }

    NEW_TASK_PARENT = null;
    GENERATED_SUBTASKS = [];
    closeNewTask();
    renderAll();
    toast("Task added ✓");
    return parentTask.id;
  };

  // ── Render Orchestration ─────────────────────────────────────────────
  function renderAll() {
    renderListView();
    renderKanbanView();
    renderFocusView();
    renderInsightsView();
    renderCalendarView();
  }
  window.renderAll = renderAll;

  // ── Keyboard Shortcuts ────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      document.activeElement?.isContentEditable
    )
      return;
    if (document.querySelector(".sheet.open")) {
      if (e.key === "Escape") {
        document.querySelectorAll(".sheet.open").forEach((s) => {
          const overlay = document.getElementById(
            s.id.replace("Sheet", "Overlay"),
          );
          s.classList.remove("open");
          if (overlay) overlay.classList.remove("show");
        });
      }
      return;
    }
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      openNewTask();
    }
  });

  // ── Initialization ────────────────────────────────────────────────────
  function initTasksApp() {
    pruneExpiredTrash();
    attachKanbanDropZones();
    document
      .querySelectorAll("#newTaskPriorityRow .priority-pill")
      .forEach((p) => {
        p.addEventListener("click", () => {
          document
            .querySelectorAll("#newTaskPriorityRow .priority-pill")
            .forEach((x) => x.classList.remove("sel"));
          p.classList.add("sel");
        });
      });

    // Bind global header search icon button
    const searchIcon = document.querySelector(".app-header .ti-search");
    if (searchIcon) {
      searchIcon.style.cursor = "pointer";
      searchIcon.onclick = window.promptSearch;
    }

    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTasksApp);
  } else {
    initTasksApp();
  }
})();
