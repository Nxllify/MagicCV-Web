// Quick import: parse a pasted deck list the way Moxfield / Archidekt / Arena / MTGO export it.
//   "4 Lightning Bolt"   "4x Lightning Bolt"   "1 Sol Ring (CMM) 400"   "1x Sol Ring (cmm) 400 [Ramp] ^Foil^"   "1 Island *F*"
//   "SB: 2 Negate"   headers: Deck / Commander / Companion / Sideboard / Maybeboard   comments: // and #
const ZONES = { deck: 'main', main: 'main', mainboard: 'main', commander: 'main', commanders: 'main', companion: 'main',
  sideboard: 'side', side: 'side', sb: 'side', maybeboard: 'maybe', maybe: 'maybe', considering: 'maybe' };
const HEADER = /^(?:\/\/|#)?\s*(deck|main(?:board)?|commanders?|companion|sideboard|side|sb|maybe(?:board)?|considering)\s*(?:\(\d+\))?\s*:?\s*$/i;

export function cleanName(raw) {
  return raw
    .replace(/\s*\^[^^]*\^/g, '')                    // ^Foil^ (Archidekt)
    .replace(/\s*\[[^\]]*\]/g, '')                   // [Category]
    .replace(/\s*\*[A-Za-z]+\*/g, '')                // *F* *E* (Moxfield)
    .replace(/\s+#\S+/g, '')                         // #tags
    .replace(/\s+\([A-Za-z0-9]{2,6}\)(?:\s+[\w★-]+)?\s*$/, '')   // (SET) 123
    .replace(/\s+\((?:foil|etched|nonfoil)\)\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

export function parseDeckList(text) {
  const zones = { main: {}, side: {}, maybe: {} };
  const lines = text.replace(/\r/g, '').split('\n');
  const explicit = lines.some((l) => l.trim() && HEADER.test(l.trim()));
  let zone = 'main', blocks = 0, sawCard = false, pendingBlank = false;
  const bad = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (sawCard) pendingBlank = true; continue; }
    const hm = HEADER.exec(line);
    if (hm) { zone = ZONES[hm[1].toLowerCase()] || 'main'; pendingBlank = false; continue; }
    if (/^(\/\/|#)/.test(line)) continue;           // comment
    if (pendingBlank && !explicit) { blocks++; zone = blocks === 1 ? 'side' : 'main'; }   // MTGO style: a blank line, then the sideboard
    pendingBlank = false;
    let z = zone, body = line;
    const sb = /^SB:\s*(.*)$/i.exec(body);
    if (sb) { z = 'side'; body = sb[1]; }
    const m = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(body);
    const qty = m ? +m[1] : 1, name = cleanName(m ? m[2] : body);
    if (!name || !/[A-Za-z]/.test(name) || qty <= 0 || qty > 999) { bad.push(line); continue; }
    zones[z][name] = (zones[z][name] || 0) + qty; sawCard = true;
  }
  const count = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { zones, bad, main: count(zones.main), side: count(zones.side), maybe: count(zones.maybe), uniqueMain: Object.keys(zones.main).length };
}
