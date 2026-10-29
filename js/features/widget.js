// Scriptable ウィジェット連携（旧アプリから移植。ウィジェット側のコードは互換を保つ）

const SCRIPT_NAME = 'マイプランナー';

/** ウィジェットに渡す形（旧アプリと同じ項目だけ） */
export function widgetTodos(todos) {
  return todos.filter(t => !t.done).map(({ id, text, done, due, start, end }) => ({ id, text, done, due, start, end }));
}

/** Scriptable を開いて未完了の Todo を同期する */
export function syncToScriptable(todos) {
  const data = encodeURIComponent(JSON.stringify(widgetTodos(todos)));
  window.location.href = `scriptable:///run/${encodeURIComponent(SCRIPT_NAME)}?action=sync&todos=${data}`;
}

// 以下の生成コードは旧アプリ（v1）と同一
export function generateWidgetCode(todos, embedTodos) {
  const todosJson = embedTodos ? JSON.stringify(widgetTodos(todos)) : '[]';
  return `// マイプランナー ウィジェット (Scriptable用)
const STORAGE_KEY = "myplanner_todos";
${embedTodos ? `const EXPORTED=${todosJson};if(!Keychain.contains(STORAGE_KEY)&&EXPORTED.length>0){Keychain.set(STORAGE_KEY,JSON.stringify(EXPORTED));}` : ''}
function loadTodos(){try{const r=Keychain.contains(STORAGE_KEY)?Keychain.get(STORAGE_KEY):null;if(!r)return[{id:1,text:"アプリから同期してください",done:false,due:null}];return JSON.parse(r);}catch{return[];}}
function saveTodos(t){Keychain.set(STORAGE_KEY,JSON.stringify(t));}
function pd(due){if(!due)return null;const p=String(due).split("-");if(p.length!==3)return null;const d=new Date(+p[0],+p[1]-1,+p[2]);return isNaN(d.getTime())?null:d;}
function isUrgent(due){if(!due)return false;const t=new Date();t.setHours(0,0,0,0);const d=pd(due);if(!d)return false;const diff=(d-t)/86400000;return diff>=0&&diff<=14;}
function isOverdue(due){const d=pd(due);if(!d)return false;const t=new Date();t.setHours(0,0,0,0);return d<t;}
function dueLabel(due,time){const d=pd(due);if(!d)return"";const t=new Date();t.setHours(0,0,0,0);const diff=Math.round((d-t)/86400000);const tp=time?" "+time:"";if(diff<0)return"期限切れ"+tp;if(diff===0)return"今日"+tp+"まで";if(diff===1)return"明日"+tp+"まで";return (d.getMonth()+1)+"/"+d.getDate()+tp+"まで";}
const args=URLScheme.allParameters();
if(args&&args.action==="sync"&&args.todos){try{const s=JSON.parse(decodeURIComponent(args.todos));saveTodos(s);const a=new Alert();a.title="✅ 同期完了";a.message=s.length+"件のTodoを更新しました。";a.addAction("OK");await a.presentAlert();}catch(e){const a=new Alert();a.title="❌ エラー";a.message="同期に失敗しました。";a.addAction("OK");await a.presentAlert();}Script.complete();return;}
async function runAsApp(){const todos=loadTodos();const active=todos.filter(t=>!t.done);const urgent=active.filter(t=>isUrgent(t.due));const normal=active.filter(t=>!isUrgent(t.due));const done=todos.filter(t=>t.done);let msg="";if(urgent.length>0)msg+="🔴 急ぎ:\\n"+urgent.map(t=>"・"+t.text+"（"+dueLabel(t.due)+"）").join("\\n")+"\\n\\n";if(normal.length>0)msg+="📌 Todo:\\n"+normal.map((t,i)=>i+1+". "+t.text+(t.due?"（"+dueLabel(t.due)+"）":"")).join("\\n");if(active.length===0)msg="✅ 未完了タスクはありません";const a=new Alert();a.title="📋 Todoリスト";a.message=msg.trim();a.addAction("✅ 完了済みを削除（"+done.length+"件）");a.addCancelAction("閉じる");const idx=await a.presentAlert();if(idx===0){saveTodos(todos.filter(t=>!t.done));await runAsApp();}}
function buildWidget(todos){const sortByDue=arr=>arr.slice().sort((a,b)=>{const da=pd(a.due),db=pd(b.due);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;if(da-db!==0)return da-db;return(a.start||"99:99").localeCompare(b.start||"99:99");});const active=todos.filter(t=>!t.done);const urgent=sortByDue(active.filter(t=>isUrgent(t.due)));const normal=sortByDue(active.filter(t=>!isUrgent(t.due)));const w=new ListWidget();w.backgroundColor=new Color("#1a1830");w.setPadding(16,16,14,16);const h=w.addStack();h.layoutHorizontally();h.centerAlignContent();const ti=h.addText("📋 Todoリスト");ti.font=Font.boldSystemFont(14);ti.textColor=new Color("#9f97f0");h.addSpacer();const bc=h.addText(active.length+"件");bc.font=Font.mediumSystemFont(12);bc.textColor=new Color("#6b6a80");w.addSpacer(10);if(urgent.length>0){const ul=w.addText("🔴 急ぎ（1日以内）");ul.font=Font.boldSystemFont(11);ul.textColor=new Color("#e87aa0");w.addSpacer(6);for(const t of urgent.slice(0,2)){const r=w.addStack();r.layoutHorizontally();r.centerAlignContent();r.spacing=8;const icon=r.addText(isOverdue(t.due)?"‼":"⚠");icon.font=Font.systemFont(13);icon.textColor=new Color("#EF9F27");const l=r.addText(t.text);l.font=Font.mediumSystemFont(13);l.textColor=new Color("#f0eff9");l.lineLimit=1;r.addSpacer();const ts=(t.start||t.end)?(t.start&&t.end?t.start+"〜"+t.end:t.start||t.end):"";const urgLabel=dueLabel(t.due,t.start);const dl=r.addText(urgLabel);dl.font=Font.systemFont(11);dl.textColor=new Color("#EF9F27");w.addSpacer(5);}if(urgent.length>2){const m=w.addText("他 "+(urgent.length-2)+" 件...");m.font=Font.systemFont(10);m.textColor=new Color("#5a596e");w.addSpacer(4);}}const maxNormal=urgent.length>0?2:4;for(const t of normal.slice(0,maxNormal)){const r=w.addStack();r.layoutHorizontally();r.centerAlignContent();r.spacing=8;const dot=r.addText("○");dot.font=Font.systemFont(13);dot.textColor=new Color("#9f97f0");const l=r.addText(t.text);l.font=Font.systemFont(13);l.textColor=new Color("#f0eff9");l.lineLimit=1;r.addSpacer();const rightLabel=dueLabel(t.due,t.start);if(rightLabel){const dl=r.addText(rightLabel);dl.font=Font.systemFont(10);dl.textColor=new Color("#6b6a80");}w.addSpacer(5);}if(normal.length>maxNormal){const m=w.addText("他 "+(normal.length-maxNormal)+" 件...");m.font=Font.systemFont(10);m.textColor=new Color("#5a596e");w.addSpacer(4);}if(active.length===0){const e=w.addText("✅ すべて完了！");e.font=Font.systemFont(13);e.textColor=new Color("#5a596e");}w.addSpacer();const f=w.addStack();f.layoutHorizontally();const hint=f.addText("タップして管理");hint.font=Font.systemFont(11);hint.textColor=new Color("#9f97f0");return w;}
const todos=loadTodos();
if(config.runsInWidget){Script.setWidget(buildWidget(todos));}else{await runAsApp();await buildWidget(loadTodos()).presentMedium();}
Script.complete();`;
}
