const fs = require('fs');
const path = require('path');

const V1 = '/home/harun/tts-live/games';

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function loadAllBanks(gameName) {
  const dir = path.join(V1, gameName, 'fallback');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));
  let all = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(data)) all = all.concat(data);
    } catch (e) {}
  }
  return all;
}

function placeTTSWords(words) {
  let curR = 0, curC = 0, maxR = 0, maxC = 0;
  const placed = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const len = w.answer.length;
    const dir = w.direction || (i % 2 === 0 ? 'down' : 'across');
    placed.push({ ...w, direction: dir, row: curR, col: curC, length: len, number: i + 1 });
    if (dir === 'down') {
      maxR = Math.max(maxR, curR + len);
      maxC = Math.max(maxC, curC + 1);
      curR += len + 1;
      if (curR > 12) { curR = 0; curC += 4; }
    } else {
      maxR = Math.max(maxR, curR + 1);
      maxC = Math.max(maxC, curC + len);
      curC += len + 1;
      if (curC > 10) { curC = 0; curR += 2; }
    }
  }
  return { rows: Math.min(maxR + 1, 14), cols: Math.min(maxC + 1, 12), words: placed };
}

function placeSambungWords(item) {
  const words = item.words || [];
  const placed = [];
  let curR = 0, curC = 0, maxR = 0, maxC = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const len = w.answer.length;
    const dir = w.direction || (i % 2 === 0 ? 'across' : 'down');
    placed.push({ ...w, direction: dir, row: curR, col: curC, length: len, number: i + 1 });
    if (dir === 'across') {
      maxR = Math.max(maxR, curR + 1); maxC = Math.max(maxC, curC + len); curR += 2;
    } else {
      maxR = Math.max(maxR, curR + len); maxC = Math.max(maxC, curC + 1); curC += 4;
    }
  }
  return { rows: Math.min(maxR + 1, 14), cols: Math.min(maxC + 1, 12), words: placed };
}

exports.getPuzzle = (gameType) => {
  try {
    if (gameType === 'tts') {
      const bank = loadAllBanks('tts');
      if (bank.length > 0) {
        const item = randomPick(bank);
        const { rows, cols, words } = placeTTSWords(item.words || []);
        return { type: 'tts', data: { rows, cols, words } };
      }
      const p = path.join(V1, 'tts', 'puzzle.json');
      if (fs.existsSync(p)) {
        const puzzle = JSON.parse(fs.readFileSync(p, 'utf8'));
        puzzle.words = (puzzle.words || []).map((w, i) => ({ ...w, length: w.answer ? w.answer.length : 0, number: i + 1 }));
        return { type: 'tts', data: puzzle };
      }
    }

    if (gameType === 'family100') {
      const bank = loadAllBanks('family100');
      if (bank.length > 0) {
        const item = randomPick(bank);
        const answers = (item.answers || []).map((a, i) => ({
          id: i, text: typeof a === 'string' ? a : a.text,
          points: typeof a === 'object' && a.points ? a.points : Math.max(30 - i * 2, 5),
          found: false, foundBy: null
        }));
        return { type: 'family100', data: { question: item.question, answers } };
      }
    }

    if (gameType === 'susun-kata-acak') {
      const bank = loadAllBanks('susun-kata-acak');
      const allWords = bank.filter(w => typeof w === 'string' && w.length >= 4);
      const src = allWords.length > 0 ? allWords : (() => {
        const wp = path.join(V1, 'susun-kata-acak', 'fallback-wordbank.json');
        return fs.existsSync(wp) ? JSON.parse(fs.readFileSync(wp, 'utf8')) : [];
      })();
      if (src.length > 0) {
        const word = randomPick(src);
        const scrambled = word.split('').sort(() => Math.random() - 0.5).join(' ');
        return { type: 'susun-kata-acak', data: { word, slots: [{ id: 'slot-0', scrambled, answer: word, status: 'active' }] } };
      }
    }

    if (gameType === 'cari-kata') {
      const bank = loadAllBanks('cari-kata');
      if (bank.length > 0) {
        const item = randomPick(bank);
        const words = (item.words || []).map(w => ({ word: typeof w === 'string' ? w : w.word, found: false }));
        return { type: 'cari-kata', data: { theme: item.theme, words } };
      }
    }

    if (gameType === 'sambung-kata') {
      const bank = loadAllBanks('sambung-kata');
      if (bank.length > 0) {
        const item = randomPick(bank);
        const { rows, cols, words } = placeSambungWords(item);
        return { type: 'sambung-kata', data: { rows, cols, words } };
      }
    }

    if (gameType === 'susun-kalimat') {
      const bank = loadAllBanks('susun-kalimat');
      if (bank.length > 0) {
        const shuffledBank = [...bank].sort(() => Math.random() - 0.5).slice(0, 4);
        const items = shuffledBank.map((s, i) => ({
          number: i + 1, sentence: s.sentence, words: s.words,
          shuffled: [...s.words].sort(() => Math.random() - 0.5),
          solved: false, solvedBy: null
        }));
        return { type: 'susun-kalimat', data: { items, totalSoal: items.length, solvedSoal: 0 } };
      }
    }

    if (gameType === 'trivia') {
      const bank = loadAllBanks('trivia');
      if (bank.length > 0) {
        const item = randomPick(bank);
        return { type: 'trivia', data: { category: item.category, question: item.question, options: item.options, correctLetter: item.correctLetter } };
      }
    }

  } catch (e) {
    console.error('[GameProxy] Error:', gameType, e.message);
  }
  return null;
};
