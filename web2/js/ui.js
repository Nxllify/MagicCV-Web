// DOM helpers for web2. All text goes through textContent / text nodes, never innerHTML with data (card names from imported files stay text).
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (['checked', 'disabled', 'value', 'selected', 'indeterminate'].includes(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

const PATHS = {   // 24x24 outline icons, one stroke style everywhere (no emoji icons)
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  inv: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  decks: '<rect x="4" y="7" width="12" height="14" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v12"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3.5"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12l5 5 9-10"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>', zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.7 0-.9.7-1.6 1.7-1.6H16a5 5 0 0 0 5-5C21 6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', box: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -5)"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 21h14"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};
export function icon(name, label) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i');
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); } else s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[name] || '';           // static strings above, never user data
  return s;
}

// Toasts: a polite live region, auto-dismiss after 4 s.
export function toast(msg) {
  const box = document.getElementById('toasts'); if (!box) return;
  const t = h('div', { class: 'toast' }, msg); box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), 4000);
}

// Dialogs on the native <dialog>: focus is trapped, Escape closes, focus returns to the button that opened it.
// build(close) returns the dialog's children; close(value) resolves (Escape / backdrop resolve null).
export function dialog(build, { wide = false, label = 'Dialog' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const d = h('dialog', { class: wide ? 'wide' : '', 'aria-label': label });
    const close = (v) => { result = v === undefined ? true : v; d.close(); };
    d.append(build(close));
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d); d.showModal();
  });
}
export function confirmDialog({ title, text, ok = 'OK', danger = false }) {
  return dialog((close) => h('form', { onsubmit: (e) => { e.preventDefault(); close(true); } },
    h('h2', null, title), text && h('p', null, text),
    h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
      h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'submit' }, ok))), { label: title });
}
export function promptDialog({ title, text, label, placeholder = '', ok = 'OK', type = 'text' }) {
  return dialog((close) => {
    const input = h('input', { class: 'input', type, placeholder, autofocus: true, autocomplete: 'off', required: true });
    return h('form', { onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) close(input.value.trim()); } },
      h('h2', null, title), text && h('p', null, text), h('label', { class: 'field' }, h('span', null, label), input),
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, ok)));
  }, { label: title });
}

export function download(name, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept, onchange: () => resolve(i.files[0] ? i.files[0].text() : null) });
    i.addEventListener('cancel', () => resolve(null)); i.click();
  });
}
export const fmtTime = (iso) => (iso || '').slice(0, 16).replace('T', ' ');
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
