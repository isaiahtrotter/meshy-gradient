// Saved gradients, in the Supabase `gradients` table (supabase/schema.sql). Signed-in users can save, update and delete
// their own and mark them public; the Community list shows every public one to everyone, signed in or not. Row-level
// security in the database is what enforces who can do what; this file only drives the UI.

import { serializeConfig } from './state.js';
import { $, showToast } from './dom.js';
import { whenClient, onUser } from './auth.js';
import { applyPreset, renderPresetThumb } from './presets.js';

let client = null, me = null;
let current = null; // the saved gradient being edited: { id, isPublic }, or null for an unsaved one
let busy = false;

const listMine = () => client.from('gradients').select('id, name, thumb, is_public').eq('user_id', me.id).order('updated_at', { ascending: false });
const listPublic = () => client.from('gradients').select('id, name, thumb, author_name').eq('is_public', true).order('created_at', { ascending: false }).limit(60);

// Anything that fails shows next to the button that was pressed. A missing table means schema.sql hasn't been run yet.
function fail(anchor, error) {
  console.error(error);
  showToast(anchor, error?.code === '42P01' || error?.code === 'PGRST205' ? 'Database not set up yet' : (error?.message || 'Something went wrong'));
}

function renderList(wrap, empty, rows, { owner, onPick }) {
  wrap.innerHTML = '';
  empty.hidden = rows.length > 0;
  for (const row of rows) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'preset';
    if (row.thumb) b.style.backgroundImage = `url(${row.thumb})`;
    const label = owner ? row.name : row.author_name ? `${row.name} by ${row.author_name}` : row.name;
    b.title = label; b.setAttribute('aria-label', label);
    b.classList.toggle('is-public', owner && row.is_public);
    b.classList.toggle('current', owner && current?.id === row.id);
    b.addEventListener('click', () => onPick(row, b));
    wrap.appendChild(b);
  }
}

async function refreshMine() {
  if (!client || !me) return;
  const { data, error } = await listMine();
  if (error) { fail($('gSave'), error); return; }
  renderList($('myList'), $('myEmpty'), data, { owner: true, onPick: openMine });
  const row = data.find(r => r.id === current?.id);
  if (current && !row) current = null; // deleted elsewhere
  if (row) current.isPublic = row.is_public;
  syncCurrent();
}
async function refreshPublic() {
  if (!client) return;
  const { data, error } = await listPublic();
  if (error) { console.error(error); return; }
  renderList($('pubList'), $('pubEmpty'), data, { owner: false, onPick: openPublic });
}
const refreshAllLists = () => Promise.all([refreshMine(), refreshPublic()]);

// The buttons that only make sense once a saved gradient is open.
function syncCurrent() {
  $('gUpdate').disabled = !current || busy;
  $('gCurrentRow').hidden = !current;
  $('gPublic').textContent = current?.isPublic ? 'Make private' : 'Make public';
}

async function fetchConfig(id, anchor) {
  const { data, error } = await client.from('gradients').select('name, config, is_public').eq('id', id).single();
  if (error) { fail(anchor, error); return null; }
  return data;
}
async function openMine(row, anchor) {
  const data = await fetchConfig(row.id, anchor); if (!data) return;
  applyPreset(data.config);
  current = { id: row.id, isPublic: data.is_public };
  $('gName').value = data.name;
  await refreshMine();
}
async function openPublic(row, anchor) {
  const data = await fetchConfig(row.id, anchor); if (!data) return;
  applyPreset(data.config); // a copy: the original stays as its author left it
  current = null; syncCurrent();
  $('myList').querySelectorAll('.preset.current').forEach(el => el.classList.remove('current'));
}

// Runs `task` with the buttons disabled, so a double click can't save twice.
async function guarded(anchor, task) {
  if (busy || !client || !me) return;
  busy = true; syncCurrent();
  try { await task(); } catch (err) { fail(anchor, err); } finally { busy = false; syncCurrent(); }
}
const snapshotRow = () => {
  const config = serializeConfig({ stripIds: true });
  return { name: $('gName').value.trim() || 'Untitled', config, thumb: renderPresetThumb(config, 200, 'image/jpeg') };
};
const authorName = () => me.user_metadata?.full_name || me.user_metadata?.name || null;

$('gSave').addEventListener('click', e => guarded(e.currentTarget, async () => {
  const { data, error } = await client.from('gradients').insert({ ...snapshotRow(), user_id: me.id, author_name: authorName() }).select('id, is_public').single();
  if (error) throw error;
  current = { id: data.id, isPublic: data.is_public };
  showToast($('gSave'), 'Saved');
  await refreshAllLists();
}));
$('gUpdate').addEventListener('click', e => guarded(e.currentTarget, async () => {
  if (!current) return;
  const { error } = await client.from('gradients').update({ ...snapshotRow(), author_name: authorName(), updated_at: new Date().toISOString() }).eq('id', current.id);
  if (error) throw error;
  showToast($('gUpdate'), 'Updated');
  await refreshAllLists();
}));
$('gPublic').addEventListener('click', e => guarded(e.currentTarget, async () => {
  if (!current) return;
  const next = !current.isPublic;
  const { error } = await client.from('gradients').update({ is_public: next }).eq('id', current.id);
  if (error) throw error;
  current.isPublic = next;
  showToast($('gPublic'), next ? 'Now public' : 'Now private');
  await refreshAllLists();
}));
$('gDelete').addEventListener('click', e => guarded(e.currentTarget, async () => {
  if (!current || !confirm('Delete this saved gradient? This can’t be undone.')) return;
  const { error } = await client.from('gradients').delete().eq('id', current.id);
  if (error) throw error;
  current = null; $('gName').value = '';
  await refreshAllLists();
}));

onUser(user => {
  me = user; current = null;
  $('mySignedIn').hidden = !user; $('mySignedOut').hidden = !!user;
  if (!user) { $('myList').innerHTML = ''; $('gName').value = ''; }
  syncCurrent();
  if (user) refreshMine();
});
whenClient.then(c => { client = c; refreshPublic(); if (me) refreshMine(); });
