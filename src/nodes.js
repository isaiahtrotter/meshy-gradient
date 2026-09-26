// The node model. Every node in state passes through normalizeNode(), so readers can rely on every field below
// being present and never need inline fallbacks.
//
// Common:  id, type ('circle'|'arc'|'line'|'stroke'), x, y (0..1 of the canvas), a (alpha), k (hardness), color,
//          th (primary axis angle), linked (true unless the arms have been unlinked), sl, sr (left/right arm lengths)
// circle:  st, sb (top/bottom arm lengths), th2 (second axis angle). Lengths are in "spread" units (× PX_PER_SPREAD
//          on screen, × softness in the shader).
// arc:     phi (bend at the apex), sw (band width). Lengths are a fraction of the canvas's long side.
// line:    sw. Same length units as an arc.
// stroke:  pts (the drawn path), stops (hardness along it), sw; see stroke.js. No arms: no sl/sr, always linked,
//          never converts to or from another type. th rotates the path about x, y.
// unlinked: ar, al (and at, ab for circles) hold each arm's own angle. Linked nodes derive them from th/th2/phi.

import { wrapAngle, arcGeom, halfArcGeom } from './geometry.js';
import { randomColor, HEX6 } from './color.js';
import { sanitizePts, sanitizeStops } from './stroke.js';

export const NODE_TYPES = ['circle', 'arc', 'line', 'stroke'];
export const SIDE_KEY = { l: 'sl', r: 'sr', t: 'st', b: 'sb' };
export const ANGLE_KEY = { l: 'al', r: 'ar', t: 'at', b: 'ab' };
export const OPPOSITE_SIDE = { l: 'r', r: 'l', t: 'b', b: 't' };
export const DEFAULTS = { k: 2.2, spread: 0.5, phi: 0.35, sw: 0.3, arcArm: 0.32, lineArm: 0.4 };

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// Accepts any historical node shape (single `r`, `rx/ry`, absent type, arc `thr/thl`) and returns a clean node.
// Does not touch `id`; the caller owns ids.
export function normalizeNode(raw) {
  const n = { ...raw };
  n.type = NODE_TYPES.includes(n.type) ? n.type : 'circle';
  if (!isNum(n.x)) n.x = 0.5;
  if (!isNum(n.y)) n.y = 0.5;
  n.a = isNum(n.a) ? n.a : 1;
  n.k = isNum(n.k) && n.k > 0 ? n.k : DEFAULTS.k;
  n.th = isNum(n.th) ? n.th : 0;
  n.color = typeof n.color === 'string' && HEX6.test(n.color) ? n.color.toLowerCase() : randomColor();
  if (n.type === 'stroke') {
    n.pts = sanitizePts(n.pts); n.stops = sanitizeStops(n.stops);
    n.sw = isNum(n.sw) && n.sw > 0 ? n.sw : DEFAULTS.sw;
    n.linked = true;
    for (const f of ['sl', 'sr', 'st', 'sb', 'th2', 'phi', 'ar', 'al', 'at', 'ab', 'r', 'rx', 'ry', 'thr', 'thl']) delete n[f];
    return n;
  }
  delete n.pts; delete n.stops;
  const rx = n.rx ?? n.r ?? DEFAULTS.spread, ry = n.ry ?? n.r ?? DEFAULTS.spread;
  n.sl = isNum(n.sl) ? n.sl : rx;
  n.sr = isNum(n.sr) ? n.sr : rx;
  if (n.type === 'circle') {
    n.st = isNum(n.st) ? n.st : ry;
    n.sb = isNum(n.sb) ? n.sb : ry;
    n.th2 = isNum(n.th2) ? n.th2 : n.th + Math.PI / 2;
    delete n.phi; delete n.sw;
  } else {
    delete n.st; delete n.sb; delete n.th2;
    n.sw = isNum(n.sw) ? n.sw : DEFAULTS.sw;
    if (n.type === 'arc') n.phi = isNum(n.phi) ? n.phi : DEFAULTS.phi; else delete n.phi;
  }
  n.linked = n.linked !== false;
  if (n.linked) {
    delete n.ar; delete n.al; delete n.at; delete n.ab;
  } else {
    // arcs used to store their unlinked angles as thr/thl; anything missing falls back to the linked-derived angle
    const asLinked = { ...n, linked: true };
    n.ar = n.ar ?? n.thr ?? armAngle(asLinked, 'r');
    n.al = n.al ?? n.thl ?? armAngle(asLinked, 'l');
    if (n.type === 'circle') { n.at = n.at ?? armAngle(asLinked, 't'); n.ab = n.ab ?? armAngle(asLinked, 'b'); }
    else { delete n.at; delete n.ab; }
  }
  delete n.r; delete n.rx; delete n.ry; delete n.thr; delete n.thl;
  return n;
}

