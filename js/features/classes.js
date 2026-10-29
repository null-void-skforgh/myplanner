// 授業（時間割）の一括登録
// 1つの授業は「毎週◯曜・◯限・N回」の繰り返し予定1件として保存する（休講の回は「この予定だけ削除」で消せる）。

import { app } from '../app.js';
import { addDays, dayOfWeek, makeDT, timeToMin } from '../core/date.js';
import { WEEKDAYS } from '../core/recurrence.js';
import { addCalendar } from './calendars.js';

/** 既定の時限（東京大学：1コマ105分） */
export const DEFAULT_PERIODS = [
  ['08:30', '10:15'], ['10:25', '12:10'], ['13:00', '14:45'], ['14:55', '16:40'], ['16:50', '18:35'],
];
export const DEFAULT_WEEKS = 13;

export const periodsOf = settings => (Array.isArray(settings?.classPeriods) && settings.classPeriods.length === 5 ? settings.classPeriods : DEFAULT_PERIODS);

/** fromKey 以降で、days（0=日〜6=土）のどれかに当たる最初の日 */
export function firstClassDate(fromKey, days) {
  for (let i = 0; i < 7; i++) {
    const k = addDays(fromKey, i);
    if (days.includes(dayOfWeek(k))) return k;
  }
  return fromKey;
}

/**
 * 授業の予定を組み立てる（純粋関数）
 * @param {{subject:string, room?:string, days:number[], periods:number[], from:string, weeks:number, periodTimes?:string[][]}} p
 *   periods は 1〜5（複数なら最初の限の開始〜最後の限の終了）
 */
export function buildClassEvent({ subject, room = '', days, periods, from, weeks, periodTimes = DEFAULT_PERIODS }) {
  const ds = [...new Set(days)].sort((a, b) => a - b);
  const ps = [...new Set(periods)].sort((a, b) => a - b);
  const first = firstClassDate(from, ds);
  const s = timeToMin(periodTimes[ps[0] - 1][0]);
  const e = timeToMin(periodTimes[ps.at(-1) - 1][1]);
  return {
    title: subject.trim(),
    allDay: false,
    start: makeDT(first, s),
    end: makeDT(first, e),
    location: room.trim(),
    rrule: { freq: 'WEEKLY', interval: 1, byDay: ds.map(d => WEEKDAYS[d]), count: Math.max(1, weeks) * ds.length },
  };
}

/** 最後の授業の日 */
export function lastClassDate(ev) {
  const days = ev.rrule.byDay.map(d => WEEKDAYS.indexOf(d));
  let k = ev.start.slice(0, 10), n = 0, last = k;
  for (let i = 0; i < 7 * 60 && n < ev.rrule.count; i++, k = addDays(k, 1)) {
    if (days.includes(dayOfWeek(k))) { n++; last = k; }
  }
  return last;
}

export const periodLabel = ps => {
  const s = [...ps].sort((a, b) => a - b);
  return s.length > 1 ? `${s[0]}〜${s.at(-1)}限` : `${s[0]}限`;
};

/** 「授業」カレンダー（なければ作る） */
export function classCalendarId() {
  const { state } = app.store;
  const id = state.settings.classCalendarId;
  if (id && state.calendars[id]) return id;
  const found = Object.values(state.calendars).find(c => c.name === '授業');
  const cal = found || addCalendar({ name: '授業', color: 6 });
  app.store.setSettings({ classCalendarId: cal.id });
  return cal.id;
}

/** これまでに登録した授業（科目名と教室）。新しい順・重複なし */
export function recentSubjects(limit = 12) {
  const { state } = app.store;
  const calId = state.settings.classCalendarId;
  if (!calId) return [];
  const seen = new Map();
  Object.values(state.events)
    .filter(e => e.calendarId === calId && !e.deletedAt && e.title)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .forEach(e => { if (!seen.has(e.title)) seen.set(e.title, e.location || ''); });
  return [...seen].slice(0, limit).map(([subject, room]) => ({ subject, room }));
}
