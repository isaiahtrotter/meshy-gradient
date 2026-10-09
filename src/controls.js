// Right-hand panel controls: canvas size (typed or scrubbed), blend/variation sliders, align, shuffle,
// scatter, and the selection buttons. syncControlsFromState() pushes state back into the inputs.

import { MOBILE_BREAKPOINT, CANVAS_MIN, CANVAS_MAX, clamp } from './constants.js';
import { state, targetNodes, addNode, setCanvasSize as setCanvasSizeState } from './state.js';
import { snapshot, pushUndo, undo, redo } from './undo.js';
import { $ } from './dom.js';
import { layout, draw } from './view.js';
import { refreshAll } from './refresh.js';
import { deleteSelected, flipSelected, toggleLinkSelected } from './actions.js';

// ---------- Canvas size ----------
function applyCanvasSizeLive(w, h) { setCanvasSizeState(w, h); $('cw').value = state.w; $('ch').value = state.h; layout(); }
function commitCanvasSize(w, h) {
  w = clamp(Math.round(w) || CANVAS_MIN, CANVAS_MIN, CANVAS_MAX); h = clamp(Math.round(h) || CANVAS_MIN, CANVAS_MIN, CANVAS_MAX);
  if (w === state.w && h === state.h) return;
  pushUndo(); applyCanvasSizeLive(w, h);
}
$('cw').addEventListener('change', () => commitCanvasSize(+$('cw').value, state.h));
$('ch').addEventListener('change', () => commitCanvasSize(state.w, +$('ch').value));

