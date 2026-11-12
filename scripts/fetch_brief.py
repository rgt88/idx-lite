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
import os
import sys
import time
from datetime import datetime, timezone

from idxcli import DATA, by_activity, dump, load, run

OUT = DATA / "brief"
INDEX = DATA / "brief_index.json"
ap = argparse.ArgumentParser()
ap.add_argument("--max", type=int, default=100)
ap.add_argument("--symbols", nargs="*")
ap.add_argument("--only-missing", action="store_true", help="hanya saham yang belum punya brief")
ap.add_argument("--budget", type=float, default=0, help="berhenti rapi setelah N menit (0 = tanpa batas)")
args = ap.parse_args()

idx = load(INDEX, {}) or {}
stocks = idx.setdefault("stocks", {})
if args.symbols:
    todo = [s.upper() for s in args.symbols]
else:
    order = by_activity()
    rank = {s: i for i, s in enumerate(order)}
    todo = sorted(order, key=lambda s: (s in stocks, stocks.get(s, ""), rank[s]))
    if args.only_missing:
        todo = [s for s in todo if s not in stocks]
    todo = todo[: args.max]

today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
ok = fail = 0
T0 = time.monotonic()


def save():
    idx["updated"] = datetime.now(timezone.utc).isoformat()
    dump(INDEX, idx)


for n, sym in enumerate(todo):
    if args.budget and time.monotonic() - T0 > args.budget * 60:
        print(f"batas waktu {args.budget:g} menit tercapai; berhenti di {n}/{len(todo)}")
        break
    if n and n % 20 == 0:
        save()
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

save()
left = sum(1 for s in by_activity() if s not in stocks)
print(f"brief: {ok} berhasil, {fail} gagal dari {len(todo)} · total tersedia {len(stocks)} · belum punya brief: {left}")
if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
        fh.write(f"ok={ok}\nleft={left}\n")
if todo and ok == 0:
    sys.exit(1)
