#!/usr/bin/env node
/**
 * Inline-handler / inline-style ratchet.
 *
 * Session 19 is migrating inline on*= handlers to js/core/delegate.js so
 * script-src 'unsafe-inline' can eventually come out of the CSP. The problem is
 * that new work keeps ADDING them back: between the overnight migration and the
 * next check, _panel_flux.html alone gained 25 fresh inline handlers. Without a
 * ratchet this is a treadmill -- migration and regression cancel out.
 *
 * These numbers may only go DOWN. If a change legitimately reduces them, lower
 * the baseline in the same commit. If it raises them, use delegate.js instead:
 *
 *     <button data-onclick="fnName">              fn()
 *     <button data-onclick="fn" data-onclick-args='["x", null]'>
 *     see js/core/delegate.js for the full grammar
 *
 * Standalone pages (admin.html, landing.html, admin_metrics.html) are counted
 * separately: they never load delegate.js, so migrating them is not possible
 * without adding the script to each page first.
 */
const fs = require("fs");
const path = require("path");

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, "inline-budget.json"), "utf8"));
const STANDALONE = new Set(["admin.html", "admin_metrics.html", "landing.html",
                            "landing_demo.html", "index.html", "lecturer.html"]);

const HANDLER = /(?<![-\w])on[a-z]+="/g;
const STYLE   = /(?<![-\w])style="/g;

let fragHandlers = 0, standaloneHandlers = 0, inlineStyles = 0;
const perFile = {};

for (const f of fs.readdirSync("templates").filter(f => f.endsWith(".html"))) {
  const src = fs.readFileSync(path.join("templates", f), "utf8");
  const h = (src.match(HANDLER) || []).length;
  const s = (src.match(STYLE) || []).length;
  inlineStyles += s;
  if (STANDALONE.has(f)) standaloneHandlers += h;
  else { fragHandlers += h; if (h) perFile[f] = h; }
}

const checks = [
  ["fragment inline handlers", fragHandlers, BASELINE.fragmentHandlers],
  ["standalone inline handlers", standaloneHandlers, BASELINE.standaloneHandlers],
  ["inline style= attributes", inlineStyles, BASELINE.inlineStyles],
];

let failed = false;
for (const [label, actual, budget] of checks) {
  const verdict = actual > budget ? "OVER" : actual < budget ? "under" : "at";
  console.log(`${label}: ${actual} (budget ${budget}) — ${verdict}`);
  if (actual > budget) {
    failed = true;
    console.log(`::error::${label} went UP: ${budget} -> ${actual}. Use js/core/delegate.js instead of an inline handler, or lower the baseline in scripts/inline-budget.json if this change genuinely removed some.`);
  }
}
if (Object.keys(perFile).length) {
  console.log("\nfragment handlers still inline, by file:");
  for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
}
process.exit(failed ? 1 : 0);
