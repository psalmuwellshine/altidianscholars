/* Altidian admin control panel. */
import { html, raw, mount, icon, api, toast, dialog, confirmBox, fmtDate, ago, pct, initial, avatar, kindLabel, initTheme, toggleTheme, readFile, debounce, eventDate, todayKey, plural, ApiError } from '../core/ui.js';
import { parseBulk } from './bulk.js';
import { embedOf } from '../core/video.js';
import { placeFields, placeChange } from '../pages/shared.js';

initTheme();
const root = document.getElementById('root');
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'students', label: 'Students', icon: 'users' },
  { id: 'academics', label: 'Academics', icon: 'shield' },
  { id: 'materials', label: 'Materials', icon: 'book' },
  { id: 'quizzes', label: 'Quizzes', icon: 'quiz' },
  { id: 'events', label: 'Events', icon: 'calendar' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'uploads', label: 'Student uploads', icon: 'upload' },
  { id: 'timetable', label: 'Timetable and exams', icon: 'clock' },
  { id: 'notice', label: 'Announcement', icon: 'bell' },
  { id: 'board', label: 'Leaderboard', icon: 'trophy' },
  { id: 'settings', label: 'Site settings', icon: 'settings' },
];
const A = { me: null, config: null, acad: { faculties: [], departments: [], courses: [] }, cache: {}, search: '', dept: '', level: '' };
const fakeS = () => ({ state: { academics: A.acad } });
const loadAcad = async () => { A.acad = await api('GET', '/api/admin/academics'); };
const dName = (id) => (A.acad.departments.find((d) => d.id === id) || {}).name || '';
const fName = (id) => (A.acad.faculties.find((f) => f.id === id) || {}).name || '';
const warn = (el, text, kind = 'bad') => { const b = el.querySelector('.msg'); if (!b) return toast(text, kind === 'bad' ? 'bad' : 'ok'); b.className = 'msg alert ' + kind; b.textContent = text; b.hidden = false; b.scrollIntoView({ block: 'nearest' }); };

/* ---------- sign in ---------- */
function loginView(configured) {
  mount(root, html`<div class="card login-box"><img class="auth-logo" src="/logo-full.png" alt="Altidian"><h2 style="text-align:center">Admin sign in</h2>
    <p class="muted" style="text-align:center;margin:6px 0 20px">Altidian control panel</p>
    ${configured ? '' : html`<div class="alert warning">Admin is not set up yet. Add an <b>ADMIN_PASSWORD</b> variable on your host, then redeploy.</div>`}
    <div class="msg alert bad" hidden role="alert"></div>
    <form data-submit="login" novalidate><label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <button class="btn primary block" type="submit" ${configured ? '' : raw('disabled')}>Sign in</button></form>
    <p style="text-align:center;margin-top:16px"><a class="small" href="/">← Back to the site</a></p></div>`);
}

/* ---------- shell ---------- */
function shell(sec) {
  return html`<div class="adm"><aside class="side"><a class="brand" href="#/overview"><img src="/logo.png" alt=""><span>Altidian<small>Admin panel</small></span></a>
    <nav aria-label="Admin sections">${SECTIONS.map((s) => html`<a href="#/${s.id}" class="${s.id === sec ? 'on' : ''}">${icon(s.icon, 18)} ${s.label}</a>`)}</nav>
    <div class="foot"><a class="btn ghost small" href="/" target="_blank" rel="noopener">${icon('eye', 16)} View site</a>
      <button class="btn ghost small" data-action="theme" type="button">${icon('moon', 16)} Light / dark</button>
      <button class="btn ghost small" data-action="logout" type="button">${icon('logout', 16)} Sign out</button></div></aside>
    <main class="content" id="content"><div class="skeleton"></div></main></div>`;
}
const head = (title, sub, actions) => html`<div class="bar-top"><div><h1 style="font-size:clamp(26px,4vw,36px)">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div><div class="row gap-s wrap-r">${actions || ''}</div></div>`;
const empty = (ic, t, s) => html`<div class="empty">${icon(ic, 34)}<h3>${t}</h3><p>${s}</p></div>`;

