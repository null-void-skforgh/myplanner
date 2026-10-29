// 設定（表示・バックアップ・ウィジェット・バージョン）

import { app } from '../app.js';
import { h, clear } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/sheet.js';
import { applyTheme } from '../ui/theme.js';
import { createStorage, KEYS } from '../core/storage.js';
import { remigrateFromBackup } from '../core/migrate.js';
import { createStore } from '../core/store.js';
import { generateWidgetCode } from '../features/widget.js';
import { arrangeTodos, dueLabel, isOverdue, WIDGET_ROWS } from '../features/todo-actions.js';
import { checkForUpdate } from '../pwa.js';
import { exportBackup, lastExportLabel } from '../features/backup.js';
import { openIcsExport, importIcs } from './ics-io.js';
import { openCalendarsSheet } from './calendars-sheet.js';
import { sortedCalendars } from '../features/calendars.js';
import { periodsOf, DEFAULT_PERIODS } from '../features/classes.js';
import { isConnected, connect, disconnect, enablePush, status, sendTest, permission, syncSchedule, serverConf } from '../features/server.js';
import { TIMED_PRESETS, reminderLabel } from '../features/notify.js';
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

/** ウィジェットの見た目のプレビュー（ミディアムサイズ） */
function widgetPreview() {
  const a = arrangeTodos(app.store.todoList(), WIDGET_ROWS);
  return h('div.wp', { 'aria-label': 'ウィジェットのプレビュー' },
    h('div.wp-head', h('span.wp-title', '📋 Todo'), h('span.wp-count', `${a.active.length}件`)),
    a.rows.map(t => h('div.wp-row' + (t.important ? '.imp' : ''),
      h('span.wp-mark', t.important ? '★' : isOverdue(t.due) ? '‼' : '○'),
      h('span.wp-text', t.text),
      h('span.wp-due', dueLabel(t.due, t.start).replace(/まで$/, '')))),
    a.hidden > 0 && h('div.wp-more', `他 ${a.hidden} 件`),
    !a.active.length && h('div.wp-more', '✅ すべて完了！'));
}

const toggle = (checked, onChange) => h('span.switch', h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }), h('span.switch-ui'));

const ERRORS = { bad_code: '接続コードが違います', unauthorized: 'サーバーとの接続が切れています。接続し直してください', http_502: '通知を届けられませんでした。「通知をオンにする」をやり直してください' };
const errText = e => ERRORS[e?.message] || (e?.name === 'AbortError' || e instanceof TypeError ? 'サーバーにつながりませんでした。URLと電波を確かめてください' : `エラー（${e?.message || e}）`);

/** 通知（サーバー接続・許可・毎朝のまとめなど） */
function notifyCard(s, rerender) {
  if (!isConnected()) {
    const url = h('input.input', { type: 'url', placeholder: 'サーバーのURL（https://…workers.dev）', autocomplete: 'off', autocapitalize: 'off' });
    const code = h('input.input', { type: 'text', placeholder: '接続コード', autocomplete: 'off', autocapitalize: 'characters' });
    const btn = h('button.btn', { onclick: async () => {
      if (!url.value.trim() || !code.value.trim()) { toast('URLと接続コードを入れてください'); return; }
      btn.disabled = true; btn.textContent = '接続しています…';
      try { await connect(url.value, code.value); toast('サーバーにつながりました。次に「通知をオンにする」を押してください'); rerender(); }
      catch (e) { toast(errText(e)); btn.disabled = false; btn.textContent = '接続する'; }
    } }, '接続する');
    return h('section.card',
      h('div.section-label', '🔔 通知'),
      h('p.note', '予定の前・Todoの期限・毎朝のまとめを通知します。最初に1回だけ、マイプランナーのサーバーにつないでください。'),
      h('div.btn-col', url, code, btn));
  }

  const st = h('div.notify-status', h('span.notify-dot'), h('span', '確認しています…'));
  const showStatus = me => {
    const perm = permission();
    const on = me?.subscribed && perm === 'granted';
    const next = me?.next ? new Date(me.next) : null;
    clear(st, h('span.notify-dot' + (on ? '.on' : '.warn')),
      h('span', on ? `通知オン・予定 ${me.pending}件` + (next ? `（次: ${next.getMonth() + 1}/${next.getDate()} ${next.getHours()}:${String(next.getMinutes()).padStart(2, '0')}）` : '')
        : perm === 'denied' ? '通知が許可されていません' : '通知はまだオフです'));
    enableBtn.hidden = on;
    testBtn.hidden = !on;
  };
  const enableBtn = h('button.btn', { hidden: true, onclick: async () => {
    try {
      const r = await enablePush();
      if (r === 'ok') { toast('通知をオンにしました'); refresh(); }
      else if (r === 'not-standalone') toast('ホーム画面のアイコンから開いたときだけ、通知をオンにできます');
      else if (r === 'denied') toast('iPhoneの「設定 → 通知 → マイプランナー」で通知を許可してください');
      else toast('このブラウザは通知に対応していません（iOS 16.4 以上が必要です）');
    } catch (e) { toast(errText(e)); }
  } }, '通知をオンにする');
  const testBtn = h('button.btn.secondary', { hidden: true, onclick: async () => {
    try { await sendTest(); toast('テスト通知を送りました'); } catch (e) { toast(errText(e)); }
  } }, 'テスト通知を送る');
  const refresh = () => syncSchedule().catch(() => {}).then(status).then(showStatus).catch(e => { clear(st, h('span.notify-dot.warn'), h('span', errText(e))); enableBtn.hidden = true; });
  refresh();

  return h('section.card',
    h('div.section-label', '🔔 通知'),
    st,
    h('div.btn-col', enableBtn, testBtn),
    h('div.setting-row', h('span', '毎朝のまとめ'),
      h('div.btn-row.tight',
        h('input.input', { type: 'time', value: s.morningTime || '09:00', step: 300, disabled: s.notifyMorning === false,
          onchange: e => e.target.value && app.store.setSettings({ morningTime: e.target.value }) }),
        toggle(s.notifyMorning !== false, v => app.store.setSettings({ notifyMorning: v })))),
    h('p.note.muted', 'その日の予定と、期限のTodo・期限切れのTodoを1つの通知にまとめます。'),
    h('div.setting-row', h('span', '時刻つきTodoの10分前'), toggle(s.notifyTodos !== false, v => app.store.setSettings({ notifyTodos: v }))),
    h('div.setting-row', h('span', '新しい予定の通知'),
      h('select.input.auto', { onchange: e => app.store.setSettings({ defaultReminder: e.target.value === '' ? null : +e.target.value }) },
        h('option', { value: '', selected: s.defaultReminder == null }, 'なし'),
        TIMED_PRESETS.map(m => h('option', { value: m, selected: s.defaultReminder === m }, reminderLabel(m, false))))),
    h('p.note', '予定ごとの通知は、予定の編集画面の「通知」で選べます（カスタムも可）。アプリを開くたびに30日先までの通知を予約し直すので、30日以上開かないとそれより先の通知は届きません。'),
    h('button.btn.secondary.wide', { onclick: async () => {
      if (!await confirmDialog('サーバーとの接続を解除しますか？', '解除する', '通知が届かなくなります。', true)) return;
      await disconnect(); toast('接続を解除しました'); rerender();
    } }, `接続を解除（${new URL(serverConf().url).host}）`));
}