// Drag-to-scrub a numeric input. With threshold 0 the drag engages immediately (desktop prefix letter). With a
// threshold it engages only after that much movement, so a plain tap still focuses the input (mobile, dragging on
// the input). The pointer is captured rather than locked: pointer lock makes the browser show its "Press Esc to
// show your cursor" notice, which isn't wanted. A page can't warp the pointer to the other side of the screen, so instead,
// while the pointer rests against the left or right screen edge the value keeps running that way (EDGE_SPEED).
const EDGE_SPEED = 500; // px/s of scrub while the pointer sits against a screen edge
export function attachScrub(trigger, input, { onInput, threshold = 0, mobileOnly = false, sensitivity = 1 } = {}) {
  trigger.addEventListener('pointerdown', e => {
    if (input.disabled) return;
    if (mobileOnly && window.innerWidth > MOBILE_BREAKPOINT) return;
    const startVal = +input.value || 0, startX = e.clientX;
    const min = input.min !== '' ? +input.min : -Infinity, max = input.max !== '' ? +input.max : Infinity;
    const snap = onInput ? snapshot() : null;
    let engaged = false, lastVal = startVal, lastX = startX, edgeOff = 0, edgeDir = 0, edgeRaf = 0, edgeT = 0;
    const engage = () => {
      engaged = true;
      try { trigger.setPointerCapture(e.pointerId); } catch {}
      if (threshold) input.blur();
      document.body.classList.add('scrubbing');
    };
    const apply = dx => {
      const v = clamp(Math.round(startVal + dx * sensitivity), min, max);
      if (v === lastVal) return;
      lastVal = v; input.value = v;
      if (onInput) onInput(v); else input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const edgeStep = t => {
      if (!edgeDir) { edgeRaf = 0; return; }
      edgeOff += edgeDir * EDGE_SPEED * Math.min(50, t - edgeT) / 1000; edgeT = t;
      apply(lastX - startX + edgeOff);
      edgeRaf = requestAnimationFrame(edgeStep);
    };
    const move = ev => {
      if (!engaged) { if (Math.abs(ev.clientX - startX) < threshold) return; engage(); }
      lastX = ev.clientX;
      edgeDir = lastX <= 1 ? -1 : lastX >= window.innerWidth - 2 ? 1 : 0;
      if (edgeDir && !edgeRaf) { edgeT = performance.now(); edgeRaf = requestAnimationFrame(edgeStep); }
      apply(lastX - startX + edgeOff);
    };
    const up = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      edgeDir = 0; cancelAnimationFrame(edgeRaf); edgeRaf = 0;
      if (!engaged) return;
      document.body.classList.remove('scrubbing');
      try { trigger.releasePointerCapture(ev.pointerId); } catch {}
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
$('mobileDelBtn').addEventListener('click', deleteSelected);
$('mobileLinkBtn').addEventListener('click', toggleLinkSelected);
$('mobileFlipXBtn').addEventListener('click', () => flipSelected('x'));
$('mobileFlipYBtn').addEventListener('click', () => flipSelected('y'));
$('undoTopBtn').addEventListener('click', undo);
$('redoTopBtn').addEventListener('click', redo);
$('mobileUndoBtn').addEventListener('click', undo);
$('mobileRedoBtn').addEventListener('click', redo);

// ---------- Sliders ----------
// Softness and grain map the 0..1 range input onto data-min..data-max.
// Set on the .slider wrapper (not the input) so a sibling overlay, like .adj-glow, inherits it too.
function sliderFill(el) {
  const slider = el.closest('.slider');
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100;
  slider.style.setProperty('--pct', pct + '%');
  slider.style.setProperty('--pct-frac', String(pct / 100)); // unitless twin of --pct, for calc() maths in px

  // At the exact ends, push the glow-bar handle a little further out so it tucks fully behind the rounded
  // corner (clipped by .slider's overflow: hidden) instead of a thin line sitting right on the edge.
  slider.style.setProperty('--handle-shift', pct <= 0 ? '-4px' : pct >= 100 ? '4px' : '0px');
}
// A slider's readout, plus any [data-mirror] copies of it (the Softness slider's blurred replica has one).
function setOut(id, text) {
  $(id).textContent = text;
  for (const m of document.querySelectorAll(`[data-mirror="${id}"]`)) m.textContent = text;
}
function mappedValue(el) { const min = +el.dataset.min, max = +el.dataset.max; return min + (+el.value) * (max - min); }
function reverseMapped(el, val) { const min = +el.dataset.min, max = +el.dataset.max; return (val - min) / (max - min); }

const BLEND_MODES = ['normal', 'linear', 'multiply', 'screen', 'overlay', 'softlight', 'lighten', 'darken'];
const BLEND_MODE_LABELS = { normal: 'Normal', linear: 'Linear', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', softlight: 'Soft light', lighten: 'Lighten', darken: 'Darken' };

const SLIDERS = [
  { id: 'soft', out: 'softVal', get: () => reverseMapped($('soft'), state.soft), set: el => { state.soft = mappedValue(el); }, fmt: v => v.toFixed(2) },
  { id: 'blendMode', out: 'blendModeVal', get: () => BLEND_MODES.indexOf(state.blendMode), set: el => { state.blendMode = BLEND_MODES[Math.round(+el.value)]; }, fmt: v => BLEND_MODE_LABELS[BLEND_MODES[Math.round(v)]] },
  { id: 'grain', out: 'grainVal', get: () => reverseMapped($('grain'), state.grain), set: el => { state.grain = mappedValue(el); }, fmt: v => v.toFixed(2) },
  { id: 'grainSize', out: 'grainSizeVal', get: () => state.grainSize, set: el => { state.grainSize = +el.value; }, fmt: v => v.toFixed(1) },
  { id: 'density', out: 'densityVal', get: () => state.density, set: el => { state.density = +el.value; }, fmt: v => v.toFixed(1) },
  { id: 'adjHue', out: 'adjHueVal', get: () => state.adj.hue, set: el => { state.adj.hue = +el.value; }, fmt: v => String(Math.round(v)) },
  { id: 'adjSat', out: 'adjSatVal', get: () => state.adj.sat, set: el => { state.adj.sat = +el.value; }, fmt: v => v.toFixed(2) },
  { id: 'adjBri', out: 'adjBriVal', get: () => state.adj.bri, set: el => { state.adj.bri = +el.value; }, fmt: v => v.toFixed(2) },
  { id: 'adjTemp', out: 'adjTempVal', get: () => state.adj.temp, set: el => { state.adj.temp = +el.value; }, fmt: v => String(Math.round(v)) },
];
for (const s of SLIDERS) {
  const el = $(s.id);
  // A stale cached page (HTML/JS version mismatch) could be missing an element the current JS expects; skip
  // that one control instead of throwing and leaving every remaining control in this file unwired.
  if (!el) { console.error(`Missing #${s.id} — reload the page (a hard refresh if that doesn't fix it).`); continue; }
  let dragSnap = null;
  el.addEventListener('pointerdown', () => {
    dragSnap = snapshot();
    // a manual drag interrupting a right-click reset's animation would otherwise fight it for el.value each frame
    if (sliderAnims.has(el)) { cancelAnimationFrame(sliderAnims.get(el)); sliderAnims.delete(el); el.classList.remove('glow-active'); }
  });
  el.addEventListener('input', e => { s.set(e.target); sliderFill(e.target); setOut(s.out, s.fmt(+e.target.value)); draw(); });
  el.addEventListener('change', () => { if (dragSnap) { pushUndo(dragSnap); dragSnap = null; } });
  // Touch/pen drag. The native range thumb is 0px wide (see styles.css), so a finger can only tap-to-jump; this makes a
  // horizontal drag anywhere on the slider scrub it. Vertical swipes still scroll the panel (touch-action: pan-y), so
  // nothing engages until the finger has moved sideways a few px; a plain tap is left to the native jump.
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || el.disabled) return;
    const startX = e.clientX, startY = e.clientY;
    let engaged = false;
    const setFromX = x => {
      const r = el.getBoundingClientRect(), min = +el.min || 0, max = +el.max || 100, step = +el.step || 1;
      const v = clamp(min + Math.round(((x - r.left) / r.width * (max - min)) / step) * step, min, max);
      if (v === +el.value) return;
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const move = ev => {
      if (ev.pointerId !== e.pointerId) return;
      if (!engaged) {
        if (Math.abs(ev.clientX - startX) < 6 || Math.abs(ev.clientX - startX) < Math.abs(ev.clientY - startY)) return;
        engaged = true;
        try { el.setPointerCapture(e.pointerId); } catch {}
      }
      setFromX(ev.clientX);
    };
    const end = ev => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end);
      if (engaged) el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  });
  // Right-click resets it to its built-in default (the input's own initial `value` attribute, i.e. defaultValue),
  // animating there over 100ms with the same hover-preview glow a real drag shows.
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    const def = +el.defaultValue;
    if (Math.abs(+el.value - def) < 1e-6) return; // already at default: nothing to animate or undo
    const snap = snapshot();
    animateSliderTo(el, def, {
      duration: 100,
      onFrame: v => { s.set(el); setOut(s.out, s.fmt(v)); draw(); },
      onDone: () => pushUndo(snap),
    });
  });
}

