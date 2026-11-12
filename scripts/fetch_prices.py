#!/usr/bin/env python3
"""
Harga harian semua saham (Yahoo Finance) -> prices/KODE.json dan summary.json.

  python scripts/fetch_prices.py            # unduh semua saham + putaran perbaikan
  python scripts/fetch_prices.py --check    # hanya laporkan saham yang harganya tertinggal

Alur:
1. Unduh 1 tahun candle harian per kelompok 50 saham.
2. Putaran perbaikan untuk saham yang candle terakhirnya tertinggal dari sesi terbaru atau gagal diunduh:
   a. unduh ulang satu per satu (tanpa thread, lebih jarang kena batas Yahoo);
   b. kalau candle harian tetap belum ada, susun candle hari itu dari data intraday 5 menit Yahoo.
3. Saham yang tetap gagal tidak dihapus: data lamanya dipertahankan dan diberi tanda "stale".
   Saham tanpa transaksi di sesi itu juga tetap tertinggal; itu wajar.
"""
import argparse
import json
import pathlib
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests
import yfinance as yf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
PRICES = OUT / "prices"
PRICES.mkdir(parents=True, exist_ok=True)
WIB = timezone(timedelta(hours=7))

ap = argparse.ArgumentParser()
ap.add_argument("--check", action="store_true", help="hanya periksa summary.json yang ada")
args = ap.parse_args()

symbols = list(dict.fromkeys(s.upper() for s in (ROOT / "symbols.txt").read_text().split()))
CHUNK = 50


def num(x, nd=2):
    return None if x is None or pd.isna(x) else round(float(x), nd)


def rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    down = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / down)


def dump(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":")))


def load(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return default


def rows_from_df(df):
    df = df.dropna(subset=["Close"])
    vol = df["Volume"].fillna(0)
    return [[i.strftime("%Y-%m-%d"), round(float(o)), round(float(h)), round(float(l)), round(float(c)), int(v)]
            for i, o, h, l, c, v in zip(df.index, df["Open"], df["High"], df["Low"], df["Close"], vol)]


def merge(old, new):
    """Gabungkan baris lama dan baru per tanggal (yang baru menang), simpan ±1 tahun terakhir."""
    by = {r[0]: r for r in (old or [])}
    by.update({r[0]: r for r in new})
    return [by[d] for d in sorted(by)][-260:]


def entry(sym, rows):
    close = pd.Series([r[4] for r in rows], dtype=float)
    last, prev = close.iloc[-1], close.iloc[-2]
    v = rows[-1][5]
    return {
        "symbol": sym, "date": rows[-1][0], "price": num(last, 0),
        "change_pct": num((last - prev) / prev * 100) if prev else None,
        "volume": int(v), "value": num(last * v, 0),
        "sma20": num(close.rolling(20).mean().iloc[-1], 0),
        "sma50": num(close.rolling(50).mean().iloc[-1], 0),
        "rsi14": num(rsi(close).iloc[-1], 1),
    }


def intraday_candle(sym, session):
    """Candle sesi dari data 5 menit Yahoo, untuk saham yang candle hariannya belum terbit."""
    r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}.JK",
                     params={"interval": "5m", "range": "1d"}, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    m = res["meta"]
    t = m.get("regularMarketTime")
    if not t or datetime.fromtimestamp(t, WIB).date().isoformat() != session:
        return None
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    o = [x for x in (q.get("open") or []) if x is not None]
    h = [x for x in (q.get("high") or []) if x is not None]
    lo = [x for x in (q.get("low") or []) if x is not None]
    vol = m.get("regularMarketVolume") or sum(x for x in (q.get("volume") or []) if x)
    price = m.get("regularMarketPrice")
    if not price or not o:
        return None
    return [session, round(o[0]), round(max(h + [price])), round(min(lo + [price])), round(price), int(vol or 0)]


