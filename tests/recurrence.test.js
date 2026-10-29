import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandDates } from '../js/core/recurrence.js';
import { occurrencesInRange, lastDate } from '../js/core/events.js';
import { newEvent } from '../js/core/model.js';

test('毎日・間隔・until・count・exdates', () => {
  assert.deepEqual(expandDates('2026-10-01', { freq: 'DAILY' }, '2026-10-30', '2026-11-02'),
    ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(expandDates('2026-10-01', { freq: 'DAILY', interval: 3 }, '2026-10-05', '2026-10-12'),
    ['2026-10-07', '2026-10-10']);
  assert.deepEqual(expandDates('2026-10-01', { freq: 'DAILY', until: '2026-10-03' }, '2026-09-01', '2026-12-01'),
    ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(expandDates('2026-10-01', { freq: 'DAILY', count: 3 }, '2026-10-02', '2026-12-01'),
    ['2026-10-02', '2026-10-03']);
  assert.deepEqual(expandDates('2026-10-01', { freq: 'DAILY', count: 3 }, '2026-01-01', '2026-12-01', ['2026-10-02']),
    ['2026-10-01', '2026-10-03']);
});

test('毎週（曜日指定・隔週）', () => {
  // 2026-10-29 は木曜
  assert.deepEqual(expandDates('2026-10-29', { freq: 'WEEKLY' }, '2026-11-01', '2026-11-20'),
    ['2026-11-05', '2026-11-12', '2026-11-19']);
  assert.deepEqual(expandDates('2026-10-26', { freq: 'WEEKLY', byDay: ['MO', 'WE', 'FR'] }, '2026-10-26', '2026-11-02'),
    ['2026-10-26', '2026-10-28', '2026-10-30']);
  assert.deepEqual(expandDates('2026-10-01', { freq: 'WEEKLY', interval: 2 }, '2026-10-01', '2026-11-01'),
    ['2026-10-01', '2026-10-15', '2026-10-29']);
  // 遠い未来でも正しく飛ばせる
  assert.deepEqual(expandDates('2020-01-02', { freq: 'WEEKLY', interval: 2 }, '2026-10-25', '2026-11-08').length, 1);
});

test('毎月（31日は存在する月だけ）・毎年（2/29）', () => {
  assert.deepEqual(expandDates('2026-01-31', { freq: 'MONTHLY' }, '2026-01-01', '2026-06-01'),
    ['2026-01-31', '2026-03-31', '2026-05-31']);
  assert.deepEqual(expandDates('2024-02-29', { freq: 'YEARLY' }, '2024-01-01', '2033-01-01'),
    ['2024-02-29', '2028-02-29', '2032-02-29']);
});

test('複数日・日またぎの予定は範囲の前から始まっても拾う', () => {
  const trip = newEvent({ id: 'a', title: '旅行', allDay: true, start: '2026-10-28', end: '2026-11-02' });
  const late = newEvent({ id: 'b', title: '夜勤', start: '2026-10-31T22:00', end: '2026-11-01T06:00' });
  const midnight = newEvent({ id: 'c', title: '0時まで', start: '2026-10-31T22:00', end: '2026-11-01T00:00' });
  const occ = occurrencesInRange([trip, late, midnight], '2026-11-01', '2026-11-08');
  assert.deepEqual(occ.map(o => o.event.id), ['a', 'b']);
  assert.equal(lastDate(midnight), '2026-10-31');
  assert.equal(lastDate(trip), '2026-11-01');
});

test('繰り返しの各回に時刻が付く', () => {
  const ev = newEvent({ id: 'w', title: 'ゼミ', start: '2026-10-01T15:00', end: '2026-10-01T17:00', rrule: { freq: 'WEEKLY' } });
  const occ = occurrencesInRange([ev], '2026-10-08', '2026-10-09');
  assert.equal(occ.length, 1);
  assert.equal(occ[0].start, '2026-10-08T15:00');
  assert.equal(occ[0].end, '2026-10-08T17:00');
  assert.equal(occ[0].key, 'w@2026-10-08');
});

test('毎月 第N曜日・最終曜日', () => {
  // 2026-11 の第2火曜は 11/10、最終金曜は 11/27
  assert.deepEqual(expandDates('2026-10-13', { freq: 'MONTHLY', byDay: ['2TU'] }, '2026-10-01', '2027-01-01'),
    ['2026-10-13', '2026-11-10', '2026-12-08']);
  assert.deepEqual(expandDates('2026-10-30', { freq: 'MONTHLY', byDay: ['-1FR'] }, '2026-11-01', '2027-01-01'),
    ['2026-11-27', '2026-12-25']);
  // 第5木曜がない月は飛ばす
  assert.deepEqual(expandDates('2026-10-29', { freq: 'MONTHLY', byDay: ['5TH'] }, '2026-10-01', '2027-03-01'),
    ['2026-10-29', '2026-12-31']);
  assert.deepEqual(expandDates('2026-10-13', { freq: 'MONTHLY', byDay: ['2TU'], count: 2 }, '2026-01-01', '2027-12-01'),
    ['2026-10-13', '2026-11-10']);
});

test('繰り返しの説明文', async () => {
  const { describeRRule } = await import('../js/core/recurrence.js');
  assert.equal(describeRRule({ freq: 'MONTHLY', byDay: ['2TU'] }), '毎月 第2火曜');
  assert.equal(describeRRule({ freq: 'WEEKLY', interval: 2, byDay: ['MO', 'TH'], until: '2027-03-31' }), '2週ごと 月・木（2027-03-31まで）');
});
