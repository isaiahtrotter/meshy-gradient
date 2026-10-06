// Putting a gradient on the canvas (from the community, your saved ones, or the first-visit default), drawing a
// thumbnail of one, and the "Copy gradient" button. The first-visit default is default-gradient.json.

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
import { markCopy, markOwn } from './provenance.js';

const GRAIN_TYPES = ['mono', 'duo', 'multi'];
const BLEND_MODES = ['normal', 'linear', 'multiply', 'screen', 'overlay'];
// Mirrors applyConfig()'s defaults (state.js), but returns a plain renderable scene instead of touching state.
function gradientScene(p) {
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
// A real rendered thumbnail (not a CSS approximation), sized to the gradient's own aspect ratio and capped at `size`.
export function renderThumb(p, size = 160, type = 'image/png') {
  const scene = gradientScene(p);
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

// "By [name]" under the canvas while it holds a gradient someone else published; any other load clears it. Kept in
// localStorage so it survives a reload along with the gradient itself.
const CREDIT_KEY = 'meshGradientCredit.v1';
function setCredit(name) {
  const el = $('frameCredit');
  el.textContent = name ? `By ${name}` : ''; el.hidden = !name;
  try { if (name) localStorage.setItem(CREDIT_KEY, name); else localStorage.removeItem(CREDIT_KEY); } catch {}
}
try { setCredit(localStorage.getItem(CREDIT_KEY)); } catch {}

// own: the gradient is the user's own saved one, so Publish stays available; otherwise it's a copy of someone else's
// (a community gradient) and Publish waits for the first edit.
export function applyGradient(p, { credit = null, own = false } = {}) {
  pushUndo();
  setCredit(credit);
  if (!isNum(p.seed)) state.seed = Math.random() * 1000;
  applyConfig(p, { reassignIds: true });
  state.selected.clear();
  syncControlsFromState({ animate: 'ripple' });
  layout(); refreshAll(); scheduleSave();
  own ? markOwn() : markCopy();
  setStatus('Applied gradient.');
}

// The gradient a first-time visit starts from (no saved state yet). If it can't be fetched, boot falls back to a few
// plain colours.
export async function fetchDefaultGradient() {
  try { return await (await fetch('default-gradient.json', { cache: 'no-cache' })).json(); } catch { return null; }
}

async function copyGradient(e) {
  const anchor = e.currentTarget; // e itself is only valid synchronously; grab this before the first await
  const payload = JSON.stringify(serializeConfig({ stripIds: true }));
  const done = () => { setStatus('Gradient copied.'); showToast(anchor, 'Copied gradient'); };
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
