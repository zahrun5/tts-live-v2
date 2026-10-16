/**
 * bank-rules.js — aturan PASTI (tanpa AI) untuk kualitas soal.
 * Dipakai bersama oleh:
 *   - tools/audit-banks.js          (audit & bersihkan bank yang sudah ada)
 *   - games/<game>/fallback-manager.js (penjaga: soal baru dari AI worker harus lolos dulu)
 * Satu sumber aturan supaya audit dan runtime tidak bisa berbeda.
 */
'use strict';

const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const letters = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z]/g, '');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (hay, needle) => new RegExp('(^|[^a-z0-9])' + escRe(needle) + '([^a-z0-9]|$)', 'i').test(hay);


// Cirilik s.d. CJK, kana, hangul: tanda teks rusak di bank berbahasa Indonesia.
const NON_LATIN_RE = /[\u0400-\u04FF\u0590-\u06FF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

// Family 100: kata pengisi kosong yang ditempel generator di ujung pertanyaan.
const FILLER = '(?:spesial|khas|spesifik|favorit|populer|alami|umum|menarik|biasa|terkenal|lengkap)';
const FILLER_TAIL_RE = new RegExp(
  '\\s+(?:yang\\s+' + FILLER + '|yang\\s+(?:sering|biasa|banyak)\\s+(?:kita\\s+)?(?:dijumpai|didengar|digunakan|dipakai|dilihat|dikenal)|yang\\s+(?:umum|biasa)\\s+dikenal|yang\\s+(?:sering\\s+|biasa\\s+|banyak\\s+)?(?:kamu|kita|anda)\\s+(?:jumpai|dijumpai|dengar|ketahui|tahu|kenal|lihat|temui)|yang\\s+(?:umum|biasa|sering)\\s+ada|(?:kamu|kita)\\s+(?:ketahui|tahu|kenal)|' + FILLER + ')$', 'i');

// Di tengah kalimat hanya pengisi yang benar-benar kosong makna (khas/populer/umum bisa bermakna, dibiarkan).
const FILLER_MID_RE = /\s+yang\s+(?:spesial|spesifik|favorit|alami|menarik|lengkap)(?=\s)/gi;

function cleanFamilyQuestion(q) {
  let s = String(q || '').trim();
  // Ulangi sampai stabil: satu putaran bisa membuka kata pengisi/awalan baru (idempoten).
  for (let i = 0; i < 8; i++) {
    const before = s;
    s = s.replace(/[?.\s]+$/, '');
    s = s.replace(FILLER_TAIL_RE, '');
    s = s.replace(FILLER_MID_RE, '');   // pengisi kosong di tengah kalimat
    s = s.replace(/^(?:sebutkan\s+)?(?:berbagai|contoh|macam-macam|jenis-jenis|nama-nama|beberapa|jenis|macam|nama)\s+/i, '');
    if (s === before) break;
  }
  if (!/^sebutkan\b/i.test(s)) s = 'Sebutkan ' + s.charAt(0).toLowerCase() + s.slice(1);
  s = s.replace(/\bindonesia\b/gi, 'Indonesia');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ───────────────────────── aturan per game ─────────────────────────
// det(item) -> null | {drop: alasan} | {edit: itemBaru, why}
const det = {
  family100(it) {
    const q = cleanFamilyQuestion(it.question);
    if (q !== it.question) return { edit: { ...it, question: q }, why: 'pertanyaan dirapikan (buang kata pengisi)' };
    return null;
  },

  'lengkapi-kalimat'(it) {
    const blanks = (String(it.sentence).match(/_{2,}/g) || []).length;
    if (blanks !== 1) return { drop: `jumlah isian kosong = ${blanks}, harus tepat 1` };
    const filled = String(it.sentence).replace(/_{2,}/g, ' ');
    const first = String((it.answers || [])[0] || '');
    if (first && wholeWord(filled, first)) return { drop: `jawaban "${first}" sudah ada di kalimat (berputar)` };
    return null;
  },

  'sinonim-dan-bahasa-daerah'(it) {
    const answers = (it.answers || []).filter(a => norm(a) !== norm(it.word));
    if (!answers.length) return { drop: 'semua jawaban sama dengan kata soal' };
    if (answers.length !== it.answers.length) return { edit: { ...it, answers }, why: 'jawaban yang sama dengan kata soal dibuang' };
    return null;
  },

  'tts-tema'(it) {
    const theme = letters(it.theme);
    const words = (it.words || []).map(letters);
    // Tema satu kata yang "kata-katanya" cuma turunan imbuhan/potongan tema (BESAR -> SEBESAR, MABESART).
    if (!/\s/.test(String(it.theme).trim()) && theme.length >= 3 && words.length &&
        words.filter(w => w.includes(theme)).length / words.length >= 0.6) {
      return { drop: `tema "${it.theme}" hanya berisi turunan kata itu sendiri` };
    }
    return null;
  },

  'susun-kalimat'(it) {
    if ((it.words || []).length < 3) return { drop: 'kurang dari 3 kata' };
    return null;
  },

  'cari-kata': () => null
};

// Field array yang bisa "diperbaiki" + minimal isinya setelah diperbaiki.
const LIST_RULES = {
  family100: { list: 'answers', minList: 4 },
  'lengkapi-kalimat': { list: 'answers', minList: 1 },
  'sinonim-dan-bahasa-daerah': { list: 'answers', minList: 1 },
  'tts-tema': { list: 'words', minList: 4 },
  'susun-kalimat': { list: null, minList: 0 },
  'cari-kata': { list: 'words', minList: 8 }
};

/**
 * Penjaga untuk jalur simpan bank: kembalikan item yang sudah dirapikan,
 * atau null kalau harus ditolak. Tidak pernah melempar error.
 */
function sanitize(game, item) {
  try {
    if (!item) return null;
    if (NON_LATIN_RE.test(JSON.stringify(item))) return null;
    const rule = det[game];
    let cur = item;
    if (rule) {
      const r = rule(item);
      if (r && r.drop) return null;
      if (r && r.edit) cur = r.edit;
    }
    const lr = LIST_RULES[game];
    if (lr && lr.list && (cur[lr.list] || []).length < lr.minList) return null;
    return cur;
  } catch (e) {
    return item; // penjaga tidak boleh menjatuhkan alur simpan
  }
}

module.exports = { NON_LATIN_RE, cleanFamilyQuestion, det, LIST_RULES, sanitize, norm, letters, wholeWord };
