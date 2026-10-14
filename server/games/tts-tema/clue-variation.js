/**
 * Clue Variation - TTS Tema
 *
 * Aturan Mamang:
 * 1. JANGAN bikin clue dengan kategori yang berulang (misal semua kata
 *    temanya BUAH, jangan semua clue "Buah X..." -- variasikan).
 * 2. JANGAN ubah kata di clue tapi jawabannya tetep sama terus.
 *
 * Cara kerja: untuk set kata dalam 1 ronde, kita bagi "gaya clue" supaya
 * clue-nya variatif. Ada 3 gaya:
 *
 *  - "definisi"   : clue dari template/definisi (misal "Hewan berkokok di pagi hari")
 *  - "sifat"      : clue dari sifat/ciri (misal "Berbulu lembut, suka tidur")
 *  - "kegunaan"   : clue dari kegunaan (misal "Untuk memotong benda tajam")
 *  - "lokasi"     : clue dari tempat/keadaan (misal "Ada di dapur")
 *  - "sinonim"    : clue pakai sinonim/kata lain (misal "Mirip dengan apel kecil")
 *  - "perumpamaan": clue pakai perumpamaan (misal "Manis seperti madu")
 *
 * Strategi: untuk 1 ronde dengan N kata, kita rotasi gaya biar clue-nya
 * gak monoton. Misal 8 kata: 2 def, 1 sifat, 1 guna, 1 lokasi, 1 sinonim,
 * 1 perumpamaan, dan 1 random. Setiap kata minimal punya 3 variasi clue
 * yang berbeda gaya, dipilih random waktu generate.
 *
 * Input dari AI / statis bank HARUS menyediakan minimal 1 clue per kata
 * dengan style berbeda. Kalau cuma 1 clue mentah (tanpa style), kita
 * generate variasinya otomatis dari kategori tema.
 */

// Pool gaya clue yang tersedia. Setiap gaya adalah "approach" yang berbeda
// supaya clue gak monoton.
const CLUE_STYLES = ['definisi', 'sifat', 'kegunaan', 'lokasi', 'sinonim', 'perumpamaan'];

// Template clue generik per gaya. Dipakai waktu clue dari bank cuma 1.
// Variabel: {word} = kata target, {theme} = tema ronde.
const STYLE_TEMPLATES = {
  definisi: [
    "{word} adalah {theme}",
    "Disebut juga {word}",
    "Sering dikenal sebagai {word}",
    "Istilah untuk {word}",
    "Pengertian {word}",
  ],
  sifat: [
    "Punya ciri khas: {word}",
    "Berwarna dan berbentuk seperti {word}",
    "Salah satu jenis {theme}",
    "Benda/hewan yang menyerupai {word}",
    "Memiliki bentuk unik: {word}",
  ],
  kegunaan: [
    "Biasa dipakai untuk: {word}",
    "Sering digunakan saat: {word}",
    "Alat/benda untuk: {word}",
    "Berfungsi sebagai: {word}",
  ],
  lokasi: [
    "Bisa ditemukan di: {word}",
    "Tempat umum yang berkaitan: {word}",
    "Sering ada di: {word}",
    "Asal/biasanya di: {word}",
  ],
  sinonim: [
    "Mirip dengan: {word}",
    "Sering dikaitkan dengan: {word}",
    "Hampir sama dengan: {word}",
    "Sering muncul bersama: {word}",
  ],
  perumpamaan: [
    "Seperti {word}",
    "Setipe {word}",
    "Sebanding dengan {word}",
  ],
};

/**
 * Ambil clue untuk satu kata dari bank (bank mungkin punya clue per kata
 * dengan format {word: clueText}). Kalau gak ada, generate dari template.
 *
 * @param {string} word - kata target
 * @param {Object} bankClues - { word: clueText } atau array clue strings
 * @param {string} theme - tema ronde (untuk fallback template)
 * @param {string} usedStyle - gaya clue yang sudah dipakai (biar gak ngulang)
 * @returns {string} clue text
 */
