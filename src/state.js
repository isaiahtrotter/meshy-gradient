// Document state and the helpers that mutate it. No DOM access here.

import { MAXN, CANVAS_MIN, CANVAS_MAX, clamp, isNum } from './constants.js';
import { normalizeNode, createNode } from './nodes.js';

// Grain colours. Mono's single colour tints the speckle (white is the plain light/dark speckle); Duo mixes two (the
// defaults, yellow and blue, are exactly the old fixed Duo look). Multi has no colours: it's random RGB.
export const GRAIN_COLOR_DEFAULTS = { mono: '#ffffff', duoA: '#ffff00', duoB: '#0000ff' };

export const state = {
  w: 1600, h: 1000,
  nodes: [],
  selected: new Set(),
  soft: 0.1, grain: 0.02, grainSize: 1, grainType: 'mono', density: 1.4,
  grainColors: { ...GRAIN_COLOR_DEFAULTS },
  adj: { hue: 0, sat: 1, bri: 1, temp: 0 }, // temp: -100 cool .. 100 warm
  blendMode: 'normal',
  seed: Math.random() * 1000,
};

let nextId = 1;
export const allocId = () => nextId++;

export const nodeById = id => state.nodes.find(n => n.id === id);
export const selectedNodes = () => state.nodes.filter(n => state.selected.has(n.id));
// The nodes an action applies to: the selection if there is one, otherwise everything.
export const targetNodes = () => (state.selected.size ? selectedNodes() : state.nodes);

export function selectOnly(id) { state.selected = new Set([id]); }
export function selectAll() { state.selected = new Set(state.nodes.map(n => n.id)); }
export function toggleSelected(id) { state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); }
export function pruneSelection() {
  const ids = new Set(state.nodes.map(n => n.id));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
}

export function addNode(type, x, y, color, spread) {
  if (state.nodes.length >= MAXN) return null;
  const n = createNode(type, x, y, color, spread);
  n.id = allocId();
  state.nodes.push(n);
  return n;
}
// Deep, so a clone never shares a stroke's pts/stops arrays with its source.
export function cloneNode(n) { return { ...structuredClone(n), id: allocId() }; }
export function replaceNode(id, node) {
  const i = state.nodes.findIndex(n => n.id === id);
  if (i >= 0) state.nodes[i] = node;
}
export function removeNodes(ids) {
  state.nodes = state.nodes.filter(n => !ids.has(n.id));
  pruneSelection();
}
// Replace every node. Ids are kept unless missing or `reassignIds` is set; nextId always moves past them.
export function setNodes(rawNodes, reassignIds) {
  state.nodes = rawNodes.map(raw => {
    const n = normalizeNode(raw);
    n.id = !reassignIds && isNum(raw.id) ? raw.id : allocId();
    return n;
  });
  nextId = Math.max(nextId, ...state.nodes.map(n => n.id + 1));
  pruneSelection();
}

export function setCanvasSize(w, h) {
  state.w = clamp(Math.round(w) || CANVAS_MIN, CANVAS_MIN, CANVAS_MAX);
  state.h = clamp(Math.round(h) || CANVAS_MIN, CANVAS_MIN, CANVAS_MAX);
}

// Everything that describes a gradient (saved state, the database and the first-visit default all share this shape).
export function serializeConfig({ stripIds } = {}) {
  // grain colours are only written when they differ from the defaults, so existing gradients serialize exactly as before
  const customGrain = Object.keys(GRAIN_COLOR_DEFAULTS).some(k => state.grainColors[k] !== GRAIN_COLOR_DEFAULTS[k]);
  return {
    ...(customGrain ? { grainColors: { ...state.grainColors } } : {}),
    w: state.w, h: state.h,
    nodes: stripIds ? state.nodes.map(({ id, ...rest }) => rest) : state.nodes,
    soft: state.soft, grain: state.grain, grainSize: state.grainSize,
    grainType: state.grainType, density: state.density,
    adj: state.adj, blendMode: state.blendMode, seed: state.seed,
  };
}
const GRAIN_TYPES = ['mono', 'duo', 'multi'];
// A valid grain-colour set from whatever was saved: bad or missing entries fall back to the defaults.
export function cleanGrainColors(raw) {
  const out = { ...GRAIN_COLOR_DEFAULTS };
  for (const k of Object.keys(out)) if (typeof raw?.[k] === 'string' && /^#[0-9a-f]{6}$/i.test(raw[k])) out[k] = raw[k].toLowerCase();
  return out;
}
const BLEND_MODES = ['normal', 'linear', 'multiply', 'screen', 'overlay'];
export function applyConfig(s, { reassignIds } = {}) {
  if (isNum(s.w) && isNum(s.h)) setCanvasSize(s.w, s.h);
  setNodes(Array.isArray(s.nodes) ? s.nodes : [], reassignIds);
  // Clamped to each slider's own range so a corrupted or out-of-schema saved value (an old build, a hand-
  // edited preset) can't push rendering into a degenerate state, e.g. a near-zero brightness reading black.
  if (isNum(s.soft)) state.soft = clamp(s.soft, 0.05, 0.2);
  if (isNum(s.grain)) state.grain = clamp(s.grain, 0, 0.15);
  if (isNum(s.grainSize)) state.grainSize = clamp(s.grainSize, 1, 8);
  state.grainType = GRAIN_TYPES.includes(s.grainType) ? s.grainType : 'mono';
  state.density = isNum(s.density) ? clamp(s.density, 0, 2) : 1.4;
  state.grainColors = cleanGrainColors(s.grainColors);
  if (s.adj && typeof s.adj === 'object') {
    if (isNum(s.adj.hue)) state.adj.hue = clamp(s.adj.hue, -180, 180);
    if (isNum(s.adj.sat)) state.adj.sat = clamp(s.adj.sat, 0, 2);
    if (isNum(s.adj.bri)) state.adj.bri = clamp(s.adj.bri, 0.2, 1.8);
  }
  // newer than the other adjustments, so presets and saves from before it have none: that means neutral, not
  // "keep whatever temperature is currently set"
  state.adj.temp = isNum(s.adj?.temp) ? clamp(s.adj.temp, -100, 100) : 0;
  // `linear` is the old boolean flag this replaced; still accepted from older saved state/presets.
  state.blendMode = BLEND_MODES.includes(s.blendMode) ? s.blendMode : (s.linear ? 'linear' : 'normal');
  if (isNum(s.seed)) state.seed = s.seed;
}
