const fs = require('fs');
const path = require('path');

const V1 = '/home/harun/tts-live/games';

// Track pertanyaan yang sudah dipakai di session ini (per game)
// Reset ketika semua bank sudah terpakai.
const usedInSession = {
  family100: new Set(),
  tts: new Set(),
  'susun-kata-acak': new Set(),
  'cari-kata': new Set(),
  'sambung-kata': new Set(),
  'susun-kalimat': new Set(),
  trivia: new Set(),
};

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function loadAllBanks(gameName) {
  const dir = path.join(V1, gameName, 'fallback');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));
  // Cache per process — bank tidak berubah di runtime
  const cacheKey = gameName;
  if (loadAllBanks._cache && loadAllBanks._cache[cacheKey]) return loadAllBanks._cache[cacheKey];
  let all = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(data)) all = all.concat(data);
    } catch (e) { /* skip */ }
  }
  if (!loadAllBanks._cache) loadAllBanks._cache = {};
  loadAllBanks._cache[cacheKey] = all;
  return all;
}

function loadPersistentUsed(gameName) {
  const file = path.join(V1, gameName, 'used-questions.json');
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || [];
  } catch (e) { return []; }
}

function savePersistentUsed(gameName, question) {
  const file = path.join(V1, gameName, 'used-questions.json');
  let used = [];
  try {
    if (fs.existsSync(file)) used = JSON.parse(fs.readFileSync(file, 'utf8')) || [];
  } catch (e) { used = []; }
  used.push(question);
  fs.writeFileSync(file, JSON.stringify(used, null, 2));
}

function pickFromBank(gameName, getKey) {
  const bank = loadAllBanks(gameName);
  const persistentUsed = loadPersistentUsed(gameName);
  const sessionUsed = usedInSession[gameName] || new Set();
  const allUsed = new Set([...persistentUsed, ...sessionUsed]);

  const notUsed = bank.filter(item => {
    const key = getKey(item);
    return !allUsed.has(key);
  });

  if (notUsed.length === 0) {
    // Semua sudah dipakai -> reset session tracking
    usedInSession[gameName] = new Set();
    console.log(`[GameProxy] ${gameName}: semua bank sudah dipakai, reset session.`);
    return { item: randomPick(bank), fresh: true };
  }

  const picked = randomPick(notUsed);
  usedInSession[gameName].add(getKey(picked));
  return { item: picked, fresh: false };
}

function placeTTSWords(words) {
  let curR = 0, curC = 0, maxR = 0, maxC = 0;
  const placed = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const len = w.answer ? w.answer.length : 0;
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
    const len = w.answer ? w.answer.length : 0;
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
      const { item } = pickFromBank('tts', w => w.puzzleId || JSON.stringify(w));
      if (item) {
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
      const { item, fresh } = pickFromBank('family100', w => w.question);
      if (item) {
        if (!fresh) savePersistentUsed('family100', item.question);
        const answers = (item.answers || []).map((a, i) => ({
          id: i,
          text: typeof a === 'string' ? a : a.text,
          points: typeof a === 'object' && a.points ? a.points : Math.max(30 - i * 2, 5),
          found: false,
          foundBy: null
        }));
        return { type: 'family100', data: { question: item.question, answers } };
      }
    }

    if (gameType === 'susun-kata-acak') {
      const bank = loadAllBanks('susun-kata-acak');
      const sessionUsed = usedInSession['susun-kata-acak'] || new Set();
      let notUsed = bank.filter(w => typeof w === 'string' && w.length >= 4 && !sessionUsed.has(w));
      if (notUsed.length === 0) {
        usedInSession['susun-kata-acak'] = new Set();
        notUsed = bank.filter(w => typeof w === 'string' && w.length >= 4);
      }
      const word = randomPick(notUsed);
      usedInSession['susun-kata-acak'].add(word);
      const scrambled = word.split('').sort(() => Math.random() - 0.5).join(' ');
      return { type: 'susun-kata-acak', data: { word, slots: [{ id: 'slot-0', scrambled, answer: word, status: 'active' }] } };
    }

    if (gameType === 'cari-kata') {
      const { item } = pickFromBank('cari-kata', w => w.theme + '|' + (w.words || []).join(','));
      if (item) {
        const words = (item.words || []).map(w => ({ word: typeof w === 'string' ? w : w.word, found: false }));
        return { type: 'cari-kata', data: { theme: item.theme, words } };
      }
    }

    if (gameType === 'sambung-kata') {
      const { item } = pickFromBank('sambung-kata', w => w.puzzleId || JSON.stringify(w));
      if (item) {
        const { rows, cols, words } = placeSambungWords(item);
        return { type: 'sambung-kata', data: { rows, cols, words } };
      }
    }

    if (gameType === 'susun-kalimat') {
      const { item } = pickFromBank('susun-kalimat', w => w.sentence);
      if (item) {
        return { type: 'susun-kalimat', data: {
          items: [{
            number: 1,
            sentence: item.sentence,
            words: item.words,
            shuffled: [...item.words].sort(() => Math.random() - 0.5),
            solved: false,
            solvedBy: null
          }],
          totalSoal: 1,
          solvedSoal: 0
        }};
      }
    }

    if (gameType === 'trivia') {
      const { item } = pickFromBank('trivia', w => w.question);
      if (item) {
        return { type: 'trivia', data: {
          category: item.category,
          question: item.question,
          options: item.options,
          correctLetter: item.correctLetter
        }};
      }
    }
  } catch (e) {
    console.error('[GameProxy] Error:', gameType, e.message);
  }
  return null;
};

exports.getStats = (gameName) => {
  const bank = loadAllBanks(gameName);
  const persistentUsed = loadPersistentUsed(gameName);
  const sessionUsed = usedInSession[gameName] ? usedInSession[gameName].size : 0;
  return {
    total: bank.length,
    used: persistentUsed.length + sessionUsed,
    sessionUsed: sessionUsed
  };
};
