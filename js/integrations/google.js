// Google カレンダー連携（画面から使う入口）：接続・カレンダーの選択・自動同期

import { app } from '../app.js';
import { uid } from '../core/model.js';
import { api, isConnected as serverConnected } from '../features/server.js';
import { localTimeZone } from '../features/ics.js';
import { nearestColor } from './google-map.js';
import { syncCalendar, listGoogleCalendars, isGoogleCal } from './google-sync.js';

export const gapi = (path, { method = 'GET', body } = {}) =>
  api(`/api/google/api?path=${encodeURIComponent(path)}`, { method, body, timeout: 30000 });

export const googleCalendars = () => Object.values(app.store.state.calendars).filter(isGoogleCal);
export const googleStatus = () => api('/api/google/status');
export const listCalendars = () => listGoogleCalendars(gapi);

/** Google のログイン画面を開く（戻ってきたら status で確認する） */
export async function startGoogleAuth() {
  // iOS では、ボタンを押した直後に開かないとポップアップが止められるので、先に空の画面を開いておく
  const win = window.open('', '_blank');
  try {
    const { url } = await api('/api/google/auth', { method: 'POST' });
    if (win) win.location.href = url; else location.href = url;
  } catch (e) { win?.close(); throw e; }
}

export async function disconnectGoogle(removeEvents) {
  await api('/api/google', { method: 'DELETE' });
  const cals = googleCalendars();
  app.store.transact('', tx => {
    for (const c of cals) {
      if (removeEvents) {
        for (const e of Object.values(app.store.state.events)) if (e.calendarId === c.id) tx.remove('events', e.id);
        tx.remove('calendars', c.id);
      } else {
        // アプリのカレンダーとして残す
        tx.put('calendars', { ...c, source: { provider: 'local' } });
        for (const e of Object.values(app.store.state.events)) if (e.calendarId === c.id) tx.put('events', { ...e, source: { provider: 'local' } });
      }
    }
  }, { undoable: false });
}

/** Google のカレンダーを同期の対象にする（アプリに同じ名前のカレンダーを作る） */
export function linkCalendar(g) {
  const exists = googleCalendars().find(c => c.source.externalId === g.id);
  if (exists) return exists;
  const order = Math.max(0, ...Object.values(app.store.state.calendars).map(c => c.order ?? 0)) + 1;
  const cal = { id: uid('c'), name: g.name, color: nearestColor(g.color), visible: true, order,
    source: { provider: 'google', externalId: g.id, accessRole: g.accessRole, syncToken: null, lastSync: null } };
  app.store.transact('', tx => tx.put('calendars', cal), { undoable: false });
  return cal;
}

/** 同期をやめる。keep=true ならアプリのカレンダーとして残す */
export function unlinkCalendar(calId, keep) {
  const c = app.store.state.calendars[calId];
  if (!c) return;
  app.store.transact('', tx => {
    for (const e of Object.values(app.store.state.events)) {
      if (e.calendarId !== calId) continue;
      if (keep) tx.put('events', { ...e, source: { provider: 'local' } });
      else tx.remove('events', e.id);
    }
    if (keep) tx.put('calendars', { ...c, source: { provider: 'local' } });
    else tx.remove('calendars', calId);
  }, { undoable: false });
  if (app.store.state.settings.defaultCalendarId === calId && !keep) app.store.setSettings({ defaultCalendarId: 'default' });
}

// ── 同期 ──

let running = null;
let lastRun = 0;
const listeners = new Set();
export const onSyncState = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const isSyncing = () => !!running;

/** 選んだ Google カレンダーをすべて同期する */
export function syncAll({ quiet = true } = {}) {
  if (running) return running;
  if (!serverConnected() || !googleCalendars().length) return Promise.resolve(null);
  running = (async () => {
    listeners.forEach(fn => fn(true));
    const total = { pulled: 0, pushed: 0, errors: [] };
    try {
      for (const c of googleCalendars()) {
        const r = await syncCalendar({ store: app.store, gapi, calId: c.id, tz: localTimeZone() });
        total.pulled += r.pulled; total.pushed += r.pushed; total.errors.push(...r.errors);
      }
      return total;
    } catch (e) {
      total.errors.push(e.message);
      if (!quiet || e.message === 'google_reauth' || e.message === 'google_not_connected') throw e;
      return total;
    } finally {
      lastRun = Date.now();
      running = null;
      listeners.forEach(fn => fn(false));
    }
  })();
  return running;
}

export const lastSyncAt = () => Math.max(0, ...googleCalendars().map(c => c.source.lastSync || 0));

/** 起動時に1回：開いたとき・予定を変えたときに同期する */
export function startGoogleSync({ onError } = {}) {
  let timer = null;
  const run = () => syncAll().catch(e => onError?.(e));
  const later = ms => { clearTimeout(timer); timer = setTimeout(run, ms); };
  app.store.subscribe((changed, info) => {
    // 同期そのものの書き込み（ラベルなし・取り消し不可）では動かない
    if (changed.has('events') && (info.label || info.undo || info.redo) && googleCalendars().length) later(4000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > 60e3) later(800);
  });
  later(2000);
}
