import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/core/store.js';
import { createStorage, memoryBackend } from '../js/core/storage.js';
import { newEvent } from '../js/core/model.js';
import { saveOccurrence, deleteOccurrence } from '../js/core/event-ops.js';
import { occurrencesInRange } from '../js/core/events.js';
import { fromGoogle, toGoogle, rruleLine, supportedRRule, htmlToText, nearestColor } from '../js/integrations/google-map.js';
import { syncCalendar, pendingChanges } from '../js/integrations/google-sync.js';

// ── 変換 ──

test('Google → アプリ：時刻・終日・繰り返し・通知', () => {
  const t = fromGoogle({ id: 'a', summary: 'ゼミ', location: '工2', description: '資料<br>持参 &amp; 発表',
    start: { dateTime: '2026-11-03T04:00:00Z' }, end: { dateTime: '2026-11-03T05:45:00Z' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270126T145959Z', 'EXDATE;TZID=Asia/Tokyo:20261110T130000'],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 60 }] } });
  assert.deepEqual(t.fields, { title: 'ゼミ', allDay: false, start: '2026-11-03T13:00', end: '2026-11-03T14:45', location: '工2', notes: '資料\n持参 & 発表',
    rrule: { freq: 'WEEKLY', interval: 1, byDay: ['TU'], until: '2027-01-26' }, exdates: ['2026-11-10'], reminders: [10] });
  assert.equal(t.readOnly, false);
  const a = fromGoogle({ start: { date: '2026-11-05' }, end: { date: '2026-11-07' }, reminders: { useDefault: true } });
  assert.deepEqual([a.fields.allDay, a.fields.start, a.fields.end, a.fields.reminders, a.useDefault], [true, '2026-11-05', '2026-11-07', [], true]);
  // 扱えない繰り返しは読み取り専用
  assert.equal(fromGoogle({ start: { date: '2026-11-05' }, end: { date: '2026-11-06' }, recurrence: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15'] }).readOnly, true);
  assert.equal(supportedRRule('FREQ=MONTHLY;BYMONTHDAY=5', '2026-11-05'), true);
  assert.equal(supportedRRule('FREQ=MONTHLY;BYDAY=2TU', '2026-11-10'), true);
  assert.equal(supportedRRule('FREQ=MONTHLY;BYDAY=TU', '2026-11-10'), false);
  assert.equal(htmlToText('<b>a</b>'), 'a');
  assert.equal(nearestColor('#4a7fd4'), 6);
});

test('アプリ → Google：時刻の UNTIL は UTC・除外日・通知', () => {
  const ev = newEvent({ title: '授業', start: '2026-11-03T13:00', end: '2026-11-03T14:45', reminders: [10],
    rrule: { freq: 'WEEKLY', interval: 1, byDay: ['TU'], until: '2027-01-26' }, exdates: ['2026-11-10', '2026-11-17'],
    source: { provider: 'google', exceptionDates: ['2026-11-17'] } });
  const b = toGoogle(ev, { tz: 'Asia/Tokyo' });
  assert.deepEqual(b.start, { dateTime: '2026-11-03T13:00:00+09:00', timeZone: 'Asia/Tokyo' });
  assert.deepEqual(b.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270126T145959Z', 'EXDATE;TZID=Asia/Tokyo:20261110T130000']);
  assert.deepEqual(b.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
  const ad = toGoogle(newEvent({ allDay: true, start: '2026-11-05', end: '2026-11-07', reminders: [-540, 900], rrule: { freq: 'YEARLY', interval: 1, count: 3 } }));
  assert.deepEqual(ad.start, { date: '2026-11-05' });
  assert.deepEqual(ad.reminders.overrides, [{ method: 'popup', minutes: 900 }]);
  assert.equal(rruleLine({ freq: 'DAILY', interval: 2, until: '2026-12-01' }, { allDay: true }), 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261201');
});

// ── 同期（偽の Google を相手に） ──

function fakeGoogle() {
  const events = new Map(); // id → event
  let seq = 0;
  const log = [];
  const touch = ev => { ev.updated = new Date().toISOString(); ev.etag = '"' + (++seq) + '"'; ev._v = seq; return ev; };
  const err = (status, msg) => Object.assign(new Error(msg || 'http_' + status), { status });
  const gapi = async (path, { method = 'GET', body } = {}) => {
    log.push(method + ' ' + path.split('?')[0]);
    const u = new URL('https://x' + path);
    const m = u.pathname.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (!m) throw err(400);
    const id = m[2] && decodeURIComponent(m[2]);
    if (method === 'GET') {
      const st = u.searchParams.get('syncToken');
      if (st === 'expired') throw err(410);
      const since = st ? +st : 0;
      const items = [...events.values()].filter(e => e._v > since && (st || e.status !== 'cancelled')).map(({ _v, ...e }) => structuredClone(e));
      return { items, nextSyncToken: String(seq) };
    }
    if (method === 'POST') { const e = touch({ ...structuredClone(body), id: 'g' + (seq + 1) }); events.set(e.id, e); return e; }
    const cur = events.get(id);
    if (!cur) throw err(404);
    if (method === 'PATCH') { Object.assign(cur, structuredClone(body)); touch(cur); return cur; }
    if (method === 'DELETE') { if (cur.status === 'cancelled') throw err(410); cur.status = 'cancelled'; touch(cur); return {}; }
    throw err(400);
  };
  return { events, gapi, log, touch, remote: id => events.get(id),
    add(e) { const ev = touch({ status: 'confirmed', ...e }); events.set(ev.id, ev); return ev; },
    edit(id, patch) { Object.assign(events.get(id), patch); touch(events.get(id)); } };
}

function setup() {
  const store = createStore(createStorage(memoryBackend()));
  store.transact('', tx => tx.put('calendars', { id: 'cg', name: '個人', color: 6, visible: true, order: 1,
    source: { provider: 'google', externalId: 'me@gmail.com', accessRole: 'owner' } }), { undoable: false });
  const g = fakeGoogle();
  const sync = () => syncCalendar({ store, gapi: g.gapi, calId: 'cg', tz: 'Asia/Tokyo' });
  const live = () => Object.values(store.state.events).filter(e => !e.deletedAt);
  return { store, g, sync, live };
}

test('初回：Google の予定を取り込む（例外の回・削除された回を含む）', async () => {
  const { store, g, sync, live } = setup();
  g.add({ id: 'm', summary: 'ゼミ', start: { dateTime: '2026-11-03T13:00:00+09:00' }, end: { dateTime: '2026-11-03T14:00:00+09:00' }, recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'] });
  g.add({ id: 'm_1110', recurringEventId: 'm', originalStartTime: { dateTime: '2026-11-10T13:00:00+09:00' }, summary: 'ゼミ（教室変更）',
    start: { dateTime: '2026-11-10T15:00:00+09:00' }, end: { dateTime: '2026-11-10T16:00:00+09:00' } });
  g.add({ id: 'gone', status: 'cancelled', summary: 'x', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } });
  const r = await sync();
  assert.equal(r.pulled, 2);
  assert.equal(r.pushed, 0, '取り込んだだけの予定は送り返さない');
  const occ = occurrencesInRange(live(), '2026-11-01', '2026-12-01').map(o => [o.start, o.event.title]);
  assert.deepEqual(occ, [['2026-11-03T13:00', 'ゼミ'], ['2026-11-10T15:00', 'ゼミ（教室変更）'], ['2026-11-17T13:00', 'ゼミ'], ['2026-11-24T13:00', 'ゼミ']]);
  assert.ok(store.state.calendars.cg.source.syncToken);
  // 2回目は何も起きない
  const r2 = await sync();
  assert.deepEqual([r2.pulled, r2.pushed], [0, 0]);
});

test('アプリで作成・変更・削除 → Google に反映', async () => {
  const { store, g, sync } = setup();
  await sync();
  store.transact('追加', tx => tx.put('events', newEvent({ id: 'L1', calendarId: 'cg', title: '歯医者', start: '2026-11-04T15:00', end: '2026-11-04T16:00', reminders: [30] })));
  assert.equal((await sync()).pushed, 1);
  const gid = store.state.events.L1.source.externalId;
  assert.equal(g.remote(gid).summary, '歯医者');
  assert.deepEqual(g.remote(gid).reminders.overrides, [{ method: 'popup', minutes: 30 }]);
  assert.deepEqual(pendingChanges(store, store.state.calendars.cg), []);
  // 自分が送った変更が戻ってきても、二重にならない
  assert.equal((await sync()).pushed, 0);
  assert.equal(Object.keys(store.state.events).length, 1);

  store.transact('変更', tx => tx.put('events', { ...tx.get('events', 'L1'), title: '歯医者（再診）' }));
  await sync();
  assert.equal(g.remote(gid).summary, '歯医者（再診）');

  store.transact('削除', tx => tx.put('events', { ...tx.get('events', 'L1'), deletedAt: Date.now() }));
  await sync();
  assert.equal(g.remote(gid).status, 'cancelled');
  // 削除の取り消し → Google でも復活
  store.undo();
  await sync();
  assert.equal(g.remote(gid).status, 'confirmed');
  assert.equal(store.state.events.L1.deletedAt, null);
});

test('Google で変更・削除 → アプリに反映', async () => {
  const { store, g, sync, live } = setup();
  g.add({ id: 'a', summary: 'バイト', start: { dateTime: '2026-11-05T18:00:00+09:00' }, end: { dateTime: '2026-11-05T22:00:00+09:00' } });
  await sync();
  g.edit('a', { summary: 'バイト（短縮）', end: { dateTime: '2026-11-05T21:00:00+09:00' } });
  await sync();
  assert.deepEqual(live().map(e => [e.title, e.end]), [['バイト（短縮）', '2026-11-05T21:00']]);
  g.edit('a', { status: 'cancelled' });
  await sync();
  assert.equal(live().length, 0);
  assert.equal((await sync()).pushed, 0, 'Google で消えた予定を送り返さない');
});

test('両方で変更したら、あとから変えた方を残す', async () => {
  const { store, g, sync } = setup();
  g.add({ id: 'a', summary: '元', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } });
  await sync();
  const id = Object.keys(store.state.events)[0];
  g.edit('a', { summary: 'Googleで変更' });            // 先に Google で
  await new Promise(r => setTimeout(r, 5));
  store.transact('変更', tx => tx.put('events', { ...tx.get('events', id), title: 'アプリで変更' })); // あとからアプリで
  await sync();
  assert.equal(store.state.events[id].title, 'アプリで変更');
  assert.equal(g.remote('a').summary, 'アプリで変更');
});

test('繰り返し：アプリで「この回だけ」削除・変更 → Google に除外日と単独の予定', async () => {
  const { store, g, sync, live } = setup();
  store.transact('追加', tx => tx.put('events', newEvent({ id: 'S', calendarId: 'cg', title: '授業', start: '2026-11-03T13:00', end: '2026-11-03T14:45',
    rrule: { freq: 'WEEKLY', interval: 1, byDay: ['TU'], count: 3 } })));
  await sync();
  const occs = () => occurrencesInRange(live(), '2026-11-01', '2026-12-01');
  store.transact('休講', tx => deleteOccurrence(tx, occs()[1], 'this'));
  store.transact('教室変更', tx => saveOccurrence(tx, occs()[1], { location: '別教室' }, 'this'));
  await sync();
  const master = g.remote(store.state.events.S.source.externalId);
  assert.deepEqual(master.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3', 'EXDATE;TZID=Asia/Tokyo:20261110T130000', 'EXDATE;TZID=Asia/Tokyo:20261117T130000']);
  const single = [...g.events.values()].find(e => e.location === '別教室');
  assert.equal(single.start.dateTime, '2026-11-17T13:00:00+09:00');
  // もう一度同期しても増えない
  await sync();
  assert.equal(g.events.size, 2);
  assert.equal(live().length, 2);
});

test('ほかのカレンダーへ移したら Google から消す・同期トークンが古ければ取り直す', async () => {
  const { store, g, sync, live } = setup();
  g.add({ id: 'a', summary: 'A', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } });
  g.add({ id: 'b', summary: 'B', start: { date: '2026-11-06' }, end: { date: '2026-11-07' } });
  await sync();
  const idA = live().find(e => e.title === 'A').id;
  store.transact('移動', tx => tx.put('events', { ...tx.get('events', idA), calendarId: 'default' }));
  await sync();
  assert.equal(g.remote('a').status, 'cancelled');
  assert.equal(store.state.events[idA].source.provider, 'local');
  assert.equal(store.state.events[idA].deletedAt, null);
  // 同期トークンが古い → 全部取り直し。Google に無いものは消える
  g.events.delete('b');
  store.transact('', tx => tx.put('calendars', { ...tx.get('calendars', 'cg'), source: { ...tx.get('calendars', 'cg').source, syncToken: 'expired' } }), { undoable: false });
  await sync();
  assert.deepEqual(live().filter(e => e.calendarId === 'cg').map(e => e.title), []);
  assert.equal(live().length, 1, 'アプリのカレンダーに移した予定は残る');
});

test('読み取り専用のカレンダー（祝日など）は送らない', async () => {
  const { store, g, sync, live } = setup();
  store.transact('', tx => tx.put('calendars', { ...tx.get('calendars', 'cg'), source: { ...tx.get('calendars', 'cg').source, accessRole: 'reader' } }), { undoable: false });
  g.add({ id: 'h', summary: '文化の日', start: { date: '2026-11-03' }, end: { date: '2026-11-04' } });
  await sync();
  assert.equal(live()[0].source.readOnly, true);
  assert.equal(g.log.filter(l => !l.startsWith('GET')).length, 0);
});
