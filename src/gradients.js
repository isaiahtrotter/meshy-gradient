// Saved and published gradients, in the Supabase `gradients` table (supabase/schema.sql). Two kinds of row:
//   saved     is_public = false  your private gradients, listed under "My gradients"; you can add and delete them.
//   published is_public = true   a snapshot you chose to share; shown to everyone in the Community tab, where the
//                                ones that are yours carry a Delete button. Publishing never touches your saved copy.
// Row-level security in the database is what enforces who can do what; this file only drives the UI.

import { serializeConfig } from './state.js';
import { cleanHandle } from './constants.js';
import { $, showToast } from './dom.js';
import { whenClient, onUser, startSignIn } from './auth.js';
import { applyGradient, renderThumb } from './loadGradient.js';
import { toggleSideTab, onSideTabOpen, sideTabKind } from './sideTab.js';
import { masonry, thumbRatio } from './masonry.js';

let client = null, me = null;
let current = null; // the saved gradient that's open on the canvas (so it can be deleted): { id }, or null
let busy = false;
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
  $('myEmpty').hidden = rows.length > 0;
  rows.slice(0, GRID_SLOTS).forEach((row, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset';
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
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
    }
    wrap.appendChild(b);
  });
  if (sideTabKind() === 'mine') renderMineTab();
}
// The side tab's pane: every saved gradient as masonry, each at its own shape.
let mineToken = 0;
async function renderMineTab() {
  const token = ++mineToken;
  const ratios = await Promise.all(mineRows.map(r => thumbRatio(r.thumb)));
  if (token !== mineToken) return;
  masonry($('mineTabList'), mineRows.map((row, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ct-thumb';
    b.style.aspectRatio = `1 / ${ratios[i]}`;
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    b.setAttribute('aria-label', 'Open saved gradient');
    b.classList.toggle('current', current?.id === row.id);
    b.addEventListener('click', () => openMine(row, b));
    return { el: b, ratio: ratios[i] };
  }), 4);
}
async function refreshMine() {
  if (!client || !me) return;
  const { data, error } = await client.from('gradients').select('id, thumb').eq('user_id', me.id).eq('is_public', false).order('updated_at', { ascending: false });
  if (error) { fail($('saveBtn'), error); return; }
  if (current && !data.some(r => r.id === current.id)) current = null; // deleted elsewhere
  renderMine(data);
  syncCurrent();
}
// The buttons that only make sense once a saved gradient is open.
function syncCurrent() {
  $('gCurrentRow').hidden = !current;
}
async function fetchConfig(id, anchor) {
  const { data, error } = await client.from('gradients').select('config').eq('id', id).single();
  if (error) { fail(anchor, error); return null; }
  return data;
}
async function openMine(row, anchor) {
  const data = await fetchConfig(row.id, anchor); if (!data) return;
  applyGradient(data.config, { own: true });
  current = { id: row.id };
  await refreshMine();
}

