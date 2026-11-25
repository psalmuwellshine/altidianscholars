/* In-app reader for PDFs and pictures (paid files are view-only; free ones also get a Download button).
   The file is drawn onto canvases inside the page, so there is no Download or Save button,
   no right-click menu on the pages, and nothing to drag out. It stops casual saving; it cannot stop
   screenshots or screen recording, which no website can. */
import { html, icon, toast, esc } from '../core/ui.js';
import { embedOf } from '../core/video.js';
import { list as savedList } from '../core/offline.js';
import { addAsk } from './ask.js';
import { canSpeak, speak, stop as stopSpeech, pause as pauseSpeech, resume as resumeSpeech, speechState, noVoiceHelp } from '../core/speech.js';

const PDFJS = '/vendor/pdfjs/';
let pdfjsPromise = null;
const loadPdfjs = () => pdfjsPromise || (pdfjsPromise = import(PDFJS + 'pdf.min.mjs').then((m) => {
  m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  return m;
}));

// Copying, cutting, dragging and the long-press menu are switched off on paid material.
['copy', 'cut', 'contextmenu', 'dragstart'].forEach((t) => document.addEventListener(t, (ev) => {
  if (ev.target && ev.target.closest && ev.target.closest('.no-copy, .viewer')) ev.preventDefault();
}, true));

let current = null;

// Can this file be shown inside Altidian? Paid files always are; free ones when they are a PDF or a picture.
// Word and PowerPoint files cannot be drawn by any browser, so they still open in the phone's own app.
export const canView = (m) => !!(m && m.fileId && (m.paid || /\.(pdf|png|jpe?g|gif|webp)$/i.test(m.fileName || '')));
// The button for a file: "View" (in-app) when possible, otherwise a normal open link.
export const fileBtn = (m, label = 'Open file', size = 16) => canView(m)
  ? html`<button class="btn primary small" data-action="view-file" data-id="${m.id}" type="button">${icon('eye', size)} View</button>`
  : html`<a class="btn primary small" href="/files/${m.fileId}" target="_blank" rel="noopener">${icon('download', size)} ${label}</a>`;

function teardown() {
  if (!current) return;
  const { root, task, onKey, io } = current; current = null;
  stopSpeech();
  if (io) io.disconnect();
  if (task) task.destroy().catch(() => {});
  document.removeEventListener('keydown', onKey);
  root.remove();
  document.body.classList.remove('viewing');
}
// The viewer takes one step in the browser history, so the phone's Back button closes it and
// returns to the page you were on, instead of leaving or closing the app.
function closeViewer() {
  if (!current) return;
  if (current.pushed && history.state && history.state.altv) {
    const r = current.root; history.back();
    setTimeout(() => { if (current && current.root === r) teardown(); }, 400); // if Back did not fire, close anyway
    return;
  }
  teardown();
}
function claimHistory() {
  const reuse = !!(current && current.pushed);
  teardown();
  return reuse;
}
function pushed(reuse) {
  try { reuse ? history.replaceState({ altv: 1 }, '') : history.pushState({ altv: 1 }, ''); if (current) current.pushed = true; } catch (e) { /* not available */ }
}
window.addEventListener('popstate', () => { if (current) teardown(); });

const sizeCanvas = (canvas, cssW, cssH, scale) => {
  canvas.width = Math.floor(cssW * scale); canvas.height = Math.floor(cssH * scale);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
};


