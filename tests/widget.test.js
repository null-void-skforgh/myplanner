import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHARED_SOURCE, generateWidgetCode, widgetTodos } from '../js/features/widget.js';
import { arrangeTodos } from '../js/features/todo-actions.js';

const scriptArrange = new Function(SHARED_SOURCE + '; return arrange;')();
const todos = [
  { id: 'a', text: '期限なし', done: false, due: null },
  { id: 'b', text: '来週', done: false, due: '2026-11-05' },
  { id: 'c', text: 'だいじ（期限なし）', done: false, due: null, important: true },
  { id: 'd', text: '明日10時', done: false, due: '2026-10-30', start: '10:00' },
  { id: 'e', text: '明日9時', done: false, due: '2026-10-30', start: '09:00' },
  { id: 'f', text: '完了', done: true, due: '2026-10-01' },
  { id: 'g', text: 'だいじ（来月）', done: false, due: '2026-11-20', important: true },
  { id: 'h', text: '旧形式の期限', done: false, due: '2026-10-31' },
];

test('並び順：★だいじ → 期限が早い順 → 期限なし。入りきらない分は hidden', () => {
  const r = arrangeTodos(todos, 5);
  assert.deepEqual(r.rows.map(t => t.id), ['g', 'c', 'e', 'd', 'h']);
  assert.equal(r.hidden, 2);
  assert.deepEqual(arrangeTodos(todos, 1).rows.map(t => t.id), ['g']);
});

test('ウィジェット（Scriptable）側の並びがアプリと一致する', () => {
  for (const max of [1, 3, 5, 11, 999]) {
    const a = arrangeTodos(todos, max), b = scriptArrange(todos, max);
    assert.deepEqual(b.rows.map(t => t.id), a.rows.map(t => t.id), `max=${max}`);
    assert.equal(b.hidden, a.hidden);
  }
});

test('同期データに ★ が含まれる', () => {
  assert.deepEqual(widgetTodos(todos).find(t => t.id === 'c'), { id: 'c', text: 'だいじ（期限なし）', done: false, due: null, start: undefined, end: undefined, important: true });
});

test('生成コードは構文として正しい（Scriptable と同じく async 関数の中で動かす）', () => {
  const AsyncFunction = (async () => {}).constructor;
  for (const embed of [false, true]) assert.doesNotThrow(() => new AsyncFunction(generateWidgetCode(todos, embed)));
});

test('リポジトリの todo-widget.js は生成コードと同じ', () => {
  const file = readFileSync(new URL('../todo-widget.js', import.meta.url), 'utf8');
  assert.equal(file, generateWidgetCode([], false));
});
