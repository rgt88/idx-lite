import argparse
import json
import pathlib
import sys
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
FD = OUT / "fundamentals"
FD.mkdir(parents=True, exist_ok=True)
SUMMARY = OUT / "fundamentals.json"

REV = ["totalrevenue", "operatingrevenue"]
NI = ["netincome", "netincomecommonstockholders"]
EPS = ["dilutedeps", "basiceps"]

ap = argparse.ArgumentParser()
ap.add_argument("--max", type=int, default=100, help="jumlah saham per run")
ap.add_argument("--symbols", nargs="*", help="ambil saham tertentu saja")
args = ap.parse_args()


def num(x, nd=2):
    try:
        if x is None or pd.isna(x):
            return None
        return round(float(x), nd)
    except Exception:
        return None


def pick(df, names):
    idx = {str(i).replace(" ", "").lower(): i for i in df.index}
    for n in names:
        if n in idx:
            return df.loc[idx[n]]
    return None


def growth(cur, prev):
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur - prev) / abs(prev) * 100, 1)


def build(df, step_prev, step_yoy, keep):
    if df is None or df.empty:
        return []
    rev, ni, eps = pick(df, REV), pick(df, NI), pick(df, EPS)
    rows = []
    for c in sorted(df.columns):  # lama -> baru
        rows.append({
            "date": pd.Timestamp(c).strftime("%Y-%m-%d"),
            "revenue": num(rev[c], 0) if rev is not None else None,
            "net_income": num(ni[c], 0) if ni is not None else None,
            "eps": num(eps[c], 2) if eps is not None else None,
        })
    for i, r in enumerate(rows):
        for key, short in (("revenue", "rev"), ("net_income", "ni")):
            if step_prev and i >= step_prev:
                r[f"{short}_qoq"] = growth(r[key], rows[i - step_prev][key])
            if step_yoy and i >= step_yoy:
                r[f"{short}_yoy"] = growth(r[key], rows[i - step_yoy][key])
    return rows[-keep:]


def get_stmt(t, freq):
    try:
        return t.get_income_stmt(freq=freq)
    except Exception:
        return t.quarterly_income_stmt if freq == "quarterly" else t.income_stmt


def snapshot(t):
    try:
        info = t.info or {}
    except Exception:
        info = {}
    dy = info.get("trailingAnnualDividendYield")
    roe = info.get("returnOnEquity")
    return {
        "pe": num(info.get("trailingPE")),
        "pb": num(info.get("priceToBook")),
        "div_yield": num(dy * 100) if isinstance(dy, (int, float)) else None,
        "roe": num(roe * 100, 1) if isinstance(roe, (int, float)) else None,
        "mcap": num(info.get("marketCap"), 0),
        "currency": info.get("financialCurrency"),
    }


def universe():
    try:
        s = json.loads((OUT / "summary.json").read_text())["stocks"]
        return [x["symbol"] for x in sorted(s, key=lambda x: x.get("value") or 0, reverse=True)]
    except Exception:
        return [x.upper() for x in (ROOT / "symbols.txt").read_text().split()]


try:
    summary = json.loads(SUMMARY.read_text())
except Exception:
    summary = {}
stocks = summary.setdefault("stocks", {})

if args.symbols:
    todo = [s.upper() for s in args.symbols]
else:
    def staleness(s):
        f = stocks.get(s, {}).get("fetched")
        return (0, "") if not f else (1, f)   # belum pernah diambil dulu, lalu yang paling lama
    todo = sorted(universe(), key=staleness)[: args.max]

now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
ok = 0
for sym in todo:
    try:
        t = yf.Ticker(f"{sym}.JK")
        q = build(get_stmt(t, "quarterly"), 1, 4, 8)
        a = build(get_stmt(t, "yearly"), None, 1, 4)
        snap = snapshot(t)
        if not q and not a and snap["pe"] is None and snap["mcap"] is None:
            print(f"kosong {sym}")
            stocks[sym] = {"fetched": now, "n_quarters": 0}
            continue
        (FD / f"{sym}.json").write_text(json.dumps(
            {"symbol": sym, "fetched": now, "currency": snap["currency"], "quarters": q, "annual": a},
            separators=(",", ":")))
        last = q[-1] if q else {}
        stocks[sym] = {**snap, "rev_yoy": last.get("rev_yoy"), "ni_yoy": last.get("ni_yoy"),
                       "n_quarters": len(q), "fetched": now}
        span = f"{q[0]['date']} .. {q[-1]['date']}" if q else "-"
        print(f"ok   {sym}: {len(q)} kuartal ({span}), {len(a)} tahun")
        if args.symbols:
            for r in q:
                print("   ", r)
        ok += 1
    except Exception as e:
        print(f"gagal {sym}: {e}")
    time.sleep(1.0)

summary["updated"] = datetime.now(timezone.utc).isoformat()
SUMMARY.write_text(json.dumps(summary, separators=(",", ":")))
print(f"selesai: {ok} berhasil dari {len(todo)}")
if todo and ok == 0:
    sys.exit(1)
