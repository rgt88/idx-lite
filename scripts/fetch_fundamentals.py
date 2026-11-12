import argparse
import json
import os
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
VERSION = 3

REV = ["totalrevenue", "operatingrevenue"]
NI = ["netincome", "netincomecommonstockholders"]
EPS = ["dilutedeps", "basiceps"]

ap = argparse.ArgumentParser()
ap.add_argument("--max", type=int, default=100, help="jumlah saham per run")
ap.add_argument("--symbols", nargs="*", help="ambil saham tertentu saja")
ap.add_argument("--only-missing", action="store_true", help="hanya saham yang belum lengkap (mode isi semua)")
ap.add_argument("--budget", type=float, default=0, help="berhenti rapi setelah N menit (0 = tanpa batas)")
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
    data = {}
    for c in df.columns:
        ts = pd.Timestamp(c)
        key = ts.to_period("Q") if step_prev else ts
        data[key] = {
            "date": ts.strftime("%Y-%m-%d"),
            "revenue": num(rev[c], 0) if rev is not None else None,
            "net_income": num(ni[c], 0) if ni is not None else None,
            "eps": num(eps[c], 2) if eps is not None else None,
        }
    if step_prev and data:
        for per in pd.period_range(min(data), max(data), freq="Q"):
            data.setdefault(per, {"date": per.end_time.strftime("%Y-%m-%d"),
                                  "revenue": None, "net_income": None, "eps": None})
    rows = [data[k] for k in sorted(data)]
    for i, r in enumerate(rows):
        for key, short in (("revenue", "rev"), ("net_income", "ni")):
            if step_prev and i >= step_prev:
                r[f"{short}_qoq"] = growth(r[key], rows[i - step_prev][key])
            if step_yoy and i >= step_yoy:
                r[f"{short}_yoy"] = growth(r[key], rows[i - step_yoy][key])
    while rows and rows[0]["revenue"] is None and rows[0]["net_income"] is None:
        rows.pop(0)
    while rows and rows[-1]["revenue"] is None and rows[-1]["net_income"] is None:
        rows.pop()
    return rows[-keep:]


def get_stmt(t, freq):
    try:
        return t.get_income_stmt(freq=freq)
    except Exception:
        return t.quarterly_income_stmt if freq == "quarterly" else t.income_stmt


def get_info(t):
    try:
        return t.info or {}
    except Exception:
        return {}


def txt(x):
    return x.strip() if isinstance(x, str) and x.strip() else None


def analyst(t, info):
    """Target harga dan rekomendasi analis dari Yahoo Finance, termasuk riwayat per sekuritas kalau ada."""
    out = {
        "recommendation": txt(info.get("recommendationKey")),
        "rating": num(info.get("recommendationMean")),
        "analysts": info.get("numberOfAnalystOpinions"),
        "target_mean": num(info.get("targetMeanPrice")), "target_median": num(info.get("targetMedianPrice")),
        "target_high": num(info.get("targetHighPrice")), "target_low": num(info.get("targetLowPrice")),
        "trend": [], "history": [],
    }
    try:
        apt = t.analyst_price_targets or {}
        for k in ("mean", "median", "high", "low"):
            if out[f"target_{k}"] is None:
                out[f"target_{k}"] = num(apt.get(k))
    except Exception:
        pass
    try:
        rec = t.recommendations
        if rec is not None and not rec.empty:
            for _, r in rec.iterrows():
                out["trend"].append({"period": str(r.get("period")), **{k: int(r.get(k) or 0) for k in
                                     ("strongBuy", "buy", "hold", "sell", "strongSell")}})
    except Exception:
        pass
    try:
        ud = t.upgrades_downgrades
        if ud is not None and not ud.empty:
            for d, r in ud.sort_index(ascending=False).head(25).iterrows():
                out["history"].append({
                    "date": pd.Timestamp(d).strftime("%Y-%m-%d"),
                    "firm": txt(r.get("Firm")), "to": txt(r.get("ToGrade")), "from": txt(r.get("FromGrade")),
                    "action": txt(r.get("Action")),
                    "target": num(r.get("currentPriceTarget")), "prior_target": num(r.get("priorPriceTarget")),
                    "target_action": txt(r.get("priceTargetAction")),
                })
    except Exception:
        pass
    has = out["target_mean"] is not None or out["recommendation"] not in (None, "none") or out["history"] or out["trend"]
    return out if has else None


