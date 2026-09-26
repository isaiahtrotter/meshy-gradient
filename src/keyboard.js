// Global shortcuts. The node menu and colour picker register their own capture-phase Escape handlers.

import { state } from './state.js';
import { session } from './session.js';
import { stage } from './dom.js';
import { undo, redo } from './undo.js';
import { view, setZoom, resetZoom } from './view.js';
import { setPreview, setPlacement } from './modes.js';
import { setSampling } from './sampling.js';
import { deleteSelected, selectAllNodes, clearSelection, nudgeSelected, flipSelected } from './actions.js';

// Placement-mode shortcuts, one per bottom-toolbar tool; 'circle' is the default (null) placement, so its key
// just selects it rather than toggling — there's nothing "below" it to toggle back to.
const PLACEMENT_KEYS = { l: 'line', a: 'arc', c: null, b: 'stroke' };

const setSpaceHeld = on => { session.spaceHeld = on; stage.classList.toggle('space-pan', on); };
const releaseSpace = () => { if (session.spaceHeld) { setSpaceHeld(false); setPreview(false); } };
document.addEventListener('keyup', e => { if (e.key === ' ' || e.code === 'Space') releaseSpace(); });
window.addEventListener('blur', releaseSpace);

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
  if (mod && key === 'z') { e.preventDefault(); undo(); return; }
  if (typing && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(view.zoom * 1.25); return; }
  if (mod && e.key === '-') { e.preventDefault(); setZoom(view.zoom / 1.25); return; }
  if (mod && e.key === '0') { e.preventDefault(); resetZoom(); return; }
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat && !session.previewing) { setSpaceHeld(true); setPreview(true); } }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (mod && key === 'a') { e.preventDefault(); selectAllNodes(); }
  else if (e.key === 'Escape') {
    if (session.placing) setPlacement(null);
    else if (session.sampling) setSampling(false);
    else if (session.previewing) setPreview(false);
    else clearSelection();
  }
  else if (e.shiftKey && !mod && (key === 'h' || key === 'v')) { e.preventDefault(); flipSelected(key === 'h' ? 'x' : 'y'); } // before plain H (preview)
  else if ((key === 'p' || key === 'h') && !mod) { setPreview(!session.previewing); }
  else if (key === 'i' && !mod) { e.preventDefault(); setSampling(!session.sampling); }
  else if (!mod && key in PLACEMENT_KEYS) { const t = PLACEMENT_KEYS[key]; setPlacement(session.placing === t ? null : t); }
  else if (e.key.startsWith('Arrow') && state.selected.size) {
    e.preventDefault();
    const step = e.shiftKey ? 0.01 : 0.001;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    nudgeSelected(dx, dy);
  }
});
