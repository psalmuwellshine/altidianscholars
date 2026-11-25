'use strict';
/*
  Passkeys (WebAuthn) without any extra package. The phone checks the owner's fingerprint, face or screen lock
  and signs a one-time challenge. The server keeps only the public key, never anything biometric.
  Only the "none" attestation is needed, so the attestation statement is not checked.
*/
const crypto = require('crypto');

/* ---------- a small CBOR reader (enough for WebAuthn) ---------- */
function cborRead(buf, pos) {
  let p = pos.i; const ib = buf[p++]; const mt = ib >> 5; let ai = ib & 31; let n;
  const need = (k) => { if (p + k > buf.length) throw new Error('cbor'); };
  if (ai < 24) n = ai;
  else if (ai === 24) { need(1); n = buf[p]; p += 1; }
  else if (ai === 25) { need(2); n = buf.readUInt16BE(p); p += 2; }
  else if (ai === 26) { need(4); n = buf.readUInt32BE(p); p += 4; }
  else throw new Error('cbor');
  pos.i = p;
  if (mt === 0) return n;
  if (mt === 1) return -1 - n;
  if (mt === 2 || mt === 3) { need(n); const b = buf.subarray(p, p + n); pos.i = p + n; return mt === 2 ? Buffer.from(b) : b.toString('utf8'); }
  if (mt === 4) { if (n > 64) throw new Error('cbor'); const a = []; for (let k = 0; k < n; k++) a.push(cborRead(buf, pos)); return a; }
  if (mt === 5) { if (n > 64) throw new Error('cbor'); const m = new Map(); for (let k = 0; k < n; k++) { const key = cborRead(buf, pos); m.set(key, cborRead(buf, pos)); } return m; }
  throw new Error('cbor');
}
const cbor = (buf) => cborRead(buf, { i: 0 });

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

/* ---------- challenges (kept for five minutes, used once) ---------- */
const challenges = new Map();
function newChallenge(meta) {
  const c = b64u(crypto.randomBytes(32));
  challenges.set(c, Object.assign({ exp: Date.now() + 5 * 60 * 1000 }, meta || {}));
  if (challenges.size > 5000) for (const [k, v] of challenges) if (Date.now() > v.exp) challenges.delete(k);
  return c;
}
function takeChallenge(c) { const v = challenges.get(c); challenges.delete(c); return v && Date.now() <= v.exp ? v : null; }

/* ---------- site identity ---------- */
function siteOf(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const rpId = host.replace(/:\d+$/, '');
  const secure = req.headers['x-forwarded-proto'] === 'https' || !!(req.socket && req.socket.encrypted);
  return { rpId, origin: (secure ? 'https://' : 'http://') + host };
}

function checkClientData(clientDataJSON, type, site) {
  let cd; try { cd = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); } catch (e) { throw new Error('Bad passkey data.'); }
  if (cd.type !== type) throw new Error('Bad passkey data.');
  if (cd.origin !== site.origin) throw new Error('This passkey is not for this website.');
  const meta = takeChallenge(cd.challenge);
  if (!meta) throw new Error('That sign-in took too long. Please try again.');
  return meta;
}

function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('Bad passkey data.');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], counter: ad.readUInt32BE(33), rest: ad.subarray(37) };
  return out;
}

/* ---------- registration ---------- */
function coseToSpki(cose) {
  const kty = cose.get(1); const alg = cose.get(3);
  let jwk;
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) jwk = { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) };
  else if (kty === 3 && alg === -257) jwk = { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) };
  else throw new Error('This phone uses a passkey type we do not support.');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return { alg, spki: key.export({ type: 'spki', format: 'der' }).toString('base64') };
}

function verifyRegistration(cred, site) {
  const r = cred && cred.response; if (!r) throw new Error('Bad passkey data.');
  const clientDataJSON = fromB64u(r.clientDataJSON);
  const meta = checkClientData(clientDataJSON, 'webauthn.create', site);
  const att = cbor(fromB64u(r.attestationObject));
  const ad = parseAuthData(att.get('authData'));
  if (!ad.rpIdHash.equals(sha256(site.rpId))) throw new Error('This passkey is not for this website.');
  if (!(ad.flags & 0x01) || !(ad.flags & 0x40)) throw new Error('Bad passkey data.'); // user present + attested credential data
  if (!(ad.flags & 0x04)) throw new Error('Your phone did not confirm it is you. Turn on a fingerprint or screen lock and try again.');
  const rest = ad.rest; if (rest.length < 18) throw new Error('Bad passkey data.');
  const idLen = rest.readUInt16BE(16); const id = rest.subarray(18, 18 + idLen);
  const pos = { i: 18 + idLen }; const cose = cborRead(rest, pos);
  const k = coseToSpki(cose);
  return { meta, credentialId: b64u(id), alg: k.alg, publicKey: k.spki, counter: ad.counter };
}

/* ---------- sign in ---------- */
function verifyAssertion(cred, rec, site) {
  const r = cred && cred.response; if (!r) throw new Error('Bad passkey data.');
  const clientDataJSON = fromB64u(r.clientDataJSON);
  const meta = checkClientData(clientDataJSON, 'webauthn.get', site);
  const authData = fromB64u(r.authenticatorData);
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(sha256(site.rpId))) throw new Error('This passkey is not for this website.');
  if (!(ad.flags & 0x01) || !(ad.flags & 0x04)) throw new Error('Your phone did not confirm it is you.');
  const key = crypto.createPublicKey({ key: Buffer.from(rec.publicKey, 'base64'), format: 'der', type: 'spki' });
  const data = Buffer.concat([authData, sha256(clientDataJSON)]);
  if (!crypto.verify('sha256', data, key, fromB64u(r.signature))) throw new Error('That passkey could not be verified.');
  if (ad.counter && rec.counter && ad.counter <= rec.counter) throw new Error('That passkey could not be verified.'); // a cloned key would repeat an old counter
  return { meta, counter: ad.counter };
}

module.exports = { newChallenge, takeChallenge, siteOf, verifyRegistration, verifyAssertion, b64u, fromB64u, cbor };