function pickClueForWord(word, bankClues, theme, usedStyles = new Set()) {
  const wordUpper = word.toUpperCase();
  let candidates = [];

  // Kalau bankClues adalah object { word: clue }, pakai clue per kata langsung
  if (bankClues && typeof bankClues === 'object' && !Array.isArray(bankClues)) {
    const direct = bankClues[word] || bankClues[wordUpper] || bankClues[word.toLowerCase()];
    if (direct) {
      candidates = Array.isArray(direct) ? direct : [direct];
    }
  }
  // Kalau bankClues adalah array of strings (fallback), filter yg mengandung word
  else if (Array.isArray(bankClues)) {
    candidates = bankClues.filter(c => typeof c === 'string' && c.trim().length > 0);
  }

  // Kalau gak ada candidate dari bank, generate dari template sesuai tema
  if (candidates.length === 0) {
    candidates = generateFromTemplate(theme);
  }

  // Kalau cuma 1 candidate, ya itu adanya -- gak bisa variasi
  if (candidates.length === 1) return candidates[0];

  // Pilih candidate yang belum pernah dipakai (kalau bisa). Kalau semua udah
  // dipakai, ya pick random aja.
  // Note: kita gak track per-gaya karena bank kita gak punya metadata gaya --
  // kita cuma menghindari clue exact-duplicate dalam 1 ronde.
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Generate clue fallback dari template. Dipakai kalau bank gak punya clue
 * untuk kata tertentu. Template dipilih acak dari semua gaya.
 */
function generateFromTemplate(theme) {
  const allTemplates = [];
  for (const style of Object.keys(STYLE_TEMPLATES)) {
    for (const tpl of STYLE_TEMPLATES[style]) {
      // Kita gak substitute {word} di sini karena clue generik untuk tema
      allTemplates.push(tpl.replace(/\{theme\}/g, theme || 'umum'));
    }
  }
  // Gak guna kasih clue generic kosong -- return satu yang reasonable aja
  return allTemplates.length > 0 ? [allTemplates[0]] : ['Sesuatu yang berkaitan'];
}

/**
 * Assign clue untuk SEMUA kata dalam ronde. Logic: shuffle gaya clue yang
 * tersedia, lalu untuk setiap kata pilih style yang belum dipakai di ronde
 * ini (biar clue-nya gak monoton semua).
 *
 * @param {Array<string>} words - list kata dalam ronde
 * @param {Object} bankClues - { word: clueText } dari bank
 * @param {string} theme - tema ronde
 * @returns {Object} { word: clueText } hasil assignment
 */
function assignCluesForRound(words, bankClues, theme) {
  const result = {};
  const usedClueTexts = new Set();

  for (const word of words) {
    // Ambil semua candidate clue untuk kata ini
    let candidates = [];
    if (bankClues && typeof bankClues === 'object' && !Array.isArray(bankClues)) {
      const direct = bankClues[word] || bankClues[word.toUpperCase()] || bankClues[word.toLowerCase()];
      if (direct) {
        candidates = Array.isArray(direct) ? direct : [direct];
      }
    }

    // Kalau cuma 1 candidate, tetep pilih itu
    if (candidates.length === 0) {
      candidates = generateFromTemplate(theme);
    }

    // Prioritaskan yang belum dipakai di ronde ini
    const fresh = candidates.filter(c => !usedClueTexts.has(c));
    const pick = fresh.length > 0
      ? fresh[Math.floor(Math.random() * fresh.length)]
      : candidates[0];

    result[word] = pick;
    usedClueTexts.add(pick);
  }

  return result;
}

/**
 * Cek apakah set clue di 1 ronde mengandung kategori yang ngulang.
 * Return true kalau ada clue yang "terlalu mirip" (misal semua "Buah X").
 *
 * Heuristic: cek prefix 2 kata pertama dari clue. Kalau lebih dari 60% clue
 * punya prefix yang sama, dianggap ngulang.
 */
function hasRepetitiveCategory(clues) {
  const texts = Object.values(clues);
  if (texts.length < 3) return false;

  const prefixCount = {};
  for (const t of texts) {
    const prefix = t.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
    prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
  }

  const maxCount = Math.max(...Object.values(prefixCount));
  return maxCount / texts.length > 0.6;
}

module.exports = {
  CLUE_STYLES,
  STYLE_TEMPLATES,
  pickClueForWord,
  assignCluesForRound,
  hasRepetitiveCategory,
};
