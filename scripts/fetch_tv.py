#!/usr/bin/env python3
"""
Data pasar luas dari pemindai publik TradingView (tanpa akun, tanpa key):
  - semua saham BEI dalam satu permintaan: sektor & industri, kapitalisasi pasar, perubahan harian,
    performa 1 minggu / 1 bulan / 3 bulan / YTD / 1 tahun, rating teknikal  -> heatmap sektor
  - kuotasi global: yield SBN 1Y/2Y/5Y/10Y, komoditas (batubara Newcastle, CPO, nikel, emas, minyak, tembaga),
    DXY, yield US 10Y

  python scripts/fetch_tv.py

Endpoint tidak resmi (dipakai halaman screener TradingView sendiri); kalau kolom atau simbol berubah, skrip
membuang kolom/simbol yang ditolak dan mencatatnya di tv/meta.json, jadi sisanya tetap jalan.
Keluaran: docs/data/tv/stocks.json, docs/data/tv/quotes.json, docs/data/tv/meta.json
"""
import json
import pathlib
import re
import time
from datetime import datetime, timezone

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "tv"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
      "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/", "Content-Type": "application/json"}

STOCK_COLS = {  # nama kolom TradingView -> nama kita
    "name": "code", "description": "name", "close": "close", "change": "chg", "volume": "volume",
    "market_cap_basic": "mcap", "sector": "sector", "industry": "industry",
    "Perf.W": "r1w", "Perf.1M": "r1m", "Perf.3M": "r3m", "Perf.YTD": "rytd", "Perf.Y": "r1y",
    "Recommend.All": "rating", "relative_volume_10d_calc": "rvol", "price_earnings_ttm": "pe",
}
QUOTES = {  # simbol -> (id, label, satuan, grup)
    "TVC:ID01Y": ("id1y", "Yield SBN 1Y", "%", "yield"), "TVC:ID02Y": ("id2y", "Yield SBN 2Y", "%", "yield"),
    "TVC:ID05Y": ("id5y", "Yield SBN 5Y", "%", "yield"), "TVC:ID10Y": ("id10y", "Yield SBN 10Y", "%", "yield"),
    "TVC:US10Y": ("us10y", "Yield US 10Y", "%", "yield"), "TVC:DXY": ("dxy", "Indeks dolar (DXY)", "", "fx"),
    "ICEEUR:NCF1!": ("coal", "Batubara Newcastle", "USD/ton", "komoditas"),
    "MYX:FCPO1!": ("cpo", "CPO (Bursa Malaysia)", "MYR/ton", "komoditas"),
    "LME:NI1!": ("nickel", "Nikel LME", "USD/ton", "komoditas"),
    "COMEX:GC1!": ("gold", "Emas", "USD/oz", "komoditas"),
    "NYMEX:CL1!": ("wti", "Minyak WTI", "USD/bbl", "komoditas"),
    "ICEEUR:BRN1!": ("brent", "Minyak Brent", "USD/bbl", "komoditas"),
    "COMEX:HG1!": ("copper", "Tembaga", "USD/lb", "komoditas"),
    "MCX:TIN1!": ("tin", "Timah", "", "komoditas"),
}
QUOTE_COLS = ["close", "change", "change_abs", "Perf.W", "Perf.1M", "Perf.YTD", "description"]


def post(url, body, tries=3):
    last = None
    for i in range(tries):
        try:
            r = requests.post(url, json=body, headers=UA, timeout=40)
            if r.status_code == 200:
                return r.json(), None
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code == 400:
                return None, last
        except Exception as e:
            last = str(e)[:200]
        time.sleep(3 * (i + 1))
    return None, last


def scan_with_fallback(url, body, cols):
    """Ulangi tanpa kolom yang ditolak (pesan error TradingView menyebut nama kolomnya)."""
    dropped = []
    for _ in range(len(cols)):
        body["columns"] = cols
        data, err = post(url, body)
        if data is not None:
            return data, cols, dropped, None
        bad = [c for c in cols if err and re.search(r"\b" + re.escape(c) + r"\b", err)]
        if not bad:
            return None, cols, dropped, err
        cols = [c for c in cols if c not in bad]
        dropped += bad
    return None, cols, dropped, "semua kolom ditolak"


def main():
    now = datetime.now(timezone.utc).isoformat()
    meta = {"updated": now}

    # 1. semua saham BEI
    data, cols, dropped, err = scan_with_fallback(
        "https://scanner.tradingview.com/indonesia/scan",
        {"filter": [{"left": "type", "operation": "equal", "right": "stock"}], "markets": ["indonesia"],
         "options": {"lang": "en"}, "range": [0, 2000], "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}},
        list(STOCK_COLS))
    if data:
        rows = {}
        for item in data.get("data", []):
            d = dict(zip(cols, item.get("d", [])))
            code = str(d.get("name") or item.get("s", "").split(":")[-1]).upper()
            rows[code] = {STOCK_COLS[k]: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items() if k != "name"}
        (OUT).mkdir(parents=True, exist_ok=True)
        (OUT / "stocks.json").write_text(json.dumps({"updated": now, "source": "TradingView scanner", "stocks": rows},
                                                    ensure_ascii=False, separators=(",", ":")))
        meta["stocks"] = f"ok {len(rows)}" + (f"; kolom ditolak: {', '.join(dropped)}" if dropped else "")
        print(f"saham: {len(rows)}" + (f" (kolom ditolak: {dropped})" if dropped else ""))
    else:
        meta["stocks"] = f"gagal: {err}"
        print("saham gagal:", err)

    # 2. kuotasi global (yield, komoditas)
    quotes, bad_syms = {}, []
    syms = list(QUOTES)
    for attempt in range(3):
        data, qcols, qdropped, err = scan_with_fallback("https://scanner.tradingview.com/global/scan",
                                                        {"symbols": {"tickers": syms, "query": {"types": []}}}, list(QUOTE_COLS))
        if data is None and err and attempt < 2:
            bad = [s for s in syms if s in (err or "")]
            if bad:
                syms = [s for s in syms if s not in bad]
                bad_syms += bad
                continue
        break
    if data:
        for item in data.get("data", []):
            s = item.get("s")
            if s not in QUOTES:
                continue
            d = dict(zip(qcols, item.get("d", [])))
            qid, label, unit, group = QUOTES[s]
            if d.get("close") is None:
                continue
            quotes[qid] = {"symbol": s, "label": label, "unit": unit, "group": group, "value": d.get("close"),
                           "chg_pct": d.get("change"), "chg": d.get("change_abs"), "r1w": d.get("Perf.W"),
                           "r1m": d.get("Perf.1M"), "rytd": d.get("Perf.YTD")}
        missing = [QUOTES[s][0] for s in QUOTES if QUOTES[s][0] not in quotes]
        meta["quotes"] = f"ok {len(quotes)}" + (f"; tidak tersedia: {', '.join(missing)}" if missing else "")
        print(f"kuotasi: {len(quotes)}; tidak tersedia: {missing}")
    else:
        meta["quotes"] = f"gagal: {err}"
        print("kuotasi gagal:", err)
    if quotes:
        prev = json.loads((OUT / "quotes.json").read_text()) if (OUT / "quotes.json").exists() else {}
        merged = {**(prev.get("quotes") or {}), **quotes}       # simbol yang kali ini gagal tetap pakai nilai lama
        (OUT / "quotes.json").write_text(json.dumps({"updated": now, "source": "TradingView scanner", "quotes": merged},
                                                    ensure_ascii=False, separators=(",", ":")))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    if "gagal" in meta.get("stocks", "") and "gagal" in meta.get("quotes", ""):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
