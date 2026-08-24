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
  return specs.map(([label,key,type,isBad])=>{
    const baseline=num(`b_${key}`),current=num(`c_${key}`);
    if(!Number.isFinite(baseline)||!Number.isFinite(current))return null;
    const change=type==='delta'?current-baseline:pct(current,baseline);
    return{label,key,type,baseline,current,change,bad:isBad(change)};
  }).filter(Boolean);
}
function changeText(r){
  if(r.type==='delta')return `${r.change>=0?'+':''}${r.change.toFixed(1)}${r.key==='spo2'?' points':' °C'}`;
  return `${r.change>=0?'+':''}${Math.round(r.change*100)}%`;
}
function build(){
  const target=$('testingContent');if(!target||$('testingDecision'))return;
  target.innerHTML=`<section id="testingDecision" class="card testing-decision" data-kind="waiting">
    <div class="testing-decision-head">
      <div><div id="testingUrgency" class="eyebrow">BASELINE REQUIRED</div><h2 id="nextTestName">Upload WHOOP history first.</h2><p id="nextTestReason">PulseLab needs your prior measurements before it can interpret the live pattern.</p></div>
      <div class="test-window"><span>Timing</span><strong id="nextTestWindow">—</strong></div>
    </div>

    <div>
      <div class="test-section-title">What changed</div>
      <div id="testingChanges" class="test-change-grid"></div>
    </div>

    <div>
      <div class="test-section-title">What this could mean</div>
      <div id="possibleCauses" class="test-explain-grid"></div>
    </div>

    <div>
      <div class="test-section-title">Why these tests</div>
      <div class="test-explain-grid">
        <div><strong>CBC</strong><span id="cbcReason">Checks blood cells and can show patterns consistent with infection, inflammation, anemia, or other blood abnormalities.</span></div>
        <div><strong>CMP</strong><span id="cmpReason">Checks electrolytes, glucose, kidney markers and liver markers that a wearable cannot measure.</span></div>
        <div><strong>Why now</strong><span id="whyNow">Timing depends on how broad and persistent the change is compared with your baseline.</span></div>
      </div>
    </div>

    <div id="testNetworkNote" class="test-network-note"></div>
    <div class="testing-actions"><button type="button" data-go-tab="population">See the study matches</button><button class="secondary" type="button" data-go-tab="measurements">Review your history</button></div>
  </section>`;
}
function renderCauses(alert){
  const host=$('possibleCauses');
  if(!alert){
    host.innerHTML=`<div><strong>No strong pattern yet</strong><span>The current measurements do not form a broad enough change to point toward a useful disease category.</span></div>`;
    return;
  }
  host.innerHTML=`
    <div><strong>Infection or inflammation</strong><span>This is the main disease category worth checking. Published cases in the Population view include COVID-19, Lyme disease and other inflammatory illnesses with related wearable changes.</span></div>
    <div><strong>Acute stress or sleep loss</strong><span>These can also raise heart rate and breathing while lowering HRV. WESAD stress participants are included in the network for this reason.</span></div>
    <div><strong>Not enough to name one disease</strong><span>The wearable pattern cannot tell COVID-19 from Lyme disease, another infection, inflammation, or a non-disease stress response. Blood testing adds information needed to narrow that down.</span></div>`;
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
    $('nextTestName').textContent='Upload WHOOP history first.';
    $('nextTestWindow').textContent='—';
    $('nextTestReason').textContent='PulseLab needs several prior days so it can tell whether the current live values are actually unusual for you.';
    $('testingChanges').innerHTML='<div class="test-change"><span>Status</span><strong>No baseline</strong></div>';
    renderCauses(false);
    $('cbcReason').textContent='CBC is not recommended until the live pattern can be compared with a personal baseline.';
    $('cmpReason').textContent='CMP is not recommended until the live pattern can be compared with a personal baseline.';
    $('whyNow').textContent='No timing recommendation yet.';
    $('testNetworkNote').textContent='Population matches will become useful after the baseline is loaded.';
    return;
  }

  $('testingChanges').innerHTML=rows.map(r=>`<div class="test-change${r.bad?' bad':''}"><span>${r.label}</span><strong>${changeText(r)}</strong><small>${formatValue(r.key,r.baseline)} → ${formatValue(r.key,r.current)}</small></div>`).join('');
  renderCauses(alert);

  if(alert){
    card.dataset.kind='urgent';
    $('testingUrgency').textContent='TEST RECOMMENDED';
    $('nextTestName').textContent='CBC + CMP';
    $('nextTestWindow').textContent='Within 72 hours';
    $('nextTestReason').textContent=`${bad.length} measurements have moved away from your ${dayCount}-day WHOOP baseline at the same time. The pattern is broad enough to justify checking for infection, inflammation, or another systemic change.`;
    $('cbcReason').textContent='CBC checks white cells, red cells, hemoglobin and platelets. It can reveal blood changes that help distinguish infection or inflammation from a wearable-only signal.';
    $('cmpReason').textContent='CMP checks electrolytes, glucose, kidney markers and liver markers. It looks for metabolic or organ-level changes that WHOOP cannot see.';
    $('whyNow').textContent='The recommendation is time-sensitive because several signals are abnormal together rather than one measurement drifting on its own.';
  }else{
    card.dataset.kind='stable';
    $('testingUrgency').textContent='NO BLOOD TEST TRIGGERED';
    $('nextTestName').textContent='Continue monitoring';
    $('nextTestWindow').textContent='No new test now';
    $('nextTestReason').textContent=`Only ${bad.length} measurement${bad.length===1?' is':'s are'} currently outside the configured ranges. That is not enough for this prototype to recommend a new blood panel.`;
    $('cbcReason').textContent='CBC becomes more useful when several independent measurements change together.';
    $('cmpReason').textContent='CMP becomes more useful when several independent measurements change together.';
    $('whyNow').textContent='One isolated wearable change is not enough to trigger testing.';
  }

  const a=analog();
  if(alert){
    const match=a?.similarity?` The closest published match currently scores ${Math.round(a.similarity)}% on the PulseLab similarity scale.`:'';
    $('testNetworkNote').innerHTML=`<strong>Published comparisons:</strong> nearby study cases include COVID-19, Lyme disease and other inflammatory illness; acute stress also produces some of the same wearable shifts.${match} The match is a similarity ranking, not the probability that you have one of those diseases.`;
  }else{
    $('testNetworkNote').innerHTML='<strong>Published comparisons:</strong> the Population page shows illness and stress cases for context, but the current wearable pattern is not broad enough to trigger blood testing.';
  }
}

document.addEventListener('input',()=>setTimeout(render,80));
window.addEventListener('pulselab:history-imported',render);
window.addEventListener('pulselab:analog-recommendation',render);
window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='testing')render();});
build();render();
