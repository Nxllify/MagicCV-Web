import * as db from '../../../web/js/store.js';
import { engineLoaded, webgpuAvailable } from '../../../web/js/scan/engine.js';
import { prefs, setPrefs, THEMES, BACKENDS } from '../prefs.js';
import { h, icon, toast, confirmDialog } from '../ui.js';
import { startTour, setTourHidden } from '../tour.js';

export function settingsPage(root) {
  const p = prefs();
  const themes = h('div', { class: 'themes', role: 'group', 'aria-label': 'Color theme' }, THEMES.map((t) =>
    h('button', { class: 'theme', type: 'button', 'aria-pressed': String(t.id === p.theme), onclick: (e) => { setPrefs({ theme: t.id }); for (const b of themes.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } },
      h('span', { class: 'sw', 'aria-hidden': 'true' }, t.swatch.map((c) => h('i', { style: `background:${c}` }))), h('span', null, t.name, h('small', null, t.note)))));
  const row = (id, title, sub, ctl) => h('div', { class: 'setrow' }, h('label', { class: 't', for: id }, title, h('small', null, sub)), h('div', { class: 'ctl' }, ctl));
  const reloadIfLoaded = () => { if (engineLoaded()) { toast('Switching: reloading the page'); setTimeout(() => location.reload(), 400); } };

  const cams = h('select', { class: 'input', id: 'cam', onchange: (e) => setPrefs({ camera: e.target.value }) }, h('option', { value: '' }, 'Default camera'));
  navigator.mediaDevices?.enumerateDevices?.().then((ds) => ds.filter((d) => d.kind === 'videoinput').forEach((d, i) => cams.append(h('option', { value: d.deviceId, selected: prefs().camera === d.deviceId }, d.label || `Camera ${i + 1}`)))).catch(() => {});
  const confOut = h('output', { class: 'mono', for: 'conf' }, p.conf.toFixed(2));
  const conf = h('input', { type: 'range', id: 'conf', min: 0.15, max: 0.6, step: 0.01, value: p.conf, oninput: (e) => { confOut.textContent = (+e.target.value).toFixed(2); setPrefs({ conf: +e.target.value }); } });
  const backend = h('select', { class: 'input', id: 'backend', onchange: (e) => { setPrefs({ backend: e.target.value }); reloadIfLoaded(); } }, BACKENDS.map(([v, l]) => h('option', { value: v, selected: p.backend === v }, l)));
  webgpuAvailable().then((ok) => { if (!ok) { const o = [...backend.options].find((x) => x.value === 'webgpu'); o.textContent += ' - not available in this browser'; } });
  const threads = h('select', { class: 'input', id: 'threads', onchange: (e) => { setPrefs({ threads: e.target.value }); reloadIfLoaded(); } }, [['auto', 'Automatic'], ['1', '1'], ['2', '2'], ['4', '4'], ['8', '8']].map(([v, l]) => h('option', { value: v, selected: String(p.threads) === v }, l)));
  const empty = async () => { if (await confirmDialog({ title: 'Empty the database?', text: 'All scanned cards and decks are removed. Export first if you want a copy.', ok: 'Empty', danger: true })) { db.clearAll(); toast('Database emptied'); } };

  root.replaceChildren(h('div', { class: 'page narrow', style: 'max-width:900px' },
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Settings'), h('p', null, 'Saved in this browser.'))),
    h('div', { class: 'grid' },
      h('section', { class: 'card' }, h('div', { class: 'hd' }, icon('palette'), h('h2', null, 'Color theme')), h('div', { class: 'bd' }, themes)),
      h('section', { class: 'card' }, h('div', { class: 'hd' }, icon('scan'), h('h2', null, 'Scanner')),
        row('cam', 'Camera', 'Used the next time you press Start camera.', cams),
        row('conf', 'Detection confidence', 'Lower finds more cards but also more false boxes. Default 0.30.', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, conf, confOut)),
        row('backend', 'Run the scanner on', 'The graphics card (WebGPU) can be much faster. Automatic uses it when the browser has it. Applies the next time the scanner loads.', backend),
        row('threads', 'CPU threads', 'Only for the CPU option. Automatic uses up to 4. Needs cross-origin isolation, which turns on by itself after one reload.', threads)),
      h('section', { class: 'card' }, h('div', { class: 'hd' }, icon('db'), h('h2', null, 'Data')),
        h('div', { class: 'setrow' }, h('div', { class: 't' }, 'Empty the database', h('small', null, 'Removes all cards and decks (keeps your settings).')), h('button', { class: 'btn danger', onclick: empty }, 'Empty'))),
      h('section', { class: 'card' }, h('div', { class: 'hd' }, icon('star'), h('h2', null, 'Help')),
        h('div', { class: 'setrow' }, h('div', { class: 't' }, 'Show the tour', h('small', null, 'A quick walk through the main features.')), h('button', { class: 'btn', onclick: () => { setTourHidden(false); startTour(); } }, 'Show tour'))))));
  return {};
}
