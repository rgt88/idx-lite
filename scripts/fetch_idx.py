#!/usr/bin/env python3
"""
Data resmi BEI (idx.co.id) tanpa akun: ringkasan saham (termasuk beli/jual ASING per saham), ringkasan indeks
(IHSG, LQ45, IDX30, 11 indeks sektor IDX-IC, dll.) dan total transaksi per broker.

  python scripts/fetch_idx.py               # sesi hari ini + isi hari yang bolong (maks 5 hari ke belakang)
  python scripts/fetch_idx.py --days 40     # isi riwayat 40 hari bursa (sekali di awal)
  python scripts/fetch_idx.py --method browser   # paksa cara browser

idx.co.id dilindungi Cloudflare dan sering menantang jaringan cloud (termasuk GitHub Actions). Urutan cara:
  1. curl_cffi dengan sidik jari TLS Chrome (cepat, sering lolos);
  2. Playwright + Chromium: buka halaman BEI sampai tantangan selesai, lalu ambil JSON dari dalam browser;
  3. kalau keduanya gagal: status "diblokir" dicatat, data lama tetap tayang. Cadangan terakhir: jalankan skrip ini
     dari laptop (mode lokal) atau runner self-hosted.

Keluaran di docs/data/idx/:
  days/YYYY-MM-DD.json   ringkasan saham per hari (kompak), disimpan 60 hari bursa
  foreign.json           foreign flow pasar + per saham (1/5/20 hari) + 20 net buy/sell teratas + riwayat pasar
  fs/KODE.json           riwayat foreign per saham 60 hari: [tanggal, beli lembar, jual lembar, close]
  indices.json           semua indeks BEI hari terakhir + riwayat 60 hari
  brokers.json           nilai/volume/frekuensi transaksi per broker (gabungan beli+jual)
  meta.json              cara yang berhasil, tanggal, status
Nilai foreign = lembar × harga penutupan (perkiraan; BEI menerbitkan lembar, bukan rupiah).
"""
import argparse
import json
import pathlib
import time
from datetime import date, datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "idx"
DAYS = OUT / "days"
WIB = timezone(timedelta(hours=7))
BASE = "https://www.idx.co.id/primary/TradingSummary/"
HOME = "https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/"
KEEP = 60

ap = argparse.ArgumentParser()
ap.add_argument("--days", type=int, default=5, help="berapa hari bursa ke belakang yang dicek")
ap.add_argument("--method", choices=["auto", "curl", "browser"], default="auto")
args = ap.parse_args()


def load(p, d=None):
    try:
        return json.loads(pathlib.Path(p).read_text())
    except Exception:
        return d


def dump(p, o):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(o, ensure_ascii=False, separators=(",", ":")))


def is_challenge(status, text):
    t = (text or "")[:3000]
    return status in (403, 429, 503) or "Just a moment" in t or "_cf_chl" in t or "Attention Required" in t


# ------------------------------------------------------------------ cara 1: curl_cffi
class Curl:
    name = "curl_cffi"

    def __init__(self):
        from curl_cffi import requests as cr
        self.s = cr.Session(impersonate="chrome")
        self.s.headers.update({"Accept-Language": "id-ID,id;q=0.9,en;q=0.8"})
        r = self.s.get(HOME, timeout=30)
        if is_challenge(r.status_code, r.text):
            raise RuntimeError(f"halaman BEI menantang (HTTP {r.status_code})")

    def get(self, path):
        r = self.s.get(BASE + path, timeout=40, headers={"Accept": "application/json, text/plain, */*", "Referer": HOME})
        if is_challenge(r.status_code, r.text) or not r.text.lstrip().startswith("{"):
            raise RuntimeError(f"{path.split('?')[0]}: HTTP {r.status_code}, bukan JSON")
        return r.json()

    def close(self):
        pass


