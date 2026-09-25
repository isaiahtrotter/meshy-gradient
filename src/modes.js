// Stage modes: preview (hide handles), arc/line placement, and the hint line that describes the current mode.

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

// Placement modes are mutually exclusive; the pending type is what the next canvas click creates.
export const pendingNodeType = () => (session.addingArc ? 'arc' : session.addingLine ? 'line' : 'circle');
export function setPlacement(type) {
  session.addingArc = type === 'arc'; session.addingLine = type === 'line';
  $('addCircleBtn').setAttribute('aria-pressed', String(!session.addingArc && !session.addingLine));
  $('addArcBtn').setAttribute('aria-pressed', String(session.addingArc));
  $('addLineBtn').setAttribute('aria-pressed', String(session.addingLine));
  setHint(type === 'arc' ? 'Click on the canvas to place an arc.' : type === 'line' ? 'Click on the canvas to place a line.' : DEFAULT_HINT);
}
$('addCircleBtn').addEventListener('click', () => setPlacement(null));
$('addArcBtn').addEventListener('click', () => setPlacement('arc'));
$('addLineBtn').addEventListener('click', () => setPlacement('line'));
