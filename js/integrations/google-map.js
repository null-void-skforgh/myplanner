// Google カレンダーの予定 ⇄ マイプランナーの予定 の変換（純粋関数）
// 時刻は端末のタイムゾーンで 'YYYY-MM-DDTHH:mm' にそろえる。

import { pad2, makeKey, dtDate, dtTime, addDays } from '../core/date.js';
import { parseRRule, parseDateValue, localTimeZone } from '../features/ics.js';

const PALETTE = ['#7F77DD', '#D4537E', '#3aabbb', '#4caf7d', '#E8923A', '#8e6bbf', '#4a7fd4', '#d94a4a', '#b59b1c', '#7d7c8a'];

/** Google のカレンダー色 → いちばん近いアプリの色番号 */
export function nearestColor(hex) {
  const rgb = h => { const m = String(h || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m ? m.slice(1).map(x => parseInt(x, 16)) : null; };
  const c = rgb(hex);
  if (!c) return 6;
  let best = 0, bd = Infinity;
  PALETTE.forEach((p, i) => {
    const q = rgb(p);
    const d = (c[0] - q[0]) ** 2 * 0.3 + (c[1] - q[1]) ** 2 * 0.59 + (c[2] - q[2]) ** 2 * 0.11;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** RFC3339 → 端末ローカルの 'YYYY-MM-DDTHH:mm' */
export function isoToLocal(iso) {
  const t = new Date(iso);
  return `${makeKey(t.getFullYear(), t.getMonth() + 1, t.getDate())}T${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
}

/** 'YYYY-MM-DDTHH:mm'（端末ローカル）→ '2026-11-03T13:00:00+09:00' */
export function localToIso(dt) {
  const [y, m, d] = dtDate(dt).split('-').map(Number);
  const [hh, mi] = dtTime(dt).split(':').map(Number);
  const off = -new Date(y, m - 1, d, hh, mi).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${dt}:00${sign}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}`;
}

/** Google の説明文（HTML のことがある）→ ふつうの文章 */
export function htmlToText(s) {
  if (!s || !/[<&]/.test(s)) return s || '';
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** アプリで扱える RRULE か（扱えないものは読み取り専用で取り込む） */
export function supportedRRule(value, startKey) {
  const kv = Object.fromEntries(value.split(';').map(p => { const [k, v] = p.split('='); return [k.toUpperCase(), v || '']; }));
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'WKST', 'BYSETPOS', 'BYMONTHDAY', 'BYMONTH']);
  if (Object.keys(kv).some(k => !known.has(k))) return false;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(kv.FREQ)) return false;
  // 開始日と同じ日・月の指定だけなら、指定なしと同じ
  if (kv.BYMONTHDAY && kv.BYMONTHDAY !== String(+startKey.slice(8, 10))) return false;
  if (kv.BYMONTH && kv.BYMONTH !== String(+startKey.slice(5, 7))) return false;
  if (kv.BYSETPOS && (kv.BYDAY || '').split(',').length !== 1) return false;
  // 月ごとの「毎週◯曜」（序数なし）は扱えない
  if (kv.FREQ === 'MONTHLY' && kv.BYDAY && !kv.BYSETPOS && kv.BYDAY.split(',').some(d => !/\d/.test(d))) return false;
  if (kv.FREQ === 'YEARLY' && kv.BYDAY) return false;
  return true;
}

/**
 * Google の予定 → アプリの予定の項目（id・calendarId・source などは呼び出し側で付ける）
 * @returns {{fields:object, readOnly:boolean, useDefault:boolean, originalDate:string|null}}
 */
export function fromGoogle(g) {
  const allDay = !!g.start?.date;
  const start = allDay ? g.start.date : isoToLocal(g.start.dateTime);
  let end = allDay ? (g.end?.date || addDays(start, 1)) : isoToLocal(g.end?.dateTime || g.start.dateTime);
  if (end <= start) end = allDay ? addDays(start, 1) : start;
  let rrule = null, readOnly = false;
  const exdates = [];
  for (const line of g.recurrence || []) {
    const m = line.match(/^([A-Z]+)([^:]*):(.*)$/);
    if (!m) continue;
    const [, name, paramStr, value] = m;
    if (name === 'RRULE') {
      if (rrule || !supportedRRule(value, start.slice(0, 10))) readOnly = true;
      const r = parseRRule(value);
      if (r) rrule = r; else readOnly = true;
    } else if (name === 'EXDATE') {
      const params = Object.fromEntries(paramStr.split(';').filter(Boolean).map(p => p.split('=')));
      for (const v of value.split(',')) { const d = parseDateValue(v, params); if (d) exdates.push(d.value.slice(0, 10)); }
    } else readOnly = true; // RDATE / EXRULE
  }
  const ov = g.reminders?.overrides || [];
  const fields = {
    title: g.summary || '',
    allDay, start, end,
    location: g.location || '',
    notes: htmlToText(g.description),
    rrule,
    exdates: [...new Set(exdates)].sort(),
    reminders: g.reminders?.useDefault ? [] : [...new Set(ov.filter(o => o.method !== 'email').map(o => o.minutes))].sort((a, b) => a - b),
  };
  const os = g.originalStartTime;
  const originalDate = os ? (os.date || isoToLocal(os.dateTime).slice(0, 10)) : null;
  return { fields, readOnly, useDefault: !!g.reminders?.useDefault, originalDate };
}

const icsDate = key => key.replace(/-/g, '');
const utcStamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** アプリの rrule → Google に送る RRULE 行 */
export function rruleLine(r, ev) {
  const parts = [`FREQ=${r.freq}`];
  if ((r.interval || 1) > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay?.length) parts.push(`BYDAY=${r.byDay.join(',')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (r.until) {
    // 時刻のある予定の UNTIL は UTC の日時で書く（RFC 5545）
    if (ev.allDay) parts.push(`UNTIL=${icsDate(r.until)}`);
    else { const [y, m, d] = r.until.split('-').map(Number); parts.push(`UNTIL=${utcStamp(new Date(y, m - 1, d, 23, 59, 59).getTime())}`); }
  }
  return 'RRULE:' + parts.join(';');
}

/** アプリの予定 → Google に送る本文 */
export function toGoogle(ev, { tz = localTimeZone() } = {}) {
  const body = {
    summary: ev.title || '',
    location: ev.location || '',
    description: ev.notes || '',
    status: 'confirmed',
    start: ev.allDay ? { date: ev.start } : { dateTime: localToIso(ev.start), timeZone: tz },
    end: ev.allDay ? { date: ev.end } : { dateTime: localToIso(ev.end), timeZone: tz },
  };
  if (ev.rrule) {
    // Google 側で変更された回（exceptionDates）は EXDATE にしない（その回の予定が消えてしまうため）
    const skip = new Set(ev.source?.exceptionDates || []);
    const ex = (ev.exdates || []).filter(d => !skip.has(d));
    body.recurrence = [rruleLine(ev.rrule, ev),
      ...ex.map(d => (ev.allDay ? `EXDATE;VALUE=DATE:${icsDate(d)}` : `EXDATE;TZID=${tz}:${icsDate(d)}T${dtTime(ev.start).replace(':', '')}00`))];
  }
  const rem = ev.reminders || [];
  body.reminders = rem.length
    // Google は「開始の何分前」が 0 以上のものだけ。終日の「当日 9:00」（負の値）は送らずアプリにだけ残す
    ? { useDefault: false, overrides: rem.filter(m => m >= 0 && m <= 40320).slice(0, 5).map(minutes => ({ method: 'popup', minutes })) }
    : { useDefault: !!ev.source?.useDefault, ...(ev.source?.useDefault ? {} : { overrides: [] }) };
  return body;
}
