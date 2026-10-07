// Shared hover tooltips for the icon buttons: the bottom toolbar's (the pill appears above the bar) and the top bar's
// undo / redo / settings / share (below the bar). The first hover in a bar waits out TIP_DELAY (.5s) before the pill
// appears; while it's visible, moving straight to another icon (without leaving the bar) slides it sideways instead of
// hiding and re-arming the delay. Buttons opt in with `data-tip` (the label) and, when they have one, `data-key`
// (rendered as a <kbd>).

const TIP_DELAY = 500;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

// Undo / redo show their keyboard shortcuts (the keys themselves are handled in keyboard.js).
document.getElementById('undoTopBtn').dataset.key = isMac ? '⌘Z' : 'Ctrl+Z';
document.getElementById('redoTopBtn').dataset.key = isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z';

const BARS = [
  { el: document.querySelector('.node-bar'), below: false },
  { el: document.querySelector('.topbar-right'), below: true },
].filter(b => b.el);

const tip = document.createElement('div');
tip.className = 'toolbar-tip';
document.body.appendChild(tip);

let delayTimer = null, pendingBtn = null, shownBtn = null;

function place(btn, bar) {
  const r = btn.getBoundingClientRect(), barRect = bar.el.getBoundingClientRect();
  tip.classList.toggle('below', bar.below);
  tip.style.left = (r.left + r.width / 2) + 'px';
  // above a bottom bar: at the bar's top edge (the CSS transform lifts it by its own height + 8px);
  // below a top bar: 8px under the button
  tip.style.top = (bar.below ? r.bottom + 8 : barRect.top) + 'px';
}
function render(btn) {
  tip.innerHTML = `<span>${btn.dataset.tip}</span>` + (btn.dataset.key ? `<kbd>${btn.dataset.key}</kbd>` : '');
}
function reset() {
  clearTimeout(delayTimer); delayTimer = null; pendingBtn = null; shownBtn = null;
  tip.classList.remove('visible');
}

for (const bar of BARS) {
  bar.el.addEventListener('pointerover', e => {
    const btn = e.target.closest('[data-tip]');
    if (!btn || btn === shownBtn || btn === pendingBtn) return;
    if (shownBtn) { shownBtn = btn; render(btn); place(btn, bar); return; } // already showing: hop straight over
    pendingBtn = btn;
    clearTimeout(delayTimer);
    delayTimer = setTimeout(() => {
      shownBtn = btn; pendingBtn = null;
      render(btn); place(btn, bar); tip.classList.add('visible');
    }, TIP_DELAY);
  });
  bar.el.addEventListener('pointerleave', reset); // only fires on leaving the bar as a whole, not between its buttons
  bar.el.addEventListener('pointerdown', reset); // don't leave it hovering over whatever was just clicked/dragged
  new ResizeObserver(() => { if (shownBtn && bar.el.contains(shownBtn)) place(shownBtn, bar); }).observe(bar.el);
}
