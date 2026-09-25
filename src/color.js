// Colour conversions. Hex strings are '#rrggbb' lowercase everywhere in state.

export const HEX6 = /^#[0-9a-f]{6}$/i;

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const rgb01ToHex = (r, g, b) => rgbToHex(...[r, g, b].map(v => Math.round(v * 255)));

export function rgbaCss(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

// Hue sector of the standard HSV/HSL → RGB conversion, before the lightness offset `m` is added.
function hueSector(h, c, x) {
  return h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
}
export function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  return rgb01ToHex(...hueSector(h, c, x).map(k => k + m));
}
export function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  return rgb01ToHex(...hueSector(h, c, x).map(k => k + m));
}
export function randomColor() {
  return hslToHex(Math.random() * 360, (55 + Math.random() * 35) / 100, (45 + Math.random() * 25) / 100);
}
export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
export function hexWithAlpha(hex, a) {
  return (a >= 0.999 ? hex : hex + Math.round(a * 255).toString(16).padStart(2, '0')).toUpperCase();
}
// Parses user input: '#abc', 'abc', '#aabbcc', '#aabbccdd' (alpha). Returns null when it isn't a colour yet.
export function parseHexInput(str) {
  let v = str.trim().replace(/^#?/, '#'), alpha = null;
  if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  if (/^#[0-9a-f]{8}$/i.test(v)) { alpha = parseInt(v.slice(7, 9), 16) / 255; v = v.slice(0, 7); }
  if (!HEX6.test(v)) return null;
  return { hex: v.toLowerCase(), alpha };
}
