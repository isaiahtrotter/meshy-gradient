// Pointer interaction on the stage: the `session.drag` state machine.
//   spread  – dragging an arm end: sets that arm's length and angle
//   hard    – dragging the dotted ring: radial motion sets hardness, orbiting rotates the axis cross
//   move    – dragging selected nodes (alt/ctrl duplicates them)
//   marquee – rubber-band selection (shift/cmd-drag, touch, or from the margin around the canvas); a plain click adds a node instead
//   place   – mouse drag on empty canvas with a node tool: creates the node and sizes it as you drag (line: its two ends,
//             arc: its right end, as the spread handle drags it, circle: its hardness ring)
//   pan     – middle button or space + drag
//   draw    – the brush: dragging on the canvas draws a new stroke node
//   stopMove – sliding one of a stroke's hardness stops along its path (clicking the path adds one and starts this)
//   stopHard – dragging a stop's dotted ring: radial motion sets the hardness at that point of the stroke

import { MAXN, STROKE_START_K, HARD_K_MIN, HARD_K_MAX, STROKE_K_MAX, clamp } from './constants.js';
import { state, nodeById, cloneNode, addNode, selectOnly, selectedNodes, toggleSelected, removeNodes } from './state.js';
import { session } from './session.js';
import { snapshot, pushUndo, revertTo } from './undo.js';
import { armAngle, SIDE_KEY, ANGLE_KEY, OPPOSITE_SIDE } from './nodes.js';
import { cumLengths, pointAt, nearestT, smoothStroke, strokeFromPath, recenterStroke, strokeWorld, strokeK, stopFactor, STOP_M_MIN, STOP_M_MAX } from './stroke.js';
import { wrapAngle } from './geometry.js';
import { stage, overlay, work, normPos, maxDim, frameRect, setStatus } from './dom.js';
import { view, applyPan, draw } from './view.js';
import { initPinch } from './pinch.js';
import { aimStopIndicator, handleEls, hardMax, hardToRadius, radiusToHard, stopHardToRadius, stopRadiusToHard, armScale, updateHardIndicator, refreshHandles } from './handles.js';
import { refreshSelectionPanel } from './colorPanel.js';
import { refreshAll, refreshSelection } from './refresh.js';
import { colorAtCanvasPoint } from './sampling.js';
import { pendingNodeType, setPlacement } from './modes.js';
import { setDemoColorSampler, markToolUsed } from './toolDemo.js';

const marquee = document.getElementById('marquee');
setDemoColorSampler(colorAtCanvasPoint); // the tool demo's pretend node takes the canvas colour under it, like a real one

