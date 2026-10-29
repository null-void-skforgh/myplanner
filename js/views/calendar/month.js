// 月表示：複数日の予定は帯で表示。長押しで別の日へドラッグ。

import { app } from '../../app.js';
import { h, clear } from '../../ui/dom.js';
import { attachPress } from '../../ui/gesture.js';
import { addDays, diffDays, startOfMonth, startOfWeek, dayOfWeek, todayKey, daysInMonth, parts, DAY_LABELS, fmtTime } from '../../core/date.js';
import { shiftTimes } from '../../core/events.js';
import { collectItems, layoutLanes } from './items.js';
import { updateOccurrence } from './actions.js';
import { updateTodo } from '../../features/todo-actions.js';

const LANE_H = 17;
const NUM_H = 22;

export function renderMonth(root, { date, weekStart }) {
  const first = startOfMonth(date);
  const gridStart = startOfWeek(first, weekStart);
  const { y, m } = parts(first);
  const rows = Math.ceil((diffDays(gridStart, first) + daysInMonth(y, m)) / 7);
  const gridEnd = addDays(gridStart, rows * 7);
  const today = todayKey();
  const items = collectItems(gridStart, gridEnd);

  const head = h('div.month-wd', Array.from({ length: 7 }, (_, i) => {
    const wd = (weekStart + i) % 7;
    return h('div' + (wd === 0 ? '.sun' : wd === 6 ? '.sat' : ''), DAY_LABELS[wd]);
  }));

  const weeks = [];
  for (let r = 0; r < rows; r++) {
    const ws = addDays(gridStart, r * 7);
    const cells = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(ws, i);
      const wd = dayOfWeek(day);
      const cls = ['mday', day.slice(0, 7) !== first.slice(0, 7) && 'other', day === today && 'today',
        wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join('.');
      return h('div.' + cls, { dataset: { day } }, h('span.mday-num', String(+day.slice(8))));
    });
    weeks.push(h('div.mweek', { dataset: { ws } }, h('div.mweek-cells', cells), h('div.mweek-events')));
  }
  const body = h('div.month-body', weeks);
  clear(root, h('div.month', head, body));

  const place = () => placeEvents(body, items, weekStart);
  requestAnimationFrame(place);
  root._relayout = place;
  bindInteractions(body, new Map(items.map(it => [it.key, it])));
}

function placeEvents(body, items, weekStart) {
  for (const row of body.children) {
    const layer = row.querySelector('.mweek-events');
    layer.replaceChildren();
    const ws = row.dataset.ws;
    const maxLanes = Math.max(1, Math.floor((row.clientHeight - NUM_H - 2) / LANE_H));
    const { segs } = layoutLanes(items, ws);
    // 日ごとの件数
    const perDay = Array(7).fill(0);
    for (const sg of segs) for (let c = sg.col; c < sg.col + sg.span; c++) perDay[c]++;
    const overflow = perDay.map(n => n > maxLanes);
    const shown = Array(7).fill(0);
    for (const sg of segs) {
      const lastLane = sg.lane === maxLanes - 1;
      const fits = sg.lane < maxLanes - 1 || (lastLane && !overflow.slice(sg.col, sg.col + sg.span).some(Boolean));
      if (!fits) continue;
      for (let c = sg.col; c < sg.col + sg.span; c++) shown[c]++;
      layer.appendChild(renderSeg(sg));
    }
    perDay.forEach((n, c) => {
      if (n > shown[c]) layer.appendChild(h('div.mmore', {
        style: { left: `calc(${c} * 100% / 7)`, top: `${NUM_H + (maxLanes - 1) * LANE_H}px` },
        dataset: { day: addDays(ws, c) },
      }, `+${n - shown[c]}`));
    });
  }
}

function renderSeg(sg) {
  const { it } = sg;
  const style = { left: `calc(${sg.col} * 100% / 7)`, width: `calc(${sg.span} * 100% / 7 - 2px)`, top: `${NUM_H + sg.lane * LANE_H}px` };
  // 日をまたぐ時間指定の予定も帯で表示する
  const asBar = it.bar || sg.span > 1 || sg.contLeft || sg.contRight;
  const cls = it.kind === 'todo' ? 'mev.todo' : asBar ? `mev.bar.c${it.color}` : `mev.dot.c${it.color}`;
  return h('div.' + cls + (sg.contLeft ? '.cont-l' : '') + (sg.contRight ? '.cont-r' : ''),
    { style, dataset: { key: it.key } },
    it.kind === 'todo' ? h('span.mev-check') : !asBar && h('span.mev-dot'),
    !asBar && it.kind === 'event' && h('span.mev-time', fmtTime(it.start)),
    h('span.mev-title', it.title));
}

function bindInteractions(body, byKey) {
  const itemOf = el => byKey.get(el.dataset.key) || null;

  attachPress(body, {
    resolve(e) {
      const ev = e.target.closest('.mev');
      if (ev) return { type: 'item', el: ev };
      const more = e.target.closest('.mmore');
      if (more) return { type: 'more', day: more.dataset.day };
      const day = dayAt(body, e.clientX, e.clientY);
      return day ? { type: 'day', day } : null;
    },
    onTap(ctx) {
      if (ctx.type === 'item') {
        const it = itemOf(ctx.el);
        if (!it) return;
        if (it.kind === 'todo') app.openTodoEditor(it.todo); else app.openEventEditor(it.occ);
      } else {
        app.router.go({ view: 'day', date: ctx.day }, { push: true });
      }
    },
    onDragStart(ctx) {
      if (ctx.type === 'day') { app.openQuickAdd({ baseDate: ctx.day }); return null; }
      if (ctx.type !== 'item') return null;
      const it = itemOf(ctx.el);
      if (!it) return null;
      return dragItem(body, ctx.el, it);
    },
  });
}

function dayAt(body, x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.classList?.contains('mday')) return el.dataset.day;
  }
  return null;
}

/** 帯をつまんで別の日へ */
function dragItem(body, el, it) {
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', margin: 0 });
  document.body.appendChild(ghost);
  el.classList.add('drag-source');
  let originDay = null, target = null;
  const highlight = day => {
    body.querySelectorAll('.mday.drop').forEach(c => c.classList.remove('drop'));
    if (day) body.querySelector(`.mday[data-day="${day}"]`)?.classList.add('drop');
  };
  const cleanup = () => { ghost.remove(); el.classList.remove('drag-source'); highlight(null); };
  return {
    move(e, dx, dy) {
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
      const d = dayAt(body, e.clientX, e.clientY);
      originDay ??= dayAt(body, e.clientX - dx, e.clientY - dy);
      if (d) { target = d; highlight(d); }
    },
    async end() {
      cleanup();
      if (!target || !originDay || target === originDay) return;
      const delta = diffDays(originDay, target);
      if (it.kind === 'todo') {
        updateTodo(it.todo.id, { due: addDays(it.todo.due, delta) }, `「${it.title}」の期限を変更しました`);
      } else {
        await updateOccurrence(it.occ, shiftTimes(it.occ, delta), `「${it.title}」を移動しました`);
      }
    },
    cancel: cleanup,
  };
}
