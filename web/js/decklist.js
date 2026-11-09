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
    .replace(/\s+\/{1,2}\s+/g, ' // ')                // "A / B" and "A // B" are the same card (catalog name: A // B)
    .replace(/\s+/g, ' ').trim();
}

// Archidekt writes categories as "[Ramp]" (a deck-only board as "[Maybeboard{noDeck}]"), Moxfield writes tags as "#Ramp".
// A category named like a board moves the card to that board; any other one is a tag. Returns { zone, tags } for one line.
const BOARD_CATEGORY = { commander: 'commander', commanders: 'commander', sideboard: 'side', maybeboard: 'maybe' };
function categories(body, zone) {
  const tags = [];
  for (const m of body.matchAll(/\[([^\]]+)\]/g)) {
    const t = m[1].replace(/\{[^}]*\}/g, '').trim(), b = BOARD_CATEGORY[t.toLowerCase()];
    if (b) zone = b; else if (t) tags.push(t);
  }
  for (const m of body.matchAll(/(?:^|\s)#([^\s#]+)/g)) tags.push(m[1].replace(/_/g, ' '));
  return { zone, tags: [...new Set(tags)] };
}

// zones.main also holds the commander cards (the classic site has no commander board); `commander` lists them on their own
// and `tags` maps a card name to its categories / tags. A card that appears in several zones keeps all its tags.
export function parseDeckList(text) {
  const zones = { main: {}, side: {}, maybe: {} }, commander = {}, tags = {};
  const lines = text.replace(/\r/g, '').split('\n');
  const explicit = lines.some((l) => l.trim() && HEADER.test(l.trim()));
  let zone = 'main', blocks = 0, sawCard = false, pendingBlank = false, inCmd = false;
  const bad = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (sawCard) pendingBlank = true; continue; }
    const hm = HEADER.exec(line);
    if (hm) { zone = ZONES[hm[1].toLowerCase()] || 'main'; inCmd = /^commanders?$/i.test(hm[1]); pendingBlank = false; continue; }
    if (/^(\/\/|#)/.test(line)) continue;           // comment
    if (pendingBlank && !explicit) { blocks++; zone = blocks === 1 ? 'side' : 'main'; }   // MTGO style: a blank line, then the sideboard
    pendingBlank = false;
    let z = zone, body = line, cmd = inCmd;
    const sb = /^SB:\s*(.*)$/i.exec(body);
    if (sb) { z = 'side'; body = sb[1]; cmd = false; }
    const m = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(body);
    const qty = m ? +m[1] : 1, raw2 = m ? m[2] : body, name = cleanName(raw2);
    if (!name || !/[A-Za-z]/.test(name) || qty <= 0 || qty > 999) { bad.push(line); continue; }
    const cat = categories(raw2, cmd ? 'commander' : z);
    if (cat.zone === 'commander') { cmd = true; z = 'main'; } else z = cat.zone;      // a board category moves the card; commander cards also stay in zones.main
    zones[z][name] = (zones[z][name] || 0) + qty; if (cmd) commander[name] = (commander[name] || 0) + qty; sawCard = true;
    if (cat.tags.length) tags[name] = [...new Set([...(tags[name] || []), ...cat.tags])];
  }
  const count = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { zones, commander, tags, bad, main: count(zones.main), side: count(zones.side), maybe: count(zones.maybe), uniqueMain: Object.keys(zones.main).length };
}
