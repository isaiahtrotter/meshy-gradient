// The "Selected" panel: swatch, hex input, and the custom HSV colour picker. Colour edits are live while dragging
// and commit one undo entry on release.

import { state, selectedNodes } from './state.js';
import { snapshot, pushUndo } from './undo.js';
import { hexToHsv, hsvToHex, hexToRgb, rgbToHex, rgbaCss, parseHexInput } from './color.js';
import { MAX_GRAD_STOPS, clamp } from './constants.js';
import { $ } from './dom.js';
import { refreshHandles } from './handles.js';
import { draw } from './view.js';
import { attachScrub, syncGrainColors } from './controls.js';

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
  $('selSwatch').disabled = !has; $('selHex').disabled = !has; $('selOpacity').disabled = !has;
  if (has) {
    const first = sel[0];
    activeStop = first.grad ? Math.min(Math.max(activeStop, 0), first.gradStops.length - 1) : 0;
    setSwatch(first);
    const curHex = first.grad ? first.gradStops[activeStop].color : first.color;
    if (document.activeElement !== $('selHex')) $('selHex').value = curHex.slice(1).toUpperCase();
    if (document.activeElement !== $('selOpacity')) $('selOpacity').value = Math.round(first.a * 100);
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
    if (!pickerDragging && !grainKey) syncPickerFromColor(first.grad ? first.gradStops[activeStop].color : first.color, first.a);
  } else { $('selHex').value = ''; if (!grainKey) closePicker(); }
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
  if (grainKey) { // the picker is editing a grain colour, not the selection
    state.grainColors[grainKey] = hex.toLowerCase(); syncGrainColors(); draw();
    if (commit && colorSnap) { pushUndo(colorSnap); colorSnap = null; }
    return;
  }
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
  if (stopIdx == null && document.activeElement !== $('selHex')) $('selHex').value = hex.slice(1).toUpperCase();
  if (document.activeElement !== $('selOpacity')) $('selOpacity').value = Math.round(a * 100);
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

// ---------- Opacity (separate from the hex field — never folded into it) ----------
function activeStopIdx() { const f = curNode(); return f && f.grad ? activeStop : null; }
function currentColorHex() { const f = curNode(); if (!f) return '#000000'; return f.grad ? f.gradStops[Math.min(activeStop, f.gradStops.length - 1)].color : f.color; }
function applyOpacityTyped(commit) {
  const v = clamp(Math.round(+$('selOpacity').value) || 0, 0, 100);
  beginColorEdit(); setSelectedColor(currentColorHex(), commit, v / 100, activeStopIdx());
}
$('selOpacity').addEventListener('input', () => applyOpacityTyped(false));
$('selOpacity').addEventListener('change', () => applyOpacityTyped(true));
$('selOpacity').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
const scrubOpacity = v => setSelectedColor(currentColorHex(), false, v / 100, activeStopIdx());
attachScrub($('selOpacityScrub'), $('selOpacity'), { onInput: scrubOpacity, sensitivity: 0.5 });
attachScrub($('selOpacity'), $('selOpacity'), { onInput: scrubOpacity, threshold: 6, mobileOnly: true, sensitivity: 0.5 });

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
const svSquare = $('svSquare');
let pickerHue = 16, pickerS = 0.68, pickerV = 1, pickerA = 1, pickerOpen = false, pickerDragging = false;

