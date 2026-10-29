import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/core/store.js';
import { createStorage, memoryBackend, KEYS } from '../js/core/storage.js';
import { newEvent } from '../js/core/model.js';
import { saveOccurrence, deleteOccurrence } from '../js/core/event-ops.js';
import { occurrencesInRange } from '../js/core/events.js';

const mk = () => { const st = createStorage(memoryBackend()); return { st, store: createStore(st) }; };

test('取り消し・やり直しと永続化', () => {
  const { st, store } = mk();
  const ev = newEvent({ id: 'x', title: 'A', start: '2026-10-29T10:00', end: '2026-10-29T11:00' });
  store.transact('追加', tx => tx.put('events', ev));
  store.transact('変更', tx => tx.put('events', { ...tx.get('events', 'x'), title: 'B' }));
  assert.equal(st.get(KEYS.events).x.title, 'B');
  store.undo();
  assert.equal(store.state.events.x.title, 'A');
  assert.equal(st.get(KEYS.events).x.title, 'A');
  store.undo();
  assert.equal(store.state.events.x, undefined);
  store.redo(); store.redo();
  assert.equal(store.state.events.x.title, 'B');
  assert.equal(store.canRedo(), false);
});

const series = () => newEvent({ id: 's', title: 'ゼミ', start: '2026-10-01T15:00', end: '2026-10-01T16:00', rrule: { freq: 'WEEKLY' } });
const occAt = (store, day) => occurrencesInRange(store.eventList(), day, day.replace(/\d\d$/, d => String(+d + 1).padStart(2, '0')))[0];

test('繰り返し: この予定のみ移動', () => {
  const { store } = mk();
  store.transact('', tx => tx.put('events', series()));
  const occ = occAt(store, '2026-10-15');
  store.transact('移動', tx => saveOccurrence(tx, occ, { start: '2026-10-16T10:00', end: '2026-10-16T11:00' }, 'this'));
  assert.equal(occAt(store, '2026-10-15'), undefined);
  assert.equal(occAt(store, '2026-10-16').start, '2026-10-16T10:00');
  assert.equal(occAt(store, '2026-10-22').start, '2026-10-22T15:00');
});

test('繰り返し: すべて（時刻変更はシリーズ全体に）', () => {
  const { store } = mk();
  store.transact('', tx => tx.put('events', series()));
  const occ = occAt(store, '2026-10-15');
  store.transact('', tx => saveOccurrence(tx, occ, { start: '2026-10-15T18:00', end: '2026-10-15T19:30' }, 'all'));
  assert.equal(store.state.events.s.start, '2026-10-01T18:00');
  assert.equal(occAt(store, '2026-10-22').end, '2026-10-22T19:30');
});

test('繰り返し: これ以降すべて・削除', () => {
  const { store } = mk();
  store.transact('', tx => tx.put('events', series()));
  store.transact('', tx => saveOccurrence(tx, occAt(store, '2026-10-15'), { title: '新ゼミ' }, 'following'));
  assert.equal(occAt(store, '2026-10-08').event.title, 'ゼミ');
  assert.equal(occAt(store, '2026-10-29').event.title, '新ゼミ');
  store.transact('', tx => deleteOccurrence(tx, occAt(store, '2026-10-22'), 'this'));
  assert.equal(occAt(store, '2026-10-22'), undefined);
  store.transact('', tx => deleteOccurrence(tx, occAt(store, '2026-10-08'), 'all'));
  assert.equal(occAt(store, '2026-10-01'), undefined);
  assert.equal(occAt(store, '2026-10-29').event.title, '新ゼミ');
});
