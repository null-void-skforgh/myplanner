// 繰り返しの詳細設定シート（間隔・曜日・第N曜日・終了条件）

import { h, clear } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { addMonths, dayOfWeek, DAY_LABELS } from '../core/date.js';
import { WEEKDAYS, ordinalOf, describeRRule, parseByDay } from '../core/recurrence.js';

const UNITS = [['DAILY', '日'], ['WEEKLY', '週'], ['MONTHLY', 'か月'], ['YEARLY', '年']];

/**
 * @param {object|null} rrule  今の設定
 * @param {string} startDay    予定の開始日（曜日や日付の既定値に使う）
 * @returns {Promise<object|null|undefined>}  undefined はキャンセル、null は「繰り返さない」
 */
export function openRecurrenceEditor(rrule, startDay) {
  const ord = ordinalOf(startDay);
  const baseWd = WEEKDAYS[dayOfWeek(startDay)];
  const r = {
    freq: rrule?.freq || 'WEEKLY',
    interval: rrule?.interval || 1,
    days: new Set(rrule?.freq === 'WEEKLY' && rrule.byDay?.length ? rrule.byDay : [baseWd]),
    // monthly: 'day'（毎月◯日）| 'nth'（第N◯曜）| 'last'（最終◯曜）
    monthMode: rrule?.freq === 'MONTHLY' && rrule.byDay?.length
      ? (parseByDay(rrule.byDay[0])?.ord < 0 ? 'last' : 'nth') : 'day',
    end: rrule?.until ? 'until' : rrule?.count ? 'count' : 'never',
    until: rrule?.until || addMonths(startDay, 3),
    count: rrule?.count || 10,
  };

  const build = () => {
    const out = { freq: r.freq, interval: Math.max(1, Math.min(99, +r.interval || 1)) };
    if (r.freq === 'WEEKLY') out.byDay = WEEKDAYS.filter(d => r.days.has(d));
    if (r.freq === 'MONTHLY' && r.monthMode === 'nth') out.byDay = [ord.ord + baseWd];
    if (r.freq === 'MONTHLY' && r.monthMode === 'last') out.byDay = ['-1' + baseWd];
    if (r.end === 'until' && r.until) out.until = r.until;
    if (r.end === 'count') out.count = Math.max(1, Math.min(999, +r.count || 1));
    return out;
  };

  return new Promise(resolve => {
    let result;
    const body = h('div.form');
    const preview = h('div.quick-result', h('div.quick-when'));

    const render = () => {
      const interval = h('input.input.num', { type: 'number', min: 1, max: 99, value: r.interval, inputmode: 'numeric',
        oninput: e => { r.interval = e.target.value; update(); } });
      const unit = h('select.input', { onchange: e => { r.freq = e.target.value; render(); } },
        UNITS.map(([v, l]) => h('option', { value: v, selected: v === r.freq }, l)));

      const weekly = r.freq === 'WEEKLY' && h('div.field', h('div.field-label', '曜日'),
        h('div.wd-picker', WEEKDAYS.map((d, i) => h('button.wd-btn' + (i === 0 ? '.sun' : i === 6 ? '.sat' : ''), {
          'aria-pressed': String(r.days.has(d)),
          onclick: e => {
            if (r.days.has(d) && r.days.size > 1) r.days.delete(d); else r.days.add(d);
            e.currentTarget.setAttribute('aria-pressed', String(r.days.has(d))); update();
          },
        }, DAY_LABELS[i]))));

      const radio = (name, value, label) => h('label.radio',
        h('input', { type: 'radio', name, checked: (name === 'mm' ? r.monthMode : r.end) === value,
          onchange: () => { if (name === 'mm') r.monthMode = value; else r.end = value; render(); } }), label);

      const wdName = DAY_LABELS[dayOfWeek(startDay)];
      const monthly = r.freq === 'MONTHLY' && h('div.field', h('div.field-label', '繰り返す日'),
        radio('mm', 'day', `毎月${+startDay.slice(8)}日`),
        ord.ord <= 4 && radio('mm', 'nth', `毎月第${ord.ord}${wdName}曜日`),
        ord.isLast && radio('mm', 'last', `毎月最終${wdName}曜日`));

      const ends = h('div.field', h('div.field-label', '終了'),
        radio('end', 'never', 'なし'),
        h('div.radio-row', radio('end', 'until', '日付'),
          r.end === 'until' && h('input.input', { type: 'date', value: r.until, min: startDay, onchange: e => { r.until = e.target.value; update(); } })),
        h('div.radio-row', radio('end', 'count', '回数'),
          r.end === 'count' && h('span.inline-num', h('input.input.num', { type: 'number', min: 1, max: 999, value: r.count, inputmode: 'numeric',
            oninput: e => { r.count = e.target.value; update(); } }), '回')));

      clear(body,
        h('div.field.row', h('span.field-label', '間隔'), h('div.dt', interval, unit, h('span.dt-sep', 'ごと'))),
        weekly, monthly, ends, preview);
      update();
    };
    const update = () => { preview.firstChild.textContent = describeRRule(build()); };

    const sheet = openSheet({
      title: '繰り返しの設定',
      headerRight: h('button.pill-btn.primary', { onclick: () => { result = build(); sheet.close(); } }, '完了'),
      content: body,
      onClose: () => resolve(result),
    });
    render();
  });
}
