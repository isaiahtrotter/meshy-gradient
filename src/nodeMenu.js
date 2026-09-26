// Right-click menu on a node: change its type, unlink/relink its arms, flip it. A stroke can't do the first two
// (see nodes.js), so its menu is just the flips.

import { nodeById, replaceNode, selectOnly } from './state.js';
import { pushUndo } from './undo.js';
import { convertNodeType, toggleLinked } from './nodes.js';
import { flipSelected } from './actions.js';
import { $, overlay, frameRect } from './dom.js';
import { refreshAll, refreshSelection } from './refresh.js';

const nodeMenu = $('nodeMenu');
let nodeMenuId = null;
const TYPE_KEYS = { c: 'circle', a: 'arc', l: 'line' };
const FLIP_KEYS = { h: 'x', v: 'y' }; // with shift, same as the global shortcuts

function convert(n, to) {
  const next = convertNodeType(n, to);
  if (!next) return;
  pushUndo(); replaceNode(n.id, next); refreshAll();
}
function closeNodeMenu() { nodeMenu.hidden = true; nodeMenuId = null; }
function openNodeMenu(n) {
  nodeMenuId = n.id;
  const item = (attrs, label, key) => `<button type="button" ${attrs}><span>${label}</span><span class="right">${key ? `<kbd>${key}</kbd>` : ''}</span></button>`;
  const sep = '<div class="sep"></div>';
  const flips = item('data-flip="x"', 'Flip horizontal', '⇧H') + item('data-flip="y"', 'Flip vertical', '⇧V');
  nodeMenu.innerHTML = n.type === 'stroke' ? flips :
    item('data-to="circle"', 'Circle node', 'C') +
    item('data-to="arc"', 'Arc node', 'A') +
    item('data-to="line"', 'Line node', 'L') +
    sep +
    item('data-action="toggle-link"', n.linked ? 'Unlink axes' : 'Link axes', '') +
    sep + flips;
  nodeMenu.hidden = false;
  // 8px to the right of the node's edge, vertically centred on the node
  const fr = frameRect(), r = nodeMenu.getBoundingClientRect();
  nodeMenu.style.left = (fr.left + n.x * fr.width + 10 + 8) + 'px';
  nodeMenu.style.top = (fr.top + n.y * fr.height - r.height / 2) + 'px';
}
nodeMenu.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const n = nodeById(nodeMenuId);
  if (n) {
    if (b.dataset.to) convert(n, b.dataset.to);
    else if (b.dataset.action === 'toggle-link') { pushUndo(); toggleLinked(n); refreshAll(); }
    else if (b.dataset.flip) flipSelected(b.dataset.flip); // the right-clicked node is the whole selection
  }
  closeNodeMenu();
});
overlay.addEventListener('contextmenu', e => {
  const h = e.target.closest('.handle'); if (!h) return;
  e.preventDefault();
  const n = nodeById(+h.dataset.id); if (!n) return;
  selectOnly(n.id); refreshSelection();
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
  const to = !e.shiftKey && n.type !== 'stroke' && TYPE_KEYS[key]; if (!to) return;
  e.preventDefault(); convert(n, to); closeNodeMenu();
}, true);
window.addEventListener('blur', closeNodeMenu);
