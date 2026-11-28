'use strict';
/* Spaced review: a question a student gets wrong comes back tomorrow, then after 3, 7, 14 and 30 days. Each time they get it
   right it moves to the next gap; a wrong answer sends it back to tomorrow. After the last gap it leaves the list.
   Lives inside the student's own scores record (rec.srs = { <question fingerprint>: { q: quizId, s: step, due: 'YYYY-MM-DD' } }),
   so there is nothing new to back up or clean up. A question that is edited or deleted simply drops out of the list. */
const D = require('./domain');

const STEPS = [1, 3, 7, 14, 30]; // days until the question comes back
const KEEP = 400; // most questions one student can have waiting
const SIZE = 10; // questions in one review round
const dayAt = (n) => D.lagosDate(Date.now() + n * 86400000);

// Called after a quiz is marked.
function afterQuiz(rec, quiz, answers, qHash) {
  rec.srs = rec.srs || {};
  quiz.questions.forEach((q, i) => {
    const h = qHash(q); const e = rec.srs[h];
    if (answers[i] !== q.a) rec.srs[h] = { q: quiz.id, s: 0, due: dayAt(STEPS[0]) };
    else if (e) { e.s += 1; if (e.s >= STEPS.length) delete rec.srs[h]; else e.due = dayAt(STEPS[e.s]); }
  });
  trim(rec);
}
function trim(rec) {
  const keys = Object.keys(rec.srs || {});
  if (keys.length > KEEP) keys.sort((a, b) => rec.srs[b].due.localeCompare(rec.srs[a].due)).slice(0, keys.length - KEEP).forEach((k) => delete rec.srs[k]);
}

// Looks up each waiting question in its quiz. Entries whose question was edited or removed are dropped.
function resolve(rec, quizzes, qHash, user) {
  const byId = new Map(quizzes.map((q) => [q.id, q])); const out = []; let changed = false;
  Object.entries(rec.srs || {}).forEach(([h, e]) => {
    const quiz = byId.get(e.q); const idx = quiz ? quiz.questions.findIndex((x) => qHash(x) === h) : -1;
    if (idx < 0) { delete rec.srs[h]; changed = true; return; }
    if (quiz.hidden || !D.hasAccess(user, quiz)) return; // kept, but not shown while the quiz is hidden or locked
    out.push({ h, e, quiz, idx, x: quiz.questions[idx] });
  });
  return { list: out, changed };
}
function summary(rec, quizzes, qHash, user) {
  const { list, changed } = resolve(rec, quizzes, qHash, user); const today = D.lagosDate();
  const due = list.filter((x) => x.e.due <= today);
  return { due: due.length, later: list.length - due.length, changed };
}
function dueRound(rec, quizzes, qHash, user) {
  const { list, changed } = resolve(rec, quizzes, qHash, user); const today = D.lagosDate();
  const due = list.filter((x) => x.e.due <= today).sort((a, b) => a.e.due.localeCompare(b.e.due) || a.e.s - b.e.s);
  return { total: due.length, later: list.length - due.length, changed, round: due.slice(0, SIZE) };
}
// The quizzes a student is weakest at (best score under 60%), worst first.
function weak(rec, quizzes, user, limit) {
  const out = [];
  quizzes.forEach((q) => {
    if (q.hidden || !D.hasAccess(user, q)) return; const b = (rec.best || {})[q.id]; if (!b || !b.total) return;
    const p = Math.round((b.correct / b.total) * 100); if (p < 60) out.push({ id: q.id, title: q.title, course: q.course, pct: p });
  });
  return out.sort((a, b) => a.pct - b.pct).slice(0, limit || 3);
}
// Marks a round: answers = [{ h, a }]. Returns what to show; changes rec.srs.
function grade(rec, quizzes, qHash, user, answers) {
  const { list } = resolve(rec, quizzes, qHash, user); const today = D.lagosDate(); // only questions that are due can be marked
  const by = new Map(list.filter((x) => x.e.due <= today).map((x) => [x.h, x])); const results = []; const seen = new Set();
  (Array.isArray(answers) ? answers : []).slice(0, SIZE).forEach((a) => {
    const x = a && by.get(String(a.h)); if (!x || seen.has(x.h)) return; seen.add(x.h);
    const right = Number.isInteger(a.a) && a.a === x.x.a;
    if (right) { x.e.s += 1; if (x.e.s >= STEPS.length) delete rec.srs[x.h]; else x.e.due = dayAt(STEPS[x.e.s]); }
    else { x.e.s = 0; x.e.due = dayAt(STEPS[0]); }
    results.push({ h: x.h, correct: right, answer: x.x.a, why: x.x.e || '' });
  });
  return results;
}
module.exports = { afterQuiz, summary, dueRound, weak, grade, STEPS, SIZE };
