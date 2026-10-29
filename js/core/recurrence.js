// 繰り返しの展開（RRULE のサブセット）
// 段階2で bySetPos / byMonthDay などを足すときはこのファイルを拡張する。

import { addDays, diffDays, dayOfWeek, parts, makeKey, daysInMonth } from './date.js';

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_ITER = 20000;

/**
 * 基準日 baseKey から rrule に従って並ぶ回の開始日を、[fromKey, toKey) の範囲で返す。
 * count は範囲外の回も含めて数える（RFC 5545 と同じ）。
 */
export function expandDates(baseKey, rrule, fromKey, toKey, exdates = []) {
  if (!rrule) return baseKey >= fromKey && baseKey < toKey ? [baseKey] : [];
  const interval = Math.max(1, rrule.interval || 1);
  const until = rrule.until || null;
  const count = rrule.count || null;
  const ex = new Set(exdates);
  const out = [];
  let n = 0; // 生成した回数（count 用）

  const emit = key => {
    if (until && key > until) return false;
    if (count && n >= count) return false;
    n++;
    if (key >= fromKey && key < toKey && !ex.has(key)) out.push(key);
    return key < toKey;
  };

  const { y: by, m: bm, d: bd } = parts(baseKey);
  const skipTo = count ? 0 : null; // count がなければ範囲の手前まで飛ばせる

  switch (rrule.freq) {
    case 'DAILY': {
      let k = skipTo ?? Math.max(0, Math.floor(diffDays(baseKey, fromKey) / interval));
      for (let i = 0; i < MAX_ITER; i++, k++) if (!emit(addDays(baseKey, k * interval))) break;
      break;
    }
    case 'WEEKLY': {
      const days = (rrule.byDay?.length ? rrule.byDay : [WEEKDAYS[dayOfWeek(baseKey)]])
        .map(d => WEEKDAYS.indexOf(d)).filter(i => i >= 0).sort((a, b) => a - b);
      const week0 = addDays(baseKey, -dayOfWeek(baseKey)); // 基準週の日曜
      let w = skipTo ?? Math.max(0, Math.floor(diffDays(week0, fromKey) / 7 / interval) - 1);
      outer: for (let i = 0; i < MAX_ITER; i++, w++) {
        const ws = addDays(week0, w * 7 * interval);
        for (const wd of days) {
          const key = addDays(ws, wd);
          if (key < baseKey) continue;
          if (!emit(key)) break outer;
        }
      }
      break;
    }
    case 'MONTHLY': {
      const { y: fy, m: fm } = parts(fromKey);
      const nth = (rrule.byDay || []).map(parseByDay).filter(x => x && x.ord);
      let k = skipTo ?? Math.max(0, Math.floor(((fy - by) * 12 + (fm - bm) - 1) / interval));
      outerM: for (let i = 0; i < MAX_ITER; i++, k++) {
        const total = by * 12 + (bm - 1) + k * interval;
        const y = Math.floor(total / 12), m = total % 12 + 1;
        if (nth.length) {
          // 「第2火曜」「最終金曜」など
          const keys = nth.map(x => nthWeekday(y, m, x.ord, x.wd)).filter(Boolean).sort();
          if (!keys.length && makeKey(y, m, 1) >= toKey) break;
          for (const key of keys) {
            if (key < baseKey) continue;
            if (!emit(key)) break outerM;
          }
          continue;
        }
        if (bd > daysInMonth(y, m)) { if (makeKey(y, m, 1) >= toKey) break; continue; }
        if (!emit(makeKey(y, m, bd))) break;
      }
      break;
    }
    case 'YEARLY': {
      let k = skipTo ?? Math.max(0, Math.floor((parts(fromKey).y - by - 1) / interval));
      for (let i = 0; i < MAX_ITER; i++, k++) {
        const y = by + k * interval;
        if (bd > daysInMonth(y, bm)) { if (makeKey(y, 1, 1) >= toKey) break; continue; }
        if (!emit(makeKey(y, bm, bd))) break;
      }
      break;
    }
    default:
      if (baseKey >= fromKey && baseKey < toKey) out.push(baseKey);
  }
  return out;
}

