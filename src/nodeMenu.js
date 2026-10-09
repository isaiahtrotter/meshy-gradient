// Right-click menu on a node: change its type, unlink/relink its arms, flip it. Right-clicking a node that's part of a
// multi-selection keeps the whole selection, and every choice applies to all of it. A stroke can't do the first two
// (see nodes.js), so strokes are skipped by those and a stroke-only menu is just the flips.

import { state, nodeById, selectedNodes, replaceNode, selectOnly } from './state.js';
import { pushUndo } from './undo.js';
import { convertNodeType } from './nodes.js';
import { flipSelected, toggleLinkSelected } from './actions.js';
import { $, overlay, frameRect } from './dom.js';
import { refreshAll, refreshSelection } from './refresh.js';

const nodeMenu = $('nodeMenu');
let nodeMenuId = null;
const TYPE_KEYS = { c: 'circle', a: 'arc', l: 'line' };
const FLIP_KEYS = { h: 'x', v: 'y' }; // with shift, same as the global shortcuts
// Occluding still needs more work before it's user-facing; keep toggle-occ wired below so this is a
// one-line flip to bring back, just don't offer it from the menu for now.
const SHOW_OCC_TOGGLE = false;

// Converts every selected node that can be (strokes and nodes already of that type are skipped) as one undo step.
function convertSelected(to) {
  const changes = selectedNodes().map(n => [n.id, convertNodeType(n, to)]).filter(([, next]) => next);
  if (!changes.length) return;
  pushUndo(); for (const [id, next] of changes) replaceNode(id, next); refreshAll();
}
function closeNodeMenu() { nodeMenu.hidden = true; nodeMenuId = null; }
function openNodeMenu(n) {
  nodeMenuId = n.id;
  const sel = selectedNodes(), shaped = sel.filter(x => x.type !== 'stroke'), linked = shaped[0]?.linked; // arms exist only on non-strokes
  const item = (attrs, label, key) => `<button type="button" ${attrs}><span>${label}</span><span class="right">${key ? `<kbd>${key}</kbd>` : ''}</span></button>`;
  const sep = '<div class="sep"></div>';
  const flips = item('data-flip="x"', 'Flip horizontal', '⇧H') + item('data-flip="y"', 'Flip vertical', '⇧V');
  const occToggle = SHOW_OCC_TOGGLE ? item('data-action="toggle-occ"', n.occ ? 'Make non-occluding' : 'Make occluding', '') : '';
  nodeMenu.innerHTML = !shaped.length ? ((occToggle ? occToggle + sep : '') + flips) :
    item('data-to="circle"', 'Circle node', 'C') +
    item('data-to="arc"', 'Arc node', 'A') +
    item('data-to="line"', 'Line node', 'L') +
    sep +
    item('data-action="toggle-link"', linked ? 'Unlink axes' : 'Link axes', '') +
    occToggle +
    sep + flips;
  nodeMenu.hidden = false;
  // 8px to the right of the node's edge, vertically centred on the node
  const fr = frameRect(), r = nodeMenu.getBoundingClientRect();
  nodeMenu.style.left = (fr.left + n.x * fr.width + 10 + 8) + 'px';
  nodeMenu.style.top = (fr.top + n.y * fr.height - r.height / 2) + 'px';
}
nodeMenu.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (nodeById(nodeMenuId)) {
    if (b.dataset.to) convertSelected(b.dataset.to);
    else if (b.dataset.action === 'toggle-link') toggleLinkSelected();
    else if (b.dataset.action === 'toggle-occ') { const on = !selectedNodes()[0].occ; pushUndo(); for (const n of selectedNodes()) n.occ = on; refreshAll(); }
    else if (b.dataset.flip) flipSelected(b.dataset.flip);
  }
  closeNodeMenu();
});
overlay.addEventListener('contextmenu', e => {
  const h = e.target.closest('.handle'); if (!h) return;
  e.preventDefault();
  const n = nodeById(+h.dataset.id); if (!n) return;
  if (!state.selected.has(n.id)) selectOnly(n.id); // inside a multi-selection: keep it, and the menu acts on all of it
  refreshSelection();
  openNodeMenu(n);
});
document.addEventListener('pointerdown', e => { if (!nodeMenu.hidden && !e.target.closest('#nodeMenu')) closeNodeMenu(); });
document.addEventListener('keydown', e => {
  if (nodeMenu.hidden) return;
  if (e.key === 'Escape') { closeNodeMenu(); return; }
  const key = e.key.toLowerCase(), n = nodeById(nodeMenuId);
  if (!n) return;
  // stopPropagation so the global Shift+H/V handler (keyboard.js) doesn't flip it a second time
  if (e.shiftKey && FLIP_KEYS[key]) { e.preventDefault(); e.stopPropagation(); flipSelected(FLIP_KEYS[key]); closeNodeMenu(); return; }
  const to = !e.shiftKey && TYPE_KEYS[key]; if (!to) return;
  e.preventDefault(); convertSelected(to); closeNodeMenu();
}, true);
window.addEventListener('blur', closeNodeMenu);
