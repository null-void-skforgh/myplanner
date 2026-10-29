// バックアップ（JSON）の書き出し・復元と、書き出しのお知らせ

import { app } from '../app.js';
import { h } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { SCHEMA_VERSION } from '../core/storage.js';

const DAY = 86400000;

/**
 * ファイルを共有シート（iPhone の「ファイルに保存」）か、ダウンロードで保存する。
 * ボタンのタップ処理の中から同期的に呼ぶこと（iOS の制約）。
 * @returns {Promise<boolean>} 保存できたら true（キャンセルは false）
 */
export function saveFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title: file.name }).then(() => true, () => false);
  }
  const a = h('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return Promise.resolve(true);
}

export function exportBackup() {
  const { state } = app.store;
  const data = { app: 'myplanner', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    events: state.events, todos: state.todos, trash: state.trash, calendars: state.calendars, memo: state.memo, settings: state.settings };
  const name = `myplanner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  return saveFile(file).then(ok => {
    if (ok) { app.store.setMeta({ lastExportAt: Date.now() }); toast('バックアップを書き出しました'); }
    return ok;
  });
}

export function lastExportLabel() {
  const t = app.store.state.meta.lastExportAt;
  if (!t) return 'まだ書き出していません';
  const days = Math.floor((Date.now() - t) / DAY);
  return days === 0 ? '最後の書き出し：今日' : `最後の書き出し：${days}日前`;
}

/** 起動時に呼ぶ。前回の書き出しから設定日数たっていればお知らせを出す */
export function maybeRemindBackup(now = Date.now()) {
  const { store } = app;
  const days = store.state.settings.backupReminderDays ?? 7;
  if (!days) return;
  const meta = store.state.meta;
  // 一度も書き出していない場合は、このお知らせ機能を使い始めた日から数える
  if (!meta.lastExportAt && !meta.backupReminderSince) { store.setMeta({ backupReminderSince: now }); return; }
  if (meta.backupSnoozeUntil && now < meta.backupSnoozeUntil) return;
  const last = meta.lastExportAt || meta.backupReminderSince;
  if (now - last < days * DAY) return;
  if (!Object.keys(store.state.events).length && !Object.keys(store.state.todos).length) return;

  const elapsed = Math.floor((now - last) / DAY);
  const banner = h('div.backup-banner', { role: 'alert' },
    h('div.backup-text', h('b', 'バックアップしませんか？'),
      h('span', meta.lastExportAt ? `前回の書き出しから${elapsed}日たちました。` : 'まだ一度も書き出していません。')),
    h('div.backup-actions',
      h('button.btn', { onclick: () => { exportBackup().then(ok => { if (ok) banner.remove(); }); } }, '書き出す'),
      h('button.btn.secondary', { onclick: () => { store.setMeta({ backupSnoozeUntil: now + DAY }); banner.remove(); } }, 'あとで')));
  document.body.appendChild(banner);
}
