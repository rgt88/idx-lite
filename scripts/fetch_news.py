#!/usr/bin/env python3
"""
Berita pasar + tema dampak sektor.

  python scripts/fetch_news.py               # ambil RSS, tandai dengan AI, hitung tema & dampak
  python scripts/fetch_news.py --no-ai       # tanpa AI (penanda kata kunci sederhana)
  python scripts/fetch_news.py --test-feeds  # hanya cek setiap feed di news_sources.json

Alur:
1. Ambil feed RSS dari docs/data/news_sources.json (judul, ringkasan, tanggal, tautan; isi artikel tidak disimpan).
2. Buang duplikat (judul yang sama dari beberapa sumber) dan berita > 7 hari.
3. Berita baru ditandai AI (endpoint OpenAI-compatible yang sama dengan laporan AI): kode saham yang disebut
   beserta sentimen (-1..1) dan relevansi (0..1), serta tema dari docs/data/themes.json beserta arah (naik/turun)
   dan kekuatannya. Kode dicocokkan dengan symbols.txt; tema di luar daftar dicatat sebagai "tema tanpa peta".
   Tanpa AI_API_KEY: penanda kata kunci sederhana.
4. Tema dijumlahkan selama 7 hari (bobot meluruh, waktu paruh 3 hari), lalu dipetakan ke sektor lewat themes.json:
   grup 'pos' kena dampak searah, grup 'neg' berlawanan. Hasilnya dampak per saham (langsung + lewat tema).
5. "Cek pasar": rata-rata pergerakan saham grup positif dan negatif sejak berita tema pertama muncul.

Keluaran di docs/data/news/: articles.json, themes.json, impact.json, meta.json
"""
import argparse
import email.utils
import hashlib
import html
import json
import os
import pathlib
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
OUT = DATA / "news"
WIB = timezone(timedelta(hours=7))
NOW = datetime.now(timezone.utc)
KEEP_DAYS = 7
HALF_LIFE = 3.0
UA = {"User-Agent": "Mozilla/5.0 (compatible; IDX-Lite news reader; +https://github.com/rgt88/idx-lite)"}

ap = argparse.ArgumentParser()
ap.add_argument("--no-ai", action="store_true")
ap.add_argument("--test-feeds", action="store_true")
ap.add_argument("--max-new", type=int, default=150, help="maksimum berita baru yang ditandai AI per run")
args = ap.parse_args()


def load(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return default


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def clean(text, n=300):
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:n].rsplit(" ", 1)[0] + "…" if len(text) > n else text


def norm_title(t):
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


# ------------------------------------------------------------------ 1. RSS
def parse_date(s):
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except Exception:
        try:
            d = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
        except Exception:
            return None
    return d if d.tzinfo else d.replace(tzinfo=WIB)


def fetch_feed(feed):
    r = requests.get(feed["url"], headers=UA, timeout=25)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    items = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        get = lambda name: next((c for c in it if c.tag.split("}")[-1] == name), None)
        title = (get("title").text if get("title") is not None else "") or ""
        link_el = get("link")
        link = (link_el.text or link_el.get("href") or "") if link_el is not None else ""
        date_el = next((e for e in (get("pubDate"), get("published"), get("updated"), get("date")) if e is not None), None)
        date = parse_date(date_el.text if date_el is not None else None)
        desc_el = get("description") if get("description") is not None else get("summary")
        source = feed["name"]
        src_el = get("source")
        if src_el is not None and src_el.text:            # Google News: sumber asli
            source = src_el.text.strip()
            title = re.sub(r"\s+-\s+" + re.escape(source) + r"\s*$", "", title)
        title = clean(title, 220)
        if not title or not link:
            continue
        items.append({"t": title, "u": link.strip(), "s": source, "d": date.astimezone(timezone.utc).isoformat() if date else None,
                      "x": clean(desc_el.text if desc_el is not None else "") if "news.google.com" not in feed["url"] else ""})
    return items


