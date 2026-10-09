// GLSL sources. Per-slot uniform layout (see renderer.js for the packing):
//   uType 0 circle:          uNode = (x, y, sl, sr)            uNode2 = (st, sb, k, th)        uTh2 = th2
//   uType 1 arc (or half):   uNode = (cx, cy, sw, sw)          uNode2 = (R, angleMid, halfSpan, k)
//   uType 2 unlinked circle: uNode = (x, y, lenL, lenR)        uNode2 = (lenT, lenB, k, angR)  uTh2 = angL  uNode3 = (angT, angB)
//   uType 3 line:            uNode = (Ax, Ay, Bx, By)          uNode2 = (sw, k, 0, 0)
//   uType 4 stroke:          uNode = (pointCount, sw, 0, 0)    points in row `slot` of uPts, one texel each: (x, y, k, 0)
// Circle x/y are normalized canvas coords; arc, line and stroke coords are already in scaled render space (× sc).
// uGrad[slot]: 1 if that slot fills with a screen-space linear gradient across its own `gradStops` instead of a
// flat uColor. uGradInfo[slot]: (pivotX, pivotY, halfSize, angleRad) in the same render-space units as `p` in
// main() below — t=0 sits at pivot - halfSize·dir, t=1 at pivot + halfSize·dir, dir = (cos, sin)(angleRad).
// uGradCount[slot]: number of stops (>= 2, <= MAX_GRAD_STOPS). uGradStopT[slot*MAX_GRAD_STOPS + j]: stop j's
// t. uGradStops: a MAX_GRAD_STOPS × MAXN float texture, one column per stop, one row per slot — texel
// (j, slot) is that stop's (r, g, b, a). A pixel's colour/alpha is interpolated between the two stops
// bracketing its t (flat beyond the first/last stop), after easing the 0..1 segment factor per uGradEase[slot]
// (0 linear, 1 ease-in, 2 ease-out, 3 ease-in-out — see gradEase() below and nodes.js's GRAD_EASE_TYPES).
// uOcc[slot]: 1 if that slot's node occludes (composites over the averaged base via alpha-over, in slot order)
// rather than joining the weighted-mean base layer. See the compositing step after the uBlendMode branch below.
// uOccSoft1[slot]/uOccSoft2[slot]: an occluding node's two user-set edge feather half-widths (already
// normalized, pre-divided by the canvas's reference long side in renderer.js) — uOccSoft1 on the side facing
// away from uOccAngle, uOccSoft2 on the side facing it, blended between around the shape. Equal values read
// as uniform softness. Occluding nodes ignore uSoft AND their own hardness (k) — they're rendered as a
// hard-edged shape at half its configured size (OCC_SIZE_SCALE, to read the same size as a non-occluding
// node), smoothstep-feathered by this per-direction width, instead of the continuous (1/(1+d²))^k falloff
// every non-occluding shape uses.

import { MAXN, MAX_STROKE_PTS as MAXP, MAX_GRAD_STOPS as MAXG } from './constants.js';

export const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

