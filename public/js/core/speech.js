/* Read-aloud for Altidian, using the voice built into the phone (free, nothing to download from our server).
   One player at a time: start / pause / resume / stop, with a speed setting that is remembered. */
const synth = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window ? window.speechSynthesis : null;
export const canSpeak = () => !!synth;

const RATES = [0.8, 1, 1.2, 1.5];
let rate = 1;
try { const r = Number(localStorage.getItem('alt-voice-rate')); if (RATES.includes(r)) rate = r; } catch (e) { /* private mode */ }
export const rateLabel = () => (rate === 1 ? '1×' : rate + '×');
export function nextRate() { rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]; try { localStorage.setItem('alt-voice-rate', String(rate)); } catch (e) { /* ignore */ } return rate; }

let voice = null;
function pickVoice() {
  if (!synth) return null;
  const vs = synth.getVoices ? synth.getVoices() : []; if (!vs.length) return null;
  const en = vs.filter((v) => /^en[-_]/i.test(v.lang));
  const score = (v) => (/en[-_]NG/i.test(v.lang) ? 5 : /en[-_]GB/i.test(v.lang) ? 4 : /en[-_]US/i.test(v.lang) ? 3 : 1) + (/natural|enhanced|premium|google|neural/i.test(v.name) ? 2 : 0) + (v.localService ? 0.5 : 0);
  return en.sort((a, b) => score(b) - score(a))[0] || null;
}
if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', () => { voice = pickVoice(); });
voice = pickVoice();

/* Make written science easier to hear: symbols, abbreviations, blanks. */
export function clean(t) {
  const map = { '⁺': ' plus', '⁻': ' minus', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '²': ' squared', '³': ' cubed', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'Δ': 'delta', 'μ': 'micro', 'λ': 'lambda', 'σ': 'sigma', '→': ' to ', '←': ' from ', '↑': ' increased ', '↓': ' decreased ', '–': ', ', '—': ', ', '≥': ' at least ', '≤': ' at most ', '×': ' times ', '°C': ' degrees Celsius', '%': ' percent', '&': ' and ', '·': '. ', '“': '"', '”': '"', '’': "'", '‘': "'" };
  let s = String(t == null ? '' : t);
  for (const k of Object.keys(map)) s = s.split(k).join(map[k]);
  s = s.replace(/_{2,}|\.{4,}/g, ' blank ')
    .replace(/\be\.g\./gi, 'for example').replace(/\bi\.e\./gi, 'that is').replace(/\betc\./gi, 'and so on').replace(/\bvs\.?\b/gi, 'versus')
    .replace(/([A-Za-z])\/([A-Za-z])/g, '$1 or $2').replace(/\bmL\b/g, 'millilitres').replace(/\bmg\b/g, 'milligrams')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 to $2').replace(/[*#`~^|<>[\]{}]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
function chunks(text) {
  const out = []; const parts = clean(text).split(/(?<=[.!?;:])\s+|\n+/);
  let cur = '';
  for (const p of parts) {
    if (!p) continue;
    if ((cur + ' ' + p).length > 170 && cur) { out.push(cur); cur = p; } else cur = cur ? cur + ' ' + p : p;
    while (cur.length > 220) { let i = cur.lastIndexOf(' ', 200); if (i < 60) i = 200; out.push(cur.slice(0, i)); cur = cur.slice(i).trim(); }
  }
  if (cur) out.push(cur);
  return out;
}

let st = { state: 'idle', parts: [], i: 0, tok: 0, onstate: null, onend: null, watch: null, timer: null };
const setState = (s) => { st.state = s; if (st.onstate) st.onstate(s); };
export const speechState = () => st.state;
function say() {
  if (!synth || st.state !== 'playing') return;
  if (st.i >= st.parts.length) { const cb = st.onend; reset(); if (cb) cb(); return; }
  const tok = st.tok; const u = new SpeechSynthesisUtterance(st.parts[st.i]);
  try { if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB'; } catch (e) { u.lang = 'en-GB'; }
  u.rate = rate; u.pitch = 1;
  u.onend = () => { if (tok !== st.tok || st.state !== 'playing') return; st.i += 1; say(); };
  u.onerror = (e) => { if (tok !== st.tok) return; if (e && (e.error === 'canceled' || e.error === 'interrupted')) return; reset(); };
  synth.speak(u);
}
function reset() {
  st.tok += 1; clearInterval(st.timer); st.timer = null;
  const was = st.state; st.parts = []; st.i = 0; st.onend = null; st.watch = null;
  if (was !== 'idle') setState('idle');
}
/* Speak a text. opts: onstate(s), onend(), watch (element: reading stops when it leaves the page). */
export function speak(text, opts = {}) {
  if (!synth) return false;
  stop();
  const parts = chunks(text); if (!parts.length) { if (opts.onend) opts.onend(); return true; }
  if (!voice) voice = pickVoice();
  st.parts = parts; st.i = 0; st.onstate = opts.onstate || null; st.onend = opts.onend || null; st.watch = opts.watch || null;
  setState('playing'); say();
  if (st.watch) st.timer = setInterval(() => { if (!st.watch || !st.watch.isConnected) stop(); }, 400);
  return true;
}
export function stop() {
  if (!synth) return;
  const had = st.state !== 'idle'; st.tok += 1; synth.cancel(); clearInterval(st.timer); st.timer = null;
  st.parts = []; st.i = 0; st.onend = null; st.watch = null; if (had) setState('idle');
}
export function pause() { if (!synth || st.state !== 'playing') return; st.tok += 1; synth.cancel(); setState('paused'); }
export function resume() { if (!synth || st.state !== 'paused') return; setState('playing'); say(); }
/* Changing speed takes effect from the next sentence. */
export function noVoiceHelp() {
  const vs = synth && synth.getVoices ? synth.getVoices() : [];
  return vs.length ? '' : 'This phone has no reading voice yet. On Android, install "Speech Services by Google" from the Play Store, then try again.';
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => stop());
  window.addEventListener('pagehide', () => stop());
}
