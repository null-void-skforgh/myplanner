# マイプランナー

iPhone のホーム画面で使うカレンダー・Todo・メモの Web アプリ（GitHub Pages で配信する PWA）。
ビルド不要。ファイルをそのまま push すれば公開される。

## 開発

```sh
npm test          # 単体テスト（Node 20 以上。依存パッケージなし）
npm run serve     # http://localhost:8080 で確認
npm run bump      # デプロイ前に必ず実行（バージョンを上げ、sw.js のキャッシュ一覧を更新）
```

`npm run bump` を忘れると、利用者の画面に「更新があります」が出ず古い版のままになる。
テスト（`tests/pwa.test.js`）が忘れを検出する。

## 構成

```
index.html               画面の骨組み
sw.js                    Service Worker（事前キャッシュ・更新の待機）
manifest.webmanifest / icons/（tools/make-icons.py で生成）
css/                     tokens.css（ライト/ダークの色）ほか画面ごと
js/
  main.js                起動処理
  app.js                 画面間で共有する参照
  pwa.js                 SW 登録と「更新があります」バナー
  core/                  画面に依存しないロジック（すべてテスト対象）
    date.js              日付は 'YYYY-MM-DD'、日時は 'YYYY-MM-DDTHH:mm'（ローカル時刻）
    storage.js           localStorage の唯一の窓口（キーは mp2:*）
    migrate.js           v1 → v2 の移行
    model.js             Event / Todo / Calendar / Settings の形
    store.js             状態・永続化・取り消し／やり直し（変更は必ず transact() 経由）
    recurrence.js        繰り返し（RRULE のサブセット）
    events.js            範囲内の予定の展開・複数日の扱い
    event-ops.js         保存・削除（繰り返しの「この予定のみ／これ以降／すべて」）
  nlp/parse-ja.js        自然文入力の解析
  ui/                    DOM 生成・シート・トースト・ジェスチャー・テーマ・ルーター
  views/                 各画面（calendar/ は月・週・日・リスト）
  features/              Todo 操作、Scriptable ウィジェット、起動時の自動処理
tests/
tools/                   bump-version.mjs, make-icons.py
todo-widget.js           Scriptable 用ウィジェット（v1 と同じ）
```

## データ

- v2 のデータは `mp2:*` キーに保存する。
- v1 のキー（`calItems`, `todos`, `trashedTodos`, `memo` など）は**変更も削除もしない**。
  初回起動時に v2 へ変換し、原本を `mp2:backup:v1` にもコピーする。
  設定画面の「旧データ（v1）から移行し直す」でいつでも作り直せる。
- iOS のホーム画面アプリのデータは Safari とは別に保存される。URL（`/myplanner/`）を変えない限り引き継がれるが、
  アイコンを削除するとデータも消える。設定画面からバックアップ（JSON）を書き出せる。

## 段階2・3に向けた拡張ポイント

| やること | 触る場所 |
|---|---|
| カレンダーの色分け・表示切替 | `state.calendars`（`calendarId` は既に全予定にある）、`store.isCalendarVisible`、設定画面 |
| 詳細な繰り返し | `core/recurrence.js`（`expandDates` と `REPEAT_PRESETS`）、予定編集画面 |
| 場所とメモ | `Event.location` / `Event.notes`（保存済み・検索対象）、予定編集画面に入力欄を追加 |
| .ics 入出力 | Event は RRULE 互換・終日の end は排他なので 1:1 で変換できる。`features/ics.js` を追加 |
| 通知 | `Event.reminders`（空配列で保存済み） |
| Google カレンダー同期 | `Event.source`（provider / externalId / etag）、`updatedAt`、削除は `deletedAt` で印を付けて残す。`js/integrations/` に provider を追加。保存先を IndexedDB に替える場合は `core/storage.js` だけ差し替える |
