// Pointer interaction on the stage: the `session.drag` state machine.
//   spread  – dragging an arm end: sets that arm's length and angle
//   hard    – dragging the dotted ring: radial motion sets hardness, orbiting rotates the axis cross
//   move    – dragging selected nodes (alt/ctrl duplicates them)
//   marquee – rubber-band selection; a plain click adds a node instead
//   pan     – middle button or space + drag

import { MAXN } from './constants.js';
import { state, nodeById, cloneNode, addNode, selectOnly, toggleSelected, removeNodes } from './state.js';
import { session } from './session.js';
import { snapshot, pushUndo } from './undo.js';
import { armAngle, SIDE_KEY, ANGLE_KEY, OPPOSITE_SIDE } from './nodes.js';
import { wrapAngle } from './geometry.js';
import { stage, overlay, work, normPos, maxDim, frameRect, setStatus } from './dom.js';
import { view, applyPan, draw } from './view.js';
import { handleEls, hardToRadius, radiusToHard, HARD_K_MIN, HARD_K_MAX, armScale, updateHardIndicator, refreshHandles } from './handles.js';
import { refreshSelectionPanel } from './colorPanel.js';
import { refreshAll, refreshSelection } from './refresh.js';
import { colorAtCanvasPoint } from './sampling.js';
import { pendingNodeType, setPlacement } from './modes.js';

const marquee = document.getElementById('marquee');

overlay.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const p = normPos(e);
  const sh = e.target.closest('.spread-handle');
  if (sh) {
    const n = nodeById(+sh.dataset.id); if (!n) return;
    const side = sh.dataset.side;
    session.drag = { type: 'spread', n, side, snap: snapshot(), moved: false, lockAngle: armAngle(n, side) };
    overlay.setPointerCapture(e.pointerId); return;
  }
  const ring = e.target.closest('.hard-ring');
  if (ring) {
    const n = nodeById(+ring.dataset.id); if (!n) return;
    const d0 = maxDim(), dx0 = p.px - n.x * d0.w, dy0 = p.py - n.y * d0.h;
    session.drag = {
      type: 'hard', n, snap: snapshot(), moved: false, r: hardToRadius(n.k), lastDist: Math.hypot(dx0, dy0),
      startAngle: Math.atan2(dy0, dx0), startTh: n.th, startTh2: n.type === 'circle' ? n.th2 : 0,
    };
    ring.classList.add('active'); stage.classList.add('hard-dragging');
    overlay.setPointerCapture(e.pointerId); return;
  }
  const h = e.target.closest('.handle');
  if (h) {
    const id = +h.dataset.id;
    const additive = e.metaKey || e.shiftKey; // ctrl is reserved for duplicate-drag on Windows
    if (!state.selected.has(id)) { if (additive) state.selected.add(id); else selectOnly(id); }
    else if (additive) { state.selected.delete(id); refreshAll(); return; }
    const sourceIds = [...state.selected];
    const sourceStart = new Map(sourceIds.map(sid => { const nd = nodeById(sid); return [sid, { x: nd.x, y: nd.y }]; }));
    session.drag = { type: 'move', start: p, snap: snapshot(), moved: false, duplicating: false, cloneIds: null, sourceIds, sourceStart, orig: origFrom(sourceIds, sourceStart) };
    markDragging();
    updateDuplicateMode(e.altKey || e.ctrlKey);
  } else {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) state.selected.clear();
    session.drag = { type: 'marquee', start: p, base: new Set(state.selected), moved: false, additive };
    refreshSelection();
  }
  overlay.setPointerCapture(e.pointerId);
});

