/* View-only reader for paid files (PDFs and images).
   The file is drawn onto canvases inside the page, so there is no Download or Save button,
   no right-click menu on the pages, and nothing to drag out. It stops casual saving; it cannot stop
   screenshots or screen recording, which no website can. */
import { html, icon, toast, esc } from '../core/ui.js';
import { embedOf } from '../core/video.js';

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
function closeViewer() {
  if (!current) return;
  const { root, task, onKey, io } = current; current = null;
  if (io) io.disconnect();
  if (task) task.destroy().catch(() => {});
  document.removeEventListener('keydown', onKey);
  root.remove();
  document.body.classList.remove('viewing');
}

const sizeCanvas = (canvas, cssW, cssH, scale) => {
  canvas.width = Math.floor(cssW * scale); canvas.height = Math.floor(cssH * scale);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
};

async function showPdf(buf, body) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), standardFontDataUrl: PDFJS + 'standard_fonts/', useWasm: false });
  current.task = task; // closing the task frees the document and its worker
  const pdf = await task.promise;
  const cssW = Math.max(240, Math.min(body.clientWidth - 16, 900));
  const first = await pdf.getPage(1); const v1 = first.getViewport({ scale: 1 });
  const ratio = v1.height / v1.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = Math.min(dpr, 2400 / cssW); // sharp when zoomed, without using too much memory
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
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) draw(e.target).catch(() => { e.target.textContent = 'This page could not be shown.'; }); }), { root: body, rootMargin: '600px 0px' });
  current.io = io; slots.forEach((s) => io.observe(s));
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

async function openViewer(m) {
  closeViewer();
  const root = document.createElement('div'); root.className = 'viewer'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', m.title);
  root.innerHTML = '<div class="v-bar"><div class="grow"><b class="v-title"></b><span class="v-count tiny"></span></div><button class="btn ghost small v-close" type="button">Close</button></div><div class="v-body"><p class="v-msg">Opening…</p></div>';
  root.querySelector('.v-title').textContent = m.title;
  document.body.appendChild(root); document.body.classList.add('viewing');
  const onKey = (ev) => { if (ev.key === 'Escape') closeViewer(); };
  document.addEventListener('keydown', onKey);
  current = { root, onKey };
  const close = root.querySelector('.v-close'); close.addEventListener('click', closeViewer); close.focus();
  const body = root.querySelector('.v-body');
  try {
    const res = await fetch('/files/' + encodeURIComponent(m.fileId), { headers: { 'X-Altidian-View': '1' }, credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 403 ? 'This file is locked. Unlock it first.' : 'Could not open this file. Check your connection and try again.');
    const type = (res.headers.get('Content-Type') || '').split(';')[0];
    const buf = await res.arrayBuffer();
    if (!current || current.root !== root) return; // closed while loading
    body.textContent = '';
    if (type === 'application/pdf') await showPdf(buf, body);
    else if (type.startsWith('image/')) await showImage(buf, type, body);
    else throw new Error('This file type cannot be viewed here.');
  } catch (e) {
    if (current && current.root === root) body.innerHTML = '<p class="v-msg"></p>', body.firstChild.textContent = e.message || 'Could not open this file.';
  }
}

// Plays a YouTube or Google Drive video inside the page.
function openVideo(m, emb) {
  closeViewer();
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
  current = { root, onKey };
  const close = root.querySelector('.v-close'); close.addEventListener('click', closeViewer); close.focus();
}

export const actions = {
  'play-video'(el, ev, { S }) {
    const m = S.state.materials.find((x) => x.id === el.dataset.id); const emb = m && !m.locked ? embedOf(m.link) : null;
    if (emb) openVideo(m, emb);
  },
  'view-file'(el, ev, { S }) {
    const m = S.state.materials.find((x) => x.id === el.dataset.id);
    if (m && m.fileId && !m.locked) openViewer(m);
  },
};
