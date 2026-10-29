// 日付ユーティリティ
// 日付キー: 'YYYY-MM-DD'、日時: 'YYYY-MM-DDTHH:mm'（端末ローカル時刻）
// 日付文字列を new Date() でパースするのはこのファイルだけに限定する。

export const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_MS = 86400000;

export const pad2 = n => String(n).padStart(2, '0');

/** 'YYYY-M-D' / 'YYYY-MM-DD' / 'YYYY/M/D' を 'YYYY-MM-DD' に正規化。不正なら null */
export function normalizeKey(str) {
  if (str == null) return null;
  const m = String(str).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

export function daysInMonth(y, m /* 1-12 */) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parts(key) {
  return { y: +key.slice(0, 4), m: +key.slice(5, 7), d: +key.slice(8, 10) };
}

export function makeKey(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Date（ローカル）→ 'YYYY-MM-DD' */
export function toKey(date) {
  return makeKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** 'YYYY-MM-DD' → ローカル 0:00 の Date */
export function keyToDate(key) {
  const { y, m, d } = parts(key);
  return new Date(y, m - 1, d);
}

const toUtcDays = key => { const { y, m, d } = parts(key); return Date.UTC(y, m - 1, d) / DAY_MS; };
const fromUtcDays = n => { const dt = new Date(n * DAY_MS); return makeKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); };

export const todayKey = (now = new Date()) => toKey(now);
export const addDays = (key, n) => fromUtcDays(toUtcDays(key) + n);
/** b - a（日数） */
export const diffDays = (a, b) => toUtcDays(b) - toUtcDays(a);
export const dayOfWeek = key => new Date(toUtcDays(key) * DAY_MS).getUTCDay();

export function startOfWeek(key, weekStart = 0) {
  return addDays(key, -((dayOfWeek(key) - weekStart + 7) % 7));
}
export const startOfMonth = key => key.slice(0, 8) + '01';

/** 月を加算（日は月末にクランプ） */
export function addMonths(key, n) {
  const { y, m, d } = parts(key);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12 + 1;
  return makeKey(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

// ── 時刻 ──
export const isDateTime = s => typeof s === 'string' && s.length === 16 && s[10] === 'T';
export const dtDate = dt => dt.slice(0, 10);
export const dtTime = dt => dt.slice(11, 16);

/** 'HH:mm' → 分。不正なら null */
export function timeToMin(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}
export const minToTime = min => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

/** 日付キー + 分（範囲外は日付を繰り上げ/繰り下げ） */
export function makeDT(key, minutes) {
  const dayShift = Math.floor(minutes / 1440);
  const m = minutes - dayShift * 1440;
  return `${addDays(key, dayShift)}T${minToTime(m)}`;
}
export const dtMinutes = dt => timeToMin(dtTime(dt));
export const addMinutes = (dt, n) => makeDT(dtDate(dt), dtMinutes(dt) + n);
/** b - a（分） */
export const diffMinutes = (a, b) => diffDays(dtDate(a), dtDate(b)) * 1440 + dtMinutes(b) - dtMinutes(a);

export const nowDT = (now = new Date()) => `${toKey(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

// ── 表示用 ──
export const fmtMD = key => `${+key.slice(5, 7)}/${+key.slice(8, 10)}`;
export const fmtMDW = key => `${fmtMD(key)}(${DAY_LABELS[dayOfWeek(key)]})`;
export const fmtJP = key => `${+key.slice(5, 7)}月${+key.slice(8, 10)}日(${DAY_LABELS[dayOfWeek(key)]})`;
export const fmtYM = key => `${key.slice(0, 4)}年${+key.slice(5, 7)}月`;
export const fmtTime = dt => { const t = dtTime(dt); return `${+t.slice(0, 2)}:${t.slice(3)}`; };
