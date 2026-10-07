// Saved and published gradients, in the Supabase `gradients` table (supabase/schema.sql). Two kinds of row:
//   saved     is_public = false  your private gradients, listed under "My gradients"; you can add and delete them.
//   published is_public = true   a snapshot you chose to share; shown to everyone in the Community tab, where the
//                                ones that are yours carry a Delete button. Publishing never touches your saved copy.
// Row-level security in the database is what enforces who can do what; this file only drives the UI.

import { serializeConfig, state } from './state.js';
import { cleanHandle } from './constants.js';
import { $, showToast } from './dom.js';
import { whenClient, onUser, startSignIn, configured } from './auth.js';
import { applyGradient, renderThumb, setCredit } from './loadGradient.js';
import { markSaved, clearSaved, markCopy, onProvenance } from './provenance.js';
import { toggleSideTab, onSideTabOpen, sideTabKind } from './sideTab.js';
import { masonry, relayout, thumbRatio } from './masonry.js';
import { askConfirm } from './confirm.js';

let client = null, me = null;
let current = null; // the saved gradient that's open on the canvas (so it can be deleted): { id }, or null
let busy = false;
// The community gradient on the canvas that the Share button would link to (see the Share section at the bottom).
const SHARE_KEY = 'meshGradientShareSlug.v1';
let shareSlug = (() => { try { return localStorage.getItem(SHARE_KEY); } catch { return null; } })();
let pristineCopy = false;
const DUPLICATE = '23505'; // Postgres unique violation: the gradient is identical to one already saved / published

// Anything that fails shows next to the button that was pressed. A missing table means schema.sql hasn't been run yet.
function fail(anchor, error) {
  console.error(error);
  showToast(anchor, error?.code === '42P01' || error?.code === 'PGRST205' ? 'Database not set up yet' : (error?.message || 'Something went wrong'));
}

