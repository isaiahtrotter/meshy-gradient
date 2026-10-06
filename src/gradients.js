// Saved and published gradients, in the Supabase `gradients` table (supabase/schema.sql). Two kinds of row:
//   saved     is_public = false  your private gradients, listed under "My gradients"; save / update / delete.
//   published is_public = true   a snapshot you chose to share; shown to everyone in the Community tab, where the
//                                ones that are yours carry a Delete button. Publishing never touches your saved copy.
// Row-level security in the database is what enforces who can do what; this file only drives the UI.

import { serializeConfig } from './state.js';
import { $, showToast } from './dom.js';
import { whenClient, onUser } from './auth.js';
import { applyPreset, renderPresetThumb } from './presets.js';
import { toggleSideTab, onSideTabOpen } from './sideTab.js';

let client = null, me = null;
let current = null; // the saved gradient being edited: { id }, or null for an unsaved one
let busy = false;

// Anything that fails shows next to the button that was pressed. A missing table means schema.sql hasn't been run yet.
function fail(anchor, error) {
  console.error(error);
  showToast(anchor, error?.code === '42P01' || error?.code === 'PGRST205' ? 'Database not set up yet' : (error?.message || 'Something went wrong'));
}

// ---------- My gradients (private saves) ----------
function renderMine(rows) {
  const wrap = $('myList');
  wrap.innerHTML = '';
  $('myEmpty').hidden = rows.length > 0;
  for (const row of rows) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset';
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    b.title = row.name; b.setAttribute('aria-label', row.name);
    b.classList.toggle('current', current?.id === row.id);
    b.addEventListener('click', () => openMine(row, b));
    wrap.appendChild(b);
  }
}
async function refreshMine() {
  if (!client || !me) return;
  const { data, error } = await client.from('gradients').select('id, name, thumb').eq('user_id', me.id).eq('is_public', false).order('updated_at', { ascending: false });
  if (error) { fail($('gSave'), error); return; }
  if (current && !data.some(r => r.id === current.id)) current = null; // deleted elsewhere
  renderMine(data);
  syncCurrent();
}
// The buttons that only make sense once a saved gradient is open.
function syncCurrent() {
  $('gUpdate').disabled = !current || busy;
  $('gCurrentRow').hidden = !current;
}
async function fetchConfig(id, anchor) {
  const { data, error } = await client.from('gradients').select('name, config').eq('id', id).single();
  if (error) { fail(anchor, error); return null; }
  return data;
}
async function openMine(row, anchor) {
  const data = await fetchConfig(row.id, anchor); if (!data) return;
  applyPreset(data.config);
  current = { id: row.id };
  $('gName').value = data.name;
  await refreshMine();
}

// ---------- Community (published) ----------
let pubRows = [];
function renderPublic() {
  const wrap = $('pubList');
  wrap.innerHTML = '';
  $('pubEmpty').hidden = pubRows.length > 0;
  for (const row of pubRows) {
    const mine = !!me && row.user_id === me.id;
    const card = document.createElement('div'); card.className = 'ct-card';
    const thumb = document.createElement('button'); thumb.type = 'button'; thumb.className = 'ct-thumb';
    if (row.thumb) thumb.style.backgroundImage = `url(${row.thumb})`;
    thumb.setAttribute('aria-label', `Open ${row.name}`);
    thumb.title = 'Open a copy in the editor';
    if (mine) { const tag = document.createElement('span'); tag.className = 'ct-yours'; tag.textContent = 'Yours'; thumb.appendChild(tag); }
    thumb.addEventListener('click', () => openPublic(row, thumb));
    const meta = document.createElement('div'); meta.className = 'ct-meta';
    const name = document.createElement('div'); name.className = 'ct-name'; name.textContent = row.name; name.title = row.name;
    meta.appendChild(name);
    if (mine) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'ct-del'; del.textContent = 'Delete';
      del.title = 'Remove this from the community';
      del.addEventListener('click', () => deletePublished(row, del));
      meta.appendChild(del);
    }
    card.append(thumb, meta);
    if (row.author_name && !mine) { const by = document.createElement('div'); by.className = 'ct-by'; by.textContent = `by ${row.author_name}`; card.appendChild(by); }
    wrap.appendChild(card);
  }
}
function renderCount() {
  const n = pubRows.length;
  $('communityBtn').textContent = `${n} Community Gradient${n === 1 ? '' : 's'}`;
}
async function refreshPublic() {
  if (!client) return;
  const { data, error } = await client.from('gradients').select('id, name, thumb, author_name, user_id').eq('is_public', true).order('created_at', { ascending: false }).limit(200);
  if (error) { console.error(error); return; }
  pubRows = data; renderPublic(); renderCount();
}
async function openPublic(row, anchor) {
  const data = await fetchConfig(row.id, anchor); if (!data) return;
  applyPreset(data.config); // a copy: the original stays as its author left it
  current = null; await refreshMine(); // clears the highlight on the saved list
}
async function deletePublished(row, anchor) {
  if (!confirm(`Remove “${row.name}” from the community? This can’t be undone.`)) return;
  await guarded(anchor, async () => {
    const { error } = await client.from('gradients').delete().eq('id', row.id);
    if (error) throw error;
    await refreshPublic();
  });
}

