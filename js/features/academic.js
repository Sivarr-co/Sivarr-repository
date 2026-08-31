// Academic space panel — extracted from js/app.js. Depends on app.js's shared
// globals (toast, getSpaceData, setSpaceData, getSpaces, openSpaceSettings,
// hostMountExtensions, API, getToken, siModal, $, esc) — safe regardless of
// <script> tag order since every file here loads with `defer` and none of
// the code below calls those globals until a function in this file actually
// runs (well after all deferred scripts have executed), only at declaration
// time. See templates/index.html for script load order.
//
// Covers: the dual-role (Lecturer + Student) dashboard behind
// "Create Space -> Academic" — courses/students/analytics/assessments/exam
// builder (lecturer side), modules/kanban/citations/study groups/AI
// tutor/pomodoro/flashcards (student side), and the class bridge (publish/
// join, attendance, announcements, live feed, assignments/grading, exams as
// class activities, live sessions + polls). Backend lives in
// routes/academic.py.
//
// acadAPI (a generic authenticated-POST wrapper, misleadingly named — it's
// not academic-specific) stays a plain global despite living in this file:
// js/features/org.js calls it 6 times as ITS fetch helper, and app.js's
// Settings panel calls it twice. Do not scope it privately.
//
// NOT moved here despite living nearby: cspSelectType()/cspCreate() (the
// generic Create-Space-modal handlers, shared across all 3 space types) stay
// in app.js — they call acadSelectRole() by name, which keeps resolving
// correctly once it's defined here instead, same as every other extracted
// file's call sites.

/* ═══════════════════════════════════════════════════════════
   ACADEMIC SPACE v3 — Dual-Role Dashboard (Lecturer + Student)
   Adapted to Sivarr: toast(), /api/chat, per-space blob storage.
   Data persists per-user in the academic space's data blob
   (getSpaceData/setSpaceData → /api/spaces/data/save → Postgres).
═══════════════════════════════════════════════════════════ */
let _adId = null; // current academic space id
let acadRole = "student"; // 'lecturer' | 'student'

const acToast = (m) => {
  try {
    if (typeof toast === "function") toast(m);
  } catch (_) {}
};
function adData() {
  return getSpaceData(_adId || "academic");
}
function adSave(patch) {
  const d = Object.assign({}, getSpaceData(_adId || "academic"), patch);
  setSpaceData(_adId || "academic", d); // debounced sync to Postgres
  return d;
}
async function acadAsk(message, context = "") {
  try {
    const r = await API("/api/chat", {
      sid: (window.S && S.sid) || "",
      token: getToken(),
      message,
      context,
    });
    return (r && (r.reply || r.message || r.content)) || null;
  } catch (e) {
    return null;
  }
}
function acEsc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

// ── Space init (called from openSpace academic branch) ──
function acadInit(space) {
  _adId =
    typeof space === "string"
      ? space
      : (space && space.id) || _adId || "academic";
  const meta =
    space && typeof space === "object"
      ? space
      : getSpaces().find((s) => s.id === _adId) || {};
  const blob = getSpaceData(_adId);
  acadRole = blob.academic_role || meta.academic_role || "student";
  // Persist role into the blob if it was only on the meta object
  if (!blob.academic_role && acadRole) adSave({ academic_role: acadRole });

  const now = new Date();
  const greet =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";
  const username = ((window.S && S.name) || "").split(" ")[0] || "";
  const dateStr = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("acadWelcomeEyebrow", `Academic Space · ${dateStr}`);
  set("acadWelcomeHeadline", `${greet}${username ? ", " + username : ""}.`);
  set("acadSpaceNameLabel", meta.name || "Academic Space");

  const pill = document.getElementById("acadRolePill");
  if (pill)
    pill.classList.remove(
      "acad-role-pill--lecturer",
      "acad-role-pill--student",
    );
  const lDash = document.getElementById("acadLecturerDash");
  const sDash = document.getElementById("acadStudentDash");

  if (acadRole === "lecturer") {
    if (pill) pill.classList.add("acad-role-pill--lecturer");
    set("acadRoleIcon", "📋");
    set("acadRoleName", "Lecturer");
    set("acadWelcomeSub", "Manage your courses, students, and assessments.");
    if (lDash) lDash.style.display = "block";
    if (sDash) sDash.style.display = "none";
    lInit();
  } else {
    if (pill) pill.classList.add("acad-role-pill--student");
    set("acadRoleIcon", "🎓");
    set("acadRoleName", "Student");
    set(
      "acadWelcomeSub",
      "Your study hub: modules, revision, research, and AI tutor.",
    );
    if (lDash) lDash.style.display = "none";
    if (sDash) sDash.style.display = "block";
    sInit();
  }
}
// Topbar "Search this space" -- scoped to student search (the Students tab
// already has its own working filter; this is the one useful "search from
// anywhere" case: finding a student without clicking into that tab first).
// No-ops for a student viewer, who has no Students tab to jump to.
function acSearchSpace(v) {
  if (acadRole !== "lecturer") return;
  lSwitchTab("l-students");
  const inp = document.getElementById("lStudentSearchInput");
  if (inp) inp.value = v; // keep the Students tab's own box in sync
  lFilterStudents(v);
}
/* ════════ LECTURER ════════ */
let lData = {
  courses: [],
  students: [],
  assignments: [],
};

function lInit() {
  const d = adData();
  lData.courses = []; // no longer backed by local fake data -- see the Classes tab
  lData.students = []; // no longer backed by local fake data -- see lLoadRoster
  lData.assignments = d.lAssignments || [];
  lSwitchTab("l-overview");
  lRenderMetrics();
  lRenderOverview();
  _lRenderWelcomeCTAs();
  lRenderClasses(); // populates the Overview "Active Classes" KPI + welcome "Classes" stat too
  if (d.classCode) _lLoadActiveClass(d.classCode);
  hostMountExtensions(window.currentSpace || window.currentAcademicSpace);
}

// Everything scoped to "whichever class is currently being viewed" -- shared
// by lInit() (on space open) and lSwitchClass() (when a lecturer with
// multiple classes picks a different one from the Classes tab).
function _lLoadActiveClass(code) {
  lRenderClassCode(code);
  lLoadRoster();
  lLoadRegister();
  lLoadAnnouncements();
  lLoadLive();
  lLoadPolls();
  lLoadMaterials();
  lLoadSubmissionQueue();
  lLoadActivity();
  lLoadSchedule();
  _lRenderWelcomeCTAs();
}

// Real "what's happened in my class recently" feed -- was a permanently
// empty card before this (nothing ever wrote to it). Deliberately excludes
// grading/polls/live (see routes/academic.py's _acad_log_activity docstring).
async function lLoadActivity() {
  const d = adData();
  const el = document.getElementById("lRecentActivity");
  if (!d.classCode || !el) return;
  try {
    const r = await acadAPI("/api/acad/activity/list", { code: d.classCode });
    const items = (r && r.activity) || [];
    el.innerHTML = items.length
      ? items
          .map(
            (a) =>
              `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(a.text)}</div><div class="acad-priority-sub">${acEsc((a.ts || "").slice(0, 16).replace("T", " "))}</div></div></div>`,
          )
          .join("")
      : `<div class="acad-empty-state"><i class="ti ti-activity" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No recent activity</div></div>`;
  } catch (e) {
    /* offline / not owner */
  }
}

// Real pending-submissions count + list -- reuses the Gradebook endpoint
// (every student x every item, with a per-cell state) rather than adding a
// new backend endpoint just to filter it down to "pending" here.
async function lLoadSubmissionQueue() {
  const d = adData();
  if (!d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/gradebook", { code: d.classCode });
    if (!r || !r.ok) return;
    const items = r.items || [];
    const itemsById = {};
    items.forEach((it) => (itemsById[it.id] = it));
    const pending = [];
    (r.rows || []).forEach((row) => {
      items.forEach((it) => {
        const cell = row.cells[it.id];
        if (cell && cell.state === "pending")
          pending.push({ name: row.name, title: it.title, type: it.type, id: it.id });
      });
    });
    const cEl = document.getElementById("lSubmissionCount");
    if (cEl) cEl.textContent = `${pending.length} pending`;
    const smEl = document.getElementById("lm-submissions");
    if (smEl) smEl.innerHTML = pending.length || "–";
    const qEl = document.getElementById("lSubmissionQueue");
    if (qEl) {
      qEl.innerHTML = pending.length
        ? pending
            .map(
              (p) =>
                `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(p.name)}</div><div class="acad-priority-sub">${acEsc(p.title)} · ${acEsc(p.type)}</div></div><button class="acad-action-btn acad-action-btn--teal" data-onclick="lGoToGrading" data-onclick-arg0="${acEsc(p.type)}" data-onclick-arg1="${acEsc(p.id)}">Grade</button></div>`,
            )
            .join("")
        : `<div class="acad-empty-state"><i class="ti ti-inbox" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No pending submissions</div></div>`;
    }
  } catch (e) {
    /* offline / not owner */
  }
}
function lGoToGrading(type, id) {
  lSwitchTab("l-assessments");
  if (type === "quiz" || type === "exam") {
    lAssessSegment(type === "quiz" ? "quizzes" : "exams");
    if (id) lExamResults(id);
  } else {
    lAssessSegment("grading");
  }
}

