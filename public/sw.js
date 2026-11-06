/* Altidian service worker: installs the app, keeps it opening on a poor connection,
   serves study files a student saved for offline reading, and shows push notifications.
   Pages are always fetched fresh when online. Account and quiz data (/api) is never saved. */
const CACHE = 'altidian-shell-v19';
const OFFLINE = 'altidian-offline-v1'; // files saved by students; managed by the page, never wiped here
const SHELL = ['/', '/css/app.css', '/js/app.js', '/logo.png', '/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== OFFLINE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // fonts etc. go straight to the network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return; // never save account, quiz or admin data

  if (url.pathname.startsWith('/files/')) { // saved files: the network first, the saved copy when there is no network
    e.respondWith(fetch(req).catch(() => caches.open(OFFLINE).then((c) => c.match(url.pathname)).then((hit) => hit || Response.error())));
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});

/* ---------- push notifications ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Altidian', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'altidian', renotify: true, data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(target.href) : w));
    }
    return self.clients.openWindow(target.href);
  }));
});
