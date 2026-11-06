// Export the collection for other tools. Each format turns collection.entries() into text; one entry gives up to two lines
// (non-foil copies and foil copies). Empty cells where we have no value: nothing is invented.
import * as cat from './catalog.js';
import * as col from './collection.js';
import { h, icon, toast, dialog, download, plural } from './ui.js';

const q = (c) => { c = String(c ?? ''); return /[",\r\n]/.test(c) ? '"' + c.replaceAll('"', '""') + '"' : c; };
const csv = (head, rows) => [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
const NOTE = 'Format from the tool\'s documentation and community guides, not tested against its importer; check the import preview.';

// the entry's printing (set name, rarity, Scryfall id) from the catalog; ids/rarity stay empty unless the exact set+number printing is found
function resolve(e) {
  const rows = cat.printings(e.name);
  const row = rows.find((r) => { const c = cat.rowInfo(r); return c.set === e.set && c.no === e.no; });
  const exact = row != null, r0 = exact ? row : rows[0];
  const info = r0 != null ? cat.rowInfo(r0) : null;
  const set = e.set || info?.set || '', no = e.no || info?.no || '';
  return {
    set, no, setName: exact ? info.setName : set ? cat.setName(set) : (info?.setName || ''),
    rarity: exact ? cat.meta(r0).rarity : '', id: exact ? cat.uuid(r0) : '',
    etched: /etched/.test(e.sp || '') || (exact && /etched/.test(info.treat || '')),
  };
}
// split an entry into lines: [{count, foil}]
const lines = (e) => [{ count: e.qty - e.foil, foil: false }, { count: e.foil, foil: true }].filter((l) => l.count > 0);
const flat = (entries, fn) => entries.flatMap((e) => { const p = resolve(e); return lines(e).map((l) => fn(e, p, l)); });

export const EXPORT_FORMATS = [
  { id: 'list', label: 'Plain list', ext: 'txt', description: 'One line per card: count, name, (SET) number, *F* for foil. Read by Moxfield, Archidekt and MTG Arena text importers.',
    caveat: NOTE + ' Set codes are uppercase; the importer may ignore them.',
    build: (en) => flat(en, (e, p, l) => `${l.count} ${e.name}${p.set ? ` (${p.set.toUpperCase()})` : ''}${p.no ? ` ${p.no}` : ''}${l.foil ? ' *F*' : ''}`).join('\r\n') + '\r\n' },
  { id: 'moxfield', label: 'Moxfield collection CSV', ext: 'csv', description: 'Collection import for Moxfield (Count, Name, Edition, Foil, Collector Number and more).',
    caveat: NOTE + ' Older Moxfield files use Count,Name,Edition,Condition,Language,Foil,Tag; the new header here is a superset. Condition is set to NM and language to English for every card (we do not know the real condition).',
    build: (en) => csv(['Count', 'Tradelist Count', 'Name', 'Edition', 'Condition', 'Language', 'Foil', 'Tags', 'Last Modified', 'Collector Number', 'Alter', 'Proxy', 'Purchase Price'],
      flat(en, (e, p, l) => [l.count, 0, e.name, p.set.toLowerCase(), 'NM', 'English', l.foil ? 'foil' : '', '', e.ts || '', p.no, '', '', ''])) },
  { id: 'deckbox', label: 'Deckbox CSV', ext: 'csv', description: 'Inventory import for Deckbox (uses edition names rather than set codes).',
    caveat: NOTE + ' Deckbox matches editions by name; a name it does not know may be skipped. Condition is set to Near Mint for every card.',
    build: (en) => csv(['Count', 'Tradelist Count', 'Name', 'Edition', 'Card Number', 'Condition', 'Language', 'Foil', 'Signed', 'Artist Proof', 'Altered Art', 'Misprint', 'Promo', 'Textless', 'My Price'],
      flat(en, (e, p, l) => [l.count, 0, e.name, p.setName, p.no, 'Near Mint', 'English', l.foil ? 'foil' : '', '', '', '', '', /promo/.test(e.sp || '') ? 'promo' : '', '', ''])) },
  { id: 'manabox', label: 'ManaBox CSV', ext: 'csv', description: 'Collection import for ManaBox. Archidekt can also read it by mapping Scryfall ID and Quantity.',
    caveat: NOTE + ' Scryfall ID and rarity are filled only when the exact set and number are in the catalog. Condition is set to near_mint for every card.',
    build: (en) => csv(['Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity', 'Quantity', 'ManaBox ID', 'Scryfall ID', 'Purchase price', 'Misprint', 'Altered', 'Condition', 'Language', 'Purchase price currency'],
      flat(en, (e, p, l) => [e.name, p.set.toLowerCase(), p.setName, p.no, l.foil ? (p.etched ? 'etched' : 'foil') : 'normal', p.rarity, l.count, '', p.id, '', 'false', 'false', 'near_mint', 'en', ''])) },
  { id: 'archidekt', label: 'Archidekt CSV', ext: 'csv', description: 'Collection import for Archidekt (Quantity, Name, Finish, Edition Code, Collector Number, Scryfall ID).',
    caveat: NOTE + ' Archidekt shows a column-mapping step on import: assign the columns there. Scryfall ID is filled only when the exact printing is in the catalog.',
    build: (en) => csv(['Quantity', 'Name', 'Finish', 'Edition Code', 'Collector Number', 'Scryfall ID'],
      flat(en, (e, p, l) => [l.count, e.name, l.foil ? (p.etched ? 'Etched' : 'Foil') : 'Normal', p.set.toLowerCase(), p.no, p.id])) },
  { id: 'magiccv', label: 'MagicCV scans.csv', ext: 'csv', description: 'The collection\'s own format, one row per copy with a foil column. Can be imported back into MagicCV.',
    caveat: 'Our own format, tested with the importer on this site. The desktop scanner ignores the foil column.',
    build: () => col.exportCsv() },
];

export async function buildExport(id) {
  await cat.loadCatalog();
  const f = EXPORT_FORMATS.find((x) => x.id === id) || EXPORT_FORMATS[0];
  const text = f.build(col.entries());
  return { text, filename: `magiccv-${f.id}.${f.ext}`, lines: text.split(/\r\n/).filter((l) => l).length - (f.ext === 'csv' ? 1 : 0), format: f };
}

export function openExportDialog() {
  return dialog((close) => {
    let cur = EXPORT_FORMATS[0], out = null, seq = 0;
    const preview = h('pre', { class: 'xp-preview mono', tabindex: '0', role: 'region', 'aria-label': 'Preview of the file (first lines)' }, 'Loading…');
    const count = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
    const caveat = h('p', { class: 'xp-caveat' });
    const dl = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => { download(out.filename, out.text, cur.ext === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8'); toast(`Downloaded ${out.filename}`); } }, icon('download'), 'Download file');
    const cp = h('button', { class: 'btn', type: 'button', disabled: true, onclick: async () => {
      try { await navigator.clipboard.writeText(out.text); toast('Copied to the clipboard'); } catch { toast('Could not copy: select the preview text instead'); } } }, icon('copy'), 'Copy');
    async function show() {
      const my = ++seq; caveat.textContent = cur.caveat; dl.disabled = cp.disabled = true; preview.textContent = 'Loading…';
      const r = await buildExport(cur.id); if (my !== seq) return;
      out = r;
      const ls = r.text.split(/\r\n/).filter((l) => l);
      preview.textContent = r.lines ? ls.slice(0, 6).join('\n') + (ls.length > 6 ? '\n…' : '') : (ls[0] || '') + '\n(no cards in the collection)';
      count.textContent = `${plural(r.lines, 'line')} (${plural(col.totalQty(), 'copy', 'copies')})${cur.ext === 'csv' ? ', plus the header row' : ''}. File: ${r.filename}`;
      dl.disabled = cp.disabled = !r.lines;
    }
    const radios = EXPORT_FORMATS.map((f, i) => h('label', { class: 'xp-opt' },
      h('input', { type: 'radio', name: 'xp-format', value: f.id, checked: i === 0, onchange: () => { cur = f; show(); } }),
      h('span', null, h('strong', null, f.label, ' ', h('span', { class: 'mono xp-ext' }, '.' + f.ext)), h('span', { class: 'hint' }, f.description))));
    show();
    return h('form', { onsubmit: (e) => e.preventDefault() },
      h('h2', null, 'Export collection'),
      h('fieldset', { class: 'xp-set' }, h('legend', { class: 'hint' }, 'File format'), radios),
      caveat,
      h('div', { class: 'xp-prev' }, h('span', { class: 'hint' }, 'Preview (first lines)'), preview), count,
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Close'), cp, dl));
  }, { wide: true, label: 'Export collection' });
}
