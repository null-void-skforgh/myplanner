// 自然文入力の解析（例:「明日15時 歯医者」「10/30 15-17時 ゼミ」「来週月曜 終日 旅行」「毎週火曜 10時 授業」）
// UI に依存しない純粋関数。

import { addDays, addMonths, dayOfWeek, makeKey, normalizeKey, parts, daysInMonth, makeDT, todayKey, diffDays } from '../core/date.js';
import { WEEKDAYS } from '../core/recurrence.js';

const WD = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };
const WD_RE = '([日月火水木金土])曜日?';
const DEFAULT_DURATION = 60;
const WEEKDAYS_MF = ['MO', 'TU', 'WE', 'TH', 'FR'];

/** 全角英数字・記号を半角に */
export function toHalfWidth(s) {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ：／－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[〜～]/g, '〜').replace(/　/g, ' ');
}

const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 「三時」「十二月」のように時・分・日・月の直前にある漢数字だけを数字にする */
function kanjiToNum(s) {
  return s.replace(/[一二三四五六七八九]?十[一二三四五六七八九]?(?=[時分日月])|[一二三四五六七八九](?=[時分日月])/g, m => {
    if (m.includes('十')) { const [a, b] = m.split('十'); return String((a ? KANJI_NUM[a] : 1) * 10 + (b ? KANJI_NUM[b] : 0)); }
    return String(KANJI_NUM[m]);
  });
}

/** 指定曜日の次の日付（today が同じ曜日なら today） */
const nextWeekday = (today, wd) => addDays(today, (wd - dayOfWeek(today) + 7) % 7);

