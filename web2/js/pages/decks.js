import * as db from '../../../web/js/store.js';
import { parseDeckList } from '../../../web/js/decklist.js';          // same parser as the classic site
import { h, icon, toast, dialog, confirmDialog, promptDialog, download, pickFile, plural } from '../ui.js';
import * as cat from '../catalog.js';
import * as col from '../collection.js';
import { SIZES, newDeckDialog } from '../newdeck.js';
import { computeStats, renderStats, TYPE_ORDER, COLOR_ORDER } from '../deckstats.js';

let current = null;   // selected deck (survives re-renders)
const VKEY = 'magiccv2.deck.view';      // the switches survive reloads
const saved = (() => { try { return JSON.parse(localStorage.getItem(VKEY)) || {}; } catch { return {}; } })();
const view = { tab: 'decks', sub: 'cards', mode: 'sum', only: true, q: '', board: 'main', group: 'type', tag: '', addCat: '', collapsed: new Set(),
  select: false, sel: new Set(), highlight: saved.highlight !== false, thumbs: saved.thumbs !== false, large: !!saved.large };
const keepView = () => { try { localStorage.setItem(VKEY, JSON.stringify({ highlight: view.highlight, thumbs: view.thumbs, large: view.large })); } catch { /* not remembered */ } };
let lvTimer = 0;   // tab state survives data refreshes
let catReady = false;  // once loaded the catalog stays, so later redraws are instant
const BOARD_NAME = Object.fromEntries(db.BOARDS);
// categories to pick from in one click (any other name works too). A card can have several; a deck lists them as groups, in every board.
const PRESET_CATS = ['Ramp', 'Card Draw', 'Removal', 'Board Wipe', 'Counterspell', 'Tutor', 'Protection', 'Recursion', 'Finisher', 'Combo', 'Mana Fixing', 'Utility'];
let refocusAdd = false;      // after adding a card the page redraws, so the add box gets the focus back

