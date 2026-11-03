// Teacher panel: password-protected, uploads PDFs straight to the GitHub repo in one commit.
// The GitHub token never lives in the code: it is stored on the teacher's device only,
// encrypted (AES-GCM) with a key derived from the admin password (PBKDF2, 250k rounds).
import { icon, esc, ar, mb, ago, toast, confirmDlg, formSheet, sheet } from './ui.js';
import { loadCatalog } from './catalog.js';

const CFG_KEY = 'admin-cfg';
const DEFAULT_REPO = 'starrnightt2030-oss/mashroey-2027';
let session = null; // { token, repo, branch } — memory only

// ---------- crypto ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(token, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pass, salt), enc.encode(token)));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function unseal(cfg, pass) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(cfg.iv) }, await keyFrom(pass, unb64(cfg.salt)), unb64(cfg.ct));
  return dec.decode(pt);
}
const getCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; } };

// ---------- GitHub API ----------
async function gh(path, opts = {}, s = session) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + s.token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).message; } catch (e) {}
    const err = new Error(msg || 'HTTP ' + r.status);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}
function ghError(e) {
  if (e.status === 401) return 'المفتاح (Token) غلط أو انتهت صلاحيته';
  if (e.status === 403) return 'المفتاح مالوش صلاحية كتابة على المستودع (Contents: Read and write)';
  if (e.status === 404) return 'المستودع أو الفرع مش موجود، أو المفتاح مش متاح له';
  if (e.status === 409 || e.status === 422) return 'حصل تعارض — جرّب المزامنة تاني';
  if (!navigator.onLine) return 'مفيش اتصال بالنت';
  return e.message || 'خطأ غير معروف';
}
async function readIndex(ref) {
  const { repo, branch } = session;
  try {
    const j = await gh(`/repos/${repo}/contents/files/index.json?ref=${encodeURIComponent(ref || branch)}`);
    const txt = dec.decode(unb64(j.content.replace(/\s/g, '')));
    const idx = JSON.parse(txt);
    if (!Array.isArray(idx.files)) idx.files = [];
    return idx;
  } catch (e) {
    if (e.status === 404) return { files: [] };
    throw e;
  }
}
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}
async function uploadBlob(blob) {
  const content = await blobToB64(blob);
  const r = await gh(`/repos/${session.repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
  return r.sha;
}
const newId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- view ----------
export async function mountAdmin(view, { goBack }) {
  let dead = false;
  const state = { index: null, pending: [], edits: {}, deletes: new Set(), audios: {}, busy: false, prog: null };

  function shell(inner) {
    view.innerHTML = `<div class="page stack" style="padding-bottom:60px">
      <div class="titlebar">
        <button class="iconbtn" id="aBack" aria-label="رجوع">${icon('back')}</button>
        <h1>لوحة المدرس</h1>
        ${session ? `<span class="pill" style="background:var(--accent-soft);color:var(--accent-soft-ink);display:flex;align-items:center;gap:6px;font-weight:600">${icon('lock', 14, 2.2)}مسجّل كأدمن</span>` : ''}
      </div>
      ${inner}
    </div>`;
    view.querySelector('#aBack').onclick = () => goBack('/settings');
  }

  // ----- first-time setup -----
  function renderSetup() {
    shell(`
      <div class="lock-ill">${icon('key', 34)}</div>
      <div style="text-align:center"><h2 style="font-size:19px">تجهيز لوحة المدرس</h2><div class="hint">مرة واحدة بس على موبايلك أو جهازك</div></div>
      <div class="card stack" style="gap:10px">
        <b>إزاي تعمل مفتاح GitHub (Token)</b>
        <div class="hint">
          ١. افتح <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">صفحة إنشاء مفتاح جديد</a> وانت داخل على حسابك.<br>
          ٢. Token name: <b dir="ltr">mashroey-admin</b> — Expiration: سنة.<br>
          ٣. Repository access ← <b>Only select repositories</b> ← اختار <b dir="ltr">mashroey-2027</b>.<br>
          ٤. Permissions ← Repository ← <b>Contents</b> ← <b>Read and write</b>.<br>
          ٥. Generate token وانسخه والصقه تحت.
        </div>
      </div>
      <form class="stack" id="setupForm" autocomplete="off">
        <div class="field"><label for="sRepo">المستودع</label><input class="input ltr" id="sRepo" value="${DEFAULT_REPO}" required></div>
        <div class="field"><label for="sBranch">الفرع</label><input class="input ltr" id="sBranch" value="main" required></div>
        <div class="field"><label for="sTok">مفتاح GitHub</label><input class="input ltr" id="sTok" type="password" placeholder="github_pat_…" required></div>
        <div class="field"><label for="sP1">كلمة سر لوحة المدرس</label><input class="input" id="sP1" type="password" minlength="6" required placeholder="٦ حروف أو أرقام على الأقل"></div>
        <div class="field"><label for="sP2">تأكيد كلمة السر</label><input class="input" id="sP2" type="password" required></div>
        <div class="hint">المفتاح بيتحفظ على الجهاز ده بس ومتشفّر بكلمة السر — مش موجود في كود التطبيق، فمحدش من الطلاب يقدر يرفع أو يمسح حاجة.</div>
        <button class="btn primary block" id="setupBtn">${icon('check', 18)} حفظ والدخول</button>
      </form>`);
    view.querySelector('#setupForm').onsubmit = async (e) => {
      e.preventDefault();
      const repo = view.querySelector('#sRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      const branch = view.querySelector('#sBranch').value.trim();
      const token = view.querySelector('#sTok').value.trim();
      const p1 = view.querySelector('#sP1').value, p2 = view.querySelector('#sP2').value;
      if (p1.length < 6) return toast('كلمة السر لازم ٦ حروف على الأقل');
      if (p1 !== p2) return toast('كلمتين السر مش زي بعض');
      const btn = view.querySelector('#setupBtn'); btn.disabled = true; btn.textContent = 'بيتأكد من المفتاح…';
      try {
        const s = { token, repo, branch };
        await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {}, s);
        const sealed = await seal(token, p1);
        localStorage.setItem(CFG_KEY, JSON.stringify({ repo, branch, ...sealed, at: Date.now() }));
        session = s;
        toast('تمام! لوحة المدرس جاهزة');
        renderDash();
      } catch (err) {
        toast(ghError(err), { ms: 5000 });
        btn.disabled = false; btn.innerHTML = icon('check', 18) + ' حفظ والدخول';
      }
    };
  }

  // ----- login -----
  function renderLogin() {
    const cfg = getCfg();
    shell(`
      <div class="lock-ill">${icon('lock', 34)}</div>
      <div style="text-align:center"><h2 style="font-size:19px">الدخول للوحة المدرس</h2><div class="hint" dir="ltr">${esc(cfg.repo)}</div></div>
      <form class="stack" id="loginForm">
        <div class="field"><label for="lp">كلمة السر</label><input class="input" id="lp" type="password" autocomplete="current-password" required autofocus></div>
        <button class="btn primary block">دخول</button>
        <button type="button" class="btn block" id="reset" style="background:transparent;border:0;color:var(--muted);font-weight:500">نسيت كلمة السر؟ إعادة الضبط</button>
      </form>`);
    setTimeout(() => view.querySelector('#lp')?.focus(), 200);
    view.querySelector('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const token = await unseal(cfg, view.querySelector('#lp').value);
        session = { token, repo: cfg.repo, branch: cfg.branch };
        renderDash();
      } catch (err) {
        toast('كلمة السر غلط');
        const i = view.querySelector('#lp'); i.value = ''; i.focus();
      }
    };
    view.querySelector('#reset').onclick = async () => {
      if (await confirmDlg('إعادة ضبط لوحة المدرس؟', 'هتحتاج تدخل مفتاح GitHub تاني وتعمل كلمة سر جديدة. الملفات المرفوعة مش هتتأثر.', 'إعادة الضبط', true)) {
        localStorage.removeItem(CFG_KEY); renderSetup();
      }
    };
  }

  // ----- dashboard -----
  async function renderDash() {
    shell(`
      <div class="gh-card">
        <div class="gi">${icon('git', 22)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px"><span class="live"></span>متصل بـ GitHub</div>
          <small dir="ltr" style="text-align:right">${esc(session.repo)} · ${esc(session.branch)}</small>
          <small id="aLast">بيجيب البيانات…</small>
        </div>
        <button class="iconbtn" id="aReload" style="color:#fff" aria-label="تحديث">${icon('sync', 20)}</button>
      </div>
      <label class="drop" id="aDrop">
        <span class="di">${icon('upload', 26)}</span>
        <b>اختار ملفات PDF</b>
        <span class="hint">الملف بيترفع زي ما هو بالظبط — من غير أي تحويل، فالعربي بيفضل سليم</span>
        <input type="file" id="aFiles" accept="application/pdf,.pdf" multiple class="sr">
      </label>
      <div id="aPending"></div>
      <div id="aPublished"></div>
      <div class="group">
        <button class="row" id="aLogout"><span class="ri">${icon('logout', 19)}</span><span class="rt"><b>تسجيل خروج</b><small>هتحتاج كلمة السر المرة الجاية</small></span></button>
        <button class="row" id="aForget"><span class="ri">${icon('trash', 19)}</span><span class="rt"><b>مسح بيانات الأدمن من الجهاز ده</b><small>المفتاح المتشفّر هيتمسح</small></span></button>
      </div>`);
    const drop = view.querySelector('#aDrop'), inp = view.querySelector('#aFiles');
    inp.onchange = () => { addFiles([...inp.files]); inp.value = ''; };
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
    view.querySelector('#aReload').onclick = refresh;
    view.querySelector('#aLogout').onclick = () => { session = null; toast('اتسجل الخروج'); goBack('/settings'); };
    view.querySelector('#aForget').onclick = async () => {
      if (await confirmDlg('مسح بيانات الأدمن؟', 'هتحتاج تعمل الإعداد من الأول على الجهاز ده.', 'امسح', true)) {
        localStorage.removeItem(CFG_KEY); session = null; renderSetup();
      }
    };
    drawPending();
    await refresh();
  }

  async function refresh() {
    const last = view.querySelector('#aLast');
    try {
      state.index = await readIndex();
      if (dead) return;
      last.textContent = state.index.updated ? 'آخر مزامنة: ' + ago(state.index.updated) : 'لسه مفيش ملفات مرفوعة';
      drawPublished();
    } catch (e) {
      if (last) last.textContent = ghError(e);
      if (e.status === 401) { toast('المفتاح انتهى أو اتلغى — اعمل إعادة ضبط وحط مفتاح جديد', { ms: 6000 }); }
    }
  }

  const units = () => [...new Set([...(state.index ? state.index.files : []), ...state.pending].map((f) => f.unit).filter(Boolean))];

  async function addFiles(list) {
    const { openPdf } = await import('./pdf.js');
    for (const file of list) {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      if (!isPdf) { toast(`«${file.name}» مش ملف PDF`); continue; }
      if (file.size > 90 * 1048576) { toast(`«${file.name}» حجمه كبير أوي (الحد ٩٠ م.ب)`); continue; }
      const item = {
        key: Math.random().toString(36).slice(2), file, size: file.size,
        title: file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim(),
        unit: localStorage.getItem('admin-last-unit') || '', pages: 0, thumb: null, audio: null, status: 'checking'
      };
      state.pending.push(item); drawPending();
      try {
        const buf = await file.arrayBuffer();
        const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 1024)));
        if (!head.includes('%PDF')) throw new Error('not pdf');
        const doc = await openPdf(buf);
        item.pages = doc.numPages;
        const page = await doc.getPage(1);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 300 / vp0.width });
        const cv = document.createElement('canvas');
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }).promise;
        item.thumb = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.78));
        item.thumbUrl = URL.createObjectURL(item.thumb);
        doc.destroy();
        item.status = 'ready';
      } catch (e) {
        console.warn(e);
        item.status = 'error'; item.err = 'الملف تالف أو محمي بكلمة سر';
      }
      drawPending();
    }
  }

  function changesCount() {
    return state.pending.filter((p) => p.status === 'ready').length + Object.keys(state.edits).length + state.deletes.size + Object.keys(state.audios).length;
  }

  function drawPending() {
    const box = view.querySelector('#aPending');
    if (!box) return;
    const n = changesCount();
    const total = state.pending.reduce((s, p) => s + (p.status === 'ready' ? p.size + (p.audio ? p.audio.size : 0) : 0), 0);
    box.innerHTML = state.pending.length || n ? `
      <div class="sec" style="margin-bottom:10px"><h2>جاهزة للمزامنة</h2><span>${ar(n)} تغيير${total ? ' · ' + mb(total) : ''}</span></div>
      <div class="stack" style="gap:8px">${state.pending.map((p) => `
        <div class="pend" data-k="${p.key}">
          <div class="pend-h">
            ${p.thumbUrl ? `<img src="${p.thumbUrl}" alt="" style="width:34px;height:44px;object-fit:cover;object-position:top;border-radius:6px;border:1px solid var(--line)">` : '<span class="tagpdf">PDF</span>'}
            <span style="flex:1;font-size:13px;color:var(--muted);direction:ltr;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.file.name)}</span>
            <span class="st ${p.status === 'error' ? 'err' : ''}">${p.status === 'checking' ? 'بيتفحص…' : p.status === 'error' ? esc(p.err) : p.status === 'up' ? 'بيترفع…' : `${ar(p.pages)} صفحة · ${mb(p.size)}`}</span>
            <button class="iconbtn" data-rm style="width:34px;height:34px" aria-label="شيل">${icon('x', 16)}</button>
          </div>
          ${p.status !== 'error' ? `
          <div class="field"><input class="input" data-f="title" value="${esc(p.title)}" placeholder="اسم الملف اللي هيظهر للطلاب" aria-label="اسم الملف"></div>
          <div class="pend-grid">
            <input class="input" data-f="unit" value="${esc(p.unit)}" placeholder="المادة / الوحدة" list="unitList" aria-label="المادة أو الوحدة">
            <label class="btn sm ${p.audio ? 'soft' : ''}" style="cursor:pointer;height:auto;min-height:42px">${icon('music', 16)}<span>${p.audio ? 'فيه تسجيل ✓' : 'تسجيل صوتي'}</span><input type="file" accept="audio/*" class="sr" data-audio></label>
          </div>` : ''}
        </div>`).join('')}
        ${Object.keys(state.edits).length || state.deletes.size || Object.keys(state.audios).length ? `<div class="hint">+ ${ar(Object.keys(state.edits).length)} تعديل · ${ar(state.deletes.size)} حذف · ${ar(Object.keys(state.audios).length)} تسجيل صوتي لملفات موجودة</div>` : ''}
      </div>
      <datalist id="unitList">${units().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
      <div class="sync-bar">
        <div class="sync-prog ${state.prog ? '' : 'hidden'}" id="aProg"><div class="progress"><i style="width:${state.prog ? state.prog.pct : 0}%"></i></div><span>${state.prog ? esc(state.prog.label) : ''}</span></div>
        <button class="btn primary block" id="aSync" style="height:58px;font-family:var(--display);font-size:16px" ${!n || state.busy || state.pending.some((p) => p.status === 'checking') ? 'disabled' : ''}>${icon('sync', 20, 2.2)} ${state.busy ? 'جارٍ المزامنة…' : `مزامنة مع GitHub (${ar(n)})`}</button>
      </div>` : '';
    box.querySelectorAll('.pend').forEach((el) => {
      const p = state.pending.find((x) => x.key === el.dataset.k);
      if (!p) return;
      el.querySelector('[data-rm]').onclick = () => { if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl); state.pending = state.pending.filter((x) => x !== p); drawPending(); };
      el.querySelectorAll('[data-f]').forEach((i) => i.oninput = () => { p[i.dataset.f] = i.value; if (i.dataset.f === 'unit') localStorage.setItem('admin-last-unit', i.value); });
      const au = el.querySelector('[data-audio]');
      if (au) au.onchange = () => { p.audio = au.files[0] || null; drawPending(); };
    });
    const sb = box.querySelector('#aSync');
    if (sb) sb.onclick = sync;
  }

  function drawPublished() {
    const box = view.querySelector('#aPublished');
    if (!box || !state.index) return;
    const files = state.index.files;
    box.innerHTML = `<div class="sec" style="margin-bottom:10px"><h2>الملفات المنشورة</h2><span>${ar(files.length)} ملف</span></div>
      ${files.length ? `<div class="group">${files.map((f) => {
        const ed = state.edits[f.id] || {};
        const del = state.deletes.has(f.id);
        return `<div class="row" style="${del ? 'opacity:.5' : ''}">
          ${f.thumb ? `<img src="${esc(f.thumb)}" alt="" style="width:34px;height:44px;object-fit:cover;object-position:top;border-radius:6px;border:1px solid var(--line);background:#fff" onerror="this.style.visibility='hidden'">` : `<span class="ri">${icon('file', 18)}</span>`}
          <span class="rt"><b style="${del ? 'text-decoration:line-through' : ''}">${esc(ed.title ?? f.title)}</b>
            <small>${esc(ed.unit ?? f.unit ?? '')}${(ed.unit ?? f.unit) ? ' · ' : ''}${ar(f.pages || 0)} صفحة · ${mb(f.size)}${f.audio || state.audios[f.id] ? ' · فيه تسجيل' : ''}${del ? ' · <span class="st del">هيتمسح</span>' : ''}</small></span>
          <button class="iconbtn" data-edit="${f.id}" aria-label="تعديل">${icon('edit', 18)}</button>
        </div>`;
      }).join('')}</div>` : `<div class="empty"><div class="ill">${icon('file', 28)}</div><h3>لسه مفيش ملفات</h3><span>اختار ملفات PDF من فوق وبعدين دوس مزامنة.</span></div>`}`;
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editPublished(files.find((f) => f.id === b.dataset.edit)));
  }

  function editPublished(f) {
    const ed = state.edits[f.id] || {};
    const del = state.deletes.has(f.id);
    sheet({
      title: 'تعديل الملف',
      html: `<form class="stack">
        <div class="field"><label for="eT">الاسم</label><input class="input" id="eT" value="${esc(ed.title ?? f.title)}"></div>
        <div class="field"><label for="eU">المادة / الوحدة</label><input class="input" id="eU" value="${esc(ed.unit ?? f.unit ?? '')}" list="unitList2"><datalist id="unitList2">${units().map((u) => `<option value="${esc(u)}">`).join('')}</datalist></div>
        <label class="btn soft" style="cursor:pointer">${icon('music', 18)} ${f.audio || state.audios[f.id] ? 'تغيير التسجيل الصوتي' : 'إضافة تسجيل صوتي'}<input type="file" accept="audio/*" class="sr" id="eA"></label>
        <div style="display:flex;gap:10px">
          <button type="button" class="btn danger" id="eDel">${icon('trash', 18)}${del ? 'إلغاء الحذف' : 'حذف'}</button>
          <button class="btn primary" style="flex:1">حفظ</button>
        </div>
        <div class="hint">التعديلات بتتطبق لما تدوس «مزامنة مع GitHub».</div>
      </form>`,
      onMount(el, api) {
        el.querySelector('#eA').onchange = (e) => { const a = e.target.files[0]; if (a) { state.audios[f.id] = a; toast('هيترفع التسجيل مع المزامنة'); } };
        el.querySelector('#eDel').onclick = () => { if (del) state.deletes.delete(f.id); else state.deletes.add(f.id); api.close(); drawPublished(); drawPending(); };
        el.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          const t = el.querySelector('#eT').value.trim(), u = el.querySelector('#eU').value.trim();
          if (t !== f.title || u !== (f.unit || '')) state.edits[f.id] = { title: t || f.title, unit: u }; else delete state.edits[f.id];
          api.close(); drawPublished(); drawPending();
        };
      }
    });
  }

  function setProg(pct, label) { state.prog = { pct, label }; const el = view.querySelector('#aProg'); if (el) { el.classList.remove('hidden'); el.querySelector('i').style.width = pct + '%'; el.querySelector('span').textContent = label; } }

  async function sync(attempt = 1) {
    if (state.busy) return;
    state.busy = true; drawPending();
    const { repo, branch } = session;
    const ready = state.pending.filter((p) => p.status === 'ready');
    const steps = ready.length * 2 + Object.keys(state.audios).length + ready.filter((p) => p.audio).length + 3;
    let done = 0;
    const tick = (label) => setProg(Math.round((++done / steps) * 100), label);
    try {
      setProg(2, 'بيتصل بـ GitHub…');
      const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      const head = ref.object.sha;
      const commit = await gh(`/repos/${repo}/git/commits/${head}`);
      const index = await readIndex(head);
      const tree = [];
      const now = Date.now();
      for (const [i, p] of ready.entries()) {
        const id = newId();
        const label = `بيرفع ${ar(i + 1)} من ${ar(ready.length)}: ${p.title}`;
        setProg(Math.round((done / steps) * 100), label);
        const sha = await uploadBlob(p.file); tick(label);
        tree.push({ path: `files/${id}.pdf`, mode: '100644', type: 'blob', sha });
        const entry = { id, title: (p.title || p.file.name).trim(), unit: (p.unit || '').trim(), pages: p.pages, size: p.size, path: `files/${id}.pdf`, added: now + i };
        if (p.thumb) { const tsha = await uploadBlob(p.thumb); tree.push({ path: `files/thumbs/${id}.jpg`, mode: '100644', type: 'blob', sha: tsha }); entry.thumb = `files/thumbs/${id}.jpg`; }
        tick(label);
        if (p.audio) {
          const ext = (p.audio.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
          const asha = await uploadBlob(p.audio); tick('بيرفع التسجيل الصوتي…');
          tree.push({ path: `files/audio/${id}.${ext}`, mode: '100644', type: 'blob', sha: asha });
          entry.audio = `files/audio/${id}.${ext}`;
        }
        index.files.push(entry);
      }
      for (const [id, a] of Object.entries(state.audios)) {
        const f = index.files.find((x) => x.id === id);
        if (!f) continue;
        const ext = (a.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
        const asha = await uploadBlob(a); tick('بيرفع التسجيل الصوتي…');
        const path = `files/audio/${id}.${ext}`;
        if (f.audio && f.audio !== path) tree.push({ path: f.audio, mode: '100644', type: 'blob', sha: null });
        tree.push({ path, mode: '100644', type: 'blob', sha: asha });
        f.audio = path;
      }
      for (const [id, e] of Object.entries(state.edits)) {
        const f = index.files.find((x) => x.id === id);
        if (f) { f.title = e.title; f.unit = e.unit; }
      }
      for (const id of state.deletes) {
        const f = index.files.find((x) => x.id === id);
        if (!f) continue;
        for (const p of [f.path, f.thumb, f.audio]) if (p) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
        index.files = index.files.filter((x) => x !== f);
      }
      index.updated = now;
      index.version = (index.version || 0) + 1;
      tree.push({ path: 'files/index.json', mode: '100644', type: 'blob', content: JSON.stringify(index, null, 1) });
      setProg(Math.round((done / steps) * 100), 'بيحفظ التغييرات…');
      const t = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree }) }); tick('بيحفظ التغييرات…');
      const added = ready.length, removed = state.deletes.size;
      const msg = ['تحديث الملفات', added && `+${added} ملف`, removed && `-${removed} ملف`].filter(Boolean).join(' ') + ' (من لوحة المدرس)';
      const c = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: msg, tree: t.sha, parents: [head] }) }); tick('بينشر…');
      await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) }); tick('تم');
      // success
      state.pending.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
      state.pending = state.pending.filter((p) => p.status !== 'ready');
      state.edits = {}; state.deletes = new Set(); state.audios = {};
      state.index = index; state.busy = false; state.prog = null;
      drawPending(); drawPublished();
      const last = view.querySelector('#aLast'); if (last) last.textContent = 'آخر مزامنة: دلوقتي';
      toast('اترفع بنجاح! الطلاب هيشوفوا التحديث خلال دقيقة أو اتنين', { ms: 6000 });
      setTimeout(() => loadCatalog(), 90000);
    } catch (e) {
      console.error(e);
      state.busy = false;
      if ((e.status === 422 || e.status === 409) && attempt < 2) { state.prog = null; return sync(attempt + 1); }
      state.prog = null; drawPending();
      toast('المزامنة فشلت: ' + ghError(e), { ms: 6000 });
    }
  }

  if (session) renderDash();
  else if (getCfg()) renderLogin();
  else renderSetup();

  return () => { dead = true; };
}
