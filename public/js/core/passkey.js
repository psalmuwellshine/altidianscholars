// Fingerprint / face / screen-lock sign-in (passkeys). The phone keeps the key; Altidian keeps only the public half.
import { html, icon, api, toast, confirmBox, ago } from './ui.js';

const toBuf = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer; };
const toB64u = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// The in-app browsers inside WhatsApp, Facebook and Instagram usually cannot do this, so the button is hidden there.
export const supported = () => {
  try {
    if (!window.PublicKeyCredential || !navigator.credentials || !window.isSecureContext) return false;
    return !/FBAN|FBAV|Instagram|WhatsApp|; wv\)|Line\//i.test(navigator.userAgent || '');
  } catch (e) { return false; }
};
const FLAG = 'alt-passkey-on';
const flag = (v) => { try { if (v === undefined) return localStorage.getItem(FLAG) === '1'; if (v) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch (e) { /* ignore */ } return false; };
export const onThisPhone = () => flag();
const ASKED = 'alt-passkey-asked';

const friendly = (e) => {
  if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return 'Cancelled. Nothing was changed.';
  if (e && e.name === 'InvalidStateError') return 'This phone already has a passkey for Altidian.';
  if (e && e.name === 'NotSupportedError') return 'This phone or browser cannot use fingerprint login. Use your password instead.';
  return (e && e.message) || 'Could not use fingerprint login. Use your password instead.';
};
const deviceName = () => { const u = navigator.userAgent || ''; return /iPhone|iPad/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android phone' : /Windows/.test(u) ? 'Windows computer' : /Mac/.test(u) ? 'Mac' : 'This device'; };

export async function register(scope) {
  const o = await api('POST', '/api/passkey/register/options', { scope });
  const pk = o.publicKey;
  pk.challenge = toBuf(pk.challenge); pk.user.id = toBuf(pk.user.id); pk.excludeCredentials = (pk.excludeCredentials || []).map((c) => ({ type: c.type, id: toBuf(c.id) }));
  let cred;
  try { cred = await navigator.credentials.create({ publicKey: pk }); } catch (e) { throw new Error(friendly(e)); }
  if (!cred) throw new Error('Cancelled. Nothing was changed.');
  const r = await api('POST', '/api/passkey/register/verify', { scope, name: deviceName(), credential: { id: cred.id, response: { clientDataJSON: toB64u(cred.response.clientDataJSON), attestationObject: toB64u(cred.response.attestationObject) } } });
  flag(true);
  return r;
}

export async function signIn(scope) {
  const o = await api('POST', '/api/passkey/login/options', { scope });
  const pk = o.publicKey; pk.challenge = toBuf(pk.challenge);
  let cred;
  try { cred = await navigator.credentials.get({ publicKey: pk }); } catch (e) { throw new Error(friendly(e)); }
  if (!cred) throw new Error('Cancelled.');
  const r = cred.response;
  return api('POST', '/api/passkey/login/verify', { scope, credential: { id: cred.id, response: { clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature), userHandle: r.userHandle ? toB64u(r.userHandle) : '' } } });
}

// The "Log in with fingerprint" button.
export const loginButton = (scope) => (supported()
  ? html`<div class="or-line" style="text-align:center;margin:14px 0 10px"><span class="muted small">or</span></div>
      <button class="btn ghost block" type="button" data-action="${scope === 'admin' ? 'pk-admin-login' : 'pk-login'}">${icon('lock', 17)} Log in with fingerprint</button>` : '');

// The card that lists this person's passkeys, with add and remove.
export function card(list, scope) {
  const adm = scope === 'admin';
  if (!supported()) return html`<div class="card" style="max-width:640px;margin-top:16px"><h3>${icon('lock', 18)} Fingerprint login</h3><p class="muted small">This browser cannot use fingerprint login. Open Altidian in Chrome or Samsung Internet on a phone that has a fingerprint or screen lock.</p></div>`;
  return html`<div class="card" style="max-width:640px;margin-top:16px"><h3>${icon('lock', 18)} Fingerprint login</h3>
    <p class="muted small">Log in with your fingerprint, face or screen lock instead of typing your ${adm ? 'admin ' : ''}password. Your fingerprint never leaves your phone. Your password still works.</p>
    ${list.length ? html`<ul class="pk-list" style="list-style:none;padding:0;margin:12px 0">${list.map((k) => html`<li class="row between" style="padding:8px 0;border-bottom:1px solid var(--line,#e3ecff)"><span><b>${k.name}</b><br><span class="tiny muted">Added ${ago(k.createdAt)} · ${k.lastUsedAt ? 'last used ' + ago(k.lastUsedAt) : 'not used yet'}</span></span><button class="btn ghost small" type="button" data-action="${adm ? 'pk-admin-remove' : 'pk-remove'}" data-id="${k.id}">Remove</button></li>`)}</ul>` : ''}
    <button class="btn primary" type="button" style="margin-top:8px" data-action="${adm ? 'pk-admin-add' : 'pk-add'}">${list.length ? 'Add another phone' : 'Turn on fingerprint login'}</button></div>`;
}

export async function addFlow(scope) { const r = await register(scope); toast(r.message); return r; }
export async function removeFlow(scope, id) {
  if (!(await confirmBox({ title: 'Remove this passkey?', text: 'This phone will go back to using your password.', yes: 'Remove', danger: true }))) return false;
  await api('DELETE', '/api/passkey/' + encodeURIComponent(id));
  if (scope !== 'admin') flag(false);
  toast('Removed.'); return true;
}

// After a password login, offer the fingerprint once.
export async function offerAfterLogin() {
  try {
    if (!supported() || flag() || localStorage.getItem(ASKED)) return;
    localStorage.setItem(ASKED, '1');
  } catch (e) { return; }
  const yes = await confirmBox({ title: 'Log in with your fingerprint next time?', text: 'It is faster than typing your password. Your fingerprint stays on your phone, and your password still works. You can turn this off in your profile.', yes: 'Turn on' });
  if (!yes) return;
  try { await addFlow('user'); } catch (e) { toast(e.message, 'bad'); }
}
