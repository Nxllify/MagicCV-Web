// The collection as web2 sees it, on top of the shared database (web/js/store.js): one scan row = one physical copy
// { name, special_print, best_guess_set, collector_number, timestamp, foil?: '1', pin?: '1' }. Entries group copies of the same printing
// (name + special print + set + number); `foil` counts how many of an entry's copies are foil. Prices need the catalog to be loaded.
import * as db from '../../web/js/store.js';
import * as cat from './catalog.js';

export const keyOf = db.keyOf;
export const nameOf = (key) => key.split('\x1f')[0];

export function entries() {
  const m = new Map();
  for (const r of db.get().rows) {
    if (!r.name) continue;
    const k = db.keyOf(r);
    let e = m.get(k);
    if (!e) { e = { key: k, name: r.name, sp: r.special_print || '', set: r.best_guess_set || '', no: r.collector_number || '', qty: 0, foil: 0, ts: '', pin: true, rows: [] }; m.set(k, e); }
    e.qty++; if (r.foil) e.foil++; if (!r.pin) e.pin = false; if ((r.timestamp || '') > e.ts) e.ts = r.timestamp; e.rows.push(r);
  }
  return [...m.values()];
}
export const totalQty = () => db.get().rows.length;

// Add copies. list: [{name, sp, set, no, qty, foil}] (foil = how many of qty are foil). deck: also add the cards to that deck's list.
export function addEntries(list, { deck } = {}) {
  const s = db.get(), t0 = Date.now(); let i = 0;
  for (const e of list) {
    for (let c = 0; c < e.qty; c++) {
      const row = { name: e.name, special_print: e.sp || '', best_guess_set: e.set || '', collector_number: e.no || '', timestamp: new Date(t0 + 1000 * i++).toISOString().slice(0, 19) };
      if (c < (e.foil || 0)) row.foil = '1';
      s.rows.push(row);
    }
    if (deck && s.decks[deck]) s.decks[deck][e.name] = (s.decks[deck][e.name] || 0) + e.qty;
  }
  s.sample = false; db.save();
}

// Set an entry to exactly qty copies of which foil are foil (qty 0 removes it).
export function setCounts(key, qty, foil) {
  const s = db.get(), idx = []; s.rows.forEach((r, i) => { if (db.keyOf(r) === key) idx.push(i); });
  if (!idx.length) return;
  qty = Math.max(0, Math.floor(qty) || 0); foil = Math.max(0, Math.min(qty, Math.floor(foil) || 0));
  const old = idx.map((i) => s.rows[i]), tpl = old[0], rows = [];
  for (let c = 0; c < qty; c++) {
    const src = old[Math.min(c, old.length - 1)], r = { ...tpl, timestamp: src.timestamp };
    delete r.foil; if (c < foil) r.foil = '1'; rows.push(r);
  }
  for (let j = idx.length - 1; j >= 1; j--) s.rows.splice(idx[j], 1);
  s.rows.splice(idx[0], 1, ...rows); db.save();
}

// Correct the set / number / treatment of every copy of an entry (the scanner's set is only a guess). pin: price by this exact printing.
export function setPrinting(key, { set, no, sp, pin = true }) {
  for (const r of db.get().rows) if (db.keyOf(r) === key) { r.best_guess_set = set; r.collector_number = no; r.special_print = sp; if (pin) r.pin = '1'; }
  db.save();
}

export function setPin(key, pin) { for (const r of db.get().rows) if (db.keyOf(r) === key) { if (pin) r.pin = '1'; else delete r.pin; } db.save(); }

// ---- prices
const printingRow = (e) => cat.printings(e.name).find((r) => { const c = cat.rowInfo(r); return c.set === e.set && c.no === e.no; });
// unit price of one copy of an entry: the cheapest printing with the same treatment (the set is only a guess), or the entry's own printing when pinned
export function unit(e, foil = false) {
  const treat = cat.treatOf(e.sp);
  if (e.pin) { const r = printingRow(e); if (r != null) { const p = cat.price(r, cat.finishFor(foil, treat)); return p ? { cents: p.cents, live: p.live, row: r } : null; } }
  const p = cat.cheapest(e.name, { treat, foil }); return p ? { cents: p.cents, live: p.live, row: p.row } : null;
}
// { each, eachFoil, total, unpriced } in cents; unpriced = copies without a price
export function value(e) {
  const a = unit(e, false), b = unit(e, true), plain = e.qty - e.foil;
  const total = (a ? a.cents * plain : 0) + (b ? b.cents * e.foil : 0), unpriced = (a ? 0 : plain) + (b ? 0 : e.foil);
  return { each: a?.cents ?? null, eachFoil: b?.cents ?? null, total, unpriced, live: !!(a?.live || b?.live), rows: [a?.row, b?.row].filter((x) => x != null) };
}
export function collectionValue(list = entries()) {
  let cents = 0, copies = 0, unpriced = 0;
  for (const e of list) { const v = value(e); cents += v.total; unpriced += v.unpriced; copies += e.qty; }
  return { cents, copies, unpriced };
}
// the catalog rows whose prices matter for these entries (refreshPrices(rows) fetches their live prices)
export const priceRows = (list = entries()) => [...new Set(list.flatMap((e) => value(e).rows))];

// ---- value history (one snapshot per day, so a trend builds up as the site is used)
const HKEY = 'magiccv2.value.history';
export const valueHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };
export function recordValueSnapshot() {
  const { cents, copies } = collectionValue(); if (!copies) return;
  const h = valueHistory(), day = new Date().toISOString().slice(0, 10);
  if (h.length && h[h.length - 1][0] === day) h[h.length - 1] = [day, cents, copies]; else h.push([day, cents, copies]);
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(-400))); } catch { /* ignore */ }
}

// ---- CSV: the desktop scans.csv columns plus an optional foil column
export const CSV_COLS = [...db.COLS, 'foil'];
const q = (c) => (/[",\r\n]/.test(c) ? '"' + String(c).replaceAll('"', '""') + '"' : String(c));
export function exportCsv() { return [CSV_COLS, ...db.get().rows.map((r) => CSV_COLS.map((c) => (c === 'foil' ? (r.foil ? '1' : '') : r[c] || '')))].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'; }
export function importCsv(text, replace) {
  const [head, ...body] = db.parseCsv(text);
  if (!head || !head.includes('name')) throw new Error('This does not look like a scans.csv (no "name" column).');
  const ix = Object.fromEntries(head.map((h, i) => [h, i])), isFoil = (v) => /^(1|true|yes|foil|etched)$/i.test((v || '').trim());
  const rows = body.filter((r) => r[ix.name]).map((r) => { const o = Object.fromEntries(db.COLS.map((c) => [c, ix[c] === undefined ? '' : r[ix[c]] || ''])); if (ix.foil !== undefined && isFoil(r[ix.foil])) o.foil = '1'; return o; });
  const s = db.get(); s.rows = replace ? rows : s.rows.concat(rows); s.sample = false; db.save(); return rows.length;
}
