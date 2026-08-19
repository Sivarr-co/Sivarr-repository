// Org space panel — extracted from js/app.js. Depends on app.js's shared
// globals (S, API, $, esc, toast, getToken, siModal, nav, getSpaces,
// openSpaceSettings, _recordActivity, focusStart, renderMarkdown, etc.) —
// safe regardless of <script> tag order since every file here loads with
// `defer` and none of the code below calls those globals until a function
// in this file actually runs (well after all deferred scripts have
// executed), only at declaration/registration time. See templates/index.html
// for script load order.
//
// Covers: org create/join/members, tasks/projects/docs kanban+lists, chat
// (SSE + presence + emoji picker), goals/OKRs, founder mode, billing,
// analytics, announcements, Settings-panel org tab, and the "Enable in my
// Org" extension entry point. Backend lives in routes/org.py.
//
// NOT moved here despite living in the same stretch of app.js (checked
// individually, not swept in by line range): switchSpace()/_currentSpace
// (dead code, zero call sites), resendVerificationEmail/cmdRunNamed
// (unrelated features that happened to sit nearby), extShowOnboarding
// (generic marketplace-extension onboarding modal used by every space type,
// not org-specific — it just has one button that calls orgAddExtension by
// name), _svTooltip (unrelated generic sidebar-tooltip IIFE), and the
// autoNew/autoSave/... "automations" block (pure localStorage, no /api/org
// calls at all).

async function _orgAcceptInvite(inviteToken, orgName) {
  const token = getToken() || "";
  if (!token || !inviteToken) return;
  try {
    const r = await API("/api/org/join", { token, invite_token: inviteToken });
    if (r.ok) {
      toast(`You joined ${r.org_name || orgName || "the organization"}!`);
      sessionStorage.setItem("sivarr_post_create", "org");
      setTimeout(() => location.reload(), 900);
    }
  } catch (e) {
    toast(e.message || "Could not join. The invite may be expired.");
  }
}

async function _loadPendingInvites() {
  const token = getToken() || "";
  if (!token) return;
  let invites = [];
  try {
    const r = await fetch(
      `/api/org/invites/pending?token=${encodeURIComponent(token)}`,
    );
    if (r.ok) invites = (await r.json()).invites || [];
  } catch (_) {
    return;
  }
  if (!invites.length) return;
  try {
    const notifs = JSON.parse(localStorage.getItem(NOTIF_KEY()) || "[]");
    let added = false;
    invites.forEach((inv) => {
      const id = "orginv_" + String(inv.token).slice(0, 10);
      if (!notifs.some((n) => n.id === id)) {
        notifs.unshift({
          id,
          type: "orginvite",
          icon: "📨",
          msg: `You've been invited to join ${inv.org_name} as ${inv.role}`,
          read: false,
          ts: Date.now(),
          invite_token: inv.token,
          org_name: inv.org_name,
        });
        added = true;
      }
    });
    if (added) {
      localStorage.setItem(NOTIF_KEY(), JSON.stringify(notifs));
      _renderNotifBadge();
    }
  } catch (_) {}
  const inv = invites[0];
  const ok = await siModal.confirm(
    `You've been invited to join ${inv.org_name} as ${inv.role}.`,
    { title: "Organisation invite", confirmLabel: "Join" },
  );
  if (ok) _orgAcceptInvite(inv.token, inv.org_name);
}

async function orgCreateSpace() {
  const name = await siModal.input(
    "Create Organization Space",
    "e.g. Acme Corp, My Startup",
    "",
    { confirmLabel: "Create Space" },
  );
  if (!name) return;
  const token = getToken() || "";
  try {
    const r = await API("/api/org/create", { token, name });
    if (r.ok) {
      toast(`${r.name} workspace created! Loading…`);
      sessionStorage.setItem("sivarr_post_create", "org");
      setTimeout(() => location.reload(), 900);
    }
  } catch (e) {
    if (e.status === 409) {
      // Org already exists — just open it
      toast("Loading your organization…");
      sessionStorage.setItem("sivarr_post_create", "org");
      setTimeout(() => location.reload(), 600);
      return;
    }
    toast(e.message || "Could not create space");
  }
}

let ORG = null;

let ORG_MEMBERS = [];

let ORG_TASKS = [];

let ORG_PROJECTS = [];

let ORG_DOCS = [];

let ORG_GOALS = [];

let ORG_FOUNDER = {};

const ORG_KANBAN_COLS = ["todo", "inprogress", "review", "done"];

const ORG_COL_LABELS = {
  todo: "To Do",
  inprogress: "In Progress",
  review: "Review",
  done: "Done",
};

async function orgInit() {
  if (!S.sid) return;
  const token = getToken() || "";
  if (!token) return;

  // Inject skeleton into panel immediately so users see shaped placeholders
  // instead of a blank panel while /api/org/get is in flight.
  let _orgSk = $("org-sk");
  if (!_orgSk) {
    _orgSk = document.createElement("div");
    _orgSk.id = "org-sk";
    const panel = $("panel-org");
    if (panel) panel.insertBefore(_orgSk, panel.firstChild);
  }
  _orgSk.innerHTML = _SK.orgPanel();

  const _clearOrgSk = () => {
    if (_orgSk) {
      _orgSk.innerHTML = "";
      _orgSk.style.display = "none";
    }
  };

  try {
    const r = await API("/api/org/get", { token });
    _clearOrgSk();
    if (!r.org) {
      _orgShowSetup();
      return;
    }
    ORG = r.org;
    ORG_MEMBERS = r.members || [];
    ORG_TASKS = r.tasks || [];
    ORG_PROJECTS = r.projects || [];
    ORG_DOCS = r.docs || [];
    ORG_GOALS = r.goals || [];
    ORG_FOUNDER = r.founder || {};
    // Reflect the real organization name in the pinned sidebar Space row.
    spaceRenderSidebar();
    // Go live on org-space entry so announcements + chat arrive on ANY tab,
    // not just while the Chat tab is open.
    _ocEnsureLive();
  } catch (e) {
    _clearOrgSk();
    _orgShowSetup();
    if (e.status !== 404 && e.status !== 401 && e.status !== 403) {
      toast("Could not load organization. Please refresh.");
    }
    return;
  }

  // Hero
  const nameEl = $("os-space-name");
  if (nameEl) nameEl.textContent = ORG.name;
  const mcEl = $("os-member-count");
  if (mcEl) mcEl.textContent = ORG_MEMBERS.length;
  const ocEl = $("os-online-count");
  if (ocEl) ocEl.textContent = 1;
  _orgRenderLogo();

  // Hide setup card, show org content
  const setup = $("org-setup-card");
  if (setup) setup.style.display = "none";
  const content = $("org-main-content");
  if (content)
    content.style.cssText =
      "display:flex;flex-direction:column;flex:1;overflow:hidden;";

  orgRenderOverview();
  orgRenderGoals();
  orgRenderTasks();
  orgRenderProjects();
  orgRenderDocs();
  orgRenderMembers();
  orgRenderInsights();
  orgChatRender();
  founderRender();
  _founderTabVisibility();
  hostMountExtensions({ id: "org", type: "org" });
}

function _orgRenderLogo() {
  const icon = $("os-hero-icon");
  if (!icon || !ORG) return;
  const key = `sivarr_org_logo_${ORG.id}`;
  const saved = localStorage.getItem(key);
  const placeholder = $("os-hero-icon-placeholder");
  const existing = icon.querySelector("img");
  if (saved) {
    if (!existing) {
      const img = document.createElement("img");
      img.src = saved;
      img.alt = ORG.name || "Logo";
      if (placeholder) placeholder.style.display = "none";
      icon.insertBefore(img, icon.firstChild);
    } else {
      existing.src = saved;
      if (placeholder) placeholder.style.display = "none";
    }
  } else {
    if (existing) existing.remove();
    if (placeholder) placeholder.style.display = "";
  }
}

