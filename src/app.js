// Entry point: wires the undo hooks, restores the last session, and kicks off the first layout.
// Module import order matters for event listener registration (sampling before interaction, see sampling.js).

import { state, PALETTES, applyConfig } from './state.js';
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
import './shortcuts.js';
import { syncControlsFromState, seedNodes, renderPalettes } from './controls.js';
import { fetchPresets, pickDefaultPreset, renderPresets } from './presets.js';

onUndoChange((canUndo, canRedo) => {
  $('undoBtn').disabled = !canUndo;
  $('mobileUndoBtn').disabled = !canUndo;
  $('mobileRedoBtn').disabled = !canRedo;
});
onRestore(() => { syncControlsFromState(); layout(); refreshAll(); });

// handy for poking at the document from the console
window.__meshy = { state, view };

async function boot() {
  // fetched once and reused for both the presets grid and (for a first-time visit) the default gradient
  const presets = await fetchPresets();
  if (!loadState()) {
    const def = pickDefaultPreset(presets);
    if (def) applyConfig(def, { reassignIds: true }); else seedNodes(PALETTES[0]);
  }
  restoreReference();
  renderPalettes(PALETTES);
  renderPresets(presets);
  syncControlsFromState();
  layout(); refreshAll();
}
boot();
