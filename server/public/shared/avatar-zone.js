/* shared/avatar-zone.js
 * Tata letak avatar yang SAMA untuk semua game (menggantikan jalan acak per game).
 *
 * Masalah lama: tiap game menaruh avatar di posisi `left` acak dan menggesernya
 * dengan timer sendiri, jadi avatar (apalagi >6 orang) saling tumpuk dan
 * nama/poinnya jadi tidak terbaca.
 *
 * Cara kerja: script ini TIDAK mengubah kode game. Game tetap membuat elemen
 * `.mini-avatar` di `#avatarZone`; di sini kita
 *   1. membagi avatar ke slot grid tetap (maks 2 baris), tidak mungkin tumpang tindih,
 *   2. mematikan posisi acak milik game lewat CSS `!important` (aturan stylesheet
 *      !important mengalahkan `el.style.left = ...` dari game),
 *   3. kalau penonton lebih banyak dari slot, yang paling lama diam disembunyikan
 *      dan yang baru komen/masuk dapat slot.
 *
 * Pasang SETELAH script game: <script src="/shared/avatar-zone.js"></script>
 */
(function () {
  'use strict';
  if (window.__avatarZoneInit) return;
  window.__avatarZoneInit = true;

  var SLOT_MIN = 64;   // lebar minimum satu slot (px) -> menentukan jumlah kolom
  var SLOT_MAX = 84;   // lebar maksimum satu slot kalau avatar sedikit
  var ROW_H = 88;      // tinggi satu baris: nama + foto + poin
  var MAX_ROWS = 2;
  var PAD_BOTTOM = 4;
  var PIN_TOP = 3;     // juara skor yang selalu tampil

  function injectStyle() {
    if (document.getElementById('avatar-zone-css')) return;
    var st = document.createElement('style');
    st.id = 'avatar-zone-css';
    st.textContent =
      '#avatarZone{overflow:visible}' +
      '#avatarZone .mini-avatar{' +
        'left:var(--ax,0px)!important;bottom:var(--ay,' + PAD_BOTTOM + 'px)!important;' +
        'width:var(--aw,' + SLOT_MIN + 'px);' +
        'transition:left .6s ease,bottom .6s ease!important}' +
      '#avatarZone .mini-avatar.az-hidden{display:none!important}' +
      /* arah hadap tidak lagi relevan karena avatar tidak berjalan */
      '#avatarZone .mini-avatar.facing-right .emoji{transform:none!important}' +
      '#avatarZone .mini-avatar .name-tag{max-width:calc(var(--aw,' + SLOT_MIN + 'px) - 6px)!important;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box}' +
      '#avatarZone .mini-avatar .av-score{max-width:100%;overflow:hidden;text-overflow:clip}' +
      '#avatarZone .mini-avatar .comment-bubble{z-index:6}';
    (document.head || document.documentElement).appendChild(st);
  }

  var zone = null;
  var seq = 0;                 // urutan masuk, biar posisi stabil
  var meta = new WeakMap();    // el -> { seq, active }
  var raf = 0;
  var lastRows = 0;

  function info(el) {
    var m = meta.get(el);
    if (!m) { m = { seq: ++seq, active: Date.now() }; meta.set(el, m); }
    return m;
  }

  // Poin diisi v2-bootstrap.js ke elemen `.av-score` ("586 poin").
  function scoreOf(el) {
    var s = el.querySelector('.av-score');
    return s ? (parseInt(s.textContent, 10) || 0) : 0;
  }

  function layout() {
    raf = 0;
    if (!zone) return;
    var W = zone.clientWidth;
    if (!W) return;

    var all = [];
    for (var i = 0; i < zone.children.length; i++) {
      var c = zone.children[i];
      if (c.classList && c.classList.contains('mini-avatar')) all.push(c);
    }

    var perRow = Math.max(1, Math.floor(W / SLOT_MIN));
    var slotW = Math.min(SLOT_MAX, W / perRow);
    var cap = perRow * MAX_ROWS;

    // Yang tampil = 3 skor tertinggi (selalu, biar juara tidak hilang) + sisanya
    // yang paling baru aktif (masuk / komen), total maksimal `cap`.
    var pinned = all.filter(function (el) { return scoreOf(el) > 0; })
      .sort(function (a, b) { return scoreOf(b) - scoreOf(a); })
      .slice(0, Math.min(PIN_TOP, cap));
    var pinnedSet = new Set(pinned);
    var byActive = all.filter(function (el) { return !pinnedSet.has(el); })
      .sort(function (a, b) { return info(b).active - info(a).active; });
    var shown = pinned.concat(byActive.slice(0, cap - pinned.length));
    var shownSet = new Set(shown);
    all.forEach(function (el) { el.classList.toggle('az-hidden', !shownSet.has(el)); });

    // Urutan slot: berdasarkan urutan masuk (stabil), bukan urutan aktivitas.
    shown.sort(function (a, b) { return info(a).seq - info(b).seq; });

    var rows = Math.max(1, Math.ceil(shown.length / perRow));
    shown.forEach(function (el, idx) {
      var row = Math.floor(idx / perRow);
      var col = idx % perRow;
      var inRow = Math.min(perRow, shown.length - row * perRow);
      var x = (W - inRow * slotW) / 2 + col * slotW;
      el.style.setProperty('--ax', x.toFixed(1) + 'px');
      el.style.setProperty('--ay', (PAD_BOTTOM + row * ROW_H) + 'px');
      el.style.setProperty('--aw', slotW.toFixed(1) + 'px');
    });

    if (rows !== lastRows) {
      lastRows = rows;
      var h = Math.max(96, rows * ROW_H + PAD_BOTTOM + 6);
      zone.style.setProperty('height', h + 'px', 'important');
      zone.style.setProperty('min-height', h + 'px', 'important');
      zone.style.setProperty('flex', '0 0 ' + h + 'px', 'important');
    }
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(layout); }

  function onMutations(muts) {
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.classList.contains('mini-avatar')) {
          var mm = info(n); mm.active = Date.now();
        } else if (n.classList.contains('comment-bubble')) {
          var p = n.closest && n.closest('.mini-avatar');
          if (p) info(p).active = Date.now();   // komen = aktif lagi
        }
      });
    });
    schedule();
  }

  function start() {
    zone = document.getElementById('avatarZone');
    if (!zone) return;
    injectStyle();
    new MutationObserver(onMutations).observe(zone, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
