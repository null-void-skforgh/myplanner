// 自然文でのすばやい追加（「明日15時 歯医者」など）

import { app } from '../app.js';
import { h, clear } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { parseJa } from '../nlp/parse-ja.js';
import { fmtJP, fmtTime, addDays, dtDate } from '../core/date.js';
import { describeRRule } from '../core/recurrence.js';
import { addEvent } from './calendar/actions.js';
import { addTodo } from '../features/todo-actions.js';
import { defaultCalendarId } from '../features/calendars.js';

const EXAMPLES = ['明日15時 歯医者', '金曜 18-20時 飲み会', '来週月曜 終日 出張', '毎週火曜 10時 ゼミ', '11/3〜11/5 旅行'];

/** @param {{baseDate?:string, mode?:'event'|'todo'}} opts */
export function openQuickAdd({ baseDate, mode = 'event' } = {}) {
  let kind = mode;
  const input = h('input.input.quick-input', { type: 'text', placeholder: '例: 明日15時 歯医者', enterkeyhint: 'done', autocomplete: 'off' });
  const preview = h('div.quick-preview');
  const seg = h('div.segmented.small', [['event', '予定'], ['todo', 'Todo']].map(([k, label]) =>
    h('button', { 'aria-selected': String(k === kind), onclick: e => {
      kind = k; for (const b of seg.children) b.setAttribute('aria-selected', String(b === e.currentTarget)); update();
    } }, label)));

  const parse = () => parseJa(input.value, { baseDate });

  function update() {
    const r = parse();
    if (!input.value.trim()) {
      clear(preview, h('div.quick-hint', '日時とタイトルを続けて入力できます'),
        h('div.chips', EXAMPLES.map(ex => h('button.chip', { onclick: () => { input.value = ex; update(); input.focus(); } }, ex))));
      return;
    }
    const when = kind === 'todo'
      ? (r.hasDate ? `期限 ${fmtJP(dtDate(r.start))}${r.hasTime ? ' ' + fmtTime(r.start) : ''}` : '期限なし')
      : r.allDay
        ? (addDays(r.start, 1) === r.end ? `${fmtJP(r.start)} 終日` : `${fmtJP(r.start)} 〜 ${fmtJP(addDays(r.end, -1))}`)
        : `${fmtJP(dtDate(r.start))} ${fmtTime(r.start)}〜${dtDate(r.end) !== dtDate(r.start) ? fmtJP(dtDate(r.end)) + ' ' : ''}${fmtTime(r.end)}`;
    clear(preview,
      h('div.quick-result',
        h('div.quick-title', r.title || '(タイトルなし)'),
        h('div.quick-when', when),
        kind === 'event' && r.rrule && h('div.quick-when', describeRRule(r.rrule))),
      r.tokens.length > 0 && h('div.chips', r.tokens.map(t => h('span.chip.static', t))));
  }

  function submit() {
    const r = parse();
    if (!r.title && !input.value.trim()) return;
    if (kind === 'todo') {
      addTodo({ text: r.title || input.value.trim(), due: r.hasDate ? dtDate(r.start) : null, start: r.hasTime ? r.start.slice(11) : null });
    } else {
      addEvent({ title: r.title, allDay: r.allDay, start: r.start, end: r.end, rrule: r.rrule, color: null, calendarId: defaultCalendarId() });
      const d = dtDate(r.start);
      if (d !== app.router.state.date && app.router.state.page === 'cal') app.router.go({ date: d });
    }
    sheet.close();
  }

  function details() {
    const r = parse();
    sheet.close();
    if (kind === 'todo') app.openTodoEditor({ draft: { text: r.title, due: r.hasDate ? dtDate(r.start) : baseDate || null, start: r.hasTime ? r.start.slice(11) : null } });
    else app.openEventEditor({ draft: { title: r.title, allDay: r.allDay, start: r.start, end: r.end, rrule: r.rrule } });
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });

  const sheet = openSheet({
    title: 'すばやく追加',
    headerRight: h('button.pill-btn.primary', { onclick: submit }, '追加'),
    content: h('div.form', seg, input, preview, h('button.btn.secondary.wide', { onclick: details }, '詳細を入力して追加…')),
  });
  update();
  // iOS はタップ処理の中で同期的に focus しないとキーボードが出ない
  input.focus();
}
