import * as db from '../../../web/js/store.js';
import * as cat from '../catalog.js';
import * as col from '../collection.js';
import { h, icon, toast, plural } from '../ui.js';

// Price Search: find any card, see every printing with non-foil / foil / etched prices (Scryfall estimates), add a copy to the inventory.
// Prices are a snapshot (date shown) that "Refresh prices" replaces with live Scryfall prices; the source is always labelled.
const state = { q: '', card: null, sort: 'new', busy: false };      // survives re-renders

const img = (row, size, w, h_) => h('img', { src: cat.imageUrl(row, size), alt: '', width: w, height: h_, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' });
const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export const sourceNote = () => {
  const live = cat.newestLive(), day = new Date(), fresh = live && Date.now() - live < 24 * 3600 * 1000;
  return h('p', { class: 'hint' }, `Prices are Scryfall estimates from its partners (USD): ${fresh ? `live prices from ${when(live)} where refreshed, otherwise` : ''} the snapshot of ${cat.snapshotDate()}. They can be stale after 24 hours and are only a general estimate; see the stores for final prices. Card images and names are © Wizards of the Coast, served by `, h('a', { href: 'https://scryfall.com', target: '_blank', rel: 'noopener' }, 'Scryfall'), '.');
};
export function priceCell(p) { return p ? h('span', { class: 'mono', title: p.live ? `live price, ${when(p.at)}` : `snapshot ${cat.snapshotDate()}` }, cat.fmt(p.cents), p.live ? h('i', { class: 'livedot', 'aria-label': 'live' }) : null) : h('span', { class: 'mut' }, '–'); }

export function home(root, params) {
  if (params?.get('card')) { state.card = params.get('card'); state.q = state.card; }      // deep link: #/?card=Lightning%20Bolt
  const body = h('div', { class: 'page stack' });
  root.replaceChildren(body);
  body.append(h('p', { class: 'hint', role: 'status' }, 'Loading card data…'));
  cat.loadCatalog().then(() => draw(), (e) => body.replaceChildren(h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'Card data did not load'), h('p', null, String(e.message || e)))));

  function draw() {
    const s = db.stats(), v = col.collectionValue(), ch = col.valueChange();
    const stat = (cls, label, val, sm) => h('div', { class: 'stat ' + cls }, h('small', null, label), h('b', { class: sm ? 'sm' : '' }, val));
    const input = h('input', { class: 'input', type: 'search', value: state.q, placeholder: 'Search a card name, for example Lightning Bolt', 'aria-label': 'Card name', autocomplete: 'off', oninput: (e) => { state.q = e.target.value; state.card = null; list(); detail(); }, onkeydown: (e) => { if (e.key === 'Enter') { const g = cat.search(state.q, 1)[0]; if (g) pick(g.name); } } });
    const results = h('div', { class: 'results', role: 'region', 'aria-label': 'Search results' }), live = h('p', { class: 'sr', role: 'status', 'aria-live': 'polite' }), panel = h('div');
    body.replaceChildren(
      h('div', { class: 'head' }, h('div', null, h('h1', null, 'Price Search'), h('p', null, 'Look up what a card is worth in every printing, and what your collection is worth.'))),
      h('div', { class: 'stats' }, stat('a', 'Collection value', cat.fmt(v.cents), false), stat('', 'Cards', s.total), stat('b', 'Unique', s.unique), stat('d', 'Price data', cat.newestLive() && Date.now() - cat.newestLive() < 864e5 ? 'live + snapshot' : `snapshot ${cat.snapshotDate()}`, true),
        ...(ch ? [stat(ch.delta > 0 ? 'a' : '', `Change since ${cat.previousDate()}`, cat.fmtChange(ch.delta) + (ch.pct == null ? '' : ` (${ch.pct >= 0 ? '+' : '−'}${Math.abs(ch.pct).toFixed(1)} %)`), true)] : [])),
      h('div', { class: 'grid side-right', style: 'grid-template-columns:minmax(0,380px) minmax(0,1fr)' },
        h('section', { class: 'card', 'aria-label': 'Search' }, h('div', { class: 'tools' }, h('label', { class: 'search', style: 'flex:1;max-width:none' }, h('span', { class: 'sr' }, 'Card name'), icon('search'), input)), results, live),
        panel), valuable(), sourceNote());

    // the most valuable cards you own right now: one tile per card with its prices underneath
    function valuable() {
      const by = new Map();
      for (const e of col.entries()) {
        const k = e.name + '' + e.sp, v = col.value(e); let g = by.get(k);
        if (!g) by.set(k, g = { name: e.name, sp: e.sp, qty: 0, foil: 0, total: 0, each: null, eachFoil: null, top: e, rows: v.rows });
        g.qty += e.qty; g.foil += e.foil; g.total += v.total;
        if (e.qty > g.top.qty) { g.top = e; g.rows = v.rows; }
        if (v.each != null) g.each = Math.max(g.each ?? 0, v.each); if (v.eachFoil != null) g.eachFoil = Math.max(g.eachFoil ?? 0, v.eachFoil);
      }
      const rank = (g) => (g.foil && g.eachFoil != null && g.eachFoil > (g.each ?? 0) ? g.eachFoil : (g.each ?? g.eachFoil ?? -1));
      const all = [...by.values()].sort((a, b) => rank(b) - rank(a) || b.total - a.total), box = h('div', { class: 'mv' }), more = h('button', { class: 'btn', type: 'button' });
      let n = 6;
      const fill = () => {
        box.replaceChildren(...all.slice(0, n).map((g, i) => {
          const r = cat.printings(g.name).find((x) => { const c = cat.rowInfo(x); return c.set === g.top.set && c.no === g.top.no; }) ?? cat.printings(g.name)[0];
          return h('button', { class: 'mvc', type: 'button', 'aria-label': `Number ${i + 1}: ${g.name}, ${cat.fmt(rank(g))} each. Open its prices.`, onclick: () => pick(g.name) },
            r ? img(r, 'normal', 130, 181) : h('span'),
            h('span', null, h('span', { class: 'rank' }, '#' + (i + 1)), h('span', { class: 'nm' }, g.name), g.sp ? h('span', { class: 'chip c' }, g.sp) : null,
              h('span', { class: 'px' }, h('span', null, 'Price'), h('b', null, cat.fmt(g.each)), h('span', null, 'Foil'), h('b', null, cat.fmt(g.eachFoil)), h('span', null, 'You own'), h('b', null, qty(g)), h('span', null, 'Total'), h('b', null, cat.fmt(g.total)))));
        }));
        more.hidden = n >= all.length; more.textContent = `Show more (${all.length - n} left)`;
      };
      const qty = (g) => String(g.qty) + (g.foil ? ` (${g.foil} foil${g.foil === 1 ? '' : 's'})` : '');
      more.onclick = () => { n += 6; fill(); };
      if (!all.length) return h('section', { class: 'card', 'aria-label': 'Most valuable cards' }, h('div', { class: 'hd' }, h('h2', null, 'Most valuable cards in your inventory')), h('div', { class: 'empty' }, icon('inv'), h('h3', null, 'No cards yet'), h('p', null, 'Scan or add cards and your most valuable ones show up here.')));
      fill();
      return h('section', { class: 'card', 'aria-label': 'Most valuable cards' }, h('div', { class: 'hd' }, h('h2', null, 'Most valuable cards in your inventory'), h('span', { class: 'hint' }, 'Ranked by the price of one copy. Click a card to see all its printings.')), box, h('div', { class: 'bd', style: 'padding-top:0' }, more));
    }

    function list() {
      const hits = state.q.trim() ? cat.search(state.q, 30) : [];
      live.textContent = state.q.trim() ? `${plural(hits.length, 'card')} found` : '';
      results.replaceChildren(...(hits.length ? hits.map((g) => {
        const rows = g.rows, min = Math.min(...rows.map((r) => cat.price(r, 'nonfoil')?.cents ?? Infinity));
        return h('button', { class: 'hit', type: 'button', 'aria-current': state.card && cat.find(state.card) === g ? 'true' : null, onclick: () => pick(g.name) },
          img(rows[0], 'small', 40, 56), h('span', { class: 'hn' }, h('b', null, g.name), h('small', null, plural(rows.length, 'printing'))), h('span', { class: 'mono hp' }, Number.isFinite(min) ? 'from ' + cat.fmt(min) : '–'));
      }) : [state.q.trim() ? h('div', { class: 'empty' }, icon('search'), h('h3', null, 'No card found'), h('p', null, 'Check the spelling, or try part of the name.'))
        : h('div', { class: 'empty' }, icon('search'), h('h3', null, 'Search for a card'), h('p', null, 'Type a name to see its printings and prices. Tip: partial names work, and so do the front names of double-faced cards.'))]));
    }
    function pick(name) { state.card = name; state.q = name; input.value = name; list(); detail(); panel.scrollIntoView?.({ block: 'nearest' }); }
    list(); detail();

    function detail() {
      const g = state.card ? cat.find(state.card) : null;
      if (!g) { panel.replaceChildren(h('section', { class: 'card' }, h('div', { class: 'empty' }, icon('search'), h('h3', null, 'Pick a card'), h('p', null, 'Its image, rarity and a price for every printing appear here.')))); return; }
      const m = cat.meta(g.rows[0]), rows = [...g.rows], fin = (r, f) => cat.price(r, f);
      if (state.sort === 'old') rows.reverse(); else if (state.sort === 'low' || state.sort === 'high') rows.sort((a, b) => ((fin(a, 'nonfoil')?.cents ?? Infinity) - (fin(b, 'nonfoil')?.cents ?? Infinity)) * (state.sort === 'low' ? 1 : -1));
      const prices = rows.map((r) => fin(r, 'nonfoil')?.cents).filter((x) => x != null && x > 0), cheapest = prices.length ? Math.min(...prices) : null;
      const owned = col.entries().filter((e) => cat.find(e.name) === g);
      const own = (r) => { const c = cat.rowInfo(r); return owned.filter((e) => e.set === c.set && e.no === c.no).reduce((n, e) => n + e.qty, 0); };
      const hasEtched = rows.some((r) => fin(r, 'etched')), refresh = async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Refreshing…';
        try { const n = await cat.refreshPrices(rows); toast(`Live prices for ${plural(n, 'printing')}`); } catch (er) { toast(er.message); }
        draw();
      };
      const add = (r, foil) => { const c = cat.rowInfo(r); col.addEntries([{ name: c.name, sp: c.sp, set: c.set, no: c.no, qty: 1, foil: foil ? 1 : 0 }]); toast(`Added ${c.name} (${c.set.toUpperCase()} ${c.no})${foil ? ', foil' : ''} to your inventory`); };
      panel.replaceChildren(h('section', { class: 'card', 'aria-label': g.name },
        h('div', { class: 'cardhead' }, h('img', { src: cat.imageUrl(g.rows[0], 'normal'), alt: `${g.name} card image`, width: 244, height: 340, crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg big' }),
          h('div', { class: 'ci' }, h('h2', null, g.name),
            h('div', { class: 'row', style: 'gap:6px' }, h('span', { class: 'chip c' }, m.rarity), m.colors.length ? h('span', { class: 'chip b' }, m.colors.join('')) : h('span', { class: 'chip' }, 'colorless'), ...m.types.map((t) => h('span', { class: 'chip' }, t)), m.cmc != null ? h('span', { class: 'chip d' }, `mana value ${m.cmc}`) : null),
            h('div', { class: 'stats', style: 'margin:14px 0 0;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))' },
              h('div', { class: 'stat a' }, h('small', null, 'Cheapest'), h('b', null, cat.fmt(cheapest))), h('div', { class: 'stat' }, h('small', null, 'Printings'), h('b', null, rows.length)), h('div', { class: 'stat b' }, h('small', null, 'You own'), h('b', null, owned.reduce((n, e) => n + e.qty, 0)))),
            h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: refresh }, 'Refresh prices (live)'),
              h('label', { class: 'row', style: 'gap:8px;margin-left:auto' }, h('span', { class: 'hint' }, 'Sort'), h('select', { class: 'input', style: 'width:auto', 'aria-label': 'Sort printings', onchange: (e) => { state.sort = e.target.value; detail(); } }, [['new', 'Newest first'], ['old', 'Oldest first'], ['low', 'Price: low to high'], ['high', 'Price: high to low']].map(([v, l]) => h('option', { value: v, selected: state.sort === v }, l))))))),
        h('div', { class: 'tablewrap' }, h('table', null, h('caption', { class: 'sr' }, `Printings of ${g.name}`),
          h('thead', null, h('tr', null, h('th', null, 'Printing'), h('th', null, 'Treatment'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Foil'), hasEtched ? h('th', { class: 'num' }, 'Etched') : null, h('th', { class: 'num' }, 'Own'), h('th', null, h('span', { class: 'sr' }, 'Add')))),
          h('tbody', null, rows.map((r) => {
            const c = cat.rowInfo(r), me = cat.meta(r), np = fin(r, 'nonfoil'), isCheap = np && np.cents === cheapest && cheapest > 0;
            return h('tr', null, h('td', { class: 'pr' }, img(r, 'small', 32, 44), h('span', null, h('b', null, c.setName), h('small', { class: 'mono' }, `${c.set.toUpperCase()} · ${me.released.slice(0, 4)}`))),
              h('td', null, c.sp ? c.sp.split(', ').map((t) => h('span', { class: 'chip c', style: 'margin:0 4px 4px 0' }, t)) : h('span', { class: 'mut' }, 'regular'), isCheap ? h('span', { class: 'chip a' }, 'cheapest') : null),
              h('td', { class: 'num' }, priceCell(np)), h('td', { class: 'num' }, priceCell(fin(r, 'foil'))), hasEtched ? h('td', { class: 'num' }, priceCell(fin(r, 'etched'))) : null,
              h('td', { class: 'num mono' }, own(r) || ''),
              h('td', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => { add(r, false); }, 'aria-label': `Add one ${c.name} ${c.set.toUpperCase()} ${c.no} to inventory` }, icon('plus'), 'Add'), me.finishes.includes('foil') ? h('button', { class: 'btn sm', onclick: () => { add(r, true); }, 'aria-label': `Add one foil ${c.name} ${c.set.toUpperCase()} ${c.no} to inventory` }, icon('plus'), 'Foil') : null));
          })))), h('div', { class: 'bd' }, sourceNote())));
    }
  }
  return {};
}
