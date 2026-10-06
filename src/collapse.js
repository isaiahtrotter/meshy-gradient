// Collapsible panel sections: any <section data-collapse="key"> folds down to its heading when the heading is
// clicked (or Enter / Space is pressed on it). Each section's state is remembered per browser.

const KEY = 'meshGradientCollapsed.v1';
const load = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const collapsed = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...collapsed])); } catch {} };

for (const sec of document.querySelectorAll('section[data-collapse]')) {
  const key = sec.dataset.collapse, head = sec.querySelector(':scope > h2');
  if (!head) continue;
  head.tabIndex = 0; head.setAttribute('role', 'button');
  const set = on => {
    sec.classList.toggle('collapsed', on);
    head.setAttribute('aria-expanded', String(!on));
    if (on) collapsed.add(key); else collapsed.delete(key);
  };
  set(collapsed.has(key));
  const toggle = () => { set(!sec.classList.contains('collapsed')); save(); };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } });
}
