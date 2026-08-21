/**
 * js/core/idb.js — minimal Promise-based IndexedDB key/value cache.
 *
 * WHY THIS EXISTS
 * ----------------
 * Tasks/Habits/Journal/Skills/Finance/Docs are all localStorage-primary
 * already (their data lives there as the actual working copy, synced to the
 * server in the background) — genuinely instant load, nothing to fix there.
 * Goals is the one panel that still fetches from the server before it can
 * render anything, only falling back to a stale localStorage snapshot if
 * the fetch *fails* outright — never rendering it proactively while the
 * fetch is in flight. That's the real gap (SIVARR_PRODUCT_ROADMAP.md's Gap
 * 3, "instant load with IndexedDB"), and it's the shape any future panel
 * with the same fetch-then-render pattern will want too, which is why this
 * is a small reusable helper rather than a one-off fix baked into Goals.
 *
 * IndexedDB over localStorage here specifically (unlike the panels above,
 * which predate this and work fine as-is): its API is async by design, so a
 * get/set here never blocks the main thread the way a large localStorage
 * read/write can — the right property for a *cache* that's read on every
 * page load, as opposed to primary storage read behind an explicit user
 * action.
 *
 * One object store, `kv`, holding arbitrary JSON-serializable values keyed
 * by plain strings (the same cache-key convention panels already use, e.g.
 * `goals_${S.sid}`) — deliberately not one store per data type, so adding a
 * new cached panel later never needs a schema/version bump here.
 *
 * Plain globals, not an ES module — matches core/dom.js (see that file's
 * own note: no build step, ~1,075 inline onclick handlers resolving
 * against window).
 */

const _IDB_NAME = "sivarr_cache";
const _IDB_VERSION = 1;
const _IDB_STORE = "kv";

let _idbPromise = null;

function _idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(_IDB_STORE)) {
        req.result.createObjectStore(_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idbPromise;
}

/** Returns the cached value for `key`, or undefined if missing/unavailable.
 * Never throws — a cache that can fail a caller's render path defeats the
 * point of a cache; every call site should treat undefined as "no cache
 * yet, wait for the network" exactly like the old localStorage-fallback
 * pattern already did. */
async function idbGet(key) {
  try {
    const db = await _idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, "readonly");
      const req = tx.objectStore(_IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return undefined;
  }
}

/** Stores `value` under `key`. Fire-and-forget from the caller's
 * perspective (still async so a caller that cares can await it) — a failed
 * cache write should never block or fail the caller's own save/render. */
async function idbSet(key, value) {
  try {
    const db = await _idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, "readwrite");
      tx.objectStore(_IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {
    /* no-op — see idbGet's note on never throwing */
  }
}