// ── Materials: attach a Doc, or upload a real file ──────────────
async function lLoadMaterials() {
  const d = adData();
  const list = document.getElementById("lMaterialsList");
  if (!d.classCode || !list) return;
  try {
    const r = await acadAPI("/api/acad/materials/list", { code: d.classCode });
    const items = (r && r.materials) || [];
    list.innerHTML = items.length
      ? items
          .map((m) => {
            const icon = m.type === "doc" ? "ti-file-text" : "ti-file";
            const meta =
              m.type === "doc"
                ? "Doc"
                : `${(m.filename || "").split(".").pop().toUpperCase()} · ${Math.round((m.size || 0) / 1024)} KB`;
            return `<div class="acad-priority-item"><div class="acad-priority-meta"><i class="ti ${icon}" style="margin-right:6px;color:var(--acad-accent);" aria-hidden="true"></i><div class="acad-priority-title" style="display:inline;">${acEsc(m.title)}</div><div class="acad-priority-sub">${meta} · posted ${acEsc((m.posted_at || "").slice(0, 10))}</div></div><button class="acad-action-btn acad-action-btn--red" data-onclick="lDeleteMaterial" data-onclick-arg0="${acEsc(m.id)}">Delete</button></div>`;
          })
          .join("")
      : `<div class="acad-empty-state"><i class="ti ti-folder" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No materials posted yet.</div></div>`;
  } catch (e) {
    /* offline / not owner */
  }
}
async function lAttachDoc() {
  const d = adData();
  if (!d.classCode) {
    acToast("Publish or select a class first.");
    return;
  }
  let docs = [];
  try {
    // GET, not POST -- /api/docs/restore takes ?token= as a query param.
    const res = await fetch(`/api/docs/restore?token=${encodeURIComponent(getToken())}`);
    if (!res.ok) throw new Error("failed");
    const r = await res.json();
    docs = ((r && r.docs) || []).filter((doc) => !doc.deleted_at);
  } catch (e) {
    acToast("Could not load your docs.");
    return;
  }
  if (!docs.length) {
    acToast("You don't have any docs yet — create one in Docs & Notes first.");
    return;
  }
  const f = await siModal.form("Attach a Doc", [
    {
      id: "doc_id",
      label: "Doc",
      type: "select",
      options: docs.map((doc) => ({ value: doc.id, label: doc.title || "Untitled" })),
    },
  ]);
  if (!f || !f.doc_id) return;
  try {
    await acadAPI("/api/acad/materials/add_doc", { code: d.classCode, doc_id: f.doc_id });
    acToast("Doc attached");
    lLoadMaterials();
    lLoadActivity();
  } catch (e) {
    acToast((e && e.message) || "Could not attach doc");
  }
}
async function lUploadMaterial(inputEl) {
  const d = adData();
  const file = inputEl.files && inputEl.files[0];
  inputEl.value = "";
  if (!file || !d.classCode) return;
  const form = new FormData();
  form.append("token", getToken());
  form.append("code", d.classCode);
  form.append("file", file);
  try {
    const r = await fetch("/api/acad/materials/upload", { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || "Upload failed");
    acToast("File uploaded");
    lLoadMaterials();
    lLoadActivity();
  } catch (e) {
    acToast((e && e.message) || "Upload failed");
  }
}
async function lDeleteMaterial(id) {
  const d = adData();
  if (!d.classCode) return;
  try {
    await acadAPI("/api/acad/materials/delete", { code: d.classCode, id });
    lLoadMaterials();
  } catch (e) {
    acToast((e && e.message) || "Could not delete material");
  }
}
function lRenderMetrics() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = v;
  };
  set("lm-students", lData.students.length || "–");
  // lm-courses (Active Classes) is owned by lRenderClasses() -- it needs a
  // real fetch of /api/acad/class/mine, not the local lData snapshot.
  // lm-submissions is owned by lLoadSubmissionQueue() -- same reason,
  // needs a real gradebook fetch, not the (always-empty) local snapshot.
  const scores = lData.students
    .filter((s) => s.avg_score != null)
    .map((s) => s.avg_score);
  set(
    "lm-score",
    scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) +
          "<span>%</span>"
      : "–<span>%</span>",
  );
}
function lSwitchTab(tabId) {
  document
    .querySelectorAll("#lecturerTabBar .acad-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll("#acadLecturerDash .acad-tab-content")
    .forEach((c) => {
      c.classList.remove("active");
      c.style.display = "none";
    });
  const at = document.querySelector(`#lecturerTabBar [data-tab="${tabId}"]`);
  const ac = document.getElementById(`tab-${tabId}`);
  if (at) at.classList.add("active");
  if (ac) {
    ac.classList.add("active");
    ac.style.display = "block";
  }
  if (tabId === "l-classes") lRenderClasses();
  if (tabId === "l-students") lRenderStudents();
  if (tabId === "l-gradebook") lLoadGradebook();
  if (tabId === "l-analytics") {
    _lPopulateClassFilter();
    lLoadClassStats();
  }
  if (tabId === "l-assessments") {
    lAssessSegment(_lAssessSeg);
    lRenderAssessLists();
  }
}
function lRenderOverview() {
  const sched = document.getElementById("lScheduleList");
  if (sched && lData.courses.length) {
    sched.innerHTML = lData.courses
      .slice(0, 5)
      .map(
        (c) => `
      <div class="acad-schedule-item">
        <div class="acad-schedule-dot" style="background:var(--acad-accent);"></div>
        <div><div class="acad-priority-title">${acEsc(c.name)}</div><div class="acad-priority-sub">${acEsc(c.schedule || "Schedule not set")}</div></div>
      </div>`,
      )
      .join("");
  }
  // Submission count/list are owned by lLoadSubmissionQueue() -- see
  // _lLoadActiveClass() -- lData.submissions was never actually written to
  // by anything, so this used to always read "0 pending".
}
// ── Classes: the real multi-class list (replaces the old fake Courses tab)
// A lecturer space isn't capped at one class -- /api/acad/class/create never
// had a limit, and /api/acad/class/mine already lists every class a lecturer
// owns. "classCode" in the space's data means "whichever class is currently
// being viewed" (every class-scoped call site already reads it fresh), so
// switching classes is just writing a different code into that one field.
let _lClasses = [];
async function lRenderClasses() {
  const grid = document.getElementById("lClassesGrid");
  if (!grid) return;
  let classes = [];
  try {
    const r = await acadAPI("/api/acad/class/mine");
    classes = (r && r.classes) || [];
  } catch (e) {
    grid.innerHTML = `<div class="acad-empty-state"><i class="ti ti-alert-triangle" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>Couldn't load your classes. Try again.</div></div>`;
    return;
  }
  _lClasses = classes;
  const countEl = document.getElementById("lm-courses");
  if (countEl) countEl.textContent = classes.length || "–";
  _lWelcomeClassCount = classes.length;
  _lRenderWelcomeStats();
  const stats = await Promise.all(
    classes.map((c) =>
      acadAPI("/api/acad/class/stats", { code: c.code }).catch(() => null),
    ),
  );
  const activeCode = adData().classCode;
  const cards = classes
    .map((c, i) => {
      const st = stats[i];
      const memberCount = st ? Object.keys(st.students || {}).length : 0;
      const scores = st
        ? Object.values(st.students || {})
            .map((s) => s.avg_score)
            .filter((v) => v != null)
        : [];
      const avg = scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;
      const attends = st
        ? Object.values(st.students || {}).map((s) => s.attendance_pct)
        : [];
      const attendAvg = attends.length
        ? Math.round(attends.reduce((a, b) => a + b, 0) / attends.length)
        : null;
      const isActive = c.code === activeCode;
      return `<div class="acad-course-card${isActive ? " acad-course-card--active" : ""}">
      <div class="acad-course-card-top"><div class="acad-course-name">${acEsc(c.name)}</div>${isActive ? '<span class="acad-tag acad-tag--teal">Active</span>' : ""}</div>
      <div class="acad-course-meta"><span><i class="ti ti-users" aria-hidden="true"></i> ${memberCount} students</span><span>Join code: <strong>${acEsc(c.code)}</strong></span></div>
      <div class="acad-priority-sub" style="margin-top:8px;">${avg != null ? avg + "% avg score" : "No grades yet"} · ${attendAvg != null ? attendAvg + "% attendance" : "No attendance yet"}</div>
      ${isActive ? "" : `<button class="acad-btn-ghost acad-btn-sm" style="margin-top:10px;" data-onclick="lSwitchClass" data-onclick-arg0="${acEsc(c.code)}">View this class</button>`}
    </div>`;
    })
    .join("");
  grid.innerHTML =
    cards +
    `<div class="acad-course-card acad-course-card--add" data-onclick="lCreateNewClass"><i class="ti ti-plus" style="font-size:24px;opacity:.4;" aria-hidden="true"></i><div>New Class</div></div>`;
}
async function lCreateNewClass() {
  const f = await siModal.form("New class", [
    { id: "name", label: "Class name", placeholder: "e.g. Psych 101", required: true },
    { id: "subject", label: "Subject", placeholder: "optional" },
  ]);
  if (!f || !f.name) return;
  try {
    const r = await acadAPI("/api/acad/class/create", {
      name: f.name,
      subject: f.subject || "",
    });
    if (r && r.ok) {
      acToast(`Class created, code ${r.code}`);
      lSwitchClass(r.code);
    }
  } catch (e) {
    acToast((e && e.message) || "Could not create class");
  }
}
function lSwitchClass(code) {
  adSave({ classCode: code });
  _lLoadActiveClass(code);
  lRenderClasses();
  if (document.getElementById("tab-l-students")?.classList.contains("active"))
    lLoadRoster();
  if (document.getElementById("tab-l-gradebook")?.classList.contains("active"))
    lLoadGradebook();
  if (document.getElementById("tab-l-analytics")?.classList.contains("active"))
    lLoadClassStats();
}
function lRenderStudents(filter = "") {
  const tb = document.getElementById("lStudentTableBody");
  if (!tb) return;
  let st = lData.students;
  if (filter)
    st = st.filter((s) =>
      (s.name + (s.email || "")).toLowerCase().includes(filter.toLowerCase()),
    );
  if (!st.length) {
    tb.innerHTML = `<tr><td colspan="6" class="acad-table-empty">No students found.</td></tr>`;
    return;
  }
  tb.innerHTML = st
    .map((s) => {
      const pct = s.attendance ?? 0;
      const bc =
        pct >= 80
          ? "var(--acad-accent)"
          : pct >= 60
            ? "var(--amber3)"
            : "var(--red3)";
      return `<tr>
      <td><div style="font-weight:600;color:var(--text);">${acEsc(s.name)}</div><div style="font-size:10.5px;color:var(--text4);">${acEsc(s.email || "")}</div></td>
      <td><div style="display:flex;align-items:center;gap:6px;"><div class="acad-attend-bar"><div class="acad-attend-fill" style="width:${pct}%;background:${bc};"></div></div><span style="font-size:11px;font-weight:600;color:${bc};">${pct}%</span></div></td>
      <td style="font-size:11px;font-weight:600;color:var(--text);">${s.avg_score != null ? s.avg_score + "%" : "–"}</td>
      <td style="font-size:11px;color:var(--text4);">${acEsc(s.last_active || "–")}</td>
      <td><span class="acad-tag ${pct >= 80 ? "acad-tag--teal" : pct >= 60 ? "acad-tag--orange" : "acad-tag--red"}">${pct >= 80 ? "Active" : pct >= 60 ? "At risk" : "Critical"}</span></td>
      <td><button class="acad-btn-ghost acad-btn-sm" onclick="lViewStudent('${acEsc(s.sid)}')">View</button></td>
    </tr>`;
    })
    .join("");
}
function lFilterStudents(v) {
  lRenderStudents(v);
}
function lRenderAnalytics(statsOverride) {
  // statsOverride lets the class filter "peek" at a different class's
  // analytics without touching _lClassStats (the active class's cache) or
  // adData().classCode -- switching which class is active is a separate,
  // deliberate action via the Classes tab, not a side effect of this filter.
  const stats = statsOverride || _lClassStats;
  const chart = document.getElementById("lDistributionChart");
  if (chart) {
    const buckets = (stats && stats.score_buckets) || [0, 0, 0, 0, 0];
    if (!buckets.some((b) => b > 0)) {
      chart.innerHTML = `<div class="acad-empty-state" style="padding:32px 0"><i class="ti ti-chart-bar" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No score data yet</div></div>`;
    } else {
      const max = Math.max(...buckets, 1);
      const labels = ["0-20%", "21-40%", "41-60%", "61-80%", "81-100%"];
      chart.innerHTML = `<div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding:0 8px;">
        ${buckets
          .map(
            (
              b,
              i,
            ) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div style="font-size:10px;color:var(--text4);">${b}</div>
          <div style="width:100%;background:var(--acad-accent);opacity:${0.4 + 0.6 * (b / max)};border-radius:4px 4px 0 0;height:${Math.max(4, Math.round((b / max) * 90))}px;"></div>
          <div style="font-size:9.5px;color:var(--text4);">${labels[i]}</div></div>`,
          )
          .join("")}
      </div>`;
    }
  }

  const attChart = document.getElementById("lAttendanceChart");
  if (attChart) {
    const weekly = (stats && stats.attendance_weekly) || [];
    if (!weekly.length) {
      attChart.innerHTML = `<div class="acad-empty-state" style="padding:32px 0"><i class="ti ti-calendar-stats" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No attendance data yet</div></div>`;
    } else {
      const max = Math.max(...weekly.map((w) => w.pct), 1);
      attChart.innerHTML = `<div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding:0 8px;">
        ${weekly
          .map((w) => {
            const label = w.week.includes("-W")
              ? "Wk " + parseInt(w.week.split("-W")[1], 10)
              : w.week;
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div style="font-size:10px;color:var(--text4);">${w.pct}%</div>
          <div style="width:100%;background:var(--acad-accent);opacity:${0.4 + 0.6 * (w.pct / max)};border-radius:4px 4px 0 0;height:${Math.max(4, Math.round((w.pct / max) * 90))}px;"></div>
          <div style="font-size:9.5px;color:var(--text4);">${acEsc(label)}</div></div>`;
          })
          .join("")}
      </div>`;
    }
  }

  const arCount = document.getElementById("lAtRiskCount");
  const arList = document.getElementById("lAtRiskList");
  const atRisk = (stats && stats.at_risk) || [];
  if (arCount)
    arCount.textContent = `${atRisk.length} flagged`;
  if (arList) {
    arList.innerHTML = atRisk.length
      ? atRisk
          .map(
            (s) =>
              `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(s.name)}</div><div class="acad-priority-sub">${s.attendance_pct}% attendance${s.missing_items ? " · " + s.missing_items + " missing item" + (s.missing_items > 1 ? "s" : "") : ""}</div></div><span class="acad-tag acad-tag--red">At risk</span></div>`,
          )
          .join("")
      : `<div class="acad-empty-state"><i class="ti ti-shield-check" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No at-risk students identified</div></div>`;
  }
}

// ── Gradebook: every student x every gradable item, one table ──
// Built on /api/acad/gradebook, the per-item sibling of Phase 1's
// /api/acad/class/stats (which only returns an average) -- kept as its own
// cache (_lGradebook) rather than folded into _lClassStats since the two
// endpoints return unrelated shapes.
let _lGradebook = null;
async function lLoadGradebook() {
  const d = adData();
  const head = document.getElementById("lGradebookHead");
  const body = document.getElementById("lGradebookBody");
  if (!d.classCode || !head || !body) return;
  try {
    const r = await acadAPI("/api/acad/gradebook", { code: d.classCode });
    if (!r || !r.ok) return;
    _lGradebook = r;
    const items = r.items || [];
    head.innerHTML =
      `<th>Student</th>` +
      items.map((it) => `<th>${acEsc(it.title)}</th>`).join("") +
      `<th>Final</th>`;
    const rows = r.rows || [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${items.length + 2}" class="acad-table-empty">No students enrolled yet.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map((row) => {
        const cells = items
          .map((it) => {
            const c = row.cells[it.id] || { display: "—", state: "missing" };
            const cls =
              c.state === "graded"
                ? "acad-tag--teal"
                : c.state === "pending"
                  ? "acad-tag--orange"
                  : "acad-tag--red";
            return `<td><span class="acad-tag ${cls}">${acEsc(String(c.display))}</span></td>`;
          })
          .join("");
        const final = row.final_pct != null ? row.final_pct + "%" : "–";
        return `<tr><td>${acEsc(row.name)}</td>${cells}<td style="font-weight:700;">${final}</td></tr>`;
      })
      .join("");
  } catch (e) {
    body.innerHTML = `<tr><td colspan="2" class="acad-table-empty">Couldn't load the gradebook. Try again.</td></tr>`;
  }
}

function lExportGradebookCSV() {
  if (!_lGradebook || !_lGradebook.rows || !_lGradebook.rows.length) {
    acToast("Nothing to export yet.");
    return;
  }
  const items = _lGradebook.items || [];
  const header = ["Student", ...items.map((it) => it.title), "Final %"];
  const lines = [header];
  _lGradebook.rows.forEach((row) => {
    const cells = items.map((it) => {
      const c = row.cells[it.id];
      return c ? String(c.display) : "";
    });
    lines.push([
      row.name,
      ...cells,
      row.final_pct != null ? row.final_pct : "",
    ]);
  });
  const csv = lines
    .map((line) =>
      line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gradebook.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let _lAssessSeg = "quizzes";
function lAssessSegment(seg) {
  _lAssessSeg = seg;
  document
    .querySelectorAll("#lAssessmentView .acad-seg")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`#lAssessmentView [data-seg="${seg}"]`)
    ?.classList.add("active");
  document
    .querySelectorAll("#tab-l-assessments .acad-assess-panel")
    .forEach((p) => (p.style.display = "none"));
  const panel = document.getElementById(`lAssess-${seg}`);
  if (panel) panel.style.display = "block";
  const btn = document.getElementById("lAssessCreateBtn");
  if (btn) {
    btn.textContent =
      seg === "quizzes"
        ? "+ New Quiz"
        : seg === "assignments"
          ? "+ New Assignment"
          : seg === "exams"
            ? "+ New Exam"
            : "";
    btn.style.display = seg === "grading" ? "none" : "block";
  }
  const hasClass = !!adData().classCode;
  if (seg === "assignments" && hasClass) lLoadClassAssignments();
  if (seg === "grading") lLoadGrading();
  if (seg === "exams" || seg === "quizzes") lLoadExams();
}
function lRenderAssessLists() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("lAssignCount", `${lData.assignments.length} assignments`);
  const al = document.getElementById("lAssignList");
  if (al)
    al.innerHTML = lData.assignments.length
      ? lData.assignments
          .map(
            (a) =>
              `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(a.title)}</div><div class="acad-priority-sub">${acEsc(a.course || "–")}${a.due ? " · due " + acEsc(a.due) : ""}</div></div><button class="acad-action-btn acad-action-btn--red" onclick="lDeleteAssess('assign','${a.id}')">Delete</button></div>`,
          )
          .join("")
      : `<div class="acad-empty-state"><i class="ti ti-file-text" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No assignments yet.</div></div>`;
}
function lDeleteAssess(kind, id) {
  lData.assignments = lData.assignments.filter((a) => a.id !== id);
  adSave({ lAssignments: lData.assignments });
  lRenderAssessLists();
}

// ── Exam Builder (Stage 6) ──────────────────────────────────
// Frontend rebuilt on the intact backend: free-text question bank, where each
// student is served `questions_per_student` random questions under a timer.
// Endpoints (v3-native, normal session token): POST /api/acad/exam/list ·
// /create · /delete · assign via POST /api/acad/exam/assign.
let _lExams = [];
let _lQuizzes = [];
async function lLoadExams() {
  try {
    const d = await acadAPI("/api/acad/exam/list");
    const all = d.exams || [];
    lRenderExams(all.filter((e) => e.kind !== "quiz"));
    lRenderQuizzes(all.filter((e) => e.kind === "quiz"));
  } catch (e) {
    const failMsg = `<div class="acad-empty-state"><i class="ti ti-alert-triangle" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>Couldn't load exams. Try again.</div></div>`;
    const el = document.getElementById("lExamList");
    if (el) el.innerHTML = failMsg;
    const ql = document.getElementById("lQuizList");
    if (ql) ql.innerHTML = failMsg;
  }
}
function _lRenderExamBank(items, listId, countId, emptyIcon, emptyMsg, noun) {
  const cEl = document.getElementById(countId);
  if (cEl) cEl.textContent = `${items.length} ${noun}${items.length !== 1 ? "s" : ""}`;
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = items.length
    ? items
        .map(
          (e) =>
            `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(e.title || `Untitled ${noun}`)}</div><div class="acad-priority-sub">${(e.questions || []).length} Qs · ${e.questions_per_student || 0}/student · ${e.duration || 0} min</div></div><div class="acad-priority-actions"><button class="acad-action-btn acad-action-btn--teal" onclick="lAssignExam('${acEsc(e.id)}')">Assign</button><button class="acad-action-btn" onclick="lExamResults('${acEsc(e.id)}')">Results</button><button class="acad-action-btn acad-action-btn--red" onclick="lDeleteExam('${acEsc(e.id)}')">Delete</button></div></div>`,
        )
        .join("")
    : `<div class="acad-empty-state"><i class="ti ${emptyIcon}" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>${emptyMsg}</div></div>`;
}
function lRenderExams(exams) {
  _lExams = exams || [];
  _lRenderExamBank(_lExams, "lExamList", "lExamCount", "ti-file-pencil", "No exams yet. Build your first exam.", "exam");
}
function lRenderQuizzes(quizzes) {
  _lQuizzes = quizzes || [];
  _lRenderExamBank(_lQuizzes, "lQuizList", "lQuizCount", "ti-help", "No quizzes yet. Create your first quiz.", "quiz");
}
async function _lCreateExamOrQuiz(kind) {
  const isQuiz = kind === "quiz";
  const f = await siModal.form(
    isQuiz ? "New quiz" : "New exam",
    [
      {
        id: "title",
        label: isQuiz ? "Quiz title" : "Exam title",
        placeholder: isQuiz ? "e.g. Week 3 Quiz" : "e.g. Mid-Semester Biology",
        required: true,
      },
      {
        id: "duration",
        label: "Duration (minutes)",
        type: "number",
        placeholder: isQuiz ? "15" : "60",
        default: isQuiz ? "15" : "60",
      },
      {
        id: "qps",
        label: "Questions per student",
        type: "number",
        placeholder: isQuiz ? "10" : "30",
        default: isQuiz ? "10" : "30",
      },
      {
        id: "bank",
        label:
          'Question bank, one per line. For multiple-choice: "Question? | option | *correct | option" (mark the right answer with *)',
        type: "textarea",
        placeholder:
          "Explain photosynthesis.\nWhat is 2 + 2? | 3 | *4 | 5\nDefine osmosis.",
      },
    ],
    { confirmLabel: isQuiz ? "Create quiz" : "Create exam" },
  );
  if (!f || !f.title) return;
  const questions = (f.bank || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!questions.length) {
    acToast("Add at least one question to the bank");
    return;
  }
  try {
    await acadAPI("/api/acad/exam/create", {
      title: f.title,
      questions,
      kind,
      questions_per_student: parseInt(f.qps) || (isQuiz ? 10 : 30),
      duration: parseInt(f.duration) || (isQuiz ? 15 : 60),
      lecturer: (window.S && S.name) || "",
    });
    acToast(isQuiz ? "Quiz created" : "Exam created");
    lLoadExams();
  } catch (e) {
    acToast((e && e.message) || `Could not create ${isQuiz ? "quiz" : "exam"}`);
  }
}
async function lCreateExam() {
  return _lCreateExamOrQuiz("exam");
}
async function lCreateQuiz() {
  return _lCreateExamOrQuiz("quiz");
}
async function lDeleteExam(examId) {
  const ok = await siModal.confirm("Delete this exam? This cannot be undone.", {
    title: "Delete exam",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await acadAPI("/api/acad/exam/delete", { exam_id: examId });
    acToast("Exam deleted");
    lLoadExams();
  } catch (e) {
    acToast("Could not delete exam");
  }
}
async function lAssignExam(examId) {
  const code = adData().classCode;
  if (!code) {
    acToast("Publish a class first (Overview → Publish class)");
    return;
  }
  try {
    await acadAPI("/api/acad/exam/assign", { code, exam_id: examId });
    acToast("Exam assigned to class " + code);
    lLoadActivity();
  } catch (e) {
    acToast((e && e.message) || "Could not assign exam");
  }
}
async function lExamResults(examId) {
  const code = adData().classCode;
  if (!code) {
    acToast("Publish a class first to see results");
    return;
  }
  let r;
  try {
    r = await acadAPI("/api/acad/exam/results", { code, exam_id: examId });
  } catch (e) {
    acToast((e && e.message) || "Could not load results");
    return;
  }
  const results = (r && r.results) || [];
  const ex = (_lExams || []).concat(_lQuizzes || []).find((e) => e.id === examId) || {};
  const exKindTag = ex.kind === "quiz" ? ' <span class="acad-tag acad-tag--orange">Quiz</span>' : "";
  sExamCloseTaker();
  const rowsHtml = results.length
    ? results
        .map(
          (s) => `
    <div class="sx-q">
      <div class="sx-qn">${acEsc(s.name || "Student")} ${s.auto && s.auto.mcq_total ? '<span class="sx-qtag">auto ' + s.auto.auto_pct + "% · " + s.auto.mcq_correct + "/" + s.auto.mcq_total + "</span>" : ""} ${s.graded ? "· <strong>" + acEsc(s.grade) + "</strong>" : ""}</div>
      <div class="sx-answers">${(s.answers || []).map((a) => `<div class="sx-ar"><div class="sx-arq">${acEsc(a.q)}</div><div class="sx-ara ${a.correct === true ? "sx-ok" : a.correct === false ? "sx-bad" : ""}">${acEsc(a.a) || "–"} ${a.correct === true ? "✓" : a.correct === false ? "✗" : ""}</div></div>`).join("") || '<div class="acad-priority-sub">No answers.</div>'}</div>
      <div class="sx-grade-row"><input class="acad-search-inline" style="width:90px" id="lxg-${acEsc(s.sid)}" placeholder="Grade" value="${acEsc(s.grade || "")}"><button class="acad-action-btn acad-action-btn--teal" onclick="lSaveExamGrade('${acEsc(code)}','${acEsc(examId)}','${acEsc(s.sid)}')">Save grade</button></div>
    </div>`,
        )
        .join("")
    : '<div class="acad-priority-sub">No submissions yet.</div>';
  const ov = document.createElement("div");
  ov.className = "sx-overlay";
  ov.id = "sxOverlay";
  ov.innerHTML = `<div class="sx-modal"><div class="sx-head"><div class="sx-title">${acEsc(ex.title || "Exam")}${exKindTag}: results (${results.length})</div><button class="sx-x" onclick="sExamCloseTaker()" aria-label="Close">✕</button></div><div class="sx-body">${rowsHtml}</div><div class="sx-foot"><button class="acad-action-btn acad-action-btn--teal" onclick="sExamCloseTaker()">Close</button></div></div>`;
  document.body.appendChild(ov);
}
async function lSaveExamGrade(code, examId, sid) {
  const inp = document.getElementById(`lxg-${sid}`);
  const grade = inp ? inp.value.trim() : "";
  try {
    await acadAPI("/api/acad/exam/grade", {
      code,
      exam_id: examId,
      sid,
      grade,
    });
    acToast("Grade saved, student notified");
    lExamResults(examId);
    lLoadGradebook();
    lLoadSubmissionQueue();
  } catch (e) {
    acToast((e && e.message) || "Could not save grade");
  }
}
async function lCallAI(resultId, prompt, btn, resetLabel) {
  const el = document.getElementById(resultId);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<i class="ti ti-loader" aria-hidden="true"></i> Generating…';
  }
  const text = await acadAsk(prompt, "academic_lecturer");
  if (el) {
    el.innerHTML = text
      ? `<div class="acad-ai-result-header"><div class="acad-ai-dot"></div><span class="acad-ai-result-title">SIVARR AI</span></div><div class="acad-ai-section"><div class="acad-ai-section-text">${acEsc(text).replace(/\n/g, "<br>")}</div></div>`
      : `<div class="acad-ai-section acad-ai-section-text" style="color:var(--text4);">Could not reach SIVARR AI.</div>`;
    el.style.display = "block";
  }
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i class="ti ti-bolt" aria-hidden="true"></i> ${resetLabel}`;
  }
}
function lGenerateLessonPlan() {
  const t = document.getElementById("lLessonTopic")?.value?.trim();
  if (!t) return;
  lCallAI(
    "lLessonPlanResult",
    `You are SIVARR AI, an academic assistant for lecturers. Generate a detailed lesson plan for: "${t}". Include learning objectives (3-5), an intro hook, main content sections with timings, active-learning activities, an assessment check, and a wrap-up. Use clear headers.`,
    document.querySelector('[onclick="lGenerateLessonPlan()"]'),
    "Generate Lesson Plan",
  );
}
function lGenerateQuizQuestions() {
  const t = document.getElementById("lQuizTopic")?.value?.trim();
  if (!t) return;
  lCallAI(
    "lQuizQuestionsResult",
    `You are SIVARR AI. Generate quiz questions for: "${t}". For each, give the question, options (if MCQ), and the correct answer with a short explanation.`,
    document.querySelector('[onclick="lGenerateQuizQuestions()"]'),
    "Generate Questions",
  );
}
function lGenerateFeedback() {
  const sub = document.getElementById("lFeedbackInput")?.value?.trim();
  const rub = document.getElementById("lRubricInput")?.value?.trim();
  if (!sub) return;
  lCallAI(
    "lFeedbackResult",
    `You are SIVARR AI. Generate personalised, constructive feedback for this student submission${rub ? " against the provided rubric" : ""}. Submission: "${sub}"${rub ? '. Rubric: "' + rub + '"' : ""}. Include strengths, areas to improve, specific actionable suggestions, and a suggested grade range.`,
    document.querySelector('[onclick="lGenerateFeedback()"]'),
    "Generate Feedback",
  );
}
async function lAutoMark() {
  const btn = document.querySelector('[data-onclick="lAutoMark"]');
  const resultEl = document.getElementById("lAutoMarkResult");
  const rubric = document.getElementById("lAutoMarkRubric")?.value?.trim() || "";
  const show = (html) => {
    if (resultEl) {
      resultEl.style.display = "block";
      resultEl.innerHTML = html;
    }
  };
  if (!_lPendingSubs.length) {
    show('<div class="acad-priority-sub">No pending submissions to grade right now.</div>');
    return;
  }
  const total = _lPendingSubs.length;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader" aria-hidden="true"></i> Analyzing…';
  }
  let done = 0,
    flagged = 0;
  for (let i = 0; i < total; i++) {
    const sub = _lPendingSubs[i];
    show(`<div class="acad-priority-sub">Analyzing ${i + 1} of ${total}…</div>`);
    const prompt = `You are SIVARR AI, grading a student submission for the assignment "${sub.title}".${
      rubric
        ? ` Grade strictly against this rubric: "${rubric}".`
        : " No rubric was provided -- use your best judgement for a typical academic assignment."
    } Submission: "${sub.text}". Respond in EXACTLY this format, nothing else:\nGRADE: <a grade like 8/10 or 85%>\nCONFIDENT: <yes or no -- answer "no" if the submission is off-topic, too short, blank, or you are unsure>\nFEEDBACK: <one or two sentences of specific feedback>`;
    const reply = await acadAsk(prompt, "academic_lecturer");
    const gradeMatch = reply && reply.match(/GRADE:\s*(.+)/i);
    const confMatch = reply && reply.match(/CONFIDENT:\s*(yes|no)/i);
    const fbMatch = reply && reply.match(/FEEDBACK:\s*([\s\S]+)/i);
    const inp = document.getElementById(`g-${sub.aid}-${sub.sid}`);
    if (inp && gradeMatch) {
      inp.value = gradeMatch[1].trim();
      inp.title = fbMatch ? fbMatch[1].trim() : "";
      const lowConfidence = confMatch && confMatch[1].toLowerCase() === "no";
      inp.style.outline = lowConfidence
        ? "2px solid var(--red3)"
        : "2px solid var(--acad-accent)";
      if (lowConfidence) flagged++;
      done++;
    }
  }
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-bolt" aria-hidden="true"></i> Run Auto-Mark';
  }
  show(
    done
      ? `<div class="acad-priority-sub">${done}/${total} suggestion${done !== 1 ? "s" : ""} ready${flagged ? ` — ${flagged} flagged for extra review (red outline)` : ""}. Review each below, then click Save to confirm.${done < total ? " Some submissions couldn't be reached (rate limit or connection) -- run Auto-Mark again shortly for the rest." : ""}</div>`
      : '<div class="acad-priority-sub" style="color:var(--red3);">Could not reach SIVARR AI. Try again.</div>',
  );
}
async function lViewStudent(sid) {
  const s = lData.students.find((x) => x.sid === sid);
  if (!s) return;
  const d = adData();
  if (!d.classCode) return;
  let gb, att;
  try {
    [gb, att] = await Promise.all([
      acadAPI("/api/acad/gradebook", { code: d.classCode }),
      acadAPI("/api/acad/attendance/register", { code: d.classCode }),
    ]);
  } catch (e) {
    acToast((e && e.message) || "Could not load student details");
    return;
  }
  const row = (gb.rows || []).find((r) => r.sid === sid) || { cells: {}, final_pct: null };
  const attRow = (att.rows || []).find((r) => r.sid === sid) || { present: 0, total: 0, pct: 0 };
  const items = gb.items || [];

  const gradesHtml = items.length
    ? `<table class="acad-data-grid"><thead><tr><th>Item</th><th>Type</th><th>Score</th><th>Status</th></tr></thead><tbody>${items
        .map((it) => {
          const cell = row.cells[it.id] || { display: "—", state: "missing" };
          const cls =
            cell.state === "graded"
              ? "acad-tag--teal"
              : cell.state === "pending"
                ? "acad-tag--orange"
                : "acad-tag--red";
          return `<tr><td>${acEsc(it.title)}</td><td>${acEsc(it.type)}</td><td>${acEsc(String(cell.display))}</td><td><span class="acad-tag ${cls}">${acEsc(cell.state)}</span></td></tr>`;
        })
        .join("")}</tbody></table>`
    : `<div class="acad-priority-sub">No gradable work yet.</div>`;

  const attPct = attRow.pct || 0;
  const attColor =
    attPct >= 80 ? "var(--acad-accent)" : attPct >= 60 ? "var(--amber3)" : "var(--red3)";

  sExamCloseTaker(); // reuse the generic "close whatever sx-overlay is open" helper
  const ov = document.createElement("div");
  ov.className = "sx-overlay";
  ov.id = "sxOverlay";
  ov.innerHTML = `<div class="sx-modal">
    <div class="sx-head">
      <div class="sx-title">${acEsc(s.name)}</div>
      <button class="sx-x" onclick="sExamCloseTaker()" aria-label="Close">✕</button>
    </div>
    <div class="sx-body">
      <div class="acad-priority-sub" style="margin-bottom:10px;">Joined ${acEsc(s.last_active || "–")}</div>
      <div class="acad-card" style="margin-bottom:14px;">
        <div class="acad-card-body">
          <div class="acad-priority-title" style="margin-bottom:6px;">Attendance</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="acad-attend-bar" style="flex:1;height:8px;"><div class="acad-attend-fill" style="width:${attPct}%;background:${attColor};"></div></div>
            <span style="font-size:12px;font-weight:700;color:${attColor};">${attPct}%</span>
          </div>
          <div class="acad-priority-sub" style="margin-top:6px;">${attRow.present}/${attRow.total} sessions present &middot; Overall grade: ${row.final_pct != null ? row.final_pct + "%" : "–"}</div>
        </div>
      </div>
      ${gradesHtml}
    </div>
    <div class="sx-foot">
      <button class="acad-action-btn acad-action-btn--red" data-onclick="lRemoveStudent" data-onclick-arg0="${acEsc(sid)}">Remove from class</button>
      <button class="acad-action-btn acad-action-btn--teal" onclick="sExamCloseTaker()">Close</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
async function lRemoveStudent(sid) {
  const d = adData();
  const s = lData.students.find((x) => x.sid === sid);
  const ok = await siModal.confirm(
    `Remove ${s ? s.name : "this student"} from the class? They'll need to rejoin with the class code.`,
    { title: "Remove student", confirmLabel: "Remove", danger: true },
  );
  if (!ok) return;
  try {
    await acadAPI("/api/acad/class/leave", { code: d.classCode, member_sid: sid });
    acToast("Student removed");
    sExamCloseTaker();
    lLoadRoster();
  } catch (e) {
    acToast((e && e.message) || "Could not remove student");
  }
}
function lExportRoster() {
  if (!lData.students.length) {
    acToast("No students to export");
    return;
  }
  const rows = [["Name", "Email", "Courses", "Attendance", "AvgScore"]].concat(
    lData.students.map((s) => [
      s.name,
      s.email || "",
      (s.courses || []).join("|"),
      s.attendance ?? "",
      s.avg_score ?? "",
    ]),
  );
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "sivarr-roster.csv";
  a.click();
}
const _ACAD_DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const _ACAD_DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
function _lTodayCode() {
  return _ACAD_DAY_ORDER[(new Date().getDay() + 6) % 7]; // JS Date: Sun=0 -> mon-indexed
}
function _lFormatTime(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
// Soonest upcoming entry in a class's weekly schedule -- today if its time
// hasn't passed yet, else the next matching weekday. Shared by the Today's
// Schedule card and the welcome banner's "Next class" stat so there's one
// source of truth for "what's next," not two slightly-different computations.
function _lNextClassOccurrence(schedule) {
  if (!schedule || !schedule.length) return null;
  const todayIdx = _ACAD_DAY_ORDER.indexOf(_lTodayCode());
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let best = null,
    bestDelta = Infinity;
  for (const s of schedule) {
    const dIdx = _ACAD_DAY_ORDER.indexOf(s.day);
    if (dIdx === -1) continue;
    const [h, m] = String(s.time).split(":").map(Number);
    const entryMinutes = h * 60 + m;
    let dayDelta = (dIdx - todayIdx + 7) % 7;
    if (dayDelta === 0 && entryMinutes <= nowMinutes) dayDelta = 7;
    const totalDelta = dayDelta * 1440 + entryMinutes - nowMinutes;
    if (totalDelta < bestDelta) {
      bestDelta = totalDelta;
      best = Object.assign({}, s, { isToday: dayDelta === 0 });
    }
  }
  return best;
}
async function lAddClass() {
  const d = adData();
  if (!d.classCode) {
    acToast("Publish a class first");
    return;
  }
  const f = await siModal.form(
    "Add class time",
    [
      {
        id: "day",
        label: "Day",
        type: "select",
        options: [
          { value: "mon", label: "Monday" },
          { value: "tue", label: "Tuesday" },
          { value: "wed", label: "Wednesday" },
          { value: "thu", label: "Thursday" },
          { value: "fri", label: "Friday" },
          { value: "sat", label: "Saturday" },
          { value: "sun", label: "Sunday" },
        ],
      },
      { id: "time", label: "Time", type: "time", required: true },
    ],
    { confirmLabel: "Add" },
  );
  if (!f || !f.time) return;
  try {
    await acadAPI("/api/acad/class/schedule", {
      code: d.classCode,
      day: f.day,
      time: f.time,
    });
    acToast("Class time added");
    lLoadSchedule();
  } catch (e) {
    acToast((e && e.message) || "Could not add class time");
  }
}
async function lLoadSchedule() {
  const d = adData();
  const el = document.getElementById("lScheduleList");
  if (!el || !d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/class/get", { code: d.classCode });
    const schedule = (r && r.class && r.class.schedule) || [];
    const todayCode = _lTodayCode();
    const today = schedule.filter((s) => s.day === todayCode);
    el.innerHTML = today.length
      ? today
          .map(
            (s) =>
              `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc((r.class && r.class.name) || "Class")}</div><div class="acad-priority-sub">${_lFormatTime(s.time)}</div></div><button class="acad-action-btn acad-action-btn--red" data-onclick="lRemoveScheduleEntry" data-onclick-arg0="${acEsc(s.day)}">Remove</button></div>`,
          )
          .join("")
      : `<div class="acad-empty-state"><i class="ti ti-calendar" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No classes today</div></div>`;
    _lWelcomeNextClass = _lNextClassOccurrence(schedule);
    _lRenderWelcomeStats();
  } catch (e) {
    /* offline / not owner */
  }
}
async function lRemoveScheduleEntry(day) {
  const d = adData();
  if (!d.classCode) return;
  try {
    await acadAPI("/api/acad/class/schedule/remove", { code: d.classCode, day });
    lLoadSchedule();
  } catch (e) {
    acToast((e && e.message) || "Could not remove class time");
  }
}
// ── Welcome banner: real CTAs + stats (lecturer side) ──────────────
let _lWelcomeClassCount = null;
let _lWelcomeNextClass = null;
function _lRenderWelcomeStats() {
  const el = document.getElementById("acadWelcomeStats");
  if (!el) return;
  const nextLabel = _lWelcomeNextClass
    ? (_lWelcomeNextClass.isToday ? "Today " : _ACAD_DAY_LABELS[_lWelcomeNextClass.day] + " ") +
      _lFormatTime(_lWelcomeNextClass.time)
    : "None set";
  el.innerHTML = `<div class="acad-welcome-stat"><div class="acad-welcome-stat-value">${_lWelcomeClassCount != null ? _lWelcomeClassCount : "–"}</div><div class="acad-welcome-stat-label">Classes</div></div><div class="acad-welcome-stat"><div class="acad-welcome-stat-value acad-welcome-stat-value--sm">${acEsc(nextLabel)}</div><div class="acad-welcome-stat-label">Next class</div></div>`;
}
function _lRenderWelcomeCTAs() {
  const el = document.getElementById("acadWelcomeCTAs");
  if (!el) return;
  el.innerHTML = adData().classCode
    ? `<button class="acad-welcome-cta-btn" data-onclick="lTakeAttendance">Take Attendance</button><button class="acad-welcome-cta-btn" data-onclick="lGoToGradingCTA">Grade Submissions</button>`
    : `<button class="acad-welcome-cta-btn" data-onclick="lPublishClass">Publish your first class</button>`;
}
function lGoToGradingCTA() {
  lSwitchTab("l-assessments");
  lAssessSegment("grading");
}
async function lCreateAssessment() {
  if (_lAssessSeg === "grading") return;
  if (_lAssessSeg === "exams") {
    lCreateExam();
    return;
  }
  if (_lAssessSeg === "quizzes") {
    lCreateQuiz();
    return;
  }
  const f = await siModal.form("New assignment", [
    {
      id: "title",
      label: "Title",
      placeholder: "e.g. Essay 1",
      required: true,
    },
    { id: "course", label: "Course code", placeholder: "optional" },
    {
      id: "extra",
      label: "Due date (YYYY-MM-DD)",
      placeholder: "optional",
    },
  ]);
  if (!f || !f.title) return;
  // Assignment: post to the class (shared) when published, else keep local.
  if (adData().classCode) {
    try {
      await acadAPI("/api/acad/assignment/create", {
        code: adData().classCode,
        title: f.title,
        due: f.extra || "",
        points: f.course || "",
      });
      acToast("Assignment posted to class");
      lLoadClassAssignments();
      lLoadActivity();
    } catch (e) {
      acToast((e && e.message) || "Could not post assignment");
    }
    return;
  }
  lData.assignments.push({
    id: "a_" + Date.now(),
    title: f.title,
    course: f.course || "",
    due: f.extra || "",
  });
  adSave({ lAssignments: lData.assignments });
  lRenderAssessLists();
  acToast("Assignment created");
}
async function lLoadDistribution(courseFilter) {
  if (!courseFilter) {
    // No class picked -- fall back to the active class via the normal path
    // (also keeps _lClassStats current for the Students tab).
    lLoadClassStats();
    return;
  }
  // A specific class was picked: fetch and render ITS stats without
  // touching _lClassStats or adData().classCode -- a transient peek, not a
  // switch (switching is a separate, deliberate action on the Classes tab).
  try {
    const r = await acadAPI("/api/acad/class/stats", { code: courseFilter });
    if (r && r.ok) lRenderAnalytics(r);
  } catch (e) {
    /* offline / not owner of that class */
  }
}
function _lPopulateClassFilter() {
  const sel = document.getElementById("lDistCourseFilter");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    `<option value="">${adData().classCode ? "Active class" : "All classes"}</option>` +
    (_lClasses || [])
      .map((c) => `<option value="${acEsc(c.code)}">${acEsc(c.name)}</option>`)
      .join("");
  sel.value = current || "";
}

/* ════════ STUDENT ════════ */
let sModules = [],
  sCitations = [],
  sCiteFormat = "apa";
let sSprintCards = {
  to_review: [],
  spaced_rep: [],
  flashcard: [],
  mastered: [],
};
let sPomoMinutes = 25,
  sPomoSeconds = 0,
  sPomoRunning = false,
  sPomoInterval = null,
  sPomoSession = 1,
  sPomoModeMinutes = 25; // the selected mode's full length — what Reset returns to
// Other mounted timer displays (e.g. the Marketplace "Pomodoro Pro" widget)
// that mirror this one countdown rather than running their own — there is
// only ever one Pomodoro running at a time. Registered lazily on first use;
// see sPomoRegisterMirror.
let sPomoMirrorIds = [];
let sFlashcards = [],
  sFlashIdx = 0,
  sFlashFlipped = false,
  sFlashKnown = new Set(),
  sFlashTarget = null; // active render target — see sLoadFlashcards
let sTutorModuleCtx = "";

function sInit() {
  const d = adData();
  sModules = d.modules || [];
  sCitations = d.citations || [];
  const cols = { to_review: [], spaced_rep: [], flashcard: [], mastered: [] };
  (d.sprintCards || []).forEach((c) => {
    (cols[c.column] || cols.to_review).push(c);
  });
  sSprintCards = cols;
  sSwitchTab("s-overview");
  sRenderMetrics();
  sRenderPriorities();
  sRenderDeadlines();
  sSyncModuleDropdowns();
  sUpdateCitationStats();
  sRenderMyClasses();
  _sRenderWelcomeCTAs();
  _sRenderWelcomeStats(null);
  sLoadFeed();
  sLoadAssignments(); // also fills in the welcome banner's "Pending assignments" stat
  sLoadExams();
  sLoadLivePolls();
  hostMountExtensions(window.currentSpace || window.currentAcademicSpace);
}
// ── Welcome banner: real CTAs + stats (student side) ──────────────
function _sRenderWelcomeCTAs() {
  const el = document.getElementById("acadWelcomeCTAs");
  if (!el) return;
  const joined = (adData().joinedClasses || []).length;
  el.innerHTML = joined
    ? `<button class="acad-welcome-cta-btn" data-onclick="sSwitchTab" data-onclick-arg0="s-grades">My Grades</button><button class="acad-welcome-cta-btn" data-onclick="sSwitchTab" data-onclick-arg0="s-vault">Lecture Vault</button>`
    : `<button class="acad-welcome-cta-btn" data-onclick="sJoinClass">Join a class</button>`;
}
function _sRenderWelcomeStats(pendingCount) {
  const el = document.getElementById("acadWelcomeStats");
  if (!el) return;
  const joined = (adData().joinedClasses || []).length;
  el.innerHTML = `<div class="acad-welcome-stat"><div class="acad-welcome-stat-value">${joined}</div><div class="acad-welcome-stat-label">Classes joined</div></div><div class="acad-welcome-stat"><div class="acad-welcome-stat-value">${pendingCount != null ? pendingCount : "–"}</div><div class="acad-welcome-stat-label">Pending assignments</div></div>`;
}
function sAllSprint() {
  return [].concat(
    sSprintCards.to_review,
    sSprintCards.spaced_rep,
    sSprintCards.flashcard,
    sSprintCards.mastered,
  );
}
function sPersistSprint() {
  adSave({ sprintCards: sAllSprint() });
}
function sSyncModuleDropdowns() {
  const opts =
    '<option value="">All modules</option>' +
    sModules
      .map((m) => `<option value="${m.id}">${acEsc(m.name)}</option>`)
      .join("");
  ["sSprintModule", "sTutorModule"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
}
function sRenderMetrics() {
  const d = adData();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = v;
  };
  set("sm-questions", d.aiQuestions || "–");
  set("sm-quizzes", sSprintCards.mastered.length || "–");
  set("sm-streak", (d.studyStreak || 0) + "<span> days</span>");
  set("sm-cgpa", (d.cgpaProjection || "–") + "<span>/5.0</span>");
}
function sSwitchTab(tabId) {
  document
    .querySelectorAll("#studentTabBar .acad-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll("#acadStudentDash .acad-tab-content")
    .forEach((c) => {
      c.classList.remove("active");
      c.style.display = "none";
    });
  const at = document.querySelector(`#studentTabBar [data-tab="${tabId}"]`);
  const ac = document.getElementById(`tab-${tabId}`);
  if (at) at.classList.add("active");
  if (ac) {
    ac.classList.add("active");
    ac.style.display = "block";
  }
  if (tabId === "s-grades") sLoadMyGrades();
  if (tabId === "s-vault") {
    sRenderModules();
    sLoadMaterials();
  }
  if (tabId === "s-sprint") sRenderKanban();
  if (tabId === "s-research") sRenderCitations();
  if (tabId === "s-groups") sRenderGroups();
  if (tabId === "s-tutor") sLoadFlashcards();
}

// ── My Grades: every joined class, every gradable item, one table ──
// Loops adData().joinedClasses the same way sLoadAssignments/sLoadExams
// already do (both untouched -- this is an additional consolidated view),
// calling /api/acad/gradebook/mine per class and flattening into one list.
async function sLoadMyGrades() {
  const list = adData().joinedClasses || [];
  const summary = document.getElementById("sGradesSummary");
  const body = document.getElementById("sGradesBody");
  if (!body) return;
  const emptyState = `<tr><td colspan="5" class="acad-table-empty">No grades yet. Join a class and submit some work to see them here.</td></tr>`;
  if (summary) summary.innerHTML = "";
  if (!list.length) {
    body.innerHTML = emptyState;
    return;
  }
  let allRows = [];
  for (const c of list) {
    try {
      const r = await acadAPI("/api/acad/gradebook/mine", { code: c.code });
      if (!r || !r.ok) continue;
      const items = r.items || [];
      const row = r.row;
      if (summary) {
        const pct = row && row.final_pct != null ? row.final_pct + "%" : "–";
        summary.innerHTML += `<div class="acad-card" style="padding:12px 16px;min-width:140px;flex:1;"><div class="acad-priority-sub">${acEsc(c.name || c.code)}</div><div style="font-size:20px;font-weight:700;color:var(--text);">${pct}</div></div>`;
      }
      items.forEach((it) => {
        const cell = (row && row.cells[it.id]) || {
          display: "—",
          state: "missing",
        };
        allRows.push({
          cls: c.name || c.code,
          title: it.title,
          type: it.type,
          display: cell.display,
          state: cell.state,
        });
      });
    } catch (e) {
      /* skip a class we can't reach right now */
    }
  }
  if (!allRows.length) {
    body.innerHTML = emptyState;
    return;
  }
  body.innerHTML = allRows
    .map((r) => {
      const cls =
        r.state === "graded"
          ? "acad-tag--teal"
          : r.state === "pending"
            ? "acad-tag--orange"
            : "acad-tag--red";
      return `<tr><td>${acEsc(r.cls)}</td><td>${acEsc(r.title)}</td><td>${acEsc(r.type)}</td><td><span class="acad-tag ${cls}">${acEsc(String(r.display))}</span></td><td>${acEsc(r.state)}</td></tr>`;
    })
    .join("");
}
let _sMaterials = {}; // id -> material, for the Preview modal below
async function sLoadMaterials() {
  const list = adData().joinedClasses || [];
  const grid = document.getElementById("sNotesGrid");
  if (!grid) return;
  const emptyState = `<div class="acad-empty-state"><i class="ti ti-file" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No materials posted yet</div></div>`;
  if (!list.length) {
    grid.innerHTML = emptyState;
    return;
  }
  let allItems = [];
  for (const c of list) {
    try {
      const r = await acadAPI("/api/acad/materials/list", { code: c.code });
      ((r && r.materials) || []).forEach((m) =>
        allItems.push(Object.assign({}, m, { _cls: c.name || c.code, _code: c.code })),
      );
    } catch (e) {
      /* skip a class we can't reach right now */
    }
  }
  if (!allItems.length) {
    grid.innerHTML = emptyState;
    return;
  }
  allItems.forEach((m) => (_sMaterials[m.id] = m));
  grid.innerHTML = allItems
    .map((m) => {
      const icon = m.type === "doc" ? "ti-file-text" : "ti-file";
      const meta =
        m.type === "doc"
          ? m._cls
          : `${m._cls} · ${Math.round((m.size || 0) / 1024)} KB`;
      const action =
        m.type === "doc"
          ? `<button class="acad-btn-ghost acad-btn-sm" data-onclick="sPreviewMaterial" data-onclick-arg0="${acEsc(m.id)}">Preview</button>`
          : `<a class="acad-btn-ghost acad-btn-sm" href="/api/acad/materials/${acEsc(m.id)}/file?token=${encodeURIComponent(getToken())}&code=${acEsc(m._code)}" target="_blank" rel="noopener">Download</a>`;
      return `<div class="acad-notes-card"><i class="ti ${icon}" style="font-size:20px;color:var(--acad-accent);" aria-hidden="true"></i><div class="acad-priority-title" style="margin-top:6px;">${acEsc(m.title)}</div><div class="acad-priority-sub">${acEsc(meta)}</div><div style="margin-top:8px;">${action}</div></div>`;
    })
    .join("");
}
function sPreviewMaterial(id) {
  const m = _sMaterials[id];
  if (!m) return;
  siModal.confirm(
    `<div style="white-space:pre-wrap;text-align:left;max-height:50vh;overflow:auto;">${acEsc(m.content || "")}</div>`,
    { title: m.title || "Preview", confirmLabel: "Close" },
  );
}
function sRenderPriorities() {
  const list = document.getElementById("sPriorityList");
  const cEl = document.getElementById("sPriorityCount");
  const items = sAllSprint().filter(
    (c) => c.priority === "high" && c.column !== "mastered",
  );
  if (cEl) cEl.textContent = `${items.length} due`;
  if (!list) return;
  if (!items.length) return; // keep empty state
  list.innerHTML = items
    .map(
      (c) => `
    <div class="acad-priority-item">
      <div class="acad-checkbox" onclick="this.classList.toggle('acad-checkbox--checked')"></div>
      <div class="acad-priority-meta">
        <div class="acad-priority-title">${acEsc(c.title)}</div>
        <div class="acad-priority-sub">${acEsc(c.module || "Revision")}</div>
        <div class="acad-priority-actions"><button class="acad-action-btn acad-action-btn--teal" onclick="sAskAI('Draft a quick study plan for: ${acEsc(c.title)}')"><i class="ti ti-bolt" aria-hidden="true"></i> Ask SIVARR AI</button></div>
      </div>
    </div>`,
    )
    .join("");
}
function sRenderDeadlines() {
  const strip = document.getElementById("sDeadlineStrip");
  if (!strip) return;
  const dl = sModules
    .filter((m) => m.exam_date)
    .sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date));
  if (!dl.length) return;
  const daysLeft = (d) => {
    const ms = new Date(d) - new Date();
    return ms > 0 ? Math.ceil(ms / 86400000) : 0;
  };
  strip.innerHTML = `<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;">${dl
    .map(
      (m) => `
    <div class="acad-deadline-chip"><div class="acad-deadline-module">${acEsc(m.code || m.name)}</div><div class="acad-deadline-date">${acEsc(m.exam_date)}</div><div class="acad-deadline-days">${daysLeft(m.exam_date)}d</div></div>`,
    )
    .join("")}</div>`;
}
async function sGenerateBriefing() {
  const btn = document.getElementById("sGenerateBtn");
  const wrap = document.getElementById("sAIResult");
  const body = document.getElementById("sAIResultBody");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<i class="ti ti-loader" aria-hidden="true"></i> Generating…';
  }
  const mods = sModules.map((m) => m.name).join(", ") || "general studies";
  const text = await acadAsk(
    `You are SIVARR AI, a student study assistant. Generate a concise daily study briefing for a student studying: ${mods}. Include (1) 2-3 key concepts to focus on today, (2) top 3 suggested actions, (3) a recommended 30-minute flashcard sprint. Keep it punchy and motivating.`,
    "academic_student_brief",
  );
  if (body)
    body.innerHTML = text
      ? `<div class="acad-ai-section"><div class="acad-ai-section-text">${acEsc(text).replace(/\n/g, "<br>")}</div><div style="margin-top:10px;"><button class="acad-btn-teal" style="width:100%;padding:7px;" onclick="sSwitchTab('s-sprint')">▶ Open Exam Sprint</button></div></div>`
      : `<div class="acad-ai-section acad-ai-section-text" style="color:var(--text4);">Could not reach SIVARR AI.</div>`;
  if (wrap) wrap.style.display = "block";
  const d = adData();
  adSave({ aiQuestions: (d.aiQuestions || 0) + 1 });
  sRenderMetrics();
  if (btn) {
    btn.disabled = false;
    btn.innerHTML =
      '<i class="ti ti-refresh" aria-hidden="true"></i> Regenerate';
  }
}
// ── Lecture Vault ──
function sRenderModules(filter = "") {
  const tb = document.getElementById("sModuleTableBody");
  if (!tb) return;
  const list = filter
    ? sModules.filter((m) =>
        (m.name + (m.code || "")).toLowerCase().includes(filter.toLowerCase()),
      )
    : sModules;
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="8" class="acad-table-empty">No modules yet.</td></tr>`;
    return;
  }
  const daysLeft = (d) => {
    if (!d) return null;
    const ms = new Date(d) - new Date();
    return ms > 0 ? Math.ceil(ms / 86400000) : 0;
  };
  tb.innerHTML = list
    .map((m) => {
      const pct = m.attendance ?? 0;
      const bc =
        pct >= 85
          ? "var(--acad-accent)"
          : pct >= 70
            ? "var(--amber3)"
            : "var(--red3)";
      const dl = daysLeft(m.exam_date);
      return `<tr>
      <td><span class="acad-module-name">${acEsc(m.name)}</span></td>
      <td><span class="acad-module-code">${acEsc(m.code || "–")}</span></td>
      <td><span style="font-weight:600;font-size:11px;">${m.exam_date ? acEsc(m.exam_date) + (dl != null ? " · " + dl + "d" : "") : "–"}</span></td>
      <td style="font-size:11px;">${acEsc(m.lecturer || "–")}</td>
      <td><div style="display:flex;align-items:center;gap:6px;"><div class="acad-attend-bar"><div class="acad-attend-fill" style="width:${pct}%;background:${bc};"></div></div><span style="font-size:11px;font-weight:600;color:${bc};">${pct}%</span></div></td>
      <td><span class="acad-tag ${pct >= 85 ? "acad-tag--teal" : pct >= 70 ? "acad-tag--orange" : "acad-tag--red"}">${pct >= 85 ? "On Track" : pct >= 70 ? "At Risk" : "Critical"}</span></td>
      <td><button class="acad-btn-ghost acad-btn-sm" onclick="sAskAI('Summarise the key topics for ${acEsc(m.name)}')"><i class="ti ti-bolt" aria-hidden="true"></i></button></td>
      <td><button class="acad-btn-teal acad-btn-sm" onclick="sEditModule('${m.id}')">Edit</button></td>
    </tr>`;
    })
    .join("");
}
function sFilterModules(v) {
  sRenderModules(v);
}
async function sAddModule() {
  const f = await siModal.form("Add module", [
    {
      id: "name",
      label: "Module name",
      placeholder: "e.g. Linear Algebra",
      required: true,
    },
    { id: "code", label: "Code", placeholder: "e.g. MTH201" },
    { id: "lecturer", label: "Lecturer", placeholder: "e.g. Dr. Bello" },
    {
      id: "exam_date",
      label: "Next exam (YYYY-MM-DD)",
      placeholder: "2026-07-01",
    },
  ]);
  if (!f || !f.name) return;
  sModules.push({
    id: "m_" + Date.now(),
    name: f.name,
    code: f.code || "",
    lecturer: f.lecturer || "",
    exam_date: f.exam_date || "",
    attendance: 0,
  });
  adSave({ modules: sModules });
  sRenderModules();
  sSyncModuleDropdowns();
  sRenderDeadlines();
  acToast("Module added");
}
async function sEditModule(id) {
  const m = sModules.find((x) => x.id === id);
  if (!m) return;
  const f = await siModal.form("Edit module", [
    { id: "name", label: "Module name", value: m.name, required: true },
    { id: "code", label: "Code", value: m.code },
    { id: "lecturer", label: "Lecturer", value: m.lecturer },
    { id: "exam_date", label: "Next exam (YYYY-MM-DD)", value: m.exam_date },
    {
      id: "attendance",
      label: "Attendance %",
      value: String(m.attendance || 0),
    },
  ]);
  if (!f) return;
  Object.assign(m, {
    name: f.name || m.name,
    code: f.code,
    lecturer: f.lecturer,
    exam_date: f.exam_date,
    attendance: Math.max(0, Math.min(100, parseInt(f.attendance) || 0)),
  });
  adSave({ modules: sModules });
  sRenderModules();
  sSyncModuleDropdowns();
  sRenderDeadlines();
}
// ── Exam Sprint (Kanban) ──
function sRenderKanban(moduleFilter = "") {
  Object.keys(sSprintCards).forEach((col) => {
    const cards = moduleFilter
      ? sSprintCards[col].filter(
          (c) => !c.module_id || c.module_id === moduleFilter,
        )
      : sSprintCards[col];
    const cont = document.getElementById(`sCards-${col}`);
    const cnt = document.getElementById(`sColCount-${col}`);
    if (cnt) cnt.textContent = cards.length;
    if (!cont) return;
    cont.innerHTML = cards
      .map(
        (c) => `
      <div class="acad-kanban-card" data-id="${c.id}">
        <div class="acad-kcard-title">${acEsc(c.title)}</div>
        <div class="acad-kcard-tags">${c.priority === "high" ? '<span class="acad-tag acad-tag--red">High</span>' : ""}${col === "mastered" ? '<span class="acad-tag acad-tag--teal">Mastered</span>' : ""}</div>
        <div class="acad-kcard-footer"><span class="acad-kcard-weight">${acEsc(c.module || "")}</span>${col !== "mastered" ? `<button class="acad-action-btn acad-btn-sm" onclick="sMoveCard('${c.id}','${col}')">Move →</button>` : ""}</div>
      </div>`,
      )
      .join("");
  });
}
function sFilterSprintByModule(v) {
  sRenderKanban(v);
}
async function sAddSprintCard(col = "to_review") {
  const title = await siModal.input(
    "Add revision card",
    "Topic or concept",
    "",
    { confirmLabel: "Add" },
  );
  if (!title) return;
  sSprintCards[col].push({ id: "k_" + Date.now(), title, column: col });
  sPersistSprint();
  sRenderKanban();
  sRenderPriorities();
}
function sMoveCard(id, fromCol) {
  const cols = ["to_review", "spaced_rep", "flashcard", "mastered"];
  const next = cols[Math.min(cols.indexOf(fromCol) + 1, cols.length - 1)];
  const i = sSprintCards[fromCol].findIndex((c) => c.id === id);
  if (i === -1) return;
  const [card] = sSprintCards[fromCol].splice(i, 1);
  card.column = next;
  sSprintCards[next].push(card);
  sPersistSprint();
  sRenderKanban();
  sRenderMetrics();
}
// AI-generate Q/A flashcards into the Flashcard Drill column (uses /api/chat).
async function sGenAIFlashcards() {
  const topic = await siModal.input(
    "AI flashcards",
    "Topic or concept to drill",
    "",
    { confirmLabel: "Generate" },
  );
  if (!topic) return;
  acToast("Generating flashcards…");
  const raw = await acadAsk(
    `Generate 6 concise study flashcards for: "${topic}". Return ONLY lines in EXACTLY this format, one per line, with no numbering or extra text:\nQ: <question> :: A: <answer>`,
    "flashcard_gen",
  );
  if (!raw) {
    acToast("Could not reach SIVARR AI");
    return;
  }
  const cards = [];
  raw.split(/\r?\n/).forEach((line) => {
    const m = line.match(/Q:\s*(.+?)\s*::\s*A:\s*(.+)/i);
    if (m)
      cards.push({
        id: "k_" + Date.now() + "_" + cards.length,
        title: m[1].trim(),
        answer: m[2].trim(),
        column: "flashcard",
        module: "",
      });
  });
  if (!cards.length) {
    acToast("No cards parsed, try a clearer topic");
    return;
  }
  sSprintCards.flashcard.push(...cards);
  sPersistSprint();
  sRenderKanban();
  const d = adData();
  adSave({ aiQuestions: (d.aiQuestions || 0) + 1 });
  sLoadFlashcards();
  acToast(`${cards.length} flashcards added to Flashcard Drill`);
}
// ── Research / Citations ──
function sSetFormat(btn, fmt) {
  document
    .querySelectorAll("#tab-s-research .acad-format-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  sCiteFormat = fmt;
}
async function sGenerateCitation() {
  const input = document.getElementById("sCiteInput");
  const q = input?.value?.trim();
  if (!q) return;
  const text = await acadAsk(
    `Generate a formal ${sCiteFormat.toUpperCase()} citation for: "${q}". Return ONLY the formatted citation string, nothing else.`,
    "citation_engine",
  );
  if (!text) {
    acToast("Citation generation failed");
    return;
  }
  sCitations.unshift({
    id: "r_" + Date.now(),
    title: q.substring(0, 80),
    citation: text.trim(),
    format: sCiteFormat,
    auto: true,
  });
  adSave({ citations: sCitations });
  sRenderCitations();
  sUpdateCitationStats();
  const d = adData();
  adSave({ aiQuestions: (d.aiQuestions || 0) + 1 });
  if (input) input.value = "";
}
// Real literature search (PubMed + Semantic Scholar) -- distinct from the AI
// "Generate" flow above, which never searches a real index, just asks Gemini
// to freehand a citation string. This one returns real metadata a student
// can turn into a citation via _sFormatCitation, not an AI guess.
let _sSearchResults = [];
async function sSearchLiterature() {
  const input = document.getElementById("sCiteInput");
  const q = input?.value?.trim();
  if (!q) return;
  const resultsEl = document.getElementById("sSearchResults");
  const btn = document.querySelector('[data-onclick="sSearchLiterature"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader" aria-hidden="true"></i> Searching…';
  }
  if (resultsEl) {
    resultsEl.style.display = "block";
    resultsEl.innerHTML = `<div class="acad-priority-sub">Searching PubMed and Semantic Scholar…</div>`;
  }
  try {
    const r = await acadAPI("/api/acad/research/search", { query: q });
    _sSearchResults = (r && r.results) || [];
    if (resultsEl) {
      resultsEl.innerHTML = _sSearchResults.length
        ? _sSearchResults
            .map((res, i) => {
              const authors = (res.authors || []).slice(0, 3).join(", ") + ((res.authors || []).length > 3 ? " et al." : "");
              const meta = [authors, res.year, res.venue].filter(Boolean).join(" · ");
              return `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(res.title || "Untitled")}</div><div class="acad-priority-sub">${acEsc(meta)}</div></div><div class="acad-priority-actions">${res.url ? `<a class="acad-btn-ghost acad-btn-sm" href="${acEsc(res.url)}" target="_blank" rel="noopener">View</a>` : ""}<button class="acad-action-btn acad-action-btn--teal" data-onclick="sAddRealCitation" data-onclick-arg0="${i}">Add citation</button></div></div>`;
            })
            .join("")
        : `<div class="acad-priority-sub">No results found for "${acEsc(q)}".</div>`;
    }
  } catch (e) {
    if (resultsEl)
      resultsEl.innerHTML = `<div class="acad-priority-sub" style="color:var(--red3);">Search failed. Try again.</div>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-search" aria-hidden="true"></i> Search';
    }
  }
}
// Real-metadata citation formatter -- not a full bibliographic-style engine,
// just an honest, non-hallucinated shape for the 4 formats this space offers.
function _sFormatCitation(meta) {
  const authors = (meta.authors || []).filter(Boolean);
  const year = meta.year || "n.d.";
  const title = meta.title || "Untitled";
  const venue = meta.venue || "";
  if (sCiteFormat === "mla") {
    const first = authors[0] || "Unknown author";
    return `${first}${authors.length > 1 ? ", et al." : "."} "${title}." ${venue}${venue ? ", " : ""}${year}.`;
  }
  if (sCiteFormat === "ieee") {
    const authorStr = authors.length ? authors.join(", ") : "Unknown author";
    return `${authorStr}, "${title}," ${venue}, ${year}.`;
  }
  if (sCiteFormat === "vancouver") {
    const authorStr = authors.length
      ? authors.slice(0, 6).join(", ") + (authors.length > 6 ? ", et al." : "")
      : "Unknown author";
    return `${authorStr}. ${title}. ${venue}. ${year}.`;
  }
  const authorStr = authors.length ? authors.join(", ") : "Unknown author";
  return `${authorStr} (${year}). ${title}. ${venue}.`;
}
function sAddRealCitation(idx) {
  const res = _sSearchResults[idx];
  if (!res) return;
  sCitations.unshift({
    id: "r_" + Date.now(),
    title: (res.title || "").substring(0, 80),
    citation: _sFormatCitation(res),
    format: sCiteFormat,
    auto: false,
    source: res.source,
  });
  adSave({ citations: sCitations });
  sRenderCitations();
  sUpdateCitationStats();
  acToast("Citation added");
}
function sRenderCitations(filter = "") {
  const c = document.getElementById("sCitationList");
  if (!c) return;
  const list = filter
    ? sCitations.filter((x) =>
        (x.title + x.citation).toLowerCase().includes(filter.toLowerCase()),
      )
    : sCitations;
  if (!list.length) {
    c.innerHTML = `<div class="acad-empty-state"><i class="ti ti-file-text" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No references yet.</div></div>`;
    return;
  }
  c.innerHTML = list
    .map(
      (x) => `
    <div class="acad-citation-item">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;"><div style="flex:1;"><div class="acad-citation-title">${acEsc(x.title)}</div><div class="acad-citation-ref">${acEsc(x.citation)}</div></div><span class="acad-tag acad-tag--teal" style="flex-shrink:0;font-size:9px;">${acEsc((x.format || "APA").toUpperCase())}</span></div>
      <div class="acad-citation-footer">${x.auto ? '<span class="acad-source-badge acad-source-badge--purple">AI Generated</span>' : x.source ? `<span class="acad-source-badge acad-source-badge--teal">${acEsc(x.source === "pubmed" ? "PubMed" : "Semantic Scholar")}</span>` : ""}<button style="margin-left:auto;" class="acad-action-btn" onclick="sCopyCite('${x.id}')">Copy</button><button class="acad-action-btn acad-action-btn--red" onclick="sDeleteCite('${x.id}')">Delete</button></div>
    </div>`,
    )
    .join("");
}
function sCopyCite(id) {
  const x = sCitations.find((c) => c.id === id);
  if (x) {
    navigator.clipboard?.writeText(x.citation);
    acToast("Citation copied");
  }
}
function sDeleteCite(id) {
  sCitations = sCitations.filter((c) => c.id !== id);
  adSave({ citations: sCitations });
  sRenderCitations();
  sUpdateCitationStats();
}
function sFilterCitations(v) {
  sRenderCitations(v);
}
function sUpdateCitationStats() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("sStatTotal", sCitations.length);
  set("sStatAuto", sCitations.filter((c) => c.auto).length);
  set("sStatManual", sCitations.filter((c) => !c.auto).length);
}
function sExportBib() {
  if (!sCitations.length) {
    acToast("No references to export");
    return;
  }
  const bib = sCitations
    .map((c, i) => `@misc{ref${i + 1},\n  note={${c.citation}}\n}`)
    .join("\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bib], { type: "text/plain" }));
  a.download = "sivarr-references.bib";
  a.click();
}
// ── Study Groups ──
// ── Study Groups (real, shared via the existing /api/group/* backend --
// the same one org chat's atomic message store already backs; see app.py)
let _sGroups = [];
async function sRenderGroups(filter = "") {
  const grid = document.getElementById("sGroupsGrid");
  if (!grid) return;
  let groups = [];
  try {
    const r = await fetch(`/api/group/list?token=${encodeURIComponent(getToken() || "")}`);
    const d = await r.json();
    groups = d.groups || [];
  } catch (e) {
    grid.innerHTML = `<div class="acad-empty-state"><i class="ti ti-alert-triangle" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>Couldn't load your groups. Try again.</div></div>`;
    return;
  }
  _sGroups = groups;
  const list = filter
    ? groups.filter((g) => (g.name || "").toLowerCase().includes(filter.toLowerCase()))
    : groups;
  if (!list.length) {
    grid.innerHTML = `<div class="acad-empty-state"><i class="ti ti-users" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No study groups yet. Create one or ask a classmate to invite you.</div></div>`;
    return;
  }
  grid.innerHTML = list
    .map(
      (g) => `
    <div class="acad-group-card" onclick="sOpenGroup('${acEsc(g.id)}','${acEsc(g.name)}')">
      <div class="acad-group-header"><div class="acad-group-name">${acEsc(g.name)}</div><span class="acad-tag acad-tag--teal">${g.member_count || 1} member${(g.member_count || 1) !== 1 ? "s" : ""}</span></div>
      <div class="acad-priority-sub" style="margin-top:4px;">${g.last_msg ? acEsc(g.last_msg) : "No messages yet"}</div>
      <div class="acad-group-footer" style="margin-top:10px;"><span class="acad-priority-sub">${acEsc(g.last_date || "")}</span><button class="acad-btn-teal acad-btn-sm">Open</button></div>
    </div>`,
    )
    .join("");
}
function sFilterGroups(v) {
  sRenderGroups(v);
}
async function sCreateGroup() {
  const name = await siModal.input(
    "Create study group",
    "e.g. MTH201 Study Crew",
    "",
    { confirmLabel: "Create" },
  );
  if (!name) return;
  try {
    const r = await acadAPI("/api/group/create", { name });
    acToast(`Group created! Code: ${r.group_id}`);
    sRenderGroups();
  } catch (e) {
    acToast((e && e.message) || "Could not create group");
  }
}
async function sJoinGroup() {
  const gid = await siModal.input(
    "Join a study group",
    "Paste the group code a classmate shared",
    "",
    { confirmLabel: "Join" },
  );
  if (!gid) return;
  try {
    await acadAPI("/api/group/join", { group_id: gid.trim() });
    acToast("Joined group");
    sRenderGroups();
  } catch (e) {
    acToast((e && e.message) || "Invalid group code, or already a member");
  }
}

let _sGroupActive = null; // {id, name}
let _sGroupPollInterval = null;
let _sGroupLastTs = "";
let _sGroupSeen = new Set();

// Live delivery is REST polling only, not SSE: /api/group/chat/stream connects
// fine but this app's global GZipMiddleware buffers small streamed chunks and
// never flushes them (a well-known Starlette/FastAPI GZip+SSE incompatibility,
// confirmed live -- the connection stays "open" but no event ever arrives).
// Fixing that would mean changing global response-compression behavior for
// the whole app, well beyond this feature's scope. Plain polling against
// /api/group/messages was already confirmed reliable, so it's the only
// transport here -- same real, shared data, ~3s later instead of instant.
function sOpenGroup(gid, name) {
  sExamCloseTaker(); // close any other open .sx-overlay (also tears down a prior poll interval)
  _sGroupActive = { id: gid, name };
  _sGroupLastTs = "";
  _sGroupSeen = new Set();
  const ov = document.createElement("div");
  ov.className = "sx-overlay";
  ov.id = "sxOverlay";
  ov.innerHTML = `<div class="sx-modal">
    <div class="sx-head">
      <div style="flex:1">
        <div class="sx-title">${acEsc(name)}</div>
        <div class="sx-subtitle">Code: ${acEsc(gid)} <button class="acad-btn-ghost acad-btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText('${acEsc(gid)}');acToast('Code copied')">Copy</button></div>
      </div>
      <button class="sx-x" onclick="sCloseGroupChat()" aria-label="Close">✕</button>
    </div>
    <div class="acad-tutor-messages" id="sGroupMessages" style="max-height:360px;"></div>
    <div class="acad-tutor-input-row">
      <input class="acad-research-input" id="sGroupMsgInput" type="text" placeholder="Message the group…" onkeydown="if (event.key === 'Enter') sSendGroupMessage();">
      <button class="acad-research-btn" data-onclick="sSendGroupMessage"><i class="ti ti-send" aria-hidden="true"></i></button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  sLoadGroupMessages(true).then(() => {
    if (_sGroupActive) _sGroupPollInterval = setInterval(() => sLoadGroupMessages(false), 3000);
  });
}
function sCloseGroupChat() {
  _sGroupActive = null;
  sExamCloseTaker(); // stops the poll interval too
}
// Also called from the shared sExamCloseTaker() so opening a *different*
// modal on top of an open group chat can't leave the poll timer running.
function sStopGroupLive() {
  if (_sGroupPollInterval) {
    clearInterval(_sGroupPollInterval);
    _sGroupPollInterval = null;
  }
}
async function sLoadGroupMessages(replace = false) {
  if (!_sGroupActive) return;
  try {
    const r = await fetch(
      `/api/group/messages?group_id=${encodeURIComponent(_sGroupActive.id)}&token=${encodeURIComponent(getToken() || "")}`,
    );
    const d = await r.json();
    const box = document.getElementById("sGroupMessages");
    if (replace) {
      if (box) box.innerHTML = "";
      _sGroupSeen = new Set();
      _sGroupLastTs = "";
    }
    const msgs = d.messages || [];
    if (replace && !msgs.length) {
      if (box)
        box.innerHTML = `<div class="acad-priority-sub" id="sGroupEmptyMsg" style="text-align:center;padding:20px 0;">No messages yet. Say hello!</div>`;
      return;
    }
    msgs.forEach(sAppendGroupMsg);
  } catch (e) {}
}
// Append a single message if unseen (dedupes by id -- the same poll tick can
// re-fetch a message already rendered from a previous tick).
function sAppendGroupMsg(m) {
  if (!_sGroupActive) return;
  const box = document.getElementById("sGroupMessages");
  if (!box) return;
  const key = m.id != null ? String(m.id) : `${m.sender}:${m.text}:${m.date}`;
  if (_sGroupSeen.has(key)) return;
  _sGroupSeen.add(key);
  if (m.date && m.date > _sGroupLastTs) _sGroupLastTs = m.date;
  const emptyEl = document.getElementById("sGroupEmptyMsg");
  if (emptyEl) emptyEl.remove();
  const mine = m.sender === (window.S && S.sid);
  const el = document.createElement("div");
  el.className = `acad-tutor-msg${mine ? " acad-tutor-msg--user" : ""}`;
  el.innerHTML = `<div class="acad-tutor-bubble">${!mine ? `<div class="acad-group-msg-sender">${acEsc(m.sender_name || "Student")}</div>` : ""}${acEsc(m.text || "")}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
async function sSendGroupMessage() {
  if (!_sGroupActive) return;
  const input = document.getElementById("sGroupMsgInput");
  const text = input?.value?.trim();
  if (!text) return;
  input.value = "";
  try {
    // The live feed (SSE/poll) echoes the message back to everyone, including
    // us, so we don't append optimistically here -- avoids double-rendering.
    await acadAPI("/api/group/message", { group_id: _sGroupActive.id, text });
    if (_sGroupPollInterval) sLoadGroupMessages(false); // polling fallback: pull immediately
  } catch (e) {
    input.value = text;
    acToast((e && e.message) || "Send failed");
  }
}
// ── AI Tutor ──
function sTutorSetModule(id) {
  sTutorModuleCtx = id;
}
async function sSendTutorMessage() {
  const input = document.getElementById("sTutorInput");
  const msg = input?.value?.trim();
  if (!msg) return;
  if (input) input.value = "";
  const box = document.getElementById("sTutorMessages");
  if (box) {
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="acad-tutor-msg acad-tutor-msg--user"><div class="acad-tutor-bubble">${acEsc(msg)}</div></div>`,
    );
    box.scrollTop = box.scrollHeight;
  }
  const mod = sTutorModuleCtx
    ? ` The student is studying: ${sModules.find((m) => m.id === sTutorModuleCtx)?.name || sTutorModuleCtx}.`
    : "";
  const reply = await acadAsk(
    `You are SIVARR AI Tutor, an expert academic assistant.${mod} Student says: "${msg}". Respond helpfully and educationally. If they say "quiz me", give 3 practice questions. If they ask for a concept, explain simply then give an example.`,
    "academic_tutor",
  );
  if (box) {
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="acad-tutor-msg acad-tutor-msg--ai"><div class="acad-tutor-avatar"><i class="ti ti-bolt" aria-hidden="true"></i></div><div class="acad-tutor-bubble">${reply ? acEsc(reply).replace(/\n/g, "<br>") : "Sorry, I couldn't reach SIVARR AI right now."}</div></div>`,
    );
    box.scrollTop = box.scrollHeight;
  }
  const d = adData();
  adSave({ aiQuestions: (d.aiQuestions || 0) + 1 });
  sRenderMetrics();
}
function sTutorQuick(prefix) {
  const i = document.getElementById("sTutorInput");
  if (i) {
    i.value = prefix;
    i.focus();
  }
}
function sAskAI(prompt) {
  sSwitchTab("s-tutor");
  const i = document.getElementById("sTutorInput");
  if (i) {
    i.value = prompt;
    i.focus();
  }
}
async function sAddDeadline() {
  const f = await siModal.form("Add deadline", [
    {
      id: "name",
      label: "Title",
      placeholder: "e.g. CSC301 Exam",
      required: true,
    },
    {
      id: "exam_date",
      label: "Date (YYYY-MM-DD)",
      placeholder: "2026-07-01",
      required: true,
    },
  ]);
  if (!f || !f.name || !f.exam_date) return;
  sModules.push({
    id: "m_" + Date.now(),
    name: f.name,
    code: "",
    exam_date: f.exam_date,
    attendance: 0,
  });
  adSave({ modules: sModules });
  sRenderDeadlines();
  sSyncModuleDropdowns();
}
// ── Pomodoro ──
function sPomoSet(min, label) {
  sPomoReset();
  sPomoModeMinutes = min;
  sPomoMinutes = min;
  sPomoSeconds = 0;
  document
    .querySelectorAll("#tab-s-tutor .acad-pomo-mode-bar .acad-seg")
    .forEach((b) => b.classList.remove("active"));
  document
    .getElementById(
      {
        Focus: "pomoFocus",
        "Short break": "pomoShort",
        "Long break": "pomoLong",
      }[label],
    )
    ?.classList.add("active");
  const lbl = document.getElementById("sPomoLabel");
  if (lbl) lbl.textContent = label + " session";
  sPomoUpdate();
}
function sPomoToggle() {
  const btn = document.getElementById("sPomoPlayBtn");
  if (sPomoRunning) {
    clearInterval(sPomoInterval);
    sPomoRunning = false;
    if (btn)
      btn.innerHTML =
        '<i class="ti ti-player-play" aria-hidden="true"></i> Resume';
    return;
  }
  sPomoRunning = true;
  if (btn)
    btn.innerHTML =
      '<i class="ti ti-player-pause" aria-hidden="true"></i> Pause';
  sPomoInterval = setInterval(() => {
    if (sPomoSeconds === 0) {
      if (sPomoMinutes === 0) {
        clearInterval(sPomoInterval);
        sPomoRunning = false;
        sPomoSession++;
        const s = document.getElementById("sPomoSessions");
        if (s) s.textContent = `Session ${sPomoSession} of 4`;
        if (btn)
          btn.innerHTML =
            '<i class="ti ti-player-play" aria-hidden="true"></i> Start';
        acToast("Pomodoro complete!");
        return;
      }
      sPomoMinutes--;
      sPomoSeconds = 59;
    } else sPomoSeconds--;
    sPomoUpdate();
  }, 1000);
}
function sPomoReset() {
  clearInterval(sPomoInterval);
  sPomoRunning = false;
  sPomoMinutes = sPomoModeMinutes;
  sPomoSeconds = 0;
  const b = document.getElementById("sPomoPlayBtn");
  if (b)
    b.innerHTML = '<i class="ti ti-player-play" aria-hidden="true"></i> Start';
  sPomoUpdate();
}
function sPomoUpdate() {
  const txt = `${String(sPomoMinutes).padStart(2, "0")}:${String(sPomoSeconds).padStart(2, "0")}`;
  const el = document.getElementById("sPomoDisplay");
  if (el) el.textContent = txt;
  sPomoMirrorIds.forEach((id) => {
    const m = document.getElementById(id);
    if (m) m.textContent = txt;
  });
}
// Register another element to mirror the live countdown, and paint it
// immediately with whatever this timer is currently showing (it may already
// be mid-session from another surface).
function sPomoRegisterMirror(elId) {
  if (!sPomoMirrorIds.includes(elId)) sPomoMirrorIds.push(elId);
  sPomoUpdate();
}
// Flashcard parsing — turns Lecture Lab's AI-generated "questions" text
// into {q, a} pairs for the engine below. Moved here from app.js (Session
// 18) since its only caller, _processLabFile's isPanel branch, exists
// purely to feed sLoadFlashcards -- the parser belongs next to the engine
// it feeds, not in the file that happens to call both.
function _parseFlashcards(questionsText) {
  if (!questionsText) return [];
  const cards = [];
  // Try numbered Q&A pairs: "1. Question\nAnswer: ..." or "1. Q: ...\nA: ..."
  const blocks = questionsText.split(/\n\s*\n/).filter(Boolean);
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;
    // Strip leading "1." or "**1.**" numbering
    let q = lines[0]
      .replace(/^\*?\*?\d+[\.\)]\*?\*?\s*/, "")
      .replace(/^\*\*Q:?\s*/i, "")
      .replace(/\*\*$/, "")
      .trim();
    let a = lines
      .slice(1)
      .join(" ")
      .replace(/^A:?\s*/i, "")
      .replace(/^Answer:?\s*/i, "")
      .trim();
    if (q && a) cards.push({ q, a });
  }
  // Fallback: look for Q:/A: pattern anywhere
  if (!cards.length) {
    const qMatches = [
      ...questionsText.matchAll(
        /(?:^|\n)\s*(?:\d+[\.\)]?\s*)?(?:Q:|Question:?)\s*(.+?)(?:\n\s*(?:A:|Answer:?)\s*(.+?))?(?=\n\s*(?:\d+[\.\)]|\n|$))/gis,
      ),
    ];
    qMatches.forEach((m) => {
      if (m[1] && m[2]) cards.push({ q: m[1].trim(), a: m[2].trim() });
    });
  }
  return cards.slice(0, 30);
}

