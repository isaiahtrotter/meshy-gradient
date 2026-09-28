// Rubber-band feel on every range slider: dragging past the point where the thumb stops moving (min/max)
// nudges the whole `.slider` wrapper up to 4px further in that direction, and springs it back once the
// drag ends. The overdrag is read straight off pointer position vs. the input's own bounding box — once
// the thumb is pinned at an end, the browser keeps delivering pointermove (range inputs get implicit
// pointer capture), so clientX past `rect.left`/`rect.right` *is* "can't move any further, still dragging".
const MAX_SHIFT = 4;
const OVERDRAG_FOR_MAX_SHIFT = 24; // px of overdrag past the track edge needed to reach the full 4px shift

for (const input of document.querySelectorAll('.slider input[type=range]')) {
  const wrap = input.closest('.slider');
  let dragging = false;

  input.addEventListener('pointerdown', () => { dragging = true; wrap.style.transition = 'none'; });

  input.addEventListener('pointermove', e => {
    if (!dragging) return;
    const rect = input.getBoundingClientRect();
    const overdrag = e.clientX < rect.left ? e.clientX - rect.left : e.clientX > rect.right ? e.clientX - rect.right : 0;
    const shift = Math.sign(overdrag) * Math.min(MAX_SHIFT, Math.abs(overdrag) / OVERDRAG_FOR_MAX_SHIFT * MAX_SHIFT);
    wrap.style.transform = shift ? `translateX(${shift}px)` : '';
  });

  function release() {
    if (!dragging) return;
    dragging = false;
    wrap.style.transition = 'transform 150ms ease-out';
    wrap.style.transform = '';
  }
  input.addEventListener('pointerup', release);
  input.addEventListener('pointercancel', release);
}
