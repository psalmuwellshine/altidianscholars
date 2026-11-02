// Turns the text of a timetable (typed, pasted, or read from a photo) into timetable entries.
// It looks line by line for a day or date, a time range, a course code and a venue. Everything is shown
// for review afterwards, so a wrong guess is easy to fix.
const DAY_WORDS = [['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6], ['sun', 7]];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');

function dayOf(line) {
  const m = line.toLowerCase().match(/\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b/);
  if (!m) return 0;
  const w = DAY_WORDS.find(([k]) => m[1].startsWith(k)); return w ? w[1] : 0;
}
function dateOf(line, year) {
  let m = line.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return valid(y, Number(m[2]), Number(m[1])); }
  m = line.toLowerCase().match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?\b/);
  if (m) return valid(m[3] ? Number(m[3]) : year, MONTHS.indexOf(m[2]) + 1, Number(m[1]));
  m = line.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/);
  if (m) return valid(m[3] ? Number(m[3]) : year, MONTHS.indexOf(m[1]) + 1, Number(m[2]));
  return '';
}
function valid(y, mo, d) { if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return ''; const t = new Date(Date.UTC(y, mo - 1, d)); return t.getUTCMonth() === mo - 1 ? y + '-' + pad(mo) + '-' + pad(d) : ''; }

// one clock time: "8", "8:30", "0830", "8am", "1 pm"
function clock(h, mi, ap, endHint) {
  h = Number(h); mi = Number(mi || 0);
  if (h > 24 || mi > 59) return '';
  if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } else if (h >= 1 && h <= 6) h += 12; // lectures rarely start at 3am
  if (h === 24) return '';
  return pad(h) + ':' + pad(mi);
}
const T = '(\\d{1,2})(?:[:.h]?(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
const RANGE = new RegExp('\\b' + T + '\\s*(?:-|–|—|to|till|until)\\s*' + T + '\\b', 'i');
function rangeOf(line) {
  const m = line.match(RANGE); if (!m) return null;
  const cleanAp = (a) => (a ? a.replace(/\./g, '').toLowerCase() : '');
  let a1 = cleanAp(m[3]); const a2 = cleanAp(m[6]);
  if (!a1 && a2) a1 = a2; // "8-10am" means both are morning
  let start = clock(m[1], m[2], a1); const end = clock(m[4], m[5], a2);
  if (!start || !end) return null;
  if (end <= start && !a1 && !a2) start = clock(m[1], m[2], 'am');
  if (end <= start) return null;
  return { start, end, at: m.index, len: m[0].length };
}
const COURSE = /\b([A-Za-z]{3})\s?-?\s?(\d{3})\b/;
const VENUE = /\b((?:LT|LR|CR|Room|Rm|Lab(?:oratory)?|Hall|Theatre|Auditorium)\s?-?\s?[A-Za-z0-9]{0,4})\b/i;

export function parseTimetable(text, { kind = 'class', year = new Date().getFullYear() } = {}) {
  const rows = []; let day = 0; let date = '';
  String(text || '').split(/\r?\n/).slice(0, 400).forEach((raw) => {
    const line = raw.replace(/\s+/g, ' ').trim(); if (line.length < 2) return;
    const d = dayOf(line); const dt = dateOf(line, year); const r = rangeOf(line); const c = line.match(COURSE);
    if (d) { day = d; date = ''; }
    if (dt) { date = dt; day = 0; }
    if (!r && !c) return; // a heading such as "MONDAY" or "Exam timetable"
    const lower = line.toLowerCase();
    let k = /\bexam/.test(lower) ? 'exam' : /\b(test|quiz|ca\b|assessment)/.test(lower) ? 'test' : kind;
    if (k === 'class' && !day && date) k = 'exam';
    const v = line.match(VENUE);
    let rest = line.replace(RANGE, ' ').replace(COURSE, ' ').replace(VENUE, ' ').replace(/\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b/ig, ' ').replace(/[|@,;:–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (rest.length > 50) rest = rest.slice(0, 50).trim();
    const code = c ? (c[1] + c[2]).toUpperCase() : '';
    rows.push({ kind: k, day: k === 'class' ? (d || day || 0) : 0, date: k === 'class' ? '' : (dt || date || ''), start: r ? r.start : '', end: r ? r.end : '', course: code, title: code ? (code + (rest ? ' ' + rest : '')) : (rest || 'Class'), venue: v ? v[1].replace(/\s+/g, ' ').trim() : '' });
  });
  return rows;
}
// what is still missing before the server will accept a row
export function missing(r) { if (!r.title) return 'title'; if (r.kind === 'class') return !r.day ? 'day' : !r.start ? 'start time' : ''; return !r.date ? 'date' : ''; }