$('grainType').addEventListener('click', e => {
  const b = e.target.closest('button[data-grain-type]'); if (!b) return;
  pushUndo();
  state.grainType = b.dataset.grainType;
  for (const btn of $('grainType').querySelectorAll('button[data-grain-type]')) btn.setAttribute('aria-pressed', String(btn === b));
  syncGrainColors();
  draw();
});

// Grain colours: Mono shows one swatch, Duo two, Multi none (it's random RGB). Each is a native colour input laid over
// its field; clicking one opens the shared colour picker (colorPanel.js).
const GRAIN_FIELDS = { mono: ['mono'], duo: ['duoA', 'duoB'], multi: [] };
export function syncGrainColors() {
  $('grainColors').hidden = GRAIN_FIELDS[state.grainType].length === 0; // Multi has none: no empty row, no extra gap
  for (const f of $('grainColors').querySelectorAll('.grain-field')) {
    const key = f.dataset.grainColor, hex = state.grainColors[key];
    f.hidden = !GRAIN_FIELDS[state.grainType].includes(key);
    f.querySelector('.swatch').style.setProperty('--sw', hex);
    const input = f.querySelector('.gc-hex');
    if (document.activeElement !== input) input.value = hex.slice(1).toUpperCase(); // never rewrite what's being typed
  }
}

