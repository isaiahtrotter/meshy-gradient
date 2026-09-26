// The keyboard-shortcuts modal, opened from the top bar. Escape closes it via its own capture-phase
// listener (same pattern as the node menu and colour picker), so the global handler in keyboard.js never sees it.

import { $ } from './dom.js';

let open = false;
function setOpen(on) {
  open = on;
  $('shortcutsModal').hidden = !on;
  $('shortcutsBtn').setAttribute('aria-expanded', String(on));
}
$('shortcutsBtn').addEventListener('click', () => setOpen(!open));
$('shortcutsClose').addEventListener('click', () => setOpen(false));
$('shortcutsModal').addEventListener('pointerdown', e => { if (e.target === $('shortcutsModal')) setOpen(false); });
document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }, true);
