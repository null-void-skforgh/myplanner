// 設定（表示・バックアップ・ウィジェット・バージョン）

import { app } from '../app.js';
import { h, clear } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/sheet.js';
import { applyTheme } from '../ui/theme.js';
import { createStorage, KEYS, SCHEMA_VERSION } from '../core/storage.js';
import { remigrateFromBackup } from '../core/migrate.js';
import { createStore } from '../core/store.js';
import { generateWidgetCode } from '../features/widget.js';
import { checkForUpdate } from '../pwa.js';
import { VERSION } from '../version.js';

function segmented(options, current, onChange) {
  const el = h('div.segmented.small', options.map(([value, label]) =>
    h('button', { 'aria-selected': String(value === current), onclick: () => {
      for (const b of el.children) b.setAttribute('aria-selected', String(b.dataset.v === String(value)));
      onChange(value);
    }, dataset: { v: String(value) } }, label)));
  return el;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('コピーしました');
}

function exportData() {
  const { state } = app.store;
  const data = { app: 'myplanner', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    events: state.events, todos: state.todos, trash: state.trash, calendars: state.calendars, memo: state.memo, settings: state.settings };
  const json = JSON.stringify(data, null, 1);
  const name = `myplanner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // iOS のホーム画面アプリでは共有シートから「ファイルに保存」するのが確実
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importData() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast('ファイルを読み込めませんでした'); return; }
    if (data?.app !== 'myplanner' || !data.events || !data.todos) { toast('マイプランナーのバックアップではありません'); return; }
    const n = Object.keys(data.events).length, m = Object.keys(data.todos).length;
    if (!await confirmDialog('バックアップから復元しますか？', '復元する', `予定 ${n}件・Todo ${m}件。今のデータは置き換えられます。`, true)) return;
    app.store.replaceAll(data);
    applyTheme(app.store.state.settings.theme);
    toast('復元しました');
  });
  input.click();
}

async function remigrate() {
  if (!await confirmDialog('旧データから移行し直しますか？', '移行し直す',
    'v1（旧アプリ）のデータから作り直します。v2 で追加・変更した予定とTodoは失われます。', true)) return;
  const storage = createStorage();
  const report = remigrateFromBackup(storage);
  const fresh = createStore(storage);
  app.store.replaceAll({ ...fresh.state });
  toast(`移行しました（予定 ${report.events}件・Todo ${report.todos}件）`);
}

export function mountSettings(page) {
  const body = h('div.page-scroll');
  clear(page, h('header.app-header', h('div.page-title', '設定')), body);

  function render() {
    const s = app.store.state.settings;
    const report = createStorage().get(KEYS.migrationReport, null);
    clear(body,
      h('section.card',
        h('div.section-label', '表示'),
        h('div.setting-row', h('span', 'テーマ'),
          segmented([['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']], s.theme, v => { app.store.setSettings({ theme: v }); applyTheme(v); })),
        h('div.setting-row', h('span', '週の始まり'),
          segmented([[0, '日曜'], [1, '月曜']], s.weekStart, v => app.store.setSettings({ weekStart: v }))),
        h('div.setting-row', h('span', '起動時の表示'),
          segmented([['month', '月'], ['week', '週'], ['day', '日'], ['agenda', 'リスト']], s.defaultView, v => app.store.setSettings({ defaultView: v })))),

      h('section.card',
        h('div.section-label', 'データ'),
        h('p.note', 'データはこの端末のこのアプリの中だけに保存されています。ホーム画面のアイコンを削除するとデータも消えるので、定期的にバックアップしてください。'),
        h('div.btn-col',
          h('button.btn', { onclick: exportData }, 'バックアップを書き出す'),
          h('button.btn.secondary', { onclick: importData }, 'バックアップから復元'),
          h('button.btn.secondary', { onclick: remigrate }, '旧データ（v1）から移行し直す')),
        report && (report.events || report.todos || report.trash) > 0 && h('p.note', `前回の移行: 予定 ${report.events}件・Todo ${report.todos}件・削除済み ${report.trash}件`
          + (report.skipped?.length ? `・変換できなかったもの ${report.skipped.length}件（原本はバックアップに保存済み）` : '')
          + (report.warnings?.length ? `・注意 ${report.warnings.length}件` : ''))),

      h('section.card',
        h('div.section-label', '📱 ホーム画面ウィジェット（Scriptable）'),
        h('p.note', 'Todo画面の「ウィジェットに同期」で、未完了のTodoをウィジェットに送れます。初回だけ下の手順でセットアップしてください。'),
        h('div.btn-row',
          h('button.btn', { onclick: () => copyText(generateWidgetCode(app.store.todoList(), false)) }, 'コードをコピー'),
          h('button.btn.secondary', { onclick: () => copyText(generateWidgetCode(app.store.todoList(), true)) }, 'Todoデータも含める')),
        h('ol.steps',
          h('li', h('b', 'Scriptableをインストール'), h('br'), h('a', { href: 'https://apps.apple.com/jp/app/scriptable/id1405459188' }, 'App Store → Scriptable（無料）')),
          h('li', h('b', 'スクリプトを貼り付け'), h('br'), 'Scriptableを開いて「＋」→ コードを貼り付けて保存（名前：マイプランナー）'),
          h('li', h('b', 'ホーム画面に追加'), h('br'), 'ホーム画面を長押し →「＋」→ Scriptableを検索 → ミディアムを選択'),
          h('li', h('b', 'スクリプトを選択'), h('br'), 'ウィジェットを長押し →「ウィジェットを編集」→「マイプランナー」を選択'))),

      h('section.card',
        h('div.section-label', 'このアプリについて'),
        h('div.setting-row', h('span', 'バージョン'), h('span.muted', VERSION)),
        h('button.btn.secondary.wide', { onclick: async () => { toast('確認しています…'); const r = await checkForUpdate(); if (!r) toast('最新版です'); } }, '更新を確認')),
    );
  }
  return { render, onStoreChange(changed) { if (changed.has('settings')) render(); } };
}
