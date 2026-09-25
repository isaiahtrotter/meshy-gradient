// Eyedropper: press I with a selection, then click the reference image or the gradient to sample a colour.
// Also exposes colorAtCanvasPoint(), which new nodes use to inherit the colour under the click.

import { state, selectedNodes } from './state.js';
import { session } from './session.js';
import { pushUndo } from './undo.js';
import { rgbToHex } from './color.js';
import { $, stage, frameRect, setStatus } from './dom.js';
import { preview, glCanvas, ref, draw } from './view.js';
import { refreshAll } from './refresh.js';
import { setHint, DEFAULT_HINT } from './modes.js';

let glSnap = null; // 2D copy of the (grain-free) gradient for the loupe

export function setSampling(on) {
  if (on && !state.selected.size) { setStatus('Select a node first, then press I to sample.', true); return; }
  session.sampling = on; stage.classList.toggle('sampling', on);
  if (on && preview) {
    preview.renderClean(glCanvas.width, glCanvas.height, state);
    glSnap = document.createElement('canvas'); glSnap.width = glCanvas.width; glSnap.height = glCanvas.height;
    glSnap.getContext('2d').drawImage(glCanvas, 0, 0); draw();
  }
  if (!on) { $('loupe').style.display = 'none'; $('loupeHex').style.display = 'none'; glSnap = null; }
  setHint(on ? 'Click the reference or the canvas to sample a color. Esc to cancel.' : DEFAULT_HINT);
}

// Which pixel source is under the pointer: the reference image or the gradient snapshot.
function sourceAt(cx, cy) {
  const rr = $('ref').getBoundingClientRect();
  if (ref.data && cx >= rr.left && cx <= rr.right && cy >= rr.top && cy <= rr.bottom)
    return { c: ref.data, x: (cx - rr.left) / rr.width * ref.data.width, y: (cy - rr.top) / rr.height * ref.data.height };
  const fr = frameRect();
  if (glSnap && cx >= fr.left && cx <= fr.right && cy >= fr.top && cy <= fr.bottom)
    return { c: glSnap, x: (cx - fr.left) / fr.width * glSnap.width, y: (cy - fr.top) / fr.height * glSnap.height };
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
  preview.renderClean(glCanvas.width, glCanvas.height, state); draw();
  const px = Math.floor(Math.min(0.9999, Math.max(0, nx)) * gl.drawingBufferWidth), py = Math.floor((1 - Math.min(0.9999, Math.max(0, ny))) * gl.drawingBufferHeight);
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
