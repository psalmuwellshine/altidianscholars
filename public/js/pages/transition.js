// Rebrand and move-over messages: a banner with a countdown, a one-time welcome, and a ribbon on the login pages.
import { html, icon, dialog, todayKey } from '../core/ui.js';

const daysTo = (date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(todayKey() + 'T00:00:00Z')) / 86400000);
const longDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export const active = (c) => !!c.moveOn && (!c.moveEnds || daysTo(c.moveEnds) >= -7);

function countdown(c) {
  if (!c.moveEnds) return null;
  const n = daysTo(c.moveEnds);
  if (n > 1) return { big: n, unit: 'days', line: 'until materials live only on Altidian (' + longDate(c.moveEnds) + ')' };
  if (n === 1) return { big: 1, unit: 'day', line: 'left. From tomorrow, materials live only on Altidian.' };
  if (n === 0) return { big: 'Today', unit: '', line: 'Materials now live only on Altidian.' };
  return { big: '✓', unit: '', line: 'Everything now lives on Altidian.' };
}

export function banner(c) {
  if (!active(c)) return '';
  const cd = countdown(c);
  return html`<section class="move" aria-label="Exam Warriors is now Altidian">
    <div class="move-main"><span class="move-tag">${icon('star', 14)} New home</span>
      <h2>${c.moveTitle || 'Exam Warriors is now Altidian'}</h2>
      <p>${c.moveText || 'Same team, same quality. Notes, past questions, quizzes and rankings now all live in one place. Rise to your highest point.'}</p></div>
    ${cd ? html`<div class="move-count" role="timer"><b>${cd.big}</b>${cd.unit ? html`<span>${cd.unit}</span>` : ''}<small>${cd.line}</small></div>` : ''}
  </section>`;
}

// A slim ribbon for people who arrive at the login or sign-up page from an old Exam Warriors link.
export const ribbon = (c) => (active(c) ? html`<div class="move-ribbon">${icon('star', 15)} <span><b>Exam Warriors is now Altidian.</b> Same team, new home. Log in or sign up to continue.</span></div>` : '');

const KEY = 'alt-welcome-v1:';
export function welcome(user, c) {
  if (!user || !active(c)) return;
  try { if (localStorage.getItem(KEY + user.id)) return; localStorage.setItem(KEY + user.id, '1'); } catch (e) { return; }
  setTimeout(() => {
    dialog(html`<div class="welcome"><div class="welcome-ico">${icon('star', 30)}</div>
      <h3>Welcome to Altidian</h3><p class="muted">Exam Warriors has a new home. Here is how to get the most out of it:</p>
      <ol class="welcome-steps">
        <li><b>Set your department and level</b><span>So you see the right courses first.</span></li>
        <li><b>Take a quiz</b><span>Instant answers, and your score counts on the leaderboard.</span></li>
        <li><b>Turn on notifications</b><span>Hear about new materials and exam dates as they land.</span></li>
      </ol>
      <div class="row end gap-s" style="margin-top:16px"><a class="btn ghost" href="#/profile" data-close>My profile</a><a class="btn primary" href="#/quizzes" data-close>Take a quiz ${icon('arrow', 17)}</a></div></div>`);
  }, 700);
}
