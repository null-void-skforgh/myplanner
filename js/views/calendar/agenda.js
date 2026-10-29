// 予定リスト表示（選択日から先の予定を日ごとに）

import { app } from '../../app.js';
import { h, clear, icon } from '../../ui/dom.js';
import { addDays, dayOfWeek, todayKey, fmtJP, diffDays } from '../../core/date.js';
import { timeRangeLabel } from '../../core/events.js';
import { collectItems } from './items.js';
import { toggleTodo } from '../../features/todo-actions.js';

const SPAN = 42;

export function renderAgenda(root, { date }) {
  let until = addDays(date, SPAN);
  const today = todayKey();
  const list = h('div.agenda-list');
  const moreBtn = h('button.btn.secondary.agenda-more', { onclick: () => { const from = until; until = addDays(until, SPAN); fill(from, until); } }, 'さらに表示');

  const fill = (from, to) => {
    const items = collectItems(from, to);
    let any = false;
    for (let d = from; d < to; d = addDays(d, 1)) {
      const dayItems = items.filter(it => it.startDay <= d && it.lastDay >= d);
      if (!dayItems.length && d !== today) continue;
      any = true;
      const wd = dayOfWeek(d);
      list.appendChild(h('section.agenda-day' + (d === today ? '.today' : ''),
        h('button.agenda-date' + (wd === 0 ? '.sun' : wd === 6 ? '.sat' : ''),
          { onclick: () => app.router.go({ view: 'day', date: d }, { push: true }) },
          h('span.agenda-num', String(+d.slice(8))),
          h('span.agenda-wd', fmtJP(d).replace(/^\d+月\d+日/, '')),
          diffDays(today, d) === 0 && h('span.agenda-badge', '今日')),
        h('div.agenda-items',
          dayItems.length ? dayItems.sort(order).map(it => row(it, d)) : h('div.agenda-empty', '予定なし'))));
    }
    if (!any && from === date) list.appendChild(h('div.empty-state', 'この期間の予定はありません'));
  };
  fill(date, until);
  clear(root, h('div.agenda', list, moreBtn));
}

const order = (a, b) => (a.bar === b.bar ? String(a.start || a.time || '').localeCompare(String(b.start || b.time || '')) : a.bar ? -1 : 1);

function row(it, day) {
  if (it.kind === 'todo') {
    return h('div.agenda-item.todo', { onclick: () => app.openTodoEditor(it.todo) },
      h('button.check', { 'aria-label': '完了', onclick: e => { e.stopPropagation(); toggleTodo(it.todo.id); } }),
      h('div.agenda-body', h('div.agenda-title', it.title), h('div.agenda-time', it.time ? `${it.time}まで` : 'Todo')));
  }
  return h(`div.agenda-item.c${it.color}`, { onclick: () => app.openEventEditor(it.occ) },
    h('span.agenda-bar'),
    h('div.agenda-body',
      h('div.agenda-title', it.title, it.recurring && icon('repeat', 'icon inline')),
      h('div.agenda-time', timeRangeLabel(it.occ, day)),
      it.occ.event.location && h('div.agenda-loc', it.occ.event.location)));
}
