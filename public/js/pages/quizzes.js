import { html, mount, icon, api, toast, pct, esc, dialog } from '../core/ui.js';
import { reportButton } from './report.js';
import { markBtn, weakCard } from './more.js';
import { quizCard, emptyState, scopeBar, inScope, currentScope, scopeState } from './shared.js';

const F = { course: '' };

export async function render({ S, user, config }) {
  const st = S.state; const best = (st.me && st.me.best) || {};
  const u = user(); const sc = currentScope(u);
  const pool = st.quizzes.filter((q) => inScope(S, u, sc, q.course));
  if (F.course && !pool.some((q) => q.course === F.course)) F.course = '';
  const courses = [...new Set(pool.map((q) => q.course))].sort();
  const list = pool.filter((q) => !F.course || q.course === F.course);
  const gate = config().requireLogin && !user();
  return html`<div class="sec-head"><div><h2>Quizzes</h2><p>Practise, see the right answer straight away, and climb the leaderboard.</p></div></div>
    ${gate ? html`<div class="alert info">You need an account to take quizzes and save your scores. <a href="#/login?next=%2Fquizzes">Log in</a> or <a href="#/register">create one free</a>.</div>` : ''}
    ${weakCard(S)}
    ${scopeBar(S, u, 'qz-scope')}
    ${courses.length > 1 ? html`<div class="filters"><button class="pill ${F.course ? '' : 'on'}" data-action="qz-course" data-v="" type="button">All courses</button>${courses.map((c) => html`<button class="pill ${F.course === c ? 'on' : ''}" data-action="qz-course" data-v="${c}" type="button">${c}</button>`)}</div>` : ''}
    ${list.length ? html`<div class="cards">${list.map((q) => quizCard(q, best[q.id], { missed: (st.me && st.me.missed || {})[q.id] }))}</div>` : emptyState('quiz', 'No quizzes yet', 'New quizzes will appear here soon.')}`;
}

/* ---------- quiz runner: normal, timed exam, or practising old mistakes ---------- */
let run = null;
const L = ['A', 'B', 'C', 'D'];
import { raw } from '../core/ui.js';
const raw0 = raw;

const stopTimer = () => { if (run && run.tick) { clearInterval(run.tick); run.tick = null; } };
window.addEventListener('hashchange', () => { if (run && !location.hash.startsWith('#/quiz/')) stopTimer(); });
const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const left = () => Math.max(0, Math.round((run.endAt - Date.now()) / 1000));

// Fresh random order every attempt. Fisher-Yates, so every order is equally likely.
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Options that point at other options ("All of the above", "Both A and B") only make sense in their written order.
const ORDER_BOUND = /\b(all|none|both|neither)\b[^.]{0,20}\b(of\s+)?(the\s+)?(above|these|those|options?)\b|\b(both|neither)\s+\(?[a-e]\)?\s+(and|nor)\s+\(?[a-e]\)?\b|\b(option|choice)s?\s+\(?[a-e]\)?\b|\b(a|b|c|d)\s+(and|&)\s+(a|b|c|d)\b/i;
const optionOrder = (q) => { const idx = q.o.map((_, i) => i); return q.o.some((o) => ORDER_BOUND.test(String(o))) ? idx : shuffle(idx); };
function start(quiz, mode, missed) {
  stopTimer();
  const all = quiz.questions.map((_, i) => i);
  const list = shuffle(mode === 'practice' ? missed.slice() : all);
  // perm[qi][shownPosition] = original option index. Answers are always stored as the ORIGINAL index, so scoring and mistakes stay correct.
  const perm = {}; list.forEach((qi) => { perm[qi] = optionOrder(quiz.questions[qi]); });
  run = { quiz, mode, list, perm, i: 0, answers: all.map(() => null), flags: new Set(), picked: null, result: null, endAt: 0, tick: null };
  if (mode === 'cards') { run.queue = list.slice(); run.again = new Set(); run.show = false; run.total = list.length; }
}
// Time choices for a timed exam: 3, 2 or 1 questions a minute.
export const timeOptions = (n) => [[Math.ceil(n / 3), 'Fast', '3 questions a minute'], [Math.ceil(n / 2), 'Steady', '2 questions a minute'], [n, 'Relaxed', '1 question a minute']].filter((o, i, a) => a.findIndex((x) => x[0] === o[0]) === i);
function beginClock() {
  if (!run || run.mode !== 'exam' || !run.endAt || run.result || run.tick) return;
  run.tick = setInterval(() => {
    const t = document.getElementById('timer'); if (!t) { stopTimer(); return; }
    const r = left(); t.textContent = fmt(r); t.classList.toggle('low', r <= 60);
    if (r <= 0) { stopTimer(); toast('Time is up. Submitting your answers.', 'bad'); submit(); }
  }, 500);
}

