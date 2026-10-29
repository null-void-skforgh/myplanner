// タップ／長押しドラッグの共通処理（Pointer Events）
// タッチでは長押し（約350ms）でドラッグ開始。それまでに指が動いたら通常のスクロールに任せる。
// マウスでは少し動かした時点でドラッグ開始。

import { haptic } from './dom.js';

const LONG_PRESS_MS = 350;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;

let dragging = false;
// ドラッグ中はページのスクロールを止める（iOS Safari は non-passive の touchmove で止められる）
document.addEventListener('touchmove', e => { if (dragging) e.preventDefault(); }, { passive: false });

export const isDragging = () => dragging;

/**
 * @param {HTMLElement} container
 * @param {{
 *   resolve:(e:PointerEvent)=>any,            // 対象でなければ null
 *   onTap?:(ctx, e)=>void,
 *   onDragStart?:(ctx, e)=>({move(e,dx,dy), end(e,dx,dy), cancel?()}|null),
 *   longPressOnly?: boolean                   // マウスでも長押しを要求
 * }} opts
 */
export function attachPress(container, { resolve, onTap, onDragStart }) {
  let st = null;

  const reset = () => {
    if (st?.timer) clearTimeout(st.timer);
    st = null; dragging = false;
    container.classList.remove('is-dragging');
  };

  const begin = e => {
    clearTimeout(st.timer); st.timer = null;
    const session = onDragStart?.(st.ctx, st.down);
    if (!session) { st.dead = true; return; }
    st.session = session; dragging = true;
    container.classList.add('is-dragging');
    try { container.setPointerCapture(st.pointerId); } catch { /* noop */ }
    if (st.pointerType !== 'mouse') haptic();
    if (e) session.move(e, e.clientX - st.x, e.clientY - st.y);
  };

  container.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button > 0) return;
    const ctx = resolve(e);
    if (ctx == null) return;
    st = { ctx, x: e.clientX, y: e.clientY, down: e, pointerId: e.pointerId, pointerType: e.pointerType, moved: false };
    if (e.pointerType !== 'mouse' && onDragStart) st.timer = setTimeout(() => st && begin(null), LONG_PRESS_MS);
  });

  container.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.pointerId) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (st.session) { e.preventDefault(); st.session.move(e, dx, dy); return; }
    const dist = Math.hypot(dx, dy);
    if (st.pointerType === 'mouse') {
      if (dist > MOUSE_SLOP && onDragStart && !st.dead && e.buttons === 1) begin(e);
      if (dist > MOUSE_SLOP) st.moved = true;
    } else if (dist > TOUCH_SLOP) {
      st.moved = true; clearTimeout(st.timer); st.timer = null;
    }
  });

  container.addEventListener('pointerup', e => {
    if (!st || e.pointerId !== st.pointerId) return;
    const s = st;
    if (s.session) s.session.end(e, e.clientX - s.x, e.clientY - s.y);
    else if (!s.moved && !s.dead) onTap?.(s.ctx, e);
    reset();
  });

  container.addEventListener('pointercancel', () => { st?.session?.cancel?.(); reset(); });
  container.addEventListener('contextmenu', e => { if (resolve(e) != null) e.preventDefault(); });
}

/** 横スワイプで前後移動 */
export function attachSwipe(el, { onLeft, onRight }) {
  let sx = 0, sy = 0, t0 = 0, tracking = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { tracking = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now(); tracking = true;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!tracking || dragging) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - t0 < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onLeft : onRight)();
  }, { passive: true });
}
