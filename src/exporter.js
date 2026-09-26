// Export: renders the gradient at the requested width on an offscreen canvas and downloads a JPG.

import { EXPORT_MAX, clamp } from './constants.js';
import { state } from './state.js';
import { $, setStatus } from './dom.js';
import { makeRenderer } from './renderer.js';

export function updateExportHeight() {
  const ew = +$('ew').value || state.w;
  $('eh').value = Math.round(ew * state.h / state.w);
}
// Export width tracks the canvas size at whichever scale (1x-4x) is selected, so resizing the canvas
// immediately updates the (disabled, display-only) export fields instead of leaving a stale pixel width.
function currentScale() {
  const pressed = $('scales').querySelector('button[aria-pressed="true"]');
  return pressed ? +pressed.dataset.s : 1;
}
export function updateExportSize() {
  $('ew').value = state.w * currentScale();
  updateExportHeight();
}
$('scales').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  for (const btn of $('scales').querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn === b));
  updateExportSize();
});

$('exportBtn').addEventListener('click', async () => {
  if (!state.nodes.length) { setStatus('Add at least one node before exporting.', true); return; }
  const w = clamp(Math.round(+$('ew').value) || state.w, 16, EXPORT_MAX);
  const h = Math.max(1, Math.round(w * state.h / state.w));
  const btn = $('exportBtn'); btn.disabled = true; setStatus(`Rendering ${w} × ${h}…`);
  let r = null;
  try {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    r = makeRenderer(off, { preserveDrawingBuffer: true });
    if (!r) throw new Error('WebGL unavailable for export.');
    const maxRB = r.gl.getParameter(r.gl.MAX_RENDERBUFFER_SIZE);
    if (w > maxRB || h > maxRB) throw new Error(`This device caps renders at ${maxRB} px per side. Lower the export width.`);
    r.render(w, h, state);
    if (r.gl.drawingBufferWidth !== w || r.gl.drawingBufferHeight !== h) throw new Error(`The GPU couldn’t allocate ${w} × ${h}. Try a smaller export width.`);
    const blob = await new Promise((res, rej) => off.toBlob(b => b ? res(b) : rej(new Error('Encoding failed.')), 'image/jpeg', 0.95));
    const filename = `mesh-gradient-${w}x${h}.jpg`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setStatus(`Prepared ${filename} (${(blob.size / 1048576).toFixed(1)} MB).`);
  } catch (err) {
    setStatus((err && err.message) || 'Export failed.', true);
  } finally {
    r?.gl.getExtension('WEBGL_lose_context')?.loseContext();
    btn.disabled = false;
  }
});
