// Logs a student out after being offline for more than 15 minutes.
// While offline the saved notes and timetable still open; the clock starts when the connection is lost.
const KEY = 'alt-off-since';
export const LIMIT = 15 * 60 * 1000;
const get = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { return 0; } };
export const markOffline = () => { if (!get()) { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* blocked */ } } };
export const markOnline = () => { try { localStorage.removeItem(KEY); } catch (e) { /* blocked */ } };
export const expired = () => { const s = get(); return !!s && Date.now() - s >= LIMIT; };
export const offlineFor = () => { const s = get(); return s ? Date.now() - s : 0; };
