// 週・日表示（時間グリッド）
//  - 予定を長押し → 上下左右にドラッグで時刻・日を変更
//  - 予定の下端のつまみを長押し → 長さを変更
//  - 空いている所を長押し → そのまま下へなぞって長さを決め、新しい予定を作成
// 15分単位で吸着する。

import { app } from '../../app.js';
import { h, clear } from '../../ui/dom.js';
import { attachPress } from '../../ui/gesture.js';
import { addDays, dayOfWeek, todayKey, startOfWeek, makeDT, addMinutes, diffMinutes, dtDate, dtTime, DAY_LABELS, fmtTime, minToTime } from '../../core/date.js';
import { shiftTimes, clipToDay, occTouches } from '../../core/events.js';
import { collectItems, layoutLanes, layoutColumns } from './items.js';
import { updateOccurrence } from './actions.js';
import { updateTodo } from '../../features/todo-actions.js';

export const HOUR_H = 52;
const SNAP = 15;
const ALLDAY_LANE_H = 20;
const snap = m => Math.round(m / SNAP) * SNAP;
const yToMin = y => (y / HOUR_H) * 60;

export function renderTimeGrid(root, { date, view, weekStart, dayStartHour }) {
  const days = view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date, weekStart), i));
  const from = days[0], to = addDays(days.at(-1), 1);
  const today = todayKey();
  const items = collectItems(from, to);
  const byKey = new Map(items.map(it => [it.key, it]));
  const n = days.length;
  const colsTpl = { gridTemplateColumns: `var(--gutter) repeat(${n}, 1fr)` };

  // ── 見出し ──
  const head = h('div.tg-head', { style: colsTpl }, h('div'),
    days.map(d => {
      const wd = dayOfWeek(d);
      return h('button.tg-dayhead' + (d === today ? '.today' : '') + (wd === 0 ? '.sun' : wd === 6 ? '.sat' : ''),
        { dataset: { day: d }, onclick: () => view === 'week' && app.router.go({ view: 'day', date: d }, { push: true }) },
        h('span.tg-wd', DAY_LABELS[wd]), h('span.tg-num', String(+d.slice(8))));
    }));

  // ── 終日欄 ──
  const barItems = items.filter(it => it.bar);
  const { segs, laneCount } = layoutLanes(barItems, from, n);
  const alldayLayer = h('div.tg-allday-layer', { style: { height: `${Math.max(1, laneCount) * ALLDAY_LANE_H + 4}px` } },
    segs.map(sg => {
      const it = sg.it;
      const cls = it.kind === 'todo' ? 'tev-bar.todo' : `tev-bar.c${it.color}`;
      return h('div.' + cls + (sg.contLeft ? '.cont-l' : '') + (sg.contRight ? '.cont-r' : ''), {
        dataset: { key: it.key },
        style: { left: `calc(${sg.col} * 100% / ${n})`, width: `calc(${sg.span} * 100% / ${n} - 2px)`, top: `${sg.lane * ALLDAY_LANE_H + 2}px` },
      }, it.kind === 'todo' && h('span.mev-check'), it.title, it.kind === 'todo' && it.time ? ` ${it.time}` : '');
    }));
  const allday = h('div.tg-allday', { style: colsTpl }, h('div.tg-allday-label', '終日'), alldayLayer);
  alldayLayer.style.gridColumn = `2 / span ${n}`;

  // ── 時間帯 ──
  const gutter = h('div.tg-gutter', Array.from({ length: 24 }, (_, hr) => h('div.tg-hour', hr ? `${hr}:00` : '')));
  const cols = days.map(d => {
    const blocks = items.filter(it => !it.bar && it.kind === 'event' && occTouches(it.occ, d))
      .map(it => ({ it, ...clipToDay(it.occ, d) }));
    layoutColumns(blocks);
    const col = h('div.tg-col' + (d === today ? '.today' : ''), { dataset: { day: d } },
      blocks.map(b => renderBlock(b, d)));
    if (d === today) {
      const now = new Date();
      col.appendChild(h('div.tg-now', { style: { top: `${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H}px` } }));
    }
    return col;
  });
  const colsEl = h('div.tg-cols', { style: { gridTemplateColumns: `repeat(${n}, 1fr)` } }, cols);
  const canvas = h('div.tg-canvas', { style: { height: `${24 * HOUR_H}px` } }, gutter, colsEl);
  const scroller = h('div.tg-scroll', canvas);

  const prevScroll = root._tgScroll;
  clear(root, h('div.tg.' + view, head, allday, scroller));

  // スクロール位置：同じ画面の再描画なら維持、それ以外は今の時刻（今日を含む場合）か既定の時刻へ
  const key = view + from;
  if (prevScroll && prevScroll.key === key) scroller.scrollTop = prevScroll.top;
  else {
    const now = new Date();
    const hr = days.includes(today) ? Math.max(0, now.getHours() - 1) : dayStartHour;
    scroller.scrollTop = hr * HOUR_H;
  }
  scroller.addEventListener('scroll', () => { root._tgScroll = { key, top: scroller.scrollTop }; }, { passive: true });
  root._tgScroll = { key, top: scroller.scrollTop };

  const ctx = { root, days, colsEl, scroller, byKey, view };
  bindGrid(ctx);
  bindAllday(alldayLayer, ctx);
}

