// Per-file notebook: typed notes, handwriting, and important questions (flashcards).
import { icon, esc, ar, ago, toast, formSheet, confirmDlg, uid, go, haptic, debounce } from './ui.js';
import { db, getNotes, getMeta } from './db.js';
import { drawAll, hitStroke, simplify, BASE } from './ink.js';

const HAND_COLORS = ['#1D4ED8', '#D2421A', '#18202B', '#0E8A5F'];
const toNum = (s) => parseInt(String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)), 10) || null;

export async function mountNotes(view, file, { goBack }) {
  const notes = await getNotes(file.id);
  const meta = await getMeta(file.id);
  const save = () => db.set('notes', file.id, notes);
  let tab = sessionStorage.getItem('notes-tab') || (notes.questions.length ? 'q' : 'text');
  let qi = 0, flipped = false, order = notes.questions.map((_, i) => i);
  let cleanupHand = null;

  view.innerHTML = `<div class="page stack" style="padding-bottom:140px">
    <div class="titlebar">
      <button class="iconbtn" id="nBack" aria-label="رجوع">${icon('back')}</button>
      <div style="flex:1;min-width:0"><h1 style="font-size:20px">ملاحظات الملف</h1><div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(file.title)}</div></div>
      <button class="iconbtn boxed" id="nOpen" aria-label="افتح الملف">${icon('file', 20)}</button>
    </div>
    <div class="seg" role="tablist">
      <button role="tab" data-tab="text">مكتوبة</button>
      <button role="tab" data-tab="hand">بخط اليد</button>
      <button role="tab" data-tab="q">أسئلة مهمة</button>
    </div>
    <div id="nBody"></div>
  </div>
  <button class="fab" id="nFab">${icon('plus', 20, 2.4)}<span id="nFabT"></span></button>`;

  const body = view.querySelector('#nBody');
  const fab = view.querySelector('#nFab');
  view.querySelector('#nBack').onclick = () => goBack('/read/' + file.id);
  view.querySelector('#nOpen').onclick = () => go('/read/' + file.id);
  view.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; sessionStorage.setItem('notes-tab', tab); render(); });

  function render() {
    if (cleanupHand) { cleanupHand(); cleanupHand = null; }
    view.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    fab.classList.toggle('hidden', tab === 'hand');
    view.querySelector('#nFabT').textContent = tab === 'q' ? 'سؤال جديد' : 'ملاحظة جديدة';
    if (tab === 'text') renderText();
    else if (tab === 'q') renderQ();
    else cleanupHand = renderHand();
  }
  fab.onclick = () => (tab === 'q' ? editQ() : editText());

  // ---------- typed notes ----------
  function renderText() {
    const list = [...notes.texts].sort((a, b) => b.at - a.at);
    body.innerHTML = list.length ? `<div class="stack" style="gap:10px">${list.map((n) => `
      <div class="ncard">
        <div class="nh"><span>${esc(ago(n.at))}</span>
          <span style="display:flex;gap:6px;align-items:center">${n.page ? `<button class="ptag" data-go="${n.page}">صفحة ${ar(n.page)}</button>` : ''}
          <button class="iconbtn" style="width:34px;height:34px" data-edit="${n.id}" aria-label="تعديل">${icon('edit', 16)}</button></span></div>
        <div class="nt">${esc(n.text)}</div>
      </div>`).join('')}</div>`
      : empty('note', 'لسه مفيش ملاحظات', 'اكتب أي حاجة عايز تفتكرها من الملف ده — تعريف، قانون، أو حاجة المدرس قالها.');
    body.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(`/read/${file.id}?p=${b.dataset.go}`));
    body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editText(notes.texts.find((x) => x.id === b.dataset.edit)));
  }
  async function editText(n) {
    const r = await formSheet({
      title: n ? 'تعديل الملاحظة' : 'ملاحظة جديدة',
      fields: [
        { name: 'text', label: 'الملاحظة', type: 'textarea', value: n ? n.text : '', placeholder: 'اكتب هنا…' },
        { name: 'page', label: 'رقم الصفحة (اختياري)', type: 'number', value: n ? (n.page || '') : (meta.lastPage || '') }
      ],
      danger: n ? 'حذف' : null
    });
    if (!r) return;
    if (r.__delete) { notes.texts = notes.texts.filter((x) => x !== n); save(); render(); toast('اتمسحت الملاحظة'); return; }
    if (!r.text) return;
    if (n) { n.text = r.text; n.page = toNum(r.page); }
    else notes.texts.push({ id: uid(), text: r.text, page: toNum(r.page), at: Date.now() });
    save(); render();
  }

  // ---------- questions / flashcards ----------
  function renderQ() {
    const qs = notes.questions;
    if (!qs.length) { body.innerHTML = empty('help', 'مفيش أسئلة لسه', 'ضيف الأسئلة المهمة وإجاباتها، وراجعها بعدين كبطاقات بتتقلب.'); return; }
    if (order.length !== qs.length) order = qs.map((_, i) => i);
    qi = Math.min(qi, qs.length - 1);
    const q = qs[order[qi]];
    const known = qs.filter((x) => x.known).length;
    body.innerHTML = `<div class="stack" style="gap:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="progress" style="background:var(--surface-2);height:8px"><i style="width:${(known / qs.length) * 100}%;background:var(--accent)"></i></div>
        <span style="font-size:12.5px;color:var(--muted);white-space:nowrap">حفظت ${ar(known)} من ${ar(qs.length)}</span>
      </div>
      <div class="flash ${flipped ? 'flipped' : ''}" id="flash" role="button" tabindex="0" aria-label="اقلب البطاقة">
        <div class="flash-in">
          <div class="flash-face"><div class="flash-meta"><span>سؤال ${ar(qi + 1)} من ${ar(qs.length)}</span>${q.page ? `<span>صفحة ${ar(q.page)}</span>` : ''}</div>
            <div class="flash-q">${esc(q.q)}</div><div class="flash-hint">اضغط لإظهار الإجابة</div></div>
          <div class="flash-face flash-back"><div class="flash-meta"><span>الإجابة</span>${q.known ? '<span>✓ حفظته</span>' : ''}</div>
            <div class="flash-a">${esc(q.a || '— مفيش إجابة مكتوبة —')}</div><div class="flash-hint">اضغط للرجوع للسؤال</div></div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="qPrev" aria-label="السابق" style="width:50px;padding:0">${icon('back', 20)}</button>
        <button class="btn" id="qAgain" style="flex:1">محتاج أراجعه</button>
        <button class="btn soft" id="qKnow" style="flex:1">${icon('check', 18)}حفظته</button>
        <button class="btn" id="qNext" aria-label="التالي" style="width:50px;padding:0">${icon('fwd', 20)}</button>
      </div>
      <div class="sec"><h2>كل الأسئلة</h2><button class="ptag" id="qShuffle" style="display:flex;align-items:center;gap:4px">${icon('shuffle', 14)}لخبطهم</button></div>
      ${qs.map((x, i) => `<div class="qitem">
        <span class="qn ${x.known ? 'known' : ''}">${x.known ? icon('check', 15, 3) : ar(i + 1)}</span>
        <button class="qt" style="text-align:right" data-show="${i}">${esc(x.q)}</button>
        ${x.page ? `<button class="ptag" data-go="${x.page}">ص ${ar(x.page)}</button>` : ''}
        <button class="iconbtn" style="width:34px;height:34px" data-edit="${x.id}" aria-label="تعديل">${icon('edit', 16)}</button>
      </div>`).join('')}
    </div>`;
    const flash = body.querySelector('#flash');
    const flip = () => { flipped = !flipped; flash.classList.toggle('flipped', flipped); haptic(5); };
    flash.onclick = flip;
    flash.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
    const step = (d) => { qi = (qi + d + qs.length) % qs.length; flipped = false; renderQ(); };
    body.querySelector('#qPrev').onclick = () => step(-1);
    body.querySelector('#qNext').onclick = () => step(1);
    body.querySelector('#qKnow').onclick = () => { q.known = true; save(); haptic(12); step(1); };
    body.querySelector('#qAgain').onclick = () => { q.known = false; save(); step(1); };
    body.querySelector('#qShuffle').onclick = () => { order.sort(() => Math.random() - 0.5); qi = 0; flipped = false; renderQ(); toast('اتلخبطت الأسئلة'); };
    body.querySelectorAll('[data-show]').forEach((b) => b.onclick = () => { qi = order.indexOf(+b.dataset.show); flipped = false; renderQ(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    body.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(`/read/${file.id}?p=${b.dataset.go}`));
    body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editQ(qs.find((x) => x.id === b.dataset.edit)));
  }
  async function editQ(q) {
    const r = await formSheet({
      title: q ? 'تعديل السؤال' : 'سؤال مهم جديد',
      fields: [
        { name: 'q', label: 'السؤال', type: 'textarea', value: q ? q.q : '', placeholder: 'مثلاً: علل…، اذكر…، ما المقصود بـ…' },
        { name: 'a', label: 'الإجابة', type: 'textarea', value: q ? q.a : '', placeholder: 'اكتب الإجابة النموذجية' },
        { name: 'page', label: 'رقم الصفحة (اختياري)', type: 'number', value: q ? (q.page || '') : (meta.lastPage || '') }
      ],
      danger: q ? 'حذف' : null
    });
    if (!r) return;
    if (r.__delete) { notes.questions = notes.questions.filter((x) => x !== q); order = notes.questions.map((_, i) => i); qi = 0; save(); render(); return; }
    if (!r.q) return;
    if (q) { q.q = r.q; q.a = r.a; q.page = toNum(r.page); }
    else { notes.questions.push({ id: uid(), q: r.q, a: r.a, page: toNum(r.page), known: false, at: Date.now() }); order = notes.questions.map((_, i) => i); qi = notes.questions.length - 1; flipped = false; }
    save(); render();
  }

  // ---------- handwriting ----------
  function renderHand() {
    const hand = notes.hand || (notes.hand = { strokes: [] });
    let color = HAND_COLORS[0], erase = false;
    const undo = [];
    body.innerHTML = `<div class="stack" style="gap:10px">
      <div class="paper-tools">
        ${HAND_COLORS.map((c, i) => `<button class="swatch ${i === 0 ? 'on' : ''}" data-c="${c}" aria-label="لون"><i style="background:${c}"></i></button>`).join('')}
        <span style="flex:1"></span>
        <button class="tool" id="hEr" aria-label="ممحاة">${icon('eraser')}</button>
        <button class="tool" id="hUndo" aria-label="تراجع">${icon('undo')}</button>
        <button class="tool" id="hClear" aria-label="مسح الكل">${icon('trash')}</button>
      </div>
      <div class="paper" id="paper"><canvas></canvas></div>
      <div class="hint" style="text-align:center">اكتب بصباعك أو بالقلم — بيتحفظ تلقائي</div>
    </div>`;
    const paper = body.querySelector('#paper');
    const cv = paper.querySelector('canvas');
    const ctx = cv.getContext('2d');
    let W = 0, q = 1, live = null;
    const saveSoon = debounce(save, 400);
    function size() {
      const r = paper.getBoundingClientRect();
      W = r.width; q = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * q); cv.height = Math.round(r.height * q);
      draw();
    }
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(q, 0, 0, q, 0, 0);
      drawAll(ctx, hand.strokes, W, live);
    }
    body.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
      body.querySelectorAll('[data-c]').forEach((x) => x.classList.remove('on')); b.classList.add('on');
      color = b.dataset.c; erase = false; body.querySelector('#hEr').classList.remove('on');
    });
    body.querySelector('#hEr').onclick = (e) => { erase = !erase; e.currentTarget.classList.toggle('on', erase); };
    body.querySelector('#hUndo').onclick = () => { const s = undo.pop(); if (s) { hand.strokes = JSON.parse(s); draw(); saveSoon(); } };
    body.querySelector('#hClear').onclick = async () => {
      if (!hand.strokes.length) return;
      if (await confirmDlg('مسح الصفحة؟', 'هيتمسح كل اللي كتبته بخط إيدك هنا.', 'امسح', true)) {
        undo.push(JSON.stringify(hand.strokes)); hand.strokes = []; draw(); save();
      }
    };
    let rect = null, pid = null, erasedSnap = false;
    const pt = (e) => [(e.clientX - rect.left) / W, (e.clientY - rect.top) / W, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5];
    const eraseAt = (p) => {
      const hit = hand.strokes.filter((s) => hitStroke(s, p[0], p[1], 14 / BASE));
      if (!hit.length) return;
      if (!erasedSnap) { undo.push(JSON.stringify(hand.strokes)); erasedSnap = true; }
      hand.strokes = hand.strokes.filter((s) => !hit.includes(s)); draw(); saveSoon();
    };
    cv.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId; cv.setPointerCapture(pid); rect = cv.getBoundingClientRect();
      if (erase) { erasedSnap = false; eraseAt(pt(e)); return; }
      live = { t: 'pen', c: color, w: 3 / BASE, p: [pt(e)] };
      if (e.pointerType === 'pen') live.pr = 1;
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      for (const ev of evs.length ? evs : [e]) { if (erase) eraseAt(pt(ev)); else if (live) live.p.push(pt(ev)); }
      if (live) requestAnimationFrame(draw);
    });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (live) {
        undo.push(JSON.stringify(hand.strokes));
        if (live.p.length === 1) live.p.push([live.p[0][0] + 0.0005, live.p[0][1] + 0.0005, 0.5]);
        live.p = simplify(live.p); hand.strokes.push(live); live = null; draw(); saveSoon();
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    const ro = new ResizeObserver(size);
    ro.observe(paper);
    return () => { ro.disconnect(); saveSoon.flush(); };
  }

  function empty(ic, t, s) {
    return `<div class="empty"><div class="ill">${icon(ic, 28)}</div><h3>${t}</h3><span>${s}</span></div>`;
  }

  render();
  return () => { if (cleanupHand) cleanupHand(); };
}
