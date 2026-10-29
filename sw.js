// Service Worker：アプリ本体を事前にキャッシュしてオフラインでも開けるようにする。
// 新しい版はインストール後に待機し、画面の「更新」ボタンで切り替わる（js/pwa.js）。
// VERSION と ASSETS は `npm run bump` で自動更新する。手で編集しない。

const VERSION = '2.5.0';
const CACHE = 'myplanner-' + VERSION;
const ASSETS = [
  './',
  'css/agenda.css',
  'css/base.css',
  'css/components.css',
  'css/month.css',
  'css/pages.css',
  'css/timegrid.css',
  'css/tokens.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'js/app.js',
  'js/core/date.js',
  'js/core/event-ops.js',
  'js/core/events.js',
  'js/core/migrate.js',
  'js/core/model.js',
  'js/core/recurrence.js',
  'js/core/storage.js',
  'js/core/store.js',
  'js/features/backup.js',
  'js/features/calendars.js',
  'js/features/classes.js',
  'js/features/ics.js',
  'js/features/notes.js',
  'js/features/notify.js',
  'js/features/server.js',
  'js/features/startup-tasks.js',
  'js/features/todo-actions.js',
  'js/features/widget.js',
  'js/main.js',
  'js/nlp/parse-ja.js',
  'js/pwa.js',
  'js/ui/dom.js',
  'js/ui/gesture.js',
  'js/ui/router.js',
  'js/ui/sheet.js',
  'js/ui/theme.js',
  'js/ui/toast.js',
  'js/version.js',
  'js/views/calendar/actions.js',
  'js/views/calendar/agenda.js',
  'js/views/calendar/index.js',
  'js/views/calendar/items.js',
  'js/views/calendar/month.js',
  'js/views/calendar/timegrid.js',
  'js/views/calendars-sheet.js',
  'js/views/class-add.js',
  'js/views/event-editor.js',
  'js/views/ics-io.js',
  'js/views/memo.js',
  'js/views/quick-add.js',
  'js/views/recurrence-editor.js',
  'js/views/search.js',
  'js/views/settings.js',
  'js/views/todo-editor.js',
  'js/views/todo.js',
  'manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // GitHub Pages の HTTP キャッシュ（10分）を避けて必ず最新を取る
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('myplanner-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // 画面遷移は常にキャッシュ済みの index.html（ハッシュで画面を切り替えるため）
    if (req.mode === 'navigate') return (await cache.match('index.html')) || fetch(req);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch { return new Response('', { status: 504 }); }
  })());
});

// ── 通知（サーバーから Web Push で届く） ──
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data?.json() || {}; } catch { d = { title: 'マイプランナー', body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'マイプランナー', {
    body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins[0];
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
