// v1（単一 index.html 時代）→ v2 のデータ移行
// 旧キーは一切変更・削除しない。原本は mp2:backup:v1 にもそのままコピーする。

import { normalizeKey, timeToMin, makeDT, addDays } from './date.js';
import { newEvent, newTodo, DEFAULT_CALENDARS, DEFAULT_SETTINGS } from './model.js';
import { KEYS, LEGACY_KEYS, SCHEMA_VERSION } from './storage.js';

const REPEAT_MAP = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' };
const DEFAULT_DURATION = 60;

function safeParse(raw, fallback) {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** 旧予定 1件 → v2 Event（変換できなければ null） */
export function convertLegacyEvent(dateKey, item, now) {
  if (!item || typeof item !== 'object' || (item.type && item.type !== 'event')) return null;
  const sMin = timeToMin(item.start), eMin = timeToMin(item.end);
  let allDay = false, start, end;
  if (sMin == null && eMin == null) {
    allDay = true; start = dateKey; end = addDays(dateKey, 1);
  } else if (sMin != null && eMin == null) {
    start = makeDT(dateKey, sMin); end = makeDT(dateKey, sMin + DEFAULT_DURATION);
  } else if (sMin == null) {
    start = makeDT(dateKey, Math.max(0, eMin - DEFAULT_DURATION)); end = makeDT(dateKey, eMin);
  } else {
    start = makeDT(dateKey, sMin);
    // 終了 < 開始 は日またぎとみなす。同時刻は 1時間に。
    end = makeDT(dateKey, eMin > sMin ? eMin : eMin < sMin ? eMin + 1440 : sMin + DEFAULT_DURATION);
  }
  const color = Number.isInteger(item.color) && item.color >= 0 && item.color < 6 ? item.color : 1; // v1 は6色
  const freq = REPEAT_MAP[item.repeat];
  const created = typeof item.id === 'number' && item.id > 1e12 ? item.id : now;
  return newEvent({
    id: 'e' + (item.id ?? Math.random().toString(36).slice(2)),
    title: String(item.text ?? ''),
    allDay, start, end, color,
    rrule: freq ? { freq, interval: 1 } : null,
    createdAt: created, updatedAt: now,
  }, now);
}

function convertLegacyTodo(t, index, now, report) {
  if (!t || typeof t !== 'object') { report.skipped.push({ kind: 'todo', value: t }); return null; }
  let due = null;
  if (t.due) {
    due = normalizeKey(t.due);
    if (!due) report.warnings.push(`Todo「${t.text}」の期限 "${t.due}" を解釈できず、期限なしにしました`);
  }
  const todo = newTodo({
    id: 't' + (t.id ?? index),
    text: String(t.text ?? ''),
    done: !!t.done,
    due,
    start: timeToMin(t.start) != null ? t.start : null,
    end: timeToMin(t.end) != null ? t.end : null,
    // 旧アプリは新しい順に unshift していたので、並び順を createdAt で再現する
    createdAt: now - index,
    updatedAt: now,
    archivedAuto: t.archivedAuto,
  }, now);
  if (t.due && !due) todo.dueRaw = t.due;
  return todo;
}

/**
 * 純粋関数：旧データ（生文字列）→ v2 データ
 * @param {Record<string,string|null>} legacy  LEGACY_KEYS の生の値
 */
export function migrateV1(legacy, now = Date.now()) {
  const report = { events: 0, todos: 0, trash: 0, skipped: [], warnings: [] };
  const events = {}, todos = {}, trash = {};

  const calItems = safeParse(legacy.calItems, {});
  for (const [rawKey, items] of Object.entries(calItems || {})) {
    const key = normalizeKey(rawKey);
    if (!key || !Array.isArray(items)) { report.skipped.push({ kind: 'calItems', key: rawKey, value: items }); continue; }
    for (const item of items) {
      const ev = convertLegacyEvent(key, item, now);
      if (!ev) { report.skipped.push({ kind: 'event', key: rawKey, value: item }); continue; }
      while (events[ev.id]) ev.id += '_';
      events[ev.id] = ev; report.events++;
    }
  }

  (safeParse(legacy.todos, []) || []).forEach((t, i) => {
    const td = convertLegacyTodo(t, i, now, report);
    if (!td) return;
    while (todos[td.id]) td.id += '_';
    todos[td.id] = td; report.todos++;
  });

  (safeParse(legacy.trashedTodos, []) || []).forEach((t, i) => {
    const td = convertLegacyTodo(t, i, now, report);
    if (!td) return;
    td.trashedAt = typeof t.trashedAt === 'number' ? t.trashedAt : now - i;
    td.id = td.id + '_trash' + i;
    trash[td.id] = td; report.trash++;
  });

  return {
    events, todos, trash,
    memo: legacy.memo ?? '',
    calendars: structuredClone(DEFAULT_CALENDARS),
    settings: { ...DEFAULT_SETTINGS },
    meta: {
      lastArchiveDate: legacy.lastArchiveDate ?? null,
      lastReportWeek: legacy.lastReportWeek ?? null,
      migratedAt: now,
    },
    report,
  };
}

export function readLegacy(storage) {
  const out = {};
  for (const k of LEGACY_KEYS) out[k] = storage.getRaw(k);
  return out;
}

export function hasLegacyData(legacy) {
  return ['calItems', 'todos', 'trashedTodos', 'memo'].some(k => legacy[k] != null);
}

export function writeV2(storage, data) {
  storage.set(KEYS.events, data.events);
  storage.set(KEYS.todos, data.todos);
  storage.set(KEYS.trash, data.trash);
  storage.set(KEYS.calendars, data.calendars);
  storage.set(KEYS.settings, data.settings);
  storage.set(KEYS.meta, data.meta);
  storage.setRaw(KEYS.memo, data.memo);
  storage.set(KEYS.migrationReport, data.report);
  storage.set(KEYS.schema, SCHEMA_VERSION);
}

/**
 * 起動時に呼ぶ。v2 データがなければ旧データから移行する。
 * @returns {null | report}  移行を実行したときだけ report を返す
 */
export function runMigration(storage, now = Date.now()) {
  if (storage.get(KEYS.schema, null) != null) return null;
  const legacy = readLegacy(storage);
  if (hasLegacyData(legacy) && storage.getRaw(KEYS.backupV1) == null) {
    storage.set(KEYS.backupV1, { savedAt: now, data: legacy });
  }
  const data = migrateV1(legacy, now);
  writeV2(storage, data);
  return hasLegacyData(legacy) ? data.report : null;
}

/** 設定画面の「旧データから再移行」用（現在の v2 データは上書きされる） */
export function remigrateFromBackup(storage, now = Date.now()) {
  const backup = storage.get(KEYS.backupV1, null);
  const legacy = backup?.data ?? readLegacy(storage);
  const data = migrateV1(legacy, now);
  const settings = storage.get(KEYS.settings, null);
  if (settings) data.settings = { ...data.settings, ...settings };
  writeV2(storage, data);
  return data.report;
}
