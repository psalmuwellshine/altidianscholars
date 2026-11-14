/* Loads the Altidian fonts without holding up the first screen. Text shows in a normal font at once, then switches when the fonts arrive. */
(function () {
  var l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&display=swap';
  document.head.appendChild(l);
})();
