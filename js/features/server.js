// マイプランナー サーバー（Cloudflare Workers）との接続と、通知の予定表の送信
// 接続情報（URL・トークン）はバックアップに入れないよう、設定とは別のキーに保存する。

import { app } from '../app.js';
import { createStorage, PREFIX } from '../core/storage.js';
import { buildSchedule } from './notify.js';

const KEY = PREFIX + 'server';
const REFRESH_MS = 12 * 3600e3; // 変更がなくてもこの間隔で送り直す（30日先まで延ばすため）
const storage = createStorage();

export const serverConf = () => storage.get(KEY, null);
const saveConf = patch => storage.set(KEY, { ...serverConf(), ...patch });
export const isConnected = () => !!serverConf()?.token;

export function normalizeUrl(s) {
  let u = String(s || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//.test(u)) u = 'https://' + u;
  return u;
}

export async function api(path, { method = 'GET', body, conf = serverConf(), timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(conf.url + path, {
      method, signal: ctrl.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(conf.token ? { Authorization: 'Bearer ' + conf.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'http_' + res.status), { status: res.status, data });
    return data;
  } finally { clearTimeout(timer); }
}

/** 接続コードでサーバーにつなぐ */
export async function connect(url, code) {
  const conf = { url: normalizeUrl(url) };
  await api('/api/health', { conf });
  const r = await api('/api/pair', { method: 'POST', body: { code: code.trim(), name: /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'ブラウザ' }, conf });
  storage.set(KEY, { url: conf.url, token: r.token, deviceId: r.deviceId, vapidPublicKey: r.vapidPublicKey, connectedAt: Date.now() });
  await syncSchedule({ force: true }).catch(() => {});
}

export async function disconnect() {
  try { await api('/api/device', { method: 'DELETE' }); } catch { /* サーバー側で消えていてもよい */ }
  try { await (await pushSubscription())?.unsubscribe(); } catch { /* 購読がなくてもよい */ }
  storage.remove(KEY);
}

export const status = () => api('/api/me');
export const sendTest = () => api('/api/test', { method: 'POST' });

// ── Web Push の購読 ──

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

async function pushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

const keyBytes = b64 => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)), c => c.charCodeAt(0));

/**
 * 通知を許可して購読する。iOS ではボタンを押した処理の中で最初に呼ぶこと（許可ダイアログのため）。
 * @returns {Promise<'ok'|'denied'|'unsupported'|'not-standalone'>}
 */
export async function enablePush() {
  if (!pushSupported()) return /iPhone|iPad/.test(navigator.userAgent) && !isStandalone() ? 'not-standalone' : 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const conf = serverConf();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(conf.vapidPublicKey) });
  await api('/api/subscription', { method: 'PUT', body: { subscription: sub.toJSON() } });
  await syncSchedule({ force: true });
  return 'ok';
}

// ── 予定表の送信 ──

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ':' + s.length;
}

export function currentSchedule(now = Date.now()) {
  const { store } = app;
  return buildSchedule({ events: store.eventList(), todos: store.todoList(), settings: store.state.settings, isVisible: store.isCalendarVisible }, now);
}

let syncing = null;
export async function syncSchedule({ force = false } = {}) {
  const conf = serverConf();
  if (!conf?.token) return null;
  if (syncing) return syncing;
  syncing = (async () => {
    const now = Date.now();
    const items = currentSchedule(now);
    const h = hash(JSON.stringify(items.map(i => [i.id, i.title, i.body])));
    if (!force && h === conf.lastHash && now - (conf.syncedAt || 0) < REFRESH_MS) return null;
    const r = await api('/api/schedule', { method: 'PUT', body: { items } });
    saveConf({ lastHash: h, syncedAt: now, lastCount: r.count });
    return r;
  })().finally(() => { syncing = null; });
  return syncing;
}

/** 起動時に1回呼ぶ：データが変わったら少し待って予定表を送る */
export function startScheduleSync() {
  let timer = null;
  const later = (ms = 2500) => { clearTimeout(timer); timer = setTimeout(() => syncSchedule().catch(() => {}), ms); };
  app.store.subscribe(changed => {
    if (['events', 'todos', 'settings', 'calendars'].some(k => changed.has(k))) later();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later(500); });
  later(3000);
}
