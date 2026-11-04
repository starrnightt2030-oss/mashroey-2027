// Repairs the hidden text layer of Arabic PDFs (common with files exported from MS Word).
// Many such PDFs *look* right but store wrong character codes (a shifted ToUnicode table),
// so read-aloud, search and copy produce gibberish. We rebuild that table from the font
// embedded in the PDF itself (its cmap, glyph names and ligature rules). The page drawing
// is not touched at all — the file looks exactly the same, only its text becomes correct.

let libP;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!libP) {
    libP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/pdf-lib.min.js', import.meta.url).href;
      s.onload = () => resolve(window.PDFLib);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return libP;
}

// ---------- minimal TrueType reader ----------
function parseTTF(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint16(4);
  const T = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    T[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  return { dv, u8, T };
}
function cmapByGlyph(f) {
  const { dv, T } = f;
  const out = new Map();
  if (!T.cmap) return out;
  const base = T.cmap.off, n = dv.getUint16(base + 2);
  let best = null, score = -1;
  for (let i = 0; i < n; i++) {
    const pid = dv.getUint16(base + 4 + i * 8), eid = dv.getUint16(base + 6 + i * 8), off = dv.getUint32(base + 8 + i * 8);
    const fmt = dv.getUint16(base + off);
    const sc = pid === 3 && eid === 10 && fmt === 12 ? 4 : pid === 3 && eid === 1 && fmt === 4 ? 3 : pid === 0 && (fmt === 4 || fmt === 12) ? 2 : -1;
    if (sc > score) { score = sc; best = { o: base + off, fmt }; }
  }
  if (!best || score < 0) return out;
  const add = (cp, g) => { if (!g) return; if (!out.has(g)) out.set(g, []); out.get(g).push(cp); };
  const o = best.o;
  if (best.fmt === 4) {
    const segX2 = dv.getUint16(o + 6), seg = segX2 / 2;
    const endO = o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, roO = deltaO + segX2;
    for (let s = 0; s < seg; s++) {
      const end = dv.getUint16(endO + s * 2), start = dv.getUint16(startO + s * 2);
      const delta = dv.getInt16(deltaO + s * 2), ro = dv.getUint16(roO + s * 2);
      for (let c = start; c <= end && c !== 0xFFFF; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xFFFF;
        else { g = dv.getUint16(roO + s * 2 + ro + (c - start) * 2); if (g) g = (g + delta) & 0xFFFF; }
        add(c, g);
      }
    }
  } else {
    const ng = dv.getUint32(o + 12);
    for (let i = 0; i < ng; i++) {
      const s = dv.getUint32(o + 16 + i * 12), e = dv.getUint32(o + 20 + i * 12), g0 = dv.getUint32(o + 24 + i * 12);
      for (let c = s; c <= e && c - s < 70000; c++) add(c, g0 + (c - s));
    }
  }
  return out;
}
function postNames(f) {
  const { dv, T, u8 } = f;
  const names = new Map();
  if (!T.post || dv.getUint32(T.post.off) !== 0x00020000) return names;
  const o = T.post.off, n = dv.getUint16(o + 32);
  let p = o + 34 + n * 2;
  const end = o + T.post.len, custom = [];
  while (p < end) { const l = u8[p]; custom.push(String.fromCharCode(...u8.subarray(p + 1, p + 1 + l))); p += 1 + l; }
  for (let g = 0; g < n; g++) { const k = dv.getUint16(o + 34 + g * 2); if (k >= 258 && custom[k - 258]) names.set(g, custom[k - 258]); }
  return names;
}
function coverage(dv, o) {
  const fmt = dv.getUint16(o), out = [];
  if (fmt === 1) { const n = dv.getUint16(o + 2); for (let i = 0; i < n; i++) out.push(dv.getUint16(o + 4 + i * 2)); }
  else if (fmt === 2) { const n = dv.getUint16(o + 2); for (let i = 0; i < n; i++) { const s = dv.getUint16(o + 4 + i * 6), e = dv.getUint16(o + 6 + i * 6); for (let g = s; g <= e; g++) out.push(g); } }
  return out;
}
function gsubRules(f) {
  const { dv, T } = f;
  const singles = [], ligs = [];
  if (!T.GSUB) return { singles, ligs };
  const g = T.GSUB.off, ll = g + dv.getUint16(g + 8), nl = dv.getUint16(ll);
  for (let i = 0; i < nl; i++) {
    const lo = ll + dv.getUint16(ll + 2 + i * 2);
    const type = dv.getUint16(lo), ns = dv.getUint16(lo + 4);
    for (let j = 0; j < ns; j++) {
      let so = lo + dv.getUint16(lo + 6 + j * 2), t = type;
      if (t === 7) { t = dv.getUint16(so + 2); so += dv.getUint32(so + 4); }
      if (t === 1) {
        const fmt = dv.getUint16(so), cov = coverage(dv, so + dv.getUint16(so + 2));
        if (fmt === 1) { const d = dv.getInt16(so + 4); cov.forEach((s) => singles.push([s, (s + d) & 0xFFFF])); }
        else { const n = dv.getUint16(so + 4); cov.forEach((s, k) => { if (k < n) singles.push([s, dv.getUint16(so + 6 + k * 2)]); }); }
      } else if (t === 4) {
        const cov = coverage(dv, so + dv.getUint16(so + 2)), n = dv.getUint16(so + 4);
        for (let k = 0; k < n && k < cov.length; k++) {
          const lso = so + dv.getUint16(so + 6 + k * 2), lc = dv.getUint16(lso);
          for (let m = 0; m < lc; m++) {
            const lo2 = lso + dv.getUint16(lso + 2 + m * 2);
            const lg = dv.getUint16(lo2), cc = dv.getUint16(lo2 + 2);
            const comps = [cov[k]];
            for (let q = 1; q < cc; q++) comps.push(dv.getUint16(lo2 + 2 + q * 2));
            ligs.push([lg, comps]);
          }
        }
      }
    }
  }
  return { singles, ligs };
}
const isPF = (c) => c >= 0xFB50 && c <= 0xFEFF;
function glyphText(fontBytes) {
  const f = parseTTF(fontBytes);
  const out = new Map();
  for (const [g, cps] of cmapByGlyph(f)) {
    const base = cps.filter((c) => !isPF(c));
    out.set(g, String.fromCodePoint(Math.min(...(base.length ? base : cps))).normalize('NFKC'));
  }
  for (const [g, name] of postNames(f)) {
    if (out.has(g)) continue;
    let m = name.match(/^uni((?:[0-9A-F]{4})+)$/), t = null;
    if (m) t = m[1].match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join('');
    else if ((m = name.match(/^u([0-9A-F]{5})$/))) t = String.fromCodePoint(parseInt(m[1], 16));
    if (t) out.set(g, t.normalize('NFKC'));
  }
  try {
    const { singles, ligs } = gsubRules(f);
    for (let pass = 0; pass < 3; pass++) {
      for (const [s, d] of singles) if (!out.has(d) && out.has(s)) out.set(d, out.get(s));
      for (const [lg, comps] of ligs) if (!out.has(lg) && comps.every((c) => out.has(c))) out.set(lg, comps.map((c) => out.get(c)).join(''));
    }
  } catch (e) { /* GSUB optional */ }
  return out;
}

// ---------- ToUnicode CMap read / write ----------
function parseToUnicode(s) {
  const m = new Map();
  const hexStr = (h) => h.match(/.{1,4}/g).map((x) => String.fromCharCode(parseInt(x, 16))).join('');
  for (const [, blk] of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const [, a, u] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) m.set(parseInt(a, 16), hexStr(u));
  for (const [, blk] of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const [, a, b, rest] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[\s\S]*?\]|<[0-9A-Fa-f]+>)/g)) {
      const lo = parseInt(a, 16), hi = parseInt(b, 16);
      if (rest.startsWith('[')) [...rest.matchAll(/<([0-9A-Fa-f]+)>/g)].forEach(([, u], i) => m.set(lo + i, hexStr(u)));
      else { const st = parseInt(rest.slice(1, -1), 16); for (let i = 0; i <= hi - lo && i < 65536; i++) m.set(lo + i, String.fromCharCode(st + i)); }
    }
  return m;
}
function buildToUnicode(map) {
  const items = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const hex = (t) => [...t].map((c) => { const cp = c.codePointAt(0); return cp < 0x10000 ? cp.toString(16).toUpperCase().padStart(4, '0') : ''; }).join('');
  let body = '';
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100).filter(([, t]) => hex(t));
    if (!chunk.length) continue;
    body += `${chunk.length} beginbfchar\n` + chunk.map(([c, t]) => `<${c.toString(16).toUpperCase().padStart(4, '0')}> <${hex(t)}>`).join('\n') + '\nendbfchar\n';
  }
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' + body +
    'endcmap\nCMapName currentdict /CMapResource defineresource pop\nend\nend\n';
}
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return s; };
const isArabic = (t) => { const c = t.codePointAt(0); return c >= 0x600 && c <= 0x6FF; };

