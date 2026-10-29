import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWeeklyReports } from '../js/features/notes.js';

// 旧アプリが実際に作っていた形（report + 既存のメモ をつなげたもの）
const report = (a, b, done, undone) => `

📊 週次レポート（${a}〜${b}）
━━━━━━━━━━━━━━━
✅ 完了: ${done.length}件
📌 未完了: ${undone.length}件
🎯 達成率: 50%
━━━━━━━━━━━━━━━
${done.map(t => '✓ ' + t).join('\n')}
${undone.map(t => '✗ ' + t).join('\n')}
`;

test('旧メモから週次レポートを取り出し、残りはそのまま', () => {
  const memo = report('10/19', '10/25', ['レポート'], ['洗濯']) + report('10/12', '10/18', [], ['TOEFL']) + '買い物\n- 牛乳\n\n✓ 自分で書いた行';
  const { rest, reports } = extractWeeklyReports(memo, '2026-10-29');
  assert.equal(rest, '買い物\n- 牛乳\n\n✓ 自分で書いた行');
  assert.deepEqual(reports.map(r => [r.weekStart, r.label]), [['2026-10-19', '10/19〜10/25'], ['2026-10-12', '10/12〜10/18']]);
  assert.ok(reports[0].text.endsWith('✗ 洗濯'));
  assert.ok(reports[1].text.endsWith('✗ TOEFL'));
});

test('年をまたぐ日付は前の年として推定', () => {
  const { reports } = extractWeeklyReports(report('12/29', '1/4', ['a'], []), '2027-01-06');
  assert.equal(reports[0].weekStart, '2026-12-29');
});

test('レポートがなければ何もしない', () => {
  assert.deepEqual(extractWeeklyReports('ふつうのメモ\n📊 これは自分のメモ'), { rest: 'ふつうのメモ\n📊 これは自分のメモ', reports: [] });
});
