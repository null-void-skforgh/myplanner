import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toICS, parseICS, zonedToLocal } from '../js/features/ics.js';
import { newEvent } from '../js/core/model.js';

// テストは日本時間で実行する（package.json の test スクリプトで TZ=Asia/Tokyo を指定）

test('書き出し → 読み込みで元に戻る', () => {
  const evs = [
    newEvent({ id: 'a', title: 'ゼミ, 第3回; 発表', start: '2026-10-29T15:00', end: '2026-10-29T17:00',
      rrule: { freq: 'WEEKLY', interval: 2, byDay: ['TH'], until: '2027-01-31' }, exdates: ['2026-11-12'],
      location: '工学部2号館 233', notes: '資料を持っていく\n2行目' }),
    newEvent({ id: 'b', title: '旅行', allDay: true, start: '2026-11-03', end: '2026-11-06' }),
    newEvent({ id: 'c', title: '毎月の定例', start: '2026-11-10T19:00', end: '2026-11-10T20:00', rrule: { freq: 'MONTHLY', byDay: ['2TU'], count: 5 } }),
    newEvent({ id: 'd', title: 'とても長いタイトル'.repeat(10), start: '2026-11-01T09:00', end: '2026-11-01T10:00' }),
  ];
  const ics = toICS(evs, { tz: 'Asia/Tokyo', now: 0 });
  assert.ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), '75オクテットで折り返す');
  const { events, calName } = parseICS(ics);
  assert.equal(calName, 'マイプランナー');
  assert.equal(events.length, 4);
  const [a, b, c, d] = events;
  assert.equal(a.title, 'ゼミ, 第3回; 発表');
  assert.deepEqual([a.start, a.end], ['2026-10-29T15:00', '2026-10-29T17:00']);
  assert.deepEqual(a.rrule, { freq: 'WEEKLY', interval: 2, byDay: ['TH'], until: '2027-01-31' });
  assert.deepEqual(a.exdates, ['2026-11-12']);
  assert.equal(a.location, '工学部2号館 233');
  assert.equal(a.notes, '資料を持っていく\n2行目');
  assert.equal(a.source.externalId, 'a@myplanner');
  assert.deepEqual([b.allDay, b.start, b.end], [true, '2026-11-03', '2026-11-06']);
  assert.deepEqual(c.rrule, { freq: 'MONTHLY', interval: 1, byDay: ['2TU'], count: 5 });
  assert.equal(d.title, evs[3].title);
});

test('Google カレンダー形式（UTC・DURATION・RECURRENCE-ID・他のタイムゾーン）', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:大学',
    'BEGIN:VTIMEZONE', 'TZID:America/New_York', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:u1@google.com', 'DTSTART:20261029T060000Z', 'DTEND:20261029T070000Z', 'SUMMARY:UTCの予定', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:u2', 'DTSTART;TZID=America/New_York:20261029T090000', 'DURATION:PT1H30M', 'SUMMARY:NY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:u3', 'DTSTART;VALUE=DATE:20261101', 'SUMMARY:終日（DTENDなし）', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:r1', 'DTSTART;TZID=Asia/Tokyo:20261005T103000', 'DTEND;TZID=Asia/Tokyo:20261005T120000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10', 'SUMMARY:講義', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:r1', 'RECURRENCE-ID;TZID=Asia/Tokyo:20261019T103000', 'DTSTART;TZID=Asia/Tokyo:20261019T130000',
    'DTEND;TZID=Asia/Tokyo:20261019T143000', 'SUMMARY:講義（教室変更）', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:r1', 'RECURRENCE-ID;TZID=Asia/Tokyo:20261026T103000', 'STATUS:CANCELLED', 'DTSTART;TZID=Asia/Tokyo:20261026T103000', 'END:VEVENT',
    'BEGIN:VTODO', 'UID:todo1', 'SUMMARY:これは読まない', 'END:VTODO',
    'END:VCALENDAR'].join('\r\n');
  const { events, calName } = parseICS(ics);
  assert.equal(calName, '大学');
  const by = Object.fromEntries(events.map(e => [e.title, e]));
  assert.deepEqual([by['UTCの予定'].start, by['UTCの予定'].end], ['2026-10-29T15:00', '2026-10-29T16:00']);
  assert.deepEqual([by['NY'].start, by['NY'].end], ['2026-10-29T22:00', '2026-10-29T23:30']);
  assert.deepEqual([by['終日（DTENDなし）'].start, by['終日（DTENDなし）'].end], ['2026-11-01', '2026-11-02']);
  assert.deepEqual(by['講義'].exdates.sort(), ['2026-10-19', '2026-10-26']);
  assert.equal(by['講義（教室変更）'].start, '2026-10-19T13:00');
  assert.equal(by['講義（教室変更）'].rrule, null);
  assert.equal(events.length, 5);
});

test('zonedToLocal', () => {
  assert.equal(zonedToLocal(2026, 7, 1, 12, 0, 'Europe/London'), '2026-07-01T20:00'); // 夏時間 +1
  assert.equal(zonedToLocal(2026, 12, 1, 12, 0, 'Europe/London'), '2026-12-01T21:00');
});

test('自分で書き出したファイルを読み込むと元の予定に対応づく', async () => {
  const { findExistingByUid } = await import('../js/features/ics.js');
  const ev = newEvent({ id: 'e123', title: 'x', start: '2026-10-29T10:00', end: '2026-10-29T11:00' });
  const [parsed] = parseICS(toICS([ev], { tz: 'Asia/Tokyo' })).events;
  assert.equal(findExistingByUid([ev], parsed.source.externalId), ev);
});
