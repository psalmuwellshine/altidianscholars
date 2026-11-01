/* The notifications card on the profile page. */
import { html, raw, icon, toast } from '../core/ui.js';
import * as P from '../core/push.js';

export const section = () => html`<section class="sec" id="notify"><div class="sec-head"><div><h2>Notifications</h2><p>Get an alert on your phone for new materials, exam reminders and announcements.</p></div></div><div class="card" id="notify-card" style="max-width:640px"><p class="muted small">Checking…</p></div></section>`;

const PREFS = [['notices', 'Announcements and class updates'], ['materials', 'New materials and quizzes'], ['events', 'Events, timetable and exam reminders']];
export async function hydrate() {
  const el = document.getElementById('notify-card'); if (!el) return;
  let s; try { s = await P.status(); } catch (e) { s = { supported: false }; }
  let out;
  if (!s.supported) {
    out = s.iosNeedsInstall
      ? html`<p>On iPhone, first add Altidian to your Home Screen: tap the Share button, then <b>Add to Home Screen</b>. Open Altidian from there and come back to this page to switch notifications on.</p>`
      : html`<p class="muted">This browser cannot show notifications. Try Chrome on Android, or install Altidian on your phone.</p>`;
  } else if (s.permission === 'denied') {
    out = html`<p>Notifications are blocked for Altidian on this phone. Open your browser's site settings, allow notifications, then reload this page.</p>`;
  } else if (!s.on) {
    out = html`<p style="margin-bottom:12px">Notifications are <b>off</b> on this phone.</p><button class="btn primary" data-action="push-on" type="button">${icon('bell', 17)} Turn on notifications</button>`;
  } else {
    const p = s.prefs || {};
    out = html`<p style="margin-bottom:10px"><span class="chip good">${icon('check', 13)} On for this phone</span></p>
      ${PREFS.map(([k, l]) => html`<label class="check small" style="display:flex;margin-bottom:8px"><input type="checkbox" data-change="push-pref" name="${k}" ${p[k] === false ? '' : raw('checked')}> ${l}</label>`)}
      <button class="btn ghost small" data-action="push-off" type="button" style="margin-top:6px">Turn off on this phone</button>`;
  }
  el.innerHTML = out.s;
}
/* A one-tap card on the home page for students who have not decided yet. Browsers only allow the permission prompt after a tap. */
const LATER = 'alt-push-later';
export async function nudge() {
  const el = document.getElementById('push-nudge'); if (!el) return;
  try {
    const s = await P.status(); if (!s.supported || s.permission !== 'default' || s.on) return;
    if (Date.now() - Number(localStorage.getItem(LATER) || 0) < 7 * 86400000) return;
    el.innerHTML = html`<div class="card nudge"><span class="ico-box">${icon('bell', 22)}</span><div class="grow"><b>Never miss an exam or a new note</b><p class="small muted">Turn on notifications for reminders, new materials and class updates.</p></div>
      <div class="row gap-s wrap-r"><button class="btn primary small" data-action="push-nudge-on" type="button">Turn on</button><button class="btn ghost small" data-action="push-nudge-later" type="button">Later</button></div></div>`.s;
  } catch (e) { /* the card is optional */ }
}
export const actions = {
  async 'push-nudge-on'(el) {
    el.disabled = true;
    try { await P.enable(); toast('Notifications are on.'); } catch (e) { toast(e.message, 'bad'); }
    document.getElementById('push-nudge').innerHTML = '';
  },
  'push-nudge-later'() { try { localStorage.setItem(LATER, String(Date.now())); } catch (e) { /* ignore */ } document.getElementById('push-nudge').innerHTML = ''; },
  async 'push-on'(el) {
    el.disabled = true;
    try { await P.enable(); toast('Notifications are on.'); } catch (e) { toast(e.message, 'bad'); }
    hydrate();
  },
  async 'push-off'() { try { await P.disable(); toast('Notifications are off on this phone.'); } catch (e) { toast(e.message, 'bad'); } hydrate(); },
  async 'push-pref'(el) {
    const prefs = {}; el.closest('#notify-card').querySelectorAll('input[type=checkbox]').forEach((c) => { prefs[c.name] = c.checked; });
    try { await P.setPrefs(prefs); } catch (e) { toast(e.message, 'bad'); }
  },
};
