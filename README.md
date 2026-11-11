# IDX Lite

Terminal saham Indonesia di peramban, statis dan gratis: GitHub Actions mengambil data, GitHub Pages menyajikannya.

Situs: https://rgt88.github.io/idx-lite/ (terminal) · https://rgt88.github.io/idx-lite/board.html (papan tabel)

## Perintah terminal

| Perintah | Isi |
| --- | --- |
| `brief BBCA` | Ringkasan satu halaman: poin penting, valuasi, return vs IHSG, dividen, pemegang saham, berita, grafik |
| `BBCA` / `quote BBCA` | Harga, grafik candlestick, SMA, sinyal singkat |
| `ownership` / `ownership BBCA` | Pemegang saham > 1% (register KSEI) dan perubahannya |
| `technical BBCA` | RSI, MACD, SMA/EMA, Bollinger, ATR, support/resistance |
| `fundamental BBCA` | Valuasi, kinerja kuartalan dan tahunan |
| `broker BBCA` | Broker summary sesi terakhir (10 pembeli/penjual teratas) |
| `foreign` / `foreign BBCA` | Net beli/jual asing pasar, atau riwayat foreign satu saham |
| `brokers` | Ranking broker seluruh pasar |
| `bandar BBCA` | Bandarmology 1 hari dan 1 minggu |
| `bandar screen --preset accumulation` | Saring 100 saham teraktif menurut sinyal bandar |
| `bandar broker YP` | Saham tempat satu broker masuk 10 besar |
| `screen rsi<30,value>1B` | Saring semua saham (harga, teknikal, fundamental; `hsc=0` untuk membuang saham HSC) |
| `hsc` | Daftar saham Kepemilikan Saham Terkonsentrasi Tinggi (ditandai merah di semua panel) |
| `market`, `macro`, `help`, `history`, `clear` | |

## Data

| File di `docs/data/` | Skrip | Jadwal (WIB, Senin–Jumat) | Sumber |
| --- | --- | --- | --- |
| `data.json` | `scripts/macro_update.py` | 08, 10, 12, 14, 16.30, 19.30 | Frankfurter, Yahoo |
| `summary.json`, `prices/` | `scripts/fetch_prices.py` | 16.30 | Yahoo Finance |
| `fundamentals*.json` | `scripts/fetch_fundamentals.py` | 16.30, 100 saham/hari | Yahoo Finance |
| `flow/` | `scripts/fetch_flow.py` | 19.30 | Indo Premier lewat CLI [idx](https://github.com/fzn0x/idx) |
| `hsc.json` | `scripts/hsc_update.py` | manual, setiap ada pengumuman BEI | Pengumuman BEI |

Data hasil olahan tidak masuk riwayat git `main`. Setiap sumber punya workflow sendiri (`makro`, `harga`, `fundamental`, `kepemilikan`, `brief`, `foreign-broker`) yang menerbitkan bagiannya ke branch `gh-pages`; satu sumber error tidak menghambat yang lain.

Operasional harian (jadwal, checkpoint, apa yang dilakukan kalau ada yang gagal): [RUNBOOK.md](RUNBOOK.md). Cek cepat: `python scripts/cek_status.py --runs`.

Penjelasan lengkap, termasuk plan B **mode laptop** (`scripts/update_lokal.sh`) dan cara memperbarui daftar HSC: [ARCHITECTURE.md](ARCHITECTURE.md).

## Kerja lokal

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_prices.py
python scripts/fetch_flow.py --foreign-top 5     # butuh CLI idx, jalankan setelah 19:00 WIB
python -m http.server 8000 -d docs
```

Hanya informasi, bukan saran investasi.
