import * as db from '../../../web/js/store.js';
import { loadEngine, engineLoaded, webgpuAvailable } from '../../../web/js/scan/engine.js';      // the scanner engine, models and card data are shared with the classic site
import { ScanSession } from '../../../web/js/scan/session.js';
import { scanStill } from '../../../web/js/scan/pipeline.js';
import * as cat from '../catalog.js';
import * as col from '../collection.js';
import { prefs, setPrefs, BACKENDS } from '../prefs.js';
import { h, icon, toast, plural, dialog, promptDialog } from '../ui.js';
import { newDeckDialog } from '../newdeck.js';

// Live camera -> detector -> tracker -> embedder -> gallery search -> accept rules -> REVIEW LIST -> inventory, all in the browser.
// Scans are collected in a pending list first; the Review window lets you fix quantities and foil before anything reaches the inventory.
// No SIFT step here: a card is only named when the embedder is sure (the same thresholds as the desktop scanner).
const pending = new Map();                 // key -> {key,name,sp,set,no,qty,foil}  (survives leaving the page, not a reload)
const undo = [];                           // keys in scan order, newest last
const opts = { foil: false, deck: '', binder: (() => { try { return localStorage.getItem('magiccv2.scan.binder') || ''; } catch { return ''; } })() };    // "scan as foil", destination deck, destination binder
const setBinder = (b) => { opts.binder = b; try { localStorage.setItem('magiccv2.scan.binder', b); } catch { /* not remembered */ } };
// "Also add to deck": none, each deck, or a new deck (asks for a name and a size). noneLabel is the first option.
function deckSelect(label, noneLabel, extra = {}) {
  const sel = h('select', { class: 'input', 'aria-label': label, ...extra, onchange: async (e) => {
    if (e.target.value === '\0new') {
      const r = await newDeckDialog({ text: 'The cards you scan are added to this new deck and to your inventory.' });
      if (r) { const name = db.freeDeckName(r.name); db.newDeck(name, r.size); opts.deck = name; toast(`Created deck ${name}`); }
      fill(); return;
    }
    opts.deck = e.target.value;
  } });
  function fill() {
    const decks = Object.keys(db.get().decks).sort((a, b) => a.localeCompare(b)); if (opts.deck && !decks.includes(opts.deck)) opts.deck = '';
    sel.replaceChildren(h('option', { value: '' }, noneLabel), ...decks.map((d) => h('option', { value: d }, `Inventory + deck: ${d}`)), h('option', { value: '\0new' }, '+ New deck…'));
    sel.value = opts.deck;
  }
  fill();
  return sel;
}
// "Into binder": Unsorted, each binder, or a new one (a prompt). onPick runs after the choice is stored.
function binderSelect(label, onPick) {
  const sel = h('select', { class: 'input', 'aria-label': label, style: 'width:auto', onchange: async (e) => {
    if (e.target.value === '\0new') {
      const n = await promptDialog({ title: 'New binder', label: 'Binder name', placeholder: 'Trade binder', ok: 'Create' });
      if (n) { db.addBinder(n); setBinder(db.get().binders.find((b) => b.toLowerCase() === n.trim().toLowerCase()) || ''); }
      fill(); onPick?.(); return;
    }
    setBinder(e.target.value); onPick?.();
  } });
  function fill() {
    const names = db.get().binders; if (opts.binder && !names.includes(opts.binder)) setBinder('');
    sel.replaceChildren(h('option', { value: '' }, 'Unsorted'), ...names.map((b) => h('option', { value: b }, `Binder: ${b}`)), h('option', { value: '\0new' }, '+ New binder…'));
    sel.value = opts.binder;
  }
  fill();
  return sel;
}
let lastCard = '—', scannedTotal = 0;

const pendingCount = () => [...pending.values()].reduce((n, e) => n + e.qty, 0);
const unitOf = (e, foil) => col.unit({ name: e.name, sp: e.sp, set: e.set, no: e.no, pin: false }, foil);
const money = (c) => (c == null ? '–' : cat.fmt(c));
window.addEventListener('beforeunload', (ev) => { if (pending.size) { ev.preventDefault(); ev.returnValue = ''; } });

