// データの形（スキーマ v2）
// 段階2・3で使う項目（location, notes, reminders, source など）も先に持たせておく。

export const COLOR_COUNT = 10;
export const COLOR_NAMES = ['ラベンダー', 'ピンク', 'ターコイズ', 'グリーン', 'オレンジ', 'パープル', 'ブルー', 'レッド', 'マスタード', 'グレー'];

export function uid(prefix = '') {
  const rnd = (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + rnd;
}

/**
 * Event
 *  allDay=true : start/end は 'YYYY-MM-DD'、end は排他（1日だけの予定なら翌日）
 *  allDay=false: start/end は 'YYYY-MM-DDTHH:mm'
 *  rrule: null | { freq:'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY', interval?, byDay?:['MO',..], until?:'YYYY-MM-DD', count? }
 *  exdates: 除外する回の開始日 'YYYY-MM-DD'
 */
export function newEvent(p = {}, now = Date.now()) {
  return {
    id: p.id ?? uid('e'),
    calendarId: p.calendarId ?? 'default',
    title: p.title ?? '',
    allDay: !!p.allDay,
    start: p.start,
    end: p.end,
    color: p.color ?? null,
    rrule: p.rrule ?? null,
    exdates: p.exdates ?? [],
    recurringEventId: p.recurringEventId ?? null,
    location: p.location ?? '',
    notes: p.notes ?? '',
    reminders: p.reminders ?? [],
    source: p.source ?? { provider: 'local' },
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
    deletedAt: p.deletedAt ?? null,
  };
}

/** Todo（Scriptable ウィジェットと互換のため text/due/start/end/done の名前は維持） */
export function newTodo(p = {}, now = Date.now()) {
  return {
    id: p.id ?? uid('t'),
    text: p.text ?? '',
    done: !!p.done,
    due: p.due ?? null,
    start: p.start || null,
    end: p.end || null,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
    completedAt: p.completedAt ?? null,
    ...(p.archivedAuto ? { archivedAuto: true } : {}),
  };
}

/** メモ（タイトルは本文の1行目から作る） */
export function newNote(p = {}, now = Date.now()) {
  return {
    id: p.id ?? uid('n'),
    body: p.body ?? '',
    pinned: !!p.pinned,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
    deletedAt: p.deletedAt ?? null,
  };
}

export const DEFAULT_CALENDARS = {
  default: { id: 'default', name: 'マイカレンダー', color: 0, visible: true, source: { provider: 'local' } },
};

export const DEFAULT_SETTINGS = {
  theme: 'auto',        // 'auto' | 'light' | 'dark'
  weekStart: 0,         // 0=日曜, 1=月曜
  defaultView: 'month', // 'month' | 'week' | 'day' | 'agenda'
  dayStartHour: 7,      // 週・日表示を開いたときの初期スクロール位置
  defaultCalendarId: 'default',
  backupReminderDays: 7, // 0 でお知らせしない
};
