// ============================================
// マイプランナー ウィジェット (Scriptable用・同期対応版)
// ============================================
// 【使い方】
// 1. App Storeで「Scriptable」を無料インストール
// 2. Scriptableを開いて「+」→ このコードを貼り付けて保存
//    ※ スクリプト名を必ず「マイプランナー」にしてください
// 3. アプリのウィジェットタブ →「Scriptableを開いて同期する」を押すと自動反映
// ============================================

const STORAGE_KEY = "myplanner_todos";

function loadTodos() {
  try {
    const r = Keychain.contains(STORAGE_KEY) ? Keychain.get(STORAGE_KEY) : null;
    if (!r) return [{ id: 1, text: "アプリから同期してください", done: false, due: null }];
    return JSON.parse(r);
  } catch { return []; }
}

function saveTodos(t) {
  Keychain.set(STORAGE_KEY, JSON.stringify(t));
}

function isUrgent(due) {
  if (!due) return false;
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(due); d.setHours(0,0,0,0);
  return (d - t) / 86400000 <= 1;
}
function isOverdue(due) {
  if (!due) return false;
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(due); d.setHours(0,0,0,0);
  return d < t;
}
function dueLabel(due) {
  if (!due) return "";
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(due); d.setHours(0,0,0,0);
  const diff = Math.round((d - t) / 86400000);
  if (diff < 0) return "期限切れ";
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  return due.slice(5).replace("-", "/") + "まで";
}

// ── URLから同期データを受け取る ──
const args = URLScheme.allParameters();
if (args && args.action === "sync" && args.todos) {
  try {
    const synced = JSON.parse(decodeURIComponent(args.todos));
    saveTodos(synced);
    // 同期完了通知
    const alert = new Alert();
    alert.title = "✅ 同期完了";
    alert.message = `${synced.length}件のTodoを更新しました。\nウィジェットに反映されます。`;
    alert.addAction("OK");
    await alert.presentAlert();
  } catch(e) {
    const alert = new Alert();
    alert.title = "❌ 同期エラー";
    alert.message = "データの受け取りに失敗しました。";
    alert.addAction("OK");
    await alert.presentAlert();
  }
  Script.complete();
  return;
}

// ── アプリとして起動した場合 ──
async function runAsApp() {
  const todos = loadTodos();
  const active = todos.filter(t => !t.done);
  const urgent = active.filter(t => isUrgent(t.due));
  const normal = active.filter(t => !isUrgent(t.due));
  const done   = todos.filter(t => t.done);

  let msg = "";
  if (urgent.length > 0)
    msg += "🔴 急ぎ:\n" + urgent.map(t => `・${t.text}（${dueLabel(t.due)}）`).join("\n") + "\n\n";
  if (normal.length > 0)
    msg += "📌 Todo:\n" + normal.map((t, i) => `${i+1}. ${t.text}${t.due ? `（${dueLabel(t.due)}）` : ""}`).join("\n");
  if (active.length === 0) msg = "✅ 未完了タスクはありません";

  const alert = new Alert();
  alert.title = "📋 Todoリスト";
  alert.message = msg.trim();
  alert.addAction("✅ 完了済みを削除（" + done.length + "件）");
  alert.addCancelAction("閉じる");

  const idx = await alert.presentAlert();
  if (idx === 0) {
    saveTodos(todos.filter(t => !t.done));
    await runAsApp();
  }
}

// ── ウィジェット描画 ──
function buildWidget(todos) {
  const active   = todos.filter(t => !t.done);
  const urgent   = active.filter(t => isUrgent(t.due));
  const normal   = active.filter(t => !isUrgent(t.due));
  const doneCount = todos.filter(t => t.done).length;

  const w = new ListWidget();
  w.backgroundColor = new Color("#1e1d2e");
  w.setPadding(12, 14, 10, 14);

  const h = w.addStack();
  h.layoutHorizontally(); h.centerAlignContent();
  const ti = h.addText("📋 Todoリスト");
  ti.font = Font.boldSystemFont(13);
  ti.textColor = new Color("#9f97f0");
  h.addSpacer();
  const b = h.addText(active.length + "件");
  b.font = Font.mediumSystemFont(12);
  b.textColor = new Color("#aaa9c0");

  if (urgent.length > 0) {
    w.addSpacer(8);
    const ul = w.addText("🔴 急ぎ（1日以内）");
    ul.font = Font.boldSystemFont(11);
    ul.textColor = new Color("#e87aa0");
    w.addSpacer(4);
    for (const t of urgent.slice(0, 3)) {
      const r = w.addStack();
      r.layoutHorizontally(); r.centerAlignContent(); r.spacing = 6;
      const dot = r.addText(isOverdue(t.due) ? "‼️" : "⚠️");
      dot.font = Font.systemFont(12);
      const l = r.addText(t.text);
      l.font = Font.systemFont(12); l.textColor = new Color("#f0eff9"); l.lineLimit = 1;
      r.addSpacer();
      const dl = r.addText(dueLabel(t.due));
      dl.font = Font.systemFont(10);
      dl.textColor = isOverdue(t.due) ? new Color("#e87aa0") : new Color("#EF9F27");
      w.addSpacer(4);
    }
    if (urgent.length > 3) {
      const m = w.addText("  他 " + (urgent.length - 3) + " 件...");
      m.font = Font.systemFont(10); m.textColor = new Color("#5a596e");
    }
  }

  if (normal.length > 0) {
    w.addSpacer(urgent.length > 0 ? 6 : 8);
    if (urgent.length > 0) {
      const nl = w.addText("📌 Todo");
      nl.font = Font.boldSystemFont(11); nl.textColor = new Color("#9f97f0");
      w.addSpacer(4);
    }
    const max = urgent.length > 0 ? 2 : 5;
    for (const t of normal.slice(0, max)) {
      const r = w.addStack();
      r.layoutHorizontally(); r.centerAlignContent(); r.spacing = 6;
      const dot = r.addText("○");
      dot.font = Font.systemFont(12); dot.textColor = new Color("#7F77DD");
      const l = r.addText(t.text);
      l.font = Font.systemFont(12); l.textColor = new Color("#f0eff9"); l.lineLimit = 1;
      if (t.due) {
        r.addSpacer();
        const dl = r.addText(dueLabel(t.due));
        dl.font = Font.systemFont(10); dl.textColor = new Color("#aaa9c0");
      }
      w.addSpacer(4);
    }
    if (normal.length > max) {
      const m = w.addText("  他 " + (normal.length - max) + " 件...");
      m.font = Font.systemFont(10); m.textColor = new Color("#5a596e");
    }
  }

  if (active.length === 0) {
    w.addSpacer(8);
    const e = w.addText("✅ すべて完了！");
    e.font = Font.systemFont(13); e.textColor = new Color("#5a596e");
  }

  w.addSpacer();
  const f = w.addStack();
  f.layoutHorizontally();
  const hint = f.addText("タップして管理");
  hint.font = Font.systemFont(10); hint.textColor = new Color("#7F77DD");
  f.addSpacer();
  if (doneCount > 0) {
    const dt = f.addText("完了 " + doneCount + "件");
    dt.font = Font.systemFont(10); dt.textColor = new Color("#5a596e");
  }
  return w;
}

// ── メイン ──
const todos = loadTodos();
if (config.runsInWidget) {
  Script.setWidget(buildWidget(todos));
} else {
  await runAsApp();
  await buildWidget(loadTodos()).presentMedium();
}
Script.complete();