function orgLogoEdit() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file || !ORG) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("Image must be under 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      localStorage.setItem(`sivarr_org_logo_${ORG.id}`, e.target.result);
      _orgRenderLogo();
      toast("Logo updated");
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

function _orgShowSetup() {
  const setup = $("org-setup-card");
  if (setup) setup.style.display = "flex";
  const content = $("org-main-content");
  if (content) content.style.cssText = "display:none;";
}

function _orgMemberName(sid) {
  const m = ORG_MEMBERS.find((x) => x.sid === sid);
  return m ? m.name : sid;
}

async function _orgRefresh() {
  const token = getToken() || "";
  if (!token || !ORG) return;
  try {
    const r = await API("/api/org/get", { token });
    ORG = r.org;
    ORG_MEMBERS = r.members || [];
    ORG_TASKS = r.tasks || [];
    ORG_PROJECTS = r.projects || [];
    ORG_DOCS = r.docs || [];
    ORG_GOALS = r.goals || [];
    ORG_FOUNDER = r.founder || {};
  } catch (e) {
    return;
  }
  orgRenderOverview();
  orgRenderGoals();
  orgRenderTasks();
  orgRenderProjects();
  orgRenderDocs();
  orgRenderMembers();
  orgRenderInsights();
  founderRender();
}

function orgTab(tab, btn) {
  document.querySelectorAll(".os-tab").forEach((b) => b.classList.remove("on"));
  document
    .querySelectorAll(".os-pane")
    .forEach((p) => p.classList.remove("on"));
  const pane = $("os-pane-" + tab);
  if (pane) pane.classList.add("on");
  if (btn) {
    btn.classList.add("on");
  } else {
    const b = $("os-tab-" + tab);
    if (b) b.classList.add("on");
  }
  // SSE stays live across all org tabs (so announcements arrive everywhere);
  // the Chat tab just refreshes its view. Teardown happens on leaving the space.
  if (tab === "chat") {
    orgChatInit();
  } else {
    _ocEnsureLive();
  }
  if (tab === "goals") orgRenderGoals();
  if (tab === "founder") founderRender();
  if (tab === "announce") {
    annLoad();
    const wrap = $("ann-compose-wrap");
    if (wrap) wrap.style.display = _orgIsAdmin() ? "flex" : "none";
  }
  if (tab === "analytics") orgAnalyticsLoad();
  if (tab === "financials") psFinancialsLoad();
}

function orgRenderOverview() {
  const today = new Date().toISOString().slice(0, 10);
  const open = ORG_TASKS.filter((t) => t.status !== "done").length;
  const done = ORG_TASKS.filter((t) => t.status === "done").length;
  const overdue = ORG_TASKS.filter(
    (t) => t.status !== "done" && t.due_date && t.due_date < today,
  ).length;

  const setVal = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  setVal("os-open-tasks", open);
  setVal("os-done-tasks", done);
  setVal("os-proj-count", ORG_PROJECTS.length);
  setVal("os-mem-count", ORG_MEMBERS.length);
  const ovEl = $("os-overdue-lbl");
  if (ovEl) ovEl.textContent = overdue ? `${overdue} overdue` : "";
  if (ovEl) ovEl.style.color = overdue ? "var(--coral)" : "var(--muted)";
  const invEl = $("os-invite-lbl");
  if (invEl)
    invEl.textContent =
      ORG_MEMBERS.length <= 1 ? "Just you, invite your team" : "";
  const gcEl = $("os-goal-count");
  if (gcEl)
    gcEl.textContent = ORG_GOALS.filter((g) => g.status === "active").length;

  // Goals mini
  const gm = $("os-goals-mini");
  if (gm) {
    const active = ORG_GOALS.filter((g) => g.status === "active").slice(0, 3);
    gm.innerHTML = active.length
      ? active
          .map(
            (g) => `
        <div class="os-task-card" onclick="orgTab('goals',null)">
          <div class="os-task-title">${escHtml(g.title)}</div>
          <div class="os-goal-bar-wrap"><div class="os-goal-bar-fill" style="width:${g.progress || 0}%"></div></div>
          <div class="os-task-meta"><span>${g.progress || 0}%</span>${g.due_date ? `<span>${g.due_date}</span>` : ""}</div>
        </div>`,
          )
          .join("")
      : '<div class="os-empty">No active goals. <span class="os-card-link" onclick="orgTab(\'goals\',null)">Add one →</span></div>';
  }

  // Priority tasks
  const pt = $("os-priority-tasks");
  if (pt) {
    const pri = ORG_TASKS.filter(
      (t) => t.status !== "done" && t.priority === "high",
    ).slice(0, 5);
    pt.innerHTML = pri.length
      ? pri
          .map(
            (t) =>
              `<div class="os-task-card" onclick="orgEditTask('${t.id}')"><div class="os-task-title">${escHtml(t.title)}</div><div class="os-task-meta"><span>${escHtml(ORG_COL_LABELS[t.status] || t.status)}</span>${t.due_date ? `<span>${t.due_date}</span>` : ""}</div></div>`,
          )
          .join("")
      : '<div class="os-empty">No high-priority tasks.</div>';
  }

  // Projects mini
  const pp = $("os-proj-progress");
  if (pp) {
    pp.innerHTML = ORG_PROJECTS.length
      ? ORG_PROJECTS.slice(0, 4)
          .map(
            (p) =>
              `<div class="os-task-card"><div class="os-task-tag">${escHtml(p.status || "active")}</div><div class="os-task-title">${escHtml(p.name)}</div></div>`,
          )
          .join("")
      : '<div class="os-empty">No projects yet.</div>';
  }

  // Team mini
  const tm = $("os-team-mini");
  if (tm) {
    tm.innerHTML =
      ORG_MEMBERS.slice(0, 5)
        .map(
          (m) => `
      <div class="os-member-row">
        <div class="os-member-av">${(m.name || "?")[0].toUpperCase()}</div>
        <div class="os-member-info">
          <div class="os-member-name">${escHtml(m.name)}</div>
          <div class="os-member-role">${escHtml(m.role || "Member")}</div>
        </div>
      </div>`,
        )
        .join("") || '<div class="os-empty">No members yet.</div>';
  }

  const af = $("os-activity-feed");
  if (af)
    af.innerHTML =
      '<div class="os-empty">Activity from team chat will appear here.</div>';
}

function orgRenderKanban() {
  const board = $("os-kanban");
  if (!board) return;
  board.innerHTML = ORG_KANBAN_COLS.map((col) => {
    const tasks = ORG_TASKS.filter((t) => t.status === col);
    return `
    <div class="os-col">
      <div class="os-col-head">
        <span class="os-col-title">${ORG_COL_LABELS[col]}</span>
        <span class="os-col-count">${tasks.length}</span>
      </div>
      ${tasks
        .map(
          (t) => `
        <div class="os-task-card" onclick="orgEditTask('${t.id}')">
          ${t.priority === "high" ? '<div class="os-task-tag">High</div>' : ""}
          <div class="os-task-title">${escHtml(t.title)}</div>
          <div class="os-task-meta">
            ${t.assignee_sid ? `<span>${escHtml(_orgMemberName(t.assignee_sid))}</span>` : ""}
            ${t.due_date ? `<span>${t.due_date}</span>` : ""}
          </div>
        </div>`,
        )
        .join("")}
      <button class="os-add-card-btn" onclick="orgAddTaskToCol('${col}')">+ Add task</button>
    </div>`;
  }).join("");
}

let _ORG_TASK_VIEW = "board";

function orgSetTaskView(view, btn) {
  _ORG_TASK_VIEW = view;
  ["os-task-view-board", "os-task-view-list"].forEach((id) =>
    $(id)?.classList.remove("os-tool-active"),
  );
  if (btn) btn.classList.add("os-tool-active");
  const board = $("os-kanban"),
    list = $("os-task-list");
  if (board) board.style.display = view === "board" ? "" : "none";
  if (list) list.style.display = view === "list" ? "block" : "none";
  if (view === "list") orgRenderTaskList();
  else orgRenderKanban();
}

function orgRenderTaskList() {
  const wrap = $("os-task-list");
  if (!wrap) return;
  if (!ORG_TASKS.length) {
    wrap.innerHTML =
      '<div class="os-empty" style="padding:20px 0">No tasks yet. Add one to get started.</div>';
    return;
  }
  wrap.innerHTML = ORG_KANBAN_COLS.map((col) => {
    const tasks = ORG_TASKS.filter((t) => t.status === col);
    if (!tasks.length) return "";
    return `
    <div class="os-list-group">
      <div class="os-list-group-head">${ORG_COL_LABELS[col]} <span class="os-col-count">${tasks.length}</span></div>
      ${tasks
        .map(
          (t) => `
        <div class="os-list-row" onclick="orgEditTask('${t.id}')">
          <span class="os-list-dot os-list-dot-${col}"></span>
          <span class="os-list-title">${escHtml(t.title)}</span>
          ${t.priority === "high" ? '<span class="os-task-tag">High</span>' : ""}
          <span class="os-list-meta">${t.assignee_sid ? escHtml(_orgMemberName(t.assignee_sid)) : ""}</span>
          <span class="os-list-meta">${t.due_date || ""}</span>
        </div>`,
        )
        .join("")}
    </div>`;
  }).join("");
}

function orgRenderTasks() {
  orgRenderKanban();
  if (_ORG_TASK_VIEW === "list") orgRenderTaskList();
}

function orgRenderProjects() {
  const grid = $("os-proj-grid");
  if (!grid) return;
  if (!ORG_PROJECTS.length) {
    grid.innerHTML =
      '<div class="os-empty" style="padding:20px 0">No projects yet. Create your first one.</div>';
    return;
  }
  grid.innerHTML = ORG_PROJECTS.map((p) => {
    const color = p.color || "#0d9488";
    // C2: project progress = done/total from this project's tasks.
    const projTasks = ORG_TASKS.filter((t) => t.project_id === p.id);
    const total = projTasks.length;
    const done = projTasks.filter((t) => t.status === "done").length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `
    <div class="os-proj-card">
      <div class="os-proj-stripe" style="background:${escHtml(color)}"></div>
      <div class="os-proj-name">${escHtml(p.name)}</div>
      ${p.description ? `<div class="os-proj-desc">${escHtml(p.description)}</div>` : ""}
      <div class="os-proj-progress" title="${done} of ${total} tasks done">
        <div class="os-proj-progress-bar" style="width:${pct}%;background:${escHtml(color)}"></div>
      </div>
      <div class="os-proj-meta">
        <span class="os-proj-badge">${escHtml(p.status || "active")}</span>
        <span class="os-proj-tasks-count">${done}/${total} done · ${pct}%</span>
      </div>
    </div>`;
  }).join("");
}

function orgRenderDocs() {
  const grid = $("os-docs-grid");
  if (!grid) return;
  if (!ORG_DOCS.length) {
    grid.innerHTML =
      '<div class="os-empty" style="padding:20px 0">No docs yet. Create one to share with your team.</div>';
    return;
  }
  grid.innerHTML = ORG_DOCS.map(
    (doc) => `
    <div class="os-doc-card" onclick="orgOpenDoc('${doc.id}')">
      <div class="os-doc-icon"><i class="ti ti-file-text"></i></div>
      <div class="os-doc-name">${escHtml(doc.title)}</div>
      <div class="os-doc-meta">${doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : "Just now"}</div>
    </div>`,
  ).join("");
}

function _orgBillingBanner() {
  if (!ORG) return "";
  const isOwner = ORG.member_role === "owner" || ORG.owner_sid === S.sid;
  const used = ORG_MEMBERS.length;
  if (ORG.sub_active) {
    const seats = ORG.seats_paid || used;
    const full = used >= seats;
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg2)">
      <i class="ti ti-users-group" style="color:var(--teal)"></i>
      <span style="font-size:.85rem"><b>${used}/${seats}</b> seats used${full ? ' · <span style="color:var(--coral,#e8614a)">all seats in use</span>' : ""}</span>
      ${isOwner ? `<button class="btn" style="margin-left:auto;font-size:.78rem" onclick="orgBilling('monthly')">Manage seats</button>` : ""}
    </div>`;
  }
  if (isOwner) {
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;border:1px dashed var(--border);border-radius:10px">
      <i class="ti ti-building" style="color:var(--teal)"></i>
      <span style="font-size:.85rem;color:var(--muted)">Put your team on a per-seat Org plan.</span>
      <button class="btn primary" style="margin-left:auto;font-size:.78rem" onclick="orgBilling('monthly')">Set up billing →</button>
    </div>`;
  }
  return "";
}

