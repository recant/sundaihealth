const $=id=>document.getElementById(id);
const PROFILE_KEY='pulselab-personal-profile-v1';
const ANALOG_KEY='pulselab-analog-rec-v1';

function num(id){const el=$(id);if(!el||el.value==='')return null;const n=Number(el.value);return Number.isFinite(n)?n:null;}
function pct(cur,base){return Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null;}
function profile(){try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')||{};}catch(_){return{};}}
function analog(){try{return JSON.parse(localStorage.getItem(ANALOG_KEY)||'null')||null;}catch(_){return null;}}
function formatValue(key,value){
  if(!Number.isFinite(value))return'—';
  if(key==='steps')return Math.round(value).toLocaleString();
  const unit={resting_hr:'bpm',hrv:'ms',sleep_hours:'h',temperature_c:'°C',spo2:'%',respiratory_rate:'/min'}[key]||'';
  const digits=['sleep_hours','temperature_c','spo2','respiratory_rate'].includes(key)?1:0;
  return `${value.toFixed(digits)}${unit?` ${unit}`:''}`;
}
function changeRows(){
  const specs=[
    ['Resting heart rate','resting_hr','pct',d=>d>.10],
    ['HRV','hrv','pct',d=>d<-.20],
    ['Sleep','sleep_hours','pct',d=>d<-.18],
    ['Skin temperature','temperature_c','delta',d=>d>.4],
    ['Blood oxygen','spo2','delta',d=>d<-1.5],
    ['Breathing rate','respiratory_rate','pct',d=>d>.15]
  ];
  const rows=[];
  for(const [label,key,type,isBad] of specs){
    const baseline=num(`b_${key}`),current=num(`c_${key}`);
    if(!Number.isFinite(baseline)||!Number.isFinite(current))continue;
    const change=type==='delta'?current-baseline:pct(current,baseline);
    rows.push({label,key,type,baseline,current,change,bad:isBad(change)});
  }
  return rows;
}
function changeText(r){
  if(r.type==='delta')return `${r.change>=0?'+':''}${r.change.toFixed(1)}${r.key==='spo2'?' points':' °C'}`;
  return `${r.change>=0?'+':''}${Math.round(r.change*100)}%`;
}
function build(){
  const target=$('testingContent');if(!target||$('testingDecision'))return;
  target.innerHTML=`<section id="testingDecision" class="card testing-decision" data-kind="waiting">
    <div class="testing-decision-head">
      <div><div id="testingUrgency" class="eyebrow">BASELINE REQUIRED</div><h2 id="nextTestName">Upload WHOOP history before interpreting the live stream.</h2><p id="nextTestReason">PulseLab needs a personal baseline before a testing recommendation can be tied to meaningful change.</p></div>
      <div class="test-window"><span>Recommended timing</span><strong id="nextTestWindow">Not available yet</strong></div>
    </div>
    <div>
      <div class="test-section-title">Measurements driving the decision</div>
      <div id="testingChanges" class="test-change-grid"></div>
    </div>
    <div class="test-explain-grid">
      <div><strong>CBC</strong><span id="cbcReason">A complete blood count measures red cells, white cells, platelets and related indices. It adds information that a wearable cannot directly observe.</span></div>
      <div><strong>CMP</strong><span id="cmpReason">A comprehensive metabolic panel measures electrolytes, glucose, kidney markers and liver markers, giving a broad view of systemic chemistry.</span></div>
      <div><strong>Why this timing?</strong><span id="whyNow">The timing depends on how many independent measurements are outside the personal baseline at the same time.</span></div>
    </div>
    <div id="testNetworkNote" class="test-network-note"><strong>Population comparison:</strong> open the Population page to see whether published participants had a similar combination of wearable changes and what happened in those studies.</div>
    <div class="testing-actions"><button type="button" data-go-tab="population">Review published comparisons</button><button class="secondary" type="button" data-go-tab="measurements">Review your history</button></div>
    <div class="test-disclaimer">The recommendation is generated from the uploaded wearable baseline and the simulated live state. It does not identify a diagnosis. If symptoms are severe or rapidly worsening, clinical evaluation should not wait for this prototype.</div>
  </section>`;
}
function render(){
  build();
  const p=profile();
  const dayCount=Object.keys(p.wearable_days||{}).length;
  const rows=changeRows();
  const bad=rows.filter(r=>r.bad);
  const alert=dayCount>=7&&bad.length>=3;
  const card=$('testingDecision');

  if(dayCount<7){
    card.dataset.kind='waiting';
    $('testingUrgency').textContent='BASELINE REQUIRED';
    $('nextTestName').textContent='Upload WHOOP history before interpreting the live stream.';
    $('nextTestWindow').textContent='Not available yet';
    $('nextTestReason').textContent='A personal baseline is required so that PulseLab can distinguish a real deviation from ordinary day-to-day variation. At least several prior days are needed for this demo rule.';
    $('testingChanges').innerHTML='<div class="test-change"><span>Current status</span><strong>No baseline</strong></div>';
    $('whyNow').textContent='No timing recommendation is generated until the live measurements can be compared with prior WHOOP history.';
    return;
  }

  $('testingChanges').innerHTML=rows.map(r=>`<div class="test-change${r.bad?' bad':''}"><span>${r.label}</span><strong>${changeText(r)}</strong><small>${formatValue(r.key,r.baseline)} → ${formatValue(r.key,r.current)}</small></div>`).join('');

  if(alert){
    card.dataset.kind='urgent';
    $('testingUrgency').textContent='ACTION RECOMMENDED';
    $('nextTestName').textContent='CBC + CMP';
    $('nextTestWindow').textContent='Within 72 hours';
    $('nextTestReason').textContent=`${bad.length} independent measurements are outside the ranges learned from ${dayCount} imported WHOOP days. The reason to test is not any single wearable value; it is the fact that heart rate, autonomic recovery, breathing, oxygenation, temperature or sleep are changing together. A blood panel adds a different measurement modality rather than asking the wearable to explain the cause.`;
    $('cbcReason').textContent='CBC measures red blood cells, white blood cells, hemoglobin, platelets and related indices. In this setting it is useful because a broad change in heart rate, HRV and oxygenation can accompany processes that are not distinguishable from wearable data alone.';
    $('cmpReason').textContent='CMP measures electrolytes, glucose, kidney function markers and liver-associated markers. It complements the CBC by checking basic chemistry and organ-related markers that are completely absent from the wearable stream.';
    $('whyNow').textContent=`The trigger requires at least three independent deviations at once; ${bad.length} are currently present. The 72-hour window reflects the strength and breadth of the current demo pattern, not a diagnosis of one specific disease.`;
  }else{
    card.dataset.kind='stable';
    $('testingUrgency').textContent='NO EVENT-TRIGGERED BLOOD TEST';
    $('nextTestName').textContent='No new panel from the current signal.';
    $('nextTestWindow').textContent='Continue measuring';
    $('nextTestReason').textContent=`Only ${bad.length} measurement${bad.length===1?' is':'s are'} currently outside the configured deviation thresholds. PulseLab does not recommend a blood draw when the pattern is narrow enough to plausibly reflect ordinary variation or one noisy sensor channel.`;
    $('cbcReason').textContent='CBC would become more useful if a broader pattern develops across independent physiological measurements.';
    $('cmpReason').textContent='CMP would become more useful if the current state develops into a persistent multi-signal deviation rather than an isolated change.';
    $('whyNow').textContent='The testing trigger is intentionally based on several signals moving together, so a single changed metric does not automatically produce a blood-test recommendation.';
  }

  const a=analog();
  if(a?.similarity){
    $('testNetworkNote').innerHTML=`<strong>Population comparison:</strong> the nearest published participant currently has a ${Math.round(a.similarity)}% PulseLab demo match. That number is a similarity score, not a disease probability. The useful part is the participant’s actual study record, which you can inspect on the Population page.`;
  }else{
    $('testNetworkNote').innerHTML='<strong>Population comparison:</strong> the testing decision above is driven by your baseline and current measurements. The Population page is a secondary evidence layer that shows what happened in published participants with related wearable patterns.';
  }
}

document.addEventListener('input',()=>setTimeout(render,80));
window.addEventListener('pulselab:history-imported',render);
window.addEventListener('pulselab:analog-recommendation',render);
window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='testing')render();});
build();render();
