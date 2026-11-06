import * as db from '../../../web/js/store.js';
import * as cat from '../catalog.js';
import * as col from '../collection.js';
import { h, icon, toast, confirmDialog, promptDialog, dialog, pickFile, download, fmtTime, plural } from '../ui.js';
import { priceCell, sourceNote } from './home.js';

const VKEY = 'magiccv2.inv.view';
const saved = (() => { try { return JSON.parse(localStorage.getItem(VKEY)) || {}; } catch { return {}; } })();
// view state survives re-renders; the column / hover switches survive reloads
const view = { tab: 'list', binder: null, q: '', combine: true, special: false, group: 'none', sort: 'name', desc: false, sel: new Set(), open: new Set(), prices: !!saved.prices, hideSet: !!saved.hideSet, large: !!saved.large, select: false };
const keep = () => localStorage.setItem(VKEY, JSON.stringify({ prices: view.prices, hideSet: view.hideSet, large: view.large }));
const chipClass = (sp) => (/borderless/.test(sp) ? 'c' : /showcase/.test(sp) ? 'b' : /extended/.test(sp) ? 'a' : /etched|foil/.test(sp) ? 'd' : /promo/.test(sp) ? 'e' : '');
const qtyText = (e) => String(e.qty) + (e.foil ? ` (${e.foil} foil${e.foil === 1 ? '' : 's'})` : '');
const money = (c) => cat.fmt(c);
const rowIds = new WeakMap(); let rowSeq = 0;
const rowId = (r) => { let i = rowIds.get(r); if (!i) rowIds.set(r, i = 'r' + ++rowSeq); return i; };
const printingRow = (e) => cat.printings(e.name).find((r) => { const c = cat.rowInfo(r); return c.set === e.set && c.no === e.no; });