export const FS = `
  precision highp float;
  uniform vec2 uRes, uOff; uniform int uCount; uniform float uSoft, uGrain, uGrainSize, uSeed, uBlendMode, uRefW, uGrainType, uDensity; uniform vec3 uGrainM, uGrainA, uGrainB;
  uniform vec4 uNode[${MAXN}]; uniform vec4 uNode2[${MAXN}]; uniform float uTh2[${MAXN}]; uniform float uType[${MAXN}]; uniform vec4 uColor[${MAXN}]; uniform vec4 uAdj; uniform vec2 uNode3[${MAXN}]; uniform float uOcc[${MAXN}]; uniform float uOccSoft1[${MAXN}]; uniform float uOccSoft2[${MAXN}]; uniform float uOccAngle[${MAXN}];
  uniform float uGrad[${MAXN}]; uniform vec4 uGradInfo[${MAXN}]; uniform float uGradCount[${MAXN}]; uniform float uGradEase[${MAXN}];
  uniform float uGradStopT[${MAXN * MAXG}]; uniform sampler2D uGradStops;
  uniform sampler2D uPts;
  const float OCC_SIZE_SCALE = 0.5;
  float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
  vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }
  // Eases a 0..1 factor within one gradient stop-to-stop segment. Quadratic, not cubic — cheap and plenty
  // smooth at the size these ramps render.
  float gradEase(float f, float mode) {
    if (mode < 0.5) return f;
    if (mode < 1.5) return f * f;
    if (mode < 2.5) return f * (2.0 - f);
    return f < 0.5 ? 2.0 * f * f : -1.0 + (4.0 - 2.0 * f) * f;
  }
  // Feather half-width for an occluding shape at a boundary point offset dv from its centre: soft1 on the
  // side facing away from that node's blur angle, blending up to soft2 on the side facing it.
  float occFeather(vec2 dv, float angle, float soft1, float soft2){
    float len = length(dv);
    float cosA = len > 1e-6 ? dot(dv / len, vec2(cos(angle), sin(angle))) : 0.0;
    return max(mix(soft1, soft2, 0.5 + 0.5 * cosA), 1e-4);
  }
  // Polynomial smooth minimum: like min(a, b) but rounds off the crease where two values cross, by up to k/4.
  // The caller scales k with the value itself, so beside the path (values near 0) it vanishes and adjacent segments
  // don't leave a bead at every vertex; only in the far field, where creases form, does the rounding apply.
  float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
  }
  void main(){
    // uRes is the whole image's size; uOff is where this render's pixels sit inside it (zero unless only the visible part
    // of a zoomed-in preview is being drawn), so every pixel gets exactly the value it would in a full render
    vec2 fc = gl_FragCoord.xy + uOff;
    vec2 uv = fc / uRes; uv.y = 1.0 - uv.y;
    vec2 sc = uRes / max(uRes.x, uRes.y);
    vec2 p = uv * sc;
    vec3 acc = vec3(0.0); vec3 accLin = vec3(0.0); vec3 accLogM = vec3(0.0); vec3 accLogS = vec3(0.0); vec3 accMx = vec3(0.0); vec3 accMn = vec3(0.0); vec3 accAdd = vec3(0.0); float wsum = 0.0;
    // occluding nodes composite with a running "over" op, back to front in array order, on top of the averaged
    // base below (non-occluding nodes always flatten into that base regardless of array position)
    vec3 stackPM = vec3(0.0); float stackA = 0.0;
    for (int i = 0; i < ${MAXN}; i++) {
      if (i >= uCount) break;
      float w;
      if (uType[i] > 3.5) {
        // stroke: a polyline with a hardness per point. Each segment's weight is (1/(1+d²))^k with k interpolated
        // along it; keeping the strongest segment keeps the field continuous where the nearest segment switches.
        // Compared as k·log(1+d²) so each segment costs one log, and there's a single exp at the end.
        float cnt = uNode[i].x;
        float trueSize = uNode[i].y;
        float rr = max(uOcc[i] > 0.5 ? trueSize * OCC_SIZE_SCALE : trueSize * uSoft, 1e-4);
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
          float bj = mix(P0.z, P1.z, t) * log(1.0 + d2);
          best = smin(best, bj, 0.2 * min(best, bj) + 1e-4);
          minD2 = min(minD2, d2);
          P0 = P1;
        }
        if (uOcc[i] > 0.5) {
          // hard-edged tube of half-width trueSize × OCC_SIZE_SCALE, feathered by the average of uOccSoft1/2;
          // ignores per-point hardness. No directional blur here (no single centre to project against along
          // a whole path).
          float excess = (sqrt(minD2) - 1.0) * (trueSize * OCC_SIZE_SCALE);
          float feather = max((uOccSoft1[i] + uOccSoft2[i]) * 0.5, 1e-4);
          w = 1.0 - smoothstep(-feather, feather, excess);
        } else {
          w = exp(-best) + 1e-7 / (1.0 + minD2);
        }
      } else if (uType[i] > 2.5) {
        // line: a straight capsule between two explicit endpoints — distance to the nearest point on segment A -> B
        vec2 A = uNode[i].xy, B = uNode[i].zw;
        float sw = uNode2[i].x, kLine = uNode2[i].y;
        vec2 AB = B - A; float len2 = dot(AB, AB);
        float t = len2 > 1e-8 ? clamp(dot(p - A, AB) / len2, 0.0, 1.0) : 0.0;
        float dist = length(p - (A + t * AB));
        if (uOcc[i] > 0.5) {
          // hard-edged band of half-width sw × OCC_SIZE_SCALE, feathered by uOccSoft1/2; ignores kLine.
          // Direction projects against the offset from the segment's midpoint.
          vec2 mid = (A + B) * 0.5;
          float feather = occFeather(p - mid, uOccAngle[i], uOccSoft1[i], uOccSoft2[i]);
          float excess = dist - sw * OCC_SIZE_SCALE;
          w = 1.0 - smoothstep(-feather, feather, excess);
        } else {
          float rr = max(sw * uSoft, 1e-4);
          float dnorm = dist / rr;
          float d2 = dnorm * dnorm;
          w = pow(1.0 / (1.0 + d2), kLine) + 1e-7 / (1.0 + d2);
        }
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
        if (uOcc[i] > 0.5) {
          // hard-edged disc of radius Rr × OCC_SIZE_SCALE, feathered by uOccSoft1/2; ignores kUn
          float excess = dist - Rr * OCC_SIZE_SCALE;
          float feather = occFeather(dv, uOccAngle[i], uOccSoft1[i], uOccSoft2[i]);
          w = 1.0 - smoothstep(-feather, feather, excess);
        } else {
          float excess = dist - Rr;
          float rr = max(Rr * uSoft, 1e-4);
          float dnorm = excess / rr;
          float d2 = dnorm * dnorm;
          w = pow(1.0 / (1.0 + d2), kUn) + 1e-7 / (1.0 + d2);
        }
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
        if (uOcc[i] > 0.5) {
          // hard-edged band around the ring (or endpoint caps beyond the span) at OCC_SIZE_SCALE of its
          // configured width, feathered by uOccSoft1/2; ignores kArc. Direction projects against the offset
          // from the arc's own centre (used for both the ring and its endpoint caps).
          float soOcc = so * OCC_SIZE_SCALE, siOcc = si * OCC_SIZE_SCALE;
          float excess;
          if (abs(adiff) <= halfSpan) {
            float d0 = dist - R;
            excess = abs(d0) - (d0 >= 0.0 ? soOcc : siOcc);
          } else {
            vec2 e1 = ctr + R * vec2(cos(angleMid - halfSpan), sin(angleMid - halfSpan));
            vec2 e2 = ctr + R * vec2(cos(angleMid + halfSpan), sin(angleMid + halfSpan));
            float de = min(length(p - e1), length(p - e2));
            excess = de - (soOcc + siOcc) * 0.5;
          }
          float feather = occFeather(dv, uOccAngle[i], uOccSoft1[i], uOccSoft2[i]);
          w = 1.0 - smoothstep(-feather, feather, excess);
        } else {
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
        }
      } else {
        // circle: two independent axes; express the offset in the (u1, u2) basis and pick the per-side spread
        vec2 q = uNode[i].xy * sc; vec2 dd = p - q;
        vec2 u1 = vec2(cos(uNode2[i].w), sin(uNode2[i].w)), u2 = vec2(cos(uTh2[i]), sin(uTh2[i]));
        float det = u1.x * u2.y - u1.y * u2.x; det = abs(det) < 0.05 ? (det < 0.0 ? -0.05 : 0.05) : det;
        vec2 ab = vec2(dd.x * u2.y - dd.y * u2.x, u1.x * dd.y - u1.y * dd.x) / det;
        vec2 rBase = vec2(ab.x < 0.0 ? uNode[i].z : uNode[i].w, ab.y < 0.0 ? uNode2[i].x : uNode2[i].y);
        if (uOcc[i] > 0.5) {
          // hard-edged ellipse at OCC_SIZE_SCALE of its configured radii, feathered by uOccSoft1/2; ignores
          // its own hardness. The boundary distance is approximate (anisotropic radii aren't a true SDF) but
          // close enough for a thin edge feather.
          vec2 rOcc = rBase * OCC_SIZE_SCALE;
          vec2 dNorm = abs(ab) / max(rOcc, 1e-4);
          float excess = (length(dNorm) - 1.0) * ((rOcc.x + rOcc.y) * 0.5);
          float feather = occFeather(dd, uOccAngle[i], uOccSoft1[i], uOccSoft2[i]);
          w = 1.0 - smoothstep(-feather, feather, excess);
        } else {
          vec2 r = max(rBase * uSoft, 1e-4);
          vec2 d = abs(ab) / r; float d2 = dot(d, d);
          w = pow(1.0 / (1.0 + d2), uNode2[i].z) + 1e-7 / (1.0 + d2);
        }
      }
      vec3 c = uColor[i].rgb; float effA = uColor[i].a;
      if (uGrad[i] > 0.5) {
        // screen-space linear gradient across the shape's own extent, independent of the weight mask above
        vec2 piv = uGradInfo[i].xy, dirv = vec2(cos(uGradInfo[i].w), sin(uGradInfo[i].w));
        float t = clamp(0.5 + dot(p - piv, dirv) / (2.0 * max(uGradInfo[i].z, 1e-4)), 0.0, 1.0);
        int cnt = int(uGradCount[i]);
        float row = (float(i) + 0.5) / ${MAXN}.0;
        vec4 s0 = texture2D(uGradStops, vec2(0.5 / ${MAXG}.0, row));
        float t0 = uGradStopT[i * ${MAXG}];
        vec3 gc = s0.rgb; float ga = s0.a;
        for (int j = 1; j < ${MAXG}; j++) {
          if (j >= cnt) break;
          vec4 s1 = texture2D(uGradStops, vec2((float(j) + 0.5) / ${MAXG}.0, row));
          float t1 = uGradStopT[i * ${MAXG} + j];
          if (t <= t1 || j == cnt - 1) {
            float f = gradEase(clamp((t - t0) / max(t1 - t0, 1e-5), 0.0, 1.0), uGradEase[i]);
            gc = mix(s0.rgb, s1.rgb, f); ga = mix(s0.a, s1.a, f);
            break;
          }
          s0 = s1; t0 = t1;
        }
        c = gc; effA *= ga;
      }
      if (uOcc[i] > 0.5) {
        float ai = clamp(w * effA, 0.0, 1.0);
        stackPM = ai * c + (1.0 - ai) * stackPM;
        stackA = ai + (1.0 - ai) * stackA;
      } else {
        float wA = w * effA;
        acc += c * wA; accLin += toLin(c) * wA;
        accLogM += log(max(c, 1e-4)) * wA; accLogS += log(max(1.0 - c, 1e-4)) * wA;
        if (uBlendMode > 4.5) {
          if (uBlendMode > 7.5) accAdd += toLin(c) * min(wA, 1.0);
          else if (uBlendMode > 6.5) accMn += pow(max(1.0 - c, 1e-4), vec3(6.0)) * wA;
          else if (uBlendMode > 5.5) accMx += pow(max(c, 1e-4), vec3(6.0)) * wA;
        }
        wsum += wA;
      }
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
    } else if (uBlendMode < 4.5) {
      // overlay: a per-channel contrast curve applied to the normal blend
      vec3 b = normalCol;
      col = mix(2.0 * b * b, 1.0 - 2.0 * (1.0 - b) * (1.0 - b), step(0.5, b));
    } else if (uBlendMode < 5.5) {
      // soft light: the same idea, gentler — a smoothstep contrast curve on the normal blend
      vec3 b = normalCol;
      col = b * b * (3.0 - 2.0 * b);
    } else if (uBlendMode < 6.5) {
      // lighten: a weighted power mean (p = 6) leans hard toward the lightest colour in range, without a hard edge
      col = wsum > 0.0 ? pow(accMx / wsum, vec3(1.0 / 6.0)) : vec3(0.5);
    } else if (uBlendMode < 7.5) {
      // darken: the same on the inverted colours, so the darkest wins
      col = wsum > 0.0 ? 1.0 - pow(accMn / wsum, vec3(1.0 / 6.0)) : vec3(0.5);
    } else {
      // add: light sums in linear space, so overlaps glow (no normalising: empty space is black)
      col = toSrgb(accAdd);
    }
    // occluding nodes punch through the averaged base rather than blending into it
    col = stackPM + (1.0 - stackA) * col;
    // global variation: hue rotate, saturation, brightness, temperature
    const vec3 kk = vec3(0.57735), luma = vec3(0.2126, 0.7152, 0.0722);
    float ca = cos(uAdj.x), sa = sin(uAdj.x);
    col = col * ca + cross(kk, col) * sa + kk * dot(kk, col) * (1.0 - ca);
    float lum = dot(col, luma);
    col = mix(vec3(lum), col, uAdj.y) * uAdj.z;
    if (uAdj.w != 0.0) {
      // temperature (-1 cool .. 1 warm): a white-balance gain, red and blue pulled in opposite directions, then
      // divided by its own luminance so it shifts the colour without brightening or darkening (Brightness does that)
      vec3 gain = vec3(1.0 + 0.3 * uAdj.w, 1.0 + 0.05 * uAdj.w, 1.0 - 0.3 * uAdj.w);
      col *= gain / dot(gain, luma);
    }
    // grain cell size is relative to the canvas's logical width (uRefW), not device pixels, so it looks the
    // same in the small preview and a large export
    float grainPx = uGrainSize * (uRes.x / uRefW);
    vec2 cell = floor(fc / grainPx);
    float nR = hash(cell + uSeed);
    float nG = hash(cell + uSeed + 17.23);
    float nB = hash(cell + uSeed + 41.71);
    // density: fraction of cells that carry grain at all, so higher density reads as heavier speckle coverage
    float coverage = clamp(uDensity, 0.0, 2.0) * 0.5;
    float mask = step(1.0 - coverage, hash(cell + uSeed + 91.13));
    // mono tints one noise channel with its colour (white = plain speckle); duo mixes two noise channels, one per colour
    vec3 g = uGrainType > 1.5 ? vec3(nR, nG, nB) : (uGrainType > 0.5 ? nR * uGrainA + nG * uGrainB : vec3(nR) * uGrainM);
    col += (g - 0.5) * uGrain * mask;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;
