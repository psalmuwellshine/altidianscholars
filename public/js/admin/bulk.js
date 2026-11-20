/* Turns pasted text into quiz questions. Reports exactly which block is wrong. */
export function parseBulk(text) {
  const questions = []; const errors = [];
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  blocks.forEach((block, n) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let q = ''; const o = {}; let a = -1; let e = ''; let last = '';
    for (const line of lines) {
      let m;
      if ((m = line.match(/^(?:Q(?:uestion)?\s*\d*\s*[:.)-]|\d+\s*[.)])\s*(.+)$/i))) { q = m[1]; last = 'q'; }
      else if ((m = line.match(/^\(?([A-D])\s*[.)\]:]\s*(.+)$/i))) { o[m[1].toUpperCase()] = m[2]; last = m[1].toUpperCase(); }
      else if ((m = line.match(/^(?:Answer|Ans|Correct(?:\s+(?:option|answer))?)\s*[:=-]?\s*\(?([A-D])\)?/i))) { a = 'ABCD'.indexOf(m[1].toUpperCase()); last = 'a'; }
      else if ((m = line.match(/^(?:Why|Explanation|Reason)\s*[:=-]\s*(.+)$/i))) { e = m[1]; last = 'e'; }
      else if (last === 'q') q += ' ' + line;
      else if (last === 'e') e += ' ' + line;
      else if (!q && n >= 0 && !Object.keys(o).length) { q = line; last = 'q'; }
    }
    const opts = ['A', 'B', 'C', 'D'].map((k) => o[k] || '');
    if (!q) errors.push(`Block ${n + 1}: no question found.`);
    else if (opts.some((x) => !x)) errors.push(`Block ${n + 1} (“${q.slice(0, 30)}…”): it needs options A, B, C and D.`);
    else if (a < 0) errors.push(`Block ${n + 1} (“${q.slice(0, 30)}…”): add a line like “Answer: B”.`);
    else questions.push({ q, o: opts, a, e });
  });
  return { questions, errors };
}
