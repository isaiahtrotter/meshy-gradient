// The tab that opens between the stage and the sidebar. One panel, two kinds of content: 'community' (every published
// gradient, filled by gradients.js) and 'presets' (every preset, filled by presets.js). Opening one swaps the title and
// the visible pane; opening the same one again, the close button, or Escape closes it. The stage's ResizeObserver
// refits the canvas as the tab takes or gives back its column.

import { $ } from './dom.js';

const tab = $('communityTab');
const TITLES = { community: 'Community', presets: 'Presets' };
const BUTTONS = { community: 'communityBtn', presets: 'presetMoreBtn' }; // buttons that mirror the open state in aria-expanded
const listeners = new Set();
let kind = null;

export const sideTabKind = () => (tab.hidden ? null : kind);
// cb(kind) runs each time a tab is opened, so its pane can refresh.
export const onSideTabOpen = cb => listeners.add(cb);

export function openSideTab(k) {
  kind = k; tab.hidden = false;
  $('ctTitle').textContent = TITLES[k];
  for (const pane of tab.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== k;
  syncButtons();
  for (const cb of listeners) cb(k);
}
export function closeSideTab() { tab.hidden = true; kind = null; syncButtons(); }
export const toggleSideTab = k => (sideTabKind() === k ? closeSideTab() : openSideTab(k));

function syncButtons() {
  for (const [k, id] of Object.entries(BUTTONS)) $(id)?.setAttribute('aria-expanded', String(sideTabKind() === k));
}

$('ctClose').addEventListener('click', closeSideTab);
document.addEventListener('keydown', e => {
  if (!tab.hidden && e.key === 'Escape' && $('publishModal').hidden && $('authModal').hidden) { e.stopPropagation(); closeSideTab(); }
}, true);