// ── Flashcard engine — shared by Exam Sprint's Flashcard Drill and Study
// Deck's Lab flashcard tab (see _processLabFile in app.js, which calls
// _parseFlashcards above then sLoadFlashcards below). One active deck at a
// time; `target` says which DOM ids to render into and how to describe an
// empty deck. Cards may be {title, answer} (Sprint) or {q, a} (Lab).
const _SFLASH_DEFAULT_TARGET = {
  displayId: "sFlashcardDisplay",
  actionsId: "sFlashcardActions",
  badgeId: "sSprintCardCount",
  emptyMsg: "Add cards to the Flashcard Drill column in Exam Sprint.",
};
function _sFlashFront(card) {
  return card.q ?? card.title ?? "";
}
function _sFlashBack(card) {
  return card.a ?? card.answer ?? "Say it out loud, then rate yourself.";
}
function sLoadFlashcards(cards, target) {
  sFlashcards = cards || sSprintCards.flashcard || [];
  sFlashIdx = 0;
  sFlashFlipped = false;
  sFlashKnown = new Set();
  sFlashTarget = target || _SFLASH_DEFAULT_TARGET;
  if (sFlashTarget.tabId) {
    const tab = document.getElementById(sFlashTarget.tabId);
    if (tab) tab.style.display = sFlashcards.length ? "" : "none";
  }
  if (sFlashTarget.badgeId) {
    const badge = document.getElementById(sFlashTarget.badgeId);
    if (badge) badge.textContent = `${sFlashcards.length} cards`;
  }
  sShowFlashcard();
}
function sShowFlashcard() {
  if (!sFlashTarget) sFlashTarget = _SFLASH_DEFAULT_TARGET;
  const disp = document.getElementById(sFlashTarget.displayId);
  const acts = sFlashTarget.actionsId
    ? document.getElementById(sFlashTarget.actionsId)
    : null;
  if (!disp) return;

  if (!sFlashcards.length) {
    disp.innerHTML = `<div class="acad-empty-state"><i class="ti ti-cards" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>${sFlashTarget.emptyMsg}</div></div>`;
    if (acts) acts.style.display = "none";
    return;
  }

  if (sFlashIdx >= sFlashcards.length) {
    const total = sFlashcards.length;
    const known = sFlashKnown.size;
    disp.innerHTML = `<div class="acad-flashcard-done">
      <div class="acad-fc-done-emoji">${known === total ? "🏆" : "📚"}</div>
      <div class="acad-fc-done-title">${known === total ? "Perfect round!" : `${known} / ${total} cards known`}</div>
      <div class="acad-fc-done-sub">${known < total ? `${total - known} card${total - known > 1 ? "s" : ""} to review again.` : "You nailed every card!"}</div>
      <button class="acad-action-btn" onclick="sRestartFlashcards()">↻ Go again</button>
    </div>`;
    if (acts) acts.style.display = "none";
    return;
  }

  const card = sFlashcards[sFlashIdx];
  const known = sFlashKnown.size;
  const total = sFlashcards.length;
  const cardHtml = `<div class="acad-fc-progress"><strong>${known}</strong> / ${total} known · card ${sFlashIdx + 1} of ${total}</div><div class="acad-flashcard" onclick="sFlipCard()"><div class="acad-flashcard-inner ${sFlashFlipped ? "acad-flashcard-inner--flipped" : ""}"><div class="acad-flashcard-front"><div class="acad-fc-label">Question</div><div class="acad-fc-text">${acEsc(_sFlashFront(card))}</div><div class="acad-fc-hint">Tap to flip</div></div><div class="acad-flashcard-back"><div class="acad-fc-label">Answer</div><div class="acad-fc-text">${acEsc(_sFlashBack(card))}</div></div></div></div>`;

  if (acts) {
    // Split layout (Exam Sprint): actions live in a separate, pre-existing div.
    disp.innerHTML = cardHtml;
    acts.style.display = sFlashFlipped ? "flex" : "none";
  } else {
    // Single-container layout (Study Deck's Lab tab): no separate actions
    // div exists in that template, so render them inline once flipped.
    const inlineActs = sFlashFlipped
      ? `<div class="acad-fc-inline-actions"><button class="acad-action-btn acad-action-btn--red" onclick="sFlashcardRespond('again')">✗ Again</button><button class="acad-action-btn acad-action-btn--teal" onclick="sFlashcardRespond('known')">✓ Known</button></div>`
      : "";
    disp.innerHTML = cardHtml + inlineActs;
  }
}
function sFlipCard() {
  sFlashFlipped = !sFlashFlipped;
  sShowFlashcard();
}
function sFlashcardRespond(rating) {
  if (rating === "easy" || rating === "good" || rating === "known")
    sFlashKnown.add(sFlashIdx);
  sFlashIdx++;
  sFlashFlipped = false;
  sShowFlashcard();
  if (rating === "easy" || rating === "good") acToast("Nice, keep going!");
}
function sRestartFlashcards() {
  sFlashIdx = 0;
  sFlashFlipped = false;
  sFlashKnown = new Set();
  sShowFlashcard();
}

