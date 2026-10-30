// iCalendar (.ics) の書き出し・読み込み（RFC 5545 のよく使われる範囲）
// 予定の形（RRULE 互換・終日の end は排他）がそのまま対応するので、変換はほぼ 1:1。

import { addDays, makeKey, pad2, dtDate, dtTime } from '../core/date.js';
import { newEvent } from '../core/model.js';

const PRODID = '-//myplanner//JA';

// ── 書き出し ──────────────────────────────────────────

const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);

/** 75 オクテットで折り返す（マルチバイト文字の途中では切らない） */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', len = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > limit) { out.push(cur); cur = ''; len = 0; limit = 74; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const icsDate = key => key.replace(/-/g, '');
const icsDateTime = dt => `${icsDate(dtDate(dt))}T${dtTime(dt).replace(':', '')}00`;
const utcStamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function rruleToIcs(r) {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay?.length) parts.push(`BYDAY=${r.byDay.join(',')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${icsDate(r.until)}`);
  return parts.join(';');
}

/** 東京など夏時間のないタイムゾーン用の VTIMEZONE（それ以外は TZID だけ付ける） */
function vtimezone(tz) {
  if (tz !== 'Asia/Tokyo') return [];
  return ['BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE'];
}

/**
 * @param {object[]} events
 * @param {{calName?:string, tz?:string, now?:number}} opts
 */
