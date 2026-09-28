// UI theme: light / dark / system. The header icon is a quick light<->dark toggle; the Settings >
// Appearance segmented control adds the explicit "System" option back. Persisted in `meshyTheme`
// (`'light'|'dark'`, absent means "system" — never written for that case, so a plain `prefers-color-scheme`
// change keeps tracking live with zero JS, exactly like the CSS media query already does on its own).
import { $ } from './dom.js';

const STORAGE_KEY = 'meshyTheme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

const systemTheme = () => (media.matches ? 'dark' : 'light');
const effectiveTheme = () => (theme === 'system' ? systemTheme() : theme);

let theme = localStorage.getItem(STORAGE_KEY) || 'system';

function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;

  const effective = effectiveTheme();
  $('themeBtn').setAttribute('aria-pressed', String(effective === 'dark'));
  $('themeBtn').querySelector('.theme-icon-light').toggleAttribute('hidden', effective === 'dark');
  $('themeBtn').querySelector('.theme-icon-dark').toggleAttribute('hidden', effective !== 'dark');

  for (const b of $('themeSeg').querySelectorAll('[data-theme-opt]')) {
    b.setAttribute('aria-pressed', String(b.dataset.themeOpt === theme));
  }
}

function setTheme(next) {
  theme = next;
  if (theme === 'system') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, theme);
  applyTheme();
}

applyTheme();

$('themeBtn').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
$('themeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-theme-opt]'); if (!b) return;
  setTheme(b.dataset.themeOpt);
});
media.addEventListener('change', () => { if (theme === 'system') applyTheme(); });
