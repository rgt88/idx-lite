#!/usr/bin/env bash
# Ambil data BEI (foreign per saham, indeks sektor, broker) dari laptop, lalu terbitkan HANYA data/idx ke gh-pages.
# Dipakai kalau idx.co.id menolak GitHub Actions (Cloudflare) tetapi menerima jaringan rumah.
#
#   ./scripts/bei_lokal.sh            # sesi terbaru + hari yang bolong (5 hari ke belakang)
#   ./scripts/bei_lokal.sh 40         # isi riwayat 40 hari bursa
#   NO_DEPLOY=1 ./scripts/bei_lokal.sh   # uji saja, jangan terbitkan
#
# Butuh: venv proyek dengan curl_cffi (pip install curl_cffi). Playwright opsional.
set -euo pipefail
DAYS="${1:-5}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f venv/bin/activate ] && source venv/bin/activate
python -c "import curl_cffi" 2>/dev/null || pip install -q curl_cffi

REMOTE="$(git remote get-url origin)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. mulai dari data/idx yang sedang tayang
git fetch -q --depth 1 "$REMOTE" gh-pages
rm -rf docs/data/idx
if git cat-file -e FETCH_HEAD:data/idx 2>/dev/null; then
  git archive FETCH_HEAD data/idx | tar -x -C "$TMP"
  mkdir -p docs/data && cp -r "$TMP/data/idx" docs/data/idx
fi

# 2. ambil
python scripts/fetch_idx.py --days "$DAYS" --method curl || python scripts/fetch_idx.py --days "$DAYS" --method browser

[ "${NO_DEPLOY:-0}" = "1" ] && { echo "NO_DEPLOY=1: tidak diterbitkan"; exit 0; }

# 3. terbitkan hanya data/idx (sama seperti .github/actions/publish)
for attempt in 1 2 3 4 5 6; do
  PUB="$TMP/pub$attempt"; mkdir -p "$PUB"; cd "$PUB"
  git init -q -b gh-pages
  git config user.name "$(git -C "$ROOT" config user.name || echo idx-lite)"
  git config user.email "$(git -C "$ROOT" config user.email || echo idx-lite@localhost)"
  git fetch -q --depth 1 "$REMOTE" gh-pages
  BASE="$(git rev-parse FETCH_HEAD)"
  git read-tree FETCH_HEAD && git checkout-index -a -f
  rm -rf data/idx && mkdir -p data && cp -r "$ROOT/docs/data/idx" data/idx
  rm -f .git/index && git add -A
  if git diff --cached --quiet FETCH_HEAD; then echo "tidak ada perubahan"; exit 0; fi
  git commit -q -m "bei (laptop) $(date -u +%FT%TZ)"
  if git push -q --force-with-lease="gh-pages:$BASE" "$REMOTE" HEAD:gh-pages; then echo "terbit (percobaan $attempt)"; exit 0; fi
  cd "$ROOT"; echo "gh-pages berubah saat menerbitkan; ulangi"; sleep $((RANDOM % 10 + 5))
done
echo "gagal menerbitkan"; exit 1
