// シラバスのシート：授業カタログで探す／見つけたページの URL を覚える

import { h } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { searchUrl, savedUrl, saveUrl, cleanUrl } from '../features/syllabus.js';

export const openUrl = url => { const w = window.open(url, '_blank'); if (!w) location.href = url; };

/** ボタンから：覚えていればすぐ開く、なければシートを出す */
export function openSyllabus(title, onChange) {
  const url = savedUrl(title);
  if (url) openUrl(url); else openSyllabusSheet(title, onChange);
}

export function openSyllabusSheet(title, onChange) {
  const url = savedUrl(title);
  const urlIn = h('input.input', { type: 'url', placeholder: 'https://catalog.he.u-tokyo.ac.jp/detail?…', value: url || '', autocomplete: 'off', autocapitalize: 'off' });
  const save = () => {
    const v = urlIn.value.trim();
    if (v && !cleanUrl(v)) { toast('URL を貼ってください（https:// で始まるもの）'); return; }
    saveUrl(title, v ? cleanUrl(v) : null);
    toast(v ? `「${title}」のシラバスを覚えました` : 'シラバスの URL を消しました');
    onChange?.();
    sheet.close();
  };
  const sheet = openSheet({
    title: '📘 シラバス',
    headerRight: h('button.pill-btn.primary', { onclick: save }, '保存'),
    content: h('div.form',
      h('div.quick-result', h('div.quick-title', title || '(科目名なし)')),
      url && h('button.btn.wide', { onclick: () => openUrl(url) }, 'シラバスを開く'),
      h('button.btn' + (url ? '.secondary' : '') + '.wide', { onclick: () => openUrl(searchUrl(title)) }, '授業カタログで検索する'),
      h('div.field', h('div.field-label', 'シラバスのページの URL'), urlIn,
        h('p.note', '検索結果から授業のページを開き、Safari の共有ボタン →「コピー」で URL をコピーして、ここに貼ってください。次からは「📘 シラバス」ですぐ開けます（同じ科目名の予定すべて）。'))),
  });
}
