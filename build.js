#!/usr/bin/env node
/*
 * SIVARR asset build.
 *
 * Minifies every js/**\/*.js and css/**\/*.css file (excluding anything
 * already under a dist/ output directory) into js/dist/ and css/dist/,
 * mirroring the source's relative sub-path exactly (js/features/org.js ->
 * js/dist/features/org.js). Source files are never modified.
 *
 * core.py's asset() prefers a dist/ counterpart over raw source whenever
 * one exists (see its docstring) -- app.py's existing StaticFiles mounts
 * for /js and /css already serve js/dist/* and css/dist/* for free, since
 * dist/ lives inside the directories they already mount. No route or
 * template change was needed to wire this up.
 *
 * Run via `npm run build`. Railway's nixpacks builder auto-runs a
 * package.json "build" script during its build phase, so production picks
 * this up with no railway.toml/Procfile change. Nothing runs this locally
 * unless invoked by hand -- local dev never has js/dist//css/dist, so
 * asset() always falls back to raw, readable source there.
 *
 * These files must stay global scripts, not ES modules or a single bundle
 * -- every function is a global, called from other <script> tags and from
 * inline onclick="..." attributes in the templates. Confirmed empirically
 * before relying on this: esbuild's --minify without --bundle renames only
 * function-local identifiers, never top-level declarations, precisely
 * because it can't prove they're not referenced from outside the file.
 */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = __dirname;

function collectFiles(dir, ext, skipDirNames) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirNames.has(entry.name)) continue;
      out.push(...collectFiles(path.join(dir, entry.name), ext, skipDirNames));
    } else if (entry.name.endsWith(ext)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function minifyOne(srcFile, srcRoot, distRoot, loader) {
  const rel = path.relative(srcRoot, srcFile);
  const outFile = path.join(distRoot, rel);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const result = esbuild.buildSync({
    entryPoints: [srcFile],
    outfile: outFile,
    minify: true,
    bundle: false,
    loader: { [path.extname(srcFile)]: loader },
    logLevel: "silent", // collected manually below so a warning can fail the build
  });
  return { outFile, warnings: result.warnings };
}

function run(label, srcRoot, distRoot, ext, loader) {
  // Clean first: a source file that's since been deleted or renamed must
  // not leave a stale built file behind for asset() to keep preferring.
  fs.rmSync(distRoot, { recursive: true, force: true });
  const files = collectFiles(srcRoot, ext, new Set(["dist", "vendor"]));
  let before = 0;
  let after = 0;
  let sawWarning = false;
  for (const f of files) {
    before += fs.statSync(f).size;
    const { outFile, warnings } = minifyOne(f, srcRoot, distRoot, loader);
    after += fs.statSync(outFile).size;
    if (warnings.length) {
      sawWarning = true;
      // A parse warning here is not cosmetic: a CSS comment containing a
      // literal "*/" (found live in css/features/agents.css and
      // marketplace.css, both fixed once) closes early and can swallow
      // everything after it -- including the rest of the file -- as an
      // unterminated rule, silently dropping real styles with no visible
      // error anywhere else. Treat every build warning as a build failure.
      console.error(`\n${f}:`);
      for (const w of warnings) console.error(`  ${w.text} (${w.location?.line}:${w.location?.column})`);
    }
  }
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  console.log(`${label}: ${files.length} files, ${before} -> ${after} bytes (-${pct}%)`);
  return { count: files.length, sawWarning };
}

function main() {
  const js = run("JS ", path.join(ROOT, "js"), path.join(ROOT, "js", "dist"), ".js", "js");
  const css = run("CSS", path.join(ROOT, "css"), path.join(ROOT, "css", "dist"), ".css", "css");
  if (js.count === 0 || css.count === 0) {
    console.error("build.js: found zero source files -- run from the repo root.");
    process.exit(1);
  }
  if (js.sawWarning || css.sawWarning) {
    console.error("\nbuild.js: failing on the warning(s) above -- see the comment in run().");
    process.exit(1);
  }
}

// core.py's asset() already falls back to raw, unminified source whenever
// js/dist//css/dist don't exist (see its docstring) -- minification was
// designed as a pure optimization, never something the app depends on to
// run. main() still exits 1 on a genuine content warning above (a real bug
// class -- a truncated CSS comment silently dropping rules), and that path
// is untouched: process.exit() terminates immediately, before it would
// ever reach this catch. What's caught here is main() *throwing* --
// esbuild's native binary failing to load, a registry/network hiccup
// installing it, anything unexpected -- which used to hard-fail Railway's
// nixpacks build (and therefore the whole deployment) for a step the app
// was always designed to run without. Same distinction CI draws: its
// dedicated "Asset build" job (.github/workflows/ci.yml) still runs this
// exact command on its own reliable network and stays a hard gate for
// real content warnings; only the infra-flakiness class degrades here.
try {
  main();
} catch (err) {
  console.error("build.js: minification failed unexpectedly -- falling back to raw (unminified) source.");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(0);
}
