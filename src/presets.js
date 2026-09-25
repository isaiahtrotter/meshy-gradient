// Presets are full gradient configs in presets.json. "Copy gradient" puts the current config on the clipboard in
// the same shape so it can be pasted straight into that file.

import { isNum } from './constants.js';
import { state, applyConfig, serializeConfig } from './state.js';
import { pushUndo } from './undo.js';
import { $, setStatus } from './dom.js';
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
export async function loadPresets() {
  try {
    const res = await fetch('presets.json', { cache: 'no-cache' });
    const list = await res.json();
    renderPresets(Array.isArray(list) ? list : []);
  } catch { renderPresets([]); }
}

$('copyGradient').addEventListener('click', async () => {
  const payload = JSON.stringify(serializeConfig({ stripIds: true }));
  const done = () => setStatus('Gradient copied. Paste it into presets.json to add it as a preset.');
  try { await navigator.clipboard.writeText(payload); done(); }
  catch {
    try {
      const ta = document.createElement('textarea'); ta.value = payload; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      done();
    } catch { setStatus('Could not copy automatically. Open the console to grab the JSON.', true); console.log(payload); }
  }
});
