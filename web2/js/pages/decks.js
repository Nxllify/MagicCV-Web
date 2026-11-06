import * as db from '../../../web/js/store.js';
import { parseDeckList } from '../../../web/js/decklist.js';          // same parser as the classic site
import { h, icon, toast, dialog, confirmDialog, promptDialog, download, pickFile, plural } from '../ui.js';
import * as cat from '../catalog.js';
import * as col from '../collection.js';
import { computeStats, renderStats } from '../deckstats.js';

let current = null;   // selected deck (survives re-renders)
const view = { tab: 'decks', sub: 'cards', mode: 'sum', only: true, q: '' };   // tab state survives data refreshes
let catReady = false;  // once loaded the catalog stays, so later redraws are instant

export function decks(root) {
  const all = db.get().decks, names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  if (!all[current]) current = names[0] || null;
  const own = db.owned(), deck = current ? all[current] : {};
  const cardNames = Object.keys(deck).sort((a, b) => a.localeCompare(b));
  const have = (c) => own[db.norm(c)] || 0;
  const need = cardNames.reduce((n, c) => n + deck[c], 0), missing = cardNames.reduce((n, c) => n + Math.max(0, deck[c] - have(c)), 0);
  const select = (n) => { current = n; db.save(); };

  async function create() {
    const name = await promptDialog({ title: 'New deck', label: 'Deck name', placeholder: 'My deck', ok: 'Create' }); if (!name) return;
    current = name; if (!db.newDeck(name)) toast('A deck with that name already exists');
  }
  async function del() { if (await confirmDialog({ title: 'Delete deck', text: `Delete "${current}"? Your inventory is not affected.`, ok: 'Delete', danger: true })) db.deleteDeck(current); }
  async function addCard() {
    const name = await promptDialog({ title: 'Add a card', text: 'Type the exact card name.', label: 'Card name', placeholder: 'Lightning Bolt', ok: 'Add' }); if (name) db.bump(current, name, 1);
  }
  async function importDialog(target) {
    const res = await dialog((close) => {
      const name = h('input', { class: 'input', placeholder: 'Deck name (optional)', autocomplete: 'off' });   // not used when importing into an existing deck
      const area = h('textarea', { class: 'input', placeholder: '4 Lightning Bolt\n4 Goblin Guide\n1 Sol Ring (CMM) 400\n\nSideboard\n2 Smash to Smithereens', spellcheck: 'false', 'aria-label': 'Deck list' });
      const side = h('input', { type: 'checkbox' }), info = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' }, 'Paste a list to see what is recognised.');
      const go = h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Import');
      const upd = () => {
        const p = parseDeckList(area.value); go.disabled = !p.main && !(side.checked && (p.side || p.maybe));
        info.textContent = p.main || p.side || p.maybe ? `${p.main} cards (${p.uniqueMain} unique)` + (p.side ? `, sideboard ${p.side}` : '') + (p.maybe ? `, maybeboard ${p.maybe}` : '') + (p.bad.length ? `, ${plural(p.bad.length, 'line')} not understood` : '') : 'Nothing recognised yet.';
      };
      area.addEventListener('input', upd); side.addEventListener('change', upd);
      return h('form', { onsubmit: (e) => { e.preventDefault(); close({ name: name.value, parsed: parseDeckList(area.value), side: side.checked }); } },
        h('h2', null, target ? `Import cards into ${target}` : 'Import a deck'),
        h('p', null, 'Paste a list from Moxfield, Archidekt, MTG Arena or MTGO (use their Export or Copy as text). Quantities like 4 or 4x, set codes and foil marks are understood.'),
        target ? null : h('label', { class: 'field' }, h('span', null, 'Name'), name), h('label', { class: 'field' }, h('span', null, 'Deck list'), area),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => { const t = await pickFile('.txt,.csv,.dec,text/plain'); if (t != null) { area.value = t; upd(); } } }, icon('upload'), 'Load a .txt file'),
          h('label', { class: 'check' }, side, 'Also import the sideboard and maybeboard')),
        info, h('p', { class: 'hint' }, 'A link to a Moxfield or Archidekt deck cannot be fetched from a web page (those sites block it). Copy the deck as text there and paste it here.'),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), go));
    }, { wide: true, label: target ? `Import cards into ${target}` : 'Import a deck' });
    if (!res) return;
    const cards = { ...res.parsed.zones.main };
    if (res.side) for (const z of ['side', 'maybe']) for (const [c, q] of Object.entries(res.parsed.zones[z])) cards[c] = (cards[c] || 0) + q;
    if (target) {            // merge into the open deck, then offer to add the same cards to the inventory
      const d = db.get().decks[target]; for (const [c, q] of Object.entries(cards)) d[c] = (d[c] || 0) + q; db.save();
      toast(`Imported ${plural(Object.values(cards).reduce((a, b) => a + b, 0), 'card')} into "${target}"`);
      await offerInventory(cards); return;
    }
    current = db.freeDeckName(res.name);                         // select it before the save redraws the page
    db.importDeck(current, cards); toast(`Imported ${plural(Object.values(cards).reduce((a, b) => a + b, 0), 'card')} into "${current}"`);
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

  // ---- Decks tab
  function decksTab() {
    const list = h('section', { class: 'card', 'aria-label': 'Your decks' },
      h('div', { class: 'hd' }, icon('decks'), h('h2', null, 'Decks')),
      h('div', { class: 'decklist' }, names.length ? names.map((n) => h('button', { class: 'deckbtn', type: 'button', 'aria-current': n === current ? 'true' : null, onclick: () => select(n) }, h('span', null, n), h('small', null, Object.values(all[n]).reduce((a, b) => a + b, 0)))) : [h('p', { class: 'hint', style: 'padding:8px' }, 'No decks yet.')]),
      h('div', { class: 'row', style: 'padding:0 12px 14px' }, h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'New deck'), h('button', { class: 'btn', onclick: () => importDialog() }, icon('upload'), 'Import')));

    const rows = cardNames.map((c) => h('tr', { class: have(c) < deck[c] ? 'miss' : '' },
      h('td', null, h('span', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': `One fewer ${c}`, onclick: () => db.bump(current, c, -1) }, '−'), h('b', null, deck[c]), h('button', { type: 'button', 'aria-label': `One more ${c}`, onclick: () => db.bump(current, c, 1) }, '+'))),
      h('td', { class: 'nm' }, c), h('td', { class: 'own' }, have(c) + (have(c) < deck[c] ? `  (need ${deck[c] - have(c)} more)` : ''))));

    let body;
    if (view.sub === 'stats') {
      if (!catReady) body = h('div', { class: 'empty', role: 'status' }, h('h3', null, 'Loading card data…'), h('p', null, 'Statistics need the card catalog.'));
      else body = h('div', { class: 'dx-statswrap' }, renderStats(computeStats(deck, own, db.norm, cat), cat.fmt, priceNote(cardNames.map((c) => cat.cheapest(c, { treat: '' })))));
    } else {
      body = h('div', null, h('div', { class: 'tablewrap' }, h('table', null, h('caption', { class: 'sr' }, `Cards in ${current}`), h('thead', null, h('tr', null, ['Need', 'Card', 'Owned'].map((t) => h('th', null, t)))), h('tbody', null, rows))),
        rows.length ? null : h('div', { class: 'empty' }, icon('decks'), h('h3', null, 'This deck is empty'), h('p', null, 'Add a card here, or select cards in the Inventory and use "Add to deck".')));
    }
    const detail = current ? h('section', { class: 'card', 'aria-label': current },
      h('div', { class: 'hd' }, h('h2', null, current), h('span', { class: 'grow' }), h('span', { class: 'chip ' + (missing ? 'e' : 'a') }, `${need} cards` + (missing ? `, ${missing} not owned` : ', all owned'))),
      h('div', { class: 'tools' }, h('button', { class: 'btn sm', onclick: () => db.deckText(current) && navigator.clipboard.writeText(db.deckText(current)).then(() => toast('Deck list copied (Arena / MTGO format)')) }, icon('copy'), 'Copy list'),
        h('button', { class: 'btn sm', onclick: () => importDialog(current) }, icon('upload'), 'Import cards'),
        h('button', { class: 'btn sm', onclick: () => download(current + '.txt', db.deckText(current)) }, icon('download'), 'Export .txt'), h('span', { style: 'flex:1' }),
        h('button', { class: 'btn sm primary', onclick: addCard }, icon('plus'), 'Add card'), h('button', { class: 'btn sm danger', onclick: del }, icon('trash'), 'Delete deck')),
      h('div', { class: 'dx-subbar' }, tabs('dxsub', [['cards', 'Cards'], ['stats', 'Stats']], view.sub, (k) => { view.sub = k; draw(); }, `View of ${current}`)),
      h('div', { role: 'tabpanel', id: 'dxsub-panel', 'aria-labelledby': `dxsub-tab-${view.sub}`, tabindex: '0', class: 'dx-panel' }, body))
      : h('section', { class: 'card' }, h('div', { class: 'empty' }, icon('decks'), h('h3', null, 'Create or import a deck'), h('p', null, 'Decks show which cards you already own (green) and which you still need (red).'),
        h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'New deck'), h('button', { class: 'btn', onclick: () => importDialog() }, icon('upload'), 'Import a list'))));
    return h('div', { class: 'decks' }, list, detail);
  }

  // ---- Wishlist tab
  function wishTab() {
    const m = new Map();
    for (const dn of names) for (const [c, q] of Object.entries(all[dn])) {
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
      copyBtn.disabled = expBtn.disabled = !miss;
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
      h('div', { class: 'tools' }, copyBtn, expBtn, refresh, prog, h('span', { style: 'flex:1' }), sub),
      h('div', { class: 'dx-note' }, note, live), emptyBox, tw);
  }

  function draw() {
    const body = view.tab === 'wish' ? wishTab() : decksTab();
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'head' }, h('div', null, h('h1', null, 'Decks'), h('p', null, 'Build deck lists and see what you still need to find.'))),
      tabs('dx', [['decks', 'Decks'], ['wish', 'Wishlist']], view.tab, (k) => { view.tab = k; draw(); }, 'Decks sections'),
      h('div', { role: 'tabpanel', id: 'dx-panel', 'aria-labelledby': `dx-tab-${view.tab}`, tabindex: '0', class: 'dx-panel' }, body)));
    if (focusId) { document.getElementById(focusId)?.focus(); focusId = null; }
  }

  draw();
  if (!catReady) cat.loadCatalog().then(() => { catReady = true; if (!stopped) draw(); }).catch((err) => { if (!stopped) toast('Card data could not be loaded: ' + (err.message || err)); });
  return { stop() { stopped = true; } };
}
