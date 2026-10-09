// The Export section's Copy button: renders the gradient at the export size and puts it on the clipboard as a PNG.

import { state } from './state.js';
import { $, setStatus } from './dom.js';
import { renderExport } from './exporter.js';

let copying = false; // a guard instead of `disabled`, which would dim the button for a moment on every click
$('copyImgBtn').addEventListener('click', async () => {
  if (copying) return;
  if (!state.nodes.length) { setStatus('Add at least one node before copying.', true); return; }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') { setStatus('This browser can’t copy images to the clipboard.', true); return; }
  const btn = $('copyImgBtn'); copying = true; setStatus('Rendering…');
  try {
    // the promise goes in the item itself so the write still counts as part of the click (Safari insists)
    const job = renderExport('image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': job.then(r => r.blob) })]);
    const { w, h } = await job;
    setStatus(`Copied a ${w} × ${h} image.`);
    btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); // swapped instantly, no transition
  } catch (err) {
    setStatus((err && err.message) || 'Couldn’t copy the image.', true);
  } finally { copying = false; }
});