// Shift+drag a rectangle on the square (or drag/resize the minimap window that appears once zoomed) to work in
// a cropped region of saturation/value space — mirrors a design reference's crop-to-zoom colour picker. All
// zoom fractions are 0..1, in the same s/v units as pickerS/pickerV.
const SV_FULL_ZOOM = { sMin: 0, sMax: 1, vMin: 0, vMax: 1 };
const SV_MIN_SPAN = 0.04;
const SV_MAP = 48;       // minimap square size, px
const SV_MAP_INSET = 8;  // minimap inset from the square's top-right corner, px
const SV_ANIM_MS = 380;
const SV_EASE = 'cubic-bezier(0.22,1,0.36,1)';
let svZoom = SV_FULL_ZOOM;
let svAnim = null;      // { phase: 'start'|'end', oldBg } — entrance the first time a crop is applied
let svClosing = null;   // 'start' | 'end' — the "clear crop" zoom-out
let svSelecting = false, svSelRect = null; // shift-drag select-to-zoom, in square-local px
let svDragMode = null;  // minimap window drag/resize: 'move' | 'nw' | 'ne' | 'sw' | 'se'
let svDragStart = { x: 0, y: 0, zoom: SV_FULL_ZOOM };
let svMorphing = false; // true briefly so the minimap's little rect glides instead of snapping

const svIsZoomed = z => z.sMin !== 0 || z.sMax !== 1 || z.vMin !== 0 || z.vMax !== 1;
function computeSquareBg(z, hue) {
  const hc = hsvToHex(hue, 1, 1);
  const cA = mixHex('#ffffff', hc, z.sMin), cB = mixHex('#ffffff', hc, z.sMax);
  const aTop = clamp(1 - z.vMax, 0, 1), aBottom = clamp(1 - z.vMin, 0, 1);
  return `linear-gradient(to top, rgba(0,0,0,${aBottom}), rgba(0,0,0,${aTop})), linear-gradient(to right, ${cA}, ${cB})`;
}
const svLocalPos = (clientX, clientY, rect) => ({
  x: clamp(clientX - rect.left, 0, rect.width), y: clamp(clientY - rect.top, 0, rect.height),
});
function svPixelToSV(px, py, rect) {
  const s = svZoom.sMin + (px / rect.width) * (svZoom.sMax - svZoom.sMin);
  const v = svZoom.vMax - (py / rect.height) * (svZoom.vMax - svZoom.vMin);
  return [clamp(s, 0, 1), clamp(v, 0, 1)];
}
function svToPixel(s, v, rect) {
  const x = ((s - svZoom.sMin) / (svZoom.sMax - svZoom.sMin)) * rect.width;
  const y = (1 - (v - svZoom.vMin) / (svZoom.vMax - svZoom.vMin)) * rect.height;
  return [clamp(x, 0, rect.width), clamp(y, 0, rect.height)];
}

function renderSVSquare() {
  const rect = svSquare.getBoundingClientRect();
  svSquare.style.background = computeSquareBg(svZoom, pickerHue);

  const [hx, hy] = svToPixel(pickerS, pickerV, rect);
  const dotFullX = pickerS * rect.width, dotFullY = (1 - pickerV) * rect.height;
  const thumb = $('svThumb');
  thumb.style.left = (svClosing === 'end' ? dotFullX : hx) + 'px';
  thumb.style.top = (svClosing === 'end' ? dotFullY : hy) + 'px';
  thumb.style.background = hsvToHex(pickerHue, pickerS, pickerV);
  thumb.style.transition = svClosing
    ? `left ${SV_ANIM_MS}ms ${SV_EASE}, top ${SV_ANIM_MS}ms ${SV_EASE}, background-color 150ms ease`
    : 'background-color 150ms ease';

  const selEl = $('svSelRect');
  if (svSelecting && svSelRect) {
    selEl.hidden = false;
    selEl.style.left = Math.min(svSelRect.x1, svSelRect.x2) + 'px';
    selEl.style.top = Math.min(svSelRect.y1, svSelRect.y2) + 'px';
    selEl.style.width = Math.abs(svSelRect.x2 - svSelRect.x1) + 'px';
    selEl.style.height = Math.abs(svSelRect.y2 - svSelRect.y1) + 'px';
  } else selEl.hidden = true;

  renderSVZoomOverlay(rect);
  renderSVMinimap(rect);
}

