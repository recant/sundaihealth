import { runPanelModel } from './model-runtime.js';

const METRICS=[
  ['resting_hr','Resting heart rate','bpm'],['hrv','HRV (RMSSD)','ms'],
  ['sleep_hours','Sleep duration','hours'],['steps','Daily steps','steps'],
  ['temperature_c','Skin/body temperature','°C'],['spo2','SpO₂','%'],
  ['respiratory_rate','Respiratory rate','/min'],['cgm_mean','CGM mean glucose','mg/dL'],
  ['cgm_cv','CGM variability (CV)','%']
];
const $=id=>document.getElementById(id);
let MODEL=null, timer=null;

function makeRows(){
  $('metricRows').innerHTML=METRICS.map(([k,l,u])=>`<div class="metric-row">
    <label><strong>${l}</strong><small>${u}</small></label>
    <input id="b_${k}" data-kind="baseline" data-key="${k}" type="number" step="any" placeholder="baseline" />
    <input id="c_${k}" data-kind="current" data-key="${k}" type="number" step="any" placeholder="current" />
  </div>`).join('');
}
function num(id){const v=$(id)?.value?.trim(); return v===''||v==null?null:Number(v);}
function map(kind){const o={};document.querySelectorAll(`[data-kind="${kind}"]`).forEach(e=>{if(e.value.trim()!=='')o[e.dataset.key]=Number(e.value)});return o;}
function pct(cur,base){return Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null;}
function clamp(x,a=0,b=1){return Math.max(a,Math.min(b,x));}

function modelFeatures(b,c){
  return {
    age:num('age'), sex_male:$('sex').value==='male'?1:$('sex').value==='female'?0:null,
    baseline_sleep_h:b.sleep_hours??null,current_sleep_h:c.sleep_hours??null,
    sleep_delta_pct:pct(c.sleep_hours,b.sleep_hours),activity_delta_pct:pct(c.steps,b.steps),
    persistence_days:Number($('persistence').value||1)
  };
}

const SCALE={resting_hr:.08,hrv:.18,sleep_hours:.18,steps:.35,temperature_c:.5,spo2:.025,respiratory_rate:.18,cgm_mean:.12,cgm_cv:.25};
function anomalyDetails(b,c){
  const rows=[];
  for(const [key,label,unit] of METRICS){
    if(!Number.isFinite(b[key])||!Number.isFinite(c[key])) continue;
    let d,scale;
    if(key==='temperature_c'){d=c[key]-b[key];scale=SCALE[key];}
    else if(key==='spo2'){d=(c[key]-b[key])/100;scale=SCALE[key];}
    else {d=pct(c[key],b[key]);scale=SCALE[key];}
    const z=Math.abs(d)/(scale||1);
    rows.push({key,label,unit,baseline:b[key],current:c[key],delta:d,z});
  }
  const strength=rows.length?1-Math.exp(-rows.reduce((s,r)=>s+Math.min(r.z,3),0)/(rows.length*1.2)):0;
  return {strength,rows:rows.sort((a,b)=>b.z-a.z)};
}

function finiteDiffAttribution(features,baseProb){
  if(!MODEL) return [];
  const out=[];
  const replacements={sleep_delta_pct:0,activity_delta_pct:0,persistence_days:1,current_sleep_h:features.baseline_sleep_h};
  for(const [k,repl] of Object.entries(replacements)){
    if(!Number.isFinite(features[k])||!Number.isFinite(repl)) continue;
    const p=runPanelModel(MODEL,{...features,[k]:repl}).any_abnormal;
    out.push({key:k,effect:baseProb-p});
  }
  return out.sort((a,b)=>Math.abs(b.effect)-Math.abs(a.effect));
}

function testCards(probs, anomaly){
  const keys=['glycemic','cbc','metabolic','lipid'];
  const mods={
    glycemic: anomaly.rows.filter(r=>['cgm_mean','cgm_cv'].includes(r.key)).reduce((s,r)=>s+Math.min(r.z,2)*.035,0),
    cbc: anomaly.rows.filter(r=>['resting_hr','hrv','spo2'].includes(r.key)).reduce((s,r)=>s+Math.min(r.z,2)*.025,0),
    metabolic: anomaly.rows.filter(r=>['resting_hr','hrv','temperature_c','respiratory_rate','spo2'].includes(r.key)).reduce((s,r)=>s+Math.min(r.z,2)*.02,0),
    lipid:0
  };
  return keys.map(k=>({key:k,p:clamp(probs[k]+mods[k]),...MODEL.panel_tests[k]})).sort((a,b)=>b.p-a.p);
}

