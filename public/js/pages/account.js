import { html, raw, mount, icon, api, toast, fmtDate, ago, pct, initial, plural, confirmBox, avatar, squarePhoto } from '../core/ui.js';
import * as notifyMod from './notify.js';
import { emptyState, placeFields, placeChange, hasPlace, deptName, facultyName } from './shared.js';

let nextPath = '/';
const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const showBox = (id, text, kind = 'bad') => { const b = document.getElementById(id); if (!b) return; b.className = 'alert ' + kind; b.textContent = text; b.hidden = false; };

/* ---------- login / register / forgot ---------- */
export const auth = {
  async render({ S, user, config, go }, { mode }, query) {
    if (user()) { go(safeNext(query.get('next'))); return html``; }
    nextPath = safeNext(query.get('next'));
    const c = config(); const q = nextPath !== '/' ? '?next=' + encodeURIComponent(nextPath) : '';
    const pw = (id, label, extra = '') => html`<label class="field"><span>${label}</span><input id="${id}" name="${id}" type="password" required minlength="6" autocomplete="${id.includes('new') || id === 'reg-pass' ? 'new-password' : 'current-password'}" ${raw(extra)}></label>`;
    if (mode === 'register') {
      if (!c.registrationOpen) return html`<div class="card auth"><img class="auth-logo" src="/logo-full.png" alt="Altidian"><h2>Registration is closed</h2><p class="lead">New accounts are paused for now. Please check back soon, or log in if you already have one.</p><a class="btn primary block" href="#/login${q}">Log in</a></div>`;
      return html`<div class="card auth"><img class="auth-logo" src="/logo-full.png" alt="Altidian"><h2>Join the climb</h2><p class="lead">Free account. Save your scores, earn badges and join the leaderboard.</p>
        <div id="auth-msg" class="alert bad" hidden role="alert"></div>
        <form data-submit="do-register" novalidate>
          <label class="field"><span>Username</span><input name="username" required autocomplete="username" maxlength="24" autofocus><small>3 to 24 characters. This is the name others see on the leaderboard.</small></label>
          <label class="field"><span>Matric / registration number</span><input name="matric" required autocomplete="off" maxlength="25" placeholder="e.g. NDU/MLS/2023/001" style="text-transform:uppercase"><small>Only admins can see this. Each number can be used for one account.</small></label>
          ${placeFields(S, {})}
          ${pw('reg-pass', 'Password')}
          <label class="field"><span>Recovery phrase</span><input name="phrase" required minlength="4" maxlength="60" autocomplete="off"><small>A secret word or phrase only you know. It is the only way to reset your password if you forget it, so remember it.</small></label>
          <button class="btn primary block" type="submit">Create my account</button></form>
        <p class="muted small" style="text-align:center;margin-top:18px">Already have an account? <a href="#/login${q}">Log in</a></p></div>`;
    }
    if (mode === 'forgot') {
      return html`<div class="card auth"><img class="auth-logo" src="/logo-full.png" alt="Altidian"><h2>Reset password</h2><p class="lead">Enter your username and the recovery phrase you chose when you signed up.</p>
        <div id="auth-msg" class="alert bad" hidden role="alert"></div>
        <form data-submit="do-forgot" novalidate>
          <label class="field"><span>Username</span><input name="username" required autocomplete="username" autofocus></label>
          <label class="field"><span>Recovery phrase</span><input name="phrase" required autocomplete="off"></label>
          ${pw('forgot-new-pass', 'New password')}
          <button class="btn primary block" type="submit">Reset password</button></form>
        <p class="muted small" style="text-align:center;margin-top:18px"><a href="#/login${q}">Back to log in</a></p></div>`;
    }
    return html`<div class="card auth"><img class="auth-logo" src="/logo-full.png" alt="Altidian"><h2>Welcome back</h2><p class="lead">Log in to take quizzes and track your progress.</p>
      <div id="auth-msg" class="alert bad" hidden role="alert"></div>
      <form data-submit="do-login" novalidate>
        <label class="field"><span>Username</span><input name="username" required autocomplete="username" autofocus></label>
        ${pw('login-pass', 'Password')}
        <div class="row between" style="margin:-6px 0 14px"><label class="check small"><input type="checkbox" data-change="show-pw"> Show password</label><a class="link-btn" href="#/forgot${q}">Forgot password?</a></div>
        <button class="btn primary block" type="submit">Log in</button></form>
      ${c.registrationOpen ? html`<p class="muted small" style="text-align:center;margin-top:18px">New here? <a href="#/register${q}">Create a free account</a></p>` : ''}</div>`;
  },
};

