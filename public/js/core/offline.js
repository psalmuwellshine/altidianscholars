/* Saving study material on this phone so it opens with no data or network.
   The list lives in localStorage; the files live in Cache Storage (the service worker serves them when the network is down). */
const KEY = 'alt-offline-v1';
export const CACHE = 'altidian-offline-v1';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; } };

export const list = () => Object.values(read()).sort((a, b) => b.savedAt - a.savedAt);
export const isSaved = (id) => !!read()[id];
// Paid files are view-only and never leave the server; links need the internet anyway.
export const canSave = (m) => !!m && !m.paid && !m.locked && !!(m.fileId || m.note);

export async function save(m) {
  if (!canSave(m)) throw new Error('This item cannot be saved for offline reading.');
  if (m.fileId) {
    if (!('caches' in window)) throw new Error('This browser cannot save files for offline use.');
    let res;
    try { res = await fetch('/files/' + m.fileId, { credentials: 'same-origin' }); } catch (e) { throw new Error('Could not download it. Check your connection and try again.'); }
    if (!res.ok) throw new Error('Could not download that file.');
    const c = await caches.open(CACHE);
    await c.put('/files/' + m.fileId, res);
  }
  const all = read();
  all[m.id] = { id: m.id, title: m.title, course: m.course, kind: m.kind, note: m.note || '', link: m.link || '', fileId: m.fileId || '', fileName: m.fileName || '', savedAt: Date.now() };
  if (!write(all)) throw new Error('Your phone has no room left to save this.');
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
}
export async function remove(id) {
  const all = read(); const m = all[id]; delete all[id]; write(all);
  if (m && m.fileId && 'caches' in window) { try { await (await caches.open(CACHE)).delete('/files/' + m.fileId); } catch (e) { /* ignore */ } }
}

/* A copy of the last page data, so the app still opens with no connection. */
const SNAP = 'alt-state-v1';
export const saveSnapshot = (state) => { try { localStorage.setItem(SNAP, JSON.stringify(state)); } catch (e) { /* too big or blocked */ } };
export const loadSnapshot = () => { try { return JSON.parse(localStorage.getItem(SNAP) || 'null'); } catch (e) { return null; } };
