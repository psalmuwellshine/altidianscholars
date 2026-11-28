/* Voice for the AI tab: read an answer aloud, and listen to the student during a call.
   Both use the phone's own browser (no extra service, no cost). The voice and how well it understands accents depend on the phone;
   Chrome on Android works best. In Chrome the speech-to-text is done by Google's servers. */
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const Rec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canSpeak = () => !!(synth && typeof window.SpeechSynthesisUtterance === 'function');
export const canListen = () => !!Rec;

// Takes the markdown-ish answer text and makes it sound natural when read out.
export function plain(text) {
  return String(text || '')
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^\s*\(?([A-D])[.)]\s+/gm, '$1, ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s*\n+\s*/g, '. ').replace(/([.!?:])\s*\./g, '$1').replace(/\s{2,}/g, ' ').trim();
}
function chunks(text) { // short pieces: long ones get cut off by some phones
  const out = []; let cur = '';
  plain(text).split(/(?<=[.!?])\s+/).forEach((s) => { if ((cur + ' ' + s).length > 170 && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s; });
  if (cur) out.push(cur); return out;
}
let voice = null;
function pickVoice() {
  if (!synth) return null; const list = synth.getVoices() || []; if (!list.length) return null;
  for (const p of ['en-NG', 'en-GB', 'en-ZA', 'en-US', 'en']) { const v = list.find((x) => x.lang && x.lang.replace('_', '-').toLowerCase().startsWith(p.toLowerCase())); if (v) return v; }
  return null;
}
if (synth) { synth.onvoiceschanged = () => { voice = pickVoice(); }; voice = pickVoice(); }

let gen = 0; let playing = ''; const subs = new Set();
const tell = () => subs.forEach((f) => { try { f(playing); } catch (e) { /* ignore */ } });
export const onChange = (f) => { subs.add(f); return () => subs.delete(f); };
export const nowPlaying = () => playing;

// Reads text aloud. key says which message it is, so its button can show "stop". Calls done() when it finishes or is stopped.
export function speak(text, key, done) {
  if (!canSpeak()) { if (done) done(false); return; }
  stop(); const my = ++gen; const parts = chunks(text);
  if (!parts.length) { if (done) done(true); return; }
  playing = key || 'x'; tell(); let i = 0;
  const next = () => {
    if (my !== gen) return;
    if (i >= parts.length) { playing = ''; tell(); if (done) done(true); return; }
    const u = new SpeechSynthesisUtterance(parts[i++]); if (!voice) voice = pickVoice(); if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB'; u.rate = 0.98; u.pitch = 1;
    u.onend = next; u.onerror = () => { if (my === gen) { playing = ''; tell(); if (done) done(false); } };
    try { synth.speak(u); } catch (e) { if (my === gen) { playing = ''; tell(); if (done) done(false); } } // never leave a call hanging if the phone refuses to speak
  };
  setTimeout(next, 60); // a short pause after cancel() makes phones more reliable
}
export function stop() {
  gen++; if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
  if (playing) { playing = ''; tell(); }
}

// Listens once. The call ends the listening by itself when the student stops talking.
export function listen({ lang, onInterim, onFinal, onEnd, onError }) {
  if (!Rec) { if (onError) onError('unsupported'); return { stop() {} }; }
  const r = new Rec(); r.lang = lang || 'en-NG'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let got = false; let ended = false;
  r.onresult = (e) => {
    let interim = ''; let fin = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript; else interim += res[0].transcript; }
    if (interim && onInterim) onInterim(interim.trim());
    if (fin.trim()) { got = true; if (onFinal) onFinal(fin.trim()); }
  };
  r.onerror = (e) => { if (onError) onError(e.error || 'error'); };
  r.onend = () => { if (ended) return; ended = true; if (onEnd) onEnd(got); };
  try { r.start(); } catch (e) { ended = true; if (onError) onError('start'); }
  return { stop() { ended = true; try { r.abort(); } catch (e) { /* ignore */ } } };
}