function orgRenderMembers() {
  const list = $("os-members-list");
  if (!list) return;
  const lbl = $("os-member-label");
  if (lbl)
    lbl.textContent = `${ORG_MEMBERS.length} member${ORG_MEMBERS.length !== 1 ? "s" : ""}`;
  if (!ORG_MEMBERS.length) {
    list.innerHTML =
      _orgBillingBanner() +
      '<div class="os-empty" style="padding:16px 0">No members yet.</div>';
    return;
  }
  list.innerHTML =
    _orgBillingBanner() +
    ORG_MEMBERS.map(
      (m) => `
    <div class="os-member-row">
      <div class="os-member-av">${(m.name || "?")[0].toUpperCase()}</div>
      <div class="os-member-info">
        <div class="os-member-name">${escHtml(m.name)}${m.sid === S.sid ? ' <span style="color:var(--muted);font-size:.75rem">(you)</span>' : ""}</div>
        <div class="os-member-role">${escHtml(m.email || "")}</div>
      </div>
      <span class="os-member-badge">${escHtml(m.role || "member")}</span>
    </div>`,
    ).join("");
}

async function orgBilling(period, seats) {
  period = period === "yearly" ? "yearly" : "monthly";
  let q;
  try {
    q = await API("/api/billing/org/quote", {
      token: getToken(),
      period,
      seats: seats || 0,
    });
  } catch (e) {
    toast(e.message || "Could not load org pricing.");
    return;
  }
  document.getElementById("org-bill-modal")?.remove();
  const n = q.seats || 0;
  const members = q.members || n;
  const maxSeats = q.max_seats || 50;
  const custom = q.custom;
  const priceLine = custom
    ? `<div style="font-size:1.1rem;font-weight:700">Custom pricing</div><div style="font-size:.8rem;color:var(--muted)">51+ seats. Contact sales.</div>`
    : `<div style="font-size:1.6rem;font-weight:800">${esc(q.display_usd)}<span style="font-size:.85rem;color:var(--muted)">/${period === "yearly" ? "yr" : "mo"}</span></div>
       <div style="font-size:.78rem;color:var(--muted)">${esc(q.fx?.display_local || "")} · billed via Paystack${q.discount ? ` · ${q.discount}% volume discount` : ""}</div>`;
  const m = document.createElement("div");
  m.id = "org-bill-modal";
  m.style.cssText =
    "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center";
  m.innerHTML = `
    <div style="background:var(--bg);border-radius:14px;padding:22px;width:min(420px,95vw);position:relative">
      <button onclick="document.getElementById('org-bill-modal').remove()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer">×</button>
      <div style="font-weight:800;font-size:1.05rem;margin-bottom:4px">Organisation plan</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:12px">$${q.per_seat_usd || ""}/seat · ${members} member${members !== 1 ? "s" : ""} currently</div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        <span style="font-size:.85rem;font-weight:600">Seats</span>
        <button class="btn" style="width:36px;font-size:1.1rem" onclick="orgBilling('${period}', ${n - 1})" ${n <= Math.max(members, 1) ? "disabled" : ""}>−</button>
        <b style="font-size:1.15rem;min-width:26px;text-align:center">${n}</b>
        <button class="btn" style="width:36px;font-size:1.1rem" onclick="orgBilling('${period}', ${n + 1})" ${n >= maxSeats ? "disabled" : ""}>+</button>
        <span style="font-size:.72rem;color:var(--muted)">max ${maxSeats}</span>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:14px">
        <button class="btn${period === "monthly" ? " primary" : ""}" style="flex:1;font-size:.8rem" onclick="orgBilling('monthly', ${n})">Monthly</button>
        <button class="btn${period === "yearly" ? " primary" : ""}" style="flex:1;font-size:.8rem" onclick="orgBilling('yearly', ${n})">Yearly · save 20%</button>
      </div>
      <div style="padding:14px;border:1px solid var(--border);border-radius:10px;margin-bottom:16px">${priceLine}</div>
      ${
        custom
          ? `<a class="btn primary" style="width:100%;text-align:center;text-decoration:none" href="mailto:sales@sivarr.com?subject=Enterprise%20plan">Contact sales</a>`
          : `<div style="display:flex;flex-direction:column;gap:8px">
             <button class="btn primary" style="width:100%" onclick="orgBillingSubscribe('${period}', ${n}, 'paystack')">Pay ${esc(q.fx?.display_local || q.display_usd)} for ${n} seat${n !== 1 ? "s" : ""} · Paystack →</button>
             <button class="btn" style="width:100%" onclick="orgBillingSubscribe('${period}', ${n}, 'flutterwave')">Pay with Flutterwave →</button>
           </div>`
      }
      <div style="font-size:.72rem;color:var(--muted);margin-top:10px">Buy seats ahead of inviting. Each member takes one seat. You can add more anytime.</div>
    </div>`;
  m.addEventListener("click", (e) => {
    if (e.target === m) m.remove();
  });
  document.body.appendChild(m);
}

async function orgBillingSubscribe(period, seats, gateway) {
  try {
    const r = await API("/api/billing/org/subscribe", {
      token: getToken(),
      period: period === "yearly" ? "yearly" : "monthly",
      seats: seats || 0,
      gateway: gateway === "flutterwave" ? "flutterwave" : "paystack",
    });
    const url = r.authorization_url || r.payment_url; // Paystack | Flutterwave
    if (url) {
      window.location.href = url;
      return;
    }
    toast("Could not start checkout.");
  } catch (e) {
    toast(e.message || "Could not start checkout.");
  }
}

