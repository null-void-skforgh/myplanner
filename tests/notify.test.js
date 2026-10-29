import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, reminderLabel, localMs } from '../js/features/notify.js';
import { newEvent, newTodo, DEFAULT_SETTINGS } from '../js/core/model.js';

const NOW = new Date(2026, 10, 2, 20, 0).getTime(); // 2026-11-02(月) 20:00
const S = { ...DEFAULT_SETTINGS };

test('通知のラベル', () => {
  assert.deepEqual([0, 5, 60, 90, 1440].map(m => reminderLabel(m, false)), ['開始時', '5分前', '1時間前', '1時間30分前', '1日前']);
  assert.deepEqual([-540, 900, 2340, 9540].map(m => reminderLabel(m, true)), ['当日 9:00', '前日 9:00', '2日前 9:00', '1週間前 9:00']);
});

test('既定では予定の通知なし・毎朝9時のまとめだけ', () => {
  const ev = newEvent({ title: 'ゼミ', start: '2026-11-03T13:00', end: '2026-11-03T14:45' });
  const items = buildSchedule({ events: [ev], todos: [], settings: S }, NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'morning:2026-11-03:540');
  assert.equal(items[0].at, localMs('2026-11-03T09:00'));
  assert.match(items[0].title, /11\/3\(火\) 予定1件/);
  assert.equal(items[0].body, '13:00 ゼミ');
});

test('予定ごとの通知（繰り返し・終日・カスタム）', () => {
  const evs = [
    newEvent({ id: 'a', title: '授業', start: '2026-11-03T13:00', end: '2026-11-03T14:45', location: '工2', reminders: [10, 0],
      rrule: { freq: 'WEEKLY', interval: 1, byDay: ['TU'], count: 2 } }),
    newEvent({ id: 'b', title: '旅行', allDay: true, start: '2026-11-05', end: '2026-11-07', reminders: [900] }),
  ];
  const items = buildSchedule({ events: evs, todos: [], settings: { ...S, notifyMorning: false } }, NOW);
  const at = id => items.filter(i => i.id.startsWith(id)).map(i => new Date(i.at).toString().slice(4, 21));
  assert.deepEqual(at('ev:a:'), ['Nov 03 2026 12:50', 'Nov 03 2026 13:00', 'Nov 10 2026 12:50', 'Nov 10 2026 13:00']);
  assert.deepEqual(at('ev:b:'), ['Nov 04 2026 09:00']);
  const first = items.find(i => i.id.startsWith('ev:a:2026-11-03:10'));
  assert.equal(first.title, '📅 授業');
  assert.equal(first.body, '11/3(火) 13:00〜14:45・10分後に始まります・工2');
});

test('時刻つきTodo・まとめに期限切れとだいじ', () => {
  const todos = [
    newTodo({ id: 1, text: 'レポート提出', due: '2026-11-03', start: '17:00' }),
    newTodo({ id: 2, text: '奨学金', due: '2026-11-03', important: true }),
    newTodo({ id: 3, text: '本を返す', due: '2026-11-01' }),
    newTodo({ id: 4, text: '済み', due: '2026-11-03', done: true }),
  ];
  const items = buildSchedule({ events: [], todos, settings: S }, NOW);
  const todo = items.find(i => i.id.startsWith('todo:1:'));
  assert.equal(todo.at, localMs('2026-11-03T16:50'));
  const m = items.find(i => i.id === 'morning:2026-11-03:540');
  assert.equal(m.body, '★ 奨学金\n☑ レポート提出（17:00まで）\n⚠️ 期限切れのTodo 1件');
  // 期限切れだけの日（11/4 以降）はまとめを送らない
  assert.deepEqual(items.filter(i => i.id.startsWith('morning:')).map(i => i.id), ['morning:2026-11-03:540']);
  // 設定でオフ
  const off = buildSchedule({ events: [], todos, settings: { ...S, notifyTodos: false, notifyMorning: false } }, NOW);
  assert.equal(off.length, 0);
});

test('過ぎた通知は入れない・30日より先も入れない', () => {
  const ev = newEvent({ title: 'x', start: '2026-11-02T20:05', end: '2026-11-02T21:00', reminders: [10, 1] });
  const items = buildSchedule({ events: [ev], todos: [], settings: { ...S, notifyMorning: false } }, NOW);
  assert.deepEqual(items.map(i => i.id.split(':')[3]), ['1']);
  const far = newEvent({ title: 'y', start: '2026-12-20T10:00', end: '2026-12-20T11:00', reminders: [10] });
  assert.equal(buildSchedule({ events: [far], todos: [], settings: { ...S, notifyMorning: false } }, NOW).length, 0);
});