// ---------- My gradients (private saves) ----------
// The sidebar grids work like this: the sidebar shows the first GRID_SLOTS saved gradients, and once there are that many the
// last tile carries "+N" for the rest and opens them all in the side tab.
const GRID_SLOTS = 8;
// Columns in the side tab's grids: the button in its header toggles 2 <-> 3, and the choice is remembered.
// an SVG cross rather than the × character, so it centers exactly in its square (a text glyph sits off-center)
const X_ICON = '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';
const COLS_KEY = 'meshGradientCols.v1', COL_CYCLE = [2, 3];
let COLS = (() => { try { const n = Number(localStorage.getItem(COLS_KEY)); return COL_CYCLE.includes(n) ? n : 3; } catch { return 3; } })();
const colsBtn = $('ctCols');
// The icon is always three bars: with 3 columns they sit side by side, with 2 the third has folded away into the
// right edge (zero width) and the other two are wider. Switching tweens the bars' x / width, so the two bars split into
// three (or the three merge into two). Done in JS rather than CSS because transitions on SVG geometry aren't reliable everywhere.
const barsFor = n => { // [x, width] per bar inside a 16-wide icon, 2px gaps
  const g = 2, w = (16 - g * (n - 1)) / n;
  return Array.from({ length: 3 }, (_, i) => (i < n ? [i * (w + g), w] : [16, 0]));
};
colsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' + [0, 1, 2].map(() => '<rect y="3" height="10" rx="1" fill="currentColor"/>').join('') + '</svg>';
const barEls = [...colsBtn.querySelectorAll('rect')];
let bars = barsFor(COLS), barTween = 0;
const setBars = b => barEls.forEach((el, i) => { el.setAttribute('x', b[i][0]); el.setAttribute('width', Math.max(0, b[i][1])); });
function paintCols(animate = false) {
  colsBtn.setAttribute('aria-label', `${COLS} gradients per row (click to change)`);
  const from = bars, to = barsFor(COLS);
  cancelAnimationFrame(barTween);
  if (!animate) { bars = to; setBars(bars); return; }
  const t0 = performance.now(), DUR = 200;
  const step = now => {
    const t = Math.min(1, (now - t0) / DUR), e = 1 - (1 - t) ** 3; // ease-out
    bars = from.map((f, i) => [f[0] + (to[i][0] - f[0]) * e, f[1] + (to[i][1] - f[1]) * e]);
    setBars(bars);
    if (t < 1) barTween = requestAnimationFrame(step); else { bars = to; setBars(bars); }
  };
  barTween = requestAnimationFrame(step);
}
colsBtn.addEventListener('click', () => {
  COLS = COL_CYCLE[(COL_CYCLE.indexOf(COLS) + 1) % COL_CYCLE.length];
  try { localStorage.setItem(COLS_KEY, String(COLS)); } catch {}
  paintCols(true);
  for (const id of ['pubMineList', 'pubList', 'mineTabList']) relayout($(id), COLS);
});
paintCols();
let mineRows = [];
function renderMine(rows) {
  mineRows = rows;
  const wrap = $('myList');
  wrap.innerHTML = '';
  rows.slice(0, GRID_SLOTS).forEach((row, i) => {
    const cell = document.createElement('div'); cell.className = 'preset-cell';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset';
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    cell.appendChild(b);
    if (i === GRID_SLOTS - 1) {
      b.classList.add('preset--more'); b.id = 'myMoreBtn'; b.setAttribute('aria-controls', 'communityTab'); b.setAttribute('aria-expanded', String(sideTabKind() === 'mine'));
      b.setAttribute('aria-label', `Show all ${rows.length} saved gradients`);
      const more = document.createElement('span'); more.className = 'preset-more'; more.textContent = `+${rows.length - GRID_SLOTS}`;
      b.appendChild(more);
      b.addEventListener('click', () => toggleSideTab('mine'));
    } else {
      b.setAttribute('aria-label', 'Open saved gradient');
      b.classList.toggle('current', current?.id === row.id);
      b.addEventListener('click', () => openMine(row, b));
      cell.appendChild(deleteButton(row)); // appears while the pointer is over the tile
    }
    wrap.appendChild(cell);
  });
  // the grid always shows GRID_SLOTS places: empty ones (an outline) wait for the gradients you'll save, and a new
  // account is just eight of them
  for (let i = rows.length; i < GRID_SLOTS; i++) {
    const empty = document.createElement('div'); empty.className = 'preset-empty'; empty.setAttribute('aria-hidden', 'true');
    wrap.appendChild(empty);
  }
  if (sideTabKind() === 'mine') renderMineTab();
}
// The side tab's pane: every saved gradient as masonry, each at its own shape.
let mineToken = 0;
async function renderMineTab() {
  const token = ++mineToken;
  const ratios = await Promise.all(mineRows.map(r => thumbRatio(r.thumb)));
  if (token !== mineToken) return;
  masonry($('mineTabList'), mineRows.map((row, i) => {
    const card = document.createElement('div'); card.className = 'ct-card';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ct-thumb';
    b.style.aspectRatio = `1 / ${ratios[i]}`;
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    b.setAttribute('aria-label', 'Open saved gradient');
    b.classList.toggle('current', current?.id === row.id);
    b.addEventListener('click', () => openMine(row, b));
    card.append(b, deleteButton(row));
    return { el: card, ratio: ratios[i] };
  }), COLS);
}
async function refreshMine() {
  if (!client || !me) return;
  const { data, error } = await client.from('gradients').select('id, thumb').eq('user_id', me.id).eq('is_public', false).order('updated_at', { ascending: false });
  if (error) { fail($('saveBtn'), error); return; }
  if (current && !data.some(r => r.id === current.id)) current = null; // deleted elsewhere
  renderMine(data);
}
// The hover-only Delete button on one of your saved gradients.
function deleteButton(row) {
  const del = document.createElement('button'); del.type = 'button'; del.className = 'ct-del'; del.innerHTML = X_ICON;
  del.setAttribute('aria-label', 'Delete this saved gradient');
  del.addEventListener('click', e => { e.stopPropagation(); deleteSaved(row, del); });
  return del;
}
async function deleteSaved(row, anchor) {
  if (row.pending) return;
  if (!await askConfirm({ title: 'Delete this saved gradient?', text: 'This can’t be undone.', confirmLabel: 'Delete', danger: true })) return;
  await guarded(anchor, async () => {
    const { error } = await client.from('gradients').delete().eq('id', row.id);
    if (error) throw error;
    if (current?.id === row.id) { current = null; clearSaved(); } // it was the one on the canvas: Save is available again
    await refreshMine();
  });
}
async function fetchConfig(id, anchor) {
  const { data, error } = await client.from('gradients').select('config').eq('id', id).single();
  if (error) { fail(anchor, error); return null; }
  return data;
}
async function openMine(row, anchor) {
  if (row.pending) return; // still being saved
  const data = await fetchConfig(row.id, anchor); if (!data) return;
  setShareSlug(null);
  applyGradient(data.config, { own: true });
  markSaved(); // it's already in the saved list, so Save hides until an edit
  current = { id: row.id };
  await refreshMine();
}

