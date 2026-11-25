// Rebuilds the rows and columns of a timetable from where the photo reader found each word.
// The reader alone returns words block by block, which scrambles a grid. Here the words are grouped by
// position: day names and time headings are found first, then every cell is matched to its day and time.
// The result is plain lines ("Monday 8:00-10:00 MBH222 Biochemistry LT1") that the timetable parser understands.

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const dayOf = (t) => { const m = String(t).toLowerCase().replace(/[^a-z]/g, '').match(/^(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?$/); if (!m) return null; return DAYS.find(([k]) => m[1].startsWith(k)); };
const pad = (n) => String(n).padStart(2, '0');
const COURSE = /\b[A-Za-z]{3}\s?-?\s?\d{3}\b/g;
const med = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* ---------- words -> segments (a phrase on one line, split where there is a wide gap) ---------- */
export function segmentsOf(words) {
  const ws = words.filter((w) => w && String(w.text || '').trim() && w.x1 > w.x0 && w.y1 > w.y0).map((w) => ({ text: String(w.text).trim(), x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }));
  if (!ws.length) return [];
  const H = med(ws.map((w) => w.h)) || 10;
  ws.sort((a, b) => a.cy - b.cy);
  const lines = [];
  ws.forEach((w) => { const l = lines.find((x) => Math.abs(x.cy - w.cy) <= Math.max(H * 0.55, 4)); if (l) { l.w.push(w); l.cy = (l.cy * (l.w.length - 1) + w.cy) / l.w.length; } else lines.push({ cy: w.cy, w: [w] }); });
  const segs = [];
  lines.forEach((l) => {
    l.w.sort((a, b) => a.x0 - b.x0);
    let cur = null;
    l.w.forEach((w) => {
      if (cur && w.x0 - cur.x1 <= H * 1.1) { cur.text += ' ' + w.text; cur.x1 = Math.max(cur.x1, w.x1); cur.y0 = Math.min(cur.y0, w.y0); cur.y1 = Math.max(cur.y1, w.y1); }
      else { cur = { text: w.text, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 }; segs.push(cur); }
    });
  });
  segs.forEach((s) => { s.cx = (s.x0 + s.x1) / 2; s.cy = (s.y0 + s.y1) / 2; });
  return segs;
}

/* ---------- time headings ---------- */
const T = '(\\d{1,2})(?:[:.h]?(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
const RANGE = new RegExp('^\\W*' + T + '\\s*(?:-|–|—|to)\\s*' + T + '\\W*$', 'i');
const SINGLE = /^\W*(\d{1,2})\s*[:.h]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\W*$|^\W*(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\W*$/i;
function clock(h, mi, ap) {
  h = Number(h); mi = Number(mi || 0); if (h > 24 || mi > 59) return '';
  if (ap) { ap = ap.replace(/\./g, '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } else if (h >= 1 && h <= 6) h += 12;
  return h === 24 ? '' : pad(h) + ':' + pad(mi);
}
function timeHead(text) {
  let m = text.match(RANGE);
  if (m) {
    const a1 = m[3] || m[6] || ''; let s = clock(m[1], m[2], a1); const e = clock(m[4], m[5], m[6] || '');
    if (s && e && e <= s && !m[3] && !m[6]) s = clock(m[1], m[2], 'am');
    if (s && e && e > s) return { start: s, end: e };
    return null;
  }
  m = text.match(SINGLE);
  if (m) { const s = m[1] ? clock(m[1], m[2], m[3]) : clock(m[4], 0, m[5]); return s ? { start: s, end: '' } : null; }
  return null;
}
const addHour = (t) => { const [h, m] = t.split(':').map(Number); return h >= 23 ? '23:59' : pad(h + 1) + ':' + pad(m); };

/* ---------- finding the grid ---------- */
const cluster = (items, key, tol) => { // groups items whose key values are within tol; returns the groups
  const s = items.slice().sort((a, b) => a[key] - b[key]); const out = [];
  s.forEach((x) => { const g = out[out.length - 1]; if (g && x[key] - g.at <= tol) { g.items.push(x); g.at = (g.at * (g.items.length - 1) + x[key]) / g.items.length; } else out.push({ at: x[key], items: [x] }); });
  return out;
};

function gridLines(segs, H) {
  const days = segs.map((s) => ({ s, d: dayOf(s.text) })).filter((x) => x.d && x.s.text.length <= 12);
  const times = segs.map((s) => ({ s, t: timeHead(s.text) })).filter((x) => x.t);
  if (days.length < 2 || times.length < 2) return null;
  // Layout A: days run down the side, times across the top. Layout B: days across the top, times down the side.
  const tol = H * 1.6;
  const colDays = cluster(days.map((x) => ({ ...x, v: x.s.x0 })), 'v', tol).sort((a, b) => b.items.length - a.items.length)[0];
  const rowDays = cluster(days.map((x) => ({ ...x, v: x.s.cy })), 'v', tol).sort((a, b) => b.items.length - a.items.length)[0];
  const rowTimes = cluster(times.map((x) => ({ ...x, v: x.s.cy })), 'v', tol).sort((a, b) => b.items.length - a.items.length)[0];
  const colTimes = cluster(times.map((x) => ({ ...x, v: x.s.x0 })), 'v', tol * 2).sort((a, b) => b.items.length - a.items.length)[0];
  let layout = null;
  if (colDays.items.length >= 2 && rowTimes.items.length >= 2 && colDays.items.length >= rowDays.items.length) layout = 'A';
  else if (rowDays.items.length >= 2 && colTimes.items.length >= 2) layout = 'B';
  if (!layout) return null;
  const A = layout === 'A';
  const dayItems = (A ? colDays : rowDays).items.map((x) => x).sort((a, b) => (A ? a.s.cy - b.s.cy : a.s.cx - b.s.cx));
  const timeItems = (A ? rowTimes : colTimes).items.map((x) => x).sort((a, b) => (A ? a.s.cx - b.s.cx : a.s.cy - b.s.cy));
  const isHead = new Set([...dayItems, ...timeItems].map((x) => x.s));
  // time columns (or rows): fill in missing end times from the next heading
  const slots = timeItems.map((x, i) => { const nx = timeItems[i + 1]; return { start: x.t.start, end: x.t.end || (nx ? nx.t.start : addHour(x.t.start)), c: A ? x.s.cx : x.s.cy, lo: A ? x.s.x0 : x.s.y0, hi: A ? x.s.x1 : x.s.y1 }; });
  slots.forEach((sl, i) => { sl.a = i ? (slots[i - 1].c + sl.c) / 2 : -Infinity; sl.b = i < slots.length - 1 ? (sl.c + slots[i + 1].c) / 2 : Infinity; });
  const dcen = dayItems.map((x) => (A ? x.s.cy : x.s.cx));
  const bands = dayItems.map((x, i) => ({ d: x.d, a: i ? (dcen[i - 1] + dcen[i]) / 2 : -Infinity, b: i < dcen.length - 1 ? (dcen[i] + dcen[i + 1]) / 2 : Infinity }));
  // where the body of the grid begins: after the time headings, and after the day labels
  const bodyStartAcross = Math.max(...dayItems.map((x) => (A ? x.s.x1 : x.s.y1))) - H * 0.2;
  const headEndAlong = Math.max(...timeItems.map((x) => (A ? x.s.y1 : x.s.x1))) - H * 0.2;
  const cells = new Map();
  segs.forEach((s) => {
    if (isHead.has(s)) return;
    const along = A ? s.cy : s.cx; const across = A ? s.cx : s.cy; // along: day axis. across: time axis.
    const tAxisStart = A ? s.x0 : s.y0; const tAxisEnd = A ? s.x1 : s.y1;
    if ((A ? s.y0 : s.x0) < headEndAlong - H * 0.5 && (A ? s.cy : s.cx) < Math.min(...timeItems.map((x) => (A ? x.s.cy : x.s.cx))) + H) return; // above/left of the headings
    if (A ? s.x1 < bodyStartAcross : s.y1 < bodyStartAcross) return;
    const band = bands.find((b) => along >= b.a && along < b.b); if (!band) return;
    const lo = tAxisStart; const hi = tAxisEnd;
    let cover = slots.filter((sl) => { const a = Math.max(lo, isFinite(sl.a) ? sl.a : -1e9); const b = Math.min(hi, isFinite(sl.b) ? sl.b : 1e9); return b - a >= 0.5 * Math.min(isFinite(sl.b - sl.a) ? sl.b - sl.a : 1e9, hi - lo); });
    if (!cover.length) { const near = slots.slice().sort((x, y) => Math.abs(x.c - across) - Math.abs(y.c - across))[0]; cover = [near]; }
    const key = band.d[0] + '|' + cover[0].start + '|' + cover[cover.length - 1].end;
    if (!cells.has(key)) cells.set(key, { d: band.d, start: cover[0].start, end: cover[cover.length - 1].end, parts: [], order: along * 1e6 + across });
    cells.get(key).parts.push({ t: s.text, y: s.cy, x: s.cx });
  });
  const out = [];
  [...cells.values()].sort((a, b) => DAYS.findIndex((x) => x[0] === a.d[0]) - DAYS.findIndex((x) => x[0] === b.d[0]) || a.start.localeCompare(b.start)).forEach((c) => {
    const text = c.parts.sort((p, q) => p.y - q.y || p.x - q.x).map((p) => p.t).join(' ').replace(/\s+/g, ' ').trim();
    splitByCourse(text).forEach((one) => out.push(c.d[1] + ' ' + c.start + '-' + c.end + ' ' + one));
  });
  return out;
}

// A cell that holds two courses (stacked) becomes two entries.
function splitByCourse(text) {
  const idx = []; let m; COURSE.lastIndex = 0;
  while ((m = COURSE.exec(text))) idx.push(m.index);
  if (idx.length < 2) return text ? [text] : [];
  const parts = idx.map((s, i) => text.slice(s, i + 1 < idx.length ? idx[i + 1] : undefined).trim());
  const head = text.slice(0, idx[0]).trim();
  return (head ? [head + ' ' + parts[0]] : [parts[0]]).concat(parts.slice(1));
}

/* ---------- plain rows (lists, exam tables) ---------- */
export function rowLines(segs) {
  const lines = [];
  segs.slice().sort((a, b) => a.cy - b.cy).forEach((s) => {
    const h = s.y1 - s.y0; const l = lines.find((x) => Math.abs(x.cy - s.cy) <= Math.max(h * 0.6, 4));
    if (l) { l.s.push(s); l.cy = (l.cy * (l.s.length - 1) + s.cy) / l.s.length; } else lines.push({ cy: s.cy, s: [s] });
  });
  return lines.sort((a, b) => a.cy - b.cy).map((l) => l.s.sort((a, b) => a.x0 - b.x0).map((s) => s.text).join('  ').trim()).filter(Boolean);
}

/* words: [{text, x0, y0, x1, y1}] -> text for the timetable parser. */
export function layoutText(words, { grid = true } = {}) {
  const segs = segmentsOf(words); if (!segs.length) return '';
  const H = med(segs.map((s) => s.y1 - s.y0)) || 10;
  if (grid) { const g = gridLines(segs, H); if (g && g.length) return g.join('\n'); }
  return rowLines(segs).join('\n');
}

/* ---------- fixing course codes the reader got slightly wrong ---------- */
const AS_LETTER = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z' }; const AS_DIGIT = { O: '0', o: '0', I: '1', l: '1', i: '1', S: '5', s: '5', B: '8', Z: '2' };
function lev(a, b) { const m = a.length; const n = b.length; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; }
// known: the course codes this class really has ("MBH222"). A reading such as "P1IO201" becomes "PIO201" when only one known code is close.
export function fixCodes(text, known) {
  const codes = (known || []).map((c) => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter((c) => /^[A-Z]{3}\d{3}$/.test(c));
  if (!codes.length) return text;
  const set = new Set(codes);
  return String(text).replace(/\b[A-Za-z0-9]{5,8}\b/g, (tok) => {
    const up = tok.toUpperCase();
    if (set.has(up)) return up;
    if (!/\d.*\d/.test(tok) || !/[A-Za-z]/.test(tok)) return tok; // an ordinary word or number
    const norm = up.split('').map((ch, i) => (i < 3 ? (AS_LETTER[ch] || ch) : (AS_DIGIT[ch] || ch))).join('');
    if (set.has(norm)) return norm;
    const near = codes.map((c) => [c, Math.min(lev(up, c), lev(norm, c))]).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1]);
    if (near.length && (near.length === 1 || near[0][1] < near[1][1])) return near[0][0];
    return tok;
  });
}
