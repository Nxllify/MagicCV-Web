// First-open tour: a spotlight on the real navigation plus a small card that explains each main feature.
// Shown on every page load until the user ticks "Don't show this again" (stored in localStorage). Skip closes it for this visit only.
// Replay any time: Settings > Help > "Show the tour", or add ?tour to the address.
import { h, icon } from './ui.js';

const KEY = 'magiccv2.tour.hidden';
const STEPS = [
  { route: '/', title: 'Welcome to MagicCV', icon: 'scan',
    text: 'Scan Magic cards with your webcam and build a collection, all in your browser. This 30-second tour shows the main parts. You can skip it at any time.' },
  { route: '/scanner', target: 'a[data-tour="/scanner"]', title: 'Scanner', icon: 'camera',
    text: 'Press Start camera and hold cards in view. Several cards, even fanned or overlapping, are found at once, named, and added to your inventory one time each. Nothing leaves your computer. No camera? Scan an image file instead.' },
  { route: '/inventory', target: 'a[data-tour="/inventory"]', title: 'Inventory', icon: 'inv',
    text: 'Everything you have scanned. Search, combine copies, sort, see special prints and prices, import a scans.csv from the desktop scanner, and export your list.' },
  { route: '/decks', target: 'a[data-tour="/decks"]', title: 'Decks', icon: 'decks',
    text: 'Paste a list from Moxfield, Archidekt, Arena or MTGO. Each card shows owned (green) or still needed (red) against your inventory.' },
  { route: '/', target: 'a[data-tour="/"]', title: 'Price Search', icon: 'search',
    text: 'Look up any card and see every printing with its estimated price, plus what your whole collection is worth.' },
  { route: '/settings', target: '[data-tour="settings"]', title: 'Settings', icon: 'gear',
    text: 'Pick a color theme, choose your camera, and switch the scanner between your graphics card (WebGPU) and the CPU.' },
  { route: '/settings', target: '[data-tour="db"]', title: 'Your data stays with you', icon: 'db',
    text: 'Your collection is saved in this browser only. Use the Database menu to export it as a .json file (a backup, or a way to move to another computer) and import it later.' },
];

export const tourHidden = () => localStorage.getItem(KEY) === '1';
export const setTourHidden = (v) => (v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY));
export const wantsTour = () => /[?&]tour\b/.test(location.hash + location.search);

const visible = (sel) => [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0);
let active = false;

export function startTour() {
  if (active) return;
  active = true;
  const returnTo = location.hash;
  let i = 0;
  const opener = document.activeElement;

  const never = h('input', { type: 'checkbox', id: 'tour-never', checked: tourHidden() });
  const spot = h('div', { class: 'tour-spot', 'aria-hidden': 'true' });
  const title = h('h2', { id: 'tour-title' }), text = h('p', { id: 'tour-text' }), count = h('span', { class: 'tour-count' });
  const dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, STEPS.map(() => h('i')));
  const back = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => go(i - 1) }, 'Back');
  const next = h('button', { class: 'btn primary sm', type: 'button', onclick: () => (i === STEPS.length - 1 ? finish() : go(i + 1)) });
  const skip = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => finish() }, 'Skip');
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-text' },
    h('div', { class: 'tour-top' }, h('span', { class: 'tour-ic' }), count),
    title, text, dots,
    h('label', { class: 'tour-never' }, never, h('span', null, "Don't show this again")),
    h('div', { class: 'tour-acts' }, skip, h('span', { class: 'grow' }), back, next));
  const shade = h('div', { class: 'tour' }, spot, card);
  document.body.append(shade);

  function place() {
    const s = STEPS[i], t = s.target && visible(s.target);
    if (t) {
      t.scrollIntoView({ block: 'nearest' });
      const r = t.getBoundingClientRect(), pad = 6;
      Object.assign(spot.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    } else Object.assign(spot.style, { display: 'block', left: '50%', top: '50%', width: '0px', height: '0px' });
    const c = card.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, m = 14;
    let x = (vw - c.width) / 2, y = (vh - c.height) / 2;
    if (t) {
      const r = t.getBoundingClientRect();
      if (r.left < vw / 2 && vw > 860) { x = r.right + 18; y = r.top + r.height / 2 - c.height / 2; }       // sidebar item: card to its right
      else { x = r.left + r.width / 2 - c.width / 2; y = r.top - c.height - 16; }                           // bottom bar / top bar: card above
      if (y < m) y = Math.min(r.bottom + 16, vh - c.height - m);
    }
    card.style.left = Math.max(m, Math.min(x, vw - c.width - m)) + 'px';
    card.style.top = Math.max(m, Math.min(y, vh - c.height - m)) + 'px';
  }
  function go(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const s = STEPS[i];
    if (location.hash.replace(/^#/, '').split('?')[0] !== s.route) location.hash = '#' + s.route;
    card.querySelector('.tour-ic').replaceChildren(icon(s.icon));
    title.textContent = s.title; text.textContent = s.text; count.textContent = `${i + 1} of ${STEPS.length}`;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    back.hidden = i === 0; next.textContent = i === STEPS.length - 1 ? 'Done' : i === 0 ? 'Start tour' : 'Next';
    requestAnimationFrame(() => requestAnimationFrame(() => { place(); next.focus({ preventScroll: true }); }));
  }
  function finish() {
    setTourHidden(never.checked);
    active = false; removeEventListener('resize', place); document.removeEventListener('keydown', key, true); shade.remove();
    if (location.hash !== returnTo && returnTo) location.hash = returnTo;
    opener?.focus?.();
  }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    else if (e.key === 'ArrowRight' && document.activeElement?.type !== 'checkbox') go(i + 1);
    else if (e.key === 'ArrowLeft' && document.activeElement?.type !== 'checkbox') go(i - 1);
    else if (e.key === 'Tab') {                                   // keep focus inside the card
      const f = [...card.querySelectorAll('button, input')].filter((x) => !x.hidden);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  addEventListener('resize', place); document.addEventListener('keydown', key, true);
  go(0);
}

export function maybeStartTour() { if (wantsTour() || !tourHidden()) setTimeout(startTour, 300); }