async function sendForm(form, work) {
  const btn = form.querySelector('button[type=submit]'); const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Please wait…';
  try { await work(); } catch (e) { showBox(form.dataset.box || 'auth-msg', e.message); }
  finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- profile ---------- */
export const profile = {
  needsLogin: true,
  after() { notifyMod.hydrate(); },
  async render({ S, user }) {
    const p = await api('GET', '/api/profile');
    S.profile = p;
    const r = p.rank; const earned = p.badges.filter((b) => b.earned).length;
    return html`
      ${!hasPlace(p.user) ? html`<div class="alert warning" role="status">Add your department and level in <a href="#settings" data-action="goto-settings">account settings</a> so you see the right courses.</div>` : ''}
      <section class="p-head">
        <div style="text-align:center">${avatar(p.user.username, p.user.avatarId, 'big')}
          <div class="upload-row" style="justify-content:center"><button class="btn gold small" data-action="avatar-pick" type="button">${icon('upload', 15)} ${p.user.avatarId ? 'Change' : 'Add photo'}</button>${p.user.avatarId ? html`<button class="btn ghost small" style="color:#fff;border-color:rgba(255,255,255,.6)" data-action="avatar-remove" type="button" aria-label="Remove photo">${icon('trash', 15)}</button>` : ''}</div>
          <input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" data-change="avatar-file" hidden></div>
        <div class="grow"><p class="muted small">Student profile</p><h1>${p.user.username}</h1>
          <div class="me-meta">${p.user.matric ? html`<span class="chip">${icon('shield', 13)} ${p.user.matric}</span>` : ''}${hasPlace(p.user) ? html`<span class="chip gold">${deptName(S, p.user.departmentId)}</span><span class="chip">${p.user.level} level</span><span class="chip">${facultyName(S, p.user.facultyId)}</span>` : ''}</div>
          <p class="muted small" style="margin-top:8px">Joined ${fmtDate(p.user.createdAt)}${p.user.lastLoginAt ? ' · last seen ' + ago(p.user.lastLoginAt) : ''}</p>
          <div class="rankbar"><div class="row between small"><b>${r.title}</b><span>${p.points} pts</span></div><div class="bar"><i style="width:${r.pct}%"></i></div>
            <p>${r.next ? (r.next.at - p.points) + ' points to ' + r.next.title : 'Summit reached. Legend!'}</p></div></div>
      </section>
      <div class="kpis">
        <div class="kpi">${icon('star', 22)}<b>${p.points}</b><span>Total points</span></div>
        <div class="kpi">${icon('quiz', 22)}<b>${p.done}</b><span>Quizzes completed</span></div>
        <div class="kpi">${icon('chart', 22)}<b>${p.accuracy === null ? '—' : p.accuracy + '%'}</b><span>Overall accuracy</span></div>
        <div class="kpi">${icon('flame', 22)}<b>${p.streak.current}</b><span>Day streak${p.streak.longest > p.streak.current ? ' (best ' + p.streak.longest + ')' : ''}</span></div>
      </div>
      ${p.rank.position ? html`<p class="muted" style="margin-top:14px">${icon('trophy', 17)} You are <b>#${p.rank.position}</b> of ${p.rank.outOf} on the leaderboard.</p>` : ''}

      <section class="sec"><div class="quick">
        <a class="card flat q" href="#/share">${icon('upload', 22)}<b>Share a note</b><span>Earn points when it is approved</span></a>
        <a class="card flat q" href="#/saved">${icon('download', 22)}<b>Saved offline</b><span>Read with no internet</span></a>
        <a class="card flat q" href="#/timetable">${icon('clock', 22)}<b>Timetable and exams</b><span>Your class and countdowns</span></a>
        ${user().rep ? html`<a class="card flat q gold" href="#/rep">${icon('shield', 22)}<b>Class rep panel</b><span>Review notes and post for your class</span></a>` : ''}</div></section>
      ${notifyMod.section()}

      <section class="sec"><div class="sec-head"><div><h2>Badges</h2><p>${earned} of ${p.badges.length} unlocked</p></div></div>
        <div class="badges">${p.badges.map((b) => html`<div class="badge ${b.earned ? '' : 'off'}"><div class="ico-box">${icon(b.earned ? 'medal' : 'lock', 24)}</div><b>${b.name}</b><span>${b.desc}</span>${b.earned ? '' : html`<div class="bar" style="margin-top:8px"><i style="width:${pct(b.progress.current, b.progress.target)}%"></i></div>`}</div>`)}</div></section>

      <section class="sec"><div class="sec-head"><div><h2>My quiz scores</h2><p>Your best attempt counts towards your points.</p></div></div>
        ${p.quizzes.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th>Course</th><th class="num">Best</th><th class="num">Attempts</th><th>Last tried</th><th></th></tr></thead><tbody>
          ${p.quizzes.map((q) => html`<tr><td><b>${q.title}</b></td><td><span class="chip">${q.course}</span></td>
            <td class="num">${q.best ? html`<b>${q.best.correct}/${q.best.total}</b> <span class="muted">(${q.best.pct}%)</span>` : html`<span class="muted">Not taken</span>`}</td>
            <td class="num">${q.attempts}</td><td>${q.last ? ago(q.last) : '—'}</td><td><a class="btn ${q.best ? 'ghost' : 'primary'} small" href="#/quiz/${q.id}">${q.best ? 'Retake' : 'Start'}</a></td></tr>`)}</tbody></table></div>` : emptyState('quiz', 'No quizzes yet', 'Quizzes will show up here.')}</section>

      ${p.courses.length ? html`<section class="sec"><div class="sec-head"><div><h2>Progress by course</h2></div></div><div class="cards">
        ${p.courses.map((c) => html`<div class="card flat"><div class="row between"><h4>${c.code}</h4><span class="chip ${c.done === c.quizzes ? 'good' : ''}">${c.done}/${plural(c.quizzes, 'quiz', 'quizzes')}</span></div><p class="muted small">${c.name}</p>
          <div class="bar" style="margin:10px 0 6px"><i style="width:${pct(c.done, c.quizzes)}%"></i></div><p class="small">${c.accuracy === null ? 'No attempts yet' : 'Accuracy ' + c.accuracy + '%'}</p></div>`)}</div></section>` : ''}

      <section class="sec"><div class="sec-head"><div><h2>Recent activity</h2></div></div>
        ${p.recent.length ? html`<div class="card flat"><ol class="lb">${p.recent.map((a) => html`<li><span class="ico-box ${a.pct >= 70 ? '' : 'brand'}">${icon(a.pct >= 70 ? 'check' : 'refresh', 20)}</span><span class="grow"><b>${a.title}</b><br><span class="tiny muted">${a.course} · ${ago(a.at)}</span></span><span class="pts">${a.correct}/${a.total}</span></li>`)}</ol></div>` : emptyState('clock', 'No activity yet', 'Finish a quiz and it will show up here.')}</section>

      <section class="sec" id="settings"><div class="sec-head"><div><h2>Account settings</h2><p>Enter your current password to change anything.</p></div></div>
        <div class="card" style="max-width:640px"><div id="set-msg" class="alert bad" hidden role="alert"></div>
          <form data-submit="do-update" data-box="set-msg" novalidate>
            <label class="field"><span>Current password</span><input name="currentPassword" type="password" required autocomplete="current-password"></label>
            <label class="field"><span>Matric / registration number</span><input name="newMatric" autocomplete="off" maxlength="25" value="${p.user.matric}" style="text-transform:uppercase"></label>
            ${placeFields(S, p.user)}
            <div class="grid2"><label class="field"><span>New username</span><input name="newUsername" autocomplete="username" maxlength="24" placeholder="${p.user.username}"></label>
              <label class="field"><span>New password</span><input name="newPassword" type="password" minlength="6" autocomplete="new-password"></label></div>
            <label class="field"><span>New recovery phrase</span><input name="newRecoveryPhrase" autocomplete="off" maxlength="60"><small>Leave blank to keep the one you have.</small></label>
            <div class="row gap wrap-r"><button class="btn primary" type="submit">Save changes</button><button class="btn ghost" data-action="do-logout" type="button">${icon('logout', 17)} Log out</button></div></form></div></section>`;
  },
};

export const actions = {
  'place-fac': (el, ev, { S }) => placeChange(S, el),
  'place-dep': (el, ev, { S }) => placeChange(S, el),
  'place-lvl': () => {},
  'goto-settings'(el, ev) { ev.preventDefault(); document.getElementById('settings').scrollIntoView({ behavior: 'smooth' }); },
  'avatar-pick'() { document.getElementById('avatar-file').click(); },
  async 'avatar-file'(el, ev, { load, renderView }) {
    const file = el.files[0]; if (!file) return;
    try {
      const image = await squarePhoto(file);
      await api('POST', '/api/user/avatar', { image });
      await load(); toast('Profile picture updated.'); renderView();
    } catch (e) { toast(e.message, 'bad'); }
    el.value = '';
  },
  async 'avatar-remove'(el, ev, { load, renderView }) {
    try { await api('DELETE', '/api/user/avatar'); await load(); toast('Picture removed.'); renderView(); } catch (e) { toast(e.message, 'bad'); }
  },
  'show-pw'(el) { const f = el.closest('form').querySelector('input[type=password],input[data-pw]'); if (f) { f.type = el.checked ? 'text' : 'password'; f.dataset.pw = '1'; } },
  'do-login'(form, ev, { S, load, go }) {
    return sendForm(form, async () => {
      const f = new FormData(form);
      const username = String(f.get('username')).trim(); const password = String(f.get('login-pass'));
      if (!username || !password) throw new Error('Enter your username and password.');
      await api('POST', '/api/login', { username, password, deviceId: S.device });
      await load(); toast('Welcome back!'); go(nextPath);
    });
  },
  'do-register'(form, ev, { S, load, go }) {
    return sendForm(form, async () => {
      const f = new FormData(form);
      const username = String(f.get('username')).trim(); const password = String(f.get('reg-pass')); const phrase = String(f.get('phrase')).trim();
      const matric = String(f.get('matric')).trim();
      if (!username || !password || !phrase || !matric) throw new Error('Fill in every field.');
      if (!f.get('facultyId') || !f.get('departmentId') || !f.get('level')) throw new Error('Choose your faculty, department and level.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      if (phrase.length < 4) throw new Error('Recovery phrase must be at least 4 characters.');
      await api('POST', '/api/register', { username, password, recoveryPhrase: phrase, matric, facultyId: f.get('facultyId'), departmentId: f.get('departmentId'), level: Number(f.get('level')), deviceId: S.device });
      await load(); toast('Account created. Welcome aboard!'); go(nextPath);
    });
  },
  'do-forgot'(form, ev, { load, go }) {
    return sendForm(form, async () => {
      const f = new FormData(form);
      const d = await api('POST', '/api/user/reset-password', { username: String(f.get('username')).trim(), recoveryPhrase: String(f.get('phrase')), newPassword: String(f.get('forgot-new-pass')) });
      toast(d.message || 'Password reset. You can log in now.'); go('/login' + (nextPath !== '/' ? '?next=' + encodeURIComponent(nextPath) : ''));
    });
  },
  'do-update'(form, ev, { load, renderView }) {
    return sendForm(form, async () => {
      const f = new FormData(form);
      const body = { currentPassword: String(f.get('currentPassword')) };
      const nm = String(f.get('newMatric') || '').trim(); if (nm) body.newMatric = nm;
      if (f.get('facultyId') && f.get('departmentId') && f.get('level')) { body.facultyId = f.get('facultyId'); body.departmentId = f.get('departmentId'); body.level = Number(f.get('level')); }
      ['newUsername', 'newPassword', 'newRecoveryPhrase'].forEach((k) => { const v = String(f.get(k) || '').trim(); if (v) body[k] = k === 'newPassword' ? String(f.get(k)) : v; });
      const d = await api('POST', '/api/user/update', body);
      toast(d.message); await load(); renderView();
    });
  },
  async 'do-logout'(el, ev, { load, go }) {
    if (!(await confirmBox({ title: 'Log out?', text: 'You can log back in any time with your username and password.', yes: 'Log out' }))) return;
    try { await api('POST', '/api/logout'); } catch (e) { /* ignore */ }
    await load(); go('/'); toast('Logged out.');
  },
};
