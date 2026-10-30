// Todo のタブの中の切り替え（Todo｜メモ）

import { app } from '../app.js';
import { h } from '../ui/dom.js';

export const todoMemoSwitch = current => h('div.segmented.small.sub-switch', [['todo', 'Todo'], ['memo', 'メモ']].map(([k, l]) =>
  h('button', { 'aria-selected': String(k === current), onclick: () => { if (k !== current) app.router.go({ page: k }, { push: false }); } }, l)));
