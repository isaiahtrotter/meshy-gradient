// Masonry for the side tab's grids: items keep their own shapes, and each goes in whichever column is currently
// shortest, so they read left to right in order. `items` is [{ el, ratio }] with ratio = height / width of the part
// that varies (the thumbnail); captions are ignored, which is close enough since every card has the same kind.

// With { animate: true } the cards glide from where they were to where they land (a FLIP animation: measure before,
// re-lay-out, then animate each card from its old box to its new one). Only cards that were already on screen move.
export function masonry(wrap, items, columns, { animate = false } = {}) {
  const before = animate ? new Map(items.map(({ el }) => [el, el.getBoundingClientRect()])) : null;
  wrap._items = items; // so the column count can change later without rebuilding the cards (see relayout)
  wrap.innerHTML = '';
  const cols = Array.from({ length: columns }, () => { const el = document.createElement('div'); el.className = 'ct-col'; wrap.appendChild(el); return { el, h: 0 }; });
  for (const { el, ratio } of items) {
    const col = cols.reduce((a, c) => (c.h < a.h ? c : a));
    col.el.appendChild(el); col.h += ratio;
  }
  if (before) for (const { el } of items) {
    const a = before.get(el), b = el.getBoundingClientRect();
    if (!a.width || !b.width) continue;
    const k = a.width / b.width;
    el.animate(
      [{ transformOrigin: '0 0', transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${k})` }, { transformOrigin: '0 0', transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
  }
}
// Lays the same cards out again with another number of columns, animated.
export const relayout = (wrap, columns) => { if (wrap._items) masonry(wrap, wrap._items, columns, { animate: true }); };

// A thumbnail's height / width, read from the image itself (cached by URL); 3 / 4 when there's no image.
const ratios = new Map();
export function thumbRatio(url) {
  if (!url) return Promise.resolve(0.75);
  if (!ratios.has(url)) {
    ratios.set(url, new Promise(res => {
      const img = new Image();
      img.onload = () => res(img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.75);
      img.onerror = () => res(0.75);
      img.src = url;
    }));
  }
  return ratios.get(url);
}
