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
function acadOpenSettings() {
  if (typeof openSpaceSettings === "function")
    openSpaceSettings(window.currentSpace || window.currentAcademicSpace);
  else acToast("Space settings coming soon");
}

/* ════════ LECTURER ════════ */
let lData = {
  courses: [],
  students: [],
  quizzes: [],
  assignments: [],
  submissions: [],
};

function lInit() {
  const d = adData();
  lData.courses = d.lCourses || [];
  lData.students = d.lStudents || [];
  lData.quizzes = d.lQuizzes || [];
  lData.assignments = d.lAssignments || [];
  lData.submissions = d.lSubmissions || [];
  lSwitchTab("l-overview");
  lRenderMetrics();
  lRenderOverview();
  if (d.classCode) {
    lRenderClassCode(d.classCode);
    lLoadRoster();
    lLoadRegister();
    lLoadAnnouncements();
    lLoadLive();
    lLoadPolls();
  }
  hostMountExtensions(window.currentSpace || window.currentAcademicSpace);
}
function lRenderMetrics() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = v;
  };
  set("lm-students", lData.students.length || "–");
  set("lm-courses", lData.courses.length || "–");
  const pending = lData.submissions.filter((s) => !s.graded).length;
  set("lm-submissions", pending || "–");
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
  if (tabId === "l-courses") lRenderCourses();
  if (tabId === "l-students") lRenderStudents();
  if (tabId === "l-analytics") lRenderAnalytics();
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
  const pending = lData.submissions.filter((s) => !s.graded).length;
  const cEl = document.getElementById("lSubmissionCount");
  if (cEl) cEl.textContent = `${pending} pending`;
}
function lRenderCourses(filter = "") {
  const grid = document.getElementById("lCourseGrid");
  if (!grid) return;
  const list = filter
    ? lData.courses.filter((c) =>
        c.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : lData.courses;
  const cards = list
    .map(
      (c) => `
    <div class="acad-course-card" onclick="lOpenCourse('${c.id}')">
      <div class="acad-course-card-top"><div class="acad-course-name">${acEsc(c.name)}</div><span class="acad-tag acad-tag--teal">${acEsc(c.code || "")}</span></div>
      <div class="acad-course-meta"><span><i class="ti ti-users" aria-hidden="true"></i> ${c.student_count || 0} students</span><span><i class="ti ti-file" aria-hidden="true"></i> ${c.material_count || 0} materials</span></div>
      <div style="margin-top:10px;"><div class="acad-attend-bar" style="width:100%;height:6px;"><div class="acad-attend-fill" style="width:${c.completion || 0}%;background:var(--acad-accent);"></div></div><div class="acad-priority-sub" style="margin-top:3px;">${c.completion || 0}% curriculum complete</div></div>
    </div>`,
    )
    .join("");
  grid.innerHTML =
    cards +
    `<div class="acad-course-card acad-course-card--add" onclick="lCreateCourse()"><i class="ti ti-plus" style="font-size:24px;opacity:.4;" aria-hidden="true"></i><div>New Course</div></div>`;
}
function lFilterCourses(v) {
  lRenderCourses(v);
}
function lRenderStudents(filter = "", courseId = "") {
  const tb = document.getElementById("lStudentTableBody");
  if (!tb) return;
  let st = lData.students;
  if (filter)
    st = st.filter((s) =>
      (s.name + (s.email || "")).toLowerCase().includes(filter.toLowerCase()),
    );
  if (courseId) st = st.filter((s) => (s.courses || []).includes(courseId));
  if (!st.length) {
    tb.innerHTML = `<tr><td colspan="7" class="acad-table-empty">No students found.</td></tr>`;
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
      <td style="font-size:11px;">${(s.courses || []).map(acEsc).join(", ") || "–"}</td>
      <td><div style="display:flex;align-items:center;gap:6px;"><div class="acad-attend-bar"><div class="acad-attend-fill" style="width:${pct}%;background:${bc};"></div></div><span style="font-size:11px;font-weight:600;color:${bc};">${pct}%</span></div></td>
      <td style="font-size:11px;font-weight:600;color:var(--text);">${s.avg_score != null ? s.avg_score + "%" : "–"}</td>
      <td style="font-size:11px;color:var(--text4);">${acEsc(s.last_active || "–")}</td>
      <td><span class="acad-tag ${pct >= 80 ? "acad-tag--teal" : pct >= 60 ? "acad-tag--orange" : "acad-tag--red"}">${pct >= 80 ? "Active" : pct >= 60 ? "At risk" : "Critical"}</span></td>
      <td><button class="acad-btn-ghost acad-btn-sm" onclick="lViewStudent('${s.id}')">View</button></td>
    </tr>`;
    })
    .join("");
}
function lFilterStudents(v) {
  lRenderStudents(
    v,
    document.getElementById("lStudentCourseFilter")?.value || "",
  );
}
function lFilterByCourse(v) {
  lRenderStudents("", v);
}
function lRenderAnalytics() {
  const chart = document.getElementById("lDistributionChart");
  if (!chart) return;
  const withScores = lData.students.filter((s) => s.avg_score != null);
  if (!withScores.length) return;
  const buckets = [0, 0, 0, 0, 0];
  withScores.forEach((s) => {
    buckets[Math.min(Math.floor(s.avg_score / 20), 4)]++;
  });
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
  if (seg === "exams") lLoadExams();
}
function lRenderAssessLists() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("lQuizCount", `${lData.quizzes.length} quizzes`);
  set("lAssignCount", `${lData.assignments.length} assignments`);
  const ql = document.getElementById("lQuizList");
  if (ql)
    ql.innerHTML = lData.quizzes.length
      ? lData.quizzes
          .map(
            (q) =>
              `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(q.title)}</div><div class="acad-priority-sub">${acEsc(q.course || "–")}${q.questions ? " · " + acEsc(q.questions) + " Qs" : ""}</div></div><button class="acad-action-btn acad-action-btn--red" onclick="lDeleteAssess('quiz','${q.id}')">Delete</button></div>`,
          )
          .join("")
      : `<div class="acad-empty-state"><i class="ti ti-help" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No quizzes yet. Create your first quiz.</div></div>`;
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
  if (kind === "quiz") {
    lData.quizzes = lData.quizzes.filter((q) => q.id !== id);
    adSave({ lQuizzes: lData.quizzes });
  } else {
    lData.assignments = lData.assignments.filter((a) => a.id !== id);
    adSave({ lAssignments: lData.assignments });
  }
  lRenderAssessLists();
}

// ── Exam Builder (Stage 6) ──────────────────────────────────
// Frontend rebuilt on the intact backend: free-text question bank, where each
// student is served `questions_per_student` random questions under a timer.
// Endpoints (v3-native, normal session token): POST /api/acad/exam/list ·
// /create · /delete · assign via POST /api/acad/exam/assign.
let _lExams = [];
async function lLoadExams() {
  const list = document.getElementById("lExamList");
  try {
    const d = await acadAPI("/api/acad/exam/list");
    lRenderExams(d.exams || []);
  } catch (e) {
    if (list)
      list.innerHTML = `<div class="acad-empty-state"><i class="ti ti-alert-triangle" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>Couldn't load exams. Try again.</div></div>`;
  }
}
function lRenderExams(exams) {
  _lExams = exams || [];
  const cEl = document.getElementById("lExamCount");
  if (cEl)
    cEl.textContent = `${_lExams.length} exam${_lExams.length !== 1 ? "s" : ""}`;
  const list = document.getElementById("lExamList");
  if (!list) return;
  list.innerHTML = _lExams.length
    ? _lExams
        .map(
          (e, i) =>
            `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(e.title || "Untitled exam")}</div><div class="acad-priority-sub">${(e.questions || []).length} Qs · ${e.questions_per_student || 0}/student · ${e.duration || 0} min</div></div><div class="acad-priority-actions"><button class="acad-action-btn acad-action-btn--teal" onclick="lAssignExam('${acEsc(e.id)}')">Assign</button><button class="acad-action-btn" onclick="lExamResults('${acEsc(e.id)}')">Results</button><button class="acad-action-btn acad-action-btn--red" onclick="lDeleteExam('${acEsc(e.id)}')">Delete</button></div></div>`,
        )
        .join("")
    : `<div class="acad-empty-state"><i class="ti ti-file-pencil" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No exams yet. Build your first exam.</div></div>`;
}
async function lCreateExam() {
  const f = await siModal.form(
    "New exam",
    [
      {
        id: "title",
        label: "Exam title",
        placeholder: "e.g. Mid-Semester Biology",
        required: true,
      },
      {
        id: "duration",
        label: "Duration (minutes)",
        type: "number",
        placeholder: "60",
        default: "60",
      },
      {
        id: "qps",
        label: "Questions per student",
        type: "number",
        placeholder: "30",
        default: "30",
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
    { confirmLabel: "Create exam" },
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
      questions_per_student: parseInt(f.qps) || 30,
      duration: parseInt(f.duration) || 60,
      lecturer: (window.S && S.name) || "",
    });
    acToast("Exam created");
    lLoadExams();
  } catch (e) {
    acToast((e && e.message) || "Could not create exam");
  }
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
  const ex = (_lExams || []).find((e) => e.id === examId) || {};
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
  ov.innerHTML = `<div class="sx-modal"><div class="sx-head"><div class="sx-title">${acEsc(ex.title || "Exam")}: results (${results.length})</div><button class="sx-x" onclick="sExamCloseTaker()" aria-label="Close">✕</button></div><div class="sx-body">${rowsHtml}</div><div class="sx-foot"><button class="acad-action-btn acad-action-btn--teal" onclick="sExamCloseTaker()">Close</button></div></div>`;
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
function lAutoMark() {
  acToast("Auto-mark: connect a submission batch to begin");
}
async function lCreateCourse() {
  const name = await siModal.input("New course", "e.g. Data Structures", "", {
    confirmLabel: "Create",
  });
  if (!name) return;
  const code = await siModal.input(
    "Course code (optional)",
    "e.g. CSC301",
    "",
    { confirmLabel: "Add" },
  );
  lData.courses.push({
    id: "c_" + Date.now(),
    name,
    code: code || "",
    student_count: 0,
    material_count: 0,
    completion: 0,
  });
  adSave({ lCourses: lData.courses });
  lRenderMetrics();
  lRenderCourses();
  acToast("Course created");
}
function lOpenCourse() {
  acToast("Course detail coming soon");
}
const _lClamp = (v) => Math.max(0, Math.min(100, parseInt(v) || 0));
async function lInviteStudent() {
  const f = await siModal.form("Add student", [
    { id: "name", label: "Name", placeholder: "e.g. Ada Obi", required: true },
    { id: "email", label: "Email", placeholder: "optional" },
    { id: "courses", label: "Course code(s)", placeholder: "comma-separated" },
    { id: "attendance", label: "Attendance %", placeholder: "0-100" },
    { id: "avg_score", label: "Avg score %", placeholder: "0-100" },
  ]);
  if (!f || !f.name) return;
  lData.students.push({
    id: "st_" + Date.now(),
    name: f.name,
    email: f.email || "",
    courses: (f.courses || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    attendance: _lClamp(f.attendance),
    avg_score: f.avg_score ? _lClamp(f.avg_score) : null,
    last_active: "just now",
  });
  adSave({ lStudents: lData.students });
  lRenderMetrics();
  lRenderStudents();
  lRenderAnalytics();
  acToast("Student added");
}
function lViewStudent() {
  acToast("Student detail coming soon");
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
function lAddClass() {
  acToast("Schedule editor coming soon");
}
async function lCreateAssessment() {
  if (_lAssessSeg === "grading") return;
  if (_lAssessSeg === "exams") {
    lCreateExam();
    return;
  }
  const isQuiz = _lAssessSeg === "quizzes";
  const f = await siModal.form(isQuiz ? "New quiz" : "New assignment", [
    {
      id: "title",
      label: "Title",
      placeholder: isQuiz ? "e.g. Week 3 Quiz" : "e.g. Essay 1",
      required: true,
    },
    { id: "course", label: "Course code", placeholder: "optional" },
    {
      id: "extra",
      label: isQuiz ? "Number of questions" : "Due date (YYYY-MM-DD)",
      placeholder: "optional",
    },
  ]);
  if (!f || !f.title) return;
  if (isQuiz) {
    lData.quizzes.push({
      id: "q_" + Date.now(),
      title: f.title,
      course: f.course || "",
      questions: f.extra || "",
    });
    adSave({ lQuizzes: lData.quizzes });
    lRenderAssessLists();
    acToast("Quiz created");
    return;
  }
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
function lLoadDistribution() {
  lRenderAnalytics();
}

/* ════════ STUDENT ════════ */
let sModules = [],
  sCitations = [],
  sGroups = [],
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
  sPomoSession = 1;
let sFlashcards = [],
  sFlashIdx = 0,
  sFlashFlipped = false;
let sTutorModuleCtx = "";

function sInit() {
  const d = adData();
  sModules = d.modules || [];
  sCitations = d.citations || [];
  sGroups = d.groups || [];
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
  sLoadFeed();
  sLoadAssignments();
  sLoadExams();
  sLoadLivePolls();
  hostMountExtensions(window.currentSpace || window.currentAcademicSpace);
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
  if (tabId === "s-vault") sRenderModules();
  if (tabId === "s-sprint") sRenderKanban();
  if (tabId === "s-research") sRenderCitations();
  if (tabId === "s-groups") sRenderGroups();
  if (tabId === "s-tutor") sLoadFlashcards();
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
function sOpenModule() {
  acToast("Module detail coming soon");
}
function sUploadNotes() {
  acToast("File upload coming soon");
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
      <div class="acad-citation-footer">${x.auto ? '<span class="acad-source-badge acad-source-badge--purple">AI Generated</span>' : ""}<button style="margin-left:auto;" class="acad-action-btn" onclick="sCopyCite('${x.id}')">Copy</button><button class="acad-action-btn acad-action-btn--red" onclick="sDeleteCite('${x.id}')">Delete</button></div>
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
function sConnectIndex(n) {
  acToast(n + " integration coming soon");
}
// ── Study Groups ──
function sRenderGroups(filter = "") {
  const grid = document.getElementById("sGroupsGrid");
  if (!grid) return;
  const list = filter
    ? sGroups.filter((g) => g.name.toLowerCase().includes(filter.toLowerCase()))
    : sGroups;
  if (!list.length) {
    grid.innerHTML = `<div class="acad-empty-state"><i class="ti ti-users" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>No study groups yet. Create one to get started.</div></div>`;
    return;
  }
  grid.innerHTML = list
    .map(
      (g) => `
    <div class="acad-group-card" onclick="sOpenGroup('${g.id}')">
      <div class="acad-group-header"><div class="acad-group-name">${acEsc(g.name)}</div><span class="acad-tag acad-tag--teal">${(g.members || []).length || 1} members</span></div>
      <div class="acad-priority-sub" style="margin-top:4px;">${acEsc(g.description || "")}</div>
      <div class="acad-group-footer" style="margin-top:10px;"><span class="acad-priority-sub">${acEsc(g.module || "General")}</span><button class="acad-btn-teal acad-btn-sm">Open</button></div>
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
  const desc = await siModal.input(
    "Description (optional)",
    "What is this group about?",
    "",
    { confirmLabel: "Add" },
  );
  sGroups.push({
    id: "g_" + Date.now(),
    name,
    description: desc || "",
    members: [(window.S && S.name) || "You"],
  });
  adSave({ groups: sGroups });
  sRenderGroups();
  acToast("Group created");
}
function sOpenGroup() {
  acToast("Group room coming soon");
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
  const b = document.getElementById("sPomoPlayBtn");
  if (b)
    b.innerHTML = '<i class="ti ti-player-play" aria-hidden="true"></i> Start';
  sPomoUpdate();
}
function sPomoUpdate() {
  const el = document.getElementById("sPomoDisplay");
  if (el)
    el.textContent = `${String(sPomoMinutes).padStart(2, "0")}:${String(sPomoSeconds).padStart(2, "0")}`;
}
// ── Flashcard sprint (from the Flashcard Drill column) ──
function sLoadFlashcards() {
  sFlashcards = sSprintCards.flashcard || [];
  sFlashIdx = 0;
  sFlashFlipped = false;
  const cnt = document.getElementById("sSprintCardCount");
  if (cnt) cnt.textContent = `${sFlashcards.length} cards`;
  sShowFlashcard();
}
function sShowFlashcard() {
  const disp = document.getElementById("sFlashcardDisplay");
  const acts = document.getElementById("sFlashcardActions");
  if (!disp) return;
  if (!sFlashcards.length) {
    disp.innerHTML = `<div class="acad-empty-state"><i class="ti ti-cards" style="font-size:24px;opacity:.3;" aria-hidden="true"></i><div>Add cards to the Flashcard Drill column in Exam Sprint.</div></div>`;
    if (acts) acts.style.display = "none";
    return;
  }
  const card = sFlashcards[sFlashIdx % sFlashcards.length];
  disp.innerHTML = `<div class="acad-flashcard" onclick="sFlipCard()"><div class="acad-flashcard-inner ${sFlashFlipped ? "acad-flashcard-inner--flipped" : ""}"><div class="acad-flashcard-front"><div class="acad-fc-label">Topic</div><div class="acad-fc-text">${acEsc(card.title)}</div><div class="acad-fc-hint">Tap to flip</div></div><div class="acad-flashcard-back"><div class="acad-fc-label">Recall</div><div class="acad-fc-text">${acEsc(card.answer || "Say it out loud, then rate yourself.")}</div></div></div></div>`;
  if (acts) acts.style.display = sFlashFlipped ? "flex" : "none";
}
function sFlipCard() {
  sFlashFlipped = !sFlashFlipped;
  sShowFlashcard();
}
function sFlashcardRespond(rating) {
  sFlashIdx++;
  sFlashFlipped = false;
  sShowFlashcard();
  if (rating === "easy" || rating === "good") acToast("Nice, keep going!");
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
      lRenderClassCode(r.code);
      lLoadRoster();
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
      const joined = r.members.map((m) => ({
        id: "jm_" + m.sid,
        sid: m.sid,
        name: m.name,
        email: "",
        courses: [],
        attendance: 0,
        avg_score: null,
        last_active: m.joined,
        joinedVia: "code",
      }));
      const manual = (d.lStudents || []).filter((s) => !s.joinedVia);
      lData.students = manual.concat(joined);
      lRenderMetrics();
      lRenderStudents();
    }
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
        const s = lData.students.find(
          (x) => x.sid === row.sid || x.id === "jm_" + row.sid,
        );
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
  if (!body || !list.length) return;
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
  if (!all.length) return;
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
async function lLoadGrading() {
  const d = adData();
  const el = document.getElementById("lGradingQueue");
  if (!el || !d.classCode) return;
  try {
    const r = await acadAPI("/api/acad/assignment/list", { code: d.classCode });
    const items = (r && r.assignments) || [];
    let html = "";
    for (const a of items) {
      const sr = await acadAPI("/api/acad/submissions", {
        code: d.classCode,
        assignment_id: a.id,
      });
      const subs = (sr && sr.submissions) || [];
      if (!subs.length) continue;
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
  } catch (e) {
    acToast((e && e.message) || "Could not save grade");
  }
}
// Student: class assignments + submit + grades
async function sLoadAssignments() {
  const list = adData().joinedClasses || [];
  const body = document.getElementById("sAssignmentsBody");
  if (!body || !list.length) return;
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
  if (!rows.length) return;
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
  _sxCtx = null;
async function sLoadExams() {
  const list = adData().joinedClasses || [];
  const body = document.getElementById("sExamsBody");
  if (!body) return;
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
  if (!rows.length) return; // keep the empty state
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
      return `<div class="acad-priority-item"><div class="acad-priority-meta"><div class="acad-priority-title">${acEsc(e.title)}</div><div class="acad-priority-sub">${acEsc(e._cls)} · ${e.questions_per_student || "?"} questions · ${e.duration || "?"} min · ${status}</div></div><button class="acad-action-btn acad-action-btn--teal" onclick="sTakeExam('${acEsc(e._code)}','${acEsc(e.exam_id)}')">${label}</button></div>`;
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
function sExamRenderTaker(code, exam, submission) {
  sExamCloseTaker();
  const graded = !!(submission && submission.graded);
  _sxCtx = { code, examId: exam.id, questions: exam.questions || [] };
  const prior = {};
  if (submission && submission.answers)
    submission.answers.forEach((a) => {
      prior[a.i] = a.a;
    });
  const qHtml = (exam.questions || [])
    .map((q, n) => {
      let input;
      if (q.type === "mcq" && Array.isArray(q.options) && q.options.length) {
        input =
          `<div class="sx-opts">` +
          q.options
            .map(
              (opt) =>
                `<label class="sx-opt"><input type="radio" name="sxq-${q.i}" value="${acEsc(opt)}" ${prior[q.i] === opt ? "checked" : ""} ${graded ? "disabled" : ""}/><span>${acEsc(opt)}</span></label>`,
            )
            .join("") +
          `</div>`;
      } else {
        input = `<textarea class="sx-ans" data-i="${q.i}" ${graded ? "readonly" : ""} placeholder="Type your answer…">${acEsc(prior[q.i] || "")}</textarea>`;
      }
      return `<div class="sx-q" data-qi="${q.i}" data-qtype="${q.type || "text"}">
      <div class="sx-qn">Q${n + 1}. ${acEsc(q.q)}${q.type === "mcq" ? '<span class="sx-qtag">MCQ</span>' : ""}</div>
      ${input}
    </div>`;
    })
    .join("");
  const banner = graded
    ? `<div class="sx-graded">Graded: <strong>${acEsc(submission.grade || "–")}</strong>${submission.feedback ? " (" + acEsc(submission.feedback) + ")" : ""}</div>`
    : submission
      ? `<div class="sx-graded">Submitted, you can revise and resubmit until it's graded.</div>`
      : "";
  const foot = graded
    ? `<button class="acad-action-btn acad-action-btn--teal" onclick="sExamCloseTaker()">Close</button>`
    : `<button class="acad-action-btn acad-action-btn--red" onclick="sExamCloseTaker()">Cancel</button><button class="acad-action-btn acad-action-btn--teal" onclick="sSubmitExam('${code}','${exam.id}',false)">${submission ? "Resubmit" : "Submit exam"}</button>`;
  const ov = document.createElement("div");
  ov.className = "sx-overlay";
  ov.id = "sxOverlay";
  ov.innerHTML = `<div class="sx-modal">
    <div class="sx-head"><div class="sx-title">${acEsc(exam.title)}</div>${graded ? "" : '<div class="sx-timer" id="sxTimer"></div>'}<button class="sx-x" onclick="sExamCloseTaker()" aria-label="Close">✕</button></div>
    ${banner}
    <div class="sx-body">${qHtml || '<div class="acad-priority-sub">This exam has no questions.</div>'}</div>
    <div class="sx-foot">${foot}</div>
  </div>`;
  document.body.appendChild(ov);
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
function sExamCloseTaker() {
  if (_sxTimer) {
    clearInterval(_sxTimer);
    _sxTimer = null;
  }
  const ov = document.getElementById("sxOverlay");
  if (ov) ov.remove();
}
async function sSubmitExam(code, examId, auto) {
  const ov = document.getElementById("sxOverlay");
  if (!ov || !_sxCtx) return;
  const qmap = {};
  _sxCtx.questions.forEach((q) => {
    qmap[q.i] = q.q;
  });
  const answers = [...ov.querySelectorAll(".sx-q")].map((qel) => {
    const i = +qel.dataset.qi;
    let a = "";
    if (qel.dataset.qtype === "mcq") {
      const sel = qel.querySelector("input[type=radio]:checked");
      a = sel ? sel.value : "";
    } else {
      const ta = qel.querySelector(".sx-ans");
      a = ta ? ta.value : "";
    }
    return { i, q: qmap[i] || "", a };
  });
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
  if (!body || !list.length) return;
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
  if (html) body.innerHTML = html;
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
