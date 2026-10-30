// Scriptable ウィジェット連携
// 1つのコードで2種類のウィジェットを出す（ウィジェットの Parameter で切り替え）
//   空欄 ……… Todo：★ だいじな Todo は常に先頭 → 残りは期限が早い順（期限なしは最後）→ 入りきらない分は「他N件」
//   「予定」… 今日の予定：これからの予定を時刻順に。終わった予定は省き、空いた行には明日の予定

const SCRIPT_NAME = 'マイプランナー';

/** ウィジェットに渡す形（必要な項目だけ） */
export function widgetTodos(todos) {
  return todos.filter(t => !t.done).map(({ id, text, done, due, start, end, important }) =>
    ({ id, text, done, due, start, end, ...(important ? { important: true } : {}) }));
}

const PALETTE = ['#7F77DD', '#D4537E', '#3aabbb', '#4caf7d', '#E8923A', '#8e6bbf', '#4a7fd4', '#d94a4a', '#b59b1c', '#7d7c8a'];

/**
 * ウィジェットに渡す予定（今日から7日分。毎日同期しなくても数日は表示できるように）
 * @param {object[]} occs  occurrencesInRange() の結果
 * @param {(ev)=>number} colorOf
 */
export function widgetEvents(occs, colorOf) {
  return occs.slice(0, 80).map(o => ({
    t: o.event.title || '(タイトルなし)', s: o.start, e: o.end, ...(o.allDay ? { a: 1 } : {}),
    ...(o.event.location ? { l: o.event.location } : {}), c: PALETTE[colorOf(o.event)] || PALETTE[0],
  }));
}

/** Scriptable を開いて未完了の Todo と1週間分の予定を同期する */
export function syncToScriptable(todos, events = []) {
  const q = `action=sync&todos=${encodeURIComponent(JSON.stringify(widgetTodos(todos)))}&events=${encodeURIComponent(JSON.stringify(events))}`;
  window.location.href = `scriptable:///run/${encodeURIComponent(SCRIPT_NAME)}?${q}`;
}

/**
 * ウィジェットとアプリで共通の並べ方。Scriptable 側にもこの文字列をそのまま埋め込む。
 * （tests/widget.test.js で、アプリ側の並びと一致することを確かめている）
 */
export const SHARED_SOURCE = String.raw`
function pd(due){if(!due)return null;const p=String(due).split("-");if(p.length!==3)return null;const d=new Date(+p[0],+p[1]-1,+p[2]);return isNaN(d.getTime())?null:d;}
function dayDiff(due){const d=pd(due);if(!d)return null;const t=new Date();t.setHours(0,0,0,0);return Math.round((d-t)/86400000);}
function byDue(a,b){const da=pd(a.due),db=pd(b.due);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;if(da-db!==0)return da-db;return (a.start||"99:99").localeCompare(b.start||"99:99");}
function dk(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function hm(s){return s.slice(11,16).replace(/^0/,"");}
function onDay(e,d){if(e.a)return e.s<=d&&e.e>d;const sd=e.s.slice(0,10),ed=e.e.slice(0,10);if(sd===d)return true;return sd<d&&(ed>d||(ed===d&&e.e.slice(11)!=="00:00"));}
function byStart(x,y){return (y.a?1:0)-(x.a?1:0)||(x.s<y.s?-1:x.s>y.s?1:0);}
function dayEvents(events,now,max){const today=dk(now);const nowDT=today+"T"+String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");const tomorrow=dk(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1));const todays=events.filter(e=>onDay(e,today)).sort(byStart);const upcoming=todays.filter(e=>e.a||e.e>nowDT);const rows=upcoming.slice(0,max).map(e=>Object.assign({},e,{now:!e.a&&e.s<=nowDT,label:e.a?"終日":e.s<=nowDT?"〜"+hm(e.e):hm(e.s)}));const room=max-rows.length;const tom=room>=2?events.filter(e=>onDay(e,tomorrow)).sort(byStart).slice(0,room-1).map(e=>Object.assign({},e,{label:e.a?"終日":hm(e.s)})):[];return {today:today,total:todays.length,ended:todays.length-upcoming.length,rows:rows,hidden:upcoming.length-rows.length,tomorrow:tom};}
function arrange(todos,max){const active=todos.filter(t=>!t.done);const imp=active.filter(t=>t.important).sort(byDue);const rest=active.filter(t=>!t.important).sort(byDue);const shownImp=imp.slice(0,max);const shownRest=rest.slice(0,Math.max(0,max-shownImp.length));return {active:active,imp:imp,rest:rest,rows:shownImp.concat(shownRest),hidden:active.length-shownImp.length-shownRest.length};}
`;

