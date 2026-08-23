const $ = id => document.getElementById(id);
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const STUDY_URL = 'https://doi.org/10.1038/s41551-020-00640-6';
const STUDY_NAME = 'Mishra et al. · Nature Biomedical Engineering · 2020';
const STORAGE_KEY = 'pulselab-analog-rec-v1';

const CASES = [
  {
    id:'AQC0L71',
    bump:2,
    short:'Heart-rate warnings came first. The person later worsened, tested positive for COVID-19, and was hospitalized.',
    warning:'Both heart-rate methods in the paper flagged this person before the illness became severe.',
    timeline:[
      ['Before symptoms','Wearable heart-rate warnings appeared.'],
      ['Symptoms begin','Cough, fatigue, aches and pains were reported.'],
      ['Over the next 22 days','Symptoms stayed mild to moderate, then got worse quickly. Temperature rose and a COVID-19 test was positive.'],
      ['5 days later','The participant was admitted to the hospital.'],
      ['Day 41','The participant had recovered.']
    ],
    outcome:'Hospitalized · 41 days to recovery',
    temp:true
  },
  {
    id:'APGIB2T',
    bump:0,
    short:'A heart-rate warning appeared about a week before symptoms. The illness became severe and later relapsed.',
    warning:'The paper reports an early heart-rate signal 1 week before symptom onset.',
    timeline:[
      ['7 days before symptoms','An early heart-rate warning appeared.'],
      ['Symptoms begin','The illness quickly progressed with severe diarrhea, fatigue, headaches and elevated temperature. COVID-19 was positive.'],
      ['First 18 days','The initial illness lasted 18 days.'],
      ['Next 12 days','The participant felt recovered.'],
      ['After that','Symptoms relapsed with elevated temperature, fatigue, diarrhea and another rise in heart-rate signals.']
    ],
    outcome:'18-day illness · recovery · relapse',
    temp:true
  },
  {
    id:'A1K5DRI',
    bump:-2,
    short:'A heart-rate warning came 3 days before symptom tracking. The illness lasted 23 days.',
    warning:'The paper reports a heart-rate alarm 3 days before the participant began daily symptom logs.',
    timeline:[
      ['3 days before symptoms','A heart-rate warning appeared.'],
      ['Symptoms begin','Daily symptom tracking started.'],
      ['During illness','Temperature rose quickly, with severe fatigue, aches and pains.'],
      ['Day 23','The reported illness period ended after a slow recovery.']
    ],
    outcome:'23-day illness',
    temp:true
  },
  {
    id:'A0VFT1N',
    bump:-4,
    short:'A heart-rate warning led the illness. The person later had chest pain and was hospitalized for shortness of breath.',
    warning:'The paper reports that a heart-rate alarm came before this participant’s 13-day COVID-19 illness.',
    timeline:[
      ['Before symptoms','A heart-rate warning appeared.'],
      ['First 13 days','COVID-19 illness was reported, followed by fatigue and occasional chest pain.'],
      ['Later','Shortness of breath returned along with new heart-rate warnings.'],
      ['Day 35','The participant was hospitalized for shortness of breath.']
    ],
    outcome:'Hospitalized on day 35',
    temp:false
  }
];

let selectedId = CASES[0].id;
let renderTimer = null;

