// Tiny IndexedDB wrapper — everything the student creates lives on their device.
const DB_NAME = 'mashroey';
const VERSION = 1;
export const STORES = ['pdfs', 'annos', 'meta', 'notes'];

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  set: (store, key, val) => run(store, 'readwrite', (s) => s.put(val, key)),
  del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),
  async entries(store) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const out = [];
      const t = d.transaction(store, 'readonly');
      const c = t.objectStore(store).openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (cur) { out.push([cur.key, cur.value]); cur.continue(); }
      };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }
};

// Ask the browser to keep our data (not evict it under storage pressure).
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}

// Per-file helpers with sensible defaults
export async function getMeta(id) {
  return (await db.get('meta', id)) || { lastPage: 1, bookmarks: [], done: false, opened: 0, zoom: 1 };
}
export async function setMeta(id, patch) {
  const m = await getMeta(id);
  const next = Object.assign(m, patch);
  await db.set('meta', id, next);
  return next;
}
export async function getAnnos(id) {
  return (await db.get('annos', id)) || { pages: {} };
}
export async function getNotes(id) {
  return (await db.get('notes', id)) || { texts: [], hand: { strokes: [] }, questions: [] };
}
