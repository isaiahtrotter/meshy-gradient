// Small whole-selection actions shared by the keyboard, the panel buttons, and the menus.

import { state, selectedNodes, removeNodes, selectAll } from './state.js';
import { pushUndo } from './undo.js';
import { flipNode } from './nodes.js';
import { refreshAll } from './refresh.js';

export function deleteSelected() {
  if (!state.selected.size) return;
  pushUndo();
  removeNodes(new Set(state.selected));
  refreshAll();
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
