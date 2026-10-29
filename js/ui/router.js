// 画面の状態を URL ハッシュに持つ（再起動しても同じ画面に戻れる）
// #/cal/week/2026-10-29  #/todo  #/memo  #/settings

import { normalizeKey, todayKey } from '../core/date.js';

export const PAGES = ['cal', 'todo', 'memo', 'settings'];
export const VIEWS = ['month', 'week', 'day', 'agenda'];

export function parseHash(hash, defaults) {
  const [page, view, date] = hash.replace(/^#\/?/, '').split('/');
  return {
    page: PAGES.includes(page) ? page : 'cal',
    view: VIEWS.includes(view) ? view : defaults.view,
    date: normalizeKey(date) || defaults.date || todayKey(),
  };
}

export function formatHash({ page, view, date }) {
  return page === 'cal' ? `#/cal/${view}/${date}` : `#/${page}`;
}

export function createRouter(defaults) {
  let state = parseHash(location.hash, defaults);
  const listeners = new Set();
  const emit = prev => listeners.forEach(fn => fn(state, prev));

  window.addEventListener('hashchange', () => {
    const prev = state;
    const next = parseHash(location.hash, { ...defaults, view: state.view, date: state.date });
    if (next.page === prev.page && next.view === prev.view && next.date === prev.date) return;
    state = next; emit(prev);
  });

  return {
    get state() { return state; },
    /** 履歴を積まずに更新（日付の前後移動など） */
    go(patch, { push = false } = {}) {
      const prev = state;
      state = { ...state, ...patch };
      const hash = formatHash(state);
      if (hash !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', hash);
      emit(prev);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
