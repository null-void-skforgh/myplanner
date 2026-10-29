// Todo の操作（すべて取り消し可能）

import { app } from '../app.js';
import { newTodo } from '../core/model.js';
import { todayKey, diffDays, startOfWeek, addDays, fmtMD } from '../core/date.js';

export function addTodo(fields) {
  const t = newTodo(fields);
  app.store.transact(`Todo「${t.text}」を追加しました`, tx => tx.put('todos', t));
  return t;
}

export function updateTodo(id, patch, label = 'Todoを変更しました') {
  app.store.transact(label, tx => { const t = tx.get('todos', id); if (t) tx.put('todos', { ...t, ...patch }); });
}

export function toggleTodo(id) {
  const t = app.store.state.todos[id];
  if (!t) return;
  const done = !t.done;
  updateTodo(id, { done, completedAt: done ? Date.now() : null, archivedAuto: undefined },
    done ? `「${t.text}」を完了にしました` : `「${t.text}」を未完了に戻しました`);
}

/** ゴミ箱へ（最大50件。古いものから消える） */
export function trashTodo(id) {
  const t = app.store.state.todos[id];
  if (!t) return;
  app.store.transact(`「${t.text}」をゴミ箱に移しました`, tx => {
    tx.remove('todos', id);
    tx.put('trash', { ...t, trashedAt: Date.now() });
    const all = Object.values(app.store.state.trash).sort((a, b) => b.trashedAt - a.trashedAt);
    for (const old of all.slice(50)) tx.remove('trash', old.id);
  });
}

export function restoreTodo(id) {
  const t = app.store.state.trash[id];
  if (!t) return;
  app.store.transact(`「${t.text}」を戻しました`, tx => {
    tx.remove('trash', id);
    const { trashedAt, ...rest } = t;
    tx.put('todos', rest);
  });
}

export function purgeTodo(id) {
  const t = app.store.state.trash[id];
  if (t) app.store.transact(`「${t.text}」を完全に削除しました`, tx => tx.remove('trash', id));
}

export function toggleImportant(id) {
  const t = app.store.state.todos[id];
  if (!t) return;
  updateTodo(id, { important: !t.important }, t.important ? `「${t.text}」の★を外しました` : `「${t.text}」を★だいじにしました（ウィジェットに常に表示）`);
}

/** ウィジェットの行数（ミディアムサイズ）。Todo 画面でも同じ件数まで表示して残りは「他N件」 */
export const WIDGET_ROWS = 5;

/**
 * ★だいじ → 期限が早い順（期限なしは最後）に並べ、max 件を超えた分を hidden に数える。
 * Scriptable 側の arrange()（features/widget.js の SHARED_SOURCE）と同じ結果になる。
 */
export function arrangeTodos(todos, max = WIDGET_ROWS) {
  const active = todos.filter(t => !t.done);
  const imp = active.filter(t => t.important).sort(compareDueStable);
  const rest = active.filter(t => !t.important).sort(compareDueStable);
  const shownImp = imp.slice(0, max);
  const shownRest = rest.slice(0, Math.max(0, max - shownImp.length));
  return { active, imp, rest, rows: [...shownImp, ...shownRest], hidden: active.length - shownImp.length - shownRest.length };
}
const compareDueStable = (a, b) => {
  if (!a.due && !b.due) return 0;
  if (!a.due) return 1;
  if (!b.due) return -1;
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return (a.start || '99:99').localeCompare(b.start || '99:99');
};

// ── 表示用 ──
export function compareDue(a, b) {
  if (!a.due && !b.due) return (b.createdAt || 0) - (a.createdAt || 0);
  if (!a.due) return 1;
  if (!b.due) return -1;
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return (a.start || '99:99').localeCompare(b.start || '99:99');
}

export const isOverdue = (due, today = todayKey()) => !!due && due < today;
/** 2週間以内（旧アプリと同じ基準） */
export function isUrgent(due, today = todayKey()) {
  if (!due) return false;
  const d = diffDays(today, due);
  return d >= 0 && d <= 14;
}
export function isThisWeek(due, weekStart = 1, today = todayKey()) {
  if (!due) return false;
  const s = startOfWeek(today, weekStart);
  return due >= s && due <= addDays(s, 6);
}

export function dueLabel(due, time, today = todayKey()) {
  if (!due) return '';
  const diff = diffDays(today, due);
  const tp = time ? ' ' + time : '';
  if (diff < 0) return `期限切れ（${fmtMD(due)}）`;
  if (diff === 0) return `今日${tp}まで`;
  if (diff === 1) return `明日${tp}まで`;
  return `${fmtMD(due)}${tp}まで`;
}
