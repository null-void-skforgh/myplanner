// 起動：データ移行 → store 初期化 → 画面の組み立て → 自動処理 → Service Worker

import { app } from './app.js';
import { createStorage } from './core/storage.js';
import { runMigration } from './core/migrate.js';
import { createStore } from './core/store.js';
import { todayKey } from './core/date.js';
import { createRouter } from './ui/router.js';
import { applyTheme, watchSystemTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { closeTopSheet } from './ui/sheet.js';
import { mountCalendar } from './views/calendar/index.js';
import { mountTodo } from './views/todo.js';
import { mountMemo } from './views/memo.js';
import { mountSettings } from './views/settings.js';
import { openEventEditor } from './views/event-editor.js';
import { openQuickAdd } from './views/quick-add.js';
import { openClassAdd } from './views/class-add.js';
import { openTodoEditor } from './views/todo-editor.js';
import { openSearch } from './views/search.js';
import { autoArchive, weeklyReport } from './features/startup-tasks.js';
import { ensureNotesMigrated } from './features/notes.js';
import { registerServiceWorker } from './pwa.js';
import { maybeRemindBackup } from './features/backup.js';
import { startScheduleSync } from './features/server.js';
import { startGoogleSync } from './integrations/google.js';

function boot() {
  const storage = createStorage();
  const migration = runMigration(storage);
  const store = createStore(storage);
  app.store = store;
  const notesMigration = ensureNotesMigrated();

  applyTheme(store.state.settings.theme);
  watchSystemTheme(() => store.state.settings.theme);

  const router = createRouter({ view: store.state.settings.defaultView, date: todayKey() });
  app.router = router;
  Object.assign(app, { openEventEditor, openQuickAdd, openTodoEditor, openSearch, openClassAdd });

  // ── 画面 ──
  const pages = {
    cal: mountCalendar(document.getElementById('page-cal')),
    todo: mountTodo(document.getElementById('page-todo')),
    memo: mountMemo(document.getElementById('page-memo')),
    settings: mountSettings(document.getElementById('page-settings')),
  };
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    const page = t.dataset.page;
    if (page === router.state.page && page === 'cal') router.go({ date: todayKey() });
    else if (page === router.state.page && page === 'memo') pages.memo.toList();
    else router.go({ page }, { push: true });
  }));

  function showPage(page) {
    for (const [name] of Object.entries(pages)) document.getElementById('page-' + name).classList.toggle('active', name === page);
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.page === page)));
    pages[page].render();
  }
  router.subscribe((s, prev) => {
    if (prev.page === 'memo' && s.page !== 'memo') pages.memo.flush?.();
    if (s.page !== prev.page) showPage(s.page);
    else if (s.page === 'cal') pages.cal.render();
  });

  store.subscribe((changed, info) => {
    for (const [name, p] of Object.entries(pages)) {
      if (name === router.state.page) p.onStoreChange(changed);
      else p.stale = true;
    }
    if (info.undo) toast(`取り消しました：${info.label}`, { action: { label: 'やり直す', fn: () => store.redo() } });
    else if (info.redo) toast(`やり直しました：${info.label}`);
    else if (info.undoable && info.label) toast(info.label, { action: { label: '取り消す', fn: () => store.undo() } });
  });
  // 裏にある画面は表示するときに描き直す
  router.subscribe(s => { const p = pages[s.page]; if (p.stale) { p.stale = false; p.render(); } });

  showPage(router.state.page);
  if (!location.hash) history.replaceState(null, '', `#/cal/${router.state.view}/${router.state.date}`);

  // ── 起動時の自動処理 ──
  const messages = [];
  if (migration) messages.push(`旧データを引き継ぎました（予定 ${migration.events}件・Todo ${migration.todos}件）`);
  if (notesMigration?.reviews) messages.push(`メモを整理しました（週次レポート ${notesMigration.reviews}件を「振り返り」に移動）`);
  const reportMsg = weeklyReport();
  if (reportMsg) messages.push(reportMsg);
  messages.forEach((m, i) => setTimeout(() => toast(m, { duration: 3500 }), i * 3800));
  setTimeout(autoArchive, messages.length * 3800);
  if (!migration) maybeRemindBackup();

  // 日付が変わってから戻ってきたら描き直す
  let lastDay = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || todayKey() === lastDay) return;
    lastDay = todayKey();
    autoArchive();
    pages[router.state.page].render();
  });

  // ── キーボード（iPad / PC） ──
  document.addEventListener('keydown', e => {
    if (e.target.matches?.('input, textarea, select')) { if (e.key === 'Escape') closeTopSheet(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    else if (e.key === 'Escape') closeTopSheet();
    else if (e.key === '/' ) { e.preventDefault(); openSearch(); }
    else if (e.key === 'n') openQuickAdd({ baseDate: router.state.date });
  });

  registerServiceWorker();

  // ── 通知 ──
  startScheduleSync();
  startGoogleSync({ onError: e => {
    if (e.message === 'google_reauth' || e.message === 'google_not_connected') toast('Googleとの接続が切れました。「設定 → Googleカレンダー」から接続し直してください', { duration: 5000 });
  } });
  // 通知をタップしたら、その日の画面を開く（sw.js の notificationclick から）
  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type !== 'open') return;
    const hash = new URL(e.data.url).hash;
    if (hash && hash !== location.hash) location.hash = hash;
  });
}

try {
  boot();
} catch (e) {
  console.error(e);
  const box = document.getElementById('fatal');
  box.hidden = false;
  box.querySelector('pre').textContent = String(e?.stack || e);
}
