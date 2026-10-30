// Google カレンダーとの双方向同期
//
// しくみ
//  - Google のカレンダー1つ ＝ アプリのカレンダー1つ（Calendar.source = { provider:'google', externalId: Google のカレンダーID, syncToken, ... }）
//  - 予定は Event.source = { provider:'google', externalId: Google の予定ID, gcal: Google のカレンダーID, syncedAt, ... }
//  - 「未送信の変更」＝ updatedAt > source.syncedAt（同期で書き込むときは updatedAt と syncedAt をそろえる）
//  - 1回の同期：Google の変更を受け取る（syncToken で差分だけ）→ アプリの変更を送る
//  - 両方で同じ予定を変えていたら、あとから変えた方を残す
//  - Google で変更された繰り返しの回（例外）は、アプリでは「元の予定の除外日 ＋ 1回だけの予定」として持つ
//
// gapi(path, {method, body}) は Calendar API（https://www.googleapis.com/calendar/v3 以下）を呼ぶ関数。
// 失敗したら { status } 付きの Error を投げること。

import { newEvent } from '../core/model.js';
import { fromGoogle, toGoogle, isoToLocal } from './google-map.js';

const WRITABLE = ['owner', 'writer'];
const enc = encodeURIComponent;

export const isGoogleCal = cal => cal?.source?.provider === 'google' && !!cal.source.externalId;
export const calReadOnly = cal => isGoogleCal(cal) && !WRITABLE.includes(cal.source.accessRole || 'owner');
export const eventReadOnly = (ev, calendars) => !!ev?.source?.readOnly || calReadOnly(calendars?.[ev?.calendarId]);

/** この予定に、Google へまだ送っていない変更があるか */
export function isDirty(ev, gcalId) {
  const s = ev.source || {};
  if (s.provider !== 'google' || !s.externalId || s.gcal !== gcalId) return true; // まだ Google にない
  return (ev.updatedAt || 0) > (s.syncedAt || 0);
}

/**
 * 1つのカレンダーを同期する
 * @returns {{pulled:number, pushed:number, errors:string[]}}
 */
export async function syncCalendar({ store, gapi, calId, tz }) {
  const cal = store.state.calendars[calId];
  if (!isGoogleCal(cal)) return { pulled: 0, pushed: 0, errors: [] };
  const gid = cal.source.externalId;
  const readOnlyCal = calReadOnly(cal);
  const errors = [];

  // ── 1. Google の変更を受け取る ──
  let syncToken = cal.source.syncToken || null;
  let items = [], nextSyncToken = null, full = !syncToken;
  for (let attempt = 0; attempt < 2; attempt++) {
    items = []; nextSyncToken = null;
    let pageToken = null;
    try {
      do {
        const q = new URLSearchParams({ maxResults: '1000' });
        if (syncToken) q.set('syncToken', syncToken);
        if (pageToken) q.set('pageToken', pageToken);
        const r = await gapi(`/calendars/${enc(gid)}/events?${q}`);
        items.push(...(r.items || []));
        pageToken = r.nextPageToken || null;
        nextSyncToken = r.nextSyncToken || nextSyncToken;
      } while (pageToken);
      break;
    } catch (e) {
      // 410：差分の印が古くなった → 全部取り直す
      if (e.status === 410 && syncToken) { syncToken = null; full = true; continue; }
      throw e;
    }
  }
  const pulled = applyRemote(store, cal, items, { full });

  // ── 2. アプリの変更を送る ──
  let pushed = 0;
  if (!readOnlyCal) {
    for (const ev of pendingChanges(store, cal)) {
      try { if (await pushOne(store, gapi, cal, ev, tz)) pushed++; }
      catch (e) { errors.push(`${ev.title || '(タイトルなし)'}: ${e.message}`); }
    }
  }

  store.transact('', tx => {
    const c = tx.get('calendars', calId);
    if (c) tx.put('calendars', { ...c, source: { ...c.source, syncToken: nextSyncToken || c.source.syncToken, lastSync: Date.now(), lastError: errors[0] || null } });
  }, { undoable: false });
  return { pulled, pushed, errors };
}

