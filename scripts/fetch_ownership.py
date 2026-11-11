#!/usr/bin/env python3
"""
Pemegang saham di atas 1% (register bulanan KSEI yang diterbitkan BEI) lewat CLI `idx`.

`idx ownership sync` memasang database siap pakai dari mirror GitHub milik proyek idx, jadi
tidak perlu membuka idx.co.id (yang memblokir server GitHub). Hasil di docs/data/ownership/:

  meta.json     tanggal register, register pembanding, ringkasan perubahan seluruh pasar
  index.json    ringkasan per saham: jumlah pemegang, total %, porsi asing, pemegang terbesar
  t/KODE.json   daftar pemegang satu saham + perubahannya dibanding register sebelumnya

Register terbit sebulan sekali, jadi kalau tanggalnya sama dengan yang sudah tayang, skrip
berhenti cepat (pakai --force untuk menulis ulang).
"""
import argparse
import sys
from collections import defaultdict
from datetime import datetime, timezone

from idxcli import DATA, ROOT, dump, load, run

OUT = DATA / "ownership"
ap = argparse.ArgumentParser()
ap.add_argument("--force", action="store_true", help="tulis ulang walau register belum berganti")
args = ap.parse_args()

status = {}
meta_old = load(OUT / "meta.json", {}) or {}

env, err = run(["ownership", "sync"], timeout=1200)
if not env:
    env, err = run(["ownership", "import", "--latest"], timeout=1200)
status["sync"] = "ok" if env else err

rel, err = run(["ownership", "releases"])
rows = []
if rel:
    d = rel["data"]
    rows = d if isinstance(d, list) else (d.get("releases") or d.get("rows") or [])
dates = sorted({r["as_of"] for r in rows if r.get("as_of")})
if not dates:
    status["releases"] = err or "tidak ada register"
    dump(OUT / "meta.json", {**meta_old, "updated": datetime.now(timezone.utc).isoformat(), "status": status})
    sys.exit("Database kepemilikan kosong; data lama dipertahankan.")

latest = dates[-1]
prev = dates[-2] if len(dates) > 1 else None
if not args.force and meta_old.get("as_of") == latest and (OUT / "index.json").exists():
    print(f"register {latest} sudah tayang; tidak ada yang diubah")
    sys.exit(0)

# Perubahan dibanding register sebelumnya, seluruh pasar sekaligus
changes_by = defaultdict(list)
summary = None
if prev:
    ch, err = run(["ownership", "changes", "--from", prev, "--to", latest, "--limit", "0"], timeout=1200)
    if ch:
        summary = ch["data"].get("summary")
        for c in ch["data"].get("changes", []):
            changes_by[c["symbol"]].append({k: c.get(k) for k in (
                "holder", "kind", "pct_from", "pct_to", "pct_change", "shares_change", "local_foreign", "investor_type")})
        status["changes"] = "ok"
    else:
        status["changes"] = err

# Pemegang per saham
symbols = list(dict.fromkeys(list(changes_by) + (ROOT / "symbols.txt").read_text().split()))
index, ok = {}, 0
for sym in symbols:
    env, _ = run(["ownership", "ticker", sym, "--as-of", latest], quiet=True)
    if not env:
        continue
    d = env["data"]
    holders = [{k: h.get(k) for k in ("holder", "pct", "shares_total", "local_foreign", "investor_type",
                                      "controller_or_affiliate")} for h in d.get("holders", [])]
    holders.sort(key=lambda h: h["pct"] or 0, reverse=True)
    foreign = round(sum(h["pct"] or 0 for h in holders if h["local_foreign"] == "A"), 4)
    control = round(sum(h["pct"] or 0 for h in holders if h["controller_or_affiliate"]), 4)
    dump(OUT / "t" / f"{sym}.json", {
        "symbol": sym, "issuer_name": d.get("issuer_name"), "as_of": latest, "prev": prev,
        "listed_pct": d.get("listed_pct"), "foreign_pct": foreign,
        "controller_pct": control if d.get("controller_reported") else None,
        "holders": holders, "changes": sorted(changes_by.get(sym, []), key=lambda c: -abs(c["pct_change"] or 0)),
    })
    top = holders[0] if holders else {}
    index[sym] = [len(holders), d.get("listed_pct"), foreign, top.get("holder"), top.get("pct"), d.get("issuer_name")]
    ok += 1
status["tickers"] = f"{ok}/{len(symbols)}"

if summary:
    for k in ("issuer_flow",):  # daftar per emiten sudah ada di file per saham
        summary.pop(k, None)
dump(OUT / "index.json", index)
dump(OUT / "meta.json", {"updated": datetime.now(timezone.utc).isoformat(), "as_of": latest, "prev": prev,
                         "releases": dates[-12:], "summary": summary, "status": status})
print(f"register {latest} (pembanding {prev}): {ok} saham · {status}")
if ok == 0:
    sys.exit(1)
