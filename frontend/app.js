import { runPanelModel } from './model-runtime.js';
import {
  loadProfile, clearProfile, importWearableHistory, getPersonalBaseline,
  personalizeProbabilities, personalizationStatus, saveProfile
} from './personalization.js';

const $ = id => document.getElementById(id);
const METRICS = [
  ['resting_hr','Resting heart rate','bpm'],
  ['hrv','HRV','ms'],
  ['sleep_hours','Sleep','h'],
  ['steps','Steps',''],
  ['temperature_c','Skin temperature','°C'],
  ['spo2','Blood oxygen','%'],
  ['respiratory_rate','Breathing rate','/min']
];

let MODEL = null;
let timer = null;
let PROFILE = loadProfile();
if (PROFILE?.last_import?.source !== 'whoop_csv') PROFILE = clearProfile();

function clamp(x,a=0,b=1){ return Math.max(a,Math.min(b,x)); }
function pct(cur,base){ return Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null; }
function num(id){ const el=$(id); if(!el||el.value==='') return null; const n=Number(el.value); return Number.isFinite(n)?n:null; }

function makeRows(){
  $('metricRows').innerHTML = METRICS.map(([key]) =>
    `<input id="b_${key}" data-kind="baseline" data-key="${key}">
     <input id="c_${key}" data-kind="current" data-key="${key}">`
  ).join('');
}
function current(){
  const out={};
  document.querySelectorAll('[data-kind="current"]').forEach(el=>{
    const n=Number(el.value); if(el.value!==''&&Number.isFinite(n)) out[el.dataset.key]=n;
  });
  return out;
}
function setBaselineInputs(baseline){
  for(const [key] of METRICS){
    const el=$(`b_${key}`);
    if(el && Number.isFinite(baseline?.[key])) el.value=String(Number(baseline[key].toFixed(key==='steps'?0:2)));
  }
}
function deltaRows(b,c,stats={}){
  const rows=[];
  const scales={resting_hr:.08,hrv:.18,sleep_hours:.18,steps:.35,temperature_c:.45,spo2:.02,respiratory_rate:.16};
  for(const [key,label,unit] of METRICS){
    if(!Number.isFinite(b[key])||!Number.isFinite(c[key])) continue;
    let change;
    if(key==='temperature_c'||key==='spo2') change=c[key]-b[key];
    else change=pct(c[key],b[key]);
    const learned=Number(stats?.[key]?.mad);
    let denom=scales[key];
    if(Number.isFinite(learned)&&learned>0){
      const scaled=(key==='temperature_c'||key==='spo2')?learned:learned/Math.max(Math.abs(b[key]),1e-9);
      denom=Math.max(denom,scaled);
    }
    const comparable=(key==='spo2')?Math.abs(change)/2:Math.abs(change)/Math.max(denom,1e-6);
    rows.push({key,label,unit,baseline:b[key],current:c[key],change,z:comparable});
  }
  return rows.sort((a,b)=>b.z-a.z);
}
function humanChange(row){
  if(row.key==='temperature_c') return `${row.change>=0?'+':''}${row.change.toFixed(1)} °C`;
  if(row.key==='spo2') return `${row.change>=0?'+':''}${row.change.toFixed(1)} points`;
  return `${row.change>=0?'+':''}${Math.round(row.change*100)}%`;
}
function humanValue(row,value){
  if(row.key==='steps') return Math.round(value).toLocaleString();
  const digits=['temperature_c','spo2','sleep_hours','respiratory_rate'].includes(row.key)?1:0;
  return `${Number(value).toFixed(digits)}${row.unit?` ${row.unit}`:''}`;
}
function modelFeatures(b,c){
  return {
    age:num('age'),
    sex_male:$('sex')?.value==='male'?1:0,
    baseline_sleep_h:b.sleep_hours??null,
    current_sleep_h:c.sleep_hours??null,
    sleep_delta_pct:pct(c.sleep_hours,b.sleep_hours),
    activity_delta_pct:pct(c.steps,b.steps),
    persistence_days:Number($('persistence')?.value||5)
  };
}
function renderProfile(){
  const s=personalizationStatus(PROFILE);
  $('profileStage').textContent=s.dayCount>=14?'Baseline learned':'Baseline still limited';
  $('profileDays').textContent=`${s.dayCount} day${s.dayCount===1?'':'s'} imported`;
  $('profileConfidence').textContent=`${s.confidence}%`;
  $('profileLabs').textContent=`${s.labCount} blood result${s.labCount===1?'':'s'}`;
  const last=PROFILE.last_import;
  if(last?.source==='whoop_csv'){
    const file=last.filename?`${last.filename} · `:'';
    $('csvImportStatus').textContent=`${file}${last.rows} daily records imported. The file is parsed in this browser.`;
    $('csvImportStatus').classList.add('ok');
  }
}
function updateMethod(rows,hasHistory){
  const days=personalizationStatus(PROFILE).dayCount;
  const bad=rows.filter(r=>r.z>=1.2);
  if($('baselineMethodTitle')) $('baselineMethodTitle').textContent=hasHistory?`${days} imported days define the baseline`:'Waiting for WHOOP history';
  if($('baselineMethodBody')) $('baselineMethodBody').textContent=hasHistory
    ? 'PulseLab uses prior daily measurements to estimate the usual level and variability of each signal before comparing the simulated live state.'
    : 'At least several prior days are needed before the current state can be interpreted relative to you rather than a generic reference.';
  if($('currentMethodBody')) $('currentMethodBody').textContent='The current stream is simulated and intentionally abnormal for the demo. It is compared with, but never added to, the imported historical baseline.';
  if($('triggerMethodTitle')) $('triggerMethodTitle').textContent=hasHistory?`${bad.length} measurements currently cross the deviation threshold`:'No comparison yet';
  if($('triggerMethodBody')) $('triggerMethodBody').textContent=hasHistory
    ? (bad.length>=3?'The testing rule is activated because several independent measurements are abnormal at the same time. This reduces the chance that one noisy sensor value drives the recommendation.':'Fewer than three measurements currently cross the deviation threshold, so the testing rule is not activated.')
    : 'Testing is considered only after the current state can be compared with a learned personal baseline.';
}
function updateLiveCard(rows,hasHistory){
  const card=$('liveAlertCard'), metrics=$('liveAlertMetrics');
  if(!hasHistory){
    card.className='card live-alert waiting';
    $('liveAlertKicker').textContent='BASELINE REQUIRED';
    $('liveAlertTitle').textContent='Upload WHOOP history to establish your normal range.';
    $('liveAlertBody').textContent='PulseLab needs prior measurements before it can determine whether the current simulated live pattern is materially different from your usual physiology.';
    $('liveAlertAction').classList.add('hidden');
    metrics.innerHTML='';
    updateMethod(rows,false);
    return;
  }
  const bad=rows.filter(r=>r.z>=1.2).slice(0,5);
  if(bad.length>=3){
    card.className='card live-alert bad';
    $('liveAlertKicker').textContent=`${bad.length} MEASUREMENTS OUTSIDE YOUR USUAL RANGE`;
    $('liveAlertTitle').textContent='Your current physiology is significantly different from your baseline.';
    $('liveAlertBody').textContent='Multiple independent signals are moving in an unfavorable direction at the same time. That coordinated change is the reason PulseLab recommends a CBC + CMP within 72 hours rather than treating any one measurement as sensor noise.';
    $('liveAlertAction').textContent='Review testing recommendation';
    $('liveAlertAction').classList.remove('hidden');
  } else {
    card.className='card live-alert good';
    $('liveAlertKicker').textContent='CURRENT STATE WITHIN EXPECTED RANGE';
    $('liveAlertTitle').textContent='The live pattern is close to your learned baseline.';
    $('liveAlertBody').textContent='No multi-signal deviation currently crosses the testing threshold. Individual measurements may move, but the pattern is not broad enough to trigger a new blood test.';
    $('liveAlertAction').classList.add('hidden');
  }
  metrics.innerHTML=bad.map(r=>`<div><span>${r.label}</span><strong>${humanChange(r)}</strong><small>${humanValue(r,r.baseline)} → ${humanValue(r,r.current)}</small></div>`).join('');
  updateMethod(rows,true);
}
function render(){
  if(!MODEL) return;
  renderProfile();
  const c=current();
  const learned=getPersonalBaseline(PROFILE,{},c);
  const b=learned.baseline;
  setBaselineInputs(b);
  const rows=deltaRows(b,c,learned.stats);
  const hasHistory=personalizationStatus(PROFILE).dayCount>=7;
  updateLiveCard(rows,hasHistory);

  if(!Object.keys(c).length){
    $('score').textContent='0';
    return;
  }

  const probs=personalizeProbabilities(runPanelModel(MODEL,modelFeatures(b,c)),PROFILE);
  const strength=rows.length ? 1-Math.exp(-rows.reduce((s,r)=>s+Math.min(r.z,3),0)/(rows.length*1.1)) : 0;
  const score=hasHistory?clamp(.25*(probs.any_abnormal||0)+.75*strength):0;
  const badRows=rows.filter(r=>r.z>=1.2);
  const direct=hasHistory && badRows.length>=3;

  $('score').textContent=String(Math.round(score*100));
  $('recommendation').textContent=direct?'CBC + CMP WITHIN 72 HOURS':'NO NEW BLOOD TEST';
  $('headline').textContent=direct?'Several current measurements are outside the range learned from your WHOOP history.':'The current pattern does not cross the multi-signal testing threshold.';
  $('summary').textContent=direct
    ? `${badRows.length} independent measurements are abnormal at the same time relative to your imported baseline. PulseLab recommends a CBC + CMP within 72 hours to add blood-cell and chemistry information that wearable sensors cannot provide.`
    : 'PulseLab is not seeing enough coordinated deviation across independent measurements to justify a new blood test from the current signal alone.';
  $('modelUsed').textContent=MODEL.name||'BloodNeedNet';
  $('generatedAt').textContent='current state';
  $('reasons').innerHTML=rows.slice(0,5).map(r=>`<div class="reason"><strong>${r.label}: ${humanValue(r,r.baseline)} → ${humanValue(r,r.current)} (${humanChange(r)})</strong></div>`).join('');
  $('tests').innerHTML=direct
    ? '<article class="test-item"><h3>CBC</h3><p>Blood-cell counts and related indices.</p></article><article class="test-item"><h3>CMP</h3><p>Electrolytes, glucose, kidney markers and liver markers.</p></article>'
    : '<article class="test-item"><h3>No event-triggered panel</h3></article>';
  $('panelBars').innerHTML=direct
    ? '<div class="bar-row"><span>CBC + CMP</span><b>recommended</b></div>'
    : '<div class="bar-row"><span>No event-triggered panel</span></div>';
  $('modelDrivers').textContent=direct?`Trigger: ${badRows.length} current measurements crossed the personal-deviation threshold at the same time.`:'Trigger not met.';
  window.dispatchEvent(new CustomEvent('pulselab:state',{detail:{direct,score,rows,badRows,baseline:b,current:c}}));
}
function schedule(){ clearTimeout(timer); timer=setTimeout(render,90); }

