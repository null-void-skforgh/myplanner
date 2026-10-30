// Google カレンダー連携：OAuth（リフレッシュトークンはサーバーだけが持つ）と Calendar API の中継。
// 予定の変換や同期の判断はアプリ側（js/integrations/）で行い、ここは中身を解釈せずにそのまま渡す。
// （Workers 無料枠の CPU 時間 10ms に収めるため、大きな JSON はパースしない）

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
export const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const STATE_TTL = 15 * 60 * 1000;

const redirectUri = (env, req) => new URL('/oauth/callback', req.url).href;

export async function authUrl(env, req, deviceId, now, randomToken) {
  const state = randomToken(18);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(now - STATE_TTL),
    env.DB.prepare('INSERT INTO oauth_states (state, device_id, created_at) VALUES (?, ?, ?)').bind(state, deviceId, now),
  ]);
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, req), response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${AUTH_URL}?${q}`;
}

const page = (title, msg, ok) => new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:-apple-system,sans-serif;padding:40px 24px;text-align:center;color:#222;background:#f6f5f1">
<div style="font-size:56px">${ok ? '✅' : '⚠️'}</div><h2>${title}</h2><p style="line-height:1.7">${msg}</p></body></html>`,
{ status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function tokenRequest(env, params, fetchFn) {
  const res = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'token_error'), { status: res.status, data });
  return data;
}

/** Google から戻ってきたとき（/oauth/callback） */
export async function callback(env, req, now) {
  const fetchFn = env.fetchFn || fetch;
  const u = new URL(req.url);
  const state = u.searchParams.get('state'), code = u.searchParams.get('code');
  if (u.searchParams.get('error')) return page('接続をやめました', '左上の「完了」を押して、アプリに戻ってください。', false);
  const row = state && await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ? AND created_at > ?').bind(state, now - STATE_TTL).first();
  if (!row || !code) return page('もう一度やり直してください', '接続の手続きが古くなっています。アプリの「Googleと接続」からやり直してください。', false);
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  let tok;
  try { tok = await tokenRequest(env, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(env, req) }, fetchFn); }
  catch (e) { return page('接続できませんでした', `Google からの応答：${e.message}`, false); }
  if (!tok.refresh_token) return page('接続できませんでした', 'Google からリフレッシュトークンが返りませんでした。もう一度お試しください。', false);
  // 主カレンダーの ID ＝ メールアドレス
  let email = null;
  try {
    const r = await fetchFn(`${API}/users/me/calendarList/primary?fields=id`, { headers: { Authorization: 'Bearer ' + tok.access_token } });
    if (r.ok) email = (await r.json()).id;
  } catch { /* なくてもよい */ }
  await env.DB.prepare(`INSERT INTO google_account (id, email, refresh_token, access_token, access_expires, created_at) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, access_token = excluded.access_token, access_expires = excluded.access_expires`)
    .bind(email, tok.refresh_token, tok.access_token, now + (tok.expires_in - 60) * 1000, now).run();
  return page('Google と接続しました', `${email ? email + ' と' : ''}つながりました。<br>左上の「完了」を押して、アプリに戻ってください。`, true);
}

export const account = env => env.DB.prepare('SELECT email, access_token, access_expires, refresh_token FROM google_account WHERE id = 1').first();

async function accessToken(env, now) {
  const acc = await account(env);
  if (!acc) throw Object.assign(new Error('google_not_connected'), { status: 409 });
  if (acc.access_token && acc.access_expires > now) return acc.access_token;
  let tok;
  try { tok = await tokenRequest(env, { refresh_token: acc.refresh_token, grant_type: 'refresh_token' }, env.fetchFn || fetch); }
  catch (e) {
    // 取り消された・期限切れ（invalid_grant）なら接続を消して、アプリに再接続を促す
    if (e.message === 'invalid_grant') await env.DB.prepare('DELETE FROM google_account WHERE id = 1').run();
    throw Object.assign(new Error(e.message === 'invalid_grant' ? 'google_reauth' : 'google_token_error'), { status: 409 });
  }
  await env.DB.prepare('UPDATE google_account SET access_token = ?, access_expires = ? WHERE id = 1').bind(tok.access_token, now + (tok.expires_in - 60) * 1000).run();
  return tok.access_token;
}

/** 中継してよい Calendar API のパス */
const ALLOWED = [
  /^\/users\/me\/calendarList(\?.*)?$/,
  /^\/calendars\/[^/?]+\/events(\?.*)?$/,
  /^\/calendars\/[^/?]+\/events\/[^/?]+(\?.*)?$/,
];

/** Calendar API への中継。レスポンスはそのまま返す */
export async function proxy(env, path, method, body, now) {
  if (!ALLOWED.some(re => re.test(path)) || !['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return new Response(JSON.stringify({ error: 'bad_path' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const token = await accessToken(env, now);
  const res = await (env.fetchFn || fetch)(API + path, {
    method, body: body || undefined,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' } });
}

export async function disconnect(env) {
  const acc = await account(env);
  if (acc) {
    try { await (env.fetchFn || fetch)('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: acc.refresh_token }) }); } catch { /* 取り消しに失敗しても、こちらの記録は消す */ }
  }
  await env.DB.prepare('DELETE FROM google_account WHERE id = 1').run();
}
