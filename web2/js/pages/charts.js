// Collection charts: summary, value over time, breakdowns, most valuable cards and set completion. Pure HTML/CSS bars + one inline SVG line chart.
// Every chart is a <figure> with a title, visible value labels and a text alternative; text only through h() text nodes.
import { h, icon, toast, plural } from '../ui.js';
import * as cat from '../catalog.js';
import * as col from '../collection.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k))); return e; };
const view = { q: '', started: true, more: false };      // completion filter, survives redraws
const num = (n) => n.toLocaleString('en-US');
const SET_PALETTE = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

// ---- set sizes: distinct collector numbers per set among non-digital, front-face printings (built once)
let setSizes = null;
function sizes(C) {
  if (setSizes) return setSizes;
  const m = new Map();
  for (let i = 0; i < C.n; i++) {
    if (C.flags[i] & (1 | 16)) continue;
    const s = C.cards.set[i]; let g = m.get(s); if (!g) m.set(s, g = new Set());
    g.add(C.cards.no[i]);
  }
  return (setSizes = m);
}

// ---- gather the numbers once per render
function gather(list) {
  const sets = new Map(), colors = new Map(), rarity = new Map(), types = new Map(), cards = [];
  const add = (m, k, copies, cents) => { const o = m.get(k) || { copies: 0, cents: 0 }; o.copies += copies; o.cents += cents; m.set(k, o); };
  for (const e of list) {
    const v = col.value(e), g = cat.find(e.name);
    const row = g ? (g.rows.find((r) => { const c = cat.rowInfo(r); return c.set === e.set && c.no === e.no; }) ?? g.rows[0]) : null;
    const m = row != null ? cat.meta(row) : null;
    add(sets, e.set || '?', e.qty, v.total);
    if (m) {
      add(colors, m.colors.length > 1 ? 'Multicolor' : m.colors.length ? SET_PALETTE[m.colors[0]] : 'Colorless', e.qty, v.total);
      add(rarity, m.rarity, e.qty, v.total);
      for (const t of m.types) add(types, t, e.qty, v.total);
    } else { add(colors, 'Unknown', e.qty, v.total); add(rarity, 'Unknown', e.qty, v.total); }
    cards.push({ e, v });
  }
  return { sets, colors, rarity, types, cards };
}

