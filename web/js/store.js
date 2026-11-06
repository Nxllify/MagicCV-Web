// The "database": scans, decks, binders and lists, kept in this browser's localStorage (starts empty).
//   rows    one object per physical copy (scans.csv columns, plus optional foil / pin / binder)
//   decks   { deck: { card: qty } }  the main board; this shape is what the classic site and the parser use
//   deckx   { deck: { commander: {card: qty}, side: {...}, maybe: {...}, tags: {card: [tag]} } }  extra boards and card tags (web2)
//   binders [name]  folders for owned copies; a copy is in a binder when row.binder === name, otherwise it is "Unsorted"
//   lists   { list: { card: qty } }  cards you do not own (wishlist, buylist ...)
// Rows use the same columns as the desktop scanner's scans.csv, so a scans.csv can be imported as is.
export const COLS = ['name', 'special_print', 'best_guess_set', 'collector_number', 'timestamp'];
const KEY = 'magiccv.db.1';
const listeners = new Set();

const seed = () => ({ rows: [], decks: {}, deckx: {}, binders: [], lists: {}, user: null, sample: false });
const fill = (d) => { d.decks ||= {}; d.deckx ||= {}; d.binders ||= []; d.lists ||= {}; return d; };      // data saved by an older version has no deckx / binders / lists

let state = load();
function load() {
  // a browser that still holds the old demo data (sample: true) starts empty instead
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.rows) && !d.sample) return fill(d); } catch { /* fall through */ }
  return seed();
}
export const get = () => state;
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function save() { localStorage.setItem(KEY, JSON.stringify(state)); listeners.forEach((f) => f()); }
export function reset() { state = seed(); save(); }
export function clearAll() { state = { ...seed(), user: state.user }; save(); }

export const keyOf = (r) => [r.name, r.special_print || '', r.best_guess_set || '', r.collector_number || ''].join('\x1f');
export const norm = (n) => String(n).split(' // ')[0].trim().toLowerCase();
export function owned() { const m = {}; for (const r of state.rows) m[norm(r.name)] = (m[norm(r.name)] || 0) + 1; return m; }   // keys: norm(name)
export function freeDeckName(name) {
  const n = name.trim() || 'Imported deck'; let k = n, i = 2;
  while (state.decks[k]) k = `${n} (${i++})`;
  return k;
}
export function importDeck(name, cards, extra) {      // cards: {name: qty} (main board); extra: { commander, side, maybe, tags } (all optional)
  state.decks[name] = { ...cards };
  if (extra) {
    const x = {};
    for (const b of ['commander', 'side', 'maybe']) if (extra[b] && Object.keys(extra[b]).length) x[b] = { ...extra[b] };
    if (extra.tags && Object.keys(extra.tags).length) x.tags = Object.fromEntries(Object.entries(extra.tags).map(([c, t]) => [c, [...t]]));
    if (Object.keys(x).length) state.deckx[name] = x; else delete state.deckx[name];
  }
  save();
}
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
export function deleteDeck(name) { delete state.decks[name]; delete state.deckx[name]; save(); }
export function bump(deck, card, by) { const d = state.decks[deck]; if (!d) return; d[card] = (d[card] || 0) + by; if (d[card] <= 0) delete d[card]; save(); }
const lines = (d) => Object.keys(d).sort((a, b) => a.localeCompare(b)).map((n) => `${d[n]} ${n.split(' // ')[0]}`).join('\n');
export function deckText(deck) {      // "2 Name": Arena / MTGO import. With a commander or sideboard it gets the Arena headers.
  const d = state.decks[deck] || {}, x = state.deckx[deck] || {};
  if (!Object.keys(x.commander || {}).length && !Object.keys(x.side || {}).length) return lines(d);
  return [['Commander', x.commander], ['Deck', d], ['Sideboard', x.side]].filter(([, b]) => b && Object.keys(b).length).map(([t, b]) => `${t}\n${lines(b)}`).join('\n\n');
}

