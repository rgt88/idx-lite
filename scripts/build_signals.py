#!/usr/bin/env python3
"""
Watchlist "time to buy": skor teknikal, fundamental, dan gabungan untuk semua saham likuid.

  python scripts/build_signals.py                 # baca docs/data, tulis docs/data/signals.json
  python scripts/build_signals.py --min-value 5e8 # ambang likuiditas lain (rata-rata nilai 20 hari, Rp)
  python scripts/build_signals.py --show BBCA     # cetak rincian satu saham

Masukan : summary.json, prices/KODE.json, fundamentals.json, hsc.json (semua sudah ada di situs)
Keluaran: signals.json  (dipakai menu "Time to Buy", tab Ringkasan saham, dan laporan Telegram)

Semua aturan sengaja sederhana dan tertulis di RULES supaya bisa dibaca dan diubah berdua.
Ini penyaring, bukan saran investasi.
"""
import argparse
import json
import math
import re
import pathlib
import statistics
from datetime import date, datetime, timezone

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
OUT = DATA / "signals.json"

ap = argparse.ArgumentParser()
ap.add_argument("--min-value", type=float, default=1e9, help="rata-rata nilai transaksi 20 hari minimum (Rp)")
ap.add_argument("--min-price", type=float, default=50)
ap.add_argument("--show", help="cetak rincian satu kode")
args = ap.parse_args()

RULES = {
    "universe": f"Rata-rata nilai transaksi 20 hari ≥ Rp{args.min_value / 1e9:g} M, harga ≥ Rp{args.min_price:g}, "
                "data harga sesi terakhir. Saham HSC ikut dinilai bila likuid, dengan peringatan.",
    "technical": [
        "Tren (maks 30): harga > SMA50, SMA20 > SMA50, SMA50 > SMA200 (atau harga > SMA200).",
        "Momentum (maks 25): RSI 45–65, MACD di atas sinyal, histogram MACD naik.",
        "Setup (maks 30): breakout 20 hari bervolume, pullback ke MA20 di tren naik, rebound dari oversold, "
        "MACD baru cross naik, golden cross SMA20/50.",
        "Volume (maks 15): volume ≥ 1,5× rata-rata 20 hari; volume hari naik > hari turun selama 20 hari.",
        "Penalti: RSI > 75, harga > 10% di atas SMA20, harga di bawah SMA200.",
        "Sinyal beli: ada setup aktif, skor ≥ 60, tidak overbought, risiko ke stop ≤ 10%. Pantau: skor ≥ 50.",
    ],
    "fundamental": [
        "Profitabilitas (maks 20): ROE ≥ 15% (20), ≥ 10% (12), ≥ 5% (5).",
        "Pertumbuhan (maks 25): pendapatan YoY > 0 / > 10%, laba bersih YoY > 0 / > 15% (kuartal terakhir).",
        "Valuasi (maks 35): P/E dibanding median sektor (atau pasar), P/B, PEG (P/E ÷ pertumbuhan laba) ≤ 1.",
        "Analis (maks 20): potensi ke target rata-rata (≥ 3 analis) dan rekomendasi buy.",
        "Dividen (maks 10): yield ≥ 3% / ≥ 5%.",
        "Dikeluarkan: rugi (P/E kosong atau ≤ 0). Layak koleksi: skor ≥ 60. Pantau: skor ≥ 50.",
    ],
    "combined": [
        "Skor gabungan = rata-rata skor teknikal dan fundamental; keduanya minimal 50 dan harga di atas SMA50 "
        "(kecuali setup rebound).",
        "Sinyal beli: fundamental ≥ 55 dan setup teknikal aktif. Pantau: syarat minimal terpenuhi.",
    ],
}


def load(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return default


def idn(texts):
    """Desimal gaya Indonesia di teks alasan: 28.6% -> 28,6%."""
    return [re.sub(r"(\d)\.(\d)", r"\1,\2", t) for t in texts]


def r(x, d=2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), d)


# ------------------------------------------------------------------ teknikal
def rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return 100 - 100 / (1 + up / dn.replace(0, float("nan")))