const origFrom = (ids, starts) => ids.map(sid => ({ n: nodeById(sid), x: starts.get(sid).x, y: starts.get(sid).y }));
function markDragging() {
  overlay.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  for (const o of session.drag.orig) { const el = handleEls.get(o.n.id); if (el) el.classList.add('dragging'); }
}
// Alt/ctrl during a move drag: the sources snap back and clones follow the pointer instead. Releasing the key
// mid-drag discards the clones and resumes moving the sources.
function updateDuplicateMode(active) {
  const drag = session.drag;
  if (!drag || drag.type !== 'move' || active === drag.duplicating) return;
  if (active) {
    for (const sid of drag.sourceIds) { const st = drag.sourceStart.get(sid), src = nodeById(sid); if (src) { src.x = st.x; src.y = st.y; } }
    const clones = drag.sourceIds.map(sid => { const st = drag.sourceStart.get(sid), c = cloneNode(nodeById(sid)); c.x = st.x; c.y = st.y; return c; });
    state.nodes.push(...clones);
    drag.cloneIds = clones.map(c => c.id);
    state.selected = new Set(drag.cloneIds);
    drag.orig = clones.map(c => ({ n: c, x: c.x, y: c.y }));
  } else {
    if (drag.cloneIds) { removeNodes(new Set(drag.cloneIds)); drag.cloneIds = null; }
    state.selected = new Set(drag.sourceIds);
    drag.orig = origFrom(drag.sourceIds, drag.sourceStart);
  }
  drag.duplicating = active;
  refreshSelection();
  markDragging();
}

