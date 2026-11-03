// Shared UI helpers: icons, sheets, dialogs, toasts, formatting.
const P = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  back: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  fwd: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  chev: '<path d="m15 18-6-6 6-6"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkc: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  hi: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  undo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
  redo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  git: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v6"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  sync: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  zoomin: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  zoomout: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  install: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.7-1.7h2a5.6 5.6 0 0 0 5.5-5.5C22 6 17.5 2 12 2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M9.9 4.2A9.6 9.6 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.4 3.4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 8 10 8c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>'
};

export function icon(name, size = 22, sw = 2) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ar-EG');
export const ar = (n) => nf.format(n);
export const mb = (bytes) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format((bytes || 0) / 1048576) + ' م.ب';
export function ago(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'دلوقتي';
  if (d < 3600) return 'من ' + ar(Math.round(d / 60)) + ' دقيقة';
  if (d < 86400) return 'من ' + ar(Math.round(d / 3600)) + ' ساعة';
  if (d < 172800) return 'امبارح';
  return new Date(ts).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}
export function haptic(ms = 8) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

const layer = () => document.getElementById('layer');

// ---------- Toast ----------
let toastWrap;
export function toast(msg, opts = {}) {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toasts'; document.body.appendChild(toastWrap); }
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ''}`;
  toastWrap.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (opts.action) el.querySelector('button').onclick = () => { close(); opts.onAction && opts.onAction(); };
  setTimeout(close, opts.ms || (opts.action ? 4500 : 2600));
  return close;
}

// ---------- Back-button aware overlay stack ----------
// Each open sheet pushes a history entry so the phone's back button closes it.
const overlays = [];
let skipPop = 0;
window.addEventListener('popstate', () => {
  if (skipPop) { skipPop--; return; }
  const top = overlays.pop();
  if (top) top.close(undefined, { fromPop: true });
});
export function closeAllOverlays() { while (overlays.length) overlays.pop().close(undefined, { silent: true }); }
// Navigate to a route (optionally from inside a sheet, replacing its history entry)
export function go(route) {
  const top = overlays.length ? overlays.pop() : null;
  if (top) {
    top.close(undefined, { silent: true });
    history.replaceState(null, '', '#' + route);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = route;
  }
}

// ---------- Bottom sheet ----------
export function sheet({ title = '', html = '', onMount, closeBtn = true } = {}) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grabber"></div>
    ${title || closeBtn ? `<div class="sheet-h"><h3>${esc(title)}</h3>${closeBtn ? `<button class="iconbtn" data-close aria-label="إغلاق">${icon('x', 20)}</button>` : ''}</div>` : ''}
    <div class="sheet-body">${html}</div></div>`;
  layer().appendChild(bd);
  const sh = bd.firstElementChild;
  let resolveP;
  const done = new Promise((r) => (resolveP = r));
  let closed = false;
  const entry = {};
  const close = (val, o = {}) => {
    if (closed) return; closed = true;
    const i = overlays.indexOf(entry);
    if (i >= 0) overlays.splice(i, 1);
    if (!o.fromPop && !o.silent) { skipPop++; history.back(); }
    sh.classList.add('closing'); bd.classList.add('closing');
    setTimeout(() => bd.remove(), 220);
    resolveP(val);
  };
  entry.close = close;
  history.pushState({ overlay: true }, '');
  overlays.push(entry);
  bd.addEventListener('click', (e) => { if (e.target === bd || e.target.closest('[data-close]')) close(); });
  // drag-to-dismiss on grabber
  let sy = null;
  sh.querySelector('.grabber').addEventListener('pointerdown', (e) => { sy = e.clientY; sh.setPointerCapture(e.pointerId); });
  sh.addEventListener('pointermove', (e) => { if (sy !== null) { const dy = Math.max(0, e.clientY - sy); sh.style.transform = `translateY(${dy}px)`; } });
  sh.addEventListener('pointerup', (e) => { if (sy !== null) { const dy = e.clientY - sy; sy = null; if (dy > 90) close(); else sh.style.transform = ''; } });
  const api = { el: sh, close, done };
  onMount && onMount(sh, api);
  const f = sh.querySelector('[autofocus]');
  if (f) setTimeout(() => f.focus(), 280);
  return api;
}

// ---------- Confirm dialog ----------
export function confirmDlg(title, msg, okLabel = 'تأكيد', danger = false) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'backdrop center';
    bd.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(msg)}</p>
      <div class="acts"><button class="btn" data-v="0">إلغاء</button><button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(okLabel)}</button></div></div>`;
    layer().appendChild(bd);
    bd.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b || e.target === bd) { bd.remove(); resolve(!!(b && b.dataset.v === '1')); }
    });
  });
}

// ---------- Form sheet (inputs) ----------
// fields: [{name,label,type:'text'|'textarea'|'number',value,placeholder,dir}]
export function formSheet({ title, fields, ok = 'حفظ', extra = '', danger }) {
  const html = `<form class="stack" novalidate>
    ${fields.map((f, i) => `<div class="field"><label for="ff${i}">${esc(f.label)}</label>
      ${f.type === 'textarea'
        ? `<textarea class="textarea" id="ff${i}" name="${f.name}" placeholder="${esc(f.placeholder || '')}" ${i === 0 ? 'autofocus' : ''}>${esc(f.value || '')}</textarea>`
        : `<input class="input ${f.dir === 'ltr' ? 'ltr' : ''}" id="ff${i}" name="${f.name}" type="${f.type || 'text'}" ${f.type === 'number' ? 'inputmode="numeric"' : ''} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.list ? `list="${f.list.id}"` : ''} ${i === 0 ? 'autofocus' : ''}>
          ${f.list ? `<datalist id="${f.list.id}">${f.list.items.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`}
      </div>`).join('')}
    ${extra}
    <div style="display:flex;gap:10px">${danger ? `<button type="button" class="btn danger" data-del>${icon('trash', 18)}${esc(danger)}</button>` : ''}<button class="btn primary" style="flex:1" type="submit">${esc(ok)}</button></div>
  </form>`;
  return new Promise((resolve) => {
    let result = null;
    const s = sheet({
      title, html,
      onMount(el, api) {
        const form = el.querySelector('form');
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const data = {};
          for (const f of fields) data[f.name] = form.elements[f.name].value.trim();
          result = data; api.close();
        });
        const del = el.querySelector('[data-del]');
        if (del) del.onclick = () => { result = { __delete: true }; api.close(); };
      }
    });
    s.done.then(() => resolve(result));
  });
}

export function setThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', bg); m.removeAttribute('media'); });
}
