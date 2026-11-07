// The "New deck" dialog, shared by the Decks page and the Scanner: asks for a name and how many cards the deck will have.
import { h, dialog } from './ui.js';

export const SIZES = [[40, '40 cards', 'Limited: draft and sealed'], [60, '60 cards', 'Constructed: Standard, Modern, Pioneer'], [100, '100 cards', 'Commander: includes the commander']];

// Resolves { name, size }, or null when cancelled.
export function newDeckDialog({ text } = {}) {
  return dialog((close) => {
    const name = h('input', { class: 'input', placeholder: 'My deck', autocomplete: 'off', autofocus: true, required: true, 'aria-label': 'Deck name' });
    let size = 60;
    const opts = SIZES.map(([n, t, sub]) => h('label', { class: 'xp-opt' }, h('input', { type: 'radio', name: 'dsize', value: n, checked: n === size, onchange: () => { size = n; } }), h('span', null, h('strong', null, t), h('span', { class: 'hint' }, sub))));
    return h('form', { onsubmit: (e) => { e.preventDefault(); if (name.value.trim()) close({ name: name.value.trim(), size }); } },
      h('h2', null, 'New deck'), text ? h('p', null, text) : null, h('label', { class: 'field' }, h('span', null, 'Deck name'), name),
      h('fieldset', { class: 'xp-set' }, h('legend', { class: 'hint' }, 'How many cards will it have?'), opts),
      h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create')));
  }, { label: 'New deck' });
}
