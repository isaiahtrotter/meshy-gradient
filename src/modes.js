// Stage modes: preview (hide handles), arc/line placement, the brush, and the hint line that describes the mode.

import { session } from './session.js';
import { $, stage, overlay } from './dom.js';

export const DEFAULT_HINT = 'Click to add a node. Drag to select. Arm handles set spread, the dotted ring sets hardness.';
export const setHint = text => { $('hint').textContent = text; };
setHint(DEFAULT_HINT);

export function setPreview(on) {
  session.previewing = on;
  stage.classList.toggle('previewing', on); overlay.classList.toggle('hide-handles', on);
  $('previewBtn').setAttribute('aria-pressed', String(on));
  $('previewBtn').textContent = on ? 'Exit preview' : 'Preview';
}
$('previewBtn').addEventListener('click', () => setPreview(!session.previewing));

// Placement modes are mutually exclusive; the pending type is what the next canvas click creates. Arc and line
// drop back to circles after one placement; the brush stays on until Esc or another tool, like a brush should.
const PLACEMENT_BUTTONS = { addCircleBtn: null, addLineBtn: 'line', addArcBtn: 'arc', addStrokeBtn: 'stroke' };
const PLACEMENT_HINTS = {
  arc: 'Click on the canvas to place an arc.',
  line: 'Click on the canvas to place a line.',
  stroke: 'Drag on the canvas to draw a stroke. Click its path to add a hardness stop. Esc to finish.',
};
export const pendingNodeType = () => session.placing || 'circle';
export function setPlacement(type) {
  session.placing = type || null;
  for (const [id, t] of Object.entries(PLACEMENT_BUTTONS)) $(id).setAttribute('aria-pressed', String(session.placing === t));
  setHint(PLACEMENT_HINTS[session.placing] || DEFAULT_HINT);
}
for (const [id, t] of Object.entries(PLACEMENT_BUTTONS)) $(id).addEventListener('click', () => setPlacement(t));
