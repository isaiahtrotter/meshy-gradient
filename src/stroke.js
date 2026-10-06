// Brush-stroke geometry: pure maths on paths of [x, y] pairs, no DOM.
//
// A stroke node keeps its drawn path in `pts`: points relative to the node's pivot (its x, y) in fractions of the
// canvas's long side (the same units as arcs and lines), before rotation; `th` rotates the whole path about the
// pivot. `stops` shape hardness along the path: [{ t, m }] sorted by t, where t is the arc-length fraction (0 at
// the first point, 1 at the last) and m multiplies the node's own `k`, so the main hardness ring still scales the
// whole profile at once. There is always a stop at t = 0 and one at t = 1.

import { MAX_STROKE_PTS, HARD_K_MIN, STROKE_K_MAX, clamp, isNum } from './constants.js';

export const STOP_M_MIN = 0.01, STOP_M_MAX = 10000;
export const defaultStops = () => [{ t: 0, m: 1 }, { t: 1, m: 1 }];

export function cumLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

// The point `s` along segment i-1 → i, where s is an arc length that falls within that segment.
function onSegment(pts, cum, i, s) {
  const A = pts[i - 1], B = pts[i], seg = cum[i] - cum[i - 1], u = seg > 0 ? (s - cum[i - 1]) / seg : 0;
  return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u];
}

// The point at arc-length fraction t along the path.
export function pointAt(pts, cum, t) {
  const s = clamp(t, 0, 1) * cum[cum.length - 1];
  let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
  return onSegment(pts, cum, i, s);
}

// The arc-length fraction of the path point nearest to p, and the distance to it.
export function nearestT(pts, cum, p) {
  let best = Infinity, bestS = 0;
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i], dx = B[0] - A[0], dy = B[1] - A[1], len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? clamp(((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(p[0] - (A[0] + dx * u), p[1] - (A[1] + dy * u));
    if (d < best) { best = d; bestS = cum[i - 1] + (cum[i] - cum[i - 1]) * u; }
  }
  const total = cum[cum.length - 1];
  return { t: total > 0 ? bestS / total : 0, dist: best };
}

// n points evenly spaced by arc length, first and last kept exactly.
export function resample(pts, n) {
  const cum = cumLengths(pts), total = cum[cum.length - 1], out = [];
  let i = 1;
  for (let j = 0; j < n; j++) {
    const s = n === 1 ? 0 : total * j / (n - 1);
    while (i < pts.length - 1 && cum[i] < s) i++;
    out.push(onSegment(pts, cum, i, s));
  }
  return out;
}

// Raw pointer samples (px) → a smooth path of at most MAX_STROKE_PTS points roughly `spacing` px apart. The
// samples are first made dense and even (3px), then box-filtered with a window that narrows toward the ends so the
// stroke still starts and stops exactly where the pointer did.
const DENSE_PX = 3, SMOOTH_RADIUS = 10, SMOOTH_PASSES = 3;
export function smoothStroke(raw, spacing) {
  if (raw.length < 2) return raw.map(p => [p[0], p[1]]);
  const len = cumLengths(raw)[raw.length - 1];
  const dense = resample(raw, clamp(Math.round(len / DENSE_PX), 2, 4000));
  // a few passes of the box filter approximate a gaussian: no flat runs or kinks survive the jitter of a hand
  let smooth = dense;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const src = smooth;
    smooth = src.map((p, i) => {
      const r = Math.min(SMOOTH_RADIUS, i, src.length - 1 - i);
      let x = 0, y = 0;
      for (let j = -r; j <= r; j++) { x += src[i + j][0]; y += src[i + j][1]; }
      return [x / (2 * r + 1), y / (2 * r + 1)];
    });
  }
  return resample(smooth, clamp(Math.round(len / spacing) + 1, 2, MAX_STROKE_PTS));
}

