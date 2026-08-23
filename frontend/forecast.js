const $=id=>document.getElementById(id);
const ANALOG_KEY='pulselab-analog-rec-v1';
let lastSignature='';

function num(id){const el=$(id);if(!el||el.value==='')return null;const x=Number(el.value);return Number.isFinite(x)?x:null;}
function ratio(cur,base){return Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null;}
function clamp(x,a=0,b=1){return Math.max(a,Math.min(b,x));}
function readNetwork(){try{return JSON.parse(localStorage.getItem(ANALOG_KEY)||'null');}catch(_){return null;}}
function fmtPct(v){return `${v>=0?'+':''}${Math.round(v*100)}%`;}

function state(){
  const hr=ratio(num('c_resting_hr'),num('b_resting_hr'));
  const hrv=ratio(num('c_hrv'),num('b_hrv'));
  const sleep=ratio(num('c_sleep_hours'),num('b_sleep_hours'));
  const activity=ratio(num('c_steps'),num('b_steps'));
  const temp=Number.isFinite(num('c_temperature_c'))&&Number.isFinite(num('b_temperature_c'))?num('c_temperature_c')-num('b_temperature_c'):null;
  const spo2=Number.isFinite(num('c_spo2'))&&Number.isFinite(num('b_spo2'))?num('c_spo2')-num('b_spo2'):null;
  const resp=ratio(num('c_respiratory_rate'),num('b_respiratory_rate'));
  const parts=[
    Number.isFinite(hr)?clamp(hr/.30):null,
    Number.isFinite(hrv)?clamp(-hrv/.60):null,
    Number.isFinite(sleep)?clamp(-sleep/.45):null,
    Number.isFinite(activity)?clamp(-activity/.75):null,
    Number.isFinite(temp)?clamp(temp/1.2):null,
    Number.isFinite(spo2)?clamp(-spo2/5):null,
    Number.isFinite(resp)?clamp(resp/.45):null
  ].filter(Number.isFinite);
  return {hr,hrv,sleep,activity,temp,spo2,resp,severity:parts.length?parts.reduce((a,b)=>a+b,0)/parts.length:0,hasData:parts.length>=2};
}

function changes(s){
  const out=[];
  if(Number.isFinite(s.hr)&&Math.abs(s.hr)>.05)out.push({name:'Resting heart rate',value:fmtPct(s.hr),bad:s.hr>.10});
  if(Number.isFinite(s.hrv)&&Math.abs(s.hrv)>.08)out.push({name:'HRV',value:fmtPct(s.hrv),bad:s.hrv<-.15});
  if(Number.isFinite(s.sleep)&&Math.abs(s.sleep)>.08)out.push({name:'Sleep',value:fmtPct(s.sleep),bad:s.sleep<-.15});
  if(Number.isFinite(s.activity)&&Math.abs(s.activity)>.10)out.push({name:'Daily steps',value:fmtPct(s.activity),bad:s.activity<-.20});
  if(Number.isFinite(s.temp)&&Math.abs(s.temp)>.2)out.push({name:'Skin temperature',value:`${s.temp>=0?'+':''}${s.temp.toFixed(1)} °C`,bad:s.temp>.5});
  if(Number.isFinite(s.spo2)&&Math.abs(s.spo2)>=1)out.push({name:'Blood oxygen',value:`${s.spo2>=0?'+':''}${s.spo2.toFixed(0)} points`,bad:s.spo2<=-2});
  if(Number.isFinite(s.resp)&&Math.abs(s.resp)>.08)out.push({name:'Breathing rate',value:fmtPct(s.resp),bad:s.resp>.15});
  return out.sort((a,b)=>Number(b.bad)-Number(a.bad)).slice(0,5);
}

function decision(s){
  if(!s.hasData)return{kind:'waiting',title:'Connect WHOOP or load the demo first',window:'',panel:'',body:'Once PulseLab has today’s numbers and a baseline, it can tell you what measurement would add the most information.'};
  const alarming=s.severity>=.58 || (Number.isFinite(s.spo2)&&s.spo2<=-3) || (Number.isFinite(s.temp)&&s.temp>=1);
  if(alarming)return{kind:'urgent',title:'Get a CBC + CMP within 72 hours',window:'Now / next 3 days',panel:'CBC + CMP',body:'Several signals moved far from your normal at the same time. Instead of waiting for the wearable to explain why, PulseLab would check blood cells and basic chemistry now.'};
  if(s.severity>=.34)return{kind:'soon',title:'Repeat a CBC + CMP within 7 days if this continues',window:'Within 7 days',panel:'CBC + CMP',body:'This is more than normal day-to-day noise, but it is not as extreme as the demo alert. A repeat measurement becomes useful if the same pattern sticks around.'};
  return{kind:'watch',title:'No blood test from this signal yet',window:'Keep watching',panel:'No test yet',body:'Today is still fairly close to your normal. Keep collecting data; PulseLab will change the recommendation if several signals move together.'};
}

function build(){
  const host=$('testingContent');if(!host||$('testingDecision'))return;
  host.innerHTML=`<section id="testingDecision" class="card testing-decision"><div class="testing-decision-head"><div><div class="eyebrow">PulseLab says</div><h2 id="testAction">Waiting for data</h2><p id="testActionBody"></p></div><div id="testWindow" class="test-window"></div></div><div id="testChanges" class="test-changes"></div><div id="testWhy" class="test-why"></div><div id="testNetworkNote" class="test-network-note"></div><div class="test-disclaimer">Research prototype, not a medical order. If these were real numbers and you felt very unwell, had trouble breathing, chest pain, fainting, or persistently low oxygen, seek medical care rather than waiting on this prototype.</div></section>`;
}

function render(){
  build();
  const s=state(),d=decision(s),network=readNetwork(),rows=changes(s);
  const sig=JSON.stringify([d.kind,d.title,rows,network?.similarity,network?.source]);if(sig===lastSignature)return;lastSignature=sig;
  const card=$('testingDecision');card.dataset.kind=d.kind;
  $('testAction').textContent=d.title;
  $('testActionBody').textContent=d.body;
  $('testWindow').innerHTML=d.window?`<span>When</span><strong>${d.window}</strong>`:'';
  $('testChanges').innerHTML=rows.length?`<div class="test-section-title">What changed</div><div class="test-change-grid">${rows.map(r=>`<div class="test-change ${r.bad?'bad':''}"><span>${r.name}</span><strong>${r.value}</strong></div>`).join('')}</div>`:'';
  $('testWhy').innerHTML=d.panel==='CBC + CMP'?`<div class="test-section-title">Why these tests</div><div class="test-explain-grid"><div><strong>CBC</strong><span>Checks red cells, white cells and platelets.</span></div><div><strong>CMP</strong><span>Checks electrolytes, glucose, kidney and liver chemistry.</span></div><div><strong>Why both</strong><span>Your watch can show that your body changed. These tests look for changes the watch cannot measure.</span></div></div>`:'';
  $('testNetworkNote').innerHTML=network?.similarity?`<strong>Population context:</strong> today’s pattern is close to real participants in the published-study network (${Math.round(network.similarity)}% demo match to the nearest displayed case). That match is context, not a diagnosis and not the reason the test is ordered.`:'<strong>Population context:</strong> open Population to compare today with real published study participants.';
}

function boot(){build();render();document.addEventListener('input',()=>setTimeout(render,80));document.addEventListener('change',()=>setTimeout(render,80));window.addEventListener('pulselab:analog-recommendation',()=>{lastSignature='';render();});window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='testing'){lastSignature='';render();}});setInterval(render,1200);}
boot();