function orgRenderInsights() {
  const vel = $("os-velocity");
  const otr = $("os-ontime");
  const fhr = $("os-focus-hrs");
  const gac = $("os-goals-active");
  const done = ORG_TASKS.filter((t) => t.status === "done").length;
  if (vel)
    vel.textContent =
      done > 0 ? (done / Math.max(1, Math.ceil(done / 5))).toFixed(1) : "–";
  if (otr)
    otr.textContent =
      done > 0
        ? Math.round((done / Math.max(1, ORG_TASKS.length)) * 100) + "%"
        : "–";
  // No org-wide focus-session tracking exists yet (Focus Mode is
  // per-device/local only) — "0" here is an honest "no data", not a stub.
  if (fhr) fhr.textContent = "0";
  if (gac)
    gac.textContent = String(
      ORG_GOALS.filter((g) => g.status === "active").length,
    );

  const chart = $("os-bar-chart");
  if (chart) {
    // Real per-day completed-task counts for the current week (Mon-Sun),
    // derived from each done task's updated_at — this used to be
    // Math.random(), which re-randomized on every render.
    const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 0=Mon..6=Sun
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - dow);
    const vals = dayLabels.map(() => 0);
    ORG_TASKS.forEach((t) => {
      if (t.status !== "done" || !t.updated_at) return;
      const d = new Date(t.updated_at);
      const diffDays = Math.floor((d - monday) / 86400000);
      if (diffDays >= 0 && diffDays < 7) vals[diffDays]++;
    });
    const max = Math.max(...vals, 1);
    chart.innerHTML = dayLabels
      .map(
        (w, i) => `
      <div class="os-bar-col">
        <div class="os-bar-fill" style="height:${Math.round((vals[i] / max) * 60) + 4}px"></div>
        <div class="os-bar-lbl">${w}</div>
      </div>`,
      )
      .join("");
  }

  const tbm = $("os-tasks-by-member");
  if (tbm) {
    tbm.innerHTML = ORG_MEMBERS.length
      ? ORG_MEMBERS.map((m) => {
          const count = ORG_TASKS.filter(
            (t) => t.assignee_sid === m.sid,
          ).length;
          return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:.82rem">
            <div class="os-member-av" style="width:24px;height:24px;font-size:.7rem">${(m.name || "?")[0].toUpperCase()}</div>
            <span style="flex:1;color:var(--fg)">${escHtml(m.name)}</span>
            <span style="color:var(--muted)">${count}</span>
          </div>`;
        }).join("")
      : '<div class="os-empty">No members yet.</div>';
  }

  const ai = $("os-ai-insights");
  if (ai) {
    if (!done && !ORG_TASKS.length) {
      ai.innerHTML =
        '<div class="os-empty">Start adding tasks to unlock AI insights.</div>';
    } else {
      const rate = ORG_TASKS.length
        ? Math.round((done / ORG_TASKS.length) * 100)
        : 0;
      ai.innerHTML = `<div style="font-size:.84rem;color:var(--fg);line-height:1.6;padding:4px 0">
        Your team has completed <strong>${done}</strong> tasks (${rate}% completion rate).
        ${rate >= 70 ? " Great momentum, keep it up!" : rate >= 40 ? " Solid progress. Focus on clearing the backlog." : " Consider breaking tasks into smaller steps to build momentum."}
      </div>`;
    }
  }
}

function orgRenderGoals() {
  const list = $("os-goals-list");
  if (!list) return;
  if (!ORG_GOALS.length) {
    list.innerHTML =
      '<div class="os-empty" style="padding:40px 0">No goals yet. Create your first OKR to connect your team\'s work to strategy.</div>';
    return;
  }
  const statusColor = {
    active: "var(--teal)",
    achieved: "var(--green)",
    at_risk: "var(--coral)",
    paused: "var(--muted)",
  };
  list.innerHTML = ORG_GOALS.map((g) => {
    const krs = g.key_results || [];
    const pct = g.progress || 0;
    const sc = statusColor[g.status] || "var(--muted)";
    return `
    <div class="os-goal-card">
      <div class="os-goal-head">
        <div class="os-goal-dot" style="background:${sc}"></div>
        <div class="os-goal-title">${escHtml(g.title)}</div>
        <span class="os-goal-badge" style="background:${sc}22;color:${sc}">${escHtml(g.type || "okr")}</span>
        <span class="os-goal-pct">${pct}%</span>
        <button class="os-goal-menu" onclick="orgEditGoal('${g.id}')"><i class="ti ti-pencil"></i></button>
        <button class="os-goal-menu" onclick="orgDeleteGoal('${g.id}')"><i class="ti ti-trash"></i></button>
      </div>
      <div class="os-goal-bar-wrap"><div class="os-goal-bar-fill" style="width:${pct}%"></div></div>
      ${g.description ? `<div class="os-goal-desc">${escHtml(g.description)}</div>` : ""}
      <div class="os-kr-list">
        ${krs
          .map((kr) => {
            const kpct =
              kr.target_value > 0
                ? Math.min(
                    100,
                    Math.round((kr.current_value / kr.target_value) * 100),
                  )
                : 0;
            return `
          <div class="os-kr-row">
            <div class="os-kr-title">${escHtml(kr.title)}</div>
            <div class="os-kr-progress">
              <div class="os-kr-bar"><div class="os-kr-fill" style="width:${kpct}%"></div></div>
              <span class="os-kr-val">${kr.current_value}/${kr.target_value}${escHtml(kr.unit)}</span>
            </div>
            <button class="os-goal-menu" onclick="orgUpdateKR('${kr.id}','${kr.current_value}','${kr.target_value}','${escHtml(kr.unit)}')"><i class="ti ti-edit"></i></button>
          </div>`;
          })
          .join("")}
        <button class="os-kr-add" onclick="orgAddKR('${g.id}')"><i class="ti ti-plus"></i> Add key result</button>
      </div>
    </div>`;
  }).join("");
}

async function orgNewGoal() {
  if (!ORG) return;
  const d = await siModal.form(
    "New Goal",
    [
      {
        id: "title",
        label: "Goal title",
        placeholder: "e.g. Reach 100 paying customers",
        required: true,
      },
      {
        id: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "okr", label: "OKR" },
          { value: "quarterly", label: "Quarterly" },
          { value: "annual", label: "Annual" },
          { value: "company", label: "Company Vision" },
        ],
      },
      { id: "due_date", label: "Target date", type: "date" },
      {
        id: "desc",
        label: "Description",
        placeholder: "What does success look like?",
      },
    ],
    { confirmLabel: "Create Goal" },
  );
  if (!d || !d.title) return;
  const token = getToken() || "";
  try {
    await API("/api/org/goals/create", {
      token,
      title: d.title,
      type: d.type || "okr",
      due_date: d.due_date || null,
      description: d.desc || "",
    });
    await _orgRefresh();
    toast("Goal created");
  } catch (e) {
    toast(e.message || "Could not create goal");
  }
}

async function orgEditGoal(goalId) {
  const g = ORG_GOALS.find((x) => x.id === goalId);
  if (!g) return;
  const d = await siModal.form(
    "Edit Goal",
    [
      { id: "title", label: "Goal title", required: true, default: g.title },
      {
        id: "progress",
        label: "Progress %",
        type: "number",
        default: String(g.progress || 0),
      },
      {
        id: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "achieved", label: "Achieved" },
          { value: "at_risk", label: "At Risk" },
          { value: "paused", label: "Paused" },
        ],
        default: g.status || "active",
      },
      {
        id: "due_date",
        label: "Target date",
        type: "date",
        default: g.due_date || "",
      },
    ],
    { confirmLabel: "Save" },
  );
  if (!d || !d.title) return;
  const token = getToken() || "";
  try {
    await API("/api/org/goals/update", {
      token,
      goal_id: goalId,
      title: d.title,
      progress: parseInt(d.progress) || 0,
      status: d.status,
      due_date: d.due_date || null,
    });
    await _orgRefresh();
    toast("Goal updated");
  } catch (e) {
    toast(e.message || "Could not update goal");
  }
}

async function orgDeleteGoal(goalId) {
  if (
    !(await siModal.confirm("Delete this goal and all its key results?", {
      danger: true,
    }))
  )
    return;
  const token = getToken() || "";
  try {
    await API("/api/org/goals/delete", { token, goal_id: goalId });
    await _orgRefresh();
    toast("Goal deleted");
  } catch (e) {
    toast(e.message || "Could not delete goal");
  }
}

async function orgAddKR(goalId) {
  const d = await siModal.form(
    "Add Key Result",
    [
      {
        id: "title",
        label: "Key result",
        placeholder: "e.g. Sign 50 beta users",
        required: true,
      },
      { id: "target", label: "Target value", type: "number", default: "100" },
      {
        id: "unit",
        label: "Unit",
        placeholder: "%, users, $, etc.",
        default: "%",
      },
    ],
    { confirmLabel: "Add" },
  );
  if (!d || !d.title) return;
  const token = getToken() || "";
  try {
    await API("/api/org/goals/kr/create", {
      token,
      goal_id: goalId,
      title: d.title,
      target_value: parseFloat(d.target) || 100,
      unit: d.unit || "%",
    });
    await _orgRefresh();
    toast("Key result added");
  } catch (e) {
    toast(e.message || "Could not add key result");
  }
}

async function orgUpdateKR(krId, current, target, unit) {
  const d = await siModal.form(
    "Update Key Result",
    [
      {
        id: "current",
        label: `Current value (target: ${target}${unit})`,
        type: "number",
        default: String(current),
      },
    ],
    { confirmLabel: "Update" },
  );
  if (!d) return;
  const token = getToken() || "";
  try {
    await API("/api/org/goals/kr/update", {
      token,
      kr_id: krId,
      current_value: parseFloat(d.current) || 0,
    });
    await _orgRefresh();
    toast("Progress updated");
  } catch (e) {
    toast(e.message || "Could not update");
  }
}

async function orgGetBriefing() {
  if (!ORG) return;
  const btn = $("os-briefing-btn");
  const text = $("os-briefing-text");
  if (btn) {
    btn.textContent = "Generating…";
    btn.disabled = true;
  }
  if (text) text.textContent = "Sivarr is analysing your organisation…";
  const token = getToken() || "";
  try {
    const r = await API("/api/org/ai/briefing", { token });
    if (text) text.textContent = r.briefing || "No briefing generated.";
    if (btn) {
      btn.textContent = "Refresh →";
      btn.disabled = false;
    }
  } catch (e) {
    if (text)
      text.textContent = "Could not generate briefing. Try again shortly.";
    if (btn) {
      btn.textContent = "Generate →";
      btn.disabled = false;
    }
  }
}

function _founderTabVisibility() {
  const tab = $("os-tab-founder");
  if (!tab || !ORG) return;
  const role = ORG.member_role || "";
  // Blueprint Stage 1: Founder tab is owner-only (not all members, not admins).
  tab.style.display = role === "owner" ? "" : "none";
}

function founderRender() {
  const f = ORG_FOUNDER || {};
  const burn = parseFloat(f.burn_rate) || 0;
  const cash = parseFloat(f.cash_balance) || 0;
  const mrr = parseFloat(f.mrr) || 0;
  const raised = parseFloat(f.total_raised) || 0;
  const runway = burn > 0 ? Math.round(cash / burn) : null;

  const fmt = (v) =>
    v >= 1000000
      ? `₦${(v / 1000000).toFixed(1)}M`
      : v >= 1000
        ? `₦${(v / 1000).toFixed(0)}K`
        : `₦${v.toLocaleString()}`;

  const setV = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  setV("fd-burn", fmt(burn));
  setV("fd-runway", runway !== null ? `${runway}` : "–");
  setV("fd-mrr", fmt(mrr));
  setV("fd-raised", fmt(raised));
  setV("fd-stage", f.funding_stage || "pre-seed");

  // Populate inputs
  const s = (id, v) => {
    const el = $(id);
    if (el) el.value = v || "";
  };
  s("fd-inp-stage", f.funding_stage || "pre-seed");
  s("fd-inp-cash", cash || "");
  s("fd-inp-burn", burn || "");
  s("fd-inp-mrr", mrr || "");
  s("fd-inp-raised", raised || "");

  // Milestones
  const ml = $("fd-milestones-list");
  const milestones = Array.isArray(f.milestones) ? f.milestones : [];
  if (ml) {
    ml.innerHTML = milestones.length
      ? milestones
          .map(
            (m, i) => `
        <div class="os-task-card" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" ${m.done ? "checked" : ""} onchange="founderToggleMilestone(${i})" style="accent-color:var(--teal)">
          <span style="flex:1;${m.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${escHtml(m.text)}</span>
          <button class="os-goal-menu" onclick="founderRemoveMilestone(${i})"><i class="ti ti-x"></i></button>
        </div>`,
          )
          .join("")
      : '<div class="os-empty">No milestones yet.</div>';
  }

  // Investors
  const il = $("fd-investors-list");
  const investors = Array.isArray(f.investors) ? f.investors : [];
  if (il) {
    const stages = {
      contacted: "var(--muted)",
      interested: "var(--amber)",
      committed: "var(--teal)",
      passed: "var(--coral)",
    };
    il.innerHTML = investors.length
      ? `<div class="fd-inv-grid">${investors
          .map(
            (inv, i) => `
        <div class="fd-inv-card">
          <div class="fd-inv-av">${(inv.name || "?")[0].toUpperCase()}</div>
          <div style="flex:1">
            <div class="fd-inv-name">${escHtml(inv.name)}</div>
            <div class="fd-inv-firm">${escHtml(inv.firm || "")}</div>
          </div>
          <span class="fd-inv-badge" style="background:${stages[inv.stage] || "var(--muted)"}22;color:${stages[inv.stage] || "var(--muted)"}">${escHtml(inv.stage || "contacted")}</span>
          <button class="os-goal-menu" onclick="founderRemoveInvestor(${i})"><i class="ti ti-x"></i></button>
        </div>`,
          )
          .join("")}</div>`
      : '<div class="os-empty">No investors tracked yet.</div>';
  }
}

async function founderSave() {
  if (!ORG) return;
  const token = getToken() || "";
  const f = ORG_FOUNDER || {};
  try {
    await API("/api/org/founder/save", {
      token,
      funding_stage: $("fd-inp-stage")?.value || "pre-seed",
      cash_balance: parseFloat($("fd-inp-cash")?.value) || 0,
      burn_rate: parseFloat($("fd-inp-burn")?.value) || 0,
      mrr: parseFloat($("fd-inp-mrr")?.value) || 0,
      total_raised: parseFloat($("fd-inp-raised")?.value) || 0,
      arr: (parseFloat($("fd-inp-mrr")?.value) || 0) * 12,
      investors: Array.isArray(f.investors) ? f.investors : [],
      milestones: Array.isArray(f.milestones) ? f.milestones : [],
    });
    await _orgRefresh();
    toast("Founder data saved");
  } catch (e) {
    toast(e.message || "Could not save");
  }
}

async function founderAddMilestone() {
  const text = await siModal.input(
    "New Milestone",
    "e.g. Launch beta, Reach 100 users",
    "",
    { confirmLabel: "Add" },
  );
  if (!text) return;
  const f = ORG_FOUNDER || {};
  const milestones = Array.isArray(f.milestones) ? [...f.milestones] : [];
  milestones.push({ text, done: false });
  const token = getToken() || "";
  try {
    await API("/api/org/founder/save", {
      token,
      ...f,
      milestones,
      arr: (f.mrr || 0) * 12,
    });
    await _orgRefresh();
  } catch (e) {
    toast(e.message || "Could not save");
  }
}

async function founderToggleMilestone(idx) {
  const f = ORG_FOUNDER || {};
  const milestones = Array.isArray(f.milestones) ? [...f.milestones] : [];
  if (milestones[idx]) milestones[idx].done = !milestones[idx].done;
  const token = getToken() || "";
  try {
    await API("/api/org/founder/save", {
      token,
      ...f,
      milestones,
      arr: (f.mrr || 0) * 12,
    });
    await _orgRefresh();
  } catch (e) {
    toast(e.message || "Could not save");
  }
}

async function founderRemoveMilestone(idx) {
  const f = ORG_FOUNDER || {};
  const milestones = (
    Array.isArray(f.milestones) ? [...f.milestones] : []
  ).filter((_, i) => i !== idx);
  const token = getToken() || "";
  try {
    await API("/api/org/founder/save", {
      token,
      ...f,
      milestones,
      arr: (f.mrr || 0) * 12,
    });
    await _orgRefresh();
  } catch (e) {
    toast(e.message || "Could not save");
  }
}

async function founderAddInvestor() {
  const d = await siModal.form(
    "Add Investor",
    [
      {
        id: "name",
        label: "Name",
        placeholder: "e.g. Adeola Bello",
        required: true,
      },
      { id: "firm", label: "Firm", placeholder: "e.g. Ventures Africa" },
      {
        id: "stage",
        label: "Stage",
        type: "select",
        options: [
          { value: "contacted", label: "Contacted" },
          { value: "interested", label: "Interested" },
          { value: "committed", label: "Committed" },
          { value: "passed", label: "Passed" },
        ],
      },
      { id: "note", label: "Note", placeholder: "Any context…" },
    ],
    { confirmLabel: "Add Investor" },
  );
  if (!d || !d.name) return;
  const f = ORG_FOUNDER || {};
  const investors = Array.isArray(f.investors) ? [...f.investors] : [];
  investors.push({
    name: d.name,
    firm: d.firm || "",
    stage: d.stage || "contacted",
    note: d.note || "",
  });
  const token = getToken() || "";
  try {
    await API("/api/org/founder/save", {
      token,
      ...f,
      investors,
      arr: (f.mrr || 0) * 12,
    });
    await _orgRefresh();
  } catch (e) {
    toast(e.message || "Could not save");
  }
}

async function founderRemoveInvestor(idx) {
  const f = ORG_FOUNDER || {};
  const investors = (Array.isArray(f.investors) ? [...f.investors] : []).filter(
    (_, i) => i !== idx,
  );
  const token = getToken() || "";
  try {
    await API("/api/org/founder/save", {
      token,
      ...f,
      investors,
      arr: (f.mrr || 0) * 12,
    });
    await _orgRefresh();
  } catch (e) {
    toast(e.message || "Could not save");
  }
}

async function orgNewTask() {
  if (!ORG) return;
  const title = await siModal.input("New Task", "Task title", "", {
    confirmLabel: "Create Task",
  });
  if (!title) return;
  const token = getToken() || "";
  try {
    await API("/api/org/tasks/create", {
      token,
      title,
      status: "todo",
      priority: "normal",
    });
    await _orgRefresh();
    toast("Task created");
  } catch (e) {
    toast(e.message || "Could not create task");
  }
}

async function orgAddTaskToCol(col) {
  if (!ORG) return;
  const label = ORG_COL_LABELS[col] || col;
  const title = await siModal.input(`Add to "${label}"`, "Task title", "", {
    confirmLabel: "Add Task",
  });
  if (!title) return;
  const token = getToken() || "";
  try {
    await API("/api/org/tasks/create", {
      token,
      title,
      status: col,
      priority: "normal",
    });
    await _orgRefresh();
    orgTab("tasks", null);
    toast("Task added");
  } catch (e) {
    toast(e.message || "Could not add task");
  }
}

async function orgEditTask(taskId) {
  if (!ORG) return;
  const task = ORG_TASKS.find((t) => String(t.id) === String(taskId));
  if (!task) return;
  const d = await siModal.form(
    "Edit Task",
    [
      {
        id: "title",
        label: "Title",
        placeholder: "Task title",
        required: true,
        default: task.title,
      },
      {
        id: "status",
        label: "Status",
        type: "select",
        options: ORG_KANBAN_COLS.map((c) => ({
          value: c,
          label: ORG_COL_LABELS[c],
        })),
        default: task.status,
      },
      {
        id: "priority",
        label: "Priority",
        type: "select",
        options: [
          { value: "normal", label: "Normal" },
          { value: "high", label: "High" },
        ],
        default: task.priority || "normal",
      },
      {
        id: "due_date",
        label: "Due date",
        type: "date",
        default: task.due_date || "",
      },
    ],
    { confirmLabel: "Save" },
  );
  if (!d || !d.title) return;
  const token = getToken() || "";
  try {
    await API("/api/org/tasks/update", {
      token,
      task_id: taskId,
      title: d.title,
      status: d.status,
      priority: d.priority,
      due_date: d.due_date || null,
    });
    await _orgRefresh();
    toast("Task updated");
  } catch (e) {
    toast(e.message || "Could not update task");
  }
}

async function orgNewDoc() {
  if (!ORG) return;
  const title = await siModal.input("New Document", "Document title", "", {
    confirmLabel: "Create",
  });
  if (!title) return;
  const token = getToken() || "";
  try {
    await API("/api/org/docs/save", { token, title, content: "" });
    await _orgRefresh();
    toast("Doc created");
  } catch (e) {
    toast(e.message || "Could not create doc");
  }
}

async function orgOpenDoc(docId) {
  const doc = ORG_DOCS.find((d) => String(d.id) === String(docId));
  if (!doc) return;
  const content = await siModal.form(
    "Edit Document",
    [
      {
        id: "content",
        label: "Content",
        type: "textarea",
        placeholder: "Write here…",
        default: doc.content || "",
      },
    ],
    { confirmLabel: "Save" },
  );
  if (content === null) return;
  const token = getToken() || "";
  try {
    await API("/api/org/docs/save", {
      token,
      doc_id: docId,
      title: doc.title,
      content: content.content || "",
    });
    await _orgRefresh();
    toast("Doc saved");
  } catch (e) {
    toast(e.message || "Could not save doc");
  }
}

async function orgSendInvite() {
  if (!ORG) return;
  const email = $("os-invite-email")?.value.trim();
  if (!email || !email.includes("@")) {
    toast("Enter a valid email address.");
    return;
  }
  const token = getToken() || "";
  try {
    await API("/api/org/invite", { token, email, role: "member" });
    if ($("os-invite-email")) $("os-invite-email").value = "";
    toast(`Invite sent to ${email}`);
  } catch (e) {
    toast(e.message || "Could not send invite");
  }
}

async function orgMoreMenu() {
  if (!ORG) return;
  if (ORG.member_role !== "owner" && ORG.owner_sid !== S.sid) {
    toast("Only the owner can rename this space.");
    return;
  }
  const name = await siModal.input(
    "Rename Space",
    "Space name",
    ORG.name || "",
    { confirmLabel: "Rename" },
  );
  if (!name || name.trim() === ORG.name) return;
  const token = getToken();
  try {
    const r = await API("/api/org/update", { token, name: name.trim() });
    ORG.name = r.name;
    const nameEl = $("os-space-name");
    if (nameEl) nameEl.textContent = r.name;
    toast("Space renamed ✓");
  } catch (e) {
    toast(e.message || "Could not rename space.");
  }
}

async function teamInvite() {
  if (!ORG) {
    toast("You need to be part of an organization first.");
    return;
  }
  const d = await siModal.form(
    "Invite Team Member",
    [
      {
        id: "email",
        label: "Email address",
        type: "text",
        placeholder: "colleague@example.com",
        required: true,
      },
      {
        id: "role",
        label: "Role",
        type: "select",
        options: [
          { value: "member", label: "Member" },
          { value: "manager", label: "Manager" },
          { value: "admin", label: "Admin" },
        ],
      },
    ],
    { confirmLabel: "Send Invite" },
  );
  if (!d || !d.email || !d.email.includes("@")) return;
  const token = getToken() || "";
  try {
    await API("/api/org/invite", {
      token,
      email: d.email,
      role: d.role || "member",
    });
    toast(`Invite sent to ${d.email}`);
  } catch (e) {
    toast(e.message || "Could not send invite");
  }
}

let _OC_CHANNEL = "general";

let _OC_SSE = null;

let _OC_PRESENCE = null;

let _OC_CHANNELS = [];

let _OC_UNREAD = {};

let _OC_ONLINE = new Set();

let _OC_LAST_ID = 0;

const _OC_COLOURS = [
  "#0d9488",
  "#7c3aed",
  "#d97706",
  "#2563eb",
  "#dc2626",
  "#059669",
  "#db2777",
  "#0891b2",
];

function _ocColour(name) {
  let h = 0;
  for (let i = 0; i < (name || "?").length; i++)
    h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return _OC_COLOURS[Math.abs(h) % _OC_COLOURS.length];
}

function orgChatInit() {
  if (!ORG) return;
  _ocLoadChannels();
  _ocEnsureLive();
  orgChatRender();
}

function _ocEnsureLive() {
  if (!ORG) return;
  if (!_OC_SSE || _OC_SSE.readyState === 2) _ocConnectSSE(); // 2 = CLOSED
  if (!_OC_PRESENCE) _ocStartPresence();
}

async function _ocLoadChannels() {
  const token = getToken() || "";
  try {
    const r = await fetch(
      `/api/org/channels?token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) return;
    const data = await r.json();
    _OC_CHANNELS = data.channels || [];
  } catch (_) {
    _OC_CHANNELS = [
      { id: "general", name: "general", desc: "Team-wide announcements" },
      { id: "random", name: "random", desc: "Off-topic conversations" },
    ];
  }
  // apply any locally-saved renames
  const _ocSavedNames = JSON.parse(
    localStorage.getItem(`sivarr_oc_names_${ORG?.id || ""}`) || "{}",
  );
  _OC_CHANNELS.forEach((ch) => {
    if (_ocSavedNames[ch.id]) ch.name = _ocSavedNames[ch.id];
  });
  _ocRenderSidebar();
}