// Animates a range input's handle (and readout) to a new value; used when a preset lands, and to reset a
// slider to its default on right-click (below). glow-active shows the same hover-preview glow a real drag would.
const sliderAnims = new Map();
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
function animateSliderTo(el, target, { delay = 0, duration = 150, onFrame, onDone } = {}) {
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
    else { sliderAnims.delete(el); el.classList.remove('glow-active'); if (onDone) onDone(); }
  }
  sliderAnims.set(el, requestAnimationFrame(step));
}

let grainTypeTimer = null;
function setGrainTypeButtons() {
  for (const btn of $('grainType').querySelectorAll('button[data-grain-type]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.grainType === state.grainType));
  }
}

// animate: false (snap instantly — boot/restore-from-storage), 'ripple' (a preset landing: every slider
// glides in a staggered wave), or 'settle' (undo/redo: only the sliders whose value actually changed glide to
// it on their own, the same 100ms ease-out glow-preview a right-click reset uses — nothing ripples).
export function syncControlsFromState({ animate = false } = {}) {
  $('cw').value = state.w; $('ch').value = state.h;
  clearTimeout(grainTypeTimer);
  // Mono/Duo/Multi sit right above the "Opacity" (grain) slider, so they should flip at the same point in the
  // ripple as that slider does instead of snapping immediately, ahead of the animation reaching them.
  const grainDelay = SLIDERS.findIndex(s => s.id === 'grain') * 25;
  if (animate === 'ripple') grainTypeTimer = setTimeout(setGrainTypeButtons, grainDelay); else setGrainTypeButtons();
  syncGrainColors();
  SLIDERS.forEach((s, i) => {
    const el = $(s.id), target = s.get();
    if (animate === 'ripple') animateSliderTo(el, target, { delay: i * 25, onFrame: v => { setOut(s.out, s.fmt(v)); } });
    else if (animate === 'settle' && Math.abs(+el.value - target) > 1e-6) {
      animateSliderTo(el, target, { duration: 100, onFrame: v => { setOut(s.out, s.fmt(v)); } });
    } else { el.value = target; sliderFill(el); setOut(s.out, s.fmt(+el.value)); }
  });
}

// ---------- Seeding, shuffle + scatter (bottom toolbar), align ----------
export function seedNodes(colours) {
  const spots = [[0.15, 0.2], [0.8, 0.15], [0.25, 0.85], [0.85, 0.8], [0.5, 0.5]];
  colours.forEach((c, i) => addNode('circle', spots[i % spots.length][0] + (Math.random() - .5) * .1, spots[i % spots.length][1] + (Math.random() - .5) * .1, c, 0.45 + Math.random() * 0.15));
}
const shuffleArr = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } };
// Shuffles in place but never lands back on the same arrangement (two or three colours would otherwise do so a
// good share of the time, and the click would look dead). Only an array of all-equal colours can't change.
function shuffleChanged(arr) {
  const before = arr.slice(), same = () => arr.every((c, i) => c === before[i]);
  if (before.every(c => c === before[0])) return;
  do shuffleArr(arr); while (same());
}
$('shuffle').addEventListener('click', () => {
  pushUndo();
  const target = targetNodes();
  // A gradient node's fill comes from its gradStops, so its plain `color` isn't shown: leave it out of the shuffle
  // (it would only swap with the visible solid colours and dull them), and shuffle the solid nodes' colours among
  // themselves.
  const solid = target.filter(n => !n.grad), cols = solid.map(n => n.color);
  shuffleChanged(cols);
  solid.forEach((n, i) => { n.color = cols[i]; });
  // Gradient nodes: shuffle each stop's colour among all stops across every gradient node in the target, so a
  // gradient's ramp doesn't stay frozen.
  const gradNodes = target.filter(n => n.grad);
  const stopCols = gradNodes.flatMap(n => n.gradStops.map(s => s.color));
  shuffleChanged(stopCols);
  let k = 0;
  for (const n of gradNodes) for (const s of n.gradStops) s.color = stopCols[k++];
  state.seed = Math.random() * 1000; refreshAll();
});
$('scatter').addEventListener('click', () => {
  pushUndo();
  targetNodes().forEach(n => { n.x = Math.random() * 1.1 - 0.05; n.y = Math.random() * 1.1 - 0.05; });
  refreshAll();
});
$('alignSection').addEventListener('animationend', e => e.target.closest('.align-btn')?.classList.remove('pop')); // drops the goo filter so the idle icons stay crisp
$('alignSection').addEventListener('click', e => {
  const b = e.target.closest('button[data-axis]'); if (!b) return;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); // restart the 100ms pill animation (styles.css)
  const target = targetNodes(); if (!target.length) return;
  pushUndo();
  target.forEach(n => { n[b.dataset.axis] = +b.dataset.val; });
  refreshAll();
});

