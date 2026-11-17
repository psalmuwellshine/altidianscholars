// Public page: confirm that a receipt is genuine. Opened by scanning the QR code on a receipt, or by typing its code.
import { html, icon, api, fmtDate } from '../core/ui.js';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

const form = (code) => html`<form class="vf-form" data-submit="verify-go"><label class="field"><span>Receipt code</span><input name="code" value="${code || ''}" placeholder="ALT-XXXXXXXX-XXXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" required></label><button class="btn primary" type="submit">Check receipt</button></form>`;

export const needsLogin = false;

export async function render(ctx, params) {
  const code = decodeURIComponent((params && params.code) || '').trim();
  if (!code) {
    return html`<div class="vf"><div class="vf-card"><div class="vf-badge info">${icon('search', 30)}</div><h2>Check a receipt</h2>
      <p class="sub">Every Altidian receipt has a code under its QR code. Type it here to confirm the receipt is genuine.</p>${form('')}</div></div>`;
  }
  let d = null; let msg = '';
  try { d = await api('GET', '/api/verify/' + encodeURIComponent(code)); } catch (e) { msg = e.status === 429 ? 'Too many checks from this connection. Please wait a few minutes and try again.' : ''; }
  if (!d || !d.ok) {
    return html`<div class="vf"><div class="vf-card"><div class="vf-badge no">!</div><h2>${msg ? 'Please wait a little' : 'We cannot find this receipt'}</h2>
      <p class="sub">${msg || 'The code may have been typed wrongly, or this receipt was not issued by Altidian. Please check it and try again.'}</p>${form(code)}
      <p class="tiny muted">If you think this is a mistake, write to support@altidian.com.ng and quote the receipt number.</p></div></div>`;
  }
  return html`<div class="vf"><div class="vf-card"><div class="vf-badge ok">${icon('check', 32)}</div><h2>Genuine receipt</h2>
    <p class="sub">${d.online ? 'This payment was made on Altidian.' : 'This access was unlocked on Altidian by an admin.'}</p>
    <div class="vf-rows"><div>Receipt no.<b class="mono">${d.no}</b></div><div>Item<b>${d.title}${d.count > 1 ? ' (' + d.count + ' items)' : ''}</b></div>${d.amount ? html`<div>Amount<b>${naira(d.amount)}</b></div>` : ''}${d.until ? html`<div>Valid until<b>${d.until}</b></div>` : ''}<div>Date<b>${fmtDate(d.at, { day: 'numeric', month: 'long', year: 'numeric' })}</b></div>${d.by ? html`<div>Student<b>${d.by}</b></div>` : ''}</div>
    <p class="tiny muted">For privacy, only part of the student's name is shown. Questions? support@altidian.com.ng</p>
    <p style="margin-top:10px"><a class="btn ghost small" href="#/verify">Check another receipt</a></p></div></div>`;
}

export const actions = {
  'verify-go'(form, ev) {
    ev.preventDefault();
    const code = String(new FormData(form).get('code') || '').trim().toUpperCase().replace(/\s+/g, '');
    if (code) location.hash = '#/verify/' + encodeURIComponent(code);
  },
};