function renderSVZoomOverlay(rect) {
  const el = $('svZoomOverlay');
  if (!svClosing) { el.hidden = true; return; }
  el.hidden = false;
  const cropX = svZoom.sMin * rect.width, cropY = (1 - svZoom.vMax) * rect.height;
  const cropW = (svZoom.sMax - svZoom.sMin) * rect.width, cropH = (svZoom.vMax - svZoom.vMin) * rect.height;
  el.style.background = computeSquareBg(SV_FULL_ZOOM, pickerHue);
  el.style.transform = svClosing === 'start'
    ? `scale(${rect.width / cropW}, ${rect.height / cropH}) translate(${-cropX}px, ${-cropY}px)`
    : 'none';
  el.style.transition = svClosing === 'start' ? 'none' : `transform ${SV_ANIM_MS}ms ${SV_EASE}`;
}

function renderSVMinimap(rect) {
  const mini = $('svMinimap');
  if (!svIsZoomed(svZoom) && !svAnim && !svClosing) { mini.hidden = true; return; }
  mini.hidden = false;
  const restLeft = rect.width - SV_MAP - SV_MAP_INSET, restTop = SV_MAP_INSET;
  const mapBg = computeSquareBg(SV_FULL_ZOOM, pickerHue);
  mini.style.left = '0px'; mini.style.top = '0px';

  if (svAnim) {
    const start = svAnim.phase === 'start';
    mini.style.transform = start ? 'translate(0px, 0px)' : `translate(${restLeft}px, ${restTop}px)`;
    mini.style.width = (start ? rect.width : SV_MAP) + 'px';
    mini.style.height = (start ? rect.height : SV_MAP) + 'px';
    mini.style.background = svAnim.oldBg;
    mini.style.boxShadow = start ? 'none' : '0 2px 6px rgba(0,0,0,.35)';
    mini.style.opacity = 1;
    mini.style.transition = `transform ${SV_ANIM_MS}ms ${SV_EASE}, width ${SV_ANIM_MS}ms ${SV_EASE}, height ${SV_ANIM_MS}ms ${SV_EASE}, box-shadow ${SV_ANIM_MS}ms ${SV_EASE}`;
  } else if (svClosing) {
    mini.style.transform = `translate(${restLeft}px, ${restTop}px)`;
    mini.style.width = SV_MAP + 'px'; mini.style.height = SV_MAP + 'px';
    mini.style.background = mapBg;
    mini.style.boxShadow = '0 2px 6px rgba(0,0,0,.35)';
    mini.style.opacity = svClosing === 'start' ? 1 : 0;
    mini.style.transition = svClosing === 'start' ? 'none' : `opacity ${SV_ANIM_MS}ms ${SV_EASE}`;
  } else {
    mini.style.transform = `translate(${restLeft}px, ${restTop}px)`;
    mini.style.width = SV_MAP + 'px'; mini.style.height = SV_MAP + 'px';
    mini.style.background = mapBg;
    mini.style.boxShadow = '0 2px 6px rgba(0,0,0,.35)';
    mini.style.opacity = 1;
    mini.style.transition = 'none';
  }

  const overlayVisible = svClosing ? svClosing === 'start' : (svAnim ? svAnim.phase === 'end' : true);
  const overlayAnimated = Boolean(svClosing || svAnim);
  const win = $('svMiniWin'), clearBtn = $('svClearCrop');
  win.style.left = (svZoom.sMin * SV_MAP) + 'px';
  win.style.top = ((1 - svZoom.vMax) * SV_MAP) + 'px';
  win.style.width = ((svZoom.sMax - svZoom.sMin) * SV_MAP) + 'px';
  win.style.height = ((svZoom.vMax - svZoom.vMin) * SV_MAP) + 'px';
  win.style.opacity = clearBtn.style.opacity = overlayVisible ? 1 : 0;
  win.style.pointerEvents = clearBtn.style.pointerEvents = (svAnim || svClosing) ? 'none' : 'auto';
  const winTransition = overlayAnimated
    ? `opacity ${SV_ANIM_MS}ms ${SV_EASE}`
    : (svMorphing ? `left ${SV_ANIM_MS}ms ${SV_EASE}, top ${SV_ANIM_MS}ms ${SV_EASE}, width ${SV_ANIM_MS}ms ${SV_EASE}, height ${SV_ANIM_MS}ms ${SV_EASE}` : 'none');
  win.style.transition = winTransition;
  clearBtn.style.transition = overlayAnimated ? `opacity ${SV_ANIM_MS}ms ${SV_EASE}` : 'none';
}

