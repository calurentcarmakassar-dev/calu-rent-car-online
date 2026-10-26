# Calu Rent Car Online

Starter project aplikasi rental mobil dan motor berbasis web. Dirancang untuk dipakai dari HP dan komputer, dengan database terpusat dan akun admin/karyawan.

## Fitur yang disediakan

- Login sesi server dan password hash bcrypt.
- Role `admin` dan `employee`; hanya admin dapat mengelola unit dan akun.
- Data unit Mobil/Motor dengan tarif, nomor polisi, dan status Ready/Terpakai/Pulang/Servis.
- Transaksi rental dengan validasi tanggal, tarif, DP, dan pemeriksaan bentrok jadwal.
- Pencatatan pembayaran terpisah dengan metode dan referensi.
- Riwayat aktivitas, dashboard dan ringkasan pembayaran.
- Database SQLite persisten; session disimpan ke SQLite.
- Layout responsif untuk ponsel dan desktop.

## Kebutuhan

- Node.js 20 atau lebih baru.
- Hosting yang mendukung aplikasi Node.js dan penyimpanan disk persisten.
- HTTPS wajib untuk deployment publik.

## Menjalankan lokal

1. Ekstrak ZIP ini.
2. Salin `.env.example` menjadi `.env`.
3. Atur `ADMIN_PASSWORD` dan `SESSION_SECRET` yang kuat di `.env`.
4. Jalankan:

   ```bash
   npm install
   npm start
   ```

5. Buka `http://localhost:3000`.

Akun admin awal dibuat saat database pertama kali diinisialisasi dari variabel `ADMIN_NAME`, `ADMIN_USERNAME`, dan `ADMIN_PASSWORD`. Setelah database sudah dibuat, mengubah variabel tersebut tidak otomatis mengubah akun yang sudah ada.

## Deployment online

1. Buat aplikasi Node.js pada hosting yang mendukung persistent disk.
2. Unggah repository/folder ini.
3. Jalankan `npm install` dan set start command `npm start`.
4. Set environment variables dari `.env.example`, khususnya `NODE_ENV=production`, `SESSION_SECRET` acak minimal 32 karakter, `ADMIN_PASSWORD` kuat, dan `DB_PATH` ke direktori persistent disk milik hosting.
5. Aktifkan HTTPS pada domain.
6. Pastikan direktori database persisten dan dicadangkan rutin.
7. Login sebagai admin, lalu buat akun karyawan dari menu Karyawan.

**Penting:** Jangan memasukkan `.env`, database, atau password ke repository publik. Jangan gunakan password contoh pada website publik.

## Batasan / pemeriksaan sebelum operasional penuh

Starter ini adalah fondasi aplikasi, bukan audit keamanan atau pengganti uji penerimaan. Sebelum digunakan untuk transaksi nyata:

- Uji alur transaksi, pengembalian, tagihan, dan akun pada staging.
- Tentukan aturan biaya keterlambatan, deposit/jaminan, biaya sopir, BBM, denda, pembatalan, dan kuitansi sesuai SOP usaha.
- Tambahkan alur pemeriksaan kondisi kendaraan dengan foto, tanda tangan/serah-terima, serta unggahan bukti pembayaran bila diperlukan.
- Tentukan kebijakan akses data pelanggan, retensi, backup/restore, dan pemantauan.
- Untuk skala multi-instance atau trafik tinggi, gunakan database terkelola seperti PostgreSQL dan session store terkelola; jangan menjalankan SQLite di disk sementara.
- Employee dapat membuat transaksi dan mencatat pembayaran; pengelolaan unit dan akun dibatasi ke admin. Uji role ini sesuai SOP sebelum go-live.

## Struktur

- `server.js` — API, autentikasi, otorisasi, dan skema database.
- `public/index.html` — halaman aplikasi.
- `public/style.css` — tampilan responsif.
- `public/app.js` — antarmuka dan pemanggilan API.
- `.env.example` — contoh konfigurasi.
