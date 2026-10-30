// Google カレンダー：同期するカレンダーを選ぶシート

import { app } from '../app.js';
import { h, clear, icon } from '../ui/dom.js';
import { openSheet, choose } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { listCalendars, googleCalendars, linkCalendar, unlinkCalendar, syncAll } from '../integrations/google.js';
import { nearestColor } from '../integrations/google-map.js';

const ROLE = { owner: '', writer: '', reader: '読み取り専用' };

export async function openGoogleCalendarPicker() {
  const list = h('div.cal-list', h('div.empty-state.small', '読み込んでいます…'));
  openSheet({ title: '同期するカレンダー', content: h('div.form',
    h('p.note', 'チェックしたGoogleカレンダーが、アプリに同じ名前のカレンダーとして入ります。アプリで追加・変更した予定もGoogleに送られます（読み取り専用のカレンダーを除く）。'),
    list) });
  let cals;
  try { cals = await listCalendars(); }
  catch (e) { clear(list, h('div.empty-state.small', `読み込めませんでした（${e.message}）`)); return; }
  const render = () => {
    const linked = new Map(googleCalendars().map(c => [c.source.externalId, c]));
    clear(list, cals.map(g => {
      const local = linked.get(g.id);
      return h(`label.cal-row.c${nearestColor(g.color)}`,
        h('span.cal-check',
          h('input', { type: 'checkbox', checked: !!local, onchange: e => toggle(g, e.target.checked, e.target) }),
          h('span.cal-box', icon('check'))),
        h('span.cal-name', h('span', g.name), g.primary && h('span.cal-badge', 'メイン'), ROLE[g.accessRole] && h('span.cal-count', ROLE[g.accessRole])));
    }));
  };
  async function toggle(g, on, input) {
    if (on) {
      linkCalendar(g);
      toast(`「${g.name}」を同期しています…`, { duration: 2500 });
      try { const r = await syncAll({ quiet: false }); toast(`「${g.name}」の予定を${r?.pulled ?? 0}件取り込みました`); }
      catch (e) { toast(`同期できませんでした（${e.message}）`); }
    } else {
      const local = googleCalendars().find(c => c.source.externalId === g.id);
      const how = await choose(`「${g.name}」の同期をやめる`, [
        { label: 'アプリから予定を消す', value: 'remove', danger: true },
        { label: 'アプリのカレンダーとして残す', value: 'keep' },
      ], 'Googleカレンダーの予定はどちらでも消えません。');
      if (!how) { input.checked = true; return; }
      unlinkCalendar(local.id, how === 'keep');
    }
    render();
  }
  render();
}
