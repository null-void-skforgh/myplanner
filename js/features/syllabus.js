// シラバス：授業の予定から大学の授業カタログ（シラバス）を開く
// 科目名ごとに URL を覚える（settings.syllabusUrls）。覚えていなければ授業カタログを科目名で検索する。

import { app } from '../app.js';

/** 東京大学授業カタログの検索（{q} に科目名が入る） */
export const DEFAULT_SEARCH = 'https://catalog.he.u-tokyo.ac.jp/result?q={q}';

/** 科目名 → 覚えるときのキー（「（補講）」などの付け足しや空白の違いを無視する） */
export const subjectKey = title => String(title || '').replace(/[（(][^）)]*[）)]\s*$/, '').replace(/\s+/g, '').trim();

export const searchUrl = (title, tpl = DEFAULT_SEARCH) => tpl.replace('{q}', encodeURIComponent(String(title || '').replace(/[（(][^）)]*[）)]\s*$/, '').trim()));

export const savedUrl = title => app.store.state.settings.syllabusUrls?.[subjectKey(title)] || null;

export function saveUrl(title, url) {
  const all = { ...(app.store.state.settings.syllabusUrls || {}) };
  if (url) all[subjectKey(title)] = url; else delete all[subjectKey(title)];
  app.store.setSettings({ syllabusUrls: all });
}

/** 文章の中の URL を取り出す（メモ欄のリンク用） */
export function findUrls(text) {
  // URL に使える文字（ASCII）だけ。直後に日本語が続いても切り離す
  return [...new Set((String(text || '').match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]+/g) || []).map(u => u.replace(/[.,;:!?')\]]+$/, '')))];
}

/** 貼られた文字から URL だけを取り出す（「…のシラバス https://…」のような貼り付けにも対応） */
export const cleanUrl = s => findUrls(s)[0] || null;
