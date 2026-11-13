/* "Our channels" and "Contact support": one place for every link, opened from a button instead of scattered around the pages. */
import { html, icon, dialog, toast } from '../core/ui.js';

const SUPPORT_EMAIL = 'support@altidian.com.ng'; // used until the admin sets another one under Settings
const CHANNELS = [
  { k: 'whatsapp', name: 'WhatsApp', hint: 'Join our channel for updates', color: '#25D366' },
  { k: 'telegram', name: 'Telegram', hint: 'Study materials and notices', color: '#229ED9' },
  { k: 'youtube', name: 'YouTube', hint: 'Video lessons and tutorials', color: '#E02424' },
  { k: 'instagram', name: 'Instagram', hint: 'News and behind the scenes', color: '#D6249F' },
  { k: 'tiktok', name: 'TikTok', hint: 'Short study tips', color: '#1f2937' },
  { k: 'facebook', name: 'Facebook', hint: 'Follow our page', color: '#1877F2' },
  { k: 'x', name: 'X (Twitter)', hint: 'Quick updates', color: '#1f2937' },
  { k: 'website', name: 'Website', hint: 'Visit our website', color: '#0f766e' },
];
export const supportEmail = (L) => (L && L.email) || SUPPORT_EMAIL;

export const actions = {
  'channels-open'(el, ev, { config }) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const L = config().links || {};
    const list = CHANNELS.filter((c) => L[c.k]);
    dialog(html`<div class="sheet"><h3>Our channels</h3><p class="tiny muted">Follow ${config().siteName} where you like.</p>
      <div class="chan-list">${list.length ? list.map((c) => html`<a class="chan" href="${L[c.k]}" target="_blank" rel="noopener noreferrer"><span class="chan-dot" style="background:${c.color}">${c.name.charAt(0)}</span><span class="chan-t"><b>${c.name}</b><span class="tiny muted">${c.hint}</span></span>${icon('arrow', 16)}</a>`) : html`<p class="muted">Our channels will appear here soon.</p>`}</div>
      <button class="btn ghost block" data-close type="button">Close</button></div>`);
  },
  'support-open'(el, ev, { config, user }) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const L = config().links || {}; const mail = supportEmail(L); const cfg = config(); const me = user && user();
    // One WhatsApp button per support admin, so either of them can reply. (The channel link is for "Our channels" only.)
    const text = 'Hello, I need help on ' + cfg.siteName + '.' + (me && me.username ? '\nUsername: ' + me.username : '');
    const withText = (wa) => (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(wa) ? wa + (wa.includes('?') ? '&' : '?') + 'text=' + encodeURIComponent(text) : wa);
    const admins = [1, 2].map((i) => ({ name: cfg['support' + i + 'Name'] || 'Admin ' + i, wa: cfg['support' + i + 'Wa'] })).filter((a) => a.wa);
    const sub = encodeURIComponent(config().siteName + ' support');
    dialog(html`<div class="sheet"><h3>Contact support</h3><p class="tiny muted">Having a problem with the app, a payment or your account? Write to us and we will reply as soon as we can.${admins.length > 1 ? ' Either admin can help, so pick whoever you like.' : ''}</p>
      <div class="more-list">
        <a class="btn primary" href="mailto:${mail}?subject=${sub}">${icon('mail', 16)} Email ${mail}</a>
        ${admins.map((a) => html`<a class="btn ghost" href="${withText(a.wa)}" target="_blank" rel="noopener noreferrer">Chat with ${a.name} on WhatsApp</a>`)}
        <button class="btn ghost" data-copy-support="${mail}" type="button">Copy email address</button>
      </div><button class="btn ghost block" data-close type="button">Close</button></div>`);
  },
};

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-copy-support]'); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copySupport); toast('Email address copied.'); } catch (e) { toast(b.dataset.copySupport); }
});