function _ocRenderSidebar() {
  if (!ORG) return;
  const wsName = $("oc-ws-name");
  if (wsName) wsName.textContent = ORG.name || "Workspace";

  const chList = $("oc-channels");
  if (chList) {
    chList.innerHTML = _OC_CHANNELS
      .map(
        (ch) => `
      <div class="oc-ch-item${ch.id === _OC_CHANNEL ? " active" : ""}" onclick="ocSwitchChannel('${ch.id}')">
        <span class="oc-ch-hash">#</span>
        <span style="flex:1" title="Double-click to rename" ondblclick="event.stopPropagation();ocRenameChannel('${ch.id}',this)">${esc(ch.name)}</span>
        ${_OC_UNREAD[ch.id] ? '<div class="oc-ch-unread"></div>' : ""}
      </div>`,
      )
      .join("");
  }

  // DMs: show org members
  const dmList = $("oc-dms");
  if (dmList && ORG.members?.length) {
    dmList.innerHTML = ORG.members
      .filter((m) => m.sid !== S.sid)
      .slice(0, 8)
      .map((m) => {
        const online = _OC_ONLINE.has(m.sid);
        const dmId = _ocDmId(S.sid, m.sid);
        return `<div class="oc-dm-item${_OC_CHANNEL === dmId ? " active" : ""}" onclick="ocSwitchChannel('${dmId}')">
          <div class="oc-dm-av" style="background:${_ocColour(m.name)}">${(m.name || "?")[0].toUpperCase()}</div>
          <span style="flex:1;font-size:.82rem">${esc(m.name)}</span>
          <div class="oc-presence-dot ${online ? "online" : "offline"}"></div>
        </div>`;
      })
      .join("");
  }
}

