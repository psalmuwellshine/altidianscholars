'use strict';
/*
  Altidian rules: site settings, scoring, ranks, streaks, badges, leaderboard
  and the numbers behind the profile page and the admin overview.
*/

const OLD_DEFAULTS = {
  siteName: 'Exam Warriors', tagline: 'Give The Best, Take The Best',
  heroText: 'Notes, past questions and practice quizzes for NDU students, all in one place.',
  footerText: 'Exam Warriors · Niger Delta University',
};
const DEFAULT_CONFIG = {
  siteName: 'Altidian',
  tagline: 'Rise to your highest point.',
  motto: 'Altiora et Meridies',
  heroTitle: 'Study smarter. Score higher.',
  heroText: 'Notes, past questions and practice quizzes for your own department and level, all in one place.',
  footerText: 'Altidian · Rise to your highest point.',
  registrationOpen: true,
  requireLogin: true,
  leaderboardEnabled: true,
  chatEnabled: true,
  contribEnabled: true, // students may share notes and past questions
  contribPoints: 20, // points a student earns for each approved upload
  payBank: '', payAccountNumber: '', payAccountName: '', payNote: '', // bank-transfer details students pay into
  passPrice: 0, // semester pass price in naira (0 = not set yet)
  passEnds: '', // last day of the semester pass, YYYY-MM-DD
  moveOn: true, // show the "Exam Warriors is now Altidian" banner
  moveEnds: '2026-11-16', // day materials move fully to Altidian (YYYY-MM-DD), drives the countdown
  moveTitle: '', moveText: '', // optional wording; blank uses the standard message
  levelOpen: false, // admin opens this when a new session begins so students can move up a level
  levelEnds: '', // optional last day of that window (YYYY-MM-DD)
  links: { whatsapp: '', telegram: '', instagram: '', email: '', website: '' },
};
// The courses the site started with. They are copied into the Academics section the first time the server runs.
const SEED_COURSES = [
  { code: 'MLS206', name: 'Medical Laboratory Science' },
  { code: 'MLS208', name: 'Medical Laboratory Science' },
  { code: 'MBH222', name: 'Metabolism of Macromolecules' },
  { code: 'PIO214', name: 'Physiology' },
  { code: 'PIO216', name: 'Physiology' },
  { code: 'ANA204', name: 'Anatomy' },
  { code: 'ANA206', name: 'Anatomy' },
  { code: 'GST212', name: 'General Studies' },
];

const levelWindowOpen = (c) => !!(c && c.levelOpen) && (!c.levelEnds || c.levelEnds >= lagosDate());

function mergeConfig(stored) {
  const c = Object.assign({}, DEFAULT_CONFIG, stored || {});
  c.links = Object.assign({}, DEFAULT_CONFIG.links, (stored && stored.links) || {});
  // Settings saved under the old brand name move to the new brand automatically.
  Object.keys(OLD_DEFAULTS).forEach((k) => { if (c[k] === OLD_DEFAULTS[k]) c[k] = DEFAULT_CONFIG[k]; });
  delete c.id; delete c.courses;
  return c;
}

async function loadConfig(store) {
  return mergeConfig(await store.get('settings', 'config'));
}

