#!/usr/bin/env python3
"""Refresh web/data/prices.bin + prices.json from Scryfall bulk data (Default Cards).

prices.bin: little-endian uint32, three values per catalog row (nonfoil, foil, etched) in US cents; 0xFFFFFFFF = no price.
Row order = web/data/ids.bin (16 raw uuid bytes per row), so this never touches the other data files.
The previous prices.bin is kept as prices.prev.bin so the site can show the change since the last update.

Run:  python tools/update_prices.py            (downloads the bulk file, about 80 MB compressed)
      python tools/update_prices.py --bulk default-cards.json   (use a file you already have)
"""
import argparse, datetime, gzip, json, os, shutil, struct, sys, tempfile, urllib.request, uuid
from pathlib import Path

NONE = 0xFFFFFFFF
DATA = Path(__file__).resolve().parent.parent / "web" / "data"
UA = {"User-Agent": "MagicCV-price-updater/1.0 (+https://github.com/Nxllify/MagicCV-Web)", "Accept": "application/json"}


def fetch(url, dest=None):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        if dest is None:
            return json.load(r)
        with open(dest, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)


def cards_from(path):
    """Yield card objects from a Scryfall bulk file: .jsonl, .jsonl.gz (one card per line) or a plain .json array."""
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rb") as f:
        head = f.read(1)
        f.seek(0)
        if head == b"[":
            yield from json.load(f)
            return
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def cents(v):
    if v is None:
        return NONE
    try:
        return int(round(float(v) * 100))
    except ValueError:
        return NONE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bulk", help="path to an already downloaded default-cards file (.json, .jsonl or .jsonl.gz)")
    ap.add_argument("--out", default=str(DATA), help="output folder (default: web/data)")
    args = ap.parse_args()
    out = Path(args.out)

    ids = (DATA / "ids.bin").read_bytes()
    n = len(ids) // 16
    index = {str(uuid.UUID(bytes=ids[i * 16:(i + 1) * 16])): i for i in range(n)}

    tmp = None
    bulk_at = None
    if args.bulk:
        path = args.bulk
    else:
        meta = fetch("https://api.scryfall.com/bulk-data/default-cards")
        bulk_at = meta.get("updated_at")                      # when Scryfall built the bulk file: the real age of the prices
        url = meta.get("jsonl_download_uri") or meta["download_uri"]
        tmp = tempfile.NamedTemporaryFile(suffix=".jsonl.gz" if url.endswith(".gz") else ".json", delete=False); tmp.close()
        print("downloading", url)
        fetch(url, tmp.name)
        path = tmp.name

    prices = [NONE] * (n * 3)
    seen = 0
    for c in cards_from(path):
        i = index.get(c.get("id"))
        if i is None:
            continue
        seen += 1
        p = c.get("prices") or {}
        prices[i * 3:i * 3 + 3] = [cents(p.get("usd")), cents(p.get("usd_foil")), cents(p.get("usd_etched"))]
    if tmp:
        os.unlink(tmp.name)
    priced = sum(1 for i in range(n) if prices[i * 3] != NONE)      # rows with a non-foil price (what prices.json has always counted)
    if seen < n * 0.9 or priced < n * 0.5:
        sys.exit(f"refusing to write: only {seen}/{n} catalog cards found in the bulk file and {priced} priced (something is wrong)")

    out.mkdir(parents=True, exist_ok=True)
    old_bin, old_json = out / "prices.bin", out / "prices.json"
    prev_at = None
    if old_bin.exists():
        shutil.copyfile(old_bin, out / "prices.prev.bin")
        try:
            prev_at = json.loads(old_json.read_text())["updated_at"]
        except Exception:
            prev_at = None
    (out / "prices.bin").write_bytes(struct.pack(f"<{n * 3}I", *prices))
    meta_json = {
        "updated_at": bulk_at or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds"),
        "previous_updated_at": prev_at,
        "source": "Scryfall bulk data (Default Cards): prices are daily estimates from Scryfall affiliates",
        "currency": "USD",
        "priced": priced,
    }
    old_json.write_text(json.dumps(meta_json))
    print(f"wrote {n} rows, {priced} priced; previous snapshot {prev_at}")


if __name__ == "__main__":
    main()