// ── Create-space modal: academic role selector ──
let _cspAcadRole = "student";
function acadSelectRole(role) {
  _cspAcadRole = role;
  document
    .querySelectorAll(".acad-role-card")
    .forEach((c) =>
      c.classList.toggle("acad-role-card--active", c.dataset.role === role),
    );
}

/* ── Academic class bridge (shared lecturer<->student class) ── */
async function acadAPI(path, body = {}) {
  return await API(path, {
    token: getToken(),
    ...body,
  });
}
// Lecturer: publish/show class code + live roster
async function lPublishClass() {
  const d = adData();
  if (d.classCode) {
    lRenderClassCode(d.classCode);
    return;
  }
  const meta = getSpaces().find((s) => s.id === _adId) || {};
  try {
    const r = await acadAPI("/api/acad/class/create", {
      name: meta.name || "My Class",
    });
    if (r && r.ok) {
      adSave({ classCode: r.code });
      _lLoadActiveClass(r.code);
      lRenderClasses(); // refreshes the "Active Classes" KPI + welcome "Classes" stat for the newly-created class
      acToast("Class published, code " + r.code);
    }
  } catch (e) {
    acToast((e && e.message) || "Could not publish class");
  }
}
function lRenderClassCode(code) {
  const btn = document.getElementById("lClassPublishBtn");
  if (btn) btn.style.display = "none";
  const body = document.getElementById("lClassCodeBody");
  if (body)
    body.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="font-size:28px;font-weight:800;letter-spacing:4px;color:var(--acad-accent);font-family:monospace;">${acEsc(code)}</div><button class="acad-btn-ghost acad-btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText('${acEsc(code)}');acToast('Code copied')">Copy</button></div><p class="acad-brief-desc" style="margin-top:8px;">Share this code. Joined students appear in your Students tab automatically.</p>`;
}
async function lLoadRoster() {
  const d = adData();
  if (!d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/class/roster", { code: d.classCode });
    if (r && r.members) {
      lData.students = r.members.map((m) => ({
        sid: m.sid,
        name: m.name,
        email: "",
        attendance: 0,
        avg_score: null,
        last_active: m.joined,
      }));
      lRenderMetrics();
      lRenderStudents();
      lLoadClassStats(); // fills in real attendance %/avg score, then re-renders
    }
  } catch (e) {
    /* offline / not owner */
  }
}

// Real per-student attendance % + grade average (POST /api/acad/class/stats),
// plus the class-level score distribution / at-risk list Analytics needs.
// Joined members start with placeholder attendance:0/avg_score:null (set
// above) since the roster call alone doesn't carry either -- this fills
// them in for real. Kept as one merged fetch rather than baking the stats
// into the roster endpoint itself, since Analytics needs the class-level
// aggregates (buckets/at-risk/weekly trend) too, not just per-student rows.
let _lClassStats = null;
async function lLoadClassStats() {
  const d = adData();
  if (!d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/class/stats", { code: d.classCode });
    if (!r || !r.ok) return;
    _lClassStats = r;
    lData.students = lData.students.map((s) => {
      const st = r.students[s.sid];
      return st
        ? { ...s, attendance: st.attendance_pct, avg_score: st.avg_score }
        : s;
    });
    lRenderMetrics();
    lRenderStudents();
    lRenderAnalytics();
  } catch (e) {
    /* offline / not owner */
  }
}
// Student: join / list / leave classes
async function sJoinClass() {
  const code = await siModal.input(
    "Join a class",
    "Enter the 6-char code from your lecturer",
    "",
    { confirmLabel: "Join" },
  );
  if (!code) return;
  try {
    const r = await acadAPI("/api/acad/class/join", {
      code: code.trim().toUpperCase(),
    });
    if (r && r.ok) {
      const d = adData();
      const list = d.joinedClasses || [];
      if (!list.find((c) => c.code === r.class.code)) list.push(r.class);
      adSave({ joinedClasses: list });
      sRenderMyClasses();
      _sRenderWelcomeCTAs();
      sLoadFeed();
      sLoadAssignments();
      sLoadExams();
      sLoadLivePolls();
      sLoadMyGrades();
      sLoadMaterials();
      acToast("Joined " + (r.class.name || "class"));
    }
  } catch (e) {
    acToast((e && e.message) || "Could not join, check the code");
  }
}
function sRenderMyClasses() {
  const body = document.getElementById("sMyClassesBody");
  if (!body) return;
  const list = adData().joinedClasses || [];
  if (!list.length) return;
  body.innerHTML = list
    .map(
      (c) =>
        `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(c.name || "Class")}</div><div class="acad-priority-sub">${acEsc(c.subject || "")}${c.owner_name ? " · " + acEsc(c.owner_name) : ""} · code ${acEsc(c.code)}</div><div class="acad-priority-sub" id="sAtt-${acEsc(c.code)}">Attendance –</div><div class="acad-priority-actions"><button class="acad-action-btn acad-action-btn--teal" onclick="sCheckIn('${acEsc(c.code)}')"><i class="ti ti-user-check" aria-hidden="true"></i> Check in</button><button class="acad-action-btn acad-action-btn--red" onclick="sLeaveClass('${acEsc(c.code)}')">Leave</button></div></div></div>`,
    )
    .join("");
  list.forEach((c) => sLoadMyAtt(c.code));
}
async function sLeaveClass(code) {
  try {
    await acadAPI("/api/acad/class/leave", { code });
  } catch (e) {}
  const d = adData();
  adSave({
    joinedClasses: (d.joinedClasses || []).filter((c) => c.code !== code),
  });
  sRenderMyClasses();
  _sRenderWelcomeCTAs();
  sLoadFeed();
  sLoadAssignments();
  sLoadExams();
  sLoadLivePolls();
  sLoadMyGrades();
  sLoadMaterials();
  acToast("Left class");
}

/* ── Live attendance (lecturer + student), built on the class bridge ── */
let _lAttSession = null,
  _lAttPoll = null;
async function lTakeAttendance() {
  const d = adData();
  if (!d.classCode) {
    acToast("Publish the class first (Overview → Class Code)");
    return;
  }
  try {
    const r = await acadAPI("/api/acad/attendance/start", {
      code: d.classCode,
    });
    if (r && r.ok) {
      _lAttSession = r.session_id;
      lShowAttPanel(r.checkin_code);
      lPollAtt();
      acToast("Attendance session started");
    }
  } catch (e) {
    acToast((e && e.message) || "Could not start session");
  }
}
function lShowAttPanel(code) {
  const p = document.getElementById("lAttPanel");
  if (!p) return;
  p.style.display = "block";
  p.innerHTML = `<div class="acad-card-header"><span class="acad-card-title">Live Attendance</span><button class="acad-btn-ghost acad-btn-sm" onclick="lEndAttendance()">End session</button></div>
    <div class="acad-card-body"><div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
      <div><div class="acad-label">Check-in code</div><div style="font-size:32px;font-weight:800;letter-spacing:6px;font-family:monospace;color:var(--acad-accent);">${acEsc(code)}</div></div>
      <div><div class="acad-label">Present</div><div style="font-size:32px;font-weight:800;color:var(--text);" id="lAttCount">0</div></div>
    </div><div id="lAttList" style="margin-top:12px;"></div></div>`;
}
function lPollAtt() {
  clearInterval(_lAttPoll);
  const tick = async () => {
    const d = adData();
    if (!_lAttSession) {
      clearInterval(_lAttPoll);
      return;
    }
    try {
      const r = await acadAPI("/api/acad/attendance/session", {
        code: d.classCode,
        session_id: _lAttSession,
      });
      if (r) {
        const c = document.getElementById("lAttCount");
        if (c) c.textContent = `${r.present_count}/${r.total}`;
        const l = document.getElementById("lAttList");
        if (l)
          l.innerHTML =
            (r.records || [])
              .map(
                (x) =>
                  `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(x.name)}</div><div class="acad-priority-sub">${acEsc(String(x.ts).replace("T", " ").slice(0, 16))}</div></div><span class="acad-tag ${x.status === "late" ? "acad-tag--orange" : "acad-tag--teal"}">${acEsc(x.status)}</span></div>`,
              )
              .join("") ||
            '<div class="acad-priority-sub">No check-ins yet.</div>';
      }
    } catch (e) {
      /* keep polling */
    }
  };
  tick();
  _lAttPoll = setInterval(tick, 4000);
}
async function lEndAttendance() {
  clearInterval(_lAttPoll);
  const d = adData();
  try {
    await acadAPI("/api/acad/attendance/end", {
      code: d.classCode,
      session_id: _lAttSession,
    });
  } catch (e) {}
  _lAttSession = null;
  const p = document.getElementById("lAttPanel");
  if (p) p.style.display = "none";
  acToast("Attendance saved to the register");
  lLoadRegister();
  lLoadActivity();
}
async function lLoadRegister() {
  const d = adData();
  if (!d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/attendance/register", {
      code: d.classCode,
    });
    if (r && r.rows) {
      r.rows.forEach((row) => {
        const s = lData.students.find((x) => x.sid === row.sid);
        if (s) s.attendance = row.pct;
      });
      lRenderStudents();
    }
  } catch (e) {
    /* not owner / offline */
  }
}
// Student check-in + attendance %
async function sCheckIn(code) {
  const cc = await siModal.input(
    "Check in",
    "Enter the check-in code from your lecturer",
    "",
    { confirmLabel: "Check in" },
  );
  if (!cc) return;
  try {
    const r = await acadAPI("/api/acad/attendance/checkin", {
      code,
      checkin_code: cc.trim().toUpperCase(),
    });
    if (r && r.ok) {
      acToast("Checked in: " + r.status);
      sLoadMyAtt(code);
    }
  } catch (e) {
    acToast((e && e.message) || "Check-in failed");
  }
}
async function sLoadMyAtt(code) {
  try {
    const r = await acadAPI("/api/acad/attendance/mine", { code });
    const el = document.getElementById("sAtt-" + code);
    if (r && el)
      el.textContent = `Attendance ${r.pct}% (${r.present}/${r.total})${r.open_session ? " · session OPEN" : ""}`;
  } catch (e) {}
}

/* ── Announcements + class feed (built on the class bridge) ── */
async function lPostAnnounce() {
  const d = adData();
  if (!d.classCode) {
    acToast("Publish the class first (Overview → Class Code)");
    return;
  }
  const ta = document.getElementById("lAnnounceInput");
  const text = ta ? ta.value.trim() : "";
  if (!text) return;
  try {
    const r = await acadAPI("/api/acad/announce", { code: d.classCode, text });
    if (r && r.ok) {
      if (ta) ta.value = "";
      acToast("Posted, students notified");
      lLoadAnnouncements();
      lLoadActivity();
    }
  } catch (e) {
    acToast((e && e.message) || "Could not post");
  }
}
async function lLoadAnnouncements() {
  const d = adData();
  if (!d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/feed", { code: d.classCode });
    if (r) lRenderAnnouncements(r.announcements || []);
  } catch (e) {}
}
function lRenderAnnouncements(anns) {
  const el = document.getElementById("lAnnounceList");
  if (!el) return;
  el.innerHTML = anns.length
    ? anns
        .map(
          (a) =>
            `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(a.text)}</div><div class="acad-priority-sub">${acEsc(String(a.ts).replace("T", " ").slice(0, 16))}</div></div><button class="acad-action-btn acad-action-btn--red" onclick="lDeleteAnnounce('${acEsc(a.id)}')">Delete</button></div>`,
        )
        .join("")
    : '<div class="acad-priority-sub">No announcements yet.</div>';
}
async function lDeleteAnnounce(id) {
  const d = adData();
  try {
    await acadAPI("/api/acad/announce/delete", { code: d.classCode, id });
  } catch (e) {}
  lLoadAnnouncements();
}
async function sLoadFeed() {
  const list = adData().joinedClasses || [];
  const body = document.getElementById("sFeedBody");
  if (!body) return;
  if (!list.length) {
    body.innerHTML = `<div class="acad-empty-state"><i class="ti ti-bell" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No announcements yet. Join a class to see its feed.</div></div>`;
    return;
  }
  let all = [];
  for (const c of list) {
    try {
      const r = await acadAPI("/api/acad/feed", { code: c.code });
      if (r && r.announcements)
        all = all.concat(
          r.announcements.map((a) =>
            Object.assign({}, a, { _class: c.name || r.class_name || c.code }),
          ),
        );
    } catch (e) {}
  }
  all.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  if (!all.length) {
    body.innerHTML = `<div class="acad-empty-state"><i class="ti ti-bell" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No announcements yet. Join a class to see its feed.</div></div>`;
    return;
  }
  body.innerHTML = all
    .slice(0, 30)
    .map(
      (a) =>
        `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(a.text)}</div><div class="acad-priority-sub">${acEsc(a._class)} · ${acEsc(String(a.ts).replace("T", " ").slice(0, 16))}</div></div></div>`,
    )
    .join("");
}
function sEnableNotifs() {
  if (typeof _pushSetup === "function") {
    _pushSetup().then(() => acToast("Notifications on (if you allowed them)"));
  } else acToast("Notifications unavailable on this device");
}

/* ── Gradebook: shared class assignments + submissions + grading ── */
async function lLoadClassAssignments() {
  const d = adData();
  const el = document.getElementById("lAssignList");
  if (!el || !d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/assignment/list", { code: d.classCode });
    const items = (r && r.assignments) || [];
    const cnt = document.getElementById("lAssignCount");
    if (cnt) cnt.textContent = `${items.length} assignments`;
    el.innerHTML = items.length
      ? items
          .map(
            (a) =>
              `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(a.title)}</div><div class="acad-priority-sub">${a.due ? "due " + acEsc(a.due) : ""}${a.points ? " · " + acEsc(a.points) + " pts" : ""}</div></div><div class="acad-priority-actions"><button class="acad-action-btn acad-action-btn--teal" onclick="lAssessSegment('grading')">Grade</button><button class="acad-action-btn acad-action-btn--red" onclick="lDeleteClassAssignment('${acEsc(a.id)}')">Delete</button></div></div>`,
          )
          .join("")
      : '<div class="acad-priority-sub">No class assignments yet.</div>';
  } catch (e) {}
}
async function lDeleteClassAssignment(id) {
  const d = adData();
  try {
    await acadAPI("/api/acad/assignment/delete", { code: d.classCode, id });
  } catch (e) {}
  lLoadClassAssignments();
}
let _lPendingSubs = []; // {aid, sid, title, text} for every currently-ungraded assignment submission -- feeds lAutoMark()
async function lLoadGrading() {
  const d = adData();
  const el = document.getElementById("lGradingQueue");
  if (!el || !d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/assignment/list", { code: d.classCode });
    const items = (r && r.assignments) || [];
    let html = "";
    _lPendingSubs = [];
    for (const a of items) {
      const sr = await acadAPI("/api/acad/submissions", {
        code: d.classCode,
        assignment_id: a.id,
      });
      const subs = (sr && sr.submissions) || [];
      if (!subs.length) continue;
      subs
        .filter((s) => !s.graded)
        .forEach((s) =>
          _lPendingSubs.push({ aid: a.id, sid: s.sid, title: a.title, text: s.text || "" }),
        );
      html += `<div style="margin-bottom:10px;"><div class="acad-card-title" style="margin-bottom:6px;">${acEsc(a.title)}</div>`;
      html += subs
        .map(
          (s) =>
            `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(s.name)} ${s.graded ? '<span class="acad-tag acad-tag--teal">' + acEsc(s.grade) + "</span>" : ""}</div><div class="acad-priority-sub">${acEsc(String(s.text || "").slice(0, 140))}</div><div class="acad-priority-actions"><input class="acad-search-inline" style="width:64px;" id="g-${a.id}-${s.sid}" placeholder="Grade" value="${acEsc(s.grade || "")}"><button class="acad-action-btn acad-action-btn--teal" onclick="lSubmitGrade('${a.id}','${s.sid}')">Save</button></div></div></div>`,
        )
        .join("");
      html += "</div>";
    }
    el.innerHTML =
      html ||
      '<div class="acad-priority-sub">No submissions to grade yet.</div>';
  } catch (e) {}
}
async function lSubmitGrade(aid, sid) {
  const d = adData();
  const inp = document.getElementById(`g-${aid}-${sid}`);
  const grade = inp ? inp.value.trim() : "";
  try {
    await acadAPI("/api/acad/grade", {
      code: d.classCode,
      assignment_id: aid,
      sid,
      grade,
    });
    acToast("Grade saved, student notified");
    lLoadGrading();
    lLoadGradebook();
    lLoadSubmissionQueue();
  } catch (e) {
    acToast((e && e.message) || "Could not save grade");
  }
}
// Student: class assignments + submit + grades
async function sLoadAssignments() {
  const list = adData().joinedClasses || [];
  const body = document.getElementById("sAssignmentsBody");
  if (!body) return;
  const emptyState = `<div class="acad-empty-state"><i class="ti ti-file-text" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No assignments yet. Join a class to see and submit work.</div></div>`;
  if (!list.length) {
    body.innerHTML = emptyState;
    _sRenderWelcomeStats(0);
    return;
  }
  let rows = [];
  for (const c of list) {
    try {
      const g = await acadAPI("/api/acad/grades/mine", { code: c.code });
      if (g && g.items)
        g.items.forEach((it) =>
          rows.push(
            Object.assign({}, it, { code: c.code, cls: c.name || c.code }),
          ),
        );
    } catch (e) {}
  }
  _sRenderWelcomeStats(rows.filter((r) => !r.submitted).length);
  if (!rows.length) {
    body.innerHTML = emptyState;
    return;
  }
  body.innerHTML = rows
    .map(
      (it) =>
        `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(it.title)}</div><div class="acad-priority-sub">${acEsc(it.cls)}${it.due ? " · due " + acEsc(it.due) : ""} · ${it.graded ? "Graded: " + acEsc(it.grade) : it.submitted ? "Submitted" : "Not submitted"}</div>${it.graded && it.feedback ? '<div class="acad-priority-sub">Feedback: ' + acEsc(it.feedback) + "</div>" : ""}</div><button class="acad-action-btn acad-action-btn--teal" onclick="sSubmitAssignment('${acEsc(it.code)}','${acEsc(it.assignment_id)}')">${it.submitted ? "Resubmit" : "Submit"}</button></div>`,
    )
    .join("");
}
async function sSubmitAssignment(code, aid) {
  const text = await siModal.input(
    "Submit assignment",
    "Paste your work or a link",
    "",
    { confirmLabel: "Submit" },
  );
  if (!text) return;
  try {
    await acadAPI("/api/acad/submit", { code, assignment_id: aid, text });
    acToast("Submitted");
    sLoadAssignments();
  } catch (e) {
    acToast((e && e.message) || "Submit failed");
  }
}

/* ── Student exams: list assigned exams, take (timed), submit ── */
let _sxTimer = null,
  _sxCtx = null,
  _sxAnswers = {}, // question index -> answer string -- the source of truth,
  // the DOM only ever shows one question at a time so it can't be re-scanned
  // at submit time the way a single long scrollable list could be
  _sxCurrentQ = 0; // position into _sxCtx.questions currently on screen
async function sLoadExams() {
  const list = adData().joinedClasses || [];
  const body = document.getElementById("sExamsBody");
  if (!body) return;
  const emptyState = `<div class="acad-empty-state"><i class="ti ti-clipboard-text" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No exams assigned yet. Join a class to take exams.</div></div>`;
  let rows = [];
  for (const c of list) {
    try {
      const r = await acadAPI("/api/acad/exam/assigned", { code: c.code });
      ((r && r.exams) || []).forEach((e) =>
        rows.push(
          Object.assign({}, e, { _code: c.code, _cls: c.name || c.code }),
        ),
      );
    } catch (e) {}
  }
  if (!rows.length) {
    body.innerHTML = emptyState;
    return;
  }
  body.innerHTML = rows
    .map((e) => {
      const auto = e.auto_pct != null ? ` · auto ${e.auto_pct}%` : "";
      const status =
        (e.graded
          ? "Graded: " + acEsc(e.grade || "–")
          : e.submitted
            ? "Submitted"
            : "Not taken") + auto;
      const label = e.graded ? "Review" : e.submitted ? "Resume" : "Take";
      const kindTag = e.kind === "quiz" ? ' <span class="acad-tag acad-tag--orange">Quiz</span>' : "";
      return `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(e.title)}${kindTag}</div><div class="acad-priority-sub">${acEsc(e._cls)} · ${e.questions_per_student || "?"} questions · ${e.duration || "?"} min · ${status}</div></div><button class="acad-action-btn acad-action-btn--teal" onclick="sTakeExam('${acEsc(e._code)}','${acEsc(e.exam_id)}')">${label}</button></div>`;
    })
    .join("");
}
async function sTakeExam(code, examId) {
  let r;
  try {
    r = await acadAPI("/api/acad/exam/take", { code, exam_id: examId });
  } catch (e) {
    acToast((e && e.message) || "Could not open exam");
    return;
  }
  if (!r || !r.exam) return;
  sExamRenderTaker(code, r.exam, r.submission);
}
// Draft answers persist locally so "Save & Exit" is genuinely resumable --
// there's no per-question autosave on the server, this is intentionally
// local-only (see the Phase 5 plan).
function _sxDraftKey(code, examId) {
  return `sx_draft_${S.sid || ""}_${code}_${examId}`;
}
function _sxSaveDraft() {
  if (!_sxCtx) return;
  try {
    localStorage.setItem(
      _sxDraftKey(_sxCtx.code, _sxCtx.examId),
      JSON.stringify(_sxAnswers),
    );
  } catch (e) {}
}
function _sxClearDraft(code, examId) {
  try {
    localStorage.removeItem(_sxDraftKey(code, examId));
  } catch (e) {}
}

function sExamRenderTaker(code, exam, submission) {
  sExamCloseTaker();
  const graded = !!(submission && submission.graded);
  _sxCtx = { code, examId: exam.id, questions: exam.questions || [] };
  _sxCurrentQ = 0;
  _sxAnswers = {};
  if (submission && submission.answers)
    submission.answers.forEach((a) => {
      _sxAnswers[a.i] = a.a;
    });
  if (!graded) {
    try {
      const draft = JSON.parse(
        localStorage.getItem(_sxDraftKey(code, exam.id)) || "null",
      );
      if (draft) Object.assign(_sxAnswers, draft);
    } catch (e) {}
  }

  const banner = graded
    ? `<div class="sx-graded">Graded: <strong>${acEsc(submission.grade || "–")}</strong>${submission.feedback ? " (" + acEsc(submission.feedback) + ")" : ""}</div>`
    : submission
      ? `<div class="sx-graded">Submitted, you can revise and resubmit until it's graded.</div>`
      : "";
  const foot = graded
    ? `<button class="acad-action-btn acad-action-btn--teal" onclick="sExamCloseTaker()">Close</button>`
    : `<button class="acad-action-btn acad-action-btn--red" data-onclick="sExamCancel">Cancel</button><button class="acad-action-btn acad-action-btn--teal" data-onclick="sSubmitExam" data-onclick-arg0="${code}" data-onclick-arg1="${exam.id}">${submission ? "Resubmit" : "Submit exam"}</button>`;

  const ov = document.createElement("div");
  ov.className = "sx-overlay";
  ov.id = "sxOverlay";
  ov.innerHTML = `<div class="sx-modal sx-modal--wide">
    <div class="sx-head">
      <div style="flex:1">
        <div class="sx-title">${acEsc(exam.title)}${exam.kind === "quiz" ? ' <span class="acad-tag acad-tag--orange">Quiz</span>' : ""}</div>
        <div class="sx-subtitle" id="sxSubtitle"></div>
      </div>
      ${graded ? "" : '<div class="sx-timer" id="sxTimer"></div>'}
      ${graded ? "" : '<button class="sx-savebtn" data-onclick="sExamSaveExit">Save &amp; Exit</button>'}
      <button class="sx-x" onclick="sExamCloseTaker()" aria-label="Close">✕</button>
    </div>
    ${banner}
    <div class="sx-layout">
      <div class="sx-navgrid" id="sxNavGrid"></div>
      <div class="sx-qpanel" id="sxQPanel"></div>
      ${
        graded
          ? ""
          : `<div class="sx-info-panel">
        <div class="sx-info-box sx-info-box--warn">
          <div class="sx-info-title">Auto-submits at 0:00</div>
          <div class="sx-info-body">Answers stay hidden until you submit. Your question set is different from your classmates' — same set if you reload.</div>
        </div>
        <div class="sx-info-box">
          <div class="sx-info-title">Grading</div>
          <div class="sx-info-body">Multiple-choice grades instantly on submit. Free-response questions are reviewed by your instructor.</div>
        </div>
      </div>`
      }
    </div>
    <div class="sx-foot">${foot}</div>
  </div>`;
  document.body.appendChild(ov);
  _sxRenderQuestionPanel(graded);

  if (!graded && exam.duration) {
    const deadline = Date.now() + exam.duration * 60 * 1000;
    const tick = () => {
      const ms = deadline - Date.now();
      const el = document.getElementById("sxTimer");
      if (ms <= 0) {
        clearInterval(_sxTimer);
        _sxTimer = null;
        acToast("Time up, submitting");
        sSubmitExam(code, exam.id, true);
        return;
      }
      const m = Math.floor(ms / 60000),
        s = Math.floor((ms % 60000) / 1000);
      if (el) el.textContent = `⏱ ${m}:${String(s).padStart(2, "0")}`;
    };
    tick();
    _sxTimer = setInterval(tick, 1000);
  }
}

