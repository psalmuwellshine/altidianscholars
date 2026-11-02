// Reads the text of a course registration form (typed, pasted or read from a photo) into a list of courses.
// Photo text is never perfect, so every row carries flags and the caller shows a check screen before saving.

// Course-code prefixes used to repair letters the photo reader got wrong (GHM101 -> CHM101). Courses already in the app are added by the caller.
const PREFIXES = 'CHM MTH COS PHY LIB BIO GST BCM MLS MBH PIO ANA PHS BCH MCB CSC EDU ENG ECO ZOO BOT MIC NSC NUR MLT PHA PHM STA STT CIV MEE EEE CPE FSC AGR ACC BUS ECN POL SOC LAW ENT FRN YOR IGB HAU ARB PCE GEO GLY SLT HIS ANT PSY CED EDM HLT PUB EHS NUT PAT HAE IMM PAR BAC CHP MBB'.split(' ');
// Whole words used to put spaces back when the reader ran words together (GENERALCHEMISTRY -> GENERAL CHEMISTRY).
const WORDS = ('GENERAL CHEMISTRY PHYSICS BIOLOGY MATHEMATICS ELEMENTARY INTRODUCTION INTRODUCTORY TO OF AND THE IN FOR PRACTICAL PRACTICALS LIBRARY SKILLS COMMUNICATION ENGLISH COMPUTING COMPUTER SCIENCE SCIENCES ' +
  'MENTAL HEALTH WELLBEING EDUCATIONAL INTELLIGENCE LEADERSHIP CITIZENSHIP NATIONAL ORIENTATION NIGERIAN PEOPLES PEOPLE CULTURE BIOCHEMISTRY BIOCHEMICAL INSTRUMENTATION MECHANICS ' +
  'ANATOMY PHYSIOLOGY HISTOLOGY METABOLISM MACROMOLECULES MICROBIOLOGY IMMUNOLOGY PARASITOLOGY HAEMATOLOGY PATHOLOGY PHARMACOLOGY GROSS HUMAN MEDICAL LABORATORY LABORATORIES TECHNIQUES ' +
  'ORGANIC INORGANIC PHYSICAL ANALYTICAL ENVIRONMENTAL SOCIAL BASIC APPLIED ADVANCED RESEARCH METHODS METHOD STATISTICS STATISTICAL ETHICS ENTREPRENEURSHIP USE FUNDAMENTALS PRINCIPLES ' +
  'CELL MOLECULAR GENETICS GENETIC ENZYMOLOGY NUTRITION CLINICAL CHEMICAL BLOOD TRANSFUSION MEDICINE EPIDEMIOLOGY PUBLIC COMMUNITY SEMINAR PROJECT SIWES TOPICS SELECTED SYSTEMS SYSTEM NERVOUS ' +
  'CARDIOVASCULAR RENAL ENDOCRINE REPRODUCTIVE RESPIRATORY DIGESTIVE MUSCULOSKELETAL CONCEPTS PROCESSES BIOSTATISTICS BIOETHICS PEACE CONFLICT STUDIES NIGERIA AFRICAN HISTORY PHILOSOPHY LOGIC').split(' ');
const WORDSET = new Set(WORDS);
const SMALL = new Set(['AND', 'OF', 'TO', 'THE', 'IN', 'FOR', 'A', 'AN', 'ON', 'AT', 'BY']);
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;
const DIGIT_TO_LETTER = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z' };
const LETTER_TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
const NOT_COURSE = /\b(NAME|MATRIC|FACULTY|DEPARTMENT|PROGRAMME|SEMESTER|TOTAL|LECTURER|SIGN|KEY|STUDENT|UNIVERSITY|FORM|REGISTR|STATUS|ADMISSION|ISLAND|STATE|COMPULSORY|ELECTIVE|BORROWED|REQUIRED|DATE|DEAN|OFFICER)\b/;

const dist1 = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false; return d === 1; };
export function fixPrefix(p, known) {
  if (known.has(p)) return { prefix: p, flag: '' };
  const near = [...known].filter((k) => dist1(k, p));
  if (near.length === 1) return { prefix: near[0], flag: 'prefix-fixed' };
  return { prefix: p, flag: 'prefix-unknown' };
}

