// The two refresh combos every mutation ends with.

import { refreshHandles } from './handles.js';
import { refreshSelectionPanel } from './colorPanel.js';
import { draw } from './view.js';

export function refreshSelection() { refreshHandles(); refreshSelectionPanel(); }
export function refreshAll() { refreshHandles(); refreshSelectionPanel(); draw(); }