/** Google から受け取った予定をアプリに反映する（1回の書き込み） */
export function applyRemote(store, cal, items, { full = false, now = Date.now() } = {}) {
  const gid = cal.source.externalId;
  const readOnlyCal = calReadOnly(cal);
  const all = Object.values(store.state.events);
  const byExt = new Map(all.filter(e => e.source?.provider === 'google' && e.source.gcal === gid).map(e => [e.source.externalId, e]));
  const seen = new Set();
  let n = 0;

  // 元の予定 → 例外の回 の順に
  const sorted = [...items].sort((a, b) => (a.recurringEventId ? 1 : 0) - (b.recurringEventId ? 1 : 0));
  store.transact('', tx => {
    const cur = id => tx.get('events', id);
    const clean = rec => ({ ...rec, updatedAt: now, source: { ...rec.source, syncedAt: now } });
    const put = rec => { tx.put('events', clean(rec), { keepUpdatedAt: true }); byExt.set(rec.source.externalId, cur(rec.id)); n++; };
    const addExdate = (masterExt, date) => {
      const m = byExt.get(masterExt);
      if (!m || !date) return;
      const latest = cur(m.id);
      const exdates = [...new Set([...(latest.exdates || []), date])].sort();
      const exceptionDates = [...new Set([...(latest.source.exceptionDates || []), date])].sort();
      // 元の予定に未送信の変更があれば、その状態は保つ
      const dirty = isDirty(latest, gid);
      tx.put('events', { ...latest, exdates, source: { ...latest.source, exceptionDates, ...(dirty ? {} : { syncedAt: now }) }, ...(dirty ? {} : { updatedAt: now }) }, { keepUpdatedAt: true });
      byExt.set(masterExt, cur(m.id));
    };

    for (const g of sorted) {
      seen.add(g.id);
      const local = byExt.get(g.id) && cur(byExt.get(g.id).id);
      if (g.status === 'cancelled') {
        const os = g.originalStartTime;
        if (g.recurringEventId && os) addExdate(g.recurringEventId, os.date || isoToLocal(os.dateTime).slice(0, 10));
        if (local && !local.deletedAt) {
          if (isDirty(local, gid) && !readOnlyCal) continue; // アプリで変更中 → アプリの方を残す（送るときに復活させる）
          put({ ...local, deletedAt: now, source: { ...local.source, remoteDeleted: true } });
        }
        continue;
      }
      if (local && isDirty(local, gid) && !readOnlyCal && (local.updatedAt || 0) > Date.parse(g.updated || 0)) continue; // アプリの方が新しい
      const { fields, readOnly, useDefault, originalDate } = fromGoogle(g);
      // アプリで「この回だけ変更」した予定は Google では単独の予定になるので、元のつながりは残す
      let recurringEventId = local?.recurringEventId ?? null;
      if (g.recurringEventId) {
        addExdate(g.recurringEventId, originalDate);
        recurringEventId = byExt.get(g.recurringEventId)?.id || null;
      }
      // 終日の「当日 9:00」など Google に送れない通知は、アプリ側の設定を残す
      const keepRem = (local?.reminders || []).filter(m => m < 0);
      const base = local || newEvent({ calendarId: cal.id });
      put({
        ...base, ...fields,
        reminders: [...new Set([...fields.reminders, ...(fields.allDay ? keepRem : [])])].sort((a, b) => a - b),
        calendarId: cal.id, recurringEventId, deletedAt: null,
        source: {
          provider: 'google', externalId: g.id, gcal: gid, etag: g.etag || null,
          readOnly: readOnly || readOnlyCal, useDefault,
          exceptionDates: local?.source?.exceptionDates || [],
        },
      });
    }

    // 全部取り直したときは、Google にもう無い予定（未送信の変更がないもの）を消す
    if (full) {
      for (const e of byExt.values()) {
        const latest = e && cur(e.id);
        if (!latest || latest.deletedAt || seen.has(latest.source.externalId) || isDirty(latest, gid)) continue;
        put({ ...latest, deletedAt: now, source: { ...latest.source, remoteDeleted: true } });
      }
    }
  }, { undoable: false });
  return n;
}

