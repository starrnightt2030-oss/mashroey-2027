// Teacher panel.
// • The teacher password lives in the repo (config/admin.json) as a salted PBKDF2 hash, so there is
//   exactly ONE teacher password for every device. Before it's set, a default setup password is used,
//   and the teacher is forced to change it on first entry (the change is committed to GitHub).
// • The GitHub token never lives in the code: it's stored on the teacher's own device only,
//   encrypted (AES-GCM) with a key derived from the teacher password.
import { icon, esc, ar, mb, ago, toast, confirmDlg, sheet } from './ui.js';
import { loadCatalog } from './catalog.js';

const DEFAULT_PASS = 'Mashroey@2027';           // setup password — works only until the teacher sets his own
const ADMIN_PATH = 'config/admin.json';
const CFG_KEY = 'admin-cfg';
const DEFAULT_REPO = 'starrnightt2030-oss/mashroey-2027';
const DEFAULT_BRANCH = 'main';
let session = null; // { token, repo, branch, pass } — memory only

// ---------- crypto ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2Key(pass, salt) {
  return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
}
async function aesKey(pass, salt) {
  const base = await pbkdf2Key(pass);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function passHash(pass, saltB64, iter) {
  const base = await pbkdf2Key(pass);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' }, base, 256);
  return b64(new Uint8Array(bits));
}
async function seal(token, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(pass, salt), enc.encode(token)));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function unseal(cfg, pass) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(cfg.iv) }, await aesKey(pass, unb64(cfg.salt)), unb64(cfg.ct));
  return dec.decode(pt);
}
const getLocal = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; } };
async function saveLocal(token, pass, repo, branch) {
  localStorage.setItem(CFG_KEY, JSON.stringify({ repo, branch, ...(await seal(token, pass)), at: Date.now() }));
}

// ---------- the shared teacher password (from the repo) ----------
// returns: { cfg } if a password is set, { cfg: null } if still on the default, throws if unreachable
async function fetchAdminCfg() {
  const repo = (getLocal() || {}).repo || DEFAULT_REPO;
  const branch = (getLocal() || {}).branch || DEFAULT_BRANCH;
  // 1) GitHub API (always fresh)
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${ADMIN_PATH}?ref=${branch}&t=${Date.now()}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (r.status === 404) return { cfg: null };
    if (r.ok) { const j = await r.json(); return { cfg: JSON.parse(dec.decode(unb64(j.content.replace(/\s/g, '')))) }; }
  } catch (e) {}
  // 2) raw file / 3) the site itself
  for (const url of [`https://raw.githubusercontent.com/${repo}/${branch}/${ADMIN_PATH}?t=${Date.now()}`, `${ADMIN_PATH}?t=${Date.now()}`]) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.status === 404) return { cfg: null };
      if (r.ok) return { cfg: await r.json() };
    } catch (e) {}
  }
  throw new Error('offline');
}
async function checkPassword(pass) {
  const { cfg } = await fetchAdminCfg();
  if (!cfg || !cfg.hash) return { ok: pass === DEFAULT_PASS, isDefault: true };
  return { ok: (await passHash(pass, cfg.salt, cfg.iter || 200000)) === cfg.hash, isDefault: false };
}

