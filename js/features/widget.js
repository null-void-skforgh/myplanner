// Scriptable ウィジェット連携
// 表示ルール（アプリの Todo 画面と同じ）：
//   ★ だいじな Todo は常に先頭 → 残りは期限が早い順（期限なしは最後）→ 入りきらない分は「他N件」

const SCRIPT_NAME = 'マイプランナー';

/** ウィジェットに渡す形（必要な項目だけ） */
export function widgetTodos(todos) {
  return todos.filter(t => !t.done).map(({ id, text, done, due, start, end, important }) =>
    ({ id, text, done, due, start, end, ...(important ? { important: true } : {}) }));
}

/** Scriptable を開いて未完了の Todo を同期する */
export function syncToScriptable(todos) {
  const data = encodeURIComponent(JSON.stringify(widgetTodos(todos)));
  window.location.href = `scriptable:///run/${encodeURIComponent(SCRIPT_NAME)}?action=sync&todos=${data}`;
}

/**
 * ウィジェットとアプリで共通の並べ方。Scriptable 側にもこの文字列をそのまま埋め込む。
 * （tests/widget.test.js で、アプリ側の並びと一致することを確かめている）
 */
export const SHARED_SOURCE = String.raw`
function pd(due){if(!due)return null;const p=String(due).split("-");if(p.length!==3)return null;const d=new Date(+p[0],+p[1]-1,+p[2]);return isNaN(d.getTime())?null:d;}
function dayDiff(due){const d=pd(due);if(!d)return null;const t=new Date();t.setHours(0,0,0,0);return Math.round((d-t)/86400000);}
function byDue(a,b){const da=pd(a.due),db=pd(b.due);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;if(da-db!==0)return da-db;return (a.start||"99:99").localeCompare(b.start||"99:99");}
function arrange(todos,max){const active=todos.filter(t=>!t.done);const imp=active.filter(t=>t.important).sort(byDue);const rest=active.filter(t=>!t.important).sort(byDue);const shownImp=imp.slice(0,max);const shownRest=rest.slice(0,Math.max(0,max-shownImp.length));return {active:active,imp:imp,rest:rest,rows:shownImp.concat(shownRest),hidden:active.length-shownImp.length-shownRest.length};}
`;

const SCRIPT = String.raw`// マイプランナー ウィジェット (Scriptable用) v2
// ★ だいじなTodoを常に先頭に、そのあと期限が早い順。入りきらない分は「他N件」。
// 更新するときは、アプリの「設定 → ホーム画面ウィジェット → コードをコピー」から貼り直してください。
const STORAGE_KEY = "myplanner_todos";
/*__EMBED__*/
function loadTodos(){try{const r=Keychain.contains(STORAGE_KEY)?Keychain.get(STORAGE_KEY):null;if(!r)return[{id:1,text:"アプリから同期してください",done:false,due:null}];return JSON.parse(r);}catch(e){return[];}}
function saveTodos(t){Keychain.set(STORAGE_KEY,JSON.stringify(t));}
/*__SHARED__*/
function dueLabel(t){const diff=dayDiff(t.due);if(diff===null)return"";const tp=t.start?" "+t.start:"";if(diff<0)return"期限切れ";if(diff===0)return"今日"+tp;if(diff===1)return"明日"+tp;const d=pd(t.due);return (d.getMonth()+1)+"/"+d.getDate()+tp;}
function maxRows(){const f=config.widgetFamily;return f==="small"?3:f==="large"?11:5;}

const params=URLScheme.allParameters();
if(params&&params.action==="sync"&&params.todos){
  try{const s=JSON.parse(decodeURIComponent(params.todos));saveTodos(s);const a=new Alert();a.title="✅ 同期完了";a.message=s.length+"件のTodoを更新しました。";a.addAction("OK");await a.presentAlert();}
  catch(e){const a=new Alert();a.title="❌ エラー";a.message="同期に失敗しました。";a.addAction("OK");await a.presentAlert();}
  Script.complete();return;
}

function addRow(w,t){
  const diff=dayDiff(t.due);
  const r=w.addStack();r.layoutHorizontally();r.centerAlignContent();r.spacing=6;
  const mark=r.addText(t.important?"★":(diff!==null&&diff<0?"‼":"○"));
  mark.font=Font.systemFont(12);
  mark.textColor=new Color(t.important?"#F2C14E":(diff!==null&&diff<0?"#F08584":"#9f97f0"));
  const l=r.addText(t.text);l.font=t.important?Font.boldSystemFont(13):Font.systemFont(13);l.textColor=new Color("#f0eff9");l.lineLimit=1;
  r.addSpacer();
  const lab=dueLabel(t);
  if(lab){const d=r.addText(lab);d.font=Font.systemFont(11);d.textColor=new Color(diff<0?"#F08584":diff<=1?"#EF9F27":"#8f8ea6");}
  w.addSpacer(4);
}

function buildWidget(todos){
  const a=arrange(todos,maxRows());
  const w=new ListWidget();w.backgroundColor=new Color("#1a1830");w.setPadding(14,16,12,16);
  const h=w.addStack();h.layoutHorizontally();h.centerAlignContent();
  const ti=h.addText("📋 Todo");ti.font=Font.boldSystemFont(14);ti.textColor=new Color("#9f97f0");
  h.addSpacer();
  const bc=h.addText(a.active.length+"件");bc.font=Font.mediumSystemFont(12);bc.textColor=new Color("#6b6a80");
  w.addSpacer(8);
  for(const t of a.rows)addRow(w,t);
  if(a.hidden>0){const m=w.addText("他 "+a.hidden+" 件");m.font=Font.systemFont(11);m.textColor=new Color("#8f8ea6");}
  if(a.active.length===0){const e=w.addText("✅ すべて完了！");e.font=Font.systemFont(13);e.textColor=new Color("#8f8ea6");}
  w.addSpacer();
  return w;
}

async function runAsApp(){
  const todos=loadTodos();const a=arrange(todos,999);const done=todos.filter(t=>t.done);
  let msg="";
  if(a.imp.length>0)msg+="★ だいじ:\n"+a.imp.map(t=>"・"+t.text+(t.due?"（"+dueLabel(t)+"）":"")).join("\n")+"\n\n";
  if(a.rest.length>0)msg+="📌 期限が近い順:\n"+a.rest.map((t,i)=>(i+1)+". "+t.text+(t.due?"（"+dueLabel(t)+"）":"")).join("\n");
  if(a.active.length===0)msg="✅ 未完了タスクはありません";
  const al=new Alert();al.title="📋 Todoリスト";al.message=msg.trim();
  al.addAction("✅ 完了済みを削除（"+done.length+"件）");al.addCancelAction("閉じる");
  const idx=await al.presentAlert();
  if(idx===0){saveTodos(todos.filter(t=>!t.done));await runAsApp();}
}

const todos=loadTodos();
if(config.runsInWidget){Script.setWidget(buildWidget(todos));}
else{await runAsApp();await buildWidget(loadTodos()).presentMedium();}
Script.complete();
`;

/** Scriptable に貼り付けるコード。embedTodos=true なら、今の Todo を初期データとして埋め込む */
export function generateWidgetCode(todos, embedTodos) {
  const embed = embedTodos
    ? `const EXPORTED=${JSON.stringify(widgetTodos(todos))};if(!Keychain.contains(STORAGE_KEY)&&EXPORTED.length>0){Keychain.set(STORAGE_KEY,JSON.stringify(EXPORTED));}`
    : '';
  return SCRIPT.replace('/*__EMBED__*/', () => embed).replace('/*__SHARED__*/', () => SHARED_SOURCE.trim());
}