function addPending(rec) {
  const e = { name: rec.name, sp: rec.special_print || '', set: rec.best_guess_set || '', no: rec.collector_number || '' };
  const key = db.keyOf({ name: e.name, special_print: e.sp, best_guess_set: e.set, collector_number: e.no });
  const p = pending.get(key) || pending.set(key, { key, ...e, qty: 0, foil: 0 }).get(key);
  p.qty++; if (opts.foil) p.foil++; undo.push({ key, foil: opts.foil }); scannedTotal++;
  lastCard = e.name + (e.sp ? ` [${e.sp}]` : '');
}
function undoLast() {
  const u = undo.pop(); if (!u) return null; const p = pending.get(u.key); if (!p) return u;
  p.qty--; if (u.foil && p.foil > 0) p.foil--; if (p.foil > p.qty) p.foil = p.qty; if (p.qty <= 0) pending.delete(u.key); return u;
}
let audio = null;
function beep() {
  if (!prefs().sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.0001, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.14);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.15);
  } catch { /* no audio available */ }
}
const thumb = (e, w = 36, hh = 50) => { const r = cat.printings(e.name).find((x) => { const c = cat.rowInfo(x); return c.set === e.set && c.no === e.no; }) ?? cat.printings(e.name)[0]; return r ? h('img', { src: cat.imageUrl(r, 'small'), alt: '', width: w, height: hh, loading: 'lazy', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', class: 'cimg' }) : h('span', { style: `display:inline-block;width:${w}px` }); };

// ---- the review window: what was scanned, with prices, editable quantities and a foil switch per line
export async function openReview() {
  if (!pending.size) { toast('Nothing to review yet'); return 'empty'; }
  try { await cat.loadCatalog(); } catch { /* prices stay blank */ }
  const res = await dialog((close) => {
    const body = h('tbody'), totals = h('div', { class: 'rv-total', 'aria-live': 'polite' }), note = h('p', { class: 'hint' });
    const deckSel = deckSelect('Also add to deck', 'Inventory only', { style: 'width:auto' });
    const refreshBtn = h('button', { class: 'btn sm', type: 'button', onclick: refresh }, 'Refresh prices');
    async function refresh() {
      refreshBtn.disabled = true; refreshBtn.textContent = 'Refreshing…';
      try { const rows = [...pending.values()].flatMap((e) => [unitOf(e, false)?.row, unitOf(e, true)?.row]).filter(Boolean); const n = await cat.refreshPrices([...new Set(rows)]); toast(`Live prices for ${plural(n, 'printing')}`); } catch (er) { toast(er.message); }
      draw(); refreshBtn.disabled = false; refreshBtn.textContent = 'Refresh prices';
    }
    function setQty(e, q) { q = Math.max(0, Math.floor(+q) || 0); e.qty = q; if (e.foil > q) e.foil = q; if (!q) pending.delete(e.key); draw(); }
    function setFoil(e, f) { e.foil = Math.max(0, Math.min(e.qty, Math.floor(+f) || 0)); draw(); }
    function draw() {
      const list = [...pending.values()]; let sum = 0, unpriced = 0, live = false;
      body.replaceChildren(...list.map((e) => {
        const a = unitOf(e, false), b = unitOf(e, true), plain = e.qty - e.foil, total = (a ? a.cents * plain : 0) + (b ? b.cents * e.foil : 0);
        sum += total; unpriced += (a ? 0 : plain) + (b ? 0 : e.foil); live ||= !!(a?.live || b?.live);
        const qin = h('input', { class: 'input rv-q', type: 'number', min: 0, max: 999, value: e.qty, 'aria-label': `Quantity of ${e.name}`, onchange: (ev) => setQty(e, ev.target.value) });
        const foilBtn = h('button', { class: 'btn sm foilbtn', type: 'button', 'aria-pressed': String(e.foil === e.qty && e.qty > 0), title: 'Foil', 'aria-label': `Foil: ${e.name}`, onclick: () => setFoil(e, e.foil === e.qty ? 0 : e.qty) }, icon('star'), 'Foil');
        return h('tr', null,
          h('td', { class: 'thumb' }, thumb(e)),
          h('td', null, h('b', null, e.name), h('div', { class: 'row', style: 'gap:6px;margin-top:2px' }, e.sp ? h('span', { class: 'chip c' }, e.sp) : null, h('small', { class: 'mut mono' }, e.set.toUpperCase()))),
          h('td', { class: 'qtycell' }, h('div', { class: 'stepper' },
            h('button', { class: 'btn sm', type: 'button', 'aria-label': `One fewer ${e.name}`, onclick: () => setQty(e, e.qty - 1) }, icon('minus')), qin,
            h('button', { class: 'btn sm', type: 'button', 'aria-label': `One more ${e.name}`, onclick: () => setQty(e, e.qty + 1) }, icon('plus')))),
          h('td', { class: 'foilcell' }, h('div', { class: 'foilwrap' }, foilBtn,
            e.qty > 1 ? h('label', { class: 'hint foilcount' }, 'Foil copies', h('input', { class: 'input rv-q', type: 'number', min: 0, max: e.qty, value: e.foil, 'aria-label': `Number of foil copies of ${e.name}`, onchange: (ev) => setFoil(e, ev.target.value) })) : null)),
          h('td', { class: 'num mono' }, e.foil === e.qty ? money(b?.cents) : money(a?.cents), e.foil > 0 && e.foil < e.qty && b ? h('small', { class: 'mut', style: 'display:block' }, `foil ${money(b.cents)}`) : null),
          h('td', { class: 'num mono' }, (a ? plain : 0) + (b ? e.foil : 0) > 0 ? money(total) : '–'),
          h('td', null, h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `Remove ${e.name} from the list`, onclick: () => setQty(e, 0) }, icon('trash'))));
      }));
      const n = list.reduce((x, e) => x + e.qty, 0), f = list.reduce((x, e) => x + e.foil, 0);
      totals.replaceChildren(h('span', null, `${plural(n, 'card')}${f ? ` (${f} foil${f === 1 ? '' : 's'})` : ''}, ${plural(list.length, 'different card')}`), h('b', { class: 'mono' }, `Estimated ${money(sum)}`));
      note.textContent = `Price = cheapest printing with the same treatment, since the set is only a best guess. Scryfall estimate (${live ? 'live where refreshed, otherwise ' : ''}snapshot ${cat.snapshotDate?.() ?? ''}).${unpriced ? ` ${plural(unpriced, 'copy', 'copies')} without a price.` : ''}`;
      addBtn.disabled = !n; addBtn.replaceChildren(icon('plus'), n ? `Add ${plural(n, 'card')} to inventory` : 'Nothing to add');
      if (!list.length && d0()) d0().close();
    }
    const d0 = () => body.closest('dialog');
    const addBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => {
      const list = [...pending.values()], n = list.reduce((x, e) => x + e.qty, 0); if (!n) return;
      const v = col.collectionValue(list.map((e) => ({ ...e, pin: false })));
      col.addEntries(list.map((e) => ({ name: e.name, sp: e.sp, set: e.set, no: e.no, qty: e.qty, foil: e.foil })), { deck: opts.deck || undefined, binder: opts.binder || undefined });
      pending.clear(); undo.length = 0; close('added');
      toast(`Added ${plural(n, 'card')} (about ${money(v.cents)})${opts.binder ? ` to ${opts.binder}` : ''}${opts.deck ? ` and to ${opts.deck}` : ''}`);
    } });
    queueMicrotask(() => { body.closest('dialog')?.classList.add('review'); draw(); });
    return h('div', { class: 'rv' }, h('h2', null, 'Scanned cards'),
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, 'Check the list, fix quantities that scanned twice, and mark foils. Nothing is saved to your inventory until you press Add.'),
      h('div', { class: 'tablewrap rv-wrap' }, h('table', null, h('caption', { class: 'sr' }, 'Scanned cards'),
        h('thead', null, h('tr', null, h('th', { class: 'thumb' }, h('span', { class: 'sr' }, 'Image')), h('th', null, 'Card'), h('th', null, 'Quantity'), h('th', null, 'Foil'), h('th', { class: 'num' }, 'Each'), h('th', { class: 'num' }, 'Total'), h('th', null, h('span', { class: 'sr' }, 'Remove')))), body)),
      totals, note,
      h('div', { class: 'row', style: 'justify-content:space-between;margin-top:6px' }, h('span', { class: 'row' }, binderSelect('Add the scanned cards to binder'), deckSel), refreshBtn),
      h('div', { class: 'acts' },
        h('button', { class: 'btn danger', type: 'button', onclick: () => { pending.clear(); undo.length = 0; close('discarded'); toast('Discarded the scanned list'); } }, 'Discard all'),
        h('button', { class: 'btn', type: 'button', onclick: () => close('keep') }, 'Keep scanning'), addBtn));
  }, { wide: true, label: 'Scanned cards' });
  return res;
}

