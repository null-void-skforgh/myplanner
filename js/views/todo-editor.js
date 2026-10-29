// Todo の作成・編集シート

import { app } from '../app.js';
import { h } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { addTodo, updateTodo, trashTodo, toggleTodo } from '../features/todo-actions.js';

/** @param {object} target  todo（既存）または { draft: {...} }（新規） */
export function openTodoEditor(target) {
  const isNew = !!target.draft;
  const t = isNew ? { text: '', due: null, start: null, end: null, ...target.draft } : target;
  const text = h('input.input.title-input', { type: 'text', placeholder: 'やること', value: t.text, enterkeyhint: 'done' });
  const due = h('input.input', { type: 'date', value: t.due || '' });
  const start = h('input.input', { type: 'time', step: 300, value: t.start || '' });
  const end = h('input.input', { type: 'time', step: 300, value: t.end || '' });
  const clearDue = h('button.pill-btn', { onclick: () => { due.value = ''; start.value = ''; end.value = ''; } }, '期限なし');

  const save = () => {
    const fields = { text: text.value.trim(), due: due.value || null, start: start.value || null, end: end.value || null };
    if (!fields.text) { text.focus(); return; }
    if (isNew) addTodo(fields);
    else updateTodo(t.id, fields, `「${fields.text}」を保存しました`);
    sheet.close();
  };
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });

  const sheet = openSheet({
    title: isNew ? '新しいTodo' : 'Todoの編集',
    headerRight: h('button.pill-btn.primary', { onclick: save }, isNew ? '追加' : '保存'),
    content: h('div.form',
      h('div.field', text),
      h('div.field.row', h('span.field-label', '期限'), h('div.dt', due, clearDue)),
      h('div.field.row', h('span.field-label', '時刻'), h('div.dt', start, h('span.dt-sep', '〜'), end)),
      !isNew && h('div.btn-row',
        h('button.btn.secondary', { onclick: () => { toggleTodo(t.id); sheet.close(); } }, app.store.state.todos[t.id]?.done ? '未完了に戻す' : '完了にする'),
        h('button.btn.danger', { onclick: () => { trashTodo(t.id); sheet.close(); } }, '削除'))),
  });
  if (isNew && !t.text) text.focus();
}
