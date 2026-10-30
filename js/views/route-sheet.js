// 経路を調べるシート：出発地・行き先・到着時刻を確かめて Yahoo!乗換案内を開く

import { app } from '../app.js';
import { h, clear } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { dtDate, dtTime, makeDT, timeToMin, fmtJP, todayKey, nowDT, addDays } from '../core/date.js';
import { occurrencesInRange } from '../core/events.js';
import { yahooUrl, googleMapsUrl, arriveBy, homeStation, margin, stationFor, recentOrigins, remember } from '../features/transit.js';

/**
 * @param {{title?:string, place?:string, start?:string, allDay?:boolean, prevPlace?:string}} p
 *   start は 'YYYY-MM-DDTHH:mm'（時刻のある予定）。prevPlace は直前の予定の場所（そこから向かう場合の候補）
 */
export function openRouteSheet({ title = '', place = '', start = null, allDay = false, prevPlace = '' } = {}) {
  const arrive = start && !allDay ? arriveBy(start, margin()) : null;
  const fromIn = h('input.input', { type: 'text', placeholder: '出発地（駅名など）', value: homeStation(), autocomplete: 'off', enterkeyhint: 'next' });
  const toIn = h('input.input', { type: 'text', placeholder: '行き先（駅名など）', value: stationFor(place), autocomplete: 'off', enterkeyhint: 'search' });
  const dateIn = h('input.input', { type: 'date', value: arrive ? dtDate(arrive) : todayKey() });
  const timeIn = h('input.input', { type: 'time', step: 60, value: arrive ? dtTime(arrive) : dtTime(nowDT()) });
  let mode = arrive ? 'arrive' : 'depart';
  const seg = h('div.segmented.small', [['arrive', '到着'], ['depart', '出発']].map(([k, l]) =>
    h('button', { 'aria-selected': String(k === mode), onclick: e => { mode = k; for (const b of seg.children) b.setAttribute('aria-selected', String(b === e.currentTarget)); } }, l)));

  const fromChips = h('div.chips');
  const renderChips = () => clear(fromChips, [
    homeStation() && ['🏠 ' + homeStation(), homeStation()],
    prevPlace && ['前の予定（' + prevPlace + '）', stationFor(prevPlace)],
    ...recentOrigins().filter(x => x !== homeStation()).map(x => [x, x]),
  ].filter(Boolean).map(([label, v]) => h('button.chip', { onclick: () => { fromIn.value = v; } }, label)));
  renderChips();

  const values = () => ({ from: fromIn.value, to: toIn.value, dt: dateIn.value && timeIn.value ? makeDT(dateIn.value, timeToMin(timeIn.value)) : null });
  const check = () => {
    const v = values();
    if (!v.from.trim()) { toast('出発地を入れてください（「設定 → 移動」で既定の出発地を決められます）'); fromIn.focus(); return null; }
    if (!v.to.trim()) { toast('行き先を入れてください'); toIn.focus(); return null; }
    remember({ place, to: v.to, from: v.from });
    return v;
  };
  const open = url => { const w = window.open(url, '_blank'); if (!w) location.href = url; };
  const search = () => { const v = check(); if (v) { open(yahooUrl({ ...v, mode })); sheet.close(); } };
  toIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); search(); } });

  const sheet = openSheet({
    title: '🚃 経路',
    content: h('div.form',
      (title || place) && h('div.quick-result',
        h('div.quick-title', title || place),
        h('div.quick-when', [start && !allDay ? `${fmtJP(dtDate(start))} ${+dtTime(start).slice(0, 2)}:${dtTime(start).slice(3)} 開始` : '', place && `📍 ${place}`].filter(Boolean).join('　'))),
      h('div.field', h('div.field-label', '出発地'), fromIn, fromChips),
      h('div.field', h('div.field-label', '行き先'), toIn,
        place && h('p.note.muted', `「${place}」の最寄り駅などに直すと、次からはその駅で調べます。`)),
      h('div.field.row', seg, h('div.dt', dateIn, timeIn)),
      arrive && h('p.note.muted', `開始の${margin()}分前に着く経路を調べます（「設定 → 移動」で変えられます）。`),
      h('button.btn.wide', { onclick: search }, 'Yahoo!乗換案内で調べる'),
      h('button.btn.secondary.wide', { onclick: () => { const v = check(); if (v) { open(googleMapsUrl(v)); sheet.close(); } } }, 'Googleマップで開く（住所・建物名向け）')),
  });
}

/** カレンダーの予定（occurrence）から開く。同じ日の直前の予定の場所も候補にする */
export function openRouteForOcc(occ) {
  const ev = occ.event;
  const day = occ.allDay ? occ.start : dtDate(occ.start);
  const prev = occ.allDay ? null : occurrencesInRange(app.store.eventList(), day, addDays(day, 1), { isVisible: app.store.isCalendarVisible })
    .filter(o => !o.allDay && o.event.location && o.key !== occ.key && o.end <= occ.start && o.event.location !== ev.location)
    .sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  openRouteSheet({ title: ev.title, place: ev.location, start: occ.start, allDay: occ.allDay, prevPlace: prev?.event.location || '' });
}