/** Google に送る必要がある予定 */
export function pendingChanges(store, cal) {
  const gid = cal.source.externalId;
  return Object.values(store.state.events).filter(e => {
    const s = e.source || {};
    const inGoogle = s.provider === 'google' && s.gcal === gid && s.externalId;
    if (e.calendarId === cal.id) {
      if (e.deletedAt) return inGoogle && !s.remoteDeleted;
      if (s.readOnly) return false;
      return isDirty(e, gid);
    }
    // ほかのカレンダーに移した予定 → このカレンダーからは消す
    return inGoogle && !s.remoteDeleted && !e.deletedAt;
  }).sort((a, b) => (a.recurringEventId ? 1 : 0) - (b.recurringEventId ? 1 : 0));
}

/** 1件送って、結果（Google の ID など）をアプリに書き戻す */
async function pushOne(store, gapi, cal, ev, tz) {
  const gid = cal.source.externalId;
  const s = ev.source || {};
  const sentAt = ev.updatedAt;
  const write = patch => store.transact('', tx => {
    const cur = tx.get('events', ev.id);
    if (!cur) return;
    // 送っている間にまた変更されていたら「未送信」のまま
    const syncedAt = (cur.updatedAt || 0) > sentAt ? sentAt : cur.updatedAt;
    tx.put('events', { ...cur, source: { ...patch(cur.source || {}), syncedAt } }, { keepUpdatedAt: true });
  }, { undoable: false });
  const del = async (calendarId, eventId) => {
    try { await gapi(`/calendars/${enc(calendarId)}/events/${enc(eventId)}`, { method: 'DELETE' }); }
    catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
  };

  // ほかのカレンダーへ移した／削除した
  if (ev.calendarId !== cal.id || ev.deletedAt) {
    await del(gid, s.externalId);
    if (ev.calendarId !== cal.id) {
      // 移動先が Google のカレンダーなら、そちらの同期で新しく作られる
      write(() => ({ provider: 'local' }));
    } else {
      write(src => ({ ...src, remoteDeleted: true }));
    }
    return true;
  }

  const body = toGoogle(ev, { tz });
  const insert = async () => {
    // 別の Google カレンダーから移してきた予定は、元の方を消してから作る
    if (s.provider === 'google' && s.externalId && s.gcal && s.gcal !== gid && !s.remoteDeleted) await del(s.gcal, s.externalId);
    const r = await gapi(`/calendars/${enc(gid)}/events`, { method: 'POST', body });
    write(src => ({ ...src, provider: 'google', externalId: r.id, gcal: gid, etag: r.etag || null, remoteDeleted: false,
      useDefault: !!r.reminders?.useDefault, exceptionDates: [] }));
  };
  if (s.provider === 'google' && s.externalId && s.gcal === gid) {
    try {
      const r = await gapi(`/calendars/${enc(gid)}/events/${enc(s.externalId)}`, { method: 'PATCH', body });
      write(src => ({ ...src, etag: r.etag || null, remoteDeleted: false }));
    } catch (e) {
      if (e.status === 404 || e.status === 410) await insert(); // Google 側で消えていた → 作り直す
      else throw e;
    }
  } else {
    await insert();
  }
  return true;
}

/** Google のカレンダー一覧（同期できるもの） */
export async function listGoogleCalendars(gapi) {
  const out = [];
  let pageToken = null;
  do {
    const q = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
    const r = await gapi(`/users/me/calendarList?${q}`);
    out.push(...(r.items || []));
    pageToken = r.nextPageToken || null;
  } while (pageToken);
  return out.filter(c => c.accessRole !== 'freeBusyReader')
    .map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor, accessRole: c.accessRole, primary: !!c.primary }))
    .sort((a, b) => (b.primary - a.primary) || (WRITABLE.includes(b.accessRole) - WRITABLE.includes(a.accessRole)) || a.name.localeCompare(b.name));
}
