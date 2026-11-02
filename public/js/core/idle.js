// Logs a person out after 20 minutes without any activity, online or offline.
// Activity means a tap, click, key press, scroll or swipe. The time is kept in localStorage so every open tab
// shares one clock, and so a phone that was closed for hours is logged out the next time the app is opened.
const KEY = 'alt-last-active';
export const LIMIT = 20 * 60 * 1000;
export const WARN = 19 * 60 * 1000;
let last = 0, blocked = false;
// The shared clock in localStorage is the truth; the in-memory copy is used only when storage is blocked.
const read = () => { if (blocked) return last; try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { blocked = true; return last; } };
// force: a fresh login always starts a new clock.
export function touch(force) {
  const now = Date.now();
  if (!force && now - last < 5000) return;
  last = now;
  try { localStorage.setItem(KEY, String(now)); } catch (e) { blocked = true; }
}
export const idleFor = () => { const t = read(); return t ? Date.now() - t : 0; };
export const expired = () => idleFor() >= LIMIT;
export const warning = () => { const n = idleFor(); return n >= WARN && n < LIMIT; };
// Starts the clock when there is none yet (for example the first visit after this update).
export const ensure = () => { if (!read()) touch(true); };
export const forget = () => { last = 0; try { localStorage.removeItem(KEY); } catch (e) { blocked = true; } };

// Reading a quiz question or watching a video is activity even when nothing is tapped.
const busy = () => /^#\/quiz\//.test(location.hash) || !!document.querySelector('iframe[src*="youtube"], iframe[src*="youtu.be"], video');
export function watch(onTick) {
  ['pointerdown', 'keydown', 'touchstart', 'touchmove', 'wheel', 'scroll', 'input'].forEach((e) => window.addEventListener(e, () => touch(false), { passive: true, capture: true }));
  const tick = () => { if (!document.hidden && busy()) touch(false); onTick(); };
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onTick(); });
  window.addEventListener('focus', onTick);
}
