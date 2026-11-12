#!/usr/bin/env python3
"""
Laporan pasar otomatis (sesi 1 dan penutupan) dengan ringkasan AI, dikirim ke Telegram.

  python scripts/ai_report.py sesi1            # setelah sesi 1 (12:10 WIB Sen-Kam, 11:40 Jumat)
  python scripts/ai_report.py full             # setelah penutupan (17:05 WIB)
  python scripts/ai_report.py full --no-send   # buat laporan tanpa kirim Telegram
  python scripts/ai_report.py full --force     # tetap buat walau hari ini bukan hari bursa

Angka dihitung oleh skrip; AI hanya menulis narasi dari angka itu (tidak boleh menambah fakta).
Tanpa AI_API_KEY, laporan tetap dibuat dan dikirim, hanya tanpa paragraf AI.

Lingkungan:
  AI_API_KEY          key penyedia LLM (mis. Google AI Studio / Gemini, Groq, OpenRouter)
  AI_BASE_URL         endpoint OpenAI-compatible (bawaan: Gemini)
  AI_MODEL            nama model (bawaan: gemini-flash-latest)
  TELEGRAM_BOT_TOKEN  token bot dari @BotFather
  TELEGRAM_CHAT_ID    id chat/grup/kanal tujuan (boleh beberapa, pisahkan koma)
  SITE_URL            tautan situs di akhir pesan
"""
import argparse
import html
import json
import os
import pathlib
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests
import yfinance as yf

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
OUT = DATA / "ai"
WIB = timezone(timedelta(hours=7))
NOW = datetime.now(WIB)
TODAY = NOW.date().isoformat()
HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
SITE = os.environ.get("SITE_URL", "https://rgt88.github.io/idx-lite/")

ap = argparse.ArgumentParser()
ap.add_argument("kind", choices=["sesi1", "full"])
ap.add_argument("--no-send", action="store_true", help="jangan kirim ke Telegram")
ap.add_argument("--force", action="store_true", help="tetap buat walau tidak ada sesi hari ini")
ap.add_argument("--universe", type=int, default=0, help="jumlah saham teraktif yang dipantau (bawaan 150/300)")
args = ap.parse_args()
N = args.universe or (150 if args.kind == "sesi1" else 300)