function moveSpread(drag, p, e) {
  drag.moved = true;
  const n = drag.n, d = maxDim(), dx = p.px - n.x * d.w, dy = p.py - n.y * d.h, scale = armScale(n, d);
  const isArc = n.type === 'arc';
  // linked: an arc's arms mirror each other (dragging one end sets the dip for both, so the node stays the apex)
  // and a circle's l/r or t/b share one axis angle. Unlinked: each arm keeps its own angle.
  const setAngle = ang => {
    if (!n.linked) { n[ANGLE_KEY[drag.side]] = ang; return; }
    if (isArc) { n.phi = wrapAngle(drag.side === 'r' ? ang - n.th : n.th + Math.PI - ang); return; }
    if (drag.side === 'r') n.th = ang; else if (drag.side === 'l') n.th = ang - Math.PI;
    else if (drag.side === 'b') n.th2 = ang; else n.th2 = ang - Math.PI;
  };
  const lenKey = SIDE_KEY[drag.side];
  if (e.shiftKey) {
    // lock to the axis's angle at the start of this drag and only let the length change
    setAngle(drag.lockAngle);
    const proj = dx * Math.cos(drag.lockAngle) + dy * Math.sin(drag.lockAngle);
    n[lenKey] = Math.max(0.01, proj / scale);
  } else {
    const len = Math.hypot(dx, dy);
    n[lenKey] = Math.max(0.01, len / scale);
    if (len > 4) setAngle(Math.atan2(dy, dx)); // avoid angle jitter from atan2 instability right at the centre
  }
  if (isArc && n.linked) n.sl = n.sr = n[lenKey];
  if (e.altKey) n[SIDE_KEY[OPPOSITE_SIDE[drag.side]]] = n[lenKey]; // mirror the opposite arm's length
}
function moveHard(drag, p, e) {
  drag.moved = true;
  const n = drag.n, d = maxDim(), dx = p.px - n.x * d.w, dy = p.py - n.y * d.h;
  const dist = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
  const delta = dist - drag.lastDist; drag.lastDist = dist;
  drag.r = Math.min(hardToRadius(HARD_K_MIN), Math.max(hardToRadius(HARD_K_MAX), drag.r + delta)); // clamped every frame: no overshoot to retrace
  n.k = Math.round(radiusToHard(drag.r) * 10) / 10;
  // orbiting around the ring rotates the whole axis cross, preserving the angle between the two axes
  let rot = wrapAngle(angle - drag.startAngle), indAngle;
  if (e.shiftKey) { // snap the primary axis to 15° steps; the second axis keeps its offset from the first
    const step = Math.PI / 12, snappedTh = Math.round((drag.startTh + rot) / step) * step;
    rot = snappedTh - drag.startTh;
    indAngle = drag.startAngle + rot; // the ring indicator snaps with the axis instead of trailing the pointer
  }
  n.th = drag.startTh + rot;
  if (n.type === 'circle') n.th2 = drag.startTh2 + rot;
  updateHardIndicator(n, p, indAngle);
}
function moveMarquee(drag, p) {
  if (!drag.moved && Math.abs(p.px - drag.start.px) + Math.abs(p.py - drag.start.py) < 4) return;
  drag.moved = true;
  const x0 = Math.min(drag.start.px, p.px), y0 = Math.min(drag.start.py, p.py), x1 = Math.max(drag.start.px, p.px), y1 = Math.max(drag.start.py, p.py);
  Object.assign(marquee.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
  const r = frameRect();
  state.selected = new Set(drag.base);
  for (const n of state.nodes) { const px = n.x * r.width, py = n.y * r.height; if (px >= x0 && px <= x1 && py >= y0 && py <= y1) state.selected.add(n.id); }
  refreshHandles();
}

stage.addEventListener('pointermove', e => {
  const drag = session.drag;
  if (!drag) return;
  if (drag.type === 'pan') {
    view.panX = drag.startPanX + (e.clientX - drag.startX);
    view.panY = drag.startPanY + (e.clientY - drag.startY);
    applyPan(); refreshHandles(); draw(); return;
  }
  const p = normPos(e);
  if (drag.type === 'spread') { moveSpread(drag, p, e); refreshHandles(); draw(); }
  else if (drag.type === 'hard') { moveHard(drag, p, e); refreshHandles(); draw(); }
  else if (drag.type === 'move') {
    updateDuplicateMode(e.altKey || e.ctrlKey);
    let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (Math.abs(dx) + Math.abs(dy) > 0.0005) drag.moved = true;
    for (const o of drag.orig) { o.n.x = o.x + dx; o.n.y = o.y + dy; }
    refreshHandles(); refreshSelectionPanel(); draw();
  }
  else moveMarquee(drag, p);
});

function addNodeAt(x, y) {
  const type = pendingNodeType();
  const color = state.nodes.length ? colorAtCanvasPoint(x, y) : null;
  const n = addNode(type, x, y, color);
  if (n) selectOnly(n.id); else setStatus(`Limit of ${MAXN} nodes reached.`, true);
  if (type !== 'circle') setPlacement(null);
}
function endDrag(e) {
  const drag = session.drag;
  if (!drag) return;
  if (drag.type === 'pan') { stage.classList.remove('panning'); session.drag = null; return; }
  if (drag.type === 'spread' || drag.type === 'hard') {
    if (drag.moved) pushUndo(drag.snap);
    overlay.querySelectorAll('.hard-ring.active').forEach(el => el.classList.remove('active')); stage.classList.remove('hard-dragging');
  }
  if (drag.type === 'move') {
    if (drag.moved) pushUndo(drag.snap);
    else if (drag.duplicating && drag.cloneIds) { removeNodes(new Set(drag.cloneIds)); state.selected = new Set(drag.sourceIds); }
    overlay.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  }
  if (drag.type === 'marquee' && !drag.moved && !drag.additive && e.type === 'pointerup' && !drag.fromStage) {
    pushUndo();
    addNodeAt(drag.start.x, drag.start.y);
  }
  marquee.style.display = 'none';
  session.drag = null; refreshAll();
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// Pointer down on the empty stage (outside canvas and reference) starts a marquee that only ever deselects.
stage.addEventListener('pointerdown', e => {
  if (e.target !== stage && e.target !== work) return;
  if (e.button !== 0 || session.previewing) return;
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  if (!additive) state.selected.clear();
  session.drag = { type: 'marquee', start: normPos(e), base: new Set(state.selected), moved: false, additive, fromStage: true };
  refreshSelection();
  stage.setPointerCapture(e.pointerId);
}, true);
// Middle-button drag or space + left drag pans, regardless of what's under the pointer (the hand tool).
stage.addEventListener('pointerdown', e => {
  if (e.button !== 1 && !(session.spaceHeld && e.button === 0)) return;
  e.preventDefault();
  session.drag = { type: 'pan', startX: e.clientX, startY: e.clientY, startPanX: view.panX, startPanY: view.panY };
  stage.classList.add('panning');
  stage.setPointerCapture(e.pointerId);
}, true);