const SCRIPT = String.raw`// マイプランナー ウィジェット (Scriptable用) v3
// Parameter が空欄なら Todo（★だいじ → 期限が早い順）、「予定」なら今日の予定を表示します。
// 更新するときは、アプリの「設定 → ホーム画面ウィジェット → コードをコピー」から貼り直してください。
const STORAGE_KEY = "myplanner_todos";
const EVENTS_KEY = "myplanner_events";
const MODE = String(args.widgetParameter || "").trim();
const SHOW_EVENTS = /予定|event/i.test(MODE);
/*__EMBED__*/
function loadTodos(){try{const r=Keychain.contains(STORAGE_KEY)?Keychain.get(STORAGE_KEY):null;if(!r)return[{id:1,text:"アプリから同期してください",done:false,due:null}];return JSON.parse(r);}catch(e){return[];}}
function saveTodos(t){Keychain.set(STORAGE_KEY,JSON.stringify(t));}
function loadEvents(){try{return Keychain.contains(EVENTS_KEY)?JSON.parse(Keychain.get(EVENTS_KEY)):null;}catch(e){return null;}}
/*__SHARED__*/
function dueLabel(t){const diff=dayDiff(t.due);if(diff===null)return"";const tp=t.start?" "+t.start:"";if(diff<0)return"期限切れ";if(diff===0)return"今日"+tp;if(diff===1)return"明日"+tp;const d=pd(t.due);return (d.getMonth()+1)+"/"+d.getDate()+tp;}
function maxRows(){const f=config.widgetFamily;return f==="small"?3:f==="large"?11:5;}

const params=URLScheme.allParameters();
if(params&&params.action==="sync"&&params.todos){
  try{const s=JSON.parse(decodeURIComponent(params.todos));saveTodos(s);let ev=null;if(params.events){ev=JSON.parse(decodeURIComponent(params.events));Keychain.set(EVENTS_KEY,JSON.stringify(ev));}const a=new Alert();a.title="✅ 同期完了";a.message=s.length+"件のTodo"+(ev?"と"+ev.length+"件の予定（1週間分）":"")+"を更新しました。";a.addAction("OK");await a.presentAlert();}
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

const WD=["日","月","火","水","木","金","土"];
function eventRow(w,e,dim){
  const r=w.addStack();r.layoutHorizontally();r.centerAlignContent();r.spacing=6;
  const bar=r.addText("▍");bar.font=Font.boldSystemFont(13);bar.textColor=new Color(e.c||"#7F77DD");
  const t=r.addText(e.label);t.font=Font.mediumSystemFont(12);t.textColor=new Color(e.now?"#EF9F27":"#8f8ea6");t.minimumScaleFactor=0.8;
  const l=r.addText(e.t);l.font=e.now?Font.boldSystemFont(13):Font.systemFont(13);l.textColor=new Color(dim?"#a9a8bd":"#f0eff9");l.lineLimit=1;
  r.addSpacer();
  if(e.l&&!dim){const p=r.addText(e.l);p.font=Font.systemFont(10);p.textColor=new Color("#6b6a80");p.lineLimit=1;}
  w.addSpacer(4);
}
function buildEventsWidget(events){
  const now=new Date();
  const w=new ListWidget();w.backgroundColor=new Color("#1a1830");w.setPadding(14,16,12,16);
  // 時刻で表示が変わるので、15分ごとに描き直してもらう
  w.refreshAfterDate=new Date(now.getTime()+15*60*1000);
  const h=w.addStack();h.layoutHorizontally();h.centerAlignContent();
  const ti=h.addText("📅 今日 "+(now.getMonth()+1)+"/"+now.getDate()+"("+WD[now.getDay()]+")");ti.font=Font.boldSystemFont(14);ti.textColor=new Color("#9f97f0");
  h.addSpacer();
  if(!events){w.addSpacer(8);const m=w.addText("アプリの「ウィジェットに同期」を押してください");m.font=Font.systemFont(12);m.textColor=new Color("#8f8ea6");return w;}
  const d=dayEvents(events,now,maxRows());
  const bc=h.addText(d.total?(d.ended?"残り "+(d.total-d.ended)+"件":d.total+"件"):"");bc.font=Font.mediumSystemFont(12);bc.textColor=new Color("#6b6a80");
  w.addSpacer(8);
  for(const e of d.rows)eventRow(w,e,false);
  if(d.hidden>0){const m=w.addText("他 "+d.hidden+" 件");m.font=Font.systemFont(11);m.textColor=new Color("#8f8ea6");}
  if(!d.rows.length){const m=w.addText(d.total?"✅ 今日の予定は終わりました":"今日の予定はありません");m.font=Font.systemFont(13);m.textColor=new Color("#8f8ea6");w.addSpacer(4);}
  if(d.tomorrow.length){const m=w.addText("明日");m.font=Font.boldSystemFont(11);m.textColor=new Color("#6b6a80");w.addSpacer(2);for(const e of d.tomorrow)eventRow(w,e,true);}
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
if(config.runsInWidget){Script.setWidget(SHOW_EVENTS?buildEventsWidget(loadEvents()):buildWidget(todos));}
else{await runAsApp();await buildWidget(loadTodos()).presentMedium();await buildEventsWidget(loadEvents()).presentMedium();}
Script.complete();
`;

/** アプリ側のプレビュー用：ウィジェットと同じ関数（dayEvents）を使う */
export const sharedFns = new Function(SHARED_SOURCE + '; return { dayEvents: dayEvents, arrange: arrange };');

/** Scriptable に貼り付けるコード。embedTodos=true なら、今の Todo を初期データとして埋め込む */
export function generateWidgetCode(todos, embedTodos) {
  const embed = embedTodos
    ? `const EXPORTED=${JSON.stringify(widgetTodos(todos))};if(!Keychain.contains(STORAGE_KEY)&&EXPORTED.length>0){Keychain.set(STORAGE_KEY,JSON.stringify(EXPORTED));}`
    : '';
  return SCRIPT.replace('/*__EMBED__*/', () => embed).replace('/*__SHARED__*/', () => SHARED_SOURCE.trim());
}
