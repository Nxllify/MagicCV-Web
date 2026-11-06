import * as db from '../store.js';
import { h, panel, toast, modal } from '../ui.js';
import { THEMES, BACKENDS, settings, set } from '../settings.js';
import { engineLoaded, webgpuAvailable } from '../scan/engine.js';

export function settingsPage(root) {
  const s = settings();
  const themes = h('div', { class: 'themes' }, THEMES.map((t) => h('button', { class: 'theme' + (t.id === s.theme ? ' on' : ''), onclick: () => { set({ theme: t.id }); settingsPage(root); } },
    h('span', { class: 'sw' }, t.swatch.map((c) => h('i', { style: `background:${c}` }))), t.name)));
  const row = (title, sub, control) => h('div', { class: 'setrow' }, h('div', { class: 't' }, title, sub && h('small', null, sub)), control);
  const toggle = (key, title, sub) => row(title, sub, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!settings()[key], onchange: (e) => set({ [key]: e.target.checked }) })));

  const conf = h('span', { style: 'min-width:34px;text-align:right' }, s.conf.toFixed(2));
  const cams = h('select', { onchange: (e) => set({ camera: e.target.value }) }, h('option', { value: '' }, 'Default camera'));
  navigator.mediaDevices?.enumerateDevices?.().then((ds) => ds.filter((d) => d.kind === 'videoinput').forEach((d, i) =>
    cams.append(h('option', { value: d.deviceId, selected: settings().camera === d.deviceId }, d.label || `Camera ${i + 1}`)))).catch(() => {});

  const changed = () => { if (engineLoaded()) { toast('Switching: reloading the page'); setTimeout(() => location.reload(), 400); } };
  const backend = h('select', { onchange: (e) => { set({ backend: e.target.value }); changed(); } }, BACKENDS.map(([v, l]) => h('option', { value: v, selected: s.backend === v }, l)));
  webgpuAvailable().then((ok) => { if (!ok) { const o = [...backend.options].find((x) => x.value === 'webgpu'); o.textContent += ' - not available in this browser'; } });
  const threadsSel = h('select', { onchange: (e) => { set({ threads: e.target.value }); changed(); } }, [['auto', 'Automatic'], ['1', '1'], ['2', '2'], ['4', '4'], ['8', '8']].map(([v, l]) => h('option', { value: v, selected: String(s.threads) === v }, l)));
  const empty = async () => {
    if (await modal({ title: 'Empty the database?', text: 'All scanned cards and decks are removed. Export first if you want a copy.', ok: 'Empty', danger: true })) { db.clearAll(); toast('Database emptied'); }
  };

  root.replaceChildren(h('div', { class: 'stack', style: 'max-width:980px;margin:0 auto' },
    panel('Color theme', 'palette', h('div', { class: 'bd' }, themes)),
    panel('Appearance', 'gear', h('div', null, toggle('snow', 'Falling dots in the background', 'Turn off for a plain background (also saves battery).'))),
    panel('Scanner', 'scan', h('div', null,
      row('Camera', 'Used the next time you press Start camera.', cams),
      row('Detection confidence', 'Lower finds more cards but also more false boxes. Default 0.30.', h('span', { class: 'row' },
        h('input', { type: 'range', min: .15, max: .6, step: .01, value: s.conf, oninput: (e) => { conf.textContent = (+e.target.value).toFixed(2); set({ conf: +e.target.value }); } }), conf)),
      row('Run the scanner on', 'Graphics card (WebGPU) can be much faster; Automatic uses it when the browser has it. Applies the next time the scanner loads.', backend),
      row('CPU threads', 'Only for the CPU (WASM) option. Automatic uses up to 4. Needs the page to be cross-origin isolated, which happens on its own after one reload.', threadsSel))),
    panel('Data', 'db', h('div', null,
      row('Empty the database', 'Removes all cards and decks (keeps your settings).', h('button', { class: 'btn danger sm', onclick: empty }, 'Empty'))))));
  return {};
}
