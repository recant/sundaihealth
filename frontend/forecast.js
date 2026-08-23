const $=id=>document.getElementById(id);
let lastSignature='';

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
  const target=$('testingContent');
  if(!target||$('forecastCard'))return;
  const card=document.createElement('section');card.id='forecastCard';card.className='card forecast-card';
  card.innerHTML=`
    <div class="forecast-top"><div><div class="eyebrow">Longitudinal plan</div><h2>When should you test again?</h2></div><span class="forecast-badge">LIVE MODEL + HISTORY</span></div>
    <div class="next-test"><div class="next-test-label">Next test to consider</div><div class="next-test-row"><h3 id="nextTestName">Waiting for model state</h3><div id="nextTestWindow" class="next-test-window">—</div></div><p id="nextTestReason">PulseLab combines current physiology, persistence, prior testing, and panel ranking.</p></div>
    <div class="testing-section"><div class="eyebrow">If today's pattern persists</div><div id="projection" class="projection"></div></div>
    <div class="testing-section"><div class="calendar-head"><div><div class="eyebrow">Calendar</div><h3>Past draws + suggested window</h3></div><span id="calendarLabel">Demo history is labeled.</span></div><div id="calendarGrid" class="calendar-grid"></div><div id="calendarEvents" class="calendar-events"></div></div>
    <div class="forecast-note">Research testing-yield forecast, not a diagnosis or a validated prediction that disease will occur.</div>`;
  target.appendChild(card);
}

function parsePanels(){
  return [...document.querySelectorAll('#panelBars .bar-row')].map(row=>({
    label:row.querySelector('span')?.textContent?.trim()||'',
    p:Number((row.querySelector('b')?.textContent||'').replace('%',''))||0
  })).filter(x=>x.label).sort((a,b)=>b.p-a.p);
}

function recommendation(){
  const score=Number(($('score')?.textContent||'').trim());
  const safe=Number.isFinite(score)?score:0;
  const top=parsePanels()[0]||{label:'focused blood panel',p:0};
  let days=30,window='reassess in ~30 days';
  if(safe>=75){days=3;window='within 72 hours';}
  else if(safe>=62){days=7;window='within 7 days';}
  else if(safe>=45){days=14;window='within 2 weeks';}
  const persistence=Number(num('persistence')||1);
  const reason=safe>=45
    ? `${top.label} is the highest-ranked panel (${Math.round(top.p)}%). Testing priority is ${Math.round(safe)}/100 and this pattern has persisted for ${persistence} day${persistence===1?'':'s'}.`
    : `No strong event-triggered draw right now. If the signal strengthens, ${top.label} is currently the highest-ranked panel (${Math.round(top.p)}%).`;
  return {score:safe,top,days,window,reason,date:addDays(new Date(),days)};
}

function persistenceBoost(days){return clamp((Math.max(1,Math.min(7,days))-1)/6,0,1)*8;}
function renderProjection(rec){
  const p=Number(num('persistence')||1),base=rec.score-persistenceBoost(p);
  const scenarios=[['Now',p],['+3 days',Math.min(7,p+3)],['+7 days',7]];
  $('projection').innerHTML=scenarios.map(([label,days])=>`<div class="projection-item"><span>${label}</span><strong>${Math.round(clamp(base+persistenceBoost(days)))}/100</strong><small>if the same pattern persists</small></div>`).join('');
}

function readLabHistory(){
  try{
    const profile=JSON.parse(localStorage.getItem('pulselab-personal-profile-v1')||'null');
    const real=(profile?.lab_feedback||[]).map(x=>({date:new Date(x.at),name:(x.panel||'panel').replaceAll('_',' '),result:x.outcome?'abnormal':'normal',synthetic:false})).filter(x=>Number.isFinite(x.date.getTime()));
    if(real.length)return real.slice(-6);
  }catch(_){ }
  const now=new Date();
  return [
    {date:addDays(now,-94),name:'CBC',result:'normal',synthetic:true},
    {date:addDays(now,-63),name:'CMP',result:'normal',synthetic:true},
    {date:addDays(now,-31),name:'Hemoglobin A1c',result:'normal',synthetic:true},
  ];
}

function renderMonth(monthDate,events,recommendedDate){
  const y=monthDate.getFullYear(),m=monthDate.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0);
  const days=[];for(let i=0;i<first.getDay();i++)days.push('<span class="day blank">0</span>');
  const today=dateKey(new Date()),rec=dateKey(recommendedDate),eventKeys=new Set(events.map(e=>dateKey(e.date)));
  for(let d=1;d<=last.getDate();d++){
    const key=dateKey(new Date(y,m,d)),classes=['day'];if(key===today)classes.push('today');if(eventKeys.has(key))classes.push('tested');if(key===rec)classes.push('recommended');
    days.push(`<span class="${classes.join(' ')}">${d}</span>`);
  }
  return `<div class="month"><div class="month-title">${monthName(monthDate)}</div><div class="weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="days">${days.join('')}</div></div>`;
}

function renderCalendar(rec){
  const events=readLabHistory(),now=new Date();
  const months=[-2,-1,0,1].map(o=>new Date(now.getFullYear(),now.getMonth()+o,1));
  $('calendarGrid').innerHTML=months.map(m=>renderMonth(m,events,rec.date)).join('');
  const rows=[...events.sort((a,b)=>a.date-b.date),{date:rec.date,name:rec.top.label,result:rec.score>=45?'suggested':'recheck',recommended:true}];
  $('calendarEvents').innerHTML=rows.map(e=>`<div class="calendar-event ${e.synthetic?'synthetic':''}"><span class="date">${fmtDate(e.date)}</span><b>${e.name}${e.synthetic?' · DEMO':''}</b><span class="result">${e.result}</span></div>`).join('');
}

function renderForecast(){
  if(!$('forecastCard'))return;
  const rec=recommendation(),sig=[rec.score,rec.top.label,rec.top.p,num('persistence'),$('profileLabs')?.textContent].join('|');
  if(sig===lastSignature)return;lastSignature=sig;
  $('nextTestName').textContent=rec.score>=45?rec.top.label:`No test yet · ${rec.top.label} ranks highest`;
  $('nextTestWindow').textContent=`${rec.window} · ${fmtDate(rec.date)}`;
  $('nextTestReason').textContent=rec.reason;
  renderProjection(rec);renderCalendar(rec);
}

function boot(){ensureStyles();buildCard();renderForecast();document.addEventListener('input',()=>setTimeout(renderForecast,180));document.addEventListener('change',()=>setTimeout(renderForecast,180));setInterval(renderForecast,1400);}
boot();
