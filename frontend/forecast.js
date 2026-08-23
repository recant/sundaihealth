const $=id=>document.getElementById(id);
const PROFILE_KEY='pulselab-personal-profile-v1';

function num(id){const el=$(id);if(!el||el.value==='')return null;const n=Number(el.value);return Number.isFinite(n)?n:null;}
function pct(cur,base){return Number.isFinite(cur)&&Number.isFinite(base)&&Math.abs(base)>1e-9?(cur-base)/Math.abs(base):null;}
function profile(){try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')||{};}catch(_){return{};}}
function changeRows(){
  const rows=[];
  const add=(label,key,type='pct',bad)=>{const b=num(`b_${key}`),c=num(`c_${key}`);if(!Number.isFinite(b)||!Number.isFinite(c))return;let d=type==='delta'?c-b:pct(c,b);if(bad(d))rows.push({label,d,type});};
  add('Resting heart rate','resting_hr','pct',d=>d>.10);
  add('HRV','hrv','pct',d=>d<-.20);
  add('Sleep','sleep_hours','pct',d=>d<-.18);
  add('Skin temperature','temperature_c','delta',d=>d>.4);
  add('Blood oxygen','spo2','delta',d=>d<-1.5);
  add('Breathing rate','respiratory_rate','pct',d=>d>.15);
  return rows;
}
function format(r){
  if(r.type==='delta') return `${r.d>=0?'+':''}${r.d.toFixed(1)}${r.label==='Blood oxygen'?' points':' °C'}`;
  return `${r.d>=0?'+':''}${Math.round(r.d*100)}%`;
}
function build(){
  const target=$('testingContent'); if(!target||$('testingClean'))return;
  target.innerHTML=`<div id="testingClean" class="testing-clean">
    <section class="card testing-action-card">
      <div id="testingUrgency" class="testing-urgency">WAITING FOR HISTORY</div>
      <h2 id="nextTestName">Upload your WHOOP history first.</h2>
      <div id="nextTestWindow" class="testing-window"></div>
      <p id="nextTestReason">PulseLab needs your normal baseline before it can tell whether the live stream is unusual.</p>
      <div id="testingChanges" class="testing-changes"></div>
      <div id="testingPanels" class="testing-panels"></div>
      <div class="testing-actions"><button type="button" data-go-tab="population">See similar people</button></div>
    </section>
  </div>`;
}
function render(){
  build();
  const p=profile();
  const days=Object.keys(p.wearable_days||{}).length;
  const changes=changeRows();
  const alert=days>=7&&changes.length>=3;
  if(days<7){
    $('testingUrgency').textContent='NEED YOUR BASELINE';
    $('nextTestName').textContent='Upload your WHOOP history first.';
    $('nextTestWindow').textContent='';
    $('nextTestReason').textContent='Use the CSV on Live Data.';
    $('testingChanges').innerHTML='';
    $('testingPanels').innerHTML='';
    return;
  }
  if(alert){
    $('testingUrgency').textContent='TEST WITHIN 72 HOURS';
    $('nextTestName').textContent='Get a CBC + CMP.';
    $('nextTestWindow').textContent='Several signals are off your normal at the same time.';
    $('nextTestReason').textContent='A watch can tell you that something changed. These tests add blood-cell and chemistry data the watch cannot see.';
    $('testingChanges').innerHTML=changes.slice(0,5).map(r=>`<div><span>${r.label}</span><strong>${format(r)}</strong></div>`).join('');
    $('testingPanels').innerHTML=`<div><strong>CBC</strong><span>Blood cells</span></div><div><strong>CMP</strong><span>Electrolytes, kidney/liver markers, glucose</span></div>`;
  }else{
    $('testingUrgency').textContent='NO URGENT TEST';
    $('nextTestName').textContent='Keep watching.';
    $('nextTestWindow').textContent='The live stream is still close to your normal.';
    $('nextTestReason').textContent='';
    $('testingChanges').innerHTML='';
    $('testingPanels').innerHTML='';
  }
}
document.addEventListener('input',()=>setTimeout(render,80));
window.addEventListener('pulselab:history-imported',render);
window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='testing')render();});
build();render();
