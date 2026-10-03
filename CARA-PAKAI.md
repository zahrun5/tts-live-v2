# Update: game Ular Tangga

## File BARU (tinggal taruh, tidak menimpa apa pun)
- `server/games/ular-tangga/index.js`
- `server/public/ular-tangga/index.html`
- `server/public/ular-tangga/manifest.json`
- `server/test/test-ular-tangga.js`

## File yang DITIMPA (masing-masing cuma tambah 1 baris)
- `server/games/game-registry.js`  (daftar game)
- `server/config.js`               (VALID_GAMES)
- `server/services/room.js`        (VOTABLE_GAMES, jadi pilihan nomor 5 di voting)
- `client/src/App.jsx`             (menu game di dashboard)

Kalau file-file itu di proyekmu sudah beda dari zip yang kamu kirim, JANGAN timpa.
Pakai patch saja dari folder proyek:

    patch -p1 < ular-tangga-registrasi.patch

## Setelah file terpasang
1. Tes (opsional, 1 detik): `node --test server/test/test-ular-tangga.js`
2. Build ulang client (karena App.jsx berubah): `cd client && npm run build`, lalu deploy seperti biasa.
3. Restart server: `pm2 restart ttslive-v2-api`.
4. Di dashboard pilih "🐍 Ular Tangga". Overlay OBS: sama seperti game lain.

## Aturan yang dipakai
- Komentar `lempar` (atau `dadu`, `roll`, 🎲) = lempar dadu. Semua penonton main bersamaan.
- Cooldown 3 detik per penonton. Papan 100 petak: 8 ular, 6 tangga, 5 petak spesial
  (2x lempar lagi tanpa cooldown, 2x mundur 3, 1x maju 5). Diacak tiap ronde.
- Harus pas di petak 100, kalau lebih memantul balik.
- 3 tercepat sampai 100 dapat 100/60/30 poin. Timeout 5 menit: tidak ada poin
  (hanya ditampilkan siapa yang paling dekat). Imbang = yang tiba duluan.
- Papan dibuat otomatis dan dicek lewat simulasi supaya rata-rata sekitar 32 sampai 48 lemparan.

## Yang gampang diubah (bagian atas `server/games/ular-tangga/index.js`)
`ROLL_COOLDOWN_MS`, `ROUND_TIMEOUT_MS`, `PODIUM_MS`, `WINNER_POINTS`, `SNAKE_COUNT`, `LADDER_COUNT`,
`SPECIAL_PLAN`, `TARGET_ROLLS_MIN/MAX`.
