// Stage modes: preview (hide handles), arc/line placement, the brush, and the hint line that describes the mode.

import { session } from './session.js';
import { $, stage, overlay } from './dom.js';
import { playToolDemo, stopToolDemo } from './toolDemo.js';

export const DEFAULT_HINT = 'Click to add a node, or drag to size it as you place it. Shift-drag to select. Arm handles set spread, the dotted ring sets hardness.';
export const setHint = text => { $('hint').textContent = text; };
setHint(DEFAULT_HINT);

export function setPreview(on) {
  session.previewing = on;
  stage.classList.toggle('previewing', on); overlay.classList.toggle('hide-handles', on);
  $('previewToolBtn').setAttribute('aria-pressed', String(on));
  // toggleAttribute, not the .hidden property: SVGElement doesn't reflect it in every engine
  $('previewToolBtn').querySelector('.preview-icon-off').toggleAttribute('hidden', on);
  $('previewToolBtn').querySelector('.preview-icon-on').toggleAttribute('hidden', !on);
}
$('previewToolBtn').addEventListener('click', () => setPreview(!session.previewing));

// Placement modes are mutually exclusive; the pending type is what the next canvas click creates. Arc and line
// drop back to circles after one placement; the brush stays on until Esc or another tool, like a brush should.
const PLACEMENT_BUTTONS = { selectToolBtn: 'none', addCircleBtn: null, addLineBtn: 'line', addArcBtn: 'arc', addStrokeBtn: 'stroke' };
const PLACEMENT_HINTS = {
  arc: 'Click on the canvas to place an arc, or drag to shape it.',
  line: 'Click on the canvas to place a line, or drag to draw it.',
  none: 'Drag to select, or drag the canvas to pan on a touch screen. Pick a tool to add nodes.',
  stroke: 'Drag on the canvas to draw a stroke. Click its path to add a hardness stop. Esc to finish.',
};
export const pendingNodeType = () => (session.placing === 'none' ? null : session.placing) || 'circle';
const placementListeners = [];
export const onPlacementChange = cb => placementListeners.push(cb); // colorPanel.js opens the pencil's colour picker from here
export function setPlacement(type) {
  stopToolDemo(); // any demo (looping or not) belongs to the tool that's being left; the caller starts the new tool's
  session.placing = type || null;
  for (const [id, t] of Object.entries(PLACEMENT_BUTTONS)) $(id).setAttribute('aria-pressed', String(session.placing === t));
  stage.classList.toggle('has-tool', session.placing !== 'none'); // the crosshair covers the whole stage while a node tool is up
  overlay.classList.toggle('no-tool', session.placing === 'none'); // the crosshair is for placing; with no tool the normal cursor shows
  setHint(PLACEMENT_HINTS[session.placing] || DEFAULT_HINT);
  for (const cb of placementListeners) cb(session.placing);
}
for (const [id, t] of Object.entries(PLACEMENT_BUTTONS)) $(id).addEventListener('click', () => { setPlacement(t); if (t !== 'none') playToolDemo(t || 'circle'); });
// Every viewport opens with no tool: desktop shows it as the select tool, a phone has no select button so nothing is
// highlighted and a one-finger drag pans the canvas.
setPlacement('none');
