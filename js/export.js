// Export a copy of the PDF with the student's ink + notes burned in.
// The original page content stays vector (text remains selectable); annotations are
// added as a transparent image layer on top of each annotated page.
import { drawAll, paintNote } from './ink.js';

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

export async function exportAnnotated(bytes, annos, sizes) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const [k, data] of Object.entries(annos.pages)) {
    const n = +k;
    if (!data || (!data.s.length && !data.t.length) || !pages[n - 1]) continue;
    const sz = sizes[n - 1];
    const W = Math.round(Math.min(2400, sz.w * 2.5));
    const H = Math.round(W * sz.h / sz.w);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    drawAll(ctx, data.s, W);
    for (const t of data.t) paintNote(ctx, t, W);
    const png = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const img = await doc.embedPng(await png.arrayBuffer());
    const page = pages[n - 1];
    const { width, height } = page.getSize();
    page.drawImage(img, { x: 0, y: 0, width, height });
  }
  const out = await doc.save();
  return new Blob([out], { type: 'application/pdf' });
}
