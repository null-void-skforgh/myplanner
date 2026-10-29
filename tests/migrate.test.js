import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateV1, runMigration } from '../js/core/migrate.js';
import { createStorage, memoryBackend, KEYS } from '../js/core/storage.js';

// 旧アプリが実際に保存していた形のデータ
const legacy = {
  calItems: JSON.stringify({
    '2026-6-11': [
      { type: 'event', text: 'ゼミ', start: '15:00', end: '17:00', color: 2, repeat: 'weekly', id: 1749600000000 },
      { type: 'event', text: '誕生日', start: '', end: '', color: 1, repeat: 'none', id: 1749600000001 },
    ],
    '2026-10-1': [
      { type: 'event', text: '飲み会', start: '22:00', end: '01:00', color: 0, repeat: 'none', id: 3 },
      { type: 'event', text: '開始だけ', start: '09:00', end: '', id: 4 },
      { type: 'event', text: '終了だけ', start: '', end: '10:00', id: 5 },
    ],
    'broken-key': [{ type: 'event', text: 'x' }],
  }),
  todos: JSON.stringify([
    { id: 12, text: '新しいTodo', done: false, due: '2026-6-5', start: '10:00', end: '' },
    { id: 9000, text: 'TOEFL フェーズ0', done: false, due: '2026-10-01', start: null, end: null },
    { id: 3, text: '期限なし', done: true, due: null, archivedAuto: true },
    { id: 4, text: '壊れた期限', done: false, due: '2026-13-1' },
  ]),
  trashedTodos: JSON.stringify([{ id: 1, text: '消したもの', done: false, due: '2026-7-7', trashedAt: 111 }]),
  nextId: '13',
  memo: 'メモ本文',
  lastArchiveDate: '2026-10-28',
  lastReportWeek: '2964',
};

test('予定の変換', () => {
  const { events, report } = migrateV1(legacy, 1000);
  const byTitle = Object.fromEntries(Object.values(events).map(e => [e.title, e]));
  assert.equal(report.events, 5);
  assert.deepEqual([byTitle['ゼミ'].start, byTitle['ゼミ'].end], ['2026-06-11T15:00', '2026-06-11T17:00']);
  assert.deepEqual(byTitle['ゼミ'].rrule, { freq: 'WEEKLY', interval: 1 });
  assert.equal(byTitle['ゼミ'].color, 2);
  assert.equal(byTitle['誕生日'].allDay, true);
  assert.deepEqual([byTitle['誕生日'].start, byTitle['誕生日'].end], ['2026-06-11', '2026-06-12']);
  assert.equal(byTitle['飲み会'].end, '2026-10-02T01:00');
  assert.equal(byTitle['開始だけ'].end, '2026-10-01T10:00');
  assert.equal(byTitle['終了だけ'].start, '2026-10-01T09:00');
  assert.equal(report.skipped.length, 1);
});

test('Todo の期限を YYYY-MM-DD に統一', () => {
  const { todos, trash, report } = migrateV1(legacy, 1000);
  const list = Object.values(todos).sort((a, b) => b.createdAt - a.createdAt);
  assert.deepEqual(list.map(t => t.text), ['新しいTodo', 'TOEFL フェーズ0', '期限なし', '壊れた期限']);
  assert.equal(list[0].due, '2026-06-05');
  assert.equal(list[0].start, '10:00');
  assert.equal(list[0].end, null);
  assert.equal(list[1].due, '2026-10-01');
  assert.equal(list[2].archivedAuto, true);
  assert.equal(list[3].due, null);
  assert.equal(list[3].dueRaw, '2026-13-1');
  assert.equal(report.warnings.length, 1);
  assert.equal(Object.values(trash)[0].due, '2026-07-07');
  assert.equal(Object.values(trash)[0].trashedAt, 111);
});

test('runMigration: 旧キーは残し、バックアップを作り、2回目は何もしない', () => {
  const be = memoryBackend(legacy);
  const st = createStorage(be);
  const report = runMigration(st, 1000);
  assert.ok(report);
  for (const k of Object.keys(legacy)) assert.equal(be.getItem(k), legacy[k], k + ' が変更されている');
  assert.deepEqual(st.get(KEYS.backupV1).data.calItems, legacy.calItems);
  assert.equal(st.getRaw(KEYS.memo), 'メモ本文');
  assert.equal(st.get(KEYS.meta).lastArchiveDate, '2026-10-28');
  assert.equal(runMigration(st, 2000), null);
});

test('runMigration: 新規ユーザー（旧データなし）', () => {
  const st = createStorage(memoryBackend());
  assert.equal(runMigration(st), null);
  assert.equal(st.get(KEYS.schema), 2);
  assert.deepEqual(st.get(KEYS.events), {});
});
