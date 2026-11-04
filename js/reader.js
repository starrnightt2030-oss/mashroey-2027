// The PDF reader: smooth page rendering, pen / highlighter / text notes / eraser,
// bookmarks, zoom (pinch, double-tap, buttons), read-aloud, export.
import { icon, esc, ar, toast, sheet, confirmDlg, formSheet, debounce, uid, haptic, go, mb } from './ui.js';
import { getPdfBytes } from './catalog.js';
import { db, getMeta, getAnnos, getNotes } from './db.js';
import { openPdf, pageText } from './pdf.js';
import { drawAll, drawStroke, hitStroke, simplify, PEN_COLORS, HI_COLORS, NOTE_COLORS, PEN_SIZES, HI_SIZES, BASE } from './ink.js';
import * as TTS from './tts.js';

const PREF_KEY = 'rd-prefs';
function loadPrefs() {
  const d = { pen: '#1D4ED8', penSize: 1, hi: '#F6C445', hiSize: 1, note: 'yellow', night: false, hinted: false };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { return d; }
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BM_COLORS = ['#E0A814', '#D2421A', '#1D4ED8', '#0E8A5F', '#7C3AED'];

export async function mountReader(view, file, { page: startPage, goBack }) {
  const prefs = loadPrefs();
  const st = {
    doc: null, pages: [], sizes: [], els: [], tops: [], W: 0, baseW: 0, zoom: 1,
    tool: null, cur: 1, n: 0, annos: null, meta: null, notes: null,
    undo: [], redo: [], visible: new Set(), dead: false
  };

  view.innerHTML = `
  <div class="reader ${prefs.night ? 'night' : ''}" id="rd">
    <header class="rd-top">
      <button class="iconbtn" id="rdBack" aria-label="رجوع">${icon('back')}</button>
      <div class="rd-title"><b>${esc(file.title)}</b><small id="rdSub">جارٍ الفتح…</small></div>
      <button class="iconbtn" id="rdNotes" aria-label="ملاحظات الملف">${icon('note', 21)}<span class="badge hidden" id="rdNotesN"></span></button>
      <button class="iconbtn" id="rdBm" aria-label="علامة مرجعية للصفحة دي">${icon('bookmark', 21)}</button>
      <button class="iconbtn" id="rdMore" aria-label="المزيد">${icon('more', 22)}</button>
    </header>
    <div class="rd-scroll" id="rdScroll"><div class="rd-pages" id="rdPages">
      <div class="rd-loading" id="rdLoading">
        <div class="ring"></div><b>بيجهّز الملف…</b><small id="rdLoadPct"></small>
      </div>
    </div></div>
    <div class="rd-ind fade" id="rdInd"></div>
    <div class="rd-zoom" id="rdZoom">
      <button id="zIn" aria-label="تكبير">${icon('plus', 18)}</button>
      <button id="zOut" aria-label="تصغير">${icon('minus', 18)}</button>
    </div>
    <div id="rdTts"></div>
    <div class="rd-tools" id="rdTools" role="toolbar" aria-label="أدوات الكتابة">
      <button class="tool" data-tool="pen" aria-label="قلم">${icon('pen')}</button>
      <button class="tool" data-tool="hi" aria-label="قلم تحديد">${icon('hi')}</button>
      <button class="tool" data-tool="text" aria-label="كتابة ملاحظة على الصفحة">${icon('text')}</button>
      <button class="tool" data-tool="eraser" aria-label="ممحاة">${icon('eraser')}</button>
      <span class="tsep"></span>
      <button class="tool" id="tUndo" aria-label="تراجع" disabled>${icon('undo')}</button>
      <button class="tool" id="tRedo" aria-label="إعادة" disabled>${icon('redo')}</button>
      <span class="tsep"></span>
      <button class="tool" id="tStyle" aria-label="اللون والسُمك">${icon('palette')}<span class="cdot" id="tDot"></span></button>
    </div>
  </div>`;

  document.body.classList.add('in-reader');
  const $ = (id) => view.querySelector('#' + id);
  const rd = $('rd'), scroll = $('rdScroll'), pagesEl = $('rdPages');

  $('rdBack').onclick = () => goBack('/');
  $('rdNotes').onclick = () => go('/notes/' + file.id);

  // ---------- load ----------
  let bytes;
  try {
    bytes = await getPdfBytes(file, (p) => { const el = $('rdLoadPct'); if (el) el.textContent = 'بيحمّل ' + ar(Math.round(p * 100)) + '٪'; });
    if (st.dead) return () => {};
    st.doc = await openPdf(bytes);
  } catch (e) {
    console.error(e);
    pagesEl.innerHTML = `<div class="rd-loading"><b>مقدرناش نفتح الملف</b><small>اتأكد إنك متصل بالنت أول مرة تفتح فيها الملف، وجرب تاني.</small>
      <button class="btn primary sm" id="rdRetry">جرّب تاني</button></div>`;
    $('rdRetry').onclick = () => location.reload();
    return () => document.body.classList.remove('in-reader');
  }
  st.n = st.doc.numPages;
  [st.meta, st.annos, st.notes] = await Promise.all([getMeta(file.id), getAnnos(file.id), getNotes(file.id)]);
  for (let i = 1; i <= st.n; i++) st.pages[i] = st.doc.getPage(i);
  const resolved = await Promise.all(st.pages.slice(1));
  st.sizes = resolved.map((p) => { const v = p.getViewport({ scale: 1 }); return { w: v.width, h: v.height }; });
  st.meta.opened = Date.now();
  st.meta.pages = st.n;
  db.set('meta', file.id, st.meta);

  // ---------- build pages ----------
  pagesEl.innerHTML = '';
  for (let i = 1; i <= st.n; i++) {
    const el = document.createElement('div');
    el.className = 'pg';
    el.dataset.n = i;
    el.innerHTML = `<div class="pgload">${ar(i)}</div><canvas class="ink"></canvas>`;
    pagesEl.appendChild(el);
    st.els.push(el);
  }
  const pageData = (n) => (st.annos.pages[n] ||= { s: [], t: [] });

  // ---------- layout & rendering ----------
  function layout() {
    const cw = scroll.clientWidth;
    st.baseW = Math.min(cw - 16, 880);
    st.W = Math.round(st.baseW * st.zoom);
    st.els.forEach((el, i) => {
      const s = st.sizes[i];
      el.style.width = st.W + 'px';
      el.style.height = Math.round(st.W * s.h / s.w) + 'px';
      el.style.setProperty('--pw', st.W + 'px');
    });
    st.tops = st.els.map((el) => el.offsetTop);
    $('rdZoom').classList.toggle('zoomed', st.zoom > 1.01);
    for (const n of st.visible) renderPage(n);
  }

  async function renderPage(n) {
    const el = st.els[n - 1];
    const W = st.W;
    if (!el || el._rW === W || el._busy === W) return;
    el._busy = W;
    try {
      const page = await st.pages[n];
      const s = st.sizes[n - 1];
      const H = W * s.h / s.w;
      let q = Math.min(window.devicePixelRatio || 1, 2.5);
      if (W * H * q * q > 7e6) q = Math.sqrt(7e6 / (W * H));
      const vp = page.getViewport({ scale: (W / s.w) * q });
      const cv = document.createElement('canvas');
      cv.className = 'pdf';
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      if (el._task) { try { el._task.cancel(); } catch (e) {} }
      const task = page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp });
      el._task = task;
      await task.promise;
      if (st.dead || st.W !== W || !st.visible.has(n)) return;
      const old = el.querySelector('canvas.pdf');
      if (old) old.replaceWith(cv); else el.prepend(cv);
      el.querySelector('.pgload')?.remove();
      el._rW = W;
      sizeInk(n); drawInk(n); renderTexts(n); renderRibbon(n);
      if (n === 1 && !file.thumb && !st.meta.thumb) makeThumb(cv);
    } catch (e) {
      if (e && e.name !== 'RenderingCancelledException') console.warn(e);
    } finally {
      if (el._busy === W) el._busy = 0;
    }
  }

  function unrender(n) {
    const el = st.els[n - 1];
    if (!el || !el._rW) return;
    if (el._task) { try { el._task.cancel(); } catch (e) {} }
    el.querySelector('canvas.pdf')?.remove();
    const ink = el.querySelector('canvas.ink'); ink.width = ink.height = 0;
    if (!el.querySelector('.pgload')) el.insertAdjacentHTML('afterbegin', `<div class="pgload">${ar(n)}</div>`);
    el._rW = 0;
  }

  function makeThumb(cv) {
    try {
      const t = document.createElement('canvas');
      t.width = 120; t.height = Math.round(120 * cv.height / cv.width);
      t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
      st.meta.thumb = t.toDataURL('image/jpeg', 0.7);
      db.set('meta', file.id, st.meta);
    } catch (e) {}
  }

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const n = +en.target.dataset.n;
      if (en.isIntersecting) { st.visible.add(n); renderPage(n); } else { st.visible.delete(n); unrender(n); }
    }
  }, { root: scroll, rootMargin: '120% 0px 120% 0px' });

  // ---------- ink ----------
  function sizeInk(n) {
    const el = st.els[n - 1];
    const ink = el.querySelector('canvas.ink');
    const s = st.sizes[n - 1];
    let q = Math.min(window.devicePixelRatio || 1, 3);
    if (st.W * st.W * s.h / s.w * q * q > 9e6) q = Math.sqrt(9e6 / (st.W * st.W * s.h / s.w));
    const w = Math.round(st.W * q), h = Math.round(st.W * s.h / s.w * q);
    if (ink.width !== w || ink.height !== h) { ink.width = w; ink.height = h; }
    el._iq = q;
  }
  function drawInk(n, live) {
    const el = st.els[n - 1];
    if (!el || !el._rW) return;
    const ink = el.querySelector('canvas.ink');
    const ctx = ink.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ink.width, ink.height);
    ctx.setTransform(el._iq, 0, 0, el._iq, 0, 0);
    drawAll(ctx, (st.annos.pages[n] || { s: [] }).s, st.W, live);
  }

  function renderTexts(n) {
    const el = st.els[n - 1];
    el.querySelectorAll('.tnote').forEach((x) => x.remove());
    for (const t of (st.annos.pages[n] || { t: [] }).t) {
      const d = document.createElement('div');
      d.className = 'tnote c-' + (t.c || 'yellow');
      d.dir = 'rtl';
      d.dataset.id = t.id;
      d.style.right = `calc(var(--pw) * ${(1 - t.x).toFixed(4)})`;
      d.style.top = `calc(var(--pw) * ${t.y.toFixed(4)})`;
      d.textContent = t.text;
      el.appendChild(d);
    }
  }
  function renderRibbon(n) {
    const el = st.els[n - 1];
    el.querySelector('.ribbon')?.remove();
    const b = st.meta.bookmarks.find((x) => x.page === n);
    if (b) el.insertAdjacentHTML('beforeend', `<div class="ribbon" style="background:${b.color}"></div>`);
  }

  // ---------- persistence & undo ----------
  const saveAnnos = debounce(() => {
    for (const k of Object.keys(st.annos.pages)) {
      const p = st.annos.pages[k];
      if (!p.s.length && !p.t.length) delete st.annos.pages[k];
    }
    db.set('annos', file.id, st.annos);
  }, 400);
  const saveMeta = debounce(() => {
    st.meta.lastPage = st.cur;
    st.meta.maxPage = Math.max(st.meta.maxPage || 0, st.cur);
    db.set('meta', file.id, st.meta);
  }, 700);

  function snapshot(n) {
    st.undo.push({ n, before: JSON.stringify(pageData(n)) });
    if (st.undo.length > 60) st.undo.shift();
    st.redo = [];
    updateUndo();
  }
  function restore(from, to) {
    const op = from.pop();
    if (!op) return;
    to.push({ n: op.n, before: JSON.stringify(pageData(op.n)) });
    st.annos.pages[op.n] = JSON.parse(op.before);
    drawInk(op.n); renderTexts(op.n); saveAnnos(); updateUndo();
    if (Math.abs(op.n - st.cur) > 1) goPage(op.n);
    haptic();
  }
  function updateUndo() {
    $('tUndo').disabled = !st.undo.length;
    $('tRedo').disabled = !st.redo.length;
  }
  $('tUndo').onclick = () => restore(st.undo, st.redo);
  $('tRedo').onclick = () => restore(st.redo, st.undo);

  // ---------- tools ----------
  function setTool(t) {
    st.tool = st.tool === t ? null : t;
    view.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    rd.classList.toggle('drawing', st.tool === 'pen' || st.tool === 'hi' || st.tool === 'eraser');
    updateDot();
    if (st.tool && !prefs.hinted) {
      prefs.hinted = true; savePrefs(prefs);
      toast('عشان تحرّك الصفحة وانت بتكتب استخدم صباعين — أو دوس على الأداة تاني', { ms: 5000 });
    }
    haptic(6);
  }
  view.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  function updateDot() {
    const t = st.tool === 'hi' ? prefs.hi : st.tool === 'text' ? (NOTE_COLORS.find((c) => c.id === prefs.note) || NOTE_COLORS[0]).hex : prefs.pen;
    $('tDot').style.background = t;
  }
  updateDot();
  $('tStyle').onclick = openStyle;

  function openStyle() {
    const kind = st.tool === 'hi' ? 'hi' : st.tool === 'text' ? 'text' : 'pen';
    const title = kind === 'hi' ? 'قلم التحديد' : kind === 'text' ? 'لون الملاحظة' : 'القلم';
    const colors = kind === 'hi' ? HI_COLORS : kind === 'text' ? NOTE_COLORS.map((c) => c.hex) : PEN_COLORS;
    const curC = kind === 'hi' ? prefs.hi : kind === 'text' ? (NOTE_COLORS.find((c) => c.id === prefs.note) || NOTE_COLORS[0]).hex : prefs.pen;
    const sizeKey = kind === 'hi' ? 'hiSize' : 'penSize';
    sheet({
      title,
      html: `<div class="stack">
        <div class="swatches">${colors.map((c) => `<button class="swatch ${c === curC ? 'on' : ''}" data-c="${c}" aria-label="لون"><i style="background:${c}"></i></button>`).join('')}</div>
        ${kind !== 'text' ? `<div class="field"><label>السُمك</label><div class="seg">${['رفيع', 'متوسط', 'تقيل'].map((l, i) => `<button data-s="${i}" class="${prefs[sizeKey] === i ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
        <button class="btn primary block" data-close>تمام</button>
      </div>`,
      onMount(el) {
        el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
          el.querySelectorAll('[data-c]').forEach((x) => x.classList.remove('on')); b.classList.add('on');
          const c = b.dataset.c;
          if (kind === 'hi') prefs.hi = c; else if (kind === 'text') prefs.note = NOTE_COLORS.find((x) => x.hex === c).id; else prefs.pen = c;
          savePrefs(prefs); updateDot();
        });
        el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
          el.querySelectorAll('[data-s]').forEach((x) => x.classList.remove('on')); b.classList.add('on');
          prefs[sizeKey] = +b.dataset.s; savePrefs(prefs);
        });
      }
    });
  }

  // ---------- pointer drawing ----------
  // The stroke being written is painted on its own low-latency layer (only that stroke, every frame),
  // with the pen's predicted next points, so writing follows the finger/stylus closely.
  const ptrs = new Map();
  let down = null, live = null, liveN = 0, gesture = null, penDown = false, rafDraw = 0, erased = false;
  let liveCv = null, liveCtx = null, liveQ = 1, predicted = [];

  function ptFor(e, d) {
    return [(e.clientX - d.r.left) / st.W, (e.clientY - d.r.top) / st.W, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5];
  }
  function openLive(n) {
    const el = st.els[n - 1];
    const ink = el.querySelector('canvas.ink');
    liveCv = document.createElement('canvas');
    liveCv.className = 'ink-live';
    liveCv.width = ink.width; liveCv.height = ink.height;
    el.appendChild(liveCv);
    try { liveCtx = liveCv.getContext('2d', { desynchronized: true }); } catch (e) { liveCtx = null; }
    if (!liveCtx) liveCtx = liveCv.getContext('2d');
    liveQ = el._iq || 1;
  }
  function closeLive() { if (liveCv) liveCv.remove(); liveCv = liveCtx = null; predicted = []; }
  function scheduleDraw() {
    if (rafDraw) return;
    rafDraw = requestAnimationFrame(() => {
      rafDraw = 0;
      if (!live || !liveCtx) return;
      if (live.t === 'hi' && live.p.length < 3) return; // marker: no round dot before it moves
      liveCtx.setTransform(1, 0, 0, 1, 0, 0);
      liveCtx.clearRect(0, 0, liveCv.width, liveCv.height);
      liveCtx.setTransform(liveQ, 0, 0, liveQ, 0, 0);
      const s = predicted.length ? Object.assign({}, live, { p: live.p.concat(predicted) }) : live;
      drawStroke(liveCtx, s, st.W, true);
    });
  }
  // flatten a highlighter stroke into a neat straight line when it was drawn roughly straight
  function tidyHighlight(s) {
    const p = s.p;
    if (p.length < 3) return;
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (w > 0.04 && h < Math.max(w * 0.18, s.w * 0.9)) {
      const y = ys.reduce((a, b) => a + b, 0) / ys.length;
      const a = p[0][0], b = p[p.length - 1][0];
      s.p = [[a, y, 0.5], [(a + b) / 2, y, 0.5], [b, y, 0.5]];
    }
  }
  function eraseAt(n, pt) {
    const data = pageData(n);
    const r = 12 / BASE;
    const hit = data.s.filter((s) => hitStroke(s, pt[0], pt[1], r));
    if (!hit.length) return;
    if (!erased) { snapshot(n); erased = true; }
    data.s = data.s.filter((s) => !hit.includes(s));
    drawInk(n); saveAnnos(); haptic(4);
  }

  pagesEl.addEventListener('pointerdown', (e) => {
    if (!rd.classList.contains('drawing')) return;
    if (e.target.closest('.tnote')) return;
    if (e.pointerType === 'touch' && penDown) return; // palm rejection while the stylus is down
    if (e.pointerType === 'pen') penDown = true;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { pagesEl.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault();
    if (ptrs.size === 2) { cancelLive(); startGesture(); return; }
    if (ptrs.size > 2) return;
    const pg = e.target.closest('.pg');
    if (!pg || !pg._rW) return;
    const n = +pg.dataset.n;
    down = { n, r: pg.getBoundingClientRect(), id: e.pointerId };
    const pt = ptFor(e, down);
    if (st.tool === 'pen' || st.tool === 'hi') {
      const hi = st.tool === 'hi';
      live = { t: st.tool, c: hi ? prefs.hi : prefs.pen, w: (hi ? HI_SIZES[prefs.hiSize] : PEN_SIZES[prefs.penSize]) / BASE, p: [pt] };
      if (e.pointerType === 'pen') live.pr = 1;
      liveN = n; openLive(n); scheduleDraw();
    } else if (st.tool === 'eraser') { erased = false; eraseAt(n, pt); }
  });
  const minStep = () => 0.35 / st.W; // ignore sub-pixel jitter
  function onDrawMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture) { moveGesture(); return; }
    if (!down || e.pointerId !== down.id) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of evs.length ? evs : [e]) {
      const pt = ptFor(ev, down);
      if (live) {
        const last = live.p[live.p.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= minStep()) live.p.push(pt);
      } else if (st.tool === 'eraser') eraseAt(down.n, pt);
    }
    if (live) {
      const pr = (e.getPredictedEvents && e.getPredictedEvents()) || [];
      predicted = pr.slice(0, 2).map((ev) => ptFor(ev, down));
      scheduleDraw();
    }
  }
  pagesEl.addEventListener('pointermove', onDrawMove);
  function endPtr(e, cancel) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (e.pointerType === 'pen') penDown = false;
    if (gesture) { if (ptrs.size < 2) endGesture(); return; }
    if (!down || e.pointerId !== down.id) return;
    if (live && !cancel) {
      const s = live; live = null;
      if (s.t === 'hi' && s.p.length < 3) { closeLive(); down = null; return; } // a tap with the marker draws nothing
      if (s.p.length === 1) s.p.push([s.p[0][0] + 0.0004, s.p[0][1] + 0.0004, s.p[0][2]]);
      if (s.t === 'hi') tidyHighlight(s);
      s.p = simplify(s.p);
      snapshot(liveN);
      pageData(liveN).s.push(s);
      drawInk(liveN); saveAnnos();
      closeLive();
    } else if (live) { live = null; closeLive(); }
    down = null;
  }
  pagesEl.addEventListener('pointerup', (e) => endPtr(e, false));
  pagesEl.addEventListener('pointercancel', (e) => endPtr(e, true));
  pagesEl.addEventListener('contextmenu', (e) => e.preventDefault()); // no long-press menu / selection circle
  function cancelLive() { if (live) { live = null; closeLive(); } down = null; }

  // ---------- two-finger pan / pinch ----------
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
  function pinchStart(a, b) {
    const rect = scroll.getBoundingClientRect();
    const m = mid(a, b);
    return { d0: dist(a, b), m0: m, m: m, rect, sl: scroll.scrollLeft, stp: scroll.scrollTop,
      fx: scroll.scrollLeft + (m.x - rect.left), fy: scroll.scrollTop + (m.y - rect.top), s: 1, pinching: false };
  }
  function pinchPreview(g, a, b, allowPan) {
    const m = mid(a, b);
    g.m = m;
    const s = dist(a, b) / g.d0;
    if (!g.pinching && Math.abs(s - 1) > 0.08) g.pinching = true;
    if (g.pinching) {
      g.s = clamp(s, 0.85 / st.zoom, 4.4 / st.zoom);
      pagesEl.style.transformOrigin = `${g.fx}px ${g.fy}px`;
      pagesEl.style.transform = `translate(${m.x - g.m0.x}px, ${m.y - g.m0.y}px) scale(${g.s})`;
    } else if (allowPan) {
      scroll.scrollLeft = g.sl - (m.x - g.m0.x);
      scroll.scrollTop = g.stp - (m.y - g.m0.y);
    }
  }
  function pinchCommit(g) {
    pagesEl.style.transform = '';
    if (!g.pinching) return;
    const z = clamp(st.zoom * g.s, 1, 4);
    setZoom(z, { fx: g.fx, fy: g.fy, sx: g.m.x - g.rect.left, sy: g.m.y - g.rect.top, k: z / st.zoom });
  }
  function startGesture() { const [a, b] = [...ptrs.values()]; gesture = pinchStart(a, b); }
  function moveGesture() { const [a, b] = [...ptrs.values()]; if (a && b) pinchPreview(gesture, a, b, true); }
  function endGesture() { pinchCommit(gesture); gesture = null; }

  // pinch while browsing (hand mode) — native scroll stays smooth for one finger
  let tpinch = null;
  const tp = (t) => ({ x: t.clientX, y: t.clientY });
  scroll.addEventListener('touchstart', (e) => {
    if (rd.classList.contains('drawing')) return;
    if (e.touches.length === 2) tpinch = pinchStart(tp(e.touches[0]), tp(e.touches[1]));
  }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (!tpinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    pinchPreview(tpinch, tp(e.touches[0]), tp(e.touches[1]), false);
  }, { passive: false });
  scroll.addEventListener('touchend', (e) => {
    if (tpinch && e.touches.length < 2) { pinchCommit(tpinch); tpinch = null; }
  });
  // iOS Safari: stop the whole-page zoom gesture
  const noGesture = (e) => e.preventDefault();
  document.addEventListener('gesturestart', noGesture);

  function setZoom(z, a) {
    z = clamp(z, 1, 4);
    if (!a) {
      const r = scroll.getBoundingClientRect();
      a = { fx: scroll.scrollLeft + r.width / 2, fy: scroll.scrollTop + r.height / 2, sx: r.width / 2, sy: r.height / 2, k: z / st.zoom };
    }
    st.zoom = z;
    layout();
    scroll.scrollLeft = a.fx * a.k - a.sx;
    scroll.scrollTop = a.fy * a.k - a.sy;
  }
  $('zIn').onclick = () => setZoom(st.zoom * 1.25);
  $('zOut').onclick = () => setZoom(st.zoom / 1.25);

  // taps: double-tap zoom, text notes, edit notes
  let lastTap = null;
  pagesEl.addEventListener('click', (e) => {
    const note = e.target.closest('.tnote');
    const pg = e.target.closest('.pg');
    if (note && pg) { onNoteTap(+pg.dataset.n, note.dataset.id); return; }
    if (st.tool === 'text' && pg) {
      const r = pg.getBoundingClientRect();
      addNote(+pg.dataset.n, (e.clientX - r.left) / st.W, (e.clientY - r.top) / st.W);
      return;
    }
    if (!st.tool) {
      const now = Date.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        const r = scroll.getBoundingClientRect();
        const z = st.zoom > 1.2 ? 1 : 2;
        setZoom(z, { fx: scroll.scrollLeft + e.clientX - r.left, fy: scroll.scrollTop + e.clientY - r.top, sx: e.clientX - r.left, sy: e.clientY - r.top, k: z / st.zoom });
        lastTap = null;
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  });

  // ---------- text notes on the page ----------
  function noteSheet({ text = '', color = prefs.note, del = false } = {}) {
    return new Promise((resolve) => {
      let out = null;
      const s = sheet({
        title: del ? 'تعديل الملاحظة' : 'ملاحظة على الصفحة',
        html: `<form class="stack">
          <textarea class="textarea" name="t" placeholder="اكتب ملاحظتك هنا…" autofocus>${esc(text)}</textarea>
          <div class="swatches">${NOTE_COLORS.map((c) => `<button type="button" class="swatch ${c.id === color ? 'on' : ''}" data-c="${c.id}" aria-label="لون"><i style="background:${c.hex}"></i></button>`).join('')}</div>
          <div style="display:flex;gap:10px">${del ? `<button type="button" class="btn danger" data-del>${icon('trash', 18)}حذف</button>` : ''}<button class="btn primary" style="flex:1">حفظ</button></div>
        </form>`,
        onMount(el, api) {
          let c = color;
          el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { el.querySelectorAll('[data-c]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); c = b.dataset.c; });
          el.querySelector('form').onsubmit = (e) => { e.preventDefault(); out = { text: el.querySelector('textarea').value.trim(), c }; api.close(); };
          const d = el.querySelector('[data-del]'); if (d) d.onclick = () => { out = { del: true }; api.close(); };
        }
      });
      s.done.then(() => resolve(out));
    });
  }
  async function addNote(n, x, y) {
    const r = await noteSheet();
    if (!r || !r.text) return;
    prefs.note = r.c; savePrefs(prefs); updateDot();
    snapshot(n);
    pageData(n).t.push({ id: uid(), x: clamp(x, 0.2, 1), y: clamp(y, 0, 1.4), text: r.text, c: r.c });
    renderTexts(n); saveAnnos();
  }
  async function onNoteTap(n, id) {
    const data = pageData(n);
    const t = data.t.find((x) => x.id === id);
    if (!t) return;
    if (st.tool === 'eraser') {
      snapshot(n); data.t = data.t.filter((x) => x !== t); renderTexts(n); saveAnnos(); return;
    }
    const r = await noteSheet({ text: t.text, color: t.c, del: true });
    if (!r) return;
    snapshot(n);
    if (r.del || !r.text) data.t = data.t.filter((x) => x !== t);
    else { t.text = r.text; t.c = r.c; }
    renderTexts(n); saveAnnos();
  }

  // ---------- page tracking ----------
  let rafScroll = 0, indTimer = 0;
  const ind = $('rdInd');
  scroll.addEventListener('scroll', () => {
    if (rafScroll) return;
    rafScroll = requestAnimationFrame(() => {
      rafScroll = 0;
      const y = scroll.scrollTop + scroll.clientHeight * 0.35;
      let n = 1;
      for (let i = 0; i < st.tops.length; i++) { if (st.tops[i] <= y) n = i + 1; else break; }
      if (n !== st.cur) { st.cur = n; updatePageUI(); saveMeta(); }
      ind.classList.remove('fade');
      clearTimeout(indTimer);
      indTimer = setTimeout(() => ind.classList.add('fade'), 1100);
    });
  }, { passive: true });

  function updatePageUI() {
    $('rdSub').textContent = `صفحة ${ar(st.cur)} من ${ar(st.n)}`;
    ind.textContent = `${ar(st.cur)} / ${ar(st.n)}`;
    $('rdBm').classList.toggle('bm-on', st.meta.bookmarks.some((b) => b.page === st.cur));
    const nn = st.notes.texts.length + st.notes.questions.length;
    $('rdNotesN').textContent = ar(nn);
    $('rdNotesN').classList.toggle('hidden', !nn);
  }
  function goPage(n, smooth) {
    n = clamp(n, 1, st.n);
    scroll.scrollTo({ top: st.tops[n - 1] - 8, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ---------- bookmarks ----------
  $('rdBm').onclick = async () => {
    const i = st.meta.bookmarks.findIndex((b) => b.page === st.cur);
    if (i >= 0) {
      const [b] = st.meta.bookmarks.splice(i, 1);
      db.set('meta', file.id, st.meta); renderRibbon(b.page); updatePageUI();
      toast('اتشالت العلامة من صفحة ' + ar(b.page), { action: 'تراجع', onAction: () => { st.meta.bookmarks.push(b); db.set('meta', file.id, st.meta); renderRibbon(b.page); updatePageUI(); } });
    } else {
      const b = { page: st.cur, label: '', color: BM_COLORS[st.meta.bookmarks.length % BM_COLORS.length], at: Date.now() };
      st.meta.bookmarks.push(b);
      db.set('meta', file.id, st.meta); renderRibbon(b.page); updatePageUI(); haptic(12);
      toast('اتحطت علامة على صفحة ' + ar(b.page), { action: 'سمّيها', onAction: () => renameBookmark(b) });
    }
  };
  async function renameBookmark(b) {
    const r = await formSheet({ title: 'اسم العلامة', fields: [{ name: 'label', label: 'مثلاً: قانون مهم، تعريف، سؤال امتحان', value: b.label }] });
    if (r && !r.__delete) { b.label = r.label; db.set('meta', file.id, st.meta); }
  }
  function bookmarksSheet() {
    const list = [...st.meta.bookmarks].sort((a, b) => a.page - b.page);
    sheet({
      title: 'العلامات المرجعية',
      html: list.length ? `<div class="sheet-list">${list.map((b) => `
        <div class="sheet-item"><span class="ri" style="color:${b.color}">${icon('bookmark', 20)}</span>
          <button class="rt" data-go="${b.page}" style="text-align:right"><b>${esc(b.label || 'صفحة ' + ar(b.page))}</b><small>صفحة ${ar(b.page)}</small></button>
          <button class="iconbtn" data-ren="${b.page}" aria-label="تسمية">${icon('edit', 18)}</button></div>`).join('')}</div>`
        : `<div class="empty"><div class="ill">${icon('bookmark', 28)}</div><h3>مفيش علامات لسه</h3><span>دوس على أيقونة العلامة فوق عشان تعلّم الصفحة اللي انت فيها.</span></div>`,
      onMount(el, api) {
        el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { api.close(); goPage(+b.dataset.go, true); });
        el.querySelectorAll('[data-ren]').forEach((b) => b.onclick = () => { api.close(); renameBookmark(st.meta.bookmarks.find((x) => x.page === +b.dataset.ren)); });
      }
    });
  }

  // ---------- read aloud ----------
  const ttsBox = $('rdTts');
  let spk = null, ttsPage = 0, emptyRun = 0, audio = null;
  function ttsBar(caption = '', pct = 0, playing = true) {
    const rate = spk ? spk.rate : (audio ? audio.playbackRate : 1);
    ttsBox.innerHTML = `<div class="rd-tts" role="region" aria-label="القراءة الصوتية">
      <div class="tts-row">
        <button class="tts-play" id="ttsPlay" aria-label="${playing ? 'إيقاف مؤقت' : 'تشغيل'}">${icon(playing ? 'pause' : 'play', 18)}</button>
        <div class="tts-cap" id="ttsCap">${esc(caption)}</div>
        <button class="tts-btn" id="ttsRate">${ar(rate)}×</button>
        <button class="tts-btn" id="ttsClose" aria-label="إغلاق">${icon('x', 16)}</button>
      </div>
      <div class="tts-bar"><i id="ttsProg" style="width:${pct}%"></i></div></div>`;
    $('ttsPlay').onclick = togglePlay;
    $('ttsClose').onclick = stopTts;
    $('ttsRate').onclick = () => {
      const rates = [0.75, 1, 1.25, 1.5];
      const next = rates[(rates.indexOf(rate) + 1) % rates.length] || 1;
      if (spk) spk.setRate(next); if (audio) audio.playbackRate = next;
      $('ttsRate').textContent = ar(next) + '×';
    };
  }
  function togglePlay() {
    if (audio) { audio.paused ? audio.play() : audio.pause(); return; }
    if (!spk) return;
    if (spk.playing) spk.pause(); else spk.play();
    $('ttsPlay').innerHTML = icon(spk.playing ? 'pause' : 'play', 18);
  }
  function stopTts() {
    if (spk) spk.stop(); spk = null;
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    ttsBox.innerHTML = '';
  }
  async function speakPage(n) {
    if (!spk) return;
    ttsPage = n;
    let text = '';
    try { text = await pageText(await st.pages[n]); } catch (e) {}
    if (TTS.looksGarbled(text)) {
      stopTts();
      sheet({
        title: 'النص اللي جوه الملف ده بايظ',
        html: `<div class="stack"><p class="hint" style="font-size:14.5px;margin:0">الملف شكله سليم، بس الحروف المتخزنة جواه متلخبطة (مشكلة معروفة في ملفات Word القديمة)، فالقراءة الصوتية هتطلع كلام مش مفهوم.</p>
          <p class="hint" style="font-size:14.5px;margin:0">الحل عند المدرس: من لوحة المدرس ← «تصليح نص الملفات المرفوعة» — وبعدها هتتقري صح.</p>
          ${file.audio ? '<button class="btn primary block" data-a="audio">اسمع تسجيل المدرس بدل كده</button>' : ''}<button class="btn block" data-close>تمام</button></div>`,
        onMount(el, api) { const b = el.querySelector('[data-a]'); if (b) b.onclick = () => { api.close(); startAudio(); }; }
      });
      return;
    }
    const chunks = TTS.chunkText(text);
    if (!chunks.length) {
      emptyRun++;
      if (emptyRun >= 3 || n >= st.n) {
        stopTts();
        toast(emptyRun >= 3 ? 'الصفحات دي صور (سكانر) ومفيهاش نص يتقري — الحل إن المدرس يرفع تسجيل صوتي معاها' : 'خلصت القراءة');
        return;
      }
      return speakPage(n + 1);
    }
    emptyRun = 0;
    if (n !== st.cur) goPage(n, true);
    await spk.load(chunks, 0);
    spk.play();
  }
  async function startSpeech() {
    stopTts();
    if (!TTS.supported) { toast('المتصفح ده مش بيدعم القراءة الصوتية'); return; }
    const voices = await TTS.arabicVoices();
    if (!voices.length) {
      sheet({
        title: 'مفيش صوت عربي على الموبايل ده',
        html: `<div class="stack"><p class="hint" style="font-size:14.5px;margin:0">عشان القراءة تطلع عربي سليم لازم صوت عربي يكون متثبت:</p>
          <p style="margin:0;line-height:2">١. نزّل تطبيق <b>Speech Services by Google</b> من Play Store (أو حدّثه).<br>٢. إعدادات الموبايل ← اللغة والإدخال ← <b>تحويل النص إلى كلام</b> ← اختار Google.<br>٣. من ⚙ جنبه ← <b>تثبيت بيانات الصوت</b> ← العربية.<br>٤. ارجع للتطبيق ومن الإعدادات اختار الصوت العربي.</p>
          <button class="btn primary block" data-close>فهمت</button></div>`
      });
      return;
    }
    spk = new TTS.Speaker({
      onCaption: (t, i, len) => {
        const c = $('ttsCap'), p = $('ttsProg');
        if (c) c.textContent = t;
        if (p) p.style.width = Math.round(((i + 1) / len) * 100) + '%';
      },
      onDone: () => { if (ttsPage < st.n) speakPage(ttsPage + 1); else { stopTts(); toast('خلصت قراءة الملف'); } }
    });
    ttsBar('بيجهّز القراءة من صفحة ' + ar(st.cur) + '…', 0, true);
    emptyRun = 0;
    speakPage(st.cur);
  }
  function startAudio() {
    stopTts();
    audio = new Audio(file.audio);
    audio.preload = 'auto';
    ttsBar('تسجيل المدرس', 0, true);
    audio.addEventListener('timeupdate', () => {
      const p = $('ttsProg'), c = $('ttsCap');
      if (p && audio.duration) p.style.width = (audio.currentTime / audio.duration * 100) + '%';
      if (c && audio.duration) c.textContent = 'تسجيل المدرس · ' + fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
    });
    audio.addEventListener('play', () => { const b = $('ttsPlay'); if (b) b.innerHTML = icon('pause', 18); });
    audio.addEventListener('pause', () => { const b = $('ttsPlay'); if (b) b.innerHTML = icon('play', 18); });
    audio.addEventListener('error', () => { toast('مقدرناش نشغّل التسجيل — اتأكد من النت'); });
    audio.play().catch(() => {});
  }
  const fmtTime = (s) => { s = Math.floor(s || 0); return ar(Math.floor(s / 60)) + ':' + ar(s % 60).padStart(2, '٠'); };
  function openListen() {
    if (!file.audio) return startSpeech();
    sheet({
      title: 'استمع للملف',
      html: `<div class="sheet-list">
        <button class="sheet-item" data-a="audio"><span class="ri">${icon('music', 20)}</span><span class="rt"><b>تسجيل المدرس</b><small>صوت المدرس نفسه — أوضح نطق</small></span></button>
        <button class="sheet-item" data-a="tts"><span class="ri">${icon('volume', 20)}</span><span class="rt"><b>القراءة الآلية</b><small>يقرأ الصفحة اللي انت فيها بصوت الموبايل</small></span></button></div>`,
      onMount(el, api) { el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => { api.close(); b.dataset.a === 'audio' ? startAudio() : startSpeech(); }); }
    });
  }

  // ---------- more menu ----------
  $('rdMore').onclick = () => {
    const item = (a, ic, t, s) => `<button class="sheet-item" data-a="${a}"><span class="ri">${icon(ic, 20)}</span><span class="rt"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</span></button>`;
    sheet({
      title: file.title,
      html: `<div class="sheet-list">
        ${item('listen', 'volume', 'استمع للملف', file.audio ? 'تسجيل المدرس أو القراءة الآلية' : 'قراءة صوتية بالعربي من الصفحة الحالية')}
        ${item('bms', 'bookmark', 'العلامات المرجعية', ar(st.meta.bookmarks.length) + ' علامة')}
        ${item('goto', 'hash', 'روح لصفحة…', '')}
        ${item('night', prefs.night ? 'sun' : 'moon', prefs.night ? 'إلغاء الوضع الليلي للصفحات' : 'الوضع الليلي للصفحات', 'مريح للعين في الضلمة')}
        ${item('done', 'checkc', st.meta.done ? 'إلغاء «خلصته»' : 'علّم إنك خلصت الملف', '')}
        ${item('save', 'download', 'حفظ نسخة على الجهاز', 'الملف الأصلي زي ما هو')}
        ${item('export', 'share', 'تصدير بملاحظاتي', 'PDF فيه كل التعليقات اللي كتبتها')}
        ${item('clear', 'trash', 'مسح تعليقات الصفحة دي', '')}
      </div>`,
      onMount(el, api) {
        el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => { api.close(); setTimeout(() => moreAction(b.dataset.a), 60); });
      }
    });
  };
  async function moreAction(a) {
    if (a === 'listen') openListen();
    else if (a === 'bms') bookmarksSheet();
    else if (a === 'goto') {
      const r = await formSheet({ title: 'روح لصفحة', fields: [{ name: 'p', label: `من ${ar(1)} لـ ${ar(st.n)}`, type: 'number', value: '' }], ok: 'روح' });
      const p = r && parseInt(String(r.p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)), 10);
      if (p) goPage(p, true);
    } else if (a === 'night') {
      prefs.night = !prefs.night; savePrefs(prefs); rd.classList.toggle('night', prefs.night);
    } else if (a === 'done') {
      st.meta.done = !st.meta.done; db.set('meta', file.id, st.meta);
      toast(st.meta.done ? 'برافو! اتعلّم الملف إنه خلص' : 'اتلغى');
    } else if (a === 'save') {
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), file.title + '.pdf');
    } else if (a === 'export') {
      const has = Object.values(st.annos.pages).some((p) => p.s.length || p.t.length);
      if (!has) { toast('لسه مفيش تعليقات على الملف'); return; }
      const close = toast('بيجهّز الملف بملاحظاتك…', { ms: 20000 });
      try {
        const { exportAnnotated } = await import('./export.js');
        const blob = await exportAnnotated(bytes, st.annos, st.sizes);
        close();
        await shareOrDownload(blob, file.title + ' - بملاحظاتي.pdf');
      } catch (e) { close(); console.error(e); toast('حصلت مشكلة في التصدير'); }
    } else if (a === 'clear') {
      const d = pageData(st.cur);
      if (!d.s.length && !d.t.length) { toast('الصفحة دي مفيهاش تعليقات'); return; }
      if (await confirmDlg('مسح تعليقات الصفحة؟', 'هيتمسح كل اللي كتبته على صفحة ' + ar(st.cur) + '. تقدر ترجعه بزرار التراجع.', 'امسح', true)) {
        snapshot(st.cur); st.annos.pages[st.cur] = { s: [], t: [] }; drawInk(st.cur); renderTexts(st.cur); saveAnnos();
      }
    }
  }

  // ---------- start ----------
  layout();
  st.els.forEach((el) => io.observe(el));
  const first = clamp(startPage || st.meta.lastPage || 1, 1, st.n);
  st.cur = first;
  goPage(first);
  updatePageUI();
  updateUndo();
  setTimeout(() => ind.classList.remove('fade'), 50);
  setTimeout(() => ind.classList.add('fade'), 1600);

  const onResize = debounce(() => {
    const n = st.cur;
    const off = scroll.scrollTop - st.tops[n - 1];
    const oldW = st.W;
    layout();
    scroll.scrollTop = st.tops[n - 1] + off * (st.W / oldW);
  }, 150);
  window.addEventListener('resize', onResize);

  return function cleanup() {
    st.dead = true;
    document.body.classList.remove('in-reader');
    stopTts();
    saveAnnos.flush(); saveMeta.flush();
    io.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('gesturestart', noGesture);
    try { st.doc && st.doc.destroy(); } catch (e) {}
  };
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function shareOrDownload(blob, name) {
  try {
    const f = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  downloadBlob(blob, name);
}