// Reads a PDF aloud on the phone (no data used). It starts from the page you are looking at and moves on page by page.
// A PDF made of scanned pictures has no text to read.
function addListen(pdf, body) {
  if (!canSpeak()) return;
  const bar = body.parentNode.querySelector('.v-bar'); if (!bar) return;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn ghost small v-listen'; btn.textContent = 'Listen';
  bar.insertBefore(btn, bar.querySelector('.v-close'));
  let token = 0;
  const pageText = async (n) => { const pg = await pdf.getPage(n); const tc = await pg.getTextContent(); return tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(); };
  const topPage = () => { const top = body.getBoundingClientRect().top; let n = 1; body.querySelectorAll('.v-page').forEach((s) => { if (s.getBoundingClientRect().bottom > top + 40 && n === 1 && s.getBoundingClientRect().top <= top + 80) n = Number(s.dataset.n) || 1; }); return n; };
  const label = () => { const s = speechState(); btn.textContent = s === 'playing' ? 'Pause' : s === 'paused' ? 'Resume' : 'Listen'; };
  const run = async (from) => {
    const my = ++token; let said = 0;
    for (let n = from; n <= pdf.numPages && my === token; n++) {
      const t = await pageText(n); if (my !== token) return;
      if (t.length < 20) { if (n - from >= 2 && !said) break; continue; }
      said++;
      const slot = body.querySelector('.v-page[data-n="' + n + '"]'); if (slot) slot.scrollIntoView({ block: 'start', behavior: 'smooth' });
      await new Promise((res) => { if (!speak(t, { onstate: label, onend: res })) res(); });
    }
    if (my === token) { if (!said) toast('This PDF is made of scanned pictures, so it cannot be read aloud.', 'bad'); token++; label(); }
  };
  btn.addEventListener('click', () => {
    const s = speechState();
    if (s === 'playing') pauseSpeech(); else if (s === 'paused') resumeSpeech();
    else { const h = noVoiceHelp(); if (h) toast(h, 'bad'); run(topPage()); }
    label();
  });
}

async function showPdf(buf, body, m, S) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), standardFontDataUrl: PDFJS + 'standard_fonts/', useWasm: false });
  current.task = task; // closing the task frees the document and its worker
  const pdf = await task.promise;
  const cssW = Math.max(240, Math.min(body.clientWidth - 16, 900));
  const first = await pdf.getPage(1); const v1 = first.getViewport({ scale: 1 });
  const ratio = v1.height / v1.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // Draw about 1.8 times sharper than the screen needs, so a pinch-zoom on small print stays crisp (about 1700 px wide, capped).
  const scale = Math.max(dpr, Math.min(dpr * 1.8, 4, 1700 / cssW));
  const slots = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const slot = document.createElement('div'); slot.className = 'v-page'; slot.dataset.n = String(i);
    slot.style.width = cssW + 'px'; slot.style.height = Math.round(cssW * ratio) + 'px';
    body.appendChild(slot); slots.push(slot);
  }
  const pages = body.parentNode.querySelector('.v-count'); if (pages) pages.textContent = pdf.numPages + (pdf.numPages === 1 ? ' page' : ' pages');
  const draw = async (slot) => {
    if (slot.dataset.done) return; slot.dataset.done = '1';
    const page = await pdf.getPage(Number(slot.dataset.n));
    const base = page.getViewport({ scale: 1 }); const k = cssW / base.width;
    const viewport = page.getViewport({ scale: k * scale });
    const canvas = document.createElement('canvas'); canvas.draggable = false;
    sizeCanvas(canvas, cssW, Math.round(base.height * k), scale);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    slot.style.height = canvas.style.height; slot.textContent = ''; slot.appendChild(canvas);
  };
  // Pages are drawn as they scroll into view, so long PDFs stay light on a phone.
  // Sharper pages are bigger in memory, so a page far off screen is cleared and drawn again when it comes back.
  const release = (slot) => { const c = slot.querySelector('canvas'); if (!c) return; c.width = 0; c.height = 0; c.remove(); delete slot.dataset.done; };
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) draw(e.target).catch(() => { e.target.textContent = 'This page could not be shown.'; }); else if (e.target.dataset.done) release(e.target); }), { root: body, rootMargin: '1400px 0px' });
  current.io = io; slots.forEach((s) => io.observe(s));
  addListen(pdf, body);
  if (m && m.fileId && S && current) addAsk({ root: current.root, body, pdf, m, S, close: closeViewer });
}

