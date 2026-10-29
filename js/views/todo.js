// Todo 画面（今週・急ぎ・すべて・完了・ゴミ箱）とウィジェット同期

import { app } from '../app.js';
import { h, clear, icon } from '../ui/dom.js';
import { parseJa } from '../nlp/parse-ja.js';
import { dtDate, todayKey } from '../core/date.js';
import { addTodo, toggleTodo, trashTodo, restoreTodo, purgeTodo, compareDue, isUrgent, isOverdue, isThisWeek, dueLabel } from '../features/todo-actions.js';
import { syncToScriptable } from '../features/widget.js';

export function mountTodo(page) {
  let trashOpen = false, doneOpen = false;
  const input = h('input.input', { type: 'text', placeholder: '例: 明日 レポート提出', enterkeyhint: 'done' });
  const add = () => {
    const v = input.value.trim();
    if (!v) return;
    const r = parseJa(v);
    addTodo({ text: r.title || v, due: r.hasDate ? dtDate(r.start) : null, start: r.hasTime ? r.start.slice(11) : null });
    input.value = '';
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });

  const header = h('header.app-header', h('div.page-title', 'Todo'), h('div.spacer'),
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
      h('button.icon-btn.subtle', { 'aria-label': '削除', onclick: () => trashTodo(t.id) }, icon('close')));
  }

  function render() {
    const { store } = app;
    const all = store.todoList();
    const active = all.filter(t => !t.done).sort(compareDue);
    const done = all.filter(t => t.done).sort((a, b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0));
    const week = active.filter(t => isThisWeek(t.due, 1));
    const urgent = active.filter(t => isUrgent(t.due) || isOverdue(t.due));
    const rest = active.filter(t => !urgent.includes(t));
    const trash = Object.values(store.state.trash).sort((a, b) => b.trashedAt - a.trashedAt);

    clear(body,
      h('div.todo-add', input, h('button.btn', { onclick: add }, '追加')),
      h('section.card.this-week', h('div.section-label', '📅 今週のTodo'),
        week.length ? week.map(t => item(t)) : h('div.empty-state.small', '今週が期限のTodoはありません')),
      urgent.length > 0 && h('section', h('div.section-label.red', '🔴 急ぎ（2週間以内）'), h('div.todo-list', urgent.map(t => item(t)))),
      h('section', h('div.section-label', urgent.length ? `📌 そのほかのTodo（${rest.length}）` : `📌 すべてのTodo（${rest.length}）`),
        h('div.todo-list', rest.length ? rest.map(t => item(t)) : h('div.empty-state.small', 'Todoはありません'))),
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
