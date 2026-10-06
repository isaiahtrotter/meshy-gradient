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
// grad: true if this node's fill is a screen-space linear gradient (angle gradAngle degrees, 0 = left-to-right)
// across `gradStops` instead of a flat color (named apart from a stroke's own `stops`, its hardness curve —
// see below). gradStops, gradAngle, gradEase are only meaningful when grad is true. gradStops is always at
// least 2 entries, sorted ascending by t (0..1 position along the gradient axis); each has its own color and
// alpha (a, independent of the node's own overall `a`, which still scales everything). gradEase is the easing
// curve applied to the interpolation factor within each stop-to-stop segment: 'linear' (default), 'in', 'out',
// or 'inout' (see GRAD_EASE_TYPES).
// occ: true if this node punches through (opaque, alpha-over) rather than blending into the averaged base layer.
// Occluding nodes stack in array order (later = on top); non-occluding nodes always form the flattened floor
// beneath the whole stack, regardless of where they sit in the array.
// os1, os2: occluding edge feather widths in real px, only meaningful when occ is true, independent of the
// global softness slider (which never touches occluding nodes). os1 is the width on the side facing away
// from `oa`; os2 is the side facing it — a linear (cosine) blend runs between them around the shape, so
// os1 === os2 reads as uniform softness and spreading them apart makes the blur directional.
// oa: occluding blur angle in degrees, only meaningful when occ is true; see os1/os2.

import { wrapAngle, arcGeom, halfArcGeom } from './geometry.js';
import { randomColor, HEX6 } from './color.js';
import { sanitizePts, sanitizeStops } from './stroke.js';
import { OCC_SOFT_MAX_PX, OCC_SOFT_DEFAULT_PX, MAX_GRAD_STOPS, clamp } from './constants.js';

export const NODE_TYPES = ['circle', 'arc', 'line', 'stroke'];
export const GRAD_EASE_TYPES = ['linear', 'in', 'out', 'inout'];
export const SIDE_KEY = { l: 'sl', r: 'sr', t: 'st', b: 'sb' };
export const ANGLE_KEY = { l: 'al', r: 'ar', t: 'at', b: 'ab' };
export const OPPOSITE_SIDE = { l: 'r', r: 'l', t: 'b', b: 't' };
export const DEFAULTS = { k: 2.2, spread: 0.5, phi: 0.35, sw: 0.3, strokeSw: 0.15, arcArm: 0.32, lineArm: 0.4 };

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp01 = v => Math.min(1, Math.max(0, v));

// Accepts any historical/foreign shape for a gradient's stops and returns a clean, sorted, ≥2-entry array.
function sanitizeGradStops(raw, fallbackColor) {
  let list = Array.isArray(raw) ? raw.map(s => ({
    t: isNum(s?.t) ? clamp01(s.t) : 0,
    color: typeof s?.color === 'string' && HEX6.test(s.color) ? s.color.toLowerCase() : fallbackColor,
    a: isNum(s?.a) ? clamp01(s.a) : 1,
  })) : [];
  if (list.length < 2) list = [{ t: 0, color: fallbackColor, a: 1 }, { t: 1, color: fallbackColor, a: 1 }];
  list.sort((a, b) => a.t - b.t);
  return list.slice(0, MAX_GRAD_STOPS);
}

// Accepts any historical node shape (single `r`, `rx/ry`, absent type, arc `thr/thl`) and returns a clean node.
// Does not touch `id`; the caller owns ids.
export function normalizeNode(raw) {
  const n = { ...raw };
  n.type = NODE_TYPES.includes(n.type) ? n.type : 'circle';
  if (!isNum(n.x)) n.x = 0.5;
  if (!isNum(n.y)) n.y = 0.5;
  n.a = isNum(n.a) ? n.a : 1;
  n.occ = n.occ === true;
  if (!isNum(n.os1) && !isNum(n.os2) && isNum(n.os)) {
    // legacy: a single 0..1 slider over a fixed 3..60px range, with a fixed 3px floor on the other side
    n.os1 = 3; n.os2 = 3 + clamp01(n.os) * (60 - 3);
  }
  n.os1 = isNum(n.os1) ? clamp(n.os1, 0, OCC_SOFT_MAX_PX) : OCC_SOFT_DEFAULT_PX;
  n.os2 = isNum(n.os2) ? clamp(n.os2, 0, OCC_SOFT_MAX_PX) : OCC_SOFT_DEFAULT_PX;
  delete n.os;
  n.oa = isNum(n.oa) ? n.oa : 0;
  n.k = isNum(n.k) && n.k > 0 ? n.k : DEFAULTS.k;
  n.th = isNum(n.th) ? n.th : 0;
  n.color = typeof n.color === 'string' && HEX6.test(n.color) ? n.color.toLowerCase() : randomColor();
  n.grad = n.grad === true;
  n.gradAngle = isNum(n.gradAngle) ? clamp(n.gradAngle, -180, 180) : 0;
  n.gradEase = GRAD_EASE_TYPES.includes(n.gradEase) ? n.gradEase : 'linear';
  n.gradStops = sanitizeGradStops(n.gradStops, n.color);
  if (n.type === 'stroke') {
    n.pts = sanitizePts(n.pts); n.stops = sanitizeStops(n.stops);
    n.sw = isNum(n.sw) && n.sw > 0 ? n.sw : DEFAULTS.strokeSw;
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
  const base = {
    id: n.id, type: to, x: n.x, y: n.y, a: n.a, k: n.k, color: n.color, th: n.th, sl: len, sr: len, occ: n.occ,
    grad: n.grad, gradStops: n.gradStops, gradAngle: n.gradAngle, gradEase: n.gradEase,
  };
  if (to === 'circle') { base.st = len; base.sb = len; }
  return normalizeNode(base);
}

// Mirrors a node in place about its own centre: axis 'x' flips horizontally (left ↔ right), 'y' vertically.
// Mirroring across the x-axis negates every angle; mirroring across the y-axis is that plus a half turn. Doing it
// that way (rather than swapping l/r fields) keeps every arm's own length with its mirrored arm, and an arc's
// circle follows because arcCircle() is built from th and the sign of phi. A stroke negates its local y instead:
// with th negated too, R(-th)·(x, -y) is exactly the mirrored path.
export function flipNode(n, axis) {
  const f = a => wrapAngle((axis === 'x' ? Math.PI : 0) - a);
  n.th = f(n.th);
  if (n.type === 'stroke') { n.pts = n.pts.map(([x, y]) => [x, y === 0 ? 0 : -y]); return; }
  if (n.type === 'circle') n.th2 = f(n.th2);
  if (n.type === 'arc') n.phi = -n.phi;
  if (!n.linked) for (const k of ['ar', 'al', 'at', 'ab']) if (k in n) n[k] = f(n[k]);
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
