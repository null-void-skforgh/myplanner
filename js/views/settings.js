// 設定（表示・バックアップ・ウィジェット・バージョン）

import { app } from '../app.js';
import { h, clear } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, choose } from '../ui/sheet.js';
import { applyTheme } from '../ui/theme.js';
import { createStorage, KEYS } from '../core/storage.js';
import { remigrateFromBackup } from '../core/migrate.js';
import { createStore } from '../core/store.js';
import { generateWidgetCode, widgetEvents, sharedFns } from '../features/widget.js';
import { occurrencesInRange } from '../core/events.js';
import { todayKey, addDays } from '../core/date.js';
import { colorOf } from '../app.js';
import { arrangeTodos, dueLabel, isOverdue, WIDGET_ROWS } from '../features/todo-actions.js';
import { checkForUpdate } from '../pwa.js';
import { exportBackup, lastExportLabel } from '../features/backup.js';
import { openIcsExport, importIcs } from './ics-io.js';
import { openCalendarsSheet } from './calendars-sheet.js';
import { sortedCalendars } from '../features/calendars.js';
import { periodsOf, DEFAULT_PERIODS } from '../features/classes.js';
import { isConnected, connect, disconnect, enablePush, status, sendTest, permission, syncSchedule, serverConf } from '../features/server.js';
import { TIMED_PRESETS, reminderLabel } from '../features/notify.js';
import { googleStatus, startGoogleAuth, disconnectGoogle, googleCalendars, syncAll, lastSyncAt, onSyncState, isSyncing } from '../integrations/google.js';
import { openGoogleCalendarPicker } from './google-sheet.js';
import { DEFAULT_MARGIN } from '../features/transit.js';
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

const timeAgo = ms => {
  if (!ms) return 'まだ同期していません';
  const min = Math.round((Date.now() - ms) / 60000);
  return min < 1 ? 'たった今同期しました' : min < 60 ? `${min}分前に同期` : min < 1440 ? `${Math.round(min / 60)}時間前に同期` : `${Math.round(min / 1440)}日前に同期`;
};

/** Google カレンダー（接続・カレンダーの選択・同期） */
function googleCard(rerender) {
  const card = h('section.card', h('div.section-label', '📅 Googleカレンダー'));
  if (!isConnected()) {
    card.append(h('p.note', '先に上の「🔔 通知」でサーバーにつないでください。'));
    return card;
  }
  const body = h('div', h('div.notify-status', h('span.notify-dot'), h('span', '確認しています…')));
  card.append(body);
  const show = st => {
    if (!st.connected) {
      clear(body,
        h('p.note', 'Googleカレンダーの予定をアプリに取り込み、アプリで追加・変更した予定もGoogleに送ります。'),
        h('button.btn.wide', { onclick: async () => {
          try {
            await startGoogleAuth();
            // Google の画面から戻ってきたら確かめる
            const back = async () => {
              if (document.visibilityState !== 'visible') return;
              document.removeEventListener('visibilitychange', back);
              const s2 = await googleStatus().catch(() => null);
              if (s2?.connected) { toast('Googleと接続しました'); rerender(); if (!googleCalendars().length) openGoogleCalendarPicker(); }
            };
            document.addEventListener('visibilitychange', back);
          } catch (e) { toast(e.message === 'google_not_configured' ? 'サーバーにGoogleの設定がまだありません' : `接続できませんでした（${e.message}）`); }
        } }, 'Googleと接続'));
      return;
    }
    const cals = googleCalendars();
    const syncLabel = h('span.muted', isSyncing() ? '同期しています…' : timeAgo(lastSyncAt()));
    const off = onSyncState(running => { if (!syncLabel.isConnected) { off(); return; } syncLabel.textContent = running ? '同期しています…' : timeAgo(lastSyncAt()); });
    clear(body,
      h('div.notify-status', h('span.notify-dot.on'), h('span', st.email ? `${st.email} と接続中` : '接続中')),
      h('button.setting-row.link', { onclick: openGoogleCalendarPicker },
        h('span', '同期するカレンダー'), h('span.muted', cals.length ? `${cals.map(c => c.name).join('・')} ›` : '選んでください ›')),
      h('div.setting-row', syncLabel,
        h('button.pill-btn', { onclick: async () => {
          try { const r = await syncAll({ quiet: false }); toast(r ? `同期しました（受信 ${r.pulled}件・送信 ${r.pushed}件）` + (r.errors.length ? `・失敗 ${r.errors.length}件` : '') : '同期するカレンダーがありません'); }
          catch (e) { toast(`同期できませんでした（${e.message}）`); }
        } }, '今すぐ同期')),
      cals.some(c => c.source.lastError) && h('p.note', '⚠️ ' + cals.map(c => c.source.lastError).filter(Boolean)[0]),
      h('p.note', 'アプリを開いたときと、予定を変えたときに自動で同期します。'),
      h('button.btn.secondary.wide', { onclick: async () => {
        const how = await choose('Googleとの接続を解除', [
          { label: 'アプリから同期中の予定を消す', value: 'remove', danger: true },
          { label: 'アプリのカレンダーとして残す', value: 'keep' },
        ], 'Googleカレンダーの予定はどちらでも消えません。');
        if (!how) return;
        try { await disconnectGoogle(how === 'remove'); toast('Googleとの接続を解除しました'); rerender(); }
        catch (e) { toast(errText(e)); }
      } }, 'Googleとの接続を解除'));
  };
  googleStatus().then(show).catch(e => clear(body, h('p.note', e.message === 'google_not_configured'
    ? 'サーバーにGoogleの設定がまだありません。' : errText(e))));
  return card;
}