function chooser() {
  const n = run.list.length;
  return html`<div class="row between small"><button class="btn ghost small" data-action="qz-quit" type="button">${icon('x', 15)} Leave</button><span class="muted">${n} questions</span></div>
    <h2 class="q-text">How much time do you want?</h2><p class="muted">Pick one. The timer starts as soon as you choose, and the exam submits itself when time is up.</p>
    <div class="opts">${timeOptions(n).map(([m, name, pace]) => html`<button class="opt" data-action="qz-time" data-min="${m}" type="button"><span class="l">${icon('clock', 18)}</span><span><b>${m} minute${m === 1 ? '' : 's'}</b> · ${name}<br><span class="tiny muted">${pace}</span></span></button>`)}</div>`;
}
function cardScreen() {
  const { quiz } = run;
  if (!run.queue.length) { const first = run.total - run.again.size; return html`<div class="result card pop"><div class="ring" style="--p:${pct(first, run.total)}"><b>${first}<small>/${run.total}</small></b></div><h2>Deck finished</h2><p class="muted" style="margin-top:6px">You knew <b>${first}</b> of ${run.total} the first time${run.again.size ? ', and went over ' + run.again.size + ' again until they stuck.' : '.'}</p>
    <div class="row gap wrap-r" style="justify-content:center;margin-top:20px"><button class="btn primary" data-action="qz-cards-again" type="button">${icon('refresh', 17)} Go again</button><a class="btn ghost" href="#/quizzes">All quizzes</a></div></div>`; }
  const qi = run.queue[0]; const q = quiz.questions[qi]; const done = run.total - new Set(run.queue).size;
  return html`<div class="row between small"><button class="btn ghost small" data-action="qz-quit" type="button">${icon('x', 15)} Leave</button><span class="muted"><b>${run.queue.length}</b> left</span></div>
    <div class="bar" style="margin-top:12px"><i style="width:${(done / run.total) * 100}%"></i></div>
    <div class="flash card ${run.show ? 'back' : ''}"><p class="tiny muted">${quiz.course} · ${quiz.title}</p><h2 class="q-text" style="margin:8px 0 0">${q.q}</h2>
      ${run.show ? html`<div class="flash-ans"><span class="chip good">${icon('check', 13)} Answer</span><p style="font-weight:700;margin:8px 0">${q.o[q.a]}</p>${q.e ? html`<p class="small muted">${q.e}</p>` : ''}</div>` : ''}</div>
    ${run.show ? html`<div class="row gap" style="margin-top:14px"><button class="btn ghost grow" data-action="qz-card-again" type="button">${icon('refresh', 16)} Again</button><button class="btn primary grow" data-action="qz-card-got" type="button">${icon('check', 16)} Got it</button></div>`
      : html`<div class="row between" style="margin-top:14px"><span>${markBtn('q', quiz.id, qi)}</span><button class="btn primary" data-action="qz-card-show" type="button">Show answer</button></div>`}`;
}
// CBT-style question navigator: jump to any question, see what is answered or flagged.
function navigator() {
  const n = run.list.length;
  const btns = run.list.map((qi, pos) => {
    const cls = ['qn', pos === run.i ? 'cur' : '', run.answers[qi] !== null ? 'ans' : '', run.flags.has(qi) ? 'flag' : ''].filter(Boolean).join(' ');
    const label = 'Question ' + (pos + 1) + (run.answers[qi] !== null ? ', answered' : ', unanswered') + (run.flags.has(qi) ? ', flagged' : '');
    return html`<button class="${cls}" data-action="qz-goto" data-n="${pos}" type="button" aria-label="${label}" ${pos === run.i ? raw0('aria-current="true"') : ''}>${pos + 1}</button>`;
  });
  const done = run.list.filter((qi) => run.answers[qi] !== null).length; const cq = run.list[run.i];
  return html`<div class="qnav-wrap"><div class="row between"><span class="qnav-title">Question navigator</span><button class="btn ghost small ${run.flags.has(cq) ? 'flagged' : ''}" data-action="qz-flag" type="button" aria-pressed="${run.flags.has(cq)}">${icon('flag', 15)} ${run.flags.has(cq) ? 'Flagged' : 'Flag this'}</button></div>
    <div class="qnav" role="group" aria-label="Question navigator">${btns}</div>
    <div class="qnav-key tiny"><span><i class="k ans"></i>Answered</span><span><i class="k"></i>Unanswered</span><span><i class="k flag"></i>Flagged</span><span style="margin-left:auto"><b>${done}</b> of ${n} answered</span></div></div>`;
}
function confirmSubmit() {
  const blank = run.list.filter((i) => run.answers[i] === null).length;
  const fl = run.list.filter((i) => run.flags.has(i)).length;
  const bits = [];
  if (blank) bits.push(blank + ' question' + (blank > 1 ? 's are' : ' is') + ' still unanswered');
  if (fl) bits.push(fl + ' flagged for review');
  return !bits.length || confirm(bits.join(' and ') + '. Submit anyway?');
}
function screen() {
  if (run.mode === 'cards') return cardScreen();
  if (run.mode === 'exam' && !run.endAt && !run.result) return chooser();
  const { quiz, mode } = run; const qi = run.list[run.i]; const q = quiz.questions[qi]; const n = run.list.length;
  const exam = mode === 'exam';
  const locked = !exam && run.picked !== null;
  const chosen = exam ? run.answers[qi] : run.picked;
  const last = run.i + 1 === n;
  return html`<div class="row between small"><button class="btn ghost small" data-action="qz-quit" type="button">${icon('x', 15)} Leave</button>
      ${exam ? html`<span class="timer" title="Time left"><b id="timer">${fmt(left())}</b></span>` : ''}<span class="muted"><b>${run.i + 1}</b> of ${n}</span></div>
    ${mode === 'practice' ? html`<p class="small muted" style="margin-top:10px">Practising questions you got wrong before. No points here, but each right answer leaves your mistakes list.</p>` : ''}
    ${exam ? html`<p class="small muted" style="margin-top:10px">Exam mode: answers and explanations show only at the end. Change an answer any time before you submit.</p>` : ''}
    <div class="bar" style="margin-top:12px" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${run.i + (locked ? 1 : 0)}"><i style="width:${((run.i + (locked ? 1 : 0)) / n) * 100}%"></i></div>
    <h2 class="q-text">${q.q}</h2>
    <div class="opts">${run.perm[qi].map((oi, i) => {
      let cls = '';
      if (locked) cls = oi === q.a ? 'right' : (oi === chosen ? 'wrong' : '');
      else if (exam && oi === chosen) cls = 'sel';
      return html`<button class="opt ${cls}" data-action="qz-pick" data-i="${i}" type="button" ${locked ? raw0('disabled') : ''}><span class="l">${locked && oi === q.a ? icon('check', 18) : locked && oi === chosen ? icon('x', 18) : L[i]}</span><span>${q.o[oi]}</span></button>`;
    })}</div>
    ${locked && q.e ? html`<div class="expl"><b>Why: </b>${q.e}</div>` : ''}
    <div class="row between" style="margin-top:18px">
      <span>${markBtn('q', quiz.id, qi)} ${reportButton('question', quiz.id, qi)}</span>
      <span class="row gap-s">${exam && run.i > 0 ? html`<button class="btn ghost" data-action="qz-prev" type="button">Back</button>` : ''}
      ${(exam || locked) ? html`<button class="btn primary" data-action="qz-next" type="button">${last ? (exam ? 'Submit exam' : 'Finish') : 'Next question'} ${icon('arrow', 17)}</button>` : ''}</span></div>
    ${exam ? html`${navigator()}<div style="margin-top:14px;text-align:center"><button class="btn gold" data-action="qz-submit" type="button">Submit exam</button></div>` : ''}`;
}

