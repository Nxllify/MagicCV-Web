import * as db from '../store.js';
import { h, icon, panel, toast, modal, download, pickFile } from '../ui.js';

const COLS = [
  { k: 'qty', t: 'Qty' }, { k: 'name', t: 'Card' }, { k: 'sp', t: 'Special print' },
  { k: 'set', t: 'Set (guess)' }, { k: 'no', t: 'No.' }, { k: 'ts', t: 'Last scanned' },
];
// view state survives re-renders (a change in the database re-draws the page)
const view = { q: '', combine: true, special: false, group: 'none', sort: 'name', desc: false, sel: new Set() };

function cards() {
  const q = view.q.trim().toLowerCase(), out = new Map();
  db.get().rows.forEach((r, i) => {
    if (!r.name || (q && !r.name.toLowerCase().includes(q)) || (view.special && !r.special_print)) return;
    const key = db.keyOf(r), id = view.combine ? key : key + '\x1f' + i;
    const c = out.get(id) || { qty: 0, name: r.name, sp: r.special_print || '', set: r.best_guess_set || '', no: r.collector_number || '', ts: '', key };
    c.qty++; c.ts = c.ts > (r.timestamp || '') ? c.ts : (r.timestamp || '');
    out.set(id, c);
  });
  const num = (s) => { const m = /^\d+/.exec(s || ''); return m ? +m[0] : 1e9; };
  const val = (c) => view.sort === 'qty' ? c.qty : view.sort === 'no' ? num(c.no) : (c[view.sort] || '~').toLowerCase();
  return [...out.values()].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (view.desc ? -1 : 1); });
}