// Re-renders the navigator grid + the single current question -- called on
// open and every time the student navigates, without rebuilding the modal.
function _sxRenderQuestionPanel(graded) {
  if (!_sxCtx) return;
  const qs = _sxCtx.questions;
  const total = qs.length;
  const sub = document.getElementById("sxSubtitle");
  if (sub) sub.textContent = total ? `Question ${_sxCurrentQ + 1} of ${total}` : "";

  const nav = document.getElementById("sxNavGrid");
  if (nav) {
    nav.innerHTML = qs
      .map((q, n) => {
        const answered = String(_sxAnswers[q.i] || "").trim().length > 0;
        const cls =
          n === _sxCurrentQ
            ? "sx-navbtn--current"
            : answered
              ? "sx-navbtn--answered"
              : "";
        return `<button type="button" class="sx-navbtn ${cls}" data-onclick="sExamGoTo" data-onclick-arg0="${n}">${n + 1}</button>`;
      })
      .join("");
  }

  const panel = document.getElementById("sxQPanel");
  if (!panel) return;
  if (!total) {
    panel.innerHTML = `<div class="acad-priority-sub">This exam has no questions.</div>`;
    return;
  }
  const q = qs[_sxCurrentQ];
  const val = _sxAnswers[q.i] || "";
  let input;
  if (q.type === "mcq" && Array.isArray(q.options) && q.options.length) {
    input =
      `<div class="sx-opts">` +
      q.options
        .map(
          (opt) =>
            `<label class="sx-opt"><input type="radio" name="sxq-${q.i}" value="${acEsc(opt)}" ${val === opt ? "checked" : ""} ${graded ? "disabled" : ""} onchange="_sxCaptureAnswer(${q.i}, this.value)"/><span>${acEsc(opt)}</span></label>`,
        )
        .join("") +
      `</div>`;
  } else {
    input = `<textarea class="sx-ans" ${graded ? "readonly" : ""} placeholder="Type your answer…" oninput="_sxCaptureAnswer(${q.i}, this.value)">${acEsc(val)}</textarea>`;
  }
  panel.innerHTML = `
    <div class="sx-qn">${q.type === "mcq" ? '<span class="sx-qtag">Multiple choice</span>' : '<span class="sx-qtag">Free response</span>'}</div>
    <div class="sx-qtext">${acEsc(q.q)}</div>
    ${input}
    <div class="sx-qfoot">
      <button class="acad-btn-ghost acad-btn-sm" data-onclick="sExamNav" data-onclick-arg0="-1" ${_sxCurrentQ === 0 ? "disabled" : ""}>Previous</button>
      <button class="acad-btn-teal acad-btn-sm" data-onclick="sExamNav" data-onclick-arg0="1" ${_sxCurrentQ === total - 1 ? "disabled" : ""}>Next</button>
    </div>`;
}
function _sxCaptureAnswer(i, value) {
  _sxAnswers[i] = value;
  _sxSaveDraft();
  // Only the navigator's answered/unanswered coloring needs to refresh --
  // re-rendering the whole question panel here would steal input focus.
  const nav = document.getElementById("sxNavGrid");
  if (nav && _sxCtx) {
    const n = _sxCtx.questions.findIndex((q) => q.i === i);
    const btn = nav.children[n];
    if (btn && n !== _sxCurrentQ) {
      const answered = String(value || "").trim().length > 0;
      btn.className = "sx-navbtn" + (answered ? " sx-navbtn--answered" : "");
    }
  }
}
function sExamGoTo(idx) {
  if (!_sxCtx) return;
  _sxCurrentQ = Math.max(0, Math.min(_sxCtx.questions.length - 1, +idx));
  _sxRenderQuestionPanel(false);
}
function sExamNav(delta) {
  sExamGoTo(_sxCurrentQ + +delta);
}
function sExamSaveExit() {
  _sxSaveDraft();
  acToast("Saved — resume anytime before it's due.");
  sExamCloseTaker();
}
function sExamCancel() {
  if (_sxCtx) _sxClearDraft(_sxCtx.code, _sxCtx.examId);
  sExamCloseTaker();
}
function sExamCloseTaker() {
  if (_sxTimer) {
    clearInterval(_sxTimer);
    _sxTimer = null;
  }
  sStopGroupLive(); // in case a group chat's live connection is what's currently open on #sxOverlay
  const ov = document.getElementById("sxOverlay");
  if (ov) ov.remove();
  _sxCtx = null;
}
async function sSubmitExam(code, examId, auto) {
  if (!_sxCtx) return;
  const answers = _sxCtx.questions.map((q) => ({
    i: q.i,
    q: q.q,
    a: _sxAnswers[q.i] || "",
  }));
  if (!auto && !answers.some((a) => a.a.trim())) {
    acToast("Answer at least one question first");
    return;
  }
  try {
    const r = await acadAPI("/api/acad/exam/submit", {
      code,
      exam_id: examId,
      answers,
    });
    const ap = r && r.auto && r.auto.auto_pct;
    acToast(ap != null ? `Submitted · auto-score ${ap}%` : "Exam submitted");
    _sxClearDraft(code, examId);
    sExamCloseTaker();
    sLoadExams();
  } catch (e) {
    acToast((e && e.message) || "Submit failed");
  }
}

