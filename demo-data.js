// デモページ（demo.html）用の架空のデータ。人物・記録はすべて架空です。
// 日付は「今日」からさかのぼって作るので、いつ開いても最近の記録に見えます。
(() => {
  const DAY = 864e5;
  const iso = n => { const d = new Date(Date.now() - n * DAY); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const at = n => new Date(Date.now() - n * DAY).toISOString();
  const goal = (o) => Object.assign({forWhat:'',text:'',evidence:'',metric:'',unit:'',start:'',m1:'',y1:'',kind:'',checks:[true,true,true,true]}, o);
  const sheet = (o) => Object.assign({m10:['','',''],m11:['','',''],mission:'',area:'',areaWhy:'',r21:['','',''],r22:['','',''],r23:'',goals:[],readChecks:[true,true,true,true]}, o);
  const review = () => ({mid:[{done:'',stuck:'',decision:'',reason:''}],end:{a:'',b:'',c:''}});
  let n = 0; const rid = () => 'demo-r' + (++n);
  const rec = (daysAgo, values, fact, extra = {}) => Object.assign({
    id: rid(), date: iso(daysAgo), values, fact, stuck: '', next: '', check: values.map(() => 'keep'), checkNote: '',
    createdAt: at(daysAgo), confirmedAt: at(Math.max(daysAgo - 2, 0)), confirmedBy: 'コーチ 田中',
    voiceDone: false, coachNote: '', coachNoteBy: ''
  }, extra);

  window.MOKUHYO_DEMO = {
    viewers: [
      {key:'honnin', label:'本人として見る（青木さくら）', email:'aoki@demo.example', name:'青木さくら', admin:false},
      {key:'coach',  label:'コーチとして見る（田中）',     email:'tanaka@demo.example', name:'コーチ 田中', admin:false},
      {key:'admin',  label:'管理者として見る',             email:'admin@demo.example', name:'デモの管理者', admin:true}
    ],
    people: [
      {
        id:'demo-aoki', name:'青木さくら', store:'栄店', role:'フロント', temp:'T2', coach:'田中', grower:'森',
        periodStart: iso(56), periodEnd: iso(-126), ownerEmail:'aoki@demo.example', coachEmails:['tanaka@demo.example'],
        sheet: sheet({
          m10:['初めてのお客様に館内を案内したとき、帰りに「わかりやすかった、また来ます」と言われた','お客様の表情がやわらいだ。後輩もその案内を真似し始めた','自分のやり方が、人を通して広がったと感じたから'],
          mission:'わたしは、初めて来たお客様が迷わず安心してととのえるように、案内の型を仲間に手渡す人でありたい。',
          area:'元気を届ける', areaWhy:'目の前の一人のお客様の体験が、次の来店につながると思うから',
          r21:['フロントの案内の順番','自分のシフトでの初回案内','混雑時の待ち時間の説明'],
          r22:['','初回案内を、自分以外の人が一人でできるようになるまで見届ける','困っている新人に、自分から声をかける'],
          goals:[goal({forWhat:'初めて来店されたお客様が迷わず安心して使い始められるようにするために',text:'3か月後までに、自分以外の2名が同じご案内を一人でできる状態にする',metric:'その2名が一人でご案内した回数',unit:'回',start:'0',m1:'6',kind:'見届け'})]
        }),
        review: review(), history:[{at:at(56), by:'青木さくら', note:'はじめて目標を書いた', goals:[{forWhat:'初めて来店されたお客様が迷わず安心して使い始められるようにするために', text:'3か月後までに、自分以外の2名が同じご案内を一人でできる状態にする', metric:'その2名が一人でご案内した回数'}]}],
        createdAt: at(56), sheetUpdatedAt: at(40)
      },
      {
        id:'demo-ishii', name:'石井 健', store:'今池店', role:'清掃・設備', temp:'T1', coach:'田中', grower:'',
        periodStart: iso(30), periodEnd: iso(-150), ownerEmail:'ishii@demo.example', coachEmails:['tanaka@demo.example'],
        sheet: sheet({
          mission:'わたしは、お客様がけがなく安心して過ごせるように、ヒヤリとした場面を見逃さない人でありたい。',
          area:'森を育てる', r22:['','ヒヤリとした場面の記録を、再発しなくなるまで見届ける','床の濡れに気づいたら、担当外でも拾いにいく'],
          goals:[
            goal({forWhat:'安全に安心して入っていただくために',text:'期末までに、ヒヤリとした場面を記録し、同じことが起きない形に変える',metric:'ヒヤリとした場面を記録した件数',unit:'件',start:'0',m1:'4',kind:'拾い'}),
            goal({forWhat:'同じ場所で同じことが起きないようにするために',text:'記録した場面のうち、対策をして再発しなくなったものを増やす',metric:'再発しなくなった件数',unit:'件',start:'0',m1:'1',kind:'見届け'})
          ]
        }),
        review: review(), history:[], createdAt: at(30), sheetUpdatedAt: at(30)
      },
      {
        id:'demo-ueno', name:'上野真理', store:'福岡店', role:'ウィスキング', temp:'T3', coach:'森', grower:'',
        periodStart: iso(35), periodEnd: iso(-145), ownerEmail:'ueno@demo.example', coachEmails:['mori@demo.example'],
        termStartAt: at(36),
        sheet: sheet({
          mission:'わたしは、ウィスキングを受けた人が「からだが軽くなった」と帰れるように、施術の質を仲間と一緒に高める人でありたい。',
          area:'森を育てる', r22:['','新人2名の施術を、一人で担当できるまで見届ける','予約の重なりに先に気づいて調整する'],
          goals:[goal({forWhat:'どの時間帯でも同じ質の施術を届けるために',text:'期末までに、新人2名が一人で施術を担当できる状態にする',metric:'新人が一人で担当した施術の回数',unit:'回',start:'0',m1:'8',kind:'見届け'})]
        }),
        review: review(), history:[], createdAt: at(220), sheetUpdatedAt: at(35)
      }
    ],
    records: {
      'demo-aoki': [
        rec(52, [0], '新人の◯◯さんに、初回案内の順番を紙に書いて渡した', {stuck:'日勤帯の人と時間が合わない', next:'来週、夜勤の締め前に一緒に1組ご案内する'}),
        rec(45, [1], '◯◯さんが、わたしの横で1組を一人でご案内できた', {next:'次は△△さんにも同じ紙を渡す', coachNote:'紙に書いたのが効いていますね。△△さんにはどう渡しますか？', coachNoteBy:'コーチ 田中'}),
        rec(38, [2], '◯◯さんが2組を一人でご案内。質問はサウナの温度だけだった', {check:['fix'], checkNote:'「2名」と決めたけど、日勤には新人が1人しかいない', voiceDone:true}),
        rec(31, [null], '体調不良で2日休み。案内の練習はできなかった', {stuck:'休んだ分、練習の時間が取れていない'}),
        rec(24, [3], '△△さんが初めて一人でご案内。お客様から「わかりやすい」と言われていた', {next:'案内のときに使うひと言を3つにしぼって紙に足す'}),
        rec(17, [2], '混雑した日に、◯◯さんが待ち時間の説明まで一人でできた', {stuck:'土日の混雑時は自分が案内に入ってしまう'}),
        rec(10, [4], '◯◯さんと△△さんで、その日の初回案内をすべて回せた', {next:'自分は横で見るだけにする日をつくる', confirmedAt:null, confirmedBy:''}),
        rec(3,  [3], '案内のひと言を3つにしぼった紙を、フロントの全員に配った', {stuck:'紙が古くなったとき、誰が直すか決まっていない', next:'直す人を◯◯さんにお願いしてみる', confirmedAt:null, confirmedBy:''})
      ],
      'demo-ishii': [
        rec(28, [1, 0], '水風呂の前の床が濡れていて、お客様が滑りかけた。記録して店長に伝えた', {stuck:'どこに書けばいいか迷った'}),
        rec(21, [2, 0], '脱衣所の段差でつまずいた方がいた。注意の表示を出した'),
        rec(14, [1, 1], '水風呂前にマットを敷いてから、滑りかけた人はいない', {coachNote:'「起きなくなった」を見届けましたね。マットは誰が干していますか？', coachNoteBy:'コーチ 田中'})
      ],
      'demo-ueno': [
        rec(250, [2], '前の期：新人に施術の順番を見せた', {confirmedBy:'コーチ 森'}),
        rec(200, [5], '前の期：新人が仕上げの工程を一人でできた', {confirmedBy:'コーチ 森'}),
        rec(33, [1], '新人の◯◯さんが、最初のお客様を一人で担当した', {confirmedBy:'コーチ 森'}),
        rec(26, [3], '◯◯さんが3回担当。お客様アンケートで「また受けたい」が2件', {confirmedBy:'コーチ 森'}),
        rec(19, [2], '△△さんが初めて一人で担当。時間配分が押した', {stuck:'時間配分を教える方法がわからない', confirmedBy:'コーチ 森'}),
        rec(12, [4], '△△さんに砂時計を渡し、工程ごとの目安を一緒に決めた', {confirmedBy:'コーチ 森'}),
        rec(5,  [5], '◯◯さんと△△さんで、平日の施術をすべて回せた', {confirmedAt:null, confirmedBy:''})
      ]
    },
    terms: {
      'demo-ueno': [{
        id:'demo-t1', label:`${iso(220).replaceAll('-','/')} 〜 ${iso(37).replaceAll('-','/')}`, periodStart: iso(220), periodEnd: iso(37), startAt: null, closedAt: at(36), closedBy:'上野真理',
        name:'上野真理', store:'福岡店', role:'ウィスキング', temp:'T2', coach:'森', grower:'',
        sheet: sheet({mission:'わたしは、ウィスキングを受けた人が「からだが軽くなった」と帰れる時間をつくる人でありたい。',
          goals:[goal({forWhat:'施術の質をそろえるために',text:'期末までに、施術の手順書をつくり、新人が仕上げの工程を一人でできる状態にする',metric:'新人が仕上げを一人でできた回数',unit:'回',start:'0',m1:'4'})]}),
        review: {mid:[{done:'',stuck:'',decision:'',reason:''}], end:{a:'自分が施術するだけでなく、新人の仕上げまで見届けるようになった', b:'施術の手順書。新人はこれを見て練習している', c:''}},
        history: [], recordCount: 2, totals: [7]
      }]
    }
  };
})();
