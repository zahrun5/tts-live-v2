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

// ---- Papan hasil ronde: tampil sebentar sebelum ganti ronde/game ----
// Server emit 'round:summary' ({ top, answers, total, durationMs }) lalu menunggu
// sebelum ganti ronde. Semua teks dipasang lewat textContent (nama dari TikTok = input asing).
(function () {
  var MEDALS = ['🥇', '🥈', '🥉'];
  var hideTimer = null;

  function injectStyle() {
    if (document.getElementById('round-summary-style')) return;
    var st = document.createElement('style');
    st.id = 'round-summary-style';
    st.textContent =
      '#roundSummary{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(8,5,20,.72);pointer-events:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;' +
      'animation:rsFade .35s ease both}' +
      '#roundSummary .rs-card{width:min(92vw,520px);max-height:92vh;overflow:hidden;box-sizing:border-box;padding:1.1rem 1.2rem 1.3rem;' +
      'border-radius:22px;color:#f8fafc;background:linear-gradient(160deg,rgba(76,29,149,.96),rgba(15,10,30,.97));' +
      'border:1px solid rgba(251,191,36,.45);box-shadow:0 18px 60px rgba(0,0,0,.55);animation:rsPop .45s cubic-bezier(.2,1.3,.4,1) both}' +
      '#roundSummary .rs-title{text-align:center;font-size:1.35rem;font-weight:900;letter-spacing:.5px;margin-bottom:.7rem}' +
      '#roundSummary .rs-label{font-size:.68rem;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#c4b5fd;margin:.8rem 0 .35rem}' +
      '#roundSummary .rs-row{display:flex;align-items:center;gap:.55rem;padding:.4rem .6rem;border-radius:12px;background:rgba(255,255,255,.07);margin-bottom:.3rem}' +
      '#roundSummary .rs-row.first{background:linear-gradient(90deg,rgba(251,191,36,.28),rgba(255,255,255,.07));border:1px solid rgba(251,191,36,.5)}' +
      '#roundSummary .rs-medal{font-size:1.4rem;width:1.8rem;text-align:center;flex:none}' +
      '#roundSummary .rs-emoji{font-size:1.3rem;flex:none}' +
      '#roundSummary .rs-name{flex:1;min-width:0;font-weight:800;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#roundSummary .rs-pts{flex:none;font-weight:900;color:#fbbf24;font-size:1rem}' +
      '#roundSummary .rs-empty{text-align:center;color:#c4b5fd;font-size:.95rem;padding:.4rem 0}' +
      '#roundSummary .rs-ans{display:flex;align-items:center;gap:.4rem;font-size:.82rem;padding:.12rem .2rem;color:#e2e8f0}' +
      '#roundSummary .rs-ans b{color:#fff;white-space:nowrap;max-width:45%;overflow:hidden;text-overflow:ellipsis}' +
      '#roundSummary .rs-ans span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#cbd5e1}' +
      '#roundSummary .rs-ans i{font-style:normal;color:#fbbf24;font-weight:800;flex:none}' +
      '#roundSummary .rs-tot{display:flex;flex-wrap:wrap;gap:.3rem}' +
      '#roundSummary .rs-chip{font-size:.78rem;padding:.2rem .55rem;border-radius:50px;background:rgba(255,255,255,.1);white-space:nowrap}' +
      '#roundSummary .rs-chip em{font-style:normal;color:#fbbf24;font-weight:800;margin-left:.25rem}' +
      '#roundSummary .rs-bar{height:5px;border-radius:5px;background:rgba(255,255,255,.14);margin-top:1rem;overflow:hidden}' +
      '#roundSummary .rs-bar div{height:100%;width:100%;background:linear-gradient(90deg,#fbbf24,#f472b6);transform-origin:left;animation:rsBar linear forwards}' +
      '#roundSummary .rs-next{text-align:center;font-size:.72rem;color:#a5b4fc;margin-top:.35rem}' +
      '@keyframes rsFade{from{opacity:0}to{opacity:1}}' +
      '@keyframes rsPop{from{transform:scale(.85) translateY(20px);opacity:0}to{transform:none;opacity:1}}' +
      '@keyframes rsBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}' +
      '@media (max-height:520px){#roundSummary .rs-card{padding:.7rem .9rem}#roundSummary .rs-title{font-size:1.05rem;margin-bottom:.4rem}}';
    (document.head || document.documentElement).appendChild(st);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function hide() {
    clearTimeout(hideTimer);
    var old = document.getElementById('roundSummary');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function show(d) {
    if (!d) return;
    injectStyle();
    hide();

    var root = el('div');
    root.id = 'roundSummary';
    var card = el('div', 'rs-card');
    card.appendChild(el('div', 'rs-title', '🏁 Ronde Selesai!'));

    card.appendChild(el('div', 'rs-label', 'Juara ronde ini'));
    var top = d.top || [];
    if (top.length === 0) {
      card.appendChild(el('div', 'rs-empty', 'Belum ada yang mencetak poin ronde ini'));
    } else {
      top.forEach(function (r, i) {
        var row = el('div', 'rs-row' + (i === 0 ? ' first' : ''));
        row.appendChild(el('span', 'rs-medal', MEDALS[i] || String(i + 1)));
        if (r.emoji) row.appendChild(el('span', 'rs-emoji', r.emoji));
        row.appendChild(el('span', 'rs-name', r.player));
        row.appendChild(el('span', 'rs-pts', '+' + r.points));
        card.appendChild(row);
      });
    }

    var answers = d.answers || [];
    if (answers.length > 0) {
      card.appendChild(el('div', 'rs-label', 'Yang berhasil menjawab'));
      answers.forEach(function (a) {
        var line = el('div', 'rs-ans');
        line.appendChild(el('b', null, a.player));
        line.appendChild(el('span', null, a.text));
        line.appendChild(el('i', null, '+' + a.points));
        card.appendChild(line);
      });
    }

    var total = d.total || [];
    if (total.length > 0) {
      card.appendChild(el('div', 'rs-label', 'Skor total (pemain aktif)'));
      var wrap = el('div', 'rs-tot');
      total.forEach(function (t, i) {
        var chip = el('div', 'rs-chip', (i + 1) + '. ' + t.player);
        chip.appendChild(el('em', null, String(t.score)));
        wrap.appendChild(chip);
      });
      card.appendChild(wrap);
    }

    var ms = Math.max(1000, Number(d.durationMs) || 7000);
    var bar = el('div', 'rs-bar');
    var fill = el('div');
    fill.style.animationDuration = ms + 'ms';
    bar.appendChild(fill);
    card.appendChild(bar);
    card.appendChild(el('div', 'rs-next', 'Lanjut ke ronde berikutnya...'));

    root.appendChild(card);
    (document.body || document.documentElement).appendChild(root);
    hideTimer = setTimeout(hide, ms + 400);
  }

  function start() {
    if (typeof socket === 'undefined' || !socket || typeof socket.on !== 'function') return;
    socket.on('round:summary', show);
    socket.on('puzzle:new', hide);
    socket.on('game:switched', hide);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