def load(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return default


def num(x, nd=2):
    try:
        return None if x is None or pd.isna(x) else round(float(x), nd)
    except Exception:
        return None


def fmt(n, d=0):
    if n is None:
        return "–"
    s = f"{abs(n):,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("-" if n < 0 else "") + s


def pct(v, d=2):
    return "–" if v is None else ("+" if v > 0 else "") + fmt(v, d) + "%"


def big(v):
    if v is None:
        return "–"
    for div, suf in ((1e12, " T"), (1e9, " M"), (1e6, " jt")):
        if abs(v) >= div:
            return fmt(v / div, 1 if div < 1e12 else 2) + suf
    return fmt(v)


def tanggal(d):
    return f"{HARI[d.weekday()]}, {d.day} {BULAN[d.month - 1]} {d.year}"


# ------------------------------------------------------------------ data pasar
def yahoo_intraday(symbol):
    r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                     params={"interval": "5m", "range": "1d"}, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    m = res["meta"]
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    highs = [h for h in (q.get("high") or []) if h is not None]
    lows = [x for x in (q.get("low") or []) if x is not None]
    t = m.get("regularMarketTime")
    day = datetime.fromtimestamp(t, WIB).date().isoformat() if t else None
    price, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose") or m.get("previousClose")
    return {"value": num(price), "prev": num(prev), "change_pct": num((price - prev) / prev * 100) if price and prev else None,
            "high": num(max(highs)) if highs else None, "low": num(min(lows)) if lows else None, "date": day}


def universe():
    s = load(DATA / "summary.json")
    if s:
        return [x["symbol"] for x in sorted(s["stocks"], key=lambda x: x.get("value") or 0, reverse=True)][:N]
    return (ROOT / "symbols.txt").read_text().split()[:N]


def stock_moves(symbols):
    """Candle harian terakhir (hari ini, berjalan saat sesi 1) dibanding penutupan sebelumnya."""
    rows = []
    for i in range(0, len(symbols), 50):
        chunk = symbols[i:i + 50]
        try:
            raw = yf.download([f"{s}.JK" for s in chunk], period="5d", interval="1d", group_by="ticker",
                              auto_adjust=False, threads=True, progress=False)
        except Exception as e:
            print("gagal unduh:", e)
            continue
        for s in chunk:
            try:
                df = raw[f"{s}.JK"] if isinstance(raw.columns, pd.MultiIndex) else raw
                df = df.dropna(subset=["Close"])
                if len(df) < 2:
                    continue
                last, prev = df.iloc[-1], df.iloc[-2]
                rows.append({"symbol": s, "date": df.index[-1].strftime("%Y-%m-%d"), "price": num(last["Close"], 0),
                             "change_pct": num((last["Close"] - prev["Close"]) / prev["Close"] * 100),
                             "value": num(last["Close"] * (last["Volume"] or 0), 0)})
            except Exception:
                continue
        time.sleep(1)
    return rows


# ------------------------------------------------------------------ AI (opsional)
def llm(system, user, max_tokens=3000):  # longgar: model "thinking" ikut memakai jatah token
    key = os.environ.get("AI_API_KEY")
    if not key:
        return None, "AI_API_KEY belum diisi"
    base = os.environ.get("AI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai/"
    model = os.environ.get("AI_MODEL") or "gemini-flash-latest"
    try:
        r = requests.post(base.rstrip("/") + "/chat/completions", timeout=90,
                          headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                          json={"model": model, "temperature": 0.3, "max_tokens": max_tokens,
                                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        if r.status_code >= 400:
            return None, f"HTTP {r.status_code}: {r.text[:200]}"
        return r.json()["choices"][0]["message"]["content"].strip(), model
    except Exception as e:
        return None, str(e)[:200]


SYSTEM = (
    "Kamu analis pasar saham Indonesia yang menulis ringkasan singkat untuk investor ritel. "
    "Tulis dalam Bahasa Indonesia yang lugas. Gunakan HANYA angka dan fakta dalam data yang diberikan; "
    "jangan menambah berita, alasan, atau angka dari luar data. Kalau penyebab tidak ada di data, jangan menebak penyebabnya. "
    "Jangan memberi rekomendasi beli/jual atau target harga. Tanpa judul, tanpa markdown, tanpa emoji."
)


# ------------------------------------------------------------------ susun laporan
def build():
    # Sesi 1: kalau jadwal GitHub telat sampai sesi 2 sudah buka, angkanya bukan lagi angka sesi 1.
    sesi2 = NOW.replace(hour=14 if NOW.weekday() == 4 else 13, minute=0 if NOW.weekday() == 4 else 30, second=0, microsecond=0)
    if args.kind == "sesi1" and NOW >= sesi2 and not args.force:
        print(f"Sudah lewat pembukaan sesi 2 ({sesi2:%H:%M} WIB); laporan sesi 1 dilewati. Pakai --force untuk tetap membuat.")
        sys.exit(0)
    ihsg = None
    try:
        ihsg = yahoo_intraday("%5EJKSE")
    except Exception as e:
        print("IHSG gagal:", e)
    if not args.force and (not ihsg or ihsg.get("date") != TODAY):
        print(f"Tidak ada sesi bursa hari ini ({TODAY}); laporan tidak dibuat.")
        sys.exit(0)

    moves = [m for m in stock_moves(universe()) if m["date"] == TODAY or args.force]
    hsc = set((load(DATA / "hsc.json", {}) or {}).get("codes", []))
    liquid = [m for m in moves if (m["value"] or 0) >= (5e8 if args.kind == "sesi1" else 1e9) and m["symbol"] not in hsc]
    up = sum(1 for m in moves if (m["change_pct"] or 0) > 0)
    down = sum(1 for m in moves if (m["change_pct"] or 0) < 0)
    by = lambda key, rev: sorted([m for m in liquid if m[key] is not None], key=lambda m: m[key], reverse=rev)
    facts = {
        "kind": args.kind, "date": TODAY, "ihsg": ihsg,
        "breadth": {"naik": up, "turun": down, "tetap": len(moves) - up - down, "dipantau": len(moves)},
        "gainers": [m for m in by("change_pct", True) if m["change_pct"] > 0][:7],
        "losers": [m for m in by("change_pct", False) if m["change_pct"] < 0][:7],
        "active": sorted(moves, key=lambda m: m["value"] or 0, reverse=True)[:7],
        "hsc_movers": sorted([m for m in moves if m["symbol"] in hsc and abs(m["change_pct"] or 0) >= 10],
                             key=lambda m: -abs(m["change_pct"]))[:5],
    }
    macro = {}
    for k, sym in (("usdidr", "IDR=X"), ("wti", "CL=F")):
        try:
            macro[k] = yahoo_intraday(sym)
        except Exception:
            pass
    d = load(DATA / "data.json", {}) or {}
    for k in ("bond_5y", "bond_10y"):
        if isinstance(d.get(k), dict):
            macro[k] = {"value": d[k].get("value"), "chg_1d_bp": d[k].get("chg_1d_bp"), "date": d[k].get("date")}
    facts["macro"] = macro
    if args.kind == "full":
        mf = (load(DATA / "flow" / "market_foreign.json", {}) or {}).get("data") or {}
        if mf.get("date") == TODAY:
            net = lambda r: r.get("foreign_net_value", r.get("foreign_net_value_at_close"))
            facts["foreign"] = {"net_buy": [{"symbol": r["symbol"], "net": net(r)} for r in (mf.get("net_buy") or [])[:5]],
                                "net_sell": [{"symbol": r["symbol"], "net": net(r)} for r in (mf.get("net_sell") or [])[:5]]}
    return facts


def stock_notes(facts):
    """Catatan AI singkat untuk saham teraktif (hanya laporan penutupan)."""
    fi = (load(DATA / "fundamentals.json", {}) or {}).get("stocks", {})
    summ = {x["symbol"]: x for x in (load(DATA / "summary.json", {}) or {}).get("stocks", [])}
    hsc = set((load(DATA / "hsc.json", {}) or {}).get("codes", []))
    picks = [m["symbol"] for m in facts["active"]][:5] + [m["symbol"] for m in facts["gainers"][:3] + facts["losers"][:3]]
    picks = list(dict.fromkeys(picks))[:10]
    data = {}
    for s in picks:
        m = next((x for x in facts["active"] + facts["gainers"] + facts["losers"] if x["symbol"] == s), {})
        sm, f = summ.get(s, {}), fi.get(s, {})
        data[s] = {"harga": m.get("price"), "perubahan_pct": m.get("change_pct"), "nilai_transaksi": m.get("value"),
                   "rsi14": sm.get("rsi14"), "sma20": sm.get("sma20"), "sma50": sm.get("sma50"),
                   "pe": f.get("pe"), "pb": f.get("pb"), "roe_pct": f.get("roe"), "dividend_yield_pct": f.get("div_yield"),
                   "target_analis_rata2": f.get("target"), "jumlah_analis": f.get("analysts"), "rekomendasi_analis": f.get("rec"),
                   "hsc": s in hsc}
    text, model = llm(SYSTEM + " Balas HANYA dengan JSON objek {KODE: catatan}, tiap catatan 1-2 kalimat (maks 45 kata) "
                      "tentang pergerakan hari ini dan posisi teknikal/valuasinya menurut data.",
                      json.dumps(data, ensure_ascii=False), max_tokens=4000)
    if not text:
        print("catatan saham tanpa AI:", model)
        return None
    try:
        notes = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
        return {"date": TODAY, "model": model, "notes": {k: str(v)[:400] for k, v in notes.items() if k in data}}
    except Exception:
        print("jawaban AI bukan JSON yang valid")
        return None


def message(facts, ai_text):
    k = facts["kind"]
    ih = facts["ihsg"] or {}
    b = facts["breadth"]
    title = "IHSG Sesi 1" if k == "sesi1" else "IHSG Penutupan"
    lines = [f"<b>{title} · {tanggal(NOW.date())}</b>"]
    if ih.get("value"):
        rng = f" · rentang {fmt(ih.get('low'), 0)}–{fmt(ih.get('high'), 0)}" if ih.get("low") else ""
        lines.append(f"IHSG <b>{fmt(ih['value'], 2)}</b> ({pct(ih.get('change_pct'))}){rng}")
    lines.append(f"Naik {b['naik']} · Turun {b['turun']} · Tetap {b['tetap']} <i>({b['dipantau']} saham teraktif)</i>")
    row = lambda xs, f: " · ".join(f(x) for x in xs) or "–"
    lines.append("")
    lines.append("<b>Top gainer</b>: " + row(facts["gainers"][:5], lambda m: f"{m['symbol']} {pct(m['change_pct'], 1)}"))
    lines.append("<b>Top loser</b>: " + row(facts["losers"][:5], lambda m: f"{m['symbol']} {pct(m['change_pct'], 1)}"))
    lines.append("<b>Teraktif</b>: " + row(facts["active"][:5], lambda m: f"{m['symbol']} {big(m['value'])}"))
    if facts.get("hsc_movers"):
        lines.append("<b>Saham HSC bergerak tajam</b>: " + row(facts["hsc_movers"], lambda m: f"{m['symbol']} {pct(m['change_pct'], 1)}"))
    if facts.get("foreign"):
        fr = facts["foreign"]
        lines.append("<b>Net beli asing</b>: " + row(fr["net_buy"], lambda r: f"{r['symbol']} {big(r['net'])}"))
        lines.append("<b>Net jual asing</b>: " + row(fr["net_sell"], lambda r: f"{r['symbol']} {big(r['net'])}"))
    mc = facts.get("macro", {})
    parts = []
    if mc.get("usdidr", {}).get("value"):
        parts.append(f"USD/IDR {fmt(mc['usdidr']['value'], 0)} ({pct(mc['usdidr'].get('change_pct'))})")
    if mc.get("wti", {}).get("value"):
        parts.append(f"WTI {fmt(mc['wti']['value'], 2)} ({pct(mc['wti'].get('change_pct'))})")
    if mc.get("bond_10y", {}).get("value"):
        parts.append(f"SBN 10Y {fmt(mc['bond_10y']['value'], 2)}%")
    if parts:
        lines.append("")
        lines.append(" · ".join(parts))
    ttb = time_to_buy()
    if ttb:
        lines += ["", "<b>Time to buy</b> <i>(penyaring, bukan rekomendasi)</i>"] + ttb
    if ai_text:
        lines += ["", "<b>Ringkasan AI</b>", html.escape(ai_text)]
    lines += ["", f'<a href="{SITE}">Buka IDX Lite</a> · <i>data tertunda, bukan saran investasi</i>']
    return "\n".join(lines)


def time_to_buy():
    """Sinyal beli dari signals.json (scripts/build_signals.py), hanya kalau sudah sesi hari ini."""
    sig = load(DATA / "signals.json")
    if not sig or sig.get("session") != TODAY or args.kind != "full":
        return []
    st, out = sig["stocks"], []
    for key, k, label in (("combined", "c", "Gabungan"), ("technical", "t", "Teknikal"), ("fundamental", "f", "Fundamental")):
        names = [s for s in sig["lists"][key] if st[s][k]["status"] == "beli"]
        if names:
            shown = []
            for s in names[:6]:
                x = st[s][k]
                tag = " (baru)" if x.get("since") == TODAY else ""
                shown.append(f"{s}{' ⚑HSC' if st[s].get('hsc') else ''} {x['score']}{tag}")
            more = f" +{len(names) - 6} lagi" if len(names) > 6 else ""
            out.append(f"{label}: " + " · ".join(shown) + more)
        else:
            out.append(f"{label}: –")
    return out


def send_telegram(text):
    token, chats = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chats:
        return "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID belum diisi"
    res = []
    for chat in [c.strip() for c in chats.split(",") if c.strip()]:
        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            r = requests.post(url, timeout=30, json={"chat_id": chat, "text": text[:4096], "parse_mode": "HTML",
                                                     "disable_web_page_preview": True})
            if not r.ok and "parse" in r.text.lower():  # HTML ditolak: kirim ulang sebagai teks biasa
                plain = html.unescape(re.sub(r"<[^>]+>", "", text))
                r = requests.post(url, timeout=30, json={"chat_id": chat, "text": plain[:4096], "disable_web_page_preview": True})
            res.append(f"{chat}: {'ok' if r.ok else r.text[:150]}")
        except Exception as e:
            res.append(f"{chat}: {e}")
    return "; ".join(res)


def main():
    # Jangan kirim dua kali: pengatur dan jadwal bisa sama-sama memicu laporan yang sama.
    done = {r["id"] for r in (load(OUT / "index.json", {"reports": []}) or {"reports": []}).get("reports", [])}
    if f"{TODAY}-{args.kind}" in done and not args.force:
        print(f"Laporan {TODAY}-{args.kind} sudah ada; tidak dibuat ulang (pakai --force untuk mengirim ulang).")
        return
    facts = build()
    prompt = ("Data pasar " + ("sesi 1" if args.kind == "sesi1" else "penutupan") + f" hari ini ({TODAY}):\n"
              + json.dumps(facts, ensure_ascii=False, default=str)
              + "\n\nTulis ringkasan 3-5 kalimat (maks 110 kata): arah IHSG, luas penguatan/pelemahan, saham yang menonjol, "
                "dan kondisi makro bila ada di data. Sebut saham HSC sebagai berisiko volatil bila muncul.")
    ai_text, model = llm(SYSTEM, prompt)
    if not ai_text:
        print("ringkasan tanpa AI:", model)
    text = message(facts, ai_text)
    print(re.sub(r"<[^>]+>", "", text))

    sent = "tidak dikirim (--no-send)" if args.no_send else send_telegram(text)
    print("telegram:", sent)
    report = {"id": f"{TODAY}-{args.kind}", "kind": args.kind, "date": TODAY, "generated_at": NOW.isoformat(),
              "facts": facts, "ai_text": ai_text, "model": model if ai_text else None, "telegram": sent, "message_html": text}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{report['id']}.json").write_text(json.dumps(report, ensure_ascii=False, default=str))
    idx = load(OUT / "index.json", {"reports": []}) or {"reports": []}
    idx["reports"] = [r for r in idx["reports"] if r["id"] != report["id"]]
    idx["reports"].insert(0, {"id": report["id"], "kind": args.kind, "date": TODAY, "generated_at": report["generated_at"],
                              "ihsg_change_pct": (facts["ihsg"] or {}).get("change_pct"), "ai": bool(ai_text)})
    idx["reports"] = sorted(idx["reports"], key=lambda r: r["generated_at"], reverse=True)[:120]
    keep = {r["id"] for r in idx["reports"]}
    for f in OUT.glob("20*.json"):
        if f.stem not in keep:
            f.unlink()
    (OUT / "index.json").write_text(json.dumps(idx, ensure_ascii=False))
    (OUT / "latest.json").write_text(json.dumps(report, ensure_ascii=False, default=str))
    if args.kind == "full":
        notes = stock_notes(facts)
        if notes:
            (OUT / "stocks.json").write_text(json.dumps(notes, ensure_ascii=False))


if __name__ == "__main__":
    main()
