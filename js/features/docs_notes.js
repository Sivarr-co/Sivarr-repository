// Docs & Notes panel (Tiptap editor + slash-command menu) — extracted from
// js/app.js. Depends on app.js's shared globals (S, API, $, toast,
// _queueMutation) which load before this file, and the Tiptap bundle loaded
// via templates/index.html's tiptap-ready event.

// ═══════════════════════════════════════════════════════════════
// FEATURE 4 — DOC EDITOR (Docs & Notes)
// ═══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  DOCS & NOTES — Tiptap rich-text editor
// ══════════════════════════════════════════════════════════════

const DOC_KEY = () => `sivarr_docs_${S.sid || "guest"}`;
const DOC_AUTOSAVE_MS = 1500;

let _docId = null;
let _docTimer = null;
let _docEditor = null; // Tiptap Editor instance
let _slashPos = -1; // ProseMirror position where / was typed
let _slashFilt = ""; // text typed after /
let _slashIdx = 0; // highlighted item index

function docGetAll() {
  try {
    return JSON.parse(localStorage.getItem(DOC_KEY()) || "[]");
  } catch {
    return [];
  }
}
function docSaveAll(list) {
  localStorage.setItem(DOC_KEY(), JSON.stringify(list));
  _syncDocsToServer(list);
}

function _syncDocsToServer(docs) {
  const token = getToken();
  if (!token || !S.sid) return;
  if (!navigator.onLine) {
    _queueMutation("/api/docs/sync", { token, docs });
    return;
  }
  fetch("/api/docs/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, docs }),
  }).catch(() => _queueMutation("/api/docs/sync", { token, docs }));
}

// ── Recently-visited nav (powers the home "jump back in" pills) ─
const _NAV_META = {
  flux: { i: "ti-checkbox", l: "My Tasks" },
  goals: { i: "ti-target", l: "Goals" },
  habits: { i: "ti-flame", l: "Habits" },
  journal: { i: "ti-writing", l: "Journal" },
  calendar: { i: "ti-calendar", l: "Calendar" },
  finance: { i: "ti-wallet", l: "Finance" },
  skills: { i: "ti-atom", l: "Skills" },
  notes: { i: "ti-file-text", l: "Notes" },
  org: { i: "ti-building", l: "Org Space" },
  community: { i: "ti-users", l: "Community" },
  templates: { i: "ti-layout-grid", l: "Templates" },
  academic: { i: "ti-school", l: "Academic" },
  analytics: { i: "ti-chart-bar", l: "Analytics" },
  profile: { i: "ti-user", l: "Profile" },
  quiz: { i: "ti-question-mark", l: "Quiz" },
};
const _RV_KEY = "_rv";
function _pushRecentNav(name) {
  if (!name || name === "home" || name === "chat" || !_NAV_META[name]) return;
  try {
    let rv = JSON.parse(localStorage.getItem(_RV_KEY) || "[]");
    rv = [name, ...rv.filter((n) => n !== name)].slice(0, 5);
    localStorage.setItem(_RV_KEY, JSON.stringify(rv));
  } catch (e) {}
}
function _renderRecentPills() {
  const el = document.getElementById("siva-recent-pills");
  if (!el) return;
  try {
    const rv = JSON.parse(localStorage.getItem(_RV_KEY) || "[]");
    el.innerHTML = rv
      .map((name) => {
        const m = _NAV_META[name];
        if (!m) return "";
        return `<button class="siva-pill" onclick="nav('${name}',null)"><i class="ti ${m.i}"></i> ${m.l}</button>`;
      })
      .join("");
  } catch (e) {}
}

// ── Feature usage tracking (fires on every panel navigation) ─
let _lastTrackedNav = "";
function _trackNav(panel) {
  const token = getToken();
  if (!token || !panel || panel === _lastTrackedNav) return;
  _lastTrackedNav = panel;
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, event: "nav", panel }),
  }).catch(() => {});
}

