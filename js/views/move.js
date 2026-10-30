// 移動：これからの「場所つきの予定」と、自由な乗換検索

import { app, colorOf } from '../app.js';
import { h, clear } from '../ui/dom.js';
import { todayKey, addDays, dtDate, fmtMDW, fmtTime, nowDT } from '../core/date.js';
import { occurrencesInRange } from '../core/events.js';
import { openRouteSheet, openRouteForOcc } from './route-sheet.js';
import { homeStation } from '../features/transit.js';

const DAYS = 14;

export function mountMove(page) {
  const body = h('div.page-scroll');
  clear(page, h('header.app-header', h('div.page-title', '移動')), body);

  function render() {
    const today = todayKey();
    const now = nowDT();
    const occs = occurrencesInRange(app.store.eventList(), today, addDays(today, DAYS), { isVisible: app.store.isCalendarVisible })
      .filter(o => o.event.location?.trim() && (o.allDay ? o.end > today : o.end > now));
    const byDay = new Map();
    for (const o of occs) {
      const d = o.allDay ? (o.start < today ? today : o.start) : dtDate(o.start);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(o);
    }
    const dayLabel = d => (d === today ? '今日' : d === addDays(today, 1) ? '明日' : '') + ' ' + fmtMDW(d);

    clear(body,
      h('section.card.move-search',
        h('div.section-label', '🚃 乗換を調べる'),
        h('button.btn.wide', { onclick: () => openRouteSheet({}) }, homeStation() ? `${homeStation()} から調べる` : '駅を入れて調べる'),
        !homeStation() && h('p.note', '「設定 → 移動」で既定の出発地（最寄り駅）を入れておくと、毎回入れなくてすみます。')),
      h('div.section-label', `これからの予定（場所あり・${DAYS}日先まで）`),
      occs.length ? [...byDay].map(([d, list]) => h('section.card.move-day',
        h('div.move-day-label', dayLabel(d).trim()),
        list.map(o => h(`button.move-row.c${colorOf(o.event)}`, { onclick: () => openRouteForOcc(o) },
          h('span.move-time', o.allDay ? '終日' : fmtTime(o.start)),
          h('span.move-main', h('span.move-title', o.event.title || '(タイトルなし)'), h('span.move-place', '📍 ' + o.event.location)),
          h('span.move-go', '経路 ›')))))
        : h('div.empty-state', '場所が入った予定はありません。予定の「場所」に建物名や駅名を入れると、ここから経路を調べられます。'));
  }
  return { render, onStoreChange(changed) { if (changed.has('events') || changed.has('settings') || changed.has('calendars')) render(); } };
}
