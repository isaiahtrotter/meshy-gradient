// The "Selected" panel: swatch, hex input, and the custom HSV colour picker. Colour edits are live while dragging
// and commit one undo entry on release.

import { state, selectedNodes } from './state.js';
import { snapshot, pushUndo } from './undo.js';
import { hexToHsv, hsvToHex, hexToRgb, rgbToHex, rgbaCss, hexWithAlpha, parseHexInput } from './color.js';
import { MAX_GRAD_STOPS } from './constants.js';
import { $ } from './dom.js';
import { refreshHandles } from './handles.js';
import { draw } from './view.js';

let colorSnap = null;
function beginColorEdit() { if (!colorSnap) colorSnap = snapshot(); }
// Mirrors the shader's gradEase() (shader.js) so every preview matches what actually renders.
function easeF(f, mode) {
  if (mode === 'in') return f * f;
  if (mode === 'out') return f * (2 - f);
  if (mode === 'inout') return f < 0.5 ? 2 * f * f : -1 + (4 - 2 * f) * f;
  return f;
}
function mixHex(h1, h2, f) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  return rgbToHex(...[0, 1, 2].map(i => Math.round((a[i] + (b[i] - a[i]) * f) * 255)));
}
// Mirrors the shader's own bracket-and-lerp (plus easing) so a freshly-inserted stop reads as no visual change.
function sampleGradAt(n, t) {
  const st = n.gradStops;
  if (t <= st[0].t) return st[0].color;
  for (let j = 1; j < st.length; j++) {
    if (t <= st[j].t || j === st.length - 1) {
      const f = easeF((t - st[j - 1].t) / Math.max(st[j].t - st[j - 1].t, 1e-5), n.gradEase);
      return mixHex(st[j - 1].color, st[j].color, f);
    }
  }
  return st[st.length - 1].color;
}
// CSS <linear-gradient> only interpolates linearly between stops, so an eased curve needs extra stops sampled
// along the curve to read the same as the shader's per-pixel easing.
const EASE_SAMPLES = 12;
function cssGradStops(n) {
  if (n.gradEase === 'linear') return n.gradStops;
  const st = n.gradStops, out = [st[0]];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i], span = b.t - a.t;
    for (let k = 1; k <= EASE_SAMPLES; k++) {
      const f = easeF(k / EASE_SAMPLES, n.gradEase);
      out.push({ t: a.t + span * (k / EASE_SAMPLES), color: mixHex(a.color, b.color, f), a: a.a + (b.a - a.a) * f });
    }
  }
  return out;
}
function swatchCss(n) {
  if (!n.grad) return rgbaCss(n.color, n.a);
  return `linear-gradient(${n.gradAngle}deg, ${cssGradStops(n).map(s => `${rgbaCss(s.color, s.a)} ${(s.t * 100).toFixed(1)}%`).join(', ')})`;
}
function setSwatch(n) { $('selSwatch').style.setProperty('--sw', swatchCss(n)); }

function fillSlider(el) {
  const slider = el.closest('.slider');
  slider.style.setProperty('--pct', ((+el.value - +el.min) / (+el.max - +el.min)) * 100 + '%');
}

// ---------- Occluded-node blur range (os1: side facing away from the blur angle, os2: side facing it) ----------
function wireOccSoft(id, field) {
  const el = $(id);
  let snap = null;
  el.addEventListener('pointerdown', () => { snap = snapshot(); });
  el.addEventListener('input', e => {
    const v = +e.target.value;
    for (const n of selectedNodes()) if (n.occ) n[field] = v;
    fillSlider(el); $(id + 'Val').textContent = Math.round(v) + 'px';
    refreshHandles(); draw();
  });
  el.addEventListener('change', () => { if (snap) { pushUndo(snap); snap = null; } });
}
wireOccSoft('occSoft1', 'os1');
wireOccSoft('occSoft2', 'os2');

// ---------- Occluded-node blur angle (which side gets os2 vs. os1) ----------
let occAngleSnap = null;
$('occAngle').addEventListener('pointerdown', () => { occAngleSnap = snapshot(); });
$('occAngle').addEventListener('input', e => {
  const v = +e.target.value;
  for (const n of selectedNodes()) if (n.occ) n.oa = v;
  fillSlider($('occAngle')); $('occAngleVal').textContent = Math.round(v) + '°';
  refreshHandles(); draw();
});
$('occAngle').addEventListener('change', () => { if (occAngleSnap) { pushUndo(occAngleSnap); occAngleSnap = null; } });

// Index into the selected node's `stops` that the SV/hue controls currently edit (gradient mode only; ignored
// in solid mode, where they always edit `color`).
let activeStop = 0;
const curNode = () => selectedNodes()[0];