overlay.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (!e.target.closest('.stop-dot')) session.stopSel = null; // a click anywhere but on a stop deselects it
  const p = normPos(e);
  // With a node tool active a finger always draws: the selected node's rings, arms and stops (huge next to a phone's
  // canvas) would otherwise take the touch, so they're only grabbable with no tool (tap outside the canvas to put it down).
  // Only the node's own centre stays grabbable. The mouse still grabs them.
  const grab = sel => (e.pointerType === 'touch' && session.placing !== 'none' ? null : e.target.closest(sel));
  const sh = grab('.spread-handle');
  if (sh) {
    const n = nodeById(+sh.dataset.id); if (!n) return;
    const side = sh.dataset.side;
    session.drag = { type: 'spread', n, side, snap: snapshot(), moved: false, lockAngle: armAngle(n, side) };
    stage.classList.add('node-grab');
    overlay.setPointerCapture(e.pointerId); return;
  }
  const ring = grab('.hard-ring');
  if (ring) {
    const n = nodeById(+ring.dataset.id); if (!n) return;
    const d0 = maxDim(), dx0 = p.px - n.x * d0.w, dy0 = p.py - n.y * d0.h;
    session.drag = {
      type: 'hard', n, snap: snapshot(), moved: false, r: hardToRadius(n.k), lastDist: Math.hypot(dx0, dy0),
      startAngle: Math.atan2(dy0, dx0), startTh: n.th, startTh2: n.type === 'circle' ? n.th2 : 0,
      // orbiting rotates the whole arm cross; unlinked nodes keep each arm's own angle instead of th/th2
      startAr: n.ar, startAl: n.al, startAt: n.at, startAb: n.ab,
    };
    ring.classList.add('active'); stage.classList.add('hard-dragging');
    overlay.setPointerCapture(e.pointerId); return;
  }
  const stopDot = grab('.stop-dot');
  if (stopDot) { beginStopMove(e, nodeById(+stopDot.dataset.id), +stopDot.dataset.stop); return; }
  const stopRing = grab('.stop-ring');
  if (stopRing) { beginStopHard(e, p, stopRing, nodeById(+stopRing.dataset.id), +stopRing.dataset.stop); return; }
  const strokeHit = grab('.stroke-path .hit');
  if (strokeHit) { addStopAt(e, p, nodeById(+strokeHit.dataset.id)); return; }
  const h = e.target.closest('.handle');
  if (h) {
    const id = +h.dataset.id;
    const additive = e.metaKey || e.shiftKey; // ctrl is reserved for duplicate-drag on Windows
    if (session.placing !== 'none') setPlacement('none'); // grabbing a node hands the toolbar back to the cursor (on a phone, that clears the highlighted tool)
    if (!state.selected.has(id)) { if (additive) state.selected.add(id); else selectOnly(id); }
    else if (additive) { state.selected.delete(id); refreshAll(); return; }
    const sourceIds = [...state.selected];
    const sourceStart = new Map(sourceIds.map(sid => { const nd = nodeById(sid); return [sid, { x: nd.x, y: nd.y }]; }));
    session.drag = { type: 'move', start: p, snap: snapshot(), moved: false, duplicating: false, cloneIds: null, sourceIds, sourceStart, orig: origFrom(sourceIds, sourceStart) };
    markDragging(); stage.classList.add('node-grab');
    updateDuplicateMode(e.altKey || e.ctrlKey);
  } else if (session.placing === 'stroke') {
    beginDraw(e, p); return;
  } else {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (session.placing !== 'none' && !additive) {
      // a node tool is active: dragging creates the node and sizes it (mouse and touch alike)
      state.selected.clear();
      session.drag = { type: 'place', start: p, snap: snapshot(), moved: false, n: null, placeType: pendingNodeType() };
    } else {
      // no tool (or shift held): a mouse drag selects; a finger pans the canvas
      const touch = touchPanStart(e);
      if (!additive && !touch) state.selected.clear(); // touch deselects on release instead (endDrag), so a drag that pans never flickers the selection
      session.drag = { type: 'marquee', start: p, base: new Set(state.selected), moved: false, additive, touch };
    }
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
  drag.r = Math.min(hardToRadius(HARD_K_MIN), Math.max(hardToRadius(hardMax(n)), drag.r + delta)); // clamped every frame: no overshoot to retrace
  n.k = Math.round(radiusToHard(drag.r, hardMax(n)) * 10) / 10;
  // orbiting around the ring rotates the whole arm cross by the same delta, preserving every arm's angle
  // relative to the others — th/th2 when linked, each arm's own stored angle (ar/al/at/ab) when unlinked
  let rot = wrapAngle(angle - drag.startAngle), indAngle;
  const refStart = n.linked ? drag.startTh : drag.startAr;
  if (e.shiftKey) { // snap the r-arm's resulting angle to 15° steps; every other arm keeps its offset from it
    const step = Math.PI / 12, snapped = Math.round((refStart + rot) / step) * step;
    rot = snapped - refStart;
    indAngle = drag.startAngle + rot; // the ring indicator snaps with the axis instead of trailing the pointer
  }
  if (n.linked) {
    n.th = drag.startTh + rot;
    if (n.type === 'circle') n.th2 = drag.startTh2 + rot;
  } else {
    n.ar = wrapAngle(drag.startAr + rot); n.al = wrapAngle(drag.startAl + rot);
    if (n.type === 'circle') { n.at = wrapAngle(drag.startAt + rot); n.ab = wrapAngle(drag.startAb + rot); }
  }
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

// ---------- Drag-to-place: a node tool dragged on the canvas creates the node and sizes it with the pointer ----------
const PLACE_MIN_PX = 4; // shorter than this and it's still a click
function movePlace(drag, p, e) {
  const dx = p.px - drag.start.px, dy = p.py - drag.start.py, dist = Math.hypot(dx, dy);
  if (!drag.n) {
    if (dist < PLACE_MIN_PX) return;
    if (state.nodes.length >= MAXN) { if (!drag.full) setStatus(`Limit of ${MAXN} nodes reached.`, true); drag.full = true; return; }
    const { x, y } = drag.start;
    drag.n = addNode(drag.placeType, x, y, state.nodes.length ? colorAtCanvasPoint(x, y) : null);
    selectOnly(drag.n.id);
    drag.moved = true;
  }
  const n = drag.n, d = maxDim();
  if (n.type === 'line') { // both ends follow the drag: the start is one end, the pointer the other
    n.x = (drag.start.x + p.x) / 2; n.y = (drag.start.y + p.y) / 2;
    n.th = Math.atan2(dy, dx);
    n.sl = n.sr = Math.max(0.01, dist / 2 / d.m);
  } else if (n.type === 'arc') { // the pointer carries the arc's right end, exactly like dragging that handle afterwards (shift locks the angle, alt mirrors)
    drag.spread ??= { n, side: 'r', lockAngle: armAngle(n, 'r') };
    moveSpread(drag.spread, p, e);
  } else {
    n.k = Math.round(radiusToHard(dist, hardMax(n)) * 10) / 10;
  }
}

// ---------- Brush strokes ----------
const DRAW_MIN_PX = 6;      // shorter than this and it was a click, not a stroke
const STROKE_SPACING_PX = 4;  // target distance between the stored path points, on screen at the time of drawing
const STOP_GAP = 0.01;      // how close (in t) two stops may get
const round4 = v => Math.round(v * 1e4) / 1e4;
// The stroke's path in frame px, as it's laid out on screen.
function strokeScreen(n) {
  const d = maxDim(), P = strokeWorld(n, { x: n.x * d.w, y: n.y * d.h }, d.m);
  return { P, cum: cumLengths(P) };
}

// Every new stroke starts the same, whatever is selected or was drawn before: the pencil's colour and opacity (session.pen,
// set in the Selected panel while the tool is active) and this hardness (the dotted ring), separate from the defaults a
// circle or arc gets.
function beginDraw(e, p) {
  if (state.nodes.length >= MAXN) { setStatus(`Limit of ${MAXN} nodes reached.`, true); return; }
  if (state.selected.size) { state.selected.clear(); refreshSelection(); } // nothing selected, so the panel is the pencil's again
  session.drag = { type: 'draw', snap: snapshot(), raw: [[p.px, p.py]], len: 0, n: null };
  overlay.setPointerCapture(e.pointerId);
}
function moveDraw(drag, e) {
  // coalesced events keep a fast stroke from turning into a few long straight segments
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  for (const ev of evs.length ? evs : [e]) {
    const q = normPos(ev), last = drag.raw[drag.raw.length - 1], step = Math.hypot(q.px - last[0], q.py - last[1]);
    if (step >= 1.5) { drag.raw.push([q.px, q.py]); drag.len += step; }
  }
  if (!drag.n) {
    if (drag.len < DRAW_MIN_PX) return;
    drag.n = addNode('stroke', 0.5, 0.5, session.pen.color);
    drag.n.a = session.pen.a;
    drag.n.k = STROKE_START_K;
    selectOnly(drag.n.id);
  }
  Object.assign(drag.n, strokeFromPath(smoothStroke(drag.raw, STROKE_SPACING_PX), maxDim()));
}

// End stops are pinned to the ends of the path; the ones between slide along it (hold alt/ctrl to drag a copy instead); Delete removes the selected one.
function beginStopMove(e, n, i) {
  if (!n) return;
  const interior = i > 0 && i < n.stops.length - 1;
  session.stopSel = interior ? { id: n.id, i } : null;
  session.drag = { type: 'stopMove', n, i, stop: n.stops[i], t0: n.stops[i].t, dup: false, cloneRef: null, snap: snapshot(), moved: false, pinned: !interior, pts0: interior ? null : n.pts.map(q => [q[0], q[1]]), x0: n.x, y0: n.y };
  stage.classList.add('hard-dragging');
  overlay.setPointerCapture(e.pointerId);
  updateStopDuplicate(e.altKey || e.ctrlKey);
}
// Alt/ctrl during a stop drag works like it does for nodes, and can be pressed or released at any point: while held
// the original stays put and a copy follows the pointer (and may slide past other stops); letting go drops the copy
// and the original resumes following the pointer.
function updateStopDuplicate(active) {
  const drag = session.drag;
  if (!drag || drag.type !== 'stopMove' || drag.pinned || active === drag.dup) return;
  const { n } = drag, orig = drag.orig ??= drag.stop;
  if (active) {
    orig.t = drag.t0;
    const clone = { t: drag.t0, m: orig.m };
    n.stops.push(clone); n.stops.sort((a, b) => a.t - b.t);
    drag.cloneRef = clone; drag.stop = clone;
  } else {
    n.stops.splice(n.stops.indexOf(drag.cloneRef), 1);
    drag.cloneRef = null; drag.stop = orig;
  }
  drag.dup = active; drag.i = n.stops.indexOf(drag.stop);
  session.stopSel = { id: n.id, i: drag.i };
}
// Dragging an end of the path moves that end to the pointer. The points near it follow with a smooth falloff
// over the first quarter of the path, so the stroke bends instead of kinking at the end point.
const END_FALLOFF = 0.25;
function moveEnd(drag, p) {
  const { n, i } = drag, d = maxDim(), first = i === 0, pts = drag.pts0;
  const cs = Math.cos(n.th), sn = Math.sin(n.th);
  const lx = p.px - drag.x0 * d.w, ly = p.py - drag.y0 * d.h; // measured from the pivot the drag started with
  const target = [(lx * cs + ly * sn) / d.m, (-lx * sn + ly * cs) / d.m]; // inverse of strokeWorld's rotation
  const end = pts[first ? 0 : pts.length - 1], dx = target[0] - end[0], dy = target[1] - end[1];
  const cum = cumLengths(pts), total = cum[cum.length - 1] || 1, r5 = v => Math.round(v * 1e5) / 1e5;
  n.pts = pts.map((q, j) => {
    const s = (first ? cum[j] : total - cum[j]) / (total * END_FALLOFF), u = Math.max(0, 1 - s), w = u * u * (3 - 2 * u);
    return [r5(q[0] + dx * w), r5(q[1] + dy * w)];
  });
  n.x = drag.x0; n.y = drag.y0; recenterStroke(n, d); // the node follows the middle of the line as its length changes
  drag.moved = true;
}
function moveStop(drag, p) {
  if (drag.pinned) { moveEnd(drag, p); return; }
  const { n } = drag, { P, cum } = strokeScreen(n), raw = nearestT(P, cum, [p.px, p.py]).t;
  if (drag.dup) { // the copy isn't boxed in by its neighbours: it re-sorts as it passes them
    const t = round4(clamp(raw, STOP_GAP, 1 - STOP_GAP));
    if (t !== drag.stop.t) { drag.stop.t = t; n.stops.sort((a, b) => a.t - b.t); drag.i = n.stops.indexOf(drag.stop); session.stopSel = { id: n.id, i: drag.i }; }
    if (t !== drag.t0) drag.moved = true;
    return;
  }
  const i = drag.i, t = round4(clamp(raw, n.stops[i - 1].t + STOP_GAP, n.stops[i + 1].t - STOP_GAP));
  if (t !== n.stops[i].t) { n.stops[i].t = t; drag.moved = true; }
}
// Clicking the path adds a stop there, carrying the hardness the stroke already has at that point (so nothing
// changes until it's dragged), and keeps the pointer on it so the same press can slide it.
function addStopAt(e, p, n) {
  if (!n) return;
  const snap = snapshot(), { P, cum } = strokeScreen(n), t = round4(nearestT(P, cum, [p.px, p.py]).t);
  const i = n.stops.findIndex(s => s.t >= t);
  if (i <= 0 || t - n.stops[i - 1].t < STOP_GAP || n.stops[i].t - t < STOP_GAP) return;
  n.stops.splice(i, 0, { t, m: round4(stopFactor(n.stops, t)) });
  session.stopSel = { id: n.id, i };
  session.drag = { type: 'stopMove', n, i, stop: n.stops[i], t0: n.stops[i].t, dup: false, cloneRef: null, snap, moved: true, pinned: false };
  stage.classList.add('hard-dragging');
  overlay.setPointerCapture(e.pointerId);
  refreshAll();
}
// Hovering the path swaps the cursor for a ghost stop that rides the line under the pointer; clicking places a real
// one there (addStopAt), and the cursor is back as soon as the ghost goes. Hidden while dragging or near an existing stop.
const ghostStop = document.createElement('div');
ghostStop.className = 'stop-dot ghost'; overlay.appendChild(ghostStop);
function hideGhost() { ghostStop.classList.remove('on'); overlay.classList.remove('ghost-blocked'); }
overlay.addEventListener('pointermove', e => {
  const hit = !session.drag && e.target.closest?.('.stroke-path .hit'), n = hit && nodeById(+hit.dataset.id);
  if (!n) { hideGhost(); return; }
  const p = normPos(e), { P, cum } = strokeScreen(n), t = round4(nearestT(P, cum, [p.px, p.py]).t);
  const i = n.stops.findIndex(s => s.t >= t);
  if (i <= 0 || t - n.stops[i - 1].t < STOP_GAP || n.stops[i].t - t < STOP_GAP) { hideGhost(); overlay.classList.add('ghost-blocked'); return; } // too close to a stop: bring the real cursor back
  const [sx, sy] = pointAt(P, cum, t);
  ghostStop.style.left = sx + 'px'; ghostStop.style.top = sy + 'px'; ghostStop.classList.add('on'); overlay.classList.remove('ghost-blocked');
});
overlay.addEventListener('pointerleave', hideGhost);
overlay.addEventListener('pointerdown', hideGhost, true);
function beginStopHard(e, p, ring, n, i) {
  if (!n) return;
  const { P, cum } = strokeScreen(n), [sx, sy] = pointAt(P, cum, n.stops[i].t);
  session.drag = { type: 'stopHard', ring, n, i, snap: snapshot(), moved: false, sx, sy, r: stopHardToRadius(strokeK(n, n.stops[i].t)), lastDist: Math.hypot(p.px - sx, p.py - sy) };
  ring.classList.add('active'); stage.classList.add('hard-dragging');
  overlay.setPointerCapture(e.pointerId);
}
// Same feel as the main ring: moving away from the stop softens, toward it hardens. The stop stores a multiplier
// on the node's k, so the value set here is k / n.k.
function moveStopHard(drag, p) {
  drag.moved = true; aimStopIndicator(drag.ring, p);
  const dist = Math.hypot(p.px - drag.sx, p.py - drag.sy);
  drag.r = clamp(drag.r + dist - drag.lastDist, stopHardToRadius(STROKE_K_MAX), stopHardToRadius(HARD_K_MIN)); drag.lastDist = dist;
  const k = Math.round(stopRadiusToHard(drag.r) * 10) / 10;
  drag.n.stops[drag.i].m = clamp(round4(k / drag.n.k), STOP_M_MIN, STOP_M_MAX);
}

// A second finger landing turns the gesture into a pinch (pinch.js): drop whatever the first finger started, as if it never
// touched. Edits made so far are rolled back (nothing goes on the undo stack) and the selection is put back.
function cancelDrag(selBefore) {
  const drag = session.drag;
  if (!drag) return;
  stage.classList.remove('node-grab', 'hard-dragging', 'panning');
  overlay.querySelectorAll('.hard-ring.active, .stop-ring.active, .dragging').forEach(el => el.classList.remove('active', 'dragging'));
  marquee.style.display = 'none';
  if (drag.snap && (drag.moved || drag.type === 'draw' || drag.type === 'place' || drag.duplicating || drag.dup)) revertTo(drag.snap);
  if (selBefore) state.selected = new Set(selBefore);
  session.drag = null; refreshAll();
}
initPinch(cancelDrag); // registered before the capture-phase listeners below, so its handlers run first

// One finger on empty canvas never draws a selection box: dragging pans the canvas instead (touchPanStart records where the finger
// went down and what was selected, since pressing empty canvas deselects). A tap without movement still deselects / adds a node.
const TOUCH_PAN_SLOP = 6;
const touchPanStart = e => e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, sel: new Set(state.selected) } : null;

