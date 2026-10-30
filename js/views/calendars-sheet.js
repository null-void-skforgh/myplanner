// カレンダー一覧（表示切替・色・名前・追加・削除）

import { app } from '../app.js';
import { h, clear, icon } from '../ui/dom.js';
import { openSheet, choose } from '../ui/sheet.js';
import { COLOR_COUNT, COLOR_NAMES } from '../core/model.js';
import { sortedCalendars, addCalendar, updateCalendar, setCalendarVisible, deleteCalendar, eventCountOf, defaultCalendarId } from '../features/calendars.js';

export function openCalendarsSheet() {
  const list = h('div.cal-list');
  const render = () => {
    const defId = defaultCalendarId();
    clear(list,
      sortedCalendars().map(c => h(`div.cal-row.c${c.color}`,
        h('label.cal-check',
          h('input', { type: 'checkbox', checked: c.visible !== false, onchange: e => setCalendarVisible(c.id, e.target.checked) }),
          h('span.cal-box', icon('check'))),
        h('button.cal-name', { onclick: () => openCalendarEditor(c, render) },
          h('span', c.name),
          c.id === defId && h('span.cal-badge', '既定'),
          c.source?.provider === 'google' && h('span.cal-badge', 'Google'),
          h('span.cal-count', `${eventCountOf(c.id)}件`)))),
      h('button.btn.secondary.wide', { onclick: () => openCalendarEditor(null, render) }, icon('plus', 'icon inline'), 'カレンダーを追加'));
  };
  const unsub = app.store.subscribe(changed => { if (changed.has('calendars') || changed.has('events')) render(); });
  openSheet({ title: 'カレンダー', content: h('div.form', h('p.note', 'チェックを外したカレンダーの予定は表示されません。名前をタップすると色や名前を変えられます。'), list), onClose: unsub });
  render();
}

function openCalendarEditor(cal, onDone) {
  const isNew = !cal;
  const v = { name: cal?.name ?? '', color: cal?.color ?? (Object.keys(app.store.state.calendars).length % COLOR_COUNT) };
  const nameIn = h('input.input.title-input', { type: 'text', placeholder: 'カレンダーの名前（例: 授業、バイト）', value: v.name, oninput: e => { v.name = e.target.value; } });
  const colors = h('div.color-picker');
  const renderColors = () => clear(colors, Array.from({ length: COLOR_COUNT }, (_, i) =>
    h(`button.color-dot.c${i}`, { 'aria-label': COLOR_NAMES[i], 'aria-pressed': String(i === v.color), onclick: () => { v.color = i; renderColors(); } })));
  renderColors();

  const save = () => {
    const name = v.name.trim() || '新しいカレンダー';
    if (isNew) addCalendar({ name, color: v.color });
    else updateCalendar(cal.id, { name, color: v.color }, `カレンダー「${name}」を変更しました`);
    sheet.close(); onDone();
  };

  const remove = async () => {
    const n = eventCountOf(cal.id);
    const others = sortedCalendars().filter(c => c.id !== cal.id);
    const choice = n === 0 ? 'delete' : await choose(`「${cal.name}」を削除`, [
      { label: `予定 ${n}件を「${others[0].name}」に移して削除`, value: 'move' },
      { label: `予定 ${n}件もまとめて削除`, value: 'delete', danger: true },
    ], 'あとから「取り消す」で元に戻せます。');
    if (!choice) return;
    deleteCalendar(cal.id, choice === 'move' ? others[0].id : null);
    sheet.close(); onDone();
  };

  const isDefault = cal && defaultCalendarId() === cal.id;
  const sheet = openSheet({
    title: isNew ? '新しいカレンダー' : 'カレンダーの編集',
    headerRight: h('button.pill-btn.primary', { onclick: save }, isNew ? '追加' : '保存'),
    content: h('div.form',
      h('div.field', nameIn),
      h('div.field', h('div.field-label', '色'), colors),
      cal && !isDefault && h('button.btn.secondary.wide', { onclick: () => { app.store.setSettings({ defaultCalendarId: cal.id }); sheet.close(); onDone(); } }, '新しい予定の既定にする'),
      cal && cal.id !== 'default' && h('button.btn.danger.wide', { onclick: remove }, 'カレンダーを削除')),
  });
  if (isNew) nameIn.focus();
}
