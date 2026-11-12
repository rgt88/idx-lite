#!/usr/bin/env python3
"""
Pengatur jadwal: memastikan setiap bagian data jalan sekali (atau sesuai interval) setiap hari bursa,
tanpa bergantung pada jadwal `schedule` GitHub yang sering terlewat.

Dijalankan workflow `pengatur` setiap ±15-20 menit (jadwal GitHub + pemicu luar seperti cron-job.org).
Setiap kali jalan, ia melihat jam WIB, riwayat run tiap workflow hari ini, dan data yang sedang tayang,
lalu memicu (workflow_dispatch) hanya bagian yang sudah waktunya dan belum berhasil hari ini.
Aman dipanggil berkali-kali: bagian yang sedang jalan, sudah sukses, atau sudah terlalu sering dicoba dilewati.

  python scripts/pengatur.py            # di GitHub Actions (butuh gh + GH_TOKEN)
  python scripts/pengatur.py --dry-run  # hanya tampilkan keputusan
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, time, timedelta, timezone

WIB = timezone(timedelta(hours=7))
NOW = (datetime.fromisoformat(os.environ["PENGATUR_NOW"]).replace(tzinfo=WIB)  # untuk uji
       if os.environ.get("PENGATUR_NOW") else datetime.now(WIB))
TODAY = NOW.date()
REPO = os.environ.get("GITHUB_REPOSITORY", "")

ap = argparse.ArgumentParser()
ap.add_argument("--dry-run", action="store_true")
args = ap.parse_args()


def sh(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout


def live(path):
    """Baca file dari branch gh-pages (data yang sedang tayang)."""
    try:
        return json.loads(sh("git", "show", f"origin/gh-pages:data/{path}"))
    except Exception:
        return None


def runs(wf):
    """Run workflow hari ini (WIB), terbaru dulu."""
    try:
        rows = json.loads(sh("gh", "run", "list", "--repo", REPO, "--workflow", wf, "--limit", "30",
                             "--json", "status,conclusion,createdAt,event,databaseId"))
    except Exception as e:
        print(f"  {wf}: riwayat tidak terbaca ({e})")
        return None
    out = []
    for r in rows:
        t = datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00")).astimezone(WIB)
        if t.date() == TODAY:
            r["t"] = t
            out.append(r)
    return out


def at(hh, mm):
    return NOW.time() >= time(hh, mm)


def minutes_since(t):
    return (NOW - t).total_seconds() / 60


plan = []          # (workflow, [argumen -f], alasan)


def consider(wf, *, start, max_tries, gap=45, need_success=1, extra=(), interval=None, reason=""):
    """Picu wf kalau sudah lewat jam `start`, belum ada `need_success` run sukses hari ini (atau, dengan
    `interval`, run sukses terakhir lebih lama dari interval menit), tidak ada yang sedang jalan,
    percobaan hari ini < max_tries, dan percobaan terakhir sudah lewat `gap` menit."""
    if not at(*start):
        return
    rs = runs(wf)
    if rs is None:
        return
    running = [r for r in rs if r["status"] in ("queued", "in_progress", "waiting", "pending", "requested")]
    ok = [r for r in rs if r.get("conclusion") == "success"]
    if running:
        print(f"  {wf}: sedang jalan, lewati")
        return
    if interval is not None:
        if ok and minutes_since(ok[0]["t"]) < interval:
            print(f"  {wf}: sukses {minutes_since(ok[0]['t']):.0f} menit lalu, belum waktunya")
            return
    elif len(ok) >= need_success:
        print(f"  {wf}: sudah sukses hari ini")
        return
    if len(rs) >= max_tries:
        print(f"  {wf}: sudah dicoba {len(rs)}× hari ini, berhenti (cek manual)")
        return
    if rs and minutes_since(rs[0]["t"]) < gap:
        print(f"  {wf}: percobaan terakhir {minutes_since(rs[0]['t']):.0f} menit lalu, tunggu")
        return
    plan.append((wf, list(extra), reason or "waktunya dan belum sukses hari ini"))


def main():
    print(f"Pengatur {NOW:%Y-%m-%d %H:%M} WIB")
    if NOW.weekday() >= 5:
        print("Akhir pekan: tidak ada yang dijalankan.")
        return
    try:
        sh("git", "fetch", "-q", "--depth", "1", "origin", "gh-pages")
    except Exception as e:
        print("gh-pages tidak terbaca:", e)
    today = TODAY.isoformat()
    fri = NOW.weekday() == 4

    # makro: setiap ±2 jam antara 07:30 dan 21:30
    if at(7, 30) and not at(21, 30):
        consider("makro.yml", start=(7, 30), max_tries=12, gap=30, interval=110, reason="interval 2 jam")

    # laporan AI sesi 1: 12:10-13:25 (Jumat 11:40-13:55)
    ai = live("ai/index.json") or {"reports": []}
    have = {r["id"] for r in ai.get("reports", [])}
    s1_start, s1_end = ((11, 40), time(13, 55)) if fri else ((12, 10), time(13, 25))
    if os.environ.get("SKIP_AI") != "1" and at(*s1_start) and NOW.time() < s1_end and f"{today}-sesi1" not in have:
        consider("ai.yml", start=s1_start, max_tries=6, gap=15, need_success=99, extra=["jenis=sesi1"],
                 reason="laporan sesi 1 belum ada")

    # harga: mulai 16:25; diulang (maks 4×/hari, jarak 60 menit) selama sesi hari ini belum masuk
    summ = live("summary.json") or {}
    session = summ.get("session") or max((x["date"] for x in summ.get("stocks", [])), default="")
    if session < today:
        consider("harga.yml", start=(16, 25), max_tries=4, gap=60, need_success=99, reason=f"sesi tayang {session or '-'}")
    else:
        print(f"  harga.yml: sesi {session} sudah tayang")

    # fundamental, kepemilikan, brief: sekali sehari setelah harga
    consider("fundamental.yml", start=(16, 45), max_tries=2, gap=60)
    consider("kepemilikan.yml", start=(17, 0), max_tries=2, gap=60)
    consider("brief.yml", start=(17, 15), max_tries=2, gap=60)

    # sinyal: biasanya dipicu otomatis oleh harga/fundamental; cadangan kalau tertinggal dari harga
    sig = live("signals.json") or {}
    if session and sig.get("session", "") < session:
        consider("sinyal.yml", start=(16, 30), max_tries=6, gap=20, need_success=99, reason="sinyal tertinggal dari harga")

    # laporan AI penutupan: setelah harga hari ini tayang (paling lambat dicoba 18:30)
    if os.environ.get("SKIP_AI") != "1" and f"{today}-full" not in have and (session >= today or at(18, 30)):
        consider("ai.yml", start=(17, 5), max_tries=6, gap=30, need_success=99, extra=["jenis=full"],
                 reason="laporan penutupan belum ada")

    # foreign & broker: sekali sehari setelah 19:30
    if os.environ.get("SKIP_FLOW") != "1":
        consider("flow.yml", start=(19, 30), max_tries=2, gap=60)

    if not plan:
        print("Tidak ada yang perlu dipicu.")
        return
    for wf, extra, why in plan:
        cmd = ["gh", "workflow", "run", wf, "--repo", REPO, "--ref", "main"]
        for e in extra:
            cmd += ["-f", e]
        print(f"→ picu {wf} {' '.join(extra)}  ({why})")
        if not args.dry_run:
            try:
                sh(*cmd)
            except Exception as e:
                print(f"  gagal memicu {wf}: {e}")


if __name__ == "__main__":
    main()