# ------------------------------------------------------------------ cara 2: browser
class Browser:
    name = "playwright"

    def __init__(self):
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.b = self.pw.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
        self.ctx = self.b.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale="id-ID", timezone_id="Asia/Jakarta", viewport={"width": 1366, "height": 860})
        self.ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        self.p = self.ctx.new_page()
        self.p.goto(HOME, wait_until="domcontentloaded", timeout=60000)
        for _ in range(30):                       # tunggu tantangan Cloudflare selesai (maks ±45 detik)
            if "Just a moment" not in (self.p.title() or "") and "_cf_chl" not in self.p.content()[:4000]:
                break
            time.sleep(1.5)
        else:
            raise RuntimeError("tantangan Cloudflare tidak selesai di browser")

    def get(self, path):
        status, text = self.p.evaluate(
            """async (u) => { const r = await fetch(u, {headers: {Accept: 'application/json, text/plain, */*'}});
                              return [r.status, await r.text()]; }""", BASE + path)
        if is_challenge(status, text) or not text.lstrip().startswith("{"):
            raise RuntimeError(f"{path.split('?')[0]}: HTTP {status}, bukan JSON")
        return json.loads(text)

    def close(self):
        try:
            self.b.close()
            self.pw.stop()
        except Exception:
            pass


def client():
    errors = []
    order = {"auto": [Curl, Browser], "curl": [Curl], "browser": [Browser]}[args.method]
    for C in order:
        try:
            c = C()
            c.get(f"GetIndexSummary?date={date.today():%Y%m%d}&start=0&length=9999")   # uji akses
            print(f"akses BEI lewat {c.name}")
            return c, errors
        except Exception as e:
            errors.append(f"{C.name}: {str(e)[:160]}")
            print("gagal", errors[-1])
    return None, errors


# ------------------------------------------------------------------ pengambilan
def trading_days(n):
    d, out = datetime.now(WIB).date(), []
    if datetime.now(WIB).hour < 16:                 # sebelum tutup: hari ini belum final
        d -= timedelta(days=1)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def fetch_day(c, d):
    ymd = d.strftime("%Y%m%d")
    st = c.get(f"GetStockSummary?date={ymd}&start=0&length=9999").get("data") or []
    if not st:
        return None                                  # libur / belum ada
    ix = c.get(f"GetIndexSummary?date={ymd}&start=0&length=9999").get("data") or []
    try:
        br = c.get(f"GetBrokerSummary?date={ymd}&start=0&length=9999").get("data") or []
    except Exception as e:
        print("  broker gagal:", e)
        br = []
    stocks = [[r["StockCode"].strip(), num(r.get("Close")), num(r.get("Previous")), num(r.get("Volume")), num(r.get("Value")),
               num(r.get("Frequency")), num(r.get("ForeignBuy")), num(r.get("ForeignSell")), num(r.get("ListedShares"))]
              for r in st if r.get("StockCode")]
    indices = [[r["IndexCode"].strip(), num(r.get("Close")), num(r.get("Previous")), num(r.get("Value")),
                num(r.get("MarketCapital")), int(num(r.get("NumberOfStock")))] for r in ix if r.get("IndexCode")]
    brokers = [[r["IDFirm"].strip(), (r.get("FirmName") or "").strip(), num(r.get("Value")), num(r.get("Volume")), num(r.get("Frequency"))]
               for r in br if r.get("IDFirm")]
    return {"date": d.isoformat(), "cols": ["code", "close", "prev", "volume", "value", "freq", "fbuy", "fsell", "listed"],
            "stocks": stocks, "index_cols": ["code", "close", "prev", "value", "mcap", "n"], "indices": indices,
            "broker_cols": ["code", "name", "value", "volume", "freq"], "brokers": brokers}


