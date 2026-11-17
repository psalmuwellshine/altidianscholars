// The receipt sheet (on screen and on paper), its "scan to verify" QR code, and printing that always fits one A4 page.
import { html, raw, icon, fmtDate, kindLabel, siteOrigin } from '../core/ui.js';
import { qrMatrix, qrPath } from '../core/qr.js';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const CH = { card: 'Card', bank: 'Bank', bank_transfer: 'Bank transfer', ussd: 'USSD', qr: 'QR code', mobile_money: 'Mobile money', apple_pay: 'Apple Pay' };
const MAX_SHOWN = 10; // more than this and the rest are summed up in one line, so a sheet never needs a second page

const kindName = (k) => (k === 'quiz' ? 'Quiz' : kindLabel[k] || 'Resource');
const dayOf = (iso) => fmtDate(Date.parse(iso + 'T00:00:00Z'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The QR code as inline SVG (a white tile with a quiet border, so phones read it easily). */
export function qrSvg(text, px) {
  let m; try { m = qrMatrix(text); } catch (e) { return ''; }
  const { d, size } = qrPath(m, 2);
  return raw(`<svg class="rc-qr" width="${px}" height="${px}" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code to verify this receipt" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0F1B3D"/></svg>`);
}

export function receiptSheet(r, who) {
  const online = r.via === 'online';
  const via = online ? 'Paystack' + (r.channel ? ' · ' + (CH[r.channel] || r.channel) : '') : 'Unlocked by an Altidian admin';
  const items = Array.isArray(r.items) ? r.items : [];
  const shown = items.slice(0, MAX_SHOWN); const total = Math.max(r.itemCount || 0, items.length); const more = total - shown.length;
  const saved = r.kind === 'pack' && r.value > r.amount ? r.value - r.amount : 0;
  const link = r.code ? siteOrigin() + '/verify/' + r.code : '';
  return html`<div class="rc-sheet">
    <div class="rc-head"><img class="rc-logo" src="/logo.png" alt="" width="46" height="53"><div class="rc-brand"><b>ALTIDIAN</b><span>Payment receipt</span></div><div class="rc-stamp ${online ? 'ok' : 'gold'}">${online ? 'PAID' : 'UNLOCKED'}</div></div>
    <div class="rc-body">
      <div class="rc-meta"><div>Receipt no.<b class="mono">${r.no}</b></div><div class="r">Date<b>${fmtDate(r.at, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</b></div></div>
      <table class="rc-tbl"><thead><tr><th>${r.kind === 'pack' ? 'What you got' : 'Item'}</th><th class="r">${r.kind === 'pack' ? 'Value' : 'Amount'}</th></tr></thead><tbody>
        ${r.kind === 'pack' ? html`<tr class="rc-group"><td colspan="2"><b>${r.title}</b> <span class="sub">· ${plural(total)}</span></td></tr>
          ${shown.map((x) => html`<tr><td>${x.title}<br><span class="sub">${x.course ? x.course + ' · ' : ''}${kindName(x.kind)}</span></td><td class="r">${x.price ? naira(x.price) : '—'}</td></tr>`)}
          ${more > 0 ? html`<tr><td colspan="2" class="sub">…and ${more} more ${more === 1 ? 'item' : 'items'}</td></tr>` : ''}`
          : html`<tr><td>${r.title}${r.until ? html`<br><span class="sub">Valid until ${dayOf(r.until)}</span>` : ''}</td><td class="r">${r.amount ? naira(r.amount) : '—'}</td></tr>`}
      </tbody></table>
      ${saved ? html`<div class="rc-save"><span>Value of items ${naira(r.value)}</span><span>You saved ${naira(saved)}</span></div>` : ''}
      <div class="rc-total"><span>${r.kind === 'pack' ? 'Pack price' : online ? 'Total paid' : 'Value'}</span><b>${r.amount ? naira(r.amount) : '—'}</b></div>
      <div class="rc-rows"><div>Method<b>${via}</b></div>${r.pref ? html`<div>Reference<b class="mono">${r.pref}</b></div>` : ''}${who ? html`<div>Student<b>${who}</b></div>` : ''}</div>
      ${link ? html`<div class="rc-verify">${qrSvg(link, 132)}<p><b>Scan to verify</b>Anyone can confirm this receipt is genuine by scanning the code, or by entering the code below at altidian.com.ng/verify<span class="rc-code mono">${r.code}</span></p></div>` : ''}
    </div>
    <div class="rc-foot">Thank you for learning with Altidian.<br><i>Rise to your highest point.</i><br>support@altidian.com.ng · altidian.com.ng</div>
  </div>`;
}
const plural = (n) => n + (n === 1 ? ' item' : ' items');

/** Put the sheet on paper-sized ground, shrink it if needed so it fits one A4 page, then open the print dialog. */
export function printSheet(sheet) {
  const w = document.createElement('div'); w.className = 'rcpt-print'; const copy = sheet.cloneNode(true); w.appendChild(copy); document.body.appendChild(w);
  // Measure at the real printable width (A4 less 12 mm margins = 186 mm wide, 273 mm tall), off screen.
  w.style.cssText = 'display:block;position:absolute;left:-9999px;top:0;width:186mm;visibility:hidden';
  const limit = (268 / 25.4) * 96; // keep a few millimetres of air under the 273 mm printable height
  const h = copy.getBoundingClientRect().height;
  if (h > limit) copy.style.zoom = String(Math.max(0.5, limit / h));
  w.style.cssText = '';
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); w.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50);
  return w;
}
