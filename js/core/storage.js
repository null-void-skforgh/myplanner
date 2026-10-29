// localStorage の唯一の窓口。段階3で IndexedDB に替えるときはここだけ差し替える。

export const PREFIX = 'mp2:';
export const SCHEMA_VERSION = 2;

export const KEYS = {
  schema: PREFIX + 'schema',
  events: PREFIX + 'events',
  todos: PREFIX + 'todos',
  trash: PREFIX + 'trash',
  calendars: PREFIX + 'calendars',
  notes: PREFIX + 'notes',
  reviews: PREFIX + 'reviews',
  memo: PREFIX + 'memo',
  settings: PREFIX + 'settings',
  meta: PREFIX + 'meta',
  backupV1: PREFIX + 'backup:v1',
  migrationReport: PREFIX + 'migrationReport',
};

/** 旧バージョン（v1）が使っていたキー */
export const LEGACY_KEYS = ['calItems', 'todos', 'trashedTodos', 'nextId', 'memo',
  'lastArchiveDate', 'lastReportWeek', 'toeflImported'];

export function createStorage(backend = globalThis.localStorage) {
  return {
    backend,
    getRaw(key) { return backend.getItem(key); },
    setRaw(key, value) { backend.setItem(key, value); },
    get(key, fallback) {
      const raw = backend.getItem(key);
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    },
    set(key, value) { backend.setItem(key, JSON.stringify(value)); },
    remove(key) { backend.removeItem(key); },
  };
}

/** テスト用のメモリ実装 */
export function memoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    _map: map,
  };
}
