// Small whole-selection actions shared by the keyboard, the panel buttons, and the menus.

import { state, selectedNodes, removeNodes, selectAll } from './state.js';
import { pushUndo } from './undo.js';
import { refreshAll } from './refresh.js';

export function deleteSelected() {
  if (!state.selected.size) return;
  pushUndo();
  removeNodes(new Set(state.selected));
  refreshAll();
}
export function selectAllNodes() { selectAll(); refreshAll(); }
export function clearSelection() { state.selected.clear(); refreshAll(); }
export function nudgeSelected(dx, dy) {
  if (!state.selected.size) return;
  pushUndo();
  for (const n of selectedNodes()) { n.x += dx; n.y += dy; }
  refreshAll();
}
