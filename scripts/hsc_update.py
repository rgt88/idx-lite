#!/usr/bin/env python3
"""
Perbarui docs/data/hsc.json, daftar saham Kepemilikan Saham Terkonsentrasi Tinggi (HSC) BEI.

BEI dan KSEI menerbitkan HSC sebagai pengumuman PDF di idx.co.id (menu "Kepemilikan Saham
Terkonsentrasi Tinggi"), tanpa jadwal tetap. idx.co.id memblokir server GitHub, jadi daftar ini
diperbarui manual dari PDF pengumumannya:

  # cara utama: baca langsung lampiran PDF pengumuman (butuh pdftotext: sudo apt install poppler-utils)
  python scripts/hsc_update.py --pdf ~/Downloads/pengumuman-hsc.pdf

  # tanpa PDF: tempel teks/daftar kode, akhiri dengan Ctrl+D
  python scripts/hsc_update.py --as-of 2026-11-12 < daftar.txt

  # tambah / keluarkan beberapa saham saja
  python scripts/hsc_update.py --as-of 2026-11-14 --add ABCD --remove EFGH

Dari PDF, skrip membaca nomor pengumuman, tanggal, tanggal evaluasi, persentase konsentrasi
10 pemegang terbesar, status Baru/lanjutan, dan tanda catatan (*, **, ***) tiap saham.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
PATH = ROOT / "docs" / "data" / "hsc.json"
BULAN = {m: i + 1 for i, m in enumerate(
    ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"])}
MARKS = {
    "*": "Belum menyampaikan informasi penurunan konsentrasi lewat distribusi saham ke publik.",
    "**": "Penurunan kepemilikan lewat transaksi repo saham, konsentrasi mungkin tidak berubah.",
    "***": "Dalam proses voluntary delisting.",
}
ROW = re.compile(r"^\s*(\d{1,4})\s+([A-Z]{4})(\*{0,3})\s+(\*{0,3})\s*(.*?)\s+(\d{2,3},\d{1,3})\s*(Baru/New|-)?\s*$")

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--pdf", help="PDF pengumuman HSC dari BEI/KSEI")
ap.add_argument("--as-of", help="tanggal pengumuman, YYYY-MM-DD (otomatis dari PDF)")
ap.add_argument("--source", help="tautan pengumuman di idx.co.id")
ap.add_argument("--note", help="catatan singkat yang tampil di terminal")
ap.add_argument("--add", nargs="*", default=[], help="kode yang ditambahkan ke daftar lama")
ap.add_argument("--remove", nargs="*", default=[], help="kode yang dikeluarkan dari daftar lama")
ap.add_argument("--no-check", action="store_true", help="teks bebas: jangan cocokkan dengan symbols.txt")
args = ap.parse_args()

try:
    old = json.loads(PATH.read_text())
except Exception:
    old = {"codes": []}
old_codes = set(old.get("codes", []))
known = set((ROOT / "symbols.txt").read_text().split()) if (ROOT / "symbols.txt").exists() else set()


def tanggal_id(text):
    m = re.search(r"(\d{1,2})\s+(" + "|".join(BULAN) + r")\s+(\d{4})", text, re.I)
    return date(int(m[3]), BULAN[m[2].lower()], int(m[1])) if m else None


def tambah_hari_bursa(d, n):
    while n:
        d += timedelta(days=1)
        if d.weekday() < 5:  # libur bursa tidak dihitung; cocokkan dengan pengumuman
            n -= 1
    return d


def parse_table(text):
    rows = {}
    for ln in text.splitlines():
        m = ROW.match(ln)
        if m:
            mark = m[3] or m[4]
            rows[m[2]] = {"pct": float(m[6].replace(",", ".")), "new": m[7] == "Baru/New", "mark": mark or None}
    return rows


def codes_in(text):
    found = re.findall(r"\b[A-Z]{4}\b", text.upper())
    if known and not args.no_check:
        unknown = sorted({c for c in found if c not in known})
        found = [c for c in found if c in known]
        if unknown:
            print(f"diabaikan (bukan kode di symbols.txt): {' '.join(unknown[:30])}", file=sys.stderr)
    return set(found)


meta, details = {}, None
if args.pdf:
    try:
        text = subprocess.run(["pdftotext", "-layout", args.pdf, "-"], capture_output=True, text=True, check=True).stdout
    except FileNotFoundError:
        sys.exit("pdftotext belum ada. Pasang dulu: sudo apt install poppler-utils")
    except subprocess.CalledProcessError as e:
        sys.exit(f"PDF tidak bisa dibaca: {e.stderr.strip()}")
    details = parse_table(text)
    if not details:
        sys.exit("Tabel HSC tidak ditemukan di PDF ini; hsc.json tidak diubah.")
    ref = re.search(r"(Peng-HSC-[\w/.-]+)", text)
    ref2 = re.search(r"(Peng-\d+/PWS/KSEI/\d+)", text)
    head = text.split("Lampiran")[0]
    ann = tanggal_id(head.split("Demikian")[-1]) or tanggal_id(head)
    ev = re.search(r"(?:per|pada)\s+(\d{1,2}\s+\w+\s+\d{4})", text)
    meta = {
        "ref": " · ".join(x[1] for x in (ref, ref2) if x),
        "as_of": ann.isoformat() if ann else None,
        "evaluated": tanggal_id(ev[1]).isoformat() if ev and tanggal_id(ev[1]) else None,
        "effective": tambah_hari_bursa(ann, 2).isoformat() if ann and "Hari Bursa ke-2" in text else None,
    }
    numbers = [int(m[1]) for m in map(ROW.match, text.splitlines()) if m]
    if numbers and max(numbers) != len(details):
        print(f"PERINGATAN: nomor terakhir di tabel {max(numbers)}, terbaca {len(details)} baris. Cek PDF-nya.", file=sys.stderr)
    codes = set(details)
elif args.add or args.remove:
    codes = (old_codes | codes_in(" ".join(args.add))) - {c.upper() for c in args.remove}
    details = {c: v for c, v in (old.get("details") or {}).items() if c in codes}
else:
    if sys.stdin.isatty():
        print("Tempel daftar dari pengumuman BEI, lalu tekan Ctrl+D:", file=sys.stderr)
    text = sys.stdin.read()
    details = parse_table(text) or None
    codes = set(details) if details else codes_in(text)
    if not codes:
        sys.exit("Tidak ada kode saham yang dikenali; hsc.json tidak diubah.")

as_of = args.as_of or meta.get("as_of")
if not as_of or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
    sys.exit("Tanggal pengumuman tidak terbaca; isi --as-of YYYY-MM-DD")

added, removed = sorted(codes - old_codes), sorted(old_codes - codes)
data = {
    "as_of": as_of,
    "evaluated": meta.get("evaluated"),
    "effective": meta.get("effective"),
    "ref": meta.get("ref") or (old.get("ref") if not args.pdf else None),
    "source": args.source if args.source is not None else (None if args.pdf else old.get("source")),
    "note": args.note if args.note is not None else (None if args.pdf else old.get("note")),
    "marks": MARKS,
    "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    "count": len(codes),
    "codes": sorted(codes),
    "details": {c: details[c] for c in sorted(details)} if details else None,
}
PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"hsc.json: {len(codes)} saham · pengumuman {as_of}"
      + (f" · evaluasi {data['evaluated']}" if data["evaluated"] else "")
      + (f" · efektif IHSG {data['effective']}" if data["effective"] else ""))
if data["ref"]:
    print(f"  nomor  : {data['ref']}")
print(f"  masuk  ({len(added)}): {' '.join(added) or '-'}")
print(f"  keluar ({len(removed)}): {' '.join(removed) or '-'}")
if details:
    marked = {c: v["mark"] for c, v in details.items() if v.get("mark")}
    if marked:
        print("  bertanda:", " ".join(f"{c}{m}" for c, m in sorted(marked.items())))
