// Two-finger pinch on the stage: zoom around the fingers' midpoint, and pan as the midpoint moves. Touch only.
//
// It listens in the capture phase on the stage, which runs before any handle / overlay / marquee handler, so a pinch never
// competes with a one-finger drag. One finger behaves exactly as before. When a second finger lands, the first finger's
// gesture is cancelled (cancelDrag undoes anything it had started: a half-moved node, a half-drawn stroke, a marquee), and
// from then until every finger is up the stage's other handlers don't see the pointers at all. Lifting one finger of a
// pinch leaves the other panning the canvas (never dragging a node); putting a second finger back resumes the pinch.

import { stage } from './dom.js';
import { state } from './state.js';
import { view, setZoom, panBy, applyPan } from './view.js';

export function initPinch(cancelDrag) {
  const pts = new Map();      // pointerId → { x, y }, touch pointers currently down
  let pinching = false;       // set when a second finger lands; cleared once all fingers are up
  let ids = null, lastD = 0, lastMid = null, selBefore = null, panId = null, lastPan = null; // panId: the lone finger left after a pinch

  const measure = () => {
    const [a, b] = ids.map(id => pts.get(id));
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (pts.size === 0) selBefore = new Set(state.selected); // the first finger may change the selection; a pinch undoes that
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { // a second finger: start a pinch, or resume one after a finger lifted
      if (!pinching) { pinching = true; cancelDrag(selBefore); }
      ids = [...pts.keys()]; panId = null;
      ({ d: lastD, mid: lastMid } = measure());
    }
    if (pinching) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  stage.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinching) return;
    e.stopPropagation();
    if (panId === e.pointerId) { panBy(e.clientX - lastPan.x, e.clientY - lastPan.y); lastPan = { x: e.clientX, y: e.clientY }; return; } // the lone finger pans
    if (!ids || !ids.every(id => pts.has(id))) return;
    const { d, mid } = measure();
    if (lastD < 8 || d < 8) { lastD = d; lastMid = mid; return; } // fingers practically touching: no meaningful ratio
    view.panX += mid.x - lastMid.x; view.panY += mid.y - lastMid.y; applyPan(); // the midpoint drags the canvas along (applied now, so setZoom measures the moved frame)
    setZoom(view.zoom * d / lastD, mid.x, mid.y);                   // then zoom about it (setZoom clamps the pan and redraws)
    lastD = d; lastMid = mid;
  }, true);

  const up = e => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!pinching) return;
    e.stopPropagation();
    if (!pts.size) { pinching = false; ids = null; panId = null; }
    else if (pts.size === 1) { [panId] = pts.keys(); lastPan = { ...pts.get(panId) }; } // one finger left: it pans from where it is
  };
  stage.addEventListener('pointerup', up, true);
  stage.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', () => { pts.clear(); pinching = false; ids = null; panId = null; });

  // iOS Safari reports pinches as gesture events and zooms the whole page unless they're cancelled.
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) stage.addEventListener(t, e => e.preventDefault());
}
