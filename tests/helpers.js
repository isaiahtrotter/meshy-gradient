// Shared helpers for the browser tests. The app exposes its document state as window.__meshy.state.

import fs from 'node:fs';
import { expect } from '@playwright/test';

export const PAGE = '/meshygradient.html';
export const presets = JSON.parse(fs.readFileSync(new URL('../presets.json', import.meta.url), 'utf8'));
// The preset that seeds a first-time visit — mirrors pickDefaultPreset() in src/presets.js — so tests stay
// correct no matter which preset is currently flagged as the default.
export const defaultPreset = presets.find(p => p.default) || presets[presets.length - 1];

// Fresh page with no saved state and no console/page errors tolerated.
export async function openApp(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__meshy && document.querySelectorAll('#presets .preset').length > 0);
  return errors;
}

// Load a full gradient config as if it were the saved session.
export async function loadConfig(page, cfg) {
  // Any earlier mutation on this page armed persistence.js's 300ms debounced save; if it's still pending when
  // we reload, its pagehide flush clobbers the localStorage value we're about to set with the page's current
  // (unrelated) state. Wait it out first so the reload's pagehide has nothing left to flush.
  await page.waitForTimeout(350);
  await page.evaluate(c => localStorage.setItem('meshGradientState.v1', JSON.stringify(c)), cfg);
  await page.reload({ waitUntil: 'networkidle' });
  // window.__meshy exists as soon as app.js's module body runs, well before boot() (async: fetches presets,
  // loads state, renders preset thumbnails) actually finishes — wait for something boot() only does at the end.
  await page.waitForFunction(() => window.__meshy && document.querySelectorAll('#presets .preset').length > 0);
  await page.waitForTimeout(100);
}

export const getState = page => page.evaluate(() => {
  const s = window.__meshy.state;
  return { n: s.nodes.length, selected: [...s.selected], w: s.w, h: s.h, soft: s.soft, types: s.nodes.map(n => n.type), nodes: s.nodes };
});
export const selectedNode = page => page.evaluate(() => { const s = window.__meshy.state; return s.nodes.find(n => s.selected.has(n.id)) || null; });
export const frameBox = page => page.locator('#frame').boundingBox();

export async function clickCanvas(page, fx, fy) {
  const fr = await frameBox(page);
  await page.mouse.click(fr.x + fr.width * fx, fr.y + fr.height * fy);
  await page.waitForTimeout(60);
}
export async function dragFrom(page, x, y, dx, dy) {
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}
// The first visible spread handle on the given side of the selected node.
export async function visibleSpreadHandle(page, side) {
  const handles = page.locator(`.spread-handle[data-side="${side}"]`);
  const shown = await handles.evaluateAll(els => els.map(e => e.style.display === 'block'));
  expect(shown.some(Boolean), `a visible ${side} spread handle`).toBeTruthy();
  return handles.nth(shown.indexOf(true));
}
