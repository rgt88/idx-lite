#!/usr/bin/env python3
"""
Foreign flow dan broker summary lewat CLI `idx` (https://github.com/fzn0x/idx).

Sumber datanya Indo Premier (IPOT), yang tidak memblokir server GitHub Actions
seperti idx.co.id. Hasil disimpan apa adanya (amplop JSON `idx`) di
docs/data/flow/, lalu dibaca oleh terminal web.

Jalankan SETELAH 19:00 WIB pada hari bursa: sebelum jam itu IPOT belum bisa
memberi tanggal pada ranking broker dan statistik pasar, jadi `idx` menolaknya.

  python scripts/fetch_flow.py                 # semua langkah
  python scripts/fetch_flow.py --foreign-top 10 --foreign-days 5   # uji cepat
"""
import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "flow"
IDX = os.environ.get("IDX_BIN", "idx")

ap = argparse.ArgumentParser()
ap.add_argument("--broker-top", type=int, default=100, help="broker summary untuk N saham teraktif")
ap.add_argument("--foreign-top", type=int, default=40, help="riwayat foreign untuk N saham teraktif")
ap.add_argument("--foreign-days", type=int, default=20, help="jumlah sesi riwayat foreign (maks 60)")
ap.add_argument("--keep-days", type=int, default=120, help="sesi yang disimpan di foreign_hist.json")
ap.add_argument("--budget", type=float, default=35, help="batas waktu total (menit); sisa pekerjaan dilewati")
ap.add_argument("--max-fail", type=int, default=5, help="gagal berturut-turut sebelum sisa satu bagian dilewati")
args = ap.parse_args()
DEADLINE = time.time() + args.budget * 60

for sub in ("broker", "foreign"):
    (OUT / sub).mkdir(parents=True, exist_ok=True)

status = {}


def run(cmd, timeout=300):
    """Jalankan `idx -o json ...`; kembalikan (amplop, pesan_error). Tidak melewati batas waktu total."""
    t0 = time.time()
    timeout = min(timeout, DEADLINE - t0)
    if timeout < 5:
        return None, "dilewati: batas waktu total habis"
    try:
        p = subprocess.run(
            [IDX, "-o", "json", *cmd], capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "IDX_PROGRESS": "never"},
        )
    except FileNotFoundError:
        sys.exit(f"CLI `{IDX}` tidak ditemukan. Pasang dulu: "
                 "curl -fsSL https://raw.githubusercontent.com/fzn0x/idx/main/install.sh | sh")
    except subprocess.TimeoutExpired:
        print(f"timeout idx {' '.join(cmd)} setelah {timeout:.0f} dtk; dilewati")
        return None, "timeout"
    env = None
    try:
        env = json.loads(p.stdout) if p.stdout.strip() else None
    except json.JSONDecodeError:
        pass
    if p.returncode != 0 or not env or "data" not in env:
        msg = ""
        if isinstance(env, dict) and isinstance(env.get("error"), dict):
            msg = env["error"].get("message", "")
        if not msg:
            lines = (p.stderr or p.stdout or "").strip().splitlines()
            msg = lines[-1] if lines else ""
        print(f"gagal idx {' '.join(cmd)}: exit {p.returncode} {msg[:200]}")
        return None, f"exit {p.returncode}: {msg[:300]}"
    print(f"ok    idx {' '.join(cmd)} ({time.time() - t0:.0f} dtk)")
    return env, None


def dump(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))


def job(name, cmds, file):
    """Coba beberapa bentuk perintah berurutan (idx versi rilis belum punya semua flag)."""
    cmds = cmds if isinstance(cmds[0], list) else [cmds]
    for cmd in cmds:
        env, err = run(cmd)
        if env:
            dump(OUT / file, env)
            status[name] = "ok" if cmd is cmds[0] else "ok (" + " ".join(cmd[:2]) + " tanpa --source)"
            return env
    status[name] = err
    return None


# 1. Bandarmology: 100 saham teraktif, sesi terakhir dan seminggu
b1 = job("bandar_1d", ["bandar", "screen", "--period", "1d", "--limit", "0"], "bandar_1d.json")
job("bandar_1w", ["bandar", "screen", "--period", "1w", "--limit", "0"], "bandar_1w.json")

# 2. Foreign net seluruh pasar (rupiah, 100 saham teraktif) dan ranking broker
# --source ipot (rupiah, bisa dari GitHub) baru ada di idx versi pengembangan; versi rilis membaca
# idx.co.id (lembar, semua saham), yang biasanya lolos dari koneksi rumahan tapi ditolak di GitHub.
mf = job("market_foreign", [["market", "foreign", "--source", "ipot", "--top", "0"],
                            ["market", "foreign", "--top", "0"]], "market_foreign.json")
