/* The AI tab: learn something without opening a note. "Teach me" leads a lesson step by step; "Ask a question" answers one.
   Answers here come from general knowledge (no note is attached) and the screen says so. Each turn costs 1 unit:
   today's free allowance is used first, then units the student bought. */
import { html, icon, toast, dialog, api } from '../core/ui.js';
import { el, call, format } from './ask.js';
import * as V from '../core/voice.js';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const PLAN = { free: 'Free', buyer: 'Buyer', pass: 'Semester pass' };
const IDEAS = ['Glycolysis', 'The cardiac cycle', 'Types of anaemia', 'Gram staining', 'Renal tubular function'];
const keyOf = (u) => 'alt-tutor:' + (u ? u.id : 'guest');
const T = { mode: 'teach', topic: '', history: [], info: null, busy: false };
let msgSeq = 0;
const autoOn = () => { try { return localStorage.getItem('alt-tutor-auto') === '1'; } catch (e) { return false; } };
const setAuto = (v) => { try { localStorage.setItem('alt-tutor-auto', v ? '1' : '0'); } catch (e) { /* private mode */ } };

function saveChat(u) { try { sessionStorage.setItem(keyOf(u), JSON.stringify({ mode: T.mode, topic: T.topic, history: T.history.slice(-20) })); } catch (e) { /* private mode */ } }
function loadChat(u) {
  try { const d = JSON.parse(sessionStorage.getItem(keyOf(u)) || 'null'); if (d && Array.isArray(d.history)) { T.mode = d.mode === 'ask' ? 'ask' : 'teach'; T.topic = String(d.topic || ''); T.history = d.history.filter((h) => h && typeof h.q === 'string' && typeof h.a === 'string').slice(-20); return; } } catch (e) { /* none */ }
  T.history = []; T.topic = '';
}

export const tutor = {
  needsLogin: true,
  async render({ S, user }) {
    const u = user(); loadChat(u);
    try { T.info = await call('GET', '/api/ai/status'); } catch (e) { T.info = null; }
    return html`<div class="tutor-wrap"><div class="tutor" id="tutor" data-state="${T.info ? T.info.state : 'off'}"></div></div>`;
  },
  after({ S, user, config }, view) { build(view.querySelector('#tutor'), S, user(), config()); },
};

