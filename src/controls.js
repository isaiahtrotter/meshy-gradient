// Right-hand panel controls: canvas size (typed or scrubbed), blend/variation sliders, palettes, align, shuffle,
// scatter, and the selection buttons. syncControlsFromState() pushes state back into the inputs.

import { MOBILE_BREAKPOINT, CANVAS_MIN, CANVAS_MAX, clamp } from './constants.js';
import { state, targetNodes, addNode, setCanvasSize as setCanvasSizeState } from './state.js';
import { snapshot, pushUndo, undo, redo } from './undo.js';
import { $ } from './dom.js';
import { layout, draw } from './view.js';
import { refreshAll } from './refresh.js';
import { deleteSelected, selectAllNodes } from './actions.js';

// ---------- Canvas size ----------
function applyCanvasSizeLive(w, h) { setCanvasSizeState(w, h); $('cw').value = state.w; $('ch').value = state.h; layout(); }
function commitCanvasSize(w, h) {
  w = clamp(Math.round(w) || CANVAS_MIN, CANVAS_MIN, CANVAS_MAX); h = clamp(Math.round(h) || CANVAS_MIN, CANVAS_MIN, CANVAS_MAX);
  if (w === state.w && h === state.h) return;
  pushUndo(); applyCanvasSizeLive(w, h);
}
$('cw').addEventListener('change', () => commitCanvasSize(+$('cw').value, state.h));
$('ch').addEventListener('change', () => commitCanvasSize(state.w, +$('ch').value));

