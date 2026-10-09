// The overlay DOM for each node: the main handle, four arms + spread handles, hardness ring, arc path, unlink
// badge, and for strokes the drawn path plus a dot and small dotted ring per hardness stop. refreshHandles()
// creates what's missing, positions everything, and removes elements for deleted nodes.

import { PX_PER_SPREAD, ARM_MIN, HARD_K_MIN, HARD_K_MAX, STROKE_K_MAX, LINE_K_MAX, clamp } from './constants.js';
import { state } from './state.js';
import { session } from './session.js';
import { armAngle, armEnds, arcCurves } from './nodes.js';
import { cumLengths, pointAt, strokeWorld, strokeK } from './stroke.js';
import { rgbaCss, isLightColor } from './color.js';
import { overlay, maxDim, normPos, setStyle } from './dom.js';

// Screen-px sizing at 100% zoom (k=1 → 148px, k=2.2 → 110px, k=40 → 24px); scaled live by session.zoom so the
// dotted ring grows/shrinks with the view instead of staying a fixed screen size. radiusToHard un-scales a
// screen-px radius back to the same reference space before inverting, so a live drag (real on-screen px,
// which already vary with zoom on their own) stays consistent with whatever's currently rendered.
export const hardToRadius = k => (15 + 400 / (k + 2)) * session.zoom;
export const radiusToHard = (R, kMax = HARD_K_MAX) => clamp(400 / Math.max(0.04, R / session.zoom - 15) - 2, HARD_K_MIN, kMax);
// the hardest a node's main ring may go: only circles stop at HARD_K_MAX, the thin kinds keep going
export const hardMax = n => (n.type === 'circle' ? HARD_K_MAX : LINE_K_MAX);
// the same idea at a smaller size for a stroke's stop rings: k=1 → 40px, k=2.2 → 31px, k=40 → 10px (at 100% zoom)
export const stopHardToRadius = k => (8 + 96 / (k + 2)) * session.zoom;
export const stopRadiusToHard = R => clamp(96 / Math.max(0.01, R / session.zoom - 8) - 2, HARD_K_MIN, STROKE_K_MAX);

export const handleEls = new Map(), ctlEls = new Map();
// Arc/line arms are drawn at true length (a fraction of the frame's long side, which already scales with zoom
// since the frame itself resizes); circle arms use PX_PER_SPREAD, a fixed screen-px scale that needs its own
// explicit zoom factor to grow/shrink the same way.
export const armScale = (n, d) => (n.type === 'circle' ? PX_PER_SPREAD * session.zoom : d.m);

const SVG_NS = 'http://www.w3.org/2000/svg';
const UNLINK_ICON = '<path d="M7.84082 1.08105C8.38231 0.63967 9.16366 0.639559 9.70508 1.08105L9.81738 1.18262L9.91895 1.29492C10.392 1.87508 10.358 2.73066 9.81738 3.27148L7.58887 5.5L9.81738 7.72852C10.3941 8.30545 10.3942 9.24053 9.81738 9.81738C9.24053 10.3942 8.30544 10.3941 7.72852 9.81738L5.5 7.58887L3.27148 9.81738C2.69456 10.3941 1.75947 10.3942 1.18262 9.81738C0.605767 9.24053 0.605878 8.30545 1.18262 7.72852L3.41113 5.5L1.18262 3.27148C0.60588 2.69456 0.605761 1.75947 1.18262 1.18262L1.29492 1.08105C1.83635 0.639556 2.61769 0.639671 3.15918 1.08105L3.27148 1.18262L5.5 3.41113L7.72852 1.18262L7.84082 1.08105Z" fill="black" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

export function updateHardIndicator(n, p, angleOverride) {
  const c = ctlEls.get(n.id); if (!c || !c.ind) return;
  const d = maxDim();
  const deg = (angleOverride ?? Math.atan2(p.py - n.y * d.h, p.px - n.x * d.w)) * 180 / Math.PI;
  c.ind.style.setProperty('--deg', deg); // rotation centres the arc on the pointer; see CSS for the half-arc offset
}

