// 予定の作成・編集シート

import { app } from '../app.js';
import { h, icon, clear } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { addDays, dtDate, dtTime, makeDT, timeToMin, diffDays, diffMinutes, addMinutes, todayKey } from '../core/date.js';
import { toggleAllDay, startDate } from '../core/events.js';
import { REPEAT_PRESETS, presetOf, describeRRule } from '../core/recurrence.js';
import { COLOR_COUNT, COLOR_NAMES } from '../core/model.js';
import { addEvent, updateOccurrence, removeOccurrence } from './calendar/actions.js';
import { openRecurrenceEditor } from './recurrence-editor.js';
import { sortedCalendars, defaultCalendarId } from '../features/calendars.js';

const FIELDS = ['title', 'allDay', 'start', 'end', 'calendarId', 'color', 'rrule', 'location', 'notes'];

/** 地図アプリで場所を開く URL（iPhone ではマップが開く） */
export const mapUrl = q => `https://maps.apple.com/?q=${encodeURIComponent(q)}`;

/**
 * @param {object} target  occurrence（既存）または { draft: {allDay,start,end,title?,rrule?} }（新規）
 */
export function openEventEditor(target) {
  const isNew = !!target.draft;
  const occ = isNew ? null : target;
  const src = isNew
    ? { title: '', color: null, rrule: null, location: '', notes: '', calendarId: defaultCalendarId(), ...target.draft }
    : { ...occ.event, start: occ.start, end: occ.end };
  const v = {
    title: src.title, allDay: !!src.allDay, start: src.start, end: src.end,
    calendarId: app.store.state.calendars[src.calendarId] ? src.calendarId : 'default',
    color: src.color ?? null, rrule: src.rrule ?? null,
    location: src.location || '', notes: src.notes || '',
  };

  // ── タイトル・日時 ──
  const titleIn = h('input.input.title-input', { type: 'text', placeholder: 'タイトル', value: v.title, enterkeyhint: 'done',
    oninput: e => { v.title = e.target.value; } });
  const allDayIn = h('input', { type: 'checkbox', checked: v.allDay, onchange: e => {
    Object.assign(v, toggleAllDay(v, e.target.checked, 9)); v.allDay = e.target.checked; syncTimes();
  } });
  const sDate = h('input.input', { type: 'date' });
  const sTime = h('input.input', { type: 'time', step: 300 });
  const eDate = h('input.input', { type: 'date' });
  const eTime = h('input.input', { type: 'time', step: 300 });
  const err = h('div.form-error');

  const syncTimes = () => {
    if (v.allDay) {
      sDate.value = v.start; eDate.value = addDays(v.end, -1);
    } else {
      sDate.value = dtDate(v.start); sTime.value = dtTime(v.start);
      eDate.value = dtDate(v.end); eTime.value = dtTime(v.end);
    }
    sTime.hidden = eTime.hidden = v.allDay;
    validate();
    renderRepeat();
  };
  const validate = () => {
    const ok = v.end > v.start;
    err.textContent = ok ? '' : '終了は開始より後にしてください';
    return ok;
  };
  // 開始を動かしたら長さを保ったまま終了も動かす
  const onStart = () => {
    if (!sDate.value) return;
    if (v.allDay) {
      const len = diffDays(v.start, v.end);
      v.start = sDate.value; v.end = addDays(v.start, len);
    } else {
      const len = diffMinutes(v.start, v.end);
      const t = timeToMin(sTime.value) ?? timeToMin(dtTime(v.start));
      v.start = makeDT(sDate.value, t); v.end = addMinutes(v.start, len);
    }
    syncTimes();
  };
  const onEnd = () => {
    if (!eDate.value) return;
    if (v.allDay) v.end = addDays(eDate.value, 1);
    else v.end = makeDT(eDate.value, timeToMin(eTime.value) ?? timeToMin(dtTime(v.end)));
    syncTimes();
  };
  sDate.addEventListener('change', onStart); sTime.addEventListener('change', onStart);
  eDate.addEventListener('change', onEnd); eTime.addEventListener('change', onEnd);

  // ── 繰り返し ──
  const repeatWrap = h('div.repeat-wrap');
  const renderRepeat = () => {
    const preset = presetOf(v.rrule);
    const sel = h('select.input', { onchange: async e => {
      const val = e.target.value;
      if (val === 'edit') {
        const r = await openRecurrenceEditor(v.rrule, startDate(v));
        if (r !== undefined) v.rrule = r;
        renderRepeat();
        return;
      }
      const p = REPEAT_PRESETS.find(p => p.value === val);
      if (p) v.rrule = p.rrule ? structuredClone(p.rrule) : null;
      renderRepeat();
    } },
      REPEAT_PRESETS.map(p => h('option', { value: p.value, selected: p.value === preset }, p.label)),
      preset === 'custom' && h('option', { value: 'custom', selected: true }, describeRRule(v.rrule)),
      h('option', { value: 'edit' }, 'カスタム…'));
    clear(repeatWrap, sel);
  };

  // ── カレンダー・色 ──
  const calSel = h('select.input', { onchange: e => { v.calendarId = e.target.value; renderColors(); } },
    sortedCalendars().map(c => h('option', { value: c.id, selected: c.id === v.calendarId }, c.name)));
  const colors = h('div.color-picker');
  const renderColors = () => {
    const calColor = app.store.state.calendars[v.calendarId]?.color ?? 0;
    clear(colors,
      h(`button.color-dot.cal-default.c${calColor}`, { 'aria-label': 'カレンダーの色', title: 'カレンダーの色', 'aria-pressed': String(v.color == null),
        onclick: () => { v.color = null; renderColors(); } }),
      Array.from({ length: COLOR_COUNT }, (_, i) =>
        h(`button.color-dot.c${i}`, { 'aria-label': COLOR_NAMES[i], 'aria-pressed': String(i === v.color),
          onclick: () => { v.color = i; renderColors(); } })));
  };
  renderColors();

  // ── 場所・メモ ──
  const mapLink = h('a.pill-btn', { target: '_blank', rel: 'noopener' }, '地図');
  const locIn = h('input.input', { type: 'text', placeholder: '場所', value: v.location, enterkeyhint: 'done', autocomplete: 'off',
    oninput: e => { v.location = e.target.value; syncMap(); } });
  const syncMap = () => { mapLink.hidden = !v.location.trim(); mapLink.href = mapUrl(v.location.trim()); };
  syncMap();
  const notesIn = h('textarea.input.notes-input', { placeholder: 'メモ', rows: 3, value: v.notes, oninput: e => { v.notes = e.target.value; } });

  syncTimes();

  // ── 保存・削除 ──
  const save = async () => {
    if (!validate()) return;
    const fields = { title: v.title.trim(), allDay: v.allDay, start: v.start, end: v.end, calendarId: v.calendarId,
      color: v.color, rrule: v.rrule, location: v.location.trim(), notes: v.notes };
    if (isNew) {
      addEvent(fields);
      sheet.close();
      return;
    }
    const before = { ...occ.event, start: occ.start, end: occ.end };
    const patch = {};
    for (const k of FIELDS) {
      if (JSON.stringify(before[k] ?? null) !== JSON.stringify(fields[k] ?? null)) patch[k] = fields[k];
    }
    if (!Object.keys(patch).length) { sheet.close(); return; }
    // 時刻を変えたときは start/end を両方渡す
    if ('start' in patch || 'end' in patch || 'allDay' in patch) Object.assign(patch, { start: v.start, end: v.end, allDay: v.allDay });
    if (await updateOccurrence(occ, patch, `「${fields.title || '(タイトルなし)'}」を保存しました`)) sheet.close();
  };

  const content = h('div.form',
    h('div.field', titleIn),
    h('label.field.row', h('span.field-label', '終日'), h('span.switch', allDayIn, h('span.switch-ui'))),
    h('div.field.row', h('span.field-label', '開始'), h('div.dt', sDate, sTime)),
    h('div.field.row', h('span.field-label', '終了'), h('div.dt', eDate, eTime)),
    err,
    h('div.field.row', h('span.field-label', icon('repeat', 'icon inline'), '繰り返し'), repeatWrap),
    h('div.field.row', h('span.field-label', 'カレンダー'), calSel),
    h('div.field', h('div.field-label', '色'), colors),
    h('div.field.row.loc-row', locIn, mapLink),
    h('div.field', notesIn),
    !isNew && h('button.btn.danger.wide', { onclick: async () => { if (await removeOccurrence(occ)) sheet.close(); } }, '予定を削除'),
  );

  const sheet = openSheet({
    title: isNew ? '新しい予定' : '予定の編集',
    content,
    headerRight: h('button.pill-btn.primary', { onclick: save }, isNew ? '追加' : '保存'),
  });
  titleIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });
  if (isNew && !v.title) titleIn.focus();
}

/** 新規作成の既定（今日なら次の正時から1時間、それ以外は 9:00） */
export function defaultDraft(day) {
  const today = todayKey();
  const now = new Date();
  const startMin = day === today ? Math.min(23, now.getHours() + 1) * 60 : 9 * 60;
  return { allDay: false, start: makeDT(day, startMin), end: makeDT(day, startMin + 60) };
}
