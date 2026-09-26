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

  test('brush draws a stroke; stops set hardness along it; the ring rotates it; its menu only flips', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.click('#addStrokeBtn');
    const fr = await frameBox(page);
    await page.mouse.move(fr.x + fr.width * .15, fr.y + fr.height * .8); await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(fr.x + fr.width * (.15 + .5 * i / 30), fr.y + fr.height * (.8 - .3 * Math.sin(i / 30 * Math.PI)));
    await page.mouse.up();
    let n = await selectedNode(page);
    expect(n.type).toBe('stroke');
    expect(n.pts.length).toBeGreaterThan(2);
    expect(n.linked).toBe(true);
    expect(n.sl).toBeUndefined();
    expect(n.stops.map(s => s.t)).toEqual([0, 1]);
    await expect(page.locator('#addStrokeBtn')).toHaveAttribute('aria-pressed', 'true'); // the brush stays on
    await page.keyboard.press('Escape');
    await expect(page.locator('#addStrokeBtn')).toHaveAttribute('aria-pressed', 'false');

    // clicking the path adds a stop there without changing anything yet
    const at = await page.evaluate(() => {
      const p = [...document.querySelectorAll('.stroke-path .line')].find(e => e.ownerSVGElement.style.display === 'block');
      const q = p.getPointAtLength(p.getTotalLength() * .3), r = p.ownerSVGElement.getBoundingClientRect();
      return { x: r.left + q.x, y: r.top + q.y };
    });
    await page.mouse.click(at.x, at.y);
    n = await selectedNode(page);
    expect(n.stops).toHaveLength(3);
    expect(n.stops[1].t).toBeCloseTo(.3, 1);

    // pulling that stop's ring inward hardens the stroke there
    const ring = page.locator('.stop-ring[data-stop="1"]').filter({ visible: true });
    const rb = await ring.boundingBox(), R = (rb.width - 12) / 2;
    await dragFrom(page, rb.x + rb.width / 2, rb.y + rb.height / 2 - R, 0, R - 2);
    expect((await selectedNode(page)).stops[1].m).toBeGreaterThan(2);

    // ⌥-click removes an interior stop; the ends can't be removed
    await page.keyboard.down('Alt');
    await page.locator('.stop-dot[data-stop="1"]').filter({ visible: true }).click();
    await page.locator('.stop-dot[data-stop="0"]').filter({ visible: true }).click();
    await page.keyboard.up('Alt');
    expect((await selectedNode(page)).stops).toHaveLength(2);

    // orbiting the main ring rotates the whole path
    const mr = await page.locator('.hard-ring').filter({ visible: true }).boundingBox();
    const cx = mr.x + mr.width / 2, cy = mr.y + mr.height / 2, mR = (mr.width - 20) / 2 - 7;
    await page.mouse.move(cx, cy - mR); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { const a = -Math.PI / 2 + i / 12 * Math.PI / 2; await page.mouse.move(cx + mR * Math.cos(a), cy + mR * Math.sin(a)); }
    await page.mouse.up();
    expect((await selectedNode(page)).th).toBeCloseTo(Math.PI / 2, 1);

    // its menu has only the flips: no convert, no unlink
    await page.locator('.handle.selected').click({ button: 'right' });
    await expect(page.locator('#nodeMenu')).toBeVisible();
    await expect(page.locator('#nodeMenu button[data-to], #nodeMenu button[data-action="toggle-link"]')).toHaveCount(0);
    await expect(page.locator('#nodeMenu button[data-flip]')).toHaveCount(2);
    await page.keyboard.press('Escape');
  });

  test('flip horizontal / vertical from the menu and the keyboard', async ({ page }) => {
    await loadConfig(page, { w: 1000, h: 1000, nodes: [
      { id: 1, x: .3, y: .4, type: 'stroke', th: .5, pts: [[-.1, 0], [0, .05], [.1, -.02]] },
      { id: 2, x: .7, y: .6, type: 'arc', th: .3, phi: .4, sl: .2, sr: .2 },
    ] });
    const node = id => page.evaluate(i => window.__meshy.state.nodes.find(n => n.id === i), id);
    await page.locator('.handle[data-id="1"]').click({ button: 'right' });
    await expect(page.locator('#nodeMenu button[data-flip]')).toHaveText([/Flip horizontal/, /Flip vertical/]);
    await page.locator('#nodeMenu button[data-flip="x"]').click();
    await expect(page.locator('#nodeMenu')).toBeHidden();
    let n = await node(1);
    expect(n.th).toBeCloseTo(Math.PI - .5, 9);
    expect(n.pts).toEqual([[-.1, 0], [0, -.05], [.1, .02]]);
    expect([n.x, n.y]).toEqual([.3, .4]); // a single node flips in place

    // Shift+V on the arc (via its menu's key), then undo restores it
    await page.locator('.handle[data-id="2"]').click({ button: 'right' });
    await expect(page.locator('#nodeMenu button[data-to]')).toHaveCount(3); // non-strokes keep convert + link
    await page.keyboard.press('Shift+V');
    await expect(page.locator('#nodeMenu')).toBeHidden();
    n = await node(2);
    expect([n.th, n.phi]).toEqual([-.3, -.4]); // flipped exactly once
    await page.keyboard.press('Meta+z');
    n = await node(2);
    expect([n.th, n.phi]).toEqual([.3, .4]);

    // with both selected, Shift+H also mirrors their positions across the group's centre
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Shift+H');
    expect((await node(1)).x).toBeCloseTo(.7, 9);
    expect((await node(2)).x).toBeCloseTo(.3, 9);
    await expect(page.locator('#overlay')).not.toHaveClass(/hide-handles/); // Shift+H didn't toggle preview
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

  test('temperature slider warms the render and a preset without one resets it to neutral', async ({ page }) => {
    const setTemp = v => page.locator('#adjTemp').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    const shot = async () => { await page.waitForTimeout(120); return page.locator('#gl').screenshot(); };
    await setTemp(0); const neutral = await shot();
    await setTemp(80);
    expect((await page.evaluate(() => window.__meshy.state.adj.temp))).toBe(80);
    await expect(page.locator('#adjTempVal')).toHaveText('80');
    expect((await shot()).equals(neutral)).toBe(false);

    await page.locator('#presets .preset').first().click(); // presets predate temperature
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__meshy.state.adj.temp)).toBe(0);
    await expect(page.locator('#adjTempVal')).toHaveText('0');
  });

  test('copy gradient produces a preset-shaped payload', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#copyGradientBtn');
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
    await loadConfig(page, { w: 800, h: 600, nodes: [{ id: 1, x: .2, y: .2, r: .4, color: '#ff0000' }, { id: 2, x: .8, y: .8, type: 'arc', sl: .3, sr: .3, th: 0, phi: .3, linked: false, thr: .5, thl: 3 },
      { id: 3, x: .5, y: .5, type: 'stroke', pts: [[0, 0], ['bad', 1], [.1, .1]], stops: [{ t: .5, m: 3 }], linked: false, sl: .2 }] });
    const s = await getState(page);
    expect(s.types).toEqual(['circle', 'arc', 'stroke']);
    expect(s.nodes[0].sl).toBe(.4);
    expect(s.nodes[1].ar).toBe(.5);
    expect(s.nodes[2].pts).toEqual([[0, 0], [.1, .1]]);
    expect(s.nodes[2].stops).toEqual([{ t: 0, m: 3 }, { t: .5, m: 3 }, { t: 1, m: 3 }]); // ends filled in
    expect(s.nodes[2].linked).toBe(true);
    expect(s.nodes[2].sl).toBeUndefined();
    await expect(page.locator('#status')).toHaveText('');
  });

  test('export downloads a JPG', async ({ page }) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    expect(dl.suggestedFilename()).toMatch(/^mesh-gradient-\d+x\d+\.jpg$/);
  });
});