export function scanner(root) {
  let stream = null, session = null, dead = false;
  const video = h('video', { autoplay: true, playsinline: true, muted: true, 'aria-label': 'Camera preview' });
  const overlay = h('canvas', { 'aria-hidden': 'true' });
  const bar = h('i'), progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, hidden: true }, bar);
  const phText = h('p', { role: 'status', 'aria-live': 'polite' });
  const stage = h('div', { class: 'stage' }, video, overlay, h('div', { class: 'ph' }, icon('scan'), phText, progress), h('div', { class: 'live-tag' }, h('i'), 'LIVE'));
  const msg = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite', style: 'min-height:20px' });
  const startBtn = h('button', { class: 'btn primary block', onclick: toggle }, icon('camera'), 'Start camera');
  const v = { session: h('b', null, scannedTotal), inv: h('b', null, db.stats().total), pend: h('b', null, pendingCount()), last: h('b', { class: 'sm' }, lastCard), fps: h('span', null, '—'), view: h('span', null, '0'), ms: h('span', null, '—'), be: h('span', null, '—') };
  const list = h('div', { class: 'recent' });
  const reviewBtn = h('button', { class: 'btn primary', type: 'button', onclick: review }), undoBtn = h('button', { class: 'btn', type: 'button', onclick: doUndo }, icon('undo'), 'Undo last');
  const banner = h('div', { class: 'callout', role: 'status', hidden: true });

  const idle = () => { phText.replaceChildren('Press Start camera, then hold cards under it.', h('br'), 'Fanned and overlapping cards are fine.'); progress.hidden = true; };
  const status = (text, f) => { phText.textContent = text + (f ? ` ${Math.round(f * 100)} %` : '…'); progress.hidden = false; bar.style.width = (f ? Math.round(f * 100) : 4) + '%'; progress.setAttribute('aria-valuenow', Math.round((f || 0) * 100)); };
  idle();

  function sync() {
    const n = pendingCount(); v.session.textContent = scannedTotal; v.pend.textContent = n; v.inv.textContent = db.stats().total; v.last.textContent = lastCard;
    reviewBtn.replaceChildren(icon('list'), n ? `Review (${n})` : 'Review'); reviewBtn.disabled = !n; undoBtn.disabled = !undo.length;
    banner.hidden = !n || !!stream; banner.replaceChildren(h('span', null, `${plural(n, 'scanned card')} waiting for your review.`), h('button', { class: 'btn sm primary', type: 'button', onclick: review }, 'Review now'));
    const items = [...pending.values()].reverse().slice(0, 12);
    list.replaceChildren(...(items.length ? items.map((e) => h('div', { class: 'rrow' }, h('b', null, e.name), e.sp ? h('span', { class: 'chip c' }, e.sp) : null, e.foil ? h('span', { class: 'chip d' }, e.foil === e.qty ? 'foil' : `${e.foil} foil`) : null, h('small', null, e.set.toUpperCase()), h('span', { class: 'chip a rq' }, '×' + e.qty))) : [h('p', { class: 'hint' }, 'Nothing scanned yet. Cards you scan appear here.')]));
  }
  function logRow(rec) { addPending(rec); beep(); sync(); }
  function doUndo() { const u = undoLast(); if (u) { scannedTotal = Math.max(0, scannedTotal - 1); toast('Removed the last scan'); } sync(); }
  async function review() { if (stream) stop(); const r = await openReview(); sync(); if (r === 'added') msg.textContent = 'Added to your inventory.'; }
  async function ready() { const eng = await loadEngine({ backend: prefs().backend, threads: prefs().threads, onStatus: status }); v.be.textContent = eng.backend; if (eng.note) msg.textContent = eng.note; return eng; }

  async function toggle() {
    if (stream) { stop(); if (pending.size) review(); return; }
    startBtn.disabled = true; msg.textContent = '';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open a camera here (it needs https or localhost).');
      const eng = await ready(); if (dead) return;
      status('Opening the camera', 0); const cam = prefs().camera;
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...(cam ? { deviceId: { exact: cam } } : { facingMode: 'environment' }), width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = stream; await video.play().catch(() => {});
      stage.classList.add('live'); startBtn.className = 'btn danger block'; startBtn.replaceChildren(icon('x'), 'Stop camera and review'); sync();
      session = new ScanSession({ engine: eng, video, overlay, conf: prefs().conf, onLog: logRow, onStats: (s) => {
        if (s.error) { msg.textContent = s.error; return; }
        v.fps.textContent = s.fps.toFixed(1); v.view.textContent = s.cards; v.ms.textContent = s.recMs ? Math.round(s.recMs) + ' ms' : '—'; } });
      session.start();
    } catch (e) {
      stream?.getTracks().forEach((x) => x.stop()); stream = null; idle();
      msg.textContent = e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera in the address bar and try again.' : e.name === 'NotFoundError' ? 'No camera was found.' : String(e.message || e);
    }
    startBtn.disabled = false;
  }
  function stop() {
    session?.stop(); session = null; overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height); stream?.getTracks().forEach((x) => x.stop()); stream = null; video.srcObject = null;
    stage.classList.remove('live', 'still'); startBtn.className = 'btn primary block'; startBtn.replaceChildren(icon('camera'), 'Start camera'); idle(); sync();
  }

  async function imageTest() {
    const file = await new Promise((resolve) => { const i = h('input', { type: 'file', accept: 'image/*', onchange: () => resolve(i.files[0] || null) }); i.addEventListener('cancel', () => resolve(null)); i.click(); });
    if (!file) return; if (stream) stop(); msg.textContent = '';
    try {
      const eng = await ready(); if (dead) return;
      const bmp = await createImageBitmap(file); overlay.width = bmp.width; overlay.height = bmp.height;
      const c = overlay.getContext('2d'); c.drawImage(bmp, 0, 0); stage.classList.add('still');
      status('Scanning the image', 0);
      const t0 = performance.now(), res = await scanStill(eng, bmp, bmp.width, bmp.height, prefs().conf), ms = performance.now() - t0;
      const fs = Math.max(14, Math.round(bmp.width / 62)); let named = 0;
      c.lineJoin = 'round'; c.font = `600 ${fs}px 'Fira Sans', sans-serif`; c.textBaseline = 'bottom';
      for (const r of res) {
        const colr = r.sure ? '#4ade80' : '#fbbf24'; c.lineWidth = Math.max(2, bmp.width / 480); c.strokeStyle = colr; c.beginPath();
        r.corners.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke();
        const text = r.sure ? r.label : `not sure (${eng.matcher.cards.name[r.row]}? ${r.info.cos.toFixed(2)})`;
        const x = Math.max(0, Math.min(...r.corners.map((p) => p[0]))), y = Math.min(...r.corners.map((p) => p[1])), w = c.measureText(text).width + fs * 0.8, ty = y < fs * 1.6 ? y + fs * 1.6 : y - fs * 0.3;
        c.fillStyle = 'rgba(2,6,23,.85)'; c.fillRect(x, ty - fs * 1.15, w, fs * 1.35); c.fillStyle = colr; c.fillText(text, x + fs * 0.4, ty);
        if (r.sure) { logRow(eng.matcher.record(r.row)); named++; }
      }
      progress.hidden = true; phText.textContent = '';
      msg.textContent = `${plural(res.length, 'card')} found, ${named} named, ${res.length - named} not sure (not added). ${Math.round(ms)} ms on ${eng.backend}.`;
      if (named) review(); else toast('No card was named with enough certainty');
    } catch (e) { msg.textContent = String(e.message || e); stage.classList.remove('still'); }
  }

  const runOn = h('select', { class: 'input', id: 'runon', onchange: () => {
    setPrefs({ backend: runOn.value });
    if (engineLoaded()) { stop(); toast('Switching: reloading the page'); setTimeout(() => location.reload(), 400); }   // the runtime picks its backend once per page load
    else v.be.textContent = BACKENDS.find(([x]) => x === runOn.value)[1].split(' (')[0] + ' (starts with the camera)';
  } }, BACKENDS.map(([val, l]) => h('option', { value: val, selected: prefs().backend === val }, l)));
  webgpuAvailable().then((ok) => { if (!ok) { const o = [...runOn.options].find((x) => x.value === 'webgpu'); o.textContent += ' - not available in this browser'; } });
  const kv = (k, el) => h('div', { class: 'kv' }, h('span', null, k), el);
  const dest = deckSelect('Scanning into', 'Inventory', { id: 'dest' });
    const soundChk = h('input', { type: 'checkbox', checked: prefs().sound, onchange: (e) => { setPrefs({ sound: e.target.checked }); if (e.target.checked) beep(); } });
  const camBtn = h('button', { class: 'btn block', type: 'button', onclick: async () => { try { const m = await import('../camcheck.js'); await m.openCameraCheck(); } catch (e) { toast('Camera check is not available: ' + (e.message || e)); } } }, icon('camera'), 'Check my camera');
  const firstRun = h('div', { class: 'callout', role: 'region', 'aria-label': 'First time', hidden: true }, h('span', null, 'First time here? Check that your camera is sharp enough by scanning a card the app knows.'), h('button', { class: 'btn sm primary', type: 'button', onclick: () => camBtn.click() }, 'Check camera'));
  import('../camcheck.js').then((m) => { firstRun.hidden = !m.shouldPromptFirstRun(); }, () => { camBtn.hidden = true; });

  root.replaceChildren(h('div', { class: 'page' },
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Scanner'), h('p', null, 'Hold cards under the camera. Scanned cards collect in a list; when you stop, you review prices, quantities and foils before they are added. Everything runs in your browser; nothing is uploaded.'))),
    banner, firstRun,
    h('div', { class: 'grid side-right' },
      h('section', { class: 'card stick', 'aria-label': 'Camera' }, h('div', { class: 'bd', style: 'display:grid;gap:12px' }, stage, msg)),
      h('div', { class: 'grid' },
        h('section', { class: 'card', 'aria-label': 'Controls' }, h('div', { class: 'bd', style: 'display:grid;gap:14px' },
          h('label', { class: 'field' }, h('span', null, 'Run the scanner on'), runOn),
          h('label', { class: 'field' }, h('span', null, 'Scanning into'), dest),
          h('label', { class: 'field' }, h('span', null, 'Into binder'), binderSelect('Scanned cards go into binder')),
          h('label', { class: 'check' }, soundChk, 'Beep when a card is recognised'),
          startBtn, h('div', { class: 'row' }, reviewBtn, undoBtn),
          h('button', { class: 'btn block', onclick: imageTest }, icon('image'), 'Scan an image file'), camBtn,
          h('p', { class: 'hint' }, 'No camera? Pick a photo of cards to try the scanner. Changing "Run the scanner on" after it has run reloads the page. The first start downloads about 110 MB, which your browser then caches.'))),
        h('div', { class: 'stats', style: 'margin:0' }, h('div', { class: 'stat a' }, h('small', null, 'Scanned this session'), v.session), h('div', { class: 'stat c' }, h('small', null, 'Waiting for review'), v.pend), h('div', { class: 'stat b' }, h('small', null, 'In inventory'), v.inv), h('div', { class: 'stat d' }, h('small', null, 'Last card'), v.last)),
        h('section', { class: 'card', 'aria-label': 'Live status' }, h('div', { class: 'hd' }, icon('cpu'), h('h2', null, 'Live')), h('div', { class: 'bd' }, kv('Frames per second', v.fps), kv('Cards in view', v.view), kv('Time per card', v.ms), kv('Runs on', v.be))),
        h('section', { class: 'card', 'aria-label': 'This session' }, h('div', { class: 'hd' }, icon('list'), h('h2', null, 'This session')), h('div', { class: 'bd' }, list))))));
  sync();
  return { stop: () => { dead = true; stop(); } };
}