def technical(rows):
    df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]).astype(
        {"open": float, "high": float, "low": float, "close": float, "volume": float})
    c, h, l, v = df["close"], df["high"], df["low"], df["volume"]
    n = len(df)
    s20, s50 = c.rolling(20).mean(), c.rolling(50).mean()
    s200 = c.rolling(200).mean() if n >= 200 else None
    e20 = c.ewm(span=20, adjust=False).mean()
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    sig = macd.ewm(span=9, adjust=False).mean()
    hist = macd - sig
    rs = rsi(c)
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / 14, adjust=False).mean()
    vma = v.rolling(20).mean()

    i = n - 1
    C, R = c.iloc[i], rs.iloc[i]
    S20, S50, S200 = s20.iloc[i], s50.iloc[i], (s200.iloc[i] if s200 is not None else None)
    score, setups, reasons, warns = 0, [], [], []

    # tren
    if C > S50:
        score += 10; reasons.append("Harga di atas SMA50")
    if S20 > S50:
        score += 10; reasons.append("SMA20 di atas SMA50")
    if S200 is not None and not math.isnan(S200):
        if S50 > S200:
            score += 10; reasons.append("SMA50 di atas SMA200 (tren besar naik)")
        elif C > S200:
            score += 5
        if C < S200:
            score -= 10; warns.append("Harga di bawah SMA200")
    elif C > S50:
        score += 5

    # momentum
    if 45 <= R <= 65:
        score += 10
    if macd.iloc[i] > sig.iloc[i]:
        score += 10; reasons.append("MACD di atas sinyal")
    if hist.iloc[i] > hist.iloc[i - 1]:
        score += 5

    # setup
    prior_high20 = h.iloc[i - 20:i].max()
    rv = v.iloc[i] / vma.iloc[i] if vma.iloc[i] else 0
    if C > prior_high20 and rv >= 1.5 and R < 75 and C > S50:
        setups.append(("Breakout 20 hari", 30))
    near = min(l.iloc[i], l.iloc[i - 1]) <= max(S20, e20.iloc[i]) * 1.02
    if C > S50 and S20 > S50 and near and C >= S20 * 0.995 and 40 <= R <= 60 and C > c.iloc[i - 1]:
        setups.append(("Pullback ke MA20 di tren naik", 30))
    if rs.iloc[i - 5:i].min() < 30 <= R and R > rs.iloc[i - 1] and C > h.iloc[i - 1]:
        setups.append(("Rebound dari oversold", 20))
    for k in range(i - 2, i + 1):
        if macd.iloc[k - 1] <= sig.iloc[k - 1] and macd.iloc[k] > sig.iloc[k] and C > S20:
            setups.append(("MACD baru cross naik", 15)); break
    for k in range(i - 4, i + 1):
        if s20.iloc[k - 1] <= s50.iloc[k - 1] and s20.iloc[k] > s50.iloc[k]:
            setups.append(("Golden cross SMA20/50", 15)); break
    if setups:
        pts = sorted(p for _, p in setups)
        score += min(30, pts[-1] + 5 * (len(pts) - 1))

    # volume
    if rv >= 1.5:
        score += 10; reasons.append(f"Volume {rv:.1f}× rata-rata 20 hari")
    last20 = df.iloc[i - 19:i + 1]
    upv = last20.loc[last20["close"] > last20["close"].shift(), "volume"].sum()
    dnv = last20.loc[last20["close"] < last20["close"].shift(), "volume"].sum()
    if upv > dnv:
        score += 5; reasons.append("Volume hari naik lebih besar dari hari turun (20 hari)")

    # penalti
    overbought = R > 75
    if overbought:
        score -= 20; warns.append(f"RSI {R:.0f}: overbought, tunggu pullback")
    ext = C / S20 - 1
    if ext > 0.10:
        score -= 15; warns.append(f"Harga {ext * 100:.0f}% di atas SMA20: sudah jauh dari area masuk")

    # level
    A = atr.iloc[i]
    stop = max(C - 2 * A, l.iloc[i - 9:i + 1].min())
    if stop >= C * 0.99:
        stop = C - 1.5 * A
    risk = (C - stop) / C * 100
    res = h.iloc[max(0, i - 60):i].max()
    target = max(res, C + 2 * (C - stop)) if res > C * 1.03 else C + 2 * (C - stop)
    rr = (target - C) / (C - stop) if C > stop else None

    score = max(0, min(100, score))
    active = bool(setups) and score >= 60 and not overbought and risk <= 10
    status = "beli" if active else "pantau" if score >= 50 else None
    if risk > 10:
        warns.append(f"Jarak ke stop {risk:.0f}%: terlalu lebar")
    return {
        "score": int(score), "status": status, "setups": [s for s, _ in setups], "reasons": idn(reasons), "warnings": idn(warns),
        "rsi": r(R, 1), "sma20": r(S20, 0), "sma50": r(S50, 0), "sma200": r(S200, 0) if S200 is not None else None,
        "entry": r(C, 0), "stop": r(stop, 0), "target": r(target, 0), "rr": r(rr, 1), "risk_pct": r(risk, 1),
        "above_sma50": bool(C > S50),
    }


