import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassEvent, firstClassDate, lastClassDate, periodLabel, DEFAULT_PERIODS } from '../js/features/classes.js';
import { expandDates } from '../js/core/recurrence.js';

test('3限・火曜・13週', () => {
  // 2026-10-30 は金曜 → 最初の火曜は 11/3
  const ev = buildClassEvent({ subject: ' 連続体の力学 ', room: '工学部2号館', days: [2], periods: [3], from: '2026-10-30', weeks: 13 });
  assert.equal(ev.title, '連続体の力学');
  assert.equal(ev.start, '2026-11-03T13:00');
  assert.equal(ev.end, '2026-11-03T14:45');
  assert.deepEqual(ev.rrule, { freq: 'WEEKLY', interval: 1, byDay: ['TU'], count: 13 });
  const dates = expandDates('2026-11-03', ev.rrule, '2026-01-01', '2028-01-01');
  assert.equal(dates.length, 13);
  assert.equal(dates.at(-1), '2027-01-26');
  assert.equal(lastClassDate(ev), '2027-01-26');
});

test('連続コマと週2回', () => {
  const ev = buildClassEvent({ subject: '実験', days: [4, 1], periods: [4, 3], from: '2026-11-02', weeks: 2 });
  assert.equal(ev.start, '2026-11-02T13:00');
  assert.equal(ev.end, '2026-11-02T16:40');
  assert.deepEqual(ev.rrule.byDay, ['MO', 'TH']);
  assert.equal(ev.rrule.count, 4);
  assert.deepEqual(expandDates('2026-11-02', ev.rrule, '2026-01-01', '2028-01-01'), ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12']);
  assert.equal(lastClassDate(ev), '2026-11-12');
  assert.equal(periodLabel([4, 3]), '3〜4限');
});

test('時限の時刻を変えられる', () => {
  const t = DEFAULT_PERIODS.map(p => [...p]); t[0] = ['09:00', '10:30'];
  const ev = buildClassEvent({ subject: 'a', days: [5], periods: [1], from: '2026-10-30', weeks: 1, periodTimes: t });
  assert.equal(ev.start, '2026-10-30T09:00');
  assert.equal(firstClassDate('2026-10-31', [5]), '2026-11-06');
});
