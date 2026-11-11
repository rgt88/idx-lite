#!/usr/bin/env bash
# Mode laptop (plan B): ambil semua data dari WSL lalu terbitkan ke branch gh-pages,
# tanpa GitHub Actions. Hasilnya sama dengan workflow site.yml.
#
#   ./scripts/update_lokal.sh            # auto: makro selalu; harga+fundamental sekali sehari
#                                        #       setelah 16:15 WIB; foreign+broker setelah 19:00 WIB
#   ./scripts/update_lokal.sh all        # semua langkah sekarang juga
#   ./scripts/update_lokal.sh macro|harga|flow|deploy
#   ./scripts/update_lokal.sh sync       # hanya salin data yang sedang tayang ke docs/data (untuk pratinjau lokal)
#   NO_DEPLOY=1 ./scripts/update_lokal.sh all    # ambil data saja, jangan terbitkan
#
# Aman dijalankan tiap jam dari cron / Task Scheduler: langkah berat hanya sekali per hari
# bursa, dan dua proses tidak bisa berjalan bersamaan.
set -euo pipefail

MODE="${1:-auto}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/idx-lite"
mkdir -p "$STATE"
cd "$ROOT"

log() { echo "[$(TZ=Asia/Jakarta date '+%F %T') WIB] $*"; }

exec 9>"$STATE/update.lock"
if ! flock -n 9; then log "update lain masih berjalan, keluar"; exit 0; fi

[ -f venv/bin/activate ] && source venv/bin/activate
export PATH="$HOME/.local/bin:$PATH"
export IDX_PROGRESS=never

TODAY="$(TZ=Asia/Jakarta date +%F)"
HHMM="$(TZ=Asia/Jakarta date +%H%M)"
DOW="$(TZ=Asia/Jakarta date +%u)"   # 1 = Senin ... 7 = Minggu
weekday() { [ "$DOW" -le 5 ]; }
done_today() { [ -f "$STATE/$1.$TODAY" ]; }
mark() { find "$STATE" -name "$1.*" -delete; touch "$STATE/$1.$TODAY"; }

want_macro=0; want_harga=0; want_flow=0
case "$MODE" in
  auto)
    want_macro=1
    if weekday && [ "$HHMM" -ge 1615 ] && ! done_today harga; then want_harga=1; fi
    if weekday && [ "$HHMM" -ge 1900 ] && ! done_today flow; then want_flow=1; fi ;;
  all) want_macro=1; want_harga=1; want_flow=1 ;;
  macro) want_macro=1 ;;
  harga) want_harga=1 ;;
  flow) want_flow=1 ;;
  deploy) ;;
  sync) NO_DEPLOY=1 ;;
  *) echo "pemakaian: $0 [auto|all|macro|harga|flow|deploy|sync]" >&2; exit 2 ;;
esac

log "mulai (mode $MODE: makro=$want_macro harga=$want_harga flow=$want_flow)"
git pull --ff-only -q || log "git pull gagal; lanjut dengan kode lokal"

# 1. Mulai dari data yang sedang tayang, seperti workflow: file yang dilacak git
#    (manual.json, hsc.json) menang, data hasil olahan diambil dari gh-pages.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REMOTE="$(git remote get-url origin)"
if git clone -q --depth 1 --branch gh-pages "$REMOTE" "$TMP/live" 2>/dev/null; then
  git clean -fdXq docs/data
  mkdir -p docs/data
  if command -v rsync >/dev/null; then
    rsync -a --ignore-existing "$TMP/live/data/" docs/data/
  else
    cp -rn "$TMP/live/data/." docs/data/ 2>/dev/null || true
  fi
else
  log "gh-pages belum ada atau tidak terjangkau; pakai data lokal"
fi

ok=1
step() {  # step <nama> <perintah...>
  local name="$1"; shift
  log "→ $name"
  if "$@"; then return 0; fi
  log "✗ $name gagal (data lama tetap dipakai)"; ok=0; return 1
}

if [ "$want_macro" = 1 ]; then step makro sh -c "python scripts/macro_update.py >/dev/null" || true; fi
if [ "$want_harga" = 1 ]; then
  step harga python scripts/fetch_prices.py && step fundamental python scripts/fetch_fundamentals.py --max 100 && mark harga || true
  if command -v idx >/dev/null; then
    step kepemilikan python scripts/fetch_ownership.py || true
    step brief python scripts/fetch_brief.py --max 100 || true
  fi
fi
if [ "$want_flow" = 1 ]; then
  if command -v idx >/dev/null; then
    step "foreign & broker" python scripts/fetch_flow.py && mark flow || true
  else
    log "✗ CLI idx belum terpasang: curl -fsSL https://raw.githubusercontent.com/fzn0x/idx/main/install.sh | sh"; ok=0
  fi
fi

# 2. Terbitkan isi docs/ sebagai satu commit di gh-pages (riwayat main tidak tersentuh)
if [ "${NO_DEPLOY:-0}" != 1 ]; then
  mkdir -p "$TMP/deploy"
  cp -r docs/. "$TMP/deploy/"
  (
    cd "$TMP/deploy"
    git init -q -b gh-pages
    git add -A
    git -c user.name="idx-lite (laptop)" -c user.email="idx-lite@users.noreply.github.com" \
      commit -q -m "deploy lokal $(date -u +%FT%TZ)"
    git push -fq "$REMOTE" gh-pages
  ) && log "terbit ke gh-pages" || { log "✗ gagal push ke gh-pages (cek: gh auth setup-git)"; ok=0; }
fi

log "selesai$([ "$ok" = 1 ] || echo ' dengan sebagian langkah gagal')"