# ------------------------------------------------------------------ fundamental
def fundamental(f, price, med_pe, med_pb, sector_n):
    pe, pb, roe, div = f.get("pe"), f.get("pb"), f.get("roe"), f.get("div_yield")
    rev, ni, tgt, an, rec = f.get("rev_yoy"), f.get("ni_yoy"), f.get("target"), f.get("analysts"), f.get("rec")
    if pe is None or pe <= 0:
        return {"score": 0, "status": None, "reasons": [], "warnings": ["Rugi atau P/E tidak tersedia"], "excluded": True}
    score, reasons, warns = 0, [], []
    peer = f"sektor ({sector_n} saham)" if sector_n else "pasar"

    if roe is not None:
        pts = 20 if roe >= 15 else 12 if roe >= 10 else 5 if roe >= 5 else 0
        score += pts
        if pts >= 12:
            reasons.append(f"ROE {roe:.1f}%")
        if roe < 0:
            score -= 10; warns.append(f"ROE negatif ({roe:.1f}%)")
        elif roe < 5:
            warns.append(f"ROE rendah ({roe:.1f}%)")
    if rev is not None:
        if rev > 10:
            score += 10; reasons.append(f"Pendapatan YoY +{rev:.0f}%")
        elif rev > 0:
            score += 5
        elif rev < -10:
            warns.append(f"Pendapatan YoY {rev:.0f}%")
    if ni is not None:
        if ni > 15:
            score += 15; reasons.append(f"Laba bersih YoY +{ni:.0f}%")
        elif ni > 0:
            score += 8
        elif ni < -20:
            score -= 10; warns.append(f"Laba bersih YoY {ni:.0f}%")

    val = 0
    if med_pe:
        ratio = pe / med_pe
        val += 20 if ratio <= 0.7 else 12 if ratio <= 1 else 4 if ratio <= 1.3 else 0
        if ratio <= 1:
            reasons.append(f"P/E {pe:.1f} di bawah median {peer} {med_pe:.1f}")
        elif ratio > 1.5:
            warns.append(f"P/E {pe:.1f} jauh di atas median {peer} {med_pe:.1f}")
    if pb is not None:
        if pb <= 1 and (roe or 0) >= 10:
            val += 5; reasons.append(f"P/B {pb:.2f} dengan ROE ≥ 10%")
        elif med_pb and pb <= med_pb:
            val += 5
    if ni and ni > 0 and pe / ni <= 1:
        val += 10; reasons.append(f"PEG {pe / ni:.2f}")
    score += min(35, val)

    upside = (tgt / price - 1) * 100 if tgt and price else None
    if upside is not None and (an or 0) >= 3:
        if upside >= 20:
            score += 12; reasons.append(f"Potensi +{upside:.0f}% ke target {an} analis")
        elif upside >= 10:
            score += 6
        elif upside < 0:
            warns.append(f"Harga sudah di atas target rata-rata analis ({upside:.0f}%)")
    if rec in ("buy", "strong_buy"):
        score += 8; reasons.append("Rekomendasi analis: " + rec.replace("_", " "))
    if div is not None:
        if div >= 5:
            score += 10; reasons.append(f"Dividen {div:.1f}%")
        elif div >= 3:
            score += 6

    fetched = f.get("fetched")
    if fetched:
        try:
            fd_ = datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
            if fd_.tzinfo is None:          # fetch_fundamentals menyimpan tanggal saja (YYYY-MM-DD)
                fd_ = fd_.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - fd_).days
            if age > 120:
                warns.append(f"Data fundamental berumur {age} hari")
        except ValueError:
            pass
    score = max(0, min(100, score))
    return {"score": int(score), "status": "beli" if score >= 60 else "pantau" if score >= 50 else None,
            "reasons": idn(reasons), "warnings": idn(warns), "pe": pe, "pb": pb, "roe": roe, "div": div, "rev_yoy": rev, "ni_yoy": ni,
            "upside": r(upside, 1), "analysts": an, "rec": rec, "sector": f.get("sector"),
            "med_pe": r(med_pe, 1), "peer": peer}


def combined(t, f):
    if not t or not f or f.get("excluded"):
        return None
    ok_trend = t["above_sma50"] or "Rebound dari oversold" in t["setups"]
    if t["score"] < 50 or f["score"] < 50 or not ok_trend:
        return {"score": int(round((t["score"] + f["score"]) / 2)), "status": None}
    s = int(round((t["score"] + f["score"]) / 2))
    status = "beli" if f["score"] >= 55 and t["status"] == "beli" else "pantau"
    return {"score": s, "status": status}


