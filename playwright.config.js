// Runs the app from a throwaway static server and drives it in headless Chromium.
// Software WebGL flags keep the renderer working on machines and CI runners without a GPU.
import { defineConfig } from '@playwright/test';

const PORT = 8765;
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: `python3 -m http.server ${PORT} --bind 127.0.0.1`, url: `http://127.0.0.1:${PORT}/meshygradient.html`, reuseExistingServer: true, stdout: "ignore", stderr: "ignore" },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
