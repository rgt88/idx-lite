# Runbook harian IDX Lite (BAU)

Panduan operasional harian: apa yang seharusnya terjadi setiap hari bursa, kapan dicek, cara mengecek, dan apa yang dilakukan kalau ada yang tidak beres. Arsitektur lengkap ada di [ARCHITECTURE.md](ARCHITECTURE.md).

Semua jam dalam WIB. Hari bursa = Senin–Jumat kecuali libur bursa.

## Cek cepat (satu perintah)

```bash
cd ~/idx-lite && source venv/bin/activate
python scripts/cek_status.py --runs
```

Contoh hasil normal setelah 17:30:

```
makro           OK            diperbarui 8 menit lalu
harga           OK            sesi 2026-11-11 (seharusnya 2026-11-11), 912 saham, diambil 35 menit lalu
fundamental     OK            diperbarui 32 menit lalu; 400 saham tercakup, 120 dengan target analis
kepemilikan     OK            register 2026-10-30, pembanding 2026-09-30
brief           OK            diperbarui 31 menit lalu; 100 saham punya brief
foreign-broker  OK            diambil 16 menit lalu; ok: bandar_1d, bandar_1w, broker, foreign, ...
sinyal          OK            sesi 2026-11-11, 310 saham dinilai; sinyal beli gabungan 6, teknikal 21, fundamental 34
laporan-ai      OK            terakhir 2026-11-11 full, AI ya; penutupan terakhir 2026-11-11
hsc             OK            383 saham, pengumuman 2026-11-11
```

Arti status: **OK** sesuai harapan · **TELAT** belum diperbarui sesuai jadwal · **SEBAGIAN** sebagian sumber berhasil · **SUMBER ERROR** sumber eksternal sedang bermasalah · **GAGAL** file tidak terbaca (situs atau terbitnya bermasalah).

CDS 5Y tidak punya sumber gratis resmi, jadi diisi manual lewat `docs/data/manual.json` (contoh: `{"cds_5y": {"value": 92.5, "date": "2026-11-12"}}`), lalu push. Yield 2Y/5Y/10Y diambil otomatis dari AsianBondsOnline (ADB).

Dari HP: buka situs, lihat baris *Diperbarui* di bagian bawah, atau buka tab **Actions** di github.com/rgt88/idx-lite.

## Jadwal dan checkpoint

| Jam | Workflow yang jalan | Checkpoint (cek setelah jam ini) | Hasil yang diharapkan |
| --- | --- | --- | --- |
| 08:00 | makro | **CP1 · 08:30** | makro OK; harga = sesi kemarin |
| 10:00, 12:00, 14:00 | makro | – | – |
| 12:10 (Jumat 11:40) | laporan-ai (sesi 1) | **CP-S1 · 13:00** | pesan *IHSG Sesi 1* masuk Telegram |
| 16:00 | makro | – | – |
| 16:30 | harga | **CP2 · 17:00** | harga = **sesi hari ini** |
| setelah harga selesai | sinyal (otomatis) | | sinyal = sesi hari ini |
| 16:45 | fundamental | | |
| 17:00 | kepemilikan | | |
| 17:05 | laporan-ai (penutupan) | | pesan *IHSG Penutupan* masuk Telegram |
| 17:15 | brief | **CP3 · 18:00** | fundamental & brief diperbarui hari ini; kepemilikan register ≤ 45 hari |
| 19:00 | makro | | |
| 19:30 | harga (ulang), foreign-broker | **CP4 · 20:15** | harga = sesi hari ini; foreign-broker OK atau SUMBER ERROR dengan alasan |

Jadwal GitHub bisa telat sampai sekitar satu jam. Sebelum menganggap ada masalah, tunggu sampai jam checkpoint.

## Checklist harian

Salin ke catatan masing-masing kalau mau dicentang.

