/**
 * js/core/dom.js — leaf-level DOM helpers shared by app.js and every feature module.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These four were defined in app.js, which loads LAST (after js/features/*.js).
 * The feature modules call them ~50 times, and that only worked because every one
 * of those calls happens at event time rather than at load time. A single
 * top-level call in a feature module would have thrown ReferenceError at load.
 *
 * Loading this file first makes the dependency real instead of incidental:
 *
 *     core/dom.js  ->  features/*.js  ->  app.js
 *
 * Only add things here that depend on nothing but the DOM. Anything that needs
 * app state (S, getToken, the offline queue) belongs in its feature module.
 *
 * These are intentionally plain globals, not an ES module — the app has no build
 * step and ~1,075 inline onclick handlers that resolve against window.
 */

/** getElementById, shortened. */
const $ = (id) => document.getElementById(id);

/**
 * Escapes & < > AND quotes so values are safe in BOTH text and attribute
 * contexts (e.g. value="${esc(userTitle)}"). A bare " or ' previously allowed
 * attribute breakout -> XSS. Matches the stricter acEsc/mktEsc variants.
 */
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escHtml = esc;

/** Transient bottom-of-screen message. No-ops if the toast element is absent. */
function toast(msg, ms = 2500) {
  const el = $("toast");
  if (!el) return;
  clearTimeout(el._toastTimer);
  el.classList.remove("show");
  el.textContent = msg;
  void el.offsetWidth; // force reflow so animation replays on consecutive toasts
  el.classList.add("show");
  el._toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
