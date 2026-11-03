// مشروع التخرج — app shell: router, library, bookmarks, notes hub, settings.
import { icon, esc, ar, mb, ago, toast, sheet, confirmDlg, go, closeAllOverlays, setThemeColor, $ } from './ui.js';
import { db, persist, STORES } from './db.js';
import { loadCatalog, getCatalog, findFile, downloadedIds, getPdfBytes, invalidateDownloads } from './catalog.js';

export const APP_VERSION = '1.2.1';
const DEV = { name: 'Mohamed Eldawly', role: 'Designed & Developed by', product: 'Graduation Project' };

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let cleanup = null;
let deferredInstall = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------------- navigation ----------------
const navStack = [];
function currentRoute() { return location.hash.replace(/^#/, '') || '/'; }
export function goBack(fallback = '/') {
  if (navStack.length > 1) history.back();
  else { history.replaceState(null, '', '#' + fallback); onRoute(); }
}

const TABS = [
  { r: '/', ic: 'home', t: 'المكتبة' },
  { r: '/marks', ic: 'bookmark', t: 'العلامات' },
  { r: '/mynotes', ic: 'note', t: 'ملاحظاتي' },
  { r: '/settings', ic: 'sliders', t: 'الإعدادات' }
];
function renderTabbar(route) {
  const main = TABS.some((t) => t.r === route);
  tabbar.classList.toggle('away', !main);
  tabbar.innerHTML = TABS.map((t) => `<a class="tab ${t.r === route ? 'on' : ''}" href="#${t.r}" ${t.r === route ? 'aria-current="page"' : ''}>${icon(t.ic, 22)}<span>${t.t}</span></a>`).join('');
}

async function onRoute() {
  const full = currentRoute();
  if (navStack[navStack.length - 2] === full) navStack.pop();
  else if (navStack[navStack.length - 1] !== full) navStack.push(full);
  closeAllOverlays();
  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  const [path, qs] = full.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  renderTabbar(path);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) await viewLibrary();
    else if (parts[0] === 'marks') await viewMarks();
    else if (parts[0] === 'mynotes') await viewNotesHub();
    else if (parts[0] === 'settings') await viewSettings();
    else if (parts[0] === 'admin') { const m = await import('./admin.js'); cleanup = await m.mountAdmin(view, { goBack }); }
    else if (parts[0] === 'read' || parts[0] === 'notes') {
      let file = findFile(parts[1]);
      if (!file) { await loadCatalog(); file = findFile(parts[1]); }
      if (!file) { toast('الملف ده مش موجود'); history.replaceState(null, '', '#/'); return onRoute(); }
      if (parts[0] === 'read') {
        const m = await import('./reader.js');
        cleanup = await m.mountReader(view, file, { page: +params.get('p') || 0, goBack });
      } else {
        const m = await import('./notes.js');
        cleanup = await m.mountNotes(view, file, { goBack });
      }
    } else { history.replaceState(null, '', '#/'); return onRoute(); }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page"><div class="empty"><h3>حصلت مشكلة</h3><span>${esc(e.message || e)}</span><button class="btn primary sm" onclick="location.reload()">إعادة تحميل</button></div></div>`;
  }
  hideSplash();
}
window.addEventListener('hashchange', onRoute);

function hideSplash() {
  const s = document.getElementById('splash');
  if (s && !s.classList.contains('out')) { s.classList.add('out'); setTimeout(() => s.remove(), 400); }
}

const credits = () => `<footer class="credits">
  <div class="rule"><span class="k">${DEV.role}</span></div>
  <div class="who"><em>&lt;/&gt;</em> ${esc(DEV.name)}</div>
  <div class="meta">${DEV.product} · v${APP_VERSION} · © ${new Date().getFullYear()} All rights reserved</div>
</footer>`;