/** 授業の時間割（各時限の開始・終了時刻） */
function classPeriodsCard(s) {
  const periods = periodsOf(s).map(p => [...p]);
  const set = (i, j, val) => {
    if (!val) return;
    periods[i][j] = val;
    app.store.setSettings({ classPeriods: periods.map(p => [...p]) });
  };
  const isDefault = JSON.stringify(periods) === JSON.stringify(DEFAULT_PERIODS);
  return h('section.card',
    h('div.section-label', '📚 授業の時間割'),
    h('div.period-times', periods.map(([st, en], i) => [
      h('span', `${i + 1}限`),
      h('input.input', { type: 'time', value: st, onchange: e => set(i, 0, e.target.value) }),
      h('span.muted', '〜'),
      h('input.input', { type: 'time', value: en, onchange: e => set(i, 1, e.target.value) }),
    ])),
    h('p.note', 'カレンダーの「＋」→「📚 授業」で使う時刻です。変えても、登録済みの授業の時刻は変わりません。'),
    !isDefault && h('button.btn.secondary.wide', { onclick: () => app.store.setSettings({ classPeriods: DEFAULT_PERIODS.map(p => [...p]) }) }, '東大の時刻（105分）に戻す'));
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
        h('div.section-label', 'カレンダー'),
        h('button.setting-row.link', { onclick: openCalendarsSheet },
          h('span', 'カレンダーの管理'), h('span.muted', `${sortedCalendars().length}個 ›`)),
        h('div.setting-row', h('span', '予定の読み込み・書き出し（.ics）'),
          h('div.btn-row.tight', h('button.pill-btn', { onclick: importIcs }, '読み込む'), h('button.pill-btn', { onclick: openIcsExport }, '書き出す'))),
        h('p.note', 'Googleカレンダーの「設定 → インポート/エクスポート」や、他のアプリの .ics ファイルとやり取りできます。')),

      notifyCard(s, render),

      classPeriodsCard(s),

      h('section.card',
        h('div.section-label', 'データ'),
        h('p.note', 'データはこの端末のこのアプリの中だけに保存されています。ホーム画面のアイコンを削除するとデータも消えるので、定期的にバックアップしてください。iCloud Drive に保存するのがおすすめです。'),
        h('div.btn-col',
          h('button.btn', { onclick: () => exportBackup().then(ok => ok && render()) }, 'バックアップを書き出す'),
          h('button.btn.secondary', { onclick: importData }, 'バックアップから復元'),
          h('button.btn.secondary', { onclick: remigrate }, '旧データ（v1）から移行し直す')),
        h('div.setting-row', h('span', 'バックアップのお知らせ'),
          segmented([[7, '7日ごと'], [14, '14日ごと'], [0, 'オフ']], s.backupReminderDays ?? 7, v => app.store.setSettings({ backupReminderDays: v }))),
        h('p.note.muted', lastExportLabel()),
        report && (report.events || report.todos || report.trash) > 0 && h('p.note', `前回の移行: 予定 ${report.events}件・Todo ${report.todos}件・削除済み ${report.trash}件`
          + (report.skipped?.length ? `・変換できなかったもの ${report.skipped.length}件（原本はバックアップに保存済み）` : '')
          + (report.warnings?.length ? `・注意 ${report.warnings.length}件` : ''))),

      h('section.card',
        h('div.section-label', '📱 ホーム画面ウィジェット（Scriptable）'),
        widgetPreview(),
        h('p.note', 'Todo画面の「ウィジェットに同期」で、未完了のTodoをウィジェットに送れます。★だいじなTodoは常に先頭に、残りは期限が早い順に表示されます。初回だけ下の手順でセットアップしてください。'),
        h('p.note', '⚠️ 2.3.0 でウィジェットのコードが新しくなりました。★を表示するには「コードをコピー」してScriptableのスクリプトに貼り直してください（1回だけ）。'),
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
  return { render, onStoreChange(changed) { if (changed.has('settings') || changed.has('calendars') || changed.has('todos')) render(); } };
}