function _ocDmId(a, b) {
  return "dm_" + [a.slice(0, 8), b.slice(0, 8)].sort().join("_");
}

function ocRenameChannel(chId, el) {
  const ch = _OC_CHANNELS.find((c) => c.id === chId);
  if (!ch) return;
  const oldName = ch.name;
  const inp = document.createElement("input");
  inp.className = "oc-ch-rename";
  inp.value = oldName;
  el.replaceWith(inp);
  inp.focus();
  inp.select();
  const commit = () => {
    const n = inp.value.trim().replace(/\s+/g, "-").toLowerCase() || oldName;
    ch.name = n;
    const key = `sivarr_oc_names_${ORG?.id || ""}`;
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    saved[chId] = n;
    localStorage.setItem(key, JSON.stringify(saved));
    _ocRenderSidebar();
    if (_OC_CHANNEL === chId) {
      const nameEl = $("oc-ch-name");
      const inputEl = $("os-chat-input");
      if (nameEl) nameEl.textContent = n;
      if (inputEl) inputEl.placeholder = `Message #${n}…`;
    }
  };
  inp.onblur = commit;
  inp.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inp.blur();
    }
    if (e.key === "Escape") {
      inp.value = oldName;
      inp.blur();
    }
  };
}

function ocToggleChannels(open) {
  const sb = document.querySelector(".os-pane-chat .oc-sidebar");
  const ov = $("oc-drawer-overlay");
  const show =
    open === undefined ? !(sb && sb.classList.contains("open")) : !!open;
  if (sb) sb.classList.toggle("open", show);
  if (ov) ov.classList.toggle("open", show);
}

function ocSwitchChannel(chId) {
  _OC_CHANNEL = chId;
  delete _OC_UNREAD[chId];
  // On mobile, picking a channel closes the drawer so the messages show.
  if (window.innerWidth <= 720) ocToggleChannels(false);

  // Update header
  const ch = _OC_CHANNELS.find((c) => c.id === chId);
  const nameEl = $("oc-ch-name");
  const descEl = $("oc-ch-desc");
  const inputEl = $("os-chat-input");
  if (nameEl) nameEl.textContent = ch ? ch.name : chId;
  if (descEl)
    descEl.textContent = ch
      ? ch.desc
      : chId.startsWith("dm_")
        ? "Direct message"
        : "";
  if (inputEl) inputEl.placeholder = `Message ${ch ? "#" + ch.name : chId}…`;

  _ocRenderSidebar();
  orgChatRender();
}

function _ocConnectSSE() {
  if (_OC_SSE) {
    _OC_SSE.close();
    _OC_SSE = null;
  }
  const token = getToken() || "";
  if (!token || !ORG) return;

  // P3b: auth via the httpOnly session cookie — token no longer in the URL.
  // (token presence above is just a logged-in guard; cookie carries the auth.)
  _OC_SSE = new EventSource(`/api/org/chat/stream?last_id=${_OC_LAST_ID}`);
  _OC_SSE.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "announcement") {
        // Dedupe by id — the poster already has it from annLoad(); others get it live here
        if (
          _ANN_LIST !== undefined &&
          msg.ann &&
          !_ANN_LIST.some((a) => a.id === msg.ann.id)
        ) {
          _ANN_LIST.unshift(msg.ann);
          annRender();
          const dot = $("sb-inbox-dot");
          if (dot) dot.style.display = "";
        }
        return;
      }
      // Track the cursor so reconnects don't re-deliver old messages
      if (msg.id && msg.id > _OC_LAST_ID) _OC_LAST_ID = msg.id;
      if (msg.channel === _OC_CHANNEL) {
        _ocAppendMsg(msg, true);
      } else {
        _OC_UNREAD[msg.channel] = (_OC_UNREAD[msg.channel] || 0) + 1;
        _ocRenderSidebar();
      }
    } catch (_) {}
  };
  _OC_SSE.onerror = () => {
    // auto-reconnect after 5s, resuming from last known message id
    setTimeout(() => {
      if (ORG && _OC_SSE) _ocConnectSSE();
    }, 5000);
  };
}