function resultScreen() {
  const { quiz, result: r } = run;
  if (run.mode === 'practice') {
    const rest = r.left.length;
    return html`<div class="result card pop"><div class="ring" style="--p:${pct(r.fixed, r.tried || 1)}"><b>${r.fixed}<small>/${r.tried}</small></b></div>
      <h2>${rest ? 'Good practice!' : 'Mistakes cleared! 🔥'}</h2>
      <p class="muted" style="margin-top:6px">${r.fixed} fixed. ${rest ? html`<b>${rest}</b> still to go in ${quiz.title}.` : html`Nothing left to practise in ${quiz.title}.`}</p>
      <div class="row gap wrap-r" style="justify-content:center;margin-top:20px">
        ${rest ? html`<button class="btn primary" data-action="qz-practice-again" type="button">${icon('refresh', 17)} Practise the rest</button>` : ''}
        <a class="btn ghost" href="#/quizzes">All quizzes</a></div></div>`;
  }
  const p = pct(r.correct, r.total);
  const msg = p === 100 ? 'Flawless! 🔥' : p >= 70 ? 'Strong work!' : p >= 50 ? 'Good effort. Go again?' : 'Keep practising, you will get there.';
  const nm = (r.missed || []).length;
  return html`<div class="result card pop"><div class="ring" style="--p:${p}"><b>${p}<small>%</small></b></div>
    <h2>${run.mode === 'exam' ? 'Exam finished. ' : ''}${msg}</h2><p class="muted" style="margin-top:6px">You got <b>${r.correct}</b> of <b>${r.total}</b> in ${quiz.title}.</p>
    <p style="margin-top:12px">${r.improved ? html`<span class="chip good">${icon('star', 13)} New best score</span>` : html`<span class="chip grey">Your best score stays the same</span>`} ${r.rank ? html`<span class="chip brand">${r.rank} · ${r.points} pts</span>` : ''}</p>
    ${r.newBadges && r.newBadges.length ? html`<div class="alert warning" style="margin-top:16px">${icon('medal', 18)} New badge${r.newBadges.length > 1 ? 's' : ''} unlocked: <b>${r.newBadges.join(', ')}</b></div>` : ''}
    ${r.guest ? html`<div class="alert info" style="margin-top:16px">Create an account to keep your scores safe. <a href="#/register">Sign up</a></div>` : ''}
    <div class="row gap wrap-r" style="justify-content:center;margin-top:20px">
      ${nm && !r.guest ? html`<button class="btn primary" data-action="qz-mistakes" type="button">${icon('refresh', 17)} Practise my ${nm} mistake${nm > 1 ? 's' : ''}</button>` : ''}
      <button class="btn ${nm && !r.guest ? 'ghost' : 'primary'}" data-action="qz-again" type="button">${icon('refresh', 17)} Try again</button>
      <button class="btn gold" data-action="qz-review" type="button">Review answers</button>
      ${r.guest ? '' : html`<button class="btn ghost" data-action="qz-share-score" type="button">${icon('share', 17)} Share my score</button>`}
      <a class="btn ghost" href="#/quizzes">All quizzes</a></div></div>
    <div id="review"></div>`;
}
function reviewHtml() {
  const { quiz } = run;
  return html`<h3 style="margin:28px 0 12px">Your answers</h3>${quiz.questions.map((q, i) => {
    const a = run.answers[i]; const ok = a === q.a;
    return html`<div class="card flat" style="margin-bottom:12px"><div class="row gap-s">${ok ? html`<span class="chip good">${icon('check', 13)} Correct</span>` : html`<span class="chip bad">${icon("x", 13)} Wrong</span>`}<span class="muted small">Question ${i + 1}</span></div>
      <p style="font-weight:700;margin:8px 0">${q.q}</p>
      <p class="small"><b>Your answer:</b> ${a === null || a === undefined ? '— skipped' : q.o[a]}</p>
      ${ok ? '' : html`<p class="small"><b>Correct answer:</b> ${q.o[q.a]}</p>`}
      ${q.e ? html`<p class="small muted" style="margin-top:6px">${q.e}</p>` : ''}
      <p style="margin-top:8px">${markBtn('q', quiz.id, i)} ${reportButton('question', quiz.id, i)}</p></div>`;
  })}`;
}
const draw = () => { mount(document.getElementById('runner'), run.result ? resultScreen() : screen()); beginClock(); };

