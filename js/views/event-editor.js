// 予定の作成・編集シート

import { app, colorOf } from '../app.js';
import { h, icon } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { addDays, dtDate, dtTime, makeDT, timeToMin, diffDays, diffMinutes, addMinutes, todayKey } from '../core/date.js';
import { toggleAllDay } from '../core/events.js';
import { REPEAT_PRESETS, presetOf, describeRRule } from '../core/recurrence.js';
import { COLOR_COUNT } from '../core/model.js';
import { addEvent, updateOccurrence, removeOccurrence } from './calendar/actions.js';

/**
 * @param {object} target  occurrence（既存）または { draft: {allDay,start,end,title?,rrule?} }（新規）
 */
export function openEventEditor(target) {
  const isNew = !!target.draft;
  const occ = isNew ? null : target;
  const src = isNew ? { title: '', color: null, rrule: null, location: '', notes: '', ...target.draft }
    : { ...occ.event, start: occ.start, end: occ.end };
  const v = {
    title: src.title, allDay: !!src.allDay, start: src.start, end: src.end,
    color: isNew ? (src.color ?? 0) : colorOf(occ.event), rrule: src.rrule,
    location: src.location || '', notes: src.notes || '',
  };

  // ── 入力欄 ──
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

  const preset = presetOf(v.rrule);
  const repeatSel = h('select.input', { onchange: e => {
    if (e.target.value === 'custom') return;
    const p = REPEAT_PRESETS.find(p => p.value === e.target.value);
    v.rrule = p.rrule ? structuredClone(p.rrule) : null;
  } },
    REPEAT_PRESETS.map(p => h('option', { value: p.value, selected: p.value === preset }, p.label)),
    preset === 'custom' && h('option', { value: 'custom', selected: true }, describeRRule(v.rrule)));

  const colors = h('div.color-picker', Array.from({ length: COLOR_COUNT }, (_, i) =>
    h(`button.color-dot.c${i}`, { 'aria-label': `色${i + 1}`, 'aria-pressed': String(i === v.color), onclick: e => {
      v.color = i;
      for (const b of colors.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
    } })));

  syncTimes();

  // ── 保存・削除 ──
  const save = async () => {
    if (!validate()) return;
    const fields = { title: v.title.trim(), allDay: v.allDay, start: v.start, end: v.end, color: v.color, rrule: v.rrule,
      location: v.location, notes: v.notes };
    if (isNew) {
      addEvent(fields);
      sheet.close();
      return;
    }
    const before = occ.event;
    const patch = {};
    for (const k of Object.keys(fields)) {
      const cur = k === 'start' ? occ.start : k === 'end' ? occ.end : k === 'color' ? colorOf(before) : before[k];
      if (JSON.stringify(cur ?? null) !== JSON.stringify(fields[k] ?? null)) patch[k] = fields[k];
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
    h('label.field.row', h('span.field-label', icon('repeat', 'icon inline'), '繰り返し'), repeatSel),
    h('div.field', h('div.field-label', '色'), colors),
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

