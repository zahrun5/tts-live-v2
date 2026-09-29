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
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="p-8 bg-white rounded shadow-md w-96">
        <h2 className="mb-6 text-2xl font-bold text-center text-gray-800">Login TTS Live</h2>
        {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded">{error}</div>}
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block mb-2 text-sm font-medium text-gray-700">Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-3 py-2 border rounded" required />
          </div>
          <div className="mb-6">
            <label className="block mb-2 text-sm font-medium text-gray-700">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded" required />
          </div>
          <button type="submit" disabled={loading} className="w-full px-4 py-2 font-bold text-white bg-blue-600 rounded">
            {loading ? 'Proses...' : 'Masuk'}
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
  const [randomGames, setRandomGames] = useState(['tts', 'susun-kata-acak', 'family100', 'trivia', 'cari-kata', 'sambung-kata']);
  const [isConnected, setIsConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' });
  const [testUsername, setTestUsername] = useState('');
  const [testComment, setTestComment] = useState('');
  const [testHistory, setTestHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const allGames = [
    { id: 'game-random', label: '🎲 Game Random (Acak)' },
    { id: 'tts', label: '📝 Teka Teki Silang (TTS)' },
    { id: 'family100', label: '👨‍👩‍👧‍👦 Family 100' },
    { id: 'susun-kata-acak', label: '🔤 Susun Kata Acak' },
    { id: 'cari-kata', label: '🔍 Cari Kata' },
    { id: 'sambung-kata', label: '⛓️ Sambung Kata' },
    { id: 'susun-kalimat', label: '📑 Susun Kalimat' },
    { id: 'trivia', label: '🧠 Trivia' },
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get('/api/sys/me');
        setUser(res.data.user);
        setTiktokUsername(res.data.user.tiktokUsername || '');
        setActiveGame(res.data.user.activeGame || 'tts');
        setRandomGames(res.data.user.randomGames || ['tts', 'susun-kata-acak', 'family100', 'trivia', 'cari-kata', 'sambung-kata']);
        setIsConnected(res.data.isConnected);
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
      await axios.post('/api/sys/settings', { tiktokUsername, activeGame, randomGames });
      setStatusMsg({ text: 'Pengaturan berhasil disimpan!', type: 'success' });
      await axios.post('/api/sys/overlay/reload');
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
    } catch (err) {
      setStatusMsg({ text: err.response?.data?.error || 'Gagal tersambung', type: 'error' });
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
      // Simpan sebagai setting aktif
      setTiktokUsername(testUsername.trim());
      await axios.post('/api/sys/settings', { tiktokUsername: testUsername.trim(), activeGame, randomGames });
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

  if (loading) return <div className="p-10 text-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="flex items-center justify-between px-6 py-4 bg-white shadow-sm">
        <h1 className="text-xl font-bold text-blue-600">TTS-Live Studio</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-600">Halo, <strong>{user.username}</strong></span>
          <button onClick={() => { localStorage.clear(); navigate('/login'); }} className="px-3 py-1 text-sm text-red-600 bg-red-100 rounded">Logout</button>
        </div>
      </nav>

      <main className="max-w-5xl p-8 mx-auto">
        {statusMsg.text && (
          <div className={`p-4 mb-6 rounded text-white font-medium ${statusMsg.type === 'error' ? 'bg-red-500' : statusMsg.type === 'info' ? 'bg-blue-500' : 'bg-green-500'}`}>
            {statusMsg.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Panel TikTok */}
          <div className="space-y-4">
            <div className="p-6 bg-white border border-gray-100 rounded-lg shadow-sm">
              <h2 className="flex items-center gap-2 mb-4 text-lg font-bold">📱 Koneksi TikTok</h2>
              <div className="mb-4">
                <label className="block mb-1 text-sm text-gray-500">Username TikTok Target</label>
                <input type="text" value={tiktokUsername} onChange={e => setTiktokUsername(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border rounded" placeholder="@username_tiktok" />
              </div>
              <div className="flex gap-2 mb-2">
                <button onClick={saveSettings} className="px-4 py-2 text-blue-700 bg-blue-100 rounded hover:bg-blue-200">Simpan</button>
                <button onClick={toggleConnection} className={`flex-1 font-medium text-white rounded py-2 ${isConnected ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
                  {isConnected ? 'Putuskan Koneksi' : 'Sambungkan ke Live'}
                </button>
              </div>
              <button onClick={skipRound} className="w-full px-4 py-2 font-medium text-orange-700 bg-orange-100 border border-orange-200 rounded hover:bg-orange-200">
                ⏭ Skip Soal
              </button>
            </div>

            {/* Panel Test Komentar */}
            <div className="p-6 bg-white border border-gray-100 rounded-lg shadow-sm">
              <h2 className="flex items-center gap-2 mb-4 text-lg font-bold">🧪 Test & Cek Live</h2>

              {/* Sambung ke streamer untuk test */}
              <div className="mb-4">
                <label className="block mb-2 text-sm font-medium text-gray-600">Masukkan username streamer yang sedang live:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testUsername}
                    onChange={e => setTestUsername(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-50 border rounded"
                    placeholder="windahbasudara"
                  />
                  <button onClick={testConnectStreamer} className="px-4 py-2 font-medium text-white bg-purple-600 rounded hover:bg-purple-700">
                    🔗 Test Koneksi
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400">Ketik username streamer terkenal yang sedang live, lalu klik Test Koneksi.</p>
              </div>

              {/* Kirim komentar test manual */}
              <div className="pt-4 border-t border-gray-100">
                <label className="block mb-2 text-sm font-medium text-gray-600">Atau kirim komentar test manual:</label>
                <form onSubmit={sendTestComment} className="flex gap-2">
                  <input
                    type="text"
                    value={testComment}
                    onChange={e => setTestComment(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-50 border rounded"
                    placeholder="Ketik jawaban..."
                  />
                  <button type="submit" className="px-4 py-2 font-medium text-white bg-teal-600 rounded hover:bg-teal-700">
                    Kirim
                  </button>
                </form>
              </div>

              {/* Riwayat */}
              {testHistory.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="mb-2 text-xs font-medium text-gray-400">Riwayat:</p>
                  {testHistory.map((h, i) => (
                    <div key={i} className="flex items-center justify-between py-1 text-xs text-gray-600">
                      <span className={h.sent ? 'text-teal-600' : 'text-purple-600'}>
                        {h.sent ? '→' : '🔗'} {h.text}
                      </span>
                      <span className="text-gray-400">{h.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Panel Game */}
          <div className="p-6 bg-white border border-gray-100 rounded-lg shadow-sm">
            <h2 className="mb-4 text-lg font-bold">🎮 Pilihan Game Active</h2>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {allGames.map(game => (
                <label key={game.id} className="flex items-center gap-3 p-2.5 transition-colors border rounded cursor-pointer hover:bg-blue-50">
                  <input type="radio" name="game" checked={activeGame === game.id} onChange={() => setActiveGame(game.id)} className="w-4 h-4 text-blue-600" />
                  <span className="text-sm">{game.label}</span>
                </label>
              ))}
            </div>

            {activeGame === 'game-random' && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="mb-2 text-sm font-medium text-gray-600">Pilih game yang akan diacak:</p>
                <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto pr-1">
                  {allGames.filter(g => g.id !== 'game-random').map(game => (
                    <label key={game.id} className="flex items-center gap-2 p-2 text-xs border rounded cursor-pointer hover:bg-purple-50">
                      <input type="checkbox" checked={randomGames.includes(game.id)} onChange={() => toggleRandomGame(game.id)} className="w-3.5 h-3.5 text-purple-600 rounded" />
                      <span>{game.label.replace(/^[^\s]+\s/, '')}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-400">Minimal 1 game harus terpilih.</p>
              </div>
            )}

            <button onClick={saveSettings} className="w-full py-2 mt-4 text-blue-700 bg-blue-100 rounded hover:bg-blue-200">
              Simpan & Ganti Layar
            </button>
          </div>
        </div>

        {/* Link OBS */}
        <div className="p-6 mt-6 text-white bg-gray-800 rounded-lg">
          <h2 className="mb-2 font-bold">🔗 Link OBS Browser Source</h2>
          <div className="flex items-center gap-3">
            <code className="flex-1 p-3 text-green-400 bg-gray-900 rounded select-all text-sm overflow-x-auto">
              https://live.albiontools.fun/overlay/{user.username}
            </code>
            <a href={'/overlay/' + user.username} target="_blank" rel="noopener noreferrer" className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 whitespace-nowrap">
              Buka di Tab Baru
            </a>
          </div>
          <p className="mt-2 text-sm text-gray-400">Buka overlay di tab baru, lalu test koneksi streamer di panel 🧪 Test & Cek Live.</p>
        </div>
      </main>
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