// ---------- Community (published) ----------
// The community list is every published gradient in the database (the original presets were seeded into it, owned by
// the site owner's account, so their credit follows that account's name and Twitter handle like any other). If the
// database can't be read, or has nothing published yet, the original presets (featured-gradients.json) stand in so the
// grid is never empty; they carry their own config and the credit FALLBACK_AUTHOR.
const FALLBACK_AUTHOR = 'eyezayuh';
// Until the database has answered (or failed, or 8 seconds have passed) the community grid and tab show skeleton
// placeholders instead of anything real, so the original-presets stand-ins never flash before the real list arrives.
let settled = !configured;
const SKELETON_RATIOS = [0.8, 1.25, 1, 1.4, 0.9, 1.1, 1.3, 0.85]; // heights / widths, so the tab's placeholders look like masonry
setTimeout(() => { if (!settled) { settled = true; rebuildPublic(); } }, 8000);
let pubRows = [], fallbackRows = [], loadProblem = '', loadedOnce = false;
function rebuildPublic() {
  $('communityEmpty').textContent = loadProblem ? `Couldn’t load the community list: ${loadProblem}` : 'No published gradients found in the database yet.';
  renderPublic(); renderCommunityGrid();
}
const baseRows = () => (pubRows.length ? pubRows : fallbackRows);
// the sort order applied to a list of rows
const arrange = rows => {
  if (sortMode !== 'liked') return rows;
  return rows.map((r, i) => [r, i]).sort((a, b) => likeCount(b[0]) - likeCount(a[0]) || a[1] - b[1]).map(x => x[0]); // stable: ties stay newest first
};
const shownRows = () => arrange(baseRows());