let ctxRef = null;
async function submit() {
  if (!run || run.result || run.sending) return;
  run.sending = true; stopTimer();
  const { S, user, load } = ctxRef;
  try {
    if (run.mode === 'practice') {
      const map = {}; run.list.forEach((i) => { if (run.answers[i] !== null) map[i] = run.answers[i]; });
      run.result = await api('POST', '/api/scores/practice', { quizId: run.quiz.id, answers: map, deviceId: S.device });
    } else {
      const r = await api('POST', '/api/scores', { quizId: run.quiz.id, answers: run.answers, deviceId: S.device });
      r.guest = !user(); run.result = r;
    }
    run.sending = false; draw(); window.scrollTo(0, 0); load().catch(() => {});
  } catch (e) { run.sending = false; toast(e.message, 'bad'); if (run.mode === 'exam') beginClock(); }
}

export const runner = {
  needsLogin: ({ config }) => config().requireLogin,
  async render(ctx, { id }, query) {
    const { S } = ctx; ctxRef = ctx;
    const quiz = S.state.quizzes.find((q) => q.id === id);
    if (!quiz) return html`<div class="empty">${icon('quiz', 34)}<h3>Quiz not available</h3><p>It may have been removed or hidden.</p><p style="margin-top:14px"><a class="btn primary" href="#/quizzes">Back to quizzes</a></p></div>`;
    if (quiz.locked) return html`<div class="empty">${icon('lock', 34)}<h3>This quiz is locked</h3><p>Unlock it to take it.</p><p style="margin-top:14px"><a class="btn primary" href="#/quizzes">Back to quizzes</a></p></div>`;
    const missed = ((S.state.me && S.state.me.missed) || {})[quiz.id] || [];
    let mode = query && query.get('mode');
    if (mode === 'practice' && !missed.length) mode = 'full';
    if (mode !== 'exam' && mode !== 'practice' && mode !== 'cards') mode = 'full';
    start(quiz, mode, missed);
    return html`<div class="runner ${quiz.paid ? 'no-copy' : ''}" id="runner"></div>`;
  },
  after() { if (run) draw(); },
};
runner.needsLogin.displayName = 'needsLogin';

