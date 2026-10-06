// Whether the canvas still holds an untouched copy of a community gradient (or the starting gradient). While it does, the Publish
// button stays hidden (there's nothing of yours to publish); the first edit brings it back, and undoing back to the
// copy hides it again. The copy is remembered as a hash of its serialized config, kept in localStorage so a reload
// doesn't forget it.

import { serializeConfig } from './state.js';
import { $ } from './dom.js';
import { onSave } from './persistence.js';

const KEY = 'meshGradientCopyHash.v1';

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

// instant: skip the fade, for the first call on page load.
function update(instant = false) {
  const btn = $('publishBtn');
  const pristine = copyHash !== null && currentHash() === copyHash;
  if (instant) btn.classList.add('no-anim');
  btn.classList.toggle('is-hidden', pristine);
  if (instant) { void btn.offsetWidth; btn.classList.remove('no-anim'); }
}

// Call right after loading a gradient that isn't the user's own (a community one).
export function markCopy({ instant = false } = {}) {
  copyHash = currentHash();
  try { localStorage.setItem(KEY, copyHash); } catch {}
  update(instant);
}
// Call after loading anything the user owns: Publish is available straight away.
export function markOwn() {
  copyHash = null;
  try { localStorage.removeItem(KEY); } catch {}
  update();
}

// Edits are noticed through the save hook, which every visible change goes through; at most once per frame.
let frame = 0;
onSave(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); });
update(true);
