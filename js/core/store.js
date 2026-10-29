// アプリの状態・永続化・取り消し／やり直し
// データの変更はすべて transact() を通す。各変更は「変更前/変更後」のレコード差分として記録される。

import { KEYS } from './storage.js';
import { DEFAULT_CALENDARS, DEFAULT_SETTINGS } from './model.js';

const COLLECTIONS = ['events', 'todos', 'trash', 'calendars', 'notes', 'reviews'];
const UNDO_LIMIT = 50;

export function createStore(storage) {
  const state = {
    events: storage.get(KEYS.events, {}),
    todos: storage.get(KEYS.todos, {}),
    trash: storage.get(KEYS.trash, {}),
    calendars: storage.get(KEYS.calendars, null) || structuredClone(DEFAULT_CALENDARS),
    notes: storage.get(KEYS.notes, {}),
    reviews: storage.get(KEYS.reviews, {}),
    settings: { ...DEFAULT_SETTINGS, ...storage.get(KEYS.settings, {}) },
    meta: storage.get(KEYS.meta, {}),
    memo: storage.getRaw(KEYS.memo) ?? '',
  };
  const undoStack = [], redoStack = [];
  const listeners = new Set();

  const persist = colls => { for (const c of colls) storage.set(KEYS[c], state[c]); };
  const notify = (changed, info = {}) => { for (const fn of listeners) fn(changed, info); };

  function apply(changes, useAfter) {
    const touched = new Set();
    for (const ch of changes) {
      const rec = useAfter ? ch.after : ch.before;
      if (rec == null) delete state[ch.coll][ch.id];
      else state[ch.coll][ch.id] = structuredClone(rec);
      touched.add(ch.coll);
    }
    return touched;
  }

  /**
   * @param {string} label  取り消しトーストに出す文言（例:「予定を削除しました」）
   * @param {(tx)=>void} fn  tx.put(coll, record) / tx.remove(coll, id)
   * @param {{undoable?:boolean, silent?:boolean}} opts
   */
  function transact(label, fn, { undoable = true } = {}) {
    const changes = [];
    const tx = {
      get: (coll, id) => state[coll][id],
      put(coll, rec) {
        if (!COLLECTIONS.includes(coll)) throw new Error('unknown collection ' + coll);
        const before = state[coll][rec.id] ? structuredClone(state[coll][rec.id]) : null;
        const after = structuredClone({ ...rec, updatedAt: Date.now() });
        state[coll][rec.id] = after;
        changes.push({ coll, id: rec.id, before, after });
      },
      remove(coll, id) {
        if (!state[coll][id]) return;
        changes.push({ coll, id, before: structuredClone(state[coll][id]), after: null });
        delete state[coll][id];
      },
    };
    try { fn(tx); } catch (e) {
      apply(changes.reverse(), false);
      throw e;
    }
    if (!changes.length) return null;
    const touched = new Set(changes.map(c => c.coll));
    persist(touched);
    const entry = { label, changes };
    if (undoable) {
      undoStack.push(entry);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    notify(touched, { label, undoable });
    return entry;
  }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) return null;
    const touched = apply([...entry.changes].reverse(), false);
    persist(touched); redoStack.push(entry);
    notify(touched, { label: entry.label, undo: true });
    return entry;
  }

  function redo() {
    const entry = redoStack.pop();
    if (!entry) return null;
    const touched = apply(entry.changes, true);
    persist(touched); undoStack.push(entry);
    notify(touched, { label: entry.label, redo: true });
    return entry;
  }

  return {
    state,
    transact, undo, redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // ── 取り消し対象外のもの ──
    setMemo(text) { state.memo = text; storage.setRaw(KEYS.memo, text); notify(new Set(['memo'])); },
    setSettings(patch) {
      Object.assign(state.settings, patch); storage.set(KEYS.settings, state.settings);
      notify(new Set(['settings']));
    },
    setMeta(patch) { Object.assign(state.meta, patch); storage.set(KEYS.meta, state.meta); },
    /** バックアップ読み込みなど、全体を置き換える */
    replaceAll(data) {
      for (const c of COLLECTIONS) if (data[c]) state[c] = data[c];
      if (typeof data.memo === 'string') state.memo = data.memo;
      if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      persist(COLLECTIONS);
      storage.setRaw(KEYS.memo, state.memo);
      storage.set(KEYS.settings, state.settings);
      undoStack.length = 0; redoStack.length = 0;
      notify(new Set([...COLLECTIONS, 'memo', 'settings']));
    },

    // ── 便利な読み出し ──
    eventList: () => Object.values(state.events).filter(e => !e.deletedAt),
    todoList: () => Object.values(state.todos),
    noteList: () => Object.values(state.notes).filter(n => !n.deletedAt),
    isCalendarVisible: ev => state.calendars[ev.calendarId]?.visible !== false,
  };
}
