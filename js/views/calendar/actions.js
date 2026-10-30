// カレンダー上の操作（移動・削除など）。繰り返し予定なら範囲を尋ねる。

import { app } from '../../app.js';
import { choose } from '../../ui/sheet.js';
import { saveOccurrence, deleteOccurrence, createEvent } from '../../core/event-ops.js';
import { toast } from '../../ui/toast.js';
import { eventReadOnly } from '../../integrations/google-sync.js';

/** Google の読み取り専用の予定（祝日・共有カレンダー・扱えない繰り返し）は変更できない */
function blocked(occ) {
  if (!eventReadOnly(occ.event, app.store.state.calendars)) return false;
  toast('この予定はGoogleカレンダーでしか変更できません');
  return true;
}

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
  if (blocked(occ)) return false;
  const scope = await askScope(occ);
  if (!scope) return false;
  app.store.transact(label, tx => saveOccurrence(tx, occ, patch, scope));
  return true;
}

export async function removeOccurrence(occ) {
  if (blocked(occ)) return false;
  const scope = await askScope(occ, '削除');
  if (!scope) return false;
  app.store.transact(`「${occ.event.title || '(タイトルなし)'}」を削除しました`, tx => deleteOccurrence(tx, occ, scope));
  return true;
}

/** 新しい予定の通知の既定（設定の「新しい予定の通知」。終日の予定は既定なし） */
export function defaultReminders(allDay) {
  const m = app.store.state.settings.defaultReminder;
  return !allDay && Number.isFinite(m) ? [m] : [];
}

export function addEvent(fields, label) {
  if (!fields.reminders) fields = { ...fields, reminders: defaultReminders(!!fields.allDay) };
  let ev;
  app.store.transact(label || `「${fields.title || '(タイトルなし)'}」を追加しました`, tx => { ev = createEvent(tx, fields); });
  return ev;
}
