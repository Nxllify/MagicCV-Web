import * as db from '../../web/js/store.js';          // the card database is shared with the classic site
import { h, icon, toast, download, pickFile, confirmDialog, promptDialog, dialog } from './ui.js';
import './prefs.js';
import { home } from './pages/home.js';
import { inventory } from './pages/inventory.js';
import { decks } from './pages/decks.js';
import { scanner } from './pages/scanner.js';
import { settingsPage } from './pages/settings.js';
import * as cat from './catalog.js';
import * as col from './collection.js';
import { maybeStartTour } from './tour.js';

const ROUTES = [
  { path: '/', label: 'Price Search', icon: 'search', page: home },
  { path: '/inventory', label: 'Inventory', icon: 'inv', page: inventory, count: () => db.stats().total, unit: 'cards' },
  { path: '/decks', label: 'Decks', icon: 'decks', page: decks, count: () => db.stats().decks, unit: 'decks' },
  { path: '/scanner', label: 'Scanner', icon: 'scan', page: scanner, live: true },
  { path: '/settings', label: 'Settings', icon: 'gear', page: settingsPage, hidden: true },
];
const here = () => location.hash.replace(/^#/, '').split('?')[0] || '/';
const params = () => new URLSearchParams(location.hash.split('?')[1] || '');
const route = () => ROUTES.find((r) => r.path === here()) || ROUTES[0];

// ---- chrome (sidebar, top bar, bottom bar) ----
function navLinks(cls) {
  return ROUTES.filter((r) => !r.hidden).map((r) => {
    const c = r.count ? r.count() : null;
    return h('a', { href: '#' + r.path, 'data-tour': r.path, 'aria-current': r.path === route().path ? 'page' : null, 'aria-label': c != null ? `${r.label}, ${c} ${r.unit}` : null },
      icon(r.icon), cls === 'side' ? h('span', null, r.label) : r.label, cls === 'side' && c != null ? h('span', { class: 'count', 'aria-hidden': 'true' }, c) : null);
  });
}
function chrome() {
  
  const dbBtn = h('button', { class: 'navbtn', 'data-tour': 'db', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => openMenu(e.currentTarget, 'side') },
    icon('db'), h('span', { class: 'who' }, h('span', null, h('span', null, 'My collection'), h('small', null, 'Saved in this browser'))));
  document.getElementById('side').replaceChildren(
    h('a', { class: 'logo', href: '#/' }, h('span', { class: 'mark' }, 'MC'), 'MagicCV'),
    h('nav', { class: 'nav', 'aria-label': 'Pages' }, navLinks('side')), h('div', { class: 'grow' }),
    h('div', { class: 'foot' }, h('a', { class: 'navbtn', 'data-tour': 'settings', href: '#/settings', 'aria-current': route().path === '/settings' ? 'page' : null, style: 'text-decoration:none' }, icon('gear'), 'Settings'), dbBtn));
  document.getElementById('topbar').replaceChildren(
    h('a', { class: 'logo', href: '#/' }, h('span', { class: 'mark' }, 'MC'), 'MagicCV'),
    h('a', { class: 'iconbtn', 'data-tour': 'settings', href: '#/settings', 'aria-label': 'Settings' }, icon('gear')),
    h('button', { class: 'iconbtn', 'data-tour': 'db', 'aria-label': 'Database menu', 'aria-haspopup': 'menu', onclick: (e) => openMenu(e.currentTarget, 'top') }, icon('db')));
  document.getElementById('bottomnav').replaceChildren(...navLinks('bottom'));
}

// ---- Database menu ----
function openMenu(anchor, where) {
  document.querySelector('.menu')?.remove();
  const s = db.get(), r = anchor.getBoundingClientRect();
  let off = () => {};
  const close = (refocus = true) => { m.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); if (refocus) anchor.focus(); };
  const away = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) close(false); };
  const key = (e) => {
    const items = [...m.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  };
  const item = (title, sub, fn) => h('button', { role: 'menuitem', type: 'button', onclick: () => { close(false); fn(); } }, title, sub && h('small', null, sub));
  const m = h('div', { class: 'menu', role: 'menu', 'aria-label': 'Database' },
    h('div', { class: 'lbl' }, 'My collection: stored in this browser only'),
    item('Export database', 'Save everything as a .json file', () => download('magiccv-database.json', db.exportJson(), 'application/json')),
    item('Import database', 'Load a .json file saved earlier', async () => { const t = await pickFile('.json'); if (t == null) return; try { db.importJson(t); toast('Database imported'); } catch (e) { toast(e.message); } }),
  );
  document.body.append(m);
  if (where === 'side') { m.style.left = Math.max(12, r.left) + 'px'; m.style.bottom = (innerHeight - r.top + 8) + 'px'; } else { m.style.right = '8px'; m.style.top = (r.bottom + 6) + 'px'; }
  anchor.setAttribute('aria-expanded', 'true'); m.querySelector('button').focus();
  setTimeout(() => { document.addEventListener('pointerdown', away); document.addEventListener('keydown', key); }, 0);
}

// ---- router ----
let current, first = true;
function render(animate = false) {
  chrome(); current?.stop?.();
  const r = route(), main = document.getElementById('main');
  current = r.page(main, params());
  if (animate) main.querySelector('.page')?.classList.add('enter');      // the entrance animation plays on page changes, not on every data refresh
  document.title = `${r.label} · MagicCV`;
}
window.addEventListener('hashchange', () => { render(true); document.getElementById('main').focus({ preventScroll: true }); window.scrollTo(0, 0); });
db.on(() => (route().live ? chrome() : render()));        // the camera page keeps its live preview when the database changes
render(true);
maybeStartTour();
cat.loadCatalog().then(() => col.recordValueSnapshot(), () => {});     // one value snapshot per day builds the value-over-time chart
