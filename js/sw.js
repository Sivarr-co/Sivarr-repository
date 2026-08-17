// This file is rendered through Jinja by the /sw.js route (served no-store, so
// it is always fresh) — asset() stamps each URL with its content hash, exactly
// matching the URLs index.html requests. Previously the precache list carried a
// hand-written ?v= that drifted out of sync with index.html's, so the precached
// URL was never the one the page actually asked for.
//
// CACHE is derived from those same hashes, so the whole cache is invalidated
// automatically whenever any precached asset changes. No more manual v8 -> v9.
const CACHE = 'sivarr-{{ sw_version }}';

// '/css/styles.css' used to be here — that file hasn't existed since the
// base/layout/panels/mobile split, and caches.addAll() fails its whole
// batch on any single 404.
const PRECACHE = [
  '/',
  '/app',
  '{{ asset("/static/sivarrai.png") }}',
  '{{ asset("/static/manifest.json") }}',
  '{{ asset("/css/base.css") }}',
  '{{ asset("/css/layout.css") }}',
  '{{ asset("/css/panels.css") }}',
  '{{ asset("/css/mobile.css") }}',
  '{{ asset("/js/app.js") }}',
];

// Install: pre-cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate: delete old cache versions
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Push notification received ────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'SIVARR', body: 'You have an update.' };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; }
    catch { data.body = e.data.text() || data.body; }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  '/static/sivarrai.png',
      badge: '/static/sivarrai.png',
      tag:   data.tag || 'sivarr',
      data:  { url: data.url || '/app' },
      requireInteraction: false,
    })
  );
});

// ── Notification click → focus or open the app ───────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/app';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const existing = all.find(c => new URL(c.url).pathname.startsWith('/app'));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

// ── Background sync — flush offline mutation queue ────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sivarr-sync') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'FLUSH_QUEUE' }));
      })
    );
  }
});

// ── Fetch strategy ────────────────────────────────────────────
//   API calls   → network only (never cache POST/auth)
//   Static JS/CSS/images → network first, fall back to cache
//   Navigation  → network first, fall back to cached root
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin GETs. Never intercept cross-origin requests
  // (Sentry loader, Plausible, Paystack, fonts…): calling fetch() on them from
  // the SW counts against connect-src CSP and gets blocked, which then breaks
  // the response (e.g. "Sentry is not defined"). Let the browser load those.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(hit => {
          if (hit) return hit;
          if (e.request.mode === 'navigate') return caches.match('/');
        })
      )
  );
});
