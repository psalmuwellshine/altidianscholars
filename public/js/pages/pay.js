/* "Unlock" for paid items, paid by bank transfer.
   The student sees the price and the admin's account details, transfers the money, then sends proof on WhatsApp.
   The admin then gives them access from Students -> Access. */
import { html, icon, toast, dialog } from '../core/ui.js';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const niceDate = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; } };

// wa.me links can carry a ready-written message. Group links cannot, so the student copies the message instead.
const waHref = (base, text) => (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(base) ? base + (base.includes('?') ? '&' : '?') + 'text=' + encodeURIComponent(text) : base);

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast(text); }
}

export const actions = {
  unlock(el, ev, { S, config, user }) {
    const c = config(); const u = user() || {}; const L = c.links || {};
    const item = S.state.materials.concat(S.state.quizzes).find((x) => x.id === el.dataset.id);
    if (!item) return;
    const passPrice = Number(c.passPrice) > 0 ? Number(c.passPrice) : 0;
    const ready = !!(c.payBank && c.payAccountNumber);
    const wa = L.whatsapp || '';

    if (!ready) {
      dialog(html`<h3>${icon('lock', 20)} ${item.title}</h3>
        <p style="margin:12px 0">This is a paid item (${naira(item.price)}). Payment details have not been set up yet, so please contact an admin to unlock it.</p>
        <div class="row gap wrap-r">${wa ? html`<a class="btn primary" href="${wa}" target="_blank" rel="noopener">Contact admin</a>` : ''}<button class="btn ghost" data-close type="button">Close</button></div>`);
      return;
    }

    const { box } = dialog(html`<h3>${icon('lock', 20)} Unlock</h3>
      <p class="muted small" style="margin:4px 0 14px">Pay by bank transfer, then send your proof. An admin will unlock it for you.</p>
      ${passPrice ? html`<label class="plan"><input type="radio" name="plan" value="pass" checked><span class="grow"><b>Semester pass</b><br><span class="small muted">Unlocks every paid note and quiz${c.passEnds ? ' until ' + niceDate(c.passEnds) : ''}</span></span><b>${naira(passPrice)}</b></label>` : ''}
      <label class="plan"><input type="radio" name="plan" value="item" ${passPrice ? '' : 'checked'}><span class="grow"><b>This item only</b><br><span class="small muted">${item.title}</span></span><b>${naira(item.price)}</b></label>
      <p class="small" style="margin:14px 0 6px"><b>1. Transfer <span data-amount></span> to:</b></p>
      <div class="acct"><div class="small muted">${c.payBank}</div><div class="num">${c.payAccountNumber}</div><div class="small">${c.payAccountName || ''}</div>
        <button class="btn ghost small" data-copy="${c.payAccountNumber}" type="button" style="margin-top:8px">Copy account number</button></div>
      ${c.payNote ? html`<p class="small muted" style="margin-top:8px">${c.payNote}</p>` : ''}
      <p class="small" style="margin:14px 0 6px"><b>2. Use your username “${u.username || ''}” as the transfer reference or narration.</b></p>
      <p class="small" style="margin:14px 0 6px"><b>3. Send your proof of payment:</b></p>
      <div class="row gap wrap-r">${wa ? html`<a class="btn primary" data-wa target="_blank" rel="noopener" href="${wa}">Send proof on WhatsApp</a>` : ''}<button class="btn ghost" data-copy-msg type="button">Copy message</button><button class="btn ghost" data-close type="button">Close</button></div>
      ${wa ? '' : html`<p class="small muted" style="margin-top:8px">Send the message and your payment receipt to an admin.</p>`}`);

    let message = '';
    const refresh = () => {
      const plan = (box.querySelector('input[name=plan]:checked') || {}).value || 'item';
      const amount = plan === 'pass' ? passPrice : Number(item.price);
      const what = plan === 'pass' ? 'the semester pass' : '“' + item.title + '”';
      message = 'Hello, I have paid ' + naira(amount) + ' for ' + what + ' on ' + (c.siteName || 'Altidian') + '.\nUsername: ' + (u.username || '') + (u.matric ? '\nMatric: ' + u.matric : '');
      box.querySelector('[data-amount]').textContent = naira(amount);
      const link = box.querySelector('[data-wa]'); if (link) link.href = waHref(wa, message);
      box.querySelectorAll('.plan').forEach((p) => p.classList.toggle('on', p.querySelector('input').checked));
    };
    box.addEventListener('change', refresh);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]'); if (b) return copy(b.dataset.copy);
      if (e.target.closest('[data-copy-msg]')) return copy(message);
      const w = e.target.closest('[data-wa]');
      if (w && !/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(wa)) copy(message); // group link: copy the message so it can be pasted
    });
    refresh();
  },
};