// Drag-to-scrub a numeric input. With threshold 0 the drag engages immediately (desktop prefix letter, pointer
// locked for mice so the cursor can't hit the screen edge). With a threshold it engages only after that much
// movement, so a plain tap still focuses the input (mobile, dragging on the input itself).
function attachScrub(trigger, input, { onInput, threshold = 0, mobileOnly = false } = {}) {
  trigger.addEventListener('pointerdown', e => {
    if (input.disabled) return;
    if (mobileOnly && window.innerWidth > MOBILE_BREAKPOINT) return;
    const startVal = +input.value || 0, startX = e.clientX;
    const min = input.min !== '' ? +input.min : -Infinity, max = input.max !== '' ? +input.max : Infinity;
    const snap = onInput ? snapshot() : null;
    let engaged = false, locked = false, lastVal = startVal, accum = 0;
    const engage = () => {
      engaged = true;
      locked = threshold === 0 && e.pointerType === 'mouse' && !!trigger.requestPointerLock;
      if (locked) trigger.requestPointerLock(); else { try { trigger.setPointerCapture(e.pointerId); } catch {} }
      if (threshold) input.blur();
      document.body.classList.add('scrubbing');
    };
    const apply = dx => {
      const v = clamp(Math.round(startVal + dx), min, max);
      if (v === lastVal) return;
      lastVal = v; input.value = v;
      if (onInput) onInput(v); else input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const move = ev => {
      if (!engaged) { if (Math.abs(ev.clientX - startX) < threshold) return; engage(); }
      if (locked) { accum += ev.movementX; apply(accum); } else apply(ev.clientX - startX);
    };
    const up = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!engaged) return;
      document.body.classList.remove('scrubbing');
      if (locked) { if (document.pointerLockElement === trigger) document.exitPointerLock(); }
      else { try { trigger.releasePointerCapture(ev.pointerId); } catch {} }
      if (snap && lastVal !== startVal) pushUndo(snap);
      if (!onInput) input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (threshold === 0) { e.preventDefault(); engage(); }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
}
const scrubW = v => applyCanvasSizeLive(v, state.h), scrubH = v => applyCanvasSizeLive(state.w, v);
attachScrub($('cwScrub'), $('cw'), { onInput: scrubW });
attachScrub($('chScrub'), $('ch'), { onInput: scrubH });
attachScrub($('cw'), $('cw'), { onInput: scrubW, threshold: 6, mobileOnly: true });
attachScrub($('ch'), $('ch'), { onInput: scrubH, threshold: 6, mobileOnly: true });

// ---------- Selection buttons ----------
$('delBtn').addEventListener('click', deleteSelected);
$('selAll').addEventListener('click', selectAllNodes);
$('undoBtn').addEventListener('click', undo);
$('mobileUndoBtn').addEventListener('click', undo);
$('mobileRedoBtn').addEventListener('click', redo);

// ---------- Sliders ----------
// Softness and grain map the 0..1 range input onto data-min..data-max.
// Set on the .slider wrapper (not the input) so a sibling overlay, like .adj-glow, inherits it too.
function sliderFill(el) { el.closest('.slider').style.setProperty('--pct', ((+el.value - +el.min) / (+el.max - +el.min)) * 100 + '%'); }
function mappedValue(el) { const min = +el.dataset.min, max = +el.dataset.max; return min + (+el.value) * (max - min); }
function reverseMapped(el, val) { const min = +el.dataset.min, max = +el.dataset.max; return (val - min) / (max - min); }

const BLEND_MODES = ['normal', 'linear', 'multiply', 'screen', 'overlay'];
const BLEND_MODE_LABELS = { normal: 'Normal', linear: 'Linear', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay' };

const SLIDERS = [
  { id: 'soft', out: 'softVal', get: () => reverseMapped($('soft'), state.soft), set: el => { state.soft = mappedValue(el); }, fmt: v => v.toFixed(2) },
  { id: 'blendMode', out: 'blendModeVal', get: () => BLEND_MODES.indexOf(state.blendMode), set: el => { state.blendMode = BLEND_MODES[Math.round(+el.value)]; }, fmt: v => BLEND_MODE_LABELS[BLEND_MODES[Math.round(v)]] },
  { id: 'grain', out: 'grainVal', get: () => reverseMapped($('grain'), state.grain), set: el => { state.grain = mappedValue(el); }, fmt: v => v.toFixed(2) },
  { id: 'grainSize', out: 'grainSizeVal', get: () => state.grainSize, set: el => { state.grainSize = +el.value; }, fmt: v => v.toFixed(1) },
  { id: 'density', out: 'densityVal', get: () => state.density, set: el => { state.density = +el.value; }, fmt: v => v.toFixed(1) },
  { id: 'adjHue', out: 'adjHueVal', get: () => state.adj.hue, set: el => { state.adj.hue = +el.value; }, fmt: v => String(Math.round(v)) },
  { id: 'adjSat', out: 'adjSatVal', get: () => state.adj.sat, set: el => { state.adj.sat = +el.value; }, fmt: v => v.toFixed(2) },
  { id: 'adjBri', out: 'adjBriVal', get: () => state.adj.bri, set: el => { state.adj.bri = +el.value; }, fmt: v => v.toFixed(2) },
];
for (const s of SLIDERS) {
  const el = $(s.id);
  // A stale cached page (HTML/JS version mismatch) could be missing an element the current JS expects; skip
  // that one control instead of throwing and leaving every remaining control in this file unwired.
  if (!el) { console.error(`Missing #${s.id} — reload the page (a hard refresh if that doesn't fix it).`); continue; }
  let dragSnap = null;
  el.addEventListener('pointerdown', () => { dragSnap = snapshot(); });
  el.addEventListener('input', e => { s.set(e.target); sliderFill(e.target); $(s.out).textContent = s.fmt(+e.target.value); draw(); });
  el.addEventListener('change', () => { if (dragSnap) { pushUndo(dragSnap); dragSnap = null; } });
}

$('grainType').addEventListener('click', e => {
  const b = e.target.closest('button[data-grain-type]'); if (!b) return;
  pushUndo();
  state.grainType = b.dataset.grainType;
  for (const btn of $('grainType').querySelectorAll('button[data-grain-type]')) btn.setAttribute('aria-pressed', String(btn === b));
  draw();
});

// Animates a range input's handle (and readout) to a new value; used when a preset lands.
const sliderAnims = new Map();
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
function animateSliderTo(el, target, { delay = 0, duration = 150, onFrame } = {}) {
  if (sliderAnims.has(el)) cancelAnimationFrame(sliderAnims.get(el));
  const start = +el.value, startTime = performance.now() + delay;
  let started = false;
  function step(now) {
    if (!started && now >= startTime) { started = true; el.classList.add('glow-active'); }
    const t = Math.min(1, Math.max(0, (now - startTime) / duration));
    const val = start + (target - start) * easeOutCubic(t);
    el.value = val; sliderFill(el);
    if (onFrame) onFrame(val);
    if (now < startTime + duration) sliderAnims.set(el, requestAnimationFrame(step));
    else { sliderAnims.delete(el); el.classList.remove('glow-active'); }
  }
  sliderAnims.set(el, requestAnimationFrame(step));
}

export function syncControlsFromState({ animate = false } = {}) {
  $('cw').value = state.w; $('ch').value = state.h;
  for (const btn of $('grainType').querySelectorAll('button[data-grain-type]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.grainType === state.grainType));
  }
  SLIDERS.forEach((s, i) => {
    const el = $(s.id), target = s.get(), out = $(s.out);
    if (animate) animateSliderTo(el, target, { delay: (SLIDERS.length - 1 - i) * 25, onFrame: v => { out.textContent = s.fmt(v); } });
    else { el.value = target; sliderFill(el); out.textContent = s.fmt(+el.value); }
  });
}

// ---------- Palettes, shuffle, scatter, align ----------
export function seedNodes(p) {
  const spots = [[0.15, 0.2], [0.8, 0.15], [0.25, 0.85], [0.85, 0.8], [0.5, 0.5]];
  p.forEach((c, i) => addNode('circle', spots[i % spots.length][0] + (Math.random() - .5) * .1, spots[i % spots.length][1] + (Math.random() - .5) * .1, c, 0.45 + Math.random() * 0.15));
}
export function renderPalettes(palettes) {
  const wrap = $('palettes');
  palettes.forEach((p, i) => {
    const b = document.createElement('button'); b.className = 'pal'; b.title = `Palette ${i + 1}`; b.setAttribute('aria-label', `Apply palette ${i + 1}`);
    b.innerHTML = p.map(c => `<span style="background:${c}"></span>`).join('');
    b.addEventListener('click', () => {
      pushUndo();
      if (!state.nodes.length) seedNodes(p);
      else targetNodes().forEach((n, i) => { n.color = p[i % p.length]; });
      refreshAll();
    });
    wrap.appendChild(b);
  });
}
$('shuffle').addEventListener('click', () => {
  pushUndo();
  const target = targetNodes(), cols = target.map(n => n.color);
  for (let i = cols.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cols[i], cols[j]] = [cols[j], cols[i]]; }
  target.forEach((n, i) => { n.color = cols[i]; });
  state.seed = Math.random() * 1000; refreshAll();
});
$('scatter').addEventListener('click', () => {
  pushUndo();
  targetNodes().forEach(n => { n.x = Math.random() * 1.1 - 0.05; n.y = Math.random() * 1.1 - 0.05; });
  refreshAll();
});
$('alignSection').addEventListener('click', e => {
  const b = e.target.closest('button[data-axis]'); if (!b) return;
  const target = targetNodes(); if (!target.length) return;
  pushUndo();
  target.forEach(n => { n[b.dataset.axis] = +b.dataset.val; });
  refreshAll();
});

for (const inp of document.querySelectorAll('input[type=number], input[type=text]')) inp.addEventListener('focus', () => inp.select());
