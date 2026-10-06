// Small whole-selection actions shared by the keyboard, the panel buttons, and the menus.

import { state, selectedNodes, removeNodes, selectAll } from './state.js';
import { session } from './session.js';
import { pushUndo } from './undo.js';
import { flipNode } from './nodes.js';
import { refreshAll } from './refresh.js';

export function deleteSelected() {
  if (!state.selected.size) return;
  pushUndo();
  removeNodes(new Set(state.selected));
  refreshAll();
}
// Removes the selected hardness stop, if there is one on a selected stroke. Returns whether it did.
export function deleteSelectedStop() {
  const sel = session.stopSel; if (!sel) return false;
  const n = state.nodes.find(x => x.id === sel.id);
  session.stopSel = null;
  if (!n || n.type !== 'stroke' || !state.selected.has(n.id) || sel.i <= 0 || sel.i >= n.stops.length - 1) { refreshAll(); return false; }
  pushUndo();
  n.stops.splice(sel.i, 1);
  refreshAll();
  return true;
}
export function selectAllNodes() { selectAll(); refreshAll(); }
export function clearSelection() { state.selected.clear(); refreshAll(); }
// axis 'x' = flip horizontal, 'y' = flip vertical. Each node mirrors about its own centre; with several selected,
// their positions also mirror across the selection's bounding-box centre so the group flips as a whole.
export function flipSelected(axis) {
  const nodes = selectedNodes(); if (!nodes.length) return;
  pushUndo();
  const vals = nodes.map(n => n[axis]), mid = (Math.min(...vals) + Math.max(...vals)) / 2;
  for (const n of nodes) { flipNode(n, axis); if (nodes.length > 1) n[axis] = 2 * mid - n[axis]; }
  refreshAll();
}
export function nudgeSelected(dx, dy) {
  if (!state.selected.size) return;
  pushUndo();
  for (const n of selectedNodes()) { n.x += dx; n.y += dy; }
  refreshAll();
}
// Moves each selected occluding node one step over the next occluding node in array order (dir -1 = toward the
// bottom of the occlude stack, +1 = toward the top). Non-occluding nodes have no order of their own, so they're
// skipped when looking for a neighbour to swap with, and a node with no occluding neighbour in that direction
// doesn't move. Selected nodes are walked back-to-front (dir -1) or front-to-back (dir +1) so several selected
// nodes moving together don't just swap past each other.
export function moveOccludeLayer(dir) {
  const nodes = selectedNodes().filter(n => n.occ); if (!nodes.length) return;
  const order = [...nodes].sort((a, b) => state.nodes.indexOf(a) - state.nodes.indexOf(b));
  if (dir > 0) order.reverse();
  const swaps = [];
  for (const n of order) {
    const idx = state.nodes.indexOf(n);
    let j = idx;
    do { j += dir; } while (j >= 0 && j < state.nodes.length && !state.nodes[j].occ);
    if (j >= 0 && j < state.nodes.length) swaps.push([idx, j]);
  }
  if (!swaps.length) return;
  pushUndo();
  for (const [idx, j] of swaps) [state.nodes[idx], state.nodes[j]] = [state.nodes[j], state.nodes[idx]];
  refreshAll();
}