function build(root, S, u, c) {
  if (!root) return;
  const info = () => T.info || { state: 'off', left: 0, remaining: 0, units: 0, plan: 'free', packs: [] };
  root.textContent = '';
  const head = el('div', 'tutor-head');
  head.innerHTML = '<div class="tutor-logo">' + icon('spark', 20).toString() + '</div>';
  const ttl = el('div', 'ask-title'); ttl.appendChild(el('b', '', 'Ask Altidian')); const sub = el('span', 'ask-scope', 'Learn any topic, step by step'); ttl.appendChild(sub); head.appendChild(ttl);
  const pill = el('button', 'ask-left tutor-pill'); pill.type = 'button'; pill.setAttribute('aria-label', 'Your questions and units'); head.appendChild(pill);
  const callBtn = el('button', 'ask-x tutor-call'); callBtn.type = 'button'; callBtn.setAttribute('aria-label', 'Call Ask Altidian by voice'); callBtn.title = 'Voice call'; callBtn.innerHTML = icon('phone', 18).toString();
  if (info().state !== 'off' && info().callOn !== false) head.appendChild(callBtn);
  const fresh = el('button', 'ask-x'); fresh.type = 'button'; fresh.setAttribute('aria-label', 'Start a new topic'); fresh.title = 'New topic'; fresh.innerHTML = icon('plus', 18).toString(); head.appendChild(fresh);
  root.appendChild(head);

  const bar = el('div', 'tutor-bar'); const modes = el('div', 'ask-modes');
  [['teach', 'Teach me'], ['ask', 'Ask a question']].forEach(([k, t]) => { const b = el('button', k === T.mode ? 'on' : '', t); b.type = 'button'; b.dataset.mode = k; modes.appendChild(b); });
  bar.appendChild(modes);
  if (V.canSpeak()) {
    const auto = el('button', 'tutor-auto'); auto.type = 'button'; auto.setAttribute('aria-pressed', autoOn() ? 'true' : 'false'); auto.title = 'Read every reply aloud automatically';
    const paint = () => { auto.classList.toggle('on', autoOn()); auto.setAttribute('aria-pressed', autoOn() ? 'true' : 'false'); auto.innerHTML = icon('volume', 16).toString() + '<span>' + (autoOn() ? 'Auto-read on' : 'Auto-read') + '</span>'; };
    auto.addEventListener('click', () => { setAuto(!autoOn()); if (!autoOn()) V.stop(); paint(); toast(autoOn() ? 'New replies will be read aloud.' : 'Auto-read is off.'); }); paint(); bar.appendChild(auto);
  }
  root.appendChild(bar);
  window.addEventListener('hashchange', () => V.stop(), { once: true });
  const log = el('div', 'ask-log tutor-log'); log.setAttribute('aria-live', 'polite'); root.appendChild(log);
  const foot = el('div', 'ask-foot'); root.appendChild(foot);
  const note = el('div', 'ask-note', 'From general knowledge, not from your Altidian notes. AI can make mistakes, so check important facts with your lecturer or textbook. Your messages are sent to Anthropic to get an answer.'); root.appendChild(note);

  const scroll = () => { // show the start of the newest answer if it is long, otherwise the bottom
    const answers = log.querySelectorAll('.ask-ans'); const a = answers[answers.length - 1];
    if (a && !a.querySelector('.ask-dots') && a.offsetHeight > log.clientHeight - 90) log.scrollTop = Math.max(0, a.offsetTop - log.offsetTop - 70); else log.scrollTop = log.scrollHeight;
  };
  const planLine = () => { const i = info(); return PLAN[i.plan] || 'Free'; };
  const showPill = () => {
    const i = info(); if (i.state === 'off') { pill.hidden = true; return; }
    pill.hidden = false; pill.textContent = i.left + (i.left === 1 ? ' turn left' : ' turns left'); pill.className = 'ask-left tutor-pill' + (i.left <= 1 ? ' low' : '');
    pill.title = planLine() + ': ' + i.remaining + ' free today + ' + i.units + ' units';
  };
  pill.addEventListener('click', () => balanceDialog(S, c, info, () => reload()));

  function welcome() {
    const w = el('div', 'ask-welcome');
    const hi = el('div', 'ask-hi'); hi.innerHTML = icon('spark', 22).toString(); w.appendChild(hi);
    w.appendChild(el('h4', '', T.mode === 'teach' ? 'What do you want to learn?' : 'What is your question?'));
    w.appendChild(el('p', '', T.mode === 'teach' ? 'Type a topic and I will teach it in small steps, checking you as we go. No note needed.' : 'Ask anything about your course. I answer, then I can teach it step by step.'));
    const row = el('div', 'ask-chips'); IDEAS.forEach((t) => { const b = el('button', 'ask-chip', t); b.type = 'button'; b.addEventListener('click', () => send(t)); row.appendChild(b); }); w.appendChild(row);
    log.appendChild(w);
  }
  function answer(text, q, related) {
    const wrap = el('div', 'ask-ans');
    const av = el('img', 'ask-av'); av.src = '/logo.png'; av.alt = ''; av.width = 22; av.height = 25; wrap.appendChild(av);
    const col = el('div', 'ask-col'); const card = el('div', 'ask-msg a'); card.appendChild(format(text)); col.appendChild(card);
    if (related && related.length) {
      const r = el('div', 'tutor-rel'); r.appendChild(el('span', '', 'On Altidian:'));
      related.forEach((x) => { const a = el('a', 'ask-chip', x.title + (x.paid ? ' 🔒' : '')); a.href = '#/library'; r.appendChild(a); });
      col.appendChild(r);
    }
    const bar = el('div', 'ask-acts');
    const mk = (ic, label, fn) => { const b = el('button', 'ask-act'); b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = icon(ic, 16).toString(); b.title = label; b.addEventListener('click', () => fn(b)); return b; };
    let rated = false;
    const rate = (rating, nt) => call('POST', '/api/ai/feedback', { file: '', title: 'AI tab: ' + (T.topic || 'question'), rating, question: q, answer: text, note: nt || '' }).catch(() => {});
    const copy = mk('copy', 'Copy answer', async () => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Could not copy. Press and hold the text instead.', 'bad'); } });
    const up = mk('thumbup', 'Good answer', (b) => { if (rated) return; rated = true; b.classList.add('on'); down.disabled = true; rate('up'); toast('Thanks for the feedback.'); });
    const down = mk('thumbdown', 'Not a good answer', (b) => { if (rated) return; rated = true; b.classList.add('on'); up.disabled = true; rate('down'); toast('Thanks. We will check this answer.'); });
    const flag = mk('flag', 'Report a wrong answer', () => {
      if (col.querySelector('.ask-report')) return;
      const f = el('form', 'ask-report'); const inp = el('input'); inp.type = 'text'; inp.maxLength = 300; inp.placeholder = 'What is wrong? (optional)'; inp.enterKeyHint = 'send';
      const go = el('button', '', 'Send'); go.type = 'submit'; f.appendChild(inp); f.appendChild(go);
      f.addEventListener('submit', (ev) => { ev.preventDefault(); rate('report', inp.value.trim()); f.remove(); toast('Reported. Thank you.'); flag.disabled = true; });
      col.appendChild(f); inp.focus();
    });
    const key = 'm' + (++msgSeq);
    if (V.canSpeak()) {
      const vb = mk('volume', 'Read this answer aloud', () => { if (V.nowPlaying() === key) V.stop(); else V.speak(text, key); });
      const unsub = V.onChange((k) => { if (!vb.isConnected) { unsub(); return; } const on = k === key; vb.classList.toggle('on', on); vb.innerHTML = icon(on ? 'stop' : 'volume', 16).toString(); vb.title = on ? 'Stop reading' : 'Read this answer aloud'; vb.setAttribute('aria-label', vb.title); });
      bar.appendChild(vb);
    }
    [copy, up, down, flag].forEach((b) => bar.appendChild(b)); col.appendChild(bar); wrap.appendChild(col); log.appendChild(wrap);
    return key;
  }
  function followChips() {
    log.querySelectorAll('.ask-follow').forEach((x) => x.remove());
    if (!T.history.length || info().left <= 0) return;
    const fol = el('div', 'ask-chips ask-follow');
    const set = T.mode === 'teach' ? [['Next', 'Next, please.'], ['Explain differently', 'I did not understand. Explain it a different way.'], ['Quiz me', 'Give me 5 practice questions on this topic.']] : [['Teach me this', 'Teach me this step by step.'], ['Simpler', 'Explain that again in simpler words.'], ['Give an example', 'Give me an example.']];
    set.forEach(([t, q]) => { const b = el('button', 'ask-chip', t); b.type = 'button'; b.addEventListener('click', () => send(q)); fol.appendChild(b); });
    log.appendChild(fol);
  }
  function redraw() {
    log.textContent = '';
    if (!T.history.length) welcome();
    T.history.forEach((h) => { el('div', 'ask-msg q'); const q = el('div', 'ask-msg q', h.q); log.appendChild(q); answer(h.a, h.q, h.related); });
    followChips(); scroll();
  }

  /* ---- bottom: the box, or what to do when today's turns and units are used up ---- */
  function renderFoot() {
    const i = info(); foot.textContent = '';
    if (i.state === 'off') { const b = el('div', 'ask-upsell'); b.appendChild(el('b', '', 'Ask Altidian is not switched on yet')); b.appendChild(el('p', '', 'Please check back soon.')); foot.appendChild(b); return; }
    if (i.state === 'resting') { const b = el('div', 'ask-upsell'); b.appendChild(el('b', '', 'Ask Altidian is resting')); b.appendChild(el('p', '', i.message || 'It is resting until next month. Please check back soon.')); foot.appendChild(b); return; }
    if (i.left <= 0) { foot.appendChild(outOf(S, c, i, () => reload())); return; }
    const form = el('form', 'ask-form'); const inp = el('input'); inp.type = 'text'; inp.maxLength = 500; inp.enterKeyHint = 'send'; inp.autocomplete = 'off';
    inp.placeholder = !T.history.length ? (T.mode === 'teach' ? 'Type a topic, e.g. Glycolysis' : 'Type your question') : (T.mode === 'teach' ? 'Answer, or type next' : 'Ask a follow-up');
    const go = el('button', 'ask-send'); go.type = 'submit'; go.setAttribute('aria-label', 'Send'); go.innerHTML = icon('send', 18).toString();
    form.appendChild(inp); form.appendChild(go); foot.appendChild(form); T.input = inp; T.send = go;
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const q = inp.value.trim(); if (q.length < 2) return; inp.value = ''; send(q); });
  }

  async function send(q) {
    if (T.busy || info().left <= 0) return;
    T.busy = true; if (T.send) T.send.disabled = true; if (T.input) T.input.disabled = true;
    if (!T.history.length) T.topic = q.slice(0, 120);
    const w = log.querySelector('.ask-welcome'); if (w) w.remove(); log.querySelectorAll('.ask-follow').forEach((x) => x.remove());
    log.appendChild(el('div', 'ask-msg q', q));
    const wait = el('div', 'ask-ans'); const dots = el('div', 'ask-msg a ask-dots'); dots.innerHTML = '<i></i><i></i><i></i>'; wait.appendChild(dots); log.appendChild(wait); scroll();
    try {
      const out = await call('POST', '/api/ai/tutor', { mode: T.mode, topic: T.topic, message: q, history: T.history.slice(-6).map((h) => ({ q: h.q, a: h.a })) });
      wait.remove(); const k = answer(out.answer, q, out.related); if (autoOn() && k) V.speak(out.answer, k);
      T.history.push({ q, a: out.answer, related: out.related || [] });
      Object.assign(info(), { left: out.left, remaining: out.remaining, units: out.units, plan: out.plan }); if (out.left <= 0) T.info.state = out.plan === 'pass' ? 'limit' : 'upsell';
      saveChat(u);
    } catch (e) {
      wait.remove();
      if (e.status === 429 && e.data && (e.data.reason === 'upsell' || e.data.reason === 'limit')) { T.info = Object.assign(info(), { left: 0, remaining: 0, units: 0, state: e.data.reason }); }
      else if (e.status === 503 && /resting/i.test(e.message)) { T.info = Object.assign(info(), { state: 'resting', message: e.message }); }
      else log.appendChild(el('div', 'ask-msg err', e.message || 'Something went wrong. Please try again.'));
    }
    T.busy = false; showPill(); renderFoot(); followChips(); scroll(); if (T.input) T.input.focus();
  }
  async function reload() { try { T.info = await call('GET', '/api/ai/status'); } catch (e) { /* keep what we have */ } showPill(); renderFoot(); followChips(); }

  modes.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (T.history.length && T.mode !== b.dataset.mode) { /* switching mid-chat is fine: the next turn follows the new mode */ }
    T.mode = b.dataset.mode; modes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); saveChat(u);
    if (!T.history.length) { log.textContent = ''; welcome(); } renderFoot();
  }));
  fresh.addEventListener('click', () => { if (T.busy) return; V.stop(); T.history = []; T.topic = ''; saveChat(u); redraw(); renderFoot(); toast('New topic. What do you want to learn?'); });

  /* ---- voice call: talk to the AI instead of typing. Optional, and paid for with units. ---- */
  callBtn.addEventListener('click', () => {
    const i = info(); V.stop();
    if (T.busy) return;
    if (i.callOn === false) { toast('Voice calls are switched off for now.'); return; }
    if (!V.canListen() || !V.canSpeak()) {
      dialog(html`<h3>${icon('phone', 20)} Voice call</h3><p style="margin:12px 0">This browser cannot do voice calls. Chrome on an Android phone works best. You can still tap the speaker icon under any answer to hear it read aloud.</p><div class="row end"><button class="btn ghost" data-close type="button">Close</button></div>`); return;
    }
    if (i.units < i.callCost) {
      const { box } = dialog(html`<h3>${icon('phone', 20)} Voice call</h3><p style="margin:12px 0">A voice call uses <b>${i.callCost} unit${i.callCost === 1 ? '' : 's'}</b> for each reply, and you have <b>${i.units}</b>. Free daily turns do not cover calls. Units never expire.</p><div class="row gap-s wrap-r"><button class="btn gold" data-units type="button">${icon('plus', 16)} Get units</button><button class="btn ghost" data-close type="button">Close</button></div>`);
      box.querySelector('[data-units]').addEventListener('click', () => { box.querySelector('[data-close]').click(); unitsDialog(S, c, i, () => reload()); }); return;
    }
    const { box } = dialog(html`<h3>${icon('phone', 20)} Call Ask Altidian</h3>
      <p style="margin:12px 0">Talk and it talks back, like a phone call. Each reply from Ask Altidian uses <b>${i.callCost} unit${i.callCost === 1 ? '' : 's'}</b> (you have ${i.units}).</p>
      <p class="small muted">Your phone turns your voice into text (in Chrome this is done by Google), and the text is sent to Anthropic to get the answer. Nothing is recorded by Altidian. Allow the microphone when asked.</p>
      <div class="row gap-s wrap-r" style="margin-top:14px"><button class="btn primary" data-go type="button">${icon('phone', 17)} Start call</button><button class="btn ghost" data-close type="button">Not now</button></div>`);
    box.querySelector('[data-go]').addEventListener('click', () => { box.querySelector('[data-close]').click(); openCall(); });
  });

  function openCall() {
    const cs = { active: true, muted: false, silent: 0, turns: 0, rec: null, heard: '', t0: Date.now(), state: '' };
    const ov = el('div', 'call'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Voice call with Ask Altidian');
    ov.innerHTML = '<div class="call-top"><b>Ask Altidian</b><span class="call-time">0:00</span></div>'
      + '<button class="call-orb" type="button" aria-label="Tap to interrupt or to speak"><img src="/logo.png" alt="" width="64" height="72"></button>'
      + '<p class="call-status" aria-live="polite"></p><div class="call-cap" aria-live="polite"></div>'
      + '<p class="call-cost"></p>'
      + '<div class="call-btns"><button class="call-btn mute" type="button" aria-label="Mute microphone">' + icon('mic', 24).toString() + '</button><button class="call-btn end" type="button" aria-label="End call">' + icon('phone', 24).toString() + '</button></div>'
      + '<p class="call-help">Tap the circle to interrupt or to speak.</p>';
    document.body.appendChild(ov); document.body.classList.add('call-open');
    const $ = (q) => ov.querySelector(q); const orb = $('.call-orb'); const statusEl = $('.call-status'); const cap = $('.call-cap'); const muteBtn = $('.mute');
    const label = { listening: 'Listening… speak now', thinking: 'Thinking…', speaking: 'Speaking…', muted: 'Microphone is off. Tap the circle to speak.' };
    const setState = (st) => { cs.state = st; ov.dataset.state = st; statusEl.textContent = label[st] || ''; };
    const caption = (txt, who) => { cap.textContent = txt; cap.dataset.who = who; cap.scrollTop = 0; };
    const costLine = () => { const i = info(); $('.call-cost').textContent = i.callCost + ' unit' + (i.callCost === 1 ? '' : 's') + ' per reply · ' + i.units + ' unit' + (i.units === 1 ? '' : 's') + ' left'; };
    costLine();
    const timer = setInterval(() => { const sec = Math.floor((Date.now() - cs.t0) / 1000); $('.call-time').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); if (sec > 30 * 60) endCall('The call reached the 30 minute limit. Start another when you are ready.'); }, 1000);

    function endCall(msg) {
      if (!cs.active) return; cs.active = false; clearInterval(timer);
      if (cs.rec) { cs.rec.stop(); cs.rec = null; } V.stop();
      document.removeEventListener('visibilitychange', onHide); document.removeEventListener('keydown', onKey);
      ov.remove(); document.body.classList.remove('call-open');
      toast(msg || 'Call ended. It is saved in your chat.'); redraw(); reload(); if (T.input) T.input.blur();
    }
    const onHide = () => { if (document.hidden) endCall('The call ended because the screen went off or you left the page.'); };
    const onKey = (ev) => { if (ev.key === 'Escape') endCall(); };
    document.addEventListener('visibilitychange', onHide); document.addEventListener('keydown', onKey);

    function say(text, then) { caption(V.plain(text), 'ai'); setState('speaking'); V.speak(text, 'call', then ? () => { if (cs.active) then(); } : null); }
    function hear() {
      if (!cs.active) return;
      if (cs.muted) { setState('muted'); return; }
      setState('listening'); cs.heard = '';
      cs.rec = V.listen({
        lang: 'en-NG',
        onInterim: (t) => caption(t, 'you'),
        onFinal: (t) => { cs.heard = t; },
        onEnd: () => {
          cs.rec = null; if (!cs.active || cs.state !== 'listening') return;
          if (cs.heard) { const t = cs.heard; cs.heard = ''; cs.silent = 0; ask(t); return; }
          cs.silent++;
          if (cs.silent >= 4) return endCall('Nobody spoke for a while, so the call ended.');
          if (cs.silent === 2) say('Are you still there?', hear); else hear();
        },
        onError: (e) => {
          if (e === 'no-speech' || e === 'aborted') return;
          if (e === 'not-allowed' || e === 'service-not-allowed') endCall('The microphone is blocked. Allow the microphone for this site in your browser settings, then call again.');
          else if (e === 'network') endCall('Voice calls need an internet connection. Check your data and call again.');
          else if (e === 'audio-capture') endCall('No microphone was found on this phone.');
        },
      });
    }
    async function ask(text) {
      setState('thinking'); caption(text, 'you');
      if (!T.history.length) T.topic = text.slice(0, 120);
      try {
        const out = await call('POST', '/api/ai/tutor', { mode: 'call', topic: T.topic, message: text, history: T.history.slice(-6).map((h) => ({ q: h.q, a: h.a })) });
        if (!cs.active) return;
        T.history.push({ q: text, a: out.answer, related: [] }); saveChat(u); cs.turns++;
        Object.assign(info(), { left: out.left, remaining: out.remaining, units: out.units, plan: out.plan }); costLine(); showPill();
        if (out.units < out.callCost) { say(out.answer, () => endCall('You have used all your units for calls. Get more units to keep talking.')); return; }
        if (cs.turns >= 60) { say(out.answer, () => endCall('That was a long call, so it ended. Start another any time.')); return; }
        say(out.answer, hear);
      } catch (e) {
        if (!cs.active) return;
        if (e.status === 429 && e.data && e.data.reason === 'units') { Object.assign(info(), { units: e.data.units || 0, left: e.data.left || 0 }); return endCall('You are out of units for calls. Get more units to keep talking.'); }
        if (e.status === 403 || (e.status === 503 && /resting/i.test(e.message))) return endCall(e.message);
        say('Sorry, something went wrong. Please say that again.', hear);
      }
    }
    orb.addEventListener('click', () => {
      if (cs.state === 'speaking') { V.stop(); hear(); }
      else if (cs.state === 'muted') { cs.muted = false; muteBtn.classList.remove('on'); muteBtn.innerHTML = icon('mic', 24).toString(); hear(); }
    });
    muteBtn.addEventListener('click', () => {
      cs.muted = !cs.muted; muteBtn.classList.toggle('on', cs.muted); muteBtn.innerHTML = icon(cs.muted ? 'micoff' : 'mic', 24).toString(); muteBtn.setAttribute('aria-pressed', cs.muted ? 'true' : 'false');
      if (cs.muted) { if (cs.rec) { cs.rec.stop(); cs.rec = null; } if (cs.state === 'listening') setState('muted'); } else if (cs.state === 'muted') hear();
    });
    $('.end').addEventListener('click', () => endCall());
    $('.end').focus();
    say(T.history.length ? 'Welcome back. Tell me what you want to continue with.' : 'Hello, this is Ask Altidian. What would you like to learn today?', hear);
  }

  showPill(); redraw(); renderFoot();
}

