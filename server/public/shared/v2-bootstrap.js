// v2-bootstrap.js
// Dipasang di SEMUA halaman game, SETELAH `const socket = io()` dan SEBELUM
// game-switch-watcher.js. Tugasnya: masukin overlay ini ke room milik user
// (TTS_LIVE_V2_CONFIG di-inject server di /overlay/:username).
//
// PENTING: join-overlay dikirim di event 'connect' (bukan sekali doang),
// karena room Socket.IO HILANG tiap kali koneksi putus/reconnect. Kalau cuma
// dikirim sekali, overlay OBS jadi mati permanen abis server restart.
(function () {
  if (typeof socket === 'undefined' || !socket || typeof socket.on !== 'function') {
    console.warn('v2-bootstrap: variabel `socket` belum ada.');
    return;
  }
  var cfg = window.TTS_LIVE_V2_CONFIG;
  if (!cfg || !cfg.username) {
    console.warn('v2-bootstrap: TTS_LIVE_V2_CONFIG kosong (buka lewat /overlay/<username>).');
    return;
  }
  function join() { socket.emit('join-overlay', cfg.username); }
  socket.on('connect', join);
  if (socket.connected) join();
  socket.on('force-reload', function () { window.location.reload(); });
})();
