// Element lookups and the few DOM helpers shared by every UI module.

export const $ = id => document.getElementById(id);
export const stage = $('stage'), frame = $('frame'), overlay = $('overlay'), work = $('work');

export const frameRect = () => frame.getBoundingClientRect();
export function maxDim() { const r = frameRect(); return { w: r.width, h: r.height, m: Math.max(r.width, r.height) }; }
// Pointer position relative to the frame: normalized (x, y) and pixels (px, py).
export function normPos(e) {
  const r = frameRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, px: e.clientX - r.left, py: e.clientY - r.top };
}
export function setStatus(msg, err) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); }
export const setStyle = (el, o) => Object.assign(el.style, o);

// A small toast anchored beside `anchor`, flipped to its left if it would overflow the viewport.
let toastTimer = null;
export function showToast(anchor, text) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  if (toastTimer) clearTimeout(toastTimer);
  const toast = document.createElement('div');
  toast.className = 'toast'; toast.textContent = text;
  document.body.appendChild(toast);
  const a = anchor.getBoundingClientRect(), t = toast.getBoundingClientRect();
  const top = a.top + a.height / 2 - t.height / 2;
  const rightSide = a.right + 8 + t.width <= window.innerWidth;
  toast.style.top = top + 'px';
  if (rightSide) { toast.style.left = (a.right + 8) + 'px'; toast.classList.add('from-left'); }
  else { toast.style.left = (a.left - 8 - t.width) + 'px'; toast.classList.add('from-right'); }
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 150); }, 1400);
}
