// Card catalog for the browser: names, printings, prices, images and metadata for all 118,774 indexed printings (row order = the card index).
// Files come from tools/export_web_data.py (web/data/). Prices: a snapshot (Scryfall bulk data) that can be refreshed live from the Scryfall API;
// Scryfall calls bulk prices "dangerously stale after 24 hours", so every price here carries its source: snapshot date or live time.
const DATA = new URL('../../web/data/', import.meta.url).href;
const LIVE_KEY = 'magiccv2.prices.live', LIVE_TTL = 24 * 3600 * 1000, NONE = 0xFFFFFFFF;
export const COLOR_NAMES = [['W', 'White', 1], ['U', 'Blue', 2], ['B', 'Black', 4], ['R', 'Red', 8], ['G', 'Green', 16]];
export const TYPE_NAMES = [['Creature', 1], ['Instant', 2], ['Sorcery', 4], ['Artifact', 8], ['Enchantment', 16], ['Planeswalker', 32], ['Land', 64], ['Battle', 128]];
export const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
const FINISH_IDX = { nonfoil: 0, foil: 1, etched: 2 };

let ready = null, C = null, live = {};
try { live = JSON.parse(localStorage.getItem(LIVE_KEY)) || {}; } catch { live = {}; }

export function loadCatalog(onProgress = () => {}) {
  return ready ??= (async () => {
    const get = async (f, type) => { onProgress(f); const r = await fetch(DATA + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}. Run tools/export_web_data.py`); return type === 'json' ? r.json() : r.arrayBuffer(); };
    const [cards, flags, ids, prices, meta, sets, pj] = await Promise.all([get('cards.json', 'json'), get('flags.u8.bin'), get('ids.bin'), get('prices.bin'), get('cardmeta.bin'), get('sets.json', 'json'), get('prices.json', 'json')]);
    const n = cards.name.length;
    C = { n, cards, flags: new Uint8Array(flags), ids: new Uint8Array(ids), prices: new Uint32Array(prices), meta: new Uint8Array(meta), sets, snapshot: pj, groups: new Map(), list: [] };
    for (let i = 0; i < n; i++) {                                 // printings of a card = its non-digital, front-face rows
      if (C.flags[i] & (1 | 16)) continue;
      const k = cards.name[i].toLowerCase(); let g = C.groups.get(k);
      if (!g) { g = { name: cards.name[i], lower: k, rows: [] }; C.groups.set(k, g); C.list.push(g); }
      g.rows.push(i);
    }
    for (const g of C.list) {                                     // newest printing first
      g.rows.sort((a, b) => rel(b) - rel(a) || (cards.set[a] < cards.set[b] ? -1 : 1) || cards.no[a].localeCompare(cards.no[b], undefined, { numeric: true }));
      const f = g.name.split(' // ')[0].toLowerCase(); if (f !== g.lower && !C.groups.has(f)) C.groups.set(f, g);   // "Delver of Secrets" finds the double-faced card
    }
    C.list.sort((a, b) => (a.lower < b.lower ? -1 : 1));
    return C;
  })();
}
const need = () => { if (!C) throw new Error('catalog not loaded'); return C; };
const rel = (row) => C.meta[row * 8 + 6] | (C.meta[row * 8 + 7] << 8);

export const uuid = (row) => { const b = need().ids.subarray(row * 16, row * 16 + 16); const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
// Card images: Scryfall's CDN (CORS enabled). Terms: show the image whole (no cropping, stretching or filters), no watermarks.
export const imageUrl = (row, size = 'small', face = 'front') => { const id = uuid(row); return `https://cards.scryfall.io/${size}/${face}/${id[0]}/${id[1]}/${id}.jpg`; };
export const setName = (code) => need().sets[code] || (code || '').toUpperCase();
export const rowInfo = (row) => { const c = need(); const m = c.meta, o = row * 8; return { row, name: c.cards.name[row], set: c.cards.set[row], setName: setName(c.cards.set[row]), no: c.cards.no[row], treat: c.cards.treat[row], sp: specialPrint(row), flags: c.flags[row] }; };
export function specialPrint(row) {                               // the label the scanner logs: treatments, plus 'promo' unless a regular/promo twin exists
  const c = need(), t = c.cards.treat[row] ? c.cards.treat[row].split(', ') : [], f = c.flags[row];
  if ((f & 8) && !(f & 2)) t.push('promo'); return t.join(', ');
}
export const treatOf = (sp) => (sp || '').split(', ').filter((x) => x && x !== 'promo').join(', ');   // a logged special_print back to the treatment label
export function meta(row) {
  const m = need().meta, o = row * 8, types = m[o + 2] | (m[o + 3] << 8), rel = m[o + 6] | (m[o + 7] << 8);
  return { cmc: m[o] === 255 ? null : m[o], colors: COLOR_NAMES.filter(([, , b]) => m[o + 1] & b).map(([l]) => l), types: TYPE_NAMES.filter(([, b]) => types & b).map(([t]) => t), legendary: !!(types & 256), token: !!(types & 512), basic: !!(types & 1024),
    rarity: RARITIES[m[o + 4]] || 'special', finishes: [['nonfoil', 1], ['foil', 2], ['etched', 4]].filter(([, b]) => m[o + 5] & b).map(([f]) => f), released: rel ? `${1990 + Math.floor(rel / 12)}-${String(rel % 12 + 1).padStart(2, '0')}` : '' };
}

// ---- finding cards
export function find(name) { const c = need(); return c.groups.get(String(name).toLowerCase()) || c.groups.get(String(name).split(' // ')[0].toLowerCase()) || null; }
export function printings(name) { return find(name)?.rows || []; }
export function search(q, limit = 40) {
  const c = need(), s = q.trim().toLowerCase(); if (!s) return [];
  const toks = s.split(/\s+/), out = [];
  for (const g of c.list) {
    const l = g.lower; let score = l.startsWith(s) ? 0 : l.includes(' ' + s) ? 1 : l.includes(s) ? 2 : toks.length > 1 && toks.every((t) => l.includes(t)) ? 3 : -1;
    if (score >= 0) out.push([score, l.length, g]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2]);
}

// ---- prices (cents or null)
export const finishFor = (foil, treat = '') => (/etched/.test(treat) ? 'etched' : foil ? 'foil' : 'nonfoil');
export function price(row, finish = 'nonfoil') {
  const c = need(), i = FINISH_IDX[finish], l = live[uuid(row)];
  if (l && Date.now() - l[3] < LIVE_TTL && l[i] != null && l[i] !== NONE) return { cents: l[i], live: true, at: l[3] };
  if (l && Date.now() - l[3] < LIVE_TTL && l[i] === NONE) return null;                   // the API said: no price for this finish
  const v = c.prices[row * 3 + i]; return v === NONE ? null : { cents: v, live: false, at: Date.parse(c.snapshot.updated_at) };
}
// the cheapest printing of a card (same treatment, so a borderless scan is not priced as a plain copy; the set is ignored: it is only a guess)
export function cheapest(name, { treat = '', foil = false } = {}) {
  const rows = printings(name); if (!rows.length) return null;
  const same = rows.filter((r) => need().cards.treat[r] === treat), pool = same.length ? same : rows, fin = finishFor(foil, treat);
  let best = null;
  for (const r of pool) { const p = price(r, fin); if (p && p.cents > 0 && (!best || p.cents < best.cents)) best = { row: r, ...p }; }
  return best;
}
export const fmt = (cents) => (cents == null ? '–' : `$${(cents / 100).toFixed(2)}`);
export const snapshotDate = () => need().snapshot.updated_at.slice(0, 10);
export const newestLive = () => Math.max(0, ...Object.values(live).map((v) => v[3]));

// Live refresh: POST /cards/collection (75 ids per request, at most ~8 requests a second as Scryfall asks). Returns how many cards were updated.
export async function refreshPrices(rows, onProgress = () => {}) {
  const ids = [...new Set(rows.map(uuid))]; let done = 0, updated = 0;
  for (let i = 0; i < ids.length; i += 75) {
    const batch = ids.slice(i, i + 75);
    const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) }) });
    if (!r.ok) throw new Error(r.status === 429 ? 'Scryfall asked us to slow down (HTTP 429). Try again in a minute.' : `Scryfall returned HTTP ${r.status}`);
    const j = await r.json(), t = Date.now();
    for (const card of j.data || []) { const p = card.prices || {}; const q = (v) => (v == null ? NONE : Math.round(parseFloat(v) * 100)); live[card.id] = [q(p.usd), q(p.usd_foil), q(p.usd_etched), t]; updated++; }
    done += batch.length; onProgress(done / ids.length);
    if (i + 75 < ids.length) await new Promise((res) => setTimeout(res, 130));
  }
  const cut = Date.now() - LIVE_TTL; for (const k of Object.keys(live)) if (live[k][3] < cut) delete live[k];
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch { /* storage full: live prices stay in memory */ }
  return updated;
}
