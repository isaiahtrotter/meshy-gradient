// Keeps the overlay's white dotted rings and axis lines legible on any part of the gradient: where the gradient
// beneath one is too light for white, the line gets a drop shadow (the `shade` class) instead of changing colour.
// After each render the gradient is copied down to a tiny 2D canvas (it has to happen in the same task as the
// render, before the browser presents the WebGL buffer); handles.js then asks shadeFor() with the points an element
// covers, and the CSS fades the shadow in and out.

const SAMPLE_W = 96;
const SHADE_ABOVE = 0.55, SHADE_BELOW = 0.47; // a gap between the two, so a line sitting on the boundary doesn't flicker

const cvs = document.createElement('canvas');
const ctx = cvs.getContext('2d', { willReadFrequently: true });
let lum = null, mw = 0, mh = 0;

// Call straight after a render of `source` (the preview's canvas).
export function captureInk(source) {
  if (!source.width || !source.height) return;
  mw = SAMPLE_W; mh = Math.max(1, Math.round(SAMPLE_W * source.height / source.width));
  cvs.width = mw; cvs.height = mh;
  ctx.drawImage(source, 0, 0, mw, mh);
  const d = ctx.getImageData(0, 0, mw, mh).data;
  lum = new Float32Array(mw * mh);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
}

// Toggles the element's shadow from the average brightness under `pts` ([x, y] in frame px; dims is maxDim()).
export function shadeFor(el, pts, dims) {
  if (!lum) return;
  let sum = 0, n = 0;
  for (const [x, y] of pts) {
    const u = Math.min(mw - 1, Math.max(0, Math.floor(x / dims.w * mw))), v = Math.min(mh - 1, Math.max(0, Math.floor(y / dims.h * mh)));
    sum += lum[v * mw + u]; n++;
  }
  if (!n) return;
  const avg = sum / n, shade = el.classList.contains('shade') ? avg > SHADE_BELOW : avg > SHADE_ABOVE;
  el.classList.toggle('shade', shade);
}

export const circlePoints = (cx, cy, r, n = 16) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i / n * 2 * Math.PI), cy + r * Math.sin(i / n * 2 * Math.PI)]);
export const linePoints = (x0, y0, x1, y1, n = 6) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)]);