function createControls(n) {
  const c = { arms: {}, hs: {}, lbl: document.createElement('div'), ring: document.createElementNS(SVG_NS, 'svg'), arc: document.createElementNS(SVG_NS, 'svg'), unlink: document.createElementNS(SVG_NS, 'svg') };
  for (const dir of ['l', 'r', 't', 'b']) {
    const axis = (dir === 'l' || dir === 'r') ? 'x' : 'y';
    const arm = document.createElement('div'); arm.className = 'arm';
    const h = document.createElement('div'); h.className = 'spread-handle';
    h.dataset.id = n.id; h.dataset.axis = axis; h.dataset.side = dir;
    c.arms[dir] = arm; c.hs[dir] = h; overlay.appendChild(arm); overlay.appendChild(h);
  }
  c.lbl.className = 'spread-label';
  c.ring.setAttribute('class', 'hard-ring'); c.ring.dataset.id = n.id;
  c.ring.innerHTML = '<circle class="dots"/><circle class="indicator"/><circle class="grab"/>';
  c.ring.querySelector('.grab').setAttribute('aria-label', 'Drag to set edge hardness');
  c.ind = c.ring.querySelector('.indicator');
  // track the pointer against the ring directly: more reliable than hover on the thin SVG stroke
  const nodeId = n.id;
  const withCurrentNode = ev => { const cur = state.nodes.find(x => x.id === nodeId); if (cur) updateHardIndicator(cur, normPos(ev)); };
  const grabEl = c.ring.querySelector('.grab');
  grabEl.addEventListener('pointerenter', withCurrentNode);
  grabEl.addEventListener('pointermove', withCurrentNode);
  c.arc.setAttribute('class', 'arc-path'); c.arc.innerHTML = '<path/>';
  c.unlink.setAttribute('class', 'unlink-badge'); c.unlink.setAttribute('viewBox', '0 0 11 11'); c.unlink.innerHTML = UNLINK_ICON;
  overlay.appendChild(c.arc); overlay.appendChild(c.ring); overlay.appendChild(c.lbl); overlay.appendChild(c.unlink);
  return c;
}