export function refreshSelectionPanel() {
  const sel = selectedNodes(), has = sel.length > 0;
  const occSel = sel.filter(n => n.occ);
  $('selSection').hidden = !has;
  $('delBtn').disabled = !has;
  $('selTitle').textContent = !has ? 'Selected (none)'
    : sel.every(n => n.occ) ? (sel.length === 1 ? 'Occluded node' : `${sel.length} occluded nodes selected`)
    : (sel.length === 1 ? 'Selected node' : `${sel.length} nodes selected`);
  $('selSwatch').disabled = !has; $('selHex').disabled = !has;
  if (has) {
    const first = sel[0];
    activeStop = first.grad ? Math.min(Math.max(activeStop, 0), first.gradStops.length - 1) : 0;
    setSwatch(first);
    if (document.activeElement !== $('selHex')) $('selHex').value = hexWithAlpha(first.color, first.a);
    $('pickerTabSolid').setAttribute('aria-pressed', String(!first.grad));
    $('pickerTabGradient').setAttribute('aria-pressed', String(first.grad));
    $('gradRampWrap').hidden = !first.grad;
    $('stopHead').hidden = !first.grad;
    $('stopList').hidden = !first.grad;
    $('gradAngleRow').hidden = !first.grad;
    $('gradEaseRow').hidden = !first.grad;
    if (first.grad) { renderRamp(first); renderStopList(first); }
    if (document.activeElement !== $('gradAngle')) {
      $('gradAngle').value = first.gradAngle; fillSlider($('gradAngle')); $('gradAngleVal').textContent = Math.round(first.gradAngle) + '°';
    }
    $('gradEaseRow').querySelectorAll('.ease-tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ease === first.gradEase)));
    if (!pickerDragging) syncPickerFromColor(first.grad ? first.gradStops[activeStop].color : first.color, first.a);
  } else { $('selHex').value = ''; closePicker(); }
  $('occSoft1Row').hidden = occSel.length === 0;
  $('occSoft2Row').hidden = occSel.length === 0;
  $('occAngleRow').hidden = occSel.length === 0;
  if (occSel.length) {
    for (const [id, field] of [['occSoft1', 'os1'], ['occSoft2', 'os2'], ['occAngle', 'oa']]) {
      if (document.activeElement === $(id)) continue;
      const v = occSel[0][field];
      $(id).value = v; fillSlider($(id));
      $(id + 'Val').textContent = Math.round(v) + (field === 'oa' ? '°' : 'px');
    }
  }
}

// Applies a colour (and optional alpha) to the selection. In solid mode (stopIdx null) that's `color`; in
// gradient mode it's `stops[stopIdx].color`. `commit` closes the pending undo entry.
export function setSelectedColor(hex, commit, alpha, stopIdx) {
  for (const n of selectedNodes()) {
    if (stopIdx != null) { const st = n.gradStops[Math.min(stopIdx, n.gradStops.length - 1)]; if (st) st.color = hex; }
    else n.color = hex;
    if (alpha != null) n.a = alpha;
  }
  const first = curNode(), a = alpha != null ? alpha : (first ? first.a : 1);
  if (first) {
    setSwatch(first);
    if (first.grad) { renderRamp(first); renderStopList(first); }
  }
  if (stopIdx == null && document.activeElement !== $('selHex')) $('selHex').value = hexWithAlpha(hex, a);
  refreshHandles(); draw();
  if (commit && colorSnap) { pushUndo(colorSnap); colorSnap = null; }
}
function applyHex(commit) {
  const parsed = parseHexInput($('selHex').value);
  if (!parsed) { if (commit) refreshSelectionPanel(); return; }
  beginColorEdit(); setSelectedColor(parsed.hex, commit, parsed.alpha);
  const first = curNode();
  if (commit && first && !first.grad) syncPickerFromColor(parsed.hex, first.a);
}
$('selHex').addEventListener('input', () => applyHex(false));
$('selHex').addEventListener('change', () => applyHex(true));
$('selHex').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

// ---------- Solid / Gradient tabs ----------
function setGradMode(grad) {
  const snap = snapshot();
  for (const n of selectedNodes()) n.grad = grad;
  pushUndo(snap);
  activeStop = 0;
  refreshHandles(); draw(); refreshSelectionPanel();
}
$('pickerTabSolid').addEventListener('click', () => setGradMode(false));
$('pickerTabGradient').addEventListener('click', () => setGradMode(true));

// ---------- Gradient easing ----------
$('gradEaseRow').addEventListener('click', e => {
  const b = e.target.closest('.ease-tab'); if (!b) return;
  const snap = snapshot();
  for (const n of selectedNodes()) n.gradEase = b.dataset.ease;
  pushUndo(snap);
  refreshHandles(); draw(); refreshSelectionPanel();
});

// ---------- Gradient ramp + stop list ----------
function renderRamp(n) {
  const ramp = $('gradRamp');
  ramp.style.background = `linear-gradient(90deg, ${cssGradStops(n).map(s => `${rgbaCss(s.color, s.a)} ${(s.t * 100).toFixed(2)}%`).join(', ')})`;
  ramp.querySelectorAll('.grad-stop-handle').forEach(h => h.remove());
  n.gradStops.forEach((s, idx) => {
    const h = document.createElement('div');
    h.className = 'grad-stop-handle' + (idx === activeStop ? ' active' : '');
    h.style.left = (s.t * 100) + '%'; h.style.background = s.color;
    h.addEventListener('pointerdown', gradStopDrag(idx));
    ramp.appendChild(h);
  });
}
function gradStopDrag(idx) {
  return e => {
    e.preventDefault(); e.stopPropagation();
    activeStop = idx;
    const node = curNode(); if (!node) return;
    const stopRef = node.gradStops[idx];
    const ramp = $('gradRamp');
    beginColorEdit(); pickerDragging = true;
    syncPickerFromColor(stopRef.color, node.a);
    const move = ev => {
      stopRef.t = frac(ev.clientX, ramp);
      renderRamp(node); renderStopList(node); refreshHandles(); draw();
    };
    const up = () => {
      pickerDragging = false;
      node.gradStops.sort((a, b) => a.t - b.t);
      activeStop = node.gradStops.indexOf(stopRef);
      renderRamp(node); renderStopList(node);
      if (colorSnap) { pushUndo(colorSnap); colorSnap = null; }
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
}
$('gradRamp').addEventListener('pointerdown', e => {
  if (e.target !== e.currentTarget) return; // a stop handle's own listener already handled it
  const node = curNode(); if (!node || node.gradStops.length >= MAX_GRAD_STOPS) return;
  const t = frac(e.clientX, $('gradRamp'));
  const snap = snapshot();
  node.gradStops.push({ t, color: sampleGradAt(node, t), a: 1 });
  node.gradStops.sort((a, b) => a.t - b.t);
  activeStop = node.gradStops.findIndex(s => s.t === t);
  pushUndo(snap);
  refreshHandles(); draw(); refreshSelectionPanel();
});
function renderStopList(n) {
  const list = $('stopList');
  list.innerHTML = '';
  n.gradStops.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'stop-row' + (idx === activeStop ? ' active' : '');
    row.innerHTML = `
      <input type="number" class="stop-pos" min="0" max="100" step="1" value="${Math.round(s.t * 100)}" title="Position">
      <span class="stop-sw checker"><span style="--sw:${rgbaCss(s.color, s.a)}"></span></span>
      <span class="stop-hex">${s.color.slice(1)}</span>
      <input type="number" class="stop-op" min="0" max="100" step="1" value="${Math.round(s.a * 100)}" title="Stop opacity">
      <button type="button" class="stop-remove" ${n.gradStops.length <= 2 ? 'disabled' : ''} title="Remove stop">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5H9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>`;
    row.addEventListener('pointerdown', e => {
      if (e.target.closest('input') || e.target.closest('.stop-remove')) return;
      activeStop = idx; refreshSelectionPanel();
    });
    row.querySelector('.stop-pos').addEventListener('change', e => {
      const node = curNode(); if (!node) return;
      const stopRef = node.gradStops[idx], snap = snapshot();
      stopRef.t = Math.min(100, Math.max(0, +e.target.value || 0)) / 100;
      node.gradStops.sort((a, b) => a.t - b.t);
      activeStop = node.gradStops.indexOf(stopRef);
      pushUndo(snap);
      refreshHandles(); draw(); refreshSelectionPanel();
    });
    row.querySelector('.stop-op').addEventListener('change', e => {
      const node = curNode(); if (!node) return;
      const snap = snapshot();
      node.gradStops[idx].a = Math.min(100, Math.max(0, +e.target.value || 0)) / 100;
      pushUndo(snap);
      refreshHandles(); draw(); refreshSelectionPanel();
    });
    row.querySelector('.stop-remove').addEventListener('click', () => {
      const node = curNode(); if (!node || node.gradStops.length <= 2) return;
      const snap = snapshot();
      node.gradStops.splice(idx, 1);
      activeStop = Math.min(activeStop, node.gradStops.length - 1);
      pushUndo(snap);
      refreshHandles(); draw(); refreshSelectionPanel();
    });
    list.appendChild(row);
  });
}
// The midpoint of the widest gap between consecutive stops — so repeated clicks fill in evenly rather than
// stacking identical stops on top of each other.
function widestGapMidpoint(stops) {
  let best = 0, bestGap = -1;
  for (let i = 1; i < stops.length; i++) {
    const gap = stops[i].t - stops[i - 1].t;
    if (gap > bestGap) { bestGap = gap; best = (stops[i - 1].t + stops[i].t) / 2; }
  }
  return best;
}
$('addStopBtn').addEventListener('click', () => {
  const node = curNode(); if (!node || node.gradStops.length >= MAX_GRAD_STOPS) return;
  const t = widestGapMidpoint(node.gradStops);
  const snap = snapshot();
  node.gradStops.push({ t, color: sampleGradAt(node, t), a: 1 });
  node.gradStops.sort((a, b) => a.t - b.t);
  activeStop = node.gradStops.findIndex(s => s.t === t);
  pushUndo(snap);
  refreshHandles(); draw(); refreshSelectionPanel();
});

// ---------- Gradient angle ----------
let gradAngleSnap = null;
$('gradAngle').addEventListener('pointerdown', () => { gradAngleSnap = snapshot(); });
$('gradAngle').addEventListener('input', e => {
  const v = +e.target.value;
  for (const n of selectedNodes()) n.gradAngle = v;
  fillSlider($('gradAngle')); $('gradAngleVal').textContent = Math.round(v) + '°';
  const first = selectedNodes()[0]; if (first) setSwatch(first);
  refreshHandles(); draw();
});
$('gradAngle').addEventListener('change', () => { if (gradAngleSnap) { pushUndo(gradAngleSnap); gradAngleSnap = null; } });

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
// Floats the picker over the canvas, anchored to the sidebar's left edge (8px gap) and vertically aligned
// with the swatch button — it no longer lives inside the panel's own scroll flow, so it can't clip against or
// overlap the sections below it.
function positionPicker() {
  const panel = document.querySelector('.panel'), swatch = $('selSwatch');
  const panelRect = panel.getBoundingClientRect(), swatchRect = swatch.getBoundingClientRect();
  const picker = $('colorPicker');
  picker.style.left = '-9999px'; picker.style.visibility = 'hidden';
  const ph = picker.offsetHeight, pw = picker.offsetWidth;
  const left = Math.max(8, panelRect.left - 8 - pw);
  const top = Math.min(Math.max(8, swatchRect.top), window.innerHeight - ph - 8);
  picker.style.left = left + 'px'; picker.style.top = top + 'px'; picker.style.visibility = '';
}
function openPicker() {
  if ($('selSwatch').disabled) return;
  $('colorPicker').hidden = false; pickerOpen = true; $('selSwatch').setAttribute('aria-expanded', 'true');
  refreshSelectionPanel();
  drawSV(); positionPickerThumbs(); positionPicker();
}
function closePicker() { $('colorPicker').hidden = true; pickerOpen = false; $('selSwatch').setAttribute('aria-expanded', 'false'); }
$('selSwatch').addEventListener('click', e => { e.stopPropagation(); pickerOpen ? closePicker() : openPicker(); });
document.addEventListener('pointerdown', e => { if (pickerOpen && !e.target.closest('.picker') && !e.target.closest('#selSwatch')) closePicker(); });
document.addEventListener('keydown', e => { if (pickerOpen && e.key === 'Escape') { e.stopPropagation(); closePicker(); } }, true);
window.addEventListener('resize', () => { if (pickerOpen) positionPicker(); });

const frac = (clientX, el) => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / r.width)); };
function pickerDrag(kind) {
  return e => {
    e.preventDefault(); pickerDragging = true; beginColorEdit();
    const first = curNode(), stopIdx = first && first.grad ? activeStop : null;
    const move = ev => {
      if (kind === 'sv') {
        const r = svCanvas.getBoundingClientRect();
        pickerS = frac(ev.clientX, svCanvas); pickerV = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height));
      } else if (kind === 'hue') pickerHue = Math.min(359.99, frac(ev.clientX, $('hueTrack')) * 360);
      else pickerA = frac(ev.clientX, $('alphaTrack'));
      drawSV(); positionPickerThumbs(); setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), false, pickerA, stopIdx);
    };
    const up = () => {
      pickerDragging = false; setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), true, pickerA, stopIdx);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    move(e); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
}
svCanvas.addEventListener('pointerdown', pickerDrag('sv'));
$('hueTrack').addEventListener('pointerdown', pickerDrag('hue'));
$('alphaTrack').addEventListener('pointerdown', pickerDrag('alpha'));
