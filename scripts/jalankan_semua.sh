#!/usr/bin/env bash
# Jalankan semua workflow data sekarang juga (masing-masing berdiri sendiri).
#   ./scripts/jalankan_semua.sh              # semua
#   ./scripts/jalankan_semua.sh harga brief  # sebagian
set -euo pipefail
ALL=(makro harga fundamental kepemilikan brief flow)
for w in "${@:-${ALL[@]}}"; do
  gh workflow run "${w%.yml}.yml" && echo "dijalankan: $w"
done
echo "Pantau: gh run list --limit 10"