// ---- generic horizontal bar chart. items: [{label, value, text, sub}]; fmt shows the value label
function bars(title, items, { summary, note, cls = '' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const fig = h('figure', { class: 'cx-fig ' + cls, role: 'group', 'aria-label': `${title}. ${summary || items.map((i) => `${i.label} ${i.text}`).join(', ')}` },
    h('figcaption', null, title));
  if (!items.length) fig.append(h('p', { class: 'hint' }, 'No data yet.'));
  else fig.append(h('ul', { class: 'cx-bars' }, items.map((i) => h('li', null,
    h('span', { class: 'cx-lab' }, i.label), h('span', { class: 'cx-track', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(i.value > 0 ? 2 : 0, (i.value / max) * 100).toFixed(1)}%` })),
    h('span', { class: 'cx-val mono' }, i.text), i.sub ? h('span', { class: 'cx-sub' }, i.sub) : null))));
  if (note) fig.append(h('p', { class: 'hint' }, note));
  return fig;
}
const money = (m, order) => [...m].filter(([, o]) => o.cents > 0).sort((a, b) => b[1].cents - a[1].cents).slice(0, 10).map(([k, o]) => ({ label: order ? order(k) : k, value: o.cents, text: cat.fmt(o.cents), sub: plural(o.copies, 'copy', 'copies') }));
const counts = (m, order, limit = 99) => [...m].sort((a, b) => b[1].copies - a[1].copies).slice(0, limit).map(([k, o]) => ({ label: order ? order(k) : k, value: o.copies, text: num(o.copies), sub: o.cents > 0 ? cat.fmt(o.cents) : '' }));
const tcase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sname = (code) => (code === '?' ? 'Unknown set' : `${cat.setName(code)} (${code.toUpperCase()})`);

// ---- line / area chart of the value history
function trend(hist, width = 640) {
  const fig = h('figure', { class: 'cx-fig' }, h('figcaption', null, 'Collection value over time'));
  if (!hist.length) { fig.append(h('p', { class: 'hint' }, 'No history yet. A value point is saved for each day you open the site with cards in your collection.')); return fig; }
  const W = width, H = 220, L = 54, R = 16, T = 14, B = 34;
  const vals = hist.map((p) => p[1]), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.1 || Math.max(hi * 0.1, 100);
  const y0 = Math.max(0, lo - pad), y1 = hi + pad, t = hist.map((p) => Date.parse(p[0])), t0 = t[0], t1 = t[t.length - 1];
  const x = (i) => (hist.length === 1 || t1 === t0 ? (L + W - R) / 2 : L + ((t[i] - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const summary = `${plural(hist.length, 'day')} recorded, from ${cat.fmt(hist[0][1])} on ${hist[0][0]} to ${cat.fmt(hist[hist.length - 1][1])} on ${hist[hist.length - 1][0]}`;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cx-line', role: 'img', 'aria-label': summary, preserveAspectRatio: 'xMidYMid meet' });
  for (let k = 0; k <= 3; k++) {
    const v = y0 + ((y1 - y0) * k) / 3, yy = y(v);
    s.append(svg('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'gl' }), svg('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', class: 'ax' }, cat.fmt(Math.round(v))));
  }
  const pts = hist.map((p, i) => [x(i), y(p[1])]);
  if (hist.length > 1) {
    s.append(svg('path', { d: `M${pts[0][0]},${H - B} ` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${pts[pts.length - 1][0]},${H - B} Z`, class: 'area' }),
      svg('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '), class: 'ln' }));
  }
  pts.forEach((p, i) => { if (hist.length <= 60 || i === pts.length - 1) s.append(svg('circle', { cx: p[0], cy: p[1], r: 4, class: 'dot' }, svg('title', null, `${hist[i][0]}: ${cat.fmt(hist[i][1])}`))); });
  const anchor = hist.length === 1 ? 'middle' : 'start';
  s.append(svg('text', { x: hist.length === 1 ? pts[0][0] : L, y: H - 10, 'text-anchor': anchor, class: 'ax' }, hist[0][0]));
  if (hist.length > 1) s.append(svg('text', { x: W - R, y: H - 10, 'text-anchor': 'end', class: 'ax' }, hist[hist.length - 1][0]));
  s.append(svg('text', { x: pts[pts.length - 1][0], y: Math.max(T + 10, pts[pts.length - 1][1] - 10), 'text-anchor': hist.length === 1 ? 'middle' : 'end', class: 'ax lastv' }, cat.fmt(hist[hist.length - 1][1])));
  fig.append(s);
  if (hist.length === 1) fig.append(h('p', { class: 'hint' }, 'The trend builds up as you use the site.'));
  fig.append(h('div', { class: 'sr' }, h('table', null, h('caption', null, 'Collection value per day'), h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Value'), h('th', null, 'Copies'))),
    h('tbody', null, hist.map((p) => h('tr', null, h('td', null, p[0]), h('td', null, cat.fmt(p[1])), h('td', null, p[2])))))));
  return fig;
}

