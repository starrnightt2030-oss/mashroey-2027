// PDF.js setup. The original PDF is drawn exactly as uploaded (its own embedded fonts),
// so Arabic text, diacritics and layout are never altered.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const OPTS = {
  cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
  isEvalSupported: false
};

export function openPdf(bytes) {
  // copy: pdf.js transfers the buffer to its worker
  return pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), ...OPTS }).promise;
}

// Clean text extracted from a page for read-aloud.
// Many Arabic PDFs store letters one by one in visual (left-to-right) order, so we rebuild
// lines from the glyph positions: group by baseline, order right-to-left, join by gaps.
const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LTR = /^[A-Za-z0-9٠-٩.,%+\-=/×÷()[\]Ωπ°]+$/;
export async function pageText(page) {
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue;
    const t = it.transform;
    const h = Math.abs(t[3]) || Math.hypot(t[2], t[3]) || it.height || 10;
    items.push({ s: it.str, x: t[4], y: t[5], w: it.width || 0, h });
  }
  if (!items.length) return '';
  items.sort((a, b) => b.y - a.y);
  const lines = [];
  for (const it of items) {
    const ln = lines.find((l) => Math.abs(l.y - it.y) < Math.min(l.h, it.h) * 0.5);
    if (ln) ln.items.push(it); else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  const outLines = [];
  for (const ln of lines) {
    const rtl = ln.items.some((i) => AR.test(i.s));
    const its = ln.items.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    // build pieces with spaces from gaps
    const pieces = [];
    let prev = null;
    for (const it of its) {
      if (prev) {
        const gap = rtl ? prev.x - (it.x + it.w) : it.x - (prev.x + prev.w);
        if (gap > it.h * 0.18) pieces.push({ s: ' ', sp: true });
      }
      pieces.push({ s: it.s });
      prev = it;
    }
    // in RTL lines, runs of LTR glyphs (numbers, Latin) were reversed — put them back
    if (rtl) {
      for (let i = 0; i < pieces.length;) {
        if (!pieces[i].sp && LTR.test(pieces[i].s.trim()) && pieces[i].s.trim()) {
          let j = i;
          while (j + 1 < pieces.length && !pieces[j + 1].sp && LTR.test(pieces[j + 1].s.trim()) && pieces[j + 1].s.trim()) j++;
          const run = pieces.slice(i, j + 1).reverse();
          pieces.splice(i, run.length, ...run);
          i = j + 1;
        } else i++;
      }
    }
    outLines.push(pieces.map((p) => p.s).join(''));
  }
  return outLines.join('\n')
    .normalize('NFKC')              // Arabic presentation forms → normal letters
    .replace(/ـ/g, '')         // tatweel
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export { pdfjsLib };
