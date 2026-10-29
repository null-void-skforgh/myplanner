// 授業の追加シート：曜日・限・科目・教室・週数を選んで、毎週の予定としてまとめて登録する

import { app } from '../app.js';
import { h, clear } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { DAY_LABELS, dayOfWeek, fmtMDW, todayKey, dtDate } from '../core/date.js';
import { addEvent } from './calendar/actions.js';
import { periodsOf, buildClassEvent, lastClassDate, periodLabel, classCalendarId, recentSubjects, DEFAULT_WEEKS } from '../features/classes.js';

const WEEK_DAYS = [1, 2, 3, 4, 5, 6]; // 月〜土

export function openClassAdd({ baseDate } = {}) {
  const s = app.store.state.settings;
  const times = periodsOf(s);
  const from0 = baseDate && baseDate >= todayKey() ? baseDate : todayKey();
  const wd = dayOfWeek(from0);
  const v = { subject: '', room: '', days: [wd === 0 ? 1 : wd], periods: [], from: from0, weeks: s.classWeeks || DEFAULT_WEEKS };

  const subjectIn = h('input.input.title-input', { type: 'text', placeholder: '科目名（例: 連続体の力学）', autocomplete: 'off', enterkeyhint: 'next',
    oninput: e => { v.subject = e.target.value; update(); } });
  const roomIn = h('input.input', { type: 'text', placeholder: '教室（任意）', autocomplete: 'off', enterkeyhint: 'done',
    oninput: e => { v.room = e.target.value; } });

  const recent = recentSubjects();
  const recentChips = recent.length > 0 && h('div.field',
    h('div.field-label', 'これまでの授業'),
    h('div.chips', recent.map(r => h('button.chip', { onclick: () => {
      subjectIn.value = v.subject = r.subject; roomIn.value = v.room = r.room; update();
    } }, r.subject))));

  const dayPicker = h('div.wd-picker');
  const periodPicker = h('div.period-picker');
  const fromIn = h('input.input', { type: 'date', value: v.from, onchange: e => { if (e.target.value) { v.from = e.target.value; update(); } } });
  const weeksOut = h('span.weeks-num');
  const stepWeeks = d => { v.weeks = Math.min(30, Math.max(1, v.weeks + d)); update(); };
  const preview = h('div.quick-result.class-preview');
  const addBtn = h('button.pill-btn.primary', { onclick: submit }, '追加');

  function update() {
    clear(dayPicker, WEEK_DAYS.map(d => h(`button.wd-btn${d === 6 ? '.sat' : ''}`, { 'aria-pressed': String(v.days.includes(d)), onclick: () => {
      v.days = v.days.includes(d) ? (v.days.length > 1 ? v.days.filter(x => x !== d) : v.days) : [...v.days, d];
      update();
    } }, DAY_LABELS[d])));
    clear(periodPicker, times.map(([st, en], i) => {
      const p = i + 1;
      return h('button.period-btn', { 'aria-pressed': String(v.periods.includes(p)), onclick: () => togglePeriod(p) },
        h('span.period-no', `${p}限`), h('span.period-time', `${+st.slice(0, 2)}:${st.slice(3)}`));
    }));
    weeksOut.textContent = `${v.weeks}週`;
    const ok = v.subject.trim() && v.periods.length;
    addBtn.disabled = !ok;
    if (!v.periods.length) { clear(preview, h('div.quick-when', '限を選んでください（2つ選ぶと連続コマ）')); return; }
    const ev = buildClassEvent({ ...v, subject: v.subject || '', periodTimes: times });
    const st = ev.start.slice(11), en = ev.end.slice(11);
    clear(preview,
      h('div.quick-title', v.subject.trim() || '(科目名を入力)'),
      h('div.quick-when', `毎週 ${[...v.days].sort().map(d => DAY_LABELS[d]).join('・')}曜 ${periodLabel(v.periods)}（${+st.slice(0, 2)}:${st.slice(3)}〜${+en.slice(0, 2)}:${en.slice(3)}）`),
      h('div.quick-when', `${fmtMDW(dtDate(ev.start))} 〜 ${fmtMDW(lastClassDate(ev))}・全${ev.rrule.count}回`));
  }

  // 1つ目の限を選んだあとに別の限を押すと、その間をまとめて連続コマにする
  function togglePeriod(p) {
    if (v.periods.includes(p)) v.periods = v.periods.length > 1 && (p === Math.min(...v.periods) || p === Math.max(...v.periods)) ? v.periods.filter(x => x !== p) : [p];
    else if (!v.periods.length) v.periods = [p];
    else {
      const lo = Math.min(p, ...v.periods), hi = Math.max(p, ...v.periods);
      v.periods = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    }
    update();
  }

  function submit() {
    if (!v.subject.trim()) { subjectIn.focus(); return; }
    if (!v.periods.length) return;
    const ev = buildClassEvent({ ...v, periodTimes: times });
    const calendarId = classCalendarId();
    addEvent({ ...ev, calendarId, color: null }, `授業「${ev.title}」を${ev.rrule.count}回分追加しました`);
    if (v.weeks !== s.classWeeks) app.store.setSettings({ classWeeks: v.weeks });
    const d = dtDate(ev.start);
    if (app.router.state.page === 'cal' && d !== app.router.state.date) app.router.go({ date: d });
    sheet.close();
  }

  subjectIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); roomIn.focus(); } });
  roomIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });

  const sheet = openSheet({
    title: '授業を追加',
    headerRight: addBtn,
    content: h('div.form',
      h('div.field', subjectIn),
      recentChips,
      h('div.field', h('div.field-label', '曜日'), dayPicker),
      h('div.field', h('div.field-label', '時限'), periodPicker),
      h('div.field.row', h('span.field-label', '教室'), roomIn),
      h('div.field.row', h('span.field-label', '初回'), fromIn),
      h('div.field.row', h('span.field-label', '週数'),
        h('div.inline-num', h('button.pill-btn', { onclick: () => stepWeeks(-1), 'aria-label': '1週減らす' }, '−'), weeksOut,
          h('button.pill-btn', { onclick: () => stepWeeks(1), 'aria-label': '1週増やす' }, '＋'))),
      preview,
      h('p.note', '毎週くり返す予定として「授業」カレンダーに入ります。休講の日は、その回をタップ →「削除」→「この予定だけ」で消せます。時限の時刻は「設定 → 授業の時間割」で変えられます。')),
  });
  update();
  subjectIn.focus();
}
