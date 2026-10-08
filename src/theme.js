// UI theme: light / dark / system. The header icon is a quick light<->dark toggle; the Settings >
// Appearance segmented control adds the explicit "System" option back. Persisted in `meshyTheme`
// (`'light'|'dark'`, absent means "system" — never written for that case, so a plain `prefers-color-scheme`
// change keeps tracking live with zero JS, exactly like the CSS media query already does on its own).
import { $ } from './dom.js';

// Light mode is switched off for now: the UI is pinned to dark, and the header toggle + Settings > Appearance
// tab are hidden. Flip this to true to bring it all back (the stored `meshyTheme` choice is left untouched).
const LIGHT_MODE_ENABLED = false;

const STORAGE_KEY = 'meshyTheme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

const systemTheme = () => (media.matches ? 'dark' : 'light');
const effectiveTheme = () => (theme === 'system' ? systemTheme() : theme);

let theme = LIGHT_MODE_ENABLED ? (localStorage.getItem(STORAGE_KEY) || 'system') : 'dark';
if (!LIGHT_MODE_ENABLED) {
  document.querySelector('.snav[data-tab="appearance"]').hidden = true;
}

// The highlight behind the active segment slides instead of popping — sized/positioned off its own box.
// The Appearance section is hidden (display:none) until first visited, so its first real measurement can
// land well after boot; skip the slide just that once so it doesn't visibly grow in from a stale 0 width.
const segInd = $('segInd');
export function updateThemeIndicator() {
  const active = $('themeSeg').querySelector('[data-theme-opt][aria-pressed="true"]');
  if (!active) return;
  const firstReal = !segInd.dataset.placed && active.offsetWidth > 0;
  if (firstReal) segInd.style.transition = 'none';
  segInd.style.left = active.offsetLeft + 'px';
  segInd.style.width = active.offsetWidth + 'px';
  if (firstReal) {
    segInd.dataset.placed = '1';
    void segInd.offsetWidth; // flush the position before transitions resume
    segInd.style.transition = '';
  }
}

function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;


  for (const b of $('themeSeg').querySelectorAll('[data-theme-opt]')) {
    b.setAttribute('aria-pressed', String(b.dataset.themeOpt === theme));
  }
  updateThemeIndicator();
}

function setTheme(next) {
  theme = next;
  if (theme === 'system') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, theme);
  applyTheme();
}

applyTheme();

$('themeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-theme-opt]'); if (!b) return;
  setTheme(b.dataset.themeOpt);
});
media.addEventListener('change', () => { if (theme === 'system') applyTheme(); });