const _DOC_TEMPLATES = {
  blank: { title: "", content: "<p></p>" },
  meeting: {
    title: "Meeting Notes",
    content: `<h2>Meeting Notes</h2><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p><p><strong>Attendees:</strong> </p><h3>Agenda</h3><ul><li></li></ul><h3>Discussion</h3><p></p><h3>Action Items</h3><ul><li></li></ul><h3>Next Steps</h3><p></p>`,
  },
  project: {
    title: "Project Brief",
    content: `<h1>Project Brief</h1><h2>Overview</h2><p></p><h2>Goals</h2><ul><li></li></ul><h2>Timeline</h2><p></p><h2>Resources Needed</h2><ul><li></li></ul><h2>Success Criteria</h2><p></p>`,
  },
  study: {
    title: "Study Notes",
    content: `<h1>Study Notes</h1><p><strong>Subject:</strong> </p><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p><h2>Key Concepts</h2><ul><li></li></ul><h2>Notes</h2><p></p><h2>Summary</h2><p></p><h2>Questions to Revisit</h2><ul><li></li></ul>`,
  },
  journal: {
    title: `Journal: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`,
    content: `<h2>${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h2><h3>Today's Highlights</h3><p></p><h3>What I Learned</h3><p></p><h3>What I'm Grateful For</h3><ul><li></li></ul><h3>Tomorrow's Focus</h3><p></p>`,
  },
  weekly: {
    title: "Weekly Review",
    content: `<h1>Weekly Review</h1><p><strong>Week of:</strong> ${new Date().toLocaleDateString()}</p><h2>Wins This Week</h2><ul><li></li></ul><h2>What Could Have Gone Better</h2><ul><li></li></ul><h2>Goals Progress</h2><p></p><h2>Focus for Next Week</h2><ul><li></li></ul>`,
  },
};

function docNew() {
  // Show template picker in the editor area
  const emptyState = $("doc-empty-state");
  const wrap = $("doc-editor-wrap");
  if (wrap) wrap.style.display = "none";
  if (emptyState) {
    emptyState.style.display = "flex";
    emptyState.innerHTML = `
      <div style="max-width:560px;width:100%;text-align:left">
        <div style="font-size:1.05rem;font-weight:800;color:var(--text);margin-bottom:4px">New Document</div>
        <div style="font-size:.83rem;color:var(--muted);margin-bottom:20px">Start from a template or create blank</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
          ${[
            { k: "blank", i: "📄", n: "Blank" },
            { k: "meeting", i: "📋", n: "Meeting Notes" },
            { k: "project", i: "🚀", n: "Project Brief" },
            { k: "study", i: "📚", n: "Study Notes" },
            { k: "journal", i: "✍️", n: "Daily Journal" },
            { k: "weekly", i: "🔁", n: "Weekly Review" },
          ]
            .map(
              (t) => `
            <div onclick="docFromTemplate('${t.k}')" style="background:var(--surface);border:1px solid var(--border);
                 border-radius:10px;padding:16px 14px;cursor:pointer;transition:var(--transition)"
              onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--teal2,rgba(13,122,95,.06))'"
              onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)'">
              <div style="font-size:1.8rem;margin-bottom:8px">${t.i}</div>
              <div style="font-size:.82rem;font-weight:600;color:var(--text)">${t.n}</div>
            </div>`,
            )
            .join("")}
        </div>
      </div>`;
  }
}

function docFromTemplate(key) {
  const tpl = _DOC_TEMPLATES[key] || _DOC_TEMPLATES.blank;
  const doc = {
    id: Date.now(),
    title: tpl.title,
    content: tpl.content,
    created: Date.now(),
    updated: Date.now(),
  };
  const list = docGetAll();
  list.unshift(doc);
  docSaveAll(list);
  _docId = doc.id;
  docRenderList();
  docOpenEditor(doc);
}

function docCaptureNote(text) {
  const doc = {
    id: Date.now(),
    title: text.split("\n")[0].slice(0, 60) || "Quick Note",
    content: `<p>${esc(text)}</p>`,
    created: Date.now(),
    updated: Date.now(),
  };
  const list = docGetAll();
  list.unshift(doc);
  docSaveAll(list);
}