// ---- deck boards (web2): main = decks[deck]; commander / side / maybe live in deckx[deck]
export const BOARDS = [['main', 'Main deck'], ['commander', 'Commander'], ['side', 'Sideboard'], ['maybe', 'Maybeboard']];
export function board(deck, name) {      // the {card: qty} object of a board; {} (not stored) when it does not exist yet
  if (name === 'main') return state.decks[deck] || {};
  return (state.deckx[deck] || {})[name] || {};
}
function ensureBoard(deck, name) {
  if (name === 'main') return state.decks[deck];
  const x = (state.deckx[deck] ||= {}); return (x[name] ||= {});
}
export function bumpBoard(deck, name, card, by) {
  if (!state.decks[deck]) return;
  const b = ensureBoard(deck, name); b[card] = (b[card] || 0) + by; if (b[card] <= 0) delete b[card];
  tidyDeck(deck); save();
}
export function moveCard(deck, card, from, to, qty = 1) {      // move qty copies of a card between boards of one deck
  if (!state.decks[deck] || from === to) return;
  const src = ensureBoard(deck, from), n = Math.min(qty, src[card] || 0); if (n <= 0) return;
  src[card] -= n; if (src[card] <= 0) delete src[card];
  const dst = ensureBoard(deck, to); dst[card] = (dst[card] || 0) + n;
  tidyDeck(deck); save();
}
export function setTags(deck, card, tags) {
  if (!state.decks[deck]) return;
  const t = [...new Set(tags.map((x) => x.trim()).filter(Boolean))];
  const x = (state.deckx[deck] ||= {}); x.tags ||= {};
  if (t.length) x.tags[card] = t; else delete x.tags[card];
  tidyDeck(deck); save();
}
export const tagsOf = (deck, card) => ((state.deckx[deck] || {}).tags || {})[card] || [];
export function deckTagList(deck) {      // every tag used in a deck, most used first
  const m = new Map(); for (const t of Object.values((state.deckx[deck] || {}).tags || {})) for (const k of t) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}
function tidyDeck(deck) {      // drop empty boards and tags of cards that left the deck, so deckx stays small
  const x = state.deckx[deck]; if (!x) return;
  for (const b of ['commander', 'side', 'maybe']) if (x[b] && !Object.keys(x[b]).length) delete x[b];
  if (x.tags) {
    for (const c of Object.keys(x.tags)) if (!['main', 'commander', 'side', 'maybe'].some((b) => (b === 'main' ? state.decks[deck] : x[b] || {})[c])) delete x.tags[c];
    if (!Object.keys(x.tags).length) delete x.tags;
  }
  if (!Object.keys(x).length) delete state.deckx[deck];
}
// every card the deck uses and how many (main + commander + sideboard; the maybeboard is only an idea pile)
export function deckNeeds(deck) {
  const m = {}; for (const b of ['main', 'commander', 'side']) for (const [c, q] of Object.entries(board(deck, b))) m[c] = (m[c] || 0) + q;
  return m;
}

// ---- binders: folders for owned copies (row.binder). Unsorted = no binder.
export const binderOf = (r) => (r.binder && state.binders.includes(r.binder) ? r.binder : '');
export function addBinder(name) {
  name = name.trim(); if (!name || state.binders.some((b) => b.toLowerCase() === name.toLowerCase())) return false;
  state.binders.push(name); save(); return true;
}
export function renameBinder(old, name) {
  name = name.trim(); if (!name || !state.binders.includes(old)) return false;
  if (name !== old && state.binders.some((b) => b.toLowerCase() === name.toLowerCase())) return false;
  state.binders[state.binders.indexOf(old)] = name; for (const r of state.rows) if (r.binder === old) r.binder = name; save(); return true;
}
export function deleteBinder(name) {      // the copies are kept, they just become Unsorted
  state.binders = state.binders.filter((b) => b !== name); for (const r of state.rows) if (r.binder === name) delete r.binder; save();
}
export function moveRows(rows, binder) {      // rows: real database rows; '' = Unsorted
  if (binder && !state.binders.includes(binder)) state.binders.push(binder);
  for (const r of rows) { if (binder) r.binder = binder; else delete r.binder; }
  save();
}
export function binderCounts() {      // { '': unsorted copies, binderName: copies }
  const m = { '': 0 }; for (const b of state.binders) m[b] = 0;
  for (const r of state.rows) m[binderOf(r)]++;
  return m;
}

// ---- lists: cards you want but do not own (wishlist, buylist ...)
export function newList(name) { name = name.trim(); if (!name || state.lists[name]) return false; state.lists[name] = {}; save(); return true; }
export function deleteList(name) { delete state.lists[name]; save(); }
export function renameList(old, name) {
  name = name.trim(); if (!name || !state.lists[old] || (name !== old && state.lists[name])) return false;
  const next = {}; for (const k of Object.keys(state.lists)) next[k === old ? name : k] = state.lists[k]; state.lists = next; save(); return true;
}
export function bumpList(list, card, by) { const l = state.lists[list]; if (!l) return; l[card] = (l[card] || 0) + by; if (l[card] <= 0) delete l[card]; save(); }
export function addToList(list, cards) { const l = state.lists[list]; if (!l) return; for (const [c, q] of Object.entries(cards)) if (q > 0) l[c] = (l[c] || 0) + q; save(); }
export function listText(list) { return lines(state.lists[list] || {}); }

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
  state = fill({ rows: d.rows, decks: d.decks || {}, deckx: d.deckx || {}, binders: d.binders || [], lists: d.lists || {}, user: state.user, sample: false });
  for (const r of state.rows) if (r.binder && !state.binders.includes(r.binder)) state.binders.push(r.binder);      // a copy never points at a binder that does not exist
  save();
}
export function setUser(u) { state.user = u; save(); }
