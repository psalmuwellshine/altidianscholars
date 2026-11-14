'use strict';
/* Packs the student app and the admin panel into a few small, minified files (public/js/dist) and points the two HTML pages at them.
   Run it after changing anything under public/js:  node scripts/build.js
   It needs esbuild (npm i -D esbuild, or set ESBUILD to a path). The built files are committed, so Render does not need to run it. */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const esbuild = require(process.env.ESBUILD || 'esbuild');
const root = path.join(__dirname, '..'); const pub = path.join(root, 'public'); const dist = path.join(pub, 'js', 'dist');
fs.rmSync(dist, { recursive: true, force: true });
esbuild.buildSync({
  entryPoints: { app: path.join(pub, 'js/app.js'), admin: path.join(pub, 'js/admin/admin.js') },
  bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'none',
  outdir: dist, entryNames: '[name]', chunkNames: 'chunk-[hash]',
});
const sha = (files) => { const h = crypto.createHash('sha1'); files.sort().forEach((f) => h.update(fs.readFileSync(f))); return h.digest('hex').slice(0, 10); };
const jsV = sha(fs.readdirSync(dist).map((f) => path.join(dist, f)));
const cssV = sha(['app.css', 'admin.css'].map((f) => path.join(pub, 'css', f)));
const page = (file, js) => {
  const p = path.join(pub, file); let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/(<script type="module" src=")[^"]+(")/, '$1/js/dist/' + js + '?v=' + jsV + '$2');
  s = s.replace(/(href="\/css\/(app|admin)\.css)(\?v=[^"]*)?"/g, '$1?v=' + cssV + '"');
  fs.writeFileSync(p, s);
};
page('index.html', 'app.js'); page('admin.html', 'admin.js');
const sw = path.join(pub, 'sw.js'); let t = fs.readFileSync(sw, 'utf8');
fs.writeFileSync(sw, t); // (the service worker finds its files by itself as they load)
console.log('built: js v=' + jsV + ', css v=' + cssV, fs.readdirSync(dist).map((f) => f + ' ' + Math.round(fs.statSync(path.join(dist, f)).size / 1024) + 'KB').join(', '));
