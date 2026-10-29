// 予定の保存・削除（繰り返し予定の「この予定のみ／これ以降／すべて」を含む）
// どれも store.transact() の tx を受け取る。

import { addDays, diffDays } from './date.js';
import { newEvent, uid } from './model.js';
import { startDate, shiftTimes } from './events.js';

/** scope: 'this' | 'following' | 'all' */
export function saveOccurrence(tx, occ, patch, scope = 'all') {
  const base = tx.get('events', occ.event.id);
  if (!base) return;
  if (!base.rrule) { tx.put('events', { ...base, ...patch }); return; }

  const baseDate = startDate(base);
  if (scope === 'following' && occ.occDate === baseDate) scope = 'all';

  if (scope === 'all') {
    // 編集した回の日付から基準日への差だけずらして、シリーズの基準に戻す
    const back = diffDays(occ.occDate, baseDate);
    const moved = { ...base, ...patch };
    Object.assign(moved, shiftTimes(moved, back));
    tx.put('events', moved);
    return;
  }

  if (scope === 'this') {
    tx.put('events', { ...base, exdates: [...new Set([...(base.exdates || []), occ.occDate])] });
    tx.put('events', newEvent({ ...base, start: occ.start, end: occ.end, ...patch, id: uid('e'), rrule: null, exdates: [],
      recurringEventId: base.id, createdAt: Date.now() }));
    return;
  }

  // following: 元のシリーズを前日で打ち切り、この回から新しいシリーズを始める
  const rest = { ...base.rrule }; delete rest.count;
  tx.put('events', { ...base, rrule: { ...base.rrule, until: addDays(occ.occDate, -1), count: undefined } });
  tx.put('events', newEvent({ ...base, start: occ.start, end: occ.end, ...patch, id: uid('e'), rrule: patch.rrule === undefined ? rest : patch.rrule,
    exdates: (base.exdates || []).filter(d => d >= occ.occDate), createdAt: Date.now() }));
}

export function deleteOccurrence(tx, occ, scope = 'all') {
  const base = tx.get('events', occ.event.id);
  if (!base) return;
  const tomb = () => tx.put('events', { ...base, deletedAt: Date.now() });
  if (!base.rrule || scope === 'all') return tomb();
  if (scope === 'this') {
    tx.put('events', { ...base, exdates: [...new Set([...(base.exdates || []), occ.occDate])] });
    return;
  }
  if (occ.occDate <= startDate(base)) return tomb();
  tx.put('events', { ...base, rrule: { ...base.rrule, until: addDays(occ.occDate, -1), count: undefined } });
}

export function createEvent(tx, fields) {
  const ev = newEvent(fields);
  tx.put('events', ev);
  return ev;
}
