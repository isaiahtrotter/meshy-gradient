// A single shared tooltip for the bottom toolbar's icon buttons (src/tooltip.js is imported once from app.js).
// The first hover in the bar waits out TIP_DELAY before the pill appears; while it's visible, moving straight to
// another icon (without leaving the bar) slides it sideways instead of hiding and re-arming the delay. Buttons
// opt in with `data-tip` (the label) and, when they have one, `data-key` (rendered as a <kbd>).

const TIP_DELAY = 1000;
const bar = document.querySelector('.node-bar');

const tip = document.createElement('div');
tip.className = 'toolbar-tip';
document.body.appendChild(tip);

let delayTimer = null, pendingBtn = null, shownBtn = null;

function place(btn) {
  const r = btn.getBoundingClientRect(), barRect = bar.getBoundingClientRect();
  tip.style.left = (r.left + r.width / 2) + 'px';
  tip.style.top = barRect.top + 'px'; // the transform (styles.css) offsets up by the pill's own height + 8px
}
function render(btn) {
  tip.innerHTML = `<span>${btn.dataset.tip}</span>` + (btn.dataset.key ? `<kbd>${btn.dataset.key}</kbd>` : '');
}
function reset() {
  clearTimeout(delayTimer); delayTimer = null; pendingBtn = null; shownBtn = null;
  tip.classList.remove('visible');
}

bar.addEventListener('pointerover', e => {
  const btn = e.target.closest('[data-tip]');
  if (!btn || btn === shownBtn || btn === pendingBtn) return;
  if (shownBtn) { shownBtn = btn; render(btn); place(btn); return; } // already showing: hop straight over
  pendingBtn = btn;
  clearTimeout(delayTimer);
  delayTimer = setTimeout(() => {
    shownBtn = btn; pendingBtn = null;
    render(btn); place(btn); tip.classList.add('visible');
  }, TIP_DELAY);
});
bar.addEventListener('pointerleave', reset); // only fires on leaving the bar as a whole, not between its buttons
bar.addEventListener('pointerdown', reset); // don't leave it hovering over whatever was just clicked/dragged
new ResizeObserver(() => { if (shownBtn) place(shownBtn); }).observe(bar);