function parseCsv(text){
  const rows=[]; let row=[], field='', quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){ field+='"'; i++; }
      else if(ch==='"') quoted=false;
      else field+=ch;
    } else {
      if(ch==='"') quoted=true;
      else if(ch===','){ row.push(field); field=''; }
      else if(ch==='\n'){ row.push(field.replace(/\r$/,'')); rows.push(row); row=[]; field=''; }
      else field+=ch;
    }
  }
  if(field.length||row.length){ row.push(field.replace(/\r$/,'')); rows.push(row); }
  return rows.filter(r=>r.some(v=>String(v).trim()!==''));
}
function norm(s){ return String(s||'').toLowerCase().replace(/[%°₂]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function numberValue(v){
  const n=Number(String(v??'').replace(/,/g,'').replace(/%/g,'').trim());
  return Number.isFinite(n)?n:null;
}
function recordsFromWhoopCsv(text){
  const table=parseCsv(text);
  if(table.length<2) throw new Error('This CSV has no data rows.');
  const headers=table[0].map(norm);
  const idx=(aliases)=>{
    for(const alias of aliases){
      const target=norm(alias);
      const exact=headers.indexOf(target); if(exact>=0) return exact;
    }
    for(const alias of aliases){
      const target=norm(alias);
      const partial=headers.findIndex(h=>h.includes(target)||target.includes(h)); if(partial>=0) return partial;
    }
    return -1;
  };
  const cols={
    date:idx(['cycle start time','cycle start','date','start time']),
    rhr:idx(['resting heart rate bpm','resting heart rate','rhr']),
    hrv:idx(['heart rate variability ms','heart rate variability','hrv rmssd milli','hrv']),
    temp:idx(['skin temperature celsius','skin temperature','skin temp celsius','skin temp']),
    spo2:idx(['blood oxygen','spo2 percentage','spo2']),
    resp:idx(['respiratory rate rpm','respiratory rate','breathing rate']),
    sleepMin:idx(['asleep duration min','total sleep time min','sleep duration min']),
    sleepHours:idx(['sleep duration hours','sleep hours']),
    steps:idx(['steps','daily steps'])
  };
  if(cols.date<0 || (cols.rhr<0 && cols.hrv<0)) throw new Error('Use WHOOP physiological_cycles.csv. The date, resting-heart-rate or HRV columns could not be identified.');
  const records=[];
  for(const cells of table.slice(1)){
    const rawDate=cells[cols.date];
    const date=new Date(rawDate);
    if(!Number.isFinite(date.getTime())) continue;
    const rec={date};
    const add=(key,col)=>{ if(col>=0){ const n=numberValue(cells[col]); if(Number.isFinite(n)) rec[key]=n; } };
    add('resting_hr',cols.rhr); add('hrv',cols.hrv); add('temperature_c',cols.temp);
    add('spo2',cols.spo2); add('respiratory_rate',cols.resp); add('steps',cols.steps);
    if(cols.sleepHours>=0){ const n=numberValue(cells[cols.sleepHours]); if(Number.isFinite(n)) rec.sleep_hours=n; }
    else if(cols.sleepMin>=0){ const n=numberValue(cells[cols.sleepMin]); if(Number.isFinite(n)) rec.sleep_hours=n/60; }
    if(Object.keys(rec).length>1) records.push(rec);
  }
  records.sort((a,b)=>a.date-b.date);
  if(records.length<3) throw new Error('Fewer than three usable WHOOP days were found in this file.');
  return records;
}
async function importCsv(file){
  const status=$('csvImportStatus');
  status.textContent='Reading and parsing the CSV…'; status.classList.remove('ok','error');
  try{
    const text=await file.text();
    const records=recordsFromWhoopCsv(text);
    PROFILE=clearProfile();
    const result=importWearableHistory(PROFILE,records,'whoop_csv');
    PROFILE=result.profile;
    PROFILE.last_import={...(PROFILE.last_import||{}),source:'whoop_csv',filename:file.name,rows:result.imported,at:new Date().toISOString()};
    saveProfile(PROFILE);
    renderProfile();
    render();
    window.dispatchEvent(new CustomEvent('pulselab:history-imported',{detail:{rows:result.imported,filename:file.name}}));
  } catch(error){
    status.textContent=error?.message||String(error); status.classList.add('error');
  }
}

async function boot(){
  makeRows();
  renderProfile();
  $('whoopCsvInput')?.addEventListener('change',event=>{
    const file=event.target.files?.[0]; if(file) importCsv(file);
  });
  document.addEventListener('input',schedule);
  document.addEventListener('change',schedule);
  try{
    const r=await fetch('./model/bloodneed-model.json',{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    MODEL=await r.json();
    $('modelState').textContent='ready';
    render();
  }catch(error){
    $('modelState').textContent='model unavailable';
    console.error(error);
  }
}
boot();
