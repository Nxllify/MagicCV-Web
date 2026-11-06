import * as db from './store.js';
import { h, icon, modal, toast, download, pickFile } from './ui.js';
import { snow } from './snow.js';
import { home } from './pages/home.js';
import { inventory } from './pages/inventory.js';
import { decks } from './pages/decks.js';
import { scanner } from './pages/scanner.js';
import { settingsPage } from './pages/settings.js';
import './settings.js';

const ROUTES = [   // order = tab order
  { path: '/', label: 'Price Search', icon: 'search', page: home },
  { path: '/inventory', label: 'Inventory', icon: 'cards', page: inventory, count: () => db.stats().total },
  { path: '/decks', label: 'Decks', icon: 'decks', page: decks, count: () => db.stats().decks },
  { path: '/scanner', label: 'Scanner', icon: 'scan', page: scanner },
  { path: '/settings', label: 'Settings', icon: 'gear', page: settingsPage, hidden: true },   // reached from the gear button
];
const here = () => location.hash.replace(/^#/, '') || '/';

function topbar() {
  const s = db.get();
  const bar = document.getElementById('topbar');
  const dbBtn = h('button', { class: 'dbbtn', onclick: (e) => { e.stopPropagation(); menu(dbBtn); } },
    icon('db'), s.user ? s.user : 'Database 1');
  bar.replaceChildren(
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'mark' }, 'MC'), 'MagicCV'),
    h('nav', { class: 'tabs' }, ROUTES.filter((r) => !r.hidden).map((r) => h('a', { class: 'tab' + (here() === r.path ? ' on' : ''), href: '#' + r.path },
      icon(r.icon), r.label, r.count ? h('small', null, r.count()) : null))),
    h('div', { class: 'right' }, h('a', { class: 'iconbtn' + (here() === '/settings' ? ' on' : ''), href: '#/settings', title: 'Settings' }, icon('gear'), 'Settings'), dbBtn));
}

function menu(anchor) {
  document.querySelector('.menu')?.remove();
  const s = db.get();
  const close = () => { m.remove(); document.removeEventListener('click', close); };
  const item = (title, sub, fn) => h('button', { class: 'item', onclick: () => { close(); fn(); } }, title, sub && h('small', null, sub));
  const m = h('div', { class: 'menu', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'item', style: 'cursor:default' }, 'My collection', h('small', null, 'Stored in this browser only')),
    h('hr'),
    item('Export database', 'Save everything as a .json file', () => download('magiccv-database.json', db.exportJson(), 'application/json')),
    item('Import database', 'Load a .json file saved earlier', async () => {
      const t = await pickFile('.json'); if (t == null) return;
      try { db.importJson(t); toast('Database imported'); } catch (e) { toast(e.message); }
    }),
  );
  document.body.append(m);
  setTimeout(() => document.addEventListener('click', close), 0);
}

let current;
function render() {
  topbar();
  current?.stop?.();
  const route = ROUTES.find((r) => r.path === here()) || ROUTES[0];
  const page = document.getElementById('page');
  current = route.page(page);
  page.append(h('footer', { class: 'foot' }, 'MagicCV. Card data from Scryfall. Magic: The Gathering is a trademark of Wizards of the Coast; this is unofficial fan content.'));
  document.title = route.label + ' · MagicCV';
}
window.addEventListener('hashchange', render);
db.on(() => (here() === '/scanner' ? topbar() : render()));   // the camera page keeps its live preview when the database changes
snow(document.getElementById('snow'));
render();
