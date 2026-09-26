// Brush-stroke geometry: pure maths on paths of [x, y] pairs, no DOM.
//
// A stroke node keeps its drawn path in `pts`: points relative to the node's pivot (its x, y) in fractions of the
// canvas's long side (the same units as arcs and lines), before rotation; `th` rotates the whole path about the
// pivot. `stops` shape hardness along the path: [{ t, m }] sorted by t, where t is the arc-length fraction (0 at
// the first point, 1 at the last) and m multiplies the node's own `k`, so the main hardness ring still scales the
// whole profile at once. There is always a stop at t = 0 and one at t = 1.

import { MAX_STROKE_PTS, HARD_K_MIN, HARD_K_MAX, clamp, isNum } from './constants.js';

export const STOP_M_MIN = 0.01, STOP_M_MAX = 100;
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
const DENSE_PX = 3, SMOOTH_RADIUS = 5;
export function smoothStroke(raw, spacing) {
  if (raw.length < 2) return raw.map(p => [p[0], p[1]]);
  const len = cumLengths(raw)[raw.length - 1];
  const dense = resample(raw, clamp(Math.round(len / DENSE_PX), 2, 4000));
  const smooth = dense.map((p, i) => {
    const r = Math.min(SMOOTH_RADIUS, i, dense.length - 1 - i);
    let x = 0, y = 0;
    for (let j = -r; j <= r; j++) { x += dense[i + j][0]; y += dense[i + j][1]; }
    return [x / (2 * r + 1), y / (2 * r + 1)];
  });
  return resample(smooth, clamp(Math.round(len / spacing) + 1, 2, MAX_STROKE_PTS));
}

// A drawn path in frame px → the node fields: pivot at the path's bounding-box centre, points relative to it in
// long-side units, unrotated. `dims` is maxDim().
export function strokeFromPath(path, dims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of path) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r5 = v => Math.round(v * 1e5) / 1e5;
  return { x: cx / dims.w, y: cy / dims.h, th: 0, pts: path.map(([x, y]) => [r5((x - cx) / dims.m), r5((y - cy) / dims.m)]) };
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
export const strokeK = (n, t) => clamp(n.k * stopFactor(n.stops, t), HARD_K_MIN, HARD_K_MAX);

// ---------- normalizer helpers (nodes.js) ----------
export function sanitizePts(raw) {
  const pts = Array.isArray(raw) ? raw.filter(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).map(p => [p[0], p[1]]) : [];
  if (pts.length < 2) return [[-0.1, 0], [0.1, 0]];
  return pts.length > MAX_STROKE_PTS ? resample(pts, MAX_STROKE_PTS) : pts;
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