/** 移動（乗換案内） */
function moveCard(s) {
  const learned = Object.keys(s.placeStations || {}).length;
  return h('section.card',
    h('div.section-label', '🚃 移動'),
    h('div.setting-row', h('span', '既定の出発地'),
      h('input.input.auto.home-station', { type: 'text', placeholder: '例：東京', value: s.homeStation || '', autocomplete: 'off', enterkeyhint: 'done',
        onchange: e => { app.store.setSettings({ homeStation: e.target.value.trim() }); toast('出発地を保存しました'); } })),
    h('div.setting-row', h('span', '到着の余裕'),
      segmented([[0, 'ちょうど'], [5, '5分前'], [10, '10分前'], [15, '15分前']], s.arriveMargin ?? DEFAULT_MARGIN, v => app.store.setSettings({ arriveMargin: v }))),
    h('p.note', '予定の「🚃 経路」や「移動」タブから、ここの出発地 → 予定の場所へ、開始の数分前に着く電車を Yahoo!乗換案内で調べます。出発地はその場で変えることもできます。'),
    learned > 0 && h('div.setting-row', h('span.muted', `覚えた行き先 ${learned}件（場所 → 駅名）`),
      h('button.pill-btn', { onclick: () => { app.store.setSettings({ placeStations: {} }); toast('覚えた行き先を消しました'); } }, '消す')));
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

/** 「予定」ウィジェットのプレビュー（ミディアムサイズ） */
function eventsWidgetPreview() {
  const now = new Date();
  const evs = widgetEvents(occurrencesInRange(app.store.eventList(), todayKey(), addDays(todayKey(), 2), { isVisible: app.store.isCalendarVisible }), colorOf);
  const d = sharedFns().dayEvents(evs, now, WIDGET_ROWS);
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const row = (e, dim) => h('div.wp-row' + (dim ? '.dim' : ''),
    h('span.wp-bar', { style: { color: e.c } }, '▍'), h('span.wp-time' + (e.now ? '.now' : ''), e.label), h('span.wp-text', e.t), !dim && e.l && h('span.wp-due', e.l));
  return h('div.wp', { 'aria-label': '予定ウィジェットのプレビュー' },
    h('div.wp-head', h('span.wp-title', `📅 今日 ${now.getMonth() + 1}/${now.getDate()}(${WD[now.getDay()]})`),
      h('span.wp-count', d.total ? (d.ended ? `残り ${d.total - d.ended}件` : `${d.total}件`) : '')),
    d.rows.map(e => row(e, false)),
    d.hidden > 0 && h('div.wp-more', `他 ${d.hidden} 件`),
    !d.rows.length && h('div.wp-more', d.total ? '✅ 今日の予定は終わりました' : '今日の予定はありません'),
    d.tomorrow.length > 0 && [h('div.wp-sub', '明日'), d.tomorrow.map(e => row(e, true))]);
}

// 設定の目次（カードの見出しに含まれる言葉 → ボタンの名前）
const NAV = [['表示', '表示'], ['カレンダー', 'カレンダー'], ['通知', '通知'], ['Google', 'Google'], ['移動', '移動'],
  ['授業', '授業'], ['データ', 'データ'], ['ウィジェット', 'ウィジェット'], ['このアプリ', 'アプリ']];

/** 設定の上に固定する目次。押すとそのカードまでスクロールする */
function settingsNav(body) {
  const cards = [...body.querySelectorAll(':scope > section.card')];
  const targets = NAV.map(([key, label]) => [label, cards.find(c => c.querySelector('.section-label')?.textContent.includes(key) && !c.dataset.nav)])
    .filter(([, c]) => c).map(([label, c]) => { c.dataset.nav = label; return [label, c]; });
  // カードの位置（スクロールする枠の中での上端）
  const posOf = c => c.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  const nav = h('nav.settings-nav', { 'aria-label': '設定の目次' }, targets.map(([label, c]) =>
    h('button.chip', { onclick: () => {
      body.scrollTo({ top: posOf(c) - nav.offsetHeight - 8, behavior: 'smooth' });
    } }, label)));
  // 今見ているカードのボタンを目立たせる
  let ticking = false;
  const mark = () => {
    ticking = false;
    const y = body.scrollTop + nav.offsetHeight + 20;
    let cur = targets[0]?.[1];
    for (const [, c] of targets) if (posOf(c) <= y) cur = c;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) cur = targets.at(-1)?.[1];
    [...nav.children].forEach((b, i) => b.classList.toggle('on', targets[i][1] === cur));
    // 目次の横スクロールだけを動かす（ページは動かさない）
    const on = nav.querySelector('.on');
    if (on && (on.offsetLeft < nav.scrollLeft || on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth)) nav.scrollLeft = on.offsetLeft - 16;
  };
  body.onscroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(mark); } };
  requestAnimationFrame(mark);
  return nav;
}