def snapshot(info):
    dy = info.get("trailingAnnualDividendYield")
    roe = info.get("returnOnEquity")
    return {
        "pe": num(info.get("trailingPE")),
        "pb": num(info.get("priceToBook")),
        "div_yield": num(dy * 100) if isinstance(dy, (int, float)) else None,
        "roe": num(roe * 100, 1) if isinstance(roe, (int, float)) else None,
        "mcap": num(info.get("marketCap"), 0),
        "currency": info.get("financialCurrency"),
        "sector": info.get("sector"),
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
        e = stocks.get(s, {})
        if not e.get("fetched"):
            return (0, "")              # belum pernah diambil
        if e.get("v") != VERSION or "sector" not in e:
            return (1, e["fetched"])    # format lama / belum ada sektor
        return (2, e["fetched"])        # lalu yang paling lama
    todo = sorted(universe(), key=staleness)
    if args.only_missing:
        todo = [s for s in todo if staleness(s)[0] < 2]
    todo = todo[: args.max]


def incomplete():
    """Saham yang belum pernah diambil atau formatnya lama (untuk mode isi semua)."""
    return sum(1 for s in universe() if not stocks.get(s, {}).get("fetched") or stocks[s].get("v") != VERSION or "sector" not in stocks[s])


def save():
    summary["updated"] = datetime.now(timezone.utc).isoformat()
    SUMMARY.write_text(json.dumps(summary, separators=(",", ":")))


T0 = time.monotonic()
streak = 0

now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
ok = 0
for n, sym in enumerate(todo):
    if args.budget and time.monotonic() - T0 > args.budget * 60:
        print(f"batas waktu {args.budget:g} menit tercapai; berhenti di {n}/{len(todo)}")
        break
    if n and n % 20 == 0:
        save()                      # simpan berkala supaya hasil tidak hilang kalau job dihentikan
    if streak >= 15:
        print("15 kali gagal berturut-turut (kemungkinan dibatasi Yahoo); berhenti")
        break
    if streak and streak % 5 == 0:
        print("gagal beruntun; jeda 60 detik")
        time.sleep(60)
    try:
        t = yf.Ticker(f"{sym}.JK")
        q = build(get_stmt(t, "quarterly"), 1, 4, 8)
        a = build(get_stmt(t, "yearly"), None, 1, 4)
        info = get_info(t)
        snap = snapshot(info)
        an = analyst(t, info)
        if not q and not a and snap["pe"] is None and snap["mcap"] is None:
            print(f"kosong {sym}")
            stocks[sym] = {"fetched": now, "n_quarters": 0, "v": VERSION, "sector": None}
            continue
        (FD / f"{sym}.json").write_text(json.dumps(
            {"symbol": sym, "fetched": now, "currency": snap["currency"], "quarters": q, "annual": a, "analyst": an},
            separators=(",", ":")))
        last = q[-1] if q else {}
        stocks[sym] = {**snap, "rev_yoy": last.get("rev_yoy"), "ni_yoy": last.get("ni_yoy"),
                       "target": an["target_mean"] if an else None, "analysts": an["analysts"] if an else None,
                       "rec": an["recommendation"] if an else None,
                       "n_quarters": len(q), "fetched": now, "v": VERSION}
        span = f"{q[0]['date']} .. {q[-1]['date']}" if q else "-"
        print(f"ok   {sym}: {len(q)} kuartal ({span}), {len(a)} tahun")
        if args.symbols:
            for r in q:
                print("   ", r)
        ok += 1
        streak = 0
    except Exception as e:
        print(f"gagal {sym}: {e}")
        streak += 1
    time.sleep(1.0)

save()
left = incomplete()
print(f"selesai: {ok} berhasil dari {len(todo)} · belum lengkap: {left} saham")
if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
        fh.write(f"ok={ok}\nleft={left}\n")
if todo and ok == 0:
    sys.exit(1)
