// カレンダー画面：見出し（前後移動・今日・検索・取り消し）と表示切替（月・週・日・リスト）

import { app } from '../../app.js';
import { h, clear, icon } from '../../ui/dom.js';
import { attachSwipe, isDragging } from '../../ui/gesture.js';
import { addDays, addMonths, todayKey, fmtYM, fmtJP, startOfWeek, parts } from '../../core/date.js';
import { renderMonth } from './month.js';
import { renderTimeGrid } from './timegrid.js';
import { renderAgenda } from './agenda.js';

const VIEW_LABELS = [['month', '月'], ['week', '週'], ['day', '日'], ['agenda', 'リスト']];

export function mountCalendar(page) {
  const title = h('button.cal-title', { onclick: () => app.router.go({ date: todayKey() }) });
  const undoBtn = h('button.icon-btn', { 'aria-label': '取り消す', onclick: () => app.store.undo() }, icon('undo'));
  const seg = h('div.segmented', { role: 'tablist' }, VIEW_LABELS.map(([v, label]) =>
    h('button', { role: 'tab', dataset: { view: v }, onclick: () => app.router.go({ view: v }) }, label)));
  const header = h('header.app-header.cal-header',
    h('div.cal-header-row',
      h('button.icon-btn', { 'aria-label': '前へ', onclick: () => step(-1) }, icon('left')),
      title,
      h('button.icon-btn', { 'aria-label': '次へ', onclick: () => step(1) }, icon('right')),
      h('div.spacer'),
      h('button.pill-btn', { onclick: () => app.router.go({ date: todayKey() }) }, '今日'),
      h('button.icon-btn', { 'aria-label': '検索', onclick: () => app.openSearch() }, icon('search')),
      undoBtn),
    seg);
  const body = h('div.cal-body');
  const fab = h('button.fab', { 'aria-label': '予定を追加', onclick: () => app.openQuickAdd({ baseDate: app.router.state.date }) }, icon('plus'));
  clear(page, header, body, fab);

  function step(dir) {
    const { view, date } = app.router.state;
    const next = view === 'month' ? addMonths(date, dir)
      : view === 'week' ? addDays(date, 7 * dir)
      : view === 'day' ? addDays(date, dir)
      : addMonths(date, dir);
    app.router.go({ date: next });
  }
  attachSwipe(body, { onLeft: () => step(1), onRight: () => step(-1) });

  function render() {
    const { view, date } = app.router.state;
    const { weekStart, dayStartHour } = app.store.state.settings;
    for (const b of seg.children) b.setAttribute('aria-selected', String(b.dataset.view === view));
    title.textContent = view === 'day' ? (parts(date).y === parts(todayKey()).y ? fmtJP(date) : `${parts(date).y}年 ${fmtJP(date)}`)
      : view === 'week' ? fmtYM(startOfWeek(date, weekStart))
      : fmtYM(date);
    undoBtn.disabled = !app.store.canUndo();
    body.dataset.view = view;
    const opts = { date, view, weekStart, dayStartHour };
    if (view === 'month') renderMonth(body, opts);
    else if (view === 'agenda') renderAgenda(body, opts);
    else renderTimeGrid(body, opts);
  }

  window.addEventListener('resize', () => body._relayout?.());
  return {
    render,
    onStoreChange(changed) {
      if (isDragging()) return;
      if (['events', 'todos', 'calendars', 'settings'].some(c => changed.has(c))) render();
      else undoBtn.disabled = !app.store.canUndo();
    },
  };
}
