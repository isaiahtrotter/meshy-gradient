// The Settings modal, opened from the top bar's gear icon. Tabbed (currently just Shortcuts, room to grow).
// Escape closes it via its own capture-phase listener (same pattern as the node menu and colour picker), so
// the global handler in keyboard.js never sees it.

import { $ } from './dom.js';

let open = false;
function setOpen(on) {
  open = on;
  $('settingsModal').hidden = !on;
  $('settingsBtn').setAttribute('aria-expanded', String(on));
}
$('settingsBtn').addEventListener('click', () => setOpen(!open));
$('settingsClose').addEventListener('click', () => setOpen(false));
$('settingsModal').addEventListener('pointerdown', e => { if (e.target === $('settingsModal')) setOpen(false); });
document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }, true);

$('settingsModal').querySelector('.settings-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.stab'); if (!tab) return;
  const name = tab.dataset.tab;
  for (const b of document.querySelectorAll('.stab')) {
    const on = b === tab;
    b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on));
  }
  for (const p of document.querySelectorAll('.stab-panel')) p.hidden = p.dataset.tab !== name;
});
