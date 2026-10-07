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

// Edge fades, like the main sidebar's: a fade shows at the top and/or bottom only while there's more to scroll that way.
// A MutationObserver as well as scroll/resize, because the content's height changes without scrolling (cards loading in,
// a different tab, a new column count).
{
  const scroller = tab.querySelector('.ct-scroll'), fadeTop = tab.querySelector('.ct-fade-top'), fadeBottom = tab.querySelector('.ct-fade-bottom');
  const update = () => {
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    fadeTop.classList.toggle('visible', scrollTop > 1);
    fadeBottom.classList.toggle('visible', scrollTop + clientHeight < scrollHeight - 1);
  };
  scroller.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  new MutationObserver(update).observe(scroller, { childList: true, subtree: true, attributes: true });
  onSideTabOpen(() => { scroller.scrollTop = 0; requestAnimationFrame(update); });
}

$('ctClose').addEventListener('click', closeSideTab);
document.addEventListener('keydown', e => {
  if (!tab.hidden && e.key === 'Escape' && !tab.querySelector('.ct-dd.open') && $('publishModal').hidden && $('authModal').hidden && $('publishedModal').hidden && $('confirmModal').hidden) { e.stopPropagation(); closeSideTab(); }
}, true);
