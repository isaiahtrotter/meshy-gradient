// End-to-end coverage of the editor: every interaction a user can perform, in the order they'd learn them.

import { test, expect } from '@playwright/test';
import { openApp, loadConfig, getState, selectedNode, frameBox, clickCanvas, dragFrom, visibleSpreadHandle, presets, defaultPreset } from './helpers.js';

test.describe('boot', () => {
  test('seeds the default preset, renders palettes and presets, no errors', async ({ page }) => {
    const errors = await openApp(page);
    const s = await getState(page);
    expect(s.n).toBe(defaultPreset.nodes.length);
    expect(s.types).toEqual(defaultPreset.nodes.map(n => n.type || 'circle'));
    expect([s.w, s.h]).toEqual([defaultPreset.w, defaultPreset.h]);
    await expect(page.locator('.handle')).toHaveCount(defaultPreset.nodes.length);
    await expect(page.locator('#palettes .pal')).toHaveCount(8);
    await expect(page.locator('#presets .preset')).toHaveCount(presets.length);
    await expect(page.locator('#status')).toHaveText('');
    expect(errors).toEqual([]);
  });
});

test.describe('nodes', () => {
  let seeded;
  test.beforeEach(async ({ page }) => { await openApp(page); seeded = defaultPreset.nodes.length; });

  test('click adds and selects a node; drag moves it; undo/redo restore it', async ({ page }) => {
    await clickCanvas(page, 0.15, 0.5);
    let s = await getState(page);
    expect(s.n).toBe(seeded + 1);
    expect(s.selected).toHaveLength(1);
    await expect(page.locator('#selSection')).toBeVisible();

    const hb = await page.locator('.handle.selected').boundingBox();
    await dragFrom(page, hb.x + 10, hb.y + 10, 100, 50);
    expect(Math.abs((await selectedNode(page)).x - 0.15)).toBeGreaterThan(0.05);

    await page.keyboard.press('Meta+z');
    expect(Math.abs((await selectedNode(page)).x - 0.15)).toBeLessThan(0.01);
    await page.keyboard.press('Meta+Shift+z');
    expect(Math.abs((await selectedNode(page)).x - 0.15)).toBeGreaterThan(0.05);
  });

  test('arc and line placement modes', async ({ page }) => {
    await page.click('#addArcBtn');
    await expect(page.locator('#addArcBtn')).toHaveAttribute('aria-pressed', 'true');
    await clickCanvas(page, 0.15, 0.3);
    expect((await selectedNode(page)).type).toBe('arc');
    await expect(page.locator('#addArcBtn')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('.arc-path').evaluateAll(els => els.some(e => e.style.display === 'block'))).toBeTruthy();

    await page.click('#addLineBtn');
    await clickCanvas(page, 0.15, 0.7);
    expect((await selectedNode(page)).type).toBe('line');
    expect((await getState(page)).n).toBe(seeded + 2);
  });

  test('spread handle drag changes arm length and angle', async ({ page }) => {
    await page.click('#addLineBtn');
    await clickCanvas(page, 0.15, 0.6);
    const before = await selectedNode(page);
    const h = await visibleSpreadHandle(page, 'l');
    const b = await h.boundingBox();
    await dragFrom(page, b.x + b.width / 2, b.y + b.height / 2, 80, 40);
    const after = await selectedNode(page);
    expect(after.sl).not.toBe(before.sl);
    expect(after.th).not.toBe(before.th);
  });

  test('context menu unlinks axes and converts type', async ({ page }) => {
    await clickCanvas(page, 0.15, 0.5);
    const handle = page.locator('.handle.selected');
    await handle.click({ button: 'right' });
    await expect(page.locator('#nodeMenu')).toBeVisible();
    await page.locator('#nodeMenu button[data-action="toggle-link"]').click();
    let n = await selectedNode(page);
    expect(n.linked).toBe(false);
    expect(typeof n.ar).toBe('number');
    expect(await page.locator('.unlink-badge').evaluateAll(els => els.some(e => e.style.display === 'block'))).toBeTruthy();

    await handle.click({ button: 'right' });
    await expect(page.locator('#nodeMenu button[data-action="toggle-link"]')).toHaveText(/Link axes/);
    await page.keyboard.press('a');
    n = await selectedNode(page);
    expect(n.type).toBe('arc');
    expect(n.linked).toBe(true);
    expect(n.st).toBeUndefined();

    await handle.click({ button: 'right' });
    await page.keyboard.press('c');
    n = await selectedNode(page);
    expect(n.type).toBe('circle');
    expect(typeof n.st).toBe('number');
  });

  test('select all, delete, undo', async ({ page }) => {
    await page.keyboard.press('Meta+a');
    let s = await getState(page);
    expect(s.selected).toHaveLength(s.n);
    await page.keyboard.press('Delete');
    expect((await getState(page)).n).toBe(0);
    await page.keyboard.press('Meta+z');
    expect((await getState(page)).n).toBe(seeded);
  });

  test('alt-drag duplicates the selection', async ({ page }) => {
    await clickCanvas(page, 0.15, 0.5);
    const hb = await page.locator('.handle.selected').boundingBox();
    await page.mouse.move(hb.x + 10, hb.y + 10);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(hb.x + 120, hb.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    expect((await getState(page)).n).toBe(seeded + 2);
  });
});

test.describe('colour', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); await clickCanvas(page, 0.15, 0.5); });

  test('hex input applies, picker opens and edits, Escape closes', async ({ page }) => {
    await page.fill('#selHex', '#123456');
    await page.press('#selHex', 'Enter');
    expect((await selectedNode(page)).color).toBe('#123456');

    await page.click('#selSwatch');
    await expect(page.locator('#colorPicker')).toBeVisible();
    const hue = await page.locator('#hueTrack').boundingBox();
    await page.mouse.click(hue.x + hue.width * 0.5, hue.y + 5);
    expect((await selectedNode(page)).color).not.toBe('#123456');
    await page.keyboard.press('Escape');
    await expect(page.locator('#colorPicker')).toBeHidden();
  });

  test('palette applies to the selection', async ({ page }) => {
    await page.locator('#palettes .pal').nth(2).click();
    expect((await selectedNode(page)).color).toBe('#0f2027');
  });
});