function docOpen(id) {
  const doc = docGetAll().find((d) => d.id === id);
  if (!doc) return;
  _docId = id;
  docOpenEditor(doc);
  docRenderList();
}

function docOpenEditor(doc) {
  const emptyState = $("doc-empty-state");
  const wrap = $("doc-editor-wrap");
  if (emptyState) emptyState.style.display = "none";
  if (wrap) wrap.style.display = "flex";

  const titleEl = $("doc-title");
  if (titleEl) titleEl.value = doc.title || "";

  if (_docEditor) {
    _docEditor.commands.setContent(doc.content || "<p></p>", false);
    setTimeout(() => _docEditor.commands.focus("end"), 50);
  }
  docUpdateWordCount();
  const statusEl = $("doc-save-status");
  if (statusEl) {
    const rel = doc.updated ? _relTime(doc.updated) : "";
    statusEl.textContent = rel ? `Saved ${rel}` : "All changes saved";
  }
}

function _relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function docDelete(id, e) {
  e?.stopPropagation();
  const list = docGetAll();
  const doc = list.find((d) => d.id === id);
  if (!doc) return;
  doc.deleted_at = new Date().toISOString();
  docSaveAll(list);
  if (_docId === id) {
    _docId = null;
    if (_docEditor) _docEditor.commands.setContent("<p></p>", false);
    const emptyState = $("doc-empty-state");
    const wrap = $("doc-editor-wrap");
    if (emptyState) emptyState.style.display = "flex";
    if (wrap) wrap.style.display = "none";
  }
  docRenderList();
  toast("Note moved to Trash");
}

function docRestore(id) {
  const list = docGetAll();
  const doc = list.find((d) => d.id === id);
  if (!doc) return;
  delete doc.deleted_at;
  docSaveAll(list);
  docRenderList();
}

// Same reasoning as tasks'/habits' prune helpers — no server-side purge for
// docs, so the client lets old tombstones go itself. Runs once per Docs &
// Notes panel visit.
function _docPruneExpiredTrash() {
  const list = docGetAll();
  const cutoff = Date.now() - 30 * 86400000;
  const kept = list.filter((d) => {
    if (!d.deleted_at) return true;
    const ts = Date.parse(d.deleted_at);
    return Number.isNaN(ts) || ts >= cutoff;
  });
  if (kept.length !== list.length) docSaveAll(kept);
}

function docRenderList(filter) {
  const list = $("doc-list");
  if (!list) return;
  let docs = docGetAll().filter((d) => !d.deleted_at);
  const q = filter ?? ($("doc-search")?.value?.toLowerCase() || "");
  if (q)
    docs = docs.filter(
      (d) =>
        (d.title || "").toLowerCase().includes(q) ||
        (d.content || "").toLowerCase().includes(q),
    );

  if (!docs.length) {
    list.innerHTML = `<div class="doc-list-empty">${q ? "No docs match" : "No docs yet"}</div>`;
    return;
  }
  list.innerHTML = docs
    .map((d) => {
      const title = d.title || "Untitled";
      const preview = d.content
        ? d.content.replace(/<[^>]+>/g, "").slice(0, 48)
        : "";
      const rel = _relTime(d.updated);
      return `<div class="doc-item${_docId === d.id ? " active" : ""}" onclick="docOpen(${d.id})">
      <div class="doc-item-row">
        <div class="doc-item-title">${esc(title)}</div>
        <button class="doc-delete-btn" onmousedown="event.stopPropagation()" onclick="docDelete(${d.id},event)" title="Delete">✕</button>
      </div>
      <div class="doc-item-meta">${preview ? esc(preview) : rel}</div>
    </div>`;
    })
    .join("");
}

function docSearchFilter() {
  docRenderList($("doc-search")?.value?.toLowerCase() || "");
}

function docTitleChange() {
  docScheduleSave();
}

function docContentChange() {
  docUpdateWordCount();
  docScheduleSave();
  const statusEl = $("doc-save-status");
  if (statusEl) statusEl.textContent = "Unsaved…";
}

