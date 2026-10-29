// ダークモード（自動／ライト／ダーク）

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(setting) {
  const root = document.documentElement;
  if (setting === 'light' || setting === 'dark') root.dataset.theme = setting;
  else delete root.dataset.theme;
  const dark = setting === 'dark' || (setting !== 'light' && media.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16151f' : '#ffffff');
}

export function watchSystemTheme(getSetting) {
  media.addEventListener?.('change', () => applyTheme(getSetting()));
}
