// Everything about how the document is shown on the stage: the preview renderer, fit-to-stage layout, zoom/pan,
// and the reference image that sits beside the canvas.

import { ZOOM_MIN, ZOOM_MAX } from './constants.js';
import { state } from './state.js';
import { session } from './session.js';
import { $, stage, frame, work, frameRect, setStatus } from './dom.js';
import { makeRenderer } from './renderer.js';
import { scheduleSave } from './persistence.js';
import { refreshHandles } from './handles.js';
import { updateExportSize } from './exporter.js';

// ---------- Preview renderer ----------
export const glCanvas = $('gl');
export const preview = makeRenderer(glCanvas);
if (!preview) setStatus('WebGL is not available in this browser, so the gradient can’t render.', true);

// The preview is drawn at the frame's on-screen size × DPR, but only the part of the frame that's inside the stage:
// zoomed in, the frame is far bigger than the screen, and drawing all of it would cost more the closer you get (and,
// capped, would squash the gradient). So the canvas covers just the visible part, placed inside the frame, and the
// shader (renderer.js `region`) fills it with the same pixels a full render would give there.
// fw × fh is the whole frame in device pixels; x0, y0, w, h the visible part of it (y from the top).
const VISIBLE_MARGIN = 16; // css px drawn beyond the stage edge, so a sub-pixel shift never shows a gap
export function visibleRegion() {
  const rect = frameRect(), sr = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fw = Math.max(1, Math.round(rect.width * dpr)), fh = Math.max(1, Math.round(rect.height * dpr));
  const span = (lo, hi, len, full) => {
    const a = Math.min(full - 1, Math.max(0, Math.floor((lo - VISIBLE_MARGIN) / len * full)));
    const b = Math.max(a + 1, Math.min(full, Math.ceil((hi + VISIBLE_MARGIN) / len * full)));
    return [a, b];
  };
  const [x0, x1] = span(sr.left - rect.left, sr.right - rect.left, rect.width, fw);
  const [y0, y1] = span(sr.top - rect.top, sr.bottom - rect.top, rect.height, fh);
  return { fw, fh, x0, y0, w: x1 - x0, h: y1 - y0 };
}
// Renders the visible part of the frame onto the canvas and places the canvas over it. Returns the region drawn.
export function renderPreview(clean = false) {
  const r = visibleRegion();
  (clean ? preview.renderClean : preview.render).call(preview, r.fw, r.fh, state, r);
  const s = glCanvas.style;
  s.left = (r.x0 / r.fw * 100) + '%'; s.top = (r.y0 / r.fh * 100) + '%';
  s.width = (r.w / r.fw * 100) + '%'; s.height = (r.h / r.fh * 100) + '%';
  return r;
}

let raf = 0;
export function draw() {
  scheduleSave(); // every visible change is worth persisting; the save itself is debounced
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0; if (!preview) return;
    renderPreview();
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
// skipHandles: the caller refreshes them itself afterwards (setZoom moves the pan first, which moves the handles again)
export function layout(skipHandles = false) {
  // the stage's own padding (styles.css), whose bottom holds the toolbar
  const cs = getComputedStyle(stage), px = k => parseFloat(cs[k]) || 0;
  const availW = stage.clientWidth - px('paddingLeft') - px('paddingRight'), availH = stage.clientHeight - px('paddingTop') - px('paddingBottom');
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
  updateExportSize();
  if (!skipHandles) refreshHandles();
  draw();
}
new ResizeObserver(() => layout()).observe(stage);

// ---------- Zoom + pan ----------
// `zoom` multiplies the fit-to-stage size; `pan` translates the work group in stage pixels. Handles keep their
// screen size because they're laid out from the frame's on-screen rect, so zooming just gives more room to work.
export const view = { zoom: 1, panX: 0, panY: 0 };
export function applyPan() {
  // keep at least 60px of the work group inside the stage on each axis so it can't be lost off-screen. The limits come
  // from where the group actually sits (offsetLeft/Top ignore the pan): once it's bigger than the stage the grid starts it
  // at the stage's padding rather than centred, so limits assuming it's centred would stop short of one edge.
  const S = { w: stage.clientWidth, h: stage.clientHeight };
  const clampAxis = (pan, size, offset, len) => Math.min(size - 60 - offset, Math.max(60 - (offset + len), pan));
  view.panX = clampAxis(view.panX, S.w, work.offsetLeft, work.offsetWidth);
  view.panY = clampAxis(view.panY, S.h, work.offsetTop, work.offsetHeight);
  work.style.transform = `translate(${view.panX}px, ${view.panY}px)`;
}
// Zoom so the canvas point under (cx, cy) stays put; defaults to the stage centre.
export function setZoom(z, cx, cy) {
  z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const sr = stage.getBoundingClientRect();
  if (cx == null) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
  const r = frameRect();
  const ux = (cx - r.left) / r.width, uy = (cy - r.top) / r.height;
  view.zoom = session.zoom = z; layout(true);
  const r2 = frameRect();
  view.panX += cx - (r2.left + ux * r2.width); view.panY += cy - (r2.top + uy * r2.height);
  applyPan(); refreshHandles(); draw();
}
export function resetZoom() { view.zoom = session.zoom = 1; view.panX = view.panY = 0; layout(); }
export function panBy(dx, dy) { view.panX += dx; view.panY += dy; applyPan(); refreshHandles(); draw(); }

stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { // pinch on a trackpad arrives as ctrl+wheel
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * 3.75); // 1.5x * 1.25 * 2: 2x more sensitive
    setZoom(view.zoom * factor, e.clientX, e.clientY);
  } else { // plain wheel (mouse wheel or trackpad two-finger scroll) always pans
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
