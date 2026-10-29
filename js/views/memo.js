// メモ画面：メモ一覧・メモの編集・振り返り（週次レポート）
// 編集中のメモでは、カーソルのある行（または選択した行）から Todo や予定を作れる。

import { app } from '../app.js';
import { h, clear, icon } from '../ui/dom.js';
import { choose, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { todayKey, toKey, fmtMD, dtDate } from '../core/date.js';
import { parseJa } from '../nlp/parse-ja.js';
import { newTodo } from '../core/model.js';
import { createEvent } from '../core/event-ops.js';
import { defaultCalendarId } from '../features/calendars.js';
import { sortedNotes, noteTitle, noteSnippet, createNote, saveNoteBody, togglePin, deleteNote, discardIfEmpty, deleteReview } from '../features/notes.js';

const BULLET = /^\s*(?:[-*・•□☐■◯○✓✗]|\d+[.)．])\s*/;

function dateLabel(ms) {
  const d = new Date(ms);
  const key = toKey(d);
  if (key === todayKey()) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.getFullYear() === new Date().getFullYear() ? fmtMD(key) : `${d.getFullYear()}/${fmtMD(key)}`;
}

/** textarea の選択範囲（またはカーソルの行）にかかる行を返す */
function selectedLines(area) {
  const v = area.value;
  let s = area.selectionStart ?? 0, e = area.selectionEnd ?? s;
  if (e > s && v[e - 1] === '\n') e--;
  const from = v.lastIndexOf('\n', s - 1) + 1;
  const toIdx = v.indexOf('\n', e);
  const to = toIdx < 0 ? v.length : toIdx;
  return v.slice(from, to).split('\n').map(l => l.replace(BULLET, '').trim()).filter(Boolean);
}

