// The "database": scans and decks, kept in this browser's localStorage (starts empty).
// Rows use the same columns as the desktop scanner's scans.csv, so a scans.csv can be imported as is.
export const COLS = ['name', 'special_print', 'best_guess_set', 'collector_number', 'timestamp'];
const KEY = 'magiccv.db.1';
const listeners = new Set();

const seed = () => ({ rows: [], decks: {}, user: null, sample: false });

let state = load();
function load() {
  // a browser that still holds the old demo data (sample: true) starts empty instead
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.rows) && !d.sample) return d; } catch { /* fall through */ }
  return seed();
}
export const get = () => state;
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function save() { localStorage.setItem(KEY, JSON.stringify(state)); listeners.forEach((f) => f()); }
export function reset() { state = seed(); save(); }
export function clearAll() { state = { rows: [], decks: {}, user: state.user, sample: false }; save(); }

export const keyOf = (r) => [r.name, r.special_print || '', r.best_guess_set || '', r.collector_number || ''].join('\x1f');
export const norm = (n) => String(n).split(' // ')[0].trim().toLowerCase();
export function owned() { const m = {}; for (const r of state.rows) m[norm(r.name)] = (m[norm(r.name)] || 0) + 1; return m; }   // keys: norm(name)
export function freeDeckName(name) {
  const n = name.trim() || 'Imported deck'; let k = n, i = 2;
  while (state.decks[k]) k = `${n} (${i++})`;
  return k;
}
export function importDeck(name, cards) { state.decks[name] = { ...cards }; save(); }      // cards: {name: qty}
export function addScan(row) { state.rows.push({ ...row, timestamp: row.timestamp || new Date().toISOString().slice(0, 19) }); state.sample = false; save(); }
export function removeCopies(keys) {          // newest scan of each key
  let n = 0;
  for (const k of keys) for (let i = state.rows.length - 1; i >= 0; i--) if (keyOf(state.rows[i]) === k) { state.rows.splice(i, 1); n++; break; }
  if (n) save();
  return n;
}
export function stats() {
  const names = new Set(), sets = new Set(); let special = 0;
  for (const r of state.rows) { names.add(r.name); if (r.best_guess_set) sets.add(r.best_guess_set); if (r.special_print) special++; }
  return { total: state.rows.length, unique: names.size, sets: sets.size, special, decks: Object.keys(state.decks).length };
}

// ---- decks ----
export function newDeck(name) { name = name.trim(); if (!name || state.decks[name]) return false; state.decks[name] = {}; save(); return true; }
export function deleteDeck(name) { delete state.decks[name]; save(); }
export function bump(deck, card, by) { const d = state.decks[deck]; if (!d) return; d[card] = (d[card] || 0) + by; if (d[card] <= 0) delete d[card]; save(); }
export function deckText(deck) {      // "2 Name": Arena / MTGO import
  const d = state.decks[deck] || {};
  return Object.keys(d).sort((a, b) => a.localeCompare(b)).map((n) => `${d[n]} ${n.split(' // ')[0]}`).join('\n');
}

// ---- CSV (RFC 4180) ----
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false, any = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') { q = true; any = true; }
    else if (c === ',') { row.push(f); f = ''; any = true; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; if (any || f) { row.push(f); rows.push(row); } row = []; f = ''; any = false; }
    else { f += c; any = true; }
  }
  if (any || f) { row.push(f); rows.push(row); }
  return rows;
}
const csvCell = (c) => (/[",\r\n]/.test(c) ? '"' + String(c).replaceAll('"', '""') + '"' : String(c));
export function exportCsv() { return [COLS, ...state.rows.map((r) => COLS.map((c) => r[c] || ''))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
export function importCsv(text, replace) {
  const [head, ...body] = parseCsv(text);
  if (!head || !head.includes('name')) throw new Error('This does not look like a scans.csv (no "name" column).');
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const rows = body.filter((r) => r[idx.name]).map((r) => Object.fromEntries(COLS.map((c) => [c, idx[c] === undefined ? '' : r[idx[c]] || ''])));
  state.rows = replace ? rows : state.rows.concat(rows);
  state.sample = false;
  save();
  return rows.length;
}
export const exportJson = () => JSON.stringify(state, null, 1);
export function importJson(text) {
  const d = JSON.parse(text);
  if (!d || !Array.isArray(d.rows)) throw new Error('Not a MagicCV database file.');
  state = { rows: d.rows, decks: d.decks || {}, user: state.user, sample: false };
  save();
}
export function setUser(u) { state.user = u; save(); }