# ------------------------------------------------------------------ utama
def main():
    summ = load(DATA / "summary.json")
    if not summ:
        raise SystemExit("summary.json tidak ada; jalankan fetch_prices.py dulu")
    fund = (load(DATA / "fundamentals.json", {}) or {}).get("stocks", {})
    hsc = set((load(DATA / "hsc.json", {}) or {}).get("codes", []))
    prev = (load(OUT, {}) or {}).get("stocks", {})
    session = max(x["date"] for x in summ["stocks"])

    # median P/E dan P/B per sektor (minimal 5 saham), cadangan median pasar
    by_sec, all_pe, all_pb = {}, [], []
    for s, f in fund.items():
        pe = f.get("pe")
        if pe and 0 < pe < 100:
            all_pe.append(pe)
            if f.get("sector"):
                by_sec.setdefault(f["sector"], []).append(pe)
        if f.get("pb") and 0 < f["pb"] < 30:
            all_pb.append(f["pb"])
    mkt_pe = statistics.median(all_pe) if all_pe else None
    mkt_pb = statistics.median(all_pb) if all_pb else None

    stocks, skipped = {}, {"illiquid": 0, "history": 0, "stale": 0}
    HSC_WARN = "HSC: free float kecil, harga mudah bergerak tajam"
    for x in summ["stocks"]:
        sym = x["symbol"]
        if x["date"] != session:
            skipped["stale"] += 1; continue
        rows = load(DATA / "prices" / f"{sym}.json")
        if not rows or len(rows) < 60:
            skipped["history"] += 1; continue
        val20 = sum(rw[4] * rw[5] for rw in rows[-20:]) / 20
        if val20 < args.min_value or x["price"] < args.min_price:
            skipped["illiquid"] += 1; continue
        try:
            t = technical(rows)
        except Exception as e:
            print(f"gagal teknikal {sym}: {e}")
            t = None
        f, fd = None, fund.get(sym)
        if fd and (fd.get("pe") is not None or fd.get("n_quarters")):
            sec = fd.get("sector")
            peers = by_sec.get(sec) if sec else None
            use_sec = peers and len(peers) >= 5
            try:
                f = fundamental(fd, x["price"], statistics.median(peers) if use_sec else mkt_pe,
                                mkt_pb, len(peers) if use_sec else 0)
            except Exception as ex:
                print(f"gagal fundamental {sym}: {ex}")
        if sym in hsc:
            for part in (t, f):
                if part:
                    part["warnings"].insert(0, HSC_WARN)
        c = combined(t, f)
        e = {"price": x["price"], "chg": x.get("change_pct"), "value20": round(val20), "t": t, "f": f, "c": c}
        if sym in hsc:
            e["hsc"] = True

        # kapan sinyal beli pertama muncul (untuk melihat hasilnya sejak itu)
        for k in ("t", "f", "c"):
            cur = e[k]
            if not cur:
                continue
            old = (prev.get(sym) or {}).get(k) or {}
            if cur.get("status") == "beli":
                if old.get("status") == "beli" and old.get("since"):
                    cur["since"], cur["since_price"] = old["since"], old["since_price"]
                else:
                    cur["since"], cur["since_price"] = session, x["price"]
                cur["since_ret"] = r((x["price"] / cur["since_price"] - 1) * 100, 1)
        stocks[sym] = e

    def ranked(k):
        rows = [(s, e[k]) for s, e in stocks.items() if e[k] and e[k].get("status")]
        rows.sort(key=lambda z: (z[1]["status"] != "beli", -z[1]["score"], -stocks[z[0]]["value20"]))
        return [s for s, _ in rows]

    lists = {k: ranked(k) for k in ("t", "f", "c")}
    out = {
        "updated": datetime.now(timezone.utc).isoformat(), "session": session, "rules": RULES,
        "median_pe": r(mkt_pe, 1), "evaluated": len(stocks), "skipped": skipped,
        "hsc_evaluated": sum(1 for e in stocks.values() if e.get("hsc")),
        "with_fundamental": sum(1 for e in stocks.values() if e["f"] and not e["f"].get("excluded")),
        "lists": {"technical": lists["t"], "fundamental": lists["f"], "combined": lists["c"]},
        "counts": {k: {"beli": sum(1 for s in v if stocks[s][k[0] if k != "combined" else "c"]["status"] == "beli"), "total": len(v)}
                   for k, v in (("technical", lists["t"]), ("fundamental", lists["f"]), ("combined", lists["c"]))},
        "stocks": stocks,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"sesi {session}: {len(stocks)} saham dinilai, dilewati {skipped}")
    for k, name in (("technical", "teknikal"), ("fundamental", "fundamental"), ("combined", "gabungan")):
        cn = out["counts"][k]
        top = ", ".join(lists[k[0] if k != "combined" else "c"][:8])
        print(f"  {name:<11} sinyal beli {cn['beli']:>3}, total {cn['total']:>3}: {top}")
    if args.show:
        print(json.dumps(stocks.get(args.show.upper()), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
