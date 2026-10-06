// CSS and SVG export. Neither format can express the shader's weighted blend, so instead of translating each node we
// sample the real render onto a coarse grid and rebuild it as a blurred mosaic: that keeps the colours, blend mode,
// strokes and adjustments exactly as they look in the editor, at the cost of fine detail (grain becomes an overlay).
//   CSS: one horizontal linear-gradient per grid row, stacked, on a ::before that is blurred by about a cell.
//   SVG: one rect per cell inside a group with feGaussianBlur.
// The grid carries EDGE extra cells on every side (copies of the border cells) so the blur doesn't fade at the edges.

import { state } from './state.js';
import { $, setStatus } from './dom.js';
import { rgbToHex } from './color.js';
import { makeRenderer } from './renderer.js';

const COLS = 40, SUPER = 4, EDGE = 2, BLUR = 0.55; // BLUR: the blur's standard deviation, in cells

// Cell colours as [row][col] hex strings for a cols × rows grid covering the canvas, each the average of SUPER² samples.
function sampleGrid(cols, rows) {
  const w = cols * SUPER, h = rows * SUPER, off = document.createElement('canvas');
  off.width = w; off.height = h;
  const r = makeRenderer(off, { preserveDrawingBuffer: true });
  if (!r) throw new Error('WebGL unavailable for export.');
  try {
    r.renderClean(w, h, state);
    const px = new Uint8Array(w * h * 4);
    r.gl.readPixels(0, 0, w, h, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px);
    const grid = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        let R = 0, G = 0, B = 0;
        for (let y = 0; y < SUPER; y++) for (let x = 0; x < SUPER; x++) {
          const o = (((h - 1 - (i * SUPER + y)) * w) + j * SUPER + x) * 4; // readPixels rows run bottom-up
          R += px[o]; G += px[o + 1]; B += px[o + 2];
        }
        const n = SUPER * SUPER;
        row.push(rgbToHex(Math.round(R / n), Math.round(G / n), Math.round(B / n)));
      }
      grid.push(row);
    }
    return grid;
  } finally { r.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}
// The grid padded by EDGE cells each side, repeating the border.
function padded(grid) {
  const rows = grid.length, cols = grid[0].length, at = (i, j) => grid[Math.min(rows - 1, Math.max(0, i))][Math.min(cols - 1, Math.max(0, j))];
  return Array.from({ length: rows + 2 * EDGE }, (_, i) => Array.from({ length: cols + 2 * EDGE }, (_, j) => at(i - EDGE, j - EDGE)));
}
const gridSize = () => { const cols = COLS, rows = Math.max(4, Math.round(COLS * state.h / state.w)); return { cols, rows }; };
const grainOpacity = () => Math.min(0.4, state.grain * 2.5);
const NOISE = freq => `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='300' height='300' filter='url(#n)'/></svg>`;
const f2 = v => (Math.round(v * 100) / 100).toString();

export function buildCss() {
  const { cols, rows } = gridSize(), P = padded(sampleGrid(cols, rows)), pc = cols + 2 * EDGE, pr = rows + 2 * EDGE;
  const layers = P.map((row, i) => {
    const stops = row.map((c, j) => `${c} ${f2((j + 0.5) / pc * 100)}%`).join(', ');
    return `linear-gradient(to right, ${stops}) 0 ${f2(i / (pr - 1) * 100)}% / 100% ${f2(100 / pr)}% no-repeat`;
  });
  const mid = P[Math.floor(pr / 2)][Math.floor(pc / 2)];
  const grain = state.grain > 0 ? `
.mesh-gradient::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: ${f2(grainOpacity())}; mix-blend-mode: overlay;
  background: url("data:image/svg+xml,${encodeURIComponent(NOISE(f2(0.9 / state.grainSize)))}");
}` : '';
  return `/* Mesh gradient: <div class="mesh-gradient"></div>. Sized by its width; set width (and optionally min-height) as needed. */
.mesh-gradient {
  position: relative; overflow: hidden; container-type: inline-size;
  aspect-ratio: ${state.w} / ${state.h}; background: ${mid};
}
.mesh-gradient::before {
  content: ""; position: absolute; inset: -${f2(EDGE / rows * 100)}% -${f2(EDGE / cols * 100)}%;
  background:
    ${layers.join(',\n    ')};
  filter: blur(calc(${BLUR} * 100cqw / ${cols}));
}${grain}
`;
}

export function buildSvg() {
  const { cols, rows } = gridSize(), P = padded(sampleGrid(cols, rows)), cw = state.w / cols, ch = state.h / rows;
  const rects = P.map((row, i) => row.map((c, j) =>
    `<rect x="${f2((j - EDGE) * cw)}" y="${f2((i - EDGE) * ch)}" width="${f2(cw + 0.6)}" height="${f2(ch + 0.6)}" fill="${c}"/>`).join('')).join('\n');
  const grain = state.grain > 0 ? `
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${f2(0.9 / state.grainSize)}" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.w} ${state.h}" width="${state.w}" height="${state.h}">
  <defs>
  <filter id="blur" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${f2(BLUR * cw)} ${f2(BLUR * ch)}"/></filter>${grain}
  </defs>
  <g filter="url(#blur)" shape-rendering="crispEdges">
${rects}
  </g>${state.grain > 0 ? `\n  <rect width="${state.w}" height="${state.h}" filter="url(#grain)" opacity="${f2(grainOpacity())}" style="mix-blend-mode:overlay"/>` : ''}
</svg>
`;
}

function download(text, type, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function wire(id, build, type, filename, after) {
  $(id).addEventListener('click', async () => {
    if (!state.nodes.length) { setStatus('Add at least one node before exporting.', true); return; }
    try {
      const text = build();
      const name = filename();
      download(text, type, name);
      setStatus(after ? await after(text, name) : `Prepared ${name}.`);
    } catch (err) { setStatus((err && err.message) || 'Export failed.', true); }
  });
}
wire('exportCssBtn', buildCss, 'text/css', () => 'mesh-gradient.css', async (css, name) => {
  try { await navigator.clipboard.writeText(css); return `Prepared ${name} and copied it to the clipboard.`; } catch { return `Prepared ${name}.`; }
});
wire('exportSvgBtn', buildSvg, 'image/svg+xml', () => `mesh-gradient-${state.w}x${state.h}.svg`);
