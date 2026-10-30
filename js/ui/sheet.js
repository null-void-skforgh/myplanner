// 下（または上）から出るシート（モーダル）と選択ダイアログ

import { h, icon } from './dom.js';
import { dismissToast } from './toast.js';

const stack = [];

// iPhone でキーボードが出ると、見えている範囲（visualViewport）だけが縮む。
// シートの背景をその範囲に合わせて、シートがキーボードの裏に隠れないようにする。
function watchViewport() {
  const vv = window.visualViewport;
  if (!vv || watchViewport.done) return;
  watchViewport.done = true;
  const root = document.documentElement.style;
  const update = () => {
    root.setProperty('--vv-top', `${vv.offsetTop}px`);
    root.setProperty('--vv-height', `${vv.height}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

/**
 * @param {{title?:string, content:Node, full?:boolean, top?:boolean, onClose?:()=>void}} opts
 *   top: 画面の上から出す（すぐ文字を入力するシート向け。キーボードと重ならない）
 */
export function openSheet({ title, content, full = false, top = false, headerRight, onClose }) {
  watchViewport();
  const root = document.getElementById('sheet-root');
  dismissToast(); // シートのボタンにトーストが重ならないように
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 220);
    stack.splice(stack.indexOf(api), 1);
    onClose?.();
  };
  const panel = h('div.sheet' + (full ? '.full' : '') + (top ? '.top' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    !top && h('div.sheet-grip'),
    (title || headerRight) && h('div.sheet-header',
      h('button.icon-btn', { 'aria-label': '閉じる', onclick: close }, icon('close')),
      h('div.sheet-title', title || ''),
      h('div.sheet-header-right', headerRight || null)),
    h('div.sheet-body', content),
    top && h('div.sheet-grip'));
  const overlay = h('div.sheet-overlay' + (top ? '.top' : ''), { onclick: e => { if (e.target === overlay) close(); } }, panel);
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  const api = { close, el: panel };
  stack.push(api);
  return api;
}

export const closeTopSheet = () => { stack.at(-1)?.close(); return stack.length > 0; };

/**
 * 選択肢を出して選ばれた value を返す（キャンセルは null）
 * @param {string} title
 * @param {{label:string, value:any, danger?:boolean}[]} options
 */
export function choose(title, options, message) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); sheet.close(); };
    const sheet = openSheet({
      content: h('div.choice',
        h('div.choice-title', title),
        message && h('div.choice-msg', message),
        options.map(o => h('button.choice-btn' + (o.danger ? '.danger' : ''), { onclick: () => finish(o.value) }, o.label)),
        h('button.choice-btn.cancel', { onclick: () => finish(null) }, 'キャンセル')),
      onClose: () => { if (!done) { done = true; resolve(null); } },
    });
  });
}

export const confirmDialog = (title, okLabel = 'OK', message, danger = false) =>
  choose(title, [{ label: okLabel, value: true, danger }], message).then(v => v === true);
