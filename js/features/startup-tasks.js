// 起動時の自動処理（旧アプリから移植）
//  - 期限切れ Todo の自動アーカイブ（1日1回）
//  - 先週の週次レポートを「振り返り」に追加（週1回）

import { app } from '../app.js';
import { todayKey } from '../core/date.js';
import { addWeeklyReview } from './notes.js';

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

/** 先週の週次レポートを「振り返り」に追加（以前はメモの先頭に追加していた） */
export function weeklyReport(now = new Date()) {
  return addWeeklyReview(now);
}