function docScheduleSave() {
  clearTimeout(_docTimer);
  _docTimer = setTimeout(docSave, DOC_AUTOSAVE_MS);
}

function docSave() {
  if (!_docId || !_docEditor) return;
  const list = docGetAll();
  const idx = list.findIndex((d) => d.id === _docId);
  if (idx < 0) return;
  list[idx].title = $("doc-title")?.value?.trim() || "Untitled";
  list[idx].content = _docEditor.getHTML();
  list[idx].updated = Date.now();
  docSaveAll(list);
  docRenderList();
  const st = $("doc-save-status");
  if (st) st.textContent = "All changes saved";
}

function docUpdateWordCount() {
  const text = _docEditor ? _docEditor.getText() : "";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wc = $("doc-word-count");
  if (wc) wc.textContent = `${words} word${words !== 1 ? "s" : ""}`;
  const rt = $("doc-read-time");
  if (rt) rt.textContent = `${Math.max(1, Math.round(words / 250))} min read`;
}

// ── Toolbar format commands (same names, now call Tiptap) ─────

function docFormat(cmd) {
  if (!_docEditor) return;
  const c = _docEditor.chain().focus();
  (
    ({
      bold: c.toggleBold(),
      italic: c.toggleItalic(),
      underline: c.toggleUnderline(),
      insertUnorderedList: c.toggleBulletList(),
      insertOrderedList: c.toggleOrderedList(),
      strikeThrough: c.toggleStrike(),
    })[cmd] || c
  ).run();
  docScheduleSave();
}

function docFormatBlock(tag) {
  if (!_docEditor) return;
  const c = _docEditor.chain().focus();
  (
    ({
      h1: c.toggleHeading({ level: 1 }),
      h2: c.toggleHeading({ level: 2 }),
      h3: c.toggleHeading({ level: 3 }),
      p: c.setParagraph(),
      blockquote: c.toggleBlockquote(),
      pre: c.toggleCodeBlock(),
    })[tag] || c
  ).run();
  docScheduleSave();
}

// ── Sivarr AI inline writing ──────────────────────────────────

let _docAiText = "";

function docInlineAI() {
  const panel = $("doc-ai-panel");
  if (!panel) return;
  if (panel.style.display !== "none") {
    docAIPanelClose();
    return;
  }
  panel.style.display = "block";
  $("doc-ai-result").style.display = "none";
  $("doc-ai-insert").style.display = "none";
  $("doc-ai-replace").style.display = "none";
  _docAiText = "";
  // Pre-fill hint if text is selected
  const sel = window.getSelection()?.toString()?.trim() || "";
  const inp = $("doc-ai-prompt");
  if (inp) {
    inp.value = sel
      ? `Improve this: "${sel.slice(0, 60)}${sel.length > 60 ? "…" : ""}"`
      : "";
    inp.focus();
  }
}

function docAIPanelClose() {
  const panel = $("doc-ai-panel");
  if (panel) panel.style.display = "none";
}

async function docAIGenerate() {
  if (!S.sid) return;
  const prompt = $("doc-ai-prompt")?.value?.trim();
  if (!prompt) {
    toast("Enter a prompt first");
    return;
  }
  const sel = window.getSelection()?.toString()?.trim() || "";
  const content = _docEditor ? _docEditor.getText().trim().slice(0, 400) : "";
  const title = $("doc-title")?.value?.trim() || "";
  const ctx = sel
    ? `Selected text from doc "${title}": "${sel}"\n\nInstruction: ${prompt}`
    : content
      ? `Document "${title}" so far: ${content}\n\nInstruction: ${prompt}`
      : prompt;
  const resultEl = $("doc-ai-result");
  const insertBtn = $("doc-ai-insert");
  const replaceBtn = $("doc-ai-replace");
  if (resultEl) {
    resultEl.style.display = "block";
    resultEl.textContent = "Generating…";
  }
  try {
    const r = await API("/api/chat", {
      sid: S.sid,
      token: getToken() || "",
      message: ctx,
      context: "",
    });
    _docAiText = r.reply || r.response || "";
    if (resultEl) resultEl.textContent = _docAiText;
    if (insertBtn) insertBtn.style.display = "block";
    if (replaceBtn) replaceBtn.style.display = sel ? "block" : "none";
  } catch {
    if (resultEl) resultEl.textContent = "Could not generate. Try again.";
  }
}