job("market_brokers", [["market", "brokers", "--source", "ipot", "--top", "0"],
                       ["market", "brokers", "--top", "0"]], "market_brokers.json")

# Daftar saham yang diproses per saham: urutan scan bandar (teraktif dulu)
symbols = []
if b1:
    symbols = [r["symbol"] for r in sorted(b1["data"].get("rows", []),
                                           key=lambda r: r.get("total_value") or 0, reverse=True)]
if not symbols:
    try:
        s = json.loads((ROOT / "docs" / "data" / "summary.json").read_text())["stocks"]
        symbols = [x["symbol"] for x in sorted(s, key=lambda x: x.get("value") or 0, reverse=True)]
    except Exception:
        symbols = []

class Breaker:
    """Hentikan satu bagian kalau sumbernya jelas sedang bermasalah (gagal berturut-turut)."""
    def __init__(self, name):
        self.name, self.fails, self.tripped = name, 0, None
    def record(self, ok, err=None):
        self.fails = 0 if ok else self.fails + 1
        if self.fails >= args.max_fail and not self.tripped:
            self.tripped = err or "gagal berturut-turut"
            print(f"{self.name}: {self.fails} kali gagal berturut-turut ({self.tripped}); sisa dilewati")
    def note(self, text):
        return text + (f", sisa dilewati: {self.tripped}" if self.tripped else "")


# 3. Broker summary per saham (sesi terakhir), 20 saham per panggilan
ok = 0
todo = symbols[: args.broker_top]
br = Breaker("broker")
for i in range(0, len(todo), 20):
    if br.tripped or time.time() > DEADLINE:
        break
    batch = todo[i:i + 20]
    env, err = run(["broker", ",".join(batch)], timeout=240)
    summaries = env["data"] if env else []
    if not env:  # satu saham bermasalah bisa menggagalkan satu batch: ulangi satu per satu
        for sym in batch:
            if br.tripped:
                break
            e1, err1 = run(["broker", sym], timeout=60)
            br.record(bool(e1), err1)
            if e1:
                env = env or e1
                summaries += e1["data"] or []
    for summ in summaries or []:
        dump(OUT / "broker" / f"{summ['symbol']}.json", {
            "schema": env.get("schema"), "provider": env.get("provider"),
            "fetched_at": env.get("fetched_at"), "data": summ,
        })
        ok += 1
status["broker"] = br.note(f"{ok}/{len(todo)}")

# 4. Riwayat foreign per saham (rupiah, IPOT)
ok = 0
fr = Breaker("foreign")
for sym in symbols[: args.foreign_top]:
    if fr.tripped or time.time() > DEADLINE:
        break
    env, err = run(["stocks", "foreign", sym, "--source", "ipot", "--days", str(args.foreign_days)], timeout=120)
    fr.record(bool(env), err)
    if env:
        dump(OUT / "foreign" / f"{sym}.json", env)
        ok += 1
status["foreign"] = fr.note(f"{ok}/{min(len(symbols), args.foreign_top)}")

# 5. Arsip harian foreign net (dari market foreign) supaya riwayat bertambah tiap hari
hist_path = OUT / "foreign_hist.json"
try:
    hist = json.loads(hist_path.read_text())
except Exception:
    hist = {"sessions": {}}
if mf:
    d = mf["data"]
    rows = (d.get("net_buy") or []) + (d.get("net_sell") or [])
    net = lambda r: r.get("foreign_net_value", r.get("foreign_net_value_at_close"))
    hist["sessions"][d["date"]] = {r["symbol"]: [net(r), r.get("value"), r.get("change_pct")] for r in rows}
    hist["market"] = hist.get("market", {})
    if d.get("market"):
        hist["market"][d["date"]] = d["market"]
    for key in ("sessions", "market"):
        dates = sorted(hist.get(key, {}))
        for old in dates[: max(0, len(dates) - args.keep_days)]:
            del hist[key][old]
    dump(hist_path, hist)

meta = {"updated": datetime.now(timezone.utc).isoformat(), "status": status}
dump(OUT / "meta.json", meta)
print(json.dumps(meta, indent=2, ensure_ascii=False))
if all(v != "ok" for k, v in status.items() if k.startswith(("bandar", "market"))):
    sys.exit(1)