// ---------- Community (published) ----------
// The community list is the featured gradients that ship with the app (featured-gradients.json, the original presets,
// credited to FEATURED_AUTHOR) followed by everything published in the database.
const FEATURED_AUTHOR = 'eyezayuh'; // the name shown in "By …" under the canvas for a featured gradient
let builtinRows = [], dbRows = [];
let pubRows = [];
function rebuildPublic() {
  pubRows = [...builtinRows, ...dbRows];
  renderPublic(); renderCommunityGrid();
}
async function loadFeatured() {
  try {
    const list = await (await fetch('featured-gradients.json', { cache: 'no-cache' })).json();
    builtinRows = (Array.isArray(list) ? list : []).map((config, i) => {
      const { default: _flag, ...cfg } = config;
      return { id: `featured-${i}`, builtin: true, config: cfg, author_name: FEATURED_AUTHOR, thumb: renderThumb(cfg, 200, 'image/jpeg') };
    });
  } catch { builtinRows = []; }
  rebuildPublic();
}
let renderToken = 0;
async function renderPublic() {
  const token = ++renderToken;
  $('pubEmpty').hidden = pubRows.length > 0;
  const ratios = await Promise.all(pubRows.map(r => thumbRatio(r.thumb)));
  if (token !== renderToken) return; // a newer render started while the thumbnails were measured
  const items = pubRows.map((row, i) => {
    const mine = !!me && row.user_id === me.id;
    const card = document.createElement('div'); card.className = 'ct-card';
    const thumb = document.createElement('button'); thumb.type = 'button'; thumb.className = 'ct-thumb';
    thumb.style.aspectRatio = `1 / ${ratios[i]}`; // the gradient's own shape
    if (row.thumb) thumb.style.backgroundImage = `url(${row.thumb})`;
    thumb.setAttribute('aria-label', 'Open this community gradient');
    if (mine) { const tag = document.createElement('span'); tag.className = 'ct-yours'; tag.textContent = 'Yours'; thumb.appendChild(tag); }
    thumb.addEventListener('click', () => openPublic(row, thumb));
    card.appendChild(thumb); // thumbnails only: no names, no authors (the author appears under the canvas once you open one)
    if (mine) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'ct-del'; del.textContent = 'Delete';
      del.title = 'Remove this from the community';
      del.addEventListener('click', () => deletePublished(row, del));
      card.appendChild(del);
    }
    return { el: card, ratio: ratios[i] };
  });
  masonry($('pubList'), items, 4);
}
// The sidebar's Community grid: the first GRID_SLOTS published gradients, the last tile carrying "+N" for the rest.
function renderCommunityGrid() {
  const wrap = $('communityGrid');
  wrap.innerHTML = '';
  $('communityEmpty').hidden = pubRows.length > 0;
  pubRows.slice(0, GRID_SLOTS).forEach((row, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset';
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    if (i === GRID_SLOTS - 1) {
      b.id = 'communityMoreBtn'; b.setAttribute('aria-controls', 'communityTab'); b.setAttribute('aria-expanded', String(sideTabKind() === 'community'));
      b.setAttribute('aria-label', `Show all ${pubRows.length} community gradients`);
      const more = document.createElement('span'); more.className = 'preset-more'; more.textContent = `+${pubRows.length - GRID_SLOTS}`;
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
  const { data, error } = await client.from('gradients').select('id, thumb, author_name, author_twitter, user_id').eq('is_public', true).order('created_at', { ascending: false }).limit(200);
  if (error) { console.error(error); return; }
  dbRows = data; rebuildPublic();
  pushProfile(); // re-credit any of your rows that are out of date
}
async function openPublic(row, anchor) {
  const data = row.builtin ? { config: row.config } : await fetchConfig(row.id, anchor); // featured gradients carry their config
  if (!data) return;
  // a copy: the original stays as its author left it, and the canvas credits whoever made it
  applyGradient(data.config, { credit: !!me && row.user_id === me.id ? null : row.author_name, twitter: row.author_twitter });
  current = null; await refreshMine(); // clears the highlight on the saved list
}
async function deletePublished(row, anchor) {
  if (!confirm('Remove this gradient from the community? This can’t be undone.')) return;
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
  busy = true; syncCurrent();
  try { await task(); } catch (err) { fail(anchor, err); } finally { busy = false; syncCurrent(); }
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

$('gDelete').addEventListener('click', e => guarded(e.currentTarget, async () => {
  if (!current || !confirm('Delete this saved gradient? This can’t be undone.')) return;
  const { error } = await client.from('gradients').delete().eq('id', current.id);
  if (error) throw error;
  current = null;
  await refreshMine();
}));
// The small button on the canvas: adds the current gradient to your saved ones.
$('saveBtn').addEventListener('click', e => {
  if (!me) return needSignIn(e.currentTarget, 'save');
  saveNew(e.currentTarget);
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
    const { error } = await client.from('gradients').insert({ ...snapshotRow(), user_id: me.id, author_name: authorName(), author_twitter: authorTwitter(), is_public: true });
    if (error?.code === DUPLICATE) { // unique violation: an identical gradient is already published
      $('publishError').textContent = 'This exact gradient is already in the community. Change something about it to make it unique, then publish.';
      $('publishError').hidden = false;
      return;
    }
    if (error) throw error;
    setPublishModal(false);
    showToast(anchor, 'Published');
    await refreshPublic();
  });
});

onUser(user => {
  me = user; current = null;
  $('mySignedIn').hidden = !user; $('mySignedOut').hidden = !!user;
  if (!user) $('myList').innerHTML = '';
  syncCurrent(); renderPublic(); // the Delete buttons depend on who is signed in
  if (user) { refreshMine(); refreshPublic(); } // refreshPublic also re-credits any of your rows that are out of date
});
whenClient.then(c => { client = c; refreshPublic(); if (me) refreshMine(); });
loadFeatured(); // needs no account or database, so the Community grid fills straight away

// Your display name and Twitter handle (Settings) are what your published gradients are credited to, and they're kept
// on your account so they follow you to other devices. pushProfile() writes them to the rows: it runs when either
// changes, and also whenever your published rows are out of date (e.g. they were published before the handle existed,
// or from another device), since an unchanged Settings field fires no event. `lastPushed` stops a failed update looping.
let lastPushed = '';
async function pushProfile() {
  if (!client || !me) return;
  const name = authorName(), twitter = cleanHandle($('prefTwitter').value) || null;
  if (!name) return;
  const combo = JSON.stringify([me.id, name, twitter]);
  const stale = dbRows.some(r => r.user_id === me.id && (r.author_name !== name || (r.author_twitter || null) !== twitter));
  if (!stale || combo === lastPushed) return;
  lastPushed = combo;
  const { error } = await client.from('gradients').update({ author_name: name, author_twitter: twitter }).eq('user_id', me.id);
  if (error) { console.error(error); return; }
  client.auth.updateUser({ data: { display_name: name, twitter } }).catch(() => {});
  refreshPublic();
}
let profileTimer = 0;
for (const id of ['prefName', 'prefTwitter']) $(id).addEventListener('input', () => {
  clearTimeout(profileTimer);
  lastPushed = ''; // an edit is always worth pushing
  profileTimer = setTimeout(pushProfile, 700);
});
