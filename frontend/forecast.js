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
      <div class="test-section-title">Which test answers which question?</div>
      <div class="test-explain-grid">
        <div><strong>COVID antigen or NAAT/PCR</strong><span id="targetedReason">If COVID-19 is one of the leading possibilities, this is the test that checks for SARS-CoV-2 itself. An antigen test looks for viral proteins; a NAAT/PCR looks for viral genetic material.</span></div>
        <div><strong>CBC</strong><span id="cbcReason">Counts white cells, red cells, hemoglobin and platelets. It can show whether there is a blood-cell pattern consistent with infection, inflammation, anemia or another systemic problem, but it does not identify the pathogen.</span></div>
        <div><strong>CMP</strong><span id="cmpReason">Measures glucose, electrolytes, kidney markers, liver enzymes and proteins. It shows whether the illness is affecting metabolism, hydration, kidneys or liver, but it does not diagnose COVID-19.</span></div>
      </div>
    </div>

    <div class="test-network-note"><strong>The logic:</strong> use a disease-specific test to answer “what is it?” and broader blood work to answer “what is it doing to the body?”</div>
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
    <div><strong>Respiratory infection</strong><span>COVID-19 is one real published comparison in the network. Influenza and other respiratory infections can also produce overlapping wearable changes.</span></div>
    <div><strong>Other infection or inflammation</strong><span>The Stanford cases also include Lyme disease and non-specific inflammatory illness. Wearables can flag the physiological change without identifying the exact cause.</span></div>
    <div><strong>Non-infectious stress</strong><span>Acute stress and sleep loss can move some of the same signals, which is why the wearable pattern alone should not be treated as a diagnosis.</span></div>`;
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
    $('targetedReason').textContent='A disease-specific test only makes sense after the wearable pattern and context make that disease plausible.';
    $('cbcReason').textContent='CBC is not recommended until the live pattern can be compared with a personal baseline.';
    $('cmpReason').textContent='CMP is not recommended until the live pattern can be compared with a personal baseline.';
    $('testNetworkNote').textContent='Population matches will become useful after the baseline is loaded.';
    return;
  }

  $('testingChanges').innerHTML=rows.map(r=>`<div class="test-change${r.bad?' bad':''}"><span>${r.label}</span><strong>${changeText(r)}</strong><small>${formatValue(r.key,r.baseline)} → ${formatValue(r.key,r.current)}</small></div>`).join('');
  renderCauses(alert);

  if(alert){
    card.dataset.kind='urgent';
    $('testingUrgency').textContent='TESTING RECOMMENDED';
    $('nextTestName').textContent='Start with a targeted infection test; add CBC + CMP for broader context';
    $('nextTestWindow').textContent='Within 72 hours';
    $('nextTestReason').textContent=`${bad.length} measurements have moved away from your ${dayCount}-day WHOOP baseline together. Because the nearest published examples include respiratory infection, the first question is whether a specific infection is present; the blood panels answer a different question about the body's response.`;
    $('targetedReason').textContent='If COVID-19 is plausible from symptoms, exposure, or the closest study match, use a COVID antigen test or NAAT/PCR. That is the test that detects SARS-CoV-2. A negative antigen test may need repeat testing because antigen tests are less sensitive than NAAT/PCR.';
    $('cbcReason').textContent='CBC counts white cells, red cells, hemoglobin and platelets. It may show infection-, inflammation-, anemia- or blood-related changes, but it cannot tell you that SARS-CoV-2 is present.';
    $('cmpReason').textContent='CMP measures glucose, electrolytes, kidney function, liver-associated markers and proteins. It can show dehydration, metabolic disturbance, or organ involvement, but it is not a COVID diagnostic test.';
  }else{
    card.dataset.kind='stable';
    $('testingUrgency').textContent='NO TEST TRIGGERED';
    $('nextTestName').textContent='Continue monitoring';
    $('nextTestWindow').textContent='No new test now';
    $('nextTestReason').textContent=`Only ${bad.length} measurement${bad.length===1?' is':'s are'} currently outside the configured ranges. That is not enough for this prototype to recommend a new test.`;
    $('targetedReason').textContent='No condition-specific test is suggested from the current wearable pattern.';
    $('cbcReason').textContent='CBC becomes more useful when the pattern is broad enough to raise concern for infection, inflammation, anemia, or another systemic problem.';
    $('cmpReason').textContent='CMP becomes more useful when the pattern suggests a broader metabolic or organ-level change.';
  }

  const a=analog();
  if(alert){
    const match=a?.similarity?` The closest published match currently scores ${Math.round(a.similarity)}% on the PulseLab similarity scale.`:'';
    $('testNetworkNote').innerHTML=`<strong>Published comparisons:</strong> nearby cases include COVID-19, Lyme disease and other inflammatory illness; acute stress also overlaps.${match} Similarity helps choose what to investigate next; it is not a diagnosis.`;
  }else{
    $('testNetworkNote').innerHTML='<strong>Published comparisons:</strong> the Population page shows illness and stress cases for context, but the current wearable pattern is not broad enough to trigger testing.';
  }
}

document.addEventListener('input',()=>setTimeout(render,80));
window.addEventListener('pulselab:history-imported',render);
window.addEventListener('pulselab:analog-recommendation',render);
window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='testing')render();});
build();render();
