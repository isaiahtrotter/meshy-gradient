// Saved and published gradients, in the Supabase `gradients` table (supabase/schema.sql). Two kinds of row:
//   saved     is_public = false  your private gradients, listed under "My gradients"; you can add and delete them.
//   published is_public = true   a snapshot you chose to share; shown to everyone in the Community tab, where the
//                                ones that are yours carry a Delete button. Publishing never touches your saved copy.
// Row-level security in the database is what enforces who can do what; this file only drives the UI.

import { serializeConfig } from './state.js';
import { cleanHandle } from './constants.js';
import { $, showToast } from './dom.js';
import { whenClient, onUser, startSignIn } from './auth.js';
import { applyGradient, renderThumb, setCredit } from './loadGradient.js';
import { markSaved, clearSaved, markCopy, onProvenance } from './provenance.js';
import { toggleSideTab, onSideTabOpen, sideTabKind } from './sideTab.js';
import { masonry, thumbRatio } from './masonry.js';
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
      b.id = 'myMoreBtn'; b.setAttribute('aria-controls', 'communityTab'); b.setAttribute('aria-expanded', String(sideTabKind() === 'mine'));
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
  }), 4);
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
  const del = document.createElement('button'); del.type = 'button'; del.className = 'ct-del'; del.textContent = 'Delete';
  del.setAttribute('aria-label', 'Delete this saved gradient');
  del.addEventListener('click', e => { e.stopPropagation(); deleteSaved(row, del); });
  return del;
}
async function deleteSaved(row, anchor) {
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
let pubRows = [], fallbackRows = [], loadProblem = '', loadedOnce = false;
function rebuildPublic() {
  $('communityEmpty').textContent = loadProblem ? `Couldn’t load the community list: ${loadProblem}` : 'No published gradients found in the database yet.';
  renderPublic(); renderCommunityGrid();
}
const shownRows = () => (pubRows.length ? pubRows : fallbackRows);
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
// else's. A card is the thumbnail plus, on your own, a Delete button that appears while the pointer is over it.
async function renderPublic() {
  const token = ++renderToken;
  const rows = shownRows();
  const ratios = await Promise.all(rows.map(r => thumbRatio(r.thumb)));
  if (token !== renderToken) return; // a newer render started while the thumbnails were measured
  const mineItems = [], otherItems = [];
  rows.forEach((row, i) => {
    const mine = !!me && row.user_id === me.id;
    const card = document.createElement('div'); card.className = 'ct-card';
    const thumb = document.createElement('button'); thumb.type = 'button'; thumb.className = 'ct-thumb';
    thumb.style.aspectRatio = `1 / ${ratios[i]}`; // the gradient's own shape
    if (row.thumb) thumb.style.backgroundImage = `url(${row.thumb})`;
    thumb.setAttribute('aria-label', 'Open this community gradient');
    thumb.addEventListener('click', () => openPublic(row, thumb));
    card.appendChild(thumb); // thumbnails only: no names, no authors (the author appears under the canvas once you open one)
    if (mine) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'ct-del'; del.textContent = 'Delete';
      del.setAttribute('aria-label', 'Remove this gradient from the community');
      del.addEventListener('click', () => deletePublished(row, del));
      card.appendChild(del);
    }
    (mine ? mineItems : otherItems).push({ el: card, ratio: ratios[i] });
  });
  $('pubMineSection').hidden = mineItems.length === 0;
  $('pubOthersTitle').hidden = mineItems.length === 0; // headings only matter once there are two sections
  $('pubEmpty').hidden = rows.length > 0;
  masonry($('pubMineList'), mineItems, 4);
  masonry($('pubList'), otherItems, 4);
}
// The sidebar's Community grid: the first GRID_SLOTS published gradients, the last tile carrying "+N" for the rest.
function renderCommunityGrid() {
  const wrap = $('communityGrid');
  wrap.innerHTML = '';
  const rows = shownRows();
  $('communityEmpty').hidden = !loadProblem && (pubRows.length > 0 || !loadedOnce); // also explains why the original gradients are standing in
  rows.slice(0, GRID_SLOTS).forEach((row, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset';
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    if (i === GRID_SLOTS - 1) {
      b.id = 'communityMoreBtn'; b.setAttribute('aria-controls', 'communityTab'); b.setAttribute('aria-expanded', String(sideTabKind() === 'community'));
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
  const { data, error } = await client.from('gradients').select('id, slug, thumb, author_name, author_twitter, user_id').eq('is_public', true).order('created_at', { ascending: false }).limit(200);
  if (error) { console.error(error); loadProblem = error.message || 'unknown error'; rebuildPublic(); return; } // the fallback fills the grid
  loadProblem = ''; loadedOnce = true; pubRows = data; rebuildPublic();
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

async function saveNew(anchor) {
  await guarded(anchor, async () => {
    const { data, error } = await client.from('gradients').insert({ ...snapshotRow(), user_id: me.id, author_name: authorName(), author_twitter: authorTwitter(), is_public: false }).select('id').single();
    if (error?.code === DUPLICATE) { showToast(anchor, 'Already saved'); return; } // an identical gradient is already in your saved ones
    if (error) throw error;
    current = { id: data.id };
    markSaved();
    showToast(anchor, 'Saved');
    await refreshMine();
  });
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
const setPublishModal = open => {
  $('publishModal').hidden = !open;
  $('publishError').hidden = true;
  if (open) $('publishConfirm').focus();
};
$('publishBtn').addEventListener('click', e => { if (!me) return needSignIn(e.currentTarget, 'publish'); setPublishModal(true); });
$('publishCancel').addEventListener('click', () => setPublishModal(false));
$('publishModal').addEventListener('pointerdown', e => { if (e.target === $('publishModal')) setPublishModal(false); });
document.addEventListener('keydown', e => { if (!$('publishModal').hidden && e.key === 'Escape') { e.stopPropagation(); setPublishModal(false); } }, true);
$('publishConfirm').addEventListener('click', async () => {
  const anchor = $('publishBtn');
  $('publishError').hidden = true;
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
  if (!user) { $('myList').innerHTML = ''; if (signedOut) clearSaved(); }
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
function syncShare() { $('shareSection').hidden = !(me && shareSlug && pristineCopy); }
function setShareSlug(slug) {
  shareSlug = slug || null;
  try { if (shareSlug) localStorage.setItem(SHARE_KEY, shareSlug); else localStorage.removeItem(SHARE_KEY); } catch {}
  syncShare();
}
onProvenance(pristine => { pristineCopy = pristine; syncShare(); });
$('shareBtn').addEventListener('click', async e => {
  const url = `${location.origin}/?g=${shareSlug}`;
  const anchor = e.currentTarget;
  try { await navigator.clipboard.writeText(url); showToast(anchor, 'Link copied'); }
  catch { askConfirm({ title: 'Copy this link', text: 'Your browser blocked copying automatically. Select the link below and copy it.', field: url, confirmLabel: 'Done', cancelLabel: null }); }
});

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
