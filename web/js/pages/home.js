import * as db from '../store.js';
import { h, icon, panel } from '../ui.js';

// Home = price search. Empty on purpose for now: the layout is in place, the search is not connected yet.
export function home(root) {
  const s = db.stats();
  let tick;
  const clock = h('span', null, '');
  const upd = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); };
  upd(); tick = setInterval(upd, 1000);

  const search = h('section', { class: 'panel' },
    h('div', { class: 'hd' }, icon('search'), h('span', { class: 'grow' }, 'Price Search'), h('span', { class: 'tag' }, 'coming soon')),
    h('div', { class: 'searchbar' },
      h('input', { type: 'search', placeholder: 'Search a card to see its price…', disabled: true, 'aria-label': 'Card search (not connected yet)' }),
      h('button', { class: 'btn', disabled: true }, 'Search')),
    h('div', { class: 'big-empty' }, h('div', null, icon('search'), h('h2', null, 'Price search is empty for now'),
      h('div', null, 'This page will show prices for any card, and for the cards in your inventory.', h('br'), 'The layout is here; the data is not connected yet.'))));

  const summary = panel('Your Inventory', 'box', h('div', { class: 'bd' },
    h('div', { class: 'chips' }, h('span', { class: 'chip wide' }, `Cards ${s.total}`), h('span', { class: 'chip g wide' }, `Unique ${s.unique}`)),
    h('div', { class: 'chips' }, h('span', { class: 'chip p wide' }, `Special prints ${s.special}`), h('span', { class: 'chip o wide' }, `Sets ${s.sets}`)),
    h('div', { class: 'chips' }, h('span', { class: 'chip c wide' }, `Decks ${s.decks}`),
      h('a', { class: 'chip n wide', href: '#/inventory', style: 'text-decoration:none' }, 'Open inventory'))));

  const links = panel('Quick Links', 'link', h('div', { class: 'links' },
    h('div', { class: 'box' }, h('h4', null, 'MagicCV'),
      h('a', { href: '#/inventory' }, 'Inventory'), h('a', { href: '#/decks' }, 'Decks'), h('a', { href: '#/scanner' }, 'Scanner')),
    h('div', { class: 'box' }, h('h4', null, 'Data'),
      h('a', { href: 'https://scryfall.com', target: '_blank', rel: 'noopener' }, 'Scryfall'),
      h('a', { href: 'https://magic.wizards.com/en/news/feature/wizards-of-the-coast-fan-content-policy', target: '_blank', rel: 'noopener' }, 'Fan Content Policy'))));

  const time = panel(Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' '), 'clock', h('div', { class: 'clock' }, clock));

  root.replaceChildren(h('div', { class: 'cols' }, search, h('div', { class: 'stack' }, summary, links, time)));
  return { stop: () => clearInterval(tick) };
}