function docAIInsert() {
  if (!_docAiText || !_docEditor) return;
  _docEditor
    .chain()
    .focus()
    .insertContent(
      `<p>${_docAiText.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    )
    .run();
  docScheduleSave();
  docAIPanelClose();
  toast("Text inserted ✓");
}

function docAIReplace() {
  if (!_docAiText || !_docEditor) return;
  _docEditor
    .chain()
    .focus()
    .insertContent(
      _docAiText.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>"),
    )
    .run();
  docScheduleSave();
  docAIPanelClose();
  toast("Text replaced ✓");
}

// ── Export ────────────────────────────────────────────────────

function _htmlToMd(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  function node(n) {
    if (n.nodeType === 3) return n.textContent;
    const t = n.tagName?.toLowerCase();
    const c = Array.from(n.childNodes).map(node).join("");
    switch (t) {
      case "h1":
        return `\n# ${c}\n`;
      case "h2":
        return `\n## ${c}\n`;
      case "h3":
        return `\n### ${c}\n`;
      case "p":
        return `\n${c}\n`;
      case "strong":
      case "b":
        return `**${c}**`;
      case "em":
      case "i":
        return `*${c}*`;
      case "s":
      case "strike":
        return `~~${c}~~`;
      case "code":
        return `\`${c}\``;
      case "pre":
        return `\n\`\`\`\n${n.textContent}\n\`\`\`\n`;
      case "blockquote":
        return `\n> ${c.trim().replace(/\n/g, "\n> ")}\n`;
      case "ul":
        return `\n${Array.from(n.children)
          .map((li) => `- ${li.textContent.trim()}`)
          .join("\n")}\n`;
      case "ol":
        return `\n${Array.from(n.children)
          .map((li, i) => `${i + 1}. ${li.textContent.trim()}`)
          .join("\n")}\n`;
      case "hr":
        return `\n---\n`;
      case "br":
        return "\n";
      default:
        return c;
    }
  }
  return Array.from(div.childNodes)
    .map(node)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function docExportMd() {
  if (!_docEditor) {
    toast("Open a document first");
    return;
  }
  const title = $("doc-title")?.value?.trim() || "document";
  const md = `# ${title}\n\n${_htmlToMd(_docEditor.getHTML())}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  a.download = `${title.replace(/\s+/g, "-").toLowerCase()}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Exported as Markdown ✓");
}