function renderBlock(b, day) {
  const { it } = b;
  const heightMin = b.bottom - b.top;
  const style = {
    top: `${b.top / 60 * HOUR_H}px`, height: `${Math.max(heightMin / 60 * HOUR_H - 2, 14)}px`,
    left: `calc(${b.col} * 100% / ${b.cols})`, width: `calc(100% / ${b.cols} - 3px)`,
  };
  const short = heightMin < 45;
  const occ = it.occ;
  const endsHere = dtDate(occ.end) === day || (dtTime(occ.end) === '00:00' && dtDate(occ.end) === addDays(day, 1));
  return h(`div.tev.c${it.color}` + (short ? '.short' : '') + (b.cols > 1 ? '.split' : ''), { style, dataset: { key: it.key, day } },
    h('div.tev-title', it.title),
    h('div.tev-time', `${fmtTime(occ.start)}〜${fmtTime(occ.end)}`),
    !short && occ.event.location && h('div.tev-loc', occ.event.location),
    endsHere && h('div.tev-handle', { 'aria-label': '長さを変更' }));
}

// ── 操作 ──
function colIndexAt(ctx, x) {
  const r = ctx.colsEl.getBoundingClientRect();
  const i = Math.floor((x - r.left) / (r.width / ctx.days.length));
  return Math.min(ctx.days.length - 1, Math.max(0, i));
}
const minuteAt = (ctx, y) => yToMin(y - ctx.colsEl.getBoundingClientRect().top);

/** ドラッグ中、上下の端に指があれば自動でスクロール */
function autoScroller(ctx, onTick) {
  let raf = 0, lastY = null, lastE = null;
  const loop = () => {
    raf = 0;
    if (lastY == null) return;
    const r = ctx.scroller.getBoundingClientRect();
    const edge = 44;
    let v = 0;
    if (lastY < r.top + edge) v = -Math.ceil((r.top + edge - lastY) / 4);
    else if (lastY > r.bottom - edge) v = Math.ceil((lastY - (r.bottom - edge)) / 4);
    if (v) { ctx.scroller.scrollTop += v; onTick(lastE); raf = requestAnimationFrame(loop); }
  };
  return {
    update(e) { lastY = e.clientY; lastE = e; if (!raf) raf = requestAnimationFrame(loop); },
    stop() { lastY = null; cancelAnimationFrame(raf); raf = 0; },
  };
}

function bindGrid(ctx) {
  attachPress(ctx.colsEl, {
    resolve(e) {
      const el = e.target.closest('.tev');
      if (el) return { type: 'event', el, it: ctx.byKey.get(el.dataset.key), handle: !!e.target.closest('.tev-handle') };
      if (e.target.closest('.tg-col')) return { type: 'slot' };
      return null;
    },
    onTap(c) {
      if (c.type !== 'event' || !c.it) return;
      if (c.it.kind === 'todo') app.openTodoEditor(c.it.todo); else app.openEventEditor(c.it.occ);
    },
    onDragStart(c, down) {
      if (c.type === 'slot') return createSession(ctx, down);
      if (!c.it || c.it.kind !== 'event') return null;
      return c.handle ? resizeSession(ctx, c, down) : moveSession(ctx, c, down);
    },
  });
}

function moveSession(ctx, c, down) {
  const { el, it } = c;
  const occ = it.occ;
  const m0 = minuteAt(ctx, down.clientY), d0 = colIndexAt(ctx, down.clientX);
  const colW = ctx.colsEl.getBoundingClientRect().width / ctx.days.length;
  let dMin = 0, dDay = 0;
  el.classList.add('dragging');
  const timeEl = el.querySelector('.tev-time');
  const update = e => {
    dMin = snap(minuteAt(ctx, e.clientY) - m0);
    dDay = ctx.view === 'week' ? colIndexAt(ctx, e.clientX) - d0 : 0;
    el.style.transform = `translate(${dDay * colW}px, ${dMin / 60 * HOUR_H}px)`;
    const t = shiftTimes(occ, dDay, dMin);
    timeEl.textContent = `${fmtTime(t.start)}〜${fmtTime(t.end)}`;
  };
  const auto = autoScroller(ctx, update);
  const reset = () => { auto.stop(); el.classList.remove('dragging'); el.style.transform = ''; };
  return {
    move(e) { update(e); auto.update(e); },
    async end() {
      auto.stop();
      if (!dMin && !dDay) { reset(); return; }
      const ok = await updateOccurrence(occ, shiftTimes(occ, dDay, dMin), `「${it.title}」を移動しました`);
      if (!ok) reset();
    },
    cancel: reset,
  };
}