/* ---------- sections ---------- */
const views = {
  async overview() {
    const o = await api('GET', '/api/admin/overview'); const t = o.totals;
    const max = Math.max(1, ...o.series.map((d) => d.attempts));
    const sx = Math.max(1, ...o.series.map((d) => d.signups));
    const k = (ic, n, l, sub) => html`<div class="kpi">${icon(ic, 22)}<b>${n}</b><span>${l}</span>${sub ? html`<div class="tiny muted">${sub}</div>` : ''}</div>`;
    return html`${head('Overview', 'How the platform is doing right now.', html`<a class="btn ghost small" href="/" target="_blank" rel="noopener">View site</a>`)}
      <div class="k-grid">${k('users', t.students, 'Students', t.activeWeek + ' active this week')}${k('book', t.materials, 'Materials', t.hiddenMaterials ? t.hiddenMaterials + ' hidden' : 'all visible')}${k('quiz', t.quizzes, 'Quizzes', t.hiddenQuizzes ? t.hiddenQuizzes + ' hidden' : 'all visible')}${k('star', t.attempts, 'Quiz attempts', t.guests ? t.guests + ' guest players' : '')}</div>
      <div class="k-grid" style="margin-top:12px">${k('calendar', t.upcoming, 'Upcoming events')}${k('shield', t.disabled, 'Disabled accounts')}${k('file', o.storage === 'mongodb' ? 'MongoDB' : 'File', 'Storage', o.storage === 'file' ? 'Resets on free hosting. Use MongoDB.' : 'Permanent')}</div>
      <section class="sec"><div class="card"><h3>Quiz attempts, last 14 days</h3>
        <div class="chart" role="img" aria-label="Bar chart of daily quiz attempts for the last 14 days">${o.series.map((d) => html`<div class="col" title="${d.date}: ${d.attempts} attempts, ${d.signups} new students"><b>${d.attempts || ''}</b><i style="height:${(d.attempts / max) * 100}%"></i><span>${d.date.slice(8)}</span></div>`)}</div>
        <p class="tiny muted" style="margin-top:8px">New students in the same period: ${o.series.reduce((a, d) => a + d.signups, 0)}</p></div></section>
      <div class="cards" style="margin-top:20px">
        <div class="card"><h3 style="margin-bottom:10px">Most attempted quizzes</h3>${o.top.length && o.top[0].attempts ? html`<table><tbody>${o.top.map((q) => html`<tr><td><b>${q.title}</b><br><span class="tiny muted">${q.course}</span></td><td class="num">${q.attempts} tries</td><td class="num">${q.avgPct === null ? '—' : q.avgPct + '% avg'}</td></tr>`)}</tbody></table>` : html`<p class="muted">No attempts yet.</p>`}</div>
        <div class="card"><h3 style="margin-bottom:10px">Newest students</h3>${o.newest.length ? html`<table><tbody>${o.newest.map((u) => html`<tr><td><b>${u.username}</b></td><td class="num muted">${ago(u.createdAt)}</td></tr>`)}</tbody></table>` : html`<p class="muted">No students yet.</p>`}</div></div>`;
  },

  async students() {
    const list = await api('GET', '/api/admin/users'); A.cache.students = list;
    return html`${head('Students', plural(list.length, 'account') + ' registered.', html`<a class="btn ghost small" href="/api/admin/export/students">${icon('download', 16)} Students CSV</a><a class="btn ghost small" href="/api/admin/export/scores">${icon('download', 16)} Scores CSV</a>`)}
      <div class="toolbar"><label class="searchbox" style="max-width:340px">${icon('search', 18)}<span class="sr">Search students</span><input type="search" placeholder="Search username or matric" data-input="search-students" value="${A.search}"></label>
        <select data-change="stu-dept" style="width:auto;max-width:260px" aria-label="Department"><option value="">All departments</option>${A.acad.departments.map((d) => html`<option value="${d.id}" ${A.dept === d.id ? raw('selected') : ''}>${d.name}</option>`)}</select>
        <select data-change="stu-level" style="width:auto" aria-label="Level"><option value="">All levels</option>${[100, 200, 300, 400, 500, 600].map((l) => html`<option value="${l}" ${String(A.level) === String(l) ? raw('selected') : ''}>${l} level</option>`)}</select></div>
      <div id="stu-table">${studentTable(list)}</div>`;
  },

  async academics() {
    await loadAcad(); const ac = A.acad; A.cache.acad = ac;
    const deps = (c) => (c.departmentIds.length ? c.departmentIds.map(dName).join(', ') : 'All departments');
    return html`${head('Academics', 'Faculties, departments or programmes, and the courses taught at each level.', html`<button class="btn ghost" data-action="fac-new" type="button">${icon('plus', 16)} Faculty</button><button class="btn ghost" data-action="dep-new" type="button" ${ac.faculties.length ? '' : raw('disabled')}>${icon('plus', 16)} Department</button><button class="btn primary" data-action="crs-new" type="button">${icon('plus', 16)} Course</button>`)}
      <section><h3 style="margin-bottom:10px">Faculties</h3>${ac.faculties.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Faculty</th><th class="num">Departments</th><th class="num">Students</th><th></th></tr></thead><tbody>${ac.faculties.map((f) => html`<tr><td><b>${f.name}</b></td><td class="num">${f.departments}</td><td class="num">${f.students}</td>
        <td><div class="actions"><button class="btn ghost small icon" data-action="fac-edit" data-id="${f.id}" type="button" aria-label="Edit ${f.name}">${icon('edit', 16)}</button><button class="btn ghost small icon" data-action="fac-del" data-id="${f.id}" type="button" aria-label="Delete ${f.name}">${icon('trash', 16)}</button></div></td></tr>`)}</tbody></table></div>` : empty('shield', 'No faculties yet', 'Add a faculty first, then its departments.')}</section>
      <section class="sec"><h3 style="margin-bottom:10px">Departments and programmes</h3>${ac.departments.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Department</th><th>Faculty</th><th class="num">Levels</th><th class="num">Courses</th><th class="num">Students</th><th></th></tr></thead><tbody>${ac.departments.map((d) => html`<tr><td><b>${d.name}</b></td><td>${fName(d.facultyId)}</td><td class="num">100 to ${d.maxLevel}</td><td class="num">${d.courses}</td><td class="num">${d.students}</td>
        <td><div class="actions"><button class="btn ghost small icon" data-action="dep-edit" data-id="${d.id}" type="button" aria-label="Edit ${d.name}">${icon('edit', 16)}</button><button class="btn ghost small icon" data-action="dep-del" data-id="${d.id}" type="button" aria-label="Delete ${d.name}">${icon('trash', 16)}</button></div></td></tr>`)}</tbody></table></div>` : empty('users', 'No departments yet', 'Add the departments or programmes students can pick.')}</section>
      <section class="sec"><div class="toolbar"><h3 style="margin-right:auto">Courses</h3>
        <select data-change="crs-dept" style="width:auto;max-width:240px" aria-label="Department"><option value="">All departments</option>${ac.departments.map((d) => html`<option value="${d.id}" ${A.cdept === d.id ? raw('selected') : ''}>${d.name}</option>`)}</select>
        <select data-change="crs-level" style="width:auto" aria-label="Level"><option value="">All levels</option>${[100, 200, 300, 400, 500, 600].map((l) => html`<option value="${l}" ${String(A.clevel) === String(l) ? raw('selected') : ''}>${l} level</option>`)}</select></div>
        <div id="crs-table">${courseTable(ac, deps)}</div></section>`;
  },

  async materials() {
    const list = await api('GET', '/api/admin/materials'); A.cache.materials = list;
    return html`${head('Materials', plural(list.length, 'resource') + '. Notes, past questions, slides, videos and links.', html`<button class="btn primary" data-action="mat-new" type="button">${icon('plus', 18)} Add material</button>`)}
      ${list.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Title</th><th>Course</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>${list.map((m) => html`<tr><td><b>${m.title}</b><br><span class="tiny muted">${m.fileName || m.link || 'Notes only'}</span></td><td><span class="chip">${m.course}</span></td><td>${kindLabel[m.kind] || m.kind}</td>
        <td>${m.paid ? html`<span class="chip brand">${naira(m.price)}</span> ` : ''}${m.pinned ? html`<span class="chip brand">Pinned</span> ` : ''}${m.hidden ? html`<span class="chip grey">Hidden</span>` : html`<span class="chip good">Live</span>`}</td>
        <td><div class="actions"><button class="btn ghost small icon" data-action="mat-pin" data-id="${m.id}" type="button" title="${m.pinned ? 'Unpin' : 'Pin to top'}" aria-label="${m.pinned ? 'Unpin' : 'Pin'}">${icon('pin', 17)}</button>
        <button class="btn ghost small icon" data-action="mat-hide" data-id="${m.id}" type="button" title="${m.hidden ? 'Show' : 'Hide'}" aria-label="${m.hidden ? 'Show' : 'Hide'}">${icon(m.hidden ? 'eye' : 'eyeoff', 17)}</button>
        <button class="btn ghost small icon" data-action="mat-edit" data-id="${m.id}" type="button" title="Edit" aria-label="Edit ${m.title}">${icon('edit', 17)}</button>
        <button class="btn ghost small icon" data-action="mat-del" data-id="${m.id}" type="button" title="Delete" aria-label="Delete ${m.title}">${icon('trash', 17)}</button></div></td></tr>`)}</tbody></table></div>` : empty('book', 'No materials yet', 'Add your first study resource.')}`;
  },

  async quizzes() {
    const list = await api('GET', '/api/admin/quizzes'); A.cache.quizzes = list;
    return html`${head('Quizzes', plural(list.length, 'quiz', 'quizzes') + '.', html`<button class="btn primary" data-action="qz-new" type="button">${icon('plus', 18)} New quiz</button>`)}
      ${list.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th>Course</th><th class="num">Questions</th><th class="num">Attempts</th><th class="num">Avg</th><th>Status</th><th></th></tr></thead><tbody>${list.map((q) => html`<tr><td><b>${q.title}</b></td><td><span class="chip">${q.course}</span></td><td class="num">${q.questions.length}</td><td class="num">${q.stats.attempts}</td><td class="num">${q.stats.avgPct === null ? '—' : q.stats.avgPct + '%'}</td>
        <td>${q.paid ? html`<span class="chip brand">${naira(q.price)}</span> ` : ''}${q.hidden ? html`<span class="chip grey">Hidden</span>` : html`<span class="chip good">Live</span>`}</td>
        <td><div class="actions"><button class="btn ghost small icon" data-action="qz-hide" data-id="${q.id}" type="button" title="${q.hidden ? 'Show' : 'Hide'}" aria-label="${q.hidden ? 'Show' : 'Hide'} ${q.title}">${icon(q.hidden ? 'eye' : 'eyeoff', 17)}</button>
        <button class="btn ghost small icon" data-action="qz-edit" data-id="${q.id}" type="button" title="Edit" aria-label="Edit ${q.title}">${icon('edit', 17)}</button>
        <button class="btn ghost small icon" data-action="qz-del" data-id="${q.id}" type="button" title="Delete" aria-label="Delete ${q.title}">${icon('trash', 17)}</button></div></td></tr>`)}</tbody></table></div>` : empty('quiz', 'No quizzes yet', 'Create a quiz or paste many questions at once.')}`;
  },

  async events() {
    const list = await api('GET', '/api/admin/events'); A.cache.events = list; const t = todayKey();
    return html`${head('Events', 'Shown on the home page and the Events page.', html`<button class="btn primary" data-action="ev-new" type="button">${icon('plus', 18)} Add event</button>`)}
      ${list.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Event</th><th>When</th><th>Where</th><th></th></tr></thead><tbody>${list.map((e) => html`<tr><td><b>${e.title}</b> ${e.date < t ? html`<span class="chip grey">Past</span>` : ''}</td><td>${eventDate(e).long}${e.time ? ' · ' + e.time : ''}</td><td>${e.location || '—'}</td>
        <td><div class="actions"><button class="btn ghost small icon" data-action="ev-edit" data-id="${e.id}" type="button" aria-label="Edit ${e.title}">${icon('edit', 17)}</button><button class="btn ghost small icon" data-action="ev-del" data-id="${e.id}" type="button" aria-label="Delete ${e.title}">${icon('trash', 17)}</button></div></td></tr>`)}</tbody></table></div>` : empty('calendar', 'No events', 'Add a test, meeting or study session.')}`;
  },

  async notice() {
    const n = await api('GET', '/api/admin/notice'); await loadAcad(); const ps = await api('GET', '/api/admin/push/stats');
    return html`${head('Announcement', 'A banner shown at the top of every page. Leave it empty to hide it.')}
      <div class="card" style="max-width:640px"><div class="msg alert bad" hidden role="alert"></div>
        <form data-submit="notice-save" novalidate><label class="field"><span>Message</span><textarea name="text" maxlength="240" placeholder="e.g. MBH222 test holds on Friday at 10am">${n.text}</textarea><small>Up to 240 characters.</small></label>
        <label class="field"><span>Style</span><select name="level"><option value="info" ${n.level === 'info' ? raw('selected') : ''}>Information (gold)</option><option value="warning" ${n.level === 'warning' ? raw('selected') : ''}>Important (red)</option><option value="success" ${n.level === 'success' ? raw('selected') : ''}>Good news (green)</option></select></label>
        <label class="check small" style="margin-bottom:14px"><input type="checkbox" name="push"> Also send it as a notification to every student's phone</label>
        <div class="row gap-s"><button class="btn primary" type="submit">Publish</button><button class="btn ghost" data-action="notice-clear" type="button">Remove banner</button></div></form></div>
      <div class="card" style="max-width:640px;margin-top:16px"><h3 style="margin-bottom:4px">Send a notification</h3><p class="muted small" style="margin-bottom:12px">${ps.devices} phone${ps.devices === 1 ? '' : 's'} (${ps.students} of ${ps.totalStudents} students) have notifications on.</p>
        <div class="msg alert bad" hidden role="alert"></div>
        <form data-submit="push-send" novalidate><label class="field"><span>Title</span><input name="title" maxlength="80" required placeholder="e.g. Test moved to Friday"></label>
          <label class="field"><span>Message (optional)</span><input name="body" maxlength="160"></label>
          <div class="grid2"><label class="field"><span>Department</span><select name="departmentId"><option value="">Everyone</option>${A.acad.departments.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>
          <label class="field"><span>Level</span><select name="level"><option value="">All levels</option>${[100, 200, 300, 400, 500, 600].map((l) => html`<option value="${l}">${l} level</option>`)}</select></label></div>
          <button class="btn primary" type="submit">${icon('bell', 16)} Send now</button></form></div>`;
  },

  async uploads() {
    await loadAcad(); const d = await api('GET', '/api/admin/uploads');
    const row = (m, review) => html`<div class="cm"><div class="cm-top"><b>${m.title}</b><span class="chip">${m.course}</span><span class="tiny muted">${kindLabel[m.kind] || 'Resource'} · by ${m.by || 'student'} · ${ago(m.addedAt)}</span>${review ? '' : html`<span class="chip ${m.status === 'approved' ? 'good' : 'bad'}">${m.status}</span>`}</div>
      ${m.note ? html`<p>${m.note}</p>` : ''}${m.reason ? html`<p class="tiny muted">Reason: ${m.reason}</p>` : ''}
      ${review ? html`<div class="actions">${m.fileId ? html`<a class="btn ghost small" href="/files/${m.fileId}" target="_blank" rel="noopener">${icon('eye', 15)} Open file</a>` : ''}${m.link ? html`<a class="btn ghost small" href="${m.link}" target="_blank" rel="noopener noreferrer nofollow">${icon('link', 15)} Link</a>` : ''}
        <button class="btn primary small" data-action="up-approve" data-id="${m.id}" type="button">${icon('check', 15)} Approve</button><button class="btn ghost small" data-action="up-reject" data-id="${m.id}" data-title="${m.title}" type="button">Reject</button></div>` : ''}</div>`;
    return html`${head('Student uploads', 'Notes and past questions shared by students. Class reps review their own class; you can review anything.')}
      <div class="card" style="padding:0;overflow:hidden">${d.pending.length ? d.pending.map((m) => row(m, true)) : html`<div style="padding:8px">${empty('check', 'Nothing waiting', 'New uploads will appear here.')}</div>`}</div>
      ${d.recent.length ? html`<h3 style="margin:24px 0 10px">Recently reviewed</h3><div class="card" style="padding:0;overflow:hidden">${d.recent.map((m) => row(m, false))}</div>` : ''}`;
  },

  async timetable() {
    await loadAcad(); const list = await api('GET', '/api/admin/timetable');
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return html`${head('Timetable and exams', 'Classes, exams and tests for any class. Class reps can also post for their own class.', html`<button class="btn primary small" data-action="tt-add" type="button">${icon('plus', 16)} Add</button>`)}
      ${list.length ? html`<div class="tbl-wrap"><table><thead><tr><th>What</th><th>When</th><th>Class</th><th>By</th><th></th></tr></thead><tbody>${list.map((x) => html`<tr><td><b>${x.title}</b><br><span class="chip ${x.kind === 'exam' ? 'bad' : 'grey'}">${x.kind}</span> ${x.course ? html`<span class="chip">${x.course}</span>` : ''}</td>
        <td>${x.kind === 'class' ? days[x.day - 1] : fmtDate(x.date + 'T00:00:00')}${x.start ? html`<br><span class="tiny muted">${x.start}${x.end ? ' – ' + x.end : ''}${x.venue ? ' · ' + x.venue : ''}</span>` : ''}</td>
        <td>${x.departmentId ? dName(x.departmentId) : 'Everyone'}${x.level ? html`<br><span class="tiny muted">${x.level} level</span>` : ''}</td><td>${x.byName || ''}</td>
        <td><div class="actions"><button class="btn ghost small icon" data-action="tt-del" data-id="${x.id}" type="button" aria-label="Delete ${x.title}">${icon('trash', 16)}</button></div></td></tr>`)}</tbody></table></div>` : empty('clock', 'Nothing posted', 'Add the first class, exam or test.')}`;
  },

  async chat() {
    const { rooms, muted } = await api('GET', '/api/admin/chat/rooms'); A.cache.chatRooms = rooms; A.cache.muted = muted;
    if (!rooms.find((r) => r.id === A.chatRoom)) { const rep = rooms.find((r) => r.reported); A.chatRoom = (rep || rooms[0]).id; }
    const room = rooms.find((r) => r.id === A.chatRoom);
    const d = await api('GET', '/api/admin/chat/messages?room=' + encodeURIComponent(room.id));
    const mutedIds = new Set(muted.map((u) => u.id));
    const totalRep = rooms.reduce((a, r) => a + r.reported, 0);
    return html`${head('Chat', totalRep ? plural(totalRep, 'reported message') + ' waiting for review.' : 'Watch the rooms, remove messages, mute people and post notices.', html`<button class="btn ghost small" data-action="chat-new" type="button">${icon('plus', 16)} New room</button>`)}
      <div class="toolbar"><label class="field" style="margin:0;min-width:min(100%,320px)"><span class="sr">Room</span><select data-change="chat-room">${rooms.map((r) => html`<option value="${r.id}" ${r.id === room.id ? raw('selected') : ''}>${r.name}${r.reported ? ' ⚑ ' + r.reported : ''} (${r.count})</option>`)}</select></label>
        <span class="tiny muted">${d.online} online now</span><span style="flex:1"></span>
        <button class="btn ghost small" data-action="reload" type="button">${icon('refresh', 15)} Refresh</button>
        ${room.kind === 'custom' ? html`<button class="btn ghost small" data-action="chat-edit" data-id="${room.customId}" type="button">${icon('edit', 15)} Edit room</button><button class="btn ghost small" data-action="chat-rmroom" data-id="${room.customId}" data-name="${room.name}" type="button">${icon('trash', 15)} Delete room</button>` : ''}
        ${room.count ? html`<button class="btn danger small" data-action="chat-clear" type="button">Clear room</button>` : ''}</div>
      <div class="card" style="padding:0;overflow:hidden">${d.messages.length ? html`<div class="chat-admin">${d.messages.slice().reverse().map((m) => html`<div class="cm ${m.reports ? 'flag' : ''}">
        <div class="cm-top"><b>${m.name}</b>${m.admin ? html` <span class="chip">Admin</span>` : html` <span class="tiny muted mono">${m.matric || ''}</span>`}<span class="tiny muted">${fmtDate(m.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>${m.reports ? html`<span class="chip bad">${icon('flag', 13)} ${plural(m.reports, 'report')}</span>` : ''}</div>
        <p>${m.text}</p>
        <div class="actions"><button class="btn ghost small" data-action="chat-del" data-id="${m.id}" type="button">${icon('trash', 15)} Delete</button>${m.reports ? html`<button class="btn ghost small" data-action="chat-dismiss" data-id="${m.id}" type="button">Dismiss reports</button>` : ''}${m.admin ? '' : html`<button class="btn ghost small" data-action="chat-mute" data-id="${m.uid}" data-name="${m.name}" data-state="${mutedIds.has(m.uid) ? 1 : 0}" type="button">${mutedIds.has(m.uid) ? 'Unmute' : 'Mute'} ${m.name}</button>`}</div></div>`)}</div>` : html`<div style="padding:8px">${empty('chat', 'No messages yet', 'Messages show up here as students chat.')}</div>`}</div>
      <div class="card" style="margin-top:16px"><h3 style="margin-bottom:8px">Post as admin</h3><div class="msg alert bad" hidden role="alert"></div>
        <form data-submit="chat-post" novalidate class="row gap-s"><label class="field" style="flex:1;margin:0"><span class="sr">Message</span><input name="text" maxlength="600" placeholder="Message to ${room.name}" autocomplete="off" required></label><button class="btn primary" type="submit">${icon('send', 16)} Send</button></form></div>
      ${muted.length ? html`<div class="card" style="margin-top:16px"><h3 style="margin-bottom:8px">Muted students</h3><div class="row wrap-r gap-s">${muted.map((u) => html`<span class="chip">${u.username}<button type="button" class="chip-x" data-action="chat-mute" data-id="${u.id}" data-name="${u.username}" data-state="1" aria-label="Unmute ${u.username}">×</button></span>`)}</div></div>` : ''}`;
  },

  async board() {
    const rows = await api('GET', '/api/admin/board');
    return html`${head('Leaderboard', 'Remove a score, or start a fresh season.', html`<button class="btn danger" data-action="board-reset" type="button">${icon('refresh', 16)} Reset everything</button>`)}
      ${rows.length ? html`<div class="tbl-wrap"><table><thead><tr><th class="num">#</th><th>Name</th><th>Type</th><th class="num">Points</th><th class="num">Quizzes</th><th></th></tr></thead><tbody>${rows.map((r) => html`<tr><td class="num">${r.rank}</td><td><b>${r.name}</b></td><td>${r.isUser ? html`<span class="chip good">Student</span>` : html`<span class="chip grey">Guest</span>`}</td><td class="num">${r.points}</td><td class="num">${r.done}</td>
        <td><div class="actions"><button class="btn ghost small" data-action="board-del" data-id="${r.id}" data-name="${r.name}" type="button">${icon('trash', 16)} Clear scores</button></div></td></tr>`)}</tbody></table></div>` : empty('trophy', 'Nothing on the board', 'Scores appear after students take quizzes.')}`;
  },

  async settings() {
    const c = await api('GET', '/api/admin/config'); A.config = c; const L = c.links;
    const tg = (name, on, title, sub) => html`<label class="toggle-row"><input type="checkbox" name="${name}" ${on ? raw('checked') : ''}><span><b>${title}</b><small class="muted" style="display:block">${sub}</small></span></label>`;
    return html`${head('Site settings', 'Everything students see on the site, in one place.')}
      <form data-submit="settings-save" novalidate style="max-width:760px"><div class="msg alert bad" hidden role="alert"></div>
        <div class="card"><h3 style="margin-bottom:12px">Home page text</h3>
          <div class="grid2"><label class="field"><span>Site name</span><input name="siteName" maxlength="60" value="${c.siteName}"></label><label class="field"><span>Tagline</span><input name="tagline" maxlength="120" value="${c.tagline}"></label></div>
          <label class="field"><span>Motto (small italic line in the footer)</span><input name="motto" maxlength="60" value="${c.motto || ''}"></label>
          <label class="field"><span>Hero headline</span><input name="heroTitle" maxlength="90" value="${c.heroTitle}"></label>
          <label class="field"><span>Hero text</span><textarea name="heroText" maxlength="300">${c.heroText}</textarea></label>
          <label class="field"><span>Footer text</span><input name="footerText" maxlength="120" value="${c.footerText}"></label></div>
        <div class="card" style="margin-top:16px"><h3>Access and features</h3>
          ${tg('registrationOpen', c.registrationOpen, 'Allow new registrations', 'Turn off to stop new accounts being created.')}
          ${tg('requireLogin', c.requireLogin, 'Require login for quizzes', 'When off, guests can take quizzes, but scores are stored per device.')}
          ${tg('chatEnabled', c.chatEnabled, 'Student chat rooms', 'Turns the chat rooms on or off for all students.')}
          ${tg('contribEnabled', c.contribEnabled, 'Student uploads', 'Lets students share notes and past questions. Class reps or admins approve them first.')}
          <label class="field" style="margin-top:10px"><span>Points for each approved upload</span><input name="contribPoints" type="number" min="0" max="500" step="1" value="${c.contribPoints}" style="max-width:140px"></label>
          ${tg('leaderboardEnabled', c.leaderboardEnabled, 'Show the leaderboard', 'Hides rankings everywhere on the site.')}</div>
        <div class="card" style="margin-top:16px"><h3 style="margin-bottom:6px">Pay by bank transfer</h3><p class="muted small" style="margin-bottom:12px">Students see these details when they tap Unlock, transfer the money, then send you proof on WhatsApp (set your WhatsApp link below). You then give them access under Students.</p>
          <div class="grid2"><label class="field"><span>Bank name</span><input name="payBank" maxlength="60" placeholder="e.g. Opay, GTBank" value="${c.payBank || ''}"></label>
          <label class="field"><span>Account number (10 digits)</span><input name="payAccountNumber" inputmode="numeric" maxlength="10" value="${c.payAccountNumber || ''}"></label></div>
          <label class="field"><span>Account name</span><input name="payAccountName" maxlength="80" value="${c.payAccountName || ''}"></label>
          <label class="field"><span>Extra note for students (optional)</span><input name="payNote" maxlength="300" placeholder="e.g. Send proof within 24 hours" value="${c.payNote || ''}"></label></div>
        <div class="card" style="margin-top:16px"><h3 style="margin-bottom:6px">Semester pass</h3><p class="muted small" style="margin-bottom:12px">One payment that unlocks every paid note and quiz until the last day below. Mark items as paid, with their own prices, under Materials and Quizzes.</p>
          <div class="grid2"><label class="field"><span>Pass price (naira)</span><input name="passPrice" type="number" inputmode="numeric" min="0" step="1" placeholder="e.g. 2000" value="${c.passPrice || ''}"></label>
          <label class="field"><span>Pass lasts until</span><input name="passEnds" type="date" value="${c.passEnds || ''}"></label></div></div>
        <div class="card" style="margin-top:16px"><h3 style="margin-bottom:12px">Contact links</h3><p class="muted small" style="margin-bottom:12px">Shown in the site footer. Leave blank to hide.</p>
          <div class="grid2"><label class="field"><span>WhatsApp link</span><input name="whatsapp" inputmode="url" placeholder="https://" value="${L.whatsapp}"></label><label class="field"><span>Telegram link</span><input name="telegram" inputmode="url" placeholder="https://" value="${L.telegram}"></label>
          <label class="field"><span>Instagram link</span><input name="instagram" inputmode="url" placeholder="https://" value="${L.instagram}"></label><label class="field"><span>Website</span><input name="website" inputmode="url" placeholder="https://" value="${L.website}"></label></div>
          <label class="field"><span>Email</span><input name="email" type="email" value="${L.email}"></label></div>
        <div style="margin-top:18px"><button class="btn primary" type="submit">Save settings</button></div></form>`;
  },
};

function courseTable(ac, deps) {
  const rows = ac.courses.filter((c) => (!A.clevel || String(c.level) === String(A.clevel)) && (!A.cdept || !c.departmentIds.length || c.departmentIds.includes(A.cdept)));
  if (!rows.length) return empty('book', 'No courses here', 'Add a course, or change the filters.');
  deps = deps || ((c) => (c.departmentIds.length ? c.departmentIds.map(dName).join(', ') : 'All departments'));
  return html`<div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Title</th><th class="num">Level</th><th>Taught to</th><th></th></tr></thead><tbody>${rows.map((c) => html`<tr><td><span class="chip">${c.code}</span></td><td>${c.name || '—'}</td><td class="num">${c.level}</td><td>${deps(c)}</td>
    <td><div class="actions"><button class="btn ghost small icon" data-action="crs-edit" data-id="${c.id}" type="button" aria-label="Edit ${c.code}">${icon('edit', 16)}</button><button class="btn ghost small icon" data-action="crs-del" data-id="${c.id}" type="button" aria-label="Delete ${c.code}">${icon('trash', 16)}</button></div></td></tr>`)}</tbody></table></div>`;
}
function studentTable(list) {
  const q = A.search.trim().toLowerCase();
  const rows = list.filter((u) => (!q || u.username.toLowerCase().includes(q) || (u.matric || '').toLowerCase().includes(q)) && (!A.dept || u.departmentId === A.dept) && (!A.level || String(u.level) === String(A.level)));
  if (!rows.length) return empty('users', q ? 'No match' : 'No students yet', q ? 'Try another name.' : 'Students show up here after they register.');
  return html`<div class="tbl-wrap"><table><thead><tr><th>Student</th><th>Department</th><th>Rank</th><th class="num">Points</th><th class="num">Quizzes</th><th>Last login</th><th>Access</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((u) => html`<tr>
    <td><div class="row gap-s">${avatar(u.username, u.avatarId, 'sm')}<span><b>${u.username}</b><br><span class="tiny muted mono">${u.matric || 'no matric number'}</span></span></div></td><td>${u.departmentId ? dName(u.departmentId) : html`<span class="muted">Not set</span>`}${u.level ? html`<br><span class="tiny muted">${u.level} level</span>` : ''}</td><td>${u.rank}</td><td class="num">${u.points}</td><td class="num">${u.done}</td><td>${ago(u.lastLoginAt)}</td>
    <td>${u.paidUntil ? html`<span class="chip good">Pass to ${u.paidUntil}</span>` : html`<span class="chip grey">No pass</span>`}${u.unlockedCount ? html`<br><span class="tiny muted">+ ${u.unlockedCount} item${u.unlockedCount === 1 ? '' : 's'}</span>` : ''}</td>
    <td>${u.disabled ? html`<span class="chip bad">Disabled</span>` : html`<span class="chip good">Active</span>`}</td>
    <td><div class="actions"><button class="btn ghost small" data-action="stu-view" data-id="${u.id}" type="button">View</button>
    <button class="btn ghost small" data-action="stu-access" data-id="${u.id}" type="button">Access</button>
    <button class="btn ghost small icon" data-action="stu-edit" data-id="${u.id}" type="button" aria-label="Edit ${u.username}">${icon('edit', 16)}</button>
    <button class="btn ghost small" data-action="stu-pw" data-id="${u.id}" data-name="${u.username}" type="button">${icon('lock', 15)} Password</button>
    <button class="btn ghost small" data-action="stu-rep" data-id="${u.id}" type="button">${u.rep ? 'Rep ✓' : 'Make rep'}</button>
    <button class="btn ghost small" data-action="chat-mute" data-id="${u.id}" data-name="${u.username}" data-state="${u.chatMuted ? 1 : 0}" type="button">${u.chatMuted ? 'Unmute chat' : 'Mute chat'}</button>
    <button class="btn ghost small" data-action="stu-disable" data-id="${u.id}" data-name="${u.username}" data-state="${u.disabled ? 1 : 0}" type="button">${u.disabled ? 'Enable' : 'Disable'}</button>
    <button class="btn ghost small icon" data-action="stu-del" data-id="${u.id}" data-name="${u.username}" type="button" aria-label="Delete ${u.username}">${icon('trash', 16)}</button></div></td></tr>`)}</tbody></table></div>`;
}

/* ---------- router ---------- */
let token = 0;
async function route() {
  const sec = (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
  const id = views[sec] ? sec : 'overview';
  const my = ++token;
  mount(root, shell(id));
  const box = document.getElementById('content');
  try {
    const out = await views[id]();
    if (my !== token) return;
    mount(box, out);
  } catch (e) {
    if (my !== token) return;
    if (e instanceof ApiError && e.status === 401) return start();
    mount(box, html`<div class="alert bad">${e.message}</div><button class="btn ghost" data-action="reload" type="button">Try again</button>`);
  }
}
const reload = () => route();

/* ---------- dialogs: materials ---------- */
const courseSelect = (sel) => html`<option value="">Choose a course</option>${A.acad.courses.map((c) => html`<option value="${c.code}" ${c.code === sel ? raw('selected') : ''}>${c.code}${c.name ? ' · ' + c.name : ''} (${c.level}${c.departmentIds.length ? '' : ', all depts'})</option>`)}${sel && !A.acad.courses.some((c) => c.code === sel) ? html`<option value="${sel}" selected>${sel} (not in Academics yet)</option>` : ''}`;
function materialDialog(m) {
  const edit = !!m;
  const { box, close } = dialog(html`<h3>${edit ? 'Edit material' : 'Add material'}</h3><div class="msg alert bad" hidden role="alert"></div>
    <form data-submit="mat-save" novalidate>
      <label class="field"><span>Title</span><input name="title" maxlength="120" required value="${edit ? m.title : ''}" autofocus></label>
      <div class="grid2"><label class="field"><span>Course</span><select name="course" required>${courseSelect(edit ? m.course : '')}</select></label>
      <label class="field"><span>Type</span><select name="kind">${Object.keys(kindLabel).map((k) => html`<option value="${k}" ${edit && m.kind === k ? raw('selected') : ''}>${kindLabel[k]}</option>`)}</select></label></div>
      <label class="field"><span>Notes (optional)</span><textarea name="note" maxlength="8000">${edit ? m.note || '' : ''}</textarea></label>
      <label class="field"><span>Link (optional)</span><input name="link" inputmode="url" placeholder="Paste a YouTube or Google Drive link, or any web link" value="${edit ? m.link || '' : ''}" data-input="mat-link"><small id="mat-link-hint"></small></label>
      <label class="field"><span>File (optional, up to 12 MB)</span><input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.csv,.txt"><small>${edit && m.fileName ? 'Current file: ' + m.fileName + '. Choose a new one to replace it.' : 'PDF, Word, PowerPoint, Excel, image, CSV or text.'}</small></label>
      ${edit && m.fileId ? html`<label class="check small" style="margin-bottom:14px"><input type="checkbox" name="removeFile"> Remove the current file</label>` : ''}
      <div class="paid-box" style="margin-bottom:16px"><label class="check"><input type="checkbox" name="paid" ${edit && m.paid ? raw('checked') : ''}> Paid (students must pay to open this)</label>
        <label class="field" style="margin-top:8px"><span>Price in naira</span><input name="price" type="number" inputmode="numeric" min="1" step="1" placeholder="e.g. 500" value="${edit && m.paid ? m.price : ''}"><small>A file on a paid item must be a PDF or an image. Students can only view it, not download it.</small></label></div>
      <div class="row gap wrap-r" style="margin-bottom:16px"><label class="check"><input type="checkbox" name="pinned" ${edit && m.pinned ? raw('checked') : ''}> Pin to top</label><label class="check"><input type="checkbox" name="hidden" ${edit && m.hidden ? raw('checked') : ''}> Hidden from students</label></div>
      ${edit ? '' : html`<label class="check small" style="margin-bottom:14px"><input type="checkbox" name="notify" checked> Send a notification to students of this course</label>`}
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">${edit ? 'Save changes' : 'Add material'}</button></div></form>`, { wide: true });
  box.querySelector('form').dataset.id = edit ? m.id : '';
  box.querySelector('form').closeFn = close;
  const li = box.querySelector('[name=link]'); if (li) linkHint(li);
}

/* ---------- dialogs: quizzes ---------- */
let Q = null; // the quiz being edited
function qEditor() {
  return html`${Q.questions.map((q, i) => html`<div class="q-edit" data-qi="${i}"><div class="row between" style="margin-bottom:8px"><b>Question ${i + 1}</b><button class="btn ghost small" data-action="qz-rmq" data-i="${i}" type="button" ${Q.questions.length < 2 ? raw('disabled') : ''}>${icon('trash', 15)} Remove</button></div>
    <label class="field"><span class="sr">Question ${i + 1} text</span><textarea data-q="q" placeholder="Question text" maxlength="500" style="min-height:64px">${q.q}</textarea></label>
    ${q.o.map((o, k) => html`<div class="o"><input type="radio" name="ans${i}" data-q="a" value="${k}" ${q.a === k ? raw('checked') : ''} aria-label="Option ${'ABCD'[k]} is correct"><input data-q="o${k}" placeholder="Option ${'ABCD'[k]}" maxlength="250" value="${o}" aria-label="Option ${'ABCD'[k]}"></div>`)}
    <label class="field" style="margin:6px 0 0"><span class="sr">Explanation</span><input data-q="e" placeholder="Why is it right? (optional)" maxlength="800" value="${q.e || ''}"></label></div>`)}`;
}
function syncQ(form) {
  form.querySelectorAll('.q-edit').forEach((el) => {
    const i = Number(el.dataset.qi); const q = Q.questions[i]; if (!q) return;
    q.q = el.querySelector('[data-q=q]').value;
    q.o = [0, 1, 2, 3].map((k) => el.querySelector(`[data-q=o${k}]`).value);
    const a = el.querySelector('[data-q=a]:checked'); q.a = a ? Number(a.value) : -1;
    q.e = el.querySelector('[data-q=e]').value;
  });
}
function quizDialog(qz) {
  Q = qz ? JSON.parse(JSON.stringify(qz)) : { title: '', course: '', hidden: false, questions: [{ q: '', o: ['', '', '', ''], a: -1, e: '' }] };
  const { box, close } = dialog(html`<h3>${qz ? 'Edit quiz' : 'New quiz'}</h3><div class="msg alert bad" hidden role="alert"></div>
    <form data-submit="qz-save" novalidate>
      <div class="grid2"><label class="field"><span>Quiz title</span><input name="title" maxlength="120" required value="${Q.title}" autofocus></label>
      <label class="field"><span>Course</span><select name="course" required>${courseSelect(Q.course)}</select></label></div>
      <div class="paid-box" style="margin-bottom:16px"><label class="check"><input type="checkbox" name="paid" ${Q.paid ? raw('checked') : ''}> Paid (students must pay to open this)</label>
        <label class="field" style="margin-top:8px"><span>Price in naira</span><input name="price" type="number" inputmode="numeric" min="1" step="1" placeholder="e.g. 500" value="${Q.paid ? Q.price : ''}"></label></div>
      <label class="check" style="margin-bottom:16px"><input type="checkbox" name="hidden" ${Q.hidden ? raw('checked') : ''}> Hidden from students (draft)</label>
      <div id="q-list">${qEditor()}</div>
      <div class="row gap-s wrap-r" style="margin-bottom:18px"><button class="btn ghost small" data-action="qz-addq" type="button">${icon('plus', 15)} Add question</button><button class="btn ghost small" data-action="qz-bulk" type="button">${icon('upload', 15)} Paste many questions</button></div>
      ${qz ? '' : html`<label class="check small" style="margin-bottom:14px"><input type="checkbox" name="notify" checked> Send a notification to students of this course</label>`}
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">${qz ? 'Save quiz' : 'Create quiz'}</button></div></form>`, { wide: true });
  const f = box.querySelector('form'); f.dataset.id = qz ? qz.id : ''; f.closeFn = close;
}
function bulkDialog(form) {
  const { box, close } = dialog(html`<h3>Paste many questions</h3><p class="muted small" style="margin-bottom:10px">One question per block, blocks separated by a blank line. <span class="mono">Why:</span> is optional.</p>
    <pre class="mono card flat" style="white-space:pre-wrap;margin-bottom:12px;padding:12px">Q: Which organ makes insulin?
A) Liver
B) Pancreas
C) Kidney
D) Spleen
Answer: B
Why: Beta cells of the islets of Langerhans.</pre>
    <div class="msg alert bad" hidden role="alert"></div>
    <label class="field"><span class="sr">Questions</span><textarea class="code" name="bulk" autofocus style="min-height:220px"></textarea></label>
    <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" data-action="qz-bulk-go" type="button">Add questions</button></div>`, { wide: true });
  box.bulkTarget = form; box.closeFn = close;
}

/* ---------- dialogs: events ---------- */
function eventDialog(e) {
  const { box, close } = dialog(html`<h3>${e ? 'Edit event' : 'Add event'}</h3><div class="msg alert bad" hidden role="alert"></div>
    <form data-submit="ev-save" novalidate><label class="field"><span>Title</span><input name="title" maxlength="120" required value="${e ? e.title : ''}" autofocus></label>
      <div class="grid2"><label class="field"><span>Date</span><input type="date" name="date" required value="${e ? e.date : ''}"></label><label class="field"><span>Time (optional)</span><input type="time" name="time" value="${e ? e.time || '' : ''}"></label></div>
      <label class="field"><span>Location (optional)</span><input name="location" maxlength="120" value="${e ? e.location || '' : ''}"></label>
      <label class="field"><span>Details (optional)</span><textarea name="description" maxlength="1000">${e ? e.description || '' : ''}</textarea></label>
      <label class="field"><span>Link (optional)</span><input name="link" inputmode="url" placeholder="https://" value="${e ? e.link || '' : ''}"></label>
      <div class="grid2"><label class="field"><span>For which department?</span><select name="departmentId"><option value="">Everyone</option>${A.acad.departments.map((d) => html`<option value="${d.id}" ${e && e.departmentId === d.id ? raw('selected') : ''}>${d.name}</option>`)}</select></label>
      <label class="field"><span>For which level?</span><select name="level"><option value="">All levels</option>${[100, 200, 300, 400, 500, 600].map((l) => html`<option value="${l}" ${e && e.level === l ? raw('selected') : ''}>${l} level</option>`)}</select></label></div>
      ${e ? '' : html`<label class="check small" style="margin-bottom:14px"><input type="checkbox" name="notify" checked> Send a notification to those students</label>`}
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">${e ? 'Save event' : 'Add event'}</button></div></form>`);
  const f = box.querySelector('form'); f.dataset.id = e ? e.id : ''; f.closeFn = close;
}

/* ---------- actions ---------- */
async function busy(form, work) {
  const btn = form.querySelector('button[type=submit]'); const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try { await work(); } catch (e) { warn(form.closest('.modal') || form.parentElement, e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}
const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const val = (f, n) => String(new FormData(f).get(n) || '').trim();
const chk = (f, n) => !!f.querySelector(`[name=${n}]`)?.checked;
const byId = (list, id) => (A.cache[list] || []).find((x) => x.id === id);
const sure = (title, text, yes, danger = true) => confirmBox({ title, text, yes, danger });

const linkHint = (el) => {
  const h = document.getElementById('mat-link-hint'); if (!h) return;
  const v = el.value.trim(); const e = v ? embedOf(v) : null;
  h.style.color = '';
  if (!v) { h.textContent = ''; return; }
  if (!e) { h.textContent = 'This link will open in a new tab. Only YouTube and Google Drive videos play inside Altidian.'; return; }
  h.textContent = e.kind === 'drive' ? '✓ Google Drive video recognised. Set its sharing to "Anyone with the link", or students will see "access denied".' : '✓ YouTube video recognised. It will play inside Altidian.';
  h.style.color = 'var(--good)';
};
const actions = {
  'mat-link': linkHint,
  theme: toggleTheme, reload,
  async logout() { try { await api('POST', '/api/admin/logout'); } catch (e) { /* ignore */ } start(); },
  'search-students': debounce((el) => { A.search = el.value; const t = document.getElementById('stu-table'); if (t) t.innerHTML = studentTable(A.cache.students || []).s; }, 120),

  /* uploads, timetable, reps, push */
  async 'up-approve'(el) { await api('POST', `/api/admin/uploads/${el.dataset.id}/review`, { action: 'approve' }); toast('Approved and published.'); reload(); },
  'up-reject'(el) {
    const { box, close } = dialog(html`<h3>Reject "${el.dataset.title}"?</h3><label class="field"><span>Reason the student will see</span><input name="reason" maxlength="200" autofocus></label>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn danger" data-yes type="button">Reject</button></div>`);
    box.querySelector('[data-yes]').addEventListener('click', async () => { try { await api('POST', `/api/admin/uploads/${el.dataset.id}/review`, { action: 'reject', reason: box.querySelector('[name=reason]').value }); close(); toast('Rejected.'); reload(); } catch (e) { toast(e.message, 'bad'); } });
  },
  'tt-add'() {
    const lv = [100, 200, 300, 400, 500, 600];
    const { box, close } = dialog(html`<h3>Add to the timetable</h3><div class="msg alert bad" hidden role="alert"></div><form data-submit="tt-save" novalidate>
      <div class="grid2"><label class="field"><span>What is it?</span><select name="kind" data-change="tt-kind"><option value="class">Weekly class</option><option value="exam">Exam</option><option value="test">Test or quiz</option><option value="other">Other</option></select></label>
        <label class="field"><span>Course (optional)</span><input name="course" maxlength="10" placeholder="e.g. MBH222" style="text-transform:uppercase"></label></div>
      <label class="field"><span>Title</span><input name="title" maxlength="80" required autofocus></label>
      <div class="grid2"><label class="field tt-day"><span>Day</span><select name="day">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => html`<option value="${i + 1}">${d}</option>`)}</select></label>
        <label class="field tt-date" hidden><span>Date</span><input name="date" type="date"></label><label class="field"><span>Venue (optional)</span><input name="venue" maxlength="80"></label></div>
      <div class="grid2"><label class="field"><span>Starts</span><input name="start" type="time"></label><label class="field"><span>Ends (optional)</span><input name="end" type="time"></label></div>
      <div class="grid2"><label class="field"><span>Department</span><select name="departmentId"><option value="">Everyone</option>${A.acad.departments.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>
        <label class="field"><span>Level</span><select name="level"><option value="">All levels</option>${lv.map((l) => html`<option value="${l}">${l} level</option>`)}</select></label></div>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    box.querySelector('form').closeFn = close;
  },
  'tt-kind'(el) { const f = el.closest('form'); const c = el.value === 'class'; f.querySelector('.tt-day').hidden = !c; f.querySelector('.tt-date').hidden = c; },
  async 'tt-del'(el) { if (!(await sure('Delete this entry?', 'It disappears for the whole class.', 'Delete'))) return; await api('DELETE', '/api/admin/timetable/' + el.dataset.id); toast('Deleted.'); reload(); },
  'stu-rep'(el) {
    const u = (A.cache.students || []).find((x) => x.id === el.dataset.id); if (!u) return;
    const r = u.rep || {};
    const { box, close } = dialog(html`<h3>Class rep: ${u.username}</h3><p class="muted small" style="margin-bottom:10px">A class rep can approve notes, post materials, events, timetable entries and short updates for one class.</p><div class="msg alert bad" hidden role="alert"></div>
      <form data-submit="rep-save" data-id="${u.id}" novalidate><div class="grid2"><label class="field"><span>Department</span><select name="departmentId" required><option value="">Choose</option>${A.acad.departments.map((d) => html`<option value="${d.id}" ${(r.departmentId || u.departmentId) === d.id ? raw('selected') : ''}>${d.name}</option>`)}</select></label>
        <label class="field"><span>Level</span><select name="level"><option value="0">All levels</option>${[100, 200, 300, 400, 500, 600].map((l) => html`<option value="${l}" ${(r.level || u.level) === l ? raw('selected') : ''}>${l} level</option>`)}</select></label></div>
      <div class="row end gap wrap-r">${u.rep ? html`<button class="btn ghost" data-action="rep-remove" data-id="${u.id}" type="button">Remove as rep</button>` : ''}<button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">${u.rep ? 'Save' : 'Make class rep'}</button></div></form>`);
    box.querySelector('form').closeFn = close;
  },
  async 'rep-remove'(el) { await api('POST', `/api/admin/users/${el.dataset.id}/rep`, { remove: true }); document.querySelector('.modal-back')?.remove(); document.body.classList.remove('noscroll'); toast('No longer a class rep.'); reload(); },

  /* chat */
  'chat-room'(el) { A.chatRoom = el.value; reload(); },
  async 'chat-del'(el) {
    if (!(await sure('Delete this message?', 'It disappears for everyone straight away.', 'Delete'))) return;
    await api('POST', '/api/admin/chat/delete', { room: A.chatRoom, id: el.dataset.id }); toast('Message deleted.'); reload();
  },
  async 'chat-dismiss'(el) { await api('POST', '/api/admin/chat/dismiss', { room: A.chatRoom, id: el.dataset.id }); toast('Reports cleared.'); reload(); },
  async 'chat-mute'(el) {
    const on = el.dataset.state === '1';
    if (!on && !(await sure('Mute ' + el.dataset.name + '?', 'They can still read the rooms but cannot post until you unmute them.', 'Mute'))) return;
    await api('POST', `/api/admin/users/${el.dataset.id}/mute`, { muted: !on }); toast(on ? 'Unmuted.' : 'Muted.'); reload();
  },
  async 'chat-clear'() {
    const r = (A.cache.chatRooms || []).find((x) => x.id === A.chatRoom);
    if (!(await confirmBox({ title: 'Clear ' + (r ? r.name : 'this room') + '?', text: 'Every message in this room is removed for good.', yes: 'Clear room', danger: true, typed: 'CLEAR' }))) return;
    await api('POST', '/api/admin/chat/clear', { room: A.chatRoom, confirm: 'CLEAR' }); toast('Room cleared.'); reload();
  },
  'chat-new'() { chatRoomDialog(null); },
  'chat-edit'(el) { const r = (A.cache.chatRooms || []).find((x) => x.customId === el.dataset.id); if (r) chatRoomDialog(r); },
  async 'chat-rmroom'(el) {
    if (!(await sure('Delete ' + el.dataset.name + '?', 'The room and all its messages are removed.', 'Delete room'))) return;
    await api('DELETE', '/api/admin/chat/custom/' + el.dataset.id); A.chatRoom = 'general'; toast('Room deleted.'); reload();
  },

  /* students */
  async 'stu-view'(el) {
    const p = await api('GET', '/api/admin/users/' + el.dataset.id);
    dialog(html`<div class="row gap">${avatar(p.user.username, p.user.avatarId, 'md')}<div><h3 style="margin:0">${p.user.username}</h3><p class="muted small">${p.user.matric || 'No matric number'} · ${p.user.departmentId ? dName(p.user.departmentId) + ', ' + p.user.level + ' level' : 'department not set'}</p><p class="muted small">Joined ${fmtDate(p.user.createdAt)} · last login ${ago(p.user.lastLoginAt)}</p>
      <p style="margin-top:4px"><span class="chip brand">${p.rank.title}</span> ${p.user.disabled ? html`<span class="chip grey">Disabled</span>` : ''} ${p.user.hasRecovery ? '' : html`<span class="chip grey">No recovery phrase</span>`}</p></div></div>
      <div class="kpis" style="margin:16px 0"><div class="kpi"><b>${p.points}</b><span>Points</span></div><div class="kpi"><b>${p.done}</b><span>Quizzes</span></div><div class="kpi"><b>${p.accuracy === null ? '—' : p.accuracy + '%'}</b><span>Accuracy</span></div><div class="kpi"><b>${p.streak.longest}</b><span>Best streak</span></div></div>
      ${p.quizzes.some((q) => q.best) ? html`<div class="tbl-wrap"><table><thead><tr><th>Quiz</th><th class="num">Best</th><th class="num">Tries</th></tr></thead><tbody>${p.quizzes.filter((q) => q.best).map((q) => html`<tr><td>${q.title} <span class="chip">${q.course}</span></td><td class="num">${q.best.correct}/${q.best.total}</td><td class="num">${q.attempts}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">No quiz scores yet.</p>`}
      <div class="row end gap" style="margin-top:18px"><button class="btn ghost small" data-action="stu-clear" data-id="${el.dataset.id}" data-name="${p.user.username}" type="button">Clear scores</button><button class="btn primary" data-close type="button">Close</button></div>`, { wide: true });
  },
  async 'stu-pw'(el) {
    const { box, close } = dialog(html`<h3>Set a new password</h3><p class="muted">For <b>${el.dataset.name}</b>. They will be signed out everywhere. Tell them the new password privately.</p><div class="msg alert bad" hidden role="alert"></div>
      <form data-submit="stu-pw-save" data-id="${el.dataset.id}" novalidate><label class="field"><span>New password (6+ characters)</span><input name="pw" type="text" minlength="6" autocomplete="off" autofocus></label>
      <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Set password</button></div></form>`);
    box.querySelector('form').closeFn = close;
  },
  async 'stu-disable'(el) {
    const on = el.dataset.state === '1';
    if (!on && !(await sure('Disable ' + el.dataset.name + '?', 'They will be signed out and will not be able to log in or appear on the leaderboard.', 'Disable'))) return;
    await api('POST', `/api/admin/users/${el.dataset.id}/disable`, { disabled: !on }); toast(on ? 'Account enabled.' : 'Account disabled.'); reload();
  },
  async 'stu-clear'(el) {
    if (!(await sure('Clear scores for ' + el.dataset.name + '?', 'All their quiz scores and history will be removed. This cannot be undone.', 'Clear scores'))) return;
    await api('POST', `/api/admin/users/${el.dataset.id}/clear-scores`); document.querySelector('.modal-back')?.remove(); document.body.classList.remove('noscroll'); toast('Scores cleared.'); reload();
  },
  async 'stu-del'(el) {
    if (!(await confirmBox({ title: 'Delete ' + el.dataset.name + '?', text: 'The account and all of its scores will be permanently removed.', yes: 'Delete account', danger: true, typed: 'DELETE' }))) return;
    await api('DELETE', '/api/admin/users/' + el.dataset.id); toast('Account deleted.'); reload();
  },

  /* materials */
  'mat-new': () => materialDialog(null),
  'mat-edit': (el) => materialDialog(byId('materials', el.dataset.id)),
  async 'mat-pin'(el) { const m = byId('materials', el.dataset.id); await api('PUT', '/api/admin/materials/' + m.id, { ...m, pinned: !m.pinned }); reload(); },
  async 'mat-hide'(el) { const m = byId('materials', el.dataset.id); await api('PUT', '/api/admin/materials/' + m.id, { ...m, hidden: !m.hidden }); toast(m.hidden ? 'Now visible to students.' : 'Hidden from students.'); reload(); },
  async 'mat-del'(el) {
    const m = byId('materials', el.dataset.id);
    if (!(await sure('Delete “' + m.title + '”?', 'The material and its file will be removed for good. You can hide it instead.', 'Delete'))) return;
    await api('DELETE', '/api/admin/materials/' + m.id); toast('Deleted.'); reload();
  },

  /* quizzes */
  'qz-new': () => quizDialog(null),
  'qz-edit': (el) => quizDialog(byId('quizzes', el.dataset.id)),
  'qz-addq'(el) { const f = el.closest('form'); syncQ(f); if (Q.questions.length >= 150) return toast('A quiz can have up to 150 questions.', 'bad'); Q.questions.push({ q: '', o: ['', '', '', ''], a: -1, e: '' }); document.getElementById('q-list').innerHTML = qEditor().s; const t = f.querySelectorAll('.q-edit'); t[t.length - 1].scrollIntoView({ block: 'center' }); },
  'qz-rmq'(el) { const f = el.closest('form'); syncQ(f); Q.questions.splice(Number(el.dataset.i), 1); document.getElementById('q-list').innerHTML = qEditor().s; },
  'qz-bulk'(el) { const f = el.closest('form'); syncQ(f); bulkDialog(f); },
  'qz-bulk-go'(el) {
    const box = el.closest('.modal'); const { questions, errors } = parseBulk(box.querySelector('[name=bulk]').value);
    if (errors.length) return warn(box, errors.slice(0, 3).join(' '));
    if (!questions.length) return warn(box, 'Nothing to add yet. Paste at least one question.');
    const f = box.bulkTarget;
    Q.questions = Q.questions.filter((q) => q.q.trim() || q.o.some((o) => o.trim())).concat(questions).slice(0, 150);
    if (!Q.questions.length) Q.questions = questions;
    document.getElementById('q-list').innerHTML = qEditor().s;
    box.closeFn(); toast(plural(questions.length, 'question') + ' added. Check them, then save.');
  },
  async 'qz-hide'(el) { const q = byId('quizzes', el.dataset.id); await api('PUT', '/api/admin/quizzes/' + q.id, { ...q, hidden: !q.hidden }); reload(); },
  async 'qz-del'(el) {
    const q = byId('quizzes', el.dataset.id);
    if (!(await sure('Delete “' + q.title + '”?', 'The quiz will be removed. Student points from it will no longer count. You can hide it instead.', 'Delete'))) return;
    await api('DELETE', '/api/admin/quizzes/' + q.id); toast('Deleted.'); reload();
  },

  /* events */
  'ev-new': () => eventDialog(null),
  'ev-edit': (el) => eventDialog(byId('events', el.dataset.id)),
  async 'ev-del'(el) {
    const e = byId('events', el.dataset.id);
    if (!(await sure('Delete “' + e.title + '”?', 'This event will be removed from the site.', 'Delete'))) return;
    await api('DELETE', '/api/admin/events/' + e.id); toast('Deleted.'); reload();
  },

  /* notice and board */
  async 'notice-clear'() { await api('PUT', '/api/admin/notice', { text: '' }); toast('Banner removed.'); reload(); },
  async 'board-del'(el) {
    if (!(await sure('Clear scores for ' + el.dataset.name + '?', 'They will disappear from the leaderboard and lose their quiz history.', 'Clear scores'))) return;
    await api('DELETE', '/api/admin/board/' + el.dataset.id); toast('Cleared.'); reload();
  },
  async 'board-reset'() {
    if (!(await confirmBox({ title: 'Reset the whole leaderboard?', text: 'Every student’s and guest’s quiz scores will be erased. Accounts stay. This cannot be undone.', yes: 'Erase all scores', danger: true, typed: 'RESET' }))) return;
    const r = await api('POST', '/api/admin/board/reset', { confirm: 'RESET' }); toast('Cleared ' + r.cleared + ' score records.'); reload();
  },
};

const submits = {
  async 'push-send'(form) {
    await busy(form, async () => { const r = await api('POST', '/api/admin/push/send', { title: val(form, 'title'), body: val(form, 'body'), departmentId: val(form, 'departmentId'), level: val(form, 'level') }); toast('Sent to ' + plural(r.devices, 'phone') + '.'); form.reset(); });
  },
  async 'tt-save'(form) {
    await busy(form, async () => {
      const b = {}; ['kind', 'title', 'course', 'day', 'date', 'venue', 'start', 'end', 'departmentId', 'level'].forEach((k) => { b[k] = val(form, k); });
      if (b.kind === 'class') b.date = ''; else b.day = '';
      await api('POST', '/api/admin/timetable', b); form.closeFn(); toast('Added.'); reload();
    });
  },
  async 'rep-save'(form) {
    await busy(form, async () => { await api('POST', `/api/admin/users/${form.dataset.id}/rep`, { departmentId: val(form, 'departmentId'), level: Number(val(form, 'level')) }); form.closeFn(); toast('Saved. They get a notification.'); reload(); });
  },

  async 'chat-post'(form) {
    await busy(form, async () => { await api('POST', '/api/admin/chat/send', { room: A.chatRoom, text: val(form, 'text') }); toast('Posted.'); reload(); });
  },
  async 'chat-room-save'(form) {
    await busy(form, async () => {
      const body = { name: val(form, 'name'), description: val(form, 'description'), readOnly: chk(form, 'readOnly') };
      if (form.dataset.id) await api('PUT', '/api/admin/chat/custom/' + form.dataset.id, body);
      else { const r = await api('POST', '/api/admin/chat/custom', body); A.chatRoom = 'custom-' + r.id; }
      form.closeFn && form.closeFn(); toast('Room saved.'); reload();
    });
  },

  async login(form) {
    await busy(form, async () => { await api('POST', '/api/admin/login', { password: new FormData(form).get('password') }); start(); });
  },
  async 'stu-pw-save'(form) {
    await busy(form, async () => { await api('POST', `/api/admin/users/${form.dataset.id}/password`, { newPassword: val(form, 'pw') }); form.closeFn(); toast('Password updated.'); });
  },
  async 'mat-save'(form) {
    await busy(form, async () => {
      const body = { title: val(form, 'title'), course: val(form, 'course').toUpperCase(), kind: val(form, 'kind'), note: val(form, 'note'), link: val(form, 'link'), paid: chk(form, 'paid'), price: val(form, 'price'), pinned: chk(form, 'pinned'), hidden: chk(form, 'hidden'), notify: chk(form, 'notify'), removeFile: chk(form, 'removeFile') };
      const file = form.querySelector('[name=file]').files[0];
      if (file) { if (file.size > 12 * 1024 * 1024) throw new Error('That file is over 12 MB.'); body.file = await readFile(file); }
      const id = form.dataset.id;
      await api(id ? 'PUT' : 'POST', '/api/admin/materials' + (id ? '/' + id : ''), body);
      form.closeFn(); toast(id ? 'Saved.' : 'Material added.'); reload();
    });
  },
  async 'qz-save'(form) {
    syncQ(form);
    await busy(form, async () => {
      const body = { title: val(form, 'title'), course: val(form, 'course').toUpperCase(), paid: chk(form, 'paid'), price: val(form, 'price'), hidden: chk(form, 'hidden'), notify: chk(form, 'notify'), questions: Q.questions };
      const id = form.dataset.id;
      await api(id ? 'PUT' : 'POST', '/api/admin/quizzes' + (id ? '/' + id : ''), body);
      form.closeFn(); toast(id ? 'Quiz saved.' : 'Quiz created.'); reload();
    });
  },
  async 'ev-save'(form) {
    await busy(form, async () => {
      const body = { title: val(form, 'title'), date: val(form, 'date'), time: val(form, 'time'), location: val(form, 'location'), description: val(form, 'description'), link: val(form, 'link'), departmentId: val(form, 'departmentId'), level: val(form, 'level'), notify: chk(form, 'notify') };
      const id = form.dataset.id;
      await api(id ? 'PUT' : 'POST', '/api/admin/events' + (id ? '/' + id : ''), body);
      form.closeFn(); toast(id ? 'Event saved.' : 'Event added.'); reload();
    });
  },
  async 'notice-save'(form) {
    await busy(form, async () => { await api('PUT', '/api/admin/notice', { text: val(form, 'text'), level: val(form, 'level'), push: chk(form, 'push') }); toast('Announcement published.'); });
  },
  async 'settings-save'(form) {
    await busy(form, async () => {
      const body = { siteName: val(form, 'siteName'), tagline: val(form, 'tagline'), motto: val(form, 'motto'), heroTitle: val(form, 'heroTitle'), heroText: val(form, 'heroText'), footerText: val(form, 'footerText'),
        registrationOpen: chk(form, 'registrationOpen'), requireLogin: chk(form, 'requireLogin'), leaderboardEnabled: chk(form, 'leaderboardEnabled'), chatEnabled: chk(form, 'chatEnabled'), contribEnabled: chk(form, 'contribEnabled'), contribPoints: val(form, 'contribPoints'), payBank: val(form, 'payBank'), payAccountNumber: val(form, 'payAccountNumber'), payAccountName: val(form, 'payAccountName'), payNote: val(form, 'payNote'), passPrice: val(form, 'passPrice'), passEnds: val(form, 'passEnds'),
        links: { whatsapp: val(form, 'whatsapp'), telegram: val(form, 'telegram'), instagram: val(form, 'instagram'), website: val(form, 'website'), email: val(form, 'email') } };
      A.config = await api('PUT', '/api/admin/config', body); toast('Settings saved. The site is updated.');
    });
  },
};


/* ---------- academics, student edit ---------- */
const lvlOpts = (sel) => [100, 200, 300, 400, 500, 600].map((l) => html`<option value="${l}" ${Number(sel) === l ? raw('selected') : ''}>${l} level</option>`);
function chatRoomDialog(r) {
  simpleDialog(r ? 'Edit room' : 'New chat room', html`<label class="field"><span>Room name</span><input name="name" maxlength="40" required value="${r ? r.name : ''}" placeholder="e.g. Announcements" autofocus></label>
    <label class="field"><span>Short description (optional)</span><input name="description" maxlength="90" value="${r ? r.desc : ''}" placeholder="What is this room for?"></label>
    <label class="toggle-row"><input type="checkbox" name="readOnly" ${r && r.readOnly ? raw('checked') : ''}><span><b>Only admins can post</b><small>Students can read the room but not write in it.</small></span></label>`, 'chat-room-save', r ? r.customId : '');
}

function simpleDialog(title, body, formId, id) {
  const { box, close } = dialog(html`<h3>${title}</h3><div class="msg alert bad" hidden role="alert"></div><form data-submit="${formId}" data-id="${id || ''}" novalidate>${body}
    <div class="row end gap"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
  box.querySelector('form').closeFn = close; return box;
}
const acadByCache = (k, id) => A.acad[k].find((x) => x.id === id);
const acadReload = async () => { await loadAcad(); reload(); };
Object.assign(actions, {
  'place-fac': (el) => placeChange(fakeS(), el),
  'place-dep': (el) => placeChange(fakeS(), el),
  'stu-dept': (el) => { A.dept = el.value; const t = document.getElementById('stu-table'); if (t) t.innerHTML = studentTable(A.cache.students || []).s; },
  'stu-level': (el) => { A.level = el.value; const t = document.getElementById('stu-table'); if (t) t.innerHTML = studentTable(A.cache.students || []).s; },
  'crs-dept': (el) => { A.cdept = el.value; document.getElementById('crs-table').innerHTML = courseTable(A.acad).s; },
  'crs-level': (el) => { A.clevel = el.value; document.getElementById('crs-table').innerHTML = courseTable(A.acad).s; },

  'fac-new': () => simpleDialog('Add faculty', html`<label class="field"><span>Faculty name</span><input name="name" maxlength="90" required autofocus placeholder="e.g. Basic Medical Sciences"></label>`, 'fac-save'),
  'fac-edit'(el) { const f = acadByCache('faculties', el.dataset.id); simpleDialog('Edit faculty', html`<label class="field"><span>Faculty name</span><input name="name" maxlength="90" required autofocus value="${f.name}"></label>`, 'fac-save', f.id); },
  async 'fac-del'(el) { const f = acadByCache('faculties', el.dataset.id); if (!(await sure('Delete ' + f.name + '?', 'Only possible when it has no departments or students.', 'Delete'))) return; await api('DELETE', '/api/admin/faculties/' + f.id); toast('Deleted.'); acadReload(); },

  'dep-new': () => depDialog(null),
  'dep-edit': (el) => depDialog(acadByCache('departments', el.dataset.id)),
  async 'dep-del'(el) { const d = acadByCache('departments', el.dataset.id); if (!(await sure('Delete ' + d.name + '?', 'Only possible when no students are registered in it. It is removed from its courses.', 'Delete'))) return; await api('DELETE', '/api/admin/departments/' + d.id); toast('Deleted.'); acadReload(); },

  'crs-new': () => crsDialog(null),
  'crs-edit': (el) => crsDialog(acadByCache('courses', el.dataset.id)),
  async 'crs-del'(el) { const c = acadByCache('courses', el.dataset.id); if (!(await sure('Delete ' + c.code + '?', 'Only possible when no materials or quizzes use it.', 'Delete'))) return; await api('DELETE', '/api/admin/courses/' + c.id); toast('Deleted.'); acadReload(); },
  'crs-all'(el) { el.closest('form').querySelectorAll('[name=departmentIds]').forEach((c) => { c.disabled = el.checked; if (el.checked) c.checked = false; }); },

  'stu-edit'(el) {
    const u = (A.cache.students || []).find((x) => x.id === el.dataset.id); if (!u) return;
    simpleDialog('Edit ' + u.username, html`<label class="field"><span>Matric / registration number</span><input name="matric" maxlength="25" required value="${u.matric}" style="text-transform:uppercase" autofocus></label>${placeFields(fakeS(), u)}
      ${u.avatarId ? html`<p class="small"><button class="btn ghost small" data-action="stu-avatar-del" data-id="${u.id}" type="button">${icon('trash', 15)} Remove profile picture</button></p>` : ''}`, 'stu-edit-save', u.id);
  },
  async 'stu-access'(el) {
    const u = (A.cache.students || []).find((x) => x.id === el.dataset.id); if (!u) return;
    const [mats, qzs] = await Promise.all([api('GET', '/api/admin/materials'), api('GET', '/api/admin/quizzes')]);
    const paid = mats.map((m) => ({ id: m.id, title: m.title, course: m.course, price: m.price, paid: m.paid, kind: 'Note' })).concat(qzs.map((q) => ({ id: q.id, title: q.title, course: q.course, price: q.price, paid: q.paid, kind: 'Quiz' }))).filter((x) => x.paid);
    const have = new Set(u.unlocked || []);
    const end = (A.config && A.config.passEnds) || '';
    simpleDialog('Access for ' + u.username, html`<label class="field"><span>Semester pass valid until</span><input name="paidUntil" type="date" value="${u.paidUntil || ''}"><small>Leave empty for no pass. ${end ? 'This semester ends ' + end + '.' : 'Set the semester end date under Site settings.'}</small></label>
      ${end ? html`<p class="small"><button class="btn ghost small" data-action="stu-pass-fill" data-end="${end}" type="button">Give pass until ${end}</button> <button class="btn ghost small" data-action="stu-pass-clear" type="button">Remove pass</button></p>` : ''}
      <p class="small" style="margin:14px 0 6px"><b>Single items this student has paid for</b></p>
      ${paid.length ? html`<div style="max-height:220px;overflow:auto">${paid.map((x) => html`<label class="check small" style="display:flex;margin-bottom:6px"><input type="checkbox" name="unlocked" value="${x.id}" ${have.has(x.id) ? raw('checked') : ''}> <span>${x.title} <span class="tiny muted">${x.kind} · ${x.course} · ${naira(x.price)}</span></span></label>`)}</div>` : html`<p class="muted small">No paid items yet. Mark a note or quiz as paid first.</p>`}`, 'stu-access-save', u.id);
  },
  'stu-pass-fill'(el) { el.closest('form').querySelector('[name=paidUntil]').value = el.dataset.end; },
  'stu-pass-clear'(el) { el.closest('form').querySelector('[name=paidUntil]').value = ''; },
  async 'stu-avatar-del'(el) { await api('DELETE', `/api/admin/users/${el.dataset.id}/avatar`); toast('Picture removed.'); el.remove(); reload(); },
});
function depDialog(d) {
  simpleDialog(d ? 'Edit department' : 'Add department', html`<label class="field"><span>Department or programme name</span><input name="name" maxlength="90" required autofocus value="${d ? d.name : ''}" placeholder="e.g. Medical Laboratory Science"></label>
    <div class="grid2"><label class="field"><span>Faculty</span><select name="facultyId" required>${A.acad.faculties.map((f) => html`<option value="${f.id}" ${d && d.facultyId === f.id ? raw('selected') : ''}>${f.name}</option>`)}</select></label>
    <label class="field"><span>Highest level</span><select name="maxLevel">${lvlOpts(d ? d.maxLevel : 400)}</select><small>Students can pick 100 up to this level.</small></label></div>`, 'dep-save', d && d.id);
}
function crsDialog(c) {
  const all = !c || !c.departmentIds.length;
  simpleDialog(c ? 'Edit course' : 'Add course', html`<div class="grid2"><label class="field"><span>Course code</span><input name="code" maxlength="10" required value="${c ? c.code : ''}" placeholder="MBH222" style="text-transform:uppercase" autofocus></label>
    <label class="field"><span>Level</span><select name="level">${lvlOpts(c ? c.level : 200)}</select></label></div>
    <label class="field"><span>Course title</span><input name="name" maxlength="90" value="${c ? c.name : ''}"></label>
    <fieldset class="field" style="border:0;padding:0;margin:0 0 16px"><legend style="font-weight:700;font-size:14.5px;margin-bottom:6px">Taught to</legend>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" name="all" data-change="crs-all" ${all ? raw('checked') : ''}> All departments (for example GST courses)</label>
      ${A.acad.departments.map((d) => html`<label class="check small" style="margin:4px 0 4px 6px"><input type="checkbox" name="departmentIds" value="${d.id}" ${!all && c.departmentIds.includes(d.id) ? raw('checked') : ''} ${all ? raw('disabled') : ''}> ${d.name} <span class="muted">· ${fName(d.facultyId)}</span></label>`)}</fieldset>`, 'crs-save', c && c.id);
}
Object.assign(actions, { 'crs-all': (el) => { el.closest('form').querySelectorAll('[name=departmentIds]').forEach((c) => { c.disabled = el.checked; if (el.checked) c.checked = false; }); } });
Object.assign(submits, {
  async 'fac-save'(form) { await busy(form, async () => { const id = form.dataset.id; await api(id ? 'PUT' : 'POST', '/api/admin/faculties' + (id ? '/' + id : ''), { name: val(form, 'name') }); form.closeFn(); toast('Saved.'); acadReload(); }); },
  async 'dep-save'(form) { await busy(form, async () => { const id = form.dataset.id; await api(id ? 'PUT' : 'POST', '/api/admin/departments' + (id ? '/' + id : ''), { name: val(form, 'name'), facultyId: val(form, 'facultyId'), maxLevel: Number(val(form, 'maxLevel')) }); form.closeFn(); toast('Saved.'); acadReload(); }); },
  async 'crs-save'(form) {
    await busy(form, async () => {
      const id = form.dataset.id; const all = chk(form, 'all');
      const departmentIds = all ? [] : [...form.querySelectorAll('[name=departmentIds]:checked')].map((x) => x.value);
      await api(id ? 'PUT' : 'POST', '/api/admin/courses' + (id ? '/' + id : ''), { code: val(form, 'code').toUpperCase(), name: val(form, 'name'), level: Number(val(form, 'level')), departmentIds });
      form.closeFn(); toast('Saved.'); acadReload();
    });
  },
  async 'stu-access-save'(form) {
    await busy(form, async () => {
      const unlocked = Array.from(form.querySelectorAll('[name=unlocked]:checked')).map((c) => c.value);
      await api('POST', '/api/admin/users/' + form.dataset.id + '/access', { paidUntil: val(form, 'paidUntil'), unlocked });
      form.closeFn(); toast('Access updated.'); reload();
    });
  },
  async 'stu-edit-save'(form) {
    await busy(form, async () => {
      if (!val(form, 'facultyId') || !val(form, 'departmentId') || !val(form, 'level')) throw new Error('Choose faculty, department and level.');
      await api('PUT', '/api/admin/users/' + form.dataset.id, { matric: val(form, 'matric'), facultyId: val(form, 'facultyId'), departmentId: val(form, 'departmentId'), level: Number(val(form, 'level')) });
      form.closeFn(); toast('Student updated.'); reload();
    });
  },
});
document.addEventListener('change', async (ev) => {
  const el = ev.target.closest('[data-change]'); if (!el || !actions[el.dataset.change]) return;
  try { await actions[el.dataset.change](el, ev); } catch (e) { toast(e.message, 'bad'); }
});

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]'); if (!el || !actions[el.dataset.action]) return;
  try { await actions[el.dataset.action](el, ev); } catch (e) { if (e instanceof ApiError && e.status === 401) return start(); toast(e.message, 'bad'); }
});
document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('form[data-submit]'); if (!f) return; ev.preventDefault();
  if (submits[f.dataset.submit]) submits[f.dataset.submit](f);
});
document.addEventListener('input', (ev) => { const el = ev.target.closest('[data-input]'); if (el && actions[el.dataset.input]) actions[el.dataset.input](el, ev); });
window.addEventListener('hashchange', () => { if (A.me && A.me.admin) route(); });

async function start() {
  try { A.me = await api('GET', '/api/admin/me'); } catch (e) { root.textContent = e.message; return; }
  if (!A.me.admin) return loginView(A.me.configured);
  try { A.config = await api('GET', '/api/admin/config'); await loadAcad(); } catch (e) { /* loaded later */ }
  route();
}
start();
