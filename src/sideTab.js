// The tab that opens between the stage and the sidebar. One panel, two kinds of content, both filled by gradients.js:
// 'community' (every published gradient) and 'mine' (all your saved ones). Opening one swaps the title and the
// visible pane; opening the same one again, the close button, or Escape closes it. The stage's ResizeObserver
// refits the canvas as the tab takes or gives back its column.

import { $ } from './dom.js';

const tab = $('communityTab');
const TITLES = { community: 'Community', mine: 'My gradients' };
const BUTTONS = { community: ['communityMoreBtn'], mine: ['myMoreBtn'] }; // buttons that mirror the open state in aria-expanded
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
  for (const [k, ids] of Object.entries(BUTTONS)) for (const id of ids) $(id)?.setAttribute('aria-expanded', String(sideTabKind() === k));
}

$('ctClose').addEventListener('click', closeSideTab);
document.addEventListener('keydown', e => {
  if (!tab.hidden && e.key === 'Escape' && $('publishModal').hidden && $('authModal').hidden && $('publishedModal').hidden) { e.stopPropagation(); closeSideTab(); }
}, true);