function resizeSession(ctx, c, down) {
  const { el, it } = c;
  const occ = it.occ;
  const m0 = minuteAt(ctx, down.clientY);
  const h0 = el.getBoundingClientRect().height;
  let newEnd = occ.end;
  el.classList.add('resizing');
  const timeEl = el.querySelector('.tev-time');
  const update = e => {
    const d = snap(minuteAt(ctx, e.clientY) - m0);
    let end = addMinutes(occ.end, d);
    if (end <= addMinutes(occ.start, SNAP - 1)) end = addMinutes(occ.start, SNAP);
    newEnd = end;
    const extra = diffMinutes(occ.end, end);
    el.style.height = `${Math.max(14, h0 + extra / 60 * HOUR_H)}px`;
    timeEl.textContent = `${fmtTime(occ.start)}〜${fmtTime(end)}`;
  };
  const auto = autoScroller(ctx, update);
  const reset = () => { auto.stop(); el.classList.remove('resizing'); el.style.height = `${h0}px`; };
  return {
    move(e) { update(e); auto.update(e); },
    async end() {
      auto.stop();
      if (newEnd === occ.end) { reset(); return; }
      const ok = await updateOccurrence(occ, { start: occ.start, end: newEnd }, `「${it.title}」の長さを変更しました`);
      if (!ok) reset();
    },
    cancel: reset,
  };
}

function createSession(ctx, down) {
  const dayIdx = colIndexAt(ctx, down.clientX);
  const day = ctx.days[dayIdx];
  const startMin = Math.min(1440 - SNAP, Math.floor(minuteAt(ctx, down.clientY) / SNAP) * SNAP);
  let endMin = startMin + 60;
  const col = ctx.colsEl.children[dayIdx];
  const ghost = h('div.tev.c0.ghost', { style: { left: '0', width: 'calc(100% - 3px)' } },
    h('div.tev-title', '新しい予定'), h('div.tev-time'));
  const draw = () => {
    Object.assign(ghost.style, { top: `${startMin / 60 * HOUR_H}px`, height: `${(endMin - startMin) / 60 * HOUR_H - 2}px` });
    ghost.lastChild.textContent = `${minToTime(startMin)}〜${minToTime(Math.min(endMin, 1440))}`;
  };
  draw(); col.appendChild(ghost);
  let moved = false;
  const update = e => {
    const m = Math.ceil(minuteAt(ctx, e.clientY) / SNAP) * SNAP;
    if (m > startMin + SNAP || moved) { moved = true; endMin = Math.min(1440, Math.max(startMin + SNAP, m)); }
    draw();
  };
  const auto = autoScroller(ctx, update);
  return {
    move(e) { update(e); auto.update(e); },
    end() {
      auto.stop();
      ghost.remove();
      app.openEventEditor({ draft: { allDay: false, start: makeDT(day, startMin), end: makeDT(day, endMin) } });
    },
    cancel() { auto.stop(); ghost.remove(); },
  };
}

/** 終日欄：タップで開く、長押しで横（別の日）へ移動 */
function bindAllday(layer, ctx) {
  const dayIdxAt = x => {
    const r = layer.getBoundingClientRect();
    return Math.min(ctx.days.length - 1, Math.max(0, Math.floor((x - r.left) / (r.width / ctx.days.length))));
  };
  attachPress(layer, {
    resolve(e) {
      const el = e.target.closest('.tev-bar');
      if (el) return { type: 'item', el, it: ctx.byKey.get(el.dataset.key) };
      return { type: 'empty' };
    },
    onTap(c, e) {
      if (c.type === 'empty') { app.openEventEditor({ draft: { allDay: true, start: ctx.days[dayIdxAt(e.clientX)], end: addDays(ctx.days[dayIdxAt(e.clientX)], 1) } }); return; }
      if (!c.it) return;
      if (c.it.kind === 'todo') app.openTodoEditor(c.it.todo); else app.openEventEditor(c.it.occ);
    },
    onDragStart(c, down) {
      if (c.type !== 'item' || !c.it || ctx.view !== 'week') return null;
      const { el, it } = c;
      const d0 = dayIdxAt(down.clientX);
      const colW = layer.getBoundingClientRect().width / ctx.days.length;
      let dd = 0;
      el.classList.add('dragging');
      const reset = () => { el.classList.remove('dragging'); el.style.transform = ''; };
      return {
        move(e) { dd = dayIdxAt(e.clientX) - d0; el.style.transform = `translateX(${dd * colW}px)`; },
        async end() {
          if (!dd) return reset();
          let ok = true;
          if (it.kind === 'todo') updateTodo(it.todo.id, { due: addDays(it.todo.due, dd) }, `「${it.title}」の期限を変更しました`);
          else ok = await updateOccurrence(it.occ, shiftTimes(it.occ, dd), `「${it.title}」を移動しました`);
          if (!ok) reset();
        },
        cancel: reset,
      };
    },
  });
}