// "GENERALCHEMISTRYT" -> "GENERAL CHEMISTRY I"
function segment(token) {
  const n = token.length; const best = new Array(n + 1).fill(null); best[0] = [];
  for (let i = 0; i < n; i++) {
    if (!best[i]) continue;
    for (let j = i + 2; j <= n; j++) {
      const w = token.slice(i, j);
      if (WORDSET.has(w) && (!best[j] || best[j].length > best[i].length + 1)) best[j] = best[i].concat(w);
    }
  }
  return best[n];
}
function respace(t) {
  return t.replace(/[A-Z]{12,}/g, (tok) => {
    let core = tok, tail = '';
    if (!segment(core)) { const m = /^([A-Z]+?)(TT|T|L|H|II)$/.exec(core); if (m && segment(m[1])) { core = m[1]; tail = m[2] === 'H' ? ' II' : ' I'; } }
    const seg = segment(core); return seg ? seg.join(' ') + tail : tok;
  });
}
function niceTitle(t0) {
  // mixed-case garbage from the photo reader (GmNeRALcHEMISTRY) is treated as capitals
  const t = t0.split(' ').map((tok) => (/^([A-Z][a-z]+|[a-z]+|[A-Z]+|[A-Z][a-z]+,)$/.test(tok) || !/[A-Za-z]{4,}/.test(tok) ? tok : tok.toUpperCase())).join(' ');
  const letters = t.replace(/[^A-Za-z]/g, '');
  const caps = letters && letters === letters.toUpperCase();
  let out = respace(t);
  if (caps) {
    out = out.split(' ').map((w, i) => {
      if (ROMAN.test(w)) return w;
      const lw = w.toLowerCase();
      if (i > 0 && SMALL.has(w)) return lw;
      return lw.replace(/(^|[-(\/])([a-z])/g, (m, x, y) => x + y.toUpperCase());
    }).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}
const isJunk = (tok) => (tok.length >= 2 && !/[AEIOUY]/i.test(tok) && !/^[0-9]+$/.test(tok)) || /[~=]/.test(tok) || /^[^A-Za-z0-9]+$/.test(tok) || (tok.length === 1 && /[A-Za-z]/.test(tok) && !/[CREBIAVXcrebiavx]/.test(tok));

// When the letters of a code cannot be repaired, the title often says what it is.
const HINTS = [[/BIOCHEM/i, 'BCM'], [/CHEMISTRY|CHEMICAL/i, 'CHM'], [/PHYSICS/i, 'PHY'], [/BIOLOGY/i, 'BIO'], [/MATHEMATICS/i, 'MTH'], [/COMPUT/i, 'COS'], [/LIBRARY/i, 'LIB'], [/COMMUNICATION IN ENGLISH|NIGERIAN PEOPLES|LEADERSHIP|MENTAL HEALTH|PEACE/i, 'GST']];
const hintPrefix = (name) => { const h = HINTS.find(([re]) => re.test(name)); return h ? h[1] : ''; };
const NUMWORD = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };

export function parseCourseForm(raw, opts = {}) {
  const known = new Set(PREFIXES.concat(opts.prefixes || []));
  const lines = String(raw || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { department: '', level: 0, session: '', expectedCount: 0, expectedUnits: 0, courses: [], notes: [] };
  let sem = 0, pending = [], seen = new Set(), last = null;
  const attachTail = () => { if (pending.length && last && !last.sem0) { last.name = niceTitle((last.name + ' ' + pending.join(' ')).trim()); } pending = []; };
  for (const line0 of lines) {
    const line = line0.replace(/[|[\]_~“”‘’]+/g, ' ').replace(/\s+/g, ' ').trim(); const U = line.toUpperCase();
    // header facts
    let m;
    if (!out.department && (m = /DEPARTMENT\W+([A-Z][A-Za-z &,\-]{3,}?)(?=\s{2,}|\s+(REGISTRATION|ADMISSION|LEVEL|PROGRAMME)\b|$)/i.exec(line))) out.department = m[1].trim();
    if (!out.level && /LEVEL|YEAR/i.test(line)) { m = /([1-6])\s?0\s?0/.exec(line); if (m) out.level = Number(m[1]) * 100; else { m = /YEAR\s+(ONE|TWO|THREE|FOUR|FIVE|SIX)/i.exec(line); if (m) out.level = NUMWORD[m[1].toUpperCase()] * 100; } }
    if (!out.session && (m = /(20\d\d)\s*\/\s*(20\d\d)/.exec(line)) && /REGISTR|ENROL|SESSION/i.test(line)) out.session = m[1] + '/' + m[2];
    if (!out.expectedCount && /REGISTERED/.test(U) && (m = /\((\d{1,2})\)/.exec(line))) out.expectedCount = Number(m[1]);
    if (!out.expectedUnits && (m = /UNIT\w*\s+REGISTERED\W*(\d{1,3})\b/i.exec(line))) out.expectedUnits = Number(m[1]);
    // semester headings
    if (/SEMESTER/.test(U) && !/\d{3}/.test(U.replace(/20\d\d/g, ''))) {
      if (/FIRST|1ST|\bI\b/.test(U)) { attachTail(); sem = 1; continue; }
      if (/SECOND|2ND|\bII\b/.test(U)) { attachTail(); sem = 2; continue; }
    }
    if (/^TOTAL\b/.test(U)) { attachTail(); continue; }
    // a course row: three letters, three digits
    const cm = /(?:^|[^A-Z0-9])([A-Z0-9]{3})\s?([0-9OILSBZQD]{3})(?![0-9A-Z])/.exec(U.replace(/\b(20\d\d)\b/g, ' '));
    if (!cm || NOT_COURSE.test(U)) {
      if (!NOT_COURSE.test(U) && /^[A-Z ,&\-()']{12,}$/.test(U) && !/\d/.test(U)) pending.push(line);
      continue;
    }
    let letters = cm[1], digits = cm[2];
    letters = letters.replace(/[0158Z2]/g, (c) => DIGIT_TO_LETTER[c] || c);
    digits = digits.replace(/[OQDILSBZ]/g, (c) => LETTER_TO_DIGIT[c] || c);
    if (!/^[A-Z]{3}$/.test(letters) || !/^[0-9]{3}$/.test(digits)) continue;
    const fp = fixPrefix(letters, known);
    let code = fp.prefix + digits;
    const idx = U.indexOf(cm[0].trim().slice(0, 3)); const after = line.slice(Math.max(0, idx) + cm[0].trim().length).trim();
    let rest = ' ' + after.replace(/^[\s\-–—:.,)]+/, '') + ' ';
    // units and status, in any order, at the end of the line
    let units = 0, status = '';
    let u = /\(?\b(\d)\s*(?:units?|u)\b\)?/i.exec(rest); if (u) { units = Number(u[1]); rest = rest.replace(u[0], ' '); }
    let words = rest.replace(/[^A-Za-z0-9,&()\-'\/ ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const junkTail = () => { while (words.length && isJunk(words[words.length - 1]) && !ROMAN.test(words[words.length - 1].toUpperCase())) words.pop(); };
    junkTail();
    for (let k = 0; k < 3 && words.length > 1; k++) {
      const w = words[words.length - 1];
      if (/^[CREBcreb]$/.test(w) && !status) { status = w.toUpperCase(); words.pop(); }
      else if (/^[1-9]$/.test(w) && !units) { units = Number(w); words.pop(); }
      else break;
      junkTail();
    }
    while (words.length > 2 && words[words.length - 1].length <= 2 && !/^(I|II|III|IV|V|VI|AND|OF|TO|IN|ON|A|AN|BY|AT)$/i.test(words[words.length - 1])) words.pop();
    let name = words.join(' ');
    if (seen.has(code)) { pending = []; continue; }
    seen.add(code);
    if (pending.length) { name = (pending.join(' ') + ' ' + name).trim(); pending = []; }
    const nm = niceTitle(name);
    if (!PREFIXES.includes(fp.prefix) && hintPrefix(nm) && hintPrefix(nm) !== fp.prefix) { code = hintPrefix(nm) + digits; fp.flag = 'prefix-fixed'; }
    const row = { code, name: nm, units: units >= 1 && units <= 9 ? units : 0, status, semester: sem || (Number(digits[2]) % 2 ? 1 : 2), level: Number(digits[0]) * 100, flags: [] };
    if (fp.flag) row.flags.push(fp.flag);
    if (!row.name) row.flags.push('no-title');
    if (!row.units) row.flags.push('no-unit');
    out.courses.push(row); last = row;
  }
  attachTail();
  const sum = out.courses.reduce((a, c) => a + c.units, 0);
  if (out.expectedCount && out.expectedCount !== out.courses.length) out.notes.push('The form says ' + out.expectedCount + ' courses but ' + out.courses.length + ' were found. Add or fix the missing ones below.');
  if (out.expectedUnits && sum && out.expectedUnits !== sum) out.notes.push('The form says ' + out.expectedUnits + ' units in total but the rows add up to ' + sum + '. Check the units.');
  if (out.level) for (const c of out.courses) if (c.level !== out.level) c.flags.push('level-differs');
  return out;
}

// Best match of a department name from the form among the app's departments (or null).
export function matchDepartment(name, departments) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\b(and|of|the|department|dept|science|sciences)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const n = norm(name); if (!n) return null;
  let best = null, score = 0;
  for (const d of departments) {
    const dn = norm(d.name); if (!dn) continue;
    let s = dn === n ? 3 : (dn.includes(n) || n.includes(dn)) ? 2 : 0;
    if (!s) { const a = new Set(n.split(' ')), b = dn.split(' '); const hit = b.filter((w) => a.has(w)).length; s = hit && hit === Math.min(a.size, b.length) ? 1 : 0; }
    if (s > score) { score = s; best = d; }
  }
  return best;
}
export const flagText = (f) => ({ 'prefix-fixed': 'Course letters were corrected. Check the code.', 'prefix-unknown': 'Unusual course code. Check it.', 'no-title': 'No title was read.', 'no-unit': 'No unit was read.', 'level-differs': 'The code looks like a different level.' }[f] || f);

/* ---------- a list of departments under faculty headings ---------- */
const titleCase = (t) => t.toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(And|Of|The|In|For)\b(?!$)/g, (w, x, i) => (i ? w.toLowerCase() : w)).replace(/\b(Ict|Mls|Nd|Hnd)\b/g, (w) => w.toUpperCase());
const stripBullet = (l) => l.replace(/^\s*(?:\(?\d{1,3}\s*[.)\-:]|\(?[ivxIVX]{1,4}\)|[\u2022*\u00b7>-])\s*/, '').replace(/^\d{1,3}\s+(?=[A-Za-z])/, '');
export function parseDeptList(raw) {
  const groups = []; let cur = null;
  for (const l0 of String(raw || '').replace(/\r/g, '').split('\n')) {
    let l = l0.replace(/[|_~\u201c\u201d]+/g, ' ').replace(/\s+/g, ' ').trim(); if (!l) continue;
    const head = /\b(faculty|college|school)\b/i.test(l) || /:$/.test(l);
    if (head) {
      const name = l.replace(/^\s*(?:\(?\d{1,3}\s*[.)\-:]|\(?[ivxIVX]{1,4}\))\s*/, '').replace(/^(the\s+)?(faculty|college|school)\s*(of\s*)?:?\s*/i, '').replace(/[:\s]+$/, '').trim();
      if (name.length >= 3) { cur = { faculty: titleCase(name), departments: [] }; groups.push(cur); }
      continue;
    }
    l = stripBullet(l).replace(/^(department|dept\.?|programme|program)\s*(of|in)?\s*:?\s*/i, '').replace(/\s*\(\s*\d\s*years?\s*\)\s*$/i, '').replace(/[.,;:\s]+$/, '').trim();
    if (!/[A-Za-z]{3,}/.test(l) || /^(s\/?n|no|name|departments?|programmes?|programs?)$/i.test(l) || /^page\s*\d+/i.test(l)) continue;
    if (!cur) { cur = { faculty: '', departments: [] }; groups.push(cur); }
    const nm = titleCase(l); if (!cur.departments.some((d) => d.toLowerCase() === nm.toLowerCase())) cur.departments.push(nm);
  }
  return groups.filter((g) => g.departments.length || g.faculty);
}
// Faculty name from a list matched to an existing faculty (or null).
export function matchFaculty(name, faculties) {
  const n = String(name || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\b(faculty|of|and|the)\b/g, ' ').replace(/\s+/g, ' ').trim(); if (!n) return null;
  return faculties.find((f) => String(f.name).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\b(faculty|of|and|the)\b/g, ' ').replace(/\s+/g, ' ').trim() === n) || null;
}