/** 'TU' → {ord:0, wd:2}、'2TU' → {ord:2, wd:2}、'-1FR' → {ord:-1, wd:5} */
export function parseByDay(str) {
  const m = String(str).match(/^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/);
  return m ? { ord: m[1] ? +m[1] : 0, wd: WEEKDAYS.indexOf(m[2]) } : null;
}

/** y年m月の第ord wd曜日（ord<0 は最後から）。存在しなければ null */
export function nthWeekday(y, m, ord, wd) {
  const dim = daysInMonth(y, m);
  if (ord > 0) {
    const first = dayOfWeek(makeKey(y, m, 1));
    const d = 1 + ((wd - first + 7) % 7) + (ord - 1) * 7;
    return d <= dim ? makeKey(y, m, d) : null;
  }
  const last = dayOfWeek(makeKey(y, m, dim));
  const d = dim - ((last - wd + 7) % 7) + (ord + 1) * 7;
  return d >= 1 ? makeKey(y, m, d) : null;
}

/** その日が「第何◯曜日」か（5週目は最終として扱う） */
export function ordinalOf(key) {
  const { y, m, d } = parts(key);
  const ord = Math.ceil(d / 7);
  const isLast = d + 7 > daysInMonth(y, m);
  return { ord, isLast, wd: WEEKDAYS[dayOfWeek(key)] };
}

// ── UI 用の簡易プリセット（段階2で詳細設定 UI を追加予定）──
export const REPEAT_PRESETS = [
  { value: 'none', label: 'なし', rrule: null },
  { value: 'daily', label: '毎日', rrule: { freq: 'DAILY', interval: 1 } },
  { value: 'weekdays', label: '平日（月〜金）', rrule: { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] } },
  { value: 'weekly', label: '毎週', rrule: { freq: 'WEEKLY', interval: 1 } },
  { value: 'biweekly', label: '隔週', rrule: { freq: 'WEEKLY', interval: 2 } },
  { value: 'monthly', label: '毎月', rrule: { freq: 'MONTHLY', interval: 1 } },
  { value: 'yearly', label: '毎年', rrule: { freq: 'YEARLY', interval: 1 } },
];

export function presetOf(rrule) {
  if (!rrule) return 'none';
  const by = (rrule.byDay || []).join(',');
  for (const p of REPEAT_PRESETS) {
    const r = p.rrule;
    if (!r) continue;
    if (r.freq === rrule.freq && (r.interval || 1) === (rrule.interval || 1) && (r.byDay || []).join(',') === by
      && !rrule.until && !rrule.count) return p.value;
  }
  return 'custom';
}

const JP_DAYS = { SU: '日', MO: '月', TU: '火', WE: '水', TH: '木', FR: '金', SA: '土' };
export function describeRRule(rrule) {
  if (!rrule) return '';
  const iv = rrule.interval || 1;
  let s = { DAILY: iv > 1 ? `${iv}日ごと` : '毎日', WEEKLY: iv > 1 ? `${iv}週ごと` : '毎週',
    MONTHLY: iv > 1 ? `${iv}か月ごと` : '毎月', YEARLY: iv > 1 ? `${iv}年ごと` : '毎年' }[rrule.freq] || '繰り返し';
  if (rrule.byDay?.length) {
    s += ' ' + rrule.byDay.map(d => {
      const x = parseByDay(d);
      if (!x) return '';
      const name = JP_DAYS[WEEKDAYS[x.wd]];
      return x.ord > 0 ? `第${x.ord}${name}曜` : x.ord < 0 ? `最終${name}曜` : name;
    }).join('・');
  }
  if (rrule.until) s += `（${rrule.until}まで）`;
  if (rrule.count) s += `（${rrule.count}回）`;
  return s;
}
