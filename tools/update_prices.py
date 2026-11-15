#!/usr/bin/env python3
"""Refresh web/data/prices.bin + prices.json from Scryfall bulk data (Default Cards).

prices.bin: little-endian uint32, three values per catalog row (nonfoil, foil, etched) in US cents; 0xFFFFFFFF = no price.
Row order = web/data/ids.bin (16 raw uuid bytes per row), so this never touches the other data files.
The previous prices.bin is kept as prices.prev.bin so the site can show the change since the last update.

A refresh is only written when it is worth a commit: at least --min-moved percent of the priced cards moved by 10 % and 25 cents or more,
or the saved prices are --max-age-days old. Otherwise nothing is written and the script exits normally (the workflow then makes no commit).
Use --force to write anyway and --dry-run to only look.

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
    ap.add_argument("--force", action="store_true", help="write the files even when little changed")
    ap.add_argument("--dry-run", action="store_true", help="download and compare, but write nothing")
    ap.add_argument("--min-moved", type=float, default=5.0, help="percent of priced cards that must have moved to count as a big change (default 5)")
    ap.add_argument("--max-age-days", type=float, default=30.0, help="write anyway when the saved prices are this old (default 30)")
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
    if old_bin.exists() and not args.force:
        old = struct.unpack(f"<{n * 3}I", old_bin.read_bytes()) if old_bin.stat().st_size == n * 12 else None
        try:
            age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(json.loads(old_json.read_text())["updated_at"])).total_seconds() / 86400
        except Exception:
            age = float("inf")                                  # unreadable date: treat the saved prices as stale
        if old is not None:
            both = [i for i in range(n) if old[i * 3] != NONE and prices[i * 3] != NONE]
            moved = sum(1 for i in both if abs(prices[i * 3] - old[i * 3]) >= max(25, 0.10 * old[i * 3]))
            pct = 100 * moved / max(1, len(both))
            big, stale = pct >= args.min_moved, age >= args.max_age_days
            print(f"{moved} of {len(both)} priced cards moved 10 % and 25 cents or more ({pct:.2f} %, needs {args.min_moved} %); saved prices are {age:.1f} days old (limit {args.max_age_days})")
            if not (big or stale):
                print("not a big change: nothing written")
                return
    if args.dry_run:
        print("dry run: nothing written")
        return
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