export function decks(root) {
  const all = db.get().decks, names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  if (!all[current]) current = names[0] || null;
  const own = db.owned(), deck = current ? all[current] : {};
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const have = (c) => own[db.norm(c)] || 0;
  // boards: main deck (the commander is one of its cards), sideboard and maybeboard. What you need to own: main deck + sideboard.
  const needs = current ? db.deckNeeds(current) : {};
  const need = total(needs), missing = Object.keys(needs).reduce((n, c) => n + Math.max(0, needs[c] - have(c)), 0);
  const playing = () => deck;      // the statistics cover the main deck (commander included)
  const select = (n) => { current = n; view.board = 'main'; view.tag = ''; view.sel.clear(); db.save(); };

  async function create() {
    const res = await newDeckDialog();
    if (!res) return;
    current = res.name; view.board = 'main'; view.tag = '';
    if (!db.newDeck(res.name, res.size)) toast('A deck with that name already exists');
  }
  async function del() { if (await confirmDialog({ title: 'Delete deck', text: `Delete "${current}"? Your inventory is not affected.`, ok: 'Delete', danger: true })) db.deleteDeck(current); }
  // ---- card search used to add cards: type part of a name, click a result (or press Enter for the best match). float = dropdown under the box.
  function searchBox({ label, onPick, float = true }) {
    const results = h('div', { class: 'results' + (float ? ' la-results' : ''), role: 'listbox', 'aria-label': 'Matching cards', hidden: true });
    const best = (q) => { const hits = cat.search(q, 8); return hits.find((g) => g.lower === q.trim().toLowerCase()) || hits[0]; };
    const input = h('input', { class: 'input', type: 'search', placeholder: catReady ? label : 'Loading card data…', 'aria-label': label, autocomplete: 'off', disabled: !catReady,
      oninput: () => fill(), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const g = input.value.trim() && best(input.value); if (g) pick(g); } else if (e.key === 'Escape') { input.value = ''; fill(); } } });
    function pick(g) { input.value = ''; fill(); onPick(g.name); }
    function fill() {
      const hits = input.value.trim() ? cat.search(input.value, 8) : [];
      results.hidden = !hits.length;
      results.replaceChildren(...hits.map((g) => {
        const min = Math.min(...g.rows.map((r) => cat.price(r, 'nonfoil')?.cents ?? Infinity));
        return h('button', { class: 'hit', type: 'button', role: 'option', onclick: () => pick(g) },
          h('img', { src: cat.imageUrl(g.rows[0], 'small'), alt: '', width: 40, height: 56, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }),
          h('span', { class: 'hn' }, h('b', null, g.name), h('small', null, plural(g.rows.length, 'printing'))), h('span', { class: 'mono hp' }, Number.isFinite(min) ? 'from ' + cat.fmt(min) : '–'), icon('plus'));
      }));
    }
    return { el: h('div', { class: 'la-add' }, h('label', { class: 'search' }, h('span', { class: 'sr' }, label), icon('search'), input), results), input };
  }
  function addToBoard(name) {      // one more copy on the open board, with the category chosen next to the search box
    refocusAdd = true; db.bumpBoard(current, view.board, name, 1);
    if (view.addCat) db.setTags(current, name, [...db.tagsOf(current, name), view.addCat]);
    toast(`Added ${name} to the ${BOARD_NAME[view.board].toLowerCase()}${view.addCat ? ` (${view.addCat})` : ''}`);
  }
  // a commander is a card of the main deck marked with a crown; a second one (partners) is allowed
  async function addCommander() {
    const cur = db.commandersOf(current); if (cur.length >= 2) { toast('A deck has at most two commanders'); return; }
    const name = await dialog((close) => {
      const sb = searchBox({ label: 'Search for a commander', onPick: close, float: false });
      queueMicrotask(() => sb.input.focus());
      return h('div', null, h('h2', null, cur.length ? 'Add a second commander' : 'Add a commander'),
        h('p', null, cur.length ? `Partner, Friends forever or a Background: it joins ${cur[0]} at the top of the main deck.` : 'It goes into the main deck and is listed at the top with a crown.'),
        sb.el, h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel')));
    }, { label: 'Add a commander' });
    if (!name) return;
    if (!db.board(current, 'main')[name]) db.bumpBoard(current, 'main', name, 1);
    if (db.setCommander(current, name, true)) toast(`${name} is now a commander`); else toast('Could not set the commander');
  }
  function toggleCommander(card) {
    const on = db.commandersOf(current).includes(card);
    if (!db.setCommander(current, card, !on)) { toast('A deck has at most two commanders'); return; }
    if (!on && db.deckSize(current) !== 100) { db.setDeckSize(current, 100); toast(`${card} is now a commander; deck size set to 100`); }
  }

  // ---- small dialogs used by the card menu
  async function pickListDialog(title, text, ok) {
    const lnames = Object.keys(db.get().lists).sort((a, b) => a.localeCompare(b));
    const res = await dialog((close) => {
      const sel = h('select', { class: 'input', autofocus: true }, lnames.map((n) => h('option', { value: n }, n)), h('option', { value: '\0new' }, '+ New list…'));
      const nm = h('input', { class: 'input', placeholder: 'New list name', value: lnames.length ? '' : 'Wishlist', hidden: !!lnames.length, autocomplete: 'off' });
      sel.onchange = () => { nm.hidden = sel.value !== '\0new'; if (!nm.hidden) nm.focus(); }; if (!lnames.length) sel.value = '\0new';
      return h('form', { onsubmit: (e) => { e.preventDefault(); const nw = sel.value === '\0new', v = nw ? nm.value.trim() : sel.value; if (v) close({ list: v }); } },
        h('h2', null, title), h('p', null, text), h('label', { class: 'field' }, h('span', null, 'List'), sel), nm,
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, ok)));
    }, { label: title });
    return res;
  }
  async function numberDialog(title, text, ok, value = 1) {
    return dialog((close) => {
      const n = h('input', { class: 'input', type: 'number', min: 1, max: 99, value, autofocus: true, required: true, 'aria-label': 'How many' });
      return h('form', { onsubmit: (e) => { e.preventDefault(); const v = Math.max(1, Math.min(99, Math.floor(+n.value) || 0)); if (v) close(v); } }, h('h2', null, title), text ? h('p', null, text) : null, h('label', { class: 'field' }, h('span', null, 'How many'), n),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, ok)));
    }, { label: title });
  }
  const chosenRow = (card) => {      // the printing picked for a card in this deck, else the newest one
    const g = cat.find(card); if (!g) return null; const pr = db.printOf(current, card);
    return (pr && g.rows.find((r) => { const c = cat.rowInfo(r); return c.set === pr.set && c.no === pr.no; })) ?? g.rows[0];
  };
  async function switchPrinting(card) {
    if (!catReady) { toast('Card data is still loading'); return; }
    const rows = cat.printings(card), cur = db.printOf(current, card);
    if (!rows.length) { toast('No printings found for this card'); return; }
    const res = await dialog((close) => h('div', { class: 'rv' }, h('h2', null, `Printings of ${card}`),
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, 'The printing you pick is the picture shown in this deck. Prices elsewhere still use the cheapest printing.'),
      h('div', { class: 'tablewrap rv-wrap' }, h('table', null, h('caption', { class: 'sr' }, `Printings of ${card}`),
        h('thead', null, h('tr', null, h('th', null, 'Printing'), h('th', null, 'Treatment'), h('th', { class: 'num' }, 'Price'), h('th', null, h('span', { class: 'sr' }, 'Choose')))),
        h('tbody', null, rows.map((r) => {
          const c = cat.rowInfo(r), p = cat.price(r, 'nonfoil'), isCur = cur && cur.set === c.set && cur.no === c.no;
          return h('tr', { class: isCur ? 'cur' : '' }, h('td', { class: 'pr' }, h('img', { src: cat.imageUrl(r, 'small'), alt: '', width: 32, height: 44, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }),
            h('span', null, h('b', null, c.setName), h('small', { class: 'mono' }, `${c.set.toUpperCase()} ${c.no} · ${cat.meta(r).released.slice(0, 4)}`))),
            h('td', null, c.sp ? c.sp.split(', ').map((t) => h('span', { class: 'chip c', style: 'margin:0 4px 4px 0' }, t)) : h('span', { class: 'mut' }, 'regular')),
            h('td', { class: 'num mono' }, p ? cat.fmt(p.cents) : '–'),
            h('td', { class: 'acts' }, isCur ? h('span', { class: 'chip a' }, 'in use') : h('button', { class: 'btn sm', type: 'button', onclick: () => close({ set: c.set, no: c.no }) }, 'Use this printing')));
        })))),
      h('div', { class: 'acts' }, cur ? h('button', { class: 'btn', type: 'button', onclick: () => close({ set: '', no: '' }) }, 'Back to the newest printing') : null, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Close'))), { wide: true, label: `Printings of ${card}` });
    if (res) { db.setPrint(current, card, res.set, res.no); toast(res.set ? `${card}: ${res.set.toUpperCase()} ${res.no}` : `${card}: newest printing`); }
  }
  async function addToAnotherDeck(card) {
    const others = Object.keys(db.get().decks).filter((n) => n !== current).sort((a, b) => a.localeCompare(b));
    if (!others.length) { toast('You have no other deck yet'); return; }
    const res = await dialog((close) => {
      const deckSel = h('select', { class: 'input', autofocus: true }, others.map((n) => h('option', { value: n }, n)));
      const boardSel = h('select', { class: 'input' }, db.BOARDS.map(([b, n]) => h('option', { value: b, selected: b === view.board }, n)));
      const qty = h('input', { class: 'input', type: 'number', min: 1, max: 99, value: 1, 'aria-label': 'How many' });
      return h('form', { onsubmit: (e) => { e.preventDefault(); close({ deck: deckSel.value, board: boardSel.value, qty: Math.max(1, Math.min(99, Math.floor(+qty.value) || 1)) }); } },
        h('h2', null, `Add ${card} to another deck`), h('label', { class: 'field' }, h('span', null, 'Deck'), deckSel), h('label', { class: 'field' }, h('span', null, 'Board'), boardSel), h('label', { class: 'field' }, h('span', null, 'How many'), qty),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add')));
    }, { label: 'Add to another deck' });
    if (res) { db.bumpBoard(res.deck, res.board, card, res.qty); toast(`Added ${res.qty} ${card} to ${res.deck}`); }
  }
  async function addToCollection(card) {
    const bnames = db.get().binders;
    const res = await dialog((close) => {
      const sel = h('select', { class: 'input', autofocus: true }, h('option', { value: '' }, 'Unsorted (no binder)'), bnames.map((b) => h('option', { value: b }, b)), h('option', { value: '\0new' }, '+ New binder…'));
      const nm = h('input', { class: 'input', placeholder: 'New binder name', hidden: true, autocomplete: 'off' });
      sel.onchange = () => { nm.hidden = sel.value !== '\0new'; if (!nm.hidden) nm.focus(); };
      return h('form', { onsubmit: (e) => { e.preventDefault(); const nw = sel.value === '\0new', v = nw ? nm.value.trim() : sel.value; if (nw && !v) return; close({ binder: v }); } },
        h('h2', null, `Add ${card} to your collection`), h('p', null, 'Adds one copy to your inventory. Use this for a card you own.'),
        h('label', { class: 'field' }, h('span', null, 'Put it in'), sel), nm,
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add to inventory')));
    }, { label: 'Add to collection' });
    if (!res) return;
    const r = catReady ? chosenRow(card) : null, i = r != null ? cat.rowInfo(r) : null;
    col.addEntries([{ name: card, sp: i?.sp || '', set: i?.set || '', no: i?.no || '', qty: 1, foil: 0 }], { binder: res.binder || undefined }); toast(`Added ${card} to ${res.binder || 'your inventory'}`);
  }
  async function addToWishList(card) {
    const res = await pickListDialog(`Add ${card} to a list`, 'It is added to the list you choose (a wishlist or buylist).', 'Add'); if (!res) return;
    db.newList(res.list); db.addToList(res.list, { [card]: 1 }); toast(`Added ${card} to ${res.list}`);
  }
  async function bulkCategory(cards) {
    const used = db.deckTagList(current), sugg = PRESET_CATS.filter((t) => !used.includes(t));
    const res = await dialog((close) => {
      const input = h('input', { class: 'input', placeholder: 'Ramp, Removal', autocomplete: 'off', autofocus: true, 'aria-label': 'Categories' });
      const add = (t) => { const cur = input.value.split(',').map((x) => x.trim()).filter(Boolean); if (!cur.some((x) => x.toLowerCase() === t.toLowerCase())) cur.push(t); input.value = cur.join(', '); input.focus(); };
      const chips = (title, list) => list.length ? h('div', { class: 'tagchips', style: 'margin:8px 0' }, h('span', { class: 'hint' }, title), list.map((t) => h('button', { type: 'button', class: 'tagchip c-' + db.tagColor(t), onclick: () => add(t) }, t))) : null;
      return h('form', { onsubmit: (e) => { e.preventDefault(); const t = input.value.split(',').map((x) => x.trim()).filter(Boolean); if (t.length) close({ tags: t }); } },
        h('h2', null, `Add categories to ${plural(cards.length, 'card')}`), h('p', null, 'The categories are added to what each card already has. Separate several with commas.'),
        h('label', { class: 'field' }, h('span', null, 'Categories'), input), chips('In this deck:', used), chips('Suggestions:', sugg),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add')));
    }, { label: 'Add categories' });
    if (res) { view.sel.clear(); db.addTags(current, cards, res.tags); toast(`Added ${res.tags.join(', ')} to ${plural(cards.length, 'card')}`); }
  }

  // ---- the "..." menu of a row (like Moxfield's card menu): two columns of grouped actions
  function openCardMenu(anchor, card) {
    document.querySelector('.cardmenu')?.remove();
    const onMain = view.board === 'main', cmdOn = db.commandersOf(current).includes(card), enc = encodeURIComponent(card);
    const done = (fn) => () => { close(false); fn(); };
    const item = (label, fn, o = {}) => h('button', { type: 'button', role: 'menuitem', class: o.danger ? 'danger' : '', onclick: done(fn) }, label);
    const link = (label, href) => h('a', { role: 'menuitem', href, target: '_blank', rel: 'noopener noreferrer', onclick: () => close(false) }, label);
    const group = (...kids) => { const k = kids.filter(Boolean); return k.length ? h('div', { class: 'mg' }, k) : null; };
    const move = db.BOARDS.filter(([b]) => b !== view.board).map(([b, n]) => item(`Move to ${n}`, () => db.moveCards(current, [card], view.board, b)));
    const left = h('div', { class: 'mcol' },
      group(item('Select this card', () => { view.select = true; view.sel.add(card); draw(); }), item('Switch printing…', () => switchPrinting(card))),
      group(item('Add one', () => db.bumpBoard(current, view.board, card, 1)), item('Add more…', async () => { const n = await numberDialog(`Add more ${card}`, `How many more copies go on the ${BOARD_NAME[view.board].toLowerCase()}?`, 'Add', 4); if (n) db.bumpBoard(current, view.board, card, n); }),
        item('Remove', () => db.removeCards(current, view.board, [card]), { danger: true })),
      group(...move, item('Add to another deck…', () => addToAnotherDeck(card)), item('Add to collection…', () => addToCollection(card)), item('Add to wish list…', () => addToWishList(card))));
    const right = h('div', { class: 'mcol' },
      group(item('Change categories…', () => editTags(card)), onMain ? item(cmdOn ? 'Remove as commander' : 'Make commander', () => toggleCommander(card)) : null),
      group(item('View details', () => { location.hash = '#/?card=' + enc; }), item('Copy card name', () => navigator.clipboard.writeText(card).then(() => toast('Card name copied'), () => toast('Could not copy')))),
      group(link('Buy on TCGplayer', `https://www.tcgplayer.com/search/magic/product?q=${enc}&view=grid`), link('Buy on Card Kingdom', `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${enc}`)));
    const m = h('div', { class: 'cardmenu', role: 'menu', 'aria-label': `Actions for ${card}` }, left, right);
    const away = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) close(false); };
    const key = (e) => {
      const items = [...m.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') close(); else if (e.key === 'Tab') close(false);
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    };
    function close(refocus = true) { m.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); window.removeEventListener('resize', shut); window.removeEventListener('scroll', shut, true); if (refocus) anchor.focus(); }
    const shut = () => close(false);
    document.body.append(m); anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect(), w = m.offsetWidth, hgt = m.offsetHeight;      // open under the button, or above it when there is no room
    m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, r.bottom + 4 + hgt > innerHeight - 8 ? r.top - hgt - 4 : r.bottom + 4) + 'px';
    m.querySelector('[role=menuitem]').focus();
    setTimeout(() => { document.addEventListener('pointerdown', away); document.addEventListener('keydown', key); window.addEventListener('resize', shut); window.addEventListener('scroll', shut, true); }, 0);
  }
  async function importDialog(target) {
    const res = await dialog((close) => {
      const name = h('input', { class: 'input', placeholder: 'Deck name (optional)', autocomplete: 'off' });   // not used when importing into an existing deck
      const area = h('textarea', { class: 'input', placeholder: 'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n4 Lightning Bolt\n1 Sol Ring (CMM) 400 [Ramp]\n\nSideboard\n2 Smash to Smithereens', spellcheck: 'false', 'aria-label': 'Deck list' });
      const info = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' }, 'Paste a list to see what is recognised.');
      const go = h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Import');
      const upd = () => {
        const p = parseDeckList(area.value), cmd = total(p.commander), tagged = Object.keys(p.tags).length; go.disabled = !(p.main || p.side || p.maybe);
        info.textContent = p.main || p.side || p.maybe ? `${p.main} main deck` + (cmd ? ` (${cmd} commander${cmd > 1 ? 's' : ''})` : '') + (p.side ? `, ${p.side} sideboard` : '') + (p.maybe ? `, ${p.maybe} maybeboard` : '') + (tagged ? `, ${plural(tagged, 'card')} with tags` : '') + (p.bad.length ? `, ${plural(p.bad.length, 'line')} not understood` : '') : 'Nothing recognised yet.';
      };
      area.addEventListener('input', upd);
      return h('form', { onsubmit: (e) => { e.preventDefault(); close({ name: name.value, parsed: parseDeckList(area.value) }); } },
        h('h2', null, target ? `Import cards into ${target}` : 'Import a deck'),
        h('p', null, 'Paste a list from Moxfield, Archidekt, MTG Arena or MTGO (use their Export or Copy as text). Quantities like 4 or 4x, set codes and foil marks are understood. A Commander section marks the commander (it stays in the main deck); Sideboard and Maybeboard go to their own boards; categories like [Ramp] or #Ramp become categories.'),
        target ? null : h('label', { class: 'field' }, h('span', null, 'Name'), name), h('label', { class: 'field' }, h('span', null, 'Deck list'), area),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => { const t = await pickFile('.txt,.csv,.dec,text/plain'); if (t != null) { area.value = t; upd(); } } }, icon('upload'), 'Load a .txt file')),
        info, h('p', { class: 'hint' }, 'A link to a Moxfield or Archidekt deck cannot be fetched from a web page (those sites block it). Copy the deck as text there and paste it here.'),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), go));
    }, { wide: true, label: target ? `Import cards into ${target}` : 'Import a deck' });
    if (!res) return;
    const z = res.parsed.zones, cmdNames = Object.keys(res.parsed.commander).slice(0, 2), main = z.main, count = total(main) + total(z.side) + total(z.maybe);
    if (target) {            // merge into the open deck, then offer to add the same cards to the inventory
      for (const [b, o] of Object.entries({ main, side: z.side, maybe: z.maybe })) for (const [c, q] of Object.entries(o)) db.bumpBoard(target, b, c, q);
      for (const c of cmdNames) db.setCommander(target, c, true);
      for (const [c, t] of Object.entries(res.parsed.tags)) db.setTags(target, c, [...db.tagsOf(target, c), ...t]);
      toast(`Imported ${plural(count, 'card')} into "${target}"`);
      const want = {}; for (const o of [main, z.side]) for (const [c, q] of Object.entries(o)) want[c] = (want[c] || 0) + q;
      await offerInventory(want); return;
    }
    const size = cmdNames.length || total(main) >= 90 ? 100 : total(main) <= 45 ? 40 : 60;      // a guess from the list: the size can be changed in the deck
    current = db.freeDeckName(res.name); view.board = 'main'; view.tag = '';      // select it before the save redraws the page
    db.importDeck(current, main, { cmd: cmdNames, size, side: z.side, maybe: z.maybe, tags: res.parsed.tags }); toast(`Imported ${plural(count, 'card')} into "${current}"`);
  }
  // after importing cards into a deck: ask, then show the cards with an Owned checkbox so the user chooses what goes into the inventory
  async function offerInventory(cards) {
    const names = Object.keys(cards); if (!names.length) return;
    const yes = await dialog((close) => h('form', { onsubmit: (e) => { e.preventDefault(); close('yes'); } },
      h('h2', null, 'Add these cards to your inventory too?'), h('p', null, `${plural(names.length, 'card')} were added to the deck. If you own some of them, you can add them to your inventory as well.`),
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'No, deck only'), h('button', { class: 'btn primary', type: 'submit' }, 'Yes, choose cards'))), { label: 'Add to inventory too' });
    if (!yes) return;
    try { await cat.loadCatalog(); } catch { /* no images or prices */ }
    const owned = new Set(); const boxes = new Map();
    const picked = await dialog((close) => {
      const sum = h('span', { class: 'hint', 'aria-live': 'polite' });
      const upd = () => { sum.textContent = `${plural(owned.size, 'card')} marked as owned`; };
      const allBox = h('input', { type: 'checkbox', 'aria-label': 'Owned: select all', onchange: (e) => setAll(e.target.checked) });
      const setAll = (on) => { for (const [n, b] of boxes) { b.checked = on; on ? owned.add(n) : owned.delete(n); } allBox.checked = on; upd(); };
      const rows = names.map((n) => {
        const g = cat.find?.(n), r = g?.rows?.[0];
        const b = h('input', { type: 'checkbox', 'aria-label': `Owned: ${n}`, onchange: (e) => { e.target.checked ? owned.add(n) : owned.delete(n); allBox.checked = owned.size === names.length; upd(); } }); boxes.set(n, b);
        return h('tr', null, h('td', { class: 'ck' }, b), h('td', { class: 'thumb' }, r ? h('img', { src: cat.imageUrl(r, 'small'), alt: '', width: 36, height: 50, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }) : null), h('td', null, h('b', null, n)), h('td', { class: 'num mono' }, '×' + cards[n]));
      });
      upd();
      return h('div', { class: 'rv' }, h('h2', null, 'Which of these do you own?'),
        h('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0 10px' }, h('button', { class: 'btn', type: 'button', onclick: () => setAll(true) }, icon('plus'), 'Add all to inventory'), sum),
        h('div', { class: 'tablewrap rv-wrap' }, h('table', null, h('caption', { class: 'sr' }, 'Imported cards'), h('thead', null, h('tr', null, h('th', { class: 'ck' }, allBox), h('th', { class: 'thumb' }, h('span', { class: 'sr' }, 'Image')), h('th', null, 'Card'), h('th', { class: 'num' }, 'Qty'))), h('tbody', null, rows))),
        h('div', { class: 'acts', style: 'justify-content:flex-end' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Skip'), h('button', { class: 'btn primary', type: 'button', onclick: () => close([...owned]) }, 'Confirm')));
    }, { wide: true, label: 'Which of these do you own' });
    if (!picked || !picked.length) return;
    const list = picked.map((n) => {                              // the set is only a best guess: use the cheapest regular printing
      const c = cat.cheapest?.(n, { treat: '', foil: false }), i = c?.row ? cat.rowInfo(c.row) : null;
      return { name: n, sp: i?.sp || '', set: i?.set || '', no: i?.no || '', qty: cards[n], foil: 0 };
    });
    col.addEntries(list); toast(`Added ${plural(list.reduce((a, e) => a + e.qty, 0), 'card')} to your inventory`);
  }
  let stopped = false, focusId = null;

  // ---- accessible tabs (roving tabindex, arrow keys, Home/End; the tab activates when focused by arrow)
  function tabs(id, items, active, pick, label) {
    const btns = items.map(([k, t]) => h('button', { type: 'button', role: 'tab', id: `${id}-tab-${k}`, 'aria-selected': k === active ? 'true' : 'false', 'aria-controls': `${id}-panel`, tabindex: k === active ? '0' : '-1', class: 'dx-tab',
      onclick: () => pick(k), onkeydown: (e) => {
        const i = items.findIndex((x) => x[0] === k), n = items.length;
        const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
        if (j < 0) return; e.preventDefault(); focusId = `${id}-tab-${items[j][0]}`; pick(items[j][0]);
      } }, t));
    return h('div', { class: 'dx-tabs', role: 'tablist', 'aria-label': label }, btns);
  }

  const priceNote = (rows) => {
    const live = rows.filter((p) => p && p.live), at = live.length ? new Date(Math.max(...live.map((p) => p.at))) : null;
    return `Prices are Scryfall estimates for the cheapest printing (snapshot of ${cat.snapshotDate()}` + (at ? `; ${live.length} refreshed live at ${at.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : '') + '). Real shop prices differ.';
  };

  // ---- categories (stored as tags): Ramp, Removal, Card Draw ... A card can have several; pick suggestions or type your own, separated by commas.
  async function editTags(card) {
    const used = db.deckTagList(current), now = db.tagsOf(current, card), sugg = PRESET_CATS.filter((t) => !used.includes(t));
    const res = await dialog((close) => {
      const input = h('input', { class: 'input', value: now.join(', '), placeholder: 'Ramp, Removal', autocomplete: 'off', autofocus: true, 'aria-label': 'Categories' });
      const add = (t) => { const cur = input.value.split(',').map((x) => x.trim()).filter(Boolean); if (!cur.some((x) => x.toLowerCase() === t.toLowerCase())) cur.push(t); input.value = cur.join(', '); input.focus(); };
      const chips = (title, list) => list.length ? h('div', { class: 'tagchips', style: 'margin:8px 0' }, h('span', { class: 'hint' }, title), list.map((t) => h('button', { type: 'button', class: 'tagchip', onclick: () => add(t) }, t))) : null;
      return h('form', { onsubmit: (e) => { e.preventDefault(); close({ tags: input.value.split(',') }); } },
        h('h2', null, `Categories for ${card}`), h('p', null, 'Categories split a board into groups, like Ramp, Removal or Card Draw. A card can be in several. Separate them with commas.'),
        h('label', { class: 'field' }, h('span', null, 'Categories'), input), chips('In this deck:', used), chips('Suggestions:', sugg),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
    }, { label: `Categories for ${card}` });
    if (res) db.setTags(current, card, res.tags);
  }

  // ---- grouping of the card table: returns the groups a card belongs to, [[order, label], ...]. A card with several categories shows in each of them.
  function groupOf(card) {
    const g = view.group;
    if (g === 'tag') { const t = db.tagsOf(current, card); return t.length ? t.map((x) => [1, x]) : [[2, 'Uncategorized']]; }
    const f = cat.find(card); if (!f) return [[99, 'Not found in the card data']];
    const m = cat.meta(f.rows[0]), land = m.types.includes('Land');
    if (g === 'type') { const k = land ? 'Land' : m.types.includes('Creature') ? 'Creature' : TYPE_ORDER.find((x) => m.types.includes(x)); return [[k ? TYPE_ORDER.indexOf(k) : 98, k || 'Other']]; }
    if (g === 'cmc') return [land ? [100, 'Lands'] : [m.cmc ?? 0, `Mana value ${m.cmc ?? 0}`]];
    const cols = COLOR_ORDER.filter(([k]) => m.colors.includes(k)).map(([, n]) => n);      // color
    return [land ? [100, 'Lands'] : cols.length === 0 ? [50, 'Colorless'] : cols.length > 1 ? [10, 'Multicolor: ' + cols.join(', ')] : [COLOR_ORDER.findIndex(([, n]) => n === cols[0]), cols[0]]];
  }

  // ---- category colors: pick one of eight for each category used in this deck (the color is the same in every deck)
  async function categoryColors() {
    const used = db.deckTagList(current); if (!used.length) { toast('No categories yet: give a card a category first'); return; }
    await dialog((close) => h('div', null, h('h2', null, 'Category colors'), h('p', null, 'Choose a color for each category. It shows on the chips and the group headers.'),
      h('div', { class: 'colorlist' }, used.map((t) => {
        const chip = h('span', { class: 'tagchip c-' + db.tagColor(t) }, t), sw = [];
        const row = h('div', { class: 'colorrow' }, chip, h('span', { class: 'swatches', role: 'group', 'aria-label': `Color of ${t}` }, db.TAG_COLORS.map((c) => {
          const b = h('button', { type: 'button', class: 'swatch c-' + c, 'aria-label': c, 'aria-pressed': String(db.tagColor(t) === c), onclick: () => { db.setTagColor(t, c); chip.className = 'tagchip c-' + c; sw.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); } });
          sw.push(b); return b;
        })));
        return row;
      })), h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', onclick: () => close(true) }, 'Done'))), { label: 'Category colors' });
  }

  // ---- categories (stored as tags): Ramp, Removal, Card Draw ... A card can have several; pick suggestions or type your own, separated by commas.
  async function editTags(card) {
    const used = db.deckTagList(current), now = db.tagsOf(current, card), sugg = PRESET_CATS.filter((t) => !used.includes(t));
    const res = await dialog((close) => {
      const input = h('input', { class: 'input', value: now.join(', '), placeholder: 'Ramp, Removal', autocomplete: 'off', autofocus: true, 'aria-label': 'Categories' });
      const add = (t) => { const cur = input.value.split(',').map((x) => x.trim()).filter(Boolean); if (!cur.some((x) => x.toLowerCase() === t.toLowerCase())) cur.push(t); input.value = cur.join(', '); input.focus(); };
      const chips = (title, list) => list.length ? h('div', { class: 'tagchips', style: 'margin:8px 0' }, h('span', { class: 'hint' }, title), list.map((t) => h('button', { type: 'button', class: 'tagchip c-' + db.tagColor(t), onclick: () => add(t) }, t))) : null;
      return h('form', { onsubmit: (e) => { e.preventDefault(); close({ tags: input.value.split(',') }); } },
        h('h2', null, `Categories for ${card}`), h('p', null, 'Categories split a board into groups, like Ramp, Removal or Card Draw. A card can be in several. Separate them with commas.'),
        h('label', { class: 'field' }, h('span', null, 'Categories'), input), chips('In this deck:', used), chips('Suggestions:', sugg),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
    }, { label: `Categories for ${card}` });
    if (res) db.setTags(current, card, res.tags);
  }

  // ---- grouping of the card table: returns the groups a card belongs to, [[order, label], ...]. A card with several categories shows in each of them.
  function groupOf(card) {
    const g = view.group;
    if (g === 'tag') { const t = db.tagsOf(current, card); return t.length ? t.map((x) => [1, x]) : [[2, 'Uncategorized']]; }
    const f = cat.find(card); if (!f) return [[99, 'Not found in the card data']];
    const m = cat.meta(f.rows[0]), land = m.types.includes('Land');
    if (g === 'type') { const k = land ? 'Land' : m.types.includes('Creature') ? 'Creature' : TYPE_ORDER.find((x) => m.types.includes(x)); return [[k ? TYPE_ORDER.indexOf(k) : 98, k || 'Other']]; }
    if (g === 'cmc') return [land ? [100, 'Lands'] : [m.cmc ?? 0, `Mana value ${m.cmc ?? 0}`]];
    const cols = COLOR_ORDER.filter(([k]) => m.colors.includes(k)).map(([, n]) => n);      // color
    return [land ? [100, 'Lands'] : cols.length === 0 ? [50, 'Colorless'] : cols.length > 1 ? [10, 'Multicolor: ' + cols.join(', ')] : [COLOR_ORDER.findIndex(([, n]) => n === cols[0]), cols[0]]];
  }

  // ---- Decks tab
  function decksTab() {
    clearTimeout(lvTimer); lvTimer = 0;
    const list = h('section', { class: 'card', 'aria-label': 'Your decks' },
      h('div', { class: 'hd' }, icon('decks'), h('h2', null, 'Decks')),
      h('div', { class: 'decklist' }, names.length ? names.map((n) => h('button', { class: 'deckbtn', type: 'button', 'aria-current': n === current ? 'true' : null, onclick: () => select(n) }, h('span', null, n), h('small', null, total(db.deckNeeds(n))))) : [h('p', { class: 'hint', style: 'padding:8px' }, 'No decks yet.')]),
      h('div', { class: 'row', style: 'padding:0 12px 14px' }, h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'New deck'), h('button', { class: 'btn', onclick: () => importDialog() }, icon('upload'), 'Import')));

    const onBoard = current ? db.board(current, view.board) : {};       // read here, not once per page load: the board tab changes without a data change
    const cardNames = Object.keys(onBoard).sort((a, b) => a.localeCompare(b));
    for (const c of [...view.sel]) if (!onBoard[c]) view.sel.delete(c);      // a selected card that left this board is no longer selected
    const otherBoards = db.BOARDS.filter(([b]) => b !== view.board);
    const cmds = current ? db.commandersOf(current) : [], size = current ? db.deckSize(current) : null, mainCount = total(deck);
    const span = 5 + (view.select ? 1 : 0) + (view.thumbs ? 1 : 0);      // Need, Card, Categories, Owned and the menu button are always there
    const thumbOf = (c) => (catReady ? chosenRow(c) : null);

    const syncSel = () => {
      for (const tr of tbody.querySelectorAll('tr[data-card]')) { const on = view.sel.has(tr.dataset.card); tr.setAttribute('aria-selected', String(on)); const cb = tr.querySelector('input[type=checkbox]'); if (cb) cb.checked = on; }
      const all = thead.querySelector('input'); if (all) { const n = cardNames.filter((c) => view.sel.has(c)).length; all.checked = n > 0 && n === cardNames.length; all.indeterminate = n > 0 && n < cardNames.length; }
      bulk.hidden = !view.select || !view.sel.size; selCount.textContent = view.sel.size;
    };
    const tbody = h('tbody'), thead = h('thead'), bulk = h('div', { class: 'bulk', hidden: true, role: 'region', 'aria-label': 'Selected cards' }), selCount = h('b', { class: 'mono' });
    const lv = h('aside', { class: 'lv', hidden: true, 'aria-hidden': 'true' });

    const row = (c) => {
      const q = onBoard[c], tags = db.tagsOf(current, c), isCmd = cmds.includes(c), missingHere = view.board !== 'maybe' && have(c) < (needs[c] || 0), tr = thumbOf(c);
      return h('tr', { 'data-card': c, 'aria-selected': 'false', class: (missingHere && view.highlight ? 'miss ' : '') + (isCmd ? 'is-cmd' : '') },
        view.select ? h('td', { class: 'ck' }, h('input', { type: 'checkbox', 'aria-label': `Select ${c}`, onchange: (e) => { e.target.checked ? view.sel.add(c) : view.sel.delete(c); syncSel(); } })) : null,
        view.thumbs ? h('td', { class: 'thumb' }, tr != null ? h('img', { src: cat.imageUrl(tr, 'small'), alt: '', width: 36, height: 50, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }) : null) : null,
        h('td', null, h('span', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': `One fewer ${c}`, onclick: () => db.bumpBoard(current, view.board, c, -1) }, '−'), h('b', null, q), h('button', { type: 'button', 'aria-label': `One more ${c}`, onclick: () => db.bumpBoard(current, view.board, c, 1) }, '+'))),
        h('td', { class: 'nm' }, isCmd ? h('span', { class: 'crown', title: 'Commander' }, icon('crown', 'Commander')) : null, c),
        h('td', null, h('span', { class: 'tagchips' }, tags.map((t) => h('button', { type: 'button', class: 'tagchip c-' + db.tagColor(t), title: 'Show only this category', onclick: () => { view.tag = view.tag === t ? '' : t; draw(); } }, t)),
          h('button', { type: 'button', class: 'btn sm ghost', 'aria-label': `Edit categories of ${c}`, onclick: () => editTags(c) }, tags.length ? 'Edit' : icon('plus'), tags.length ? null : 'Category'))),
        h('td', { class: 'own' }, have(c) + (missingHere ? ` (${needs[c] - have(c)} needed)` : '')),
        h('td', { class: 'rm' }, h('button', { type: 'button', class: 'rowmenu', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Actions for ${c}`, title: 'Card actions', onclick: (e) => openCardMenu(e.currentTarget, c) }, icon('dots'))));
    };
    const matches = (c) => !view.tag || db.tagsOf(current, c).includes(view.tag);
    const cmdShown = view.board === 'main' ? cmds.filter(matches) : [];      // commanders always come first, with a crown
    const shown = cardNames.filter((c) => matches(c) && !cmdShown.includes(c));
    const rows = [];
    if (cmdShown.length) { rows.push(h('tr', { class: 'bd-grp bd-cmd' }, h('td', { colspan: span }, icon('crown'), cmds.length > 1 ? ' Commanders' : ' Commander'))); cmdShown.forEach((c) => rows.push(row(c))); }
    if (view.group === 'none' || (view.group !== 'tag' && !catReady)) shown.forEach((c) => rows.push(row(c)));
    else {
      const gm = new Map();
      for (const c of shown) for (const [o, label] of groupOf(c)) { let g = gm.get(label); if (!g) gm.set(label, g = { o, cards: [] }); g.cards.push(c); }
      for (const [label, g] of [...gm].sort((a, b) => a[1].o - b[1].o || a[0].localeCompare(b[0]))) {
        const key = `${current}|${view.board}|${label}`, open = !view.collapsed.has(key);
        rows.push(h('tr', { class: 'bd-grp' }, h('td', { colspan: span }, h('button', { type: 'button', class: 'grpbtn', 'aria-expanded': String(open), onclick: () => { open ? view.collapsed.add(key) : view.collapsed.delete(key); draw(); } },
          icon(open ? 'down' : 'up'), view.group === 'tag' && g.o === 1 ? h('i', { class: 'tcdot c-' + db.tagColor(label) }) : null, `${label}  ·  ${plural(g.cards.reduce((n, c) => n + onBoard[c], 0), 'card')}`))));
        if (open) g.cards.forEach((c) => rows.push(row(c)));
      }
    }
    thead.replaceChildren(h('tr', null, view.select ? h('th', { class: 'ck' }, h('input', { type: 'checkbox', 'aria-label': 'Select all cards on this board', onchange: (e) => { for (const c of cardNames) e.target.checked ? view.sel.add(c) : view.sel.delete(c); syncSel(); } })) : null,
      view.thumbs ? h('th', { class: 'thumb' }, h('span', { class: 'sr' }, 'Image')) : null, ['Need', 'Card', 'Categories', 'Owned'].map((t) => h('th', null, t)), h('th', { class: 'rm' }, h('span', { class: 'sr' }, 'Actions'))));
    tbody.replaceChildren(...rows);
    const pickedCards = () => cardNames.filter((c) => view.sel.has(c));
    bulk.append(h('span', null, selCount, ' selected'), h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { const cs = pickedCards(); if (cs.length) bulkCategory(cs); } }, icon('plus'), 'Add category'),
      view.board === 'main' ? h('button', { class: 'btn sm', type: 'button', title: 'Mark the selected cards as commander (up to two)', onclick: () => {
        const cs = pickedCards(), room = 2 - cmds.length; if (!cs.length) return;
        if (cs.length > room) { toast(room > 0 ? `Only ${plural(room, 'more commander')} fit: a deck has at most two` : 'A deck has at most two commanders: remove one first'); return; }
        view.sel.clear(); for (const c of cs) db.setCommander(current, c, true); if (db.deckSize(current) !== 100) db.setDeckSize(current, 100); toast(`${plural(cs.length, 'card')} set as commander`);
      } }, icon('crown'), 'Make commander') : null,
      ...otherBoards.map(([b, n]) => h('button', { class: 'btn sm', type: 'button', onclick: () => {
      const cs = cardNames.filter((c) => view.sel.has(c)); if (!cs.length) return; view.sel.clear(); const n2 = db.moveCards(current, cs, view.board, b); toast(`Moved ${plural(cs.length, 'card')} (${plural(n2, 'copy', 'copies')}) to the ${n.toLowerCase()}`);
    } }, `Move to ${n}`)),
      h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { const cs = pickedCards(); if (!cs.length) return; if (!(await confirmDialog({ title: 'Remove cards', text: `Take ${plural(cs.length, 'selected card')} off the ${BOARD_NAME[view.board].toLowerCase()}?`, ok: 'Remove', danger: true }))) return; view.sel.clear(); db.removeCards(current, view.board, cs); } }, icon('trash'), 'Remove'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { view.sel.clear(); syncSel(); } }, 'Clear'));
    syncSel();

    // large view: hover a card for 0.2 s and a big picture opens on the right with its price and how many you own
    function showLv(c) {
      const g = catReady ? cat.find(c) : null; if (!g) return;
      const p = cat.cheapest(c, { treat: '' }), r = chosenRow(c) ?? g.rows[0], m = cat.meta(r), tags = db.tagsOf(current, c);
      lv.replaceChildren(h('img', { src: cat.imageUrl(r, 'normal'), alt: '', width: 300, height: 418, crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg big' }), h('h3', null, c),
        h('div', { class: 'row', style: 'gap:6px;margin:4px 0 10px' }, m.types.map((t) => h('span', { class: 'chip' }, t)), m.cmc != null ? h('span', { class: 'chip d' }, `mana value ${m.cmc}`) : null, tags.map((t) => h('span', { class: 'tagchip c-' + db.tagColor(t) }, t))),
        h('div', { class: 'lvgrid' }, h('span', null, 'Price'), h('b', { class: 'mono' }, p ? cat.fmt(p.cents) : '–'), h('span', null, 'In this deck'), h('b', null, db.BOARDS.map(([b, n]) => `${n.split(' ')[0]} ${db.board(current, b)[c] || 0}`).join(' · ')), h('span', null, 'You own'), h('b', { class: 'mono' }, have(c))));
      lv.hidden = false;
    }
    const hideLv = () => { clearTimeout(lvTimer); lvTimer = 0; lv.hidden = true; lv.dataset.card = ''; };
    tbody.addEventListener('mouseover', (ev) => {
      if (!view.large || !catReady) return; const tr = ev.target.closest('tr[data-card]'); if (!tr || tr.dataset.card === lv.dataset.card) return;
      clearTimeout(lvTimer); lvTimer = setTimeout(() => { lv.dataset.card = tr.dataset.card; showLv(tr.dataset.card); }, 200);
    });
    tbody.addEventListener('mouseleave', hideLv);
    tbody.addEventListener('focusin', (ev) => { if (!view.large || !catReady) return; const tr = ev.target.closest('tr[data-card]'); if (tr) { lv.dataset.card = tr.dataset.card; showLv(tr.dataset.card); } });

    const boardTabs = db.BOARDS.map(([b, n]) => [b, [n, h('small', null, total(db.board(current, b)))]]);
    const tagList = current ? db.deckTagList(current) : [];

    // add box: search + the category new cards get + commander button
    const sb = searchBox({ label: `Add a card to the ${BOARD_NAME[view.board].toLowerCase()}`, onPick: addToBoard });
    const catOpts = [...tagList, ...PRESET_CATS.filter((t) => !tagList.includes(t))];
    if (view.addCat && !catOpts.includes(view.addCat)) catOpts.unshift(view.addCat);
    const catSel = h('select', { class: 'input', 'aria-label': 'Category for the cards you add', onchange: async (e) => {
      if (e.target.value !== '\0new') { view.addCat = e.target.value; return; }
      const n = await promptDialog({ title: 'New category', text: 'Cards you add next get this category.', label: 'Category name', placeholder: 'Removal', ok: 'Use it' }); view.addCat = n || ''; draw();
    } }, h('option', { value: '' }, 'No category'), ...catOpts.map((t) => h('option', { value: t, selected: view.addCat === t }, t)), h('option', { value: '\0new' }, '+ New category…'));
    const addRow = h('div', { class: 'bd-add' }, sb.el, h('label', { class: 'sel' }, 'Category', catSel),
      size === 100 || cmds.length ? h('button', { class: 'btn sm', type: 'button', disabled: cmds.length >= 2, onclick: addCommander }, icon('crown'), cmds.length ? (cmds.length >= 2 ? 'Two commanders set' : 'Add second commander') : 'Add commander') : null);

    // option switches, the same style as the Inventory tab
    const opt = (label, get, set) => { const b = h('button', { type: 'button', class: 'opt', role: 'switch', 'aria-checked': String(get()), onclick: () => { set(!get()); keepView(); draw(); } }, h('span', { 'data-t': label }, label)); return b; };
    const selectBtn = h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(view.select), onclick: () => { view.select = !view.select; if (!view.select) view.sel.clear(); draw(); } }, icon('check'), view.select ? 'Done selecting' : 'Select cards');
    const toggles = h('div', { class: 'tools bd-toggles' }, selectBtn,
      opt('Card images', () => view.thumbs, (v) => { view.thumbs = v; }), opt('Large view', () => view.large, (v) => { view.large = v; }), opt('Highlight missing cards', () => view.highlight, (v) => { view.highlight = v; }));

    let body;
    if (view.sub === 'stats') {
      if (!catReady) body = h('div', { class: 'empty', role: 'status' }, h('h3', null, 'Loading card data…'), h('p', null, 'Statistics need the card catalog.'));
      else { const pl = playing(); body = h('div', { class: 'dx-statswrap' }, h('p', { class: 'hint', style: 'padding:12px 20px 0;margin:0' }, 'Statistics cover the main deck, commander included. The sideboard and maybeboard are not counted.'), renderStats(computeStats(pl, own, db.norm, cat), cat.fmt, priceNote(Object.keys(pl).map((c) => cat.cheapest(c, { treat: '' }))))); }
    } else {
      body = h('div', null, addRow,
        h('div', { class: 'bd-boards' }, tabs('bdb', boardTabs, view.board, (k) => { view.board = k; view.sel.clear(); draw(); }, `Boards of ${current}`),
          h('label', { class: 'sel' }, 'Group by', h('select', { class: 'input', 'aria-label': 'Group cards by', onchange: (e) => { view.group = e.target.value; draw(); } },
            [['none', 'None'], ['type', 'Card type'], ['cmc', 'Mana value'], ['color', 'Color'], ['tag', 'Category']].map(([v, t]) => h('option', { value: v, selected: view.group === v }, t))))),
        toggles,
        tagList.length ? h('div', { class: 'bd-filter', role: 'group', 'aria-label': 'Filter by category' }, h('span', { class: 'hint', style: 'align-self:center' }, 'Categories:'),
          tagList.map((t) => h('button', { type: 'button', class: 'bchip', 'aria-pressed': String(view.tag === t), onclick: () => { view.tag = view.tag === t ? '' : t; draw(); } }, h('i', { class: 'tcdot c-' + db.tagColor(t) }), t)),
          h('button', { type: 'button', class: 'btn sm', onclick: categoryColors }, icon('palette'), 'Colors')) : null,
        h('div', { role: 'tabpanel', id: 'bdb-panel', 'aria-labelledby': `bdb-tab-${view.board}`, class: 'dx-panel' },
          h('div', { class: 'tablewrap' }, h('table', null, h('caption', { class: 'sr' }, `${BOARD_NAME[view.board]} of ${current}`), thead, tbody)),
          rows.length ? null : h('div', { class: 'empty' }, icon('decks'), h('h3', null, view.tag ? `Nothing in ${view.tag} here` : `${BOARD_NAME[view.board]} is empty`),
            h('p', null, view.board === 'main' ? (size === 100 ? 'Start with "Add commander", then search for cards above.' : 'Search for a card above, import a list, or select cards in the Inventory and use "Add to deck".') : 'Search for a card above, or turn on "Select cards" on another board and move cards here.')),
          bulk));
    }
    const detail = current ? h('section', { class: 'card', 'aria-label': current },
      h('div', { class: 'hd' }, h('h2', null, current), h('span', { class: 'grow' }),
        size ? h('span', { class: 'chip ' + (mainCount === size ? 'a' : mainCount > size ? 'e' : 'd'), title: 'Cards in the main deck compared with the deck size' }, `Main deck ${mainCount} / ${size}`) : null,
        h('span', { class: 'chip ' + (missing ? 'e' : 'a') }, `${need} cards` + (missing ? `, ${missing} not owned` : ', all owned'))),
      h('div', { class: 'tools' }, h('button', { class: 'btn sm', onclick: () => db.deckText(current) && navigator.clipboard.writeText(db.deckText(current)).then(() => toast('Deck list copied (Arena / MTGO format)')) }, icon('copy'), 'Copy list'),
        h('button', { class: 'btn sm', onclick: () => importDialog(current) }, icon('upload'), 'Import cards'),
        h('button', { class: 'btn sm', onclick: () => download(current + '.txt', db.deckText(current)) }, icon('download'), 'Export .txt'),
        h('label', { class: 'sel', style: 'margin-left:0' }, 'Deck size', h('select', { class: 'input', 'aria-label': 'Deck size', onchange: (e) => db.setDeckSize(current, +e.target.value || null) },
          h('option', { value: '' }, 'Not set'), SIZES.map(([n]) => h('option', { value: n, selected: size === n }, n === 100 ? '100 (Commander)' : String(n))))),
        h('span', { style: 'flex:1' }), h('button', { class: 'btn sm danger', onclick: del }, icon('trash'), 'Delete deck')),
      h('div', { class: 'dx-subbar' }, tabs('dxsub', [['cards', 'Cards'], ['stats', 'Stats']], view.sub, (k) => { view.sub = k; draw(); }, `View of ${current}`)),
      h('div', { role: 'tabpanel', id: 'dxsub-panel', 'aria-labelledby': `dxsub-tab-${view.sub}`, tabindex: '0', class: 'dx-panel' }, body))
      : h('section', { class: 'card' }, h('div', { class: 'empty' }, icon('decks'), h('h3', null, 'Create or import a deck'), h('p', null, 'Decks show which cards you already own (green) and which you still need (red).'),
        h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'New deck'), h('button', { class: 'btn', onclick: () => importDialog() }, icon('upload'), 'Import a list'))));
    return h('div', { class: 'decks' }, list, detail, lv);
  }

  // ---- Wishlist tab
  function wishTab() {
    const m = new Map();
    for (const dn of names) for (const [c, q] of Object.entries(db.deckNeeds(dn))) {
      const k = db.norm(c); let e = m.get(k); if (!e) m.set(k, e = { key: k, name: c, decks: [], sum: 0, max: 0 });
      e.decks.push([dn, q]); e.sum += q; e.max = Math.max(e.max, q);
    }
    const entries = [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      e.need = view.mode === 'max' ? e.max : e.sum; e.owned = own[e.key] || 0; e.missing = Math.max(0, e.need - e.owned);
      if (catReady) { e.group = cat.find(e.name); e.p = e.group ? cat.cheapest(e.name, { treat: '' }) : null; }
    }
    const tbody = h('tbody'), total = h('b', { class: 'mono' }), sub = h('span', { class: 'hint' }), note = h('p', { class: 'hint' }), live = h('span', { class: 'sr', role: 'status', 'aria-live': 'polite' });
    const emptyBox = h('div', { class: 'empty', hidden: true });
    const tw = h('div', { class: 'tablewrap' }, h('table', null, h('caption', { class: 'sr' }, 'Cards you need across all decks'),
      h('thead', null, h('tr', null, [['', 'Image'], ['', 'Card'], ['num', 'Needed'], ['num', 'Owned'], ['num', 'Missing'], ['num', 'Price each'], ['num', 'Cost of missing'], ['', 'Needed by']].map(([c, t]) => h('th', { class: c }, t)))), tbody));
    let shown = [];
    const wishText = () => shown.filter((e) => e.missing > 0).map((e) => `${e.missing} ${e.name}`).join('\n') + '\n';
    const copyBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => navigator.clipboard.writeText(wishText()).then(() => toast('Wishlist copied')) }, icon('copy'), 'Copy list');
    const expBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => download('wishlist.txt', wishText()) }, icon('download'), 'Export .txt');
    const toListBtn = h('button', { class: 'btn sm', type: 'button', onclick: saveMissingToList }, icon('list'), 'Save to a list');
    async function saveMissingToList() {
      const miss = Object.fromEntries(shown.filter((e) => e.missing > 0).map((e) => [e.name, e.missing])); if (!Object.keys(miss).length) return;
      const res = await pickListDialog('Save missing cards to a list', `${plural(Object.keys(miss).length, 'card')} you still need are added to the list you choose (quantities add up if a card is already on it).`, 'Save');
      if (!res) return; db.newList(res.list); db.addToList(res.list, miss); toast(`Saved ${plural(Object.keys(miss).length, 'card')} to ${res.list}`);
    }

    function update() {
      const q = view.q.trim().toLowerCase();
      shown = entries.filter((e) => (!view.only || e.missing > 0) && (!q || e.name.toLowerCase().includes(q)));
      tbody.replaceChildren(...shown.map((e) => {
        const cost = e.p ? e.p.cents * e.missing : null;
        const thumb = catReady && e.group ? h('img', { src: cat.imageUrl(e.p ? e.p.row : e.group.rows[0], 'small'), width: 40, height: 56, alt: e.name, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'dx-thumb' }) : h('span', { class: 'dx-nothumb', 'aria-hidden': 'true' });
        return h('tr', { class: e.missing ? 'miss' : '' }, h('td', { class: 'dx-img' }, thumb), h('td', { class: 'nm' }, e.name),
          h('td', { class: 'num' }, e.need), h('td', { class: 'num' }, e.owned), h('td', { class: 'num' }, h('b', null, e.missing)),
          h('td', { class: 'num' }, catReady ? (e.p ? cat.fmt(e.p.cents) : (e.group ? 'no price' : 'not found')) : '…'), h('td', { class: 'num' }, e.missing && cost != null ? cat.fmt(cost) : '–'),
          h('td', null, h('span', { class: 'dx-decks' }, e.decks.map(([dn, qn]) => h('span', { class: 'chip' }, `${dn} ×${qn}`)))));
      }));
      const cost = shown.reduce((s, e) => s + (e.p ? e.p.cents * e.missing : 0), 0), unp = shown.filter((e) => e.missing && !e.p).length, miss = shown.reduce((s, e) => s + e.missing, 0);
      total.textContent = catReady ? cat.fmt(cost) : '…';
      sub.textContent = `${plural(miss, 'missing copy', 'missing copies')} in ${plural(shown.filter((e) => e.missing).length, 'card')}` + (catReady && unp ? `, ${plural(unp, 'card')} without a price or not found (not counted)` : '');
      note.textContent = catReady ? priceNote(shown.map((e) => e.p)) : 'Loading card data…';
      live.textContent = `${plural(shown.length, 'card')} shown`;
      const none = !shown.length; tw.hidden = none; emptyBox.hidden = !none;
      copyBtn.disabled = expBtn.disabled = toListBtn.disabled = !miss;
      if (none) emptyBox.replaceChildren(...(!entries.length
        ? [icon('decks'), h('h3', null, 'Create or import a deck'), h('p', null, 'The wishlist adds up what your decks need and you do not own yet.'), h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'New deck'), h('button', { class: 'btn', onclick: () => importDialog() }, icon('upload'), 'Import a list'))]
        : q ? [icon('search'), h('h3', null, 'No cards match'), h('p', null, 'Try a different search.')]
        : [icon('check'), h('h3', null, 'All decks are fully owned'), h('p', null, 'Nothing is missing. Turn off "Only cards I am missing" to see every card your decks use.')]));
    }

    const modeSel = h('div', { class: 'dx-mode', role: 'radiogroup', 'aria-label': 'How to combine decks' },
      [['sum', 'Add up all decks'], ['max', 'Largest need only']].map(([k, t]) => h('label', { class: 'dx-radio' }, h('input', { type: 'radio', name: 'dxmode', value: k, checked: view.mode === k, onchange: () => { view.mode = k; draw(); } }), h('span', null, t))));
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Filter wishlist', 'aria-label': 'Filter the wishlist by card name', autocomplete: 'off', value: view.q, oninput: (e) => { view.q = e.target.value; update(); } });
    const only = h('input', { type: 'checkbox', checked: view.only, onchange: (e) => { view.only = e.target.checked; update(); } });
    const bar = h('i', { style: 'width:4%' }), prog = h('div', { class: 'progress dx-prog', role: 'progressbar', 'aria-label': 'Price refresh progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, hidden: true }, bar);
    const refresh = h('button', { class: 'btn sm', type: 'button', disabled: !catReady }, icon('download'), 'Refresh prices');
    refresh.addEventListener('click', async () => {
      const rows = shown.filter((e) => e.p).map((e) => e.p.row);
      if (!rows.length) { toast('No priced cards to refresh'); return; }
      refresh.disabled = true; prog.hidden = false; live.textContent = 'Refreshing prices';
      try {
        const n = await cat.refreshPrices(rows, (f) => { bar.style.width = Math.max(4, Math.round(f * 100)) + '%'; prog.setAttribute('aria-valuenow', Math.round(f * 100)); });
        toast(`Updated ${plural(n, 'price')} from Scryfall`);
      } catch (err) { toast('Price refresh failed: ' + (err && err.message || err)); }
      if (!stopped) draw();
    });

    update();
    return h('section', { class: 'card', 'aria-label': 'Wishlist' },
      h('div', { class: 'hd' }, icon('list'), h('h2', null, 'Wishlist'), h('span', { class: 'grow' }), h('span', { class: 'dx-total' }, 'Missing cost ', total)),
      h('div', { class: 'tools' }, modeSel, h('div', { class: 'search' }, icon('search'), search), h('label', { class: 'check' }, only, 'Only cards I am missing')),
      h('div', { class: 'tools' }, copyBtn, expBtn, toListBtn, refresh, prog, h('span', { style: 'flex:1' }), sub),
      h('div', { class: 'dx-note' }, note, live), emptyBox, tw);
  }

  function draw() {
    const body = view.tab === 'wish' ? wishTab() : decksTab();
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'head' }, h('div', null, h('h1', null, 'Decks'), h('p', null, 'Build deck lists and see what you still need to find.'))),
      tabs('dx', [['decks', 'Decks'], ['wish', 'Wishlist']], view.tab, (k) => { view.tab = k; draw(); }, 'Decks sections'),
      h('div', { role: 'tabpanel', id: 'dx-panel', 'aria-labelledby': `dx-tab-${view.tab}`, tabindex: '0', class: 'dx-panel' }, body)));
    if (focusId) { document.getElementById(focusId)?.focus(); focusId = null; }
    if (refocusAdd) { refocusAdd = false; root.querySelector('.bd-add input')?.focus(); }
  }

  draw();
  if (!catReady) cat.loadCatalog().then(() => { catReady = true; if (!stopped) draw(); }).catch((err) => { if (!stopped) toast('Card data could not be loaded: ' + (err.message || err)); });
  return { stop() { stopped = true; } };
}
