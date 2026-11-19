#!/usr/bin/env python3
"""
CDS 5 tahun Indonesia dari pemberitaan (tidak ada sumber data CDS gratis yang resmi).

  python scripts/fetch_cds.py

Cara: cari berita 14 hari terakhir lewat Google News RSS ("CDS Indonesia 5 tahun" dan variasinya), ambil angka
CDS yang DISEBUT di judul/ringkasan (pola "CDS ... 72,5 bps"), pilih berita terbaru. Kalau AI_API_KEY ada,
AI diminta memastikan angkanya memang CDS tenor 5 tahun dan menyalin angkanya (bukan menebak).
Hasil: docs/data/cds.json {value, date, source, url, title, method}. macro_update.py memakai angka ini kecuali
manual.json berisi angka yang lebih baru.
"""
import email.utils
import html
import json
import os
import pathlib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "cds.json"
QUERIES = ['"CDS" Indonesia 5 tahun', "credit default swap Indonesia bps", '"CDS 5 tahun"']
PAT = re.compile(r"(?:CDS|credit default swap)[^.;]{0,90}?(\d{2,3}(?:[.,]\d{1,3})?)\s*(?:bps|bp|basis poin|basis points)", re.I)


def clean(t):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t or ""))).strip()


def items():
    out = []
    for q in QUERIES:
        url = "https://news.google.com/rss/search"
        try:
            r = requests.get(url, params={"q": q + " when:14d", "hl": "id", "gl": "ID", "ceid": "ID:id"},
                             headers={"User-Agent": "Mozilla/5.0"}, timeout=25)
            r.raise_for_status()
            root = ET.fromstring(r.content)
        except Exception as e:
            print("gagal", q, e)
            continue
        for it in root.iter("item"):
            g = lambda n: (it.findtext(n) or "")
            try:
                d = email.utils.parsedate_to_datetime(g("pubDate")).astimezone(timezone.utc)
            except Exception:
                continue
            out.append({"title": clean(g("title")), "desc": clean(g("description")), "url": g("link"),
                        "source": g("source") or "Google News", "date": d})
    seen, uniq = set(), []
    for x in sorted(out, key=lambda x: x["date"], reverse=True):
        if x["title"] not in seen:
            seen.add(x["title"])
            uniq.append(x)
    return uniq


def ai_check(cands):
    key = os.environ.get("AI_API_KEY")
    if not key:
        return None
    base = os.environ.get("AI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai/"
    model = os.environ.get("AI_MODEL") or "gemini-flash-latest"
    lst = [{"i": i, "judul": c["title"], "ringkasan": c["desc"][:300], "tanggal": c["date"].date().isoformat()} for i, c in enumerate(cands)]
    prompt = ("Dari daftar berita berikut, cari angka CDS (credit default swap) Indonesia TENOR 5 TAHUN yang disebut eksplisit. "
              "Jangan menghitung atau menebak. Balas JSON {\"i\": nomor berita terbaru yang menyebut angka itu, \"value\": angka bps} "
              "atau {\"i\": null} kalau tidak ada.\n" + json.dumps(lst, ensure_ascii=False))
    try:
        r = requests.post(base.rstrip("/") + "/chat/completions", timeout=90,
                          headers={"Authorization": f"Bearer {key}"},
                          json={"model": model, "temperature": 0, "max_tokens": 2000,
                                "messages": [{"role": "user", "content": prompt}]})
        m = re.search(r"\{.*\}", r.json()["choices"][0]["message"]["content"], re.S)
        j = json.loads(m.group(0))
        if j.get("i") is None:
            return None
        return int(j["i"]), float(str(j["value"]).replace(",", "."))
    except Exception as e:
        print("AI gagal:", e)
        return None


def main():
    its = items()
    print(f"{len(its)} berita kandidat")
    found = []
    for it in its:
        m = PAT.search(it["title"] + " . " + it["desc"])
        if m:
            v = float(m.group(1).replace(",", "."))
            if 20 <= v <= 600:                     # rentang wajar CDS 5Y Indonesia
                found.append((it, v))
    chosen, method = None, None
    ai = ai_check(its[:30]) if its else None
    if ai and 0 <= ai[0] < len(its) and 20 <= ai[1] <= 600:
        chosen, method = (its[ai[0]], ai[1]), "berita + AI"
    elif found:
        chosen, method = found[0], "berita + pola teks"
    if not chosen:
        print("tidak ada angka CDS di berita 14 hari terakhir; nilai lama dipertahankan")
        return
    it, v = chosen
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    res = {"value": v, "date": it["date"].astimezone(timezone(timedelta(hours=7))).date().isoformat(), "unit": "bps",
           "source": it["source"], "title": it["title"], "url": it["url"], "method": method,
           "checked": datetime.now(timezone.utc).isoformat()}
    if old.get("date", "") > res["date"]:
        print("angka tersimpan lebih baru; tidak diganti")
        return
    OUT.write_text(json.dumps(res, ensure_ascii=False))
    print(f"CDS 5Y {v} bps ({res['date']}, {it['source']}, {method})")


if __name__ == "__main__":
    main()