function _ocDisconnectSSE() {
  if (_OC_SSE) {
    _OC_SSE.close();
    _OC_SSE = null;
  }
  if (_OC_PRESENCE) {
    clearInterval(_OC_PRESENCE);
    _OC_PRESENCE = null;
  }
}

function _ocStartPresence() {
  const token = getToken() || "";
  const ping = () => {
    if (!ORG || !token) return;
    API("/api/org/presence", { token }).catch(() => {});
    fetch(`/api/org/presence?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        _OC_ONLINE = new Set((d.online || []).map((u) => u.sid));
        _ocRenderPresenceBar(d.online || []);
        _ocRenderSidebar();
      })
      .catch(() => {});
  };
  ping();
  if (_OC_PRESENCE) clearInterval(_OC_PRESENCE);
  _OC_PRESENCE = setInterval(ping, 30000);
}

function _ocRenderPresenceBar(online) {
  const bar = $("oc-presence");
  if (!bar) return;
  if (!online.length) {
    bar.innerHTML = "";
    return;
  }
  bar.innerHTML =
    online
      .slice(0, 5)
      .map(
        (u) => `
    <div class="oc-presence-chip">
      <div class="oc-presence-dot online"></div>
      <span>${esc(u.name.split(" ")[0])}</span>
    </div>`,
      )
      .join("") +
    (online.length > 5
      ? `<span style="font-size:.68rem;color:var(--text4)">+${online.length - 5}</span>`
      : "");
}

let _OC_MSG_CACHE = {};

function _ocRenderMsgs(box, msgs) {
  if (!msgs.length) {
    box.innerHTML = `<div class="oc-chat-empty">No messages in #${esc(_OC_CHANNEL)} yet.<br>Be the first to say something.</div>`;
    return;
  }
  box.innerHTML = "";
  let lastAuthor = null;
  msgs.forEach((m) => {
    box.appendChild(_ocBuildMsg(m, m.author_sid === lastAuthor));
    lastAuthor = m.author_sid;
  });
  box.scrollTop = box.scrollHeight;
}

async function orgChatRender() {
  const box = $("os-chat-messages");
  if (!box || !ORG) return;
  const token = getToken() || "";
  const ch = _OC_CHANNEL;
  // Perceived-perf: paint cached messages instantly, else a loading hint, so the
  // pane is never a frozen blank while the round-trip is in flight.
  if (_OC_MSG_CACHE[ch]) _ocRenderMsgs(box, _OC_MSG_CACHE[ch]);
  else
    box.innerHTML = `<div class="oc-chat-empty" style="opacity:.55">Loading #${esc(ch)}…</div>`;
  try {
    const r = await API("/api/org/messages", { token, channel: ch });
    const msgs = r.messages || [];
    _OC_MSG_CACHE[ch] = msgs;
    if (_OC_CHANNEL !== ch) return; // user switched away while loading
    // Seed the SSE cursor past this history so the live stream only appends NEW messages
    msgs.forEach((m) => {
      if (m.id && m.id > _OC_LAST_ID) _OC_LAST_ID = m.id;
    });
    _ocRenderMsgs(box, msgs);
  } catch (_) {
    if (!_OC_MSG_CACHE[ch])
      box.innerHTML =
        '<div class="oc-chat-empty">Could not load messages.</div>';
  }
}

function _ocBuildMsg(m, continued = false) {
  const el = document.createElement("div");
  el.className = `oc-msg${continued ? " oc-msg-continued" : ""}`;
  const ts = m.created_at
    ? new Date(m.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const col = _ocColour(m.author_name);
  el.innerHTML = `
    <div class="oc-msg-av" style="background:${col}">${(m.author_name || "?")[0].toUpperCase()}</div>
    <div class="oc-msg-body">
      ${
        !continued
          ? `<div class="oc-msg-meta">
        <span class="oc-msg-name">${esc(m.author_name)}</span>
        <span class="oc-msg-time">${ts}</span>
      </div>`
          : ""
      }
      <div class="oc-msg-text">${esc(m.content)}</div>
    </div>`;
  return el;
}

function _ocAppendMsg(m, scroll = true) {
  const box = $("os-chat-messages");
  if (!box) return;
  // Remove empty state
  const empty = box.querySelector(".oc-chat-empty");
  if (empty) empty.remove();
  const lastMsg = box.lastElementChild;
  const lastSid = lastMsg?.querySelector(".oc-msg-name")
    ? null
    : lastMsg?.dataset?.sid;
  const continued = lastMsg?.dataset?.sid === m.author_sid;
  const el = _ocBuildMsg(m, continued);
  el.dataset.sid = m.author_sid;
  box.appendChild(el);
  if (scroll) box.scrollTop = box.scrollHeight;
}

async function orgChatSend() {
  if (!ORG) return;
  const inp = $("os-chat-input");
  const msg = inp ? inp.value.trim() : "";
  if (!msg) return;
  inp.value = "";
  const token = getToken() || "";
  try {
    await API("/api/org/messages/send", {
      token,
      content: msg,
      channel: _OC_CHANNEL,
    });
    // SSE will deliver the message back — no need to re-render
  } catch (e) {
    toast(e.message || "Could not send message");
  }
}

const _OC_EMOJIS = [
  "😀",
  "😂",
  "👍",
  "❤️",
  "🔥",
  "🎉",
  "✅",
  "👀",
  "😅",
  "🙏",
  "💯",
  "🚀",
  "😎",
  "🤔",
  "😬",
  "🥳",
  "💪",
  "🙌",
  "😭",
  "🤣",
  "😊",
  "👏",
  "⚡",
  "🎯",
  "📌",
  "📎",
  "🔧",
  "💡",
  "📝",
  "🎓",
  "🏆",
  "⭐",
];

function ocEmojiToggle() {
  const p = $("oc-emoji-picker");
  if (!p) return;
  if (p.style.display !== "none") {
    p.style.display = "none";
    return;
  }
  if (!p.children.length) {
    p.innerHTML = _OC_EMOJIS
      .map(
        (e) =>
          `<button class="oc-emoji-btn-item" onclick="ocInsertEmoji('${e}')">${e}</button>`,
      )
      .join("");
  }
  p.style.display = "grid";
}

function ocInsertEmoji(em) {
  const inp = $("os-chat-input");
  if (inp) {
    inp.value += em;
    inp.focus();
  }
  const p = $("oc-emoji-picker");
  if (p) p.style.display = "none";
}

document.addEventListener("click", (e) => {
  const p = $("oc-emoji-picker");
  if (
    p &&
    p.style.display !== "none" &&
    !e.target.closest("#oc-emoji-picker") &&
    !e.target.closest("#oc-emoji-btn")
  ) {
    p.style.display = "none";
  }
});

const PROJ_COLORS = [
  "#0d9488",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#2563eb",
  "#059669",
];

async function projectNew() {
  if (!ORG) return;
  const d = await siModal.form(
    "New Project",
    [
      {
        id: "name",
        label: "Project name",
        placeholder: "e.g. Website Redesign",
        required: true,
      },
      {
        id: "desc",
        label: "Description (optional)",
        placeholder: "What is this project about?",
      },
      { id: "color", label: "Color", type: "color", default: "#41076B" },
    ],
    { confirmLabel: "Create Project" },
  );
  if (!d || !d.name) return;
  const token = getToken() || "";
  try {
    await API("/api/org/projects/create", {
      token,
      name: d.name,
      description: d.desc || "",
      color: d.color || "#41076B",
    });
    await _orgRefresh();
    toast("Project created");
  } catch (e) {
    toast(e.message || "Could not create project");
  }
}

let _ANN_LIST = [];

async function annLoad() {
  const token = getToken() || "";
  if (!token) return;
  skShow("ann-feed", _SK.ann, 3);
  try {
    const r = await fetch(
      `/api/org/announcements?token=${encodeURIComponent(token)}`,
    );
    const d = await r.json();
    _ANN_LIST = d.announcements || [];
    annRender();
  } catch (_) {}
}

function annRender() {
  const feed = $("ann-feed");
  if (!feed) return;
  if (!_ANN_LIST.length) {
    feed.innerHTML = `<div class="os-empty" style="padding:40px 0;text-align:center;color:var(--muted)"><i class="ti ti-speakerphone" style="font-size:2rem;display:block;margin-bottom:8px"></i>No announcements yet.</div>`;
    return;
  }
  feed.innerHTML = _ANN_LIST
    .map(
      (a) => `
    <div class="ann-card ${a.pinned ? "pinned" : ""}">
      <div class="ann-card-head">
        ${a.pinned ? '<span class="ann-pin-badge">Pinned</span>' : ""}
        <div class="ann-card-title">${esc(a.title)}</div>
        ${_orgIsAdmin() ? `<button class="ann-del-btn" onclick="annDelete('${esc(a.id)}')"><i class="ti ti-trash"></i></button>` : ""}
      </div>
      <div class="ann-card-body">${esc(a.body)}</div>
      <div class="ann-card-meta">By ${esc(a.author_name)} · ${_fmtTs(a.created_at)}</div>
    </div>`,
    )
    .join("");
}

function _orgIsAdmin() {
  const role =
    typeof ORG !== "undefined" && ORG
      ? ORG_MEMBERS.find((m) => m.sid === S.sid)?.role || ""
      : "";
  return role === "owner" || role === "admin";
}

function _fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString("en-NG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return ts || "";
  }
}

async function annPost() {
  const title = $("ann-title-input")?.value.trim() || "";
  const body = $("ann-body-input")?.value.trim() || "";
  const pinned = $("ann-pin-chk")?.checked || false;
  if (!title) {
    toast("Enter a title.");
    return;
  }
  const token = getToken() || "";
  try {
    await API("/api/org/announce", { token, title, body, pinned });
    $("ann-title-input").value = "";
    $("ann-body-input").value = "";
    if ($("ann-pin-chk")) $("ann-pin-chk").checked = false;
    toast("Announcement posted!");
    annLoad();
  } catch (e) {
    toast(e.message || "Failed to post announcement.");
  }
}

async function annDelete(annId) {
  const ok = await siModal.confirm("Delete this announcement?", {
    danger: true,
  });
  if (!ok) return;
  const token = getToken() || "";
  try {
    await fetch(
      `/api/org/announce/${encodeURIComponent(annId)}?token=${encodeURIComponent(token)}`,
      { method: "DELETE" },
    );
    toast("Deleted.");
    annLoad();
  } catch (e) {
    toast("Delete failed.");
  }
}

async function orgAnalyticsLoad() {
  const token = getToken() || "";
  if (!token) return;
  try {
    const r = await fetch(
      `/api/org/analytics?token=${encodeURIComponent(token)}`,
    );
    const d = await r.json();
    orgAnalyticsRender(d);
  } catch (_) {
    toast("Could not load analytics.");
  }
}

function orgAnalyticsRender(d) {
  const set = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val;
  };
  set("an-members", d.members ?? "–");
  set(
    "an-completion",
    d.completion_rate != null ? d.completion_rate + "%" : "–",
  );
  set("an-tasks-total", d.tasks_total ?? "–");
  set("an-tasks-done", d.tasks_done ?? "–");
  set("an-messages", d.messages ?? "–");
  set("an-docs", d.docs ?? "–");

  // Message trend bar chart
  const chart = $("an-msg-chart");
  if (chart) {
    const trend = d.msg_trend || [];
    if (!trend.length) {
      chart.innerHTML =
        '<div style="color:var(--muted);font-size:.8rem;padding:10px">No message data yet.</div>';
    } else {
      const max = Math.max(...trend.map((t) => t.cnt), 1);
      chart.innerHTML = trend
        .map(
          (t) => `
        <div class="an-bar-col">
          <div class="an-bar-fill" style="height:${Math.round((t.cnt / max) * 85)}px"></div>
          <div class="an-bar-lbl">${(t.day || "").slice(5)}</div>
        </div>`,
        )
        .join("");
    }
  }

  // Status breakdown
  const statusGrid = $("an-status-grid");
  if (statusGrid && d.status_breakdown) {
    const total =
      Object.values(d.status_breakdown).reduce((a, b) => a + b, 0) || 1;
    const statuses = [
      { key: "todo", label: "To Do", cls: "todo" },
      { key: "in_progress", label: "In Progress", cls: "inprog" },
      { key: "done", label: "Done", cls: "done" },
      { key: "blocked", label: "Blocked", cls: "blocked" },
    ];
    statusGrid.innerHTML = statuses
      .map((s) => {
        const cnt = d.status_breakdown[s.key] || 0;
        const pct = Math.round((cnt / total) * 100);
        return `<div class="an-status-row">
        <div class="an-status-label">${s.label}</div>
        <div class="an-status-bar-wrap"><div class="an-status-bar-fill ${s.cls}" style="width:${pct}%"></div></div>
        <div class="an-status-count">${cnt}</div>
      </div>`;
      })
      .join("");
  }
}

