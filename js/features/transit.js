// 乗換案内：Yahoo!乗換案内 / Google マップを、条件を入れた状態で開く（無料・登録不要）

import { app } from '../app.js';
import { dtDate, dtTime, addMinutes } from '../core/date.js';

export const DEFAULT_MARGIN = 5;

/**
 * Yahoo!乗換案内の検索結果の URL
 * @param {{from:string, to:string, dt?:string, mode?:'arrive'|'depart'}} p  dt は 'YYYY-MM-DDTHH:mm'（なければ今から出発）
 */
export function yahooUrl({ from, to, dt, mode = 'arrive' }) {
  const q = new URLSearchParams({ from: from.trim(), to: to.trim() });
  if (dt) {
    const [y, m, d] = dtDate(dt).split('-');
    const [hh, mi] = dtTime(dt).split(':');
    q.set('y', y); q.set('m', m); q.set('d', d); q.set('hh', String(+hh));
    q.set('m1', mi[0]); q.set('m2', mi[1]);
    q.set('type', mode === 'arrive' ? '4' : '1'); // 4 = 到着時刻で検索、1 = 出発時刻で検索
  }
  return `https://transit.yahoo.co.jp/search/result?${q}`;
}

/** Google マップの経路（電車）。時刻は指定できないので、住所や建物名で調べたいとき用 */
export const googleMapsUrl = ({ from, to }) =>
  `https://www.google.com/maps/dir/?api=1&${new URLSearchParams({ origin: from.trim(), destination: to.trim(), travelmode: 'transit' })}`;

/** 到着したい時刻（開始の◯分前） */
export const arriveBy = (startDT, margin = DEFAULT_MARGIN) => addMinutes(startDT, -margin);

// ── 覚えておくもの（設定に保存） ──
const S = () => app.store.state.settings;
export const homeStation = () => S().homeStation || '';
export const margin = () => S().arriveMargin ?? DEFAULT_MARGIN;
/** 予定の場所 → 調べるときの行き先（例：「工2-213」→「本郷三丁目」） */
export const stationFor = place => (place && S().placeStations?.[place.trim()]) || place || '';
export const recentOrigins = () => S().recentOrigins || [];

export function remember({ place, to, from }) {
  const s = S();
  const patch = {};
  if (place && to && to.trim() !== place.trim()) patch.placeStations = { ...(s.placeStations || {}), [place.trim()]: to.trim() };
  if (from && from.trim() !== (s.homeStation || '')) patch.recentOrigins = [from.trim(), ...recentOrigins().filter(x => x !== from.trim())].slice(0, 5);
  if (Object.keys(patch).length) app.store.setSettings(patch);
}