/* ---- out of turns: what each plan can do next ---- */
function outOf(S, c, i, after) {
  const box = el('div', 'ask-upsell'); const free = i.plan === 'free'; const buyer = i.plan === 'buyer';
  box.appendChild(el('b', '', i.state === 'upsell' || free || buyer ? 'You have used today’s free turns' : 'That is all for today'));
  box.appendChild(el('p', '', 'Your free turns come back tomorrow. Units never expire, so you can keep learning now and use them whenever you like.'));
  const b = el('button', 'btn gold block', 'Get units'); b.type = 'button'; b.addEventListener('click', () => unitsDialog(S, c, i, after)); box.appendChild(b);
  if (free) { const h = el('p', 'tiny', 'Buy any paid note or pack and you get more free turns every day.'); box.appendChild(h); }
  return box;
}
function balanceDialog(S, c, info, after) {
  const i = info();
  const { box } = dialog(html`<h3>${icon('spark', 20)} Your turns</h3>
    <div class="unit-sum"><div><b>${i.remaining}</b><span>free today</span></div><div><b>${i.units}</b><span>units</span></div><div><b>${i.left}</b><span>turns in all</span></div></div>
    <p class="small muted" style="margin:10px 0">You are on the <b>${PLAN[i.plan] || 'Free'}</b> plan: ${i.limit} free ${i.limit === 1 ? 'turn' : 'turns'} a day. Each question or lesson step is 1 turn. Free turns are used first, then units. Units never expire.</p>
    <div class="row gap-s wrap-r"><button class="btn gold" data-units type="button">${icon('plus', 16)} Get units</button><button class="btn ghost" data-close type="button">Close</button></div>`);
  box.querySelector('[data-units]').addEventListener('click', () => { box.querySelector('[data-close]').click(); unitsDialog(S, c, i, after); });
}
function unitsDialog(S, c, i, after) {
  const packs = i.packs || [];
  if (!c.paystack) {
    dialog(html`<h3>${icon('spark', 20)} Get units</h3><p style="margin:12px 0">Online payment is not switched on yet. Please contact an admin to get units.</p><div class="row end"><button class="btn ghost" data-close type="button">Close</button></div>`); return;
  }
  let email = ''; try { email = localStorage.getItem('alt-pay-email') || ''; } catch (e) { /* private mode */ }
  const { box } = dialog(html`<h3>${icon('spark', 20)} Get units</h3>
    <p class="muted small" style="margin:4px 0 12px">1 unit = 1 question or lesson step. Units never expire. Used units are not refundable.</p>
    ${packs.map((p, n) => html`<label class="plan ${n === 1 ? 'on' : ''}"><input type="radio" name="pack" value="${p.id}" ${n === 1 ? 'checked' : ''}><span class="grow"><b>${p.name}</b><br><span class="small muted">${p.units} units · about ${Math.max(1, Math.round(p.units / 10))} ${Math.round(p.units / 10) === 1 ? 'topic' : 'topics'}</span></span><b>${naira(p.price)}</b></label>`)}
    <label class="field" style="margin-top:12px"><span>Your email (your receipt is sent here)</span><input type="email" name="payemail" autocomplete="email" inputmode="email" placeholder="you@gmail.com" value="${email}"></label>
    <button class="btn primary block" data-pay type="button">${icon('lock', 17)} Pay online</button>
    <p class="tiny muted" style="margin-top:8px">Card, bank transfer, USSD or bank app on Paystack's secure page. Altidian never sees your card details.</p>
    <div class="row end" style="margin-top:12px"><button class="btn ghost" data-close type="button">Close</button></div>`);
  box.addEventListener('change', () => box.querySelectorAll('.plan').forEach((p) => p.classList.toggle('on', p.querySelector('input').checked)));
  box.querySelector('[data-pay]').addEventListener('click', (ev) => {
    const em = String((box.querySelector('input[name=payemail]') || {}).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return toast('Enter a valid email address. Your receipt is sent there.');
    const id = (box.querySelector('input[name=pack]:checked') || {}).value; const btn = ev.currentTarget; btn.disabled = true;
    api('POST', '/api/pay/start', { kind: 'units', itemId: id, email: em })
      .then((r) => { try { localStorage.setItem('alt-pay-email', em); } catch (e) { /* private mode */ } location.href = r.url; })
      .catch((er) => { toast(er.message || 'Could not start the payment.'); btn.disabled = false; });
  });
}
export const actions = {};