// A plain click selects everything (the old behaviour); a click-drag to select part of the value is left
// alone instead of being stomped by an immediate select-all on focus. Distance, not selectionStart/End,
// because number inputs don't expose a selection range in every browser. Keyboard (Tab) focus, which never
// touches pointerdown, still selects all immediately like before.
for (const inp of document.querySelectorAll('input[type=number], input[type=text]')) {
  let downX = null;
  inp.addEventListener('pointerdown', e => { downX = e.clientX; });
  inp.addEventListener('focus', () => { if (downX === null) inp.select(); });
  inp.addEventListener('pointerup', e => {
    if (downX !== null && Math.abs(e.clientX - downX) < 3) inp.select();
    downX = null;
  });
}

// Fade the panel's own scrollbar-less top/bottom edges in only while there's more content to scroll that
// way. A MutationObserver (not just scroll/resize) because content height changes without scrolling too —
// presets rendering in, a section showing or hiding.
{
  const panelScroll = $('panelScroll');
  const fadeTop = document.querySelector('.panel-fade-top'), fadeBottom = document.querySelector('.panel-fade-bottom');
  const updatePanelFades = () => {
    const { scrollTop, scrollHeight, clientHeight } = panelScroll;
    fadeTop.classList.toggle('visible', scrollTop > 1);
    fadeBottom.classList.toggle('visible', scrollTop + clientHeight < scrollHeight - 1);
  };
  panelScroll.addEventListener('scroll', updatePanelFades);
  window.addEventListener('resize', updatePanelFades);
  new MutationObserver(updatePanelFades).observe(panelScroll, { childList: true, subtree: true, attributes: true });
  updatePanelFades();
}

// Mobile: drag the handle on the settings panel's top edge to trade canvas height for settings height. Sets --stage-h on
// .app (the stage's grid row); the stage's ResizeObserver (view.js) re-fits the canvas as it changes.
{
  const grip = $('panelGrip'), app = document.querySelector('.app');
  if (grip && app) grip.addEventListener('pointerdown', e => {
    const stage = document.querySelector('.stage'), startY = e.clientY, startH = stage.getBoundingClientRect().height;
    const appH = app.getBoundingClientRect().height, minH = Math.round(appH * 0.3), maxH = appH - 140; // keep some canvas and some settings in view
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const move = ev => app.style.setProperty('--stage-h', `${Math.round(clamp(startH + ev.clientY - startY, minH, maxH))}px`);
    const end = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    e.preventDefault();
  });
}
