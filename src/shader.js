// GLSL sources. Per-slot uniform layout (see renderer.js for the packing):
//   uType 0 circle:          uNode = (x, y, sl, sr)            uNode2 = (st, sb, k, th)        uTh2 = th2
//   uType 1 arc (or half):   uNode = (cx, cy, sw, sw)          uNode2 = (R, angleMid, halfSpan, k)
//   uType 2 unlinked circle: uNode = (x, y, lenL, lenR)        uNode2 = (lenT, lenB, k, angR)  uTh2 = angL  uNode3 = (angT, angB)
//   uType 3 line:            uNode = (Ax, Ay, Bx, By)          uNode2 = (sw, k, 0, 0)
//   uType 4 stroke:          uNode = (pointCount, sw, 0, 0)    points in row `slot` of uPts, one texel each: (x, y, k, 0)
// Circle x/y are normalized canvas coords; arc, line and stroke coords are already in scaled render space (× sc).

import { MAXN, MAX_STROKE_PTS as MAXP } from './constants.js';

export const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

export const FS = `
  precision highp float;
  uniform vec2 uRes; uniform int uCount; uniform float uSoft, uGrain, uGrainSize, uSeed, uBlendMode, uRefW, uGrainType, uDensity;
  uniform vec4 uNode[${MAXN}]; uniform vec4 uNode2[${MAXN}]; uniform float uTh2[${MAXN}]; uniform float uType[${MAXN}]; uniform vec4 uColor[${MAXN}]; uniform vec3 uAdj; uniform vec2 uNode3[${MAXN}];
  uniform sampler2D uPts;
  float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
  vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }
  void main(){
    vec2 uv = gl_FragCoord.xy / uRes; uv.y = 1.0 - uv.y;
    vec2 sc = uRes / max(uRes.x, uRes.y);
    vec2 p = uv * sc;
    vec3 acc = vec3(0.0); vec3 accLin = vec3(0.0); vec3 accLogM = vec3(0.0); vec3 accLogS = vec3(0.0); float wsum = 0.0;
    for (int i = 0; i < ${MAXN}; i++) {
      if (i >= uCount) break;
      float w;
      if (uType[i] > 3.5) {
        // stroke: a polyline with a hardness per point. Each segment's weight is (1/(1+d²))^k with k interpolated
        // along it; keeping the strongest segment keeps the field continuous where the nearest segment switches.
        // Compared as k·log(1+d²) so each segment costs one log, and there's a single exp at the end.
        float cnt = uNode[i].x, rr = max(uNode[i].y * uSoft, 1e-4);
        float row = (float(i) + 0.5) / ${MAXN}.0;
        vec3 P0 = texture2D(uPts, vec2(0.5 / ${MAXP}.0, row)).xyz;
        float best = 1e9, minD2 = 1e9;
        for (int j = 1; j < ${MAXP}; j++) {
          if (float(j) >= cnt) break;
          vec3 P1 = texture2D(uPts, vec2((float(j) + 0.5) / ${MAXP}.0, row)).xyz;
          vec2 AB = P1.xy - P0.xy; float len2 = dot(AB, AB);
          float t = len2 > 1e-10 ? clamp(dot(p - P0.xy, AB) / len2, 0.0, 1.0) : 0.0;
          vec2 dv = (p - (P0.xy + t * AB)) / rr;
          float d2 = dot(dv, dv);
          best = min(best, mix(P0.z, P1.z, t) * log(1.0 + d2));
          minD2 = min(minD2, d2);
          P0 = P1;
        }
        w = exp(-best) + 1e-7 / (1.0 + minD2);
      } else if (uType[i] > 2.5) {
        // line: a straight capsule between two explicit endpoints — distance to the nearest point on segment A -> B
        vec2 A = uNode[i].xy, B = uNode[i].zw;
        float sw = uNode2[i].x, kLine = uNode2[i].y;
        vec2 AB = B - A; float len2 = dot(AB, AB);
        float t = len2 > 1e-8 ? clamp(dot(p - A, AB) / len2, 0.0, 1.0) : 0.0;
        float dist = length(p - (A + t * AB));
        float rr = max(sw * uSoft, 1e-4);
        float dnorm = dist / rr;
        float d2 = dnorm * dnorm;
        w = pow(1.0 / (1.0 + d2), kLine) + 1e-7 / (1.0 + d2);
      } else if (uType[i] > 1.5) {
        // unlinked circle: 4 independently angled/lengthed arms. The "radius" at a pixel's angle is an
        // inverse-angular-distance blend of the 4 arm lengths — exact at each arm's own angle, smooth between.
        vec2 ctr = uNode[i].xy * sc;
        float lenL = uNode[i].z, lenR = uNode[i].w, lenT = uNode2[i].x, lenB = uNode2[i].y, kUn = uNode2[i].z;
        float angR = uNode2[i].w, angL = uTh2[i], angT = uNode3[i].x, angB = uNode3[i].y;
        vec2 dv = p - ctr;
        float dist = length(dv);
        float ap = atan(dv.y, dv.x);
        float dR = ap - angR; dR = atan(sin(dR), cos(dR)); float wR = 1.0 / (dR * dR + 0.015);
        float dT = ap - angT; dT = atan(sin(dT), cos(dT)); float wT = 1.0 / (dT * dT + 0.015);
        float dL = ap - angL; dL = atan(sin(dL), cos(dL)); float wL = 1.0 / (dL * dL + 0.015);
        float dB = ap - angB; dB = atan(sin(dB), cos(dB)); float wB = 1.0 / (dB * dB + 0.015);
        float Rr = (wR * lenR + wT * lenT + wL * lenL + wB * lenB) / (wR + wT + wL + wB);
        float excess = dist - Rr;
        float rr = max(Rr * uSoft, 1e-4);
        float dnorm = excess / rr;
        float d2 = dnorm * dnorm;
        w = pow(1.0 / (1.0 + d2), kUn) + 1e-7 / (1.0 + d2);
      } else if (uType[i] > 0.5) {
        // arc: the circle is fit on the CPU each frame; inside the angular span measure radial distance to the
        // ring, outside it measure distance to the nearer endpoint
        vec2 ctr = uNode[i].xy;
        float so = uNode[i].z, si = uNode[i].w;
        float R = uNode2[i].x, angleMid = uNode2[i].y, halfSpan = uNode2[i].z, kArc = uNode2[i].w;
        vec2 dv = p - ctr;
        float dist = length(dv);
        float adiff = atan(dv.y, dv.x) - angleMid;
        adiff = atan(sin(adiff), cos(adiff));
        float dnorm;
        if (abs(adiff) <= halfSpan) {
          float excess = dist - R;
          float rr = max((excess >= 0.0 ? so : si) * uSoft, 1e-4);
          dnorm = excess / rr;
        } else {
          vec2 e1 = ctr + R * vec2(cos(angleMid - halfSpan), sin(angleMid - halfSpan));
          vec2 e2 = ctr + R * vec2(cos(angleMid + halfSpan), sin(angleMid + halfSpan));
          float de = min(length(p - e1), length(p - e2));
          float rr = max(((so + si) * 0.5) * uSoft, 1e-4);
          dnorm = de / rr;
        }
        float d2 = dnorm * dnorm;
        w = pow(1.0 / (1.0 + d2), kArc) + 1e-7 / (1.0 + d2);
      } else {
        // circle: two independent axes; express the offset in the (u1, u2) basis and pick the per-side spread
        vec2 q = uNode[i].xy * sc; vec2 dd = p - q;
        vec2 u1 = vec2(cos(uNode2[i].w), sin(uNode2[i].w)), u2 = vec2(cos(uTh2[i]), sin(uTh2[i]));
        float det = u1.x * u2.y - u1.y * u2.x; det = abs(det) < 0.05 ? (det < 0.0 ? -0.05 : 0.05) : det;
        vec2 ab = vec2(dd.x * u2.y - dd.y * u2.x, u1.x * dd.y - u1.y * dd.x) / det;
        vec2 r = max(vec2(ab.x < 0.0 ? uNode[i].z : uNode[i].w, ab.y < 0.0 ? uNode2[i].x : uNode2[i].y) * uSoft, 1e-4);
        vec2 d = abs(ab) / r; float d2 = dot(d, d);
        w = pow(1.0 / (1.0 + d2), uNode2[i].z) + 1e-7 / (1.0 + d2);
      }
      w *= uColor[i].a;
      vec3 c = uColor[i].rgb;
      acc += c * w; accLin += toLin(c) * w;
      accLogM += log(max(c, 1e-4)) * w; accLogS += log(max(1.0 - c, 1e-4)) * w;
      wsum += w;
    }
    vec3 normalCol = wsum > 0.0 ? acc / wsum : vec3(0.5);
    vec3 col;
    if (uBlendMode < 0.5) {
      col = normalCol;
    } else if (uBlendMode < 1.5) {
      // linear: average in linear light, not sRGB, so overlaps don't darken as much
      col = wsum > 0.0 ? toSrgb(accLin / wsum) : vec3(0.5);
    } else if (uBlendMode < 2.5) {
      // multiply: weighted geometric mean, order-independent generalization of Photoshop multiply
      col = wsum > 0.0 ? exp(accLogM / wsum) : vec3(0.5);
    } else if (uBlendMode < 3.5) {
      // screen: multiply on the inverted colours, then invert back — lightens overlaps
      col = wsum > 0.0 ? 1.0 - exp(accLogS / wsum) : vec3(0.5);
    } else {
      // overlay: a per-channel contrast curve applied to the normal blend
      vec3 b = normalCol;
      col = mix(2.0 * b * b, 1.0 - 2.0 * (1.0 - b) * (1.0 - b), step(0.5, b));
    }
    // global variation: hue rotate, saturation, brightness
    const vec3 kk = vec3(0.57735);
    float ca = cos(uAdj.x), sa = sin(uAdj.x);
    col = col * ca + cross(kk, col) * sa + kk * dot(kk, col) * (1.0 - ca);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uAdj.y) * uAdj.z;
    // grain cell size is relative to the canvas's logical width (uRefW), not device pixels, so it looks the
    // same in the small preview and a large export
    float grainPx = uGrainSize * (uRes.x / uRefW);
    vec2 cell = floor(gl_FragCoord.xy / grainPx);
    float nR = hash(cell + uSeed);
    float nG = hash(cell + uSeed + 17.23);
    float nB = hash(cell + uSeed + 41.71);
    // density: fraction of cells that carry grain at all, so higher density reads as heavier speckle coverage
    float coverage = clamp(uDensity, 0.0, 2.0) * 0.5;
    float mask = step(1.0 - coverage, hash(cell + uSeed + 91.13));
    vec3 g = uGrainType > 1.5 ? vec3(nR, nG, nB) : (uGrainType > 0.5 ? vec3(nR, nR, nG) : vec3(nR));
    col += (g - 0.5) * uGrain * mask;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;
