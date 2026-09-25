// Entry point: wires the undo hooks, restores the last session, and kicks off the first layout.
// Module import order matters for event listener registration (sampling before interaction, see sampling.js).

import { state, PALETTES } from './state.js';
import { onUndoChange, onRestore } from './undo.js';
import { loadState } from './persistence.js';
import { $ } from './dom.js';
import { layout, restoreReference } from './view.js';
import { refreshAll } from './refresh.js';
import './modes.js';
import './sampling.js';
import './nodeMenu.js';
import './interaction.js';
import './keyboard.js';
import './exporter.js';
import { syncControlsFromState, seedNodes, renderPalettes } from './controls.js';
import { loadPresets } from './presets.js';

onUndoChange(can => { $('undoBtn').disabled = !can; });
onRestore(() => { syncControlsFromState(); layout(); refreshAll(); });

if (!loadState()) seedNodes(PALETTES[0]);
restoreReference();
renderPalettes(PALETTES);
syncControlsFromState();
layout(); refreshAll();
loadPresets();

// handy for poking at the document from the console
window.__meshy = { state };