function docExportPdf() {
  if (!_docEditor) {
    toast("Open a document first");
    return;
  }
  const title = $("doc-title")?.value?.trim() || "Document";
  const content = _docEditor.getHTML();
  const win = window.open("", "_blank");
  win.document
    .write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;color:#1a1a2e;line-height:1.75;font-size:16px}
    h1{font-size:2rem;font-weight:800;margin:1.5rem 0 .5rem}h2{font-size:1.4rem;font-weight:700;margin:1.2rem 0 .5rem}
    h3{font-size:1.15rem;font-weight:700;margin:1rem 0 .4rem}blockquote{border-left:3px solid #41076B;padding:8px 16px;
    margin:1rem 0;background:#f5f0fa}pre{background:#1a1a2e;color:#e2e8f0;padding:16px;border-radius:8px;overflow-x:auto}
    code{font-family:monospace;font-size:.9em;background:#f1f5f9;padding:2px 5px;border-radius:3px}
    ul,ol{padding-left:1.5rem}@media print{body{margin:0}}</style>
    </head><body><h1>${title}</h1>${content}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

// ── Legacy shim (anything calling docAskSiva still works) ─────
function docAskSiva() {
  docInlineAI();
}

// ── Tiptap initialisation ─────────────────────────────────────

function _waitForTiptap(cb) {
  if (window._tiptap) {
    cb();
    return;
  }
  let done = false;
  const ready = () => {
    if (done) return;
    done = true;
    cb();
  };
  window.addEventListener("tiptap-ready", ready, { once: true });
  // Safety net: the editor loads from a self-hosted ESM bundle. If it ever fails
  // (404 / parse error / CSP regression), surface it instead of leaving the Docs
  // panel silently dead with no editor and no first-doc ever opening.
  setTimeout(() => {
    if (done || window._tiptap) {
      ready();
      return;
    }
    const el = $("doc-content");
    if (el && !_docEditor)
      el.innerHTML =
        '<div style="padding:20px;color:var(--muted);font-size:.9rem">The editor failed to load. <a onclick="location.reload()" style="color:var(--teal);cursor:pointer">Reload</a> to try again.</div>';
  }, 5000);
}

function _initTiptapEditor() {
  if (_docEditor) return;
  const el = $("doc-content");
  if (!el || !window._tiptap) return;

  const { Editor, StarterKit, Placeholder, Underline } = window._tiptap;

  _docEditor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: "Start writing… or type / for commands",
      }),
      Underline,
    ],
    content: "",
    onUpdate({ editor }) {
      docUpdateWordCount();
      docScheduleSave();
      const st = $("doc-save-status");
      if (st) st.textContent = "Unsaved…";
      _checkSlash(editor);
    },
  });

  // Intercept keyboard for slash menu
  el.addEventListener(
    "keydown",
    (e) => {
      if (!_slashOpen()) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        _slashMove(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        _slashMove(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        _slashExec();
      } else if (e.key === "Escape") {
        e.preventDefault();
        _slashHide();
      } else if (e.key === "Backspace") {
        if (_slashFilt.length) {
          _slashFilt = _slashFilt.slice(0, -1);
          _slashRender();
        } else _slashHide();
      }
    },
    true,
  );
}