// ---------- Likes ----------
// Only signed-in users can like. A like belongs to your account (the database reads it from your session, so it can't be
// forged for someone else); everyone, signed in or not, sees the counts. The table is closed to direct access; three
// functions in schema.sql (like_counts, my_likes, set_like) are the only way in. If they aren't installed, likes stay hidden.
const SORT_KEY = 'meshGradientSort.v1';
let likeCounts = new Map(), myLikes = new Set(), likesOk = true;
let sortMode = (() => { try { return localStorage.getItem(SORT_KEY) === 'liked' ? 'liked' : 'newest'; } catch { return 'newest'; } })();
const likeCount = row => likeCounts.get(row.id) || 0;
const HEART = '<svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17.2 3.1 10.6C1.2 8.7 1.3 5.7 3.3 4.1c1.8-1.4 4.2-1 5.6.7L10 6.1l1.1-1.3c1.4-1.7 3.8-2.1 5.6-.7 2 1.6 2.1 4.6.2 6.5L10 17.2Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
function paintLike(btn, row) {
  const n = likeCount(row), liked = myLikes.has(row.id);
  btn.classList.toggle('liked', liked);
  btn.classList.toggle('has-likes', n > 0);
  btn.setAttribute('aria-pressed', String(liked));
  btn.setAttribute('aria-label', liked ? 'Unlike this gradient' : 'Like this gradient');
  btn.innerHTML = HEART + (n > 0 ? `<span>${n}</span>` : ''); // the number only shows once someone has liked it
}
function likeButton(row) {
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ct-like';
  paintLike(btn, row);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!me) return needSignIn(btn, 'like');
    toggleLike(row, btn);
  });
  return btn;
}
async function toggleLike(row, btn) {
  if (!client || !likesOk || !me) return;
  const want = !myLikes.has(row.id), prev = likeCount(row);
  if (want) myLikes.add(row.id); else myLikes.delete(row.id);
  likeCounts.set(row.id, Math.max(0, prev + (want ? 1 : -1)));
  likeUIChanged(); // the heart and count update at once, and under "Most liked" the card glides to its new place
  likeInflight++;
  const { error } = await client.rpc('set_like', { p_gradient: row.id, p_liked: want });
  likeInflight--;
  if (error) {
    console.error(error);
    if (want) myLikes.delete(row.id); else myLikes.add(row.id);
    likeCounts.set(row.id, prev);
    likeUIChanged();
    showToast(btn, 'Couldn’t save your like');
  }
}
// Repaints every heart from the current counts and, when sorted by most liked, moves the cards to their new order
// (animated, the same glide as changing the number of columns). The sidebar's tiles are re-ordered too.
function likeUIChanged() {
  const rank = new Map(arrange(baseRows()).map((r, i) => [r, i]));
  for (const id of ['pubMineList', 'pubList']) {
    const wrap = $(id), items = wrap._items;
    if (!items) continue;
    for (const it of items) { const b = it.row && it.el.querySelector('.ct-like'); if (b) paintLike(b, it.row); }
    if (sortMode === 'liked' && items.every(it => it.row)) {
      const sorted = [...items].sort((a, b) => rank.get(a.row) - rank.get(b.row));
      if (sorted.some((it, i) => it !== items[i])) masonry(wrap, sorted, COLS, { animate: true });
    }
  }
  if (sortMode === 'liked') renderCommunityGrid();
}
// Likes from other people arrive by polling: every few seconds while the page is visible (and not mid-like) the counts
// are re-read, and if anything changed the hearts and order update. Cheap: one small function call.
let likeInflight = 0;
const likeSig = () => JSON.stringify([[...likeCounts].sort(), [...myLikes].sort()]);
async function pollLikes() {
  if (document.hidden || !client || !likesOk || likeInflight || !settled) return;
  const before = likeSig();
  await loadLikes();
  if (!likeInflight && likeSig() !== before) likeUIChanged();
}
setInterval(pollLikes, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLikes(); });
// The bookmark next to the heart copies a community gradient into your saved ones (signed-out visitors get the sign-in popup).
const BOOKMARK = '<svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 3h9a1 1 0 0 1 1 1v13l-5.5-3.8L4.5 17V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
function bookmarkButton(row) {
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ct-bm'; btn.innerHTML = BOOKMARK;
  btn.setAttribute('aria-label', 'Save to my gradients');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!me) return needSignIn(btn, 'save');
    saveCommunity(row, btn);
  });
  return btn;
}
function saveCommunity(row, anchor) {
  return saveOptimistic(anchor, row.thumb || null, async () => {
    const data = row.builtin ? { config: row.config } : await fetchConfig(row.id, anchor);
    if (!data) return { error: new Error('Couldn’t read that gradient') };
    return client.from('gradients').insert({ config: data.config, thumb: row.thumb || null, user_id: me.id, author_name: authorName(), author_twitter: authorTwitter(), is_public: false }).select('id').single();
  }, false);
}
async function loadLikes() {
  if (!client) return;
  try { // likes are optional: whatever goes wrong here must never stop the gradients themselves from showing
    const [counts, mine] = await Promise.all([client.rpc('like_counts'), me ? client.rpc('my_likes') : { data: [] }]);
    if (counts.error || mine.error) { likesOk = false; console.warn('Likes unavailable:', (counts.error || mine.error).message); return; }
    likesOk = true;
    likeCounts = new Map(counts.data.map(r => [r.gradient_id, Number(r.n)]));
    myLikes = new Set(mine.data.map(r => r.gradient_id));
  } catch (err) { likesOk = false; console.warn('Likes unavailable:', err); }
}
const sortDd = $('ctSort'), sortBox = sortDd.querySelector('.ct-dd-box'), sortBtn = sortDd.querySelector('.ct-dd-btn');
const SORT_LABELS = { newest: 'Newest', liked: 'Most liked' };
const CLOSED_H = 24; // px: the closed box is just the current choice
function setSortOpen(open) { // the box grows downward to show every option, and folds back up when one is picked (100ms ease-out, in CSS)
  sortDd.classList.toggle('open', open);
  sortBtn.setAttribute('aria-expanded', String(open));
  sortBox.style.height = `${open ? sortBox.scrollHeight : CLOSED_H}px`;
}
function paintSort() {
  sortDd.querySelector('.ct-dd-label').textContent = SORT_LABELS[sortMode];
  for (const o of sortDd.querySelectorAll('[role=option]')) o.setAttribute('aria-selected', String(o.dataset.value === sortMode));
}
sortBtn.addEventListener('click', () => setSortOpen(!sortDd.classList.contains('open')));
for (const o of sortDd.querySelectorAll('[role=option]')) o.addEventListener('click', () => {
  sortMode = o.dataset.value === 'liked' ? 'liked' : 'newest';
  try { localStorage.setItem(SORT_KEY, sortMode); } catch {}
  paintSort(); setSortOpen(false); rebuildPublic();
});
document.addEventListener('pointerdown', e => { if (sortDd.classList.contains('open') && !sortDd.contains(e.target)) setSortOpen(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sortDd.classList.contains('open')) { e.stopPropagation(); setSortOpen(false); sortBtn.focus(); } }, true);
paintSort();
onSideTabOpen(kind => { setSortOpen(false); sortDd.hidden = kind !== 'community'; }); // the sort only applies to the Community tab
async function loadFallback() {
  try {
    const list = await (await fetch('featured-gradients.json', { cache: 'no-cache' })).json();
    fallbackRows = (Array.isArray(list) ? list : []).map((config, i) => {
      const { default: _flag, ...cfg } = config;
      return { id: `original-${i}`, builtin: true, config: cfg, author_name: FALLBACK_AUTHOR, thumb: renderThumb(cfg, 200, 'image/jpeg') };
    });
  } catch { fallbackRows = []; }
  rebuildPublic();
}
let renderToken = 0;
// The Community tab has up to two sections: what you've published (only when you have something), then everyone
// else's. A card is the thumbnail plus, on your own, an × button that appears while the pointer is over it.
async function renderPublic() {
  const token = ++renderToken;
  if (!settled) { // skeletons while loading
    $('pubMineSection').hidden = true; $('pubOthersTitle').hidden = true; $('pubEmpty').hidden = true; $('pubList').hidden = false;
    masonry($('pubList'), SKELETON_RATIOS.map(r => { const el = document.createElement('div'); el.className = 'ct-skel'; el.style.aspectRatio = `1 / ${r}`; el.setAttribute('aria-hidden', 'true'); return { el, ratio: r }; }), COLS);
    return;
  }
  const isMine = r => !!me && r.user_id === me.id;
  const all = baseRows();
  const rows = arrange(all); // the sort applies to both sections
  const ratios = await Promise.all(rows.map(r => thumbRatio(r.thumb)));
  if (token !== renderToken) return; // a newer render started while the thumbnails were measured
  const mineItems = [], otherItems = [];
  rows.forEach((row, i) => {
    const mine = isMine(row);
    const card = document.createElement('div'); card.className = 'ct-card';
    const thumb = document.createElement('button'); thumb.type = 'button'; thumb.className = 'ct-thumb';
    thumb.style.aspectRatio = `1 / ${ratios[i]}`; // the gradient's own shape
    if (row.thumb) thumb.style.backgroundImage = `url(${row.thumb})`;
    thumb.setAttribute('aria-label', 'Open this community gradient');
    thumb.addEventListener('click', () => openPublic(row, thumb));
    card.appendChild(thumb); // thumbnails only: no names, no authors (the author appears under the canvas once you open one)
    const actions = document.createElement('div'); actions.className = 'ct-actions'; // bottom-left: heart, then bookmark
    if (!row.builtin) actions.appendChild(likeButton(row));
    actions.appendChild(bookmarkButton(row));
    card.appendChild(actions);
    if (mine) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'ct-del'; del.innerHTML = X_ICON;
      del.setAttribute('aria-label', 'Remove this gradient from the community');
      del.addEventListener('click', () => deletePublished(row, del));
      card.appendChild(del);
    }
    (mine ? mineItems : otherItems).push({ el: card, ratio: ratios[i], row });
  });
  $('pubMineSection').hidden = mineItems.length === 0;
  $('pubOthersTitle').hidden = mineItems.length === 0; // headings only matter once there are two sections
  $('pubEmpty').hidden = otherItems.length > 0;
  masonry($('pubMineList'), mineItems, COLS);
  masonry($('pubList'), otherItems, COLS);
  $('pubList').hidden = otherItems.length === 0; // an empty grid would still add a gap above the message
}
// The sidebar's Community grid: the first GRID_SLOTS published gradients, the last tile carrying "+N" for the rest.
function renderCommunityGrid() {
  const wrap = $('communityGrid');
  wrap.innerHTML = '';
  if (!settled) { // skeleton squares while loading
    $('communityEmpty').hidden = true;
    for (let i = 0; i < GRID_SLOTS; i++) { const sk = document.createElement('div'); sk.className = 'preset preset-skel'; sk.setAttribute('aria-hidden', 'true'); wrap.appendChild(sk); }
    return;
  }
  const rows = shownRows();
  $('communityEmpty').hidden = !loadProblem && (pubRows.length > 0 || !loadedOnce); // also explains why the original gradients are standing in
  rows.slice(0, GRID_SLOTS).forEach((row, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset';
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    if (i === GRID_SLOTS - 1) {
      b.classList.add('preset--more'); b.id = 'communityMoreBtn'; b.setAttribute('aria-controls', 'communityTab'); b.setAttribute('aria-expanded', String(sideTabKind() === 'community'));
      b.setAttribute('aria-label', `Show all ${rows.length} community gradients`);
      const more = document.createElement('span'); more.className = 'preset-more'; more.textContent = `+${rows.length - GRID_SLOTS}`;
      b.appendChild(more);
      b.addEventListener('click', () => toggleSideTab('community'));
    } else {
      b.setAttribute('aria-label', 'Open this community gradient');
      b.addEventListener('click', () => openPublic(row, b));
    }
    wrap.appendChild(b);
  });
}
async function refreshPublic() {
  if (!client) return;
  const [{ data, error }] = await Promise.all([
    client.from('gradients').select('id, slug, thumb, author_name, author_twitter, user_id').eq('is_public', true).order('created_at', { ascending: false }).limit(200),
    loadLikes(),
  ]);
  settled = true;
  if (error) { console.error(error); loadProblem = error.message || 'unknown error'; rebuildPublic(); return; } // the fallback fills the grid
  loadProblem = ''; loadedOnce = true; pubRows = data;
  rebuildPublic();
  pushProfile(); // re-credit any of your rows that are out of date
}
async function openPublic(row, anchor) {
  const data = row.builtin ? { config: row.config } : await fetchConfig(row.id, anchor);
  if (!data) return;
  // a copy: the original stays as its author left it, and the canvas always credits whoever made it (even if that's you)
  setShareSlug(row.slug || null); // so the Share button can link to it (the original presets stand-ins have no slug)
  applyGradient(data.config, { credit: row.author_name, twitter: row.author_twitter });
  current = null; await refreshMine(); // clears the highlight on the saved list
}
async function deletePublished(row, anchor) {
  if (!await askConfirm({ title: 'Remove this gradient from the community?', text: 'Everyone will lose access to it, and any share links to it will stop working. This can’t be undone.', confirmLabel: 'Remove', danger: true })) return;
  await guarded(anchor, async () => {
    const { error } = await client.from('gradients').delete().eq('id', row.id);
    if (error) throw error;
    await refreshPublic();
  });
}

