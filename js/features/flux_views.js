/* ══ View switcher — purely presentational, not owned by tasks.js ══ */
document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".view-btn")
      .forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    ["list", "kanban", "calendar", "focus", "insights"].forEach(
      (name) => {
        document.getElementById("view-" + name).style.display =
          name === btn.dataset.view ? "block" : "none";
      },
    );
    if (
      btn.dataset.view === "kanban" ||
      btn.dataset.view === "focus" ||
      btn.dataset.view === "calendar"
    ) {
      document.getElementById("view-" + btn.dataset.view).style.display =
        "flex";
      document.getElementById(
        "view-" + btn.dataset.view,
      ).style.flexDirection = "column";
      document.getElementById("view-" + btn.dataset.view).style.height =
        "100%";
    }
    document.getElementById("scrollArea").scrollTop = 0;
    if (btn.dataset.view === "focus") startFocusTimer();
    else stopFocusTimer();
    if (btn.dataset.view === "insights" && window.renderInsightsView)
      renderInsightsView();
  });
});

/* ══ Sheet open/close helpers — tasks.js calls these by name but doesn't
   define them itself, so they need to live here. ══ */
function openSheet(id, overlayId) {
  document.getElementById(id).classList.add("open");
  document.getElementById(overlayId).classList.add("show");
}
function closeSheetEls(id, overlayId) {
  document.getElementById(id).classList.remove("open");
  document.getElementById(overlayId).classList.remove("show");
}
function openWhatsApp() {
  openSheet("waSheet", "waOverlay");
}
function closeWhatsApp() {
  closeSheetEls("waSheet", "waOverlay");
}
function openInvite() {
  openSheet("inviteSheet", "inviteOverlay");
}
function closeInvite() {
  closeSheetEls("inviteSheet", "inviteOverlay");
}
/* openDetail/closeDetail/openNewTask/closeNewTask/showAiBreakdown are all
   owned by tasks.js (they read/write real task data) — not redefined here. */

/* ══ Focus view countdown ring — cosmetic only, tasks.js owns the task
   title/subtitle/next-up text via renderFocusView(). ══ */
let focusSeconds = 18 * 60 + 24,
  focusInterval = null;
function renderFocusTime() {
  const m = String(Math.floor(focusSeconds / 60)).padStart(2, "0");
  const s = String(focusSeconds % 60).padStart(2, "0");
  const el = document.querySelector(".focus-ring-time");
  if (el) el.textContent = m + ":" + s;
}
function startFocusTimer() {
  if (focusInterval) return;
  focusInterval = setInterval(() => {
    if (focusSeconds <= 0) {
      stopFocusTimer();
      return;
    }
    focusSeconds--;
    renderFocusTime();
  }, 1000);
}
function stopFocusTimer() {
  clearInterval(focusInterval);
  focusInterval = null;
}
function toggleFocusTimer() {
  const btn = document.getElementById("focusPauseBtn");
  if (focusInterval) {
    stopFocusTimer();
    if (btn)
      btn.innerHTML =
        '<i class="ti ti-player-play" style="font-size:13px;"></i>Resume';
  } else {
    startFocusTimer();
    if (btn)
      btn.innerHTML =
        '<i class="ti ti-player-pause" style="font-size:13px;"></i>Pause';
  }
}

/* ══ Calendar timeline drag/reschedule — visual-only interaction on the
   demo grid; tasks.js's renderCalendarView() only populates the
   unscheduled bucket (real task data), it doesn't manage time-slot
   placement yet, so this stays separate and doesn't touch task records. ══ */
function pxToTimeLabel(px, durationPx) {
  const totalMin = Math.round(((px / 50) * 60) / 30) * 30; // snap to 30-min
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
let dragCard = null;
document.querySelectorAll(".tl-block, .tl-chip").forEach((el) => {
  el.addEventListener("dragstart", () => {
    dragCard = el;
    el.style.opacity = ".4";
  });
  el.addEventListener("dragend", () => {
    el.style.opacity = "1";
    dragCard = null;
  });
});
document.querySelectorAll(".tl-grid").forEach((grid) => {
  grid.addEventListener("dragover", (e) => e.preventDefault());
  grid.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragCard) return;
    const rect = grid.getBoundingClientRect();
    let dropY = e.clientY - rect.top;
    dropY = Math.max(0, Math.min(690, Math.round(dropY / 25) * 25));

    if (dragCard.classList.contains("tl-chip")) {
      const block = document.createElement("div");
      block.className = "tl-block";
      block.style.cssText =
        "top:" +
        dropY +
        "px;height:75px;background:" +
        getComputedStyle(dragCard).backgroundColor +
        ";color:" +
        getComputedStyle(dragCard).color +
        ";border-left-color:var(--t3);";
      block.dataset.id = dragCard.dataset.id || "";
      block.onclick = () => {
        if (block.dataset.id && window.openDetail)
          openDetail(Number(block.dataset.id));
      };
      block.innerHTML =
        '<div class="tl-block-time">' +
        pxToTimeLabel(dropY, 75) +
        '</div><div class="tl-block-title">' +
        dragCard.textContent +
        "</div>";
      block.setAttribute("draggable", "true");
      block.addEventListener("dragstart", () => {
        dragCard = block;
      });
      block.addEventListener("dragend", () => {
        block.style.opacity = "1";
        dragCard = null;
      });
      grid.appendChild(block);
      dragCard.remove();
    } else {
      const height = parseInt(dragCard.style.height);
      dragCard.style.top = dropY + "px";
      const timeEl = dragCard.querySelector(".tl-block-time");
      if (timeEl) timeEl.textContent = pxToTimeLabel(dropY, height);
      grid.appendChild(dragCard);
    }
  });
});

/* Task data, rendering, and all sheet content (list/kanban/focus/insights/detail/new-task) live in tasks.js */
