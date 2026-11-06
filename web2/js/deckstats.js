// Deck statistics: pure computation (computeStats) plus the DOM for the "Stats" view (renderStats).
// Numbers come from the catalog metadata of each card; cards the catalog does not know are listed and left out of every number except "total cards".
import { h, plural } from './ui.js';

export const COLOR_ORDER = [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'], ['C', 'Colorless']];
export const TYPE_ORDER = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'];
export const CURVE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

// deck: {cardName: qty}; own: db.owned() ({normalizedName: copies}); norm: db.norm; cat: the catalog module.
export function computeStats(deck, own, norm, cat) {
  const curve = Array(8).fill(0), colors = Object.fromEntries(COLOR_ORDER.map(([k]) => [k, 0])), types = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0]));
  const s = { curve, colors, types, total: 0, counted: 0, lands: 0, nonland: 0, avg: null, notFound: [], price: 0, unpriced: [], missingCopies: 0, missingCost: 0, missingUnpriced: [] };
  let cmcSum = 0, cmcN = 0;
  for (const [name, qty] of Object.entries(deck)) {
    s.total += qty;
    const g = cat.find(name);
    if (!g) { s.notFound.push(name); continue; }
    s.counted += qty;
    const m = cat.meta(g.rows[0]), land = m.types.includes('Land');
    if (land) s.lands += qty; else s.nonland += qty;
    if (!land) {
      if (m.cmc != null) { curve[Math.min(7, m.cmc)] += qty; cmcSum += m.cmc * qty; cmcN += qty; }
      if (m.colors.length) for (const c of m.colors) colors[c] += qty; else colors.C += qty;   // lands are left out of the color split
    }
    for (const t of m.types) if (t in types) types[t] += qty;
    const p = cat.cheapest(name, { treat: '' }), miss = Math.max(0, qty - (own[norm(name)] || 0));
    s.missingCopies += miss;
    if (p) { s.price += p.cents * qty; s.missingCost += p.cents * miss; } else { s.unpriced.push(name); if (miss) s.missingUnpriced.push(name); }
  }
  s.avg = cmcN ? cmcSum / cmcN : null;
  return s;
}

const pct = (v, max) => (max ? Math.max(v ? 4 : 0, Math.round((v / max) * 100)) : 0);

function curveChart(st) {
  const max = Math.max(...st.curve), label = 'Mana curve: ' + CURVE_LABELS.map((l, i) => `mana value ${l}, ${st.curve[i]}`).join('; ');
  return h('figure', { class: 'dx-fig' },
    h('div', { class: 'dx-cols', role: 'img', 'aria-label': label },
      CURVE_LABELS.map((l, i) => h('div', { class: 'dx-col' }, h('span', { class: 'dx-val mono' }, st.curve[i]),
        h('div', { class: 'dx-colbar' }, h('i', { class: 'dx-fill', style: `height:${pct(st.curve[i], max)}%` })), h('span', { class: 'dx-lbl mono' }, l)))),
    h('figcaption', { class: 'hint' }, 'Copies by mana value (lands excluded). The x axis is the mana value.'),
    h('table', { class: 'sr' }, h('caption', null, 'Mana curve'), h('thead', null, h('tr', null, h('th', null, 'Mana value'), h('th', null, 'Copies'))),
      h('tbody', null, CURVE_LABELS.map((l, i) => h('tr', null, h('td', null, l), h('td', null, st.curve[i]))))));
}

function barList(title, rows, st, cls) {   // rows: [[key, label, value]]
  const max = Math.max(...rows.map((r) => r[2])), label = `${title}: ` + rows.map((r) => `${r[1]} ${r[2]}`).join('; ');
  return h('figure', { class: 'dx-fig' },
    h('ul', { class: 'dx-bars', role: 'img', 'aria-label': label },
      rows.map(([k, l, v]) => h('li', { class: 'dx-bar' }, h('span', { class: 'dx-name' }, cls === 'color' ? h('b', { class: 'mono' }, k) : null, cls === 'color' ? ' ' : null, l),
        h('span', { class: 'dx-track' }, h('i', { class: 'dx-fill ' + (cls === 'color' ? 'dx-c' + k : ''), style: `width:${pct(v, max)}%` })), h('span', { class: 'dx-val mono' }, v)))),
    h('table', { class: 'sr' }, h('caption', null, title), h('thead', null, h('tr', null, h('th', null, 'Category'), h('th', null, 'Copies'))),
      h('tbody', null, rows.map(([, l, v]) => h('tr', null, h('td', null, l), h('td', null, v))))));
}

export function renderStats(st, fmt, priceNote) {
  const none = !st.total;
  if (none) return h('div', { class: 'empty' }, h('h3', null, 'No statistics yet'), h('p', null, 'Add cards to this deck to see its mana curve, colors and types.'));
  const noPrice = st.unpriced.length;
  return h('div', { class: 'dx-stats' },
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('small', null, 'Total cards'), h('b', null, st.total)),
      h('div', { class: 'stat b' }, h('small', null, 'Average mana value'), h('b', null, st.avg == null ? '–' : st.avg.toFixed(2)), h('span', { class: 'hint' }, `${st.nonland} nonland, ${st.lands} land`)),
      h('div', { class: 'stat a' }, h('small', null, 'Estimated deck price'), h('b', null, fmt(st.price)),
        h('span', { class: 'hint' }, noPrice ? `${plural(noPrice, 'card')} without a price` : 'every card priced')),
      h('div', { class: 'stat d' }, h('small', null, 'Still to buy'), h('b', null, fmt(st.missingCost)),
        h('span', { class: 'hint' }, `${plural(st.missingCopies, 'copy', 'copies')} not owned` + (st.missingUnpriced.length ? `, ${plural(st.missingUnpriced.length, 'card')} unpriced` : '')))),
    h('p', { class: 'hint' }, priceNote),
    h('div', { class: 'dx-charts' },
      h('section', { class: 'card', 'aria-label': 'Mana curve' }, h('div', { class: 'hd' }, h('h3', null, 'Mana curve')), h('div', { class: 'bd' }, curveChart(st))),
      h('section', { class: 'card', 'aria-label': 'Color split' }, h('div', { class: 'hd' }, h('h3', null, 'Colors')),
        h('div', { class: 'bd' }, barList('Color split', COLOR_ORDER.map(([k, l]) => [k, l, st.colors[k]]), st, 'color'),
          h('p', { class: 'hint' }, 'Nonland copies. A multicolor card counts once for each of its colors; lands are not counted.'))),
      h('section', { class: 'card', 'aria-label': 'Card types' }, h('div', { class: 'hd' }, h('h3', null, 'Card types')),
        h('div', { class: 'bd' }, barList('Card types', TYPE_ORDER.map((t) => [t, t, st.types[t]]), st, 'type'),
          h('p', { class: 'hint' }, 'A card with two types (an artifact creature) counts for both.')))),
    st.notFound.length ? h('div', { class: 'dx-nf', role: 'note' }, h('b', null, `Not found in the card data (${st.notFound.length}), left out of the charts and prices: `), st.notFound.join(', ')) : null);
}
