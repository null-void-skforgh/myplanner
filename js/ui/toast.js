// 画面下部のトースト（「取り消す」ボタン付き）

import { h } from './dom.js';

let root, current, timer;

/** シートを開くときなど、表示中のトーストを消す */
export function dismissToast() {
  clearTimeout(timer);
  current?.remove();
  current = null;
}

export function toast(message, { action, duration = 4000 } = {}) {
  root ??= document.getElementById('toast-root');
  current?.remove();
  clearTimeout(timer);
  const el = h('div.toast', { role: 'status' },
    h('span.toast-msg', message),
    action && h('button.toast-action', { onclick: () => { el.remove(); action.fn(); } }, action.label));
  root.appendChild(el);
  current = el;
  requestAnimationFrame(() => el.classList.add('show'));
  timer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, duration);
  return el;
}