// Stroke-only parts, created the first time a stroke is laid out: its path (a visible line plus a wide invisible
// hit line that adds a stop on click) and one dot + ring per stop, kept in step with n.stops.
function ensureStrokeControls(c, n) {
  if (c.path) return;
  c.path = document.createElementNS(SVG_NS, 'svg'); c.path.setAttribute('class', 'stroke-path');
  c.path.innerHTML = '<path class="hit"></path><path class="line"/>';
  c.path.querySelector('.hit').dataset.id = n.id;
  c.stops = [];
  // under the main ring, so where the two cross the ring still rotates instead of adding a stop
  overlay.insertBefore(c.path, c.ring);
}
export function aimStopIndicator(ring, p) {
  const ind = ring.querySelector('.indicator'); if (!ind || ring._cx == null) return;
  ind.style.setProperty('--deg', Math.atan2(p.py - ring._cy, p.px - ring._cx) * 180 / Math.PI);
}
function syncStopEls(c, n) {
  while (c.stops.length < n.stops.length) {
    const dot = document.createElement('div'); dot.className = 'stop-dot'; dot.dataset.id = n.id;
    const ring = document.createElementNS(SVG_NS, 'svg'); ring.setAttribute('class', 'stop-ring'); ring.dataset.id = n.id;
    ring.innerHTML = '<circle class="dots"/><circle class="indicator"/><circle class="grab"/>';
    // same hover as the node's main ring: the arc handle tracks the pointer around the circle
    ring.querySelector('.grab').addEventListener('pointerenter', ev => aimStopIndicator(ring, normPos(ev)));
    ring.querySelector('.grab').addEventListener('pointermove', ev => aimStopIndicator(ring, normPos(ev)));
    overlay.appendChild(ring); overlay.appendChild(dot);
    c.stops.push({ dot, ring });
  }
  while (c.stops.length > n.stops.length) { const s = c.stops.pop(); s.dot.remove(); s.ring.remove(); }
  const last = n.stops.length - 1;
  c.stops.forEach((s, i) => {
    s.dot.dataset.stop = s.ring.dataset.stop = i;
    const end = i === 0 || i === last;
    s.dot.classList.toggle('end', end);
    s.dot.classList.toggle('selected', !end && session.stopSel?.id === n.id && session.stopSel.i === i);
    if (end) s.dot.removeAttribute('title'); else s.dot.title = 'Drag along the stroke to move (hold ⌥ or Ctrl to duplicate). Click to select, then Delete to remove';
  });
}
function layoutStroke(c, n, cx, cy, dims) {
  const P = strokeWorld(n, { x: cx, y: cy }, dims.m), cum = cumLengths(P);
  setStyle(c.path, { width: dims.w + 'px', height: dims.h + 'px' }); c.path.setAttribute('viewBox', `0 0 ${dims.w} ${dims.h}`);
  // quadratic curves through the segment midpoints, so the drawn line has no corners
  const f = v => v.toFixed(1), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M ${f(P[0][0])} ${f(P[0][1])}`;
  for (let i = 1; i < P.length - 1; i++) { const m = mid(P[i], P[i + 1]); d += ` Q ${f(P[i][0])} ${f(P[i][1])} ${f(m[0])} ${f(m[1])}`; }
  d += ` L ${f(P[P.length - 1][0])} ${f(P[P.length - 1][1])}`;
  for (const p of c.path.children) p.setAttribute('d', d);
  c.path.style.setProperty('--hc', isLightColor(n.color) ? '#000' : '#fff');
  syncStopEls(c, n);
  n.stops.forEach((st, i) => {
    const [sx, sy] = pointAt(P, cum, st.t), { dot, ring } = c.stops[i];
    for (const e of [dot, ring]) e.style.setProperty('--hc', isLightColor(n.color) ? '#000' : '#fff');
    setStyle(dot, { left: sx + 'px', top: sy + 'px' });
    const R = stopHardToRadius(strokeK(n, st.t)), S = R * 2 + 12, mid = S / 2;
    setStyle(ring, { left: (sx - mid) + 'px', top: (sy - mid) + 'px', width: S + 'px', height: S + 'px' });
    ring.setAttribute('viewBox', `0 0 ${S} ${S}`);
    for (const e of ring.children) { e.setAttribute('cx', mid); e.setAttribute('cy', mid); e.setAttribute('r', e.classList.contains('indicator') ? R + 5 : R); }
    ring.querySelector('.indicator').style.setProperty('--circ', 2 * Math.PI * (R + 5));
    ring._cx = sx; ring._cy = sy;
  });
}
const setStrokeShown = (c, pathOn, stopsOn) => {
  if (!c.path) return;
  c.path.style.display = pathOn ? 'block' : 'none';
  for (const s of c.stops) s.dot.style.display = s.ring.style.display = stopsOn ? 'block' : 'none';
};

const ARC_SAMPLES = 48;
function arcPathD(g) {
  const pts = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const a = g.angleMid - g.halfSpan + (2 * g.halfSpan * i) / ARC_SAMPLES;
    pts.push((g.cx + g.R * Math.cos(a)).toFixed(1) + ' ' + (g.cy + g.R * Math.sin(a)).toFixed(1));
  }
  return 'M ' + pts.join(' L ');
}

// Arms and spread handles are placed with transforms (left/top stay 0): the browser snaps left/top/width to whole
// device pixels, which made them step and jitter while dragging, but transforms position at sub-pixel precision.
const moveTo = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px)`; };