async function showImage(buf, type, body) {
  const bmp = await createImageBitmap(new Blob([buf], { type }));
  const cssW = Math.min(body.clientWidth - 16, 900, bmp.width);
  const cssH = Math.round(cssW * (bmp.height / bmp.width));
  const canvas = document.createElement('canvas'); canvas.draggable = false;
  const scale = Math.min(window.devicePixelRatio || 1, 3, bmp.width / cssW);
  sizeCanvas(canvas, cssW, cssH, scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const slot = document.createElement('div'); slot.className = 'v-page'; slot.appendChild(canvas); body.appendChild(slot);
}

async function openViewer(m, S) {
  const reuse = claimHistory();
  const root = document.createElement('div'); root.className = 'viewer'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', m.title);
  root.innerHTML = '<div class="v-bar"><div class="grow"><b class="v-title"></b><span class="v-count tiny"></span></div><button class="btn ghost small v-close" type="button">Close</button></div><div class="v-body"><p class="v-msg">Opening…</p></div>';
  root.querySelector('.v-title').textContent = m.title;
  document.body.appendChild(root); document.body.classList.add('viewing');
  const onKey = (ev) => { if (ev.key === 'Escape') closeViewer(); };
  document.addEventListener('keydown', onKey);
  current = { root, onKey }; pushed(reuse);
  if (!m.paid && m.fileId) { const dl = document.createElement('a'); dl.className = 'btn ghost small v-dl'; dl.href = '/files/' + encodeURIComponent(m.fileId); dl.setAttribute('download', m.fileName || 'file'); dl.textContent = 'Download'; root.querySelector('.v-close').before(dl); }
  const close = root.querySelector('.v-close'); close.addEventListener('click', closeViewer); close.focus();
  const body = root.querySelector('.v-body');
  try {
    const res = await fetch('/files/' + encodeURIComponent(m.fileId), { headers: { 'X-Altidian-View': '1' }, credentials: 'same-origin', cache: m.paid ? 'no-store' : 'default' }); // free files may come from the phone's own copy (saves data)
    if (!res.ok) throw new Error(res.status === 403 ? 'This file is locked. Unlock it first.' : 'Could not open this file. Check your connection and try again.');
    const type = (res.headers.get('Content-Type') || '').split(';')[0];
    const buf = await res.arrayBuffer();
    if (!current || current.root !== root) return; // closed while loading
    body.textContent = '';
    if (type === 'application/pdf') await showPdf(buf, body, m, S);
    else if (type.startsWith('image/')) await showImage(buf, type, body);
    else throw new Error('This file type cannot be viewed here.');
  } catch (e) {
    if (current && current.root === root) body.innerHTML = '<p class="v-msg"></p>', body.firstChild.textContent = e.message || 'Could not open this file.';
  }
}

// Plays a YouTube or Google Drive video inside the page.
function openVideo(m, emb) {
  const reuse = claimHistory();
  const root = document.createElement('div'); root.className = 'viewer'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', m.title);
  root.innerHTML = '<div class="v-bar"><div class="grow"><b class="v-title"></b><span class="v-count tiny"></span></div><button class="btn ghost small v-close" type="button">Close</button></div><div class="v-body v-video"></div>';
  root.querySelector('.v-title').textContent = m.title; root.querySelector('.v-count').textContent = emb.label;
  const frame = document.createElement('iframe');
  frame.title = m.title; frame.src = emb.src; frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute('allow', 'fullscreen; encrypted-media; picture-in-picture');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
  root.querySelector('.v-body').appendChild(frame);
  document.body.appendChild(root); document.body.classList.add('viewing');
  const onKey = (ev) => { if (ev.key === 'Escape') closeViewer(); };
  document.addEventListener('keydown', onKey);
  current = { root, onKey }; pushed(reuse);
  const close = root.querySelector('.v-close'); close.addEventListener('click', closeViewer); close.focus();
}

export const actions = {
  'play-video'(el, ev, { S }) {
    const m = S.state.materials.find((x) => x.id === el.dataset.id); const emb = m && !m.locked ? embedOf(m.link) : null;
    if (emb) openVideo(m, emb);
  },
  'view-file'(el, ev, { S }) {
    const m = S.state.materials.find((x) => x.id === el.dataset.id) || (S.state.campus || []).find((x) => x.id === el.dataset.id) || savedList().find((x) => x.id === el.dataset.id);
    if (m && m.fileId && !m.locked) openViewer(m, S);
  },
};