test.describe('document', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('preset applies nodes, size and sliders', async ({ page }) => {
    const p = presets[presets.length - 1];
    await page.locator('#presets .preset').last().click();
    await page.waitForTimeout(300);
    const s = await getState(page);
    expect(s.n).toBe(p.nodes.length);
    expect([s.w, s.h]).toEqual([p.w, p.h]);
    await expect(page.locator('#cw')).toHaveValue(String(p.w));
    expect(s.nodes.every(n => n.type && Number.isFinite(n.sl))).toBeTruthy();
  });

  test('canvas size, sliders, zoom, preview', async ({ page }) => {
    await page.fill('#cw', '1200');
    await page.press('#cw', 'Enter');
    await page.locator('#cw').blur(); // shortcuts are ignored while typing in a field
    await page.waitForTimeout(60);
    expect((await getState(page)).w).toBe(1200);
    await expect(page.locator('#sizeTag')).toHaveText(`1200 × ${defaultPreset.h} px`);

    await page.locator('#soft').evaluate(el => { el.value = 0.8; el.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((await getState(page)).soft).toBeCloseTo(0.05 + 0.8 * 0.15, 9);

    await page.keyboard.press('Meta+=');
    await expect.poll(() => page.evaluate(() => window.__meshy.view.zoom)).toBeCloseTo(1.25, 5);
    await page.keyboard.press('Meta+0');
    await expect.poll(() => page.evaluate(() => window.__meshy.view.zoom)).toBe(1);

    await page.keyboard.press('p');
    await expect(page.locator('#overlay')).toHaveClass(/hide-handles/);
    await page.keyboard.press('p');
    await expect(page.locator('#overlay')).not.toHaveClass(/hide-handles/);
  });

  test('copy gradient produces a preset-shaped payload', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#copyGradient');
    const payload = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    const s = await getState(page);
    expect(payload.nodes).toHaveLength(s.n);
    expect(payload.nodes[0].id).toBeUndefined();
    expect(payload.w).toBe(s.w);
  });

  test('state survives a reload, including one made just before it', async ({ page }) => {
    await page.fill('#cw', '1200');
    await page.press('#cw', 'Enter');
    await clickCanvas(page, 0.15, 0.5);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__meshy);
    const s = await getState(page);
    expect(s.n).toBe(defaultPreset.nodes.length + 1);
    expect(s.w).toBe(1200);
  });

  test('legacy saved shapes still load', async ({ page }) => {
    await loadConfig(page, { w: 800, h: 600, nodes: [{ id: 1, x: .2, y: .2, r: .4, color: '#ff0000' }, { id: 2, x: .8, y: .8, type: 'arc', sl: .3, sr: .3, th: 0, phi: .3, linked: false, thr: .5, thl: 3 }] });
    const s = await getState(page);
    expect(s.types).toEqual(['circle', 'arc']);
    expect(s.nodes[0].sl).toBe(.4);
    expect(s.nodes[1].ar).toBe(.5);
    await expect(page.locator('#status')).toHaveText('');
  });

  test('export downloads a JPG', async ({ page }) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    expect(dl.suggestedFilename()).toMatch(/^mesh-gradient-\d+x\d+\.jpg$/);
  });
});
