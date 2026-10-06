// The Settings dialog, opened from the top bar's gear icon: a sidebar (Account / Appearance / Shortcuts)
// next to the active section's body, with a highlight that slides between nav buttons instead of popping.
// Escape closes it via its own capture-phase listener (same pattern as the node menu and colour picker), so
// the global handler in keyboard.js never sees it.

import { $ } from './dom.js';
import { cleanHandle } from './constants.js';
import { updateThemeIndicator } from './theme.js';

const NAME_KEY = 'meshyDisplayName', TWITTER_KEY = 'meshyTwitter';

// ---------- Avatar: initials of the display name, or a silhouette when there's nothing to initial ----------
const userIcon = px =>
  `<svg width="${px}" height="${px}" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5.2" r="3"/><path d="M2.5 14a5.5 5.5 0 0 1 11 0z"/></svg>`;
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const a = parts[0][0] ?? '', b = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (a + b).toUpperCase();
}
function renderAvatar(name) {
  const ini = initials(name);
  for (const el of document.querySelectorAll('.avatar')) {
    if (ini) el.textContent = ini;
    else el.innerHTML = userIcon(el.classList.contains('lg') ? 28 : 16);
  }
}

const nameInput = $('prefName');
nameInput.value = localStorage.getItem(NAME_KEY) || '';
renderAvatar(nameInput.value);
nameInput.addEventListener('input', () => {
  const name = nameInput.value.slice(0, 40);
  if (name) localStorage.setItem(NAME_KEY, name); else localStorage.removeItem(NAME_KEY);
  renderAvatar(name);
});
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

const twitterInput = $('prefTwitter');
twitterInput.value = localStorage.getItem(TWITTER_KEY) || '';
twitterInput.addEventListener('input', () => {
  const h = cleanHandle(twitterInput.value);
  if (h) localStorage.setItem(TWITTER_KEY, h); else localStorage.removeItem(TWITTER_KEY);
});
twitterInput.addEventListener('blur', () => { twitterInput.value = cleanHandle(twitterInput.value) ? '@' + cleanHandle(twitterInput.value) : ''; }); // tidy what was typed
twitterInput.addEventListener('keydown', e => { if (e.key === 'Enter') twitterInput.blur(); });

// ---------- Sidebar nav: the sliding highlight is sized/positioned off the active button's own box ----------
const navInd = $('navInd');
function updateNavIndicator() {
  const active = document.querySelector('.snav[aria-selected="true"]');
  if (!active) return;
  navInd.style.top = active.offsetTop + 'px';
  navInd.style.height = active.offsetHeight + 'px';
}
function showSection(name) {
  for (const b of document.querySelectorAll('.snav')) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on));
  }
  for (const s of document.querySelectorAll('.ssec')) s.classList.toggle('active', s.dataset.tab === name);
  // whichever section is visible now measures correctly; the other settles into place next time it's shown
  updateNavIndicator();
  updateThemeIndicator();
}
$('settingsModal').querySelector('.settings-nav').addEventListener('click', e => {
  const tab = e.target.closest('.snav'); if (!tab) return;
  showSection(tab.dataset.tab);
});

// ---------- Open/close ----------
let open = false;
function setOpen(on) {
  open = on;
  $('settingsModal').hidden = !on;
  $('settingsBtn').setAttribute('aria-expanded', String(on));
  if (on) { updateNavIndicator(); updateThemeIndicator(); }
}
$('settingsBtn').addEventListener('click', () => setOpen(!open));
$('settingsClose').addEventListener('click', () => setOpen(false));
$('settingsModal').addEventListener('pointerdown', e => { if (e.target === $('settingsModal')) setOpen(false); });
document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }, true);
