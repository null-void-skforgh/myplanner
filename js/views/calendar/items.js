// カレンダー表示用に、予定の各回と期限付き Todo を同じ形にそろえる

import { app, colorOf } from '../../app.js';
import { addDays, diffDays } from '../../core/date.js';
import { occurrencesInRange, startDate, lastDate, durationMin } from '../../core/events.js';

/**
 * item = { kind:'event'|'todo', key, title, color, startDay, lastDay, allDay, start?, end?, occ?, todo? }
 *   bar: 終日、または 24時間以上の予定（週・日表示では終日欄に出す）
 */
export function collectItems(fromKey, toKey) {
  const { store } = app;
  const items = [];
  for (const occ of occurrencesInRange(store.eventList(), fromKey, toKey, { isVisible: store.isCalendarVisible })) {
    items.push({
      kind: 'event', key: occ.key, occ,
      title: occ.event.title || '(タイトルなし)',
      color: colorOf(occ.event),
      allDay: occ.allDay,
      bar: occ.allDay || durationMin(occ) >= 1440,
      start: occ.start, end: occ.end,
      startDay: startDate(occ), lastDay: lastDate(occ),
      recurring: occ.recurring,
    });
  }
  for (const t of store.todoList()) {
    if (t.done || !t.due || t.due < fromKey || t.due >= toKey) continue;
    items.push({ kind: 'todo', key: 'todo:' + t.id, todo: t, title: t.text, startDay: t.due, lastDay: t.due,
      allDay: !t.start, bar: true, time: t.start });
  }
  return items;
}

/** 1行（週）に並べる帯の段を決める。items は startDay/lastDay を持つ */
export function layoutLanes(items, weekStartKey, ncols = 7) {
  const weekEnd = addDays(weekStartKey, ncols - 1);
  const segs = items
    .filter(it => it.startDay <= weekEnd && it.lastDay >= weekStartKey)
    .map(it => {
      const s = it.startDay < weekStartKey ? weekStartKey : it.startDay;
      const e = it.lastDay > weekEnd ? weekEnd : it.lastDay;
      return { it, col: diffDays(weekStartKey, s), span: diffDays(s, e) + 1,
        contLeft: it.startDay < weekStartKey, contRight: it.lastDay > weekEnd };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span || rank(a.it) - rank(b.it) || cmpStart(a.it, b.it));
  const laneEnds = [];
  for (const sg of segs) {
    let lane = laneEnds.findIndex(end => end < sg.col);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(-1); }
    laneEnds[lane] = sg.col + sg.span - 1;
    sg.lane = lane;
  }
  return { segs, laneCount: laneEnds.length };
}

// 終日 → 時間指定 → Todo の順
const rank = it => (it.kind === 'todo' ? 2 : it.allDay ? 0 : 1);
const cmpStart = (a, b) => String(a.start || a.time || '').localeCompare(String(b.start || b.time || ''));

/** 時間グリッド内で重なる予定を横に並べる（列番号と列数を付ける） */
export function layoutColumns(blocks) {
  blocks.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const b of cluster) {
      let c = cols.findIndex(end => end <= b.top);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = b.bottom; b.col = c;
    }
    for (const b of cluster) b.cols = cols.length;
    cluster = [];
  };
  for (const b of blocks) {
    if (b.top >= clusterEnd && cluster.length) flush();
    cluster.push(b); clusterEnd = Math.max(clusterEnd, b.bottom);
  }
  if (cluster.length) flush();
  return blocks;
}
