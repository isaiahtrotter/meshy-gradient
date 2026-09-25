// Renderer regression: each preset must draw pixel-for-pixel like the committed baseline. Update the baselines
// deliberately with `npm run test:update` when a rendering change is intended.

import { test, expect } from '@playwright/test';
import { openApp, loadConfig, presets } from './helpers.js';

for (const [i, p] of presets.entries()) {
  test(`preset ${i + 1} renders like the baseline`, async ({ page }) => {
    await openApp(page);
    await loadConfig(page, { ...p, nodes: p.nodes.map((n, k) => ({ ...n, id: k + 1 })) });
    await page.evaluate(() => { document.getElementById('overlay').style.display = 'none'; });
    await page.waitForTimeout(100);
    await expect(page.locator('#gl')).toHaveScreenshot(`preset-${i + 1}.png`);
  });
}