// The tab beside the sidebar (sideTab.js): opening it refreshes the list.
$('communityBtn').addEventListener('click', () => toggleSideTab('community'));
onSideTabOpen(kind => { if (kind === 'community') refreshPublic(); });

// ---------- Saving and publishing ----------
// Runs `task` with the buttons disabled, so a double click can't save twice.
async function guarded(anchor, task) {
  if (busy || !client || !me) return;
  busy = true; syncCurrent();
  try { await task(); } catch (err) { fail(anchor, err); } finally { busy = false; syncCurrent(); }
}
const snapshotRow = name => {
  const config = serializeConfig({ stripIds: true });
  return { name: (name || '').trim() || 'Untitled', config, thumb: renderPresetThumb(config, 200, 'image/jpeg') };
};
const authorName = () => me.user_metadata?.full_name || me.user_metadata?.name || null;

async function saveNew(anchor) {
  await guarded(anchor, async () => {
    const { data, error } = await client.from('gradients').insert({ ...snapshotRow($('gName').value), user_id: me.id, author_name: authorName(), is_public: false }).select('id').single();
    if (error) throw error;
    current = { id: data.id };
    showToast(anchor, 'Saved');
    await refreshMine();
  });
}
async function updateCurrent(anchor) {
  if (!current) return;
  await guarded(anchor, async () => {
    const { error } = await client.from('gradients').update({ ...snapshotRow($('gName').value), author_name: authorName(), updated_at: new Date().toISOString() }).eq('id', current.id);
    if (error) throw error;
    showToast(anchor, 'Updated');
    await refreshMine();
  });
}
const needSignIn = (anchor, what) => { showToast(anchor, `Sign in to ${what}`); };

$('gSave').addEventListener('click', e => saveNew(e.currentTarget));
$('gUpdate').addEventListener('click', e => updateCurrent(e.currentTarget));
$('gDelete').addEventListener('click', e => guarded(e.currentTarget, async () => {
  if (!current || !confirm('Delete this saved gradient? This can’t be undone.')) return;
  const { error } = await client.from('gradients').delete().eq('id', current.id);
  if (error) throw error;
  current = null; $('gName').value = '';
  await refreshMine();
}));
// The small button on the canvas: updates the open saved gradient, or saves a new one.
$('saveBtn').addEventListener('click', e => {
  if (!me) return needSignIn(e.currentTarget, 'save');
  current ? updateCurrent(e.currentTarget) : saveNew(e.currentTarget);
});

// Publish: always asks first.
const setPublishModal = open => {
  $('publishModal').hidden = !open;
  if (open) { $('pubName').value = $('gName').value.trim(); $('pubName').focus(); }
};
$('publishBtn').addEventListener('click', e => { if (!me) return needSignIn(e.currentTarget, 'publish'); setPublishModal(true); });
$('publishCancel').addEventListener('click', () => setPublishModal(false));
$('publishModal').addEventListener('pointerdown', e => { if (e.target === $('publishModal')) setPublishModal(false); });
document.addEventListener('keydown', e => { if (!$('publishModal').hidden && e.key === 'Escape') { e.stopPropagation(); setPublishModal(false); } }, true);
$('pubName').addEventListener('keydown', e => { if (e.key === 'Enter') $('publishConfirm').click(); });
$('publishConfirm').addEventListener('click', async e => {
  const anchor = $('publishBtn');
  await guarded(anchor, async () => {
    const { error } = await client.from('gradients').insert({ ...snapshotRow($('pubName').value), user_id: me.id, author_name: authorName(), is_public: true });
    if (error) throw error;
    setPublishModal(false);
    showToast(anchor, 'Published');
    await refreshPublic();
  });
  setPublishModal(false);
});

onUser(user => {
  me = user; current = null;
  $('mySignedIn').hidden = !user; $('mySignedOut').hidden = !!user;
  if (!user) { $('myList').innerHTML = ''; $('gName').value = ''; }
  syncCurrent(); renderPublic(); // the Delete buttons depend on who is signed in
  if (user) refreshMine();
});
whenClient.then(c => { client = c; refreshPublic(); if (me) refreshMine(); });