/* Sharing: a link that opens the quiz. Someone who is not logged in is sent to log in or sign up first, then straight to the quiz. */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fall through */ }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
}
// Opens the phone's share sheet when there is one; otherwise a dialog that stays until closed.
async function shareOut(title, text, url) {
  try { if (navigator.share) { await navigator.share({ title, text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const all = text + '\n' + url; const enc = encodeURIComponent(all);
  const { box } = dialog(html`<div class="sheet"><h3>Share</h3><p class="tiny muted">Send this to your class group.</p>
    <textarea class="share-text" readonly rows="7">${all}</textarea>
    <div class="more-list"><button class="btn primary" data-sh="copy" type="button">${icon('file', 16)} Copy message</button>
      <a class="btn ghost" href="https://wa.me/?text=${enc}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a class="btn ghost" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">Telegram</a></div>
    <button class="btn ghost block" data-close type="button">Done</button></div>`);
  const ta = box.querySelector('textarea'); const cb = box.querySelector('[data-sh=copy]');
  cb.addEventListener('click', async () => { ta.select(); cb.textContent = (await copyText(all)) ? 'Copied ✓' : 'Press and hold the text to copy'; });
}
export const actions = {
  'quiz-share'(el) {
    const d = el.dataset; const url = location.origin + '/#/quiz/' + d.id;
    const sh = document.querySelector('.sheet .btn.block');
    shareOut(d.title, `Try this quiz on Altidian: ${d.course}, ${d.title} (${d.n} questions). Instant answers, and it counts on the leaderboard.`, url).then(() => { if (sh && sh.isConnected) sh.click(); }); // close the ⋯ menu once shared
  },
  'qz-share-score'() {
    if (!run || !run.result) return; const r = run.result; const q = run.quiz;
    shareOut(q.title, `I got ${r.correct}/${r.total} (${pct(r.correct, r.total)}%) in ${q.course}: ${q.title} on Altidian. Can you beat me?`, location.origin + '/#/quiz/' + q.id);
  },
  'qz-scope': (el, ev, { renderView }) => { scopeState.v = el.dataset.v; F.course = ''; renderView(); },
  'qz-course': (el, ev, { renderView }) => { F.course = el.dataset.v; renderView(); },
  'qz-pick'(el) {
    if (!run || run.result) return;
    const qi = run.list[run.i]; const v = run.perm[qi][Number(el.dataset.i)];
    if (run.mode === 'exam') { run.answers[qi] = v; run.picked = v; draw(); return; }
    if (run.picked !== null) return;
    run.picked = v; run.answers[qi] = v; draw();
    const nx = document.querySelector('[data-action="qz-next"]'); if (nx) nx.focus();
  },
  'qz-time'(el) { if (!run || run.endAt) return; run.endAt = Date.now() + Number(el.dataset.min) * 60000; draw(); window.scrollTo(0, 0); },
  'qz-card-show'() { run.show = true; draw(); },
  'qz-card-got'() { run.queue.shift(); run.show = false; draw(); },
  'qz-card-again'() { const i = run.queue.shift(); run.again.add(i); run.queue.splice(Math.min(3, run.queue.length), 0, i); run.show = false; draw(); },
  'qz-cards-again'() { start(run.quiz, 'cards'); draw(); },
  'qz-goto'(el) {
    if (!run || run.result || run.mode !== 'exam') return;
    const n = Number(el.dataset.n); if (!(n >= 0 && n < run.list.length) || n === run.i) return;
    run.i = n; run.picked = null; draw(); window.scrollTo(0, 0);
  },
  'qz-flag'() { if (!run || run.mode !== 'exam' || run.result) return; const qi = run.list[run.i]; run.flags.has(qi) ? run.flags.delete(qi) : run.flags.add(qi); draw(); },
  async 'qz-submit'(el, ev, ctx) { if (!run || run.mode !== 'exam' || run.result) return; ctxRef = ctx; if (!confirmSubmit()) return; el.disabled = true; await submit(); el.disabled = false; },
  'qz-prev'() { if (!run || run.i === 0) return; run.i--; run.picked = null; draw(); window.scrollTo(0, 0); },
  async 'qz-next'(el, ev, ctx) {
    if (!run) return; ctxRef = ctx;
    const exam = run.mode === 'exam';
    if (!exam && run.picked === null) return;
    if (run.i + 1 < run.list.length) { run.i++; run.picked = null; draw(); window.scrollTo(0, 0); return; }
    if (exam && !confirmSubmit()) return;
    el.disabled = true; await submit(); el.disabled = false;
  },
  'qz-again'() { start(run.quiz, run.mode === 'practice' ? 'full' : run.mode); draw(); window.scrollTo(0, 0); },
  'qz-mistakes'() { start(run.quiz, 'practice', run.result.missed); draw(); window.scrollTo(0, 0); },
  'qz-practice-again'() { start(run.quiz, 'practice', run.result.left); draw(); window.scrollTo(0, 0); },
  'qz-review'() { const b = document.getElementById('review'); b.innerHTML = reviewHtml().s; b.scrollIntoView({ behavior: 'smooth' }); },
  'qz-quit'(el, ev, { go }) { if (run.result || run.mode === 'cards' || (run.mode === 'exam' && !run.endAt) || (run.mode !== 'exam' && run.picked === null && run.i === 0) || confirm('Leave this quiz? Your progress will be lost.')) { stopTimer(); go('/quizzes'); } },
};
