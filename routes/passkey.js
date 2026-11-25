'use strict';
/* Passkey sign-in (fingerprint, face or screen lock) for students and for the admin. The password always keeps working. */
const H = require('../lib/helpers');
const P = require('../lib/passkey');
const { HttpError } = H;

module.exports = function registerPasskey({ route, store, send, userOf }) {
  const scopeOf = (b) => (b && b.scope === 'admin' ? 'admin' : 'user');

  // Who is adding a passkey: a signed-in student, or the signed-in admin.
  async function owner(req, scope) {
    if (scope === 'admin') { if (!H.isAdmin(req)) throw new HttpError(401, 'Log in to the admin panel first.'); return { id: 'admin', name: 'Altidian admin' }; }
    const u = await userOf(req); if (!u) throw new HttpError(401, 'Please log in first.');
    return { id: u.id, name: u.username };
  }
  const mine = async (ownerId, scope) => (await store.list('passkeys')).filter((r) => r.owner === ownerId && r.scope === scope);
  const label = (r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt || null });

  route('POST', '/api/passkey/register/options', { limit: ['pkreg', 20, 15 * 60 * 1000] }, async (req, res, ctx) => {
    const scope = scopeOf(ctx.body); const o = await owner(req, scope);
    const site = P.siteOf(req);
    const have = await mine(o.id, scope);
    if (have.length >= 5) throw new HttpError(400, 'You already have 5 passkeys. Remove one first.');
    const challenge = P.newChallenge({ kind: 'register', scope, owner: o.id });
    send(res, 200, { publicKey: {
      challenge, rp: { name: 'Altidian', id: site.rpId },
      user: { id: P.b64u(Buffer.from(scope + ':' + o.id)), name: o.name, displayName: o.name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none', timeout: 60000,
      excludeCredentials: have.map((r) => ({ type: 'public-key', id: r.id })),
    } });
  });

  route('POST', '/api/passkey/register/verify', { limit: ['pkreg', 20, 15 * 60 * 1000] }, async (req, res, ctx) => {
    const scope = scopeOf(ctx.body); const o = await owner(req, scope);
    let v;
    try { v = P.verifyRegistration(ctx.body.credential, P.siteOf(req)); } catch (e) { throw new HttpError(400, e.message || 'Could not save this passkey.'); }
    if (v.meta.kind !== 'register' || v.meta.scope !== scope || v.meta.owner !== o.id) throw new HttpError(400, 'That sign-in took too long. Please try again.');
    if (await store.get('passkeys', v.credentialId)) throw new HttpError(400, 'This passkey is already saved.');
    const name = H.clean(ctx.body.name, 40) || 'This phone';
    await store.put('passkeys', { id: v.credentialId, owner: o.id, scope, publicKey: v.publicKey, alg: v.alg, counter: v.counter, name, createdAt: Date.now() });
    send(res, 200, { ok: true, message: 'Fingerprint login is on for this phone.', list: (await mine(o.id, scope)).map(label) });
  });

  route('POST', '/api/passkey/login/options', { limit: ['pklogin', 60, 15 * 60 * 1000] }, async (req, res, ctx) => {
    const scope = scopeOf(ctx.body); const site = P.siteOf(req);
    if (scope === 'admin' && !H.ADMIN_PASSWORD) throw new HttpError(503, 'Admin is not set up.');
    send(res, 200, { publicKey: { challenge: P.newChallenge({ kind: 'login', scope }), rpId: site.rpId, allowCredentials: [], userVerification: 'required', timeout: 60000 } });
  });

  route('POST', '/api/passkey/login/verify', { limit: ['pklogin', 60, 15 * 60 * 1000] }, async (req, res, ctx) => {
    const scope = scopeOf(ctx.body); const cred = ctx.body.credential;
    const rec = cred && typeof cred.id === 'string' ? await store.get('passkeys', cred.id) : null;
    if (!rec || rec.scope !== scope) throw new HttpError(401, 'This phone’s passkey is not recognised. Log in with your password instead.');
    if (H.tooManyFails('pklogin', rec.id, 8)) throw new HttpError(429, 'Too many tries. Please wait 15 minutes.');
    let v;
    try { v = P.verifyAssertion(cred, rec, P.siteOf(req)); } catch (e) { H.noteFail('pklogin', rec.id, 15 * 60 * 1000); throw new HttpError(401, e.message || 'That passkey could not be verified.'); }
    if (v.meta.kind !== 'login' || v.meta.scope !== scope) throw new HttpError(401, 'That sign-in took too long. Please try again.');
    rec.counter = v.counter; rec.lastUsedAt = Date.now(); await store.put('passkeys', rec);
    if (scope === 'admin') {
      if (!H.ADMIN_PASSWORD) throw new HttpError(503, 'Admin is not set up.');
      return send(res, 200, { ok: true }, { 'Set-Cookie': H.makeCookie(req, 'ew_admin', 'admin', 'admin', 0, H.ADMIN_SESSION_HOURS * 3600) });
    }
    const user = await store.get('users', rec.owner);
    if (!user) throw new HttpError(401, 'This account no longer exists.');
    if (user.disabled) throw new HttpError(403, 'This account has been disabled. Please contact an Altidian admin.');
    user.lastLoginAt = Date.now(); await store.put('users', user);
    send(res, 200, { ok: true }, { 'Set-Cookie': H.makeCookie(req, 'ew_user', 'user', user.id, user.sv || 0, H.USER_SESSION_DAYS * 86400) });
  });

  route('GET', '/api/passkey/list', {}, async (req, res, ctx) => {
    const scope = ctx.query.get('scope') === 'admin' ? 'admin' : 'user';
    const o = await owner(req, scope);
    send(res, 200, { list: (await mine(o.id, scope)).map(label) });
  });

  route('DELETE', '/api/passkey/:id', {}, async (req, res, ctx) => {
    const id = (ctx.params && ctx.params[0]) || '';
    const rec = await store.get('passkeys', id);
    if (!rec) throw new HttpError(404, 'Not found.');
    const o = await owner(req, rec.scope);
    if (rec.owner !== o.id) throw new HttpError(403, 'Not yours.');
    await store.del('passkeys', id);
    send(res, 200, { ok: true, list: (await mine(o.id, rec.scope)).map(label) });
  });
};
