// 画面どうしで共有するもの（循環 import を避けるため、実体は main.js で入れる）
//   app.store   : core/store.js
//   app.router  : ui/router.js
//   app.openEventEditor(occOrDraft) / app.openQuickAdd(opts) / app.openTodoEditor(todo) / app.openSearch()

export const app = {
  store: null,
  router: null,
  openEventEditor: null,
  openQuickAdd: null,
  openTodoEditor: null,
  openSearch: null,
};

/** 予定の色番号（予定 → カレンダー → 0 の順） */
export function colorOf(ev) {
  if (ev.color != null) return ev.color;
  return app.store?.state.calendars[ev.calendarId]?.color ?? 0;
}
