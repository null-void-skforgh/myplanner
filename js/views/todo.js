// Todo 画面とウィジェット同期
// 並びはウィジェットと同じ：★だいじ → 期限が早い順。5件を超えた分は「他N件」にまとめる。

import { todoMemoSwitch } from './sub-switch.js';
import { app } from '../app.js';
import { h, clear, icon } from '../ui/dom.js';
import { parseJa } from '../nlp/parse-ja.js';
import { dtDate, todayKey } from '../core/date.js';
import { addTodo, toggleTodo, toggleImportant, trashTodo, restoreTodo, purgeTodo, isUrgent, isOverdue, dueLabel, arrangeTodos, WIDGET_ROWS } from '../features/todo-actions.js';
import { syncToScriptable } from '../features/widget.js';

export function mountTodo(page) {
  let trashOpen = false, doneOpen = false, showAll = false;
  const input = h('input.input', { type: 'text', placeholder: '例: 明日 レポート提出', enterkeyhint: 'done' });
  const add = () => {
    const v = input.value.trim();
    if (!v) return;
    // 先頭か末尾に ★ を付けると「だいじ」として追加
    const important = /^[★☆]|[★☆]$/.test(v);
    const r = parseJa(v.replace(/^[★☆]\s*|\s*[★☆]$/g, ''));
    addTodo({ text: r.title || v, due: r.hasDate ? dtDate(r.start) : null, start: r.hasTime ? r.start.slice(11) : null, important });
    input.value = '';
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });

  const header = h('header.app-header', todoMemoSwitch('todo'), h('div.spacer'),
    h('button.pill-btn', { onclick: () => syncToScriptable(app.store.todoList()) }, icon('sync', 'icon inline'), 'ウィジェットに同期'),
    h('button.icon-btn', { 'aria-label': '取り消す', onclick: () => app.store.undo() }, icon('undo')));
  const body = h('div.page-scroll');
  clear(page, header, body);

  function item(t, { trash = false } = {}) {
    const today = todayKey();
    const dl = dueLabel(t.due, t.start, today);
    const cls = isOverdue(t.due, today) ? 'over' : isUrgent(t.due, today) ? 'soon' : '';
    if (trash) {
      return h('div.todo-item.trashed',
        h('div.todo-body', h('div.todo-text', t.text), dl && h('div.todo-due', dl)),
        h('button.pill-btn', { onclick: () => restoreTodo(t.id) }, '戻す'),
        h('button.icon-btn', { 'aria-label': '完全に削除', onclick: () => purgeTodo(t.id) }, icon('close')));
    }
    return h('div.todo-item' + (t.done ? '.done' : ''),
      h('button.check' + (t.done ? '.checked' : ''), { 'aria-label': t.done ? '未完了に戻す' : '完了', onclick: () => toggleTodo(t.id) }, t.done && icon('check')),
      h('button.todo-body', { onclick: () => app.openTodoEditor(t) },
        h('div.todo-text', t.text),
        dl && h('div.todo-due.' + (cls || 'normal'), dl)),
      !t.done && h('button.icon-btn.star' + (t.important ? '.on' : ''), {
        'aria-label': t.important ? '★を外す' : '★だいじにする', 'aria-pressed': String(!!t.important), onclick: () => toggleImportant(t.id),
      }, icon('star')),
      h('button.icon-btn.subtle', { 'aria-label': '削除', onclick: () => trashTodo(t.id) }, icon('close')));
  }

  function render() {
    const { store } = app;
    const all = store.todoList();
    const a = arrangeTodos(all, showAll ? Infinity : WIDGET_ROWS);
    const shownImp = a.rows.filter(t => t.important), shownRest = a.rows.filter(t => !t.important);
    const done = all.filter(t => t.done).sort((x, y) => (y.completedAt || y.updatedAt || 0) - (x.completedAt || x.updatedAt || 0));
    const trash = Object.values(store.state.trash).sort((x, y) => y.trashedAt - x.trashedAt);
    const hiddenCount = arrangeTodos(all, WIDGET_ROWS).hidden;

    clear(body,
      h('div.todo-add', input, h('button.btn', { onclick: add }, '追加')),
      shownImp.length > 0 && h('section',
        h('div.section-label.star-label', '★ だいじ（', String(a.imp.length), '）'),
        h('div.todo-list', shownImp.map(t => item(t)))),
      h('section',
        h('div.section-label', '📌 期限が近い順'),
        h('div.todo-list', shownRest.length ? shownRest.map(t => item(t))
          : !shownImp.length && h('div.empty-state.small', 'Todoはありません'))),
      hiddenCount > 0 && h('button.more-btn', { onclick: () => { showAll = !showAll; render(); } },
        showAll ? '閉じる ▲' : `他 ${hiddenCount} 件を表示 ▼`),
      a.active.length > 0 && h('p.note.muted', `ウィジェットには上から${WIDGET_ROWS}件が表示されます。☆を押した「だいじ」なTodoは常に先頭に出ます。`),
      done.length > 0 && h('section',
        h('button.section-label.toggle', { onclick: () => { doneOpen = !doneOpen; render(); } }, `✅ 完了済み（${done.length}） ${doneOpen ? '▼' : '▶'}`),
        doneOpen && h('div.todo-list', done.map(t => item(t)))),
      trash.length > 0 && h('section',
        h('button.section-label.toggle', { onclick: () => { trashOpen = !trashOpen; render(); } }, `🗑️ 削除済み（${trash.length}） ${trashOpen ? '▼' : '▶'}`),
        trashOpen && h('div.todo-list', trash.map(t => item(t, { trash: true })))));
  }

  return {
    render,
    onStoreChange(changed) { if (changed.has('todos') || changed.has('trash')) render(); },
  };
}