// Triggers the square's 100ms cross-dissolve from `bg` to whatever renderSVSquare() sets next — used when the
// crop changes while already zoomed (a gray preset, or a shift-drag reselect), where there's no shrink/grow
// minimap animation to carry the transition instead.
function triggerSVBgFade(bg) {
  const el = $('svBgFade');
  el.hidden = false;
  el.style.background = bg;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}
$('svBgFade').addEventListener('animationend', () => { $('svBgFade').hidden = true; });

function applySVZoom(newZoom) {
  if (svIsZoomed(svZoom)) {
    triggerSVBgFade(computeSquareBg(svZoom, pickerHue));
    svZoom = newZoom;
    svMorphing = true;
    renderSVSquare();
    setTimeout(() => { svMorphing = false; }, SV_ANIM_MS + 50);
  } else {
    const oldBg = computeSquareBg(svZoom, pickerHue);
    svZoom = newZoom;
    svAnim = { phase: 'start', oldBg };
    renderSVSquare();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (svAnim && svAnim.phase === 'start') { svAnim = { ...svAnim, phase: 'end' }; renderSVSquare(); }
    }));
  }
}
$('svMinimap').addEventListener('transitionend', e => {
  if (e.propertyName === 'transform' && svAnim && svAnim.phase === 'end') { svAnim = null; renderSVSquare(); }
});
$('svZoomOverlay').addEventListener('transitionend', e => {
  if (e.propertyName === 'transform' && svClosing === 'end') { svZoom = SV_FULL_ZOOM; svClosing = null; renderSVSquare(); }
});
$('svClearCrop').addEventListener('click', e => {
  e.stopPropagation();
  svMorphing = false;
  svClosing = 'start';
  renderSVSquare();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (svClosing === 'start') { svClosing = 'end'; renderSVSquare(); }
  }));
});
// Inset the handle's travel by its own half-width so it stays fully inside the track instead of hanging its
// far edge out over the track's rounded end to reach the min/max color.
const HANDLE_RADIUS = 7;
function insetThumbLeft(frac, trackWidth) {
  return HANDLE_RADIUS + frac * Math.max(0, trackWidth - HANDLE_RADIUS * 2);
}
function positionPickerThumbs() {
  const hex = hsvToHex(pickerHue, pickerS, pickerV);
  $('hueThumb').style.left = insetThumbLeft(pickerHue / 360, $('hueTrack').clientWidth) + 'px';
  $('alphaThumb').style.left = insetThumbLeft(pickerA, $('alphaTrack').clientWidth) + 'px';
  $('alphaFill').style.background = `linear-gradient(to right, ${rgbaCss(hex, 0)}, ${hex})`;
}
function syncPickerFromColor(hex, a) {
  const { h, s, v } = hexToHsv(hex); pickerHue = h; pickerS = s; pickerV = v; if (a != null) pickerA = a;
  renderSVSquare(); positionPickerThumbs();
}
// Floats the picker over the canvas, anchored to the sidebar's left edge (8px gap) and vertically aligned
// with the swatch button — it no longer lives inside the panel's own scroll flow, so it can't clip against or
// overlap the sections below it.
function positionPicker() {
  const panel = document.querySelector('.panel'), swatch = grainKey ? grainAnchor : $('selSwatch');
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
  setGrainMode(null);
  svZoom = SV_FULL_ZOOM; svAnim = null; svClosing = null; svMorphing = false;
  $('colorPicker').hidden = false; pickerOpen = true; $('selSwatch').setAttribute('aria-expanded', 'true');
  refreshSelectionPanel();
  renderSVSquare(); positionPickerThumbs(); positionPicker();
}
function closePicker() { $('colorPicker').hidden = true; pickerOpen = false; $('selSwatch').setAttribute('aria-expanded', 'false'); setGrainMode(null); }

