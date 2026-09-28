// UI theme toggle (light/dark), opened from the top bar. Persisted separately from the document/prefs
// state in `meshyTheme` (`'light'|'dark'`); no saved value falls back to the OS `prefers-color-scheme`,
// same as the CSS media query does for anyone who's never touched the toggle.
import { $ } from './dom.js';

const STORAGE_KEY = 'meshyTheme';

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeBtn').setAttribute('aria-pressed', String(theme === 'dark'));
  $('themeBtn').querySelector('.theme-icon-light').toggleAttribute('hidden', theme === 'dark');
  $('themeBtn').querySelector('.theme-icon-dark').toggleAttribute('hidden', theme !== 'dark');
}

let theme = localStorage.getItem(STORAGE_KEY) || systemTheme();
applyTheme(theme);

$('themeBtn').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
});
