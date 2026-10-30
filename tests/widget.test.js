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

// ── 予定のウィジェット ──
const { dayEvents } = new Function(SHARED_SOURCE + '; return { dayEvents };')();
const E = (t, s, e, extra = {}) => ({ t, s, e, c: '#7F77DD', ...extra });
const events = [
  E('旅行', '2026-11-02', '2026-11-04', { a: 1 }),
  E('朝ゼミ', '2026-11-03T09:00', '2026-11-03T10:30'),
  E('連続体の力学', '2026-11-03T13:00', '2026-11-03T14:45', { l: '工2' }),
  E('バイト', '2026-11-03T18:00', '2026-11-03T22:00'),
  E('夜勤', '2026-11-02T22:00', '2026-11-03T06:00'),
  E('明日の授業', '2026-11-04T10:25', '2026-11-04T12:10'),
  E('明日の昼', '2026-11-04T12:00', '2026-11-04T13:00'),
  E('前日0時まで', '2026-11-02T20:00', '2026-11-03T00:00'),
];

test('予定ウィジェット：終わった予定は省き、進行中は「〜終了時刻」', () => {
  const d = dayEvents(events, new Date(2026, 10, 3, 13, 30), 5);
  assert.deepEqual(d.rows.map(e => [e.t, e.label, !!e.now]), [['旅行', '終日', false], ['連続体の力学', '〜14:45', true], ['バイト', '18:00', false]]);
  assert.equal(d.total, 5, '0時ちょうどに終わる前日の予定は今日に入れない');
  assert.equal(d.ended, 2);
  assert.deepEqual(d.tomorrow.map(e => [e.t, e.label]), [['明日の授業', '10:25']], '旅行（終日・11/4 は含まない）は明日に出さない');
});

test('予定ウィジェット：行が余れば明日の予定、足りなければ「他N件」', () => {
  const d = dayEvents(events, new Date(2026, 10, 3, 23, 0), 5);
  assert.deepEqual(d.rows.map(e => e.t), ['旅行']);
  assert.deepEqual(d.tomorrow.map(e => e.t), ['明日の授業', '明日の昼']);
  const small = dayEvents(events, new Date(2026, 10, 3, 8, 0), 3);
  assert.deepEqual(small.rows.map(e => e.t), ['旅行', '朝ゼミ', '連続体の力学']);
  assert.equal(small.hidden, 1);
  assert.equal(small.tomorrow.length, 0);
});
