import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJa } from '../js/nlp/parse-ja.js';

const today = '2026-10-29'; // 木曜
const p = s => parseJa(s, { today });
const pick = r => ({ title: r.title, allDay: r.allDay, start: r.start, end: r.end });

const cases = [
  ['明日15時 歯医者', { title: '歯医者', allDay: false, start: '2026-10-30T15:00', end: '2026-10-30T16:00' }],
  ['歯医者 明日 15:30', { title: '歯医者', allDay: false, start: '2026-10-30T15:30', end: '2026-10-30T16:30' }],
  ['10/30 15-17時 ゼミ', { title: 'ゼミ', allDay: false, start: '2026-10-30T15:00', end: '2026-10-30T17:00' }],
  ['11月3日 10時から12時まで 説明会', { title: '説明会', allDay: false, start: '2026-11-03T10:00', end: '2026-11-03T12:00' }],
  ['来週月曜 終日 旅行', { title: '旅行', allDay: true, start: '2026-11-02', end: '2026-11-03' }],
  ['金曜 午後3時半 1時間半 面談', { title: '面談', allDay: false, start: '2026-10-30T15:30', end: '2026-10-30T17:00' }],
  ['あさって 3時 打ち合わせ', { title: '打ち合わせ', allDay: false, start: '2026-10-31T15:00', end: '2026-10-31T16:00' }],
  ['午前3時 起きる', { title: '起きる', allDay: false, start: '2026-10-29T03:00', end: '2026-10-29T04:00' }],
  ['10/30〜11/2 京都旅行', { title: '京都旅行', allDay: true, start: '2026-10-30', end: '2026-11-03' }],
  ['22時〜2時 夜勤', { title: '夜勤', allDay: false, start: '2026-10-29T22:00', end: '2026-10-30T02:00' }],
  ['買い物', { title: '買い物', allDay: true, start: '2026-10-29', end: '2026-10-30' }],
  ['5日 締切', { title: '締切', allDay: true, start: '2026-11-05', end: '2026-11-06' }],
  ['１２月２４日　１９：００　クリスマス会', { title: 'クリスマス会', allDay: false, start: '2026-12-24T19:00', end: '2026-12-24T20:00' }],
  ['1/10 成人式', { title: '成人式', allDay: true, start: '2027-01-10', end: '2027-01-11' }],
  ['三時に お茶', { title: 'お茶', allDay: false, start: '2026-10-29T15:00', end: '2026-10-29T16:00' }],
  ['今日 9時 30分 朝会', { title: '朝会', allDay: false, start: '2026-10-29T09:00', end: '2026-10-29T09:30' }],
];

for (const [input, want] of cases) {
  test(input, () => assert.deepEqual(pick(p(input)), want));
}

test('繰り返し', () => {
  const r = p('毎週火曜 10時 授業');
  assert.deepEqual(r.rrule, { freq: 'WEEKLY', interval: 1, byDay: ['TU'] });
  assert.equal(r.start, '2026-11-03T10:00');
  assert.equal(r.title, '授業');
  assert.deepEqual(p('毎日 7時 ジョギング').rrule, { freq: 'DAILY', interval: 1 });
  assert.equal(p('毎月25日 給料日').start, '2026-11-25');
  assert.deepEqual(p('平日 9時 出社').rrule.byDay, ['MO', 'TU', 'WE', 'TH', 'FR']);
});

test('選択中の日を既定日にする', () => {
  assert.equal(parseJa('14時 会議', { today, baseDate: '2026-11-11' }).start, '2026-11-11T14:00');
});

test('タイトル中の語を壊さない', () => {
  assert.equal(p('三井さんと 明日 ランチ').title, '三井さんと ランチ');
  assert.equal(p('月曜会議の準備').title.includes('会議の準備'), true);
});

test('毎月 第N曜日・最終曜日', () => {
  const a = p('毎月第2火曜 19時 定例会');
  assert.deepEqual(a.rrule, { freq: 'MONTHLY', interval: 1, byDay: ['2TU'] });
  assert.equal(a.start, '2026-11-10T19:00');
  assert.equal(a.title, '定例会');
  const b = p('毎月最終金曜 飲み会');
  assert.deepEqual(b.rrule.byDay, ['-1FR']);
  assert.equal(b.start, '2026-10-30');
});
