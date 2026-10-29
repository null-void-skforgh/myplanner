// メモ（自動保存）

import { app } from '../app.js';
import { h, clear } from '../ui/dom.js';

export function mountMemo(page) {
  const saved = h('span.memo-saved', '保存済み');
  const area = h('textarea.memo-area', { placeholder: '自由にメモを書いてください…' });
  let timer;
  area.addEventListener('input', () => {
    clearTimeout(timer);
    saved.style.opacity = '0';
    timer = setTimeout(() => { app.store.setMemo(area.value); saved.style.opacity = '1'; }, 500);
  });
  // 画面を離れる前に確実に保存
  const flush = () => { if (timer) { clearTimeout(timer); timer = null; app.store.setMemo(area.value); } };
  document.addEventListener('visibilitychange', flush);
  area.addEventListener('blur', flush);

  clear(page, h('header.app-header', h('div.page-title', 'メモ'), h('div.spacer'), saved), h('div.memo-wrap', area));
  return {
    render() { if (document.activeElement !== area) area.value = app.store.state.memo; },
    onStoreChange(changed) { if (changed.has('memo') && document.activeElement !== area) area.value = app.store.state.memo; },
  };
}
