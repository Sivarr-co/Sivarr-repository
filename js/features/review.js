// Spaced repetition review queue — one shared due-cards queue (real
// SM-2-lite scheduling, server-authoritative via routes/review.py) for
// Study Deck AI flashcards, and cards created from Notes/Journal entries.
// Depends on app.js's shared globals ($, esc, toast, getToken, siModal),
// which load after this file — safe because those are only referenced
// inside function bodies below, never at top-level/load time (same pattern
// every other js/features/*.js file already relies on).

let _rvCards = [];
let _rvIdx = 0;
let _rvFlipped = false;

// ── Creating cards (called from Notes/Journal/Study Deck) ──────────────
async function reviewCreate(front, back, sourceType, sourceId) {
  const token = getToken();
  if (!token) return false;
  try {
    const r = await fetch("/api/review/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        front,
        back,
        source_type: sourceType || "custom",
        source_id: sourceId || "",
      }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

async function reviewAddFromPrompt(sourceType, sourceId, defaultFront, defaultBack) {
  const f = await siModal.form(
    "🧠 Add to Spaced Review",
    [
      { id: "front", label: "Front (question/prompt)", default: defaultFront || "" },
      { id: "back", label: "Back (answer)", type: "textarea", default: defaultBack || "" },
    ],
    { confirmLabel: "Add card" },
  );
  if (!f) return;
  const front = (f.front || "").trim();
  const back = (f.back || "").trim();
  if (!front || !back) {
    toast("Both sides are required");
    return;
  }
  const ok = await reviewCreate(front, back, sourceType, sourceId);
  toast(ok ? "Added to spaced review 🧠" : "Couldn't add card — try again");
}

// ── The review session itself ───────────────────────────────────────────
async function reviewOpen() {
  const token = getToken();
  const bg = $("review-sheet-bg");
  if (!token || !bg) return;
  bg.classList.add("open");
  _renderReviewLoading();
  try {
    const r = await fetch(`/api/review/due?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _rvCards = d.cards || [];
  } catch (_) {
    _rvCards = [];
  }
  _rvIdx = 0;
  _rvFlipped = false;
  _renderReviewCard();
}

function reviewClose() {
  $("review-sheet-bg")?.classList.remove("open");
}

// Same guard as cmdClose/cnClose — the backdrop's own click handler only
// dismisses when the click landed directly on the backdrop, not on the
// sheet itself (a bare reviewClose() here would close on every click
// inside the sheet, including flipping the card).
function reviewBgClick(e) {
  if (e && e.target !== $("review-sheet-bg")) return;
  reviewClose();
}

function _renderReviewLoading() {
  const disp = $("review-card-display");
  if (disp)
    disp.innerHTML = `<div class="rv-empty">Loading your review queue…</div>`;
  const acts = $("review-card-actions");
  if (acts) acts.style.display = "none";
  const progress = $("review-progress");
  if (progress) progress.textContent = "";
}

function _rvSourceLabel(type) {
  return (
    { flashcard: "Study Deck", note: "From a note", journal: "From journal" }[
      type
    ] || "Question"
  );
}

function _renderReviewCard() {
  const disp = $("review-card-display");
  const acts = $("review-card-actions");
  const progress = $("review-progress");
  if (!disp) return;

  if (!_rvCards.length) {
    disp.innerHTML = `<div class="rv-empty"><i class="ti ti-confetti" aria-hidden="true"></i><div>Nothing due right now — you're all caught up!</div></div>`;
    if (acts) acts.style.display = "none";
    if (progress) progress.textContent = "";
    return;
  }

  if (_rvIdx >= _rvCards.length) {
    disp.innerHTML = `<div class="rv-empty"><i class="ti ti-check" aria-hidden="true"></i><div>Session complete — nice work!</div></div>`;
    if (acts) acts.style.display = "none";
    if (progress) progress.textContent = "";
    return;
  }

  const card = _rvCards[_rvIdx];
  if (progress)
    progress.textContent = `Card ${_rvIdx + 1} of ${_rvCards.length}`;
  disp.innerHTML = `<div class="rv-flashcard" data-onclick="reviewFlip"><div class="rv-flashcard-inner ${_rvFlipped ? "rv-flashcard-inner--flipped" : ""}"><div class="rv-flashcard-front"><div class="rv-fc-label">${esc(_rvSourceLabel(card.source_type))}</div><div class="rv-fc-text">${esc(card.front || "")}</div><div class="rv-fc-hint">Tap to flip</div></div><div class="rv-flashcard-back"><div class="rv-fc-label">Answer</div><div class="rv-fc-text">${esc(card.back || "")}</div></div></div></div>`;
  if (acts) acts.style.display = _rvFlipped ? "flex" : "none";
}

function reviewFlip() {
  _rvFlipped = !_rvFlipped;
  _renderReviewCard();
}

async function reviewAnswer(quality) {
  const card = _rvCards[_rvIdx];
  if (!card) return;
  const token = getToken();
  try {
    await fetch("/api/review/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, card_id: card.id, quality }),
    });
  } catch (_) {}
  _rvIdx++;
  _rvFlipped = false;
  _renderReviewCard();
}
