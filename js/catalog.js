// The list of files the teacher published (files/index.json) + offline copies.
import { db } from './db.js';

let catalog = null;
const LS = 'catalog-cache';

export function getCatalog() { return catalog || { files: [] }; }
export function findFile(id) { return getCatalog().files.find((f) => f.id === id); }

export async function loadCatalog({ network = true } = {}) {
  if (!catalog) {
    try { const c = localStorage.getItem(LS); if (c) catalog = JSON.parse(c); } catch (e) {}
  }
  if (network) {
    try {
      const r = await fetch('files/index.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.files)) {
          j.files = j.files.filter((f) => !f.hidden); // hidden by the teacher
          catalog = j;
          try { localStorage.setItem(LS, JSON.stringify(j)); } catch (e) {}
        }
      }
    } catch (e) { /* offline — keep cached copy */ }
  }
  return getCatalog();
}

let downloadedSet = null;
export async function downloadedIds() {
  if (!downloadedSet) downloadedSet = new Set(await db.keys('pdfs'));
  return downloadedSet;
}
export function invalidateDownloads() { downloadedSet = null; }

// Returns the PDF bytes, from the device if saved, otherwise downloads and saves it.
export async function getPdfBytes(file, onProgress) {
  const saved = await db.get('pdfs', file.id);
  const revs = (() => { try { return JSON.parse(localStorage.getItem('pdf-rev') || '{}'); } catch (e) { return {}; } })();
  if (saved && (revs[file.id] || 0) === (file.rev || 0)) return saved;
  const res = await fetch(file.path + (file.rev ? '?v=' + file.rev : ''), { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = +res.headers.get('content-length') || file.size || 0;
  let buf;
  if (res.body && res.body.getReader && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onProgress(Math.min(1, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  await db.set('pdfs', file.id, buf);
  try { revs[file.id] = file.rev || 0; localStorage.setItem('pdf-rev', JSON.stringify(revs)); } catch (e) {}
  if (downloadedSet) downloadedSet.add(file.id);
  return buf;
}

export async function removeDownload(id) {
  await db.del('pdfs', id);
  if (downloadedSet) downloadedSet.delete(id);
}
