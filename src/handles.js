// The overlay DOM for each node: the main handle, four arms + spread handles, hardness ring, arc path, unlink
// badge. refreshHandles() creates what's missing, positions everything, and removes elements for deleted nodes.

import { PX_PER_SPREAD, ARM_MIN } from './constants.js';
import { state } from './state.js';
import { session } from './session.js';
import { armAngle, armEnds, arcCurves } from './nodes.js';
import { rgbaCss } from './color.js';
import { overlay, maxDim, normPos, setStyle } from './dom.js';

export const hardToRadius = k => 15 + 400 / (k + 2); // k=1 → 148px, k=2.2 → 110px, k=40 → 24px
export const radiusToHard = R => Math.min(40, Math.max(1, 400 / Math.max(1, R - 15) - 2));
export const HARD_K_MIN = 1, HARD_K_MAX = 40;

export const handleEls = new Map(), ctlEls = new Map();
// Arc/line arms are drawn at true length (a fraction of the frame's long side); circle arms use PX_PER_SPREAD.
export const armScale = (n, d) => (n.type === 'circle' ? PX_PER_SPREAD : d.m);

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
    h.title = 'Drag to set this axis’s length and angle';
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

const ARC_SAMPLES = 48;
function arcPathD(g) {
  const pts = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const a = g.angleMid - g.halfSpan + (2 * g.halfSpan * i) / ARC_SAMPLES;
    pts.push((g.cx + g.R * Math.cos(a)).toFixed(1) + ' ' + (g.cy + g.R * Math.sin(a)).toFixed(1));
  }
  return 'M ' + pts.join(' L ');
}

export function refreshHandles() {
  const live = new Set(), dims = maxDim(), drag = session.drag;
  for (const n of state.nodes) {
    live.add(n.id);
    const isArc = n.type === 'arc', isLine = n.type === 'line', isCircle = n.type === 'circle';
    let el = handleEls.get(n.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'handle'; el.dataset.id = n.id; el.tabIndex = 0;
      el.setAttribute('role', 'button');
      overlay.appendChild(el); handleEls.set(n.id, el);
    }
    const cx = n.x * dims.w, cy = n.y * dims.h;
    el.style.left = cx + 'px'; el.style.top = cy + 'px';
    el.style.background = rgbaCss(n.color, n.a); el.setAttribute('aria-label', `Node ${n.color}`);
    el.classList.toggle('selected', state.selected.has(n.id));
    let c = ctlEls.get(n.id);
    if (!c) { c = createControls(n); ctlEls.set(n.id, c); }
    const on = state.selected.has(n.id);
    // a small badge up and to the right of the node marks it as unlinked, only while the node is selected
    c.unlink.style.display = !n.linked && on ? 'block' : 'none';
    c.unlink.style.left = (cx + 18) + 'px'; c.unlink.style.top = (cy - 18) + 'px';
    // an arc has no straight arms (its ends sit on the drawn curve); a line has l/r arms but no t/b axis
    for (const dir in c.arms) {
      const isLR = dir === 'l' || dir === 'r';
      c.arms[dir].style.display = on && !isArc && (isLR || !isLine) ? 'block' : 'none';
      c.hs[dir].style.display = on && (isLR || isCircle) ? 'block' : 'none';
    }
    c.ring.style.display = on ? 'block' : 'none';
    c.arc.style.display = on && isArc ? 'block' : 'none';
    c.lbl.style.display = 'none';
    if (!on) continue;

    const scale = armScale(n, dims);
    // the arm being dragged may shrink below ARM_MIN so the handle tracks the pointer exactly
    const armLen = (v, dir) => (drag && drag.type === 'spread' && drag.n === n && drag.side === dir) ? Math.max(0, v * scale) : Math.max(ARM_MIN, v * scale);
    const gap = 9; // flush against the 20px main node
    if (isArc) {
      const C = { x: cx, y: cy }, { l: P1, r: P2 } = armEnds(n, C, dims.m);
      setStyle(c.hs.l, { left: P1.x + 'px', top: P1.y + 'px' }); setStyle(c.hs.r, { left: P2.x + 'px', top: P2.y + 'px' });
      setStyle(c.arc, { width: dims.w + 'px', height: dims.h + 'px' }); c.arc.setAttribute('viewBox', `0 0 ${dims.w} ${dims.h}`);
      c.arc.querySelector('path').setAttribute('d', arcCurves(n, C, dims.m).map(arcPathD).join(' '));
    } else {
      const place = (dir, len, phi) => {
        const cs = Math.cos(phi), sn = Math.sin(phi), deg = phi * 180 / Math.PI;
        setStyle(c.arms[dir], { left: (cx + gap * cs) + 'px', top: (cy + gap * sn) + 'px', width: Math.max(0, len - gap - 6) + 'px', transform: `rotate(${deg}deg)` });
        setStyle(c.hs[dir], { left: (cx + len * cs) + 'px', top: (cy + len * sn) + 'px' });
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
  for (const [id, c] of ctlEls) if (!live.has(id)) { [...Object.values(c.arms), ...Object.values(c.hs), c.lbl, c.ring, c.arc, c.unlink].forEach(el => el.remove()); ctlEls.delete(id); }
}
