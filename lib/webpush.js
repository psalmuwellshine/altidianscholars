'use strict';
/* Web Push, written with Node's own crypto so no extra package is needed.
   VAPID (RFC 8292) identifies this server; messages are encrypted with aes128gcm (RFC 8291). */
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

function makeVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }); const prv = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)])), privateKey: prv.d };
}
function privateKeyObject(v) {
  const raw = unb64u(v.publicKey);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: v.privateKey, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: 'jwk' });
}
function vapidHeader(vapid, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: privateKeyObject(vapid), dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + vapid.publicKey;
}

// Encrypts a payload for one browser subscription.
function encrypt(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh); const authSecret = unb64u(sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Bad subscription keys');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, data]);
}

// Sends one message. Resolves with the push service status code; rejects on network errors.
function send(sub, payload, { vapid, subject, ttl = 86400, allowHttp = false }) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(sub.endpoint); } catch (e) { return reject(new Error('Bad endpoint')); }
    if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return reject(new Error('Endpoint must be https'));
    const body = encrypt(sub, payload);
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'POST', timeout: 15000,
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, TTL: String(ttl), Urgency: 'normal', Authorization: vapidHeader(vapid, sub.endpoint, subject) },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

// Used by tests: what a browser does to read a message.
function decrypt(body, uaPrivateECDH, uaPublic, authSecret) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPublic = body.subarray(21, 21 + idlen); const data = body.subarray(21 + idlen);
  const secret = uaPrivateECDH.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

module.exports = { makeVapid, vapidHeader, encrypt, send, decrypt, b64u, unb64u };
