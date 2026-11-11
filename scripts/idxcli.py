"""Pembantu bersama untuk skrip yang memanggil CLI `idx` (https://github.com/fzn0x/idx)."""
import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
IDX = os.environ.get("IDX_BIN", "idx")


def run(cmd, timeout=900, quiet=False):
    """Jalankan `idx -o json ...`. Kembalikan (amplop, None) atau (None, pesan_error)."""
    t0 = time.time()
    try:
        p = subprocess.run([IDX, "-o", "json", *cmd], capture_output=True, text=True, timeout=timeout,
                           env={**os.environ, "IDX_PROGRESS": "never"})
    except FileNotFoundError:
        sys.exit(f"CLI `{IDX}` tidak ditemukan. Pasang dulu: "
                 "curl -fsSL https://raw.githubusercontent.com/fzn0x/idx/main/install.sh | sh")
    except subprocess.TimeoutExpired:
        return None, "timeout"
    env = None
    try:
        env = json.loads(p.stdout) if p.stdout.strip() else None
    except json.JSONDecodeError:
        pass
    if p.returncode != 0 or not isinstance(env, dict) or "data" not in env:
        msg = ""
        if isinstance(env, dict) and isinstance(env.get("error"), dict):
            msg = env["error"].get("message", "")
        if not msg:
            lines = (p.stderr or p.stdout or "").strip().splitlines()
            msg = lines[-1] if lines else ""
        if not quiet:
            print(f"gagal idx {' '.join(cmd)}: exit {p.returncode} {msg[:200]}")
        return None, f"exit {p.returncode}: {msg[:300]}"
    if not quiet:
        print(f"ok    idx {' '.join(cmd)} ({time.time() - t0:.0f} dtk)")
    return env, None


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))


def load(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return default


def by_activity():
    """Kode saham, paling aktif (nilai transaksi) dulu; cadangan symbols.txt."""
    s = load(DATA / "summary.json")
    if s:
        return [x["symbol"] for x in sorted(s["stocks"], key=lambda x: x.get("value") or 0, reverse=True)]
    return (ROOT / "symbols.txt").read_text().split()
