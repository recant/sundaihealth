import { runPanelModel } from './model-runtime.js';
import {
  loadProfile, clearProfile, observeToday, importWearableHistory, getPersonalBaseline,
  personalizeProbabilities, recordLabFeedback, personalizationStatus, seedDemoHistory
} from './personalization.js';

const METRICS=[
  ['resting_hr','Resting heart rate','bpm'],['hrv','HRV (RMSSD)','ms'],
  ['sleep_hours','Sleep duration','hours'],['steps','Daily steps','steps'],
  ['temperature_c','Skin temperature','°C'],['spo2','SpO₂','%'],
  ['respiratory_rate','Respiratory rate','/min'],['cgm_mean','CGM mean glucose','mg/dL'],
  ['cgm_cv','CGM variability (CV)','%']
];
const $=id=>document.getElementById(id);
let MODEL=null, timer=null, PROFILE=loadProfile(), LAST_GLOBAL=null, SKIP_OBSERVE_ONCE=false;

function makeRows(){
  $('metricRows').innerHTML=METRICS.map(([k,l,u])=>`<div class="metric-row">
    <label><strong>${l}</strong><small>${u}</small></label>
    <input id="b_${k}" data-kind="baseline" data-key="${k}" type="number" step="any" placeholder="optional" />
    <input id="c_${k}" data-kind="current" data-key="${k}" type="number" step="any" placeholder="today" />
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
function anomalyDetails(b,c,stats={}){
  const rows=[];
  for(const [key,label,unit] of METRICS){
    if(!Number.isFinite(b[key])||!Number.isFinite(c[key])) continue;
    let d,scale;
    if(key==='temperature_c'){d=c[key]-b[key];scale=SCALE[key];}
    else if(key==='spo2'){d=(c[key]-b[key])/100;scale=SCALE[key];}
    else {d=pct(c[key],b[key]);scale=SCALE[key];}
    const learnedScale=Number.isFinite(stats?.[key]?.mad)&&stats[key].mad>0
      ? (key==='temperature_c'?stats[key].mad:key==='spo2'?stats[key].mad/100:stats[key].mad/Math.max(Math.abs(b[key]),1e-9))
      : null;
    const denominator=Math.max(scale||1,learnedScale||0);
    const z=Math.abs(d)/(denominator||1);
    rows.push({key,label,unit,baseline:b[key],current:c[key],delta:d,z,personalDays:stats?.[key]?.n||0});
  }
  const strength=rows.length?1-Math.exp(-rows.reduce((s,r)=>s+Math.min(r.z,3),0)/(rows.length*1.2)):0;
  return {strength,rows:rows.sort((a,b)=>b.z-a.z)};
}

function finiteDiffAttribution(features,baseProb){
  if(!MODEL)return[];
  const out=[];
  const replacements={sleep_delta_pct:0,activity_delta_pct:0,persistence_days:1,current_sleep_h:features.baseline_sleep_h};
  for(const[k,repl]of Object.entries(replacements)){
    if(!Number.isFinite(features[k])||!Number.isFinite(repl))continue;
    const p=runPanelModel(MODEL,{...features,[k]:repl}).any_abnormal;
    out.push({key:k,effect:baseProb-p});
  }
  return out.sort((a,b)=>Math.abs(b.effect)-Math.abs(a.effect));
}

function testCards(probs,anomaly){
  const keys=['glycemic','cbc','metabolic','lipid'];
  const mods={
    glycemic:anomaly.rows.filter(r=>['cgm_mean','cgm_cv'].includes(r.key)).reduce((s,r)=>s+Math.min(r.z,2)*.035,0),
    cbc:anomaly.rows.filter(r=>['resting_hr','hrv','spo2'].includes(r.key)).reduce((s,r)=>s+Math.min(r.z,2)*.025,0),
    metabolic:anomaly.rows.filter(r=>['resting_hr','hrv','temperature_c','respiratory_rate','spo2'].includes(r.key)).reduce((s,r)=>s+Math.min(r.z,2)*.02,0),
    lipid:0
  };
  return keys.map(k=>({key:k,p:clamp(probs[k]+mods[k]),...MODEL.panel_tests[k]})).sort((a,b)=>b.p-a.p);
}
function label(score){if(score>=.62)return['CONSIDER TESTING SOON','high'];if(score>=.4)return['WATCH THE TREND','watch'];return['NO EVENT-TRIGGERED TEST','low'];}
function fmtDelta(r){if(r.key==='temperature_c')return`${r.delta>=0?'+':''}${r.delta.toFixed(1)} °C`;if(r.key==='spo2')return`${r.delta>=0?'+':''}${(r.delta*100).toFixed(1)} points`;return`${r.delta>=0?'+':''}${(r.delta*100).toFixed(0)}%`;}

function renderProfile(){
  const s=personalizationStatus(PROFILE);
  $('profileStage').textContent=s.stage;
  $('profileConfidence').textContent=`${s.confidence}% personalized`;
  $('profileDays').textContent=`${s.dayCount} wearable day${s.dayCount===1?'':'s'}`;
  $('profileLabs').textContent=`${s.labCount} blood result${s.labCount===1?'':'s'}`;
  $('profileFill').style.width=`${s.confidence}%`;
}

function render(){
  if(!MODEL)return;
  const manual=map('baseline'),c=map('current');
  if(Object.keys(c).length){
    if(SKIP_OBSERVE_ONCE)SKIP_OBSERVE_ONCE=false;
    else PROFILE=observeToday(PROFILE,c);
  }
  renderProfile();
  const learned=getPersonalBaseline(PROFILE,manual,c),b=learned.baseline;
  const entered=Object.keys(c).some(k=>Number.isFinite(c[k]));
  if(!entered){$('emptyState').classList.remove('hidden');$('resultView').classList.add('hidden');return;}
  const features=modelFeatures(b,c);
  const globalProbs=runPanelModel(MODEL,features);LAST_GLOBAL=globalProbs;
  const probs=personalizeProbabilities(globalProbs,PROFILE);
  const an=anomalyDetails(b,c,learned.stats);
  const persistence=Number($('persistence').value||1);
  const persistenceBoost=clamp((persistence-1)/6)*.08;
  const since=num('lastBlood');
  const recencyBoost=Number.isFinite(since)?clamp((since-180)/540)*.08:0;
  const score=clamp(.68*probs.any_abnormal+.32*an.strength+persistenceBoost+recencyBoost);
  const[status,level]=label(score),tests=testCards(probs,an),pstat=personalizationStatus(PROFILE);

  $('emptyState').classList.add('hidden');$('resultView').classList.remove('hidden');
  $('recommendation').textContent=status;$('recommendation').dataset.level=level;
  $('score').textContent=Math.round(score*100);
  $('headline').textContent=score>=.62?'Your recent wearable pattern increases the expected yield of blood testing.':score>=.4?'There is enough drift to keep watching closely.':'The model does not see a strong event-trigger for testing right now.';
  $('summary').textContent=`Population model: ${Math.round(globalProbs.any_abnormal*100)}% expected screening yield. Personalized model: ${Math.round(probs.any_abnormal*100)}%. Physiology drift from your learned baseline: ${Math.round(an.strength*100)}%.`;
  $('modelUsed').textContent=`${MODEL.name} ${MODEL.version} · ${pstat.stage}`;$('generatedAt').textContent='updates automatically';

  const top=an.rows.slice(0,4);
  $('reasons').innerHTML=top.length?top.map(r=>`<div class="reason"><div class="signal-name">${r.label}</div><div><strong>${Number(r.baseline).toFixed(1)} → ${r.current} ${r.unit} (${fmtDelta(r)})</strong><p>${r.z>=1.5?'Large':'Moderate'} deviation from ${r.personalDays>=3?`your learned ${r.personalDays}-day history`:'the current fallback baseline'}.</p></div></div>`).join(''):'<p class="muted">Connect WHOOP or add current wearable values to see the drivers.</p>';
  const shown=tests.filter((t,i)=>t.p>=.38||i===0).slice(0,4);
  $('tests').innerHTML=shown.map(t=>`<article class="test-item"><div class="test-top"><h3>${t.name}</h3><span class="prob">${Math.round(t.p*100)}%</span></div><p>${t.description} Current personalized estimate: ${Math.round(t.p*100)}%.</p></article>`).join('');
  $('panelBars').innerHTML=tests.map(t=>`<div class="bar-row"><span>${t.name}</span><div class="bar"><i style="width:${Math.round(t.p*100)}%"></i></div><b>${Math.round(t.p*100)}%</b></div>`).join('');
  const attr=finiteDiffAttribution(features,globalProbs.any_abnormal).slice(0,3);
  const offsets=['glycemic','cbc','metabolic','lipid'].filter(k=>(PROFILE.panel_feedback_counts?.[k]||0)>0).map(k=>`${k} n=${PROFILE.panel_feedback_counts[k]}`);
  $('modelDrivers').textContent=attr.length?`Global model drivers: ${attr.map(a=>`${a.key.replaceAll('_',' ')} ${a.effect>=0?'+':''}${Math.round(a.effect*100)} pts`).join(' · ')}${offsets.length?` · Personal calibration: ${offsets.join(', ')}`:''}`:'Model drivers will appear when enough compatible features are supplied.';
}
function schedule(){clearTimeout(timer);timer=setTimeout(render,120);}

function setWhoopUI(state,message=''){
  const card=document.querySelector('.whoop-card'),connect=$('whoopConnectBtn'),disconnect=$('whoopDisconnectBtn'),status=$('whoopStatus');
  card.classList.remove('source-success','source-error');
  connect.disabled=false;connect.classList.remove('hidden');disconnect.classList.add('hidden');
  if(state==='connected'){
    card.classList.add('source-success');connect.textContent='WHOOP connected';connect.disabled=true;disconnect.classList.remove('hidden');
  }else if(state==='syncing'){
    connect.textContent='Syncing WHOOP…';connect.disabled=true;
  }else if(state==='unconfigured'){
    card.classList.add('source-error');connect.textContent='WHOOP setup required';connect.disabled=true;
  }else if(state==='error'){
    card.classList.add('source-error');connect.textContent='Reconnect WHOOP';
  }else connect.textContent='Connect WHOOP';
  status.textContent=message;
}

function fillCurrentFromRecord(rec){
  const keys=['resting_hr','hrv','sleep_hours','steps','temperature_c','spo2','respiratory_rate','cgm_mean','cgm_cv'];
  for(const key of keys){
    const value=Number(rec?.[key]);
    if(Number.isFinite(value)&&$(`c_${key}`))$(`c_${key}`).value=Number(value.toFixed(key==='steps'?0:2));
  }
}

async function syncWhoop(){
  setWhoopUI('syncing','Checking WHOOP…');
  try{
    const response=await fetch('/api/whoop/data',{cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(response.status===503||data.configured===false){
      setWhoopUI('unconfigured','Add WHOOP developer credentials to this deployment.');return false;
    }
    if(response.status===401||data.connected===false){
      setWhoopUI('disconnected','Not connected yet');return false;
    }
    if(!response.ok)throw new Error(data.error||`WHOOP sync failed (${response.status})`);
    const records=Array.isArray(data.records)?data.records:[];
    if(records.length){
      const result=importWearableHistory(PROFILE,records,'whoop_api_v2');PROFILE=result.profile;
      fillCurrentFromRecord(records[records.length-1]);SKIP_OBSERVE_ONCE=true;
      renderProfile();render();
      document.querySelector('.manual').open=false;
      setWhoopUI('connected',`${records.length} recent WHOOP days synced automatically`);
      $('syncTitle').textContent='WHOOP is feeding PulseLab';
      $('syncCopy').textContent='Your recent WHOOP physiology has been backfilled. Each visit refreshes Recovery and Sleep data before the recommendation updates.';
    }else{
      setWhoopUI('connected','Connected · no scored Recovery/Sleep records found yet');
    }
    return true;
  }catch(error){setWhoopUI('error',error.message||String(error));return false;}
}

async function disconnectWhoop(){
  $('whoopDisconnectBtn').disabled=true;
  try{await fetch('/api/whoop/logout',{method:'POST'});}catch(_){ }
  $('whoopDisconnectBtn').disabled=false;setWhoopUI('disconnected','Disconnected');
  $('syncTitle').textContent='Continuous sync';$('syncCopy').textContent='Connect WHOOP once and PulseLab will refresh your physiology automatically whenever you return.';
}

function loadExample(){PROFILE=seedDemoHistory(PROFILE);const v={b_resting_hr:58,c_resting_hr:69,b_hrv:56,c_hrv:37,b_sleep_hours:7.5,c_sleep_hours:5.9,b_steps:9200,c_steps:5100,b_temperature_c:36.5,c_temperature_c:37.1,b_spo2:98,c_spo2:96,b_resp:14,c_resp:17};const aliases={b_resp:'b_respiratory_rate',c_resp:'c_respiratory_rate'};for(const[k,x]of Object.entries(v)){const id=aliases[k]||k;if($(id))$(id).value=x;}$('persistence').value='3';$('lastBlood').value='150';$('age').value='32';$('sex').value='male';schedule();}
function teachModel(){if(!LAST_GLOBAL)return;const panel=$('feedbackPanel').value,outcome=$('feedbackOutcome').value;PROFILE=recordLabFeedback(PROFILE,panel,outcome,LAST_GLOBAL);$('feedbackMessage').textContent=`Learned from this ${panel.replaceAll('_',' ')} result.`;render();}
function resetLearning(){PROFILE=clearProfile();$('feedbackMessage').textContent='Personal history cleared; back to the population prior.';renderProfile();schedule();}
function showOAuthResult(){
  const code=new URLSearchParams(location.search).get('whoop');if(!code)return;
  const messages={connected:'WHOOP authorized. Syncing your history…',denied:'WHOOP authorization was cancelled.',state_error:'WHOOP authorization could not be verified. Try again.',error:'WHOOP authorization failed. Try again.'};
  if(messages[code])$('whoopStatus').textContent=messages[code];
  history.replaceState({},'',location.pathname+location.hash);
}

async function boot(){
  makeRows();renderProfile();showOAuthResult();
  document.addEventListener('input',schedule);document.addEventListener('change',schedule);
  $('sampleBtn').addEventListener('click',loadExample);$('feedbackBtn').addEventListener('click',teachModel);$('resetProfileBtn').addEventListener('click',resetLearning);
  $('whoopConnectBtn').addEventListener('click',()=>{location.href='/api/whoop/auth';});$('whoopDisconnectBtn').addEventListener('click',disconnectWhoop);
  try{
    const r=await fetch('./model/bloodneed-model.json',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
    MODEL=await r.json();$('modelState').textContent=`${MODEL.name} ${MODEL.version} loaded`;render();await syncWhoop();
  }catch(e){$('modelState').textContent='Trained model artifact unavailable';$('modelState').classList.add('bad');$('emptyState').innerHTML='<h2>Model artifact missing</h2><p>Deploy the committed <code>bloodneed-model.json</code> with the frontend.</p>';}
}
boot();