/* ── Live session + in-class polls (built on the class bridge) ── */
async function lGoLive() {
  const d = adData();
  if (!d.classCode) {
    acToast("Publish the class first (Overview → Class Code)");
    return;
  }
  const link = await siModal.input(
    "Go live",
    "Paste the meeting link (Zoom / Meet / Jitsi)",
    "",
    { confirmLabel: "Go live" },
  );
  if (link === null || link === undefined) return;
  try {
    await acadAPI("/api/acad/live/set", {
      code: d.classCode,
      link: link || "",
      title: "Live class",
    });
    acToast("Class is live, students notified");
    lLoadLive();
  } catch (e) {
    acToast((e && e.message) || "Could not go live");
  }
}
async function lEndLive() {
  const d = adData();
  try {
    await acadAPI("/api/acad/live/clear", { code: d.classCode });
  } catch (e) {}
  acToast("Live session ended");
  lLoadLive();
}
async function lLoadLive() {
  const d = adData();
  if (!d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/class/get", { code: d.classCode });
    const el = document.getElementById("lLiveStatus");
    if (el) {
      const live = r && r.class && r.class.live;
      el.innerHTML = live
        ? `🔴 Live: ${acEsc(live.title || "Live class")} ${live.link ? '· <a href="' + acEsc(live.link) + '" target="_blank" style="color:var(--acad-accent)">link</a> ' : ""}· <button class="acad-action-btn acad-action-btn--red" onclick="lEndLive()">End</button>`
        : "Not live.";
    }
  } catch (e) {}
}
async function lCreatePoll() {
  const d = adData();
  if (!d.classCode) {
    acToast("Publish the class first");
    return;
  }
  const f = await siModal.form("New poll", [
    {
      id: "q",
      label: "Question",
      placeholder: "e.g. Which topic next?",
      required: true,
    },
    { id: "o1", label: "Option 1", required: true },
    { id: "o2", label: "Option 2", required: true },
    { id: "o3", label: "Option 3 (optional)" },
    { id: "o4", label: "Option 4 (optional)" },
  ]);
  if (!f || !f.q) return;
  const options = [f.o1, f.o2, f.o3, f.o4].filter((x) => x && x.trim());
  if (options.length < 2) {
    acToast("Add at least 2 options");
    return;
  }
  try {
    await acadAPI("/api/acad/poll/create", {
      code: d.classCode,
      question: f.q,
      options,
    });
    acToast("Poll opened");
    lLoadPolls();
  } catch (e) {
    acToast((e && e.message) || "Could not create poll");
  }
}
async function lLoadPolls() {
  const d = adData();
  if (!d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/poll/list", { code: d.classCode });
    lRenderPolls((r && r.polls) || [], true);
  } catch (e) {}
}
function lRenderPolls(polls, owner) {
  const el = document.getElementById("lPollList");
  if (!el) return;
  el.innerHTML = polls.length
    ? polls
        .map((p) => {
          const max = Math.max(1, ...p.counts);
          return `<div class="acad-card" style="margin-top:8px;"><div class="acad-card-body"><div class="acad-priority-title" style="margin-bottom:6px;">${acEsc(p.question)} <span class="acad-priority-sub">(${p.total} votes)</span></div>${p.options.map((o, i) => `<div style="margin-bottom:4px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);"><span>${acEsc(o)}</span><span>${p.counts[i]}</span></div><div class="acad-attend-bar" style="width:100%;height:6px;"><div class="acad-attend-fill" style="width:${Math.round((p.counts[i] / max) * 100)}%;background:var(--acad-accent);"></div></div></div>`).join("")}${owner ? `<button class="acad-action-btn acad-action-btn--red" style="margin-top:6px;" onclick="lClosePoll('${p.id}')">Close poll</button>` : ""}</div></div>`;
        })
        .join("")
    : '<div class="acad-priority-sub">No active polls.</div>';
}
async function lClosePoll(pid) {
  const d = adData();
  try {
    await acadAPI("/api/acad/poll/close", { code: d.classCode, poll_id: pid });
  } catch (e) {}
  lLoadPolls();
}
// Student: live banner + vote on polls
async function sLoadLivePolls() {
  const list = adData().joinedClasses || [];
  const body = document.getElementById("sLivePollsBody");
  if (!body) return;
  const emptyState = `<div class="acad-empty-state"><i class="ti ti-broadcast" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>Nothing live right now.</div></div>`;
  if (!list.length) {
    body.innerHTML = emptyState;
    return;
  }
  let html = "";
  for (const c of list) {
    try {
      const g = await acadAPI("/api/acad/class/get", { code: c.code });
      const live = g && g.class && g.class.live;
      if (live)
        html += `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">🔴 ${acEsc(c.name || c.code)} is live</div><div class="acad-priority-sub">${acEsc(live.title || "")}</div></div>${live.link ? `<a class="acad-action-btn acad-action-btn--teal" href="${acEsc(live.link)}" target="_blank">Join</a>` : ""}</div>`;
      const pr = await acadAPI("/api/acad/poll/list", { code: c.code });
      const polls = (pr && pr.polls) || [];
      const mine = (pr && pr.my_votes) || {};
      polls.forEach((p) => {
        const max = Math.max(1, ...p.counts);
        const voted = mine[p.id] !== undefined;
        html += `<div class="acad-card" style="margin-top:8px;"><div class="acad-card-body"><div class="acad-priority-title" style="margin-bottom:6px;">${acEsc(p.question)}</div>${p.options
          .map((o, i) =>
            voted
              ? `<div style="margin-bottom:4px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);"><span>${acEsc(o)}${mine[p.id] === i ? " ✓" : ""}</span><span>${p.counts[i]}</span></div><div class="acad-attend-bar" style="width:100%;height:6px;"><div class="acad-attend-fill" style="width:${Math.round((p.counts[i] / max) * 100)}%;background:var(--acad-accent);"></div></div></div>`
              : `<button class="acad-action-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px;" onclick="sVote('${c.code}','${p.id}',${i})">${acEsc(o)}</button>`,
          )
          .join("")}</div></div>`;
      });
    } catch (e) {}
  }
  body.innerHTML = html || emptyState;
}
async function sVote(code, pid, idx) {
  try {
    await acadAPI("/api/acad/poll/vote", {
      code,
      poll_id: pid,
      option_index: idx,
    });
    sLoadLivePolls();
  } catch (e) {
    acToast((e && e.message) || "Vote failed");
  }
}

