// The app's own confirmation dialog, used instead of the browser's confirm() / prompt() popups.
//   askConfirm({ title, text, confirmLabel, danger })      → Promise<boolean>   (true = confirmed)
//   askConfirm({ ..., field: 'text', cancelLabel: null })  shows a read-only, pre-selected text field (to copy a link
//                                                          by hand) and a single button; resolves true when closed.
// Escape, clicking outside and Cancel all resolve false.

import { $ } from './dom.js';

let resolver = null;

function close(value) {
  $('confirmModal').hidden = true;
  const r = resolver; resolver = null;
  r?.(value);
}

export function askConfirm({ title, text, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, field = null }) {
  if (resolver) close(false); // only one at a time
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  const ok = $('confirmOk'), cancel = $('confirmCancel'), input = $('confirmField');
  ok.textContent = confirmLabel;
  ok.classList.toggle('danger', danger); ok.classList.toggle('primary', !danger);
  cancel.hidden = cancelLabel === null; cancel.textContent = cancelLabel ?? '';
  input.hidden = field === null; input.value = field ?? '';
  $('confirmModal').hidden = false;
  // a destructive action starts on Cancel, so a stray Enter can't delete anything
  if (field !== null) { input.focus(); input.select(); } else (danger ? cancel : ok).focus();
  return new Promise(resolve => { resolver = resolve; });
}

$('confirmOk').addEventListener('click', () => close(true));
$('confirmCancel').addEventListener('click', () => close(false));
$('confirmModal').addEventListener('pointerdown', e => { if (e.target === $('confirmModal')) close(false); });
// stopImmediatePropagation: the other Escape handlers on document (Settings, the side tab) must not also see this key
document.addEventListener('keydown', e => { if (!$('confirmModal').hidden && e.key === 'Escape') { e.stopImmediatePropagation(); close(false); } }, true);
