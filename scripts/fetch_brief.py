#!/usr/bin/env python3
"""
Brief satu halaman per saham (`idx stocks brief`): valuasi + verdict, sinyal teknikal, return
dibanding IHSG, dividen, pemegang saham terbesar, dan berita Kontan/CNBC Indonesia.

Satu brief butuh beberapa permintaan ke Yahoo, MSN dan RSS berita, jadi diambil bergilir:
saham yang belum pernah diambil dan paling aktif dulu, lalu yang brief-nya paling lama.
Jalankan setelah fetch_ownership.py supaya bagian pemegang saham ikut terisi.

  python scripts/fetch_brief.py --max 100
  python scripts/fetch_brief.py --symbols BBCA BBRI
"""
import argparse
import sys
import time
from datetime import datetime, timezone

from idxcli import DATA, by_activity, dump, load, run

OUT = DATA / "brief"
INDEX = DATA / "brief_index.json"
ap = argparse.ArgumentParser()
ap.add_argument("--max", type=int, default=100)
ap.add_argument("--symbols", nargs="*")
args = ap.parse_args()

idx = load(INDEX, {}) or {}
stocks = idx.setdefault("stocks", {})
if args.symbols:
    todo = [s.upper() for s in args.symbols]
else:
    order = by_activity()
    rank = {s: i for i, s in enumerate(order)}
    todo = sorted(order, key=lambda s: (s in stocks, stocks.get(s, ""), rank[s]))[: args.max]

today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
ok = fail = 0
for sym in todo:
    env, err = run(["stocks", "brief", sym], timeout=240, quiet=True)
    if env:
        dump(OUT / f"{sym}.json", {"fetched_at": env.get("fetched_at"), "warnings": env.get("warnings") or [],
                                   "data": env["data"]})
        stocks[sym] = today
        ok += 1
    else:
        fail += 1
        print(f"gagal {sym}: {err}")
    time.sleep(0.5)

idx["updated"] = datetime.now(timezone.utc).isoformat()
dump(INDEX, idx)
print(f"brief: {ok} berhasil, {fail} gagal dari {len(todo)} · total tersedia {len(stocks)}")
if todo and ok == 0:
    sys.exit(1)