def report(summ_stocks, failed=()):
    dates = Counter(x["date"] for x in summ_stocks)
    session = max(dates) if dates else None
    behind = sorted((x for x in summ_stocks if x["date"] != session), key=lambda x: -(x.get("value") or 0))
    print(f"\nsesi terbaru {session}: {dates.get(session, 0)} saham; tertinggal {len(behind)}; tanpa data {len(failed)}")
    print("sebaran tanggal terakhir:", ", ".join(f"{d}: {n}" for d, n in sorted(dates.items())[-5:]))
    if behind:
        print("tertinggal (paling aktif dulu):", " ".join(f"{x['symbol']}({x['date'][5:]})" for x in behind[:40]))
    return session, behind


if args.check:
    s = load(OUT / "summary.json")
    if not s:
        sys.exit("summary.json tidak ada")
    report(s["stocks"])
    sys.exit(0)

# 1. unduhan utama
got, failed = {}, []
for i in range(0, len(symbols), CHUNK):
    chunk = symbols[i:i + CHUNK]
    print(f"kelompok {i // CHUNK + 1}/{(len(symbols) - 1) // CHUNK + 1}")
    try:
        raw = yf.download(tickers=[f"{s}.JK" for s in chunk], period="1y", interval="1d", group_by="ticker",
                          auto_adjust=False, threads=True, progress=False)
    except Exception as e:
        print("  gagal unduh kelompok:", e)
        failed += chunk
        continue
    for sym in chunk:
        try:
            df = raw[f"{sym}.JK"] if isinstance(raw.columns, pd.MultiIndex) else raw
            rows = rows_from_df(df)
            if len(rows) < 2:
                failed.append(sym)
                continue
            got[sym] = rows
        except Exception:
            failed.append(sym)
    time.sleep(3)

if not got:
    sys.exit("Tidak ada data yang berhasil diambil")

session = max(r[-1][0] for r in got.values())
behind = [s for s, r in got.items() if r[-1][0] < session]
print(f"\nsesi terbaru {session}; candle tertinggal {len(behind)}, gagal {len(failed)} -> putaran perbaikan")

# 2. putaran perbaikan
fixed_daily = fixed_intra = 0
todo = behind + failed
T0 = time.monotonic()
for n, sym in enumerate(todo):
    if time.monotonic() - T0 > 15 * 60:
        print(f"  batas 15 menit putaran perbaikan tercapai di {n}/{len(todo)}")
        for s in todo[n:]:
            if s not in got:
                got[s] = load(PRICES / f"{s}.json") or []
        break
    if n and n % 25 == 0:
        print(f"  perbaikan {n}/{len(todo)}")
    old = got.get(sym) or load(PRICES / f"{sym}.json") or []
    try:
        df = yf.download(f"{sym}.JK", period="1mo" if old else "1y", interval="1d", auto_adjust=False,
                         threads=False, progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        new = rows_from_df(df)
        if new and new[-1][0] == session:
            got[sym] = merge(old, new)
            fixed_daily += 1
            continue
        old = merge(old, new) if new else old
    except Exception:
        pass
    try:
        c = intraday_candle(sym, session)
        if c and old:
            got[sym] = merge(old, [c])
            fixed_intra += 1
            continue
    except Exception:
        pass
    if old and len(old) >= 2:
        got[sym] = old             # tetap tampil dengan data terakhir yang ada
    time.sleep(0.3)
print(f"diperbaiki: {fixed_daily} lewat unduh ulang, {fixed_intra} lewat data intraday")

# 3. tulis
stocks, still_failed = [], []
for sym in symbols:
    rows = got.get(sym)
    if not rows or len(rows) < 2:
        still_failed.append(sym)
        continue
    dump(PRICES / f"{sym}.json", rows)
    e = entry(sym, rows)
    if e["date"] < session:
        e["stale"] = True
    stocks.append(e)

dump(OUT / "summary.json", {"updated": datetime.now(timezone.utc).isoformat(), "session": session, "stocks": stocks})
print(f"selesai: {len(stocks)} saham ditulis, {len(still_failed)} tanpa data sama sekali")
if still_failed:
    print("tanpa data:", " ".join(still_failed[:50]), "..." if len(still_failed) > 50 else "")
report(stocks, still_failed)
