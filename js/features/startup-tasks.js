// 起動時の自動処理（旧アプリから移植）
//  - 期限切れ Todo の自動アーカイブ（1日1回）
//  - 先週の週次レポートをメモの先頭に追加（週1回）

import { app } from '../app.js';
import { todayKey, addDays, startOfWeek, fmtMD } from '../core/date.js';

export function autoArchive() {
  const { store } = app;
  const today = todayKey(); // 旧アプリは UTC 日付で判定していたのを端末の日付に修正
  if (store.state.meta.lastArchiveDate === today) return;
  const targets = store.todoList().filter(t => !t.done && t.due && t.due < today);
  if (targets.length) {
    store.transact(`期限切れ ${targets.length}件をアーカイブしました`, tx => {
      for (const t of targets) tx.put('todos', { ...t, done: true, archivedAuto: true, completedAt: Date.now() });
    });
  }
  store.setMeta({ lastArchiveDate: today });
}

export function weeklyReport(now = new Date()) {
  const { store } = app;
  const weekNum = String(Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000))); // 旧アプリと同じ番号付け
  if (store.state.meta.lastReportWeek === weekNum) return null;
  store.setMeta({ lastReportWeek: weekNum });

  const thisMonday = startOfWeek(todayKey(now), 1);
  const lastMonday = addDays(thisMonday, -7);
  const lastSunday = addDays(thisMonday, -1);
  const list = store.todoList().filter(t => t.due && t.due >= lastMonday && t.due <= lastSunday);
  if (!list.length) return null;

  const done = list.filter(t => t.done);
  const rate = Math.round(done.length / list.length * 100);
  const report = `

📊 週次レポート（${fmtMD(lastMonday)}〜${fmtMD(lastSunday)}）
━━━━━━━━━━━━━━━
✅ 完了: ${done.length}件
📌 未完了: ${list.length - done.length}件
🎯 達成率: ${rate}%
━━━━━━━━━━━━━━━
${done.map(t => '✓ ' + t.text).join('\n')}
${list.filter(t => !t.done).map(t => '✗ ' + t.text).join('\n')}
`;
  store.setMemo(report + store.state.memo);
  return '📊 先週の週次レポートをメモに追加しました';
}
