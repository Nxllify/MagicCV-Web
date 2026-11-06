# MagicCV web2: the redesigned site

A second design of the website with **the same functions** as the classic one in `../web/`, built with the UI/UX Pro Max skill (see [DESIGN.md](DESIGN.md)). The classic site is unchanged and still works. Plain HTML, CSS and JavaScript (ES modules), no build step.

## Run it

Serve the **repo root** (web2 shares the scanner engine, models and card data with `web/`, so both folders must be reachable):

```
python -m http.server 8000
```

then open http://localhost:8000 (a start page links both sites) or go straight to http://localhost:8000/web2/. Camera access needs `localhost` or https. The first load registers `../coi-serviceworker.js` and reloads once; that is what lets the model use several threads.

## What is different from the classic site

| | Classic (`web/`) | New (`web2/`) |
|---|---|---|
| Layout | Top tab bar (Genshin Optimizer style) | Sidebar on desktop, top bar plus bottom navigation on phones |
| Look | Navy panels, falling dots | "Dark Mode (OLED)" design system: black surfaces, one accent, Fira Sans / Fira Code (self-hosted), no particles |
| Inventory | Click rows to select | Checkbox column, select all, sticky bulk-action bar (Add to deck, Remove copy), sort buttons with `aria-sort` |
| Dialogs | Custom overlay | Native `<dialog>`: focus trap, Escape, focus returns to the opener |
| Menus and toasts | Plain | Keyboard operable menu (arrows, Escape), toasts in a polite live region, skip link, visible focus rings, 44 px touch targets |
| Themes | 7 | 7 (OLED Dark, Midnight Blue, Vaporwave, Crimson, Amber, Violet, Light), saved separately |

## Same functions

Price Search (empty for now), Inventory (search, combine copies, special prints only, group by set or print, sort, CSV import and export, bulk remove and add to deck), Decks (new, delete, +/-, add card, copy and export, **quick import** from Moxfield / Archidekt / Arena / MTGO text or a file), **Scanner** (live camera, tracker, log once; "Run the scanner on": Automatic / WebGPU / CPU; image test), Settings (themes, camera, detection confidence, backend, CPU threads, data reset), Database menu with a sample sign-in and JSON export / import.

## What is shared with `web/`

- `web/js/store.js`: the database. Both sites read and write the same `localStorage` key, so your cards and decks show up in both. (Settings and themes are separate: `magiccv2.settings.1`.)
- `web/js/decklist.js`: the deck-list parser. `web/js/scan/*`: detector, warp, matcher, tracker, session, engine. `web/models/`, `web/data/`, `web/vendor/ort/`: the models, the card database and the model runtime.
- `../coi-serviceworker.js` (repo root): registered from the root so its scope covers `web2/` and the shared runtime under `web/`.

Deploying only `web2/` is therefore not possible: publish the repo root (or move the shared parts into a common folder first).

## Files

`index.html`, `css/style.css` (tokens and themes first, then layout and components), `css/fonts.css` + `fonts/` (Fira Sans, Fira Code, OFL), `js/main.js` (shell, router, Database menu), `js/ui.js` (helpers: icons, dialogs, toasts), `js/prefs.js` (themes, scanner options), `js/pages/*.js`.

## Binders, lists, deck boards and daily prices

- **Binders** (Inventory): folders for the copies you own. A copy (`row.binder`) is in one binder or in none (Unsorted). Chips above the table switch binder; "Select cards" then "Move to binder" moves copies; the Scanner has an "Into binder" picker. The CSV export/import has a `binder` column.
- **Lists** (`#/lists`): cards you want but do not own (wishlist, buylist). They hold card names with a quantity. "Got it" turns one wanted copy into a real copy in a binder. The Decks > Wishlist tab can save what your decks are missing into a list.
- **Deck boards and tags** (Decks): Main deck, Commander, Sideboard and Maybeboard, "Move to..." between them, per-card tags, group by type / mana value / color / tag. Importing a list keeps its Commander, Sideboard and Maybeboard sections and turns Archidekt `[Category]` or Moxfield `#tag` into tags. The main board stays `decks[name]` (so the classic site still works); the other boards and tags live in `deckx[name]` (`web/js/store.js`). Statistics cover main + commander; "needed" counts main + commander + sideboard.
- **Daily prices**: `.github/workflows/update-prices.yml` runs `tools/update_prices.py` every day. It rebuilds `web/data/prices.bin` from Scryfall bulk data and keeps the old file as `prices.prev.bin`, so the Inventory shows each card's change and the collection's change since the previous snapshot. Run it by hand with `python tools/update_prices.py`.