# ------------------------------------------------------------------ 3. penandaan
STOP = set("""DARI AKAN ATAU JUGA BANK DALAM YANG PADA ATAS NAIK UNTUK BAGI LAGI SAAT HARI HARGA EMAS DUIT KABAR LABA RUGI
PAJAK BURSA SAHAM DANA BUMN BESAR BARU JUAL BELI MASA KATA LALU SATU DUA TIGA OLEH PERSEN MINYAK GAJI MODAL ASET KERJA
LIMA ENAM BUKA DATA BAIK RAYA PERI TIGA KAMI KITA MAKA SAMA ROTI KIRA CEPAT KUAT POOL JAGO BOLA MEGA ASIA BINA GOOD
TOTAL CITA MINA FAST TEXT ALFA PERU BELI SINAR""".split())
SYMBOLS = set((ROOT / "symbols.txt").read_text().split()) if (ROOT / "symbols.txt").exists() else set()
THEMES = load(DATA / "themes.json", {"groups": {}, "themes": []})
THEME_IDS = {t["id"] for t in THEMES["themes"]}

KEYWORDS = [  # cadangan tanpa AI: (tema, pola subjek)
    ("batubara", r"batu ?bara|coal"), ("minyak", r"minyak (mentah|dunia)|brent|wti"), ("cpo", r"\bcpo\b|sawit"),
    ("nikel", r"nikel"), ("emas", r"harga emas"), ("timah", r"harga timah"), ("tembaga", r"tembaga"),
    ("rupiah_menguat", r"rupiah"), ("bi_rate", r"bi ?rate|suku bunga (acuan )?bi\b|bank indonesia.*suku bunga"),
    ("the_fed", r"the fed|fed funds|suku bunga (as|fed)"), ("inflasi", r"inflasi"), ("cukai_rokok", r"cukai (rokok|hasil tembakau)"),
]
UP = r"naik|melonjak|menguat|melesat|meroket|reli|tertinggi|terbang|kenaikan|dinaikkan|menanjak"
DOWN = r"turun|anjlok|melemah|merosot|ambles|terendah|jatuh|tergelincir|penurunan|dipangkas|longsor"


def keyword_tags(a):
    text = (a["t"] + " " + a.get("x", "")).lower()
    up, down = bool(re.search(UP, text)), bool(re.search(DOWN, text))
    themes = []
    for tid, pat in KEYWORDS:
        if re.search(pat, text) and up != down:
            themes.append([tid, "up" if up else "down", 0.4, "kata kunci"])
    codes = [w for w in re.findall(r"\b[A-Z]{4}\b", a["t"]) if w in SYMBOLS and w not in STOP]
    return [[c, 0.0, 0.5, ""] for c in dict.fromkeys(codes)], themes