// ── Mobile FAB → Sivarr AI quick-chat popup (templates/_modals.html,
//    #ac-chat-sheet-bg) — js/app.js's mobFabTrigger() opens this instead of
//    the usual quick-capture sheet while this panel is active on mobile.
//    Posts to the real /api/chat/stream, the same endpoint and per-user
//    daily quota the main Sivarr AI panel (js/app.js's send()) uses,
//    deliberately without that panel's context-injection/attachments/
//    retry machinery — a lighter quick-ask surface, not a duplicate of it.
function acadChatOpen() {
  $("ac-chat-sheet-bg")?.classList.add("open");
  _acadChatMakeDraggable();
  setTimeout(() => $("ac-chat-input")?.focus(), 200);
}

// Draggable by its header, like any floating widget -- bound once (guarded
// by dataset.dragBound) since acadChatOpen() calls this on every open.
// Pointer Events cover mouse + touch + pen in one listener set; the panel
// starts anchored near the FAB via CSS right/bottom and switches to an
// explicit left/top on first drag so it can end up anywhere on screen,
// clamped to stay fully within the viewport.
function _acadChatMakeDraggable() {
  const sheet = $("ac-chat-sheet");
  const handle = $("ac-chat-drag-handle");
  if (!sheet || !handle || sheet.dataset.dragBound) return;
  sheet.dataset.dragBound = "1";

  let dragging = false,
    startX = 0,
    startY = 0,
    startLeft = 0,
    startTop = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".chat-hdr-btn")) return; // let the close (X) button work
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    const rect = sheet.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    sheet.style.right = "auto";
    sheet.style.bottom = "auto";
    sheet.style.left = `${startLeft}px`;
    sheet.style.top = `${startTop}px`;
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const maxLeft = Math.max(4, window.innerWidth - sheet.offsetWidth - 4);
    const maxTop = Math.max(4, window.innerHeight - sheet.offsetHeight - 4);
    const newLeft = Math.min(Math.max(4, startLeft + (e.clientX - startX)), maxLeft);
    const newTop = Math.min(Math.max(4, startTop + (e.clientY - startY)), maxTop);
    sheet.style.left = `${newLeft}px`;
    sheet.style.top = `${newTop}px`;
  });
  const endDrag = (e) => {
    dragging = false;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}
