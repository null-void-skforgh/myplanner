import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectKey, searchUrl, findUrls, cleanUrl } from '../js/features/syllabus.js';

test('科目名のキー：付け足しや空白の違いを無視', () => {
  assert.equal(subjectKey('連続体の力学（補講）'), '連続体の力学');
  assert.equal(subjectKey(' 連続体の 力学 '), '連続体の力学');
  assert.equal(subjectKey('材料力学(第2回)'), '材料力学');
});

test('授業カタログの検索 URL', () => {
  assert.equal(searchUrl('連続体の力学（補講）'), 'https://catalog.he.u-tokyo.ac.jp/result?q=' + encodeURIComponent('連続体の力学'));
});

test('メモ欄の URL を取り出す', () => {
  assert.deepEqual(findUrls('Zoom: https://u-tokyo-ac-jp.zoom.us/j/123?pwd=ab。資料は https://example.com/a.pdf\nhttps://example.com/a.pdf'),
    ['https://u-tokyo-ac-jp.zoom.us/j/123?pwd=ab', 'https://example.com/a.pdf']);
  assert.equal(cleanUrl('連続体の力学のシラバス https://catalog.he.u-tokyo.ac.jp/detail?code=FEN-AM4201L1&year=2026'), 'https://catalog.he.u-tokyo.ac.jp/detail?code=FEN-AM4201L1&year=2026');
  assert.equal(cleanUrl('なし'), null);
});
