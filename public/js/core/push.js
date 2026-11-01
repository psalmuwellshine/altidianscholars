/* Push notifications from the browser side. */
import { api } from './ui.js';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

const keyBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const ready = () => navigator.serviceWorker.ready;

export async function status() {
  if (!supported()) return { supported: false, iosNeedsInstall: isIos() && !standalone() };
  const permission = Notification.permission;
  const sub = await (await ready()).pushManager.getSubscription();
  let on = false; let prefs = null;
  if (sub && permission === 'granted') {
    try { const r = await api('POST', '/api/push/check', { endpoint: sub.endpoint }); on = r.on; prefs = r.prefs; } catch (e) { on = true; }
  }
  return { supported: true, permission, on, prefs };
}
export async function enable(prefs) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.' : 'Notifications were not turned on.');
  const { key } = await api('GET', '/api/push/key');
  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }); } catch (e) { throw new Error('This browser could not turn on notifications.'); }
  }
  await api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), prefs });
}
export async function disable() {
  const sub = await (await ready()).pushManager.getSubscription();
  if (!sub) return;
  try { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch (e) { /* still switch it off here */ }
  await sub.unsubscribe();
}
export async function setPrefs(prefs) {
  const sub = await (await ready()).pushManager.getSubscription();
  if (sub) await api('POST', '/api/push/prefs', { endpoint: sub.endpoint, prefs });
}
// If this phone is subscribed, make sure the signed-in student owns that subscription.
export async function sync() {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const sub = await (await ready()).pushManager.getSubscription(); if (!sub) return;
    const r = await api('POST', '/api/push/check', { endpoint: sub.endpoint });
    if (!r.on) await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  } catch (e) { /* try again next visit */ }
}
