const $=id=>document.getElementById(id);
let MODEL=null,lastSignature='';

function num(id){const el=$(id);if(!el||el.value==='')return null;const n=Number(el.value);return Number.isFinite(n)?n:null;}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function pct(cur,base){return Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null;}
function pos(z){return clamp(50+(Number(z)||0)*16,4,96);}

async function getModel(){
  if(MODEL)return MODEL;
  try{const r=await fetch('./model/bloodneed-model.json',{cache:'no-store'});if(r.ok)MODEL=await r.json();}catch(_){ }
  return MODEL;
}

function rawFeatures(model){
  const bs=num('b_sleep_hours'),cs=num('c_sleep_hours'),ba=num('b_steps'),ca=num('c_steps');
  const sex=$('sex')?.value;
  return {
    age:num('age'),sex_male:sex==='male'?1:sex==='female'?0:null,
    baseline_sleep_h:bs,current_sleep_h:cs,sleep_delta_pct:pct(cs,bs),activity_delta_pct:pct(ca,ba),
    persistence_days:Number(num('persistence')||1)
  };
}

function featureVector(model){
  const names=model?.panel_model?.feature_names||[],raw=rawFeatures(model);
  const med=model?.panel_model?.imputer_median||[],mean=model?.panel_model?.scaler_mean||[],scale=model?.panel_model?.scaler_scale||[];
  return names.map((name,i)=>{
    const v=Number.isFinite(raw[name])?raw[name]:med[i];
    return (v-mean[i])/(scale[i]||1);
  });
}

function demoRecords(z){
  return Array.from({length:8},(_,i)=>({
    id:`DEMO-${String(i+1).padStart(2,'0')}`,
    age_band:['20–29','30–39','20–29','40–49'][i%4],
    z:z.map((v,j)=>v+Math.sin((i+1)*(j+1))*0.32+(i-3.5)*0.035),
    outcomes:{glycemic:i<4?1:0,cbc:[1,5].includes(i)?1:0,metabolic:[0,2,6].includes(i)?1:0,lipid:[2,3,7].includes(i)?1:0},
    demo:true
  }));
}

function buildShell(){
  const target=$('populationContent');if(!target||$('populationShell'))return;
  target.innerHTML=`<div id="populationShell" class="population-shell">
    <section class="card population-hero-card">
      <div class="population-score-row"><div><div class="eyebrow">Closest physiology match</div><h2 id="populationHeadline">Finding people like you…</h2><p id="populationSummary" class="muted"></p></div><div class="similarity-score"><strong id="similarityScore">—</strong><span>% similar</span></div></div>
      <div id="cohortProfile" class="cohort-profile"></div>
      <div class="population-note">Black = you. Green = closest anonymized analog. Center line = training-cohort typical value in BloodNeedNet's standardized feature space.</div>
    </section>
    <div class="population-grid">
      <section class="card"><div class="eyebrow">Nearest neighbors</div><h2>Closest cohort members</h2><div id="analogPeople" class="analog-list"></div></section>
      <section class="card"><div class="eyebrow">What showed up in their bloodwork</div><h2>Nearest-5 outcome pattern</h2><div id="outcomeBars" class="outcome-bars"></div><div id="populationCaveat" class="population-note"></div></section>
    </div>
  </div>`;
}

function renderProfile(model,z,closest){
  const names=model.panel_model.feature_names||[];
  const labels={age:'Age',sex_male:'Sex feature',baseline_sleep_h:'Usual sleep',current_sleep_h:'Current sleep',sleep_delta_pct:'Sleep change',activity_delta_pct:'Activity change',persistence_days:'Persistence'};
  const selected=['sleep_delta_pct','activity_delta_pct','current_sleep_h','persistence_days','age'].filter(k=>names.includes(k));
  $('cohortProfile').innerHTML=selected.map(name=>{
    const i=names.indexOf(name),uz=z[i]||0,az=closest.z?.[i]||0;
    const direction=Math.abs(uz)<.35?'near cohort typical':uz>0?'above cohort typical':'below cohort typical';
    return `<div class="cohort-row"><span>${labels[name]||name}</span><div class="cohort-track"><i class="cohort-analog-dot" style="left:${pos(az)}%"></i><i class="cohort-dot" style="left:${pos(uz)}%"></i></div><small>${direction}</small></div>`;
  }).join('');
}

async function render(){
  buildShell();const model=await getModel();if(!model?.panel_model)return;
  const z=featureVector(model),sig=z.map(x=>x.toFixed(2)).join('|')+'|'+(model.version||'');
  if(sig===lastSignature)return;lastSignature=sig;
  let records=Array.isArray(model?.analog_bank?.records)?model.analog_bank.records:[];
  const usingDemo=!records.length;if(usingDemo)records=demoRecords(z);
  const dist=r=>Math.sqrt((r.z||[]).reduce((s,v,i)=>s+(Number(v)-z[i])**2,0)/Math.max(1,z.length));
  const nearest=records.map(r=>({...r,d:dist(r)})).sort((a,b)=>a.d-b.d).slice(0,5),closest=nearest[0];
  if(!closest)return;
  const similarity=Math.round(100*Math.exp(-closest.d/2.2));
  $('similarityScore').textContent=clamp(similarity,1,99);
  $('populationHeadline').textContent=`You currently look most like ${closest.id} · age ${closest.age_band||'adult'}`;
  $('populationSummary').textContent=usingDemo?'Demo comparison shown until BloodNeedNet v0.2 is retrained with its anonymized analog bank.':'Similarity is computed in the same standardized feature space used by BloodNeedNet.';
  renderProfile(model,z,closest);

  const label={glycemic:'A1c / glycemic',cbc:'CBC',metabolic:'CMP / metabolic',lipid:'Lipid'};
  $('analogPeople').innerHTML=nearest.map((r,i)=>{
    const hits=Object.keys(label).filter(k=>r.outcomes?.[k]).map(k=>label[k]);
    const sim=Math.round(100*Math.exp(-r.d/2.2));
    return `<div class="analog-person"><div class="analog-avatar">${i+1}</div><div><h3>${r.id} · age ${r.age_band||'adult'}</h3><p>${hits.length?`Abnormal targets: ${hits.join(', ')}`:'No target abnormality among the four modeled panels'}</p></div><div class="analog-distance">${clamp(sim,1,99)}% match</div></div>`;
  }).join('');

  const rates=Object.keys(label).map(k=>({k,n:nearest.reduce((s,r)=>s+Number(r.outcomes?.[k]||0),0)})).sort((a,b)=>b.n-a.n);
  $('outcomeBars').innerHTML=rates.map(r=>`<div class="outcome-row"><span>${label[r.k]}</span><div class="outcome-track"><i style="width:${r.n/5*100}%"></i></div><b>${r.n}/5</b></div>`).join('');
  $('populationCaveat').textContent=usingDemo
    ? 'DEMO cohort: these neighbor cards are synthetic placeholders. Retrain v0.2 to replace them with anonymized NHANES analogs.'
    : 'These are same-participant lab abnormalities from the training cohort—not future disease outcomes. Similarity does not imply the same diagnosis or future trajectory.';
}

function boot(){buildShell();render();document.addEventListener('input',()=>setTimeout(render,160));document.addEventListener('change',()=>setTimeout(render,160));window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='population')render();});setInterval(render,1800);}
boot();
