#!/usr/bin/env python3
"""
Indikator makro dari sumber GRATIS (tanpa API key), disimpan di docs/data/:

  data.json          nilai terbaru + perubahan + status tiap sumber
  macro_series.json  riwayat harian 1 tahun IHSG, USD/IDR, WTI (Yahoo Finance)
  macro_hist.json    arsip harian semua indikator, bertambah setiap run (untuk yield & CDS)

Sumber:
- USD/IDR       : Frankfurter (kurs referensi ECB, harian) + riwayat Yahoo (IDR=X)
- IHSG, WTI     : Yahoo Finance chart API (^JKSE, CL=F)
- Yield SBN     : AsianBondsOnline (ADB), tenor 2Y/5Y/10Y + perubahan 1 hari, 1 minggu, YTD (bp)
- CDS 5Y        : tidak ada sumber gratis resmi; dibaca dari docs/data/manual.json

Kalau satu sumber gagal, nilai lamanya dipertahankan dan status sumber itu dicatat.
"""
import json
import pathlib
import re
import sys
from datetime import date, datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

DATA = pathlib.Path(__file__).resolve().parent.parent / "docs" / "data"
DATA_FILE = DATA / "data.json"
SERIES_FILE = DATA / "macro_series.json"
HIST_FILE = DATA / "macro_hist.json"
MANUAL_FILE = DATA / "manual.json"
WIB = timezone(timedelta(hours=7))
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
TIMEOUT = 20
ADB_URL = "https://asianbondsonline.adb.org/economy/?economy=ID"
KEEP_DAYS = 3 * 366


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def safe_get(url, **kwargs):
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, **kwargs)
    r.raise_for_status()
    return r


# ---------------------------------------------------------------- Yahoo
def yahoo_chart(symbol, rng="5d"):
    r = safe_get(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}", params={"interval": "1d", "range": rng})
    return r.json()["chart"]["result"][0]


def candles(result):
    off = result["meta"].get("gmtoffset") or 0
    ts = result.get("timestamp") or []
    closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    out = {}
    for t, c in zip(ts, closes):
        if c is not None:
            out[datetime.fromtimestamp(t + off, tz=timezone.utc).date().isoformat()] = round(float(c), 4)
    return sorted(out.items())


def previous_session_close(result):
    """Penutupan sesi SEBELUM sesi harga terakhir (bukan meta.chartPreviousClose, yang untuk
    range=5d adalah penutupan sebelum awal jendela 5 hari)."""
    meta = result["meta"]
    off = meta.get("gmtoffset") or 0
    last_t = meta.get("regularMarketTime")
    rows = candles(result)
    if not rows:
        return None
    last_day = datetime.fromtimestamp(last_t + off, tz=timezone.utc).date().isoformat() if last_t else rows[-1][0]
    for d, c in reversed(rows):
        if d < last_day:
            return c
    return None


def quote_from_chart(result, extra=None):
    meta = result["meta"]
    price = meta.get("regularMarketPrice")
    prev = previous_session_close(result) or meta.get("previousClose")
    off = meta.get("gmtoffset") or 0
    t = meta.get("regularMarketTime")
    out = {
        "value": round(price, 2) if price is not None else None,
        "previous_close": prev,
        "change_pct": round((price - prev) / prev * 100, 2) if price is not None and prev else None,
        "date": datetime.fromtimestamp(t + off, tz=timezone.utc).date().isoformat() if t else None,
        "currency": meta.get("currency"),
        "source": "yahoo_finance",
    }
    out.update(extra or {})
    return out


# ---------------------------------------------------------------- sumber
def fetch_usdidr():
    data = safe_get("https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR").json()
    out = {"value": round(data["rates"]["IDR"], 2), "unit": "IDR", "date": data.get("date"), "source": "frankfurter.dev"}
    try:
        prev_day = (date.fromisoformat(data["date"]) - timedelta(days=7)).isoformat()
        hist = safe_get(f"https://api.frankfurter.dev/v1/{prev_day}..{data['date']}?base=USD&symbols=IDR").json()["rates"]
        days = sorted(d for d in hist if d < data["date"])
        if days:
            p = hist[days[-1]]["IDR"]
            out["previous_close"] = p
            out["change_pct"] = round((out["value"] - p) / p * 100, 2)
    except Exception:
        pass
    return out