// The tab beside the sidebar (sideTab.js): opening it refreshes the list.
onSideTabOpen(kind => { if (kind === 'community') refreshPublic(); if (kind === 'mine') renderMineTab(); });

// ---------- Saving and publishing ----------
// Runs `task` with the buttons disabled, so a double click can't save twice.
async function guarded(anchor, task) {
  if (busy || !client || !me) return;
  busy = true;
  try { await task(); } catch (err) { fail(anchor, err); } finally { busy = false; }
}
const snapshotRow = () => {
  const config = serializeConfig({ stripIds: true });
  return { config, thumb: renderThumb(config, 200, 'image/jpeg') };
};
// What published gradients are credited to: the display name from Settings, else the Google profile name.
const authorTwitter = () => cleanHandle($('prefTwitter').value) || me.user_metadata?.twitter || null;
const authorName = () => $('prefName').value.trim() || me.user_metadata?.display_name || me.user_metadata?.full_name || me.user_metadata?.name || null;

// Saving feels instant: the new tile appears in the saved list (and Save greys out) the moment you press it, while the
// insert runs behind it. `insert()` resolves to the database's { data, error }. If the insert fails, the tile is taken
// back out; if it's a duplicate, the list is re-read so the existing copy shows. `onCanvas` is true for saving what's on
// the canvas (it then becomes the open saved gradient), false for saving a community gradient from its bookmark.
let pendingN = 0;
async function saveOptimistic(anchor, thumb, insert, onCanvas) {
  if (busy || !client || !me) return;
  busy = true;
  const temp = { id: `pending-${++pendingN}`, thumb, pending: true }, prevCurrent = current;
  mineRows = [temp, ...mineRows]; renderMine(mineRows);
  if (onCanvas) { current = { id: temp.id }; markSaved(); renderMine(mineRows); }
  showToast(anchor, 'Saved');
  const drop = () => { mineRows = mineRows.filter(r => r !== temp); };
  try {
    const { data, error } = await insert();
    if (error?.code === DUPLICATE) { // an identical gradient is already in your saved ones
      drop(); if (onCanvas) current = null;
      showToast(anchor, 'Already saved'); await refreshMine(); return;
    }
    if (error) throw error;
    temp.id = data.id; temp.pending = false; // the tile is real now
    if (onCanvas) current = { id: data.id };
    renderMine(mineRows);
    refreshMine(); // reconcile with the database in the background
  } catch (err) {
    drop(); if (onCanvas) { current = prevCurrent; clearSaved(); }
    renderMine(mineRows);
    fail(anchor, err);
  } finally { busy = false; }
}
function saveNew(anchor) {
  const snap = snapshotRow();
  return saveOptimistic(anchor, snap.thumb, () =>
    client.from('gradients').insert({ ...snap, user_id: me.id, author_name: authorName(), author_twitter: authorTwitter(), is_public: false }).select('id').single(), true);
}
// Signed-out visitors who press Save or Publish get a popup offering to sign in or create an account.
const setAuthModal = open => { $('authModal').hidden = !open; };
const needSignIn = (anchor, what) => {
  $('authModalTitle').textContent = `Sign in to ${what}`;
  $('authModalText').textContent = `You need to sign in or create an account to ${what} gradients${what === 'publish' ? ' to the community' : ''}.`;
  setAuthModal(true);
};
$('authModalCancel').addEventListener('click', () => setAuthModal(false));
for (const id of ['authModalSignIn', 'authModalSignUp']) $(id).addEventListener('click', () => { setAuthModal(false); startSignIn(); }); // Google creates the account on first use, so both start the same flow
$('authModal').addEventListener('pointerdown', e => { if (e.target === $('authModal')) setAuthModal(false); });
document.addEventListener('keydown', e => { if (!$('authModal').hidden && e.key === 'Escape') { e.stopPropagation(); setAuthModal(false); } }, true);

