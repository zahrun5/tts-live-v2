// Daftar semua game yang tersedia di platform ini.
// Tinggal tambah baris baru di sini tiap kali bikin game baru,
// server.js dan tiktok-connector.js otomatis bisa pakai lewat ACTIVE_GAME.
module.exports = {
  tts: require('./tts'),
  'sambung-kata': require('./sambung-kata'),
  'cari-kata': require('./cari-kata'),
  family100: require('./family100'),
  'susun-kata-acak': require('./susun-kata-acak'),
  'susun-kalimat': require('./susun-kalimat'),
  "hitung-cepat": require("./hitung-cepat"),
  "spam-tap": require("./spam-tap"),
  "memory-card": require("./memory-card"),
  labirin: require("./labirin"),
  "ular-tangga": require("./ular-tangga"),
  "sinonim-kata": require("./sinonim-kata"),
  "bahasa-daerah": require("./bahasa-daerah"),
};
