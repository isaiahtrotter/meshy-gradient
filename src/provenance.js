// Whether the canvas still holds an untouched copy of a community gradient (or the starting gradient). While it does, the Publish
// button and the "By [name]" byline under the canvas stay as they are for a copy (Publish hidden, byline shown), because an exact copy of something already out there isn't yours to publish; the first edit brings it back, and undoing back to the
// copy hides it again. The copy is remembered as a hash of its serialized config, kept in localStorage so a reload
// doesn't forget it.

import { serializeConfig } from './state.js';
import { $ } from './dom.js';
import { onSave } from './persistence.js';

const KEY = 'meshGradientCopyHash.v1', SAVED_KEY = 'meshGradientSavedHash.v1';

// cyrb53: a small, fast string hash; collisions are a non-issue here.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
}
const currentHash = () => hash(JSON.stringify(serializeConfig({ stripIds: true })));
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

let copyHash = stored();
// The same idea for the Save button: while the canvas is exactly a gradient that's already in the user's saved list
// (just opened from there, or just saved), there's nothing to save, so the button hides until the first edit.
let savedHash = (() => { try { return localStorage.getItem(SAVED_KEY); } catch { return null; } })();

const listeners = new Set();
// cb(pristine) runs on every update: pristine is true while the canvas is an exact copy of a community gradient.
export const onProvenance = cb => { listeners.add(cb); };

// instant: skip the fade, for the first call on page load.
function update(instant = false) {
  const btn = $('publishBtn');
  const pristine = copyHash !== null && currentHash() === copyHash;
  if (instant) btn.classList.add('no-anim');
  btn.classList.toggle('is-hidden', pristine);
  // the "By [name]" line only belongs to an exact copy: the first edit removes it, and undoing back to the copy restores it
  const credit = $('frameCredit');
  credit.hidden = !(pristine && credit.firstChild);
  for (const cb of listeners) cb(pristine);
  const save = $('saveBtn');
  if (instant) save.classList.add('no-anim');
  save.classList.toggle('is-hidden', savedHash !== null && currentHash() === savedHash);
  if (instant) { void btn.offsetWidth; btn.classList.remove('no-anim'); save.classList.remove('no-anim'); }
}

// Re-evaluates the Publish button and the byline, e.g. after the byline text changes.
export const refreshProvenance = (instant = false) => update(instant);

// Call right after loading a gradient that isn't the user's own (a community one).
export function markCopy({ instant = false } = {}) {
  copyHash = currentHash();
  savedHash = null; try { localStorage.setItem(KEY, copyHash); localStorage.removeItem(SAVED_KEY); } catch {}
  update(instant);
}
// Call after loading anything the user owns: Publish is available straight away.
export function markOwn() {
  copyHash = null; savedHash = null;
  try { localStorage.removeItem(KEY); localStorage.removeItem(SAVED_KEY); } catch {}
  update();
}
// The canvas is now exactly a gradient in the user's saved list (opened from it, or just saved): hide Save until an edit.
export function markSaved() {
  savedHash = currentHash();
  try { localStorage.setItem(SAVED_KEY, savedHash); } catch {}
  update();
}
// The saved gradient is gone (deleted, or signed out): Save is available again.
export function clearSaved() {
  savedHash = null;
  try { localStorage.removeItem(SAVED_KEY); } catch {}
  update();
}

// Edits are noticed through the save hook, which every visible change goes through; at most once per frame.
let frame = 0;
onSave(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); });
update(true);