export function createNode(type, x, y, color, spread) {
  const base = { type, x, y, color: color || randomColor() };
  if (type === 'arc') { base.sl = base.sr = DEFAULTS.arcArm; }
  else if (type === 'line') { base.sl = base.sr = DEFAULTS.lineArm; }
  else if (spread != null) { base.sl = base.sr = base.st = base.sb = spread; }
  return normalizeNode(base);
}

// A single arm's current angle. The one place both the drag code and the renderers read an arm's angle from.
export function armAngle(n, side) {
  if (!n.linked) { const v = n[ANGLE_KEY[side]]; if (v != null) return v; }
  if (n.type === 'arc') return side === 'r' ? n.th + n.phi : n.th + Math.PI - n.phi;
  return side === 'r' ? n.th : side === 'l' ? n.th + Math.PI : side === 'b' ? n.th2 : n.th2 + Math.PI;
}

// Left/right arm endpoints around centre C, with arm lengths scaled by `scale`.
export function armEnds(n, C, scale) {
  const thl = armAngle(n, 'l'), thr = armAngle(n, 'r'), lenL = n.sl * scale, lenR = n.sr * scale;
  return { l: { x: C.x + lenL * Math.cos(thl), y: C.y + lenL * Math.sin(thl) }, r: { x: C.x + lenR * Math.cos(thr), y: C.y + lenR * Math.sin(thr) } };
}

// The circle(s) an arc node draws: one shared circle when linked, two independent halves (right first) when not.
export function arcCurves(n, C, scale, eps) {
  const { l: P1, r: P2 } = armEnds(n, C, scale);
  if (n.linked) return [arcGeom(C, n.th, n.phi, P1, P2, (n.sl + n.sr) / 2 * scale, eps)];
  // each half's implied bend relative to the shared tangent, mirroring how phi works when linked
  const phiR = wrapAngle(armAngle(n, 'r') - n.th), phiL = wrapAngle(n.th + Math.PI - armAngle(n, 'l'));
  return [halfArcGeom(C, n.th, phiR, P2, n.sr * scale, eps), halfArcGeom(C, n.th, phiL, P1, n.sl * scale, eps)];
}

// Returns a fresh node of the new type (same id/position/colour), or null if already that type.
// The three arm-based kinds keep independent-axis state in different fields, so a conversion always starts linked.
// A stroke's shape is its drawn path, which none of them can hold, so strokes never convert either way.
export function convertNodeType(n, to) {
  if (n.type === to || n.type === 'stroke' || to === 'stroke') return null;
  const len = (n.sl + n.sr) / 2;
  const base = { id: n.id, type: to, x: n.x, y: n.y, a: n.a, k: n.k, color: n.color, th: n.th, sl: len, sr: len };
  if (to === 'circle') { base.st = len; base.sb = len; }
  return normalizeNode(base);
}

export function toggleLinked(n) {
  if (n.type === 'stroke') return; // one path, no arms to unlink
  if (!n.linked) {
    // relink: fold the independent angles back into one shared angle (+ half the split, for an arc); the other
    // end snaps to the now-enforced opposite angle, which is the point of relinking
    if (n.type === 'arc') {
      const thr = armAngle(n, 'r'), thl = armAngle(n, 'l');
      n.th = wrapAngle((thr + thl - Math.PI) / 2); n.phi = wrapAngle(thr - n.th);
    } else {
      n.th = armAngle(n, 'r');
      if (n.type === 'circle') n.th2 = armAngle(n, 't');
    }
    n.linked = true; delete n.ar; delete n.al; delete n.at; delete n.ab;
  } else {
    // unlink: capture each arm's current angle explicitly so nothing jumps at the moment of unlinking
    const ar = armAngle(n, 'r'), al = armAngle(n, 'l');
    if (n.type === 'circle') { n.at = armAngle(n, 't'); n.ab = armAngle(n, 'b'); }
    n.ar = ar; n.al = al; n.linked = false;
  }
}
