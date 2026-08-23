const $=id=>document.getElementById(id);
const STORAGE_KEY='pulselab-personal-profile-v1';
let selectedMetric='resting_hr';
let selectedDate=null;

const METRICS={
  resting_hr:{label:'Resting heart rate',short:'RHR',unit:'bpm',dec:0,threshold:.10,type:'pct',bad:1},
  hrv:{label:'Heart-rate variability',short:'HRV',unit:'ms',dec:0,threshold:.20,type:'pct',bad:-1},
  sleep_hours:{label:'Sleep duration',short:'Sleep',unit:'h',dec:1,threshold:.18,type:'pct',bad:-1},
  temperature_c:{label:'Skin temperature',short:'Temp',unit:'°C',dec:2,threshold:.40,type:'delta',bad:1},
  spo2:{label:'Blood oxygen',short:'SpO₂',unit:'%',dec:1,threshold:1.5,type:'delta',bad:-1},
  respiratory_rate:{label:'Breathing rate',short:'Breathing',unit:'/min',dec:1,threshold:.15,type:'pct',bad:1}
};
function profile(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')||{};}catch(_){return{};}}
function entries(){return Object.entries(profile().wearable_days||{}).filter(([,r])=>r&&typeof r==='object').sort(([a],[b])=>a.localeCompare(b));}
function fmtDate(key,long=false){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString([],long?{month:'long',day:'numeric',year:'numeric'}:{month:'short',day:'numeric'});}
function fmt(metric,v){const m=METRICS[metric];if(!Number.isFinite(Number(v)))return'—';return `${Number(v).toFixed(m.dec)}${m.unit?` ${m.unit}`:''}`;}
function avg(xs){return xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;}
function values(metric,data){return data.filter(([,r])=>Number.isFinite(Number(r?.[metric]))).map(([date,r])=>({date,value:Number(r[metric])}));}
function comparison(metric,data){
  const vals=values(metric,data);if(vals.length<10)return null;
  const recent=vals.slice(-7),prior=vals.slice(Math.max(0,vals.length-37),Math.max(0,vals.length-7));
  if(!prior.length)return null;
  const base=avg(prior.map(x=>x.value)),current=avg(recent.map(x=>x.value));
  const meta=METRICS[metric],delta=current-base;
  const change=meta.type==='pct'&&Math.abs(base)>1e-9?delta/Math.abs(base):delta;
  const concern=(meta.bad===1?change:-change)/meta.threshold;
  return{base,current,delta,change,concern,recentDays:recent.length,priorDays:prior.length};
}
function changeText(metric,c){
  if(!c)return'Not enough history';const m=METRICS[metric];
  if(m.type==='pct')return`${c.change>=0?'+':''}${Math.round(c.change*100)}%`;
  return`${c.change>=0?'+':''}${c.change.toFixed(m.dec)} ${m.unit}`;
}
function baselineBefore(metric,data,date){
  const prior=values(metric,data).filter(x=>x.date<date).slice(-30).map(x=>x.value);
  return avg(prior);
}
function build(){
  const target=$('measurementsContent');if(!target||$('measurementsShell'))return;
  target.innerHTML=`<div id="measurementsShell" class="measurements-shell">
    <section id="measurementsEmpty" class="card measurements-empty-state"><h2>No WHOOP history has been imported.</h2><p>Upload <code>physiological_cycles.csv</code> on Live Data. This page does not generate synthetic historical measurements.</p><button data-go-tab="live" type="button">Go to Live Data</button></section>
    <div id="measurementsLoaded" class="hidden">
      <div id="measurementSummary" class="measurement-summary"></div>
      <section class="card measurement-insight-card">
        <div><div class="eyebrow">Recent trend</div><h2 id="measurementInsightTitle">Comparing the last 7 days with the prior baseline…</h2><p id="measurementInsightBody"></p></div>
        <div id="measurementInsightStats" class="measurement-insight-stats"></div>
      </section>
      <div class="measurement-main">
        <section class="card measurement-chart-card">
          <div class="chart-section-head"><div><div class="eyebrow">Imported WHOOP history</div><h2 id="measurementChartTitle">Resting heart rate over time</h2></div><div id="metricPicker" class="metric-picker"></div></div>
          <div class="measurement-chart-wrap"><svg id="measurementChart" class="measurement-chart" viewBox="0 0 760 270" preserveAspectRatio="none" role="img" aria-label="Imported WHOOP measurement history"></svg></div>
          <div id="measurementRange" class="measurement-chart-caption"></div>
        </section>
        <section class="card measurement-detail-card">
          <div class="eyebrow">Selected day</div><h2 id="measurementDetailTitle">—</h2>
          <div id="measurementSelected" class="measurement-selected"></div>
          <div id="measurementMiniGrid" class="measurement-mini-grid"></div>
          <div id="measurementSourceNote" class="measurement-source-note">All values on this page come from the CSV you imported. The simulated live stream is not written into this history.</div>
        </section>
      </div>
      <section class="card"><div class="eyebrow">Recent daily measurements</div><h2>Latest 14 imported days</h2><div id="measurementTable"></div></section>
    </div>
  </div>`;
  $('metricPicker').innerHTML=Object.entries(METRICS).map(([k,m])=>`<button type="button" class="metric-chip" data-metric="${k}">${m.short}</button>`).join('');
  $('metricPicker').addEventListener('click',e=>{const b=e.target.closest('[data-metric]');if(!b)return;selectedMetric=b.dataset.metric;selectedDate=null;render();});
}
function renderSummary(data){
  const picks=['resting_hr','hrv','spo2','respiratory_rate'];
  $('measurementSummary').innerHTML=picks.map(k=>{
    const latest=[...data].reverse().find(([,r])=>Number.isFinite(Number(r?.[k])));
    const c=comparison(k,data),change=c?changeText(k,c):'—';
    return `<div class="measurement-summary-card"><span>${METRICS[k].label}</span><strong>${latest?fmt(k,latest[1][k]):'—'}</strong><small>${change} · recent 7-day average vs prior baseline</small></div>`;
  }).join('');
}
function renderInsight(data){
  const comps=Object.keys(METRICS).map(k=>({key:k,c:comparison(k,data)})).filter(x=>x.c).sort((a,b)=>b.c.concern-a.c.concern);
  if(!comps.length){$('measurementInsightTitle').textContent='More history is needed for a trend comparison.';$('measurementInsightBody').textContent='PulseLab compares the recent seven-day average with the preceding baseline window once enough imported measurements are available.';$('measurementInsightStats').innerHTML='';return;}
  const worst=comps[0],bad=comps.filter(x=>x.c.concern>=1);
  if(bad.length>=2){
    $('measurementInsightTitle').textContent='The final days are moving away from the earlier baseline.';
    $('measurementInsightBody').textContent=`The recent seven-day averages show coordinated movement across ${bad.length} measurements. The largest relative change is ${METRICS[worst.key].label.toLowerCase()} (${changeText(worst.key,worst.c)} versus the preceding baseline window). This is the historical trend that makes the abnormal live stream more credible than a one-off reading.`;
  }else{
    $('measurementInsightTitle').textContent='Most recent measurements remain close to the earlier baseline.';
    $('measurementInsightBody').textContent=`The strongest recent change is ${METRICS[worst.key].label.toLowerCase()} (${changeText(worst.key,worst.c)}), but the imported history does not yet show a broad multi-signal departure from the earlier baseline.`;
  }
  $('measurementInsightStats').innerHTML=comps.slice(0,3).map(({key,c})=>`<div><span>${METRICS[key].label}</span><strong>${changeText(key,c)}</strong><small>${fmt(key,c.base)} baseline → ${fmt(key,c.current)} recent avg</small></div>`).join('');
}
function renderChart(data){
  const series=values(selectedMetric,data).slice(-90);
  document.querySelectorAll('.metric-chip').forEach(b=>b.classList.toggle('active',b.dataset.metric===selectedMetric));
  $('measurementChartTitle').textContent=`${METRICS[selectedMetric].label} over time`;
  const svg=$('measurementChart');
  if(!series.length){svg.innerHTML='<text x="380" y="135" text-anchor="middle">No imported data for this measurement</text>';return;}
  if(!selectedDate||!series.some(x=>x.date===selectedDate))selectedDate=series.at(-1).date;
  const W=760,H=270,p={l:45,r:15,t:18,b:28},vals=series.map(x=>x.value);
  const rawMin=Math.min(...vals),rawMax=Math.max(...vals),span=Math.max(rawMax-rawMin,Math.abs(rawMax)*.02,1e-3);
  const min=rawMin-span*.15,max=rawMax+span*.15;
  const x=i=>p.l+(W-p.l-p.r)*(series.length===1?.5:i/(series.length-1));
  const y=v=>p.t+(H-p.t-p.b)*(1-(v-min)/(max-min));
  const line=series.map((d,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area=`${line} L${x(series.length-1)},${H-p.b} L${x(0)},${H-p.b} Z`;
  const grid=[0,.25,.5,.75,1].map(f=>{const yy=p.t+(H-p.t-p.b)*f;return `<line class="measurement-grid" x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}"></line>`;}).join('');
  const points=series.map((d,i)=>`<circle class="measurement-point${d.date===selectedDate?' selected':''}" data-date="${d.date}" cx="${x(i)}" cy="${y(d.value)}" r="${d.date===selectedDate?5.5:3.5}"><title>${fmtDate(d.date,true)}: ${fmt(selectedMetric,d.value)}</title></circle>`).join('');
  svg.innerHTML=`${grid}<path class="measurement-area" d="${area}"></path><path class="measurement-line" d="${line}"></path>${points}`;
  svg.querySelectorAll('[data-date]').forEach(pt=>pt.addEventListener('click',()=>{selectedDate=pt.dataset.date;render();}));
  const c=comparison(selectedMetric,data);
  $('measurementRange').innerHTML=`<span>${fmtDate(series[0].date)}–${fmtDate(series.at(-1).date)} · ${series.length} imported days</span><span>${c?`${changeText(selectedMetric,c)} recent 7-day average vs prior baseline`:'Not enough history for a baseline comparison'}</span>`;
}
function renderDetail(data){
  const pair=data.find(([d])=>d===selectedDate)||data.at(-1);if(!pair)return;
  const [date,r]=pair,baseline=baselineBefore(selectedMetric,data,date),value=Number(r[selectedMetric]);
  $('measurementDetailTitle').textContent=fmtDate(date,true);
  let comparisonCopy='No prior baseline is available for this date.';
  if(Number.isFinite(baseline)&&Number.isFinite(value)){
    const meta=METRICS[selectedMetric],delta=value-baseline;
    const change=meta.type==='pct'&&Math.abs(baseline)>1e-9?delta/Math.abs(baseline):delta;
    comparisonCopy=meta.type==='pct'?`${change>=0?'+':''}${Math.round(change*100)}% versus the preceding 30-day average.`:`${change>=0?'+':''}${change.toFixed(meta.dec)} ${meta.unit} versus the preceding 30-day average.`;
  }
  $('measurementSelected').innerHTML=`<div class="selected-date">${METRICS[selectedMetric].label}</div><strong>${fmt(selectedMetric,value)}</strong><p>${comparisonCopy}</p>`;
  $('measurementMiniGrid').innerHTML=['resting_hr','hrv','sleep_hours','spo2','respiratory_rate'].filter(k=>k!==selectedMetric).slice(0,4).map(k=>`<div class="measurement-mini"><span>${METRICS[k].short}</span><strong>${fmt(k,r[k])}</strong></div>`).join('');
}
function renderTable(data){
  $('measurementTable').innerHTML=`<table class="history-table"><thead><tr><th>Date</th><th>RHR</th><th>HRV</th><th>Sleep</th><th>SpO₂</th><th>Breathing</th></tr></thead><tbody>${data.slice(-14).reverse().map(([d,r])=>`<tr><td>${fmtDate(d)}</td><td>${fmt('resting_hr',r.resting_hr)}</td><td>${fmt('hrv',r.hrv)}</td><td>${fmt('sleep_hours',r.sleep_hours)}</td><td>${fmt('spo2',r.spo2)}</td><td>${fmt('respiratory_rate',r.respiratory_rate)}</td></tr>`).join('')}</tbody></table>`;
}
function render(){
  build();const data=entries();
  $('measurementsEmpty').classList.toggle('hidden',data.length>0);
  $('measurementsLoaded').classList.toggle('hidden',!data.length);
  if(!data.length)return;
  renderSummary(data);renderInsight(data);renderChart(data);renderDetail(data);renderTable(data);
}
window.addEventListener('pulselab:history-imported',render);
window.addEventListener('pulselab:tab',e=>{if(e.detail?.tab==='measurements')render();});
build();render();