// ---------------- library ----------------
const FILTERS = [
  { id: 'all', t: 'كل الملفات' }, { id: 'new', t: 'الجديدة' }, { id: 'dl', t: 'المحمّلة' }, { id: 'done', t: 'خلصتها' }
];
const isNew = (f, m) => !(m && m.opened) && Date.now() - (f.added || 0) < 14 * 864e5;
const tint = (s) => ['#E2E9FC', '#FDE6E9', '#E6EEF9', '#F1E8FB', '#E3F0FB', '#FBEDEF'][[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6];

async function viewLibrary() {
  let filter = sessionStorage.getItem('lib-filter') || 'all';
  let q = '';
  view.innerHTML = `<div class="page stack">
    <div class="appbar">
      <div class="brand"><div class="brand-mark"><img src="icons/icon-192.png" alt=""></div>
        <div><div class="brand-name">مشروع التخرج</div><div class="brand-sub">مكتبتك الدراسية</div></div></div>
      <button class="iconbtn boxed" id="libRefresh" aria-label="تحديث قائمة الملفات">${icon('sync', 20)}</button>
    </div>
    <label class="search">${icon('search', 18)}<input id="libQ" type="search" placeholder="ابحث في الملفات…" aria-label="بحث"></label>
    <div id="libInstall"></div>
    <div id="libNotif"></div>
    <div id="libHero"></div>
    <div class="chips" id="libChips" role="tablist"></div>
    <div id="libList"></div>
    ${credits()}
  </div>`;

  let metas = {}, dl = new Set();
  async function loadLocal() {
    metas = Object.fromEntries(await db.entries('meta'));
    dl = await downloadedIds();
  }
  function draw() {
    const files = getCatalog().files;
    // install banner
    const ib = $('#libInstall');
    if (ib) ib.innerHTML = !isStandalone() && (deferredInstall || isIOS) && !localStorage.getItem('install-dismissed') ? `
      <div class="card" style="display:flex;align-items:center;gap:12px">
        <div class="ri" style="width:42px;height:42px;border-radius:13px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center">${icon('install', 22)}</div>
        <div style="flex:1"><b style="font-size:14.5px">ثبّت التطبيق على موبايلك</b><div class="hint">يفتح زي أي تطبيق ويشتغل من غير نت</div></div>
        <button class="btn primary sm" id="doInstall">تثبيت</button>
        <button class="iconbtn" id="noInstall" aria-label="إخفاء" style="width:34px;height:34px">${icon('x', 16)}</button>
      </div>` : '';
    const di = $('#doInstall'); if (di) di.onclick = promptInstall;
    const ni = $('#noInstall'); if (ni) ni.onclick = () => { localStorage.setItem('install-dismissed', '1'); draw(); };
    const nb = $('#libNotif');
    if (nb) nb.innerHTML = 'Notification' in window && Notification.permission === 'default' && !localStorage.getItem('notif-dismissed') ? `
      <div class="card" style="display:flex;align-items:center;gap:12px;border-color:var(--red-soft)">
        <div style="width:42px;height:42px;border-radius:13px;background:var(--red-soft);color:var(--red);display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon('bell', 22)}</div>
        <div style="flex:1"><b style="font-size:14.5px">فعّل الإشعارات</b><div class="hint">عشان يوصلك إشعار أول ما المدرس ينزّل جديد</div></div>
        <button class="btn primary sm" id="doNotif">تفعيل</button>
        <button class="iconbtn" id="noNotif" aria-label="إخفاء" style="width:34px;height:34px">${icon('x', 16)}</button>
      </div>` : '';
    const dn = $('#doNotif'); if (dn) dn.onclick = async () => { await enableNotifications(); draw(); };
    const nn = $('#noNotif'); if (nn) nn.onclick = () => { localStorage.setItem('notif-dismissed', '1'); draw(); };

    // continue reading
    const last = files.filter((f) => metas[f.id] && metas[f.id].opened && !metas[f.id].done).sort((a, b) => metas[b.id].opened - metas[a.id].opened)[0];
    const hero = $('#libHero');
    if (last && !q) {
      const m = metas[last.id];
      const pages = m.pages || last.pages || 1;
      const pct = Math.round(((m.lastPage || 1) / pages) * 100);
      hero.innerHTML = `<div class="hero">
        <div class="hero-top"><span class="hero-label">كمّل من مكان ما وقفت</span><span class="pill">صفحة ${ar(m.lastPage || 1)} من ${ar(pages)}</span></div>
        <div class="hero-title">${esc(last.title)}</div>
        <div class="hero-row"><div class="progress"><i style="width:${pct}%"></i></div><span style="font-size:13px;color:var(--hero-muted)">${ar(pct)}٪</span></div>
        <div class="hero-actions">
          <a class="btn-light" href="#/read/${last.id}">متابعة القراءة ${icon('fwd', 18)}</a>
          <a class="btn-ghost-light" href="#/notes/${last.id}" aria-label="ملاحظات الملف">${icon('note', 20)}</a>
        </div></div>`;
    } else hero.innerHTML = '';

    // chips
    const counts = {
      all: files.length,
      new: files.filter((f) => isNew(f, metas[f.id])).length,
      dl: files.filter((f) => dl.has(f.id)).length,
      done: files.filter((f) => metas[f.id] && metas[f.id].done).length
    };
    $('#libChips').innerHTML = FILTERS.map((f) => `<button class="chip ${filter === f.id ? 'on' : ''}" data-f="${f.id}" role="tab" aria-selected="${filter === f.id}">${f.t}${counts[f.id] && f.id !== 'all' ? ` <span class="n">${ar(counts[f.id])}</span>` : ''}</button>`).join('');
    $('#libChips').querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; sessionStorage.setItem('lib-filter', filter); draw(); });

    // list
    let list = files.filter((f) => {
      const m = metas[f.id];
      if (filter === 'new' && !isNew(f, m)) return false;
      if (filter === 'dl' && !dl.has(f.id)) return false;
      if (filter === 'done' && !(m && m.done)) return false;
      if (q && !(`${f.title} ${f.unit || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const el = $('#libList');
    if (!files.length) {
      el.innerHTML = `<div class="empty"><div class="ill">${icon('file', 28)}</div><h3>لسه مفيش ملفات</h3><span>أول ما المدرس يرفع الملفات هتظهر هنا على طول.</span></div>`;
      return;
    }
    if (!list.length) {
      el.innerHTML = `<div class="empty"><div class="ill">${icon('search', 28)}</div><h3>مفيش نتايج</h3><span>جرّب كلمة تانية أو فلتر تاني.</span></div>`;
      return;
    }
    const groups = new Map();
    for (const f of list) { const u = f.unit || 'ملفات عامة'; if (!groups.has(u)) groups.set(u, []); groups.get(u).push(f); }
    el.innerHTML = [...groups].map(([u, fs]) => `
      <div class="sec" style="margin:8px 0 10px"><h2>${esc(u)}</h2><span>${ar(fs.length)} ملف</span></div>
      <div class="files">${fs.map((f) => card(f, metas[f.id], dl.has(f.id))).join('')}</div>`).join('');
  }
  function card(f, m, isDl) {
    const thumb = f.thumb || (m && m.thumb);
    const pages = (m && m.pages) || f.pages;
    const pct = m && m.opened && pages ? Math.round(((m.lastPage || 1) / pages) * 100) : 0;
    const nb = m ? m.bookmarks.length : 0;
    return `<a class="fcard" href="#/read/${f.id}">
      <div class="cover" style="background:${tint(f.unit || f.title)}">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : '<i></i><i></i><i></i><i style="width:80%"></i><b>PDF</b>'}</div>
      <div class="fbody">
        <div class="ftitle"><span>${esc(f.title)}</span>${isNew(f, m) ? '<span class="badge-new">جديد</span>' : ''}</div>
        <div class="fmeta">${pages ? ar(pages) + ' صفحة · ' : ''}${mb(f.size)}${nb ? ` · ${ar(nb)} علامة` : ''}</div>
        ${pct ? `<div class="mini-progress"><i style="width:${pct}%"></i></div>` : ''}
        <div class="fstate ${isDl ? 'ok' : ''}">${isDl ? icon('checkc', 14, 2.2) + '<span>متاح بدون نت</span>' : icon('download', 14) + '<span>اضغط للتحميل</span>'}${f.audio ? ` · ${icon('music', 13)}<span>فيه تسجيل</span>` : ''}</div>
      </div>
      <div class="fside">${m && m.done ? `<span class="done-tick">${icon('check', 15, 3)}</span>` : pct ? `<b>${ar(pct)}٪</b>` : ''}</div>
    </a>`;
  }

  $('#libQ').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  $('#libRefresh').onclick = async (e) => {
    const b = e.currentTarget; b.style.animation = 'spin .8s linear infinite';
    await refreshCatalog(true);
    b.style.animation = '';
    await loadLocal(); draw();
  };

  await loadLocal();
  draw();
  // refresh from network in the background
  refreshCatalog(false).then(async (changed) => { if (changed && currentRoute() === '/') { await loadLocal(); draw(); } });
}

async function refreshCatalog(manual) {
  const before = JSON.stringify(getCatalog().files.map((f) => f.id + f.title));
  const cat = await loadCatalog();
  const after = JSON.stringify(cat.files.map((f) => f.id + f.title));
  await checkContentUpdate(cat);
  if (manual) toast(navigator.onLine ? 'المكتبة محدّثة' : 'انت أوفلاين — دي آخر نسخة متحفظة');
  return before !== after;
}

// ---------------- mandatory content updates ----------------
// Every teacher sync bumps index.version. When a student's app sees a newer version it shows a
// blocking "update now" screen that downloads the new files, so every student gets every update.
let updateOpen = false;
function setSeen(cat) {
  const v = cat.version || 0;
  try {
    localStorage.setItem('seen-version', String(v));
    localStorage.setItem('known-ids', JSON.stringify(cat.files.map((f) => f.id)));
  } catch (e) {}
  try { caches.open('app-state').then((c) => c.put('seen-version', new Response(String(v)))); } catch (e) {}
  try { navigator.clearAppBadge && navigator.clearAppBadge(); } catch (e) {}
}
async function checkContentUpdate(cat) {
  const v = cat.version || 0;
  const seenRaw = localStorage.getItem('seen-version');
  if (seenRaw === null) { setSeen(cat); return; }
  if (v <= +seenRaw || updateOpen) return;
  if (currentRoute().startsWith('/admin')) { setSeen(cat); return; } // the teacher just published it
  let known = [];
  try { known = JSON.parse(localStorage.getItem('known-ids') || '[]'); } catch (e) {}
  const fresh = cat.files.filter((f) => !known.includes(f.id));
  try { navigator.setAppBadge && navigator.setAppBadge(fresh.length || 1); } catch (e) {}
  if (document.hidden) notifySystem(cat, fresh);
  showUpdateModal(cat, fresh);
}
async function notifySystem(cat, fresh) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const body = (cat.notice && cat.notice.version === cat.version && cat.notice.text) ||
      (fresh.length ? `اتضاف: ${fresh.slice(0, 3).map((f) => f.title).join('، ')}` : 'المدرس حدّث محتوى المكتبة');
    reg.showNotification('مشروع التخرج — تحديث جديد', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'content-update', lang: 'ar', dir: 'rtl', renotify: true });
  } catch (e) {}
}
function showUpdateModal(cat, fresh) {
  updateOpen = true;
  const note = cat.notice && cat.notice.version === cat.version ? cat.notice.text : '';
  const bd = document.createElement('div');
  bd.className = 'backdrop center upd-modal';
  bd.innerHTML = `<div class="dialog upd" role="alertdialog" aria-modal="true" aria-labelledby="updT">
    <div class="upd-ic">${icon('bell', 30)}</div>
    <h3 id="updT">تحديث جديد من المدرس</h3>
    ${note ? `<div class="upd-note">${esc(note)}</div>` : ''}
    ${fresh.length ? `<div class="upd-list">${fresh.slice(0, 5).map((f) => `<div>${icon('file', 16)}<span>${esc(f.title)}</span></div>`).join('')}${fresh.length > 5 ? `<small>و${ar(fresh.length - 5)} ملفات كمان</small>` : ''}</div>`
      : '<p>المدرس حدّث المكتبة — دوس تحديث عشان يوصلك آخر محتوى.</p>'}
    <div class="upd-prog hidden"><div class="progress"><i></i></div><small></small></div>
    <button class="btn primary block" id="updGo">${icon('download', 18)} تحديث الآن</button>
    <div class="hint" style="text-align:center;margin-top:8px">التحديث إجباري عشان يوصلك كل جديد</div>
  </div>`;
  document.body.appendChild(bd);
  const go = bd.querySelector('#updGo');
  go.onclick = async () => {
    go.disabled = true; go.textContent = 'بيحدّث…';
    const pr = bd.querySelector('.upd-prog'); pr.classList.remove('hidden');
    const bar = pr.querySelector('i'), lbl = pr.querySelector('small');
    let fail = 0;
    for (const [i, f] of fresh.entries()) {
      try {
        await getPdfBytes(f, (p) => { bar.style.width = Math.round(((i + p) / fresh.length) * 100) + '%'; lbl.textContent = `بيحمّل ${ar(i + 1)} من ${ar(fresh.length)}`; });
      } catch (e) { fail++; }
    }
    bar.style.width = '100%';
    setSeen(cat);
    updateOpen = false;
    bd.classList.add('closing'); setTimeout(() => bd.remove(), 220);
    toast(fail ? 'المكتبة اتحدّثت — في ملفات هتتحمّل لما تفتحها' : 'تمام! المكتبة محدّثة ومتاحة بدون نت');
    const r = currentRoute();
    if (r === '/' || r === '/settings' || r === '/marks' || r === '/mynotes') onRoute();
  };
}
function showAppUpdateModal(worker) {
  if (document.querySelector('.app-upd')) return;
  const bd = document.createElement('div');
  bd.className = 'backdrop center upd-modal app-upd';
  bd.innerHTML = `<div class="dialog upd" role="alertdialog" aria-modal="true">
    <div class="upd-ic">${icon('sync', 30)}</div>
    <h3>إصدار جديد من التطبيق</h3>
    <p>في تحسينات جديدة للتطبيق. ملاحظاتك وتعليقاتك محفوظة ومش هتتأثر.</p>
    <button class="btn primary block" id="appUpdGo">${icon('sync', 18)} تحديث الآن</button>
  </div>`;
  document.body.appendChild(bd);
  bd.querySelector('#appUpdGo').onclick = (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'بيحدّث…'; worker.postMessage('skip'); };
}
// ---------------- instant push (OneSignal) ----------------
// The teacher sets the OneSignal App ID from the teacher panel (config/push.json). When set, the app
// subscribes students to real push notifications; a GitHub Action sends one after every teacher sync.
let osPromise = null;
async function loadPushConfig() {
  try {
    const r = await fetch('config/push.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); localStorage.setItem('push-cfg', JSON.stringify(j)); return j; }
    if (r.status === 404) { localStorage.removeItem('push-cfg'); return {}; }
  } catch (e) {}
  try { return JSON.parse(localStorage.getItem('push-cfg') || '{}'); } catch (e) { return {}; }
}
function initOneSignal() {
  if (osPromise) return osPromise;
  osPromise = (async () => {
    const cfg = await loadPushConfig();
    if (!cfg.onesignalAppId || !('serviceWorker' in navigator)) return null;
    const base = location.pathname.replace(/[^/]*$/, ''); // e.g. /mashroey-2027/
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    const s = document.createElement('script');
    s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    s.defer = true;
    document.head.appendChild(s);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 20000);
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId: cfg.onesignalAppId,
            serviceWorkerPath: base.slice(1) + 'push/onesignal/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: base + 'push/onesignal/' },
            notifyButton: { enable: false },
            allowLocalhostAsSecureOrigin: true
          });
          // students who allowed notifications before OneSignal was set up: subscribe them silently
          if (Notification.permission === 'granted' && !OneSignal.User.PushSubscription.optedIn) {
            try { await OneSignal.User.PushSubscription.optIn(); } catch (e) {}
          }
          clearTimeout(t); resolve(OneSignal);
        } catch (e) { console.warn('OneSignal', e); clearTimeout(t); resolve(null); }
      });
    });
  })();
  return osPromise;
}
async function pushStatus() {
  if (!('Notification' in window)) return 'none';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const os = await Promise.race([initOneSignal(), new Promise((r) => setTimeout(() => r(null), 1500))]);
  return os && os.User.PushSubscription.optedIn ? 'instant' : 'on';
}
async function enableNotifications() {
  if (!('Notification' in window)) { toast(isIOS ? 'على الآيفون: ثبّت التطبيق على الشاشة الرئيسية الأول، وافتحه من الأيقونة، وبعدين فعّل الإشعارات' : 'المتصفح ده مش بيدعم الإشعارات'); return false; }
  const os = await initOneSignal();
  if (os) {
    try { await os.Notifications.requestPermission(); } catch (e) {}
    if (Notification.permission === 'granted') { try { await os.User.PushSubscription.optIn(); } catch (e) {} }
  } else {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') { toast('الإشعارات مقفولة — تقدر تفتحها من إعدادات المتصفح للموقع'); return false; }
  await registerPeriodic();
  toast('تمام! هيوصلك إشعار أول ما المدرس ينزّل جديد');
  return true;
}
async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return;
    let ok = true;
    try { ok = (await navigator.permissions.query({ name: 'periodic-background-sync' })).state === 'granted'; } catch (e) {}
    if (ok) await reg.periodicSync.register('check-updates', { minInterval: 60 * 60 * 1000 });
  } catch (e) {}
}
function startUpdateChecks() {
  setInterval(() => { if (navigator.onLine) refreshCatalog(false); }, 90000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshCatalog(false);
    navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  });
  window.addEventListener('online', () => refreshCatalog(false));
}

function installHelp() {
  sheet({
    title: 'تثبيت التطبيق',
    html: `<div class="stack">
      <div class="row" style="padding:0"><span class="ri">${icon('more', 20)}</span><span class="rt"><b>١. من Chrome دوس على ⋮ فوق</b><small>القائمة اللي في الركن</small></span></div>
      <div class="row" style="padding:0;border:0"><span class="ri">${icon('install', 20)}</span><span class="rt"><b>٢. اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»</b><small>Install app / Add to Home screen</small></span></div>
      <div class="card stack" style="gap:6px;border-color:var(--red-soft)">
        <b>بيقولك «مثبّت بالفعل» وانت مسحته؟</b>
        <div class="hint">
          • شيل الأيقونة من الشاشة مش بيمسح التطبيق — امسحه من: <b>الإعدادات ← التطبيقات ← مشروع التخرج ← إلغاء التثبيت</b>.<br>
          • وبعدين اقفل Chrome خالص وافتحه تاني، وارجع للموقع ودوس «تثبيت».<br>
          • لو لسه: Chrome ← الإعدادات ← إعدادات المواقع ← كل المواقع ← <b dir="ltr">github.io</b> ← امسح البيانات. (ملاحظاتك هتتمسح، فاعمل نسخة احتياطية الأول من الإعدادات)
        </div>
      </div>
      <button class="btn primary block" data-close>فهمت</button></div>`
  });
}

async function promptInstall() {
  if (deferredInstall) {
    deferredInstall.prompt();
    const r = await deferredInstall.userChoice;
    deferredInstall = null;
    if (r.outcome === 'accepted') toast('اتثبت التطبيق 🎉'.replace(' 🎉', ''));
    if (currentRoute() === '/') viewLibrary();
  } else if (isIOS) {
    sheet({
      title: 'تثبيت على الآيفون',
      html: `<div class="stack">
        <div class="row" style="padding:0"><span class="ri">${icon('share', 20)}</span><span class="rt"><b>١. دوس على زرار المشاركة</b><small>اللي تحت في سفاري</small></span></div>
        <div class="row" style="padding:0;border:0"><span class="ri">${icon('plus', 20)}</span><span class="rt"><b>٢. اختار «إضافة إلى الشاشة الرئيسية»</b><small>Add to Home Screen</small></span></div>
        <div class="row" style="padding:0;border:0"><span class="ri">${icon('check', 20)}</span><span class="rt"><b>٣. دوس «إضافة»</b><small>هتلاقي أيقونة التطبيق على الشاشة</small></span></div>
        <button class="btn primary block" data-close>فهمت</button></div>`
    });
  } else {
    installHelp();
  }
}

// ---------------- bookmarks hub ----------------
async function viewMarks() {
  const metas = await db.entries('meta');
  const files = getCatalog().files;
  const groups = metas
    .map(([id, m]) => ({ f: files.find((x) => x.id === id), m }))
    .filter((g) => g.f && g.m.bookmarks && g.m.bookmarks.length);
  view.innerHTML = `<div class="page stack">
    <div class="titlebar"><h1>العلامات المرجعية</h1></div>
    ${groups.length ? groups.map(({ f, m }) => `
      <div class="glabel">${esc(f.title)}</div>
      <div class="group">${[...m.bookmarks].sort((a, b) => a.page - b.page).map((b) => `
        <a class="row" href="#/read/${f.id}?p=${b.page}">
          <span class="ri" style="color:${b.color}">${icon('bookmark', 19)}</span>
          <span class="rt"><b>${esc(b.label || 'صفحة ' + ar(b.page))}</b><small>صفحة ${ar(b.page)} · ${esc(ago(b.at))}</small></span>
          <span class="chev">${icon('chev', 18)}</span></a>`).join('')}</div>`).join('')
    : `<div class="empty"><div class="ill">${icon('bookmark', 28)}</div><h3>مفيش علامات لسه</h3><span>وانت بتقرا أي ملف، دوس على أيقونة العلامة فوق عشان تحفظ الصفحة المهمة وترجعلها بسرعة.</span></div>`}
    ${credits()}
  </div>`;
}

// ---------------- notes hub ----------------
async function viewNotesHub() {
  const [notes, annos] = await Promise.all([db.entries('notes'), db.entries('annos')]);
  const nm = Object.fromEntries(notes), am = Object.fromEntries(annos);
  const files = getCatalog().files;
  const rows = files.map((f) => {
    const n = nm[f.id] || {}, a = am[f.id] || { pages: {} };
    const texts = (n.texts || []).length, qs = (n.questions || []).length, hand = ((n.hand || {}).strokes || []).length;
    const ink = Object.values(a.pages).reduce((s, p) => s + p.s.length + p.t.length, 0);
    return { f, texts, qs, hand, ink };
  }).filter((r) => r.texts || r.qs || r.hand || r.ink);
  view.innerHTML = `<div class="page stack">
    <div class="titlebar"><h1>ملاحظاتي</h1></div>
    ${rows.length ? `<div class="group">${rows.map((r) => `
      <a class="row" href="#/notes/${r.f.id}">
        <span class="ri">${icon('note', 19)}</span>
        <span class="rt"><b>${esc(r.f.title)}</b><small>${[r.texts && ar(r.texts) + ' ملاحظة', r.qs && ar(r.qs) + ' سؤال', r.hand && 'كتابة بخط اليد', r.ink && ar(r.ink) + ' تعليق على الصفحات'].filter(Boolean).join(' · ')}</small></span>
        <span class="chev">${icon('chev', 18)}</span></a>`).join('')}</div>`
    : `<div class="empty"><div class="ill">${icon('note', 28)}</div><h3>لسه مكتبتش ملاحظات</h3><span>افتح أي ملف ودوس على أيقونة الملاحظات فوق — تقدر تكتب ملاحظات، أسئلة مهمة، أو بخط إيدك.</span></div>`}
    ${credits()}
  </div>`;
}

// ---------------- settings ----------------
async function viewSettings() {
  const theme = localStorage.getItem('theme') || 'auto';
  const files = getCatalog().files;
  const dl = await downloadedIds();
  let used = '';
  try { const e = await navigator.storage.estimate(); used = mb(e.usage); } catch (e) {}
  const TTS = await import('./tts.js');
  const voices = TTS.supported ? await TTS.arabicVoices() : [];
  const curVoice = await TTS.pickVoice();
  const rate = TTS.getRate();
  const notifState = await pushStatus();

  view.innerHTML = `<div class="page stack">
    <div class="titlebar"><h1>الإعدادات</h1></div>

    <div class="glabel">المظهر</div>
    <div class="seg" id="sTheme">
      <button data-t="light">${icon('sun', 16)} فاتح</button><button data-t="auto">تلقائي</button><button data-t="dark">${icon('moon', 16)} داكن</button>
    </div>

    <div class="glabel">القراءة الصوتية</div>
    <div class="card stack" style="gap:12px">
      ${voices.length ? `<div class="field"><label for="sVoice">الصوت</label><select class="select" id="sVoice">${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${curVoice && v.voiceURI === curVoice.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></div>`
        : `<div class="hint">${TTS.supported ? 'مفيش صوت عربي على جهازك. من إعدادات الموبايل ← اللغة ← تحويل النص إلى كلام، نزّل اللغة العربية (ويفضّل صوت Google)، وبعدين ارجع هنا.' : 'المتصفح ده مش بيدعم القراءة الصوتية — استخدم Chrome أو Safari.'}</div>`}
      <div class="field"><label>السرعة</label><div class="seg" id="sRate">${[0.75, 1, 1.25, 1.5].map((r) => `<button data-r="${r}" class="${r === rate ? 'on' : ''}">${ar(r)}×</button>`).join('')}</div></div>
      <button class="btn soft" id="sTest">${icon('volume', 18)} جرّب الصوت</button>
    </div>

    <div class="glabel">الملفات والتخزين</div>
    <div class="group">
      <button class="row" id="sDlAll"><span class="ri">${icon('download', 19)}</span><span class="rt"><b>حمّل كل الملفات</b><small id="sDlInfo">${ar(dl.size)} من ${ar(files.length)} متاحة بدون نت</small></span></button>
      <div class="row"><span class="ri">${icon('database', 19)}</span><span class="rt"><b>المساحة المستخدمة</b><small>${used || '—'}</small></span></div>
      <button class="row" id="sClearDl"><span class="ri">${icon('trash', 19)}</span><span class="rt"><b>مسح الملفات المحمّلة</b><small>ملاحظاتك وتعليقاتك مش هتتمسح</small></span></button>
    </div>

    <div class="glabel">النسخة الاحتياطية لملاحظاتك</div>
    <div class="group">
      <button class="row" id="sBackup"><span class="ri">${icon('upload', 19)}</span><span class="rt"><b>حفظ نسخة احتياطية</b><small>ملف واحد فيه كل تعليقاتك وعلاماتك وملاحظاتك</small></span></button>
      <label class="row" style="cursor:pointer"><span class="ri">${icon('download', 19)}</span><span class="rt"><b>استرجاع من نسخة احتياطية</b><small>لو غيرت موبايلك أو مسحت المتصفح</small></span><input type="file" id="sRestore" accept="application/json,.json" class="sr"></label>
    </div>

    <div class="glabel">التطبيق</div>
    <div class="group">
      ${!isStandalone() ? `<button class="row" id="sInstall"><span class="ri">${icon('install', 19)}</span><span class="rt"><b>ثبّت التطبيق</b><small>على الشاشة الرئيسية زي أي تطبيق</small></span></button>` : ''}
      <button class="row" id="sNotif"><span class="ri">${icon('bell', 19)}</span><span class="rt"><b>إشعارات المحتوى الجديد</b><small>${{ none: 'غير مدعومة هنا' + (isIOS ? ' — ثبّت التطبيق الأول' : ''), denied: 'مقفولة من إعدادات المتصفح', off: 'دوس عشان تفعّلها', on: 'مفعّلة ✓', instant: 'مفعّلة ✓ — إشعارات فورية' }[notifState]}</small></span></button>
      <button class="row" id="sUpdate"><span class="ri">${icon('sync', 19)}</span><span class="rt"><b>البحث عن تحديث</b><small>الإصدار ${APP_VERSION}</small></span></button>
      <a class="row" href="#/admin"><span class="ri">${icon('lock', 19)}</span><span class="rt"><b>لوحة المدرس</b><small>رفع الملفات — بكلمة سر</small></span><span class="chev">${icon('chev', 18)}</span></a>
      <a class="row" href="#/admin?do=pass"><span class="ri">${icon('key', 19)}</span><span class="rt"><b>تغيير كلمة سر المدرس</b><small>للمدرس فقط — بتتزامن مع GitHub</small></span><span class="chev">${icon('chev', 18)}</span></a>
    </div>
    ${credits()}
  </div>`;

  view.querySelectorAll('#sTheme [data-t]').forEach((b) => {
    b.classList.toggle('on', b.dataset.t === theme);
    b.onclick = () => {
      const t = b.dataset.t;
      localStorage.setItem('theme', t);
      if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
      view.querySelectorAll('#sTheme [data-t]').forEach((x) => x.classList.toggle('on', x === b));
      setThemeColor();
    };
  });
  const sv = $('#sVoice');
  if (sv) sv.onchange = () => localStorage.setItem('tts-voice', sv.value);
  view.querySelectorAll('#sRate [data-r]').forEach((b) => b.onclick = () => {
    TTS.setRate(+b.dataset.r);
    view.querySelectorAll('#sRate [data-r]').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#sTest').onclick = async () => {
    if (!TTS.supported) return;
    const s = new TTS.Speaker();
    await s.load(['أهلاً بيك في مشروع التخرج. ده صوت القراءة اللي هيقرالك الملفات.']);
    s.play();
  };
  $('#sDlAll').onclick = async () => {
    const todo = files.filter((f) => !dl.has(f.id));
    if (!todo.length) { toast('كل الملفات متحمّلة بالفعل'); return; }
    const info = $('#sDlInfo');
    let ok = 0;
    for (const [i, f] of todo.entries()) {
      try {
        await getPdfBytes(f, (p) => { info.textContent = `بيحمّل ${ar(i + 1)} من ${ar(todo.length)} — ${ar(Math.round(p * 100))}٪`; });
        ok++;
      } catch (e) {}
    }
    const d2 = await downloadedIds();
    info.textContent = `${ar(d2.size)} من ${ar(files.length)} متاحة بدون نت`;
    toast(ok === todo.length ? 'اتحمّلت كل الملفات — تقدر تقرا من غير نت' : 'في ملفات متحمّلتش — اتأكد من النت');
  };
  $('#sClearDl').onclick = async () => {
    if (await confirmDlg('مسح الملفات المحمّلة؟', 'هتحتاج نت عشان تفتحها تاني. ملاحظاتك وتعليقاتك هتفضل زي ما هي.', 'امسح', true)) {
      await db.clear('pdfs'); invalidateDownloads(); toast('اتمسحت'); viewSettings();
    }
  };
  $('#sBackup').onclick = async () => {
    const data = { app: 'mashroey', v: 1, at: Date.now() };
    for (const s of ['annos', 'meta', 'notes']) data[s] = await db.entries(s);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mashroey-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('اتحفظت النسخة — احتفظ بالملف في مكان أمان');
  };
  $('#sRestore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'mashroey') throw new Error('bad');
      if (!(await confirmDlg('استرجاع النسخة؟', 'ملاحظات الملفات اللي في النسخة هتحل محل الموجودة على الجهاز دلوقتي.', 'استرجع'))) return;
      for (const s of ['annos', 'meta', 'notes']) for (const [k, v] of data[s] || []) await db.set(s, k, v);
      toast('اترجعت ملاحظاتك بنجاح');
    } catch (err) { toast('الملف ده مش نسخة احتياطية صحيحة'); }
    e.target.value = '';
  };
  const si = $('#sInstall'); if (si) si.onclick = promptInstall;
  $('#sNotif').onclick = async () => { if (await enableNotifications()) viewSettings(); };
  $('#sUpdate').onclick = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.update(); if (!reg.waiting && !reg.installing) toast('عندك أحدث إصدار'); }
    else toast('عندك أحدث إصدار');
  };
}

// ---------------- service worker & install ----------------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (currentRoute() === '/') { const ib = $('#libInstall'); if (ib && !ib.innerHTML) viewLibrary(); }
});
window.addEventListener('appinstalled', () => { deferredInstall = null; });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const offer = (w) => showAppUpdateModal(w);
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    } catch (e) { console.warn('SW', e); }
  });
}

// ---------------- boot ----------------
(async function boot() {
  persist();
  setThemeColor();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setThemeColor);
  await loadCatalog({ network: false });
  if (!getCatalog().files.length) await loadCatalog();
  if (!localStorage.getItem('known-ids')) localStorage.setItem('known-ids', JSON.stringify(getCatalog().files.map((f) => f.id)));
  await onRoute();
  startUpdateChecks();
  setTimeout(initOneSignal, 1200);
  if ('Notification' in window && Notification.permission === 'granted') registerPeriodic();
  setTimeout(hideSplash, 1500);
})();
