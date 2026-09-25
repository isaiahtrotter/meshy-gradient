// The "Selected" panel: swatch, hex input, and the custom HSV colour picker. Colour edits are live while dragging
// and commit one undo entry on release.

import { state, selectedNodes } from './state.js';
import { snapshot, pushUndo } from './undo.js';
import { hexToHsv, hsvToHex, rgbaCss, hexWithAlpha, parseHexInput } from './color.js';
import { $ } from './dom.js';
import { refreshHandles } from './handles.js';
import { draw } from './view.js';

let colorSnap = null;
function beginColorEdit() { if (!colorSnap) colorSnap = snapshot(); }
function setSwatch(hex, a) { $('selSwatch').style.setProperty('--sw', rgbaCss(hex, a)); }

export function refreshSelectionPanel() {
  const sel = selectedNodes(), has = sel.length > 0;
  $('selSection').hidden = !has;
  $('delBtn').disabled = !has;
  $('selTitle').textContent = has ? (sel.length === 1 ? 'Selected node' : `${sel.length} nodes selected`) : 'Selected (none)';
  $('selSwatch').disabled = !has; $('selHex').disabled = !has;
  if (has) {
    setSwatch(sel[0].color, sel[0].a);
    if (document.activeElement !== $('selHex')) $('selHex').value = hexWithAlpha(sel[0].color, sel[0].a);
    if (!pickerDragging) syncPickerFromColor(sel[0].color, sel[0].a);
  } else { $('selHex').value = ''; closePicker(); }
}

// Applies a colour (and optional alpha) to the selection. `commit` closes the pending undo entry.
export function setSelectedColor(hex, commit, alpha) {
  for (const n of selectedNodes()) { n.color = hex; if (alpha != null) n.a = alpha; }
  const first = selectedNodes()[0], a = alpha != null ? alpha : (first ? first.a : 1);
  setSwatch(hex, a);
  if (document.activeElement !== $('selHex')) $('selHex').value = hexWithAlpha(hex, a);
  refreshHandles(); draw();
  if (commit && colorSnap) { pushUndo(colorSnap); colorSnap = null; }
}
function applyHex(commit) {
  const parsed = parseHexInput($('selHex').value);
  if (!parsed) { if (commit) refreshSelectionPanel(); return; }
  beginColorEdit(); setSelectedColor(parsed.hex, commit, parsed.alpha);
  if (commit) { const f = selectedNodes()[0]; syncPickerFromColor(parsed.hex, f ? f.a : 1); }
}
$('selHex').addEventListener('input', () => applyHex(false));
$('selHex').addEventListener('change', () => applyHex(true));
$('selHex').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

// ---------- Picker (HSV square + hue strip + alpha strip) ----------
const svCanvas = $('svCanvas'), svCtx = svCanvas.getContext('2d');
let pickerHue = 16, pickerS = 0.68, pickerV = 1, pickerA = 1, pickerOpen = false, pickerDragging = false;

function drawSV() {
  const w = svCanvas.width, h = svCanvas.height;
  svCtx.fillStyle = hsvToHex(pickerHue, 1, 1); svCtx.fillRect(0, 0, w, h);
  let g = svCtx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  svCtx.fillStyle = g; svCtx.fillRect(0, 0, w, h);
  g = svCtx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
  svCtx.fillStyle = g; svCtx.fillRect(0, 0, w, h);
}
function positionPickerThumbs() {
  const w = svCanvas.clientWidth || svCanvas.width, h = svCanvas.clientHeight || svCanvas.height;
  const hex = hsvToHex(pickerHue, pickerS, pickerV);
  $('svThumb').style.left = (pickerS * w) + 'px'; $('svThumb').style.top = ((1 - pickerV) * h) + 'px'; $('svThumb').style.background = hex;
  $('hueThumb').style.left = (pickerHue / 360 * $('hueTrack').clientWidth) + 'px'; $('hueThumb').style.background = hsvToHex(pickerHue, 1, 1);
  $('alphaThumb').style.left = (pickerA * $('alphaTrack').clientWidth) + 'px'; $('alphaThumb').style.background = rgbaCss(hex, pickerA);
  $('alphaFill').style.background = `linear-gradient(to right, ${rgbaCss(hex, 0)}, ${hex})`;
  $('alphaOut').textContent = Math.round(pickerA * 100) + '%';
}
function syncPickerFromColor(hex, a) {
  const { h, s, v } = hexToHsv(hex); pickerHue = h; pickerS = s; pickerV = v; if (a != null) pickerA = a;
  drawSV(); positionPickerThumbs();
}
function openPicker() {
  if ($('selSwatch').disabled) return;
  const sel = selectedNodes()[0]; if (sel) syncPickerFromColor(sel.color, sel.a);
  $('colorPicker').hidden = false; pickerOpen = true; $('selSwatch').setAttribute('aria-expanded', 'true');
  drawSV(); positionPickerThumbs();
}
function closePicker() { $('colorPicker').hidden = true; pickerOpen = false; $('selSwatch').setAttribute('aria-expanded', 'false'); }
$('selSwatch').addEventListener('click', e => { e.stopPropagation(); pickerOpen ? closePicker() : openPicker(); });
document.addEventListener('pointerdown', e => { if (pickerOpen && !e.target.closest('.picker') && !e.target.closest('#selSwatch')) closePicker(); });
document.addEventListener('keydown', e => { if (pickerOpen && e.key === 'Escape') { e.stopPropagation(); closePicker(); } }, true);

const frac = (clientX, el) => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / r.width)); };
function pickerDrag(kind) {
  return e => {
    e.preventDefault(); pickerDragging = true; beginColorEdit();
    const move = ev => {
      if (kind === 'sv') {
        const r = svCanvas.getBoundingClientRect();
        pickerS = frac(ev.clientX, svCanvas); pickerV = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height));
      } else if (kind === 'hue') pickerHue = Math.min(359.99, frac(ev.clientX, $('hueTrack')) * 360);
      else pickerA = frac(ev.clientX, $('alphaTrack'));
      drawSV(); positionPickerThumbs(); setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), false, pickerA);
    };
    const up = () => {
      pickerDragging = false; setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), true, pickerA);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    move(e); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
}
svCanvas.addEventListener('pointerdown', pickerDrag('sv'));
$('hueTrack').addEventListener('pointerdown', pickerDrag('hue'));
$('alphaTrack').addEventListener('pointerdown', pickerDrag('alpha'));
