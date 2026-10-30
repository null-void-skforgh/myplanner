// カレンダー画面：見出し（前後移動・今日・検索・取り消し）と表示切替（月・週・日・リスト）

import { app } from '../../app.js';
import { h, clear, icon } from '../../ui/dom.js';
import { attachSwipe, isDragging } from '../../ui/gesture.js';
import { addDays, addMonths, todayKey, fmtYM, fmtJP, startOfWeek, startOfMonth, parts } from '../../core/date.js';
import { renderMonth } from './month.js';
import { renderTimeGrid } from './timegrid.js';
import { renderAgenda } from './agenda.js';
import { openCalendarsSheet } from '../calendars-sheet.js';

const VIEW_LABELS = [['month', '月'], ['week', '週'], ['day', '日'], ['agenda', 'リスト']];

export function mountCalendar(page) {
  // 同じ日に移るとき（リストをスクロールしたあとの「今日」など）は、描き直さずに先頭まで戻す
  const goDate = next => {
    const { view, date } = app.router.state;
    const list = body.querySelector('.agenda');
    if (view === 'agenda' && next === date && list) { list.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    app.router.go({ date: next });
  };
  const title = h('button.cal-title', { onclick: () => goDate(todayKey()) });
  const undoBtn = h('button.icon-btn', { 'aria-label': '取り消す', onclick: () => app.store.undo() }, icon('undo'));
  const seg = h('div.segmented', { role: 'tablist' }, VIEW_LABELS.map(([v, label]) =>
    h('button', { role: 'tab', dataset: { view: v }, onclick: () => app.router.go({ view: v }) }, label)));
  const header = h('header.app-header.cal-header',
    h('div.cal-header-row',
      h('button.icon-btn', { 'aria-label': '前へ', onclick: () => step(-1) }, icon('left')),
      title,
      h('button.icon-btn', { 'aria-label': '次へ', onclick: () => step(1) }, icon('right')),
      h('div.spacer'),
      h('button.pill-btn', { onclick: () => goDate(todayKey()) }, '今日'),
      h('button.icon-btn', { 'aria-label': 'カレンダー', onclick: openCalendarsSheet }, icon('layers')),
      h('button.icon-btn', { 'aria-label': '検索', onclick: () => app.openSearch() }, icon('search')),
      undoBtn),
    seg);
  const body = h('div.cal-body');
  const fab = h('button.fab', { 'aria-label': '予定を追加', onclick: () => app.openQuickAdd({ baseDate: app.router.state.date }) }, icon('plus'));
  clear(page, header, body, fab);

  // リスト表示で今見出しに出ている月（スクロールで変わる）
  let agendaShown = null;

  function step(dir) {
    const { view, date } = app.router.state;
    let next;
    if (view === 'agenda') {
      // 見出しの月の前後の月へ。今月なら今日から、それ以外は1日から
      const target = addMonths(startOfMonth(agendaShown || date), dir);
      const today = todayKey();
      next = target.slice(0, 7) === today.slice(0, 7) ? today : target;
    } else {
      next = view === 'month' ? addMonths(date, dir)
        : view === 'week' ? addDays(date, 7 * dir)
        : addDays(date, dir);
    }
    goDate(next);
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
    else if (view === 'agenda') { agendaShown = date; renderAgenda(body, { ...opts, onMonth: d => { agendaShown = d; title.textContent = fmtYM(d); } }); }
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
