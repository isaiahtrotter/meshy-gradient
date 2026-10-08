// Lazy, cached thumbnails for the community lists. The list itself carries no images (a row's thumbnail is ~6 kB and
// would be downloaded again on every visit); tiles register here and an IntersectionObserver fetches a thumbnail only
// when its tile is about to be seen. A published gradient's thumbnail never changes, so each one is kept by id in memory
// and in IndexedDB, and a returning visitor downloads only the gradients that are new since last time.

const DB = 'meshyThumbs', STORE = 'thumbs', BATCH = 24;
const mem = new Map();      // id -> data URL
const waiting = new Map();  // id -> Set of callbacks wanting it
let queue = new Set(), timer = 0, fetcher = null;
const pending = new Set(); // ids already queued or being fetched, so a re-render doesn't ask for them twice

let dbp = null;
const db = () => dbp || (dbp = new Promise(res => {
  try {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = req.onblocked = () => res(null);
  } catch { res(null); }
}));
const idb = async (mode, fn) => {
  const d = await db(); if (!d) return null;
  return new Promise(res => {
    try { const tx = d.transaction(STORE, mode); const out = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(out?.result ?? out ?? null); tx.onerror = tx.onabort = () => res(null); }
    catch { res(null); }
  });
};
const idbGet = id => new Promise(async res => {
  const d = await db(); if (!d) return res(null);
  try { const r = d.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); } catch { res(null); }
});
const idbPut = entries => idb('readwrite', s => { for (const [id, url] of entries) s.put(url, id); });

// Where the thumbnails come from: async ids => [{ id, thumb }]. Set once the database client exists.
export const setThumbFetcher = fn => { fetcher = fn; };
export const cachedThumb = id => mem.get(id) || null;

// Drops cached thumbnails for gradients that no longer exist (deleted by their owner). Call with the full set of live ids.
export async function pruneThumbs(liveIds) {
  const live = new Set(liveIds);
  for (const id of [...mem.keys()]) if (!live.has(id)) mem.delete(id);
  const d = await db(); if (!d) return;
  try {
    const tx = d.transaction(STORE, 'readwrite'), s = tx.objectStore(STORE);
    s.openKeyCursor().onsuccess = e => { const c = e.target.result; if (c) { if (!live.has(c.key)) s.delete(c.key); c.continue(); } };
  } catch {}
}

function deliver(id, url) {
  mem.set(id, url);
  for (const cb of waiting.get(id) || []) cb(url);
  waiting.delete(id);
}

async function flush() {
  timer = 0;
  const ids = [...queue]; queue = new Set();
  const need = [];
  for (const id of ids) { // persistent cache first
    const hit = mem.get(id) || await idbGet(id);
    if (hit) { pending.delete(id); deliver(id, hit); } else need.push(id);
  }
  for (let i = 0; i < need.length; i += BATCH) {
    const chunk = need.slice(i, i + BATCH);
    let rows = [];
    try { rows = fetcher ? await fetcher(chunk) : []; } catch (e) { console.error(e); }
    const fresh = [];
    for (const r of rows || []) if (r?.thumb) { deliver(r.id, r.thumb); fresh.push([r.id, r.thumb]); }
    if (fresh.length) idbPut(fresh);
    for (const id of chunk) { pending.delete(id); if (!mem.has(id)) waiting.delete(id); } // unavailable (deleted, or no thumbnail): leave the tile as is
  }
}
const want = (id, cb) => {
  if (mem.has(id)) return cb(mem.get(id));
  if (!waiting.has(id)) waiting.set(id, new Set());
  waiting.get(id).add(cb);
  if (pending.has(id)) return; // already on its way: the callback above will be called when it lands
  pending.add(id); queue.add(id);
  if (!timer) timer = setTimeout(flush, 40); // gathers the tiles that appear together into one request
};

const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    const { thumbId, thumbCb } = e.target._thumb || {};
    if (thumbId) want(thumbId, thumbCb);
  }
}, { rootMargin: '300px' }) : null;

// Paints `el`'s background with the row's thumbnail: straight away if it's already here (a stand-in preset's own image,
// or one cached), otherwise once the tile is about to scroll into view. Tiles in a hidden tab never intersect, so
// nothing is fetched for a tab nobody has opened.
export function paintThumb(el, row) {
  const set = url => { el.style.backgroundImage = `url(${url})`; };
  if (row.thumb) return set(row.thumb);
  if (!row.id || row.builtin) return;
  const hit = mem.get(row.id);
  if (hit) return set(hit);
  const cb = url => { row.thumb = url; set(url); };
  if (!io) return want(row.id, cb);
  el._thumb = { thumbId: row.id, thumbCb: cb };
  io.observe(el);
}