export function mountMemo(page) {
  let mode = 'list', tab = 'notes', currentId = null, query = '';
  let saveTimer = null;
  const root = h('div.memo-root');
  clear(page, root);

  // ── 一覧 ──
  function renderList() {
    const seg = h('div.segmented.small', [['notes', 'メモ'], ['reviews', '振り返り']].map(([k, l]) =>
      h('button', { 'aria-selected': String(k === tab), onclick: () => { tab = k; renderList(); } }, l)));
    const header = h('header.app-header', h('div.page-title', 'メモ'), h('div.spacer'), seg,
      tab === 'notes' && h('button.icon-btn', { 'aria-label': '新しいメモ', onclick: () => openNote(createNote().id, true) }, icon('plus')));
    const body = h('div.page-scroll');
    clear(root, header, body);

    if (tab === 'reviews') {
      const reviews = Object.values(app.store.state.reviews).sort((a, b) => (b.weekStart > a.weekStart ? 1 : -1));
      clear(body,
        h('p.note', '毎週月曜に、先週が期限だったTodoの達成状況をまとめます。'),
        reviews.length ? reviews.map(r => h('section.card.review',
          h('div.review-head', h('span.review-label', r.label), h('div.spacer'),
            h('button.icon-btn.subtle', { 'aria-label': '削除', onclick: () => deleteReview(r.id) }, icon('close'))),
          h('pre.review-text', r.text.split('\n').slice(1).join('\n'))))
          : h('div.empty-state', 'まだ振り返りはありません'));
      return;
    }

    const search = h('input.input.search-input', { type: 'search', placeholder: 'メモを検索', value: query,
      oninput: e => { query = e.target.value; fillList(); } });
    const list = h('div.note-list');
    const fillList = () => {
      const q = query.trim().toLowerCase();
      const notes = sortedNotes().filter(n => !q || n.body.toLowerCase().includes(q));
      clear(list, notes.length ? notes.map(n => h('button.note-row', { onclick: () => openNote(n.id) },
        h('div.note-row-main',
          h('div.note-title', n.pinned && icon('pin', 'icon inline pin'), noteTitle(n)),
          h('div.note-sub', h('span.note-date', dateLabel(n.updatedAt)), h('span.note-snippet', noteSnippet(n))))))
        : h('div.empty-state', q ? '見つかりませんでした' : 'メモはまだありません。右上の＋から作れます'));
    };
    fillList();
    clear(body, search, list);
  }

  // ── 編集 ──
  function openNote(id, isNew = false) {
    const note = app.store.state.notes[id];
    if (!note) { mode = 'list'; renderList(); return; }
    mode = 'edit'; currentId = id;
    const saved = h('span.memo-saved', '保存済み');
    const area = h('textarea.memo-area', { placeholder: '1行目がタイトルになります', value: note.body });
    const flush = () => {
      if (!saveTimer) return;
      clearTimeout(saveTimer); saveTimer = null;
      saveNoteBody(id, area.value); saved.style.opacity = '1';
    };
    area.addEventListener('input', () => {
      clearTimeout(saveTimer); saved.style.opacity = '0';
      saveTimer = setTimeout(flush, 400);
    });
    area.addEventListener('blur', flush);
    const back = () => { flush(); discardIfEmpty(id); mode = 'list'; currentId = null; renderList(); };
    root._flush = flush;

    // ボタンを押してもキーボード（カーソル位置）が外れないようにする
    const keepFocus = { onpointerdown: e => e.preventDefault() };
    const pinBtn = h('button.icon-btn' + (note.pinned ? '.active' : ''), { ...keepFocus, 'aria-label': 'ピン留め', onclick: () => { togglePin(id); pinBtn.classList.toggle('active'); } }, icon('pin'));
    const convertBtn = h('button.pill-btn.primary', { ...keepFocus, onclick: () => convert(area) }, '行をTodo・予定に');
    const delBtn = h('button.icon-btn', { 'aria-label': 'メモを削除', onclick: async () => {
      if (area.value.trim() && !await confirmDialog('このメモを削除しますか？', '削除', 'あとから「取り消す」で戻せます。', true)) return;
      flush(); deleteNote(id); mode = 'list'; renderList();
    } }, icon('trash'));

    clear(root,
      h('header.app-header',
        h('button.back-btn', { onclick: back }, icon('left'), 'メモ'),
        h('div.spacer'), saved, pinBtn, delBtn),
      h('div.memo-toolbar', convertBtn, h('span.memo-hint', 'カーソルのある行・選択した行から作成')),
      h('div.memo-wrap', area));
    if (isNew) area.focus();
  }

  async function convert(area) {
    const lines = selectedLines(area);
    if (!lines.length) { toast('Todoや予定にしたい行にカーソルを置くか、行を選択してください'); return; }
    if (lines.length === 1) { app.openQuickAdd({ text: lines[0], baseDate: todayKey() }); return; }
    const kind = await choose(`${lines.length}行をまとめて追加`, [
      { label: `${lines.length}件のTodoにする`, value: 'todo' },
      { label: `${lines.length}件の予定にする`, value: 'event' },
    ], '日時が書かれた行は、その日時で登録します。');
    if (!kind) return;
    app.store.transact(`${lines.length}件の${kind === 'todo' ? 'Todo' : '予定'}を追加しました`, tx => {
      lines.forEach((line, i) => {
        const r = parseJa(line);
        if (kind === 'todo') {
          tx.put('todos', newTodo({ text: r.title || line, due: r.hasDate ? dtDate(r.start) : null,
            start: r.hasTime ? r.start.slice(11) : null, createdAt: Date.now() - i }));
        } else {
          createEvent(tx, { title: r.title || line, allDay: r.allDay, start: r.start, end: r.end, rrule: r.rrule, calendarId: defaultCalendarId() });
        }
      });
    });
  }

  app.openNote = id => { app.router.go({ page: 'memo' }, { push: true }); openNote(id); };

  return {
    render() { if (mode === 'list') renderList(); },
    onStoreChange(changed) {
      if (mode === 'list' && (changed.has('notes') || changed.has('reviews'))) renderList();
      if (mode === 'edit' && changed.has('notes') && !app.store.state.notes[currentId]?.body && app.store.state.notes[currentId]?.deletedAt) { mode = 'list'; renderList(); }
    },
    flush: () => root._flush?.(),
    /** メモのタブをもう一度押したら一覧に戻る */
    toList() { if (mode !== 'edit') return; root._flush?.(); discardIfEmpty(currentId); mode = 'list'; currentId = null; renderList(); },
  };
}
