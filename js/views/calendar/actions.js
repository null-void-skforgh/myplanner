// カレンダー上の操作（移動・削除など）。繰り返し予定なら範囲を尋ねる。

import { app } from '../../app.js';
import { choose } from '../../ui/sheet.js';
import { saveOccurrence, deleteOccurrence, createEvent } from '../../core/event-ops.js';

/** 繰り返し予定の変更範囲を尋ねる。キャンセルなら null */
export async function askScope(occ, verb = '変更') {
  if (!occ.recurring) return 'all';
  return choose(`繰り返し予定の${verb}`, [
    { label: 'この予定のみ', value: 'this' },
    { label: 'これ以降すべて', value: 'following' },
    { label: 'すべての予定', value: 'all' },
  ]);
}

export async function updateOccurrence(occ, patch, label = '予定を変更しました') {
  const scope = await askScope(occ);
  if (!scope) return false;
  app.store.transact(label, tx => saveOccurrence(tx, occ, patch, scope));
  return true;
}

export async function removeOccurrence(occ) {
  const scope = await askScope(occ, '削除');
  if (!scope) return false;
  app.store.transact(`「${occ.event.title || '(タイトルなし)'}」を削除しました`, tx => deleteOccurrence(tx, occ, scope));
  return true;
}

export function addEvent(fields, label) {
  let ev;
  app.store.transact(label || `「${fields.title || '(タイトルなし)'}」を追加しました`, tx => { ev = createEvent(tx, fields); });
  return ev;
}
