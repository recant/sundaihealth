const $=id=>document.getElementById(id);
const STORAGE_KEY='pulselab-personal-profile-v1';
let selectedMetric='resting_hr';
let selectedDate=null;

const METRICS={
  resting_hr:{label:'Resting heart rate',short:'RHR',unit:'bpm',dec:0},
  hrv:{label:'HRV',short:'HRV',unit:'ms',dec:0},
  sleep_hours:{label:'Sleep',short:'Sleep',unit:'h',dec:1},
  temperature_c:{label:'Skin temperature',short:'Temp',unit:'°C',dec:2},
  spo2:{label:'Blood oxygen',short:'SpO₂',unit:'%',dec:1},
  respiratory_rate:{label:'Breathing rate',short:'Breathing',unit:'/min',dec:1}
};
function profile(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')||{};}catch(_){return{};}}
function entries(){return Object.entries(profile().wearable_days||{}).filter(([,r])=>r&&typeof r==='object').sort(([a],[b])=>a.localeCompare(b));}
function fmtDate(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString([],{month:'short',day:'numeric'});}
function fmt(metric,v){const m=METRICS[metric];if(!Number.isFinite(Number(v)))return'—';return `${Number(v).toFixed(m.dec)}${m.unit?` ${m.unit}`:''}`;}
function build(){
  const target=$('measurementsContent');if(!target||$('measurementsShell'))return;
  target.innerHTML=`<div id="measurementsShell" class="measurements-shell">
    <section id="measurementsEmpty" class="card measurements-empty-state"><h2>No history yet.</h2><p>Upload your WHOOP CSV on Live Data.</p><button data-go-tab="live" type="button">Upload CSV</button></section>
    <div id="measurementsLoaded" class="hidden">
      <div id="measurementSummary" class="measurement-summary"></div>
      <div class="measurement-main">
        <section class="card measurement-chart-card">
          <div id="metricPicker" class="metric-picker"></div>
          <div class="measurement-chart-wrap"><svg id="measurementChart" class="measurement-chart" viewBox="0 0 760 270" preserveAspectRatio="none"></svg></div>
          <div id="measurementRange" class="measurement-chart-caption"></div>
        </section>
        <section class="card measurement-detail-card">
          <div class="eyebrow">Selected day</div><h2 id="measurementDetailTitle">—</h2>
          <div id="measurementSelected" class="measurement-selected"></div>
          <div id="measurementMiniGrid" class="measurement-mini-grid"></div>
        </section>
      </div>
      <section class="card"><div class="eyebrow">Recent days</div><div id="measurementTable"></div></section>
    </div>
  </div>`;
  $('metricPicker').innerHTML=Object.entries(METRICS).map(([k,m])=>`<button type="button" class="metric-chip" data-metric="${k}">${m.short}</button>`).join('');
  $('metricPicker').addEventListener('click',e=>{const b=e.target.closest('[data-metric]');if(!b)return;selectedMetric=b.dataset.metric;selectedDate=null;render();});
}
function trend(metric,data){
  const vals=data.filter(([,r])=>Number.isFinite(Number(r?.[metric]))).map(([,r])=>Number(r[metric]));
  if(vals.length<14)return null;
  const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
  return avg(vals.slice(-7))-avg(vals.slice(-21,-7));
}
function renderSummary(data){
  const picks=['resting_hr','hrv','sleep_hours','spo2'];
  $('measurementSummary').innerHTML=picks.map(k=>{
    const latest=[...data].reverse().find(([,r])=>Number.isFinite(Number(r?.[k])));
    const d=trend(k,data), sign=d==null?'':`${d>=0?'+':''}${d.toFixed(METRICS[k].dec)} ${METRICS[k].unit}`;
    return `<div class="measurement-summary-card"><span>${METRICS[k].label}</span><strong>${latest?fmt(k,latest[1][k]):'—'}</strong><small>${sign||'—'} vs earlier</small></div>`;
  }).join('');
}
function renderChart(data){
  const series=data.map(([date,r])=>({date,value:Number(r?.[selectedMetric])})).filter(x=>Number.isFinite(x.value)).slice(-90);
  document.querySelectorAll('.metric-chip').forEach(b=>b.classList.toggle('active',b.dataset.metric===selectedMetric));
  const svg=$('measurementChart');
  if(!series.length){svg.innerHTML='<text x="380" y="135" text-anchor="middle">No data</text>';return;}
  if(!selectedDate||!series.some(x=>x.date===selectedDate))selectedDate=series.at(-1).date;
  const W=760,H=270,p={l:45,r:15,t:18,b:28},vals=series.map(x=>x.value);
  const rawMin=Math.min(...vals),rawMax=Math.max(...vals),span=Math.max(rawMax-rawMin,1);
  const min=rawMin-span*.15,max=rawMax+span*.15;
  const x=i=>p.l+(W-p.l-p.r)*(series.length===1?.5:i/(series.length-1));
  const y=v=>p.t+(H-p.t-p.b)*(1-(v-min)/(max-min));
  const line=series.map((d,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const grid=[0,.25,.5,.75,1].map(f=>{const yy=p.t+(H-p.t-p.b)*f;return `<line class="measurement-grid" x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}"></line>`;}).join('');
  const points=series.map((d,i)=>`<circle class="measurement-point${d.date===selectedDate?' selected':''}" data-date="${d.date}" cx="${x(i)}" cy="${y(d.value)}" r="${d.date===selectedDate?5.5:3.5}"><title>${fmtDate(d.date)}: ${fmt(selectedMetric,d.value)}</title></circle>`).join('');
  svg.innerHTML=`${grid}<path class="measurement-line" d="${line}"></path>${points}`;
  svg.querySelectorAll('[data-date]').forEach(pt=>pt.addEventListener('click',()=>{selectedDate=pt.dataset.date;render();}));
  $('measurementRange').textContent=`${METRICS[selectedMetric].label} · ${fmtDate(series[0].date)}–${fmtDate(series.at(-1).date)}`;
}
function renderDetail(data){
  const pair=data.find(([d])=>d===selectedDate)||data.at(-1);if(!pair)return;
  const [date,r]=pair;
  $('measurementDetailTitle').textContent=fmtDate(date);
  $('measurementSelected').innerHTML=`<strong>${fmt(selectedMetric,r[selectedMetric])}</strong>`;
  $('measurementMiniGrid').innerHTML=['resting_hr','hrv','sleep_hours','spo2'].filter(k=>k!==selectedMetric).slice(0,3).map(k=>`<div class="measurement-mini"><span>${METRICS[k].short}</span><strong>${fmt(k,r[k])}</strong></div>`).join('');
}
function renderTable(data){
  $('measurementTable').innerHTML=`<table class="history-table"><thead><tr><th>Date</th><th>RHR</th><th>HRV</th><th>Sleep</th><th>SpO₂</th></tr></thead><tbody>${data.slice(-14).reverse().map(([d,r])=>`<tr><td>${fmtDate(d)}</td><td>${fmt('resting_hr',r.resting_hr)}</td><td>${fmt('hrv',r.hrv)}</td><td>${fmt('sleep_hours',r.sleep_hours)}</td><td>${fmt('spo2',r.spo2)}</td></tr>`).join('')}</tbody></table>`;
}
function render(){
  build();const data=entries();
  $('measurementsEmpty').classList.toggle('hidden',data.length>0);
  $('measurementsLoaded').classList.toggle('hidden',!data.length);
  if(!data.length)return;
  renderSummary(data);renderChart(data);renderDetail(data);renderTable(data);
}
window.addEventListener('pulselab:history-imported',render);
window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='measurements')render();});
build();render();
