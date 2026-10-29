import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest, runDue } from '../server/src/index.js';
import { generateVapidKeys, encryptPayload, b64u } from '../server/src/webpush.js';

/** D1 と同じ形の、テスト用 SQLite ラッパー */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: sql => stmt(sql), batch: async list => { db.exec('BEGIN'); try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

const ORIGIN = 'https://null-void-skforgh.github.io';
async function setup() {
  const { privateJwk } = await generateVapidKeys();
  const sent = [];
  const env = { DB: fakeD1(), PAIR_CODE: 'TESTCODE42', VAPID_PRIVATE_JWK: JSON.stringify(privateJwk), VAPID_SUBJECT: 'https://example.com/', ALLOWED_ORIGINS: ORIGIN,
    fetchFn: async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 201 }); } };
  const call = async (method, path, body, token, now) => {
    const res = await handleRequest(new Request('https://srv.example' + path, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, now);
    return { status: res.status, data: res.status === 204 ? null : await res.json(), headers: res.headers };
  };
  return { env, call, sent };
}

/** ブラウザ側（受信者）の鍵と、受け取った本文の復号（RFC 8291） */
async function makeReceiver() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const hm = async (k, d) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));
  const te = new TextEncoder();
  return {
    subscription: { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: b64u.encode(pub), auth: b64u.encode(auth) } },
    async decrypt(body) {
      const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
      const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, kp.privateKey, 256));
      const ikm = await hm(await hm(auth, shared), new Uint8Array([...te.encode('WebPush: info\0'), ...pub, ...asPub, 1]));
      const prk = await hm(salt, ikm);
      const cek = (await hm(prk, te.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
      const nonce = (await hm(prk, te.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
      assert.equal(plain.at(-1), 2);
      return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
    },
  };
}

test('暗号化した本文を受信側で復号できる', async () => {
  const r = await makeReceiver();
  const body = await encryptPayload(r.subscription, JSON.stringify({ title: 'こんにちは' }));
  assert.deepEqual(await r.decrypt(body), { title: 'こんにちは' });
});

test('接続コードが違うと接続できない・トークンなしは 401', async () => {
  const { call } = await setup();
  assert.equal((await call('POST', '/api/pair', { code: 'wrong' })).status, 403);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', null, 'nope')).status, 401);
  const h = await call('GET', '/api/health');
  assert.equal(h.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('接続 → 購読 → 予定表 → 時間が来たら1回だけ送る', async () => {
  const { env, call, sent } = await setup();
  const { data: { token, vapidPublicKey } } = await call('POST', '/api/pair', { code: 'TESTCODE42', name: 'iPhone' });
  assert.ok(token.length > 30 && vapidPublicKey.length > 80);
  const r = await makeReceiver();
  assert.equal((await call('PUT', '/api/subscription', { subscription: r.subscription }, token)).status, 200);

  const T0 = Date.parse('2026-11-03T09:00:00+09:00');
  const items = [
    { id: 'morning:2026-11-03', at: T0, title: '☀️ 今日の予定', body: '13:00 連続体の力学' },
    { id: 'ev:a:2026-11-03:10', at: T0 + 3600e3, title: 'ゼミ', body: '10分後' },
    { id: 'old', at: T0 - 86400e3, title: '古い' },
  ];
  assert.equal((await call('PUT', '/api/schedule', { items }, token, T0 - 60e3)).data.count, 2);
  assert.equal((await call('GET', '/api/me', null, token, T0 - 60e3)).data.pending, 2);

  assert.equal(await runDue(env, T0 - 1000), 0);
  assert.equal(await runDue(env, T0 + 30e3), 1);
  assert.equal(await runDue(env, T0 + 90e3), 0, '二重に送らない');
  const msg = await r.decrypt(new Uint8Array(sent[0].init.body));
  assert.equal(msg.title, '☀️ 今日の予定');
  assert.equal(sent[0].url, 'https://web.push.apple.com/abc');
  assert.match(sent[0].init.headers.Authorization, /^vapid t=.+\..+\..+, k=/);

  // 予定表を送り直しても、送信済みのものは送らない
  await call('PUT', '/api/schedule', { items }, token, T0 + 100e3);
  assert.equal(await runDue(env, T0 + 120e3), 0);
  // 15分以上過ぎたものは送らない
  assert.equal(await runDue(env, T0 + 3600e3 + 16 * 60e3), 0);
});

test('購読が無効（410）になったら購読を消す', async () => {
  const { env, call } = await setup();
  const { data: { token } } = await call('POST', '/api/pair', { code: 'TESTCODE42' });
  const r = await makeReceiver();
  await call('PUT', '/api/subscription', { subscription: r.subscription }, token);
  env.fetchFn = async () => new Response(null, { status: 410 });
  assert.equal((await call('POST', '/api/test', null, token)).status, 502);
  assert.equal((await call('GET', '/api/me', null, token)).data.subscribed, false);
  assert.equal((await call('DELETE', '/api/device', null, token)).status, 200);
  assert.equal((await call('GET', '/api/me', null, token)).status, 401);
});
