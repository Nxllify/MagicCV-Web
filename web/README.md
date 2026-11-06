# MagicCV web

The website, in the style of Genshin Optimizer: a dark top tab bar, blue panels, coloured chips, switchable color themes. Plain HTML, CSS and JavaScript (ES modules): **no build step, no npm**, so it can be served from GitHub Pages as is. **The scanner runs in the browser**: nothing is uploaded, the camera frames never leave your computer.

## Run it

```
python -m http.server 8000 --directory web
```

(to run it next to the redesigned site in `../web2/`, serve the repo root instead: `python -m http.server 8000`, then open http://localhost:8000/web/) then open http://localhost:8000 (camera access needs `localhost` or https; opening `index.html` as a file does not work because of ES modules). The first page load registers `coi-serviceworker.js` and reloads once; that is what lets the model use several threads (see below).

## Pages (hash routes, which work on GitHub Pages)

| Tab | Route | What it is |
|---|---|---|
| Price Search | `#/` | The home page. Empty on purpose for now: the layout and a disabled search box. Right column: inventory summary, quick links, clock. |
| Inventory | `#/inventory` | Search, combine copies, special prints only, group by set or print, sortable columns, select cards, remove a copy, add to deck, import `scans.csv` from the desktop scanner, export CSV. |
| Decks | `#/decks` | Deck lists with owned (green) versus needed (red), +/- per card, add card, copy list (Arena / MTGO), export .txt, and **Import**: paste a list from Moxfield, Archidekt, MTG Arena or MTGO (quantities, `4x`, set codes, foil marks, sideboard / commander / maybeboard headers) or load a .txt file; live preview, optional sideboard. |
| Scanner | `#/scanner` | **The real scanner.** Start camera: detects every card, follows it across frames, names it and adds it to the inventory once. "Scan an image file" tests it on a photo without a camera. The **Run the scanner on** dropdown picks Automatic (WebGPU when the browser has it, else CPU), Graphics card (WebGPU) or CPU (WASM); changing it after the scanner has run reloads the page, because the runtime picks its backend once per page load. |
| Settings (gear, top right) | `#/settings` | 7 color themes (Midnight Blue, Vaporwave, Emerald, Crimson, Amber, Slate, Light), falling dots on or off, camera choice, detection confidence, **Run the scanner on** (Automatic / Graphics card (WebGPU) / CPU (WASM)), CPU threads, reset / empty the database. |
| Database (top right) | menu | "Database 1" (this browser), a **sample** sign-in (nothing is sent anywhere), export / import the whole database as .json, reset to sample data. |

## How the scanner works here

Same models and rules as the desktop scanner, minus the SIFT verification step (it does not fit a static site):

1. `js/scan/detector.js`: letterbox the frame to 640x640, run `card_corners_v9_640.onnx`, decode the corners (a port of `corner_model.py`; matches the Python decode to 0.07 % of a card's width).
2. `js/scan/warp.js`: flatten each card into the embedder input (272x384) from the full-resolution frame, upright and rotated 180 degrees.
3. `js/scan/engine.js`: `card_embed_v3_512.onnx` through onnxruntime-web (vendored in `vendor/ort`, MIT), in a worker.
4. `js/scan/search.worker.js` + `matcher.js`: cosine against the 118,774-printing int8 gallery in a Web Worker, then the desktop's accept rules: cosine at least 0.65, a lead of 0.10 over the best other card and 0.03 over the best other treatment of the same card; tokens, lands and placeholders need 0.80. Digital-only printings never match. Not sure: no name.
5. `js/scan/tracker.js` + `session.js`: tracks each physical card; the last few embeddings are averaged when one frame is not sure; a card is logged once, after two matching confident answers (no duplicates when a card drops out and comes back).

**Measured** on the 40 golden test scenes (`../golden`, headless Edge, CPU, 4 threads): 97 of 140 cards found (Python: 98), **66 named correctly and 0 wrong** (the desktop pipeline with SIFT: 73 and 0). WebGPU gives the same answers as the CPU (same 97 found, 66 correct, 0 wrong, same corners). Live, with a fake camera playing a 6-card scene: 5 named correctly, 0 wrong, none logged twice. Speed per step after warm-up (an NVIDIA RTX GPU in headless Edge; CPU = 4 threads): **detect 27 ms on WebGPU against 222 ms on the CPU**, embed 51 ms against 114 ms, flatten 15-17 ms and gallery search 80 ms on both. Live that is about 40 frames per second once the cards are identified (about 25 while it is still identifying them) on WebGPU, and about 2.6 on the CPU.

**Not in the browser version yet:** SIFT verification (about 10 points fewer right answers on hard scenes, same wrong-answer rule), the grey fill for the hidden part of covered cards, title OCR. **Untested:** WebGPU on other GPUs and browsers (it falls back to the CPU on its own, and says so), phones, Firefox and Safari.

First start downloads about 110 MB (models 30 MB, card database 65 MB, model runtime 30 MB); the browser caches it.

## Data

Everything the user creates is kept in this browser's `localStorage`: scans, decks, settings (`magiccv.db.1`, `magiccv.settings.1`). Rows use the columns of the desktop `scans.csv` (`name, special_print, best_guess_set, collector_number, timestamp`), so a real `scans.csv` imports as is. Text from imported files is only ever inserted as text, never as HTML.

## Files

- `index.html`, `css/style.css` (themes are `[data-theme=...]` blocks at the end), `coi-serviceworker.js` (MIT).
- `js/main.js` (top bar, router, Database menu), `store.js` (browser database, CSV / JSON), `settings.js`, `ui.js`, `snow.js`, `decklist.js` (deck-list parser), `pages/*.js`.
- `js/scan/*`: the scanner (above). `models/`: the two ONNX models. `vendor/ort/`: onnxruntime-web 1.31.1 (MIT).
- `data/`: the card database in browser form, **generated** by `python tools/export_web_data.py` from `../data/index` (int8 gallery, flags, card table). Re-run it after `tools/sync_from_main.py`.

## What comes next

Prices in the Price Search page, a faster gallery search (now the slowest step on WebGPU), SIFT-free accuracy work (the covered-card grey fill, OCR), then a real login. See `../WEB_PORT_GUIDE.md` and `../docs/research_web_hosting.md`.