const PM_PRE = ['午後', 'PM', 'pm', '夕方'];
const AM_PRE = ['午前', 'AM', 'am', '朝'];
/** 時刻 → 分。guess=true のとき前置きなしの 1〜7時は午後とみなす（「3時」→15:00） */
function toMin(pre, h, mi, half, guess) {
  h = +h; let min = mi != null ? +mi : 0;
  if (half) min = 30;
  if (PM_PRE.includes(pre) || ((pre === '夜' || pre === '晩') && h >= 5)) { if (h < 12) h += 12; }
  else if (AM_PRE.includes(pre)) { if (h === 12) h = 0; }
  else if (!pre && guess && h >= 1 && h <= 7) h += 12;
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * @param {string} input
 * @param {{today?:string, baseDate?:string}} ctx  baseDate: 日付の指定がないときに使う日（選択中の日）
 * @returns {{title, allDay, start, end, rrule, hasDate, hasTime, tokens:string[]}}
 */
export function parseJa(input, ctx = {}) {
  const today = ctx.today || todayKey();
  const { y: ty, m: tm } = parts(today);
  let s = ' ' + kanjiToNum(toHalfWidth(String(input))) + ' ';
  const tokens = [];
  /** 正規表現に一致した部分を取り除いて fn に渡す。名前付きグループ pre は残す。 */
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    const keep = m.groups?.pre ?? '';
    tokens.push(m[0].slice(keep.length).trim());
    s = s.slice(0, m.index) + keep + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  let date = null, endDate = null, allDay = false, rrule = null;
  let sMin = null, eMin = null, dur = null;

  // ── 繰り返し ──
  take(/毎日/, () => { rrule = { freq: 'DAILY', interval: 1 }; });
  take(/平日(?:毎日)?/, () => { rrule = { freq: 'WEEKLY', interval: 1, byDay: WEEKDAYS_MF }; });
  take(new RegExp('(毎週|隔週)の?(?:' + WD_RE + ')?'), m => {
    rrule = { freq: 'WEEKLY', interval: m[1] === '隔週' ? 2 : 1 };
    if (m[2]) { rrule.byDay = [WEEKDAYS[WD[m[2]]]]; date = nextWeekday(today, WD[m[2]]); }
  });
  take(/毎月(?:(\d{1,2})日)?/, m => {
    rrule = { freq: 'MONTHLY', interval: 1 };
    if (m[1]) {
      let k = +m[1] <= daysInMonth(ty, tm) ? makeKey(ty, tm, +m[1]) : null;
      if (!k || k < today) k = normalizeKey(addMonths(makeKey(ty, tm, 1), 1).slice(0, 8) + m[1]);
      if (k) date = k;
    }
  });
  take(/毎年/, () => { rrule = { freq: 'YEARLY', interval: 1 }; });

  // ── 日付 ──
  const absDate = (y, m, d) => {
    const key = normalizeKey(`${y ?? ty}-${m}-${d}`);
    if (!key) return null;
    // 年の指定がなく 30日以上過去なら来年とみなす
    if (y == null && diffDays(key, today) > 30) return normalizeKey(`${ty + 1}-${m}-${d}`);
    return key;
  };
  const DATE_ABS = '(?:(\\d{4})[/年-])?(\\d{1,2})[/月](\\d{1,2})日?';
  // 日付の範囲（複数日の終日予定）: 10/30〜11/2, 10月30日から11月2日まで, 10/30-11/2
  take(new RegExp(DATE_ABS + '\\s*(?:〜|~|-|から)\\s*(?:(\\d{1,2})[/月])?(\\d{1,2})日?(?:まで)?(?![\\d:時])'), m => {
    const a = absDate(m[1], m[2], m[3]);
    if (!a) return false;
    let b = normalizeKey(`${a.slice(0, 4)}-${m[4] ?? m[2]}-${m[5]}`);
    if (!b) return false;
    if (b < a) b = addMonths(b, m[4] ? 12 : 1);
    date = a; endDate = b; allDay = true;
  }) ||
  take(new RegExp(DATE_ABS), m => { const k = absDate(m[1], m[2], m[3]); if (!k) return false; date = k; }) ||
  take(/今日|きょう|本日/, () => { date = today; }) ||
  take(/明後日|あさって/, () => { date = addDays(today, 2); }) ||
  take(/明日|あした|あす/, () => { date = addDays(today, 1); }) ||
  take(/(\d{1,3})日後/, m => { date = addDays(today, +m[1]); }) ||
  take(new RegExp('(再来週|来週|今週)の?' + WD_RE), m => {
    // 週は月曜始まりとして数える（「来週日曜」= 来週月曜から6日後）
    const monday = addDays(today, -((dayOfWeek(today) + 6) % 7));
    const weeks = { 今週: 0, 来週: 1, 再来週: 2 }[m[1]];
    date = addDays(monday, weeks * 7 + (WD[m[2]] + 6) % 7);
  }) ||
  take(/再来週|来週/, m => {
    const monday = addDays(today, -((dayOfWeek(today) + 6) % 7));
    date = addDays(monday, m[0] === '来週' ? 7 : 14);
  }) ||
  take(/来月(\d{1,2})日/, m => { date = normalizeKey(addMonths(makeKey(ty, tm, 1), 1).slice(0, 8) + m[1]); if (!date) return false; }) ||
  take(new RegExp('(?<pre>^|[^\\d毎])' + WD_RE), m => { date = nextWeekday(today, WD[m[2]]); }) ||
  take(/(?<pre>^|[^\d/月])(\d{1,2})日(?![後間中])/, m => {
    let k = normalizeKey(`${ty}-${tm}-${m[2]}`);
    if (k && k < today) k = normalizeKey(addMonths(makeKey(ty, tm, 1), 1).slice(0, 8) + m[2]);
    if (!k) return false;
    date = k;
  });

  // ── 終日 ──
  take(/終日|一日中|1日中/, () => { allDay = true; });

  // ── 長さ（「1時間」を時刻と取り違えないよう先に取る）──
  take(/(\d+(?:\.\d+)?)時間(半)?/, m => { dur = Math.round(+m[1] * 60) + (m[2] ? 30 : 0); }) ||
  take(/(\d{1,3})分間/, m => { dur = +m[1]; });

  // ── 時刻 ──
  const PRE = '(午前|午後|朝|夕方|夜|晩|AM|PM|am|pm)?\\s*';
  const HM = '(\\d{1,2})(?:([:時])(\\d{2})分?|時(半)?)?';
  // 範囲: 15時〜17時 / 15:00-17:30 / 15-17時 / 15時から17時まで
  take(new RegExp(PRE + HM + '\\s*(?:〜|~|-|から)\\s*' + PRE + HM + '(?:まで)?'), m => {
    const [all, p1, h1, sep1, m1, half1, p2, h2, sep2, m2, half2] = m;
    if (!/[時:]/.test(all)) return false;
    const a = toMin(p1, h1, m1, half1, sep1 !== ':');
    let b = toMin(p2 || p1, h2, m2, half2, sep2 !== ':');
    if (a == null || b == null) return false;
    // 「22時〜2時」のように午後補正すると逆転する場合は、補正なしで日またぎとみなす
    if (b <= a) { b = toMin(p2, h2, m2, half2, false); if (b <= a) b += 1440; }
    sMin = a; eMin = b;
  }) ||
  take(new RegExp(PRE + '(\\d{1,2})(?:([:時])(\\d{2})分?|時(半)?|(時))'), m => {
    const v = toMin(m[1], m[2], m[4], m[5], m[3] !== ':');
    if (v == null) return false;
    sMin = v;
  });
  if (sMin != null && dur == null && eMin == null) take(/(\d{1,3})分/, m => { dur = +m[1]; });

  const hasDate = !!date;
  const hasTime = sMin != null && !allDay;
  let d = date || ctx.baseDate || today;
  // 「平日」で開始日が週末なら次の月曜へ
  if (rrule?.byDay === WEEKDAYS_MF && !hasDate) {
    const wd = dayOfWeek(d);
    if (wd === 0 || wd === 6) d = addDays(d, wd === 6 ? 2 : 1);
  }

  let start, end;
  if (hasTime) {
    start = makeDT(d, sMin);
    end = makeDT(d, eMin ?? sMin + (dur ?? DEFAULT_DURATION));
  } else {
    allDay = true;
    start = d;
    end = addDays(endDate || d, 1);
  }
  if (rrule?.byDay === WEEKDAYS_MF) rrule = { ...rrule, byDay: [...WEEKDAYS_MF] };

  const title = s.replace(/\s+/g, ' ').trim()
    .replace(/^(?:に|で|から|の|は|、|,)\s*/, '').replace(/\s*(?:に|で|の|、|,|〜|まで)$/, '').trim();

  return { title, allDay, start, end, rrule, hasDate, hasTime, tokens };
}