# ------------------------------------------------------------------ olahan
def build():
    files = sorted(DAYS.glob("*.json"))[-KEEP:]
    for f in sorted(DAYS.glob("*.json"))[:-KEEP]:
        f.unlink()
    days = [load(f) for f in files]
    days = [d for d in days if d and d.get("stocks")]
    if not days:
        return None
    last = days[-1]
    # riwayat foreign per saham
    hist = {}
    for d in days:
        for code, close, prev, vol, val, freq, fb, fs, listed in d["stocks"]:
            hist.setdefault(code, []).append([d["date"], int(fb), int(fs), close])
    for code, rows in hist.items():
        dump(OUT / "fs" / f"{code}.json", rows)

    def net_value(rows, n):
        return sum((fb - fs) * c for _, fb, fs, c in rows[-n:])

    per = {}
    for code, close, prev, vol, val, freq, fb, fs, listed in last["stocks"]:
        rows = hist.get(code, [])
        per[code] = {"close": close, "chg": round((close / prev - 1) * 100, 2) if prev else None, "value": val,
                     "fbuy_val": round(fb * close), "fsell_val": round(fs * close), "net_val": round((fb - fs) * close),
                     "net_5d": round(net_value(rows, 5)), "net_20d": round(net_value(rows, 20)),
                     "foreign_share": round((fb + fs) * close / (2 * val) * 100, 1) if val else None}
    top = lambda key, rev: [dict(code=k, **v) for k, v in sorted(per.items(), key=lambda kv: kv[1][key], reverse=rev)[:20]]
    market = []
    for d in days:
        b = sum(fb * c for _, c, _, _, _, _, fb, _, _ in d["stocks"])
        s = sum(fs * c for _, c, _, _, _, _, _, fs, _ in d["stocks"])
        v = sum(r[4] for r in d["stocks"])
        market.append({"date": d["date"], "buy": round(b), "sell": round(s), "net": round(b - s), "value": round(v)})
    dump(OUT / "foreign.json", {
        "source": "idx.co.id GetStockSummary", "date": last["date"], "unit": "IDR (lembar × close, perkiraan)",
        "market": market[-1], "market_hist": market,
        "top_buy": top("net_val", True), "top_sell": top("net_val", False),
        "top_buy_5d": top("net_5d", True), "top_sell_5d": top("net_5d", False),
        "top_buy_20d": top("net_20d", True), "top_sell_20d": top("net_20d", False),
        "stocks": per})
    # indeks
    ih = {}
    for d in days:
        for code, close, prev, val, mcap, n in d.get("indices", []):
            ih.setdefault(code, []).append([d["date"], close])
    idx_rows = []
    for code, close, prev, val, mcap, n in last.get("indices", []):
        h = ih.get(code, [])
        ret = lambda k: round((close / h[-k - 1][1] - 1) * 100, 2) if len(h) > k and h[-k - 1][1] else None
        idx_rows.append({"code": code, "close": close, "chg": round((close / prev - 1) * 100, 2) if prev else None,
                         "r5": ret(5), "r20": ret(20), "value": val, "mcap": mcap, "n": n, "hist": h})
    dump(OUT / "indices.json", {"source": "idx.co.id GetIndexSummary", "date": last["date"], "indices": idx_rows})
    # broker
    br = sorted(last.get("brokers", []), key=lambda r: -r[2])
    dump(OUT / "brokers.json", {"source": "idx.co.id GetBrokerSummary", "date": last["date"],
                                "note": "Nilai = beli + jual broker itu di seluruh pasar (BEI tidak memisahkan sisi beli/jual).",
                                "brokers": [{"code": c, "name": n, "value": v, "volume": vol, "freq": f, "rank": i + 1}
                                            for i, (c, n, v, vol, f) in enumerate(br)]})
    return last["date"]


def main():
    have = {f.stem for f in DAYS.glob("*.json")}
    want = [d for d in trading_days(args.days) if d.isoformat() not in have]
    meta = load(OUT / "meta.json", {}) or {}
    status = {"checked": datetime.now(timezone.utc).isoformat(), "wanted": [d.isoformat() for d in want]}
    if want:
        c, errors = client()
        status["errors"] = errors
        if not c:
            status["state"] = "diblokir"
            print("BEI tidak bisa diakses dari jaringan ini; data lama dipertahankan.")
        else:
            status["method"] = c.name
            got = []
            for d in want:
                try:
                    day = fetch_day(c, d)
                    if day:
                        dump(DAYS / f"{d.isoformat()}.json", day)
                        got.append(d.isoformat())
                        print(f"  {d}: {len(day['stocks'])} saham, {len(day['indices'])} indeks, {len(day['brokers'])} broker")
                    else:
                        print(f"  {d}: tidak ada perdagangan / belum terbit")
                except Exception as e:
                    print(f"  {d}: gagal {e}")
                    status.setdefault("day_errors", []).append(f"{d}: {str(e)[:120]}")
                time.sleep(1.2)
            c.close()
            status["got"] = got
            status["state"] = "ok" if got or not want else "kosong"
    else:
        status["state"] = "ok"
        print("semua hari sudah ada")
    last = build()
    status["last_date"] = last
    meta.update(status)
    dump(OUT / "meta.json", meta)
    print("tanggal terakhir:", last, "· status:", status["state"])
    if status["state"] == "diblokir" and not last:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
