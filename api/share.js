// Serves the editor for a share link (/?g=<slug>) with that gradient's Open Graph tags filled in. Link-preview crawlers
// don't run JS, so the title and image have to be in the HTML they get. vercel.json routes only `/?g=…` here; the page
// itself is meshygradient.html, unchanged (the app opens the gradient from the slug as usual).

import { readFile } from 'node:fs/promises';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/config.js';

const ORIGIN = 'https://mmeshy.com';
const SLUG = /^[A-Za-z0-9]{6,32}$/;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Swaps the content of one <meta> tag (matched by its property/name) in the page.
const setMeta = (html, key, value) =>
  html.replace(new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`), (_, a, b) => a + esc(value) + b);

export default async function handler(req, res) {
  let html = await readFile(new URL('../meshygradient.html', import.meta.url), 'utf8');
  const slug = new URL(req.url, ORIGIN).searchParams.get('g');
  try {
    if (slug && SLUG.test(slug)) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gradient_by_slug`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_slug: slug }),
      });
      const row = r.ok ? (await r.json())[0] : null;
      if (row) {
        const image = `${SUPABASE_URL}/storage/v1/object/public/og/${slug}.jpg`;
        const hasImage = (await fetch(image, { method: 'HEAD' })).ok; // not rendered yet: keep the default card
        const title = row.author_name ? `A gradient by ${row.author_name}` : 'A gradient';
        for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, title);
        html = setMeta(html, 'og:url', `${ORIGIN}/?g=${slug}`);
        if (hasImage) {
          for (const k of ['og:image', 'twitter:image']) html = setMeta(html, k, image);
          // the shared image is the gradient itself, at its own proportions
          const w = +row.config?.w, h = +row.config?.h;
          if (w > 0 && h > 0) {
            const long = 1200, k = long / Math.max(w, h);
            html = setMeta(html, 'og:image:width', Math.max(1, Math.round(w * k)));
            html = setMeta(html, 'og:image:height', Math.max(1, Math.round(h * k)));
          }
        }
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
      }
    }
  } catch { /* any failure: serve the plain page with the default card */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}