function acadChatClose() {
  $("ac-chat-sheet-bg")?.classList.remove("open");
}
function acadChatToggle() {
  const bg = $("ac-chat-sheet-bg");
  if (!bg) return;
  if (bg.classList.contains("open")) acadChatClose();
  else acadChatOpen();
}
function acadChatKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    acadChatSend();
  }
}
function _acadChatAddMsg(role, text, isError) {
  const w = $("ac-chat-msgs");
  if (!w) return null;
  const d = document.createElement("div");
  d.className = `msg ${role}`;
  d.innerHTML = `<div class="msg-av">${role === "user" ? acEsc((S.name || "?").charAt(0).toUpperCase()) : "AI"}</div><div class="msg-inner"><div class="msg-bub md-body${isError ? " msg-error" : ""}"></div></div>`;
  const bub = d.querySelector(".msg-bub");
  if (role === "user") bub.textContent = text;
  else bub.innerHTML = isError ? acEsc(text) : renderMarkdown(text);
  w.appendChild(d);
  w.scrollTop = w.scrollHeight;
  return bub;
}
// What tab/role the popup was opened from, so a question like "how am I
// doing in this module" or "what's due here" resolves against the space
// the user is actually looking at, not a blind guess. Injected server-side
// into the Gemini prompt only (routes/ai_chat.py prepends req.context to
// the message it sends the model) -- add_history persists req.message
// alone, so this line never pollutes the user's saved chat history.
function _acadChatContext() {
  const spaceName =
    $("acadSpaceNameLabel")?.textContent?.trim() || "this Academic Space";
  const tabBarId = acadRole === "lecturer" ? "lecturerTabBar" : "studentTabBar";
  const activeTab = document.querySelector(`#${tabBarId} .acad-tab.active`);
  const tabLabel = activeTab ? activeTab.textContent.trim() : "Overview";
  const roleLabel = acadRole === "lecturer" ? "lecturer" : "student";
  return `The user opened this quick-chat from their Academic Space "${spaceName}", where they are a ${roleLabel} currently viewing the "${tabLabel}" tab. If their question relates to this space or tab, use that context.`;
}

async function acadChatSend() {
  const input = $("ac-chat-input");
  const msg = input?.value.trim() || "";
  if (!msg || !S.sid) return;
  _acadChatAddMsg("user", msg);
  input.value = "";
  input.style.height = "auto";

  const btn = $("ac-chat-send");
  if (btn) btn.disabled = true;

  let res;
  try {
    const token = getToken() || "";
    res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sid: S.sid,
        message: msg,
        context: _acadChatContext(),
        token,
      }),
    });
  } catch {
    _acadChatAddMsg(
      "sivarr",
      "Could not reach Sivarr. Check your connection and try again.",
      true,
    );
    if (btn) btn.disabled = false;
    return;
  }

  if (!res.ok) {
    if (res.status === 401) {
      _acadChatAddMsg(
        "sivarr",
        "Your session expired. Please sign in again.",
        true,
      );
    } else if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      _acadChatAddMsg(
        "sivarr",
        data.detail || "You've sent a lot of messages. Please wait a moment.",
        true,
      );
    } else {
      _acadChatAddMsg("sivarr", "Could not reach Sivarr. Please try again.", true);
    }
    if (btn) btn.disabled = false;
    return;
  }

  const bub = _acadChatAddMsg("sivarr", "");
  const msgsEl = $("ac-chat-msgs");
  let fullText = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") break outer;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.done) break outer;
          if (parsed.token) {
            fullText += parsed.token;
            bub.textContent = fullText + "▌";
            if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
          }
        } catch {}
      }
    }
  } catch {
    bub.classList.add("msg-error");
    bub.textContent = "Stream interrupted. Please try again.";
    if (btn) btn.disabled = false;
    return;
  }
  bub.innerHTML = renderMarkdown(fullText);
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  if (btn) btn.disabled = false;
}
