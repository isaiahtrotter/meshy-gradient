// Everything about how the document is shown on the stage: the preview renderer, fit-to-stage layout, zoom/pan,
// and the reference image that sits beside the canvas.

import { ZOOM_MIN, ZOOM_MAX } from './constants.js';
import { state } from './state.js';
import { $, stage, frame, work, frameRect, setStatus } from './dom.js';
import { makeRenderer } from './renderer.js';
import { scheduleSave } from './persistence.js';
import { refreshHandles } from './handles.js';
import { updateExportSize } from './exporter.js';

// ---------- Preview renderer ----------
export const glCanvas = $('gl');
export const preview = makeRenderer(glCanvas);
if (!preview) setStatus('WebGL is not available in this browser, so the gradient can’t render.', true);

let raf = 0;
export function draw() {
  scheduleSave(); // every visible change is worth persisting; the save itself is debounced
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0; if (!preview) return;
    const rect = frameRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cap = 4096; // deep zoom on a large canvas would otherwise ask for an enormous framebuffer
    preview.render(Math.min(cap, Math.max(1, Math.round(rect.width * dpr))), Math.min(cap, Math.max(1, Math.round(rect.height * dpr))), state);
  });
}

// ---------- Reference image ----------
export const ref = { img: null, data: null }; // loaded image + a 2D canvas of its pixels for sampling
const REF_STORAGE_KEY = 'meshGradientRefImage.v1';
function applyReferenceImage(url, persist) {
  const img = new Image();
  img.onload = () => {
    ref.img = img; $('refImg').src = url; $('ref').hidden = false;
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0); ref.data = c;
    $('refBtn').textContent = 'Replace image'; layout();
    if (persist) {
      try { localStorage.setItem(REF_STORAGE_KEY, c.toDataURL()); }
      catch { try { localStorage.removeItem(REF_STORAGE_KEY); } catch {} } // e.g. quota exceeded: it just won't survive a refresh
    }
  };
  img.src = url;
}
export function setReference(file) {
  if (!file || !file.type.startsWith('image/')) return;
  applyReferenceImage(URL.createObjectURL(file), true);
}
export function restoreReference() {
  try { const url = localStorage.getItem(REF_STORAGE_KEY); if (url) applyReferenceImage(url, false); } catch {}
}
export function clearReference() {
  ref.img = null; ref.data = null; $('ref').hidden = true; $('refImg').removeAttribute('src'); $('refBtn').textContent = 'Add image'; layout();
  try { localStorage.removeItem(REF_STORAGE_KEY); } catch {}
}

// ---------- Layout ----------
export function layout() {
  const pad = 28 * 2;
  const availW = stage.clientWidth - pad, availH = stage.clientHeight - pad - 40;
  const ac = state.w / state.h;
  let h, ar;
  if (ref.img) {
    ar = ref.img.naturalWidth / ref.img.naturalHeight;
    h = Math.min(availH, (availW - 24) / (ar + ac));
  } else h = Math.min(availH, availW / ac);
  h = Math.max(40, h) * view.zoom; // zoom scales the fit size before it's applied to either panel, so the reference stays locked to the canvas
  if (ref.img) { $('ref').style.width = (h * ar) + 'px'; $('ref').style.height = h + 'px'; }
  frame.style.width = (h * ac) + 'px';
  frame.style.height = h + 'px';
  applyPan();
  $('sizeTag').textContent = `${state.w} × ${state.h} px`;
  updateExportSize();
  refreshHandles(); draw();
}
new ResizeObserver(() => layout()).observe(stage);

// ---------- Zoom + pan ----------
// `zoom` multiplies the fit-to-stage size; `pan` translates the work group in stage pixels. Handles keep their
// screen size because they're laid out from the frame's on-screen rect, so zooming just gives more room to work.
export const view = { zoom: 1, panX: 0, panY: 0 };
export function applyPan() {
  // keep at least 60px of the work group inside the stage on each axis so it can't be lost off-screen
  const S = { w: stage.clientWidth, h: stage.clientHeight }, W = { w: work.offsetWidth, h: work.offsetHeight };
  const lim = (s, w) => Math.max(0, (s + w) / 2 - 60);
  view.panX = Math.min(lim(S.w, W.w), Math.max(-lim(S.w, W.w), view.panX));
  view.panY = Math.min(lim(S.h, W.h), Math.max(-lim(S.h, W.h), view.panY));
  work.style.transform = `translate(${view.panX}px, ${view.panY}px)`;
}
// Zoom so the canvas point under (cx, cy) stays put; defaults to the stage centre.
export function setZoom(z, cx, cy) {
  z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const sr = stage.getBoundingClientRect();
  if (cx == null) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
  const r = frameRect();
  const ux = (cx - r.left) / r.width, uy = (cy - r.top) / r.height;
  view.zoom = z; layout();
  const r2 = frameRect();
  view.panX += cx - (r2.left + ux * r2.width); view.panY += cy - (r2.top + uy * r2.height);
  applyPan(); refreshHandles(); draw();
}
export function resetZoom() { view.zoom = 1; view.panX = view.panY = 0; layout(); }
export function panBy(dx, dy) { view.panX += dx; view.panY += dy; applyPan(); refreshHandles(); draw(); }

stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { // pinch on a trackpad arrives as ctrl+wheel
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * 1.5); // 1.5x: more zoom per inch of trackpad travel
    setZoom(view.zoom * factor, e.clientX, e.clientY);
  } else {
    const k = e.deltaMode === 1 ? 16 : 1;
    panBy(-e.deltaX * k, -e.deltaY * k);
  }
}, { passive: false });

// Reference: button, paste, drop
$('refBtn').addEventListener('click', () => $('refFile').click());
$('refFile').addEventListener('change', e => { setReference(e.target.files[0]); e.target.value = ''; });
$('refRemove').addEventListener('click', clearReference);
document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')); if (f) { e.preventDefault(); setReference(f); } });
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dropping'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
stage.addEventListener('drop', e => { e.preventDefault(); stage.classList.remove('dropping'); setReference(e.dataTransfer.files[0]); });
