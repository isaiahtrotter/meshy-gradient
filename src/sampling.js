// Eyedropper: press I with a selection, then click the reference image or the gradient to sample a colour.
// Also exposes colorAtCanvasPoint(), which new nodes use to inherit the colour under the click.

import { state, selectedNodes } from './state.js';
import { session } from './session.js';
import { pushUndo } from './undo.js';
import { rgbToHex } from './color.js';
import { $, stage, frameRect, setStatus } from './dom.js';
import { preview, glCanvas, ref, draw, renderPreview, visibleRegion } from './view.js';
import { refreshAll } from './refresh.js';
import { setHint, DEFAULT_HINT } from './modes.js';

let glSnap = null; // 2D copy of the (grain-free) gradient for the loupe: just the visible part of the frame
let snapRegion = null; // which part (view.js visibleRegion()), so a point on screen can be found in the copy
const sameRegion = (a, b) => a.fw === b.fw && a.fh === b.fh && a.x0 === b.x0 && a.y0 === b.y0 && a.w === b.w && a.h === b.h;
function takeSnapshot() {
  snapRegion = renderPreview(true);
  glSnap = document.createElement('canvas'); glSnap.width = glCanvas.width; glSnap.height = glCanvas.height;
  glSnap.getContext('2d').drawImage(glCanvas, 0, 0); draw();
}

export function setSampling(on) {
  if (on && !state.selected.size) { setStatus('Select a node first, then press I to sample.', true); return; }
  session.sampling = on; stage.classList.toggle('sampling', on);
  if (on && preview) {
    takeSnapshot();
  }
  if (!on) { $('loupe').style.display = 'none'; $('loupeHex').style.display = 'none'; glSnap = null; snapRegion = null; }
  setHint(on ? 'Click the reference or the canvas to sample a color. Esc to cancel.' : DEFAULT_HINT);
}

// Which pixel source is under the pointer: the reference image or the gradient snapshot.
function sourceAt(cx, cy) {
  const rr = $('ref').getBoundingClientRect();
  if (ref.data && cx >= rr.left && cx <= rr.right && cy >= rr.top && cy <= rr.bottom)
    return { c: ref.data, x: (cx - rr.left) / rr.width * ref.data.width, y: (cy - rr.top) / rr.height * ref.data.height };
  const fr = frameRect();
  if (glSnap && !sameRegion(snapRegion, visibleRegion())) takeSnapshot(); // panned or zoomed since the copy was made
  if (glSnap && cx >= fr.left && cx <= fr.right && cy >= fr.top && cy <= fr.bottom)
    return { c: glSnap, x: (cx - fr.left) / fr.width * snapRegion.fw - snapRegion.x0, y: (cy - fr.top) / fr.height * snapRegion.fh - snapRegion.y0 };
  return null;
}
const clampPx = (src) => ({ px: Math.min(src.c.width - 1, Math.max(0, Math.floor(src.x))), py: Math.min(src.c.height - 1, Math.max(0, Math.floor(src.y))) });
function pixelHex(src) {
  const { px, py } = clampPx(src);
  const d = src.c.getContext('2d').getImageData(px, py, 1, 1).data;
  return rgbToHex(d[0], d[1], d[2]);
}

const loupeCtx = $('loupeCanvas').getContext('2d');
function updateLoupe(cx, cy) {
  const src = sourceAt(cx, cy), L = $('loupe'), H = $('loupeHex');
  if (!src) { L.style.display = 'none'; H.style.display = 'none'; return; }
  const N = 11, S = 132, cell = S / N, { px, py } = clampPx(src);
  loupeCtx.imageSmoothingEnabled = false; loupeCtx.clearRect(0, 0, S, S);
  loupeCtx.drawImage(src.c, px - (N - 1) / 2, py - (N - 1) / 2, N, N, 0, 0, S, S);
  loupeCtx.strokeStyle = 'rgba(0,0,0,.18)'; loupeCtx.lineWidth = 1; loupeCtx.beginPath();
  for (let i = 1; i < N; i++) { loupeCtx.moveTo(i * cell, 0); loupeCtx.lineTo(i * cell, S); loupeCtx.moveTo(0, i * cell); loupeCtx.lineTo(S, i * cell); }
  loupeCtx.stroke();
  const m = (N - 1) / 2 * cell; loupeCtx.strokeStyle = '#fff'; loupeCtx.lineWidth = 2; loupeCtx.strokeRect(m - 1, m - 1, cell + 2, cell + 2);
  loupeCtx.strokeStyle = 'rgba(0,0,0,.6)'; loupeCtx.lineWidth = 1; loupeCtx.strokeRect(m - 2.5, m - 2.5, cell + 5, cell + 5);
  L.style.display = 'block'; L.style.left = cx + 'px'; L.style.top = cy + 'px';
  H.style.display = 'block'; H.style.left = cx + 'px'; H.style.top = cy + 'px'; H.textContent = pixelHex(src).toUpperCase();
}
document.addEventListener('pointermove', e => { if (session.sampling) updateLoupe(e.clientX, e.clientY); });

// The rendered (grain-free) colour at a normalized canvas point, read back from the GPU.
export function colorAtCanvasPoint(nx, ny) {
  if (!preview) return null;
  const gl = preview.gl;
  const r = renderPreview(true); draw();
  // the canvas holds only the visible part of the frame, so the point's position is taken relative to that
  const at = (n, full, off, size) => Math.min(size - 1, Math.max(0, Math.floor(Math.min(0.9999, Math.max(0, n)) * full) - off));
  const px = at(nx, r.fw, r.x0, gl.drawingBufferWidth), py = gl.drawingBufferHeight - 1 - at(ny, r.fh, r.y0, gl.drawingBufferHeight);
  const d = new Uint8Array(4); gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, d);
  return rgbToHex(d[0], d[1], d[2]);
}

function sampleAt(cx, cy) {
  const src = sourceAt(cx, cy);
  if (src) {
    const hex = pixelHex(src);
    pushUndo();
    for (const n of selectedNodes()) n.color = hex;
    refreshAll(); setStatus(`Sampled ${hex.toUpperCase()}.`);
  }
  setSampling(false);
}
// Capture-phase and first-registered so a sampling click never reaches the selection/marquee handlers.
stage.addEventListener('pointerdown', e => {
  if (!session.sampling) return;
  e.preventDefault(); e.stopImmediatePropagation(); sampleAt(e.clientX, e.clientY);
}, true);