function label(score){if(score>=.62)return['CONSIDER TESTING SOON','high']; if(score>=.4)return['WATCH THE TREND','watch']; return['NO EVENT-TRIGGERED TEST','low'];}
function fmtDelta(r){if(r.key==='temperature_c')return `${r.delta>=0?'+':''}${r.delta.toFixed(1)} °C`; if(r.key==='spo2')return `${r.delta>=0?'+':''}${(r.delta*100).toFixed(1)} points`;return `${r.delta>=0?'+':''}${(r.delta*100).toFixed(0)}%`;}

function render(){
  if(!MODEL)return;
  const b=map('baseline'),c=map('current');
  const entered=Object.keys(b).some(k=>Number.isFinite(c[k]));
  if(!entered){$('emptyState').classList.remove('hidden');$('resultView').classList.add('hidden');return;}
  const features=modelFeatures(b,c);
  const probs=runPanelModel(MODEL,features);
  const an=anomalyDetails(b,c);
  const persistence=Number($('persistence').value||1);
  const persistenceBoost=clamp((persistence-1)/6)*.08;
  const since=num('lastBlood');
  const recencyBoost=Number.isFinite(since)?clamp((since-180)/540)*.08:0;
  const score=clamp(.68*probs.any_abnormal+.32*an.strength+persistenceBoost+recencyBoost);
  const [status,level]=label(score);
  const tests=testCards(probs,an);

  $('emptyState').classList.add('hidden');$('resultView').classList.remove('hidden');
  $('recommendation').textContent=status;$('recommendation').dataset.level=level;
  $('score').textContent=Math.round(score*100);
  $('headline').textContent=score>=.62?'Your recent wearable pattern increases the expected yield of blood testing.':score>=.4?'There is enough drift to keep watching closely.':'The model does not see a strong event-trigger for testing right now.';
  $('summary').textContent=`BloodNeedNet estimates a ${Math.round(probs.any_abnormal*100)}% screening-yield probability from the trained wearable model; your personal physiology-drift score is ${Math.round(an.strength*100)}%.`;
  $('modelUsed').textContent=`${MODEL.name} ${MODEL.version} · ${MODEL.panel_model.training_participants} training participants`;
  $('generatedAt').textContent='updates automatically';

  const top=an.rows.slice(0,4);
  $('reasons').innerHTML=top.length?top.map(r=>`<div class="reason"><div class="signal-name">${r.label}</div><div><strong>${r.baseline} → ${r.current} ${r.unit} (${fmtDelta(r)})</strong><p>${r.z>=1.5?'Large':'Moderate'} deviation from your own baseline; this raises the event-trigger signal.</p></div></div>`).join(''):'<p class="muted">Add baseline and current wearable values to see the drivers.</p>';

  const shown=tests.filter((t,i)=>t.p>=.38||i===0).slice(0,4);
  $('tests').innerHTML=shown.map(t=>`<article class="test-item"><div class="test-top"><h3>${t.name}</h3><span class="prob">${Math.round(t.p*100)}%</span></div><p>${t.description} The trained head estimates this panel is ${Math.round(t.p*100)}% likely to contain the target pattern used during training.</p></article>`).join('');
  $('panelBars').innerHTML=tests.map(t=>`<div class="bar-row"><span>${t.name}</span><div class="bar"><i style="width:${Math.round(t.p*100)}%"></i></div><b>${Math.round(t.p*100)}%</b></div>`).join('');

  const attr=finiteDiffAttribution(features,probs.any_abnormal).slice(0,3);
  $('modelDrivers').textContent=attr.length?`Learned model drivers: ${attr.map(a=>`${a.key.replaceAll('_',' ')} ${a.effect>=0?'+':''}${Math.round(a.effect*100)} pts`).join(' · ')}`:'Learned model drivers will appear when enough compatible features are supplied.';
}
function schedule(){clearTimeout(timer);timer=setTimeout(render,120);}
function loadExample(){const v={b_resting_hr:58,c_resting_hr:69,b_hrv:56,c_hrv:37,b_sleep_hours:7.5,c_sleep_hours:5.9,b_steps:9200,c_steps:5100,b_temperature_c:36.5,c_temperature_c:37.1,b_spo2:98,c_spo2:96,b_respiratory_rate:14,c_respiratory_rate:17};for(const[k,x]of Object.entries(v))$(k).value=x;$('persistence').value='3';$('lastBlood').value='150';$('age').value='32';$('sex').value='male';schedule();}
async function boot(){
  makeRows();
  document.addEventListener('input',schedule);document.addEventListener('change',schedule);$('sampleBtn').addEventListener('click',loadExample);
  try{const r=await fetch('./model/bloodneed-model.json',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);MODEL=await r.json();$('modelState').textContent=`${MODEL.name} ${MODEL.version} loaded`;render();}
  catch(e){$('modelState').textContent='Training model artifact is not available yet';$('modelState').classList.add('bad');$('emptyState').innerHTML='<h2>Model training in progress</h2><p>The app will become live as soon as <code>bloodneed-model.json</code> is produced by the training workflow.</p>';}
}
boot();