// The small button on the canvas: adds the current gradient to your saved ones.
$('saveBtn').addEventListener('click', e => {
  if (!me) return needSignIn(e.currentTarget, 'save');
  saveNew(e.currentTarget);
});

// After publishing: a confirmation that offers the share link.
const setPublishedModal = open => {
  $('publishedModal').hidden = !open;
  $('publishedShare').textContent = 'Copy share link';
  if (open) $('publishedShare').focus();
};
$('publishedDone').addEventListener('click', () => setPublishedModal(false));
$('publishedModal').addEventListener('pointerdown', e => { if (e.target === $('publishedModal')) setPublishedModal(false); });
document.addEventListener('keydown', e => { if (!$('publishedModal').hidden && e.key === 'Escape') { e.stopPropagation(); setPublishedModal(false); } }, true);
$('publishedShare').addEventListener('click', async () => {
  const url = `${location.origin}/?g=${shareSlug}`;
  try { await navigator.clipboard.writeText(url); $('publishedShare').textContent = 'Link copied'; }
  catch { askConfirm({ title: 'Copy this link', text: 'Your browser blocked copying automatically. Select the link below and copy it.', field: url, confirmLabel: 'Done', cancelLabel: null }); }
});

// Publish: always asks first.
// Only gradients no wider than 2:1 (width : height) can be published; taller ones and squares are fine.
const MAX_PUBLISH_RATIO = 2;
const tooWide = () => state.w / state.h > MAX_PUBLISH_RATIO;
const setPublishModal = open => {
  $('publishModal').hidden = !open;
  $('publishError').hidden = true;
  $('publishConfirm').disabled = false;
  if (open && tooWide()) { // explain instead of letting it fail
    $('publishError').textContent = `This gradient is ${(state.w / state.h).toFixed(1)}:1. Only gradients no wider than 2:1 can be published to the community. Make the canvas narrower or taller, then publish.`;
    $('publishError').hidden = false;
    $('publishConfirm').disabled = true;
  }
  if (open) (tooWide() ? $('publishCancel') : $('publishConfirm')).focus();
};
$('publishBtn').addEventListener('click', e => { if (!me) return needSignIn(e.currentTarget, 'publish'); setPublishModal(true); });
$('publishCancel').addEventListener('click', () => setPublishModal(false));
$('publishModal').addEventListener('pointerdown', e => { if (e.target === $('publishModal')) setPublishModal(false); });
document.addEventListener('keydown', e => { if (!$('publishModal').hidden && e.key === 'Escape') { e.stopPropagation(); setPublishModal(false); } }, true);
$('publishConfirm').addEventListener('click', async () => {
  const anchor = $('publishBtn');
  $('publishError').hidden = true;
  if (tooWide()) return setPublishModal(true);
  await guarded(anchor, async () => {
    const { data: inserted, error } = await client.from('gradients').insert({ ...snapshotRow(), user_id: me.id, author_name: authorName(), author_twitter: authorTwitter(), is_public: true }).select('slug').single();
    if (error?.code === DUPLICATE) { // unique violation: an identical gradient is already published
      $('publishError').textContent = 'This exact gradient is already in the community. Change something about it to make it unique, then publish.';
      $('publishError').hidden = false;
      return;
    }
    if (error) throw error;
    setPublishModal(false);
    // the canvas is now exactly a community gradient: credit it, hide Publish, and make it shareable
    setShareSlug(inserted.slug); setCredit(authorName(), authorTwitter()); markCopy();
    setPublishedModal(true);
    await refreshPublic();
  });
});

