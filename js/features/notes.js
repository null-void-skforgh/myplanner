// メモ（複数）と振り返り（週次レポート）

import { app } from '../app.js';
import { newNote, uid } from '../core/model.js';
import { makeKey, parts, todayKey, addDays, startOfWeek } from '../core/date.js';

// ── 表示用 ──
export const noteTitle = n => (n.body.split('\n').find(l => l.trim()) || '').trim() || '新しいメモ';
export function noteSnippet(n) {
  const lines = n.body.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.slice(1, 3).join(' ');
}
export const sortedNotes = () => app.store.noteList().sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));

// ── 操作 ──
export function createNote(body = '') {
  const n = newNote({ body });
  app.store.transact('', tx => tx.put('notes', n), { undoable: false });
  return n;
}

/** 本文の保存（入力のたびに呼ばれるので取り消し対象外） */
export function saveNoteBody(id, body) {
  const n = app.store.state.notes[id];
  if (!n || n.body === body) return;
  app.store.transact('', tx => tx.put('notes', { ...n, body }), { undoable: false });
}

export function togglePin(id) {
  const n = app.store.state.notes[id];
  if (n) app.store.transact(n.pinned ? 'ピン留めを外しました' : 'ピン留めしました', tx => tx.put('notes', { ...n, pinned: !n.pinned }), { undoable: false });
}

export function deleteNote(id) {
  const n = app.store.state.notes[id];
  if (!n) return;
  app.store.transact(`メモ「${noteTitle(n).slice(0, 20)}」を削除しました`, tx => tx.put('notes', { ...n, deletedAt: Date.now() }));
}

/** 空のメモは残さない（作っただけで何も書かずに戻ったとき） */
export function discardIfEmpty(id) {
  const n = app.store.state.notes[id];
  if (n && !n.body.trim()) app.store.transact('', tx => tx.remove('notes', id), { undoable: false });
}

export function deleteReview(id) {
  const r = app.store.state.reviews[id];
  if (r) app.store.transact(`振り返り（${r.label}）を削除しました`, tx => tx.remove('reviews', id));
}

// ── 週次レポートの取り出し（旧メモの先頭に積まれていたもの） ──

const HEADER = /^📊 週次レポート（(\d{1,2})\/(\d{1,2})〜(\d{1,2})\/(\d{1,2})）\s*$/;

/** M/D から、today 以前で最も近い年の日付キーを推定する */
function inferKey(m, d, today) {
  const y = parts(today).y;
  for (const yy of [y, y - 1]) {
    const k = makeKey(yy, m, d);
    if (k <= today) return k;
  }
  return makeKey(y - 1, m, d);
}

/**
 * メモ本文から週次レポートのかたまりを取り出す（純粋関数）
 * @returns {{ rest: string, reports: {weekStart:string, label:string, text:string}[] }}
 */
export function extractWeeklyReports(memo, today = todayKey()) {
  const lines = memo.split('\n');
  const keep = [], reports = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADER);
    const isBlock = m && /^━+$/.test(lines[i + 1] || '') && /^✅ 完了/.test(lines[i + 2] || '');
    if (!isBlock) { keep.push(lines[i]); continue; }
    const block = [lines[i]];
    let j = i + 1;
    // 見出し・区切り線・集計（6行）
    for (let k = 0; k < 5 && j < lines.length; k++, j++) block.push(lines[j]);
    // 完了／未完了の一覧（✓ / ✗ で始まる行）と、その間の空行
    while (j < lines.length && (/^[✓✗] /.test(lines[j]) || (lines[j] === '' && /^[✓✗] /.test(lines[j + 1] || '')))) block.push(lines[j++]);
    if (lines[j] === '') j++; // レポート直後の空行
    reports.push({ weekStart: inferKey(+m[1], +m[2], today), label: `${m[1]}/${m[2]}〜${m[3]}/${m[4]}`, text: block.join('\n').trim() });
    i = j - 1;
  }
  return { rest: keep.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''), reports };
}

/**
 * 起動時：メモが1件もなく、旧メモ（mp2:memo）に中身があれば、メモ1件と振り返りに分けて移す。
 * mp2:memo 自体は消さずに残す（元に戻せるように）。
 */
export function ensureNotesMigrated() {
  const { store } = app;
  if (store.state.meta.notesMigrated) return null;
  const memo = store.state.memo || '';
  const { rest, reports } = extractWeeklyReports(memo);
  store.transact('', tx => {
    if (!Object.keys(store.state.notes).length && rest.trim()) tx.put('notes', newNote({ body: rest }));
    for (const r of reports) {
      if (Object.values(store.state.reviews).some(x => x.weekStart === r.weekStart)) continue;
      tx.put('reviews', { id: uid('r'), ...r, createdAt: Date.now() });
    }
  }, { undoable: false });
  store.setMeta({ notesMigrated: true });
  return { notes: rest.trim() ? 1 : 0, reviews: reports.length };
}

/** 先週分の振り返りを作る（週1回。旧アプリと同じ集計） */
export function addWeeklyReview(now = new Date()) {
  const { store } = app;
  const thisMonday = startOfWeek(todayKey(now), 1);
  const lastMonday = addDays(thisMonday, -7), lastSunday = addDays(thisMonday, -1);
  if (Object.values(store.state.reviews).some(r => r.weekStart === lastMonday)) return null;
  const list = store.todoList().filter(t => t.due && t.due >= lastMonday && t.due <= lastSunday);
  if (!list.length) return null;
  const done = list.filter(t => t.done), undone = list.filter(t => !t.done);
  const md = k => `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;
  const label = `${md(lastMonday)}〜${md(lastSunday)}`;
  const text = [`📊 週次レポート（${label}）`, '━━━━━━━━━━━━━━━',
    `✅ 完了: ${done.length}件`, `📌 未完了: ${undone.length}件`, `🎯 達成率: ${Math.round(done.length / list.length * 100)}%`,
    '━━━━━━━━━━━━━━━', ...done.map(t => '✓ ' + t.text), ...undone.map(t => '✗ ' + t.text)].join('\n');
  store.transact('', tx => tx.put('reviews', { id: uid('r'), weekStart: lastMonday, label, text, createdAt: Date.now() }), { undoable: false });
  return '📊 先週の振り返りを作成しました（メモ →「振り返り」）';
}
