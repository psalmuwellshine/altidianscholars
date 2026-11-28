/* Ask Altidian: a study assistant inside the PDF viewer.
   The viewer already has the PDF open, so the text of the pages on screen is read here, on the student's phone, and sent
   with the question. The server decides who may ask (semester pass, free daily questions, spending cap) and talks to Claude. */
import { icon, toast } from '../core/ui.js';
import { passOn } from './pay.js';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const BUDGET = 24000; // characters of note text sent with a question (about 6,000 tokens)
const PAGE_MAX = 6000;

const STARTERS = [
  ['Explain simply', 'Explain this in simple words.'],
  ['Key points', 'Give me the key points I must remember from this.'],
  ['Exam questions', 'Give me 5 likely exam questions from this, with the answers at the end.'],
  ['Quiz me', 'Quiz me with 3 multiple-choice questions from this, with the answers at the end.'],
  ['Memory trick', 'Make a short memory trick or mnemonic for the most important facts here.'],
];
const FOLLOW = [
  ['Simpler', 'Explain that again in simpler words.'],
  ['Give an example', 'Give me an example.'],
  ['Quiz me on this', 'Quiz me on this with 3 questions, with the answers at the end.'],
];

export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export async function call(method, url, body) {
  let res;
  try { res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch (e) { const err = new Error('Could not reach the server. Check your connection and try again.'); err.status = 0; throw err; }
  let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) { const err = new Error((data && data.error) || 'Something went wrong. Please try again.'); err.status = res.status; err.data = data || {}; throw err; }
  return data;
}

/* ---- the answer, with light formatting (bullets, numbers, **bold**) built safely from text ---- */
function inline(parent, text) {
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) { parent.appendChild(el('b', '', part)); return; }
    part.split(/\*([^*\n]+)\*/g).forEach((bit, j) => { if (!bit) return; if (j % 2) parent.appendChild(el('i', '', bit)); else parent.appendChild(document.createTextNode(bit)); }); // *italic*
  });
}
export function format(text) {
  const box = el('div', 'ask-text');
  let list = null; let kind = '';
  const flush = () => { list = null; kind = ''; };
  String(text).replace(/\r/g, '').split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const b = line.match(/^[-•*]\s+(.*)$/); const n = line.match(/^(\d{1,2})[.)]\s+(.*)$/);
    if (b || n) {
      const want = b ? 'ul' : 'ol';
      if (!list || kind !== want) { list = el(want, 'ask-list'); kind = want; box.appendChild(list); }
      const li = el('li'); inline(li, (b ? b[1] : n[2])); if (n && want === 'ol') li.value = Number(n[1]); list.appendChild(li);
    } else {
      flush(); const p = el('p'); inline(p, line.replace(/^#+\s*/, '')); box.appendChild(p);
    }
  });
  return box;
}

