// Service Worker の登録と「更新があります」の表示
// 新しい版は待機状態で止めておき、ユーザーが「更新」を押したら切り替えて再読み込みする。

import { h } from './ui/dom.js';

let registration = null;
let banner = null;
let updateRequested = false;

function showUpdateBanner(worker) {
  if (banner) return;
  banner = h('div.update-banner', { role: 'alert' },
    h('span', '更新があります'),
    h('button.update-btn', { onclick: () => { banner.querySelector('button').disabled = true; updateRequested = true; worker.postMessage({ type: 'SKIP_WAITING' }); } }, '更新'),
    h('button.update-later', { 'aria-label': 'あとで', onclick: () => { banner.remove(); banner = null; } }, 'あとで'));
  document.body.appendChild(banner);
}

function watch(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      // 初回インストール（controller なし）のときは表示しない
      if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(w);
    });
  });
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let reloading = false;
  // 初回インストール時の clients.claim() でも controllerchange が起きるので、「更新」を押したときだけ再読み込みする
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !updateRequested) return;
    reloading = true;
    location.reload();
  });
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    watch(registration);
  } catch (e) {
    console.warn('Service Worker の登録に失敗しました', e);
    return;
  }
  // iOS のホーム画面アプリは起動したままになりやすいので、前面に戻るたびと30分ごとに確認する
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); });
  setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
}

/** 設定画面の「更新を確認」。更新が見つかれば true */
export async function checkForUpdate() {
  if (!registration) return false;
  try { await registration.update(); } catch { return false; }
  if (registration.waiting) { showUpdateBanner(registration.waiting); return true; }
  const w = registration.installing;
  if (!w) return false;
  return new Promise(resolve => {
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') resolve(true);
      if (w.state === 'redundant') resolve(false);
    });
  });
}