onUser(user => {
  const signedOut = !user && !!me; // a real sign-out, not the initial "nobody yet" call at startup
  me = user; current = null;
  syncShare(); // the Share button is only for signed-in users
  $('mySignedIn').hidden = !user; $('mySignedOut').hidden = !!user;
  if (!user) { $('myList').innerHTML = ''; myLikes = new Set(); if (signedOut) clearSaved(); }
  renderPublic(); // the Delete buttons depend on who is signed in
  if (user) { refreshMine(); refreshPublic(); } // refreshPublic also re-credits any of your rows that are out of date
});
whenClient.then(c => { client = c; refreshPublic(); if (me) refreshMine(); });
loadFallback(); // needs no account or database, so the grid fills straight away

// Your display name and Twitter handle (Settings) are what your published gradients are credited to, and they're kept
// on your account so they follow you to other devices. pushProfile() writes them to the rows: it runs when either
// changes, and also whenever your published rows are out of date (e.g. they were published before the handle existed,
// or from another device), since an unchanged Settings field fires no event. `lastPushed` stops a failed update looping.
let lastPushed = '';
// `explicit` means the user just edited a field, so an empty handle really means "remove it"; otherwise an empty
// Settings field (a fresh device, say) never wipes a handle already stored on the rows.
async function pushProfile(explicit = false) {
  if (!client || !me) return;
  const name = authorName(), twitter = cleanHandle($('prefTwitter').value) || null;
  if (!name) return;
  const combo = JSON.stringify([me.id, name, twitter]);
  const stale = pubRows.some(r => r.user_id === me.id && (r.author_name !== name || (twitter ? r.author_twitter !== twitter : explicit && r.author_twitter)));
  if (!stale || combo === lastPushed) return;
  lastPushed = combo;
  const fields = twitter || explicit ? { author_name: name, author_twitter: twitter } : { author_name: name };
  const { error } = await client.from('gradients').update(fields).eq('user_id', me.id);
  if (error) { console.error(error); return; }
  client.auth.updateUser({ data: twitter || explicit ? { display_name: name, twitter } : { display_name: name } }).catch(() => {});
  refreshPublic();
}
let profileTimer = 0;
for (const id of ['prefName', 'prefTwitter']) $(id).addEventListener('input', () => {
  clearTimeout(profileTimer);
  lastPushed = ''; // an edit is always worth pushing
  profileTimer = setTimeout(() => pushProfile(true), 700);
});

