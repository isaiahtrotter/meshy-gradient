// The little demo that plays when a node tool is picked: a hand pops up in the middle of the canvas and draws a line, arc,
// circle or pencil stroke, with the node's real controls (the very same code and styles as the overlay: handles.js lays out
// a pretend node into its own host element). It never touches the document, and any press on the stage ends it at once.

import { stage, frame, frameRect, maxDim } from './dom.js';
import { clamp, STROKE_START_K, MOBILE_BREAKPOINT } from './constants.js';
import { session } from './session.js';
import { createNode } from './nodes.js';
import { smoothStroke, strokeFromPath } from './stroke.js';
import { wrapAngle } from './geometry.js';
import { makeScope, refreshHandles, radiusToHard, hardToRadius, hardMax } from './handles.js';

const HAND = `<svg width="24" height="29" viewBox="0 0 24 29" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#toolDemoHandShadow)"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.12635 9.2869C10.6716 8.83551 13.5323 8.82667 15.0624 9.03343C16.6198 9.24391 18.0339 9.75519 19.1094 10.4525C19.6462 10.8005 20.1494 11.2281 20.5351 11.7378C20.9158 12.241 21.2554 12.9263 21.2554 13.741C21.2554 14.7714 21.3271 16.5655 21.2538 18.3964C21.2149 19.3695 20.7402 20.347 20.336 21.0544C19.8894 21.836 19.3262 22.6257 18.8011 23.3C18.4688 23.7267 18.1305 24.1818 17.5873 24.5832C17.1633 24.8965 16.6063 25.1687 16.0986 25.3107C15.4402 25.4949 14.8023 25.48 14.1894 25.48H10.1579C9.52047 25.48 8.86606 25.4945 8.2354 25.3277C7.72506 25.1926 7.24179 24.9704 6.80715 24.6708C6.4043 24.3932 6.07027 24.0389 5.75343 23.675L3.49599 21.0419C3.15941 20.6492 2.80681 20.2528 2.5523 19.7825C2.34596 19.4013 2.19486 18.9925 2.10338 18.5687C1.99056 18.0461 2.0002 17.5156 2.00021 16.9984V13.884C2.00021 13.8251 2.00301 13.7662 2.00859 13.7076C2.16704 12.044 3.38165 11.0287 4.43534 10.4588C5.52136 9.87131 6.85632 9.51215 8.12635 9.2869ZM14.8131 10.8778C12.1646 10.5199 4.14768 10.8778 3.8613 13.884V16.9984L3.86228 17.394C3.86515 17.7424 3.87661 17.9633 3.92253 18.176C3.97685 18.4276 4.06663 18.6703 4.18914 18.8967C4.32727 19.1519 4.52119 19.3783 4.909 19.8308L6.85342 22.0993C7.33249 22.6582 7.57216 22.9377 7.86338 23.1384C8.12144 23.3163 8.40844 23.4483 8.71144 23.5285C9.01064 23.6076 9.32997 23.6176 9.89825 23.6188L14.1894 23.6189C14.8883 23.6189 15.2378 23.619 15.5973 23.5184C15.8871 23.4373 16.2391 23.2653 16.4811 23.0864C16.7438 22.8923 16.9173 22.6873 17.2028 22.3229L17.3327 22.1566C18.323 20.8848 19.3549 19.3052 19.3943 18.322C19.4659 16.5325 19.3943 14.8862 19.3943 13.741C19.3943 12.5957 17.4615 11.2357 14.8131 10.8778Z" fill="white"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3.8613 13.884C4.14768 10.8778 12.1646 10.5199 14.8131 10.8778C17.4615 11.2357 19.3943 12.5957 19.3943 13.741C19.3943 14.0877 19.4008 14.4804 19.408 14.9091C19.4245 15.8962 19.4442 17.0743 19.3943 18.322C19.3549 19.3052 18.323 20.8848 17.3327 22.1566L17.2028 22.3229C16.9173 22.6873 16.7438 22.8923 16.4811 23.0864C16.2391 23.2653 15.8871 23.4373 15.5973 23.5184C15.2379 23.6189 14.888 23.6189 14.1894 23.6189L9.89825 23.6188C9.32997 23.6176 9.01064 23.6076 8.71144 23.5285C8.40844 23.4483 8.12144 23.3163 7.86338 23.1384C7.57216 22.9377 7.33249 22.6582 6.85342 22.0993L4.909 19.8308C4.52119 19.3783 4.32727 19.1519 4.18914 18.8967C4.06663 18.6703 3.97685 18.4276 3.92253 18.176C3.87661 17.9633 3.86515 17.7424 3.86228 17.394L3.8613 16.9984V13.884Z" fill="black"/><path d="M5.50781 3.79164C5.50781 2.24986 6.75767 1 8.29945 1C9.84123 1 11.0911 2.24986 11.0911 3.79164V7.2275C11.0911 8.76929 9.84123 10.0191 8.29945 10.0191C6.75767 10.0191 5.50781 8.76929 5.50781 7.22751V3.79164Z" fill="white"/><path d="M9.23047 10.0912C9.23047 8.58891 10.4483 7.37109 11.9505 7.37109C13.4528 7.37109 14.6706 8.58891 14.6706 10.0912C14.6706 11.5934 13.4528 12.8112 11.9505 12.8112C10.4483 12.8112 9.23047 11.5934 9.23047 10.0912Z" fill="white"/><path d="M12.8086 11.5941C12.8086 10.0918 14.0264 8.87402 15.5287 8.87402C17.0309 8.87402 18.2487 10.0918 18.2487 11.5941C18.2487 13.0963 17.0309 14.3141 15.5287 14.3141C14.0264 14.3141 12.8086 13.0963 12.8086 11.5941Z" fill="white"/><path d="M5.50781 4.07801C5.50781 3.56408 5.92443 3.14746 6.43836 3.14746C6.95229 3.14746 7.36891 3.56408 7.36891 4.07801V14.9582C7.36891 15.4722 6.95229 15.8888 6.43836 15.8888C5.92443 15.8888 5.50781 15.4722 5.50781 14.9582V4.07801Z" fill="white"/><path d="M7.36914 4.07801C7.36914 3.56408 7.78576 3.14746 8.29969 3.14746C8.81361 3.14746 9.23023 3.56408 9.23023 4.07801V14.9582C9.23023 15.4722 8.81361 15.8888 8.29969 15.8888C7.78576 15.8888 7.36914 15.4722 7.36914 14.9582V4.07801Z" fill="black"/><path d="M10.9473 10.3768C10.9473 9.86291 11.3639 9.44629 11.8778 9.44629C12.3917 9.44629 12.8084 9.86291 12.8084 10.3768V21.2571C12.8084 21.771 12.3917 22.1876 11.8778 22.1876C11.3639 22.1876 10.9473 21.771 10.9473 21.2571V10.3768Z" fill="black"/><path d="M14.5273 11.8798C14.5273 11.3658 14.944 10.9492 15.4579 10.9492C15.9718 10.9492 16.3884 11.3658 16.3884 11.8798V21.1852C16.3884 21.6992 15.9718 22.1158 15.4579 22.1158C14.944 22.1158 14.5273 21.6992 14.5273 21.1852V11.8798Z" fill="black"/><path d="M8.22656 11.8806C8.22656 11.2481 8.73933 10.7354 9.37185 10.7354H12.2351C12.8676 10.7354 13.3804 11.2481 13.3804 11.8806C13.3804 12.5132 12.8676 13.0259 12.2351 13.0259H9.37185C8.73933 13.0259 8.22656 12.5132 8.22656 11.8806Z" fill="black"/><path d="M12.0918 13.0254C12.0918 12.2347 12.7328 11.5938 13.5234 11.5938H15.5277C16.3183 11.5938 16.9593 12.2347 16.9593 13.0254C16.9593 13.816 16.3183 14.457 15.5277 14.457H13.5234C12.7328 14.457 12.0918 13.816 12.0918 13.0254Z" fill="black"/><path d="M12.8086 13.7412C12.8086 12.9505 13.4495 12.3096 14.2402 12.3096H16.2445C17.0351 12.3096 17.6761 12.9505 17.6761 13.7412C17.6761 14.5318 17.0351 15.1728 16.2445 15.1728H14.2402C13.4495 15.1728 12.8086 14.5318 12.8086 13.7412Z" fill="black"/><path d="M9.23047 3.79188C9.23047 3.27795 9.64709 2.86133 10.161 2.86133C10.6749 2.86133 11.0916 3.27795 11.0916 3.79188V10.8068C11.0916 11.3207 10.6749 11.7373 10.161 11.7373C9.64709 11.7373 9.23047 11.3207 9.23047 10.8068V3.79188Z" fill="white"/><path d="M12.8086 10.0907C12.8086 9.57678 13.2252 9.16016 13.7391 9.16016C14.2531 9.16016 14.6697 9.57678 14.6697 10.0907V11.8086C14.6697 12.3226 14.2531 12.7392 13.7391 12.7392C13.2252 12.7392 12.8086 12.3226 12.8086 11.8086V10.0907Z" fill="white"/><path d="M16.3867 11.5936C16.3867 11.0797 16.8033 10.6631 17.3173 10.6631C17.8312 10.6631 18.2478 11.0797 18.2478 11.5936V12.4526C18.2478 12.9665 17.8312 13.3831 17.3173 13.3831C16.8033 13.3831 16.3867 12.9665 16.3867 12.4526V11.5936Z" fill="white"/></g><defs><filter id="toolDemoHandShadow" x="0" y="0" width="23.2871" height="28.4805" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/><feOffset dy="1"/><feGaussianBlur stdDeviation="1"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0"/><feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1562_495"/><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1562_495" result="shape"/></filter></defs></svg>`;
const HAND_TIP = { x: 8.3, y: 1.2 }; // the index fingertip inside the 24 × 29 hand: the point that "presses"
// On desktop the pointer is the app's own crosshair (crosshair.svg, 18px, hotspot at its centre); the hand is for touch screens.
const CROSS = '<img src="crosshair.svg" width="18" height="18" alt="" draggable="false">', CROSS_TIP = { x: 9, y: 9 };

