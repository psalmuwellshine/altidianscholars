'use strict';
/* Usage counters for the admin analytics: how often resources are opened and which quiz questions students miss. */
const D = require('./domain');
const H = require('./helpers');

module.exports = function createStats(store) {
  const chains = new Map();
  // Updates to one counter run one after another, so two students at the same moment do not overwrite each other.
  function update(id, fn) {
    const prev = chains.get(id) || Promise.resolve();
    const next = prev.then(async () => { const d = (await store.get('stats', id)) || { id }; fn(d); await store.put('stats', d); }).catch((e) => console.error('stats:', e.message));
    chains.set(id, next);
    next.then(() => { if (chains.get(id) === next) chains.delete(id); });
    return next;
  }
  const qHash = (q) => H.sha(String(q.q)).slice(0, 10);
  const open = (materialId) => update('mat:' + materialId, (d) => {
    d.opens = (d.opens || 0) + 1; d.last = Date.now();
    const day = D.lagosDate(); d.days = d.days || {}; d.days[day] = (d.days[day] || 0) + 1;
    Object.keys(d.days).sort().slice(0, -14).forEach((k) => delete d.days[k]);
  });
  const attempt = (quiz, answers, correct) => update('quiz:' + quiz.id, (d) => {
    d.attempts = (d.attempts || 0) + 1; d.correct = (d.correct || 0) + correct; d.total = (d.total || 0) + quiz.questions.length;
    d.wrong = d.wrong || {}; d.seen = d.seen || {};
    quiz.questions.forEach((q, i) => { const h = qHash(q); d.seen[h] = (d.seen[h] || 0) + 1; if (answers[i] !== q.a) d.wrong[h] = (d.wrong[h] || 0) + 1; });
  });
  return { open, attempt, qHash };
};