// The same picker also edits the grain colours (Mono / Duo): grain mode shows just the square and the hue slider and
// sends every change to state.grainColors instead of the selected nodes.
let grainKey = null, grainAnchor = null;
function setGrainMode(key, anchor = null) {
  grainKey = key; grainAnchor = anchor;
  $('colorPicker').classList.toggle('picker--grain', key !== null);
}
function toggleGrainPicker(field) {
  const key = field.dataset.grainColor;
  if (pickerOpen && grainKey === key) { closePicker(); return; }
  svZoom = SV_FULL_ZOOM; svAnim = null; svClosing = null; svMorphing = false;
  setGrainMode(key, field);
  $('selSwatch').setAttribute('aria-expanded', 'false');
  $('colorPicker').hidden = false; pickerOpen = true;
  syncPickerFromColor(state.grainColors[key], 1);
  renderSVSquare(); positionPickerThumbs(); positionPicker();
}
for (const field of document.querySelectorAll('.grain-field')) {
  field.addEventListener('click', e => { e.stopPropagation(); toggleGrainPicker(field); });
  field.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGrainPicker(field); } });
}
$('selSwatch').addEventListener('click', e => { e.stopPropagation(); pickerOpen ? closePicker() : openPicker(); });
document.addEventListener('pointerdown', e => { if (pickerOpen && !e.target.closest('.picker') && !e.target.closest('#selSwatch') && !e.target.closest('.grain-field')) closePicker(); });
document.addEventListener('keydown', e => { if (pickerOpen && e.key === 'Escape') { e.stopPropagation(); closePicker(); } }, true);
window.addEventListener('resize', () => { if (pickerOpen) { renderSVSquare(); positionPicker(); } });

const frac = (clientX, el) => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / r.width)); };
function pickerDrag(kind) {
  return e => {
    e.preventDefault(); pickerDragging = true; beginColorEdit();
    const first = curNode(), stopIdx = first && first.grad ? activeStop : null;
    const move = ev => {
      if (kind === 'hue') pickerHue = Math.min(359.99, frac(ev.clientX, $('hueTrack')) * 360);
      else pickerA = frac(ev.clientX, $('alphaTrack'));
      renderSVSquare(); positionPickerThumbs(); setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), false, pickerA, stopIdx);
    };
    const up = () => {
      pickerDragging = false; setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), true, pickerA, stopIdx);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    move(e); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
}
$('hueTrack').addEventListener('pointerdown', pickerDrag('hue'));
$('alphaTrack').addEventListener('pointerdown', pickerDrag('alpha'));

