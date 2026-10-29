import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listAssets, currentVersion } from '../tools/bump-version.mjs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('sw.js の VERSION が js/version.js と一致する（npm run bump を忘れていない）', () => {
  assert.equal(sw.match(/const VERSION = '([^']+)'/)[1], currentVersion());
});

test('sw.js の ASSETS に全ファイルが入っている（オフラインで欠けない）', () => {
  const listed = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(listed, listAssets());
});
