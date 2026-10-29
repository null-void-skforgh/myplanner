// 予定の問い合わせ・変形（純粋関数）

import { addDays, diffDays, dtDate, dtTime, dtMinutes, makeDT, diffMinutes, addMinutes, isDateTime } from './date.js';
import { expandDates } from './recurrence.js';

export const startDate = ev => (ev.allDay ? ev.start : dtDate(ev.start));

/** 予定が最後にかかる日（含む） */
export function lastDate(ev) {
  if (ev.allDay) return ev.end > ev.start ? addDays(ev.end, -1) : ev.start;
  const sd = dtDate(ev.start), ed = dtDate(ev.end);
  if (ed > sd && dtTime(ev.end) === '00:00') return addDays(ed, -1);
  return ed < sd ? sd : ed;
}

export const spanDays = ev => diffDays(startDate(ev), lastDate(ev)) + 1;
export const isMultiDay = ev => spanDays(ev) > 1;

/** start/end を days 日・minutes 分ずらす */
export function shiftTimes(ev, days, minutes = 0) {
  if (ev.allDay) return { start: addDays(ev.start, days), end: addDays(ev.end, days) };
  const d = days * 1440 + minutes;
  return { start: addMinutes(ev.start, d), end: addMinutes(ev.end, d) };
}

/** 繰り返しの1回分を、その日に置いた start/end */
function placeAt(ev, occDate) {
  const days = diffDays(startDate(ev), occDate);
  return shiftTimes(ev, days);
}

/**
 * [fromKey, toKey) にかかる回をすべて返す。
 * occurrence = { key, event, start, end, allDay, occDate, recurring }
 */
export function occurrencesInRange(events, fromKey, toKey, { isVisible = () => true } = {}) {
  const out = [];
  for (const ev of events) {
    if (ev.deletedAt || !isVisible(ev)) continue;
    const look = spanDays(ev) - 1;
    const dates = expandDates(startDate(ev), ev.rrule, addDays(fromKey, -look), toKey, ev.exdates);
    for (const occDate of dates) {
      const { start, end } = ev.rrule ? placeAt(ev, occDate) : ev;
      out.push({ key: `${ev.id}@${occDate}`, event: ev, start, end, allDay: ev.allDay, occDate, recurring: !!ev.rrule });
    }
  }
  return out.sort(compareOcc);
}

export function compareOcc(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const sa = a.allDay ? a.start : a.start, sb = b.allDay ? b.start : b.start;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const la = spanDays(a), lb = spanDays(b);
  if (la !== lb) return lb - la;
  return (a.event.title || '').localeCompare(b.event.title || '');
}

/** occurrence が day にかかるか */
export function occTouches(occ, day) {
  return startDate(occ) <= day && lastDate(occ) >= day;
}

/** timed occurrence を day の枠に切り取った分（0〜1440） */
export function clipToDay(occ, day) {
  const s = dtDate(occ.start) < day ? 0 : dtMinutes(occ.start);
  const e = dtDate(occ.end) > day ? 1440 : dtMinutes(occ.end);
  return { top: s, bottom: Math.max(e, s + 15) };
}

export const durationMin = ev => (ev.allDay ? diffDays(ev.start, ev.end) * 1440 : diffMinutes(ev.start, ev.end));

/** 表示用ラベル */
export function timeRangeLabel(occ, day) {
  if (occ.allDay) return isMultiDay(occ) ? `終日（${diffDays(startDate(occ), day) + 1}/${spanDays(occ)}日目）` : '終日';
  const sd = dtDate(occ.start), ed = dtDate(occ.end);
  const f = dt => { const t = dtTime(dt); return `${+t.slice(0, 2)}:${t.slice(3)}`; };
  if (!day || (sd === day && (ed === day || lastDate(occ) === day))) return `${f(occ.start)}〜${f(occ.end)}`;
  if (sd === day) return `${f(occ.start)}〜`;
  if (ed === day) return `〜${f(occ.end)}`;
  return '終日';
}

/** 予定を終日⇔時間指定に切り替えたときの値 */
export function toggleAllDay(ev, allDay, defaultHour = 9) {
  if (ev.allDay === allDay) return { start: ev.start, end: ev.end };
  if (allDay) {
    const s = dtDate(ev.start);
    return { start: s, end: addDays(lastDate(ev), 1) };
  }
  return { start: makeDT(ev.start, defaultHour * 60), end: makeDT(ev.start, defaultHour * 60 + 60) };
}

export const isValidEventTimes = ev =>
  ev.allDay ? /^\d{4}-\d{2}-\d{2}$/.test(ev.start) && ev.end > ev.start
    : isDateTime(ev.start) && isDateTime(ev.end) && ev.end > ev.start;
