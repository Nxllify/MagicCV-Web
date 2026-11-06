import * as db from '../store.js';
import { h, panel, toast, modal, download, dialog, pickFile } from '../ui.js';
import { parseDeckList } from '../decklist.js';

let current = null;   // selected deck name (survives re-renders)

export function decks(root) {
  const all = db.get().decks, names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  if (!all[current]) current = names[0] || null;
  const own = db.owned();
  const deck = current ? all[current] : {};
  const cardNames = Object.keys(deck).sort((a, b) => a.localeCompare(b));
  const need = cardNames.reduce((n, c) => n + deck[c], 0);
  const missing = cardNames.reduce((n, c) => n + Math.max(0, deck[c] - (own[db.norm(c)] || 0)), 0);

  async function create() {
    const v = await modal({ title: 'New deck', fields: [{ placeholder: 'Deck name' }], ok: 'Create' });
    if (!v) return;
    const name = v[0].trim(); current = name;
    if (!db.newDeck(name)) toast('Enter a name that is not used yet');
  }
  async function del() { if (await modal({ title: 'Delete deck', text: `Delete "${current}"? Your inventory is not affected.`, ok: 'Delete', danger: true })) db.deleteDeck(current); }
  async function addCard() {
    const v = await modal({ title: 'Add a card', text: 'Type the exact card name.', fields: [{ placeholder: 'Card name' }], ok: 'Add' });
    if (v && v[0].trim()) db.bump(current, v[0].trim(), 1);
  }

  async function importDialog() {
    const res = await dialog((close) => {
      const name = h('input', { type: 'text', placeholder: 'Deck name (optional)', style: 'width:100%' });
      const area = h('textarea', { rows: 13, placeholder: 'Paste a deck list here, for example:\n\n4 Lightning Bolt\n4 Goblin Guide\n1 Sol Ring (CMM) 400\n\nSideboard\n2 Smash to Smithereens', spellcheck: 'false' });
      const side = h('input', { type: 'checkbox' }), info = h('div', { class: 'hint', style: 'min-height:20px' });
      const go = h('button', { class: 'btn', disabled: true, onclick: () => close({ name: name.value, parsed: parseDeckList(area.value), side: side.checked }) }, 'Import');
      const upd = () => {
        const p = parseDeckList(area.value);
        go.disabled = !p.main && !(side.checked && (p.side || p.maybe));
        info.textContent = p.main || p.side || p.maybe ? `${p.main} cards (${p.uniqueMain} unique)` + (p.side ? `, sideboard ${p.side}` : '') + (p.maybe ? `, maybeboard ${p.maybe}` : '') + (p.bad.length ? `, ${p.bad.length} line(s) not understood` : '') : 'Nothing recognised yet.';
      };
      area.addEventListener('input', upd); side.addEventListener('change', upd);
      return h('div', { class: 'modal wide', role: 'dialog' }, h('h3', null, 'Import a deck'),
        h('p', null, 'Paste a list from Moxfield, Archidekt, MTG Arena or MTGO (use their Export / Copy as text). Quantities like 4 or 4x, set codes in brackets and foil marks are understood.'),
        h('div', { class: 'fields' }, name, area),
        h('div', { class: 'row', style: 'margin-bottom:6px' },
          h('button', { class: 'btn line sm', onclick: async () => { const t = await pickFile('.txt,.csv,.dec,.mwDeck,text/plain'); if (t != null) { area.value = t; upd(); } } }, 'Load a .txt file'),
          h('label', { class: 'chk' }, side, 'Also import the sideboard / maybeboard')),
        info,
        h('div', { class: 'hint', style: 'margin:8px 0 14px' }, 'A link to a Moxfield or Archidekt deck cannot be fetched from a web page (those sites block it), so copy the deck as text there and paste it here.'),
        h('div', { class: 'acts' }, h('button', { class: 'btn line', onclick: () => close(null) }, 'Cancel'), go));
    });
    if (!res) return;
    const cards = { ...res.parsed.zones.main };
    if (res.side) for (const z of ['side', 'maybe']) for (const [c, q] of Object.entries(res.parsed.zones[z])) cards[c] = (cards[z === 'side' ? c : c] || 0) + q;
    const total = Object.values(cards).reduce((a, b) => a + b, 0);
    current = db.freeDeckName(res.name);          // select it before the save redraws the page
    db.importDeck(current, cards);
    toast(`Imported ${total} cards into "${current}"`);
  }

  const list = panel('Decks', 'decks', h('div', null,
    h('div', { class: 'decklist' }, names.length ? names.map((n) => h('button', { class: 'deckbtn' + (n === current ? ' on' : ''), onclick: () => { current = n; db.save(); } },
      h('span', null, n), h('small', null, `${Object.values(all[n]).reduce((a, b) => a + b, 0)} cards`)))
      : h('div', { class: 'empty' }, 'No decks yet.')),
    h('div', { class: 'row', style: 'padding:0 12px 14px' }, h('button', { class: 'btn', onclick: create }, '+ New deck'), h('button', { class: 'btn green', onclick: importDialog }, 'Import'))));

  const rows = cardNames.map((c, i) => h('tr', { class: (own[db.norm(c)] || 0) < deck[c] ? 'miss' : (i % 2 ? 'alt' : '') },
    h('td', { class: 'need' }, h('span', { class: 'stepper' }, h('button', { onclick: () => db.bump(current, c, -1) }, '−'), h('b', null, deck[c]), h('button', { onclick: () => db.bump(current, c, 1) }, '+'))),
    h('td', { class: 'name' }, c),
    h('td', { class: 'own' }, (own[db.norm(c)] || 0) + ((own[db.norm(c)] || 0) < deck[c] ? `  (need ${deck[c] - (own[db.norm(c)] || 0)} more)` : ''))));

  const status = current ? h('span', { style: `color:${missing ? '#ff8f8c' : '#6fe08a'};font-size:15px` },
    `${need} cards` + (missing ? `  ·  ${missing} not in your inventory` : '  ·  all owned ✓')) : null;
  const right = panel(current || 'Deck', 'cards', current ? h('div', null,
    h('div', { class: 'row', style: 'padding:14px 16px' }, status, h('span', { style: 'flex:1' }),
      h('button', { class: 'btn line sm', onclick: () => db.deckText(current) && navigator.clipboard.writeText(db.deckText(current)).then(() => toast('Deck list copied (Arena / MTGO format)')) }, 'Copy list'),
      h('button', { class: 'btn line sm', onclick: () => download(current + '.txt', db.deckText(current)) }, 'Export .txt'),
      h('button', { class: 'btn sm', onclick: addCard }, 'Add card'),
      h('button', { class: 'btn danger sm', onclick: del }, 'Delete')),
    h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Need', 'Card', 'Owned'].map((t) => h('th', null, t)))), h('tbody', null, rows)),
      rows.length ? null : h('div', { class: 'empty' }, 'This deck is empty. Use Add card, or select cards in the Inventory tab and press Add to deck.')))
    : h('div', { class: 'empty' }, h('b', null, 'Create or import a deck to start.'), h('br'), 'Decks show which cards you already own (green) and which you still need (red).'));

  root.replaceChildren(h('div', { class: 'cols', style: 'grid-template-columns:320px minmax(0,1fr)' }, list, right));
  return {};
}