let _orgSet = null;

async function orgSettingsInit() {
  const sec = document.getElementById("st-sec-org");
  if (!sec) return;
  let r = null;
  try {
    r = await acadAPI("/api/org/get", {});
  } catch (e) {}
  if (!r || !r.org) {
    sec.style.display = "none";
    return;
  }
  _orgSet = {
    org: r.org,
    members: r.members || [],
    role: r.org.member_role || "member",
    isOwner: r.org.owner_sid === S.sid,
  };
  sec.style.display = "";
  const prof = document.getElementById("st-org-profile");
  if (prof) prof.style.display = _orgSet.isOwner ? "" : "none";
  if (_orgSet.isOwner) {
    const n = document.getElementById("st-org-name");
    if (n) n.value = r.org.name || "";
    const d = document.getElementById("st-org-desc");
    if (d) d.value = r.org.description || "";
  }
  orgSettingsRenderMembers();
  const canInvite = ["owner", "admin", "manager"].includes(_orgSet.role);
  const inv = document.getElementById("st-org-invite");
  if (inv) inv.style.display = canInvite ? "" : "none";
  const canAudit = ["owner", "admin"].includes(_orgSet.role);
  const aw = document.getElementById("st-org-audit-wrap");
  if (aw) aw.style.display = canAudit ? "" : "none";
  if (canAudit) orgSettingsLoadAudit();
}

function orgSettingsRenderMembers() {
  const el = document.getElementById("st-org-members");
  if (!el || !_orgSet) return;
  const mc = document.getElementById("st-org-mcount");
  if (mc) mc.textContent = `(${_orgSet.members.length})`;
  const roles = ["admin", "manager", "member", "guest"];
  el.innerHTML = _orgSet.members
    .map((m) => {
      const msid = m.sid || m.user_sid || "";
      const role = m.role || "member";
      const isOwnerRow = role === "owner";
      const canManage = _orgSet.isOwner && !isOwnerRow;
      const canRemove =
        !isOwnerRow &&
        msid !== S.sid &&
        (_orgSet.role === "owner" ||
          (_orgSet.role === "admin" && role !== "admin" && role !== "manager"));
      const roleCtl = canManage
        ? `<select onchange="orgSettingsSetRole('${msid}',this.value)" style="padding:3px 6px;font-size:.72rem;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text)">${roles.map((rr) => `<option value="${rr}" ${rr === role ? "selected" : ""}>${rr}</option>`).join("")}</select>`
        : `<span style="font-size:.7rem;color:var(--muted);text-transform:capitalize">${esc(role)}</span>`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><div style="flex:1;min-width:0"><div style="font-size:.82rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name || msid.slice(0, 8))}${isOwnerRow ? " 👑" : ""}</div></div>${roleCtl}${canRemove ? `<button onclick="orgSettingsRemove('${msid}','${esc((m.name || "").replace(/'/g, ""))}')" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:.9rem" title="Remove member">✕</button>` : ""}</div>`;
    })
    .join("");
}

async function orgSettingsSaveProfile() {
  const name = (document.getElementById("st-org-name")?.value || "").trim();
  const desc = (document.getElementById("st-org-desc")?.value || "").trim();
  try {
    await acadAPI("/api/org/update", { name, description: desc });
    toast("Organisation updated");
  } catch (e) {
    toast((e && e.message) || "Could not update");
  }
}

async function orgSettingsSetRole(sid, role) {
  try {
    await acadAPI("/api/org/member/role", { sid, role });
    toast("Role updated");
    orgSettingsInit();
  } catch (e) {
    toast((e && e.message) || "Could not change role");
  }
}

async function orgSettingsRemove(sid, name) {
  if (!confirm(`Remove ${name || "this member"} from the organisation?`))
    return;
  try {
    await acadAPI("/api/org/member/remove", { sid });
    toast("Member removed");
    orgSettingsInit();
  } catch (e) {
    toast((e && e.message) || "Could not remove");
  }
}

async function orgSettingsInvite() {
  const email = await siModal.input(
    "Invite member",
    "their email address",
    "",
    { confirmLabel: "Send invite" },
  );
  if (!email) return;
  try {
    await acadAPI("/api/org/invite", { email });
    toast("Invite sent");
  } catch (e) {
    toast((e && e.message) || "Could not invite");
  }
}

async function orgSettingsLoadAudit() {
  const el = document.getElementById("st-org-audit");
  if (!el) return;
  let r = null;
  try {
    r = await acadAPI("/api/org/audit", {});
  } catch (e) {}
  const rows = (r && r.audit) || [];
  el.innerHTML = rows.length
    ? rows
        .slice(0, 20)
        .map(
          (a) =>
            `<div style="font-size:.74rem;color:var(--muted);padding:3px 0"><strong style="color:var(--text)">${esc(a.actor || "")}</strong>: ${esc(a.action || "")} <span style="opacity:.6">· ${esc(
              String(a.ts || "")
                .replace("T", " ")
                .slice(0, 16),
            )}</span></div>`,
        )
        .join("")
    : `<div style="font-size:.76rem;color:var(--muted)">No admin activity yet.</div>`;
}

function orgAddExtension() {
  const sp = (typeof getSpaces === "function"
    ? getSpaces().find((s) => s.id === "org")
    : null) || {
    id: "org",
    name: (typeof ORG === "object" && ORG && ORG.name) || "Organisation",
    type: "org",
  };
  if (typeof openSpaceSettings === "function") {
    openSpaceSettings(sp);
    if (typeof spaceSettingsTab === "function")
      spaceSettingsTab(
        "extensions",
        document.querySelector("#spaceSettingsModal .mkt-modal-tab"),
      );
  } else if (typeof nav === "function") {
    nav("marketplace");
  }
}
