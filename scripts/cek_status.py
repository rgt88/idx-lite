#!/usr/bin/env python3
"""
Checkpoint harian: apakah setiap bagian data di situs sudah diperbarui?

  python scripts/cek_status.py                 # situs publik
  python scripts/cek_status.py --runs          # + status run terakhir tiap workflow (butuh gh)
  python scripts/cek_status.py --base http://localhost:8000   # pratinjau lokal

Keluar dengan kode 1 kalau ada bagian berstatus GAGAL, jadi bisa dipakai di skrip lain.
Tanggal sesi bursa dihitung dari hari kerja; hari libur bursa belum diperhitungkan, jadi saat
libur bagian harga bisa tampil TELAT padahal wajar.
"""
import argparse
import json
import subprocess
import sys
import urllib.request
from datetime import date, datetime, time, timedelta, timezone

WIB = timezone(timedelta(hours=7))
ap = argparse.ArgumentParser()
ap.add_argument("--base", default="https://rgt88.github.io/idx-lite", help="alamat situs")
ap.add_argument("--runs", action="store_true", help="tampilkan juga run terakhir tiap workflow (gh)")
args = ap.parse_args()
BASE = args.base.rstrip("/") + "/data/"
NOW = datetime.now(WIB)


def get(path):
    try:
        with urllib.request.urlopen(BASE + path + f"?t={int(NOW.timestamp())}", timeout=20) as r:
            return json.load(r)
    except Exception:
        return None


def parse_ts(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def last_session():
    """Sesi bursa terakhir yang sudah tutup (16:15 WIB), hari kerja saja."""
    d = NOW.date()
    if NOW.time() < time(16, 15):
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def age(ts):
    if not ts:
        return "–"
    h = (NOW - ts).total_seconds() / 3600
    return f"{h:.0f} jam lalu" if h >= 1 else f"{h * 60:.0f} menit lalu"


rows, bad = [], 0
SESSION = last_session()


def add(name, state, detail):
    global bad
    rows.append((name, state, detail))
    if state == "GAGAL":
        bad += 1


# makro
m = get("data.json")
if not m:
    add("makro", "GAGAL", "data.json tidak bisa dibaca")
else:
    ts = parse_ts(m.get("last_updated"))
    failed = [k for k, v in (m.get("last_run_status") or {}).items() if v != "ok" and not str(v).startswith("manual")]
    stale = ts is None or NOW - ts > timedelta(hours=26 if NOW.weekday() < 5 else 80)
    add("makro", "TELAT" if stale else "OK",
        f"diperbarui {age(ts)}" + (f"; sumber gagal: {', '.join(failed)}" if failed else ""))

# harga
s = get("summary.json")
if not s:
    add("harga", "GAGAL", "summary.json tidak bisa dibaca")
else:
    last = max((x["date"] for x in s["stocks"]), default=None)
    ok = last and date.fromisoformat(last) >= SESSION
    add("harga", "OK" if ok else "TELAT", f"sesi {last} (seharusnya {SESSION}), {len(s['stocks'])} saham, diambil {age(parse_ts(s.get('updated')))}")

# fundamental
f = get("fundamentals.json")
if not f:
    add("fundamental", "GAGAL", "fundamentals.json tidak bisa dibaca")
else:
    ts = parse_ts(f.get("updated"))
    st = f.get("stocks", {})
    with_an = sum(1 for v in st.values() if v.get("target") is not None)
    add("fundamental", "TELAT" if ts is None or NOW - ts > timedelta(days=3) else "OK",
        f"diperbarui {age(ts)}; {len(st)} saham tercakup, {with_an} dengan target analis")

# kepemilikan
o = get("ownership/meta.json")
if not o:
    add("kepemilikan", "GAGAL", "ownership/meta.json tidak bisa dibaca")
else:
    as_of = o.get("as_of")
    old = not as_of or (NOW.date() - date.fromisoformat(as_of)).days > 45
    errs = [f"{k}: {v}" for k, v in (o.get("status") or {}).items() if v not in ("ok",) and not str(v)[0].isdigit()]
    add("kepemilikan", "TELAT" if old else "OK", f"register {as_of}, pembanding {o.get('prev')}" + (f"; {'; '.join(errs)[:120]}" if errs else ""))

# brief
b = get("brief_index.json")
if not b:
    add("brief", "GAGAL", "brief_index.json tidak bisa dibaca")
else:
    ts = parse_ts(b.get("updated"))
    add("brief", "TELAT" if ts is None or NOW - ts > timedelta(days=3) else "OK",
        f"diperbarui {age(ts)}; {len(b.get('stocks', {}))} saham punya brief")

# foreign & broker
fl = get("flow/meta.json")
if not fl:
    add("foreign-broker", "GAGAL", "flow/meta.json tidak bisa dibaca (belum pernah jalan?)")
else:
    st = fl.get("status") or {}
    good = [k for k, v in st.items() if str(v).startswith("ok") or (str(v)[:1].isdigit() and not str(v).startswith("0/"))]
    bad_parts = [k for k in st if k not in good]
    state = "OK" if not bad_parts else ("SEBAGIAN" if good else "SUMBER ERROR")
    reason = ""
    joined = " ".join(map(str, st.values()))
    if "HTTP 5" in joined:
        reason = "Indo Premier error"
    if "Cloudflare" in joined or "blocked" in joined:
        reason += (", " if reason else "") + "idx.co.id menolak (Cloudflare)"
    add("foreign-broker", state, f"diambil {age(parse_ts(fl.get('updated')))}; ok: {', '.join(good) or '-'}" + (f"; {reason}" if reason else ""))

# HSC
h = get("hsc.json")
add("hsc", "OK" if h else "GAGAL", f"{h.get('count')} saham, pengumuman {h.get('as_of')}" if h else "hsc.json tidak bisa dibaca")

w = max(len(r[0]) for r in rows)
print(f"Checkpoint {NOW:%Y-%m-%d %H:%M} WIB · sesi bursa terakhir yang seharusnya ada: {SESSION}\n")
for name, state, detail in rows:
    print(f"{name:<{w}}  {state:<12}  {detail}")

if args.runs:
    print("\nRun terakhir tiap workflow:")
    for wf in ("makro", "harga", "fundamental", "kepemilikan", "brief", "flow", "site"):
        try:
            out = subprocess.run(["gh", "run", "list", "--workflow", f"{wf}.yml", "--limit", "1", "--json",
                                  "status,conclusion,createdAt,event,databaseId"], capture_output=True, text=True, timeout=30)
            r = (json.loads(out.stdout or "[]") or [{}])[0]
            when = parse_ts(r.get("createdAt"))
            print(f"  {wf:<12} {r.get('conclusion') or r.get('status') or 'belum ada':<10} {r.get('event', ''):<18} "
                  f"{when.astimezone(WIB):%d %b %H:%M} WIB  id {r.get('databaseId')}" if when else f"  {wf:<12} belum ada run")
        except Exception as e:
            print(f"  {wf:<12} tidak bisa dicek ({e})")

sys.exit(1 if bad else 0)