// ---- set completion
function completion(list, C) {
  const sz = sizes(C), owned = new Map();
  for (const e of list) { if (!e.set) continue; let o = owned.get(e.set); if (!o) owned.set(e.set, o = { nos: new Set(), copies: 0 }); if (e.no) o.nos.add(e.no); o.copies += e.qty; }
  const all = [...owned].map(([code, o]) => {
    const full = sz.get(code), total = full ? full.size : 0;
    let have = 0; for (const n of o.nos) if (!full || full.has(n)) have++;
    return { code, name: cat.setName(code), have, total, pct: total ? (have / total) * 100 : 0 };
  }).sort((a, b) => b.pct - a.pct || b.have - a.have || a.name.localeCompare(b.name));
  const out = h('div', { class: 'cx-comp' });
  const listEl = h('ul', { class: 'cx-sets' }), count = h('p', { class: 'hint', 'aria-live': 'polite' });
  const draw = () => {
    const q = view.q.trim().toLowerCase();
    const rows = all.filter((s) => (!view.started || s.have > 0) && (!q || s.name.toLowerCase().includes(q) || s.code.includes(q)));
    const shown = view.more ? rows : rows.slice(0, 60);
    listEl.replaceChildren(...shown.map((s) => {
      const p = s.total ? Math.floor(s.pct * 10) / 10 : 0;
      return h('li', null, h('div', { class: 'cx-seth' }, h('span', { class: 'cx-setn' }, s.name, ' ', h('span', { class: 'mono cx-code' }, s.code.toUpperCase())),
        h('span', { class: 'mono cx-setv' }, s.total ? `${s.have} / ${s.total}  ·  ${p.toFixed(p % 1 ? 1 : 0)}%` : `${s.have} owned`)),
      s.total ? h('div', { class: 'progress', role: 'progressbar', 'aria-label': `${s.name} completion`, 'aria-valuemin': 0, 'aria-valuemax': s.total, 'aria-valuenow': s.have, 'aria-valuetext': `${s.have} of ${s.total} cards, ${p}%` }, h('i', { style: `width:${s.have ? Math.max(2, s.pct) : 0}%` })) : null);
    }));
    count.textContent = rows.length ? `Showing ${shown.length} of ${plural(rows.length, 'set')}. Owned counts distinct collector numbers, so a foil or a second copy does not count twice.` : 'No sets match.';
    more.hidden = rows.length <= shown.length;
  };
  const more = h('button', { class: 'btn sm', type: 'button', onclick: () => { view.more = true; draw(); } }, 'Show all sets');
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Filter sets by name or code', 'aria-label': 'Filter sets by name or code', autocomplete: 'off', value: view.q, oninput: (e) => { view.q = e.target.value; draw(); } });
  const only = h('input', { type: 'checkbox', checked: view.started, onchange: (e) => { view.started = e.target.checked; draw(); } });
  out.append(h('div', { class: 'cx-tools' }, h('div', { class: 'search' }, icon('search'), q), h('label', { class: 'check' }, only, 'Show only sets I have started')), listEl, count, h('div', null, more));
  draw();
  return out;
}

