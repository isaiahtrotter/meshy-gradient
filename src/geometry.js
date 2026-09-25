// Pure arc geometry. No DOM, no state: everything comes in through arguments so it can be unit-tested.

export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// The circle through C, tangent to angle `th` there, bent by `phi`, for an arm of length `len`. Built from signed
// curvature (2·sin(phi)/len) rather than fitting through three points, so the arm-end handles always sit exactly on
// the drawn curve. As phi → 0 the radius grows very large and flips sign at 0. `eps` floors |sin(phi)| purely to
// dodge a divide-by-zero: the GPU path passes a real cap (0.03) so float32 stays precise near the snap; the
// on-screen handle path passes nothing and gets a negligible one.
function arcCircle(C, th, phi, len, eps) {
  let s = Math.sin(phi || 0);
  const EPS = eps ?? 1e-6;
  if (Math.abs(s) < EPS) s = s < 0 ? -EPS : EPS;
  const R = len / (2 * s);
  const cx = C.x - R * Math.sin(th), cy = C.y + R * Math.cos(th);
  return { cx, cy, R, aC: Math.atan2(C.y - cy, C.x - cx) };
}
const angleOn = (c, P) => wrapAngle(Math.atan2(P.y - c.cy, P.x - c.cx) - c.aC);

// One shared circle spanning P1 → C → P2 (a linked arc).
export function arcGeom(C, th, phi, P1, P2, len, eps) {
  const c = arcCircle(C, th, phi, len, eps);
  const d1 = angleOn(c, P1);
  let d2 = angleOn(c, P2);
  if (d1 * d2 > 0) d2 -= (d2 < 0 ? -1 : 1) * 2 * Math.PI; // take the arc that passes through C
  return { cx: c.cx, cy: c.cy, R: Math.abs(c.R), angleMid: c.aC + (d1 + d2) / 2, halfSpan: Math.abs(d1 - d2) / 2 };
}
// One independent half, C → P (each side of an unlinked arc gets its own circle; they only meet at C).
export function halfArcGeom(C, th, phi, P, len, eps) {
  const c = arcCircle(C, th, phi, len, eps);
  const d = angleOn(c, P);
  return { cx: c.cx, cy: c.cy, R: Math.abs(c.R), angleMid: c.aC + d / 2, halfSpan: Math.abs(d) / 2 };
}
