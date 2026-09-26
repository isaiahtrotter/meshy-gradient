// Undo/redo over the whole document: nodes, canvas size, and every sidebar parameter (blend, grain, colour
// adjustments, blend mode). Capture `snapshot()` before a change and `pushUndo(snap)` once it's committed.

import { UNDO_LIMIT } from './constants.js';
import { serializeConfig, applyConfig } from './state.js';

const undoStack = [], redoStack = [];
const hooks = { change: () => {}, restore: () => {} };
export const onUndoChange = fn => { hooks.change = fn; };  // fn(canUndo, canRedo)
export const onRestore = fn => { hooks.restore = fn; };    // called after undo/redo rewrote state

export const snapshot = () => JSON.stringify(serializeConfig());
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function pushUndo(snap) {
  undoStack.push(snap ?? snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  hooks.change(canUndo(), canRedo());
}
function restore(json) {
  applyConfig(JSON.parse(json));
  hooks.restore();
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  hooks.change(canUndo(), canRedo());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  hooks.change(canUndo(), canRedo());
}