stage.addEventListener('pointermove', e => {
  let drag = session.drag;
  if (!drag) return;
  if (drag.type === 'marquee' && drag.touch) {
    if (Math.hypot(e.clientX - drag.touch.x, e.clientY - drag.touch.y) < TOUCH_PAN_SLOP) return;
    // a pan isn't a click: the selection was never touched
    drag = session.drag = { type: 'pan', startX: drag.touch.x, startY: drag.touch.y, startPanX: view.panX, startPanY: view.panY };
    stage.classList.add('panning');
  }
  if (drag.type === 'pan') {
    view.panX = drag.startPanX + (e.clientX - drag.startX);
    view.panY = drag.startPanY + (e.clientY - drag.startY);
    applyPan(); refreshHandles(); draw(); return;
  }
  const p = normPos(e);
  if (drag.type === 'spread') { moveSpread(drag, p, e); refreshHandles(); draw(); }
  else if (drag.type === 'hard') { moveHard(drag, p, e); refreshHandles(); draw(); }
  else if (drag.type === 'draw') { moveDraw(drag, e); refreshSelection(); draw(); }
  else if (drag.type === 'place') { movePlace(drag, p, e); refreshHandles(); refreshSelectionPanel(); draw(); }
  else if (drag.type === 'stopMove') { updateStopDuplicate(e.altKey || e.ctrlKey); moveStop(drag, p); refreshHandles(); draw(); }
  else if (drag.type === 'stopHard') { moveStopHard(drag, p); refreshHandles(); draw(); }
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
  if (n) { selectOnly(n.id); markToolUsed(type); } else setStatus(`Limit of ${MAXN} nodes reached.`, true);
}
function endDrag(e) {
  const drag = session.drag;
  if (!drag) return;
  stage.classList.remove('node-grab');
  if (drag.type === 'pan') { stage.classList.remove('panning'); session.drag = null; return; }
  if (drag.type === 'spread' || drag.type === 'hard' || drag.type === 'stopMove' || drag.type === 'stopHard') {
    if (drag.type === 'stopMove' && drag.dup && !drag.moved) { drag.n.stops.splice(drag.n.stops.indexOf(drag.cloneRef), 1); session.stopSel = null; } // a copy that never moved is dropped
    else if (drag.moved) pushUndo(drag.snap);
    overlay.querySelectorAll('.hard-ring.active, .stop-ring.active').forEach(el => el.classList.remove('active')); stage.classList.remove('hard-dragging');
  }
  if (drag.type === 'draw' && drag.n) { pushUndo(drag.snap); markToolUsed('stroke'); }
  if (drag.type === 'place') {
    if (drag.n) { pushUndo(drag.snap); markToolUsed(drag.placeType); }
    else if (!drag.full && e.type === 'pointerup') { pushUndo(); addNodeAt(drag.start.x, drag.start.y); } // never dragged: a click adds the node as it always did
  }
  if (drag.type === 'move') {
    if (drag.moved) pushUndo(drag.snap);
    else if (drag.duplicating && drag.cloneIds) { removeNodes(new Set(drag.cloneIds)); state.selected = new Set(drag.sourceIds); }
    overlay.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  }
  if (drag.type === 'marquee' && drag.touch && !drag.additive && e.type === 'pointerup') state.selected.clear(); // a touch tap on empty canvas deselects here, on release
  if (drag.type === 'marquee' && !drag.moved && !drag.additive && e.type === 'pointerup' && !drag.fromStage && session.placing !== 'none') {
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
  const touch = touchPanStart(e);
  if (!additive && !touch) state.selected.clear();
  if (!additive) setPlacement('none'); // clicking outside the canvas also puts the tool down: a drag selects (mouse) or pans (finger)
  session.drag = { type: 'marquee', start: normPos(e), base: new Set(state.selected), moved: false, additive, fromStage: true, touch };
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

// In preview the overlay ignores the pointer (nothing to grab), so a one-finger drag anywhere on the stage pans the canvas.
stage.addEventListener('pointerdown', e => {
  if (!session.previewing || e.pointerType !== 'touch' || session.drag) return;
  session.drag = { type: 'pan', startX: e.clientX, startY: e.clientY, startPanX: view.panX, startPanY: view.panY };
  stage.classList.add('panning');
  stage.setPointerCapture(e.pointerId);
}, true);