// SV square: a plain drag picks a colour within the current crop; a shift+drag selects a rectangle to zoom
// (crop) into, and dragging/resizing the minimap window (once zoomed) re-crops directly.
svSquare.addEventListener('pointerdown', e => {
  if (svAnim || svClosing) return;
  e.preventDefault();
  const rect = svSquare.getBoundingClientRect();
  if (e.shiftKey) {
    const { x, y } = svLocalPos(e.clientX, e.clientY, rect);
    svSelRect = { x1: x, y1: y, x2: x, y2: y };
    svSelecting = true;
    renderSVSquare();
    const move = ev => {
      const p = svLocalPos(ev.clientX, ev.clientY, rect);
      svSelRect = { ...svSelRect, x2: p.x, y2: p.y };
      renderSVSquare();
    };
    const up = () => {
      const r = svSelRect;
      const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2);
      const y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
      if (x2 - x1 > 8 && y2 - y1 > 8) {
        const [sA, vA] = svPixelToSV(x1, y1, rect);
        const [sB, vB] = svPixelToSV(x2, y2, rect);
        applySVZoom({ sMin: Math.min(sA, sB), sMax: Math.max(sA, sB), vMin: Math.min(vA, vB), vMax: Math.max(vA, vB) });
      }
      svSelRect = null; svSelecting = false; renderSVSquare();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  } else {
    const first = curNode(), stopIdx = first && first.grad ? activeStop : null;
    beginColorEdit(); pickerDragging = true;
    const move = ev => {
      const r = svSquare.getBoundingClientRect();
      const p = svLocalPos(ev.clientX, ev.clientY, r);
      const [s, v] = svPixelToSV(p.x, p.y, r);
      pickerS = s; pickerV = v;
      renderSVSquare(); setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), false, pickerA, stopIdx);
    };
    const up = () => {
      pickerDragging = false;
      setSelectedColor(hsvToHex(pickerHue, pickerS, pickerV), true, pickerA, stopIdx);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    move(e); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
});

function startSVDrag(mode, e) {
  e.preventDefault(); e.stopPropagation();
  svMorphing = false;
  svDragMode = mode;
  svDragStart = { x: e.clientX, y: e.clientY, zoom: svZoom };
}
$('svMiniWin').addEventListener('pointerdown', e => { if (!svAnim && !svClosing) startSVDrag('move', e); });
$('svMinimap').querySelectorAll('.sv-handle').forEach(h => {
  h.addEventListener('pointerdown', e => { if (!svAnim && !svClosing) startSVDrag(h.dataset.mode, e); });
});
window.addEventListener('pointermove', e => {
  const mode = svDragMode;
  if (!mode) return;
  const start = svDragStart.zoom;
  if (mode === 'move') {
    const dxPct = (e.clientX - svDragStart.x) / SV_MAP, dyPct = -(e.clientY - svDragStart.y) / SV_MAP;
    const width = start.sMax - start.sMin, height = start.vMax - start.vMin;
    let sMin = start.sMin + dxPct, sMax = sMin + width;
    if (sMin < 0) { sMin = 0; sMax = width; }
    if (sMax > 1) { sMax = 1; sMin = 1 - width; }
    let vMin = start.vMin + dyPct, vMax = vMin + height;
    if (vMin < 0) { vMin = 0; vMax = height; }
    if (vMax > 1) { vMax = 1; vMin = 1 - height; }
    svZoom = { sMin, sMax, vMin, vMax };
  } else {
    const rect = $('svMinimap').getBoundingClientRect();
    const s = clamp((e.clientX - rect.left) / SV_MAP, 0, 1), v = clamp(1 - (e.clientY - rect.top) / SV_MAP, 0, 1);
    let { sMin, sMax, vMin, vMax } = start;
    if (mode === 'nw') { sMin = clamp(s, 0, start.sMax - SV_MIN_SPAN); vMax = clamp(v, start.vMin + SV_MIN_SPAN, 1); }
    if (mode === 'ne') { sMax = clamp(s, start.sMin + SV_MIN_SPAN, 1); vMax = clamp(v, start.vMin + SV_MIN_SPAN, 1); }
    if (mode === 'sw') { sMin = clamp(s, 0, start.sMax - SV_MIN_SPAN); vMin = clamp(v, 0, start.vMax - SV_MIN_SPAN); }
    if (mode === 'se') { sMax = clamp(s, start.sMin + SV_MIN_SPAN, 1); vMin = clamp(v, 0, start.vMax - SV_MIN_SPAN); }
    svZoom = { sMin, sMax, vMin, vMax };
  }
  renderSVSquare();
});
window.addEventListener('pointerup', () => { svDragMode = null; });
