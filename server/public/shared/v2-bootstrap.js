// v2-bootstrap.js
// Dipasang di SEMUA halaman game, SETELAH `const socket = io()` dan SEBELUM
// game-switch-watcher.js. Tugasnya: masukin overlay ini ke room milik user
// (TTS_LIVE_V2_CONFIG di-inject server di /overlay/:username).
//
// PENTING: join-overlay dikirim di event 'connect' (bukan sekali doang),
// karena room Socket.IO HILANG tiap kali koneksi putus/reconnect. Kalau cuma
// dikirim sekali, overlay OBS jadi mati permanen abis server restart.

// ---- Fix tampilan portrait/HP: panel Top Skor jangan nutupin soal ----
// Di layar sempit/portrait, panel dipindah jadi strip kecil di bawah (top 3 aja).
(function () {
  try {
    var s = document.createElement('style');
    s.id = 'lb-compact-fix';
    s.textContent =
      /* Semua layar: panel kecil, transparan, nggak bisa diklik */
      '#leaderboard{opacity:.55 !important;pointer-events:none !important;' +
      'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;' +
      'background:rgba(15,10,30,.35) !important;box-shadow:none !important;' +
      'padding:.35rem .5rem !important;border-radius:10px !important;' +
      'min-width:0 !important;max-width:150px !important;width:max-content !important;animation:none !important}' +
      '#leaderboard .label{font-size:.6rem !important;margin-bottom:.2rem !important}' +
      '#lbList{gap:.15rem !important}' +
      '#lbList .lb-row{padding:.1rem .3rem !important;gap:.3rem !important;transform:none !important;background:transparent !important}' +
      '#lbList .lb-row:nth-child(n+6){display:none !important}' +
      '#lbList .lb-rank{font-size:.6rem !important;width:14px !important}' +
      '#lbList .lb-name{font-size:.6rem !important;max-width:80px !important}' +
      '#lbList .lb-score{font-size:.6rem !important}' +
      /* HP / portrait: jadi strip tipis di bawah, top 3 aja */
      '@media (max-width:760px), (orientation:portrait){' +
      '#app{padding-bottom:56px !important;box-sizing:border-box}' +
      '#leaderboard{top:auto !important;bottom:6px !important;left:6px !important;right:6px !important;' +
      'max-width:none !important;width:auto !important}' +
      '#leaderboard .label{display:none !important}' +
      '#lbList{flex-direction:row !important;flex-wrap:nowrap !important;gap:.3rem !important;overflow:hidden}' +
      '#lbList .lb-row{flex:1 1 0 !important;min-width:0 !important}' +
      '#lbList .lb-row:nth-child(n+4){display:none !important}' +
      '#lbList .lb-name{max-width:none !important}' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { console.warn('lb-compact-fix gagal', e); }
})();

// ---- Avatar: foto/emoji lebih besar + poin pemain di bawah avatar ----
(function () {
  try {
    var st = document.createElement('style');
    st.id = 'avatar-score-fix';
    st.textContent =
      '#avatarZone{height:clamp(120px,17vh,170px) !important}' +
      '.mini-avatar img{width:46px !important;height:46px !important;border-width:2px !important;margin-right:0 !important;display:block !important}' +
      '.mini-avatar .emoji{font-size:40px !important}' +
      '.mini-avatar .name-tag{font-size:.7rem !important;max-width:96px !important}' +
      '.mini-avatar .av-score{order:5;margin-top:2px;font-weight:800;font-size:.7rem;line-height:1;color:#fbbf24;' +
      'background:rgba(15,10,30,.55);padding:.12rem .45rem;border-radius:50px;white-space:nowrap}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) { console.warn('avatar-score-fix gagal', e); }

  var scores = {};
  function paint(el) {
    var tag = el.querySelector('.name-tag');
    if (!tag) return;
    var name = tag.textContent;
    var b = el.querySelector('.av-score');
    if (!b) { b = document.createElement('span'); b.className = 'av-score'; el.appendChild(b); }
    b.textContent = (scores[name] || 0) + ' poin';
  }
  function paintAll() {
    var list = document.querySelectorAll('.mini-avatar');
    for (var i = 0; i < list.length; i++) paint(list[i]);
  }
  function start() {
    if (typeof socket === 'undefined' || !socket || typeof socket.on !== 'function') return;
    socket.on('scores:update', function (m) { scores = m || {}; paintAll(); });
    // cadangan: kalau server belum di-update, minimal top 10 tetap ada skornya
    socket.on('leaderboard:update', function (list) {
      (list || []).forEach(function (r) { scores[r.player] = r.score; });
      paintAll();
    });
    var zone = document.getElementById('avatarZone');
    if (zone) {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType === 1 && n.classList.contains('mini-avatar')) paint(n);
          });
        });
      }).observe(zone, { childList: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

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