// ---------- GitHub API (authenticated) ----------
async function gh(path, opts = {}, s = session) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    cache: 'no-store',
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
  if (e.status === 401) return 'مفتاح GitHub غلط أو انتهت صلاحيته';
  if (e.status === 403) return 'المفتاح مالوش صلاحية كتابة (Contents: Read and write)';
  if (e.status === 404) return 'المستودع أو الفرع مش موجود، أو المفتاح مش متاح له';
  if (e.status === 409 || e.status === 422) return 'حصل تعارض — جرّب تاني';
  if (!navigator.onLine) return 'مفيش اتصال بالنت';
  return e.message || 'خطأ غير معروف';
}
async function readIndex(ref) {
  const { repo, branch } = session;
  try {
    const j = await gh(`/repos/${repo}/contents/files/index.json?ref=${encodeURIComponent(ref || branch)}`);
    const idx = JSON.parse(dec.decode(unb64(j.content.replace(/\s/g, ''))));
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
  return (await gh(`/repos/${session.repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) })).sha;
}
async function headInfo() {
  const { repo, branch } = session;
  const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`);
  return { head: ref.object.sha, baseTree: commit.tree.sha };
}
async function commitTree(head, baseTree, tree, message) {
  const { repo, branch } = session;
  const t = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
  const c = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [head] }) });
  await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  return c.sha;
}
const newId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- view ----------
export async function mountAdmin(view, { goBack }) {
  let dead = false;
  const state = { index: null, pending: [], edits: {}, deletes: new Set(), audios: {}, vis: {}, notice: '', busy: false, prog: null };

  function shell(inner) {
    view.innerHTML = `<div class="page stack" style="padding-bottom:60px">
      <div class="titlebar">
        <button class="iconbtn" id="aBack" aria-label="رجوع">${icon('back')}</button>
        <h1>لوحة المدرس</h1>
        ${session ? `<span class="pill" style="background:var(--accent-soft);color:var(--accent-soft-ink);display:flex;align-items:center;gap:6px;font-weight:600">${icon('lock', 14, 2.2)}مدرس</span>` : ''}
      </div>
      ${inner}
    </div>`;
    view.querySelector('#aBack').onclick = () => goBack('/settings');
  }
  const pwField = (id, label, extra = '') => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" type="password" autocomplete="off" ${extra}></div>`;

  // ----- 1) login: the one teacher password -----
  function renderLogin() {
    shell(`
      <div class="lock-ill">${icon('lock', 34)}</div>
      <div style="text-align:center"><h2 style="font-size:19px">دخول المدرس فقط</h2><div class="hint">لوحة رفع الملفات والتحكم فيها محمية بكلمة سر</div></div>
      <form class="stack" id="loginForm">
        ${pwField('lp', 'كلمة سر المدرس', 'required autofocus autocomplete="current-password"')}
        <button class="btn primary block" id="lBtn">دخول</button>
      </form>
      <div class="hint" style="text-align:center">لو نسيت كلمة السر: امسح ملف <b dir="ltr">${ADMIN_PATH}</b> من المستودع على GitHub، فترجع كلمة سر الإعداد الأولى.</div>`);
    setTimeout(() => view.querySelector('#lp')?.focus(), 200);
    view.querySelector('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const pass = view.querySelector('#lp').value;
      const btn = view.querySelector('#lBtn');
      btn.disabled = true; btn.textContent = 'بيتأكد…';
      try {
        const r = await checkPassword(pass);
        if (!r.ok) {
          toast('كلمة السر غلط');
          const i = view.querySelector('#lp'); i.value = ''; i.focus();
          btn.disabled = false; btn.textContent = 'دخول';
          return;
        }
        // unlock the token saved on this device (if any)
        const local = getLocal();
        let token = null;
        if (local) { try { token = await unseal(local, pass); } catch (er) { token = null; } }
        if (token) {
          session = { token, repo: local.repo, branch: local.branch, pass };
          if (r.isDefault) renderChangePass(true); else renderDash();
        } else {
          renderToken(pass, r.isDefault);
        }
      } catch (er) {
        toast('محتاج نت عشان تدخل لوحة المدرس');
        btn.disabled = false; btn.textContent = 'دخول';
      }
    };
  }

  // ----- 2) connect GitHub on this device -----
  function renderToken(pass, isDefault, fromDash) {
    const local = getLocal() || {};
    shell(`
      <div class="lock-ill">${icon('key', 34)}</div>
      <div style="text-align:center"><h2 style="font-size:19px">ربط الجهاز ده بـ GitHub</h2><div class="hint">مرة واحدة بس على كل جهاز هترفع منه</div></div>
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
      <form class="stack" id="tokForm" autocomplete="off">
        <div class="field"><label for="sTok">مفتاح GitHub</label><input class="input ltr" id="sTok" type="password" placeholder="github_pat_…" required></div>
        <details><summary class="hint" style="cursor:pointer">إعدادات متقدمة</summary>
          <div class="stack" style="margin-top:10px">
            <div class="field"><label for="sRepo">المستودع</label><input class="input ltr" id="sRepo" value="${esc(local.repo || DEFAULT_REPO)}" required></div>
            <div class="field"><label for="sBranch">الفرع</label><input class="input ltr" id="sBranch" value="${esc(local.branch || DEFAULT_BRANCH)}" required></div>
          </div>
        </details>
        <div class="hint">المفتاح بيتحفظ على الجهاز ده بس ومتشفّر بكلمة سر المدرس — مش موجود في كود التطبيق.</div>
        <button class="btn primary block" id="tokBtn">${icon('check', 18)} ربط ومتابعة</button>
      </form>`);
    if (fromDash) view.querySelector('#aBack').onclick = () => renderDash();
    view.querySelector('#tokForm').onsubmit = async (e) => {
      e.preventDefault();
      const repo = view.querySelector('#sRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      const branch = view.querySelector('#sBranch').value.trim();
      const token = view.querySelector('#sTok').value.trim();
      const btn = view.querySelector('#tokBtn'); btn.disabled = true; btn.textContent = 'بيتأكد من المفتاح…';
      try {
        const s = { token, repo, branch, pass };
        await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {}, s);
        await saveLocal(token, pass, repo, branch);
        session = s;
        toast('اتربط الجهاز بـ GitHub');
        if (isDefault) renderChangePass(true); else renderDash();
      } catch (err) {
        toast(ghError(err), { ms: 5000 });
        btn.disabled = false; btn.innerHTML = icon('check', 18) + ' ربط ومتابعة';
      }
    };
  }

  // ----- 3) set / change the teacher password (synced to GitHub) -----
  function renderChangePass(forced) {
    shell(`
      <div class="lock-ill" style="background:var(--red-soft);color:var(--red)">${icon('lock', 34)}</div>
      <div style="text-align:center"><h2 style="font-size:19px">${forced ? 'اعمل كلمة السر الخاصة بيك' : 'تغيير كلمة سر المدرس'}</h2>
        <div class="hint">${forced ? 'انت داخل بكلمة سر الإعداد. لازم تغيّرها دلوقتي — بعدها هي الوحيدة اللي تفتح لوحة المدرس على أي جهاز.' : 'كلمة السر الجديدة هتتحفظ على GitHub وتشتغل على كل الأجهزة.'}</div></div>
      <form class="stack" id="cpForm">
        ${pwField('cp1', 'كلمة السر الجديدة', 'required minlength="8" placeholder="٨ حروف أو أرقام على الأقل" autocomplete="new-password"')}
        ${pwField('cp2', 'تأكيد كلمة السر', 'required autocomplete="new-password"')}
        <div class="hint">استخدم كلمة سر قوية (حروف وأرقام ورموز) ومتقولهاش لحد.</div>
        <button class="btn primary block" id="cpBtn">${icon('sync', 18)} حفظ ومزامنة مع GitHub</button>
        ${forced ? '' : '<button type="button" class="btn block" id="cpCancel">إلغاء</button>'}
      </form>`);
    view.querySelector('#aBack').onclick = () => (forced ? goBack('/settings') : renderDash());
    const cancel = view.querySelector('#cpCancel'); if (cancel) cancel.onclick = renderDash;
    view.querySelector('#cpForm').onsubmit = async (e) => {
      e.preventDefault();
      const p1 = view.querySelector('#cp1').value, p2 = view.querySelector('#cp2').value;
      if (p1.length < 8) return toast('كلمة السر لازم ٨ حروف على الأقل');
      if (p1 !== p2) return toast('كلمتين السر مش زي بعض');
      if (p1 === DEFAULT_PASS) return toast('اختار كلمة سر غير كلمة سر الإعداد');
      const btn = view.querySelector('#cpBtn'); btn.disabled = true; btn.textContent = 'بيحفظ على GitHub…';
      try {
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const iter = 200000;
        const cfg = { v: 1, salt, iter, hash: await passHash(p1, salt, iter), updated: Date.now() };
        const { head, baseTree } = await headInfo();
        await commitTree(head, baseTree, [{ path: ADMIN_PATH, mode: '100644', type: 'blob', content: JSON.stringify(cfg, null, 1) }], 'تحديث كلمة سر المدرس');
        await saveLocal(session.token, p1, session.repo, session.branch);
        session.pass = p1;
        toast('اتحفظت كلمة السر الجديدة على GitHub', { ms: 4000 });
        renderDash();
      } catch (err) {
        toast('محصلش حفظ: ' + ghError(err), { ms: 6000 });
        btn.disabled = false; btn.innerHTML = icon('sync', 18) + ' حفظ ومزامنة مع GitHub';
      }
    };
  }

  // ----- 4) dashboard -----
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
      <div class="glabel">الإشعارات الفورية</div>
      <div class="group">
        <button class="row" id="aPush"><span class="ri">${icon('bell', 19)}</span><span class="rt"><b>إعداد OneSignal</b><small id="aPushSt">بيتأكد…</small></span><span class="chev">${icon('chev', 18)}</span></button>
        <a class="row" id="aPushManual" target="_blank" rel="noopener"><span class="ri">${icon('share', 19)}</span><span class="rt"><b>ابعت إشعار يدوي للطلاب</b><small>من صفحة GitHub Actions ← Run workflow</small></span></a>
      </div>
      <div class="glabel">الأمان</div>
      <div class="group">
        <button class="row" id="aPass"><span class="ri">${icon('lock', 19)}</span><span class="rt"><b>تغيير كلمة سر المدرس</b><small>بتتزامن مع GitHub وتشتغل على كل الأجهزة</small></span><span class="chev">${icon('chev', 18)}</span></button>
        <button class="row" id="aTok"><span class="ri">${icon('key', 19)}</span><span class="rt"><b>تغيير مفتاح GitHub</b><small>لو المفتاح انتهى أو عايز تغيّره</small></span><span class="chev">${icon('chev', 18)}</span></button>
        <button class="row" id="aLogout"><span class="ri">${icon('logout', 19)}</span><span class="rt"><b>تسجيل خروج</b><small>هتحتاج كلمة السر المرة الجاية</small></span></button>
        <button class="row" id="aForget"><span class="ri">${icon('trash', 19)}</span><span class="rt"><b>فصل الجهاز ده عن GitHub</b><small>يمسح المفتاح المتشفّر من الجهاز ده بس</small></span></button>
      </div>`);
    const drop = view.querySelector('#aDrop'), inp = view.querySelector('#aFiles');
    inp.onchange = () => { addFiles([...inp.files]); inp.value = ''; };
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
    view.querySelector('#aReload').onclick = refresh;
    view.querySelector('#aPush').onclick = pushSetup;
    view.querySelector('#aPushManual').href = `https://github.com/${session.repo}/actions/workflows/notify-students.yml`;
    readPushCfg().then((c) => { const el = view.querySelector('#aPushSt'); if (el) el.textContent = c.onesignalAppId ? 'متفعّل ✓ — App ID متسجل' : 'مش متفعّل — دوس عشان تجهّزه'; });
    view.querySelector('#aPass').onclick = () => renderChangePass(false);
    view.querySelector('#aTok').onclick = () => renderToken(session.pass, false, true);
    view.querySelector('#aLogout').onclick = () => { session = null; toast('اتسجل الخروج'); goBack('/settings'); };
    view.querySelector('#aForget').onclick = async () => {
      if (await confirmDlg('فصل الجهاز عن GitHub؟', 'هتحتاج تحط مفتاح GitHub تاني لو حبيت ترفع من الجهاز ده.', 'افصل', true)) {
        localStorage.removeItem(CFG_KEY); session = null; renderLogin();
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
      if (last) last.textContent = state.index.updated ? 'آخر مزامنة: ' + ago(state.index.updated) : 'لسه مفيش ملفات مرفوعة';
      drawPublished();
    } catch (e) {
      if (last) last.textContent = ghError(e);
      if (e.status === 401) toast('مفتاح GitHub انتهى أو اتلغى — من «تغيير مفتاح GitHub» حط مفتاح جديد', { ms: 6000 });
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
    return state.pending.filter((p) => p.status === 'ready').length + Object.keys(state.edits).length + state.deletes.size + Object.keys(state.audios).length + Object.keys(state.vis).length;
  }

  function drawPending() {
    const box = view.querySelector('#aPending');
    if (!box) return;
    const n = changesCount();
    const total = state.pending.reduce((s, p) => s + (p.status === 'ready' ? p.size + (p.audio ? p.audio.size : 0) : 0), 0);
    const nVis = Object.keys(state.vis).length;
    box.innerHTML = state.pending.length || n ? `
      <div class="sec" style="margin-bottom:10px"><h2>جاهزة للمزامنة</h2><span>${ar(n)} تغيير${total ? ' · ' + mb(total) : ''}</span></div>
      <div class="stack" style="gap:8px">${state.pending.map((p) => `
        <div class="pend" data-k="${p.key}">
          <div class="pend-h">
            ${p.thumbUrl ? `<img src="${p.thumbUrl}" alt="" style="width:34px;height:44px;object-fit:cover;object-position:top;border-radius:6px;border:1px solid var(--line)">` : '<span class="tagpdf">PDF</span>'}
            <span style="flex:1;font-size:13px;color:var(--muted);direction:ltr;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.file.name)}</span>
            <span class="st ${p.status === 'error' ? 'err' : ''}">${p.status === 'checking' ? 'بيتفحص…' : p.status === 'error' ? esc(p.err) : `${ar(p.pages)} صفحة · ${mb(p.size)}`}</span>
            <button class="iconbtn" data-rm style="width:34px;height:34px" aria-label="شيل">${icon('x', 16)}</button>
          </div>
          ${p.status !== 'error' ? `
          <div class="field"><input class="input" data-f="title" value="${esc(p.title)}" placeholder="اسم الملف اللي هيظهر للطلاب" aria-label="اسم الملف"></div>
          <div class="pend-grid">
            <input class="input" data-f="unit" value="${esc(p.unit)}" placeholder="المادة / الوحدة" list="unitList" aria-label="المادة أو الوحدة">
            <label class="btn sm ${p.audio ? 'soft' : ''}" style="cursor:pointer;height:auto;min-height:42px">${icon('music', 16)}<span>${p.audio ? 'فيه تسجيل ✓' : 'تسجيل صوتي'}</span><input type="file" accept="audio/*" class="sr" data-audio></label>
          </div>` : ''}
        </div>`).join('')}
        ${Object.keys(state.edits).length || state.deletes.size || Object.keys(state.audios).length || nVis ? `<div class="hint">+ ${ar(Object.keys(state.edits).length)} تعديل · ${ar(state.deletes.size)} حذف · ${ar(nVis)} إخفاء/إظهار · ${ar(Object.keys(state.audios).length)} تسجيل صوتي</div>` : ''}
      </div>
      <datalist id="unitList">${units().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
      <div class="field" style="margin-top:12px"><label for="aNotice">رسالة للطلاب مع التحديث (اختياري)</label>
        <textarea class="textarea" id="aNotice" style="min-height:70px" placeholder="مثلاً: نزّلت ملخص الوحدة التالتة — ذاكروه قبل الحصة الجاية">${esc(state.notice)}</textarea></div>
      <div class="sync-bar">
        <div class="sync-prog ${state.prog ? '' : 'hidden'}" id="aProg"><div class="progress"><i style="width:${state.prog ? state.prog.pct : 0}%"></i></div><span>${state.prog ? esc(state.prog.label) : ''}</span></div>
        <button class="btn primary block" id="aSync" style="height:58px;font-family:var(--display);font-size:16px" ${!n || state.busy || state.pending.some((p) => p.status === 'checking') ? 'disabled' : ''}>${icon('sync', 20, 2.2)} ${state.busy ? 'جارٍ المزامنة…' : `مزامنة مع GitHub (${ar(n)})`}</button>
        <div class="hint" style="text-align:center">بعد المزامنة، كل الطلاب هيظهرلهم إشعار تحديث إجباري</div>
      </div>` : '';
    box.querySelectorAll('.pend').forEach((el) => {
      const p = state.pending.find((x) => x.key === el.dataset.k);
      if (!p) return;
      el.querySelector('[data-rm]').onclick = () => { if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl); state.pending = state.pending.filter((x) => x !== p); drawPending(); };
      el.querySelectorAll('[data-f]').forEach((i) => i.oninput = () => { p[i.dataset.f] = i.value; if (i.dataset.f === 'unit') localStorage.setItem('admin-last-unit', i.value); });
      const au = el.querySelector('[data-audio]');
      if (au) au.onchange = () => { p.audio = au.files[0] || null; drawPending(); };
    });
    const nt = box.querySelector('#aNotice'); if (nt) nt.oninput = () => { state.notice = nt.value; };
    const sb = box.querySelector('#aSync');
    if (sb) sb.onclick = () => sync();
  }

  async function readPushCfg() {
    try {
      const j = await gh(`/repos/${session.repo}/contents/config/push.json?ref=${encodeURIComponent(session.branch)}`);
      return JSON.parse(dec.decode(unb64(j.content.replace(/\s/g, ''))));
    } catch (e) { return {}; }
  }
  async function pushSetup() {
    const cur = await readPushCfg();
    sheet({
      title: 'الإشعارات الفورية (OneSignal)',
      html: `<form class="stack">
        <div class="card stack" style="gap:8px">
          <b>الإعداد مرة واحدة (١٠ دقايق)</b>
          <div class="hint">
            ١. اعمل حساب مجاني على <a href="https://onesignal.com" target="_blank" rel="noopener">onesignal.com</a> ← New App ← اسمه «مشروع التخرج» ← اختار <b>Web</b>.<br>
            ٢. Integration: اختار <b>Custom Code</b> — Site URL: <b dir="ltr">https://${esc(session.repo.split('/')[0])}.github.io</b> ← Save.<br>
            ٣. من Settings ← <b>Keys &amp; IDs</b>: انسخ <b>App ID</b> والصقه تحت.<br>
            ٤. من نفس الصفحة اعمل <b>API Key</b> وانسخه، وبعدين في GitHub افتح <a href="https://github.com/${esc(session.repo)}/settings/secrets/actions/new" target="_blank" rel="noopener">صفحة Secrets</a> واعمل Secret اسمه <b dir="ltr">ONESIGNAL_REST_API_KEY</b> وقيمته المفتاح.<br>
            ٥. خلاص! بعد أي مزامنة، الطلاب اللي فعّلوا الإشعارات هيوصلهم إشعار فوري.
          </div>
        </div>
        <div class="field"><label for="osId">OneSignal App ID</label><input class="input ltr" id="osId" value="${esc(cur.onesignalAppId || '')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
        <button class="btn primary block" id="osSave">${icon('sync', 18)} حفظ ومزامنة مع GitHub</button>
      </form>`,
      onMount(el, api) {
        el.querySelector('form').onsubmit = async (e) => {
          e.preventDefault();
          const id = el.querySelector('#osId').value.trim();
          if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return toast('الـ App ID شكله مش مظبوط — انسخه تاني من OneSignal');
          const b = el.querySelector('#osSave'); b.disabled = true; b.textContent = 'بيحفظ…';
          try {
            const { head, baseTree } = await headInfo();
            await commitTree(head, baseTree, [{ path: 'config/push.json', mode: '100644', type: 'blob', content: JSON.stringify({ onesignalAppId: id }, null, 1) }], 'إعداد الإشعارات الفورية');
            toast(id ? 'اتفعّلت الإشعارات الفورية — هتشتغل على أجهزة الطلاب خلال دقيقتين' : 'اتلغت الإشعارات الفورية', { ms: 5000 });
            api.close();
            const st = view.querySelector('#aPushSt'); if (st) st.textContent = id ? 'متفعّل ✓ — App ID متسجل' : 'مش متفعّل — دوس عشان تجهّزه';
          } catch (err) { toast('محصلش حفظ: ' + ghError(err)); b.disabled = false; b.innerHTML = icon('sync', 18) + ' حفظ ومزامنة مع GitHub'; }
        };
      }
    });
  }

  const isHidden = (f) => (f.id in state.vis ? state.vis[f.id] : !!f.hidden);

  function drawPublished() {
    const box = view.querySelector('#aPublished');
    if (!box || !state.index) return;
    const files = state.index.files;
    const shown = files.filter((f) => !f.hidden).length;
    box.innerHTML = `<div class="sec" style="margin-bottom:10px"><h2>الملفات المنشورة</h2><span>${ar(shown)} ظاهر من ${ar(files.length)}</span></div>
      ${files.length ? `<div class="group">${files.map((f) => {
        const ed = state.edits[f.id] || {};
        const del = state.deletes.has(f.id);
        const hid = isHidden(f);
        return `<div class="row" style="${del || hid ? 'opacity:.55' : ''}">
          ${f.thumb ? `<img src="${esc(f.thumb)}" alt="" style="width:34px;height:44px;object-fit:cover;object-position:top;border-radius:6px;border:1px solid var(--line);background:#fff" onerror="this.style.visibility='hidden'">` : `<span class="ri">${icon('file', 18)}</span>`}
          <span class="rt"><b style="${del ? 'text-decoration:line-through' : ''}">${esc(ed.title ?? f.title)}</b>
            <small>${esc(ed.unit ?? f.unit ?? '')}${(ed.unit ?? f.unit) ? ' · ' : ''}${ar(f.pages || 0)} صفحة${f.audio || state.audios[f.id] ? ' · فيه تسجيل' : ''}${hid ? ' · <span class="st del">مخفي عن الطلاب</span>' : ''}${del ? ' · <span class="st del">هيتمسح</span>' : ''}</small></span>
          <button class="iconbtn" data-vis="${f.id}" aria-label="${hid ? 'إظهار للطلاب' : 'إخفاء عن الطلاب'}" style="color:${hid ? 'var(--red)' : 'var(--accent)'}">${icon(hid ? 'eyeoff' : 'eye', 19)}</button>
          <button class="iconbtn" data-edit="${f.id}" aria-label="تعديل">${icon('edit', 18)}</button>
        </div>`;
      }).join('')}</div>` : `<div class="empty"><div class="ill">${icon('file', 28)}</div><h3>لسه مفيش ملفات</h3><span>اختار ملفات PDF من فوق وبعدين دوس مزامنة.</span></div>`}`;
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editPublished(files.find((f) => f.id === b.dataset.edit)));
    box.querySelectorAll('[data-vis]').forEach((b) => b.onclick = () => {
      const f = files.find((x) => x.id === b.dataset.vis);
      const next = !isHidden(f);
      if (next === !!f.hidden) delete state.vis[f.id]; else state.vis[f.id] = next;
      toast(next ? 'هيتخفى عن الطلاب بعد المزامنة' : 'هيظهر للطلاب بعد المزامنة');
      drawPublished(); drawPending();
    });
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
    const ready = state.pending.filter((p) => p.status === 'ready');
    const steps = ready.length * 2 + Object.keys(state.audios).length + ready.filter((p) => p.audio).length + 2;
    let done = 0;
    const tick = (label) => setProg(Math.round((++done / steps) * 100), label);
    try {
      setProg(2, 'بيتصل بـ GitHub…');
      const { head, baseTree } = await headInfo();
      const index = await readIndex(head);
      const tree = [];
      const now = Date.now();
      for (const [i, p] of ready.entries()) {
        const id = p.id || (p.id = newId());
        const label = `بيرفع ${ar(i + 1)} من ${ar(ready.length)}: ${p.title}`;
        setProg(Math.round((done / steps) * 100), label);
        p.sha = p.sha || await uploadBlob(p.file); tick(label);
        tree.push({ path: `files/${id}.pdf`, mode: '100644', type: 'blob', sha: p.sha });
        const entry = { id, title: (p.title || p.file.name).trim(), unit: (p.unit || '').trim(), pages: p.pages, size: p.size, path: `files/${id}.pdf`, added: now + i };
        if (p.thumb) { p.tsha = p.tsha || await uploadBlob(p.thumb); tree.push({ path: `files/thumbs/${id}.jpg`, mode: '100644', type: 'blob', sha: p.tsha }); entry.thumb = `files/thumbs/${id}.jpg`; }
        tick(label);
        if (p.audio) {
          const ext = (p.audio.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
          p.asha = p.asha || await uploadBlob(p.audio); tick('بيرفع التسجيل الصوتي…');
          tree.push({ path: `files/audio/${id}.${ext}`, mode: '100644', type: 'blob', sha: p.asha });
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
      for (const [id, h] of Object.entries(state.vis)) {
        const f = index.files.find((x) => x.id === id);
        if (f) { if (h) f.hidden = true; else delete f.hidden; }
      }
      for (const id of state.deletes) {
        const f = index.files.find((x) => x.id === id);
        if (!f) continue;
        for (const p of [f.path, f.thumb, f.audio]) if (p) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
        index.files = index.files.filter((x) => x !== f);
      }
      index.updated = now;
      index.version = (index.version || 0) + 1;
      const note = state.notice.trim();
      if (note) index.notice = { text: note, version: index.version, at: now }; else delete index.notice;
      tree.push({ path: 'files/index.json', mode: '100644', type: 'blob', content: JSON.stringify(index, null, 1) });
      setProg(Math.round((done / steps) * 100), 'بينشر التحديث…');
      const added = ready.length, removed = state.deletes.size;
      const msg = ['تحديث الملفات', added && `+${added} ملف`, removed && `-${removed} ملف`].filter(Boolean).join(' ') + ' (من لوحة المدرس)';
      await commitTree(head, baseTree, tree, msg); tick('تم');
      // success
      state.pending.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
      state.pending = state.pending.filter((p) => p.status !== 'ready');
      state.edits = {}; state.deletes = new Set(); state.audios = {}; state.vis = {}; state.notice = '';
      state.index = index; state.busy = false; state.prog = null;
      drawPending(); drawPublished();
      const last = view.querySelector('#aLast'); if (last) last.textContent = 'آخر مزامنة: دلوقتي';
      toast('اتنشر التحديث! هيوصل لكل الطلاب خلال دقيقة أو اتنين', { ms: 6000 });
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
  else renderLogin();

  return () => { dead = true; };
}