export function mountSettings(page) {
  const body = h('div.page-scroll');
  clear(page, h('header.app-header', h('div.page-title', '設定')), body);

  function render() {
    const s = app.store.state.settings;
    const report = createStorage().get(KEYS.migrationReport, null);
    const keep = body.scrollTop; // 設定を変えて描き直しても、見ていた位置のまま
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

      googleCard(render),

      moveCard(s),

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
        h('div.wp-pair', widgetPreview(), eventsWidgetPreview()),
        h('p.note', 'Todo画面の「ウィジェットに同期」で、未完了のTodoと1週間分の予定をウィジェットに送れます。Todo は★だいじ → 期限が早い順、予定は今日のこれからの予定を時刻順に表示します（空いた行には明日の予定）。'),
        h('p.note', '⚠️ 2.8.0 でウィジェットのコードが新しくなりました。「予定」のウィジェットを使うには「コードをコピー」してScriptableのスクリプトに貼り直してください（1回だけ）。'),
        h('div.btn-row',
          h('button.btn', { onclick: () => copyText(generateWidgetCode(app.store.todoList(), false)) }, 'コードをコピー'),
          h('button.btn.secondary', { onclick: () => copyText(generateWidgetCode(app.store.todoList(), true)) }, 'Todoデータも含める')),
        h('ol.steps',
          h('li', h('b', 'Scriptableをインストール'), h('br'), h('a', { href: 'https://apps.apple.com/jp/app/scriptable/id1405459188' }, 'App Store → Scriptable（無料）')),
          h('li', h('b', 'スクリプトを貼り付け'), h('br'), 'Scriptableを開いて「＋」→ コードを貼り付けて保存（名前：マイプランナー）'),
          h('li', h('b', 'ホーム画面に追加'), h('br'), 'ホーム画面を長押し →「＋」→ Scriptableを検索 → ミディアムを選択'),
          h('li', h('b', 'スクリプトを選択'), h('br'), 'ウィジェットを長押し →「ウィジェットを編集」→ Script で「マイプランナー」を選択'),
          h('li', h('b', '予定のウィジェット（2つ目）'), h('br'), '同じ手順でミディアムをもう1つ追加 →「ウィジェットを編集」→ Script で「マイプランナー」、Parameter に「予定」と入力'))),

      h('section.card',
        h('div.section-label', 'このアプリについて'),
        h('div.setting-row', h('span', 'バージョン'), h('span.muted', VERSION)),
        h('button.btn.secondary.wide', { onclick: async () => { toast('確認しています…'); const r = await checkForUpdate(); if (!r) toast('最新版です'); } }, '更新を確認')),
    );
    body.prepend(settingsNav(body));
    body.scrollTop = keep;
  }
  return { render, onStoreChange(changed) { if (changed.has('settings') || changed.has('calendars') || changed.has('todos')) render(); } };
}
