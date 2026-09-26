// Document state and the helpers that mutate it. No DOM access here.

import { MAXN, CANVAS_MIN, CANVAS_MAX, clamp, isNum } from './constants.js';
import { normalizeNode, createNode } from './nodes.js';

export const PALETTES = [
  ['#ff7a59', '#ffd166', '#6a4c93', '#1982c4'],
  ['#f9c5d1', '#f2a7c0', '#9d8df1', '#3d5af1'],
  ['#0f2027', '#2c5364', '#3ca55c', '#b5ac49'],
  ['#ff9a9e', '#fad0c4', '#fbc2eb', '#a18cd1'],
  ['#001219', '#005f73', '#0a9396', '#ee9b00'],
  ['#f6d365', '#fda085', '#f5576c', '#4facfe'],
  ['#e8e1d9', '#c9b79c', '#8a9a5b', '#3e5641'],
  ['#12c2e9', '#c471ed', '#f64f59', '#ffe259'],
];

export const state = {
  w: 1600, h: 1000,
  nodes: [],
  selected: new Set(),
  soft: 0.1, grain: 0.02, grainSize: 1, grainType: 'mono', density: 1.4,
  adj: { hue: 0, sat: 1, bri: 1 },
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
export function cloneNode(n) { return { ...n, id: allocId() }; }
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

// Everything that describes a gradient (saved state, presets, "Copy gradient" all share this shape).
export function serializeConfig({ stripIds } = {}) {
  return {
    w: state.w, h: state.h,
    nodes: stripIds ? state.nodes.map(({ id, ...rest }) => rest) : state.nodes,
    soft: state.soft, grain: state.grain, grainSize: state.grainSize,
    grainType: state.grainType, density: state.density,
    adj: state.adj, blendMode: state.blendMode, seed: state.seed,
  };
}
const GRAIN_TYPES = ['mono', 'duo', 'multi'];
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
  if (s.adj && typeof s.adj === 'object') {
    if (isNum(s.adj.hue)) state.adj.hue = clamp(s.adj.hue, -180, 180);
    if (isNum(s.adj.sat)) state.adj.sat = clamp(s.adj.sat, 0, 2);
    if (isNum(s.adj.bri)) state.adj.bri = clamp(s.adj.bri, 0.2, 1.8);
  }
  // `linear` is the old boolean flag this replaced; still accepted from older saved state/presets.
  state.blendMode = BLEND_MODES.includes(s.blendMode) ? s.blendMode : (s.linear ? 'linear' : 'normal');
  if (isNum(s.seed)) state.seed = s.seed;
}