// Returns { bytes, fixed } — `fixed` = number of fonts repaired (0 = file was already fine).
export async function repairArabicPdf(input, lib) {
  const L = lib || await loadPdfLib();
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } = L;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch (e) { return { bytes, fixed: 0 }; }
  const ctx = doc.context;
  const N = (n) => PDFName.of(n);
  const raw = (s) => (s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents ? s.getContents() : null);
  let fixed = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    try {
      if (!(obj instanceof PDFDict) || obj.get(N('Subtype')) !== N('Type0')) continue;
      if (obj.get(N('Encoding')) !== N('Identity-H') || !obj.get(N('ToUnicode'))) continue;
      const desc = ctx.lookup(obj.get(N('DescendantFonts')), PDFArray);
      const cid = ctx.lookup(desc.get(0), PDFDict);
      const c2g = cid.get(N('CIDToGIDMap'));
      if (c2g && c2g !== N('Identity')) continue;
      const fd = ctx.lookup(cid.get(N('FontDescriptor')), PDFDict);
      if (!fd.get(N('FontFile2'))) continue;
      const fontBytes = raw(ctx.lookup(fd.get(N('FontFile2'))));
      const tuBytes = raw(ctx.lookup(obj.get(N('ToUnicode'))));
      if (!fontBytes || !tuBytes) continue;
      const gt = glyphText(fontBytes);
      const old = parseToUnicode(latin1(tuBytes));
      const ar = [...old.entries()].filter(([c, t]) => t && isArabic(t) && gt.has(c));
      if (ar.length < 5) continue;
      const bad = ar.filter(([c, t]) => t[0].normalize('NFKC') !== gt.get(c)[0]).length;
      if (bad / ar.length < 0.15) continue; // this font is already correct
      const next = new Map();
      for (const [c, t] of old) next.set(c, gt.get(c) || t);
      obj.set(N('ToUnicode'), ctx.register(ctx.flateStream(buildToUnicode(next))));
      fixed++;
    } catch (e) { /* skip this font */ }
  }
  if (!fixed) return { bytes, fixed: 0 };
  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes: out, fixed };
}
