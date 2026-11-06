// Small DOM helpers. All text goes through textContent / createTextNode: card names from an imported CSV are never parsed as HTML.
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') throw new Error('h(): no raw html');   // never used on purpose
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

const SVG = {   // 24x24 outline icons
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  cards: '<rect x="3" y="6" width="12" height="15" rx="2"/><path d="M7 3h11a3 3 0 0 1 3 3v11"/>',
  decks: '<rect x="4" y="8" width="13" height="12" rx="2"/><path d="M7 5h13v12M10 2h12"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3.5"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  box: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.7 0-.9.7-1.6 1.7-1.6H16a5 5 0 0 0 5-5C21 6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = SVG[name] || '';            // static strings above, no user data
  return s;
}

export function panel(title, iconName, body, extra) {
  return h('section', { class: 'panel' }, h('div', { class: 'hd' }, iconName && icon(iconName), h('span', { class: 'grow' }, title), extra), body);
}

let toastTimer;
export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2600);
}

export function modal({ title, text, fields = [], ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const inputs = fields.map((f) => h('input', { type: f.type || 'text', placeholder: f.placeholder || '', autocomplete: 'off' }));
    const close = (v) => { scrim.remove(); resolve(v); };
    const okBtn = h('button', { class: 'btn' + (danger ? ' danger' : ''), onclick: () => close(inputs.length ? inputs.map((i) => i.value) : true) }, ok);
    const scrim = h('div', { class: 'scrim', onclick: (e) => e.target === scrim && close(null) },
      h('div', { class: 'modal', role: 'dialog' }, h('h3', null, title), text && h('p', null, text),
        inputs.length ? h('div', { class: 'fields' }, inputs) : null,
        h('div', { class: 'acts' }, cancel && h('button', { class: 'btn line', onclick: () => close(null) }, cancel), okBtn)));
    scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && inputs.length) okBtn.click(); });
    document.getElementById('overlay').append(scrim);
    (inputs[0] || okBtn).focus();
  });
}

export function dialog(build) {      // build(close) -> element; resolves with whatever close(value) gets
  return new Promise((resolve) => {
    const close = (v) => { scrim.remove(); resolve(v); };
    const scrim = h('div', { class: 'scrim', onclick: (e) => e.target === scrim && close(null) }, build(close));
    scrim.addEventListener('keydown', (e) => e.key === 'Escape' && close(null));
    document.getElementById('overlay').append(scrim);
  });
}

export function download(name, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept, onchange: () => resolve(i.files[0] ? i.files[0].text() : null) });
    i.click();
  });
}