// ---------- Share links ----------
// Only gradients in the community can be shared: the link is /?g=<slug> of the published row, and sharing never saves
// anything. So the Share button (signed-in users only) shows while the canvas is an exact copy of a community gradient
// that has a slug (opened from the Community tab, opened from a share link, or just published), and hides on the first
// edit. gradient_by_slug (supabase/schema.sql) serves the link to anyone, but only for published rows.
function syncShare() {
  const canShare = !!(shareSlug && pristineCopy);
  $('shareSection').hidden = !(me && canShare);                    // the top bar icon: signed-in users
  $('shareFrameBtn').classList.toggle('is-hidden', !canShare);     // the "Share" button where Publish would be: anyone
}
function setShareSlug(slug) {
  shareSlug = slug || null;
  try { if (shareSlug) localStorage.setItem(SHARE_KEY, shareSlug); else localStorage.removeItem(SHARE_KEY); } catch {}
  syncShare();
}
onProvenance(pristine => { pristineCopy = pristine; syncShare(); });
async function copyShareLink(anchor) {
  const url = `${location.origin}/?g=${shareSlug}`;
  try { await navigator.clipboard.writeText(url); showToast(anchor, 'Link copied'); }
  catch { askConfirm({ title: 'Copy this link', text: 'Your browser blocked copying automatically. Select the link below and copy it.', field: url, confirmLabel: 'Done', cancelLabel: null }); }
}
for (const id of ['shareBtn', 'shareFrameBtn']) $(id).addEventListener('click', e => copyShareLink(e.currentTarget));

// Opens the gradient a share link points at (called once the app has booted). It lands as a copy, credited to its
// author, like one from the Community tab.
export async function openSharedFromUrl() {
  const slug = new URLSearchParams(location.search).get('g');
  if (slug === null) return; // not a share link
  const home = () => location.replace(`${location.origin}/`); // a broken link just lands on the app's home page
  if (!/^[A-Za-z0-9]{6,32}$/.test(slug)) return home();
  try {
    const c = client || await Promise.race([whenClient, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
    const { data, error } = await c.rpc('gradient_by_slug', { p_slug: slug });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) throw error || new Error('not found');
    setShareSlug(slug);
    applyGradient(row.config, { credit: row.author_name, twitter: row.author_twitter });
  } catch (err) {
    console.error(err);
    return home();
  }
  history.replaceState(null, '', location.pathname); // a reload keeps the gradient (it's saved locally) without re-fetching it
}