export function refreshHandles() {
  const live = new Set(), dims = maxDim(), drag = session.drag;
  for (const n of state.nodes) {
    live.add(n.id);
    const isArc = n.type === 'arc', isLine = n.type === 'line', isCircle = n.type === 'circle', isStroke = n.type === 'stroke';
    let el = handleEls.get(n.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'handle'; el.dataset.id = n.id; el.tabIndex = 0;
      el.setAttribute('role', 'button');
      overlay.appendChild(el); handleEls.set(n.id, el);
    }
    const cx = n.x * dims.w, cy = n.y * dims.h;
    el.style.translate = `${cx}px ${cy}px`; // the `translate` property (not transform): the hover `scale` is applied after it, so scaling about the node's centre never shifts it
    el.style.background = rgbaCss(n.color, n.a); el.setAttribute('aria-label', `Node ${n.color}`);
    el.classList.toggle('selected', state.selected.has(n.id));
    let c = ctlEls.get(n.id);
    if (!c) { c = createControls(n); ctlEls.set(n.id, c); }
    const on = state.selected.has(n.id);
    // outlines, arms and rings turn black over a light colour (--hc); the spread handles' centres stay white
    const hc = isLightColor(n.color) ? '#000' : '#fff';
    for (const e of [el, c.ring, c.arc, ...Object.values(c.arms), ...Object.values(c.hs), ...(c.path ? [c.path, ...c.stops.flatMap(s => [s.dot, s.ring])] : [])]) e.style.setProperty('--hc', hc);
    // a small badge up and to the right of the node marks it as unlinked, only while the node is selected
    c.unlink.style.display = !n.linked && on ? 'block' : 'none';
    c.unlink.style.left = (cx + 18) + 'px'; c.unlink.style.top = (cy - 18) + 'px';
    // an arc has no straight arms (its ends sit on the drawn curve); a line has l/r arms but no t/b axis; a stroke
    // has none at all, its shape is the drawn path
    for (const dir in c.arms) {
      const isLR = dir === 'l' || dir === 'r';
      c.arms[dir].style.display = on && !isArc && !isStroke && (isLR || !isLine) ? 'block' : 'none';
      c.hs[dir].style.display = on && !isStroke && (isLR || isCircle) ? 'block' : 'none';
    }
    // while a stroke is still being drawn only its path shows; the rings would just get in the way of the brush
    const drawing = drag && drag.type === 'draw' && drag.n === n;
    c.ring.style.display = on && !drawing ? 'block' : 'none';
    c.arc.style.display = on && isArc ? 'block' : 'none';
    c.lbl.style.display = 'none';
    if (isStroke) ensureStrokeControls(c, n);
    setStrokeShown(c, on && isStroke, on && isStroke && !drawing);
    if (!on) continue;

    const scale = armScale(n, dims);
    // the arm being dragged may shrink below ARM_MIN so the handle tracks the pointer exactly
    const armLen = (v, dir) => (drag && drag.type === 'spread' && drag.n === n && drag.side === dir) ? Math.max(0, v * scale) : Math.max(ARM_MIN, v * scale);
    const gap = 9; // flush against the 20px main node
    if (isStroke) {
      layoutStroke(c, n, cx, cy, dims);
      setStrokeShown(c, true, !drawing); // stop dots are created by the layout, after the first show/hide above
      if (drawing) continue;
    } else if (isArc) {
      const C = { x: cx, y: cy }, { l: P1, r: P2 } = armEnds(n, C, dims.m);
      moveTo(c.hs.l, P1.x, P1.y); moveTo(c.hs.r, P2.x, P2.y);
      setStyle(c.arc, { width: dims.w + 'px', height: dims.h + 'px' }); c.arc.setAttribute('viewBox', `0 0 ${dims.w} ${dims.h}`);
      c.arc.querySelector('path').setAttribute('d', arcCurves(n, C, dims.m).map(arcPathD).join(' '));
    } else {
      const place = (dir, len, phi) => {
        const cs = Math.cos(phi), sn = Math.sin(phi), deg = phi * 180 / Math.PI;
        c.arms[dir].style.transform = `translate(${cx + gap * cs}px, ${cy + gap * sn}px) rotate(${deg}deg) scaleX(${Math.max(0, len - gap - 6)})`; // the arm is 1px wide, scaled to its length
        moveTo(c.hs[dir], cx + len * cs, cy + len * sn);
      };
      place('r', armLen(n.sr, 'r'), armAngle(n, 'r')); place('l', armLen(n.sl, 'l'), armAngle(n, 'l'));
      if (isCircle) { place('b', armLen(n.sb, 'b'), armAngle(n, 'b')); place('t', armLen(n.st, 't'), armAngle(n, 't')); }
    }
    const R = hardToRadius(n.k);
    const Ri = R + 7, S = Ri * 2 + 20, mid = S / 2; // 1px (half main stroke) + 4px gap + 2px (half indicator stroke)
    setStyle(c.ring, { left: (cx - S / 2) + 'px', top: (cy - S / 2) + 'px', width: S + 'px', height: S + 'px' });
    c.ring.setAttribute('viewBox', `0 0 ${S} ${S}`);
    for (const sel of ['.dots', '.grab']) { const e = c.ring.querySelector(sel); e.setAttribute('cx', mid); e.setAttribute('cy', mid); e.setAttribute('r', R); }
    c.ind.setAttribute('cx', mid); c.ind.setAttribute('cy', mid); c.ind.setAttribute('r', Ri);
    c.ind.style.setProperty('--circ', 2 * Math.PI * Ri);
  }
  for (const [id, el] of handleEls) if (!live.has(id)) { el.remove(); handleEls.delete(id); }
  for (const [id, c] of ctlEls) {
    if (live.has(id)) continue;
    [...Object.values(c.arms), ...Object.values(c.hs), c.lbl, c.ring, c.arc, c.unlink].forEach(el => el.remove());
    if (c.path) { c.path.remove(); c.stops.forEach(s => { s.dot.remove(); s.ring.remove(); }); }
    ctlEls.delete(id);
  }
}
