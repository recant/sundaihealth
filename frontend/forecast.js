const $ = id => document.getElementById(id);
let MODEL_CACHE = null;
let lastSignature = '';

function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x));}
function num(id){const el=$(id);if(!el||el.value==='')return null;const n=Number(el.value);return Number.isFinite(n)?n:null;}
function addDays(date,days){const d=new Date(date);d.setDate(d.getDate()+days);return d;}
function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function fmtDate(d){return d.toLocaleDateString([], {month:'short',day:'numeric'});}
function monthName(d){return d.toLocaleDateString([], {month:'long',year:'numeric'});}

function ensureStyles(){
  if(document.querySelector('link[data-pulselab-forecast]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./forecast.css';link.dataset.pulselabForecast='1';document.head.appendChild(link);
}

function buildCard(){
  const results=document.querySelector('.results');
  if(!results||$('forecastCard'))return;
  const card=document.createElement('section');
  card.id='forecastCard';card.className='card forecast-card';
  card.innerHTML=`
    <div class="forecast-top"><div><div class="eyebrow">Longitudinal testing plan</div><h2>What should be tested next—and when?</h2></div><span id="forecastMode" class="forecast-badge">LIVE MODEL + DEMO HISTORY</span></div>
    <div class="next-test"><div class="next-test-label">Next test to consider</div><div class="next-test-row"><h3 id="nextTestName">Waiting for model state</h3><div id="nextTestWindow" class="next-test-window">—</div></div><p id="nextTestReason">PulseLab will combine the current wearable pattern, persistence, prior testing, and panel ranking.</p></div>
    <div><div class="eyebrow">If today's pattern persists</div><div id="projection" class="projection"></div></div>
    <div><div class="calendar-head"><div><div class="eyebrow">Testing calendar</div><h3>Past draws + suggested window</h3></div><span id="calendarLabel">Synthetic prior tests are clearly labeled.</span></div><div id="calendarGrid" class="calendar-grid"></div><div id="calendarEvents" class="calendar-events"></div></div>
    <div class="analog-box"><div class="eyebrow">Closest training-cohort analogs</div><h3 id="analogTitle">Waiting for BloodNeedNet v0.2 analog bank</h3><p id="analogSummary">The current v0.1 artifact predicts lab-panel abnormality but does not contain anonymized row-level analogs. Retraining v0.2 enables real nearest-neighbor comparison.</p><div id="analogStats" class="analog-grid"></div></div>
    <div class="forecast-note">This is a research testing-yield forecast, not a diagnosis or a validated prediction that a disease will occur. The current NHANES model can support statements about similar wearable patterns and same-participant blood-panel abnormalities; it cannot truthfully say that a similar person later developed heart disease.</div>`;
  const chat=$('pulseChat');
  if(chat)results.insertBefore(card,chat);else results.appendChild(card);
}

function parsePanels(){
  return [...document.querySelectorAll('#panelBars .bar-row')].map(row=>{
    const label=row.querySelector('span')?.textContent?.trim()||'';
    const p=Number((row.querySelector('b')?.textContent||'').replace('%',''));
    return {label,p:Number.isFinite(p)?p:0};
  }).filter(x=>x.label);
}

function recommendation(){
  const score=Number(($('score')?.textContent||'').trim());
  const safeScore=Number.isFinite(score)?score:0;
  const panels=parsePanels().sort((a,b)=>b.p-a.p);
  const top=panels[0]||{label:'focused blood panel',p:0};
  let days=30,window='reassess in ~30 days',verb='No event-triggered draw yet';
  if(safeScore>=75){days=3;window='within 72 hours';verb='High-priority testing window';}
  else if(safeScore>=62){days=7;window='within 7 days';verb='Testing window surfaced';}
  else if(safeScore>=45){days=14;window='within 2 weeks';verb='Watch closely / consider testing';}
  const persistence=Number(num('persistence')||1);
  const reason=safeScore>=45
    ? `${verb}. ${top.label} is currently the highest-ranked panel at ${Math.round(top.p)}%. The wearable-driven priority is ${Math.round(safeScore)}/100 and the change has persisted for ${persistence} day${persistence===1?'':'s'}.`
    : `PulseLab does not currently see a strong event-triggered reason for a new draw. If testing becomes warranted, ${top.label} is currently the highest-ranked panel (${Math.round(top.p)}%).`;
  return {score:safeScore,top,days,window,reason,date:addDays(new Date(),days)};
}

function persistenceBoost(days){return clamp((Math.max(1,Math.min(7,days))-1)/6,0,1)*8;}
function renderProjection(rec){
  const currentPersistence=Number(num('persistence')||1);
  const currentBoost=persistenceBoost(currentPersistence);
  const base=rec.score-currentBoost;
  const scenarios=[['Now',currentPersistence],['+3 days',Math.min(7,currentPersistence+3)],['+7 days',7]];
  $('projection').innerHTML=scenarios.map(([label,p])=>{
    const projected=Math.round(clamp(base+persistenceBoost(p)));
    return `<div class="projection-item"><span>${label}</span><strong>${projected}/100</strong><small>testing priority if the same physiology persists</small></div>`;
  }).join('');
}

function readLabHistory(){
  try{
    const profile=JSON.parse(localStorage.getItem('pulselab-personal-profile-v1')||'null');
    const real=(profile?.lab_feedback||[]).map(x=>({date:new Date(x.at),name:(x.panel||'panel').replaceAll('_',' '),result:x.outcome?'abnormal':'normal',synthetic:false})).filter(x=>Number.isFinite(x.date.getTime()));
    if(real.length)return real.slice(-6);
  }catch(_){ }
  const now=new Date();
  return [
    {date:addDays(now,-94),name:'Complete blood count (CBC)',result:'normal',synthetic:true},
    {date:addDays(now,-63),name:'Comprehensive metabolic panel (CMP)',result:'normal',synthetic:true},
    {date:addDays(now,-31),name:'Hemoglobin A1c',result:'normal',synthetic:true},
  ];
}

function renderMonth(monthDate,events,recommendedDate){
  const y=monthDate.getFullYear(),m=monthDate.getMonth();
  const first=new Date(y,m,1),last=new Date(y,m+1,0);
  const days=[];
  for(let i=0;i<first.getDay();i++)days.push('<span class="day blank">0</span>');
  const todayKey=dateKey(new Date()),recKey=dateKey(recommendedDate);
  const eventKeys=new Set(events.map(e=>dateKey(e.date)));
  for(let d=1;d<=last.getDate();d++){
    const date=new Date(y,m,d),key=dateKey(date);
    const classes=['day'];if(key===todayKey)classes.push('today');if(eventKeys.has(key))classes.push('tested');if(key===recKey)classes.push('recommended');
    days.push(`<span class="${classes.join(' ')}">${d}</span>`);
  }
  return `<div class="month"><div class="month-title">${monthName(monthDate)}</div><div class="weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="days">${days.join('')}</div></div>`;
}

function renderCalendar(rec){
  const events=readLabHistory();
  const now=new Date();
  const months=[-2,-1,0,1].map(offset=>new Date(now.getFullYear(),now.getMonth()+offset,1));
  $('calendarGrid').innerHTML=months.map(m=>renderMonth(m,events,rec.date)).join('');
  const rows=[...events.sort((a,b)=>a.date-b.date),{date:rec.date,name:rec.top.label,result:rec.score>=45?'suggested window':'recheck window',synthetic:false,recommended:true}];
  $('calendarEvents').innerHTML=rows.map(e=>`<div class="calendar-event ${e.synthetic?'synthetic':''}"><span class="date">${fmtDate(e.date)}</span><b>${e.name}${e.synthetic?' · DEMO':''}</b><span class="result">${e.result}</span></div>`).join('');
}

async function getModel(){
  if(MODEL_CACHE)return MODEL_CACHE;
  try{const r=await fetch('./model/bloodneed-model.json',{cache:'no-store'});if(r.ok)MODEL_CACHE=await r.json();}catch(_){ }
  return MODEL_CACHE;
}

function currentFeatureVector(model){
  const f=model?.panel_model?.feature_names||[];
  const baselineSleep=num('b_sleep_hours'),currentSleep=num('c_sleep_hours');
  const baselineSteps=num('b_steps'),currentSteps=num('c_steps');
  const pct=(cur,base)=>Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null;
  const sex=$('sex')?.value;
  const values={age:num('age'),sex_male:sex==='male'?1:sex==='female'?0:null,baseline_sleep_h:baselineSleep,current_sleep_h:currentSleep,sleep_delta_pct:pct(currentSleep,baselineSleep),activity_delta_pct:pct(currentSteps,baselineSteps),persistence_days:Number(num('persistence')||1)};
  const med=model.panel_model.imputer_median||[];
  const mean=model.panel_model.scaler_mean||[];
  const scale=model.panel_model.scaler_scale||[];
  return f.map((name,i)=>{
    const raw=Number.isFinite(values[name])?values[name]:med[i];
    return (raw-mean[i])/(scale[i]||1);
  });
}

async function renderAnalogs(rec){
  const model=await getModel();
  const records=model?.analog_bank?.records;
  if(!Array.isArray(records)||!records.length){
    $('analogTitle').textContent='Retrain BloodNeedNet v0.2 to enable real analogs';
    $('analogSummary').textContent='The deployed model artifact has no anonymized training analog bank yet. Run the updated trainer once; after that this section will compare the current feature vector with real NHANES training participants.';
    $('analogStats').innerHTML='';return;
  }
  const z=currentFeatureVector(model);
  const dist=r=>Math.sqrt((r.z||[]).reduce((s,v,i)=>s+(v-z[i])**2,0)/Math.max(1,z.length));
  const nearest=records.map(r=>({...r,d:dist(r)})).sort((a,b)=>a.d-b.d).slice(0,5);
  const closest=nearest[0];
  const keys=['glycemic','cbc','metabolic','lipid'];
  const labels={glycemic:'A1c / glycemic',cbc:'CBC',metabolic:'CMP / metabolic',lipid:'lipid'};
  const rates=keys.map(k=>({k,n:nearest.reduce((s,r)=>s+Number(r.outcomes?.[k]||0),0)})).sort((a,b)=>b.n-a.n);
  const strongest=rates[0];
  $('analogTitle').textContent=`Closest anonymized analog: ${closest.id} · ${closest.age_band||'adult'}`;
  const closestAbnormal=keys.filter(k=>closest.outcomes?.[k]).map(k=>labels[k]);
  $('analogSummary').textContent=`This is similarity in BloodNeedNet's standardized wearable-feature space, not identity or a disease prediction. The closest analog had ${closestAbnormal.length?closestAbnormal.join(', ')+' target abnormality':'none of the four target abnormalities'}. Among the 5 nearest analogs, ${strongest.n}/5 had an abnormal ${labels[strongest.k]} target.`;
  $('analogStats').innerHTML=rates.slice(0,2).map(r=>`<div class="analog-stat"><span>Nearest 5 analogs</span><strong>${r.n}/5 abnormal ${labels[r.k]}</strong></div>`).join('');
}

async function renderForecast(){
  if(!$('forecastCard'))return;
  const rec=recommendation();
  const signature=[rec.score,rec.top.label,rec.top.p,num('persistence'),$('profileLabs')?.textContent].join('|');
  if(signature===lastSignature)return;lastSignature=signature;
  $('nextTestName').textContent=rec.score>=45?rec.top.label:`No event-triggered test · ${rec.top.label} ranks highest`;
  $('nextTestWindow').textContent=`${rec.window} · ${fmtDate(rec.date)}`;
  $('nextTestReason').textContent=rec.reason;
  renderProjection(rec);renderCalendar(rec);await renderAnalogs(rec);
}

function boot(){
  ensureStyles();buildCard();renderForecast();
  document.addEventListener('input',()=>setTimeout(renderForecast,180));
  document.addEventListener('change',()=>setTimeout(renderForecast,180));
  setInterval(renderForecast,1400);
}

boot();
