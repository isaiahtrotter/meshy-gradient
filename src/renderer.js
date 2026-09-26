// WebGL renderer. makeRenderer(canvas) compiles the program once; render(w, h, scene) packs the scene's nodes
// into uniform slots and draws. `scene` is the state object (nodes, soft, grain, grainSize, grainType, density,
// seed, blendMode, w, adj).

import { MAXN, MAX_STROKE_PTS } from './constants.js';
import { VS, FS } from './shader.js';
import { hexToRgb } from './color.js';
import { armAngle, armEnds, arcCurves } from './nodes.js';
import { cumLengths, strokeWorld, strokeK } from './stroke.js';

const GPU_ARC_EPS = 0.03; // keeps arc circle centres within float32 precision near the phi = 0 snap
const GRAIN_TYPE_INDEX = { mono: 0, duo: 1, multi: 2 };
const BLEND_MODE_INDEX = { normal: 0, linear: 1, multiply: 2, screen: 3, overlay: 4 };

export function makeRenderer(canvas, opts) {
  const gl = canvas.getContext('webgl', Object.assign({ antialias: false, alpha: false, premultipliedAlpha: false }, opts || {}));
  if (!gl) return null;
  const sh = (t, s) => {
    const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
    return o;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['uRes', 'uCount', 'uSoft', 'uGrain', 'uGrainSize', 'uSeed', 'uBlendMode', 'uRefW', 'uGrainType', 'uDensity', 'uNode', 'uNode2', 'uTh2', 'uType', 'uColor', 'uAdj', 'uNode3', 'uPts']) U[n] = gl.getUniformLocation(prog, n);

  const nodeArr = new Float32Array(MAXN * 4), node2Arr = new Float32Array(MAXN * 4), colArr = new Float32Array(MAXN * 4);
  const th2Arr = new Float32Array(MAXN), typeArr = new Float32Array(MAXN), node3Arr = new Float32Array(MAXN * 2);

  // Stroke points: too many for uniforms, so they go in a float texture, one row per slot, one texel per point.
  // Without float textures (rare) strokes are skipped rather than failing the whole render.
  const canFloat = !!gl.getExtension('OES_texture_float');
  const ptsArr = new Float32Array(MAXN * MAX_STROKE_PTS * 4);
  const ptsTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ptsTex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  if (canFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAX_STROKE_PTS, MAXN, 0, gl.RGBA, gl.FLOAT, ptsArr);
  gl.uniform1i(U.uPts, 0);

  const put4 = (arr, slot, a, b, c, d) => { arr[slot * 4] = a; arr[slot * 4 + 1] = b; arr[slot * 4 + 2] = c; arr[slot * 4 + 3] = d; };
  const putColor = (slot, rgb, a) => put4(colArr, slot, rgb[0], rgb[1], rgb[2], a);
  const putArc = (slot, g, sw, k) => { put4(nodeArr, slot, g.cx, g.cy, sw, sw); put4(node2Arr, slot, g.R, g.angleMid, g.halfSpan, k); th2Arr[slot] = 0; typeArr[slot] = 1; };
  const putLine = (slot, A, B, sw, k) => { put4(nodeArr, slot, A.x, A.y, B.x, B.y); put4(node2Arr, slot, sw, k, 0, 0); th2Arr[slot] = 0; typeArr[slot] = 3; };
  function putStroke(slot, n, C) {
    const P = strokeWorld(n, C, 1), cum = cumLengths(P), total = cum[cum.length - 1] || 1, row = slot * MAX_STROKE_PTS * 4;
    P.forEach(([x, y], j) => { const o = row + j * 4; ptsArr[o] = x; ptsArr[o + 1] = y; ptsArr[o + 2] = strokeK(n, cum[j] / total); ptsArr[o + 3] = 0; });
    put4(nodeArr, slot, P.length, n.sw, 0, 0); put4(node2Arr, slot, 0, 0, 0, 0); th2Arr[slot] = 0; typeArr[slot] = 4;
  }

  // Number of slots used, and whether any stroke was packed (its points then need uploading).
  function packNodes(nodes, w, h) {
    const scX = w >= h ? 1 : w / h, scY = w >= h ? h / w : 1; // mirrors the shader's `sc`
    let slot = 0, strokes = false;
    for (const n of nodes) {
      if (slot >= MAXN) break;
      const rgb = hexToRgb(n.color);
      if (n.type === 'stroke') {
        if (!canFloat) continue;
        putStroke(slot, n, { x: n.x * scX, y: n.y * scY }); putColor(slot, rgb, n.a); slot++; strokes = true;
      } else if (n.type === 'arc') {
        // an unlinked arc is two independent half-circles, so it costs two slots
        const C = { x: n.x * scX, y: n.y * scY };
        for (const g of arcCurves(n, C, 1, GPU_ARC_EPS)) {
          if (slot >= MAXN) break;
          putArc(slot, g, n.sw, n.k); putColor(slot, rgb, n.a); slot++;
        }
      } else if (n.type === 'line') {
        // unlinked costs two slots too: one ray from the centre per arm
        const C = { x: n.x * scX, y: n.y * scY }, { l, r } = armEnds(n, C, 1);
        const segs = n.linked ? [[l, r]] : [[C, r], [C, l]];
        for (const [A, B] of segs) {
          if (slot >= MAXN) break;
          putLine(slot, A, B, n.sw, n.k); putColor(slot, rgb, n.a); slot++;
        }
      } else {
        put4(nodeArr, slot, n.x, n.y, n.sl, n.sr);
        if (n.linked) {
          put4(node2Arr, slot, n.st, n.sb, n.k, n.th); th2Arr[slot] = n.th2; typeArr[slot] = 0;
        } else {
          put4(node2Arr, slot, n.st, n.sb, n.k, armAngle(n, 'r'));
          th2Arr[slot] = armAngle(n, 'l'); node3Arr[slot * 2] = armAngle(n, 't'); node3Arr[slot * 2 + 1] = armAngle(n, 'b');
          typeArr[slot] = 2;
        }
        putColor(slot, rgb, n.a); slot++;
      }
    }
    return { count: slot, strokes };
  }

  return {
    gl,
    render(w, h, s) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(prog);
      const { count, strokes } = packNodes(s.nodes, w, h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ptsTex);
      if (strokes) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_STROKE_PTS, MAXN, gl.RGBA, gl.FLOAT, ptsArr);
      gl.uniform2f(U.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1i(U.uCount, count);
      gl.uniform1f(U.uSoft, s.soft / 0.2); gl.uniform1f(U.uGrain, s.grain); gl.uniform1f(U.uGrainSize, s.grainSize);
      gl.uniform1f(U.uSeed, s.seed); gl.uniform1f(U.uBlendMode, BLEND_MODE_INDEX[s.blendMode] || 0); gl.uniform1f(U.uRefW, s.w);
      gl.uniform1f(U.uGrainType, GRAIN_TYPE_INDEX[s.grainType] || 0); gl.uniform1f(U.uDensity, s.density);
      gl.uniform4f(U.uAdj, s.adj.hue * Math.PI / 180, s.adj.sat, s.adj.bri, (s.adj.temp || 0) / 100);
      gl.uniform4fv(U.uNode, nodeArr); gl.uniform4fv(U.uNode2, node2Arr); gl.uniform2fv(U.uNode3, node3Arr);
      gl.uniform1fv(U.uTh2, th2Arr); gl.uniform1fv(U.uType, typeArr); gl.uniform4fv(U.uColor, colArr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    // Renders once with grain off; used by the eyedropper so samples aren't noisy.
    renderClean(w, h, s) {
      const g = s.grain; s.grain = 0;
      try { this.render(w, h, s); } finally { s.grain = g; }
    },
  };
}