// A drawn path in frame px → the node fields: pivot at the middle of the line (half its length along it, so the
// node always sits on the stroke), points relative to it in long-side units, unrotated. `dims` is maxDim().
export function strokeFromPath(path, dims) {
  const [cx, cy] = pointAt(path, cumLengths(path), 0.5), r5 = v => Math.round(v * 1e5) / 1e5;
  return { x: cx / dims.w, y: cy / dims.h, th: 0, pts: path.map(([x, y]) => [r5((x - cx) / dims.m), r5((y - cy) / dims.m)]) };
}

// Moves the pivot back to the middle of the line after its ends have been dragged, without changing the shape.
export function recenterStroke(n, dims) {
  const [mx, my] = pointAt(n.pts, cumLengths(n.pts), 0.5), c = Math.cos(n.th), s = Math.sin(n.th);
  n.x += (mx * c - my * s) * dims.m / dims.w; n.y += (mx * s + my * c) * dims.m / dims.h;
  n.pts = n.pts.map(([x, y]) => [Math.round((x - mx) * 1e5) / 1e5, Math.round((y - my) * 1e5) / 1e5]);
}

// The path in world space: rotated by th about centre C, lengths × scale.
export function strokeWorld(n, C, scale) {
  const c = Math.cos(n.th) * scale, s = Math.sin(n.th) * scale;
  return n.pts.map(([x, y]) => [C.x + x * c - y * s, C.y + x * s + y * c]);
}

// The stop multiplier at t: eased between neighbouring stops, in log space so a 1 → 4 ramp reads as even as 4 → 16.
export function stopFactor(stops, t) {
  let i = 1; while (i < stops.length - 1 && stops[i].t < t) i++;
  const a = stops[i - 1], b = stops[i], span = b.t - a.t;
  const u = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1, e = u * u * (3 - 2 * u);
  return Math.exp(Math.log(a.m) + (Math.log(b.m) - Math.log(a.m)) * e);
}
export const strokeK = (n, t) => clamp(n.k * stopFactor(n.stops, t), HARD_K_MIN, STROKE_K_MAX);

// A coarse path (an older stroke, or a preset) made fine: a Catmull-Rom spline through its points, re-sampled evenly at
// FINE_SPACING. The renderer measures distance to the polyline, which is circular around every corner, so a sparse
// polyline shows as a string of beads; at this spacing the corners turn too little to see.
const FINE_SPACING = 0.004; // of the long side, ~4px on a 1000px canvas
function refine(pts) {
  const n = pts.length, dense = [pts[0]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n - 1)];
    for (let s = 1; s <= 8; s++) {
      const t = s / 8, t2 = t * t, t3 = t2 * t;
      dense.push([0, 1].map(c => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  const len = cumLengths(dense).pop();
  return resample(dense, clamp(Math.round(len / FINE_SPACING) + 1, 2, MAX_STROKE_PTS)).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
}

// ---------- normalizer helpers (nodes.js) ----------
export function sanitizePts(raw) {
  const pts = Array.isArray(raw) ? raw.filter(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).map(p => [p[0], p[1]]) : [];
  if (pts.length < 2) return [[-0.1, 0], [0.1, 0]];
  if (pts.length > MAX_STROKE_PTS) return resample(pts, MAX_STROKE_PTS);
  const len = cumLengths(pts).pop();
  return pts.length < MAX_STROKE_PTS && len / (pts.length - 1) > FINE_SPACING * 1.5 ? refine(pts) : pts;
}
export function sanitizeStops(raw) {
  const stops = Array.isArray(raw)
    ? raw.filter(s => s && isNum(s.t) && isNum(s.m)).map(s => ({ t: clamp(s.t, 0, 1), m: clamp(s.m, STOP_M_MIN, STOP_M_MAX) }))
    : [];
  if (!stops.length) return defaultStops();
  stops.sort((a, b) => a.t - b.t);
  if (stops[0].t > 0) stops.unshift({ t: 0, m: stops[0].m });
  if (stops[stops.length - 1].t < 1) stops.push({ t: 1, m: stops[stops.length - 1].m });
  return stops;
}
