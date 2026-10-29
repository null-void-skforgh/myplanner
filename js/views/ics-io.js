// .ics の書き出し・読み込み画面

import { app } from '../app.js';
import { h, icon } from '../ui/dom.js';
import { openSheet, choose } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { uid } from '../core/model.js';
import { toICS, parseICS, findExistingByUid } from '../features/ics.js';
import { saveFile } from '../features/backup.js';
import { sortedCalendars, eventCountOf } from '../features/calendars.js';

/** 書き出し：カレンダーごと、またはすべて（iOS の共有シートはタップから直接開く必要があるので、選択肢をボタンで並べる） */
export function openIcsExport() {
  const cals = sortedCalendars();
  const run = (calId) => {
    const events = app.store.eventList().filter(e => !calId || e.calendarId === calId);
    const cal = calId ? app.store.state.calendars[calId] : null;
    const name = cal ? cal.name : 'マイプランナー';
    const file = new File([toICS(events, { calName: name })], `${name}.ics`, { type: 'text/calendar' });
    saveFile(file).then(ok => { if (ok) { sheet.close(); toast(`${events.length}件の予定を書き出しました`); } });
  };
  const sheet = openSheet({
    title: '予定を書き出す（.ics）',
    content: h('div.form',
      h('p.note', 'Googleカレンダーや iPhone のカレンダーに読み込める形式で保存します。'),
      h('button.btn.wide', { onclick: () => run(null) }, icon('download', 'icon inline'), `すべてのカレンダー（${app.store.eventList().length}件）`),
      cals.length > 1 && cals.map(c => h(`button.btn.secondary.wide.cal-export.c${c.color}`, { onclick: () => run(c.id) },
        h('span.cal-dot'), `${c.name}（${eventCountOf(c.id)}件）`))),
  });
}

/** 読み込み：ファイルを選ぶ → 読み込み先を選ぶ → 追加（同じ予定は更新） */
export function importIcs() {
  const input = h('input', { type: 'file', accept: '.ics,text/calendar' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    let parsed;
    try { parsed = parseICS(await f.text()); } catch (e) { console.error(e); toast('ファイルを読み込めませんでした'); return; }
    if (!parsed.events.length) { toast('読み込める予定がありませんでした'); return; }

    const newName = parsed.calName || f.name.replace(/\.ics$/i, '');
    const target = await choose(`${parsed.events.length}件の予定を読み込みます`, [
      { label: `新しいカレンダー「${newName}」を作る`, value: '__new__' },
      ...sortedCalendars().map(c => ({ label: `「${c.name}」に追加`, value: c.id })),
    ], '同じ予定をもう一度読み込んだ場合は、追加せずに内容を更新します。');
    if (!target) return;

    const all = Object.values(app.store.state.events);
    let added = 0, updated = 0;
    app.store.transact(`${parsed.events.length}件の予定を読み込みました`, tx => {
      let calId = target;
      if (target === '__new__') {
        const order = Math.max(0, ...Object.values(app.store.state.calendars).map(c => c.order ?? 0)) + 1;
        const used = new Set(Object.values(app.store.state.calendars).map(c => c.color));
        const color = [6, 2, 3, 4, 1, 5, 7, 8, 9, 0].find(c => !used.has(c)) ?? 6;
        calId = uid('c');
        tx.put('calendars', { id: calId, name: newName, color, visible: true, order, source: { provider: 'ics', name: f.name } });
      }
      const idMap = new Map();
      for (const ev of parsed.events) {
        const existing = findExistingByUid(all, ev.source.externalId);
        if (existing) {
          idMap.set(ev.id, existing.id);
          tx.put('events', { ...existing, ...pick(ev), id: existing.id, calendarId: existing.calendarId, color: existing.color });
          updated++;
        } else {
          idMap.set(ev.id, ev.id);
          tx.put('events', { ...ev, calendarId: calId });
          added++;
        }
      }
      // 「この回だけ変更」の参照先を付け替える
      for (const ev of parsed.events) {
        if (!ev.recurringEventId) continue;
        const id = idMap.get(ev.id), rec = tx.get('events', id);
        if (rec) tx.put('events', { ...rec, recurringEventId: idMap.get(ev.recurringEventId) ?? ev.recurringEventId });
      }
    });
    if (updated) setTimeout(() => toast(`追加 ${added}件・更新 ${updated}件`), 4200);
  });
  input.click();
}

const pick = ev => ({ title: ev.title, allDay: ev.allDay, start: ev.start, end: ev.end, rrule: ev.rrule, exdates: ev.exdates,
  location: ev.location, notes: ev.notes, source: ev.source, deletedAt: null });
