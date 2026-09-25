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