- [ ] **CP1 (pagi):** `cek_status.py` → makro OK, tidak ada GAGAL.
- [ ] **CP2 (sore):** harga dan sinyal menunjukkan sesi hari ini. Kalau belum, lihat [Harga TELAT](#harga-telat) dan [Sinyal TELAT](#sinyal-telat).
- [ ] **CP-S1 (siang):** pesan *IHSG Sesi 1* masuk Telegram. Kalau tidak, lihat [Laporan AI / Telegram](#laporan-ai--telegram).
- [ ] **CP3:** fundamental dan brief diperbarui hari ini; kepemilikan OK; pesan *IHSG Penutupan* masuk Telegram.
- [ ] **CP4 (malam):** harga masih sesi hari ini; foreign-broker OK, atau SUMBER ERROR dengan alasan yang jelas.
- [ ] Buka situs sekali (laptop atau HP): halaman Pasar tampil, angka IHSG dan persentasenya masuk akal dibanding sumber lain.
- [ ] Ada pengumuman HSC baru dari BEI hari ini? Kalau ada, lihat [Memperbarui HSC](#memperbarui-hsc).

## Kalau ada yang tidak beres

Prinsipnya: **setiap bagian berdiri sendiri.** Jalankan ulang hanya workflow yang bermasalah; bagian lain tidak perlu disentuh.

```bash
gh run list --workflow harga.yml --limit 3          # lihat run terakhir satu workflow
gh run view <ID> --log-failed | tail -40            # pesan error run yang merah
gh workflow run harga.yml                           # jalankan ulang satu workflow
```

### Harga TELAT

1. `gh run list --workflow harga.yml --limit 3`
2. **Tidak ada run hari ini:** jadwal GitHub terlewat. Jalankan `gh workflow run harga.yml`. Jadwal 19:30 juga menjadi cadangan otomatis.
3. **Run merah:** buka lognya. Kalau isinya error dari Yahoo (rate limit, 429, timeout), tunggu 30–60 menit lalu jalankan ulang.
4. **Run hijau tapi sesi masih kemarin:** Yahoo belum menerbitkan candle hari ini. Jalankan ulang setelah 19:00.
5. **Hari libur bursa:** TELAT wajar, abaikan.

### Sinyal TELAT

Sinyal hanya bisa sebaru harga. Kalau harga sudah sesi hari ini tapi sinyal belum: `gh workflow run sinyal.yml`. Run `sinyal` dari pemicu otomatis yang berstatus *skipped* itu normal: artinya workflow harga/fundamental yang memicunya gagal, dan jadwal cadangan 17:40/20:15 akan menyusul.

Mengubah ambang (mis. likuiditas): ubah `RULES` dan nilai di `scripts/build_signals.py`, uji di laptop dengan `./scripts/update_lokal.sh sync && python scripts/build_signals.py --show BBCA`, lalu push.

### Fundamental atau brief TELAT

**Mengisi semua saham sekaligus** (pertama kali, atau setelah format berubah): Actions → fundamental (atau brief) → Run workflow → centang *isi_semua*, atau `gh workflow run fundamental.yml -f isi_semua=true`. Workflow berjalan berulang sendiri (±40 menit per putaran) sampai semua saham terisi; log tiap putaran menulis `belum lengkap: N saham`. Jangan jalankan berbarengan dengan run fundamental lain.

Jalankan ulang workflow-nya. Keduanya bergilir 100 saham per run, jadi satu hari terlewat tidak merusak apa pun. Kalau lognya menunjukkan banyak `gagal`, kurangi jumlahnya: `gh workflow run fundamental.yml -f max=50`.

### Kepemilikan TELAT atau GAGAL

Register KSEI terbit bulanan, jadi tanggal register yang tidak berubah selama sebulan itu normal. TELAT berarti register lebih dari 45 hari. Cek:

```bash
gh workflow run kepemilikan.yml -f force=true
gh run view <ID> --log | grep -E "register|sync|gagal"
```

Kalau `idx ownership sync` gagal, mirror proyek idx sedang bermasalah. Tunggu sehari.

### Foreign-broker SUMBER ERROR

Penyebabnya di luar kita: Indo Premier error (HTTP 502) atau idx.co.id menolak (Cloudflare). Situs tetap menampilkan penjelasan, jadi tidak ada tindakan wajib.

- Cek dari laptop apakah sumber sudah pulih: `idx broker BBCA`.
- Kalau error berhari-hari, matikan sementara supaya run tidak membuang waktu: `gh variable set SKIP_FLOW --body 1`.
- Setelah `idx broker BBCA` berhasil lagi: `gh variable delete SKIP_FLOW`, lalu `gh workflow run flow.yml`.

### Laporan AI / Telegram

| Gejala | Penyebab | Tindakan |
| --- | --- | --- |
| Tidak ada pesan, tidak ada run hari ini | Jadwal GitHub terlewat | Actions → laporan-ai → Run workflow (jenis `full` atau `sesi1`). Sesi 1 yang dijalankan setelah 13:30 perlu centang *paksa*. |
| Run hijau, log: *Tidak ada sesi bursa hari ini* | Hari libur, atau Yahoo belum memperbarui IHSG | Wajar saat libur. Kalau bukan libur, jalankan ulang 15–30 menit kemudian. |
| Pesan masuk tanpa *Ringkasan AI* | `AI_API_KEY` kosong/kedaluwarsa, kuota gratis habis, atau nama model sudah tidak ada | Lihat baris `ringkasan tanpa AI:` di log. Ganti key (`gh secret set AI_API_KEY`) atau model (`gh variable set AI_MODEL --body <nama>`). |
| Log: `telegram: ... chat not found` / `Unauthorized` | Chat id salah, bot belum di-*start*/belum masuk grup, atau token salah | Kirim `/start` ke bot (atau masukkan bot ke grup), cek ulang `TELEGRAM_CHAT_ID` dan `TELEGRAM_BOT_TOKEN`. |
| Ingin berhenti sementara | – | `gh variable set SKIP_AI --body 1`; nyalakan lagi dengan `gh variable delete SKIP_AI`. |

Uji tanpa mengirim Telegram: `python scripts/ai_report.py full --no-send --force` (di laptop, dengan `AI_API_KEY` di environment).

### Semua bagian GAGAL atau situs tidak tampil

1. `gh run list --workflow site.yml --limit 3` → run `situs` terakhir harus hijau.
2. `gh run list --workflow pages-build-deployment --limit 3` → harus hijau.
3. Settings → Pages di GitHub: sumber tetap branch `gh-pages`, folder `/ (root)`.
4. Kalau GitHub Pages sendiri bermasalah, cek https://www.githubstatus.com.

### Workflow tidak jalan sama sekali

```bash
gh workflow list                       # semua harus "active"
gh workflow enable harga.yml           # aktifkan lagi yang "disabled"
```

GitHub bisa menonaktifkan jadwal repo publik yang tidak ada aktivitas sekitar 60 hari.

### GitHub Actions tidak bisa dipakai

Pakai mode laptop (plan B), dijalankan setelah 16:15 dan setelah 19:00:

```bash
./scripts/update_lokal.sh all
```

Detail dan penjadwalannya di [ARCHITECTURE.md](ARCHITECTURE.md#mode-laptop).

## Memperbarui HSC

BEI mengumumkan perubahan daftar HSC tanpa jadwal tetap (menu *Kepemilikan Saham Terkonsentrasi Tinggi* di idx.co.id). Saat ada pengumuman baru:

```bash
python scripts/hsc_update.py --pdf "/mnt/c/Users/Vito Muhammad N/Downloads/NAMA_FILE.pdf"
git add docs/data/hsc.json && git commit -m "hsc: pengumuman YYYY-MM-DD" && git push
```

Periksa daftar *masuk* dan *keluar* yang dicetak skrip sebelum push, dan cocokkan tanggal efektifnya dengan teks pengumuman.

## Mingguan (misalnya setiap Jumat malam)

- [ ] `gh run list --limit 60` → catat workflow yang sering merah dan pola jamnya.
- [ ] `cek_status.py`: jumlah saham dengan fundamental dan target analis bertambah dari minggu lalu.
- [ ] Coba 3–5 saham acak di situs (Ringkasan, Analis, Kepemilikan) dan cocokkan satu angka dengan sumber lain.
- [ ] Status `SKIP_FLOW`: `gh variable list`. Kalau masih aktif, cek apakah sumber sudah pulih.

## Bulanan

- [ ] Register KSEI baru biasanya terbit awal bulan. Pastikan kepemilikan menunjukkan register bulan lalu, lalu buka menu *Kepemilikan* untuk melihat ringkasan perubahannya.
- [ ] Versi CLI idx: `idx version`, lalu cek https://github.com/fzn0x/idx/releases. Versi baru dipakai otomatis di GitHub Actions; di laptop, pasang ulang dengan `install.sh`.
- [ ] Perbarui paket Python di laptop: `pip install -U -r requirements.txt` (terutama `yfinance`).
- [ ] Isi `docs/data/manual.json` (CDS, yield) kalau ingin angkanya tampil, lalu push.
- [ ] `gh workflow list` → semua *active*.

## Hari libur bursa

Workflow tetap jalan sesuai jadwal hari kerja. Harga tampil TELAT, dan foreign-broker biasanya tidak menemukan sesi baru. Keduanya wajar dan tidak perlu ditindaklanjuti. `cek_status.py` belum tahu kalender libur.

## Catatan insiden

Catat setiap masalah yang butuh tindakan manual sebagai **GitHub Issue** di repo (tab Issues → New issue), dengan judul `[ops] <bagian>: <gejala>`. Isi singkatnya: kapan, gejala, penyebab, tindakan. Dari situ pola masalah dan perbaikan permanen lebih mudah dilihat berdua.

## Perintah rujukan

| Tujuan | Perintah |
| --- | --- |
| Status semua bagian | `python scripts/cek_status.py --runs` |
| Run terakhir semua workflow | `gh run list --limit 15` |
| Jalankan ulang satu bagian | `gh workflow run <makro\|harga\|fundamental\|kepemilikan\|brief\|flow>.yml` |
| Hitung ulang time to buy | `gh workflow run sinyal.yml` |
| Kirim laporan AI sekarang | `gh workflow run ai.yml -f jenis=full` (atau `-f jenis=sesi1 -f paksa=true`) |
| Jalankan semua | `./scripts/jalankan_semua.sh`, atau workflow **jalankan-semua** (bisa dari HP) |
| Log run yang gagal | `gh run view <ID> --log-failed \| tail -40` |
| Matikan / nyalakan foreign-broker | `gh variable set SKIP_FLOW --body 1` / `gh variable delete SKIP_FLOW` |
| Pratinjau lokal dengan data tayang | `./scripts/update_lokal.sh sync && python -m http.server 8000 -d docs` |
| Perbarui HSC dari PDF | `python scripts/hsc_update.py --pdf <file>` |