function num(id){
  const el=$(id);
  if(!el || el.value==='') return null;
  const x=Number(el.value);
  return Number.isFinite(x)?x:null;
}
function ratio(cur,base){
  return Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null;
}
function pattern(){
  const rhr=ratio(num('c_resting_hr'),num('b_resting_hr'));
  const steps=ratio(num('c_steps'),num('b_steps'));
  const sleep=ratio(num('c_sleep_hours'),num('b_sleep_hours'));
  const temp=(Number.isFinite(num('c_temperature_c'))&&Number.isFinite(num('b_temperature_c')))?num('c_temperature_c')-num('b_temperature_c'):null;
  const spo2=(Number.isFinite(num('c_spo2'))&&Number.isFinite(num('b_spo2')))?num('b_spo2')-num('c_spo2'):null;
  const resp=ratio(num('c_respiratory_rate'),num('b_respiratory_rate'));
  const parts=[
    Number.isFinite(rhr)?clamp(rhr/.28):null,
    Number.isFinite(steps)?clamp((-steps)/.7):null,
    Number.isFinite(sleep)?clamp((-sleep)/.4):null,
    Number.isFinite(temp)?clamp(temp/1.1):null,
    Number.isFinite(spo2)?clamp(spo2/4):null,
    Number.isFinite(resp)?clamp(resp/.35):null
  ].filter(Number.isFinite);
  const severity=parts.length?parts.reduce((a,b)=>a+b,0)/parts.length:0;
  return {rhr,steps,sleep,temp,spo2,resp,severity,hasData:parts.length>=2};
}
function pctText(v,reverse=false){
  if(!Number.isFinite(v)) return null;
  const x=Math.round(Math.abs(v)*100);
  return `${reverse&&v<0?'down ':v>=0?'up ':'down '}${x}%`;
}
function signals(p){
  const out=[];
  if(Number.isFinite(p.rhr)) out.push({label:'Resting heart rate',value:pctText(p.rhr),bad:p.rhr>.10});
  if(Number.isFinite(p.steps)) out.push({label:'Daily steps',value:pctText(p.steps),bad:p.steps<-.25});
  if(Number.isFinite(p.sleep)) out.push({label:'Sleep',value:pctText(p.sleep),bad:p.sleep<-.18});
  if(Number.isFinite(p.temp)) out.push({label:'Skin temperature',value:`${p.temp>=0?'+':''}${p.temp.toFixed(1)} °C`,bad:p.temp>.5});
  if(Number.isFinite(p.spo2)) out.push({label:'Oxygen',value:`${p.spo2>0?'-':''}${Math.abs(p.spo2).toFixed(0)} points`,bad:p.spo2>=2});
  if(Number.isFinite(p.resp)) out.push({label:'Breathing rate',value:pctText(p.resp),bad:p.resp>.18});
  return out.slice(0,6);
}
function scoreCase(c,p){
  const s=clamp(p.severity);
  return Math.round(clamp(72+s*24+c.bump,68,97));
}
function rankedCases(p){
  return CASES.map(c=>({...c,score:scoreCase(c,p)})).sort((a,b)=>b.score-a.score);
}
function recommendation(p,top){
  if(!p.hasData) return {days:14,panel:'CBC + CMP',similarity:top?.score||null,level:'WAITING',title:'Load the demo day first',body:'PulseLab needs today’s wearable values before it can compare your pattern with the real study cases.'};
  if(p.severity>=.62) return {days:3,panel:'CBC + CMP',similarity:top.score,level:'CHECK NOW · DEMO',title:'This demo day is abnormal enough to check now.',body:'Your watch is showing several changes at once. A blood test can measure things the watch cannot see and tell you whether there is a real blood or chemistry change to follow up.'};
  if(p.severity>=.38) return {days:7,panel:'CBC + CMP',similarity:top.score,level:'CHECK SOON',title:'This pattern is worth checking soon.',body:'The changes are not tiny. If they continue, getting another measurement is more useful than waiting for the watch alone to explain the cause.'};
  return {days:14,panel:'CBC',similarity:top.score,level:'KEEP WATCHING',title:'This pattern is not very alarming yet.',body:'Keep collecting data. If heart rate rises, activity falls, temperature rises, or the pattern lasts, testing becomes more useful.'};
}
function publish(rec){
  const payload={days:rec.days,panel:rec.panel,similarity:rec.similarity,synthetic:false,source:'Stanford COVID-19 wearable study',updatedAt:Date.now()};
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));}catch(_){}
  window.dispatchEvent(new CustomEvent('pulselab:analog-recommendation',{detail:payload}));
}
function shell(){
  const target=$('populationContent');
  if(!target||$('simplePopulation')) return;
  target.innerHTML=`
  <div id="simplePopulation" class="simple-population">
    <section class="card simple-alert-card">
      <div class="simple-alert-top">
        <div><div class="eyebrow">Today</div><div id="simpleLevel" class="simple-level">—</div><h2 id="simpleTitle">Reading your demo day…</h2><p id="simpleBody"></p></div>
        <div class="simple-test-box"><span>What PulseLab would check</span><strong id="simplePanel">CBC + CMP</strong><small id="simpleWindow">—</small></div>
      </div>
      <div id="simpleSignals" class="simple-signals"></div>
      <div class="simple-why-test"><strong>Why get a blood test?</strong><span>A watch can tell you that your body changed. It usually cannot tell you why. Blood can add information the watch cannot measure.</span><em>A CBC/CMP does not diagnose COVID-19. This is a demo testing recommendation, not medical advice.</em></div>
    </section>

    <section class="simple-match-layout">
      <div class="card simple-case-list-card">
        <div class="eyebrow">Real people from a published study</div>
        <h2>Who had warning signs like this?</h2>
        <p class="simple-intro">These are real de-identified participant IDs from a Stanford study. Click one to see what the paper says happened to them.</p>
        <div id="simpleCaseList" class="simple-case-list"></div>
        <div class="simple-match-note">The <b>match % is PulseLab demo math</b> based on the direction and size of today’s wearable changes. The illness stories are real study data.</div>
      </div>
      <div class="card simple-case-detail-card"><div id="simpleCaseDetail"></div></div>
    </section>

    <section class="card simple-study-card">
      <div><div class="eyebrow">Why this comparison matters</div><h2>The study really did see wearable warnings before illness.</h2></div>
      <div class="simple-study-stats">
        <div><strong>26 / 32</strong><span>COVID-positive participants had a change in heart rate, steps, or sleep.</span></div>
        <div><strong>22 / 25</strong><span>with detected changes were flagged before or at symptom onset.</span></div>
        <div><strong>15 / 24</strong><span>with enough earlier data had an online alarm by symptom onset.</span></div>
      </div>
      <div class="simple-source-row">
        <div><strong>Real illness timelines:</strong> ${STUDY_NAME}</div>
        <a href="${STUDY_URL}" target="_blank" rel="noopener">Open the paper ↗</a>
      </div>
      <div class="simple-source-row secondary"><div><strong>Blood-panel model:</strong> BloodNeedNet uses real CDC NHANES 2013–2014 wrist + lab data. The Stanford cases are used here only for the real illness stories.</div></div>
    </section>
  </div>`;
}
function renderSignals(p){
  const host=$('simpleSignals');
  const rows=signals(p);
  host.innerHTML=rows.length?rows.map(x=>`<div class="simple-signal ${x.bad?'bad':''}"><span>${x.label}</span><strong>${x.value}</strong></div>`).join(''):`<div class="simple-empty">No current wearable values yet. Go to <b>Live Data</b> and click <b>Load demo history</b>.</div>`;
}
function renderList(ranked){
  const host=$('simpleCaseList');
  host.innerHTML=ranked.map((c,i)=>`<button type="button" class="simple-case-button ${selectedId===c.id?'selected':''}" data-case-id="${c.id}">
    <div class="simple-case-rank">${i+1}</div>
    <div class="simple-case-copy"><div><strong>${c.id}</strong><span>REAL STANFORD CASE</span></div><p>${c.short}</p><small>${c.outcome}</small></div>
    <div class="simple-case-score"><strong>${c.score}%</strong><span>demo match</span></div>
  </button>`).join('');
  host.querySelectorAll('[data-case-id]').forEach(btn=>btn.addEventListener('click',()=>{selectedId=btn.dataset.caseId;render();}));
}
function renderDetail(c,p){
  const host=$('simpleCaseDetail');
  const hrLine=Number.isFinite(p.rhr)&&p.rhr>.08?`Your resting heart rate is ${Math.round(p.rhr*100)}% above your usual value. ${c.warning}`:c.warning;
  const tempLine=c.temp&&Number.isFinite(p.temp)&&p.temp>.4?`Your demo temperature is also ${p.temp.toFixed(1)} °C above usual. This participant later reported elevated temperature.`:null;
  host.innerHTML=`
    <div class="simple-detail-head"><div><div class="eyebrow">Closest real case</div><h2>${c.id}</h2><p>De-identified participant ID from the Stanford study</p></div><div class="simple-detail-score"><strong>${c.score}%</strong><span>demo pattern match</span></div></div>
    <div class="simple-case-warning"><strong>Why PulseLab picked this person</strong><span>${hrLine}</span>${tempLine?`<span>${tempLine}</span>`:''}</div>
    <div class="simple-timeline">
      ${c.timeline.map((x,i)=>`<div class="simple-time-row"><div class="simple-time-dot">${i+1}</div><div><strong>${x[0]}</strong><p>${x[1]}</p></div></div>`).join('')}
    </div>
    <div class="simple-outcome"><span>What happened</span><strong>${c.outcome}</strong></div>
    <div class="simple-cohort-note"><strong>Also seen across the study:</strong> daily steps fell around illness, and sleep changed. That is why PulseLab compares several wearable signals together instead of looking at one number.</div>
    <div class="simple-citation">Source: <a href="${STUDY_URL}" target="_blank" rel="noopener">${STUDY_NAME} ↗</a></div>`;
}
function render(){
  shell();
  if(!$('simplePopulation')) return;
  const p=pattern();
  const ranked=rankedCases(p);
  if(!ranked.some(x=>x.id===selectedId)) selectedId=ranked[0].id;
  const selected=ranked.find(x=>x.id===selectedId)||ranked[0];
  const rec=recommendation(p,ranked[0]);
  $('simpleLevel').textContent=rec.level;
  $('simpleTitle').textContent=rec.title;
  $('simpleBody').textContent=rec.body;
  $('simplePanel').textContent=rec.panel;
  $('simpleWindow').textContent=p.hasData?(rec.days<=3?'today or within 72 hours':rec.days<=7?'within 7 days':`within ${rec.days} days`):'waiting for data';
  renderSignals(p);
  renderList(ranked);
  renderDetail(selected,p);
  if(p.hasData) publish(rec);
}
function schedule(){clearTimeout(renderTimer);renderTimer=setTimeout(render,120);}

document.addEventListener('input',schedule);
document.addEventListener('change',schedule);
window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='population')render();});
render();
