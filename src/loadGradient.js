// Putting a gradient on the canvas (from the community, your saved ones, or the first-visit default), drawing a
// thumbnail of one. The first-visit default is default-gradient.json.

import { isNum } from './constants.js';
import { state, applyConfig } from './state.js';
import { pushUndo } from './undo.js';
import { $, setStatus } from './dom.js';
import { layout } from './view.js';
import { refreshAll } from './refresh.js';
import { scheduleSave } from './persistence.js';
import { syncControlsFromState } from './controls.js';
import { normalizeNode } from './nodes.js';
import { makeRenderer } from './renderer.js';
import { markCopy, markOwn, refreshProvenance } from './provenance.js';

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
const CREDIT_KEY = 'meshGradientCredit.v2';
// Builds the line with DOM nodes (names come from other people, so never as HTML). With a Twitter handle the name is a
// link to that profile, opening in a new tab.
function renderCredit(c) {
  const el = $('frameCredit');
  el.replaceChildren();
  if (!c?.name) return;
  el.append('By ');
  if (c.twitter) {
    const a = document.createElement('a');
    a.href = `https://x.com/${encodeURIComponent(c.twitter)}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = c.name; a.title = `@${c.twitter} on Twitter`;
    el.append(a);
  } else el.append(c.name);
}
function setCredit(name, twitter) {
  const c = name ? { name, twitter: twitter || null } : null;
  renderCredit(c);
  try { if (c) localStorage.setItem(CREDIT_KEY, JSON.stringify(c)); else localStorage.removeItem(CREDIT_KEY); } catch {}
  refreshProvenance(); // the byline only shows while the canvas is an exact copy (provenance.js)
}
try { renderCredit(JSON.parse(localStorage.getItem(CREDIT_KEY) || 'null')); } catch {}
refreshProvenance(true);

// own: the gradient is the user's own saved one, so Publish stays available; otherwise it's a copy of someone else's
// (a community gradient) and Publish waits for the first edit.
export function applyGradient(p, { credit = null, twitter = null, own = false } = {}) {
  pushUndo();
  setCredit(credit, twitter);
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