// timeline, ms
const T_IN = 260, T_DRAG = 1250, T_HOLD = 650, T_OUT = 350;
const REPEAT_MS = 3000; // pause before it plays again; it loops until the tool is used or something else is picked
const ease = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const DEMO_ID = -1;
// twice the default hardness: a tighter dotted ring, so the demo's controls stay compact; on a phone the ring is two thirds of that
// size, found by running the radius through the same ring maths the overlay uses
const harder = (n, mobile) => { n.k *= 2; if (mobile) n.k = Math.round(radiusToHard(hardToRadius(n.k) / 1.5, hardMax(n)) * 10) / 10; return n; };

// A new node gets the colour the canvas has under it, like a real click; interaction.js registers the sampler (it can't be imported here).
let sampler = null;
export const setDemoColorSampler = fn => { sampler = fn; };

// Each tool: `start` is where the hand presses and `at(d)` where it is at drag progress d (0..1), both in frame px, given the
// middle c and scale s. `make` builds the pretend node; `update` poses it for the hand's position, as the real drag does.
const TOOLS = {
  line: {
    // 1.5× as long on a phone, where the canvas is small next to the handles
    start: (c, s) => ({ x: c.x - 74 * s * (c.mobile ? 1.5 : 1), y: c.y + 30 * s * (c.mobile ? 1.5 : 1) }),
    at: (d, c, s) => ({ x: c.x + (-74 + 148 * d) * s * (c.mobile ? 1.5 : 1), y: c.y + (30 - 60 * d) * s * (c.mobile ? 1.5 : 1) }),
    make: (A, color, dims, mobile) => harder(createNode('line', A.x / dims.w, A.y / dims.h, color), mobile),
    update(n, A, H, dims) { // both ends follow the drag: the start is one end, the pointer the other
      const dx = H.x - A.x, dy = H.y - A.y;
      n.x = (A.x + H.x) / 2 / dims.w; n.y = (A.y + H.y) / 2 / dims.h; n.th = Math.atan2(dy, dx); n.sl = n.sr = Math.max(0.01, Math.hypot(dx, dy) / 2 / dims.m);
    },
  },
  arc: {
    start: (c, s) => ({ x: c.x, y: c.y }), // the apex, in the middle
    // `raw`: gets the plain 0..1 time and eases each leg itself (the same in/out curve as the other tools); `dragMs`: slower, it has two legs and a pause
    raw: true, dragMs: 2600,
    // the hand pulls the right end out wide and down (a dome), holds there a moment, then drags it up and well past the apex so the arc flips over
    at(d, c, s) {
      const sm = ease, DOWN = { x: 105, y: 46 }, UP = { x: 105, y: -87 };
      const p = d < 0.4 ? { x: DOWN.x * sm(d / 0.4), y: DOWN.y * sm(d / 0.4) }
        : d < 0.55 ? DOWN
        : { x: DOWN.x + (UP.x - DOWN.x) * sm((d - 0.55) / 0.45), y: DOWN.y + (UP.y - DOWN.y) * sm((d - 0.55) / 0.45) };
      return { x: c.x + p.x * s, y: c.y + p.y * s };
    },
    make: (C, color, dims, mobile) => harder(createNode('arc', C.x / dims.w, C.y / dims.h, color), mobile),
    update(n, C, H, dims) { // the pointer carries the right end: its distance is the arm length, its angle the bend
      const dx = H.x - C.x, dy = H.y - C.y, len = Math.hypot(dx, dy);
      n.sl = n.sr = Math.max(0.01, len / dims.m);
      if (len > 4) n.phi = wrapAngle(Math.atan2(dy, dx) - n.th);
    },
  },
  circle: {
    start: (c, s) => ({ x: c.x, y: c.y }),
    at: (d, c, s) => ({ x: c.x + 50 * s * d * (c.mobile ? 2 : 1), y: c.y + 12 * s * d * (c.mobile ? 2 : 1) }), // the ring is the drag distance, so a short drag is a small, hard ring (twice as far on a phone, where it's hard to see)
    make: (C, color, dims, mobile) => createNode('circle', C.x / dims.w, C.y / dims.h, color, mobile ? 1 : undefined), // arms twice the default spread on a phone
    update(n, C, H) { n.k = Math.round(radiusToHard(Math.hypot(H.x - C.x, H.y - C.y), hardMax(n)) * 10) / 10; }, // the ring is the drag distance
  },
  stroke: {
    // on a phone the canvas is small next to the (bigger) handles, so the wave is stretched wider and taller to read as a curve, not a squiggle
    start: (c, s) => ({ x: c.x - 92 * s * (c.mobile ? 2 : 1), y: c.y }),
    at: (d, c, s) => ({ x: c.x + (-92 + 184 * d) * s * (c.mobile ? 2 : 1), y: c.y - 30 * s * (c.mobile ? 3 : 1) * Math.sin(d * Math.PI * 2) }),
    make: (A, color) => createNode('stroke', 0.5, 0.5, session.pen.color),
    update(n, A, H, dims, d, c, s, tool) {
      const steps = Math.max(3, Math.round(d * 60));
      const raw = Array.from({ length: steps + 1 }, (_, i) => { const p = tool.at(d * i / steps, c, s); return [p.x, p.y]; });
      Object.assign(n, strokeFromPath(smoothStroke(raw, 4), dims)); n.k = STROKE_START_K; n.a = session.pen.a;
    },
  },
};