def llm(messages, max_tokens=6000):
    key = os.environ.get("AI_API_KEY")
    if not key or args.no_ai:
        return None, "AI tidak dipakai (AI_API_KEY kosong atau --no-ai)"
    base = os.environ.get("AI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai/"
    model = os.environ.get("AI_MODEL") or "gemini-flash-latest"
    try:
        r = requests.post(base.rstrip("/") + "/chat/completions", timeout=120,
                          headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                          json={"model": model, "temperature": 0.1, "max_tokens": max_tokens, "messages": messages})
        if r.status_code >= 400:
            return None, f"HTTP {r.status_code}: {r.text[:200]}"
        return r.json()["choices"][0]["message"]["content"], model
    except Exception as e:
        return None, str(e)[:200]


SYSTEM = (
    "Kamu analis pasar saham Indonesia. Tugasmu menandai berita, bukan memberi saran investasi. "
    "Untuk setiap berita tentukan: (1) kode saham BEI 4 huruf yang benar-benar dibahas (bukan sekadar kata 4 huruf), "
    "dengan sentimen -1 (negatif bagi saham itu) sampai 1 (positif) dan relevansi 0-1; "
    "(2) tema penggerak pasar dari DAFTAR TEMA yang dibahas berita itu, dengan arah 'up' (naik/terjadi/diperketat) atau "
    "'down' (turun/dibatalkan/dilonggarkan) dan kekuatan 0-1 (seberapa besar/pasti beritanya). "
    "Untuk tema rupiah_menguat: rupiah menguat = up, melemah = down. Untuk bi_rate/the_fed: suku bunga naik = up, turun = down. "
    "Untuk asing_masuk: net buy asing = up, net sell = down. "
    "Jangan menebak tema yang tidak dibahas. Kalau ada penggerak penting yang tidak ada di daftar, isi 'tema_baru' dengan label singkat. "
    "Alasan maksimal 15 kata. Balas HANYA JSON array."
)


def ai_tags(batch):
    theme_list = "\n".join(f"- {t['id']}: {t['label']}" for t in THEMES["themes"])
    items = [{"i": i, "judul": a["t"], "ringkasan": a.get("x", "")} for i, a in enumerate(batch)]
    user = (f"DAFTAR TEMA:\n{theme_list}\n\nFormat tiap elemen: "
            '{"i":0,"saham":[{"kode":"BBCA","sentimen":0.5,"relevansi":0.8,"alasan":"..."}],'
            '"tema":[{"id":"batubara","arah":"up","kekuatan":0.7,"alasan":"..."}],"tema_baru":null}\n\n'
            f"BERITA:\n{json.dumps(items, ensure_ascii=False)}")
    text, info = llm([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
    if not text:
        return None, info
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return None, "jawaban AI bukan JSON array"
    try:
        rows = json.loads(m.group(0))
    except Exception:
        return None, "JSON AI tidak valid"
    out = {}
    for r in rows:
        try:
            i = int(r["i"])
        except Exception:
            continue
        codes = []
        for s in r.get("saham") or []:
            c = str(s.get("kode", "")).upper().replace(".JK", "")
            if c in SYMBOLS:
                codes.append([c, max(-1, min(1, float(s.get("sentimen") or 0))), max(0, min(1, float(s.get("relevansi") or 0))),
                              str(s.get("alasan") or "")[:140]])
        themes = []
        for t in r.get("tema") or []:
            if t.get("id") in THEME_IDS and t.get("arah") in ("up", "down"):
                themes.append([t["id"], t["arah"], max(0, min(1, float(t.get("kekuatan") or 0.5))), str(t.get("alasan") or "")[:140]])
        new = r.get("tema_baru")
        out[i] = (codes, themes, str(new)[:60] if new else None)
    return out, info


# ------------------------------------------------------------------ 4-5. agregasi
def weight(iso):
    try:
        age = (NOW - datetime.fromisoformat(iso)).total_seconds() / 86400
    except Exception:
        age = KEEP_DAYS
    return 0.5 ** (max(age, 0) / HALF_LIFE)


def group_members():
    fund = (load(DATA / "fundamentals.json", {}) or {}).get("stocks", {})
    by_ind = {}
    for s, f in fund.items():
        if f.get("industry"):
            by_ind.setdefault(f["industry"], []).append(s)
    members = {}
    for gid, g in THEMES["groups"].items():
        syms = [s for s in g.get("symbols", [])]
        for ind in g.get("industries", []):
            syms += by_ind.get(ind, [])
        members[gid] = [s for s in dict.fromkeys(syms) if not SYMBOLS or s in SYMBOLS]
    return members


def close_on_or_before(rows, day):
    last = None
    for r in rows:
        if r[0] < day:
            last = r[4]
        else:
            break
    return last


def market_check(syms, start_day):
    rets = []
    for s in syms:
        rows = load(DATA / "prices" / f"{s}.json")
        if not rows or rows[-1][0] < start_day:   # belum ada harga setelah berita muncul
            continue
        base = close_on_or_before(rows, start_day)
        if base:
            rets.append((rows[-1][4] / base - 1) * 100)
    return (round(sum(rets) / len(rets), 2), len(rets)) if rets else (None, 0)


def aggregate(articles):
    members = group_members()
    tmap = {t["id"]: t for t in THEMES["themes"]}
    agg, unmapped = {}, {}
    for a in articles:
        w = weight(a["d"])
        for tid, direction, strength, why in a.get("th", []):
            g = agg.setdefault(tid, {"score": 0.0, "n": 0, "ids": [], "first": a["d"][:10]})
            g["score"] += (1 if direction == "up" else -1) * strength * w
            g["n"] += 1
            g["ids"].append(a["id"])
            g["first"] = min(g["first"], a["d"][:10])
        if a.get("nt"):
            u = unmapped.setdefault(a["nt"].lower(), {"label": a["nt"], "n": 0, "ids": []})
            u["n"] += 1
            u["ids"].append(a["id"])

    themes_out, impact = [], {}
    for tid, g in agg.items():
        t = tmap.get(tid)
        if not t:
            continue
        score = round(g["score"], 2)
        sign = 1 if score > 0 else -1 if score < 0 else 0
        active = abs(score) >= 0.3 or g["n"] >= 2
        pos_syms = sorted({s for gid in t["pos"] for s in members.get(gid, [])})
        neg_syms = sorted({s for gid in t["neg"] for s in members.get(gid, [])})
        chk_pos, n_pos = market_check(pos_syms, g["first"]) if active and sign else (None, 0)
        chk_neg, n_neg = market_check(neg_syms, g["first"]) if active and sign else (None, 0)
        verdict = None
        if sign and chk_pos is not None and chk_neg is not None:
            exp = (chk_pos - chk_neg) * sign
            verdict = "sesuai" if exp > 0.5 else "berlawanan" if exp < -0.5 else "belum terlihat"
        elif sign and (chk_pos is not None or chk_neg is not None):
            v = chk_pos if chk_pos is not None else -chk_neg
            verdict = "sesuai" if v * sign > 0.5 else "berlawanan" if v * sign < -0.5 else "belum terlihat"
        themes_out.append({
            "id": tid, "label": t["label"], "why": t.get("why"), "score": score, "dir": "up" if sign > 0 else "down" if sign < 0 else "flat",
            "n": g["n"], "first": g["first"], "active": active, "articles": g["ids"][:12],
            "pos": [{"group": gid, "label": THEMES["groups"][gid]["label"], "symbols": members.get(gid, [])} for gid in t["pos"] if gid in THEMES["groups"]],
            "neg": [{"group": gid, "label": THEMES["groups"][gid]["label"], "symbols": members.get(gid, [])} for gid in t["neg"] if gid in THEMES["groups"]],
            "check": {"pos": chk_pos, "pos_n": n_pos, "neg": chk_neg, "neg_n": n_neg, "verdict": verdict},
        })
        if not active or not sign:
            continue
        done = set()
        for side, gids in ((1, t["pos"]), (-1, t["neg"])):
            for gid in gids:
                for s in members.get(gid, []):
                    if s in done:          # satu saham di dua grup tema yang sama: hitung sekali
                        continue
                    done.add(s)
                    e = impact.setdefault(s, {"direct": [], "themes": [], "score_direct": 0.0, "score_theme": 0.0})
                    eff = round(side * score, 2)
                    e["themes"].append({"id": tid, "label": t["label"], "dir": "up" if sign > 0 else "down",
                                        "effect": eff, "group": THEMES["groups"][gid]["label"]})
                    e["score_theme"] = round(e["score_theme"] + eff, 2)
    for a in articles:
        w = weight(a["d"])
        for code, sent, rel, why in a.get("k", []):
            e = impact.setdefault(code, {"direct": [], "themes": [], "score_direct": 0.0, "score_theme": 0.0})
            e["direct"].append([a["id"], sent, rel])
            e["score_direct"] = round(e["score_direct"] + sent * rel * w, 2)
    for e in impact.values():
        e["direct"] = e["direct"][:15]
    themes_out.sort(key=lambda x: (not x["active"], -abs(x["score"])))
    return themes_out, impact, sorted(unmapped.values(), key=lambda u: -u["n"])


# ------------------------------------------------------------------ utama
def main():
    sources = load(DATA / "news_sources.json", {"feeds": []})["feeds"]
    status, fresh = {}, []
    for f in [f for f in sources if f.get("on", True)]:
        try:
            items = fetch_feed(f)
            status[f["name"]] = f"ok {len(items)}"
            fresh += items
        except Exception as e:
            status[f["name"]] = f"gagal: {str(e)[:120]}"
        time.sleep(1.5)
    for k, v in status.items():
        print(f"  {k:<28} {v}")
    if args.test_feeds:
        return

    old = (load(OUT / "articles.json", {}) or {}).get("articles", [])
    cutoff = (NOW - timedelta(days=KEEP_DAYS)).isoformat()
    by_id = {a["id"]: a for a in old if a.get("d", "") >= cutoff}
    seen_titles = {norm_title(a["t"]) for a in by_id.values()}
    new = []
    for it in sorted(fresh, key=lambda x: x["d"] or "", reverse=True):
        if not it["d"] or it["d"] < cutoff:
            continue
        nt = norm_title(it["t"])
        if nt in seen_titles:
            continue
        seen_titles.add(nt)
        it["id"] = hashlib.sha1(nt.encode()).hexdigest()[:12]
        new.append(it)
    print(f"berita baru {len(new)}, tersimpan {len(by_id)}")

    tag_now, ai_info, ai_ok = new[: args.max_new], None, 0
    for i in range(0, len(tag_now), 25):
        batch = tag_now[i:i + 25]
        res, ai_info = ai_tags(batch)
        for j, a in enumerate(batch):
            if res is not None and j in res:
                a["k"], a["th"], nt = res[j]
                if nt:
                    a["nt"] = nt
                a["ai"] = True
                ai_ok += 1
            else:
                a["k"], a["th"] = keyword_tags(a)
                a["ai"] = False
        if res is None and i == 0 and "tidak dipakai" not in str(ai_info):
            print("AI gagal:", ai_info)
        time.sleep(4 if res is not None else 0)
    for a in new[args.max_new:]:          # sisanya ditandai kata kunci saja
        a["k"], a["th"] = keyword_tags(a)
        a["ai"] = False
    for a in new:
        by_id[a["id"]] = a

    articles = sorted(by_id.values(), key=lambda a: a["d"], reverse=True)
    themes, impact, unmapped = aggregate(articles)
    dump(OUT / "articles.json", {"updated": NOW.isoformat(), "articles": articles})
    dump(OUT / "themes.json", {"updated": NOW.isoformat(), "themes": themes, "unmapped": unmapped[:20]})
    dump(OUT / "impact.json", {"updated": NOW.isoformat(), "stocks": impact})
    dump(OUT / "meta.json", {"updated": NOW.isoformat(), "feeds": status, "articles": len(articles), "new": len(new),
                             "ai_tagged": ai_ok, "ai_info": ai_info, "themes_version": THEMES.get("version")})
    act = [t for t in themes if t["active"]]
    print(f"selesai: {len(articles)} berita (7 hari), {ai_ok} ditandai AI; tema aktif: "
          + ", ".join(f"{t['label']} {'↑' if t['dir'] == 'up' else '↓'} ({t['score']:+.2f})" for t in act[:8]))
    if unmapped:
        print("tema tanpa peta:", ", ".join(f"{u['label']} ({u['n']})" for u in unmapped[:8]))
    if not fresh:
        raise SystemExit("Semua feed gagal")


if __name__ == "__main__":
    main()
