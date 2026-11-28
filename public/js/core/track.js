/* Tells the server that a resource was opened, so the admin's Analytics shows real numbers.
   Once per resource per day on this phone (the server also keeps its own once-a-day check). Never blocks or shows an error. */
const day = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
const KEY = 'alt-trk';
function seen() { try { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); return d.day === day() ? d : { day: day(), ids: [] }; } catch (e) { return { day: day(), ids: [] }; } }
export function track(id, locked) {
  if (!id || !/^[a-zA-Z0-9_-]{4,40}$/.test(id)) return;
  const tag = id + (locked ? ':l' : '');
  const d = seen(); if (d.ids.includes(tag)) return;
  d.ids.push(tag); try { localStorage.setItem(KEY, JSON.stringify({ day: d.day, ids: d.ids.slice(-400) })); } catch (e) { /* private mode: the server still dedupes */ }
  let device = ''; try { device = localStorage.getItem('ew-device') || ''; } catch (e) { /* fine */ }
  try { fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, locked: !!locked, device }), keepalive: true, credentials: 'same-origin' }).catch(() => {}); } catch (e) { /* fine */ }
}
// One listener for every place a resource can be opened: the viewer, video, notes, links, and a tap on a locked item.
export function watchOpens() {
  document.addEventListener('click', (ev) => {
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-action],[data-track]') : null; if (!t) return;
    const a = t.dataset.action; const id = t.dataset.track || t.dataset.id; if (!id) return;
    if (t.dataset.track || a === 'view-file' || a === 'play-video' || a === 'read') track(id);
    else if (a === 'unlock' && !t.dataset.pack) track(id, true);
  }, true);
}
