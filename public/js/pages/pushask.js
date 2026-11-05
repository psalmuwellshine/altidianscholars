/* Every time a student logs in without notifications, explain why they help and offer to turn them on. */
import { html, icon, dialog, toast } from '../core/ui.js';
import * as P from '../core/push.js';

const KEY = 'alt-push-asked'; // cleared on login, register and logout, so it shows once per login
const asked = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const mark = () => { try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ } };
let box = null;

const REASONS = html`<ul class="pa-list">
  <li>${icon('calendar', 18)}<span><b>Exam and timetable changes</b>Reach your phone the moment your class rep posts them.</span></li>
  <li>${icon('book', 18)}<span><b>New notes, past questions and quizzes</b>Know as soon as they are added.</span></li>
  <li>${icon('star', 18)}<span><b>Question of the day</b>Keep your streak without having to remember.</span></li>
  <li>${icon('chat', 18)}<span><b>Messages from classmates</b>See replies and private messages straight away.</span></li>
</ul>`;

function show(s) {
  let body;
  if (!s.supported) {
    body = html`<p class="muted">On iPhone, notifications only work after you add Altidian to your Home Screen.</p>
      <ol class="pa-steps"><li>Open Altidian in <b>Safari</b>.</li><li>Tap <b>Share</b>, then <b>Add to Home Screen</b>.</li><li>Open Altidian from your Home Screen and turn notifications on.</li></ol>
      <div class="row end gap-s" style="margin-top:14px"><button class="btn primary" data-close type="button">Got it</button></div>`;
  } else if (s.permission === 'denied') {
    body = html`<p class="muted">Notifications are blocked for Altidian on this phone, so you will miss these:</p>${REASONS}
      <p class="small">To fix it, open your browser's <b>site settings</b> for Altidian, set notifications to <b>Allow</b>, then reload.</p>
      <div class="row end gap-s" style="margin-top:14px"><button class="btn primary" data-close type="button">OK</button></div>`;
  } else {
    body = html`<p class="muted">Notifications are off on this phone. Without them you only find out when you open the app.</p>${REASONS}
      <div class="row end gap-s wrap-r" style="margin-top:14px"><button class="btn ghost" data-close type="button">Not now</button><button class="btn primary" data-action="pa-on" type="button">${icon('bell', 17)} Turn on notifications</button></div>`;
  }
  const d = dialog(html`<div class="pa"><div class="welcome-ico">${icon('bell', 28)}</div><h3>${s.supported ? 'Turn on notifications' : 'Add Altidian to your Home Screen'}</h3>${body}</div>`, { onClose: () => { box = null; } });
  box = d;
}

// Called after each page is drawn. Waits for other dialogs and never interrupts a quiz.
export function maybe({ user }, path, tries = 0) {
  if (!user() || asked() || path.startsWith('/quiz/') || path.startsWith('/login') || path.startsWith('/register')) return;
  setTimeout(async () => {
    if (!user() || asked() || box || location.hash.startsWith('#/quiz/')) return;
    if (document.querySelector('.modal-back')) { if (tries < 40) maybe({ user }, path, tries + 1); return; }
    try {
      let s = await P.status();
      if (s.supported && s.permission === 'granted' && !s.on) { await P.sync(); s = await P.status(); } // already allowed, so switch it on quietly
      if (s.supported && s.on) { mark(); return; }
      if (!s.supported && !s.iosNeedsInstall) { mark(); return; } // this browser cannot do it, so do not nag
      mark(); show(s);
    } catch (e) { /* try again on the next page */ }
  }, 2500);
}

export const actions = {
  async 'pa-on'(el) {
    el.disabled = true;
    try { await P.enable(); toast('Notifications are on.'); if (box) box.close(); } catch (e) { toast(e.message, 'bad'); el.disabled = false; }
  },
};
