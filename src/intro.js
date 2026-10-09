// First-visit intro: a small carousel of looping videos with a heading and a line of text each. Shown once per
// browser (the version is written as it opens, so closing it any way, or just reloading, never brings it back), and
// the videos only download when it's about to be shown (or when the header's info icon is clicked).
// To show it to everyone again after adding something new, bump INTRO_VERSION.
// [i] (any single [key]) in a slide's text is drawn as a keycap.

import { $ } from './dom.js';
import { MOBILE_BREAKPOINT } from './constants.js';

const INTRO_VERSION = 1;
const SEEN_KEY = 'meshyIntroSeen';
// each text should run to two lines at the 440px text width: up to about 115 characters
// mobileOnly: only part of the carousel on a phone-sized window
const ALL_SLIDES = [
  { video: 'videos/referencev2.mp4', title: 'Add a reference', text: 'Drag and drop any image in the canvas! You can also press [i] on your keyboard and sample it with the color picker.' },
  { video: 'videos/community.mp4', title: 'Community gradients', text: 'Publish your gradients to the community, or use any of them as your own starting point.' },
  { video: 'videos/unlink.mp4', title: 'Unlink nodes', text: 'For some additional control, you can right click on a node and unlink its axes so all the handles move independently.' },
  { video: 'videos/pencil.mp4', title: 'Draw with the pencil', text: 'Press [p] to draw a stroke right on the canvas, then click its path to add hardness stops along it.' },
];

const modal = $('introModal'), track = $('introTrack'), dots = $('introDots');
let index = 0, slides = [], videos = [], dotEls = [];

function seen() { try { return localStorage.getItem(SEEN_KEY) === String(INTRO_VERSION); } catch { return true; } } // can't remember it → don't nag
function markSeen() { try { localStorage.setItem(SEEN_KEY, String(INTRO_VERSION)); } catch {} }

// Builds the slides, videos and dots once, the first time the modal is opened (not on every open, which would reload
// the videos). A slide marked mobileOnly is only included when the window is phone-sized at that moment.
let built = false;
function build() {
  if (built) return; built = true;
  const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
  slides = ALL_SLIDES.filter(s => !s.mobileOnly || mobile);
  track.replaceChildren(); dots.replaceChildren();
  videos = slides.map((s, i) => {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('aria-hidden', 'true');
    v.src = s.video; track.appendChild(v); // all of them start loading together, so the slides are ready as you page through
    return v;
  });
  dotEls = slides.map((s, i) => {
    const d = document.createElement('button');
    d.type = 'button'; d.className = 'intro-dot'; d.setAttribute('role', 'tab'); d.setAttribute('aria-label', `Tip ${i + 1} of ${slides.length}`);
    d.addEventListener('click', () => show(i));
    dots.appendChild(d);
    return d;
  });
}

function show(i) {
  index = Math.max(0, Math.min(slides.length - 1, i));
  track.style.transform = `translateX(${-index * 100}%)`;
  videos.forEach((v, k) => {
    if (k === index) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
  });
  dotEls.forEach((d, k) => d.setAttribute('aria-selected', String(k === index)));
  $('introPrev').disabled = index === 0; $('introNext').disabled = index === slides.length - 1;
  $('introTitle').textContent = slides[index].title;
  $('introText').innerHTML = slides[index].text.replace(/\[(\w)\]/g, (_, k) => `<kbd>${k.toUpperCase()}</kbd>`);
}
// Closing flies the dialog up into the info icon in the header (desktop and mobile), and that icon flies it back out.
// With reduced motion it just appears and disappears.
const dialog = modal.querySelector('.intro-dialog'), infoBtn = $('introInfoBtn');
const canFly = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLY_MS = 200, FLY_EASE = 'ease-out';
let flying = false;
// the transform that squashes the dialog onto the icon (from the dialog's top-left corner)
function squash() {
  const d = dialog.getBoundingClientRect(), b = infoBtn.getBoundingClientRect();
  return `translate(${b.left - d.left}px, ${b.top - d.top}px) scale(${b.width / d.width}, ${b.height / d.height})`;
}
function open() {
  if (flying || !modal.hidden) return;
  markSeen(); build(); show(0);
  modal.hidden = false;
  if (!canFly()) return;
  flying = true;
  const from = squash();
  dialog.style.transformOrigin = '0 0';
  modal.animate({ backgroundColor: ['rgba(0,0,0,0)', 'rgba(0,0,0,.5)'] }, { duration: FLY_MS, easing: FLY_EASE });
  dialog.animate([{ transform: from, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: FLY_MS, easing: FLY_EASE }).finished
    .catch(() => {}).then(() => { flying = false; });
}
function close() {
  if (modal.hidden || flying) return;
  videos.forEach(v => v.pause());
  if (!canFly()) { modal.hidden = true; return; }
  flying = true;
  const to = squash();
  dialog.style.transformOrigin = '0 0';
  modal.animate({ backgroundColor: ['rgba(0,0,0,.5)', 'rgba(0,0,0,0)'] }, { duration: FLY_MS, easing: FLY_EASE, fill: 'forwards' });
  dialog.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: 0 }], { duration: FLY_MS, easing: FLY_EASE, fill: 'forwards' }).finished
    .catch(() => {}).then(() => {
      modal.hidden = true; flying = false;
      modal.getAnimations().forEach(a => a.cancel()); dialog.getAnimations().forEach(a => a.cancel());
    });
}
infoBtn.addEventListener('click', open);

$('introClose').addEventListener('click', close);
$('introPrev').addEventListener('click', () => show(index - 1));
$('introNext').addEventListener('click', () => show(index + 1));
modal.addEventListener('pointerdown', e => { if (e.target === modal) close(); });
document.addEventListener('keydown', e => {
  if (modal.hidden) return;
  if (e.key === 'Escape') { e.stopPropagation(); close(); }
  else if (e.key === 'ArrowRight') { e.stopPropagation(); show(index + 1); }
  else if (e.key === 'ArrowLeft') { e.stopPropagation(); show(index - 1); }
}, true);
// swipe between slides on touch screens
let swipeX = null;
$('introTrack').addEventListener('pointerdown', e => { swipeX = e.clientX; });
$('introTrack').addEventListener('pointerup', e => {
  if (swipeX == null) return;
  const dx = e.clientX - swipeX; swipeX = null;
  if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
});

if (!seen()) open(); // a returning visitor downloads nothing until they click the info icon
