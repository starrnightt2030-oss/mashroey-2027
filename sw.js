// Service worker — makes the app installable and work offline.
const VERSION = 'v1.0.0';
const SHELL = `shell-${VERSION}`;
const RUNTIME = 'runtime-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/db.js', 'js/catalog.js', 'js/reader.js', 'js/notes.js', 'js/ink.js', 'js/pdf.js', 'js/tts.js', 'js/export.js', 'js/admin.js',
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
