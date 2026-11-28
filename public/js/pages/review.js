/* Review: the questions a student missed come back here on a schedule (tomorrow, then 3, 7, 14 and 30 days later).
   A round is up to 10 questions. The answers are marked on the server and shown after the round. */
import { html, icon, toast, api } from '../core/ui.js';

const L = ['A', 'B', 'C', 'D'];
const R = { d: null, i: 0, picks: {}, out: null, busy: false };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function empty(d) {
  return html`<div class="card" style="max-width:520px;margin:24px auto;text-align:center"><div class="welcome-ico" style="margin:0 auto 12px">${icon('check', 30)}</div>
    <h2>Nothing to review today</h2><p class="muted" style="margin:10px 0 18px">${d && d.later ? d.later + ' question' + (d.later === 1 ? '' : 's') + ' will come back on another day.' : 'When you miss a question in a quiz, it comes back here tomorrow, then again after 3, 7, 14 and 30 days, until it sticks.'}</p>
    <div class="row gap-s wrap-r" style="justify-content:center"><a class="btn primary" href="#/quizzes">Take a quiz</a><a class="btn ghost" href="#/">Home</a></div></div>`;
}
function question() {
  const q = R.d.questions[R.i]; const n = R.d.questions.length; const chosen = R.picks[q.h];
  return html`<div class="rv-head"><span class="chip grey">Review · question ${R.i + 1} of ${n}</span> <span class="chip">${q.course}</span></div>
    <div class="bar" style="margin:10px 0 14px"><i style="width:${(R.i / n) * 100}%"></i></div>
    <div class="card"><p class="tiny muted">${q.title}</p><h2 style="margin:6px 0 16px;font-size:1.15rem;line-height:1.4">${q.q}</h2>
      <div class="opts">${q.o.map((o, i) => html`<button class="opt ${chosen === i ? 'sel' : ''}" data-action="rv-pick" data-i="${i}" type="button"><span class="l">${L[i]}</span><span>${o}</span></button>`)}</div></div>
    <div class="row gap-s" style="margin-top:14px;justify-content:space-between"><a class="btn ghost" href="#/">Leave</a>
      ${R.i + 1 < n ? html`<button class="btn primary" data-action="rv-next" type="button" ${chosen === undefined ? 'disabled' : ''}>Next ${icon('arrow', 16)}</button>` : html`<button class="btn gold" data-action="rv-finish" type="button" ${chosen === undefined || R.busy ? 'disabled' : ''}>Finish and mark</button>`}</div>`;
}
function results() {
  const o = R.out; const qs = R.d.questions; const by = new Map(o.results.map((r) => [r.h, r]));
  return html`<div class="result card pop"><div class="ring" style="--p:${Math.round((o.right / Math.max(1, o.results.length)) * 100)}"><b>${o.right}<small>/${o.results.length}</small></b></div>
    <h2>${o.right === o.results.length ? 'All of them stuck! 🔥' : o.right >= o.results.length / 2 ? 'Getting there' : 'Keep going, they will stick'}</h2>
    <p class="muted" style="margin-top:6px">The ones you got right come back later; the ones you missed come back tomorrow.</p>
    <div class="row gap wrap-r" style="justify-content:center;margin-top:16px">${o.due > 0 ? html`<button class="btn primary" data-action="rv-again" type="button">${icon('refresh', 17)} Another round (${o.due} due)</button>` : html`<span class="chip good">${icon('check', 13)} Nothing else due today</span>`}<a class="btn ghost" href="#/">Home</a></div></div>
    <h3 style="margin:20px 0 10px">Your answers</h3>
    ${qs.map((q) => { const r = by.get(q.h); if (!r) return ''; const mine = R.picks[q.h];
      return html`<div class="card" style="margin-bottom:10px"><div class="row gap-s wrap-r"><span class="chip ${r.correct ? 'good' : 'bad'}">${r.correct ? 'Right' : 'Missed'}</span><span class="chip grey">${q.course}</span></div>
        <p style="margin:8px 0"><b>${q.q}</b></p><p class="small">${r.correct ? '' : html`<span class="muted">You chose:</span> ${q.o[mine]}<br>`}<span class="muted">Answer:</span> <b>${q.o[r.answer]}</b></p>${r.why ? html`<p class="small muted" style="margin-top:6px">${r.why}</p>` : ''}</div>`; })}`;
}

export const review = {
  needsLogin: true,
  async render() {
    R.d = await api('GET', '/api/review'); R.i = 0; R.picks = {}; R.out = null; R.busy = false;
    return html`<div id="rv-root" class="page-narrow">${R.d.questions.length ? question() : empty(R.d)}</div>`;
  },
};
const redraw = () => { const el = document.getElementById('rv-root'); if (!el) return; const t = !R.d.questions.length ? empty(R.d) : R.out ? results() : question(); el.innerHTML = t.s; window.scrollTo(0, 0); };
export const actions = {
  'rv-pick'(el) { if (R.out) return; R.picks[R.d.questions[R.i].h] = Number(el.dataset.i); redraw(); },
  'rv-next'() { if (R.picks[R.d.questions[R.i].h] === undefined) return; R.i++; redraw(); },
  async 'rv-finish'(el) {
    if (R.busy) return; R.busy = true; el.disabled = true;
    try { R.out = await api('POST', '/api/review/answer', { answers: R.d.questions.map((q) => ({ h: q.h, a: R.picks[q.h] })) }); }
    catch (e) { toast(e.message || 'Could not mark your answers. Try again.'); R.busy = false; el.disabled = false; return; }
    R.busy = false; redraw();
  },
  async 'rv-again'() { try { R.d = await api('GET', '/api/review'); R.i = 0; R.picks = {}; R.out = null; redraw(); } catch (e) { toast(e.message); } },
};
