// デプロイ前に実行：node tools/bump-version.mjs [新バージョン]
//  - js/version.js と sw.js の VERSION をそろえる（省略時はパッチ番号を +1）
//  - sw.js の事前キャッシュ一覧（ASSETS）を実ファイルから作り直す
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function listAssets() {
  const walk = dir => readdirSync(join(root, dir)).flatMap(f => {
    const p = join(dir, f);
    return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
  });
  return ['./', 'index.html', 'manifest.webmanifest', ...['css', 'js', 'icons'].flatMap(walk)]
    .map(p => p.split('\\').join('/'))
    .filter(p => !p.endsWith('.DS_Store'))
    .sort((a, b) => (a === './' ? -1 : b === './' ? 1 : a.localeCompare(b)));
}

export function currentVersion() {
  return readFileSync(join(root, 'js/version.js'), 'utf8').match(/VERSION = '([^']+)'/)[1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cur = currentVersion();
  const next = process.argv[2] || cur.replace(/(\d+)$/, n => String(+n + 1));
  writeFileSync(join(root, 'js/version.js'), readFileSync(join(root, 'js/version.js'), 'utf8').replace(/VERSION = '[^']+'/, `VERSION = '${next}'`));
  let sw = readFileSync(join(root, 'sw.js'), 'utf8');
  sw = sw.replace(/const VERSION = '[^']+';/, `const VERSION = '${next}';`);
  sw = sw.replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = [\n${listAssets().map(a => `  '${a}',`).join('\n')}\n];`);
  writeFileSync(join(root, 'sw.js'), sw);
  console.log(`${cur} → ${next}（キャッシュ対象 ${listAssets().length} ファイル）`);
}
