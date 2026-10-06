// Masonry for the side tab's grids: items keep their own shapes, and each goes in whichever column is currently
// shortest, so they read left to right in order. `items` is [{ el, ratio }] with ratio = height / width of the part
// that varies (the thumbnail); captions are ignored, which is close enough since every card has the same kind.

export function masonry(wrap, items, columns) {
  wrap.innerHTML = '';
  const cols = Array.from({ length: columns }, () => { const el = document.createElement('div'); el.className = 'ct-col'; wrap.appendChild(el); return { el, h: 0 }; });
  for (const { el, ratio } of items) {
    const col = cols.reduce((a, c) => (c.h < a.h ? c : a));
    col.el.appendChild(el); col.h += ratio;
  }
}

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