export function toICS(events, { calName = 'マイプランナー', tz = localTimeZone(), now = Date.now() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`, `X-WR-TIMEZONE:${tz}`, ...vtimezone(tz)];
  for (const ev of events) {
    if (ev.deletedAt) continue;
    const uid = ev.source?.provider === 'ics' && ev.source.externalId ? ev.source.externalId : `${ev.id}@myplanner`;
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utcStamp(now)}`);
    if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`, `DTEND;VALUE=DATE:${icsDate(ev.end)}`);
    else lines.push(`DTSTART;TZID=${tz}:${icsDateTime(ev.start)}`, `DTEND;TZID=${tz}:${icsDateTime(ev.end)}`);
    lines.push(`SUMMARY:${esc(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${esc(ev.notes)}`);
    if (ev.rrule) lines.push(`RRULE:${rruleToIcs(ev.rrule)}`);
    if (ev.rrule && ev.exdates?.length) {
      lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${ev.exdates.map(icsDate).join(',')}`
        : `EXDATE;TZID=${tz}:${ev.exdates.map(d => icsDateTime(`${d}T${dtTime(ev.start)}`)).join(',')}`);
    }
    if (ev.updatedAt) lines.push(`LAST-MODIFIED:${utcStamp(ev.updatedAt)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const localTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'; } catch { return 'Asia/Tokyo'; } };

// ── 読み込み ──────────────────────────────────────────

const unesc = s => s.replace(/\\([\\,;nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

/** 1行 → { name, params, value } */
function parseLine(line) {
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  for (const p of ps) { const [k, ...v] = p.split('='); params[k.toUpperCase()] = v.join('=').replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value };
}

/** タイムゾーン tz での壁時計の時刻 → 端末ローカルの 'YYYY-MM-DDTHH:mm' */
export function zonedToLocal(y, mo, d, h, mi, tz) {
  let utc = Date.UTC(y, mo - 1, d, h, mi);
  if (tz) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const offsetAt = t => {
        const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t;
      };
      // 2回反復して夏時間の境目にも対応
      utc -= offsetAt(utc);
      utc = Date.UTC(y, mo - 1, d, h, mi) - offsetAt(utc);
    } catch { /* 未知の TZID は端末の時刻として扱う */ return `${makeKey(y, mo, d)}T${pad2(h)}:${pad2(mi)}`; }
  } else {
    return `${makeKey(y, mo, d)}T${pad2(h)}:${pad2(mi)}`;
  }
  return toLocalDT(utc);
}

const toLocalDT = ms => { const t = new Date(ms); return `${makeKey(t.getFullYear(), t.getMonth() + 1, t.getDate())}T${pad2(t.getHours())}:${pad2(t.getMinutes())}`; };

/** DTSTART などの値 → { allDay, value }（値は 'YYYY-MM-DD' か 'YYYY-MM-DDTHH:mm'） */
export function parseDateValue(value, params) {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (params.VALUE === 'DATE' || h == null) return { allDay: true, value: `${y}-${mo}-${d}` };
  if (z) return { allDay: false, value: toLocalDT(Date.UTC(+y, +mo - 1, +d, +h, +mi)) };
  return { allDay: false, value: zonedToLocal(+y, +mo, +d, +h, +mi, params.TZID || null) };
}

/** 'P1DT2H30M' / 'PT45M' / 'P1W' → 分 */
function parseDuration(s) {
  const m = s.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * ((+m[2] || 0) * 7 * 1440 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0));
}

const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
export function parseRRule(value) {
  const kv = Object.fromEntries(value.split(';').map(p => { const [k, v] = p.split('='); return [k.toUpperCase(), v]; }));
  if (!FREQS.includes(kv.FREQ)) return null;
  const r = { freq: kv.FREQ, interval: kv.INTERVAL ? Math.max(1, +kv.INTERVAL) : 1 };
  if (kv.BYDAY) r.byDay = kv.BYDAY.split(',').map(s => s.trim().toUpperCase()).filter(s => /^[+-]?\d?(SU|MO|TU|WE|TH|FR|SA)$/.test(s)).map(s => s.replace(/^\+/, ''));
  if (kv.BYSETPOS && r.byDay?.length === 1 && !/\d/.test(r.byDay[0])) r.byDay = [kv.BYSETPOS + r.byDay[0]];
  if (kv.COUNT) r.count = +kv.COUNT;
  if (kv.UNTIL) { const u = parseDateValue(kv.UNTIL, {}); if (u) r.until = u.value.slice(0, 10); }
  if (r.byDay && !r.byDay.length) delete r.byDay;
  return r;
}

function addMinutesDT(dt, n) {
  const [d, t] = dt.split('T');
  const [h, mi] = t.split(':').map(Number);
  const total = h * 60 + mi + n;
  const days = Math.floor(total / 1440);
  const rem = total - days * 1440;
  return `${addDays(d, days)}T${pad2(Math.floor(rem / 60))}:${pad2(rem % 60)}`;
}

/**
 * @returns {{ calName: string|null, events: object[], skipped: number }}
 *   events は newEvent() の形。source = { provider:'ics', externalId: UID }
 */
export function parseICS(text) {
  const raw = text.replace(/\r\n[ \t]|\n[ \t]/g, '').split(/\r?\n/);
  let calName = null, cur = null, depth = 0, skipped = 0;
  const vevents = [];
  for (const line of raw) {
    if (!line) continue;
    const p = parseLine(line);
    if (p.name === 'BEGIN') {
      if (p.value === 'VEVENT' && depth === 1) cur = { props: [] };
      depth++;
      continue;
    }
    if (p.name === 'END') {
      depth--;
      if (p.value === 'VEVENT' && cur) { vevents.push(cur); cur = null; }
      continue;
    }
    if (cur) cur.props.push(p);
    else if (depth === 1 && p.name === 'X-WR-CALNAME') calName = unesc(p.value);
  }

  const now = Date.now();
  const masters = new Map(), overrides = [];
  const events = [];
  for (const ve of vevents) {
    const get = n => ve.props.find(p => p.name === n);
    const all = n => ve.props.filter(p => p.name === n);
    const ds = get('DTSTART');
    const start = ds && parseDateValue(ds.value, ds.params);
    if (!start || get('STATUS')?.value === 'CANCELLED' && !get('RECURRENCE-ID')) { skipped++; continue; }
    let end;
    const de = get('DTEND'), du = get('DURATION');
    if (de) end = parseDateValue(de.value, de.params)?.value;
    else if (du) {
      const min = parseDuration(du.value);
      end = start.allDay ? addDays(start.value, Math.max(1, Math.round((min ?? 1440) / 1440))) : addMinutesDT(start.value, min ?? 0);
    }
    if (!end) end = start.allDay ? addDays(start.value, 1) : start.value;
    if (start.allDay && end.length > 10) end = addDays(end.slice(0, 10), 1);
    if (!start.allDay && end.length === 10) end = `${end}T00:00`;
    // 長さ0や終了が開始より前のものは、終日なら1日・時間指定なら1時間にする
    if (end <= start.value) end = start.allDay ? addDays(start.value, 1) : addMinutesDT(start.value, 60);
    const rr = get('RRULE');
    const exdates = all('EXDATE').flatMap(p => p.value.split(',').map(v => parseDateValue(v, p.params)?.value.slice(0, 10)).filter(Boolean));
    const uid = get('UID')?.value || null;
    const ev = newEvent({
      title: unesc(get('SUMMARY')?.value ?? ''),
      allDay: start.allDay, start: start.value, end,
      location: unesc(get('LOCATION')?.value ?? ''),
      notes: unesc(get('DESCRIPTION')?.value ?? ''),
      rrule: rr ? parseRRule(rr.value) : null,
      exdates,
      source: { provider: 'ics', externalId: uid },
      createdAt: now, updatedAt: now,
    }, now);
    const rid = get('RECURRENCE-ID');
    if (rid) {
      const occ = parseDateValue(rid.value, rid.params);
      overrides.push({ uid, occDate: occ?.value.slice(0, 10), ev, cancelled: get('STATUS')?.value === 'CANCELLED' });
      continue;
    }
    if (uid) masters.set(uid, ev);
    events.push(ev);
  }
  // 「この回だけ変更」は、元のシリーズに除外日を足して単独の予定にする
  for (const o of overrides) {
    const master = masters.get(o.uid);
    if (master && o.occDate) master.exdates = [...new Set([...master.exdates, o.occDate])];
    if (o.cancelled) continue;
    o.ev.rrule = null;
    o.ev.source = { provider: 'ics', externalId: `${o.uid}#${o.occDate}` };
    if (master) o.ev.recurringEventId = master.id;
    events.push(o.ev);
  }
  return { calName, events, skipped };
}

/** 読み込み済みの予定（同じ UID）を探す */
export function findExistingByUid(allEvents, uid) {
  if (!uid) return null;
  // このアプリで書き出したもの（UID = 予定ID@myplanner）は元の予定を指す
  const own = uid.endsWith('@myplanner') ? uid.slice(0, -'@myplanner'.length) : null;
  return allEvents.find(e => !e.deletedAt && (e.source?.externalId === uid || (own && e.id === own))) || null;
}

