// マイプランナー サーバー（Cloudflare Workers）
//  - アプリから「通知の予定表」を受け取り、1分ごとの cron で時間が来たものを Web Push で送る
//  - 段階3-2 で Google カレンダー同期（OAuth・トークン保持）をここに足す
//
// 環境変数（wrangler secret put で登録。リポジトリには入れない）
//   PAIR_CODE         アプリをつなぐときの接続コード
//   VAPID_PRIVATE_JWK 通知用の鍵（JSON）
// wrangler.toml の vars
//   ALLOWED_ORIGINS   アプリの URL（カンマ区切り）
//   VAPID_SUBJECT     通知サービスに伝える連絡先（https URL か mailto:）

import { sendPush, publicKeyFromJwk, b64u } from './webpush.js';

export const SERVER_VERSION = '1';
const GRACE_MS = 15 * 60 * 1000;   // 遅れてもこの時間内なら送る
const KEEP_MS = 3 * 86400 * 1000;  // 送ったあと・過ぎたあとに残しておく期間
const MAX_ITEMS = 1000;

const enc = new TextEncoder();
async function sha256(s) { return b64u.encode(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
const randomToken = (n = 32) => b64u.encode(crypto.getRandomValues(new Uint8Array(n)));

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const vapidJwk = env => JSON.parse(env.VAPID_PRIVATE_JWK);
const vapidPublic = env => b64u.encode(publicKeyFromJwk(vapidJwk(env)));

async function authDevice(env, req) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  return env.DB.prepare('SELECT * FROM devices WHERE token_hash = ?').bind(await sha256(m[1])).first();
}

/** 予定表の1件を検査して整える */
function cleanItem(it) {
  if (!it || typeof it.id !== 'string' || !Number.isFinite(it.at) || typeof it.title !== 'string') return null;
  return {
    nid: it.id.slice(0, 200),
    at: Math.round(it.at),
    payload: JSON.stringify({ title: it.title.slice(0, 120), body: String(it.body || '').slice(0, 1000), tag: String(it.tag || it.id).slice(0, 100), url: String(it.url || './').slice(0, 300) }),
  };
}

async function replaceSchedule(env, deviceId, items, now) {
  const rows = items.map(cleanItem).filter(r => r && r.at > now - GRACE_MS).slice(0, MAX_ITEMS);
  const stmts = [env.DB.prepare('DELETE FROM notifications WHERE device_id = ? AND sent_at IS NULL').bind(deviceId)];
  // 送信済みのもの（同じ nid）はそのまま残す＝二重に送らない
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO notifications (device_id, nid, at, payload) VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}`)
      .bind(...chunk.flatMap(r => [deviceId, r.nid, r.at, r.payload])));
  }
  stmts.push(env.DB.prepare('UPDATE devices SET schedule_at = ? WHERE id = ?').bind(now, deviceId));
  await env.DB.batch(stmts);
  return rows.length;
}

async function pushTo(env, device, payload, opts = {}) {
  if (!device.subscription) return { ok: false, status: 0, gone: false };
  const r = await sendPush(JSON.parse(device.subscription), payload,
    { privateJwk: vapidJwk(env), subject: env.VAPID_SUBJECT, fetchFn: env.fetchFn || fetch, ...opts });
  if (r.gone) await env.DB.prepare('UPDATE devices SET subscription = NULL WHERE id = ?').bind(device.id).run();
  return r;
}

export async function handleRequest(req, env, now = Date.now()) {
  const h = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const { pathname } = new URL(req.url);
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  if (pathname === '/api/health') return json({ ok: true, app: 'myplanner', version: SERVER_VERSION }, 200, h);

  if (pathname === '/api/pair' && req.method === 'POST') {
    const { code, name } = await body();
    if (!env.PAIR_CODE || !timingSafeEqual(String(code || '').trim(), env.PAIR_CODE)) return json({ error: 'bad_code' }, 403, h);
    const token = randomToken();
    const id = randomToken(9);
    await env.DB.prepare('INSERT INTO devices (id, token_hash, name, created_at) VALUES (?, ?, ?, ?)').bind(id, await sha256(token), String(name || '').slice(0, 60), now).run();
    return json({ token, deviceId: id, vapidPublicKey: vapidPublic(env) }, 200, h);
  }

  if (!pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404, h);
  const device = await authDevice(env, req);
  if (!device) return json({ error: 'unauthorized' }, 401, h);

  if (pathname === '/api/me' && req.method === 'GET') {
    const pending = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(at) AS next FROM notifications WHERE device_id = ? AND sent_at IS NULL').bind(device.id).first();
    return json({ deviceId: device.id, subscribed: !!device.subscription, pending: pending?.n || 0, next: pending?.next ?? null, scheduleAt: device.schedule_at, vapidPublicKey: vapidPublic(env) }, 200, h);
  }
  if (pathname === '/api/subscription' && req.method === 'PUT') {
    const { subscription } = await body();
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth || !/^https:\/\//.test(subscription.endpoint)) return json({ error: 'bad_subscription' }, 400, h);
    await env.DB.prepare('UPDATE devices SET subscription = ? WHERE id = ?').bind(JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }), device.id).run();
    return json({ ok: true }, 200, h);
  }
  if (pathname === '/api/subscription' && req.method === 'DELETE') {
    await env.DB.prepare('UPDATE devices SET subscription = NULL WHERE id = ?').bind(device.id).run();
    return json({ ok: true }, 200, h);
  }
  if (pathname === '/api/schedule' && req.method === 'PUT') {
    const { items } = await body();
    if (!Array.isArray(items)) return json({ error: 'bad_items' }, 400, h);
    return json({ ok: true, count: await replaceSchedule(env, device.id, items, now) }, 200, h);
  }
  if (pathname === '/api/test' && req.method === 'POST') {
    const r = await pushTo(env, device, { title: '🔔 テスト通知', body: 'マイプランナーから通知が届きました。', tag: 'test', url: './#/settings' });
    return json(r, r.ok ? 200 : 502, h);
  }
  if (pathname === '/api/device' && req.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM notifications WHERE device_id = ?').bind(device.id),
      env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(device.id),
    ]);
    return json({ ok: true }, 200, h);
  }
  return json({ error: 'not_found' }, 404, h);
}

/** cron（1分ごと）：時間が来た通知を送る */
export async function runDue(env, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT n.device_id, n.nid, n.at, n.payload, d.id, d.subscription FROM notifications n JOIN devices d ON d.id = n.device_id
     WHERE n.sent_at IS NULL AND n.at <= ? AND n.at > ? AND d.subscription IS NOT NULL ORDER BY n.at LIMIT 50`).bind(now, now - GRACE_MS).all();
  let sent = 0;
  for (const r of results || []) {
    // 先に送信済みにしてから送る（cron が重なっても二重に送らない）
    const claim = await env.DB.prepare('UPDATE notifications SET sent_at = ? WHERE device_id = ? AND nid = ? AND sent_at IS NULL').bind(now, r.device_id, r.nid).run();
    if (!claim.meta?.changes) continue;
    try {
      const res = await pushTo(env, { id: r.device_id, subscription: r.subscription }, JSON.parse(r.payload));
      if (res.ok) sent++;
    } catch (e) { console.error('push failed', r.nid, e); }
  }
  await env.DB.prepare('DELETE FROM notifications WHERE at < ?').bind(now - KEEP_MS).run();
  return sent;
}

export default {
  fetch: (req, env) => handleRequest(req, env).catch(e => { console.error(e); return json({ error: 'server_error' }, 500, cors(env, req)); }),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runDue(env, event.scheduledTime || Date.now())); },
};