export function inventory(root) {
  if (view.binder && !db.get().binders.includes(view.binder)) view.binder = null;       // the binder was deleted
  let loaded = false, list = [], lvTimer = 0, lvFor = null;
  const tbody = h('tbody'), thead = h('thead'), bulk = h('div', { class: 'bulk', hidden: true, role: 'region', 'aria-label': 'Selected cards' });
  const sumCards = h('b', { class: 'mono' }), live = h('span', { class: 'sr', 'aria-live': 'polite' }), empty = h('div', { class: 'empty', hidden: true });
  const stats = h('div', { class: 'stats' }), listPane = h('div'), chartsPane = h('div', { hidden: true });
  const lv = h('aside', { class: 'lv', hidden: true, 'aria-hidden': 'true' });
  const showBinderCol = () => view.binder === null && db.get().binders.length > 0;       // inside a binder the column would repeat its name
  const COLS = () => [['qty', 'Qty', 'num'], ['name', 'Card', ''], ['sp', 'Special print', ''], ...(view.hideSet ? [] : [['set', 'Set', '']]), ...(showBinderCol() ? [['binder', 'Binder', '']] : []), ...(view.prices ? [['price', 'Price', 'num']] : [])];
  const binderArg = () => (view.binder === null ? undefined : view.binder);
  const binderLabel = (c) => [...new Set(c.rows.map((r) => db.binderOf(r)))].map((b) => b || 'Unsorted').sort((a, b) => a.localeCompare(b)).join(', ');
  const span = () => 2 + (view.select ? 1 : 0) + COLS().length;

  // ---- data. Combined: one line per card + special print (all its printings together, shown as the printing you own most of).
  // Not combined: one line per physical copy, so each copy can get its own printing.
  function items() {
    const q = view.q.trim().toLowerCase(), out = [];
    const ents = col.entries(binderArg()).filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!view.special || e.sp));
    if (view.combine) {
      const m = new Map();
      for (const e of ents) {
        const k = e.name + '\x1f' + e.sp; let g = m.get(k);
        if (!g) m.set(k, g = { id: k, name: e.name, sp: e.sp, qty: 0, foil: 0, ts: '', pin: true, ents: [], rows: [] });
        g.qty += e.qty; g.foil += e.foil; if (e.ts > g.ts) g.ts = e.ts; if (!e.pin) g.pin = false; g.ents.push(e); g.rows.push(...e.rows);
      }
      for (const g of m.values()) { g.top = g.ents.reduce((a, b) => (b.qty > a.qty ? b : a)); g.set = g.top.set; g.no = g.top.no; out.push(g); }
    } else {
      for (const e of ents) for (const r of e.rows) {
        const f = r.foil ? 1 : 0;
        out.push({ id: rowId(r), name: e.name, sp: e.sp, set: e.set, no: e.no, qty: 1, foil: f, ts: r.timestamp || '', pin: !!r.pin, ents: [e], rows: [r], top: { name: e.name, sp: e.sp, set: e.set, no: e.no, qty: 1, foil: f, pin: !!r.pin, rows: [r] } });
      }
    }
    for (const c of out) { c.binder = binderLabel(c); if (loaded && view.prices) { c.val = valueOf(c); c.chg = changeOf(c); } }
    const val = (c) => (view.sort === 'qty' ? c.qty : view.sort === 'price' ? (c.val?.each ?? -1) : (c[view.sort] || '~').toLowerCase());
    return out.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (view.desc ? -1 : 1); });
  }
  const valueOf = (c) => col.value({ ...c.top, qty: c.qty, foil: c.foil });
  // how much one copy moved since the previous daily price snapshot (cents), or null
  const changeOf = (c) => { if (!cat.hasPrevious()) return null; const p = col.value({ ...c.top, qty: c.qty, foil: c.foil }, true); return c.val.each != null && p.each != null ? c.val.each - p.each : null; };
  const topRow = (c) => (loaded ? (printingRow(c.top) ?? cat.printings(c.name)[0]) : undefined);
  const ownedOf = (c, p) => (view.combine ? c.ents.filter((e) => e.set === p.set && e.no === p.no).reduce((n, e) => n + e.qty, 0) : (c.set === p.set && c.no === p.no ? 1 : 0));

  // ---- rendering
  const refresh = () => inventory(root);
  const sortBy = (k) => { if (view.sort === k) view.desc = !view.desc; else { view.sort = k; view.desc = k === 'qty' || k === 'ts' || k === 'price'; } draw(); };
  function syncSel() {
    for (const tr of tbody.querySelectorAll('tr[data-id]')) { const on = view.sel.has(tr.dataset.id); tr.setAttribute('aria-selected', on); const cb = tr.querySelector('input[type=checkbox]'); if (cb) cb.checked = on; }
    const all = thead.querySelector('input'); if (all) { const n = list.filter((c) => view.sel.has(c.id)).length; all.checked = n > 0 && n === list.length; all.indeterminate = n > 0 && n < list.length; }
    bulk.hidden = !view.select || !view.sel.size; sumCards.textContent = view.sel.size; live.textContent = view.sel.size ? `${plural(view.sel.size, 'entry', 'entries')} selected` : 'Selection cleared';
  }

  // set the printing of these copies (rows are the real database rows); pin = price by exactly this printing
  const applyPrinting = (rows, c) => { for (const r of rows) { r.best_guess_set = c.set; r.collector_number = c.no; r.special_print = c.sp; r.pin = '1'; } db.save(); };
  const unpin = (rows) => { for (const r of rows) delete r.pin; db.save(); };

  function printingsPanel(e) {
    const rows = cat.printings(e.name), cheapestRow = col.unit({ name: e.name, sp: e.sp, set: '', no: '', pin: false }, false)?.row, one = !view.combine;
    return h('div', { class: 'prints' }, h('h3', null, `${plural(rows.length, 'printing')} of ${e.name}`),
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, e.pin ? 'You picked a printing, so this card is priced by that printing.' : 'Priced by the cheapest printing with the same treatment, because the scanner only guesses the set.',
        one ? ' "Pick this printing" changes just this copy; "Apply to all" changes every copy of the card.' : ' Pick a printing to correct all copies of this card.'),
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Printing'), h('th', null, 'Treatment'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Foil'), h('th', { class: 'num' }, 'You own'), h('th', null, h('span', { class: 'sr' }, 'Choose')))),
        h('tbody', null, rows.map((r) => {
          const c = cat.rowInfo(r), isCur = c.set === e.set && c.no === e.no, n = ownedOf(e, c), label = `${c.setName} (${c.set.toUpperCase()})`;
          return h('tr', { class: isCur ? 'cur' : '' }, h('td', { class: 'pr' }, h('img', { src: cat.imageUrl(r, 'small'), alt: '', width: 32, height: 44, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }), h('span', null, h('b', null, c.setName), h('small', { class: 'mono' }, `${c.set.toUpperCase()} · ${cat.meta(r).released.slice(0, 4)}`))),
            h('td', null, c.sp ? c.sp.split(', ').map((t) => h('span', { class: 'chip c', style: 'margin:0 4px 4px 0' }, t)) : h('span', { class: 'mut' }, 'regular'), r === cheapestRow ? h('span', { class: 'chip a' }, 'cheapest') : null),
            h('td', { class: 'num' }, priceCell(cat.price(r, 'nonfoil'))), h('td', { class: 'num' }, priceCell(cat.price(r, 'foil'))), h('td', { class: 'num mono' }, n || ''),
            h('td', { class: 'acts' }, isCur && e.pin ? h('span', { class: 'chip a' }, 'your pick') : isCur ? h('span', { class: 'chip' }, one ? 'scanned as' : 'most owned') : null,
              isCur && e.pin ? h('button', { class: 'btn sm', onclick: () => unpin(e.rows) }, 'Price by cheapest') : null,
              !(isCur && e.pin) ? h('button', { class: 'btn sm', 'aria-label': `${one ? 'Pick' : 'Use'} ${label} for ${e.name}`, onclick: () => { applyPrinting(e.rows, c); toast(`${e.name}: ${one ? 'this copy is' : 'now'} ${label}`); } }, one ? 'Pick this printing' : 'Use this printing') : null,
              one ? h('button', { class: 'btn sm', 'aria-label': `Apply ${label} to all copies of ${e.name}`, onclick: () => { const all = db.get().rows.filter((x) => x.name === e.name); applyPrinting(all, c); toast(`All ${plural(all.length, 'copy', 'copies')} of ${e.name}: ${label}`); } }, 'Apply to all') : null));
        })))));
  }
  function draw() {
    hideLv(); list = items();
    const known = new Set(list.map((c) => c.id)); for (const k of [...view.sel]) if (!known.has(k)) view.sel.delete(k);
    thead.replaceChildren(h('tr', null,
      view.select ? h('th', { class: 'ck' }, h('input', { type: 'checkbox', 'aria-label': 'Select all cards shown', onchange: (e) => { for (const c of list) e.target.checked ? view.sel.add(c.id) : view.sel.delete(c.id); syncSel(); } })) : null, h('th', { class: 'exp' }, h('span', { class: 'sr' }, 'Printings')), h('th', { class: 'thumb' }, h('span', { class: 'sr' }, 'Image')),
      COLS().map(([k, t, cls]) => h('th', { class: cls, 'aria-sort': view.sort === k ? (view.desc ? 'descending' : 'ascending') : 'none', title: k === 'price' ? 'Cheapest printing with the same treatment (the set is only a guess); foil copies use the foil price' : null },
        h('button', { type: 'button', onclick: () => sortBy(k) }, t, view.sort === k ? icon(view.desc ? 'down' : 'up') : null)))));
    const row = (c) => {
      const open = view.open.has(c.id), tr = [h('tr', { 'data-id': c.id, 'data-key': c.id, 'aria-selected': false },
        view.select ? h('td', { class: 'ck' }, h('input', { type: 'checkbox', 'aria-label': `Select ${c.name}`, onchange: (e) => { e.target.checked ? view.sel.add(c.id) : view.sel.delete(c.id); syncSel(); } })) : null,
        h('td', { class: 'exp' }, h('button', { class: 'expbtn', type: 'button', 'aria-expanded': String(open), 'aria-label': `Printings of ${c.name}`, disabled: !loaded, onclick: () => { open ? view.open.delete(c.id) : view.open.add(c.id); draw(); } }, icon('down'))),
        h('td', { class: 'thumb' }, topRow(c) ? h('img', { src: cat.imageUrl(topRow(c), 'small'), alt: '', width: 36, height: 50, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }) : null),
        h('td', { class: 'qty num' }, qtyText(c)), h('td', { class: 'nm' }, c.name), h('td', null, c.sp ? h('span', { class: 'chip ' + chipClass(c.sp) }, c.sp) : null),
        view.hideSet ? null : h('td', { class: 'mut' }, c.set.toUpperCase(), c.ents.length > 1 ? h('small', { class: 'mut', title: c.ents.map((e) => `${e.set.toUpperCase()} x${e.qty}`).join(', ') }, ` +${c.ents.length - 1}`) : null),
        showBinderCol() ? h('td', { class: c.binder === 'Unsorted' ? 'mut' : '' }, c.binder) : null,
        view.prices ? h('td', { class: 'num' }, !loaded ? '…' : c.val.each == null && c.val.eachFoil == null ? h('span', { class: 'mut' }, '–') : h('span', { class: 'mono' }, c.val.each != null ? money(c.val.each) : '–', c.foil && c.val.eachFoil != null ? h('small', { class: 'mut', style: 'display:block' }, `foil ${money(c.val.eachFoil)}`) : null,
          c.chg ? h('small', { class: 'chg ' + (c.chg > 0 ? 'up' : 'down'), style: 'display:block', title: `since ${cat.previousDate()}` }, cat.fmtChange(c.chg)) : null)) : null,
      )];
      if (open && loaded) tr.push(h('tr', { class: 'detail' }, h('td', { colspan: span() }, printingsPanel(c))));
      return tr;
    };
    const rows = [];
    if (view.group === 'none') list.forEach((c) => rows.push(...row(c)));
    else {
      const g = new Map();
      for (const c of list) { const k = ((view.group === 'set' ? c.set : c.sp) || (view.group === 'sp' ? '(regular)' : '(unknown)')).toUpperCase(); (g.get(k) || g.set(k, []).get(k)).push(c); }
      for (const k of [...g.keys()].sort()) { const cs = g.get(k); rows.push(h('tr', { class: 'grp' }, h('td', { colspan: span() }, `${k}  ·  ${plural(cs.reduce((n, c) => n + c.qty, 0), 'copy', 'copies')}  ·  ${plural(cs.length, 'card')}`))); cs.forEach((c) => rows.push(...row(c))); }
    }
    tbody.replaceChildren(...rows); syncSel();
    empty.hidden = list.length > 0;
    empty.replaceChildren(...(db.get().rows.length && view.binder !== null && !col.entries(binderArg()).length ? [icon('box'), h('h3', null, view.binder === '' ? 'No unsorted cards' : `${view.binder} is empty`), h('p', null, 'Turn on "Select cards" in All cards and use "Move to binder", or choose this binder in the Scanner.')]
      : db.get().rows.length ? [icon('search'), h('h3', null, 'No cards match'), h('p', null, 'Try a different search or turn off "Special prints only".')]
      : [icon('inv'), h('h3', null, 'Your inventory is empty'), h('p', null, 'Scan cards with the Scanner, or import the scans.csv from the desktop scanner.'),
         h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('a', { class: 'btn primary', href: '#/scanner' }, icon('scan'), 'Scan cards'), h('button', { class: 'btn', onclick: importCsv }, icon('upload'), 'Import scans.csv'))]));
    drawStats();
  }
  function drawStats() {
    const ents = col.entries(binderArg()), copies = ents.reduce((n, e) => n + e.qty, 0), names = new Set(ents.map((e) => e.name)), sets = new Set(ents.map((e) => e.set).filter(Boolean)), special = ents.reduce((n, e) => n + (e.sp ? e.qty : 0), 0);
    const v = loaded && view.prices ? col.collectionValue(ents) : null, ch = loaded && view.prices ? col.valueChange(ents) : null;
    const st = (c, l, x, sm, sub) => h('div', { class: 'stat ' + c }, h('small', null, l), h('b', { class: sm ? 'sm' : '' }, x), sub ? h('span', { class: 'hint' }, sub) : null);
    stats.replaceChildren(st('a', view.binder === null ? 'Cards' : 'Cards here', copies), st('b', 'Unique', names.size), st('c', 'Special prints', special), st('d', 'Sets', sets.size),
      ...(v ? [st('a', view.binder === null ? 'Collection value' : 'Binder value', money(v.cents)), st('', 'Without a price', plural(v.unpriced, 'copy', 'copies'), true)] : []),
      ...(ch ? [st(ch.delta > 0 ? 'a' : '', `Change since ${cat.previousDate()}`, cat.fmtChange(ch.delta), true, ch.pct == null ? null : `${ch.pct >= 0 ? '+' : '−'}${Math.abs(ch.pct).toFixed(1)} % over ${plural(ch.entries, 'card line')}`)] : []));
  }

  // ---- binders: folders for owned copies. A copy is in one binder or in none (Unsorted).
  function binderBar() {
    const s0 = db.get(), counts = db.binderCounts(), total = s0.rows.length;
    const chip = (label, key, n) => h('button', { type: 'button', class: 'bchip', 'aria-pressed': String(view.binder === key), onclick: () => { view.binder = key; view.sel.clear(); refresh(); } }, h('span', null, label), h('small', { class: 'mono' }, n));
    const kids = [chip('All cards', null, total)];
    if (s0.binders.length) { kids.push(chip('Unsorted', '', counts[''])); for (const b of s0.binders) kids.push(chip(b, b, counts[b])); }
    kids.push(h('button', { type: 'button', class: 'btn sm', onclick: newBinder }, icon('plus'), 'New binder'));
    if (view.binder) kids.push(h('button', { type: 'button', class: 'btn sm', onclick: renameBinder }, 'Rename'), h('button', { type: 'button', class: 'btn sm danger', onclick: deleteBinder }, icon('trash'), 'Delete binder'));
    return h('div', { class: 'binders', role: 'group', 'aria-label': 'Binders' }, kids);
  }
  async function newBinder() {
    const n = await promptDialog({ title: 'New binder', text: 'A binder is a folder for the cards you own, like a box or binder on your shelf.', label: 'Binder name', placeholder: 'Trade binder', ok: 'Create' }); if (!n) return;
    if (!db.addBinder(n)) { toast('A binder with that name already exists'); return; }
    view.binder = n.trim(); view.sel.clear(); refresh();
  }
  async function renameBinder() {
    const n = await promptDialog({ title: `Rename ${view.binder}`, label: 'New name', placeholder: view.binder, ok: 'Rename' }); if (!n) return;
    if (db.renameBinder(view.binder, n)) view.binder = n.trim(); else toast('Could not rename: that name is empty or already used');
  }
  async function deleteBinder() {
    const n = db.binderCounts()[view.binder] || 0;
    if (!(await confirmDialog({ title: 'Delete binder', text: `Delete "${view.binder}"? Its ${plural(n, 'copy', 'copies')} stay in your inventory as Unsorted.`, ok: 'Delete binder', danger: true }))) return;
    db.deleteBinder(view.binder); view.binder = null; toast('Binder deleted; its cards are now Unsorted');
  }
  async function moveToBinder() {
    const cs = picked(); if (!cs.length) return; const names = db.get().binders, copies = cs.reduce((n, c) => n + c.rows.length, 0);
    const res = await dialog((close) => {
      const sel = h('select', { class: 'input', autofocus: true }, h('option', { value: '' }, 'Unsorted (no binder)'), names.map((b) => h('option', { value: b, selected: b === view.binder }, b)), h('option', { value: '\0new' }, '+ New binder…'));
      const nm = h('input', { class: 'input', placeholder: 'New binder name', hidden: true, autocomplete: 'off' });
      sel.onchange = () => { nm.hidden = sel.value !== '\0new'; if (!nm.hidden) nm.focus(); };
      return h('form', { onsubmit: (e) => { e.preventDefault(); const nw = sel.value === '\0new'; const v = nw ? nm.value.trim() : sel.value; if (nw && !v) return; close({ binder: v }); } },
        h('h2', null, 'Move to binder'), h('p', null, `${plural(copies, 'copy', 'copies')} of ${plural(cs.length, 'selected line')} move to the binder you choose.${view.combine ? ' Every copy of a line moves; turn on "Individual cards" to move single copies.' : ''}`),
        h('label', { class: 'field' }, h('span', null, 'Binder'), sel), nm,
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Move')));
    }, { label: 'Move to binder' });
    if (!res) return;
    view.sel.clear(); col.moveToBinder(cs.flatMap((c) => c.rows), res.binder); toast(`Moved ${plural(copies, 'copy', 'copies')} to ${res.binder || 'Unsorted'}`);
  }

  // ---- large view: hover a card for 0.2 s and a big picture opens on the right with its printing, price and your quantity
  function showLv(c) {
    const r = topRow(c); if (!r) return;
    const info = cat.rowInfo(r), v = valueOf(c);
    lv.replaceChildren(h('img', { src: cat.imageUrl(r, 'normal'), alt: '', width: 300, height: 418, crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg big' }),
      h('h3', null, c.name),
      h('div', { class: 'row', style: 'gap:6px;margin:4px 0 10px' }, info.sp ? h('span', { class: 'chip c' }, info.sp) : h('span', { class: 'chip' }, 'regular'), h('span', { class: 'chip b' }, `${info.setName} (${info.set.toUpperCase()})`)),
      h('div', { class: 'lvgrid' }, h('span', null, 'Price'), h('b', { class: 'mono' }, money(v.each)), h('span', null, 'Foil price'), h('b', { class: 'mono' }, money(v.eachFoil)), h('span', null, 'You own'), h('b', { class: 'mono' }, qtyText(c)),
        ...(c.ents.length > 1 ? [h('span', null, 'Printings'), h('b', null, c.ents.map((e) => `${e.set.toUpperCase()} x${e.qty}`).join(', '))] : [])));
    lv.hidden = false;
  }
  function hideLv() { clearTimeout(lvTimer); lvTimer = 0; lvFor = null; lv.hidden = true; }
  tbody.addEventListener('mouseover', (ev) => {
    if (!view.large || !loaded) return; const tr = ev.target.closest('tr[data-id]'); if (!tr || tr.dataset.id === lvFor) return;
    clearTimeout(lvTimer); lvTimer = setTimeout(() => { const c = list.find((x) => x.id === tr.dataset.id); if (c) { lvFor = c.id; showLv(c); } }, 200);
  });
  tbody.addEventListener('mouseleave', hideLv);
  tbody.addEventListener('focusin', (ev) => { if (!view.large || !loaded) return; const tr = ev.target.closest('tr[data-id]'); const c = tr && list.find((x) => x.id === tr.dataset.id); if (c) { lvFor = c.id; showLv(c); } });

  // ---- actions
  const picked = () => list.filter((c) => view.sel.has(c.id));
  async function remove() {
    const cs = picked(); if (!cs.length) return;
    if (!(await confirmDialog({ title: 'Remove a copy', text: `Remove one copy of ${plural(cs.length, 'selected card')}? Use this for a card that was identified wrongly.`, ok: 'Remove', danger: true }))) return;
    const rows = db.get().rows;
    for (const c of cs) {
      const src = c.top.rows, r = [...src].reverse().find((x) => !x.foil) ?? src[src.length - 1], i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1);
    }
    db.save(); view.sel.clear(); toast(`Removed one copy of ${plural(cs.length, 'card')}`);
  }
  async function addToDeck() {
    const cs = picked(); if (!cs.length) return; const names = Object.keys(db.get().decks).sort((a, b) => a.localeCompare(b));
    const res = await dialog((close) => {
      const sel = h('select', { class: 'input', autofocus: true }, names.map((n) => h('option', { value: n }, n)), h('option', { value: '\0new' }, '+ New deck…'));
      const nm = h('input', { class: 'input', placeholder: 'New deck name', hidden: !!names.length, autocomplete: 'off' });
      sel.onchange = () => { nm.hidden = sel.value !== '\0new'; if (!nm.hidden) nm.focus(); }; if (!names.length) sel.value = '\0new';
      return h('form', { onsubmit: (e) => { e.preventDefault(); const v = sel.value === '\0new' ? nm.value.trim() : sel.value; if (v) close(v); } },
        h('h2', null, 'Add to deck'), h('p', null, `${plural(cs.length, 'card')} selected: one copy of each is added.`), h('label', { class: 'field' }, h('span', null, 'Deck'), sel), nm,
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add')));
    }, { label: 'Add to deck' });
    if (!res) return; if (!db.get().decks[res]) db.newDeck(res);
    for (const n of new Set(cs.map((x) => x.name))) db.bump(res, n, 1); toast(`Added ${plural(cs.length, 'card')} to ${res}`);
  }
  async function importCsv() {
    const t = await pickFile('.csv'); if (t == null) return;
    try {
      let replace = false;
      if (db.get().rows.length) { const r = await dialog((close) => h('form', { onsubmit: (e) => e.preventDefault() }, h('h2', null, 'Import scans.csv'), h('p', null, `You have ${plural(db.get().rows.length, 'scan')} already. Add the file's scans to them, or replace them?`),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn danger', type: 'button', onclick: () => close('replace') }, 'Replace'), h('button', { class: 'btn primary', type: 'button', onclick: () => close('add') }, 'Add'))), { label: 'Import scans.csv' }); if (!r) return; replace = r === 'replace'; }
      toast(`Imported ${plural(col.importCsv(t, replace), 'scan')}`);
    } catch (e) { toast(e.message); }
  }
  async function exportIt() {
    try { const m = await import('../exporters.js'); await m.openExportDialog(); }
    catch { download('scans.csv', col.exportCsv(), 'text/csv'); }
  }
  async function refreshPrices(e) {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Refreshing…';
    try { const n = await cat.refreshPrices(col.priceRows(), (f) => { btn.textContent = `Refreshing ${Math.round(f * 100)} %`; }); toast(`Live prices for ${plural(n, 'printing')}`); col.recordValueSnapshot(); } catch (er) { toast(er.message); }
    draw(); btn.disabled = false; btn.textContent = 'Refresh prices';
  }

  // ---- layout
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search cards', value: view.q, 'aria-label': 'Search cards', oninput: (e) => { view.q = e.target.value; draw(); } });
  const group = h('select', { class: 'input', 'aria-label': 'Group by', onchange: (e) => { view.group = e.target.value; draw(); } }, [['none', 'None'], ['set', 'Set'], ['sp', 'Special print']].map(([v, t]) => h('option', { value: v, selected: view.group === v }, t)));
  // option toggles are plain text you click: the selected one turns accent-coloured, bolder and a little larger (no checkbox squares)
  const opt = (label, get, set, persist) => { const b = h('button', { type: 'button', class: 'opt', role: 'switch', 'aria-checked': String(get()), onclick: () => { set(!get()); b.setAttribute('aria-checked', String(get())); if (persist) keep(); } }, h('span', { 'data-t': label }, label)); return b; };
  const chk = (label, key, persist) => opt(label, () => view[key], (v) => { view[key] = v; if (key === 'prices') refresh(); else draw(); }, persist);
  const individual = opt('Individual cards', () => !view.combine, (v) => { view.combine = !v; view.sel.clear(); draw(); });
  const selectBtn = h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(view.select), onclick: () => { view.select = !view.select; if (!view.select) view.sel.clear(); refresh(); } }, icon('check'), view.select ? 'Done selecting' : 'Select cards');
  bulk.append(h('span', null, sumCards, ' selected'), h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: moveToBinder }, icon('box'), 'Move to binder'), h('button', { class: 'btn sm', onclick: addToDeck }, icon('plus'), 'Add to deck'), h('button', { class: 'btn sm danger', onclick: remove }, icon('trash'), 'Remove copy'), h('button', { class: 'btn sm ghost', onclick: () => { view.sel.clear(); syncSel(); } }, 'Clear'));
  const tab = (id, label) => h('button', { type: 'button', role: 'tab', id: 'tab-' + id, 'aria-selected': String(view.tab === id), 'aria-controls': 'pane-' + id, tabindex: view.tab === id ? 0 : -1, onclick: () => { view.tab = id; refresh(); },
    onkeydown: (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { view.tab = view.tab === 'list' ? 'charts' : 'list'; refresh(); setTimeout(() => root.querySelector('[role=tab][aria-selected=true]')?.focus(), 0); } } }, label);
  listPane.setAttribute('role', 'tabpanel'); listPane.id = 'pane-list'; listPane.setAttribute('aria-labelledby', 'tab-list'); chartsPane.setAttribute('role', 'tabpanel'); chartsPane.id = 'pane-charts'; chartsPane.setAttribute('aria-labelledby', 'tab-charts');
  listPane.hidden = view.tab !== 'list'; chartsPane.hidden = view.tab !== 'charts';
  listPane.append(h('section', { class: 'card', 'aria-label': 'Card list' }, binderBar(),
    h('div', { class: 'tools' }, h('label', { class: 'search' }, h('span', { class: 'sr' }, 'Search cards'), icon('search'), search),
      individual, chk('Special prints only', 'special'), chk('Show prices', 'prices', true), chk('Hide set column', 'hideSet', true), chk('Large view', 'large', true), selectBtn,
      view.prices ? h('button', { class: 'btn sm', onclick: refreshPrices, title: 'Fetch live prices from Scryfall for the cheapest printings of your cards' }, 'Refresh prices') : null,
      h('label', { class: 'sel' }, 'Group by', group)),
    h('div', { class: 'tablewrap' }, h('table', null, h('caption', { class: 'sr' }, 'Your cards'), thead, tbody)), empty, bulk, live,
    view.prices ? h('div', { class: 'bd', style: 'border-top:1px solid var(--line)' }, h('div', { id: 'srcnote' })) : null));

  root.replaceChildren(h('div', { class: 'page' },
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Inventory'), h('p', null, 'Every card you have scanned. All printings of a card are one line, shown as the printing you own most of; foil copies are counted in brackets. Turn on "Individual cards" to see every copy on its own line.')),
      h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: importCsv }, icon('upload'), 'Import scans.csv'), h('button', { class: 'btn', onclick: exportIt }, icon('download'), 'Export…'))),
    stats, h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Inventory views' }, tab('list', 'List'), tab('charts', 'Charts')), listPane, chartsPane, lv));
  const fillNote = () => { const n = root.querySelector('#srcnote'); if (n && loaded) n.replaceWith(Object.assign(sourceNote(), { id: 'srcnote' })); };

  draw();
  cat.loadCatalog().then(() => { loaded = true; draw(); fillNote(); if (view.tab === 'charts') showCharts(); }, () => {});
  async function showCharts() {
    chartsPane.replaceChildren(h('p', { class: 'hint', role: 'status' }, 'Loading charts…'));
    try { const m = await import('./charts.js'); await m.renderCharts(chartsPane); } catch (e) { chartsPane.replaceChildren(h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'Charts are not available'), h('p', null, String(e.message || e)))); }
  }
  if (view.tab === 'charts') showCharts();
  return {};
}
