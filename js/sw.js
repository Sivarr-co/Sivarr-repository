const CACHE = 'sivarr-v8';

// '/css/styles.css' used to be here — that file hasn't existed since the
// base/layout/panels/mobile split, and caches.addAll() fails its whole
// batch on any single 404, so the precache step may have been silently
// no-op-ing since then. '/js/app.js' and the CSS files are intentionally
// left off this list too now: they're always loaded with a cache-busting
// ?v= query string from index.html, so precaching the bare unversioned
// URL here doesn't help hit those specific requests anyway.
const PRECACHE = [
  '/',
  '/app',
  '/static/sivarrai.png?v=20260815b',
  '/static/manifest.json',
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
      icon:  '/static/sivarrai.png?v=20260815b',
      badge: '/static/sivarrai.png?v=20260815b',
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