export function addAsk({ root, body, pdf, m, S, close }) { // S = the app's state (config and the logged-in student)
  const st = { busy: false, history: [], mode: 'near', pages: new Map(), sheet: null, info: null, lastQ: '' };
  const config = () => (S && S.state && S.state.config) || {};
  const me = () => (S && S.state && S.state.user) || null;

  const fab = el('button', 'ask-fab'); fab.type = 'button'; fab.hidden = true; fab.setAttribute('aria-label', 'Ask Altidian about this note');
  fab.innerHTML = icon('spark', 18).toString(); fab.appendChild(el('span', '', 'Ask Altidian'));
  root.appendChild(fab);

  /* ---- read the pages around the one on screen ---- */
  const pageText = (n) => {
    if (!st.pages.has(n)) st.pages.set(n, pdf.getPage(n).then((pg) => pg.getTextContent()).then((tc) => tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, PAGE_MAX)).catch(() => ''));
    return st.pages.get(n);
  };
  const topPage = () => {
    const top = body.getBoundingClientRect().top; let n = 1;
    for (const s of body.querySelectorAll('.v-page')) { if (s.getBoundingClientRect().bottom > top + 40) { n = Number(s.dataset.n) || 1; break; } }
    return n;
  };
  async function gather() {
    const here = Math.min(topPage(), pdf.numPages);
    const order = [here];
    if (st.mode === 'near') for (let k = 1; k < pdf.numPages; k++) { if (here + k <= pdf.numPages) order.push(here + k); if (here - k >= 1) order.push(here - k); }
    const got = []; let used = 0;
    for (const n of order) {
      const t = await pageText(n);
      if (t.length < 15) { if (got.length === 0 && order.indexOf(n) > 6) break; continue; }
      if (used + t.length > BUDGET && got.length) break;
      got.push({ n, t }); used += t.length;
      if (used >= BUDGET) break;
    }
    got.sort((a, b) => a.n - b.n);
    return { text: got.map((g) => '[Page ' + g.n + ']\n' + g.t).join('\n\n'), pages: got.map((g) => g.n) };
  }
  const label = (p) => (!p.length ? '' : p.length === 1 ? 'page ' + p[0] : 'pages ' + p[0] + (p[p.length - 1] - p[0] === p.length - 1 ? '–' : ', …, ') + p[p.length - 1]);

  /* ---- the sheet ---- */
  function build() {
    const sheet = el('div', 'ask-sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Ask Altidian');
    sheet.innerHTML = '<div class="ask-grab"></div><div class="ask-head"><img src="/logo.png" alt="" width="26" height="30"><div class="ask-title"><b>Ask Altidian</b><span class="ask-scope"></span></div><span class="ask-left"></span><button type="button" class="ask-x" aria-label="Hide">' + icon('x', 18) + '</button></div>'
      + '<div class="ask-modes" role="group" aria-label="What to read"><button type="button" data-mode="page">This page</button><button type="button" data-mode="near" class="on">Nearby pages</button></div>'
      + '<div class="ask-log" aria-live="polite"></div><div class="ask-foot"></div><div class="ask-note">AI can make mistakes. Check important facts with your lecturer or textbook. Your question and the page text are sent to Anthropic to get an answer.</div>';
    root.appendChild(sheet); st.sheet = sheet;
    st.log = sheet.querySelector('.ask-log'); st.foot = sheet.querySelector('.ask-foot'); st.scope = sheet.querySelector('.ask-scope'); st.left = sheet.querySelector('.ask-left');
    sheet.querySelector('.ask-x').addEventListener('click', hide);
    sheet.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); hide(); } }, true);
    sheet.querySelectorAll('.ask-modes button').forEach((b) => b.addEventListener('click', () => {
      st.mode = b.dataset.mode; sheet.querySelectorAll('.ask-modes button').forEach((x) => x.classList.toggle('on', x === b));
      st.scope.textContent = st.mode === 'page' ? 'Reads the page on screen' : 'Reads the page on screen and the ones around it';
    }));
    st.scope.textContent = 'Reads the page on screen and the ones around it';
    welcome(); renderFoot();
  }
  function show() { if (!st.sheet) build(); st.sheet.hidden = false; fab.hidden = true; showLeft(); if (st.input && !st.input.disabled) st.input.focus(); }
  function hide() { if (st.sheet) st.sheet.hidden = true; fab.hidden = false; }
  fab.addEventListener('click', show);

  const showLeft = () => {
    if (!st.left || !st.info) return;
    const i = st.info; st.left.textContent = i.state === 'upsell' || i.state === 'limit' || i.state === 'resting' ? '' : i.left + (i.units ? ' left' : ' left today');
    st.left.className = 'ask-left' + (i.left <= 1 ? ' low' : '');
  };
  const scroll = () => { st.log.scrollTop = st.log.scrollHeight; };

  function welcome() {
    const w = el('div', 'ask-welcome');
    const hi = el('div', 'ask-hi'); hi.innerHTML = icon('spark', 22).toString(); w.appendChild(hi);
    w.appendChild(el('h4', '', 'What do you want to understand?'));
    w.appendChild(el('p', '', 'I read the page you are on and answer from your note. Tap one to start, or type your own question.'));
    const row = el('div', 'ask-chips'); STARTERS.forEach(([t, q]) => row.appendChild(chip(t, q))); w.appendChild(row);
    st.log.appendChild(w);
  }
  function chip(text, q) { const b = el('button', 'ask-chip', text); b.type = 'button'; b.addEventListener('click', () => ask(q)); return b; }

  function bubble(kind) { const d = el('div', 'ask-msg ' + kind); st.log.appendChild(d); return d; }
  function clearFollow() { st.log.querySelectorAll('.ask-follow').forEach((x) => x.remove()); }

  function answerBubble(text, q) {
    const wrap = el('div', 'ask-ans');
    const av = el('img', 'ask-av'); av.src = '/logo.png'; av.alt = ''; av.width = 22; av.height = 25; wrap.appendChild(av);
    const col = el('div', 'ask-col'); const card = el('div', 'ask-msg a'); card.appendChild(format(text)); col.appendChild(card);
    const bar = el('div', 'ask-acts');
    const mk = (ic, label, fn) => { const b = el('button', 'ask-act'); b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = icon(ic, 16).toString(); b.title = label; b.addEventListener('click', () => fn(b)); return b; };
    const copy = mk('copy', 'Copy answer', async () => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Could not copy. Press and hold the text instead.', 'bad'); } });
    let rated = false;
    const rate = (rating, note) => call('POST', '/api/ai/feedback', { file: m.fileId, title: m.title, rating, question: q, answer: text, note: note || '' }).catch(() => {});
    const up = mk('thumbup', 'Good answer', (b) => { if (rated) return; rated = true; b.classList.add('on'); down.disabled = true; rate('up'); toast('Thanks for the feedback.'); });
    const down = mk('thumbdown', 'Not a good answer', (b) => { if (rated) return; rated = true; b.classList.add('on'); up.disabled = true; rate('down'); toast('Thanks. We will check this answer.'); });
    const flag = mk('flag', 'Report a wrong answer', () => {
      if (col.querySelector('.ask-report')) return;
      const f = el('form', 'ask-report'); const inp = el('input'); inp.type = 'text'; inp.maxLength = 300; inp.placeholder = 'What is wrong? (optional)'; inp.enterKeyHint = 'send';
      const go = el('button', '', 'Send'); go.type = 'submit'; f.appendChild(inp); f.appendChild(go);
      f.addEventListener('submit', (ev) => { ev.preventDefault(); rate('report', inp.value.trim()); f.remove(); toast('Reported. Thank you.'); flag.disabled = true; });
      col.appendChild(f); inp.focus();
    });
    [copy, up, down, flag].forEach((b) => bar.appendChild(b)); col.appendChild(bar);
    wrap.appendChild(col); st.log.appendChild(wrap);
    const fol = el('div', 'ask-chips ask-follow'); FOLLOW.forEach(([t, qq]) => fol.appendChild(chip(t, qq))); st.log.appendChild(fol);
  }

  /* ---- the bottom of the sheet: the question box, or the pass offer ---- */
  function renderFoot() {
    const i = st.info || {}; st.foot.textContent = '';
    if (i.state === 'upsell' || i.state === 'limit' || i.state === 'resting') {
      const box = el('div', 'ask-upsell');
      if (i.state === 'resting') { box.appendChild(el('b', '', 'Ask Altidian is resting')); box.appendChild(el('p', '', i.message || 'It is resting until next month. Please check back soon.')); }
      else if (i.state === 'limit') { box.appendChild(el('b', '', 'That is all for today')); box.appendChild(el('p', '', i.message || 'Your questions come back tomorrow.')); }
      else {
        const price = passOn(config(), me());
        const buyer = i.plan === 'buyer'; const upto = i.buyerLimit || 5;
        box.appendChild(el('b', '', buyer ? 'That is all for today' : i.limit > 0 ? 'You have used today’s free questions' : 'Ask Altidian is for students with a paid note or pass'));
        if (price) {
          box.appendChild(el('p', '', 'The semester pass unlocks every paid note and quiz, and gives you up to ' + (i.passLimit || 10) + ' Ask Altidian questions every day.'));
          const b = el('button', 'btn gold block', 'Get the semester pass · ' + naira(price)); b.type = 'button'; b.addEventListener('click', getPass); box.appendChild(b);
        } else if (!buyer) {
          box.appendChild(el('p', '', 'Buy any paid note or pack and you get up to ' + upto + ' Ask Altidian questions every day.' + (i.limit > 0 ? ' Your free questions come back tomorrow.' : '')));
          const b = el('button', 'btn gold block', 'See paid notes and packs'); b.type = 'button'; b.addEventListener('click', () => { close(); setTimeout(() => { location.hash = '#/library'; }, 300); }); box.appendChild(b);
        } else box.appendChild(el('p', '', 'Your questions come back tomorrow.'));
      }
      if (i.state !== 'resting' && config().paystack && (i.packs || []).length) {
        const u = el('button', 'btn ghost block', 'Get units (never expire)'); u.type = 'button'; u.addEventListener('click', () => { close(); setTimeout(() => { location.hash = '#/ask'; }, 300); }); box.appendChild(u);
      }
      st.foot.appendChild(box); st.input = null; return;
    }
    const form = el('form', 'ask-form'); const inp = el('input'); inp.type = 'text'; inp.maxLength = 500; inp.placeholder = 'Ask about this note…'; inp.enterKeyHint = 'send'; inp.autocomplete = 'off';
    const go = el('button', 'ask-send'); go.type = 'submit'; go.setAttribute('aria-label', 'Send'); go.innerHTML = icon('send', 18).toString();
    form.appendChild(inp); form.appendChild(go); st.foot.appendChild(form); st.input = inp; st.send = go;
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const q = inp.value.trim(); if (q.length < 3) return; inp.value = ''; ask(q); });
  }
  function getPass() {
    close();
    setTimeout(() => { const b = document.createElement('button'); b.dataset.action = 'getpass'; b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); }, 500);
  }

  async function ask(q) {
    if (st.busy || !st.info || !(st.info.left > 0)) return;
    st.busy = true; if (st.send) st.send.disabled = true; if (st.input) st.input.disabled = true;
    clearFollow(); const w = st.log.querySelector('.ask-welcome'); if (w) w.remove();
    bubble('q').textContent = q;
    const wait = el('div', 'ask-ans'); const dots = el('div', 'ask-msg a ask-dots'); dots.innerHTML = '<i></i><i></i><i></i>'; wait.appendChild(dots); st.log.appendChild(wait); scroll();
    try {
      const ctx = await gather();
      if (ctx.text.length < 40) throw Object.assign(new Error('This PDF is made of scanned pictures, so Ask Altidian cannot read it.'), { status: 0 });
      st.scope.textContent = 'Reading ' + label(ctx.pages);
      const out = await call('POST', '/api/ai/ask', { file: m.fileId, title: m.title, question: q, context: ctx.text, history: st.history.slice(-3) });
      wait.remove(); answerBubble(out.answer, q);
      st.history.push({ q, a: out.answer });
      Object.assign(st.info, { remaining: out.remaining, units: out.units, left: out.left, plan: out.plan }); if (out.left <= 0) st.info.state = st.info.plan === 'pass' ? 'limit' : 'upsell';
    } catch (e) {
      wait.remove();
      if (e.status === 429 && e.data && (e.data.reason === 'upsell' || e.data.reason === 'limit')) { Object.assign(st.info, { remaining: 0, units: 0, left: 0, state: e.data.reason }); }
      else if (e.status === 503 && /resting/i.test(e.message)) { st.info.state = 'resting'; st.info.message = e.message; }
      else { const d = bubble('err'); d.textContent = e.message || 'Something went wrong. Please try again.'; }
    }
    st.busy = false; showLeft(); renderFoot(); scroll();
    if (st.input) st.input.focus();
  }

  /* ---- find out whether Ask Altidian is on for this note, then show the button ---- */
  (async () => {
    try { st.info = await call('GET', '/api/ai/status?file=' + encodeURIComponent(m.fileId)); } catch (e) { return; }
    if (!st.info || st.info.state === 'off') return;
    if (!root.isConnected) return;
    fab.hidden = false;
  })();
}