def fetch_adb_yields():
    """Yield SBN dari AsianBondsOnline: baris '<tenor> Year', nilai, lalu perubahan (bp) 1 hari, 1 minggu, YTD.
    Panah ▼ (&#9660) berarti turun, ▲ (&#9650) naik."""
    html_text = safe_get(ADB_URL).text
    soup = BeautifulSoup(html_text, "html.parser")

    def bp(td):
        raw = str(td)
        txt = td.get_text(" ", strip=True)
        m = re.search(r"(\d+(?:\.\d+)?)", txt)
        if not m:
            return None
        down = "▼" in txt or "9660" in raw
        return -float(m.group(1)) if down else float(m.group(1))

    out = {}
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 2:
            continue
        label = tds[0].get_text(" ", strip=True)
        m = re.fullmatch(r"(\d+)\s*Years?", label, flags=re.I)
        if not m:
            continue
        try:
            val = float(tds[1].get_text(strip=True).replace(",", ""))
        except ValueError:
            continue
        key = f"bond_{m.group(1)}y"
        if key in out:  # tabel pertama (pemerintah) yang dipakai
            continue
        out[key] = {
            "value": val, "unit": "%", "source": "asianbondsonline.adb.org",
            "chg_1d_bp": bp(tds[2]) if len(tds) > 2 else None,
            "chg_1w_bp": bp(tds[3]) if len(tds) > 3 else None,
            "chg_ytd_bp": bp(tds[4]) if len(tds) > 4 else None,
        }
    if not out:
        raise ValueError("tabel yield tidak ditemukan (struktur halaman mungkin berubah)")
    # tanggal data: cari tanggal yang dekat dengan kata "as of"/"close" (tanggal lain di halaman bisa berita)
    text = soup.get_text(" ", strip=True)
    asof = None
    for mm in re.finditer(r"(?:as of|close)[^.]{0,40}?([A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+ \d{4})", text, flags=re.I):
        raw = mm.group(1).replace(".", "").replace(",", "")
        for fmt in ("%B %d %Y", "%b %d %Y", "%d %B %Y", "%d %b %Y"):
            try:
                asof = datetime.strptime(raw, fmt).date()
                break
            except ValueError:
                continue
        if asof:
            break
    for v in out.values():
        v["date"] = asof.isoformat() if asof else None
    return out


# ---------------------------------------------------------------- utama
def main():
    old = load(DATA_FILE, {})
    result = {k: v for k, v in old.items() if k not in ("bond_1y",)}
    status = {}

    for key, fn in (("usdidr", fetch_usdidr),
                    ("ihsg", lambda: quote_from_chart(yahoo_chart("%5EJKSE"))),
                    ("crude_oil", lambda: quote_from_chart(yahoo_chart("CL=F"), {"type": "WTI Crude Oil Futures", "unit": "USD/barrel"}))):
        try:
            result[key] = fn()
            status[key] = "ok"
        except Exception as e:
            status[key] = f"error: {e}"
            print(f"[WARN] {key}: {e}", file=sys.stderr)

    try:
        ylds = fetch_adb_yields()
        for k in ("bond_2y", "bond_5y", "bond_10y"):
            if k in ylds:
                result[k] = ylds[k]
                status[k] = "ok"
            else:
                status[k] = "error: tenor tidak ada di halaman"
    except Exception as e:
        for k in ("bond_2y", "bond_5y", "bond_10y"):
            status[k] = f"error: {e}"
        print(f"[WARN] yield ADB: {e}", file=sys.stderr)

    manual = load(MANUAL_FILE, {})
    if isinstance(manual.get("cds_5y"), dict) and manual["cds_5y"].get("value") is not None:
        result["cds_5y"] = {**manual["cds_5y"], "unit": "bps", "source": "manual"}
        status["cds_5y"] = "manual"
    else:
        result["cds_5y"] = None
        status["cds_5y"] = "manual: belum diisi"

    result["last_updated"] = datetime.now(WIB).isoformat()
    result["last_run_status"] = status
    DATA_FILE.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    # Riwayat 1 tahun dari Yahoo (IHSG, USD/IDR, WTI)
    series = load(SERIES_FILE, {})
    for key, sym in (("ihsg", "%5EJKSE"), ("usdidr", "IDR=X"), ("crude_oil", "CL=F")):
        try:
            rows = candles(yahoo_chart(sym, "1y"))
            if rows:
                series[key] = rows
        except Exception as e:
            print(f"[WARN] riwayat {key}: {e}", file=sys.stderr)
    series["updated"] = result["last_updated"]
    SERIES_FILE.write_text(json.dumps(series, separators=(",", ":")), encoding="utf-8")

    # Arsip harian sendiri (yield, CDS, dan semua lainnya), satu nilai per tanggal data
    hist = load(HIST_FILE, {})
    for key in ("usdidr", "ihsg", "crude_oil", "bond_2y", "bond_5y", "bond_10y", "cds_5y"):
        v = result.get(key)
        if isinstance(v, dict) and v.get("value") is not None:
            d = v.get("date") or datetime.now(WIB).date().isoformat()
            hist.setdefault(key, {})[d] = v["value"]
    cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    for key in list(hist):
        if isinstance(hist[key], dict):
            hist[key] = {d: x for d, x in sorted(hist[key].items()) if d >= cutoff}
    HIST_FILE.write_text(json.dumps(hist, separators=(",", ":")), encoding="utf-8")

    print(json.dumps({k: result.get(k) for k in ("usdidr", "ihsg", "crude_oil", "bond_2y", "bond_5y", "bond_10y", "cds_5y")},
                     indent=1, ensure_ascii=False))
    print("status:", status)


if __name__ == "__main__":
    main()
