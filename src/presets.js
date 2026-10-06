// Presets are full gradient configs in presets.json. "Copy gradient" puts the current config on the clipboard in
// the same shape so it can be pasted straight into that file.

import { isNum } from './constants.js';
import { state, applyConfig, serializeConfig } from './state.js';
import { pushUndo } from './undo.js';
import { $, setStatus, showToast } from './dom.js';
import { layout } from './view.js';
import { refreshAll } from './refresh.js';
import { scheduleSave } from './persistence.js';
import { syncControlsFromState } from './controls.js';
import { normalizeNode } from './nodes.js';
import { makeRenderer } from './renderer.js';
import { toggleSideTab, onSideTabOpen } from './sideTab.js';

const GRAIN_TYPES = ['mono', 'duo', 'multi'];
const BLEND_MODES = ['normal', 'linear', 'multiply', 'screen', 'overlay'];
// Mirrors applyConfig()'s defaults (state.js), but returns a plain renderable scene instead of touching state.
function presetScene(p) {
  return {
    w: isNum(p.w) ? p.w : 1600, h: isNum(p.h) ? p.h : 1000,
    nodes: Array.isArray(p.nodes) ? p.nodes.map(normalizeNode) : [],
    soft: isNum(p.soft) ? p.soft : 0.1,
    grain: isNum(p.grain) ? p.grain : 0.02,
    grainSize: isNum(p.grainSize) ? p.grainSize : 1,
    grainType: GRAIN_TYPES.includes(p.grainType) ? p.grainType : 'mono',
    density: isNum(p.density) ? p.density : 1.4,
    adj: { hue: isNum(p.adj?.hue) ? p.adj.hue : 0, sat: isNum(p.adj?.sat) ? p.adj.sat : 1, bri: isNum(p.adj?.bri) ? p.adj.bri : 1, temp: isNum(p.adj?.temp) ? p.adj.temp : 0 },
    blendMode: BLEND_MODES.includes(p.blendMode) ? p.blendMode : (p.linear ? 'linear' : 'normal'),
    seed: isNum(p.seed) ? p.seed : 0,
  };
}
// A real rendered thumbnail (not a CSS approximation), sized to the preset's own aspect ratio and capped at `size`.
export function renderPresetThumb(p, size = 160, type = 'image/png') {
  const scene = presetScene(p);
  const scale = size / Math.max(scene.w, scene.h);
  const tw = Math.max(1, Math.round(scene.w * scale)), th = Math.max(1, Math.round(scene.h * scale));
  const canvas = document.createElement('canvas'); canvas.width = tw; canvas.height = th;
  const r = makeRenderer(canvas, { preserveDrawingBuffer: true });
  if (!r) return null;
  r.render(tw, th, scene);
  const url = canvas.toDataURL(type, 0.85);
  r.gl.getExtension('WEBGL_lose_context')?.loseContext();
  return url;
}

export function applyPreset(p) {
  pushUndo();
  if (!isNum(p.seed)) state.seed = Math.random() * 1000;
  applyConfig(p, { reassignIds: true });
  state.selected.clear();
  syncControlsFromState({ animate: 'ripple' });
  layout(); refreshAll(); scheduleSave();
  setStatus('Applied preset.');
}
// The sidebar grid shows this many presets; the last of them carries a "+N" for the rest and opens the side tab.
const GRID_SLOTS = 8;
let allPresets = [];
const thumbCache = new Map(); // index -> data URL, so a preset is only ever rendered once
const thumbFor = i => {
  if (!thumbCache.has(i)) thumbCache.set(i, renderPresetThumb(allPresets[i]));
  return thumbCache.get(i);
};
function renderPresets(presets) {
  allPresets = presets; thumbCache.clear();
  const wrap = $('presets');
  wrap.innerHTML = '';
  $('presetsEmpty').hidden = presets.length > 0;
  presets.slice(0, GRID_SLOTS).forEach((p, i) => {
    const b = document.createElement('button'); b.className = 'preset'; b.type = 'button';
    const thumb = thumbFor(i);
    if (thumb) b.style.backgroundImage = `url(${thumb})`;
    if (i === GRID_SLOTS - 1) {
      // the corner tile: a count of the presets that don't fit, and it opens all of them in the side tab
      b.id = 'presetMoreBtn'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'communityTab');
      b.setAttribute('aria-label', `Show all ${presets.length} presets`);
      const more = document.createElement('span'); more.className = 'preset-more'; more.textContent = `+${Math.max(0, presets.length - GRID_SLOTS)}`;
      b.appendChild(more);
      b.addEventListener('click', () => toggleSideTab('presets'));
    } else {
      b.setAttribute('aria-label', `Apply preset ${i + 1}`);
      b.addEventListener('click', () => applyPreset(p));
    }
    wrap.appendChild(b);
  });
}
// The side tab's pane: every preset, rendered when the tab opens (thumbnails are cached from then on).
function renderPresetTab() {
  const wrap = $('presetTabList');
  wrap.innerHTML = '';
  allPresets.forEach((p, i) => {
    const card = document.createElement('div'); card.className = 'ct-card';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ct-thumb';
    const thumb = thumbFor(i);
    if (thumb) b.style.backgroundImage = `url(${thumb})`;
    b.setAttribute('aria-label', `Apply preset ${i + 1}`);
    b.addEventListener('click', () => applyPreset(p));
    card.appendChild(b); wrap.appendChild(card);
  });
}
onSideTabOpen(kind => { if (kind === 'presets') renderPresetTab(); });
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
$('copyGradientBtn').addEventListener('click', copyGradient);
