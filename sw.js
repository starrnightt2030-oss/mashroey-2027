// Service worker — makes the app installable and work offline.
const VERSION = 'v1.3.3';
const SHELL = `shell-${VERSION}`;
const RUNTIME = 'runtime-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/db.js', 'js/catalog.js', 'js/reader.js', 'js/notes.js', 'js/ink.js', 'js/pdf.js', 'js/tts.js', 'js/export.js', 'js/admin.js', 'js/arfix.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/perfect-freehand.mjs',
  'vendor/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2', 'vendor/fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2',
  'vendor/fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2', 'vendor/fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2',
  'vendor/fonts/ibm-plex-sans-arabic-latin-400-normal.woff2', 'vendor/fonts/ibm-plex-sans-arabic-latin-500-normal.woff2',
  'vendor/fonts/ibm-plex-sans-arabic-latin-600-normal.woff2', 'vendor/fonts/ibm-plex-sans-arabic-latin-700-normal.woff2',
  'vendor/fonts/alexandria-arabic-500-normal.woff2', 'vendor/fonts/alexandria-arabic-600-normal.woff2', 'vendor/fonts/alexandria-arabic-700-normal.woff2',
  'vendor/fonts/alexandria-latin-500-normal.woff2', 'vendor/fonts/alexandria-latin-600-normal.woff2', 'vendor/fonts/alexandria-latin-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname;
  if (path.includes('/push/onesignal/')) return;

  // catalog: always try the network first so new files show up
  if (path.endsWith('/files/index.json')) {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(RUNTIME).then((c) => c.put(new Request(url.pathname), copy)); }
      return r;
    }).catch(() => caches.match(new Request(url.pathname))));
    return;
  }
  // PDFs and audio are stored by the app itself (IndexedDB) — don't double-cache
  if (/\/files\/.*\.(pdf|mp3|m4a|aac|ogg|wav|webm)$/i.test(path)) return;

  // thumbnails, cmaps, standard fonts, pdf-lib: cache on first use
  if (/\/files\/thumbs\//.test(path) || /\/vendor\//.test(path)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
      return r;
    })));
    return;
  }
  // app shell: navigation → cached index.html
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: false }).then((hit) => hit || fetch(req)));
});

// ---- content-update notifications (no server needed) ----
async function checkUpdates() {
  try {
    const r = await fetch('files/index.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    const v = j.version || 0;
    const c = await caches.open('app-state');
    const seenR = await c.match('seen-version');
    if (!seenR) return;
    const seen = +(await seenR.text());
    const notR = await c.match('notified-version');
    const notified = notR ? +(await notR.text()) : 0;
    if (v > seen && v > notified) {
      const ann = (j.announcements || []).filter((a) => a.version > seen).sort((a, b) => b.at - a.at)[0];
      const body = ann ? ann.title + (ann.text ? ' — ' + ann.text.slice(0, 120) : '') : (j.notice && j.notice.version === v && j.notice.text) || 'المدرس نزّل محتوى جديد — افتح التطبيق عشان يوصلك.';
      await self.registration.showNotification(ann ? 'مشروع التخرج — تعليمات جديدة' : 'مشروع التخرج — تحديث جديد', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'content-update', lang: 'ar', dir: 'rtl' });
      await c.put('notified-version', new Response(String(v)));
      if (self.navigator.setAppBadge) self.navigator.setAppBadge(1).catch(() => {});
    }
  } catch (e) {}
}
self.addEventListener('periodicsync', (e) => { if (e.tag === 'check-updates') e.waitUntil(checkUpdates()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return self.clients.openWindow('./');
  }));
});
