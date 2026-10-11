// Two-finger pinch on the stage: zoom around the fingers' midpoint, and pan as the midpoint moves. Touch only.
//
// It listens in the capture phase on the stage, which runs before any handle / overlay / marquee handler, so a pinch never
// competes with a one-finger drag. One finger behaves exactly as before. When a second finger lands, the first finger's
// gesture is cancelled (cancelDrag undoes anything it had started: a half-moved node, a half-drawn stroke, a marquee), and
// from then until every finger is up the stage's other handlers don't see the pointers at all. So lifting one finger of
// a pinch doesn't turn the other into a drag.

import { stage } from './dom.js';
import { state } from './state.js';
import { view, setZoom } from './view.js';

export function initPinch(cancelDrag) {
  const pts = new Map();      // pointerId → { x, y }, touch pointers currently down
  let pinching = false;       // set when a second finger lands; cleared once all fingers are up
  let ids = null, lastD = 0, lastMid = null, selBefore = null;

  const measure = () => {
    const [a, b] = ids.map(id => pts.get(id));
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (pts.size === 0) selBefore = new Set(state.selected); // the first finger may change the selection; a pinch undoes that
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && !pinching) {
      pinching = true; ids = [...pts.keys()];
      cancelDrag(selBefore);
      ({ d: lastD, mid: lastMid } = measure());
    }
    if (pinching) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  stage.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinching) return;
    e.stopPropagation();
    if (!ids.every(id => pts.has(id))) return; // one of the two lifted: wait for everything to come up
    const { d, mid } = measure();
    if (lastD < 8 || d < 8) { lastD = d; lastMid = mid; return; } // fingers practically touching: no meaningful ratio
    view.panX += mid.x - lastMid.x; view.panY += mid.y - lastMid.y; // the midpoint drags the canvas along
    setZoom(view.zoom * d / lastD, mid.x, mid.y);                   // then zoom about it (setZoom clamps the pan and redraws)
    lastD = d; lastMid = mid;
  }, true);

  const up = e => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinching) { e.stopPropagation(); if (!pts.size) { pinching = false; ids = null; } }
  };
  stage.addEventListener('pointerup', up, true);
  stage.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', () => { pts.clear(); pinching = false; ids = null; });

  // iOS Safari reports pinches as gesture events and zooms the whole page unless they're cancelled.
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) stage.addEventListener(t, e => e.preventDefault());
}