export function inventory(root) {
  const s = db.stats();
  const list = cards();
  const body = h('tbody');
  const total = list.reduce((n, c) => n + c.qty, 0);

  const refresh = () => inventory(root);      // recompute the list after a filter / sort / group change
  const sortBy = (k) => { if (view.sort === k) view.desc = !view.desc; else { view.sort = k; view.desc = k === 'qty' || k === 'ts'; } refresh(); };
  const head = h('tr', null);

  const actions = { remove: h('button', { class: 'btn danger', onclick: remove }, 'Remove copy'), add: h('button', { class: 'btn line', onclick: addToDeck }, 'Add to deck') };
  const count = h('span', { style: 'color:var(--muted)' });

  function sync() {
    for (const tr of body.querySelectorAll('tr[data-key]')) tr.classList.toggle('sel', view.sel.has(tr.dataset.key));
    actions.remove.disabled = actions.add.disabled = !view.sel.size;
    count.textContent = view.sel.size ? `${view.sel.size} selected` : 'Click a card to select it (Ctrl+click for more).';
  }
  function draw() {
    head.replaceChildren(...COLS.map((c) => h('th', { class: 'sort' + (view.sort === c.k ? ' on' : ''), onclick: () => sortBy(c.k) }, c.t + (view.sort === c.k ? (view.desc ? '  ▼' : '  ▲') : ''))));
    const rows = [];
    const row = (c, i) => h('tr', { class: 'pick' + (i % 2 ? ' alt' : ''), 'data-key': c.key, onclick: (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) { view.sel.has(c.key) ? view.sel.delete(c.key) : view.sel.add(c.key); }
      else { const only = view.sel.size === 1 && view.sel.has(c.key); view.sel.clear(); if (!only) view.sel.add(c.key); }
      sync(); } },
      h('td', { class: 'qty' }, c.qty), h('td', { class: 'name' }, c.name), h('td', { class: 'sp' }, c.sp), h('td', { class: 'mut' }, c.set.toUpperCase()),
      h('td', { class: 'mut' }, c.no), h('td', { class: 'mut' }, (c.ts || '').slice(0, 16).replace('T', ' ')));
    if (view.group === 'none') list.forEach((c, i) => rows.push(row(c, i)));
    else {
      const g = new Map();
      for (const c of list) { const k = ((view.group === 'set' ? c.set : c.sp) || (view.group === 'sp' ? '(regular)' : '(unknown)')).toUpperCase(); (g.get(k) || g.set(k, []).get(k)).push(c); }
      for (const k of [...g.keys()].sort()) {
        const cs = g.get(k);
        rows.push(h('tr', { class: 'grp' }, h('td', { colspan: 6 }, `${k}   ·   ${cs.reduce((n, c) => n + c.qty, 0)} copies · ${cs.length} card${cs.length === 1 ? '' : 's'}`)));
        cs.forEach((c, i) => rows.push(row(c, i)));
      }
    }
    body.replaceChildren(...rows);
    sync();
  }

  async function remove() {
    if (!(await modal({ title: 'Remove scans', text: `Remove the newest copy of ${view.sel.size} selected card(s) from the database? Use this for a misidentified card.`, ok: 'Remove', danger: true }))) return;
    const n = db.removeCopies([...view.sel]); view.sel.clear(); toast(n ? `Removed ${n} scan(s)` : 'Nothing removed');
  }
  async function addToDeck() {
    const names = Object.keys(db.get().decks);
    if (!names.length) return toast('Create a deck first (Decks tab)');
    const deck = names.length === 1 ? names[0] : (await modal({ title: 'Add to which deck?', text: names.join(', '), fields: [{ placeholder: 'Deck name' }], ok: 'Add' }) || [])[0];
    if (!deck || !db.get().decks[deck.trim()]) return deck == null ? undefined : toast('No deck with that name');
    for (const k of view.sel) db.bump(deck.trim(), k.split('\x1f')[0], 1);
    toast(`Added ${view.sel.size} card(s) to ${deck.trim()}`);
  }
  async function importCsv() {
    const t = await pickFile('.csv'); if (t == null) return;
    try {
      const merge = db.get().rows.length ? await modal({ title: 'Import scans.csv', text: `Add the scans to your ${db.get().rows.length} existing ones, or replace them?`, ok: 'Add', cancel: 'Replace' }) : true;
      toast(`Imported ${db.importCsv(t, !merge)} scans`);
    } catch (e) { toast(e.message); }
  }

  const bar = h('div', { class: 'row', style: 'padding:14px 16px' },
    h('input', { type: 'search', placeholder: 'Search cards…', value: view.q, style: 'width:260px', oninput: (e) => { view.q = e.target.value; const keep = e.target.selectionStart; refresh(); const n = root.querySelector('input[type=search]'); n.focus(); n.setSelectionRange(keep, keep); } }),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: view.combine, onchange: (e) => { view.combine = e.target.checked; refresh(); } }), 'Combine copies'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: view.special, onchange: (e) => { view.special = e.target.checked; refresh(); } }), 'Special prints only'),
    h('span', { style: 'flex:1' }),
    h('span', { style: 'color:var(--muted)' }, 'Group'),
    h('select', { onchange: (e) => { view.group = e.target.value; refresh(); } },
      [['none', 'None'], ['set', 'Set'], ['sp', 'Special print']].map(([v, t]) => h('option', { value: v, selected: view.group === v }, t))));

  const summary = h('div', { class: 'chips', style: 'padding:14px 16px 0' },
    h('span', { class: 'chip' }, `Cards ${s.total}`), h('span', { class: 'chip g' }, `Unique ${s.unique}`),
    h('span', { class: 'chip p' }, `Special prints ${s.special}`), h('span', { class: 'chip o' }, `Sets ${s.sets}`),
    view.q || view.special ? h('span', { class: 'chip n' }, `Showing ${total}`) : null);

  const tools = h('div', { class: 'row' },
    h('button', { class: 'btn line sm', onclick: importCsv }, 'Import scans.csv'),
    h('button', { class: 'btn line sm', onclick: () => download('scans.csv', db.exportCsv(), 'text/csv') }, 'Export CSV'));

  const table = h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, head), body),
    list.length ? null : h('div', { class: 'empty' }, db.get().rows.length ? h('span', null, 'No cards match the filter.')
      : h('span', null, h('b', null, 'Your inventory is empty.'), h('br'), 'Scan cards on the Scanner tab, or import the scans.csv from the desktop scanner.')));

  const foot = h('div', { class: 'row', style: 'padding:14px 16px;border-top:1px solid var(--line)' }, count, h('span', { style: 'flex:1' }), actions.add, actions.remove);

  function render() { root.replaceChildren(panel('Inventory', 'cards', h('div', null, summary, bar, table, foot), tools)); }
  render(); draw();
  return {};
}
