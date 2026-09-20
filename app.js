
(() => {
  "use strict";

  const BANK = window.QUESTION_BANK;
  const QUESTIONS = BANK.questions;
  const BY_ID = new Map(QUESTIONS.map(q => [q.id, q]));
  const SUBJECTS = BANK.meta.subjects;
  const TYPE_LABEL = {single:"单选题", multi:"多选题", judge:"判断题"};
  const STORAGE_KEY = "js_gx_teacher_pwa_state_v3";
  const SESSION_KEY = "js_gx_teacher_session_v3";
  const MAX_HISTORY = 3000;

  const DEFAULT_STATE = {
    version: 3,
    profile: {dailyGoal: 30},
    records: {},
    history: [],
    daily: {},
    settings: {
      theme: "auto",
      shuffleQuestions: true,
      shuffleOptions: true,
      instantFeedback: true,
      wrongMasteryThreshold: 3
    },
    cloud: {projectUrl:"", anonKey:"", email:"", accessToken:"", refreshToken:"", userId:""},
    updatedAt: Date.now()
  };

  // Utility functions used during initial state loading must be defined before loadState() runs.
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
  const deepClone = obj => JSON.parse(JSON.stringify(obj));

  let state = loadState();
  let view = "home";
  let session = null;
  let examTimer = null;
  let searchQuery = "";
  let libraryFilter = {subject:"全部", type:"全部", status:"全部"};

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const todayKey = () => {
    const d = new Date();
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  };
  const addDays = (dateStr, days) => {
    const d = dateStr ? new Date(dateStr+"T12:00:00") : new Date();
    d.setDate(d.getDate()+days);
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  };
  function mergeDefaults(obj, defs) {
    if (!obj || typeof obj !== "object") return deepClone(defs);
    const out = deepClone(defs);
    for (const [k,v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
        out[k] = {...out[k], ...v};
      } else out[k] = v;
    }
    return out;
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? mergeDefaults(JSON.parse(raw), DEFAULT_STATE) : deepClone(DEFAULT_STATE);
    } catch(e) { return deepClone(DEFAULT_STATE); }
  }
  function saveState() {
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateHeaderStats();
  }
  function getRecord(id) {
    if (!state.records[id]) state.records[id] = {
      attempts:0, correct:0, wrong:0, streak:0, box:0, due:todayKey(),
      favorite:false, manual:"", wrongReasons:{}, lastAt:null, lastCorrect:null
    };
    return state.records[id];
  }
  function mastery(q) {
    const r = state.records[q.id];
    if (!r || !r.attempts) return "未学习";
    if (r.manual === "unmastered") return "未掌握";
    if (r.manual === "mastered") return "已掌握";
    const acc = r.correct / r.attempts;
    if ((r.attempts >= 3 && acc < .6) || r.wrong >= 2) return "易错";
    if (r.streak >= 3 && acc >= .75) return "已掌握";
    if (r.streak >= 1 && acc >= .6) return "熟悉";
    return "生疏";
  }
  function isDue(q) {
    const r=state.records[q.id];
    return !!(r && r.attempts && r.due && r.due <= todayKey());
  }
  function statsFor(list=QUESTIONS) {
    let attempts=0, correct=0, wrong=0, done=0, due=0, fav=0;
    for (const q of list) {
      const r=state.records[q.id];
      if(r?.attempts){done++;attempts+=r.attempts;correct+=r.correct;wrong+=r.wrong;}
      if(r?.favorite) fav++;
      if(isDue(q)) due++;
    }
    return {attempts,correct,wrong,done,due,fav,accuracy:attempts?Math.round(correct/attempts*100):0};
  }
  function streakDays() {
    let n=0, d=new Date();
    while(true){
      const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
      const k=`${y}-${m}-${day}`;
      if((state.daily[k]?.attempts||0)>0){n++;d.setDate(d.getDate()-1);}
      else break;
    }
    return n;
  }
  function updateHeaderStats() {
    const el=$("#topToday");
    if(!el) return;
    const day=state.daily[todayKey()]||{attempts:0,correct:0};
    el.textContent=`今日 ${day.attempts||0} 题`;
  }

  function hashCode(str) {
    let h=2166136261>>>0;
    for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
    return h>>>0;
  }
  function seededShuffle(arr, seed) {
    let x = seed || 123456789;
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      const j=x%(i+1); [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }
  function randomShuffle(arr) {
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  }

  function uniqueStrings(arr){return [...new Set(arr.map(x=>String(x).trim()).filter(Boolean))];}
  function optionPool(q) {
    let pool=[];
    const sameSubject=QUESTIONS.filter(x=>x.subject===q.subject && x.id!==q.id);
    if(q.type==="single"){
      pool=sameSubject.filter(x=>x.type==="single").flatMap(x=>x.answerParts||[]);
    }else if(q.type==="multi"){
      pool=sameSubject.filter(x=>x.type==="multi").flatMap(x=>x.answerParts||[]);
      if(pool.length<12) pool.push(...sameSubject.filter(x=>x.type==="single").flatMap(x=>x.answerParts||[]));
    }
    return uniqueStrings(pool).filter(x=>!(q.answerParts||[]).includes(x));
  }
  function buildOptions(q) {
    if(q.type==="judge") return [
      {value:"正确", correct:q.answerText==="正确"},
      {value:"错误", correct:q.answerText==="错误"}
    ];
    const correct=uniqueStrings(q.answerParts||[]);
    const desired=q.type==="single"?4:Math.max(5, Math.min(7, correct.length+3));

    // v7：优先使用为“这一道题”预生成的固定高仿真干扰项。
    // 这些干扰项按题干语义、答案类型、同科目概念家族与相似答案生成，
    // 不再从整科答案池随机抽取，因此人物题配人物、年份题配年份、
    // 理论题配相近理论、方法题配相近方法。
    const fixed=uniqueStrings(q.distractors||[]).filter(v=>!correct.includes(v));
    let opts=[...correct];
    for(const x of fixed){
      if(opts.length>=desired) break;
      if(!opts.includes(x)) opts.push(x);
    }

    // 兼容旧题库：固定干扰项不足时才回退到同科目答案池。
    if(opts.length<desired){
      const pool=seededShuffle(optionPool(q), hashCode(q.id+"pool"));
      for(const x of pool){
        if(opts.length>=desired) break;
        if(!opts.includes(x)) opts.push(x);
      }
    }

    const seed=hashCode(q.id+"opts-v7");
    return state.settings.shuffleOptions ? seededShuffle(opts, seed).map(v=>({value:v,correct:correct.includes(v)}))
                                         : opts.map(v=>({value:v,correct:correct.includes(v)}));
  }
  function maskQuestion(q) {
    if(q.type==="judge") return q.original;
    let s=q.original;
    const parts=[...(q.answerParts||[])].sort((a,b)=>b.length-a.length);
    for(const part of parts){
      if(!part) continue;
      const escaped=part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      s=s.replace(new RegExp(escaped,"g"),"【______】");
    }
    return s;
  }
  function isAnswerCorrect(q, selected) {
    const sel=uniqueStrings(selected).sort();
    const ans=(q.type==="judge"?[q.answerText]:uniqueStrings(q.answerParts||[])).sort();
    return sel.length===ans.length && sel.every((v,i)=>v===ans[i]);
  }
  function sourceExplanation(q) {
    if(q.type==="judge"){
      if(q.answerText==="正确"){
        return `按题库标准答案，本题表述为“正确”。建议把整句作为判断题知识点记忆。`;
      }
      return `按题库标准答案，本题表述为“错误”。原题库仅给出“×/错误”时，系统不会自行补写题库没有提供的订正句。`;
    }
    if(q.type==="multi"){
      return `本题需要同时记住 ${q.answerParts.length} 个标准答案要点：${q.answerParts.map(x=>"“"+x+"”").join("、")}。多选题建议按“题干关键词 → 完整要点组”整体记忆，避免漏选。`;
    }
    return `本题的核心记忆配对是：题干关键词 → “${q.answerText}”。复习时优先记住人物、年代、概念、制度或结论之间的一一对应关系。`;
  }
  function keywordHint(q) {
    const years = q.original.match(/\d{3,4}\s*年/g) || [];
    const quoted = [...q.original.matchAll(/[“《](.*?)[”》]/g)].map(m=>m[1]).slice(0,2);
    let tags=[...years,...quoted];
    if(q.type!=="judge") tags.push(...(q.answerParts||[]).slice(0,2));
    tags=uniqueStrings(tags).slice(0,4);
    return tags.length?tags:["题干—答案配对"];
  }

  function setView(v){view=v; render();}
  window.setView=setView;

  function navHtml(active){
    const items=[
      ["home","⌂","首页"],["practice","▣","刷题"],["wrong","!","错题"],["stats","◫","统计"],["settings","⚙","我的"]
    ];
    return `<nav class="bottom-nav">${items.map(([id,ico,label])=>`
      <button class="${active===id?"active":""}" data-nav="${id}">
        <span class="nav-ico">${ico}</span><span>${label}</span>
      </button>`).join("")}</nav>`;
  }

  function shell(content, active="home") {
    return `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand"><div class="brand-mark">✓</div><div><b>高校教师资格岗前培训</b><small>江苏题库 · ${QUESTIONS.length}题</small></div></div>
          <div class="top-actions"><span id="topToday"></span><button class="icon-btn" data-action="theme" aria-label="切换深色模式">◐</button></div>
        </header>
        <main class="content">${content}</main>
        ${navHtml(active)}
      </div>`;
  }

  function render(){
    clearInterval(examTimer);
    const root=$("#app");
    if(session && view==="quiz") root.innerHTML=shell(renderQuiz(),"practice");
    else if(view==="home") root.innerHTML=shell(renderHome(),"home");
    else if(view==="practice") root.innerHTML=shell(renderPracticeHub(),"practice");
    else if(view==="wrong") root.innerHTML=shell(renderWrongHub(),"wrong");
    else if(view==="stats") root.innerHTML=shell(renderStats(),"stats");
    else if(view==="settings") root.innerHTML=shell(renderSettings(),"settings");
    else if(view==="search") root.innerHTML=shell(renderSearch(),"practice");
    else root.innerHTML=shell(renderHome(),"home");
    bindCommon();
    updateHeaderStats();
    if(session && view==="quiz") bindQuiz();
    if(view==="stats") renderHeatmap();
    if(state.settings.theme==="dark" || (state.settings.theme==="auto" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.dataset.theme="dark";
    else document.documentElement.dataset.theme="light";
  }

  function renderHome(){
    const s=statsFor();
    const day=state.daily[todayKey()]||{attempts:0,correct:0};
    const due=QUESTIONS.filter(isDue).length;
    const unseen=QUESTIONS.filter(q=>!state.records[q.id]?.attempts).length;
    const mCounts={};
    QUESTIONS.forEach(q=>mCounts[mastery(q)]=(mCounts[mastery(q)]||0)+1);
    const goal=state.profile.dailyGoal||30;
    const pct=clamp(Math.round((day.attempts||0)/goal*100),0,100);
    return `
      <section class="hero-card">
        <div>
          <div class="eyebrow">随时刷 · 随手记 · 多端可同步</div>
          <h1>今天再刷几题？</h1>
          <p>优先覆盖未做题，再用错题与间隔复习巩固。</p>
        </div>
        <div class="goal-ring" style="--p:${pct}"><div><b>${day.attempts||0}</b><span>/${goal}题</span></div></div>
      </section>

      <section class="quick-grid">
        <button class="quick primary" data-start="quick10"><span>⚡</span><b>快刷 10 题</b><small>零碎时间首选</small></button>
        <button class="quick" data-start="continue"><span>▶</span><b>继续刷题</b><small>优先未做 + 今日复习</small></button>
        <button class="quick" data-start="due"><span>↻</span><b>今日复习</b><small>${due} 题待复习</small></button>
        <button class="quick" data-nav="wrong"><span>✕</span><b>错题强化</b><small>${s.wrong} 次错误记录</small></button>
      </section>

      <section class="section">
        <div class="section-title"><h2>学习概览</h2><button class="text-btn" data-nav="stats">详细统计 ›</button></div>
        <div class="metric-grid">
          <div class="metric"><b>${s.done}</b><span>已覆盖 / ${QUESTIONS.length}</span></div>
          <div class="metric"><b>${s.accuracy}%</b><span>累计正确率</span></div>
          <div class="metric"><b>${unseen}</b><span>未学习</span></div>
          <div class="metric"><b>${streakDays()}</b><span>连续学习天数</span></div>
        </div>
      </section>

      <section class="section">
        <div class="section-title"><h2>掌握度</h2></div>
        <div class="mastery-strip">
          ${["已掌握","熟悉","生疏","易错","未掌握","未学习"].map(x=>`<button data-library-status="${x}"><b>${mCounts[x]||0}</b><span>${x}</span></button>`).join("")}
        </div>
      </section>

      <section class="section">
        <div class="section-title"><h2>五科分类练习</h2><button class="text-btn" data-nav="search">搜索题库 ›</button></div>
        <div class="subject-list">
          ${SUBJECTS.map((sub,i)=>{
            const list=QUESTIONS.filter(q=>q.subject===sub), st=statsFor(list);
            return `<button class="subject-card" data-subject="${esc(sub)}">
              <span class="subject-num">${i+1}</span>
              <span class="subject-main"><b>${esc(sub)}</b><small>已做 ${st.done}/220 · 正确率 ${st.accuracy}%</small></span>
              <span class="chev">›</span>
            </button>`;
          }).join("")}
        </div>
      </section>`;
  }

  function renderPracticeHub(){
    return `
      <section class="page-head"><div><div class="eyebrow">PRACTICE</div><h1>选择刷题方式</h1><p>可以按科目、题型、学习状态组合筛选。</p></div><button class="icon-btn" data-nav="search">⌕</button></section>

      <section class="section card-panel">
        <h2>分类练习</h2>
        <label>科目<select id="practiceSubject"><option>全部</option>${SUBJECTS.map(s=>`<option>${esc(s)}</option>`).join("")}</select></label>
        <div class="segmented" id="practiceType">
          <button class="active" data-value="全部">全部</button><button data-value="single">单选</button><button data-value="multi">多选</button><button data-value="judge">判断</button>
        </div>
        <label>范围<select id="practiceStatus">
          <option value="unseen">未做题优先</option><option value="due">今日复习</option><option value="all">全部题目</option>
          <option value="wrong">错题</option><option value="favorite">收藏题</option><option value="unmastered">未掌握</option>
        </select></label>
        <label>题量<input id="practiceCount" type="number" min="1" max="220" value="20"></label>
        <button class="big-btn" data-action="startPractice">开始练习</button>
      </section>

      <section class="section card-panel">
        <h2>随机组卷 / 模拟考试</h2>
        <div class="form-grid">
          <label>单选题<input id="examSingle" type="number" min="0" max="160" value="30"></label>
          <label>多选题<input id="examMulti" type="number" min="0" max="20" value="10"></label>
          <label>判断题<input id="examJudge" type="number" min="0" max="40" value="10"></label>
          <label>考试时间（分钟）<input id="examMinutes" type="number" min="1" max="180" value="60"></label>
        </div>
        <p class="note">题库文件未给出真实考试题量比例，因此这里采用“自行配置”，不把默认值标称为真实考试比例。</p>
        <button class="big-btn secondary" data-action="startExam">开始模拟考试</button>
      </section>

      <section class="section card-panel">
        <h2>背题模式</h2><p>先看挖空题干，点击后显示标准答案，再标记“不认识 / 有印象 / 已掌握”。</p>
        <button class="big-btn ghost" data-action="startRecite">开始背题</button>
      </section>`;
  }

  function filterQuestions({subject="全部", type="全部", status="all"}={}){
    return QUESTIONS.filter(q=>{
      if(subject!=="全部" && q.subject!==subject) return false;
      if(type!=="全部" && q.type!==type) return false;
      const r=state.records[q.id];
      if(status==="unseen" && r?.attempts) return false;
      if(status==="due" && !isDue(q)) return false;
      if(status==="wrong" && !(r?.wrong>0 && mastery(q)!=="已掌握")) return false;
      if(status==="favorite" && !r?.favorite) return false;
      if(status==="unmastered" && !["未掌握","生疏","易错"].includes(mastery(q))) return false;
      if(status && status!=="all" && !["unseen","due","wrong","favorite","unmastered"].includes(status) && mastery(q)!==status) return false;
      return true;
    });
  }

  function startSession(ids, mode="practice", opts={}){
    if(!ids.length){toast("当前筛选条件下没有题目");return;}
    if(state.settings.shuffleQuestions && !opts.keepOrder) ids=randomShuffle(ids);
    session={
      ids, mode, idx:0, answers:{}, checked:{}, startedAt:Date.now(),
      timeLimitMin:opts.timeLimitMin||0, reveal:false, recite:mode==="recite",
      config:opts
    };
    sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
    view="quiz"; render();
  }

  function renderQuiz(){
    if(!session || !session.ids.length) return `<p>没有题目。</p>`;
    const q=BY_ID.get(session.ids[session.idx]);
    if(!q) return `<p>题目不存在。</p>`;
    const checked=!!session.checked[q.id];
    const selected=session.answers[q.id]||[];
    const correct=checked?isAnswerCorrect(q,selected):false;
    const r=state.records[q.id];
    const opts=buildOptions(q);
    const progress=Math.round((session.idx+1)/session.ids.length*100);
    const isExam=session.mode==="exam";
    const isRecite=session.mode==="recite";

    let body="";
    if(isRecite){
      body=`
        <div class="question-text">${esc(maskQuestion(q))}</div>
        ${session.reveal?`
          <div class="answer-reveal"><span>标准答案</span><b>${esc(q.answerText)}</b></div>
          <div class="recite-actions">
            <button data-recite="again">不认识</button><button data-recite="familiar">有印象</button><button data-recite="mastered">已掌握</button>
          </div>`:
          `<button class="big-btn" data-action="reveal">显示答案</button>`}
      `;
    }else{
      body=`
        <div class="question-text">${esc(maskQuestion(q))}</div>
        <div class="options">
          ${opts.map((o,i)=>{
            const sel=selected.includes(o.value);
            let cls=sel?"selected":"";
            if(checked && !isExam){
              if(o.correct) cls+=" correct";
              else if(sel) cls+=" wrong";
            }
            const inputType=q.type==="multi"?"checkbox":"radio";
            return `<label class="option ${cls}">
              <input type="${inputType}" name="answer" value="${esc(o.value)}" ${sel?"checked":""} ${checked&&!isExam?"disabled":""}>
              <span class="option-letter">${String.fromCharCode(65+i)}</span><span class="option-text">${esc(o.value)}</span>
              ${checked&&!isExam&&o.correct?'<span class="status-mark">✓</span>':checked&&!isExam&&sel?'<span class="status-mark">✕</span>':""}
            </label>`;
          }).join("")}
        </div>
        ${checked&&!isExam?renderFeedback(q,correct):""}
      `;
    }

    return `
      <section class="quiz-page">
        <div class="quiz-top">
          <button class="icon-btn" data-action="exitQuiz">‹</button>
          <div class="quiz-progress"><div><span>${session.idx+1}/${session.ids.length}</span><b>${esc(q.subject)}</b></div><div class="progress"><i style="width:${progress}%"></i></div></div>
          <button class="icon-btn ${r?.favorite?"favorite":""}" data-action="favorite">☆</button>
        </div>
        ${isExam?`<div class="exam-clock" id="examClock">计时中</div>`:""}
        <article class="question-card">
          <div class="q-meta"><span>${TYPE_LABEL[q.type]}</span><span>${esc(q.id)}</span><span>${mastery(q)}</span></div>
          ${body}
        </article>
        ${!isRecite?`
        <div class="quiz-actions">
          <button class="minor-btn" data-action="flagUnmastered">${r?.manual==="unmastered"?"取消未掌握":"标记未掌握"}</button>
          ${isExam?`<button class="big-btn" data-action="${session.idx===session.ids.length-1?"submitExam":"nextExam"}">${session.idx===session.ids.length-1?"交卷":"保存并下一题"}</button>`:
            checked?`<button class="big-btn" data-action="nextQuestion">${session.idx===session.ids.length-1?"完成":"下一题"}</button>`:
            `<button class="big-btn" data-action="submitAnswer">提交答案</button>`}
        </div>`:""}
      </section>`;
  }

  function renderFeedback(q, correct){
    const ans=q.type==="judge"?q.answerText:q.answerText;
    return `<div class="feedback ${correct?"ok":"bad"}">
      <div class="feedback-title">${correct?"✓ 回答正确":"✕ 回答错误"}</div>
      <div class="answer-line"><span>标准答案</span><b>${esc(ans)}</b></div>
      <details open><summary>题库原文</summary><p>${esc(q.original)}</p></details>
      <details open><summary>辅助理解</summary><p>${esc(sourceExplanation(q))}</p>
        <div class="tags">${keywordHint(q).map(x=>`<span>${esc(x)}</span>`).join("")}</div>
        <p class="source-note">“标准答案/题库原文”来自上传题库；“辅助理解/记忆提示”为系统基于题库文字生成的学习辅助，不替代题库原文。</p>
      </details>
      ${!correct?`<div class="wrong-reason"><span>这次为什么错？</span>${["概念混淆","记忆不牢","审题失误","多选漏选","时间/人物混淆"].map(x=>`<button data-wrong-reason="${x}">${x}</button>`).join("")}</div>`:""}
    </div>`;
  }

  function recordAnswer(q, selected, correct, mode){
    const r=getRecord(q.id);
    r.attempts++; r.lastAt=Date.now(); r.lastCorrect=correct;
    if(correct){r.correct++;r.streak++;r.box=Math.min(5,(r.box||0)+1);}
    else{r.wrong++;r.streak=0;r.box=0;}
    const intervals=[0,1,3,7,14,30];
    r.due=addDays(todayKey(), correct?intervals[r.box]:0);
    const k=todayKey();
    state.daily[k]=state.daily[k]||{attempts:0,correct:0};
    state.daily[k].attempts++; if(correct) state.daily[k].correct++;
    state.history.push({id:q.id, at:Date.now(), correct, mode, selected});
    if(state.history.length>MAX_HISTORY) state.history=state.history.slice(-MAX_HISTORY);
    saveState();
  }

  function submitCurrent(){
    const q=BY_ID.get(session.ids[session.idx]);
    const selected=[...document.querySelectorAll('input[name="answer"]:checked')].map(x=>x.value);
    if(!selected.length){toast("请先选择答案");return;}
    session.answers[q.id]=selected;
    const correct=isAnswerCorrect(q,selected);
    session.checked[q.id]=true;
    recordAnswer(q,selected,correct,session.mode);
    persistSession(); render();
  }

  function persistSession(){try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));}catch(e){}}

  function nextQuestion(){
    if(session.idx>=session.ids.length-1){
      const done=session.ids.length;
      session=null;sessionStorage.removeItem(SESSION_KEY);view="home";render();toast(`本轮完成 ${done} 题`);
      return;
    }
    session.idx++;session.reveal=false;persistSession();render();
  }

  function submitExam(){
    let correctN=0, answered=0;
    for(const id of session.ids){
      const q=BY_ID.get(id), sel=session.answers[id]||[];
      if(sel.length){answered++; const ok=isAnswerCorrect(q,sel); if(ok) correctN++; recordAnswer(q,sel,ok,"exam");}
    }
    const total=session.ids.length, score=total?Math.round(correctN/total*100):0;
    const summary={correctN,answered,total,score,ids:[...session.ids],answers:{...session.answers}};
    session=null;sessionStorage.removeItem(SESSION_KEY);
    view="home";render();
    setTimeout(()=>showExamResult(summary),80);
  }

  function showExamResult(res){
    const wrongIds=res.ids.filter(id=>!isAnswerCorrect(BY_ID.get(id),res.answers[id]||[]));
    modal(`
      <div class="result-score">${res.score}<small>分</small></div>
      <h2>模拟考试完成</h2><p>共 ${res.total} 题，已答 ${res.answered} 题，正确 ${res.correctN} 题。</p>
      <div class="modal-actions">
        <button class="big-btn" data-modal-close>返回首页</button>
        ${wrongIds.length?`<button class="big-btn secondary" id="reviewExamWrong">重刷本卷错题（${wrongIds.length}）</button>`:""}
      </div>`, ()=>{
        const b=$("#reviewExamWrong"); if(b) b.onclick=()=>{closeModal();startSession(wrongIds,"practice");};
      });
  }

  function renderWrongHub(){
    const wrong=QUESTIONS.filter(q=>state.records[q.id]?.wrong>0 && mastery(q)!=="已掌握");
    const fav=QUESTIONS.filter(q=>state.records[q.id]?.favorite);
    const unmastered=QUESTIONS.filter(q=>["未掌握","生疏","易错"].includes(mastery(q)));
    return `
      <section class="page-head"><div><div class="eyebrow">REVIEW</div><h1>错题与重点</h1><p>错题默认采用“连续掌握”思路，不会因为答对一次就消失。</p></div></section>
      <div class="review-cards">
        <button data-start-special="wrong"><b>${wrong.length}</b><span>错题强化</span><small>答对后继续巩固</small></button>
        <button data-start-special="favorite"><b>${fav.length}</b><span>收藏题</span><small>重点题集中复习</small></button>
        <button data-start-special="unmastered"><b>${unmastered.length}</b><span>未掌握</span><small>生疏、易错、手动标记</small></button>
        <button data-start-special="due"><b>${QUESTIONS.filter(isDue).length}</b><span>今日复习</span><small>按间隔复习计划</small></button>
      </div>
      <section class="section card-panel">
        <div class="section-title"><h2>错因统计</h2></div>
        ${renderWrongReasonStats()}
      </section>
      <section class="section card-panel">
        <h2>导出复习材料</h2>
        <div class="button-row"><button class="minor-btn" data-action="exportWrongTxt">导出错题 TXT</button><button class="minor-btn" data-action="exportFavTxt">导出收藏 TXT</button></div>
      </section>`;
  }
  function renderWrongReasonStats(){
    const c={};
    Object.values(state.records).forEach(r=>Object.entries(r.wrongReasons||{}).forEach(([k,v])=>c[k]=(c[k]||0)+v));
    const entries=Object.entries(c).sort((a,b)=>b[1]-a[1]);
    if(!entries.length) return `<p class="muted">答错后可选择错因，系统会在这里汇总。</p>`;
    const max=Math.max(...entries.map(x=>x[1]));
    return `<div class="bar-list">${entries.map(([k,v])=>`<div><span>${k}</span><i><b style="width:${v/max*100}%"></b></i><em>${v}</em></div>`).join("")}</div>`;
  }

  function renderStats(){
    const all=statsFor();
    const day=state.daily[todayKey()]||{attempts:0,correct:0};
    const subjectRows=SUBJECTS.map(s=>{const st=statsFor(QUESTIONS.filter(q=>q.subject===s));return [s,st];});
    const types=["single","multi","judge"].map(t=>[t,statsFor(QUESTIONS.filter(q=>q.type===t))]);
    return `
      <section class="page-head"><div><div class="eyebrow">STATISTICS</div><h1>学习统计</h1><p>以实际作答记录计算，不把浏览题目计入已做。</p></div></section>
      <div class="metric-grid large">
        <div class="metric"><b>${all.attempts}</b><span>累计作答</span></div><div class="metric"><b>${all.accuracy}%</b><span>累计正确率</span></div>
        <div class="metric"><b>${day.attempts||0}</b><span>今日作答</span></div><div class="metric"><b>${streakDays()}</b><span>连续天数</span></div>
      </div>
      <section class="section card-panel"><h2>近 8 周学习热力图</h2><div id="heatmap" class="heatmap"></div></section>
      <section class="section card-panel"><h2>按科目</h2><div class="stat-table">${subjectRows.map(([s,st])=>`<div><span>${esc(s)}</span><b>${st.done}/220</b><em>${st.accuracy}%</em></div>`).join("")}</div></section>
      <section class="section card-panel"><h2>按题型</h2><div class="stat-table">${types.map(([t,st])=>`<div><span>${TYPE_LABEL[t]}</span><b>${st.done}题</b><em>${st.accuracy}%</em></div>`).join("")}</div></section>
      <section class="section card-panel"><h2>掌握度分布</h2>${renderMasteryBars()}</section>`;
  }
  function renderMasteryBars(){
    const order=["已掌握","熟悉","生疏","易错","未掌握","未学习"], c={};
    QUESTIONS.forEach(q=>c[mastery(q)]=(c[mastery(q)]||0)+1);
    return `<div class="bar-list">${order.map(k=>`<div><span>${k}</span><i><b style="width:${(c[k]||0)/QUESTIONS.length*100}%"></b></i><em>${c[k]||0}</em></div>`).join("")}</div>`;
  }
  function renderHeatmap(){
    const el=$("#heatmap"); if(!el) return;
    const days=[];
    for(let i=55;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");const k=`${y}-${m}-${day}`;days.push([k,state.daily[k]?.attempts||0]);}
    const max=Math.max(1,...days.map(x=>x[1]));
    el.innerHTML=days.map(([k,v])=>`<div class="heat" title="${k}: ${v}题" style="--a:${v?(.18+.82*v/max):.06}"><span>${v||""}</span></div>`).join("");
  }

  function renderSearch(){
    const results=searchQuery.trim()?QUESTIONS.filter(q=>(q.original+" "+q.answerText+" "+q.subject).toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0,100):[];
    return `
      <section class="page-head"><div><div class="eyebrow">SEARCH</div><h1>搜索题库</h1></div></section>
      <div class="search-box"><input id="searchInput" placeholder="输入：洪堡、学术自由、教师法……" value="${esc(searchQuery)}"><button data-action="doSearch">搜索</button></div>
      <p class="muted">${searchQuery?`找到 ${results.length}${results.length===100?"+":""} 条结果`:"可搜索题干、标准答案和科目"}</p>
      <div class="search-results">${results.map(q=>`<button data-open-q="${q.id}"><div><span>${esc(q.subject)} · ${TYPE_LABEL[q.type]}</span><b>${esc(maskQuestion(q))}</b><small>标准答案：${esc(q.answerText)}</small></div><i>›</i></button>`).join("")}</div>`;
  }

  function renderSettings(){
    const c=state.cloud||DEFAULT_STATE.cloud;
    return `
      <section class="page-head"><div><div class="eyebrow">SETTINGS</div><h1>我的设置</h1><p>本机数据默认存储在浏览器中；云同步为可选功能。</p></div></section>
      <section class="section card-panel">
        <h2>学习设置</h2>
        <label>每日目标（题）<input id="dailyGoal" type="number" min="1" max="500" value="${state.profile.dailyGoal||30}"></label>
        <label class="switch-row"><span>打乱题目</span><input id="shuffleQuestions" type="checkbox" ${state.settings.shuffleQuestions?"checked":""}></label>
        <label class="switch-row"><span>打乱选项</span><input id="shuffleOptions" type="checkbox" ${state.settings.shuffleOptions?"checked":""}></label>
        <label>外观<select id="themeSelect"><option value="auto" ${state.settings.theme==="auto"?"selected":""}>跟随系统</option><option value="light" ${state.settings.theme==="light"?"selected":""}>浅色</option><option value="dark" ${state.settings.theme==="dark"?"selected":""}>深色</option></select></label>
        <button class="big-btn" data-action="saveSettings">保存设置</button>
      </section>

      <section class="section card-panel">
        <h2>学习数据</h2>
        <div class="button-row"><button class="minor-btn" data-action="exportData">导出备份</button><label class="minor-btn file-btn">导入备份<input type="file" id="importData" accept=".json,application/json"></label></div>
        <button class="danger-btn" data-action="resetData">清空本机学习记录</button>
      </section>

      <section class="section card-panel">
        <h2>iPhone / iPad 安装</h2>
        <p>使用 Safari 打开部署后的 HTTPS 网站，点击“分享” → “添加到主屏幕”。安装后将以独立 App 方式全屏运行，并支持离线缓存。</p>
        <button class="minor-btn" data-action="installHelp">查看安装说明</button>
      </section>

      <section class="section card-panel">
        <h2>可选：Supabase 三端同步</h2>
        <p class="note">只有在你自行创建 Supabase 项目并运行随包提供的 <code>supabase_schema.sql</code> 后才启用。项目 URL 与 anon key 属于 Supabase 客户端公开配置；账户密码仅用于向你自己的 Supabase Auth 登录，并保存在本设备浏览器中。</p>
        <label>Project URL<input id="cloudUrl" placeholder="https://xxxx.supabase.co" value="${esc(c.projectUrl||"")}"></label>
        <label>Anon public key<input id="cloudKey" type="password" placeholder="eyJ..." value="${esc(c.anonKey||"")}"></label>
        <label>邮箱<input id="cloudEmail" type="email" placeholder="you@example.com" value="${esc(c.email||"")}"></label>
        <label>密码<input id="cloudPassword" type="password" placeholder="Supabase 登录密码"></label>
        <div class="button-row"><button class="minor-btn" data-action="cloudRegister">注册</button><button class="minor-btn" data-action="cloudLogin">登录</button></div>
        <div class="button-row"><button class="minor-btn" data-action="cloudPush">上传进度</button><button class="minor-btn" data-action="cloudPull">下载进度</button></div>
        <p class="cloud-status">${c.userId?`已登录：${esc(c.email||c.userId)}`:"当前未登录云同步"}</p>
      </section>
      <section class="section card-panel"><h2>题库说明</h2><p>共 ${QUESTIONS.length} 题，5 科，每科 220 题：160 单选、20 多选、40 判断。程序保留题库标准答案；原题库未提供完整 A/B/C/D 选项，因此选择题干扰项由同科目答案池自动生成，并不属于题库原文。</p></section>`;
  }

  function bindCommon(){
    $$("[data-nav]").forEach(b=>b.onclick=()=>setView(b.dataset.nav));
    $$("[data-start='quick10']").forEach(b=>b.onclick=()=>{
      const unseen=filterQuestions({status:"unseen"}), due=filterQuestions({status:"due"});
      const pool=uniqueById([...randomShuffle(due),...randomShuffle(unseen),...randomShuffle(QUESTIONS)]);
      startSession(pool.slice(0,10).map(q=>q.id),"practice");
    });
    $$("[data-start='continue']").forEach(b=>b.onclick=()=>{
      const pool=uniqueById([...filterQuestions({status:"due"}),...filterQuestions({status:"unseen"}),...QUESTIONS]);
      startSession(pool.slice(0,20).map(q=>q.id),"practice");
    });
    $$("[data-start='due']").forEach(b=>b.onclick=()=>startSession(filterQuestions({status:"due"}).map(q=>q.id),"practice"));
    $$("[data-subject]").forEach(b=>b.onclick=()=>startSession(filterQuestions({subject:b.dataset.subject,status:"unseen"}).slice(0,30).map(q=>q.id),"practice"));
    $$("[data-library-status]").forEach(b=>b.onclick=()=>startSession(filterQuestions({status:b.dataset.libraryStatus}).slice(0,50).map(q=>q.id),"practice"));
    $$("[data-start-special]").forEach(b=>b.onclick=()=>startSession(filterQuestions({status:b.dataset.startSpecial}).map(q=>q.id),"practice"));

    const themeBtn=$('[data-action="theme"]'); if(themeBtn) themeBtn.onclick=()=>{state.settings.theme=state.settings.theme==="dark"?"light":"dark";saveState();render();};

    if(view==="practice"){
      $$("#practiceType button").forEach(b=>b.onclick=()=>{$$("#practiceType button").forEach(x=>x.classList.remove("active"));b.classList.add("active");});
      const sp=$('[data-action="startPractice"]'); if(sp) sp.onclick=()=>{
        const subject=$("#practiceSubject").value, type=$("#practiceType .active").dataset.value, status=$("#practiceStatus").value;
        const count=clamp(parseInt($("#practiceCount").value)||20,1,220);
        let list=filterQuestions({subject,type,status});
        if(status==="unseen" && list.length<count){
          const more=filterQuestions({subject,type,status:"all"}).filter(q=>!list.some(x=>x.id===q.id));
          list=[...list,...more];
        }
        startSession(list.slice(0,count).map(q=>q.id),"practice");
      };
      const se=$('[data-action="startExam"]'); if(se) se.onclick=()=>{
        const nS=+$("#examSingle").value||0,nM=+$("#examMulti").value||0,nJ=+$("#examJudge").value||0,mins=+$("#examMinutes").value||60;
        const ids=[
          ...randomShuffle(QUESTIONS.filter(q=>q.type==="single")).slice(0,nS),
          ...randomShuffle(QUESTIONS.filter(q=>q.type==="multi")).slice(0,nM),
          ...randomShuffle(QUESTIONS.filter(q=>q.type==="judge")).slice(0,nJ)
        ].map(q=>q.id);
        startSession(ids,"exam",{timeLimitMin:mins});
      };
      const sr=$('[data-action="startRecite"]'); if(sr) sr.onclick=()=>{
        const pool=uniqueById([...filterQuestions({status:"due"}),...filterQuestions({status:"unseen"}),...QUESTIONS]).slice(0,50);
        startSession(pool.map(q=>q.id),"recite");
      };
    }

    if(view==="wrong"){
      const ew=$('[data-action="exportWrongTxt"]'); if(ew) ew.onclick=()=>exportText(filterQuestions({status:"wrong"}),"错题复习");
      const ef=$('[data-action="exportFavTxt"]'); if(ef) ef.onclick=()=>exportText(filterQuestions({status:"favorite"}),"收藏题复习");
    }

    if(view==="search"){
      const inp=$("#searchInput");
      if(inp) inp.onkeydown=e=>{if(e.key==="Enter"){searchQuery=inp.value;render();}};
      const ds=$('[data-action="doSearch"]'); if(ds) ds.onclick=()=>{searchQuery=inp.value;render();};
      $$("[data-open-q]").forEach(b=>b.onclick=()=>startSession([b.dataset.openQ],"practice",{keepOrder:true}));
    }

    if(view==="settings") bindSettings();
  }
  function uniqueById(list){const seen=new Set();return list.filter(q=>q&&!seen.has(q.id)&&seen.add(q.id));}

  function bindQuiz(){
    const q=BY_ID.get(session.ids[session.idx]);
    $$('input[name="answer"]').forEach(inp=>inp.onchange=()=>{
      const allInputs=[...document.querySelectorAll('input[name="answer"]')];

      // v8：选择后立即给出视觉反馈，不必等到“提交答案”
      if(q.type==="multi"){
        allInputs.forEach(x=>x.closest(".option")?.classList.toggle("selected", x.checked));
      }else{
        allInputs.forEach(x=>x.closest(".option")?.classList.remove("selected"));
        if(inp.checked) inp.closest(".option")?.classList.add("selected");
      }

      const vals=allInputs.filter(x=>x.checked).map(x=>x.value);
      session.answers[q.id]=vals;
      persistSession();
    });
    const sub=$('[data-action="submitAnswer"]'); if(sub) sub.onclick=submitCurrent;
    const next=$('[data-action="nextQuestion"]'); if(next) next.onclick=nextQuestion;
    const nexte=$('[data-action="nextExam"]'); if(nexte) nexte.onclick=()=>{session.idx++;persistSession();render();};
    const se=$('[data-action="submitExam"]'); if(se) se.onclick=submitExam;
    const exit=$('[data-action="exitQuiz"]'); if(exit) exit.onclick=()=>{
      if(session.mode==="exam"){
        confirmModal("退出模拟考试？","当前未交卷，本次模拟答题不会计入正式统计。",()=>{session=null;sessionStorage.removeItem(SESSION_KEY);setView("practice");});
      }else{session=null;sessionStorage.removeItem(SESSION_KEY);setView("home");}
    };
    const fav=$('[data-action="favorite"]'); if(fav) fav.onclick=()=>{const r=getRecord(q.id);r.favorite=!r.favorite;saveState();render();};
    const flag=$('[data-action="flagUnmastered"]'); if(flag) flag.onclick=()=>{const r=getRecord(q.id);r.manual=r.manual==="unmastered"?"":"unmastered";saveState();render();};
    $$("[data-wrong-reason]").forEach(b=>b.onclick=()=>{const r=getRecord(q.id);r.wrongReasons[b.dataset.wrongReason]=(r.wrongReasons[b.dataset.wrongReason]||0)+1;saveState();b.classList.add("chosen");});
    const reveal=$('[data-action="reveal"]'); if(reveal) reveal.onclick=()=>{session.reveal=true;render();};
    $$("[data-recite]").forEach(b=>b.onclick=()=>{
      const r=getRecord(q.id);
      const kind=b.dataset.recite;
      if(kind==="again"){r.manual="unmastered";r.streak=0;r.due=todayKey();}
      else if(kind==="familiar"){r.manual="";r.due=addDays(todayKey(),1);}
      else {r.manual="mastered";r.streak=Math.max(r.streak,3);r.due=addDays(todayKey(),14);}
      r.attempts++;r.lastAt=Date.now();
      state.daily[todayKey()]=state.daily[todayKey()]||{attempts:0,correct:0};
      state.daily[todayKey()].attempts++;
      saveState();nextQuestion();
    });
    if(session.mode==="exam") startExamClock();
  }

  function startExamClock(){
    const update=()=>{
      const el=$("#examClock"); if(!el) return;
      const total=(session.timeLimitMin||60)*60, used=Math.floor((Date.now()-session.startedAt)/1000), left=Math.max(0,total-used);
      el.textContent=`剩余 ${String(Math.floor(left/60)).padStart(2,"0")}:${String(left%60).padStart(2,"0")}`;
      if(left<=0){clearInterval(examTimer);toast("考试时间到，已自动交卷");submitExam();}
    }; update(); examTimer=setInterval(update,1000);
  }

  function bindSettings(){
    $('[data-action="saveSettings"]').onclick=()=>{
      state.profile.dailyGoal=clamp(+$("#dailyGoal").value||30,1,500);
      state.settings.shuffleQuestions=$("#shuffleQuestions").checked;
      state.settings.shuffleOptions=$("#shuffleOptions").checked;
      state.settings.theme=$("#themeSelect").value;
      saveState();render();toast("设置已保存");
    };
    $('[data-action="exportData"]').onclick=()=>downloadBlob(JSON.stringify(state,null,2),`岗前培训学习进度_${todayKey()}.json`,"application/json");
    $("#importData").onchange=async e=>{
      const f=e.target.files[0]; if(!f)return;
      try{const obj=JSON.parse(await f.text());state=mergeDefaults(obj,DEFAULT_STATE);saveState();render();toast("学习进度已导入");}catch(err){toast("导入失败：文件格式不正确");}
    };
    $('[data-action="resetData"]').onclick=()=>confirmModal("清空学习记录？","题库不会删除，但所有答题、错题、收藏、统计和云登录状态都会清空。",()=>{state=deepClone(DEFAULT_STATE);saveState();render();toast("已清空");});
    $('[data-action="installHelp"]').onclick=()=>modal(`<h2>iPhone / iPad 安装</h2><ol class="help-list"><li>先把本项目部署到 HTTPS 网站（推荐 GitHub Pages）。</li><li>在 iPhone/iPad 的 Safari 打开网址。</li><li>点击底部/顶部“分享”按钮。</li><li>选择“添加到主屏幕”。</li><li>从桌面图标打开，即以独立 App 全屏运行。</li></ol><p class="note">PWA 的离线缓存需要 HTTPS 或 localhost；直接从“文件”App 打开 HTML 不具备完整 PWA 能力。</p><button class="big-btn" data-modal-close>知道了</button>`);

    ["cloudRegister","cloudLogin","cloudPush","cloudPull"].forEach(a=>{const b=$(`[data-action="${a}"]`);if(b)b.onclick=()=>cloudAction(a);});
  }

  async function cloudAction(action){
    const projectUrl=$("#cloudUrl").value.trim().replace(/\/$/,""), anonKey=$("#cloudKey").value.trim(), email=$("#cloudEmail").value.trim(), password=$("#cloudPassword").value;
    if(!projectUrl||!anonKey){toast("请先填写 Supabase Project URL 和 anon key");return;}
    state.cloud.projectUrl=projectUrl;state.cloud.anonKey=anonKey;state.cloud.email=email;saveState();
    try{
      if(action==="cloudRegister"){
        if(!email||!password) throw new Error("请填写邮箱和密码");
        const r=await supaFetch("/auth/v1/signup",{method:"POST",body:{email,password}},false);
        if(r.access_token){applyAuth(r);toast("注册并登录成功");} else toast("注册请求已提交；如项目开启邮箱确认，请先查收邮件");
      }else if(action==="cloudLogin"){
        if(!email||!password) throw new Error("请填写邮箱和密码");
        const r=await supaFetch("/auth/v1/token?grant_type=password",{method:"POST",body:{email,password}},false);
        applyAuth(r);toast("登录成功");render();
      }else if(action==="cloudPush"){
        await ensureToken();
        const payload={user_id:state.cloud.userId, state_json:stripCloudSecrets(state), updated_at:new Date().toISOString()};
        await supaFetch("/rest/v1/study_progress?on_conflict=user_id",{method:"POST",body:payload,headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}},true);
        toast("学习进度已上传");
      }else if(action==="cloudPull"){
        await ensureToken();
        const rows=await supaFetch(`/rest/v1/study_progress?user_id=eq.${encodeURIComponent(state.cloud.userId)}&select=state_json,updated_at`,{method:"GET"},true);
        if(!rows?.length){toast("云端暂无学习进度");return;}
        const cloudCfg={...state.cloud};
        state=mergeDefaults(rows[0].state_json,DEFAULT_STATE);
        state.cloud=cloudCfg;saveState();render();toast("已从云端下载并合并为当前进度");
      }
    }catch(e){toast("云同步失败："+(e.message||e));}
  }
  function stripCloudSecrets(s){const x=deepClone(s);x.cloud={projectUrl:s.cloud.projectUrl,email:s.cloud.email,userId:s.cloud.userId};return x;}
  function applyAuth(r){
    if(!r?.access_token||!r?.user?.id) throw new Error(r?.msg||r?.error_description||"登录失败");
    state.cloud.accessToken=r.access_token;state.cloud.refreshToken=r.refresh_token||"";state.cloud.userId=r.user.id;saveState();
  }
  async function ensureToken(){if(!state.cloud.accessToken||!state.cloud.userId) throw new Error("请先登录云同步账户");}
  async function supaFetch(path,opt={},auth=true){
    const h={"apikey":state.cloud.anonKey,"Content-Type":"application/json",...(opt.headers||{})};
    h["Authorization"]="Bearer "+(auth?state.cloud.accessToken:state.cloud.anonKey);
    const res=await fetch(state.cloud.projectUrl+path,{method:opt.method||"GET",headers:h,body:opt.body?JSON.stringify(opt.body):undefined});
    const txt=await res.text(); let obj=null;try{obj=txt?JSON.parse(txt):{};}catch{obj=txt;}
    if(!res.ok) throw new Error(obj?.message||obj?.msg||obj?.error_description||`${res.status} ${res.statusText}`);
    return obj;
  }

  function exportText(list,title){
    if(!list.length){toast("当前没有可导出的题目");return;}
    const lines=[title,`导出日期：${todayKey()}`,`共 ${list.length} 题`,""];
    list.forEach((q,i)=>{lines.push(`${i+1}. [${q.subject} / ${TYPE_LABEL[q.type]}] ${q.original}`);lines.push(`标准答案：${q.answerText}`);lines.push("");});
    downloadBlob(lines.join("\n"),`${title}_${todayKey()}.txt`,"text/plain;charset=utf-8");
  }
  function downloadBlob(content,name,type){
    const blob=new Blob([content],{type}), url=URL.createObjectURL(blob), a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function modal(html,onOpen){
    const wrap=document.createElement("div");wrap.id="modal";wrap.className="modal-backdrop";wrap.innerHTML=`<div class="modal-card">${html}</div>`;document.body.appendChild(wrap);
    wrap.onclick=e=>{if(e.target===wrap||e.target.hasAttribute("data-modal-close"))closeModal();};
    if(onOpen) onOpen();
  }
  function closeModal(){document.getElementById("modal")?.remove();}
  window.closeModal=closeModal;
  function confirmModal(title,text,ok){
    modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="modal-actions"><button class="minor-btn" data-modal-close>取消</button><button class="danger-btn" id="confirmOk">确认</button></div>`,()=>{$("#confirmOk").onclick=()=>{closeModal();ok();};});
  }
  function toast(msg){
    let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t);}
    t.textContent=msg;t.classList.add("show");clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove("show"),2200);
  }

  document.addEventListener("keydown",e=>{
    if(view!=="quiz"||!session||session.recite) return;
    const q=BY_ID.get(session.ids[session.idx]);
    const opts=$$('input[name="answer"]');
    if(/^[1-7]$/.test(e.key)){const i=+e.key-1;if(opts[i]){if(q.type==="multi")opts[i].checked=!opts[i].checked;else opts[i].checked=true;opts[i].dispatchEvent(new Event("change"));}}
    if(e.key==="Enter"){const b=$('[data-action="submitAnswer"],[data-action="nextQuestion"],[data-action="nextExam"],[data-action="submitExam"]');if(b)b.click();}
    if(e.key.toLowerCase()==="f") $('[data-action="favorite"]')?.click();
  });

  // Restore unfinished non-exam session after accidental refresh.
  try{
    const raw=sessionStorage.getItem(SESSION_KEY);
    if(raw){const s=JSON.parse(raw); if(s?.ids?.length){session=s;view="quiz";}}
  }catch(e){}

  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }

  render();
})();
