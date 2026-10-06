// Entry point: wires the undo hooks, restores the last session, and kicks off the first layout.
// Module import order matters for event listener registration (sampling before interaction, see sampling.js).

import { state, applyConfig } from './state.js';
import { onUndoChange, onRestore } from './undo.js';
import { loadState } from './persistence.js';
import { $ } from './dom.js';
import { layout, restoreReference, view } from './view.js';
import { refreshAll } from './refresh.js';
import './modes.js';
import './sampling.js';
import './nodeMenu.js';
import './interaction.js';
import './keyboard.js';
import './exporter.js';
import './sideTab.js';
import './gradients.js';
import './collapse.js';
import './settingsPanel.js';
import './theme.js';
import './auth.js';
import './tooltip.js';
import './sliderRubberband.js';
import { syncControlsFromState, seedNodes } from './controls.js';
import { markCopy } from './provenance.js';
import { fetchDefaultGradient } from './loadGradient.js';

// a first-time visit whose default gradient can't be fetched still gets something to look at
const FALLBACK_COLOURS = ['#ff7a59', '#ffd166', '#6a4c93', '#1982c4'];

onUndoChange((canUndo, canRedo) => {
  $('undoBtn').disabled = !canUndo;
  $('undoTopBtn').disabled = !canUndo;
  $('redoTopBtn').disabled = !canRedo;
  $('mobileUndoBtn').disabled = !canUndo;
  $('mobileRedoBtn').disabled = !canRedo;
});
onRestore(() => { syncControlsFromState({ animate: 'settle' }); layout(); refreshAll(); });

// handy for poking at the document from the console
window.__meshy = { state, view };

// Reveals the real canvas/sidebar and hides the skeleton loaders (meshygradient.html, styles.css) placed over
// them so a boot in progress never shows the default HTML values before the restored/loaded ones replace them.
function revealApp() { document.body.classList.remove('loading'); }

async function boot() {
  layout(); // size the frame from the current (default or, below, restored) state before anything is drawn
  const restored = loadState();
  if (restored) { restoreReference(); syncControlsFromState(); layout(); refreshAll(); revealApp(); }
  if (!restored) {
    // a returning visitor's own canvas above doesn't wait on this network round-trip to appear
    const def = await fetchDefaultGradient();
    if (def) applyConfig(def, { reassignIds: true }); else seedNodes(FALLBACK_COLOURS);
    restoreReference(); syncControlsFromState(); layout(); refreshAll(); revealApp();
    if (def) markCopy({ instant: true }); // the starting gradient isn't the visitor's own, so Publish waits for the first edit
  }
}
boot();
