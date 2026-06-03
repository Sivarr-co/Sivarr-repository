const CACHE = 'sivarr-v3';

const PRECACHE = [
  '/',
  '/css/styles.css',
  '/static/sivarrai.png',
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

// ── Fetch strategy ────────────────────────────────────────────
//   API calls   → network only (never cache POST/auth)
//   Static JS/CSS/images → network first, fall back to cache
//   Navigation  → network first, fall back to cached root
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET and all API calls
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

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