/* ---------- time ---------- */
const LAGOS_OFFSET_MS = 3600000; // Nigeria is UTC+1 all year
// Today's date in Nigeria (YYYY-MM-DD), used to check when a semester pass runs out.
const lagosDate = (now) => new Date((now || Date.now()) + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
// Free items are open to everyone. A paid item opens for a student with a live semester pass,
// or one who has been given that single item. Guests (no account) never get paid items.
function hasAccess(user, item, now) {
  if (!item || !item.paid) return true;
  if (!user || user.disabled) return false;
  if (user.paidUntil && user.paidUntil >= lagosDate(now)) return true;
  return Array.isArray(user.unlocked) && user.unlocked.includes(item.id);
}
const dayKey = (ts) => Math.floor((ts + LAGOS_OFFSET_MS) / 86400000);
const HISTORY_LIMIT = 300;

/* ---------- scores ---------- */
const historyOf = (rec) => (rec && Array.isArray(rec.history) ? rec.history : []);

function pointsFor(rec, quizIds) {
  let points = 0; let done = 0;
  for (const id of Object.keys((rec && rec.best) || {})) {
    if (quizIds.has(id)) { points += rec.best[id].correct * 10; done++; }
  }
  points += Math.max(0, Number(rec && rec.bonus) || 0); // points from approved uploads
  return { points, done };
}

const RANKS = [
  { min: 0, title: 'Base Camp' },
  { min: 40, title: 'Climber' },
  { min: 100, title: 'Trailblazer' },
  { min: 250, title: 'Summiter' },
  { min: 500, title: 'Summit Legend' },
];
function rankInfo(points) {
  let i = 0;
  RANKS.forEach((r, idx) => { if (points >= r.min) i = idx; });
  const next = RANKS[i + 1] || null;
  const pct = next ? Math.round(((points - RANKS[i].min) / (next.min - RANKS[i].min)) * 100) : 100;
  return { title: RANKS[i].title, index: i, next: next ? { title: next.title, at: next.min } : null, pct };
}

function streaks(history, now) {
  const days = [...new Set(history.map((h) => dayKey(h.at || 0)))].sort((a, b) => a - b);
  if (!days.length) return { current: 0, longest: 0, activeToday: false };
  let longest = 1; let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const set = new Set(days);
  const today = dayKey(now);
  let cursor = set.has(today) ? today : (set.has(today - 1) ? today - 1 : null);
  let current = 0;
  while (cursor !== null && set.has(cursor)) { current++; cursor--; }
  return { current, longest, activeToday: set.has(today) };
}

/* ---------- badges ---------- */
function badgeList(s) {
  const defs = [
    { id: 'first', name: 'First Steps', desc: 'Finish your first quiz', current: s.attempts, target: 1 },
    { id: 'five', name: 'Getting Serious', desc: 'Finish 5 quizzes', current: s.attempts, target: 5 },
    { id: 'machine', name: 'Quiz Machine', desc: 'Finish 25 quizzes', current: s.attempts, target: 25 },
    { id: 'flawless', name: 'Flawless', desc: 'Score 100% on a quiz', current: s.perfect, target: 1 },
    { id: 'century', name: 'Century', desc: 'Earn 100 points', current: s.points, target: 100 },
    { id: 'fire', name: 'On Fire', desc: 'Study 3 days in a row', current: s.longestStreak, target: 3 },
    { id: 'unstoppable', name: 'Unstoppable', desc: 'Study 7 days in a row', current: s.longestStreak, target: 7 },
    { id: 'sharer', name: 'Contributor', desc: 'Share a note that gets approved', current: s.contributions || 0, target: 1 },
    { id: 'giver', name: 'Knowledge Giver', desc: 'Share 5 approved notes', current: s.contributions || 0, target: 5 },
    { id: 'allround', name: 'All-Rounder', desc: 'Take quizzes in 3 courses', current: s.courses, target: 3 },
  ];
  return defs.map((d) => ({
    id: d.id, name: d.name, desc: d.desc,
    earned: d.current >= d.target,
    progress: { current: Math.min(d.current, d.target), target: d.target },
  }));
}

/* ---------- leaderboard ---------- */
// usersById: Map of user records. Scores are kept per user, or per device for guests.
function buildBoard(usersById, scores, quizIds) {
  const rows = [];
  for (const rec of scores) {
    const { points, done } = pointsFor(rec, quizIds);
    if (points <= 0) continue;
    const u = usersById.get(rec.id);
    if (u && u.disabled) continue;
    rows.push({
      id: rec.id,
      name: u ? u.username : (rec.nick || 'Anonymous climber'),
      isUser: !!u, avatar: u ? u.avatarId || '' : '', dept: u ? u.departmentId || '' : '', level: u ? u.level || 0 : 0,
      points, done,
      updatedAt: rec.updatedAt || 0,
    });
  }
  rows.sort((a, b) => b.points - a.points || a.updatedAt - b.updatedAt);
  return rows;
}

/* ---------- profile ---------- */
function buildProfile({ user, rec, quizzes, courses, board, now, contributions }) {
  const quizIds = new Set(quizzes.map((q) => q.id));
  const quizById = new Map(quizzes.map((q) => [q.id, q]));
  const history = historyOf(rec).filter((h) => quizById.has(h.q));
  const best = (rec && rec.best) || {};
  const { points, done } = pointsFor(rec, quizIds);

  const visible = quizzes.filter((q) => !q.hidden);
  const attemptsByQuiz = {}; const lastByQuiz = {};
  history.forEach((h) => {
    attemptsByQuiz[h.q] = (attemptsByQuiz[h.q] || 0) + 1;
    if (!lastByQuiz[h.q] || h.at > lastByQuiz[h.q]) lastByQuiz[h.q] = h.at;
  });

  const quizRows = visible.map((q) => {
    const b = best[q.id];
    const attempts = attemptsByQuiz[q.id] || (b ? 1 : 0);
    return {
      id: q.id, title: q.title, course: q.course, total: q.questions.length,
      best: b ? { correct: b.correct, total: b.total, pct: b.total ? Math.round((b.correct / b.total) * 100) : 0 } : null,
      attempts,
      last: lastByQuiz[q.id] || null,
    };
  });

  const totalAttempts = history.length || done;
  let sumC = 0; let sumT = 0;
  if (history.length) history.forEach((h) => { sumC += h.c; sumT += h.t; });
  else Object.keys(best).forEach((id) => { if (quizIds.has(id)) { sumC += best[id].correct; sumT += best[id].total; } });
  const accuracy = sumT ? Math.round((sumC / sumT) * 100) : null;

  const perfect = Object.keys(best).filter((id) => quizIds.has(id) && best[id].total > 0 && best[id].correct === best[id].total).length;
  const takenCourses = new Set(Object.keys(best).filter((id) => quizIds.has(id)).map((id) => quizById.get(id).course));
  const st = streaks(history, now);

  const courseRows = [];
  const nameOf = new Map((courses || []).map((c) => [c.code, c.name]));
  const codes = [...new Set(visible.map((q) => q.course))];
  codes.forEach((code) => {
    const qs = quizRows.filter((r) => r.course === code);
    const taken = qs.filter((r) => r.best);
    const c = taken.reduce((a, r) => a + r.best.correct, 0);
    const t = taken.reduce((a, r) => a + r.best.total, 0);
    courseRows.push({ code, name: nameOf.get(code) || '', quizzes: qs.length, done: taken.length, accuracy: t ? Math.round((c / t) * 100) : null });
  });

  const position = board.findIndex((b) => b.id === (user && user.id));
  const recent = history.slice(-12).reverse().map((h) => {
    const q = quizById.get(h.q);
    return { quizId: h.q, title: q.title, course: q.course, correct: h.c, total: h.t, pct: h.t ? Math.round((h.c / h.t) * 100) : 0, at: h.at };
  });

  return {
    user: { id: user.id, username: user.username, createdAt: user.createdAt || null, lastLoginAt: user.lastLoginAt || null, facultyId: user.facultyId || '', departmentId: user.departmentId || '', level: user.level || 0, avatarId: user.avatarId || '' },
    points, done, attempts: totalAttempts, accuracy,
    rank: Object.assign(rankInfo(points), { position: position >= 0 ? position + 1 : null, outOf: board.length }),
    streak: st,
    quizzes: quizRows,
    courses: courseRows,
    recent,
    badges: badgeList({ contributions: contributions || 0, attempts: totalAttempts, perfect, points, longestStreak: st.longest, courses: takenCourses.size }),
  };
}

/* ---------- admin numbers ---------- */
function quizStats(scores, quizzes) {
  const map = new Map(quizzes.map((q) => [q.id, { attempts: 0, sumPct: 0, takers: 0 }]));
  for (const rec of scores) {
    const seen = new Set();
    const h = historyOf(rec);
    h.forEach((x) => {
      const s = map.get(x.q); if (!s) return;
      s.attempts++; s.sumPct += x.t ? (x.c / x.t) * 100 : 0; seen.add(x.q);
    });
    Object.keys(rec.best || {}).forEach((id) => { // older records that have no history yet
      const s = map.get(id); if (!s || seen.has(id)) return;
      s.attempts++; s.sumPct += rec.best[id].total ? (rec.best[id].correct / rec.best[id].total) * 100 : 0; seen.add(id);
    });
    seen.forEach((id) => { map.get(id).takers++; });
  }
  const out = {};
  map.forEach((s, id) => { out[id] = { attempts: s.attempts, takers: s.takers, avgPct: s.attempts ? Math.round(s.sumPct / s.attempts) : null }; });
  return out;
}

function lastDays(n, now) {
  const today = dayKey(now);
  return Array.from({ length: n }, (_, i) => today - (n - 1 - i));
}
function activitySeries(scores, users, n, now) {
  const days = lastDays(n, now);
  const attempts = new Map(days.map((d) => [d, 0]));
  const signups = new Map(days.map((d) => [d, 0]));
  scores.forEach((rec) => historyOf(rec).forEach((h) => { const k = dayKey(h.at || 0); if (attempts.has(k)) attempts.set(k, attempts.get(k) + 1); }));
  users.forEach((u) => { const k = dayKey(u.createdAt || 0); if (signups.has(k)) signups.set(k, signups.get(k) + 1); });
  return days.map((d) => ({ date: new Date(d * 86400000).toISOString().slice(0, 10), attempts: attempts.get(d), signups: signups.get(d) }));
}

module.exports = {
  levelWindowOpen, DEFAULT_CONFIG, SEED_COURSES, mergeConfig, loadConfig, dayKey, lagosDate, hasAccess, HISTORY_LIMIT, historyOf, pointsFor, RANKS, rankInfo,
  streaks, badgeList, buildBoard, buildProfile, quizStats, activitySeries,
};
