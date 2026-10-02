let state = null;
let broadcast = null;
let roundNumber = 1;

// Generate 6 unique math problems with no duplicate answers
function generateRound() {
  const questions = [];
  const usedAnswers = new Set();
  
  while (questions.length < 6) {
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a, b, ans;

    if (op === '+') {
      a = Math.floor(Math.random() * 50) + 1;
      b = Math.floor(Math.random() * 50) + 1;
      ans = a + b;
    } else if (op === '-') {
      a = Math.floor(Math.random() * 50) + 20;
      b = Math.floor(Math.random() * 20) + 1;
      ans = a - b;
    } else if (op === '*') {
      a = Math.floor(Math.random() * 10) + 2;
      b = Math.floor(Math.random() * 10) + 2;
      ans = a * b;
    }

    // Skip if answer already exists in this round
    if (usedAnswers.has(ans)) continue;
    
    usedAnswers.add(ans);
    questions.push({
      question: `${a} ${op} ${b} = ?`,
      answer: ans,
      solved: false,
      winner: null
    });
  }
  
  state = {
    questions,
    roundNumber
  };
}

module.exports = {
  id: 'hitung-cepat',

  setBroadcaster(fn) {
    broadcast = fn;
  },

  init() {
    generateRound();
    if (broadcast) {
      setTimeout(() => broadcast(), 100);
    }
  },

  getAdminAnswers() {
    if (!state) return { title: 'Hitung Cepat', items: [] };
    
    return {
      title: 'Hitung Cepat - Ronde ' + state.roundNumber,
      items: state.questions.map((q, i) => ({
        label: `#${i + 1}`,
        hint: q.question,
        answer: String(q.answer),
        solved: q.solved
      }))
    };
  },

  buildStatePayload() {
    if (!state) {
      return {
        questions: [],
        roundNumber: 1,
        solvedCount: 0
      };
    }

    return {
      questions: state.questions.map(q => ({
        question: q.question,
        solved: q.solved,
        winner: q.winner
      })),
      roundNumber: state.roundNumber,
      solvedCount: state.questions.filter(q => q.solved).length
    };
  },

  buildClueList() {
    if (!state) return 'Ronde 1';
    return `Ronde ${state.roundNumber}`;
  },

  handleAnswer({ answer, player, room }) {
    if (!answer) return { ok: false, msg: 'Jawaban kosong' };
    
    const numAnswer = parseInt(answer, 10);
    if (isNaN(numAnswer)) return { ok: false, msg: 'Bukan angka' };

    // Find unsolved question with matching answer
    const match = state.questions.find(q => !q.solved && q.answer === numAnswer);
    
    if (!match) {
      // Check if already solved
      const alreadySolved = state.questions.find(q => q.solved && q.answer === numAnswer);
      if (alreadySolved) {
        return { ok: false, msg: 'Sudah terjawab' };
      }
      return { ok: false, msg: 'Salah' };
    }

    // Mark as solved with winner info
    match.solved = true;
    const playerObj = room?.players?.[player];
    match.winner = {
      name: player,
      emoji: playerObj?.emoji || '👤',
      profileUrl: playerObj?.profilePictureUrl || null,
      avatarType: room?.settings?.avatarType || 'emoji'
    };
    
    if (broadcast) broadcast();
    return { ok: true, points: 10, msg: 'Benar!' };
  },

  isComplete() {
    if (!state) return false;
    return state.questions.every(q => q.solved);
  },

  async onComplete() {
    roundNumber++;
    generateRound();
    if (broadcast) broadcast();
    return { success: true };
  },

  reset() {
    roundNumber = 1;
    generateRound();
    if (broadcast) broadcast();
  },

  async parseComment(text) {
    const normalized = text.trim().toLowerCase();
    
    // Detect skip command
    if (normalized === 'skip' || normalized === '.skip') {
      return { skip: true };
    }
    
    // Parse numeric answer
    const match = text.match(/\b\d+\b/);
    if (match) {
      return { answer: parseInt(match[0], 10) };
    }
    return null;
  }
};
