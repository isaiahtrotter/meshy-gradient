// Presets are full gradient configs in presets.json. "Copy gradient" puts the current config on the clipboard in
// the same shape so it can be pasted straight into that file.

import { isNum } from './constants.js';
import { state, applyConfig, serializeConfig } from './state.js';
import { pushUndo } from './undo.js';
import { $, setStatus, showToast } from './dom.js';
import { rgbaCss } from './color.js';
import { layout } from './view.js';
import { refreshAll } from './refresh.js';
import { scheduleSave } from './persistence.js';
import { syncControlsFromState } from './controls.js';

const presetPreviewBg = nodes => nodes
  .map(n => `radial-gradient(circle at ${(n.x * 100).toFixed(1)}% ${(n.y * 100).toFixed(1)}%, ${rgbaCss(n.color, n.a ?? 1)} 0%, transparent 65%)`)
  .join(', ');

function applyPreset(p) {
  pushUndo();
  if (!isNum(p.seed)) state.seed = Math.random() * 1000;
  applyConfig(p, { reassignIds: true });
  state.selected.clear();
  syncControlsFromState({ animate: true });
  layout(); refreshAll(); scheduleSave();
  setStatus('Applied preset.');
}
function renderPresets(presets) {
  const wrap = $('presets');
  wrap.innerHTML = '';
  $('presetsEmpty').hidden = presets.length > 0;
  presets.forEach((p, i) => {
    const b = document.createElement('button'); b.className = 'preset'; b.type = 'button';
    b.setAttribute('aria-label', `Apply preset ${i + 1}`);
    b.style.background = presetPreviewBg(p.nodes);
    b.addEventListener('click', () => applyPreset(p));
    wrap.appendChild(b);
  });
}
// Fetches presets.json once and caches the promise; safe to call from multiple places.
let presetsPromise = null;
export function fetchPresets() {
  if (!presetsPromise) {
    presetsPromise = fetch('presets.json', { cache: 'no-cache' })
      .then(res => res.json())
      .then(list => (Array.isArray(list) ? list : []))
      .catch(() => []);
  }
  return presetsPromise;
}
// The preset that seeds a first-time visit (no saved state yet). Marked with "default": true in presets.json;
// falls back to the last preset if none is marked, so there's always something reasonable to seed from.
export const pickDefaultPreset = list => list.find(p => p.default) || list[list.length - 1] || null;

export { renderPresets };
export async function loadPresets() { renderPresets(await fetchPresets()); }

async function copyGradient(e) {
  const anchor = e.currentTarget; // e itself is only valid synchronously; grab this before the first await
  const payload = JSON.stringify(serializeConfig({ stripIds: true }));
  const done = () => { setStatus('Gradient copied. Paste it into presets.json to add it as a preset.'); showToast(anchor, 'Copied gradient'); };
  try { await navigator.clipboard.writeText(payload); done(); }
  catch {
    try {
      const ta = document.createElement('textarea'); ta.value = payload; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      done();
    } catch { setStatus('Could not copy automatically. Open the console to grab the JSON.', true); console.log(payload); }
  }
}
$('copyGradient').addEventListener('click', copyGradient);
$('copyGradientBtn').addEventListener('click', copyGradient);
