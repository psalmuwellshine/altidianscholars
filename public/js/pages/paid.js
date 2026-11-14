/* Where Paystack sends the student back after paying: #/paid?s=ok|pending|failed */
import { html, icon, toast } from '../core/ui.js';

export const paid = {
  needsLogin: true,
  async render(ctx, params, query) {
    await ctx.load(); // fresh data, so the unlocked item opens straight away
    const s = query.get('s') || 'unknown';
    if (s === 'ok') toast('Payment successful. Your item is unlocked.');
    const view = {
      ok: ['check', 'Payment received', 'Thank you! Your item is unlocked and a receipt is saved under My purchases.'],
      pending: ['clock', 'We are confirming your payment', 'This can take a minute. It unlocks by itself as soon as Paystack confirms. If it is still locked after a few minutes, contact support with your username.'],
      failed: ['flag', 'Payment was not completed', 'No money was taken for this attempt. You can try again from the item, or pay by bank transfer.'],
      unknown: ['flag', 'We could not find that payment', 'If you paid and your item is still locked, contact support with your username and the time you paid.'],
    }[s] || ['flag', 'Payment', ''];
    return html`<div class="card" style="max-width:520px;margin:30px auto;text-align:center"><div class="welcome-ico" style="margin:0 auto 12px">${icon(view[0], 30)}</div>
      <h2>${view[1]}</h2><p class="muted" style="margin:10px 0 18px">${view[2]}</p>
      <div class="row gap-s wrap-r" style="justify-content:center"><a class="btn primary" href="#/library">Open the library</a><a class="btn ghost" href="#/receipts">My purchases</a><a class="btn ghost" href="#/quizzes">Quizzes</a></div></div>`;
  },
};
