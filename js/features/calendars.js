// カレンダー（予定のグループ）の操作

import { app } from '../app.js';
import { uid } from '../core/model.js';

export function sortedCalendars() {
  return Object.values(app.store.state.calendars)
    .sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)));
}

export function defaultCalendarId() {
  const id = app.store.state.settings.defaultCalendarId;
  return id && app.store.state.calendars[id] ? id : 'default';
}

export function addCalendar({ name, color }) {
  const order = Math.max(0, ...Object.values(app.store.state.calendars).map(c => c.order ?? 0)) + 1;
  const cal = { id: uid('c'), name: name || '新しいカレンダー', color: color ?? 0, visible: true, order, source: { provider: 'local' } };
  app.store.transact(`カレンダー「${cal.name}」を作成しました`, tx => tx.put('calendars', cal));
  return cal;
}

export function updateCalendar(id, patch, label) {
  app.store.transact(label ?? 'カレンダーを変更しました', tx => {
    const c = tx.get('calendars', id);
    if (c) tx.put('calendars', { ...c, ...patch });
  }, { undoable: label !== null });
}

/** 表示／非表示の切り替え（取り消し対象外・トーストなし） */
export function setCalendarVisible(id, visible) {
  app.store.transact('', tx => {
    const c = tx.get('calendars', id);
    if (c) tx.put('calendars', { ...c, visible });
  }, { undoable: false });
}

/**
 * カレンダーを削除する。中の予定は moveTo があればそこへ移し、なければ削除する。
 * 既定のカレンダーは削除できない。
 */
export function deleteCalendar(id, moveTo = null) {
  if (id === 'default') return;
  const cal = app.store.state.calendars[id];
  if (!cal) return;
  const now = Date.now();
  app.store.transact(`カレンダー「${cal.name}」を削除しました`, tx => {
    for (const ev of Object.values(app.store.state.events)) {
      if (ev.calendarId !== id || ev.deletedAt) continue;
      tx.put('events', moveTo ? { ...ev, calendarId: moveTo } : { ...ev, deletedAt: now });
    }
    tx.remove('calendars', id);
  });
  if (app.store.state.settings.defaultCalendarId === id) app.store.setSettings({ defaultCalendarId: 'default' });
}

export const eventCountOf = id => Object.values(app.store.state.events).filter(e => e.calendarId === id && !e.deletedAt).length;
