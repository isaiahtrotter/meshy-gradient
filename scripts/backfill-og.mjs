// One-off: renders a link-preview image (<slug>.jpg in the `og` bucket) for every published gradient that lacks one.
// Rendering needs WebGL, so it drives the app in headless Chromium (the same renderer the editor uses), then uploads
// with the service-role key (Supabase dashboard → Project Settings → API; never commit it).
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/backfill-og.mjs
// Safe to re-run: slugs that already have an image are skipped.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { SUPABASE_URL } from '../src/config.js';

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));

const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/gradients?select=slug,config&is_public=eq.true`, { headers: auth })).json();
if (!Array.isArray(rows)) throw new Error('Could not list gradients: ' + JSON.stringify(rows));
const have = new Set((await (await fetch(`${SUPABASE_URL}/storage/v1/object/list/og`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 100000, prefix: '' }),
})).json()).map?.(o => o.name) ?? []);
const todo = rows.filter(r => !have.has(`${r.slug}.jpg`));
console.log(`${rows.length} published, ${todo.length} need an image`);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.route('https://esm.sh/**', r => r.fulfill({ contentType: 'application/javascript', body: 'export function createClient() { return { auth: { onAuthStateChange() {} } }; }' }));
await page.goto(`http://127.0.0.1:${server.address().port}/meshygradient.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('meshyIntroSeen', '1'));

let ok = 0, failed = 0;
for (const { slug, config } of todo) {
  try {
    const dataUrl = await page.evaluate(async c => (await import('/src/loadGradient.js')).renderThumb(c, 1200, 'image/jpeg'), config);
    if (!dataUrl) throw new Error('render failed');
    const body = Buffer.from(dataUrl.split(',')[1], 'base64');
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/og/${slug}.jpg`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg', 'cache-control': 'max-age=31536000' }, body,
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    ok++; console.log('✓', slug);
  } catch (err) { failed++; console.error('✗', slug, err.message); }
}
console.log(`done: ${ok} uploaded, ${failed} failed`);
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