// Once a tool has been used the demo never plays for it again (remembered across visits).
const USED_KEY = 'meshyToolsUsed';
let used = new Set();
try { used = new Set(JSON.parse(localStorage.getItem(USED_KEY)) || []); } catch { /* private mode or bad data: the demos just play */ }
export function markToolUsed(type) {
  if (used.has(type)) return;
  used.add(type);
  try { localStorage.setItem(USED_KEY, JSON.stringify([...used])); } catch { /* not remembered: fine */ }
}

let current = null;
export function stopToolDemo() {
  if (!current) return;
  clearTimeout(current.timer); cancelAnimationFrame(current.raf); current.root?.remove(); current = null;
}
stage.addEventListener('pointerdown', stopToolDemo, true); // the first press on the stage is the real thing

// type: 'line' | 'arc' | 'circle' | 'stroke'
export function playToolDemo(type) {
  stopToolDemo();
  const tool = TOOLS[type];
  if (!tool || used.has(type) || session.previewing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const sr = stage.getBoundingClientRect(), fr = frameRect(), dims = maxDim();
  // the middle of what's on screen: the visible part of the canvas, in the frame's own pixel coordinates
  const left = Math.max(sr.left, fr.left), right = Math.min(sr.right, fr.right), top = Math.max(sr.top, fr.top), bottom = Math.min(sr.bottom, fr.bottom);
  const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
  const c = { x: (left + right) / 2 - fr.left, y: (top + bottom) / 2 - fr.top, mobile };
  const s = clamp(Math.min(right - left, bottom - top) / 420, 0.5, 1.3);

  const root = document.createElement('div');
  root.className = 'tool-demo';
  const TIP = mobile ? HAND_TIP : CROSS_TIP;
  root.innerHTML = `<div class="tool-demo-hand" style="transform-origin: ${TIP.x}px ${TIP.y}px">${TIP === CROSS_TIP ? CROSS : HAND}</div>`;
  frame.appendChild(root);
  const hand = root.firstElementChild, scope = makeScope(root);
  const A = tool.start(c, s), color = sampler ? sampler(A.x / dims.w, A.y / dims.h) : null;
  const n = tool.make(A, color, dims, mobile); n.id = DEMO_ID;
  scope.nodes = [n]; scope.selected = new Set([DEMO_ID]);
  const dragMs = tool.dragMs || T_DRAG, dragStart = T_IN, dragEnd = T_IN + dragMs, holdEnd = dragEnd + T_HOLD, total = holdEnd + T_OUT;
  const t0 = performance.now();
  current = { root, raf: 0 };
  const step = now => {
    const t = now - t0;
    if (t >= total) { root.remove(); current = { timer: setTimeout(() => playToolDemo(type), REPEAT_MS) }; return; }
    const d = tool.raw ? clamp((t - dragStart) / dragMs, 0, 1) : ease(clamp((t - dragStart) / dragMs, 0, 1)), H = tool.at(d, c, s);
    // the hand slides up into place, presses (a touch smaller) while it drags, and lifts off at the end
    const inU = ease(clamp(t / T_IN, 0, 1)), out = t > holdEnd ? ease((t - holdEnd) / T_OUT) : 0;
    const x = t < dragStart ? A.x + (1 - inU) * 14 * s : H.x, y = t < dragStart ? A.y + (1 - inU) * 22 * s : H.y;
    hand.style.opacity = String(inU);
    hand.style.transform = `translate(${(x - TIP.x).toFixed(1)}px, ${(y - TIP.y).toFixed(1)}px) scale(${t >= dragStart && t < dragEnd ? 0.92 : 1})`;
    root.style.opacity = String(1 - out);
    if (t >= dragStart && (type !== 'stroke' || d > 0.03)) {
      tool.update(n, A, H, dims, d, c, s, tool);
      scope.drag = type === 'stroke' && t < dragEnd ? { type: 'draw', n } : null; // while a stroke is being drawn only its path shows
      refreshHandles(scope);
    }
    current.raf = requestAnimationFrame(step);
  };
  current.raf = requestAnimationFrame(step);
}
