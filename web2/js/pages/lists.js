// Lists: cards you want but do not own (a wishlist, a buylist, a "for trade" want list ...). Unlike a binder, a list holds card NAMES with a wanted
// quantity, not physical copies. "Got it" turns one wanted copy into a real copy in a binder.
import * as db from '../../../web/js/store.js';
import * as cat from '../catalog.js';
import * as col from '../collection.js';
import { h, icon, toast, dialog, confirmDialog, promptDialog, download, plural } from '../ui.js';

let current = null;                    // selected list (survives re-renders)
const view = { q: '' };                // the add-card search text
let catReady = false, refocus = false;      // refocus: after adding a card the page redraws, so the search box gets the focus back

export function lists(root) {
  const all = db.get().lists, names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  if (!all[current]) current = names[0] || null;
  const own = db.owned(), list = current ? all[current] : {};
  let stopped = false;

  async function create(first) {
    const n = await promptDialog({ title: 'New list', text: 'A list holds cards you want but do not own yet.', label: 'List name', placeholder: first || 'Wishlist', ok: 'Create' }); if (!n) return;
    if (db.newList(n)) current = n.trim(); else toast('A list with that name already exists');
  }
  async function rename() {
    const n = await promptDialog({ title: `Rename ${current}`, label: 'New name', placeholder: current, ok: 'Rename' }); if (!n) return;
    if (db.renameList(current, n)) current = n.trim(); else toast('Could not rename: that name is empty or already used');
  }
  async function del() { if (await confirmDialog({ title: 'Delete list', text: `Delete "${current}"? Your inventory is not affected.`, ok: 'Delete', danger: true })) db.deleteList(current); }

  // "Got it": one wanted copy becomes a real copy in a binder (the cheapest regular printing; the scanner or the printing picker can correct it later)
  async function gotIt(card) {
    const bnames = db.get().binders;
    const res = await dialog((close) => {
      const sel = h('select', { class: 'input', autofocus: true }, h('option', { value: '' }, 'Unsorted (no binder)'), bnames.map((b) => h('option', { value: b }, b)), h('option', { value: '\0new' }, '+ New binder…'));
      const nm = h('input', { class: 'input', placeholder: 'New binder name', hidden: true, autocomplete: 'off' });
      sel.onchange = () => { nm.hidden = sel.value !== '\0new'; if (!nm.hidden) nm.focus(); };
      return h('form', { onsubmit: (e) => { e.preventDefault(); const nw = sel.value === '\0new', v = nw ? nm.value.trim() : sel.value; if (nw && !v) return; close({ binder: v }); } },
        h('h2', null, `Got ${card}`), h('p', null, 'Adds one copy to your inventory and takes one off this list.'),
        h('label', { class: 'field' }, h('span', null, 'Put it in'), sel), nm,
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add to inventory')));
    }, { label: `Got ${card}` });
    if (!res) return;
    const c = catReady ? cat.cheapest(card, { treat: '' }) : null, i = c ? cat.rowInfo(c.row) : null;
    col.addEntries([{ name: card, sp: i?.sp || '', set: i?.set || '', no: i?.no || '', qty: 1, foil: 0 }], { binder: res.binder || undefined });
    db.bumpList(current, card, -1); toast(`Added ${card} to ${res.binder || 'your inventory'}`);
  }

  // ---- the add-card box: type a name, pick a result
  function adder() {
    const results = h('div', { class: 'results la-results', role: 'listbox', 'aria-label': 'Matching cards', hidden: true });
    const input = h('input', { class: 'input', type: 'search', placeholder: catReady ? 'Search a card to add' : 'Loading card data…', 'aria-label': 'Search a card to add to this list', autocomplete: 'off', disabled: !catReady, value: view.q,
      oninput: (e) => { view.q = e.target.value; fill(); }, onkeydown: (e) => { if (e.key === 'Enter') { const g = cat.search(view.q, 1)[0]; if (g) add(g.name); } else if (e.key === 'Escape') { view.q = ''; input.value = ''; fill(); } } });
    function add(name) { refocus = true; db.bumpList(current, name, 1); view.q = ''; toast(`Added ${name} to ${current}`); }
    function fill() {
      const hits = view.q.trim() ? cat.search(view.q, 8) : [];
      results.hidden = !hits.length;
      results.replaceChildren(...hits.map((g) => {
        const min = Math.min(...g.rows.map((r) => cat.price(r, 'nonfoil')?.cents ?? Infinity));
        return h('button', { class: 'hit', type: 'button', role: 'option', onclick: () => add(g.name) },
          h('img', { src: cat.imageUrl(g.rows[0], 'small'), alt: '', width: 40, height: 56, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }),
          h('span', { class: 'hn' }, h('b', null, g.name), h('small', null, plural(g.rows.length, 'printing'))), h('span', { class: 'mono hp' }, Number.isFinite(min) ? 'from ' + cat.fmt(min) : '–'), icon('plus'));
      }));
    }
    fill();
    return h('div', { class: 'la-add' }, h('label', { class: 'search' }, h('span', { class: 'sr' }, 'Search a card to add'), icon('search'), input), results);
  }

  function detail() {
    const cards = Object.keys(list).sort((a, b) => a.localeCompare(b)), copies = cards.reduce((n, c) => n + list[c], 0);
    const price = (c) => (catReady ? cat.cheapest(c, { treat: '' }) : null);
    let cost = 0, unpriced = 0;
    const rows = cards.map((c) => {
      const p = price(c), g = catReady ? cat.find(c) : null, line = p ? p.cents * list[c] : null, have = own[db.norm(c)] || 0;
      if (line != null) cost += line; else if (catReady) unpriced++;
      return h('tr', null,
        h('td', { class: 'dx-img' }, catReady && g ? h('img', { src: cat.imageUrl(p ? p.row : g.rows[0], 'small'), width: 40, height: 56, alt: '', loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'dx-thumb' }) : h('span', { class: 'dx-nothumb', 'aria-hidden': 'true' })),
        h('td', { class: 'nm' }, c, catReady && !g ? h('small', { class: 'mut', style: 'display:block' }, 'not found in the card data') : null),
        h('td', null, h('span', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': `One fewer ${c}`, onclick: () => db.bumpList(current, c, -1) }, '−'), h('b', null, list[c]), h('button', { type: 'button', 'aria-label': `One more ${c}`, onclick: () => db.bumpList(current, c, 1) }, '+'))),
        h('td', { class: 'num mono' }, have || h('span', { class: 'mut' }, '0')),
        h('td', { class: 'num' }, catReady ? (p ? h('span', { class: 'mono' }, cat.fmt(p.cents)) : h('span', { class: 'mut' }, g ? 'no price' : '–')) : '…'),
        h('td', { class: 'num mono' }, line != null ? cat.fmt(line) : '–'),
        h('td', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', 'aria-label': `Got ${c}: add a copy to the inventory`, onclick: () => gotIt(c) }, icon('check'), 'Got it'),
          h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `Remove ${c} from the list`, onclick: () => db.bumpList(current, c, -list[c]) }, icon('trash'))));
    });
    const text = db.listText(current);
    return h('section', { class: 'card', 'aria-label': current },
      h('div', { class: 'hd' }, h('h2', null, current), h('span', { class: 'grow' }), h('span', { class: 'chip a' }, plural(copies, 'copy', 'copies') + ' wanted'), catReady && cards.length ? h('span', { class: 'chip' }, 'about ' + cat.fmt(cost)) : null),
      h('div', { class: 'tools' }, adder()),
      h('div', { class: 'tools' },
        h('button', { class: 'btn sm', disabled: !cards.length, onclick: () => navigator.clipboard.writeText(text).then(() => toast('List copied'), () => toast('Could not copy')) }, icon('copy'), 'Copy list'),
        h('button', { class: 'btn sm', disabled: !cards.length, onclick: () => download(current + '.txt', text + '\n') }, icon('download'), 'Export .txt'),
        h('span', { style: 'flex:1' }), h('button', { class: 'btn sm', onclick: rename }, 'Rename'), h('button', { class: 'btn sm danger', onclick: del }, icon('trash'), 'Delete list')),
      cards.length ? h('div', { class: 'tablewrap' }, h('table', null, h('caption', { class: 'sr' }, `Cards on ${current}`),
        h('thead', null, h('tr', null, [['', 'Image'], ['', 'Card'], ['', 'Wanted'], ['num', 'You own'], ['num', 'Price each'], ['num', 'Line total'], ['', 'Actions']].map(([cls, t]) => h('th', { class: cls }, t)))), h('tbody', null, rows)))
        : h('div', { class: 'empty' }, icon('list'), h('h3', null, 'This list is empty'), h('p', null, 'Search for a card above to add it.')),
      cards.length ? h('div', { class: 'dx-note' }, catReady ? `Prices: Scryfall estimates for the cheapest printing (snapshot of ${cat.snapshotDate()}).` + (unpriced ? ` ${plural(unpriced, 'card')} without a price are not counted.` : '') : 'Loading card data…') : null);
  }

  const side = h('section', { class: 'card', 'aria-label': 'Your lists' },
    h('div', { class: 'hd' }, icon('list'), h('h2', null, 'Lists')),
    h('div', { class: 'decklist' }, names.length ? names.map((n) => h('button', { class: 'deckbtn', type: 'button', 'aria-current': n === current ? 'true' : null, onclick: () => { current = n; view.q = ''; db.save(); } }, h('span', null, n), h('small', null, Object.values(all[n]).reduce((a, b) => a + b, 0)))) : [h('p', { class: 'hint', style: 'padding:8px' }, 'No lists yet.')]),
    h('div', { class: 'row', style: 'padding:0 12px 14px' }, h('button', { class: 'btn primary', onclick: () => create() }, icon('plus'), 'New list')));
  const body = current ? detail() : h('section', { class: 'card' }, h('div', { class: 'empty' }, icon('list'), h('h3', null, 'Make your first list'),
    h('p', null, 'Lists are for cards you want but do not own: a wishlist, a buylist, cards you are hunting for a deck. When you get a card, press "Got it" and it moves into a binder.'),
    h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => create('Wishlist') }, icon('plus'), 'Create a wishlist'))));

  root.replaceChildren(h('div', { class: 'page' },
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Lists'), h('p', null, 'Wishlists and buylists: cards you want but do not own. Binders hold what you have; lists hold what you are after.'))),
    h('div', { class: 'decks' }, side, body)));

  if (refocus) { refocus = false; root.querySelector('.la-add input')?.focus(); }
  if (!catReady) cat.loadCatalog().then(() => { catReady = true; if (!stopped) lists(root); }).catch((err) => { if (!stopped) toast('Card data could not be loaded: ' + (err.message || err)); });
  return { stop() { stopped = true; } };
}
