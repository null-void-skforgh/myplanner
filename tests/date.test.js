import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/core/date.js';

test('normalizeKey: 旧形式を YYYY-MM-DD に', () => {
  assert.equal(D.normalizeKey('2026-6-1'), '2026-06-01');
  assert.equal(D.normalizeKey('2026-10-01'), '2026-10-01');
  assert.equal(D.normalizeKey('2026/1/5'), '2026-01-05');
  assert.equal(D.normalizeKey('2026-2-30'), null);
  assert.equal(D.normalizeKey('abc'), null);
  assert.equal(D.normalizeKey(null), null);
});

test('日付の加減算（月またぎ・うるう年）', () => {
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(D.diffDays('2026-10-01', '2026-11-01'), 31);
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.dayOfWeek('2026-10-29'), 4);
  assert.equal(D.startOfWeek('2026-10-29', 0), '2026-10-25');
  assert.equal(D.startOfWeek('2026-10-29', 1), '2026-10-26');
});

test('日時', () => {
  assert.equal(D.makeDT('2026-10-29', 25 * 60), '2026-10-30T01:00');
  assert.equal(D.addMinutes('2026-10-29T23:30', 45), '2026-10-30T00:15');
  assert.equal(D.diffMinutes('2026-10-29T23:30', '2026-10-30T01:00'), 90);
  assert.equal(D.timeToMin('9:05'), 545);
  assert.equal(D.timeToMin(''), null);
});
