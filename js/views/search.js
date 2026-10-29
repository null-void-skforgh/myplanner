// 検索（予定・Todo・メモ）

import { app, colorOf } from '../app.js';
import { h, clear, icon } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { todayKey, addDays, fmtJP, fmtMD, parts } from '../core/date.js';
import { occurrencesInRange, startDate, timeRangeLabel } from '../core/events.js';
import { describeRRule } from '../core/recurrence.js';

const norm = s => String(s || '').normalize('NFKC').toLowerCase();

export function openSearch() {
  const input = h('input.input.search-input', { type: 'search', placeholder: '予定・Todo・メモを検索', enterkeyhint: 'search' });
  const results = h('div.search-results');
  let timer;

  const go = date => { sheet.close(); app.router.go({ page: 'cal', view: 'day', date }, { push: true }); };

  function run() {
    const q = norm(input.value.trim());
    if (!q) { clear(results, h('div.empty-state', 'キーワードを入力してください')); return; }
    const words = q.split(/\s+/);
    const hit = (...fields) => { const t = norm(fields.join(' ')); return words.every(w => t.includes(w)); };
    const today = todayKey();
    const { store } = app;

    // 予定：繰り返しは今日以降の次の回（なければ最初の回）
    const evs = store.eventList().filter(e => hit(e.title, e.location, e.notes)).map(e => {
      const next = e.rrule ? occurrencesInRange([e], today, addDays(today, 800))[0] : null;
      const occ = next || occurrencesInRange([e], startDate(e), addDays(startDate(e), 1))[0];
      return occ && { occ, day: startDate(occ) };
    }).filter(Boolean).sort((a, b) => {
      const fa = a.day >= today, fb = b.day >= today;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? (a.day < b.day ? -1 : 1) : (a.day > b.day ? -1 : 1);
    });
    const todos = store.todoList().filter(t => hit(t.text)).sort((a, b) => a.done - b.done);
    const memoLines = store.state.memo.split('\n').map((l, i) => ({ l, i })).filter(x => x.l.trim() && hit(x.l)).slice(0, 30);

    const sections = [];
    if (evs.length) sections.push(h('div.search-section', h('div.section-label', `予定（${evs.length}）`),
      evs.slice(0, 100).map(({ occ, day }) => h(`button.search-item.c${colorOf(occ.event)}`, { onclick: () => { go(day); app.openEventEditor(occ); } },
        h('span.agenda-bar'),
        h('div.agenda-body',
          h('div.agenda-title', occ.event.title || '(タイトルなし)'),
          h('div.agenda-time', `${parts(day).y !== parts(today).y ? parts(day).y + '年 ' : ''}${fmtJP(day)}  ${timeRangeLabel(occ, day)}`,
            occ.recurring ? `  ${describeRRule(occ.event.rrule)}` : ''))))));
    if (todos.length) sections.push(h('div.search-section', h('div.section-label', `Todo（${todos.length}）`),
      todos.map(t => h('button.search-item', { onclick: () => { sheet.close(); app.openTodoEditor(t); } },
        h('span.check' + (t.done ? '.checked' : ''), t.done && icon('check')),
        h('div.agenda-body', h('div.agenda-title' + (t.done ? '.done' : ''), t.text),
          t.due && h('div.agenda-time', `期限 ${fmtMD(t.due)}`))))));
    if (memoLines.length) sections.push(h('div.search-section', h('div.section-label', `メモ（${memoLines.length}）`),
      memoLines.map(({ l }) => h('button.search-item', { onclick: () => { sheet.close(); app.router.go({ page: 'memo' }, { push: true }); } },
        h('div.agenda-body', h('div.agenda-title', l.trim()))))));
    clear(results, sections.length ? sections : h('div.empty-state', '見つかりませんでした'));
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
  const sheet = openSheet({ title: '検索', full: true, content: h('div.search', input, results) });
  run();
  input.focus();
}