// ---- the view
export async function renderCharts(container) {
  container.replaceChildren(h('p', { class: 'hint', role: 'status' }, 'Loading card data…'));
  let C;
  try { C = await cat.loadCatalog(); } catch (err) { container.replaceChildren(h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'Card data could not be loaded'), h('p', null, String(err.message || err)))); return; }
  const list = col.entries();
  if (!list.length) {
    container.replaceChildren(h('div', { class: 'empty' }, icon('inv'), h('h3', null, 'No charts yet'), h('p', null, 'Add cards with the Scanner or import a scans.csv, then come back for value, breakdowns and set completion.'),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('a', { class: 'btn primary', href: '#/scanner' }, icon('scan'), 'Scan cards'))));
    return;
  }
  const total = col.collectionValue(list), g = gather(list), hist = col.valueHistory();
  const anyLive = list.some((e) => col.value(e).live), newest = cat.newestLive();
  const prog = h('div', { class: 'progress', hidden: true, role: 'progressbar', 'aria-label': 'Price refresh progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, h('i'));
  const btn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    btn.disabled = true; prog.hidden = false;
    try {
      const n = await cat.refreshPrices(col.priceRows(list), (f) => { prog.firstChild.style.width = Math.max(4, f * 100) + '%'; prog.setAttribute('aria-valuenow', Math.round(f * 100)); });
      toast(`Updated ${plural(n, 'price')} from Scryfall`); col.recordValueSnapshot();
    } catch (err) { toast('Price refresh failed: ' + (err.message || err)); }
    await renderCharts(container);
  } }, icon('zap'), 'Refresh prices');
  const source = anyLive && newest ? `Includes live prices fetched ${new Date(newest).toLocaleString()}.` : `Prices from the Scryfall snapshot of ${cat.snapshotDate()}.`;
  const colorOrder = ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless', 'Unknown'], rarOrder = [...cat.RARITIES, 'Unknown'];
  const byOrder = (order) => (m) => order.filter((k) => m.has(k)).map((k) => [k, m.get(k)]);
  const colorItems = byOrder(colorOrder)(g.colors).map(([k, o]) => ({ label: k, value: o.copies, text: num(o.copies), sub: o.cents > 0 ? cat.fmt(o.cents) : '' }));
  const rarItems = byOrder(rarOrder)(g.rarity).map(([k, o]) => ({ label: tcase(k), value: o.copies, text: num(o.copies), sub: o.cents > 0 ? cat.fmt(o.cents) : '' }));
  const typeItems = cat.TYPE_NAMES.map(([t]) => t).filter((t) => g.types.has(t)).map((t) => { const o = g.types.get(t); return { label: t, value: o.copies, text: num(o.copies), sub: o.cents > 0 ? cat.fmt(o.cents) : '' }; });
  const top = g.cards.filter((c) => c.v.total > 0).sort((a, b) => b.v.total - a.v.total).slice(0, 10);

  const card = (title, ...kids) => h('section', { class: 'card cx-card' }, h('div', { class: 'hd' }, h('h2', null, title)), h('div', { class: 'bd' }, kids));
  container.replaceChildren(h('div', { class: 'cx' },
    h('div', { class: 'stats' },
      h('div', { class: 'stat a' }, h('small', null, 'Collection value'), h('b', null, cat.fmt(total.cents)), total.unpriced ? h('span', { class: 'hint' }, `${plural(total.unpriced, 'copy', 'copies')} without a price are not included`) : null),
      h('div', { class: 'stat b' }, h('small', null, 'Cards (copies)'), h('b', null, num(total.copies))),
      h('div', { class: 'stat c' }, h('small', null, 'Unique cards'), h('b', null, num(list.length)))),
    h('div', { class: 'cx-src' }, h('div', { class: 'row' }, btn), prog,
      h('p', { class: 'hint' }, `${source} Prices are Scryfall estimates (USD) and can be stale after 24 hours. Foil copies use foil prices.`)),
    card('Value over time', trend(hist, Math.max(280, Math.min(640, (container.clientWidth || 640) - 42)))),
    h('div', { class: 'cx-grid' },
      card('Value by set', bars('Top 10 sets by value', money(g.sets, sname), { note: 'Set is the scanner\'s best guess.' })),
      card('Cards by set', bars('Top 10 sets by copies', counts(g.sets, sname, 10)))),
    h('div', { class: 'cx-grid' },
      card('Cards by color', bars('Copies per color identity', colorItems, { note: 'Multicolor cards count once as Multicolor.' })),
      card('Cards by rarity', bars('Copies per rarity', rarItems))),
    card('Cards by type', bars('Copies per card type', typeItems, { note: 'A card with two types (Artifact Creature) counts in both.' })),
    card('Most valuable cards', top.length ? h('ol', { class: 'cx-top' }, top.map(({ e, v }) => {
      const r = v.rows[0], tot = h('b', { class: 'mono' }, cat.fmt(v.total));
      return h('li', null, r != null ? h('img', { src: cat.imageUrl(r, 'small'), crossorigin: 'anonymous', referrerpolicy: 'no-referrer', loading: 'lazy', width: 63, height: 88, alt: e.name }) : h('span', { class: 'cx-noimg' }),
        h('div', { class: 'cx-ti' }, h('b', null, e.name), h('span', { class: 'hint' }, `${e.set ? sname(e.set) : 'Unknown set'}${e.sp ? ' · ' + e.sp : ''}`),
          h('span', { class: 'hint' }, `${plural(e.qty, 'copy', 'copies')}${e.foil ? `, ${e.foil} foil` : ''} · ${cat.fmt(v.each)}${v.eachFoil != null && e.foil ? ` / foil ${cat.fmt(v.eachFoil)}` : ''} each`)), tot);
    })) : h('p', { class: 'hint' }, 'No priced cards yet.')),
    card('Set completion', completion(list, C))));
}
