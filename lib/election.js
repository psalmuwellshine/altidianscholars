'use strict';
/* Student elections (NIMELSSA): who may see the campaign pages, and how candidates are listed.
   Everything is controlled by admins; candidates are shown only to students of the chosen department. */

const POSITIONS = ['President', 'Vice President', 'General Secretary', 'Assistant General Secretary', 'Financial Secretary', 'Treasurer', 'Director of Socials', 'Director of Sports', 'Director of Welfare', 'Director of Information', 'Public Relations Officer', 'Librarian'];
const DEFAULTS = { id: 'election', on: false, title: 'NIMELSSA Elections', departmentId: '', votingDate: '', note: '' };

async function loadCfg(store) { return Object.assign({}, DEFAULTS, (await store.get('settings', 'election')) || {}); }
const visibleTo = (cfg, user) => !!(cfg.on && cfg.departmentId && user && user.departmentId === cfg.departmentId);

const rank = (p) => { const i = POSITIONS.findIndex((x) => x.toLowerCase() === String(p).toLowerCase()); return i < 0 ? 999 : i; };
/* Same layout for everyone; names inside a post are alphabetical so nobody is placed first on purpose. */
function groupByPost(list) {
  const posts = new Map();
  list.forEach((c) => { const k = c.position; if (!posts.has(k)) posts.set(k, []); posts.get(k).push(c); });
  return [...posts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([position, cs]) => ({ position, candidates: cs.sort((a, b) => a.name.localeCompare(b.name)).map(pub) }));
}
const pub = (c) => ({ id: c.id, name: c.name, position: c.position, level: c.level || 0, slogan: c.slogan || '', manifesto: c.manifesto || '', promises: c.promises || [], link: c.link || '', photo: c.photoId || '' });

/* The small summary that rides along with /api/state so the home page knows whether to show the card. */
async function summary(store, user) {
  const cfg = await loadCfg(store);
  if (!visibleTo(cfg, user)) return null;
  const n = (await store.list('candidates')).length;
  return n ? { title: cfg.title, votingDate: cfg.votingDate || '', count: n } : null;
}
module.exports = { POSITIONS, loadCfg, visibleTo, groupByPost, pub, summary };
