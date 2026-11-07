/* Opening screen: shows the full Altidian logo for a moment while the app loads. */
(function () {
  var el = document.getElementById('splash'); if (!el) return;
  var t0 = Date.now(), gone = false;
  function hide() { if (gone) return; gone = true; el.classList.add('out'); setTimeout(function () { el.remove(); }, 450); }
  function ready() { setTimeout(hide, Math.max(0, 1200 - (Date.now() - t0))); }
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
  setTimeout(hide, 4000); // never hold the app back
})();
