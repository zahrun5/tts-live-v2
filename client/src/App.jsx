import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';

axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const response = await axios.post('/api/auth/login', { username, password });
      localStorage.setItem('token', response.data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Gagal login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 animate-gradient">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-40"></div>
      <div className="relative p-8 backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl w-96 transform hover:scale-105 transition-transform duration-300">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-3 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl shadow-lg">
            <span className="text-3xl">🎮</span>
          </div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">TTS Live Studio</h2>
          <p className="mt-1 text-sm text-slate-300">Masuk ke dashboard game interaktif</p>
        </div>
        {error && (
          <div className="p-3 mb-4 text-sm text-rose-100 bg-rose-500/20 border border-rose-500/30 rounded-lg backdrop-blur-sm animate-shake">
            {error}
          </div>
        )}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block mb-2 text-sm font-medium text-slate-200">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="username"
              required
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-slate-200">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 font-bold text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-purple-500/50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Memproses...
              </span>
            ) : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [activeGame, setActiveGame] = useState('tts');
  const [randomGames, setRandomGames] = useState(['tts', 'susun-kata-acak', 'family100', 'cari-kata', 'sambung-kata', 'susun-kalimat']);
  const [avatarType, setAvatarType] = useState('emoji');
  const [isConnected, setIsConnected] = useState(false);
  const [activeSoal, setActiveSoal] = useState(null);
  const [gameStats, setGameStats] = useState({});
  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' });
  const [testUsername, setTestUsername] = useState('');
  const [testComment, setTestComment] = useState('');
  const [testHistory, setTestHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAnswers, setShowAnswers] = useState(false);
  const [answers, setAnswers] = useState(null);
  const [answersError, setAnswersError] = useState('');

  const allGames = [
    { id: 'game-random', label: '🎲 Game Random', icon: '🎲', color: 'from-violet-500 to-purple-600' },
    { id: 'tts', label: '📝 Teka Teki Silang', icon: '📝', color: 'from-blue-500 to-cyan-600' },
    { id: 'family100', label: '👨‍👩‍👧‍👦 Family 100', icon: '👨‍👩‍👧‍👦', color: 'from-emerald-500 to-teal-600' },
    { id: 'susun-kata-acak', label: '🔤 Susun Kata Acak', icon: '🔤', color: 'from-amber-500 to-orange-600' },
    { id: 'cari-kata', label: '🔍 Cari Kata', icon: '🔍', color: 'from-pink-500 to-rose-600' },
    { id: 'sambung-kata', label: '⛓️ Sambung Kata', icon: '⛓️', color: 'from-indigo-500 to-blue-600' },
    { id: 'susun-kalimat', label: '📑 Susun Kalimat', icon: '📑', color: 'from-purple-500 to-pink-600' },
    { id: 'hitung-cepat', label: '🧮 Hitung Cepat', icon: '🧮', color: 'from-red-500 to-orange-600' },
    { id: 'spam-tap', label: '❤️ Spam Tap Battle', icon: '⚔️', color: 'from-red-500 to-blue-600' },
    { id: 'memory-card', label: '🎴 Memory Card', icon: '🃏', color: 'from-purple-500 to-pink-600' },
    { id: 'labirin', label: '🌀 Labirin', icon: '🌀', color: 'from-violet-500 to-fuchsia-600' },
    { id: 'ular-tangga', label: '🐍 Ular Tangga', icon: '🐍', color: 'from-emerald-500 to-lime-600' },
  ];
  const refreshActiveSoal = async (username) => {
    if (!username) return;
    try {
      const res = await axios.get(`/api/sys/game-state/${username}`);
      setActiveSoal(res.data.state && res.data.state.actualGame ? res.data.state.actualGame : null);
      if (res.data.stats) setGameStats(res.data.stats);
    } catch (err) {
      setActiveSoal(null);
    }
  };

  const fetchAnswers = async () => {
    try {
      const res = await axios.get('/api/sys/game/answers');
      setAnswers(res.data);
      setAnswersError('');
    } catch (err) {
      setAnswers(null);
      setAnswersError(err.response?.data?.error || 'Gagal memuat jawaban');
    }
  };

  useEffect(() => {
    if (!showAnswers) return;
    fetchAnswers();
    const t = setInterval(fetchAnswers, 4000);
    return () => clearInterval(t);
  }, [showAnswers]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get('/api/sys/me');
        setUser(res.data.user);
        setTiktokUsername(res.data.user.tiktokUsername || '');
        setActiveGame(res.data.user.activeGame || 'tts');
        setRandomGames(res.data.user.randomGames || ['tts', 'susun-kata-acak', 'family100', 'cari-kata', 'sambung-kata', 'susun-kalimat']);
        setAvatarType(res.data.user.avatarType || 'emoji');
        setIsConnected(res.data.isConnected);
        refreshActiveSoal(res.data.user.username);
      } catch (err) {
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [navigate]);

  const saveSettings = async () => {
    try {
      await axios.post('/api/sys/settings', { tiktokUsername, activeGame, randomGames, avatarType });
      setStatusMsg({ text: 'Pengaturan berhasil disimpan!', type: 'success' });
      await axios.post('/api/sys/overlay/reload');
      if (user) await refreshActiveSoal(user.username);
      setTimeout(() => setStatusMsg({text:'', type:''}), 3000);
    } catch (err) {
      setStatusMsg({ text: 'Gagal menyimpan', type: 'error' });
    }
  };

  const toggleConnection = async () => {
    setStatusMsg({ text: 'Memproses...', type: 'info' });
    try {
      const action = isConnected ? 'stop' : 'start';
      const res = await axios.post('/api/sys/tiktok/toggle', { action });
      setIsConnected(res.data.isConnected);
      setStatusMsg({ text: res.data.message, type: 'success' });
      if (user) await refreshActiveSoal(user.username);
    } catch (err) {
      setStatusMsg({ text: err.response?.data?.error || 'Gagal tersambung', type: 'error' });
    }
  };

  const resetLeaderboard = async () => {
    if (!window.confirm('Yakin ingin mereset skor semua pemain jadi 0?')) return;
    setStatusMsg({ text: 'Mereset leaderboard...', type: 'info' });
    try {
      await axios.post('/api/sys/game/reset-leaderboard');
      setStatusMsg({ text: 'Leaderboard berhasil direset!', type: 'success' });
      setTimeout(() => setStatusMsg({text:'', type:''}), 2000);
    } catch (err) {
      setStatusMsg({ text: 'Gagal mereset leaderboard', type: 'error' });
    }
  };

  const skipRound = async () => {
    setStatusMsg({ text: 'Memuat soal baru...', type: 'info' });
    try {
      await axios.post('/api/sys/game/skip');
      setStatusMsg({ text: 'Soal baru dimuat!', type: 'success' });
      setTimeout(() => setStatusMsg({text:'', type:''}), 2000);
    } catch (err) {
      setStatusMsg({ text: 'Gagal memuat soal baru', type: 'error' });
    }
  };

  const sendTestComment = async (e) => {
    e.preventDefault();
    if (!testComment.trim()) return;
    try {
      await axios.post('/api/sys/game/test-comment', { comment: testComment });
      setTestHistory(prev => [{ text: testComment.trim(), sent: true, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));
      setTestComment('');
    } catch (err) {
      setStatusMsg({ text: 'Gagal kirim test comment', type: 'error' });
    }
  };

  const testConnectStreamer = async () => {
    if (!testUsername.trim()) return;
    setStatusMsg({ text: `Menghubungi live @${testUsername.trim()}...`, type: 'info' });
    try {
      const res = await axios.post('/api/sys/tiktok/test-connect', { tiktokUsername: testUsername.trim() });
      setStatusMsg({ text: res.data.message, type: 'success' });
      setIsConnected(true);
      setTiktokUsername(testUsername.trim());
      await axios.post('/api/sys/settings', { tiktokUsername: testUsername.trim(), activeGame, randomGames, avatarType });
      setTestHistory(prev => [{ text: `@${testUsername.trim()} - connected!`, sent: false, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));
    } catch (err) {
      setStatusMsg({ text: err.response?.data?.error || 'Gagal menyambung ke streamer', type: 'error' });
    }
  };

  const toggleRandomGame = (gameId) => {
    setRandomGames(prev => {
      if (prev.includes(gameId)) {
        if (prev.length <= 1) return prev;
        return prev.filter(g => g !== gameId);
      }
      return [...prev, gameId];
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <div className="inline-block w-16 h-16 mb-4 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
          <p className="text-slate-300">Loading dashboard...</p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-40"></div>
      
      <nav className="relative backdrop-blur-xl bg-slate-900/50 border-b border-white/10 shadow-2xl">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl shadow-lg">
                <span className="text-2xl">🎮</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">TTS-Live Studio</h1>
                <p className="text-xs text-slate-400">Interactive Game Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-2 backdrop-blur-sm bg-white/5 border border-white/10 rounded-xl">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                <span className="text-slate-300 text-sm">Halo, <strong className="text-white">{user.username}</strong></span>
              </div>
              <button
                onClick={() => { localStorage.clear(); navigate('/login'); }}
                className="px-4 py-2 text-sm font-medium text-rose-100 bg-rose-500/20 border border-rose-500/30 rounded-xl hover:bg-rose-500/30 transition-all"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="relative max-w-7xl mx-auto p-6 md:p-8">
        {statusMsg.text && (
          <div className={`p-4 mb-6 rounded-xl backdrop-blur-xl border font-medium animate-slideDown ${
            statusMsg.type === 'error' 
              ? 'bg-rose-500/20 border-rose-500/30 text-rose-100' 
              : statusMsg.type === 'info' 
              ? 'bg-blue-500/20 border-blue-500/30 text-blue-100' 
              : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-100'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-xl">{statusMsg.type === 'error' ? '⚠️' : statusMsg.type === 'info' ? '⏳' : '✅'}</span>
              {statusMsg.text}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left Column - Connection & Testing */}
          <div className="space-y-6 lg:col-span-1">
            {/* TikTok Connection Card */}
            <div className="p-6 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl hover:shadow-purple-500/20 transition-all">
              <div className="flex items-center gap-2 mb-5">
                <span className="text-2xl">📱</span>
                <h2 className="text-lg font-bold text-white">Koneksi TikTok</h2>
              </div>
              
              <div className="mb-4">
                <label className="block mb-2 text-sm font-medium text-slate-300">Username TikTok Target</label>
                <input
                  type="text"
                  value={tiktokUsername}
                  onChange={e => setTiktokUsername(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                  placeholder="@username_tiktok"
                />
              </div>

              <div className="mb-4">
                <label className="block mb-2 text-sm font-medium text-slate-300">Tampilan Avatar</label>
                <div className="flex gap-3">
                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all border border-white/10 hover:border-purple-500/50" style={{
                    background: avatarType === 'emoji' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                    borderColor: avatarType === 'emoji' ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255,255,255,0.1)'
                  }}>
                    <input
                      type="radio"
                      name="avatarType"
                      value="emoji"
                      checked={avatarType === 'emoji'}
                      onChange={() => setAvatarType('emoji')}
                      className="hidden"
                    />
                    <span className="text-xl">🟢</span>
                    <span className="text-sm text-white font-medium">Emoji</span>
                  </label>
                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all border border-white/10 hover:border-purple-500/50" style={{
                    background: avatarType === 'tiktok' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                    borderColor: avatarType === 'tiktok' ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255,255,255,0.1)'
                  }}>
                    <input
                      type="radio"
                      name="avatarType"
                      value="tiktok"
                      checked={avatarType === 'tiktok'}
                      onChange={() => setAvatarType('tiktok')}
                      className="hidden"
                    />
                    <span className="text-xl">🖼</span>
                    <span className="text-sm text-white font-medium">Profil TT</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2 mb-3">
                <button
                  onClick={saveSettings}
                  className="px-4 py-2.5 text-sm font-medium text-blue-100 bg-blue-500/20 border border-blue-500/30 rounded-xl hover:bg-blue-500/30 transition-all"
                >
                  💾 Simpan
                </button>
                <button
                  onClick={toggleConnection}
                  className={`flex-1 font-medium rounded-xl py-2.5 transition-all text-white ${
                    isConnected 
                      ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-lg shadow-rose-500/30' 
                      : 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 shadow-lg shadow-emerald-500/30'
                  }`}
                >
                  {isConnected ? '🔴 Putus Koneksi' : '🟢 Sambungkan'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={skipRound}
                  className="px-3 py-2.5 text-sm font-medium text-amber-100 bg-amber-500/20 border border-amber-500/30 rounded-xl hover:bg-amber-500/30 transition-all"
                >
                  ⏭ Skip Soal
                </button>
                <button
                  onClick={resetLeaderboard}
                  className="px-3 py-2.5 text-sm font-medium text-rose-100 bg-rose-500/20 border border-rose-500/30 rounded-xl hover:bg-rose-500/30 transition-all"
                >
                  🗑️ Reset Skor
                </button>
              </div>
            </div>

            {/* Test & Debug Card */}
            <div className="p-6 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl hover:shadow-blue-500/20 transition-all">
              <div className="flex items-center gap-2 mb-5">
                <span className="text-2xl">🧪</span>
                <h2 className="text-lg font-bold text-white">Test & Debug</h2>
              </div>

              <div className="mb-4">
                <label className="block mb-2 text-sm font-medium text-slate-300">Test Koneksi ke Live:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testUsername}
                    onChange={e => setTestUsername(e.target.value)}
                    className="flex-1 px-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                    placeholder="username"
                  />
                  <button
                    onClick={testConnectStreamer}
                    className="px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl hover:from-purple-500 hover:to-blue-500 transition-all shadow-lg"
                  >
                    🔗
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10">
                <label className="block mb-2 text-sm font-medium text-slate-300">Kirim Test Comment:</label>
                <form onSubmit={sendTestComment} className="flex gap-2">
                  <input
                    type="text"
                    value={testComment}
                    onChange={e => setTestComment(e.target.value)}
                    className="flex-1 px-4 py-2.5 bg-white/5 border border-white/20 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all text-sm"
                    placeholder="Ketik jawaban..."
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-teal-600 to-cyan-600 rounded-xl hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg"
                  >
                    📤
                  </button>
                </form>
              </div>

              {testHistory.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/10 space-y-1 max-h-32 overflow-y-auto">
                  {testHistory.map((h, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
                        h.sent ? 'bg-teal-500/10 text-teal-200' : 'bg-purple-500/10 text-purple-200'
                      }`}
                    >
                      <span className="truncate flex-1">{h.sent ? '→' : '🔗'} {h.text}</span>
                      <span className="text-slate-500 ml-2">{h.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Middle Column - Game Selection */}
          <div className="lg:col-span-2">
            <div className="p-6 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl hover:shadow-purple-500/20 transition-all">
              <div className="flex items-center gap-2 mb-5">
                <span className="text-2xl">🎮</span>
                <h2 className="text-lg font-bold text-white">Pilih Game Aktif</h2>
              </div>

              {/* Active Game Status Banner */}
              <div className={`flex items-center gap-3 px-4 py-3 mb-5 rounded-xl border backdrop-blur-sm ${
                activeSoal
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              }`}>
                <span className="text-2xl">{activeSoal ? '✅' : '⚠️'}</span>
                <div className="flex-1">
                  {activeSoal ? (
                    <div>
                      <div className="text-xs font-medium text-emerald-300/80">Soal aktif:</div>
                      <div className="font-bold">{allGames.find(g => g.id === activeSoal)?.label || activeSoal}</div>
                    </div>
                  ) : (
                    <div>
                      <div className="font-medium">Belum ada soal aktif</div>
                      <div className="text-xs text-amber-300/70">Pilih game lalu klik Simpan</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Game Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {allGames.map(game => (
                  <label
                    key={game.id}
                    className={`group relative p-4 rounded-xl cursor-pointer transition-all duration-300 border ${
                      activeGame === game.id
                        ? 'bg-gradient-to-br ' + game.color + ' border-white/30 shadow-lg scale-105'
                        : 'bg-white/5 border-white/10 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    <input
                      type="radio"
                      name="game"
                      checked={activeGame === game.id}
                      onChange={() => setActiveGame(game.id)}
                      className="hidden"
                    />
                    <div className="flex items-start gap-3">
                      <div className={`flex items-center justify-center w-12 h-12 rounded-xl transition-all ${
                        activeGame === game.id
                          ? 'bg-white/20 shadow-lg'
                          : 'bg-white/5 group-hover:bg-white/10'
                      }`}>
                        <span className="text-2xl">{game.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold text-sm mb-1 ${
                          activeGame === game.id ? 'text-white' : 'text-slate-200'
                        }`}>
                          {game.label.replace(/^[^\s]+\s/, '')}
                        </div>
                        {gameStats[game.id] && (
                          <div className={`flex items-center gap-3 text-xs ${
                            activeGame === game.id ? 'text-white/70' : 'text-slate-400'
                          }`}>
                            <span className="flex items-center gap-1">
                              <span className="font-medium">{gameStats[game.id].total || 0}</span>
                              <span className="text-[10px]">bank</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="font-medium">{gameStats[game.id].used || 0}</span>
                              <span className="text-[10px]">pakai</span>
                            </span>
                          </div>
                        )}
                      </div>
                      {activeGame === game.id && (
                        <div className="absolute top-2 right-2">
                          <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-lg">
                            <span className="text-xs">✓</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              {/* Random Game Config */}
              {activeGame === 'game-random' && (
                <div className="p-4 mb-5 backdrop-blur-sm bg-purple-500/10 border border-purple-500/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🎲</span>
                    <p className="text-sm font-medium text-purple-200">Pilih game yang akan diacak:</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {allGames.filter(g => g.id !== 'game-random').map(game => (
                      <label
                        key={game.id}
                        className={`flex items-center gap-2 px-3 py-2.5 text-xs rounded-lg cursor-pointer transition-all border ${
                          randomGames.includes(game.id)
                            ? 'bg-purple-500/20 border-purple-400/50 text-white'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={randomGames.includes(game.id)}
                          onChange={() => toggleRandomGame(game.id)}
                          className="hidden"
                        />
                        <span className="text-base">{game.icon}</span>
                        <span className="flex-1 truncate">{game.label.replace(/^[^\s]+\s/, '')}</span>
                        {randomGames.includes(game.id) && <span className="text-purple-300">✓</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={saveSettings}
                className="w-full py-3 font-bold text-white bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg hover:shadow-blue-500/50 transform hover:scale-105"
              >
                💾 Simpan & Ganti Game
              </button>
            </div>
          </div>
        </div>
        {/* Admin Answers Section */}
        <div className="mt-6 p-6 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔑</span>
              <h2 className="text-lg font-bold text-white">Jawaban Soal Aktif (Admin)</h2>
            </div>
            <button
              onClick={() => setShowAnswers(v => !v)}
              className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                showAnswers
                  ? 'bg-slate-500/20 text-slate-200 border border-slate-500/30 hover:bg-slate-500/30'
                  : 'bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30'
              }`}
            >
              {showAnswers ? '🙈 Sembunyikan' : '👁 Tampilkan'}
            </button>
          </div>

          {!showAnswers && (
            <p className="text-sm text-slate-400 bg-slate-800/30 px-4 py-3 rounded-xl border border-slate-700/30">
              Disembunyikan supaya aman kalau layar dashboard ikut terlihat di stream. Klik Tampilkan kalau game macet atau perlu cek jawaban.
            </p>
          )}

          {showAnswers && (
            <div>
              {answersError && (
                <div className="px-4 py-3 text-sm text-rose-200 bg-rose-500/20 border border-rose-500/30 rounded-xl">
                  {answersError}
                </div>
              )}
              {answers && answers.ok && (
                <div>
                  <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                    <span className="text-2xl">{allGames.find(g => g.id === answers.gameId)?.icon || '🎮'}</span>
                    <div>
                      <div className="font-bold text-white">
                        {allGames.find(g => g.id === answers.gameId)?.label || answers.gameId}
                      </div>
                      {answers.title && <div className="text-sm text-blue-200">{answers.title}</div>}
                    </div>
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                    {answers.items.map((it, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${
                          it.solved
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-amber-500/10 border-amber-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 text-xs font-bold text-white shrink-0">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-400 mb-1">{it.label}</div>
                          <div className={`font-bold text-lg break-words ${
                            it.solved ? 'line-through text-slate-400' : 'text-white'
                          }`}>
                            {it.answer}
                          </div>
                          {it.hint && (
                            <div className="text-xs text-slate-400 mt-1 break-words">💡 {it.hint}</div>
                          )}
                        </div>
                        <div className={`text-2xl shrink-0 ${it.solved ? '' : 'opacity-50'}`}>
                          {it.solved ? '✅' : '⏳'}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 text-xs text-slate-500 text-center bg-slate-800/30 px-3 py-2 rounded-lg">
                    ⚡ Update otomatis tiap 4 detik • Jawab lewat komentar atau kolom test di atas
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* OBS Browser Source Link */}
        <div className="mt-6 p-6 backdrop-blur-xl bg-gradient-to-br from-slate-800/50 to-purple-900/30 border border-white/10 rounded-2xl shadow-2xl">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🔗</span>
            <div>
              <h2 className="font-bold text-white text-lg">OBS Browser Source</h2>
              <p className="text-xs text-slate-400">Tambahkan link ini ke OBS sebagai Browser Source</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 px-4 py-3 text-sm text-emerald-300 bg-slate-900/70 border border-slate-700/50 rounded-xl select-all overflow-x-auto font-mono">
              https://live.albiontools.fun/overlay/{user.username}
            </code>
          </div>
        </div>

        {/* Fullscreen PC Link */}
        <div className="mt-4 p-6 backdrop-blur-xl bg-gradient-to-br from-slate-800/50 to-indigo-900/30 border border-white/10 rounded-2xl shadow-2xl">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🖥️</span>
            <div>
              <h2 className="font-bold text-white text-lg">Fullscreen PC</h2>
              <p className="text-xs text-slate-400">Buka di browser PC — fullscreen otomatis terjaga saat ganti game</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 px-4 py-3 text-sm text-purple-300 bg-slate-900/70 border border-slate-700/50 rounded-xl select-all overflow-x-auto font-mono">
              https://live.albiontools.fun/overlay-shell/{user.username}
            </code>
            <a
              href={'https://live.albiontools.fun/overlay-shell/' + user.username}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-3 font-medium text-white bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl hover:from-purple-500 hover:to-indigo-500 transition-all shadow-lg hover:shadow-purple-500/50 whitespace-nowrap"
            >
              🖥️ Buka
            </a>
          </div>
        </div>
      </main>

      <style>{`
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 15s ease infinite;
        }
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-shake {
          animation: shake 0.5s ease;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-slideDown {
          animation: slideDown 0.3s ease;
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(168, 85, 247, 0.5);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(168, 85, 247, 0.7);
        }
      `}</style>
    </div>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}
