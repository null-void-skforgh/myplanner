// 通知の予定表づくり（純粋関数）。結果はサーバーに送り、サーバーが時間になったら Web Push で届ける。
//
// 予定の通知 Event.reminders は「開始の何分前か」の配列。
//   時刻のある予定：10 → 10分前、0 → 開始時、1440 → 1日前
//   終日の予定    ：開始日の 0:00 が基準。-540 → 当日 9:00、900 → 前日 9:00

import { addDays, dtDate, dtTime, fmtMDW, fmtTime, todayKey, timeToMin, makeDT, parts } from '../core/date.js';
import { occurrencesInRange, startDate, lastDate } from '../core/events.js';

export const WINDOW_DAYS = 30;
const MAX_ITEMS = 900;
const TODO_BEFORE_MIN = 10;

export const TIMED_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440];
export const ALLDAY_PRESETS = [-540, 900, 2340, 9540]; // 当日9時・前日9時・2日前9時・1週間前9時

export function reminderLabel(min, allDay) {
  if (allDay) {
    const days = Math.max(0, Math.ceil(min / 1440));
    const t = days * 1440 - min;
    const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    return `${days === 0 ? '当日' : days === 1 ? '前日' : days === 7 ? '1週間前' : `${days}日前`} ${time}`;
  }
  if (min === 0) return '開始時';
  if (min % 1440 === 0) return `${min / 1440}日前`;
  if (min % 60 === 0) return `${min / 60}時間前`;
  if (min > 60) return `${Math.floor(min / 60)}時間${min % 60}分前`;
  return `${min}分前`;
}

/** "YYYY-MM-DDTHH:mm"（端末の時刻）→ ミリ秒 */
export function localMs(dt) {
  const { y, m, d } = parts(dtDate(dt));
  const t = timeToMin(dtTime(dt));
  return new Date(y, m - 1, d, Math.floor(t / 60), t % 60).getTime();
}

const occStartDT = occ => (occ.allDay ? `${occ.start}T00:00` : occ.start);
const hm = dt => fmtTime(dt);

/**
 * @param {{events:object[], todos:object[], settings:object, isVisible?:(ev)=>boolean}} data
 * @param {number} now ミリ秒
 * @returns {{id:string, at:number, title:string, body:string, tag:string, url:string}[]}
 */
export function buildSchedule({ events, todos, settings, isVisible = () => true }, now = Date.now(), days = WINDOW_DAYS) {
  const today = todayKey(new Date(now));
  const until = addDays(today, days);
  const out = [];
  const push = it => { if (it.at > now - 60e3 && it.at < localMs(`${until}T00:00`)) out.push(it); };

  // ── 予定ごとの通知（終日の「1週間前」まで拾えるよう、少し先まで展開する） ──
  const withRem = events.filter(e => !e.deletedAt && e.reminders?.length);
  for (const occ of occurrencesInRange(withRem, today, addDays(until, 8))) {
    const ev = occ.event;
    const base = localMs(occStartDT(occ));
    const when = occ.allDay
      ? (startDate(occ) === lastDate(occ) ? `${fmtMDW(occ.start)} 終日` : `${fmtMDW(occ.start)}〜${fmtMDW(lastDate(occ))}`)
      : `${fmtMDW(dtDate(occ.start))} ${hm(occ.start)}〜${hm(occ.end)}`;
    for (const min of new Set(ev.reminders)) {
      if (!Number.isFinite(min)) continue;
      const at = base - min * 60e3;
      push({ id: `ev:${ev.id}:${occ.occDate}:${min}:${at}`, at, title: `📅 ${ev.title || '(タイトルなし)'}`,
        body: [when, !occ.allDay && (min === 0 ? '始まりました' : `${reminderLabel(min, false).replace('前', '後')}に始まります`), ev.location].filter(Boolean).join('・'),
        tag: `ev:${ev.id}:${occ.occDate}`, url: `./#/cal/day/${dtDate(occStartDT(occ))}` });
    }
  }

  const active = todos.filter(t => !t.done && !t.deletedAt);

  // ── 時刻つき Todo の期限 ──
  if (settings.notifyTodos !== false) {
    for (const t of active) {
      if (!t.due || !t.start) continue;
      const at = localMs(`${t.due}T${t.start}`) - TODO_BEFORE_MIN * 60e3;
      push({ id: `todo:${t.id}:${at}`, at, title: `${t.important ? '★' : '☑'} ${t.text}`, body: `${TODO_BEFORE_MIN}分後（${t.start}）が期限です`, tag: `todo:${t.id}`, url: './#/todo' });
    }
  }

  // ── 毎朝のまとめ ──
  if (settings.notifyMorning !== false) {
    const time = timeToMin(settings.morningTime || '09:00') ?? 540;
    const occs = occurrencesInRange(events, today, until, { isVisible });
    for (let d = today; d < until; d = addDays(d, 1)) {
      const at = localMs(makeDT(d, time));
      if (at <= now) continue;
      const lines = occs.filter(o => startDate(o) <= d && lastDate(o) >= d).map(o =>
        `${o.allDay ? '終日' : dtDate(o.start) === d ? hm(o.start) : '〜' + (dtDate(o.end) === d ? hm(o.end) : '')} ${o.event.title || '(タイトルなし)'}`);
      const dueToday = active.filter(t => t.due === d).sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || (a.start || '99').localeCompare(b.start || '99'));
      const overdue = active.filter(t => t.due && t.due < d).length;
      const todoLines = dueToday.map(t => `${t.important ? '★' : '☑'} ${t.text}${t.start ? `（${t.start}まで）` : ''}`);
      // 期限切れだけの日は送らない（毎朝同じ通知が続かないように）
      if (!lines.length && !todoLines.length) continue;
      const body = [...lines, ...todoLines, overdue > 0 && `⚠️ 期限切れのTodo ${overdue}件`].filter(Boolean);
      const summary = [lines.length && `予定${lines.length}件`, dueToday.length && `Todo${dueToday.length}件`].filter(Boolean).join('・');
      push({ id: `morning:${d}:${time}`, at, title: `☀️ ${fmtMDW(d)} ${summary || '今日のまとめ'}`,
        body: body.join('\n'), tag: `morning:${d}`, url: `./#/cal/day/${d}` });
    }
  }

  return out.sort((a, b) => a.at - b.at).slice(0, MAX_ITEMS);
}
