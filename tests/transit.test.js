import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yahooUrl, googleMapsUrl, arriveBy } from '../js/features/transit.js';

test('Yahoo!乗換案内：到着時刻で検索する URL', () => {
  const u = new URL(yahooUrl({ from: ' 東京 ', to: '本郷三丁目', dt: arriveBy('2026-11-03T13:00', 5) }));
  assert.equal(u.origin + u.pathname, 'https://transit.yahoo.co.jp/search/result');
  assert.deepEqual(Object.fromEntries(u.searchParams), { from: '東京', to: '本郷三丁目', y: '2026', m: '11', d: '03', hh: '12', m1: '5', m2: '5', type: '4' });
  const dep = new URL(yahooUrl({ from: 'a', to: 'b', dt: '2026-11-03T09:05', mode: 'depart' }));
  assert.deepEqual([dep.searchParams.get('hh'), dep.searchParams.get('m1'), dep.searchParams.get('m2'), dep.searchParams.get('type')], ['9', '0', '5', '1']);
  assert.equal(new URL(yahooUrl({ from: 'a', to: 'b' })).searchParams.get('type'), null);
});

test('日付をまたぐ到着時刻・Google マップ', () => {
  assert.equal(arriveBy('2026-11-03T00:03', 5), '2026-11-02T23:58');
  const g = new URL(googleMapsUrl({ from: '東京駅', to: '東京大学 工学部2号館' }));
  assert.equal(g.searchParams.get('travelmode'), 'transit');
  assert.equal(g.searchParams.get('destination'), '東京大学 工学部2号館');
});
