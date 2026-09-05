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

/** Grow a single-line-looking textarea to fit its content, capped at 120px.
 * CSP migration: was `oninput="this.style.height=...` on a couple of chat
 * inputs; pure DOM, no app state, so it lives here rather than in a feature
 * module. */
function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

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

/**
 * safeUrl(u) - return `u` if it is safe to put in an href, otherwise "#".
 *
 * WHY: escaping is not enough. acEsc/esc/mktEsc all escape & < > " ' which stops
 * an attacker breaking OUT of the attribute, but leaves the SCHEME untouched, so
 * `javascript:doSomething()` survives escaping intact and runs on click. The CSP
 * does not save us either: script-src still carries 'unsafe-inline' (Session 19),
 * which is exactly what permits javascript: URLs.
 *
 * This matters because several rendered links carry values a user chose:
 *   - a lecturer's "live class" link  (POST /api/acad/live/set)
 *   - an opportunity's link           (POST /api/opportunities, open to anyone)
 * and others carry values from third parties (Semantic Scholar, PubMed, Google
 * Calendar, Stripe) that we should not assume stay well-formed forever.
 *
 * Servers validate these too; this is the second layer, at the point of render.
 *
 * Whitespace and control characters are stripped before the scheme test because
 * browsers ignore them when resolving a URL. "java\tscript:x" navigates fine, so
 * testing the raw string would miss it.
 */
function safeUrl(u) {
  const raw = String(u == null ? "" : u);
  const probe = raw.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  // Relative, anchor and query URLs carry no scheme to abuse.
  if (/^(?:[/#?]|$)/.test(probe)) return raw;
  const scheme = probe.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) return raw;                       // no scheme at all -> relative
  return ["http", "https", "mailto"].includes(scheme[1]) ? raw : "#";
}
