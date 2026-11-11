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
| 16:00 | makro | – | – |
| 16:30 | harga | **CP2 · 17:00** | harga = **sesi hari ini** |
| 16:45 | fundamental | | |
| 17:00 | kepemilikan | | |
| 17:15 | brief | **CP3 · 18:00** | fundamental & brief diperbarui hari ini; kepemilikan register ≤ 45 hari |
| 19:00 | makro | | |
| 19:30 | harga (ulang), foreign-broker | **CP4 · 20:15** | harga = sesi hari ini; foreign-broker OK atau SUMBER ERROR dengan alasan |

Jadwal GitHub bisa telat sampai sekitar satu jam. Sebelum menganggap ada masalah, tunggu sampai jam checkpoint.

## Checklist harian

Salin ke catatan masing-masing kalau mau dicentang.

- [ ] **CP1 (pagi):** `cek_status.py` → makro OK, tidak ada GAGAL.
- [ ] **CP2 (sore):** harga menunjukkan sesi hari ini. Kalau belum, lihat [Harga TELAT](#harga-telat).
- [ ] **CP3:** fundamental dan brief diperbarui hari ini; kepemilikan OK.
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

### Fundamental atau brief TELAT

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
| Jalankan semua | `./scripts/jalankan_semua.sh` |
| Log run yang gagal | `gh run view <ID> --log-failed \| tail -40` |
| Matikan / nyalakan foreign-broker | `gh variable set SKIP_FLOW --body 1` / `gh variable delete SKIP_FLOW` |
| Pratinjau lokal dengan data tayang | `./scripts/update_lokal.sh sync && python -m http.server 8000 -d docs` |
| Perbarui HSC dari PDF | `python scripts/hsc_update.py --pdf <file>` |
