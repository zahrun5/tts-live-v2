let state = null;
let broadcast = null;
let roundNumber = 1;

// Emoji pool for matching pairs
const EMOJI_POOL = ['🍎','🐱','⚽','🎮','🌟','🔥','💎','🎵'];

// Shuffle array using Fisher-Yates algorithm
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate 16 cards from 8 emoji pairs
function generateCards() {
  const pairs = [];
  EMOJI_POOL.forEach(emoji => {
    pairs.push({ emoji });
    pairs.push({ emoji });
  });
  
  const shuffled = shuffle(pairs);
  return shuffled.map((card, index) => ({
    id: index,
    emoji: card.emoji,
    revealed: false,
    matched: false,
    matchedBy: null
  }));
}

// Initialize game state
function initGame() {
  state = {
    cards: generateCards(),
    playerCooldown: {},
    roundNumber
  };
}

module.exports = {
  id: 'memory-card',

  setBroadcaster(fn) {
    broadcast = fn;
  },

  init() {
    initGame();
    if (broadcast) {
      setTimeout(() => broadcast(), 100);
    }
  },

  getAdminAnswers() {
    if (!state) return { title: 'Memory Card', items: [] };
    
    // Build 4x4 grid showing all cards
    const items = [];
    for (let i = 0; i < 16; i++) {
      const card = state.cards[i];
      items.push({
        label: `#${i}`,
        hint: card.emoji,
        answer: card.emoji,
        solved: card.matched
      });
    }
    
    return {
      title: 'Memory Card - Ronde ' + state.roundNumber,
      items
    };
  },

  buildStatePayload() {
    if (!state) {
      return {
        cards: [],
        progress: '0/16',
        roundNumber: 1
      };
    }

    const matchedCount = state.cards.filter(c => c.matched).length;
    
    return {
      cards: state.cards.map(card => ({
        id: card.id,
        emoji: card.emoji,
        revealed: card.revealed,
        matched: card.matched,
        matchedBy: card.matchedBy
      })),
      progress: `${matchedCount}/16`,
      roundNumber: state.roundNumber
    };
  },

  buildClueList() {
    if (!state) return 'Ronde 1';
    const matchedCount = state.cards.filter(c => c.matched).length;
    return `Ronde ${state.roundNumber} - ${matchedCount}/16 kartu`;
  },

  async parseComment(text) {
    const normalized = text.trim().toLowerCase();
    
    // Detect skip command
    if (normalized === 'skip' || normalized === '.skip') {
      return { skip: true };
    }
    
    // Parse card selection patterns: '2 10', '2 dan 10', '2-10', '2,10'
    // Match two numbers between 0-15
    const patterns = [
      /(\d+)\s+(?:dan\s+)?(\d+)/i,  // '2 10' or '2 dan 10'
      /(\d+)[-,](\d+)/,              // '2-10' or '2,10'
    ];
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const card1 = parseInt(match[1], 10);
        const card2 = parseInt(match[2], 10);
        
        // Validate range
        if (card1 >= 0 && card1 <= 15 && card2 >= 0 && card2 <= 15) {
          return { card1, card2 };
        }
      }
    }
    
    return null;
  },

  handleAnswer({ answer, player, room }) {
    if (!answer || typeof answer !== 'object') {
      return { ok: false, msg: 'Format salah' };
    }
    
    const { card1, card2 } = answer;
    
    // Validate input
    if (card1 === undefined || card2 === undefined) {
      return { ok: false, msg: 'Pilih 2 kartu (contoh: 2 10)' };
    }
    
    if (card1 === card2) {
      return { ok: false, msg: 'Pilih 2 kartu berbeda' };
    }
    
    if (card1 < 0 || card1 > 15 || card2 < 0 || card2 > 15) {
      return { ok: false, msg: 'Nomor kartu harus 0-15' };
    }
    
    const cardA = state.cards[card1];
    const cardB = state.cards[card2];
    
    // Check if cards already matched
    if (cardA.matched || cardB.matched) {
      return { ok: false, msg: 'Kartu sudah terpasangkan' };
    }
    
    // Check player cooldown (2 seconds)
    const now = Date.now();
    const lastPlay = state.playerCooldown[player] || 0;
    if (now - lastPlay < 2000) {
      const remaining = Math.ceil((2000 - (now - lastPlay)) / 1000);
      return { ok: false, msg: `Tunggu ${remaining}s lagi` };
    }
    
    // Flip both cards
    cardA.revealed = true;
    cardB.revealed = true;
    
    // Check if they match
    const isMatch = cardA.emoji === cardB.emoji;
    
    if (isMatch) {
      // Mark as matched
      cardA.matched = true;
      cardB.matched = true;
      
      const playerObj = room?.players?.[player];
      const matchedByInfo = {
        name: player,
        emoji: playerObj?.emoji || '👤',
        profileUrl: playerObj?.profilePictureUrl || null,
        avatarType: room?.settings?.avatarType || 'emoji'
      };
      
      cardA.matchedBy = matchedByInfo;
      cardB.matchedBy = matchedByInfo;
      
      // Set cooldown
      state.playerCooldown[player] = now;
      
      if (broadcast) broadcast();
      return { ok: true, points: 10, msg: `Match! ${cardA.emoji}` };
    } else {
      // Not a match - cards will flip back after 2s on client
      // Set cooldown
      state.playerCooldown[player] = now;
      
      if (broadcast) broadcast();
      
      // Auto-hide cards after 2 seconds
      setTimeout(() => {
        if (!cardA.matched) cardA.revealed = false;
        if (!cardB.matched) cardB.revealed = false;
        if (broadcast) broadcast();
      }, 2000);
      
      return { ok: false, msg: 'Tidak cocok', wrongAnswer: true };
    }
  },

  isComplete() {
    if (!state) return false;
    return state.cards.every(c => c.matched);
  },

  async onComplete() {
    roundNumber++;
    initGame();
    if (broadcast) broadcast();
    return { success: true };
  },

  reset() {
    roundNumber = 1;
    initGame();
    if (broadcast) broadcast();
  }
};
