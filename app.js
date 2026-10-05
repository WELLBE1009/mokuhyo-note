/* 目標と記録ノート — ウェルビー / サウナラボ 温度システム β版
 * データの置き場所: Firebase (Authentication + Cloud Firestore)
 *   people/{pid}                 … 1人分の目標設定シート・振り返り・見られる人（本人とコーチのメール）
 *   people/{pid}/records/{rid}   … 週ごとの記録
 *   admins/{email}               … 管理者（Firebase コンソールで手で作る）
 * firebase-config.js が空なら、保存されない「デモ表示」で動きます。
 */
(() => {
'use strict';

/* ---------- 小道具 ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nl = v => esc(v).replace(/\n/g,'<br>');
const today = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const daysSince = iso => iso ? Math.floor((Date.now()-new Date(iso).getTime())/86400000) : null;
const md = iso => { if(!iso) return '—'; const d=new Date(iso); return `${d.getMonth()+1}/${d.getDate()}`; };
const ymd = iso => { if(!iso) return '—'; const d=new Date(iso); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; };
const ls = { get(k){try{return localStorage.getItem(k)}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,v)}catch(e){}} };
let toastT; const toast = m => { const t=$('#toast'); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2400); };
const normEmail = s => String(s||'').trim().toLowerCase();
const emailList = s => String(s||'').split(/[\s,、，]+/).map(normEmail).filter(x=>x.includes('@'));
const STORES = ['今池店','栄店','福岡店','本社・その他'];
const REVIEW_DAYS = 28;   // 目標シートを見直す目安（日）
const REVIEW_RECORDS = 4; // または、この回数の記録がたまったら
const blankGoal = () => ({forWhat:'',text:'',evidence:'',metric:'',unit:'',start:'',m1:'',y1:'',kind:'',checks:[false,false,false,false]});
const blankSheet = () => ({m10:['','',''],m11:['','',''],mission:'',area:'',areaWhy:'',r21:['','',''],r22:['','',''],r23:'',goals:[blankGoal()],readChecks:[false,false,false,false]});
const blankMid = () => ({done:'',stuck:'',decision:'',reason:''});
const blankReview = () => ({mid:[blankMid()],end:{a:'',b:'',c:''}});
const clone = o => JSON.parse(JSON.stringify(o));
const fw = g => { const t=(g.forWhat||'').trim().replace(/[、。,]$/,''); if(!t) return ''; return /ため(に)?$/.test(t)? t+'、' : t+'ために、'; };
// 目標の数は自由。一度使った目標は消さずに「外す（archived）」ので、記録の数値の位置（何番目の目標か）がずれない
const activeGoals = p => (p?.sheet?.goals||[]).map((g,i)=>({...g,i})).filter(g=>!g.archived && (g.text||g.metric||g.forWhat));
const goalCount = p => Math.max(1,(p?.sheet?.goals||[]).length);

/* ---------- 状態 ---------- */
const me = { email:'', name:'', admin:false, signedIn:false };
const state = { people:[], records:{}, terms:{}, ready:false };
const ui = { showInactive:false, pid: ls.get('mn.pid') || null, tab: 'record', dirty:false, draft:null, draftKey:'', addOpen:false, edit:null };
let api = null;   // 下の firebaseApi() か demoApi()

function person(){ return state.people.find(p=>p.id===ui.pid) || null; }
const byDate = (a,b)=>(a.date||'').localeCompare(b.date||'') || ((Date.parse(a.createdAt||'')||0)-(Date.parse(b.createdAt||'')||0));
function allRecordsOf(pid){ return [...(state.records[pid]||[])].sort(byDate); }
// いまの期の記録だけ（前の期を締めた時刻より後に書いたもの）
const tms = v => Date.parse(v||'')||0;  // 時刻の比較はタイムゾーン表記に左右されないよう数値で
function recordsOf(pid){ const p=state.people.find(x=>x.id===pid); const st=p?.termStartAt; return allRecordsOf(pid).filter(r=>!st || tms(r.createdAt)>=tms(st)); }
function termsOf(pid){ return [...(state.terms[pid]||[])].sort((a,b)=>(a.closedAt||'').localeCompare(b.closedAt||'')); }
// 期ごとの数値の合計（目標1〜3）
// 数値：空欄は null（未入力）、0 は「本当にゼロ」。表示と保存で区別する
const toVal = v => (v===''||v===null||v===undefined) ? null : Number(v);
const showVal = v => (v===null||v===undefined) ? '未入力' : v;
// 週の区切り（月曜はじまり）。同じ週に2回目を書くときに知らせるため
const weekStart = iso => { const d=new Date((iso||today())+'T00:00:00'); const w=(d.getDay()+6)%7; d.setDate(d.getDate()-w); return d; };
const weekKey = iso => { const d=weekStart(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const weekLabel = iso => { const a=weekStart(iso); const b=new Date(a); b.setDate(a.getDate()+6); return `${a.getMonth()+1}/${a.getDate()}〜${b.getMonth()+1}/${b.getDate()}`; };
const isFuture = iso => !!iso && iso > today();
const goalTotals = recs => { const n=Math.max(0,...recs.map(r=>(r.values||[]).length)); return Array.from({length:n},(_,i)=>recs.reduce((a,r)=>a+(Number(r.values?.[i])||0),0)); };
function roleOf(p){ if(!p) return ''; if(p.ownerEmail===me.email) return '本人'; if((p.coachEmails||[]).includes(me.email)) return 'コーチ'; return me.admin? '管理者' : ''; }
const canConfirm = p => roleOf(p)!=='本人';
// 一覧の印：その人の役割ではなく「あなたとの関係」。管理者として見えているだけの人には付けない
const relationBadge = p => { const r=roleOf(p); return r==='本人'? '<span class="role">あなたのノート</span>' : r==='コーチ'? '<span class="role">あなたが担当</span>' : ''; };
const canDeleteRecord = () => me.admin;
// 記録の訂正は本人（と管理者）。元の内容は edits に残る
const canEditRecord = p => roleOf(p)==='本人' || me.admin;  // 記録の削除は管理者だけ（firestore.rules と同じ）

function showNotice(m){ const n=$('#notice'); n.textContent=m; n.hidden=!m; }
async function saveSafe(fn, ok){
  try{ await fn(); if(ok) toast(ok); return true; }
  catch(e){
    console.error(e);
    if(e?.code==='permission-denied') toast('この操作をする権限がありません');
    else if(e?.code==='unavailable') toast('通信できませんでした。電波のよい場所でもう一度');
    else toast('保存できませんでした。もう一度お試しください');
    return false;
  }
}

/* =========================================================
   データ層 1: Firebase
   ========================================================= */
async function firebaseApi(cfg){
  const V='10.12.2', base=`https://www.gstatic.com/firebasejs/${V}/`;
  const [A, AU, F] = await Promise.all([import(base+'firebase-app.js'), import(base+'firebase-auth.js'), import(base+'firebase-firestore.js')]);
  const app = A.initializeApp(cfg);
  const auth = AU.getAuth(app);
  const db = F.getFirestore(app);
  let unsubs = [], recUnsubs = new Map();
  const peopleParts = new Map();   // query名 → Map(id→doc)

  function stopAll(){ unsubs.forEach(u=>u()); unsubs=[]; recUnsubs.forEach(u=>u()); recUnsubs.clear(); peopleParts.clear(); }
  function mergePeople(){
    const m=new Map(); peopleParts.forEach(part=>part.forEach((v,k)=>m.set(k,v)));
    state.people=[...m.values()];
    state.ready=true; onData();
  }
  function watchPeople(name, q){
    unsubs.push(F.onSnapshot(q, s=>{ peopleParts.set(name,new Map(s.docs.map(d=>[d.id,{id:d.id,...d.data()}]))); mergePeople(); },
      e=>{ console.warn(name,e); peopleParts.set(name,new Map()); mergePeople(); if(e.code==='permission-denied') showNotice('データを読む権限がありません。管理者に、あなたのメールアドレスが登録されているか確認してください。'); }));
  }

  AU.onAuthStateChanged(auth, async u => {
    stopAll(); state.people=[]; state.records={}; state.ready=false;
    if(!u){ Object.assign(me,{email:'',name:'',admin:false,signedIn:false}); renderLogin(); return; }
    if(!u.emailVerified){ renderVerify(u.email); return; }
    Object.assign(me,{email:normEmail(u.email), name:u.displayName||u.email, signedIn:true});
    try{ me.admin = (await F.getDoc(F.doc(db,'admins',me.email))).exists(); }catch(e){ me.admin=false; }
    renderAccount();
    const col=F.collection(db,'people');
    if(me.admin) watchPeople('all', col);
    else { watchPeople('own', F.query(col, F.where('ownerEmail','==',me.email))); watchPeople('coach', F.query(col, F.where('coachEmails','array-contains',me.email))); }
  });

  return {
    demo:false,
    // 記録は「いま開いている人」の分だけ読む（無料枠の読み取り回数を節約）
    watchRecords(pid){
      recUnsubs.forEach((u,id)=>{ if(id!==pid){ u(); recUnsubs.delete(id); delete state.records[id]; delete state.terms[id]; } });
      if(!pid || recUnsubs.has(pid)) return;
      const u1=F.onSnapshot(F.collection(db,'people',pid,'records'), s=>{ state.records[pid]=s.docs.map(d=>({id:d.id,...d.data()})); onData(); }, e=>console.warn('records',e));
      const u2=F.onSnapshot(F.collection(db,'people',pid,'terms'), s=>{ state.terms[pid]=s.docs.map(d=>({id:d.id,...d.data()})); onData(); }, e=>console.warn('terms',e));
      recUnsubs.set(pid, ()=>{ u1(); u2(); });
    },
    // 期を締める：その期のシートと振り返りを terms に保管してから、次の期の形に person を更新
    async closeTerm(pid, term, next){
      // 保管と次の期への切り替えを1回でまとめて保存（片方だけ成功することがない）
      const b=F.writeBatch(db);
      b.set(F.doc(F.collection(db,'people',pid,'terms')), term);
      b.update(F.doc(db,'people',pid), next);
      await b.commit();
    },
    // 管理者用：全員分を1つにまとめて返す（バックアップ）
    async exportAll(){
      const out={exportedAt:new Date().toISOString(), project:cfg.projectId, people:[]};
      const ps=await F.getDocs(F.collection(db,'people'));
      for(const d of ps.docs){
        const r=await F.getDocs(F.collection(db,'people',d.id,'records'));
        const t=await F.getDocs(F.collection(db,'people',d.id,'terms'));
        out.people.push({id:d.id, ...d.data(), records:r.docs.map(x=>({id:x.id,...x.data()})), terms:t.docs.map(x=>({id:x.id,...x.data()}))});
      }
      return out;
    },
    async google(){ const p=new AU.GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'});
      try{ await AU.signInWithPopup(auth,p); }catch(e){ if(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-this-environment') await AU.signInWithRedirect(auth,p); else throw e; } },
    async login(email,pw){ await AU.signInWithEmailAndPassword(auth,email,pw); },
    async register(name,email,pw){ const c=await AU.createUserWithEmailAndPassword(auth,email,pw); if(name) await AU.updateProfile(c.user,{displayName:name}); await AU.sendEmailVerification(c.user); },
    async reset(email){ await AU.sendPasswordResetEmail(auth,email); },
    async resendVerify(){ if(auth.currentUser) await AU.sendEmailVerification(auth.currentUser); },
    async checkVerified(){ const u=auth.currentUser; if(!u) return false; await u.reload(); if(u.emailVerified){ await u.getIdToken(true); location.reload(); return true; } return false; },
    async logout(){ await AU.signOut(auth); },
    async addPerson(data){ const r=await F.addDoc(F.collection(db,'people'),data); return r.id; },
    async updatePerson(pid,data){ await F.updateDoc(F.doc(db,'people',pid),data); },
    async addRecord(pid,data){ await F.addDoc(F.collection(db,'people',pid,'records'),data); },
    async updateRecord(pid,rid,data){ await F.updateDoc(F.doc(db,'people',pid,'records',rid),data); },
    async deleteRecord(pid,rid){ await F.deleteDoc(F.doc(db,'people',pid,'records',rid)); },
    // メンバーを消す：先に週の記録をすべて消してから、本人の文書を消す
    async deletePerson(pid){
      const snap=await F.getDocs(F.collection(db,'people',pid,'records'));
      const ts=await F.getDocs(F.collection(db,'people',pid,'terms'));
      const refs=[...snap.docs.map(d=>d.ref), ...ts.docs.map(d=>d.ref)];
      recUnsubs.get(pid)?.(); recUnsubs.delete(pid); delete state.records[pid]; delete state.terms[pid];
      for(let i=0;i<refs.length;i+=400){ const b=F.writeBatch(db); refs.slice(i,i+400).forEach(r=>b.delete(r)); await b.commit(); }
      await F.deleteDoc(F.doc(db,'people',pid));
    },
  };
}

/* =========================================================
   データ層 2: デモ（この画面の中だけ。閉じると消える）
   ========================================================= */
function demoApi(pack){
  const id=()=> 'd'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  let all=[], viewers=[];
  if(pack){
    // デモページ：架空のデータ一式＋立場の切り替え
    all=clone(pack.people); state.records=clone(pack.records||{}); state.terms=clone(pack.terms||{}); viewers=pack.viewers||[];
  } else {
    const s=blankSheet();
    s.mission='わたしは、疲れて来たお客様が「来てよかった」と言って帰れるように、その時間を仲間と一緒につくる人でありたい。';
    s.area='元気を届ける'; s.r22[1]='初回案内を、自分以外の人ができるようになるまで見届ける';
    s.goals[0]={...blankGoal(),forWhat:'初めて来店されたお客様が迷わず安心して使い始められるようにするために',text:'3月までに、自分以外の2名が同じご案内をできる状態にする',metric:'その2名が単独でご案内した回数',unit:'回',start:'0',m1:'6',kind:'見届け',checks:[true,true,true,true]};
    all=[{id:'sample',name:'サンプル（記入例）',store:'栄店',role:'フロント',temp:'T2',coach:'コーチ名',grower:'成長担当名',periodStart:'2026-10-01',periodEnd:'2027-03-31',ownerEmail:'sample@example.com',coachEmails:['demo@example.com'],sheet:s,review:blankReview(),history:[],createdAt:'2026-10-01T09:00:00+09:00',sheetUpdatedAt:'2026-10-01T09:00:00+09:00'}];
    state.records.sample=[{id:id(),date:'2026-10-02',values:[1,0,0],fact:'初回案内のチェック表を使って、夜勤の◯◯さんが1組を単独でご案内できた',stuck:'日勤帯のメンバーに時間が取れていない',next:'来週は日勤の△△さんに同じ手順を渡す',check:['keep','',''],checkNote:'',createdAt:'2026-10-02T10:00:00+09:00',confirmedAt:null,confirmedBy:'',voiceDone:false,coachNote:''}];
    viewers=[{key:'admin',email:'demo@example.com',name:'デモの管理者',admin:true}];
  }
  // 本番と同じく「見られる人のノートだけ」を見せる
  const push=()=>{ state.people=all.filter(p=>me.admin || p.ownerEmail===me.email || (p.coachEmails||[]).includes(me.email)); state.ready=true; onData(); };
  const setViewer=key=>{ const v=viewers.find(x=>x.key===key)||viewers[0]; Object.assign(me,{email:v.email,name:v.name,admin:!!v.admin,signedIn:true,viewerKey:v.key}); };
  setViewer(pack? 'honnin' : 'admin');
  setTimeout(()=>{ renderAccount(); push(); showNotice(pack? 'デモページです。登場する人と記録はすべて架空です。何を触っても保存されず、ページを開き直すと元に戻ります。' : 'デモ表示です。保存はされず、閉じると消えます。firebase-config.js を設定すると、本人とコーチで共有できるようになります。'); },0);
  const upd=(pid,data)=>{ all=all.map(p=>p.id===pid?{...p,...data}:p); };
  return {
    demo:true, viewers,
    switchViewer(key){ setViewer(key); ui.pid=null; ui.dirty=false; ui.draft=null; ui.draftKey=''; ui.edit=null; renderAccount(); push(); window.scrollTo({top:0}); },
    watchRecords(){},
    async closeTerm(pid,term,next){ (state.terms[pid] ||= []).push({id:id(),...term}); upd(pid,next); push(); },
    async exportAll(){ return {exportedAt:new Date().toISOString(), project:'demo', people:all.map(p=>({...p, records:state.records[p.id]||[], terms:state.terms[p.id]||[]}))}; },
    async logout(){ toast('デモページにはログアウトはありません。右上で立場を切り替えられます'); },
    async addPerson(data){ const n=id(); all.push({id:n,...data}); state.records[n]=[]; push(); return n; },
    async updatePerson(pid,data){ upd(pid,data); push(); },
    async addRecord(pid,data){ (state.records[pid] ||= []).push({id:id(),...data}); push(); },
    async updateRecord(pid,rid,data){ state.records[pid]=(state.records[pid]||[]).map(r=>r.id===rid?{...r,...data}:r); push(); },
    async deleteRecord(pid,rid){ state.records[pid]=(state.records[pid]||[]).filter(r=>r.id!==rid); push(); },
    async deletePerson(pid){ all=all.filter(p=>p.id!==pid); delete state.records[pid]; delete state.terms[pid]; push(); },
  };
}

/* ---------- 起動 ---------- */
async function boot(){
  const cfg=window.FIREBASE_CONFIG||{};
  if(window.MOKUHYO_DEMO){ api=demoApi(window.MOKUHYO_DEMO); return; }  // demo.html：架空データのデモページ
  if(cfg.apiKey && cfg.projectId){
    try{ api=await firebaseApi(cfg); }
    catch(e){ console.error(e); $('#main').innerHTML=`<div class="card emptystate"><h2>Firebase に接続できませんでした</h2><p>firebase-config.js の内容と、インターネット接続を確認してください。</p></div>`; }
  } else api=demoApi();
}

function onData(){
  if(!state.ready) return;
  if(ui.pid && !person()) ui.pid=null;
  // 本人だけの人は、自分のページを直接開く
  if(!ui.pid && !me.admin && state.people.length===1) ui.pid=state.people[0].id;
  api.watchRecords(ui.pid);
  syncSummary(person());
  renderPeople();
  if(ui.pid && (ui.edit || (ui.dirty && ['record','sheet','review'].includes(ui.tab)))){ renderChainOnly(); return; }
  render();
}

/* ---------- ログイン画面 ---------- */
let loginMode='login';
function renderLogin(msg=''){
  $('#account').innerHTML=''; $('#people').innerHTML=''; showNotice('');
  const m=loginMode;
  $('#main').innerHTML=`<div class="card login">
    <h2>ログイン</h2>
    <p class="muted small">本人と、担当のコーチだけが見られるノートです。会社に登録したメールアドレスでログインしてください。</p>
    <button class="btn google" data-act="google" type="button"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Googleでログイン</button>
    <div class="or">または メールアドレスで</div>
    <div class="segment" role="group" aria-label="メールでのログイン方法">
      ${[['login','ログイン'],['register','はじめて登録'],['reset','パスワードを忘れた']].map(([k,l])=>`<button type="button" data-login="${k}" aria-pressed="${m===k}">${l}</button>`).join('')}
    </div>
    <form id="loginForm" style="display:flex;flex-direction:column;gap:10px">
      ${m==='register'?'<label class="f">お名前<input type="text" id="lname" autocomplete="name" placeholder="例：横大路"></label>':''}
      <label class="f">メールアドレス<input type="email" id="lemail" autocomplete="email" required style="width:100%;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:8px 10px"></label>
      ${m!=='reset'?`<label class="f">パスワード${m==='register'?'<span class="h">6文字以上</span>':''}<input type="password" id="lpw" autocomplete="${m==='register'?'new-password':'current-password'}" required minlength="6" style="width:100%;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:8px 10px"></label>`:''}
      <button class="btn primary wide" type="submit">${m==='login'?'ログイン':m==='register'?'登録して確認メールを受け取る':'再設定メールを送る'}</button>
      <p class="err" id="lerr">${esc(msg)}</p>
    </form>
  </div>`;
}
function renderVerify(email){
  $('#main').innerHTML=`<div class="card login">
    <h2>確認メールを開いてください</h2>
    <p><b>${esc(email)}</b> に確認メールを送りました。メールの中のリンクを押してから、下の「確認した」を押してください。</p>
    <p class="muted small">届かないときは、迷惑メールのフォルダも見てください。</p>
    <button class="btn primary wide" data-act="verified">確認した</button>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="resend">確認メールをもう一度送る</button><button class="btn ghost" data-act="logout">別のアドレスでログイン</button></div>
  </div>`;
}
const authMsg = e => ({
  'auth/invalid-credential':'メールアドレスかパスワードが違います',
  'auth/wrong-password':'メールアドレスかパスワードが違います',
  'auth/user-not-found':'このメールアドレスはまだ登録されていません。「はじめて登録」から登録してください',
  'auth/email-already-in-use':'このメールアドレスは登録済みです。「ログイン」から入ってください',
  'auth/weak-password':'パスワードは6文字以上にしてください',
  'auth/invalid-email':'メールアドレスの形が正しくありません',
  'auth/too-many-requests':'回数が多すぎます。少し時間をおいてから試してください',
  'auth/popup-closed-by-user':'',
  'auth/unauthorized-domain':'このURLはFirebaseに登録されていません（管理者向け：README 手順5）',
}[e?.code] ?? 'ログインできませんでした（'+(e?.code||'不明なエラー')+'）');

function renderAccount(){
  // デモページだけ：本番と同じ右上の表示とは別に、色を変えた帯で「デモ用の切り替え」を出す
  const bar=document.getElementById('demoBar');
  if(bar){
    if(api?.demo && (api.viewers||[]).length>1){
      bar.hidden=false;
      bar.innerHTML = `<b>デモ用の切り替え</b><span class="small">本番にはない機能です。本番では、ログインしたメールアドレスで立場が決まり、自分で切り替えることはできません。</span><label class="small" style="display:flex;gap:6px;align-items:center;margin-left:auto">見る立場<select id="viewerSel" style="width:auto">${api.viewers.map(v=>`<option value="${esc(v.key)}" ${me.viewerKey===v.key?'selected':''}>${esc(v.label||v.name)}</option>`).join('')}</select></label>`;
    } else bar.hidden=true;
  }
  $('#account').innerHTML = me.signedIn ? `${esc(me.name)}${me.admin?' <span class="role">管理者</span>':''} <button class="btn ghost" data-act="logout">ログアウト</button>` : '';
}

/* ---------- 人の切り替え ---------- */
function sortedPeople(){ return [...state.people].filter(p=>ui.showInactive || p.status!=='inactive').sort((a,b)=>(a.store||'').localeCompare(b.store||'')||(a.name||'').localeCompare(b.name||'')); }
function renderPeople(){
  const box=$('#people');
  if(!me.admin && state.people.length<=1){ box.innerHTML=''; return; }
  box.innerHTML = `<button class="chip-person" data-go="" aria-pressed="${!ui.pid}">みんなの様子</button>` +
    sortedPeople().map(p=>`<button class="chip-person" data-go="${esc(p.id)}" aria-pressed="${ui.pid===p.id}"><span class="dot ${statusOf(p).dot}"></span>${esc(p.name||'名前未入力')}</button>`).join('');
}
function go(pid){
  if(ui.dirty && !leaveOk()) return;
  ui.pid=pid||null; ui.dirty=false; ui.draft=null; ui.draftKey=''; ui.edit=null; ls.set('mn.pid',ui.pid||'');
  if(ui.pid){ ui.tab = activeGoals(person()).length? 'record' : 'sheet'; }
  renderPeople(); render(); window.scrollTo({top:0});
}
let pendingLeave=null;
function leaveOk(){ // confirm() を使わず、2回押しで確定
  if(pendingLeave && Date.now()-pendingLeave<4000){ pendingLeave=null; return true; }
  pendingLeave=Date.now(); toast('書きかけの内容があります。もう一度押すと破棄して移動します'); return false;
}

/* ---------- 状態の判定（中身の良し悪しではなく、続いているかだけを見る） ---------- */
function computeSummary(p, recs){
  const last=recs.at(-1);
  return {
    lastDate: last?.date || null,
    count: recs.length,
    unconfirmed: recs.filter(r=>!r.confirmedAt).length,
    voices: recs.filter(r=>(r.check||[]).some(c=>c==='fix'||c==='change') && !r.voiceDone).length,
    recsSinceSheet: recs.filter(r=>!p.sheetUpdatedAt || (r.createdAt||r.date) > p.sheetUpdatedAt).length,
  };
}
// 一覧に出す「要約」を、開いた人の記録から作り直して person 文書に保存（変わったときだけ書く）
let summaryWriting=false;
async function syncSummary(p){
  if(!p || !state.records[p.id] || summaryWriting || api.demo) return;
  const sum=computeSummary(p, recordsOf(p.id));
  if(JSON.stringify(sum)===JSON.stringify(p.summary||null)) return;
  summaryWriting=true;
  try{ await api.updatePerson(p.id,{summary:sum}); }catch(e){ console.warn('summary',e); }
  summaryWriting=false;
}
function statusOf(p){
  if(!state.records[p.id]){
    // 記録を読んでいない人は、保存された要約で判定する
    const m=p.summary||{lastDate:null,count:0,unconfirmed:0,voices:0,recsSinceSheet:0};
    const sinceRec=m.lastDate? daysSince(m.lastDate) : null; const sinceSheet=daysSince(p.sheetUpdatedAt);
    const voices=Array(m.voices||0).fill(null);
    const needReview = activeGoals(p).length>0 && (sinceSheet===null || sinceSheet>=REVIEW_DAYS || m.recsSinceSheet>=REVIEW_RECORDS || voices.length>0);
    return {recs:[],last:m.lastDate?{date:m.lastDate}:null,sinceRec,unconfirmed:m.unconfirmed||0,sinceSheet,recsSinceSheet:m.recsSinceSheet||0,voices,needReview,dot: voices.length?'ember':(sinceRec===null||sinceRec>10)?'warn':'ok'};
  }
  const recs=recordsOf(p.id);
  const last=recs.at(-1);
  const sinceRec = last? daysSince(last.date) : null;
  const unconfirmed = recs.filter(r=>!r.confirmedAt).length;
  const sinceSheet = daysSince(p.sheetUpdatedAt);
  const recsSinceSheet = recs.filter(r=>!p.sheetUpdatedAt || (r.createdAt||r.date) > p.sheetUpdatedAt).length;
  const voices = recs.filter(r=>(r.check||[]).some(c=>c==='fix'||c==='change') && !r.voiceDone);
  const needReview = activeGoals(p).length>0 && (sinceSheet===null || sinceSheet>=REVIEW_DAYS || recsSinceSheet>=REVIEW_RECORDS || voices.length>0);
  const dot = voices.length? 'ember' : (sinceRec===null || sinceRec>10)? 'warn' : 'ok';
  return {recs,last,sinceRec,unconfirmed,sinceSheet,recsSinceSheet,voices,needReview,dot};
}

/* ---------- 描画 ---------- */
function render(){
  if(!me.signedIn) return;
  const main=$('#main');
  if(!state.ready){ main.innerHTML=`<div class="card emptystate"><h2>読み込んでいます</h2></div>`; return; }
  if(!ui.pid){ main.innerHTML = teamView(); return; }
  const p=person(); if(!p){ main.innerHTML=teamView(); return; }
  main.innerHTML = `<div class="panel">
    <div id="chainbox">${chainView(p)}</div>
    <nav class="tabs" role="tablist">
      ${[['record','今週の記録'],['flow','記録の流れ'],['sheet','目標設定シート'],['review','振り返り'],...(termsOf(p.id).length?[['terms','これまでの期']]:[])].map(([k,l])=>`<button class="tab" role="tab" data-tab="${k}" aria-selected="${ui.tab===k}">${l}</button>`).join('')}
    </nav>
    <section id="tabbody" class="panel">${tabView(p)}</section>
  </div>`;
}
function renderChainOnly(){ const p=person(); const c=$('#chainbox'); if(p&&c) c.innerHTML=chainView(p); }

function addPersonForm(){
  if(!me.admin) return '';
  if(!ui.addOpen) return `<div><button class="btn primary" data-act="open-add">＋ メンバーを追加</button></div>`;
  return `<form class="card" id="addForm">
    <h3>メンバーを追加</h3>
    <p class="hint">ここに書いたメールアドレスでログインした人だけが、このノートを見られます。本人がGoogleでログインするならGmailのアドレスを入れてください。</p>
    <div class="grid2">
      <label class="f">氏名<input type="text" id="nname" required></label>
      <label class="f">所属<select id="nstore"><option value="">選ぶ</option>${STORES.map(x=>`<option>${x}</option>`).join('')}</select></label>
      <label class="f">本人のメールアドレス<input type="text" id="nowner" inputmode="email" required placeholder="例：taro@example.com"></label>
      <label class="f">コーチのメールアドレス<span class="h">複数いるときは、カンマで区切る</span><input type="text" id="ncoach" inputmode="email"></label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-add">やめる</button><button class="btn primary" type="submit">追加する</button></div>
  </form>`;
}

function teamView(){
  if(!state.people.length){
    return `<div class="panel">${me.admin? `<div class="card emptystate">
      <h2>まだ誰も登録されていません</h2>
      <p>「メンバーを追加」で、目標設定シートを書く人を登録します。本人とコーチのメールアドレスを入れると、その2人がログインしてこのノートを開けるようになります。</p>
      <p class="muted small">比べる相手は、先月の自分だけです。この一覧は「記録が続いているか」を見るためのもので、中身の良し悪しは表示しません。</p>
    </div>${addPersonForm()}` : `<div class="card emptystate">
      <h2>まだあなたのノートがありません</h2>
      <p>このメールアドレス（${esc(me.email)}）は、まだ誰のノートにも登録されていません。管理者に、このアドレスを伝えて登録してもらってください。</p>
    </div>`}</div>`;
  }
  const rows=sortedPeople().map(p=>{
    const s=statusOf(p);
    return `<tr class="row" data-go="${esc(p.id)}">
      <td><b>${esc(p.name||'名前未入力')}</b> ${relationBadge(p)}${p.status==='inactive'?' <span class="pill warn">利用停止中</span>':''}<div class="small muted">${esc([p.store,p.role].filter(Boolean).join('・'))}</div></td>
      <td class="small">${esc(p.coach||'—')}</td>
      <td>${s.last? `<span class="num">${md(s.last.date)}</span> <span class="pill ${s.sinceRec>10?'warn':'ok'}">${s.sinceRec<=0?'今日':s.sinceRec+'日前'}</span>` : '<span class="pill warn">まだ記録なし</span>'}</td>
      <td>${s.unconfirmed? `<span class="pill plain">${s.unconfirmed}件</span>`:'<span class="muted small">—</span>'}</td>
      <td>${!activeGoals(p).length? '<span class="pill warn">目標を書く前</span>' : s.voices.length? `<span class="pill ember">見直したい声 ${s.voices.length}</span>` : s.needReview? '<span class="pill warn">見直しの時期</span>' : `<span class="small muted">${s.sinceSheet===null?'—':s.sinceSheet+'日前に更新'}</span>`}</td>
    </tr>`;}).join('');
  const act=state.people.filter(p=>p.status!=='inactive'); const inactiveN=state.people.length-act.length;
  const total=act.length, voices=act.filter(p=>statusOf(p).voices.length).length, stale=act.filter(p=>{const s=statusOf(p);return s.sinceRec===null||s.sinceRec>10}).length;
  return `<div class="panel">
    <div class="card">
      <h2>みんなの様子</h2>
      <p class="muted small">コーチ・成長担当がすること：記録が続いているかの確認と、詰まっているところを聞くこと。内容の良し悪しや点数はつけません。</p>
      <p>${total}人のうち、<b>${stale}人</b>が10日以上記録なし、<b>${voices}人</b>から「目標を見直したい」という声が出ています。</p>
    </div>
    ${me.admin && inactiveN?`<div><button class="btn ghost" data-act="toggle-inactive">${ui.showInactive?'利用停止中の人を隠す':`利用停止中の人も表示する（${inactiveN}人）`}</button></div>`:''}
    <div class="card"><div class="tablewrap"><table class="team">
      <thead><tr><th>氏名</th><th>コーチ</th><th>最後の記録</th><th>未確認</th><th>目標</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>
    ${addPersonForm()}
    ${me.admin?`<div class="card"><h3>バックアップ</h3><p class="hint">全員分の目標設定シート・週の記録・振り返り・これまでの期を、1つのファイル（JSON）にして保存します。期末の前や、月に一度を目安に。保存したファイルは個人情報なので、社内の決まった場所に置いてください。</p><div><button class="btn" data-act="export">全データを書き出す</button></div></div>`:''}
  </div>`;
}

function chainView(p){
  const sh=p.sheet||blankSheet(); const s=statusOf(p); const goals=activeGoals(p);
  const resp = sh.r23 || [sh.r22?.[1],sh.r22?.[2]].filter(Boolean).join(' ／ ');
  const nudge = goals.length && s.needReview ? `<div class="nudge">
      <p>${s.voices.length? `記録の中で「目標を見直したい」という声が${s.voices.length}回出ています。コーチと一緒に目標設定シートを開きましょう。` : s.sinceSheet===null? '目標設定シートをまだ見直していません。' : `目標設定シートを最後に見直してから ${s.sinceSheet}日・記録${s.recsSinceSheet}回。月に一度、上から1本の文で読み返します。`}</p>
      <button class="btn ember" data-tab="sheet">目標を見直す</button></div>` : '';
  return `<div class="chain">
    <div class="chain-head">
      <div><h2>${esc(p.name||'名前未入力')} <span class="role">${esc(roleOf(p)==='管理者'?'管理者として閲覧中':'あなたは'+roleOf(p))}</span></h2><div class="small muted">${esc([p.store,p.role,p.temp?('現在 '+p.temp):'',p.coach?('コーチ '+p.coach):'',p.grower?('成長担当 '+p.grower):''].filter(Boolean).join('　'))}</div></div>
      <div class="small muted">対象期間 ${p.periodStart?ymd(p.periodStart):'—'} 〜 ${p.periodEnd?ymd(p.periodEnd):'—'}</div>
    </div>
    <div class="link"><div class="lab">チームミッション</div><div class="val">街にサウナという木を植え、森を育て、人々に元気を届ける${sh.area?` <span class="pill plain">${esc(sh.area)}を担う</span>`:''}</div></div>
    <div class="link"><div class="arrow">↓</div></div>
    <div class="link"><div class="lab">個人ミッション</div><div class="val"><div class="mission">${sh.mission?nl(sh.mission):'<span class="empty-val">まだ書いていません</span>'}</div>${(()=>{ const prev=termsOf(p.id).at(-1); return prev?.sheet?.mission? `<div class="small muted" style="margin-top:6px">前の期（${esc(prev.label||'')}）のミッション：${esc(prev.sheet.mission)}</div>` : ''; })()}</div></div>
    <div class="link"><div class="arrow">↓</div></div>
    <div class="link"><div class="lab">新しく引き受けること</div><div class="val">${resp?nl(resp):'<span class="empty-val">まだ書いていません</span>'}</div></div>
    <div class="link"><div class="arrow">↓</div></div>
    <div class="link"><div class="lab">目標</div><div class="val" style="display:flex;flex-direction:column;gap:8px">${goals.length? goals.map(g=>`<div class="goal-line"><span class="gno">目標${g.i+1}</span><div>${g.forWhat?`<span class="forwhat">${esc(fw(g))}</span>`:''}${esc(g.text)}${g.metric?`<div class="small muted">数えるもの：${esc(g.metric)}${g.unit?`（${esc(g.unit)}）`:''}</div>`:''}</div></div>`).join('') : '<span class="empty-val">まだ書いていません。「目標設定シート」タブから始めます</span>'}</div></div>
    ${nudge}
  </div>`;
}

function tabView(p){
  if(ui.tab==='record') return recordView(p);
  if(ui.tab==='flow') return flowView(p);
  if(ui.tab==='sheet') return sheetView(p);
  if(ui.tab==='review') return reviewView(p);
  if(ui.tab==='terms') return termsView(p);
  return '';
}

/* ---- 今週の記録 ---- */
function recordDraft(p){
  if(ui.draftKey!=='record:'+p.id || !ui.draft){ const n=goalCount(p); ui.draft={date:today(),check:Array(n).fill(''),checkNote:'',values:Array(n).fill(''),fact:'',stuck:'',next:''}; ui.draftKey='record:'+p.id; }
  return ui.draft;
}
function recordView(p){
  const goals=activeGoals(p);
  if(!goals.length) return `<div class="card emptystate"><h3>先に目標設定シートを書きます</h3><p>記録は、目標設定シートの「毎月記録する数値」を数えていくものです。まず目標を1つ書いてください（1か月のおためしなら1つで十分です）。</p><div><button class="btn primary" data-tab="sheet">目標設定シートを開く</button></div></div>`;
  const d=recordDraft(p); const recs=recordsOf(p.id); const last=recs.at(-1);
  const sum=i=>recs.reduce((a,r)=>a+(Number(r.values?.[i])||0),0);
  const sh=p.sheet;
  const readSentence = `わたしは${sh.mission?'「'+esc(sh.mission)+'」':'〔個人ミッション〕'}。だから、この期間は`;
  return `
  ${roleOf(p)!=='本人'?`<p class="notice">${esc(p.name)}さんの記録を、${esc(roleOf(p))}として代わりに書いています。1on1の場で一緒に書くときに使ってください。</p>`:''}
  <div class="card">
    <div class="step"><span class="sn">1</span><div><h3>まず、目標を声に出して読みます</h3><p class="hint">書く前に毎回ここを通ります。読んでみて引っかかったら、それが見直しの合図です。</p></div></div>
    ${goals.map(g=>`<div class="goalcheck">
      <div class="readout">${readSentence}${esc(fw(g))}${esc(g.text)}。それは${esc(g.metric||'〔数えるもの〕')}を見れば分かる。</div>
      <div class="choice" role="radiogroup" aria-label="目標${g.i+1}をこのまま続けるか">
        ${[['keep','このまま続ける'],['fix','言葉を直したい'],['change','目標を変えたい']].map(([v,l])=>`<label><input type="radio" name="chk${g.i}" id="chk${g.i}-${v}" value="${v}" data-d="check.${g.i}" ${d.check[g.i]===v?'checked':''}><span>${l}</span></label>`).join('')}
      </div>
    </div>`).join('')}
    ${d.check.some(c=>c==='fix'||c==='change')?`<label class="f">どこが引っかかりましたか<span class="h">一言で大丈夫です。コーチとの次の1on1で、この言葉から話し始めます。</span><textarea id="checkNote" data-d="checkNote" placeholder="例：「2名」と決めたけど、夜勤には1人しか新人がいない">${esc(d.checkNote)}</textarea></label>`:''}
  </div>

  <div class="card">
    <div class="step"><span class="sn">2</span><div><h3>今週の数値</h3><p class="hint">今週起きた分だけを入れます。0でも大事な記録です。数えていない週は空欄のままにすると「未入力」として残ります（0とは区別されます）。</p></div></div>
    ${goals.map(g=>`<div class="numrow">
      <div><div>目標${g.i+1}：${esc(g.metric||'数えるもの未設定')}</div><div class="meta">ここまでの累計 <span class="num">${sum(g.i)}</span>${esc(g.unit)}${g.m1?`　1か月後の目安 <span class="num">${esc(g.m1)}</span>${esc(g.unit)}`:''}${last?`　前回 <span class="num">${esc(showVal(last.values?.[g.i]))}</span>`:''}</div></div>
      <input type="number" inputmode="decimal" min="0" step="any" id="val${g.i}" data-d="values.${g.i}" value="${esc(d.values[g.i])}" aria-label="目標${g.i+1}の今週の数値">
    </div>`).join('')}
  </div>

  <div class="card">
    <div class="step"><span class="sn">3</span><div><h3>今週あった事実</h3><p class="hint">うまい言葉はいりません。あとから場面を思い出せる程度で十分です。</p></div></div>
    <label class="f">今週あった事実（1〜2行）<span class="h">やったこと → 変わったこと → 誰にどう届いたか</span><textarea id="fact" data-d="fact" placeholder="例：新人の◯◯さんが、夜勤の締め作業を一人でできるようになった">${esc(d.fact)}</textarea></label>
    <div class="grid2">
      <label class="f">詰まっていること<textarea id="stuck" data-d="stuck" placeholder="例：日勤帯のメンバーに時間が取れていない">${esc(d.stuck)}</textarea></label>
      <label class="f">次の一歩<textarea id="next" data-d="next" placeholder="例：来週は日勤の△△さんに同じ手順を渡す">${esc(d.next)}</textarea></label>
    </div>
    <label class="f" style="max-width:220px">記録日<input type="date" id="rdate" data-d="date" value="${esc(d.date)}" max="${today()}"></label>
    ${(()=>{ const same=recs.filter(r=>weekKey(r.date)===weekKey(d.date)); return same.length?`<p class="notice">この週（${weekLabel(d.date)}）は、${same.map(r=>md(r.date)).join('・')} にもう記録があります。前の記録を直すなら「記録の流れ」の「訂正する」を使ってください。別の出来事として足すなら、このまま記録できます。</p>`:''; })()}
  </div>
  <div class="savebar">
    <span class="small muted">${goals.some(g=>!d.check[g.i])?'1の「このまま続けるか」を選ぶと保存できます':''}</span>
    <button class="btn primary" data-act="save-record" ${goals.some(g=>!d.check[g.i])?'disabled':''}>記録する</button>
  </div>`;
}

/* ---- 記録の流れ ---- */
function flowView(p){
  const recs=recordsOf(p.id); const goals=activeGoals(p);
  if(!recs.length) return `<div class="card emptystate"><h3>まだ記録がありません</h3><p>「今週の記録」で1回目を書くと、ここに週ごとの流れと月ごとの合計が並びます。</p><div><button class="btn primary" data-tab="record">今週の記録を書く</button></div></div>`;
  const months=[...new Set(recs.map(r=>(r.date||'').slice(0,7)))].filter(Boolean).sort();
  const charts=goals.map(g=>{
    const vals=months.map(m=>recs.filter(r=>(r.date||'').startsWith(m)).reduce((a,r)=>a+(Number(r.values?.[g.i])||0),0));
    return chartSvg(g, months, vals);
  }).join('');
  const coach=canConfirm(p);
  const items=[...recs].reverse().map(r=>{
    const voice=(r.check||[]).map((c,i)=>c==='fix'?`目標${i+1}：言葉を直したい`:c==='change'?`目標${i+1}：変えたい`:'').filter(Boolean);
    if(ui.edit && ui.edit.rid===r.id) return editRecordForm(r, goals);
    const edits=r.edits||[];
    return `<div class="tl-item">
      <div class="tl-date">${ymd(r.date)}<div class="small">${weekLabel(r.date)}の週</div></div>
      <div class="tl-body">
        <div class="tl-vals">${goals.map(g=>`<span class="pill plain" title="${esc(r.goalLabels?.[g.i]?('記録したときに数えたもの：'+r.goalLabels[g.i]):'')}">目標${g.i+1} <span class="num">${esc(showVal(r.values?.[g.i]))}</span>${r.values?.[g.i]==null?'':esc(g.unit)}${r.goalLabels?.[g.i] && r.goalLabels[g.i]!==g.metric?`（当時：${esc(r.goalLabels[g.i])}）`:''}</span>`).join('')}
          ${voice.length?`<span class="pill ember">${esc(voice.join('・'))}</span>`:''}</div>
        ${r.fact?`<div class="kv"><b>事実</b>${nl(r.fact)}</div>`:''}
        ${r.stuck?`<div class="kv"><b>詰まり</b>${nl(r.stuck)}</div>`:''}
        ${r.next?`<div class="kv"><b>次の一歩</b>${nl(r.next)}</div>`:''}
        ${r.checkNote?`<div class="kv"><b>引っかかり</b>${nl(r.checkNote)}</div>`:''}
        ${edits.length?`<details class="small"><summary class="muted" style="cursor:pointer">訂正あり（${edits.length}回）・元の記録を見る</summary><div class="hist" style="margin-top:6px">${edits.map(e=>`<div><span class="num">${ymd(e.at)}</span> ${esc(e.by||'')} が訂正${e.why?`（${esc(e.why)}）`:''}。訂正前：${esc(ymd(e.before?.date))}／${goals.map(g=>`目標${g.i+1} ${esc(showVal(e.before?.values?.[g.i]))}`).join('・')}${e.before?.fact?`／事実「${esc(e.before.fact)}」`:''}${e.before?.stuck?`／詰まり「${esc(e.before.stuck)}」`:''}${e.before?.next?`／次の一歩「${esc(e.before.next)}」`:''}</div>`).join('')}</div></details>`:''}
        ${r.coachNote?`<div class="coachnote"><b>${esc(r.coachNoteBy||'コーチ')}から</b>${nl(r.coachNote)}</div>`:''}
        ${coach && !r.coachNote?`<div class="inline-form"><textarea id="cn-${esc(r.id)}" placeholder="ひとこと返す（任意）。評価ではなく、問いかけや気づいたことを"></textarea><button class="btn" data-act="coach-note" data-id="${esc(r.id)}">返す</button></div>`:''}
        <div class="confirm-inline small">
          ${r.confirmedAt? `<span class="pill ok">${md(r.confirmedAt)} ${esc(r.confirmedBy||'')} 確認済み</span>` : coach? `<button class="btn" data-act="confirm" data-id="${esc(r.id)}">確認した</button>` : '<span class="muted">コーチの確認待ち</span>'}
          ${voice.length && !r.voiceDone && coach?`<button class="btn" data-act="voice-done" data-id="${esc(r.id)}">見直しについて話した</button>`:''}
          ${voice.length && r.voiceDone?'<span class="pill plain">見直しについて話した</span>':''}
          ${canEditRecord(p)?`<button class="btn ghost" data-act="edit-record" data-id="${esc(r.id)}">訂正する</button>`:''}
          ${canDeleteRecord(p)?`<button class="btn ghost" data-act="del-record" data-id="${esc(r.id)}">削除</button>`:''}
        </div>
      </div></div>`;}).join('');
  return `
  <div class="card">
    <h3>月ごとの合計</h3>
    <p class="hint">進み具合を本人が見るための数字です。他の人と比べるためのものではありません。点線は1か月後の目安。</p>
    <div class="charts">${charts||'<p class="muted">目標に「数えるもの」を書くと表示されます。</p>'}</div>
  </div>
  <div class="card">
    <h3>週ごとの記録</h3>
    <div class="tl">${items}</div>
  </div>`;
}
function chartSvg(g, months, vals){
  const W=300,H=150,L=30,B=24,T=12,R=8;
  const target=Number(g.m1)||0; const max=Math.max(1,target,...vals)*1.15;
  const step=(W-L-R)/Math.max(months.length,1); const bw=Math.min(36,step*.6);
  const y=v=>T+(H-T-B)*(1-v/max);
  const ticks=[...new Set([0,Math.round(max/2),Math.floor(max)])];
  const bars=vals.map((v,i)=>{ const x=L+step*i+step/2-bw/2; const last=i===vals.length-1;
    return `<rect x="${x}" y="${y(v)}" width="${bw}" height="${Math.max(0,H-B-y(v))}" rx="3" fill="${last?'var(--forest)':'var(--forest-soft)'}" stroke="var(--forest)" stroke-width="${last?0:1}"/>
      <text x="${x+bw/2}" y="${y(v)-4}" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="IBM Plex Mono,monospace">${v}</text>
      <text x="${x+bw/2}" y="${H-6}" text-anchor="middle" font-size="10" fill="var(--muted)">${Number(months[i].slice(5))}月</text>`;}).join('');
  return `<div class="chart"><div class="t">目標${g.i+1}：${esc(g.metric||'')}${g.unit?`（${esc(g.unit)}）`:''}</div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="目標${g.i+1}の月ごとの合計">
    ${ticks.map(t=>`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${L-6}" y="${y(t)+4}" text-anchor="end" font-size="10" fill="var(--muted)">${t}</text>`).join('')}
    ${target?`<line x1="${L}" x2="${W-R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--ember)" stroke-dasharray="4 3" stroke-width="1.5"/>`:''}
    ${bars}
  </svg></div>`;
}

/* ---- 目標設定シート ---- */
function sheetDraft(p){
  if(ui.draftKey!=='sheet:'+p.id || !ui.draft){
    const base={name:p.name||'',store:p.store||'',role:p.role||'',temp:p.temp||'',coach:p.coach||'',grower:p.grower||'',periodStart:p.periodStart||'',periodEnd:p.periodEnd||'',ownerEmail:p.ownerEmail||'',coachEmails:(p.coachEmails||[]).join(', '),sheet:Object.assign(blankSheet(),clone(p.sheet||{})),changeNote:''};
    if(!base.sheet.goals.length) base.sheet.goals.push(blankGoal());
    ui.draft=base; ui.draftKey='sheet:'+p.id;
  }
  return ui.draft;
}
const ta=(path,val,ph='')=>`<textarea id="${path.replace(/\./g,'-')}" data-d="${path}" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
const tx=(path,val,ph='')=>`<input type="text" id="${path.replace(/\./g,'-')}" data-d="${path}" value="${esc(val)}" placeholder="${esc(ph)}">`;
function sheetView(p){
  const d=sheetDraft(p); const s=d.sheet; const st=statusOf(p);
  const open = activeGoals(p).length ? 'goals' : (d.name?'mission':'basic');
  const voices = st.voices.map(r=>`<div><span class="num">${md(r.date)}</span> ${(r.check||[]).map((c,i)=>c==='fix'?`目標${i+1}を直したい`:c==='change'?`目標${i+1}を変えたい`:'').filter(Boolean).join('・')}${r.checkNote?`：${esc(r.checkNote)}`:''}</div>`).join('');
  const goalBox=(g,i)=>`<div class="goalbox">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3>目標 ${i+1}</h3><button type="button" class="btn ghost small" data-act="archive-goal" data-i="${i}">この目標を外す</button></div>
    ${g.text?`<p class="small muted">言葉を整える程度なら、このまま書き直して大丈夫です。目標の中身（数えるもの・対象の人）が変わるときは、書き換えずに「この目標を外す」→「＋ 目標を追加」で新しく立ててください。過去の記録との意味がずれずに残ります。</p>`:''}
    <label class="f">「〜のために」の部分<span class="h">個人ミッションとつながる唯一の接続部分です。ここが書けない目標は、まだ目標になっていません。</span>${tx(`sheet.goals.${i}.forWhat`,g.forWhat,'例：初めて来店されたお客様が迷わず安心して使い始められるようにするために')}</label>
    <label class="f">いつまでに・誰が・どんな状態になるようにする${ta(`sheet.goals.${i}.text`,g.text,'例：3月までに、自分以外の2名が同じご案内をできる状態にする')}</label>
    <div class="grid3">
      <label class="f">毎月数えるもの${tx(`sheet.goals.${i}.metric`,g.metric,'例：単独でご案内した回数')}</label>
      <label class="f">単位${tx(`sheet.goals.${i}.unit`,g.unit,'例：回')}</label>
      <label class="f">開始時点の数値${tx(`sheet.goals.${i}.start`,g.start,'例：0')}</label>
      <label class="f">1か月後の目安${tx(`sheet.goals.${i}.m1`,g.m1,'例：6')}</label>
      <label class="f">期末の目安${tx(`sheet.goals.${i}.y1`,g.y1,'')}</label>
    </div>
    <div class="choice" role="radiogroup" aria-label="2-2のどれに当たるか">
      <span class="small muted" style="align-self:center">2-2のどれ：</span>
      ${[['見届け','② 新しく見届けたいこと'],['拾い','③ 新しく拾いにいきたいこと']].map(([v,l])=>`<label><input type="radio" name="kind${i}" id="kind${i}-${v}" value="${v}" data-d="sheet.goals.${i}.kind" ${g.kind===v?'checked':''}><span>${l}</span></label>`).join('')}
    </div>
    <div class="checks"><span class="small muted">4つの条件</span>
      ${['①ミッションにつながっている（「〜のために」が入っている）','②自分が動けば動く（他の人の成績や他店の数字に左右されない）','③進んだか止まったかが、月に1回自分で判定できる','④数値、または「観察できる行動＋確認方法」になっている'].map((l,k)=>`<label><input type="checkbox" id="gc${i}-${k}" data-d="sheet.goals.${i}.checks.${k}" ${g.checks?.[k]?'checked':''}><span>${l}</span></label>`).join('')}
    </div>
  </div>`;
  return `
  ${voices?`<div class="card"><h3>記録の中で出た「見直したい」声</h3><div class="hist">${voices}</div><p class="hint">この声をもとに、コーチと一緒に下の目標を直してください。直して保存すると、この声は「話した」扱いになります。</p></div>`:''}
  <details class="sec" ${open==='basic'?'open':''}><summary>基本情報</summary><div class="in">
    <div class="grid3">
      <label class="f">氏名${tx('name',d.name)}</label>
      <label class="f">所属<select id="store" data-d="store"><option value="">選ぶ</option>${STORES.map(x=>`<option ${d.store===x?'selected':''}>${x}</option>`).join('')}</select></label>
      <label class="f">ロール${tx('role',d.role,'例：フロント')}</label>
      <label class="f">現在の温度<select id="temp" data-d="temp"><option value="">選ぶ</option>${['T1','T2','T3','T4','T5'].map(x=>`<option ${d.temp===x?'selected':''}>${x}</option>`).join('')}</select></label>
      <label class="f">コーチ（名前）${tx('coach',d.coach)}</label>
      <label class="f">成長担当（名前）${tx('grower',d.grower)}</label>
      <label class="f">対象期間（始まり）<input type="date" id="periodStart" data-d="periodStart" value="${esc(d.periodStart)}"></label>
      <label class="f">対象期間（終わり）<input type="date" id="periodEnd" data-d="periodEnd" value="${esc(d.periodEnd)}"></label>
    </div>
    ${me.admin? `<div class="grid2">
      <label class="f">本人のメールアドレス<span class="h">管理者だけが変えられます</span>${tx('ownerEmail',d.ownerEmail)}</label>
      <label class="f">コーチのメールアドレス<span class="h">複数はカンマ区切り。ここにある人がこのノートを見られます</span>${tx('coachEmails',d.coachEmails)}</label>
    </div>
    <div class="goalbox" style="gap:8px">
      ${p.status==='inactive'
        ? `<b>利用停止中（${ymd(p.stoppedAt)}〜）</b><p class="small muted">本人とコーチはこのノートを見られません。データは残っています。再開すると、停止前のメールアドレス（本人：${esc(p.formerOwnerEmail||'—')}、コーチ：${esc((p.formerCoachEmails||[]).join('、')||'—')}）に戻ります。</p><div><button type="button" class="btn" data-act="resume-person">利用を再開する</button></div>`
        : `<b>退職・異動・休職のとき</b><p class="small muted">「利用停止」にすると、本人とコーチはこのノートを見られなくなりますが、目標設定シート・週の記録・振り返り・これまでの期はすべて残ります。あとから再開もできます。</p><div><button type="button" class="btn" data-act="suspend-person">利用を停止する</button></div>`}
    </div>
    <div class="goalbox" style="gap:8px">
      <b>このメンバーを削除する</b>
      <p class="small muted">テストで作った人など、残す必要のないデータだけに使ってください。目標設定シート・週の記録・振り返り・これまでの期がすべて消え、元に戻せません。退職や異動のときは、上の「利用停止」を使ってください。</p>
      <div class="inline-form"><input type="text" id="delConfirm" placeholder="確認のため、氏名「${esc(p.name||'')}」を入力" style="flex:1;min-width:200px"><button type="button" class="btn" data-act="delete-person" style="border-color:var(--ember);color:var(--ember)">削除する</button></div>
    </div>` : `<p class="small muted">このノートを見られる人：本人（${esc(p.ownerEmail||'—')}）、コーチ（${esc((p.coachEmails||[]).join('、')||'—')}）、管理者。変更は管理者に依頼してください。</p>`}
  </div></details>

  <details class="sec" ${open==='mission'?'open':''}><summary>1. 個人ミッション</summary><div class="in">
    <p class="hint">いきなり「どんな価値を生みたいか」と聞かれて答えられる人はほとんどいません。実際にあった場面から書き始めます。うまい言葉にしようとせず、事実だけで大丈夫です。</p>
    <label class="f">1-0 ① この1年で「これはやってよかった」と思えた仕事の場面<span class="h">思いつかないときは「もう一度やりたい仕事」「誰かに見てほしかった仕事」でも構いません</span>${ta('sheet.m10.0',s.m10[0])}</label>
    <label class="f">1-0 ② そのとき、誰が、どう変わりましたか<span class="h">お客様、仲間、自分。表情、言葉、行動。</span>${ta('sheet.m10.1',s.m10[1])}</label>
    <label class="f">1-0 ③ なぜ、それが自分にとって嬉しかったのですか<span class="h">ここに書いた理由が、そのままミッションになることがほとんどです</span>${ta('sheet.m10.2',s.m10[2])}</label>
    <label class="f">1-1 ① 自分は、どんな価値を生みたいか${ta('sheet.m11.0',s.m11[0])}</label>
    <label class="f">1-1 ② どのような状態になれば、自分の役割を果たせたと言えますか<span class="h">「誰に」を、顔が浮かぶくらい具体的に</span>${ta('sheet.m11.1',s.m11[1])}</label>
    <label class="f">1-1 ③ この1年で、どんな成長をしたいか<span class="h">「できるようになりたいこと」ではなく「任されたいこと」で</span>${ta('sheet.m11.2',s.m11[2])}</label>
    <label class="f">1-2 個人ミッション<span class="h">わたしは、〔誰〕が〔どんな状態〕になるために、〔自分は何をする人〕でありたい。</span>${ta('sheet.mission',s.mission,'例：わたしは、疲れて来たお客様が「来てよかった」と言って帰れるように、その時間を仲間と一緒につくる人でありたい。')}</label>
    <div class="f"><span>1-3 チームミッションのなかで、いちばん担いたいところ</span>
      <div class="choice">${[['木を植える','新しい場をつくる'],['森を育てる','続く形にする・仲間を育てる'],['元気を届ける','目の前のお客様の体験をよくする']].map(([v,h])=>`<label title="${h}"><input type="radio" name="area" id="area-${v}" value="${v}" data-d="sheet.area" ${s.area===v?'checked':''}><span>${v}</span></label>`).join('')}</div></div>
    <label class="f">そこを選んだ理由（働く上での判断の軸）${ta('sheet.areaWhy',s.areaWhy)}</label>
  </div></details>

  <details class="sec"><summary>2. 責任の範囲</summary><div class="in">
    <p class="hint">責任＝「自分が始めた（受け取った）ことを最後まで見届けること」と「予定どおりにいかない変化に対応すること」。温度が上がるとは、②と③が広がることです。</p>
    <div class="grid3">
      <label class="f">2-1 ① 自分で決めていること${ta('sheet.r21.0',s.r21[0])}</label>
      <label class="f">2-1 ② いま最後まで見届けていること${ta('sheet.r21.1',s.r21[1])}</label>
      <label class="f">2-1 ③ いま予定外に対応していること${ta('sheet.r21.2',s.r21[2])}</label>
      <label class="f">2-2 ① 新しく決めたいこと<span class="h">無理に広げなくて構いません</span>${ta('sheet.r22.0',s.r22[0])}</label>
      <label class="f">2-2 ② 新しく見届けたいこと<span class="h">途中で終わっていたこと</span>${ta('sheet.r22.1',s.r22[1])}</label>
      <label class="f">2-2 ③ 新しく拾いにいきたいこと<span class="h">誰かが困っているのを見かけたとき</span>${ta('sheet.r22.2',s.r22[2])}</label>
    </div>
    <label class="f">2-3 つながりの確認<span class="h">〔個人ミッションの一部〕のために、わたしは新しく〔2-2の②〕を最後まで見届け、〔2-2の③〕を拾いにいく。</span>${ta('sheet.r23',s.r23)}</label>
  </div></details>

  <details class="sec" ${open==='goals'?'open':''}><summary>3. 目標</summary><div class="in">
    <p class="hint">文型：〔　　〕のために、〔いつまでに〕〔誰が〕〔どんな状態〕になるようにする。それは〔何を見れば〕分かる。1か月のおためしでは目標は1つ（多くても2つ）。</p>
    ${s.goals.map((g,i)=>g.archived?'':goalBox(g,i)).join('')}
    <div><button type="button" class="btn" data-act="add-goal">＋ 目標を追加</button></div>
    ${s.goals.some(g=>g.archived)?`<div class="hist small"><span class="muted">外した目標（これまでの記録は残っています）</span>${s.goals.map((g,i)=>g.archived?`<div>目標${i+1}：${esc(fw(g))}${esc(g.text||'')} <button type="button" class="btn ghost small" data-act="restore-goal" data-i="${i}">戻す</button></div>`:'').join('')}</div>`:''}
    <div class="checks"><span class="small muted">3-4 最後の確認（コーチと一緒に、声に出して読んでから）</span>
      ${['言葉に無理がない（自分の言葉になっている）','「会社に言われたから」ではなく「自分がやりたいから」と言える','期末に、できたかできなかったかを、自分で判定できる','読み上げたとき、コーチが「なぜそれをやるのか」を聞き返さずに理解できた'].map((l,k)=>`<label><input type="checkbox" id="rc${k}" data-d="sheet.readChecks.${k}" ${s.readChecks?.[k]?'checked':''}><span>${l}</span></label>`).join('')}
      <p class="hint">1つでもチェックが付かないときは、目標ではなく1（ミッション）か2（責任の範囲）に戻ってください。</p>
    </div>
  </div></details>

  ${(p.history||[]).length?`<details class="sec"><summary>見直しの履歴（${p.history.length}回）</summary><div class="in"><div class="hist">${[...p.history].reverse().map(h=>`<div><span class="num">${ymd(h.at)}</span>　${esc(h.note||'見直し')}${h.by?` <span class="small muted">（${esc(h.by)}）</span>`:''}<div class="small muted">${(h.goals||[]).filter(g=>g.text).map((g,i)=>`目標${i+1}：${esc(fw(g))}${esc(g.text)}`).join('<br>')}</div></div>`).join('')}</div></div></details>`:''}

  <div class="savebar">
    ${activeGoals(p).length?`<input type="text" id="changeNote" data-d="changeNote" value="${esc(d.changeNote)}" placeholder="何を見直したか一言（任意）" style="max-width:320px">`:''}
    <button class="btn primary" data-act="save-sheet">シートを保存</button>
  </div>`;
}

/* ---- 振り返り ---- */
function reviewDraft(p){
  if(ui.draftKey!=='review:'+p.id || !ui.draft){ ui.draft=Object.assign(blankReview(),clone(p.review||{})); ui.draftKey='review:'+p.id; }
  return ui.draft;
}
function reviewView(p){
  const goals=activeGoals(p); const d=reviewDraft(p); const recs=recordsOf(p.id);
  goals.forEach(g=>{ if(!d.mid[g.i]) d.mid[g.i]=blankMid(); });
  if(!goals.length) return `<div class="card emptystate"><h3>先に目標を書きます</h3><p>振り返りは、期首に立てた目標ごとに書きます。</p></div>`;
  const facts=recs.filter(r=>r.fact).slice(-8).reverse().map(r=>`<div><span class="num">${md(r.date)}</span> ${esc(r.fact)}</div>`).join('');
  const sum=i=>recs.reduce((a,r)=>a+(Number(r.values?.[i])||0),0);
  return `
  <div class="card"><h3>これまでの記録から（材料）</h3><p class="hint">過去にやったことではなく、この期間に立てた目標に対してどこまで進んだかを書きます。記録に残っている事実を手がかりにしてください。</p>
    <div class="hist">${facts||'<span class="muted">まだ記録がありません</span>'}</div></div>
  <div class="card"><h3>4-1 中間の振り返り</h3>
    ${goals.map(g=>`<div class="goalbox">
      <div><b>目標${g.i+1}</b>　<span class="small muted">開始時点 ${esc(g.start||'—')} → 現在の累計 <span class="num">${sum(g.i)}</span>${esc(g.unit)}</span></div>
      <div class="grid2">
        <label class="f">進んだこと（事実で）${ta(`mid.${g.i}.done`,d.mid[g.i].done)}</label>
        <label class="f">詰まっていること${ta(`mid.${g.i}.stuck`,d.mid[g.i].stuck)}</label>
      </div>
      <div class="choice">${[['keep','このまま続ける'],['change','変える']].map(([v,l])=>`<label><input type="radio" name="mdec${g.i}" id="mdec${g.i}-${v}" value="${v}" data-d="mid.${g.i}.decision" ${d.mid[g.i].decision===v?'checked':''}><span>${l}</span></label>`).join('')}</div>
      ${d.mid[g.i].decision==='change'?`<label class="f">変える理由${tx(`mid.${g.i}.reason`,d.mid[g.i].reason)}</label>`:''}
    </div>`).join('')}
  </div>
  <div class="card"><h3>4-2 期末の振り返り（目標1〜3を通して）</h3>
    <label class="f">この期間で、最後まで見届けた範囲・予定どおりにいかないときに対応した範囲は、どう広がったか${ta('end.a',d.end.a)}</label>
    <label class="f">自分がいなくても続く形になったものはあるか<span class="h">T3以上を申告する場合は必須</span>${ta('end.b',d.end.b)}</label>
    <label class="f">達成できなかった目標があれば、その理由<span class="h">達成率を問う欄ではありません</span>${ta('end.c',d.end.c)}</label>
  </div>
  <div class="savebar"><button class="btn primary" data-act="save-review">振り返りを保存</button></div>
  <div class="card">
    <h3>この期を締めて、次の期を始める</h3>
    <p class="hint">期末の振り返りを書き終えたら押します。この期の目標設定シート・振り返り・週の記録は「これまでの期」に保管され、あとから書き換えられません。次の期は、個人ミッションと1-0〜1-1、責任の範囲の2-1を引き継ぎ、目標と振り返りは白紙から始めます。</p>
    <p class="small muted">${p.periodStart?`この期：${ymd(p.periodStart)} 〜 ${p.periodEnd?ymd(p.periodEnd):'（終わりの日が未入力）'}`:'対象期間が未入力です。「目標設定シート」の基本情報で入れておくと、保管するときの名前になります。'}　記録 ${recs.length}回</p>
    <div><button class="btn" data-act="close-term" style="border-color:var(--ember);color:var(--ember)">この期を締める</button></div>
  </div>`;
}

/* ---- 記録の訂正フォーム ---- */
function editRecordForm(r, goals){
  const e=ui.edit;
  return `<div class="tl-item"><div class="tl-date">訂正中</div><div class="tl-body goalbox">
    <p class="small muted">直した内容で上書きされますが、訂正前の内容と、いつ誰が直したかは「訂正あり」として残ります。</p>
    <label class="f" style="max-width:220px">記録日<input type="date" id="ed-date" data-e="date" value="${esc(e.date)}" max="${today()}"></label>
    ${goals.map(g=>`<div class="numrow"><div>目標${g.i+1}：${esc(g.metric||'')}</div><input type="number" inputmode="decimal" min="0" step="any" id="ed-v${g.i}" data-e="values.${g.i}" value="${esc(e.values[g.i]??'')}" aria-label="目標${g.i+1}の数値"></div>`).join('')}
    <label class="f">今週あった事実<textarea id="ed-fact" data-e="fact">${esc(e.fact)}</textarea></label>
    <div class="grid2">
      <label class="f">詰まっていること<textarea id="ed-stuck" data-e="stuck">${esc(e.stuck)}</textarea></label>
      <label class="f">次の一歩<textarea id="ed-next" data-e="next">${esc(e.next)}</textarea></label>
    </div>
    <label class="f">何を直したか（任意）<input type="text" id="ed-why" data-e="why" value="${esc(e.why||'')}" placeholder="例：数値を打ち間違えた"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" data-act="cancel-edit">やめる</button><button class="btn primary" data-act="save-edit" data-id="${esc(r.id)}">訂正を保存</button></div>
  </div></div>`;
}

/* ---- これまでの期（読むだけ） ---- */
function termsView(p){
  const ts=[...termsOf(p.id)].reverse();
  if(!ts.length) return `<div class="card emptystate"><h3>まだ締めた期はありません</h3><p>「振り返り」タブの下で期を締めると、ここに残ります。</p></div>`;
  const all=allRecordsOf(p.id);
  return ts.map(t=>{
    const recs=all.filter(r=>(!t.startAt || tms(r.createdAt)>=tms(t.startAt)) && tms(r.createdAt)<tms(t.closedAt));
    const goals=(t.sheet?.goals||[]).map((g,i)=>({...g,i})).filter(g=>g.text||g.metric||g.forWhat);
    const tot=goalTotals(recs);
    return `<details class="sec"><summary>${esc(t.label||'期')}<span class="small muted" style="font-family:var(--font-body);font-weight:400">${esc([t.temp,t.role].filter(Boolean).join('・'))}</span></summary><div class="in">
      <div class="link"><div class="lab">個人ミッション</div><div class="val mission">${t.sheet?.mission?nl(t.sheet.mission):'—'}</div></div>
      <div class="link"><div class="lab">目標と結果</div><div class="val" style="display:flex;flex-direction:column;gap:8px">${goals.length?goals.map(g=>`<div class="goal-line"><span class="gno">目標${g.i+1}</span><div>${esc(fw(g))}${esc(g.text)}<div class="small muted">${esc(g.metric||'')}　開始 ${esc(g.start||'—')} → 期間の合計 <b class="num">${tot[g.i]}</b>${esc(g.unit||'')}</div></div></div>`).join(''):'—'}</div></div>
      ${t.review?.end?.a||t.review?.end?.b||t.review?.end?.c?`<div class="link"><div class="lab">期末の振り返り</div><div class="val" style="display:flex;flex-direction:column;gap:6px">
        ${t.review.end.a?`<div class="kv"><b>広がったこと</b>${nl(t.review.end.a)}</div>`:''}
        ${t.review.end.b?`<div class="kv"><b>続く形になったもの</b>${nl(t.review.end.b)}</div>`:''}
        ${t.review.end.c?`<div class="kv"><b>できなかった理由</b>${nl(t.review.end.c)}</div>`:''}</div></div>`:''}
      ${(t.history||[]).length?`<div class="link"><div class="lab">見直しの履歴</div><div class="val hist">${t.history.map(h=>`<div><span class="num">${ymd(h.at)}</span>　${esc(h.note||'')}</div>`).join('')}</div></div>`:''}
      <div class="link"><div class="lab">週の記録</div><div class="val">${recs.length}回${recs.length?`<div class="hist" style="margin-top:6px">${recs.filter(r=>r.fact).slice(-12).reverse().map(r=>`<div><span class="num">${md(r.date)}</span> ${esc(r.fact)}</div>`).join('')}</div>`:''}</div></div>
      <p class="small muted">${ymd(t.closedAt)} に ${esc(t.closedBy||'')} が締めました</p>
    </div></details>`;}).join('');
}
function downloadJson(obj, filename){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
}

/* ---------- 入力 ---------- */
function setPath(obj, path, val){
  const ks=path.split('.'); let o=obj;
  for(let i=0;i<ks.length-1;i++){ const k=isNaN(ks[i])?ks[i]:Number(ks[i]); if(o[k]==null) o[k]={}; o=o[k]; }
  const last=ks.at(-1); o[isNaN(last)?last:Number(last)]=val;
}
document.addEventListener('input', e=>{
  if(e.target.dataset?.e && ui.edit){ setPath(ui.edit, e.target.dataset.e, e.target.value); return; }
  const el=e.target; const path=el.dataset?.d; if(!path||!ui.draft) return;
  setPath(ui.draft, path, el.type==='checkbox'? el.checked : el.value); ui.dirty=true;
  if((el.type==='radio' && (path.startsWith('check.')||path.endsWith('.decision'))) || (el.id==='rdate' && e.type==='input')){
    const y=window.scrollY; $('#tabbody').innerHTML=tabView(person()); window.scrollTo(0,y);
    document.getElementById(el.id)?.focus({preventScroll:true});
  }
});

document.addEventListener('change', e=>{ if(e.target.id==='viewerSel' && api?.switchViewer) api.switchViewer(e.target.value); });
document.addEventListener('submit', async e=>{
  e.preventDefault();
  if(e.target.id==='loginForm'){
    const email=$('#lemail').value.trim(), pw=$('#lpw')?.value||'', name=$('#lname')?.value.trim()||'';
    const errEl=$('#lerr'); errEl.textContent='';
    try{
      if(loginMode==='login') await api.login(email,pw);
      else if(loginMode==='register') await api.register(name,email,pw);
      else { await api.reset(email); errEl.textContent='再設定のメールを送りました。メールのリンクから新しいパスワードを決めてください。'; }
    }catch(err){ errEl.textContent=authMsg(err); }
    return;
  }
  if(e.target.id==='addForm'){
    const name=$('#nname').value.trim(), owner=normEmail($('#nowner').value), coaches=emailList($('#ncoach').value);
    if(!name||!owner.includes('@')){ toast('氏名と本人のメールアドレスを入れてください'); return; }
    let newId=null;
    const ok=await saveSafe(async()=>{ newId=await api.addPerson({name,store:$('#nstore').value,role:'',temp:'',coach:'',grower:'',periodStart:'',periodEnd:'',ownerEmail:owner,coachEmails:coaches,sheet:blankSheet(),review:blankReview(),history:[],createdAt:new Date().toISOString(),sheetUpdatedAt:null}); },`${name}さんを追加しました`);
    if(ok){ ui.addOpen=false; render(); }
  }
});

document.addEventListener('click', async e=>{
  const t=e.target.closest('[data-go],[data-tab],[data-act],[data-login]'); if(!t) return;
  if(t.dataset.login){ loginMode=t.dataset.login; renderLogin(); return; }
  if(t.dataset.go!==undefined){ go(t.dataset.go); return; }
  if(t.dataset.tab){ if(ui.dirty && !leaveOk()) return; ui.edit=null; ui.tab=t.dataset.tab; ui.dirty=false; ui.draft=null; ui.draftKey=''; render(); return; }
  const act=t.dataset.act;
  // ログインまわり
  if(act==='google'){ try{ await api.google(); }catch(err){ const m=authMsg(err); if(m){ const el=$('#lerr'); if(el) el.textContent=m; } } return; }
  if(act==='logout'){ if(ui.dirty && !leaveOk()) return; ui.dirty=false; ui.pid=null; await api.logout(); return; }
  if(act==='resend'){ try{ await api.resendVerify(); toast('確認メールを送りました'); }catch(err){ toast(authMsg(err)); } return; }
  if(act==='verified'){ const ok=await api.checkVerified(); if(!ok) toast('まだ確認が済んでいません。メールのリンクを押してください'); return; }
  if(act==='export'){
    if(!me.admin) return; t.disabled=true; t.textContent='書き出し中…';
    try{ const data=await api.exportAll(); downloadJson(data, `mokuhyo-note-backup-${today()}.json`); toast(`${data.people.length}人分を書き出しました`); }
    catch(e){ console.error(e); toast('書き出せませんでした'); }
    t.disabled=false; t.textContent='全データを書き出す'; return;
  }
  if(act==='toggle-inactive'){ ui.showInactive=!ui.showInactive; renderPeople(); render(); return; }
  if(act==='open-add'){ ui.addOpen=true; render(); $('#nname')?.focus(); return; }
  if(act==='close-add'){ ui.addOpen=false; render(); return; }

  const p=person(); if(!p) return;
  if(act==='save-record'){
    const d=ui.draft;
    if(isFuture(d.date)){ toast('今日より先の日付では記録できません'); return; }
    const same=recordsOf(p.id).filter(r=>weekKey(r.date)===weekKey(d.date||today()));
    if(same.length && t.dataset.arm!=='1'){ t.dataset.arm='1'; t.textContent='同じ週に追加で記録する'; toast('この週はもう記録があります。もう一度押すと追加で記録します'); return; }
    t.disabled=true;
    const labels=(p.sheet?.goals||[]).map(g=>g.metric||'');
    const rec={date:d.date||today(),values:d.values.map(toVal),goalLabels:labels,fact:d.fact.trim(),stuck:d.stuck.trim(),next:d.next.trim(),check:d.check,checkNote:d.checkNote.trim(),createdAt:new Date().toISOString(),createdBy:me.name,confirmedAt:null,confirmedBy:'',voiceDone:false,coachNote:'',coachNoteBy:''};
    const ok=await saveSafe(()=>api.addRecord(p.id,rec),'記録しました');
    if(ok){ ui.dirty=false; ui.draft=null; ui.draftKey=''; ui.tab='flow'; render(); window.scrollTo({top:0}); } else t.disabled=false;
    return;
  }
  if(act==='save-sheet'){
    const d=ui.draft; t.disabled=true; const now=new Date().toISOString();
    const hadGoals=activeGoals(p).length>0;
    const history=[...(p.history||[]), {at:now, by:me.name, note:d.changeNote?.trim() || (hadGoals?'目標を見直した':'はじめて目標を書いた'), goals:d.sheet.goals.map(g=>({forWhat:g.forWhat,text:g.text,metric:g.metric}))}].slice(-200);
    const data={name:d.name.trim(),store:d.store,role:d.role.trim(),temp:d.temp,coach:d.coach.trim(),grower:d.grower.trim(),periodStart:d.periodStart,periodEnd:d.periodEnd,sheet:d.sheet,sheetUpdatedAt:now,history};
    if(me.admin){ data.ownerEmail=normEmail(d.ownerEmail); data.coachEmails=emailList(d.coachEmails); }
    const voices=statusOf(p).voices;
    const ok=await saveSafe(()=>api.updatePerson(p.id,data),'シートを保存しました');
    if(ok){
      for(const r of voices) await saveSafe(()=>api.updateRecord(p.id,r.id,{voiceDone:true}));
      ui.dirty=false; ui.draft=null; ui.draftKey=''; render();
    } else t.disabled=false;
    return;
  }
  if(act==='save-review'){
    t.disabled=true; const ok=await saveSafe(()=>api.updatePerson(p.id,{review:ui.draft}),'振り返りを保存しました');
    if(ok) ui.dirty=false; t.disabled=false; return;
  }
  if(act==='close-term'){
    if(t.dataset.arm!=='1'){ t.dataset.arm='1'; t.textContent='もう一度押すと締めます（元に戻せません）'; setTimeout(()=>{ if(t.isConnected){ t.dataset.arm=''; t.textContent='この期を締める'; } },5000); return; }
    if(ui.dirty){ toast('振り返りを先に保存してください'); return; }
    t.disabled=true;
    const now=new Date().toISOString(); const recs=recordsOf(p.id);
    const start=p.periodStart || recs[0]?.date || (p.termStartAt||now).slice(0,10);
    const end=p.periodEnd || today();
    const term={label:`${ymd(start)} 〜 ${ymd(end)}`, periodStart:start, periodEnd:end, startAt:p.termStartAt||null, closedAt:now, closedBy:me.name,
      name:p.name||'', store:p.store||'', role:p.role||'', temp:p.temp||'', coach:p.coach||'', grower:p.grower||'',
      sheet:p.sheet||blankSheet(), review:p.review||blankReview(), history:p.history||[], recordCount:recs.length, totals:goalTotals(recs)};
    const old=p.sheet||blankSheet(); const ns=blankSheet();
    Object.assign(ns,{m10:old.m10||ns.m10, m11:old.m11||ns.m11, mission:old.mission||'', area:old.area||'', areaWhy:old.areaWhy||'', r21:old.r21||ns.r21});
    const next={termStartAt:now, periodStart:today(), periodEnd:'', sheet:ns, review:blankReview(), history:[], sheetUpdatedAt:null};
    const ok=await saveSafe(()=>api.closeTerm(p.id,term,next),'この期を保管しました。次の期の目標を書きましょう');
    if(ok){ ui.tab='sheet'; ui.dirty=false; ui.draft=null; ui.draftKey=''; render(); window.scrollTo({top:0}); } else t.disabled=false;
    return;
  }
  if(act==='suspend-person' || act==='resume-person'){
    if(!me.admin) return;
    if(ui.dirty){ toast('先にシートを保存するか、変更を取り消してください'); return; }
    if(t.dataset.arm!=='1'){ t.dataset.arm='1'; t.textContent= act==='suspend-person'?'もう一度押すと停止します':'もう一度押すと再開します'; setTimeout(()=>{ if(t.isConnected){ t.dataset.arm=''; t.textContent= act==='suspend-person'?'利用を停止する':'利用を再開する'; } },5000); return; }
    t.disabled=true; const now=new Date().toISOString();
    const data = act==='suspend-person'
      ? {status:'inactive', stoppedAt:now, stoppedBy:me.name, formerOwnerEmail:p.ownerEmail||'', formerCoachEmails:p.coachEmails||[], ownerEmail:'', coachEmails:[]}
      : {status:'active', resumedAt:now, ownerEmail:p.formerOwnerEmail||'', coachEmails:p.formerCoachEmails||[]};
    const ok=await saveSafe(()=>api.updatePerson(p.id,data), act==='suspend-person'?`${p.name}さんを利用停止にしました（データは残っています）`:`${p.name}さんの利用を再開しました`);
    if(ok){ ui.draft=null; ui.draftKey=''; render(); } else t.disabled=false;
    return;
  }
  if(act==='delete-person'){
    if(!me.admin) return;
    const typed=(document.getElementById('delConfirm')?.value||'').trim();
    if(!p.name || typed!==p.name.trim()){ toast('確認のため、氏名を正確に入力してください'); return; }
    t.disabled=true;
    const name=p.name;
    const ok=await saveSafe(()=>api.deletePerson(p.id),`${name}さんを削除しました`);
    if(ok){ ui.pid=null; ui.dirty=false; ui.draft=null; ui.draftKey=''; ls.set('mn.pid',''); render(); renderPeople(); window.scrollTo({top:0}); } else t.disabled=false;
    return;
  }
  if(act==='add-goal' || act==='archive-goal' || act==='restore-goal'){
    const d=ui.draft; if(!d?.sheet) return;
    const i=Number(t.dataset.i);
    if(act==='add-goal'){ d.sheet.goals.push(blankGoal()); }
    else if(act==='archive-goal'){
      const g=d.sheet.goals[i]; const empty=!(g.text||g.metric||g.forWhat);
      const used=allRecordsOf(p.id).some(r=>r.values && r.values[i]!==undefined && r.values[i]!==null && r.values[i]!=='');
      // 何も書いていない最後の目標は消す。それ以外は「外す」だけ（記録の位置を守る）
      if(empty && !used && i===d.sheet.goals.length-1 && d.sheet.goals.length>1) d.sheet.goals.pop(); else g.archived=true;
    } else if(act==='restore-goal'){ d.sheet.goals[i].archived=false; }
    ui.dirty=true; const y=window.scrollY; $('#tabbody').innerHTML=tabView(p); window.scrollTo(0,y);
    document.querySelectorAll('#tabbody details.sec').forEach(x=>{ if(x.querySelector('[data-act=add-goal]')) x.open=true; });
    if(act==='add-goal') document.getElementById(`sheet-goals-${d.sheet.goals.length-1}-forWhat`)?.focus();
    toast(act==='add-goal'?'目標を足しました。書いたら「シートを保存」を押してください':act==='archive-goal'?'目標を外しました。「シートを保存」で確定します':'目標を戻しました。「シートを保存」で確定します');
    return;
  }
  if(act==='edit-record'){
    if(ui.dirty && !leaveOk()) return;
    const r=allRecordsOf(p.id).find(x=>x.id===t.dataset.id); if(!r) return;
    ui.edit={rid:r.id, date:r.date||'', values:Array.from({length:Math.max(goalCount(p),(r.values||[]).length)},(_,i)=>r.values?.[i]??''), fact:r.fact||'', stuck:r.stuck||'', next:r.next||'', why:''};
    render(); document.getElementById('ed-date')?.focus(); return;
  }
  if(act==='cancel-edit'){ ui.edit=null; render(); return; }
  if(act==='save-edit'){
    const r=allRecordsOf(p.id).find(x=>x.id===t.dataset.id); const e=ui.edit; if(!r||!e) return;
    if(isFuture(e.date)){ toast('今日より先の日付にはできません'); return; }
    const after={date:e.date||r.date, values:e.values.map(toVal), fact:e.fact.trim(), stuck:e.stuck.trim(), next:e.next.trim()};
    const before={date:r.date||'', values:r.values||[], fact:r.fact||'', stuck:r.stuck||'', next:r.next||''};
    if(JSON.stringify(after)===JSON.stringify({...before,values:after.values.map((_,i)=>toVal(before.values[i]))})){ toast('変わったところがありません'); return; }
    t.disabled=true; const now=new Date().toISOString();
    const edits=[...(r.edits||[]), {at:now, by:me.name, why:(e.why||'').trim(), before}];
    const ok=await saveSafe(()=>api.updateRecord(p.id,r.id,{...after, edits, editedAt:now, editedBy:me.name}),'訂正しました（元の記録も残っています）');
    if(ok){ ui.edit=null; render(); } else t.disabled=false;
    return;
  }
  if(act==='confirm'){ await saveSafe(()=>api.updateRecord(p.id,t.dataset.id,{confirmedAt:new Date().toISOString(),confirmedBy:me.name}),'確認しました'); return; }
  if(act==='coach-note'){
    const v=document.getElementById('cn-'+t.dataset.id)?.value.trim(); if(!v){ toast('ひとことを書いてから押してください'); return; }
    await saveSafe(()=>api.updateRecord(p.id,t.dataset.id,{coachNote:v,coachNoteBy:me.name}),'返しました'); return;
  }
  if(act==='voice-done'){ await saveSafe(()=>api.updateRecord(p.id,t.dataset.id,{voiceDone:true}),'記録しました'); return; }
  if(act==='del-record'){
    if(t.dataset.arm!=='1'){ t.dataset.arm='1'; t.textContent='もう一度押すと削除'; setTimeout(()=>{t.dataset.arm='';t.textContent='削除';},4000); return; }
    await saveSafe(()=>api.deleteRecord(p.id,t.dataset.id),'削除しました'); return;
  }
});

boot();
})();
