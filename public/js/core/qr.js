// A small QR code maker (byte mode, error correction level M, versions 1 to 10: up to 213 characters).
// Used for the "scan to verify" code on receipts. No outside library, so nothing extra to load.

// [number of blocks, codewords per block, data codewords per block] for each version at level M.
const BLOCKS = [
  [[1, 26, 16]], [[1, 44, 28]], [[1, 70, 44]], [[2, 50, 32]], [[2, 67, 43]],
  [[4, 43, 27]], [[4, 49, 31]], [[2, 60, 38], [2, 61, 39]], [[3, 58, 36], [2, 59, 37]], [[4, 69, 43], [1, 70, 44]],
];
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/* ----- arithmetic over GF(256), used by the error-correction codewords ----- */
const EXP = new Array(512); const LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsRemainder(data, ecLen) {
  const div = new Array(ecLen).fill(0); div[ecLen - 1] = 1; let root = 1;
  for (let i = 0; i < ecLen; i++) {
    for (let j = 0; j < ecLen; j++) { div[j] = mul(div[j], root); if (j + 1 < ecLen) div[j] ^= div[j + 1]; }
    root = mul(root, 2);
  }
  const res = new Array(ecLen).fill(0);
  for (const b of data) { const f = b ^ res.shift(); res.push(0); for (let i = 0; i < ecLen; i++) res[i] ^= mul(div[i], f); }
  return res;
}

const capacity = (v) => BLOCKS[v - 1].reduce((n, [c, , d]) => n + c * d, 0);

function dataCodewords(bytes, version) {
  const bits = []; const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, version < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  const cap = capacity(version) * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const out = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; out.push(b); }
  for (let pad = 0xec; out.length < capacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function withErrorCorrection(data, version) {
  const blocks = []; let at = 0;
  for (const [count, total, dcount] of BLOCKS[version - 1]) {
    for (let i = 0; i < count; i++) { const d = data.slice(at, at + dcount); at += dcount; blocks.push({ d, ec: rsRemainder(d, total - dcount) }); }
  }
  const out = []; const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < blocks[0].ec.length; i++) blocks.forEach((b) => out.push(b.ec[i]));
  return out;
}

/** The code as a grid of true (dark) and false (light) modules. */
export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  let version = 1; while (version <= 10 && Math.ceil((4 + (version < 10 ? 8 : 16) + bytes.length * 8) / 8) > capacity(version)) version++;
  if (version > 10) throw new Error('That is too long for a QR code here.');
  const size = 17 + 4 * version;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false)); const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { mod[y][x] = dark; fn[y][x] = true; } };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const pos = ALIGN[version - 1];
  pos.forEach((px, i) => pos.forEach((py, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const formatBits = (mask) => { const data = (0 << 3) | mask; let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return ((data << 10) | rem) ^ 0x5412; };
  const drawFormat = (mask) => {
    const bits = formatBits(mask); const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) { const dark = ((bits >>> i) & 1) !== 0; const a = size - 11 + (i % 3); const b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }

  const codewords = withErrorCorrection(dataCodewords(bytes, version), version);
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j; const up = ((right + 1) & 2) === 0; const y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && n < codewords.length * 8) { mod[y][x] = ((codewords[n >>> 3] >>> (7 - (n & 7))) & 1) !== 0; n++; }
    }
  }

  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0, (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0];
  const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  const penalty = () => {
    let p = 0;
    const line = (get) => {
      let run = 1;
      for (let i = 1; i < size; i++) { if (get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      const s = []; for (let i = 0; i < size; i++) s.push(get(i) ? 1 : 0); const str = s.join('');
      for (const pat of ['10111010000', '00001011101']) { let at = -1; while ((at = str.indexOf(pat, at + 1)) !== -1) p += 40; }
    };
    for (let y = 0; y < size; y++) line((i) => mod[y][i]);
    for (let x = 0; x < size; x++) line((i) => mod[i][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
    let dark = 0; mod.forEach((r) => r.forEach((c) => { if (c) dark++; }));
    p += Math.max(0, Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
    return p;
  };
  let best = 0; let bestScore = Infinity;
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const s = penalty(); if (s < bestScore) { bestScore = s; best = m; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return mod;
}

/** One SVG path that draws every dark module as a 1 x 1 square (row by row, joining runs). */
export function qrPath(matrix, quiet = 0) {
  let d = '';
  matrix.forEach((row, y) => { let x = 0; while (x < row.length) { if (!row[x]) { x++; continue; } let e = x; while (e < row.length && row[e]) e++; d += `M${x + quiet} ${y + quiet}h${e - x}v1h-${e - x}z`; x = e; } });
  return { d, size: matrix.length + quiet * 2 };
}