function docInit() {
  _docPruneExpiredTrash();
  docRenderList();
  _waitForTiptap(() => {
    _initTiptapEditor();
    if (!_docId) {
      // Auto-open the most recent doc — must never land on a trashed one.
      const docs = docGetAll().filter((d) => !d.deleted_at);
      if (docs.length) docOpen(docs[0].id);
      else {
        const emptyState = $("doc-empty-state");
        const wrap = $("doc-editor-wrap");
        if (emptyState) emptyState.style.display = "flex";
        if (wrap) wrap.style.display = "none";
      }
    } else {
      const doc = docGetAll().find((d) => d.id === _docId && !d.deleted_at);
      if (doc) docOpenEditor(doc);
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  SLASH COMMAND MENU
// ══════════════════════════════════════════════════════════════

const _SLASH_CMDS = [
  {
    icon: "ti-h-1",
    label: "Heading 1",
    desc: "Large section heading",
    act: () => docFormatBlock("h1"),
  },
  {
    icon: "ti-h-2",
    label: "Heading 2",
    desc: "Medium heading",
    act: () => docFormatBlock("h2"),
  },
  {
    icon: "ti-h-3",
    label: "Heading 3",
    desc: "Small heading",
    act: () => docFormatBlock("h3"),
  },
  {
    icon: "ti-list",
    label: "Bullet list",
    desc: "Unordered list",
    act: () => docFormat("insertUnorderedList"),
  },
  {
    icon: "ti-list-numbers",
    label: "Numbered list",
    desc: "Ordered list",
    act: () => docFormat("insertOrderedList"),
  },
  {
    icon: "ti-quote",
    label: "Quote",
    desc: "Blockquote",
    act: () => docFormatBlock("blockquote"),
  },
  {
    icon: "ti-code",
    label: "Code block",
    desc: "Monospace code",
    act: () => docFormatBlock("pre"),
  },
  {
    icon: "ti-minus",
    label: "Divider",
    desc: "Horizontal rule",
    act: () => _docEditor?.chain().focus().setHorizontalRule().run(),
  },
  {
    icon: "ti-info-circle",
    label: "Callout",
    desc: "Highlighted note block",
    act: () =>
      _docEditor
        ?.chain()
        .focus()
        .insertContent(
          "<blockquote><p>💡 <strong>Note:</strong> </p></blockquote>",
        )
        .run(),
  },
  {
    icon: "ti-sparkles",
    label: "AI Write",
    desc: "Generate with Sivarr AI",
    act: () => {
      _slashHide();
      docInlineAI();
    },
  },
];

function _checkSlash(editor) {
  const { from } = editor.state.selection;
  if (from < 1) {
    _slashHide();
    return;
  }
  const $pos = editor.state.doc.resolve(from);
  const lineStart = $pos.start();
  const lineText = editor.state.doc.textBetween(lineStart, from);
  if (lineText === "/") {
    _slashPos = from - 1;
    _slashFilt = "";
    _slashIdx = 0;
    _slashShow(editor, _slashPos);
  } else if (_slashOpen() && lineText.startsWith("/")) {
    _slashFilt = lineText.slice(1).toLowerCase();
    _slashIdx = 0;
    _slashRender();
  } else {
    _slashHide();
  }
}

function _slashOpen() {
  const m = $("slash-menu");
  return m && m.style.display !== "none";
}

function _slashShow(editor, pos) {
  const menu = $("slash-menu");
  if (!menu) return;
  try {
    const coords = editor.view.coordsAtPos(pos);
    const scrollY = window.scrollY || 0;
    menu.style.top = `${coords.bottom + scrollY + 4}px`;
    menu.style.left = `${Math.max(8, coords.left)}px`;
  } catch (_) {}
  menu.style.display = "block";
  _slashRender();
}

function _slashRender() {
  const menu = $("slash-menu");
  if (!menu) return;
  const q = _slashFilt;
  const vis = _SLASH_CMDS.filter(
    (c) =>
      !q ||
      c.label.toLowerCase().includes(q) ||
      c.desc.toLowerCase().includes(q),
  );
  if (!vis.length) {
    _slashHide();
    return;
  }
  menu.innerHTML = vis
    .map(
      (c, i) => `
    <div class="slash-item${i === _slashIdx ? " sel" : ""}" onmousedown="event.preventDefault();_slashRun(${_SLASH_CMDS.indexOf(c)})">
      <div class="slash-ic"><i class="ti ${c.icon}"></i></div>
      <div>
        <div class="slash-lb">${c.label}</div>
        <div class="slash-ds">${c.desc}</div>
      </div>
    </div>`,
    )
    .join("");
}

function _slashMove(dir) {
  const q = _slashFilt;
  const vis = _SLASH_CMDS.filter(
    (c) =>
      !q ||
      c.label.toLowerCase().includes(q) ||
      c.desc.toLowerCase().includes(q),
  );
  _slashIdx = Math.max(0, Math.min(vis.length - 1, _slashIdx + dir));
  _slashRender();
}

function _slashExec() {
  const q = _slashFilt;
  const vis = _SLASH_CMDS.filter(
    (c) =>
      !q ||
      c.label.toLowerCase().includes(q) ||
      c.desc.toLowerCase().includes(q),
  );
  _slashRun(_SLASH_CMDS.indexOf(vis[_slashIdx]));
}

function _slashRun(idx) {
  _slashHide();
  const cmd = _SLASH_CMDS[idx];
  if (!cmd || !_docEditor) return;
  const delLen = 1 + _slashFilt.length;
  _docEditor
    .chain()
    .focus()
    .deleteRange({ from: _slashPos, to: _slashPos + delLen })
    .run();
  setTimeout(() => cmd.act(), 20);
}

function _slashHide() {
  const m = $("slash-menu");
  if (m) m.style.display = "none";
  _slashFilt = "";
  _slashIdx = 0;
}

document.addEventListener("mousedown", (e) => {
  if (_slashOpen() && !$("slash-menu")?.contains(e.target)) _slashHide();
});

