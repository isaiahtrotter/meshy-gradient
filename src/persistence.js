// localStorage persistence of the gradient config. Reads are validated through applyConfig/normalizeNode so a
// stale or hand-edited entry can't put NaN into the renderer.

import { serializeConfig, applyConfig } from './state.js';

const STORAGE_KEY = 'meshGradientState.v1';
let saveTimer = null;

export function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeConfig())); } catch {}
}
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveState(); }, 300);
}
// a pending debounced save must not be lost to a tab close or reload
window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveState(); } });

// Returns true when a usable saved gradient was restored.
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || !Array.isArray(s.nodes) || !s.nodes.length) return false;
    applyConfig(s);
    return true;
  } catch { return false; }
}
