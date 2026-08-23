const $=id=>document.getElementById(id);
window.PULSELAB_SYNTHETIC_LIVE=true;

const LIVE={
  resting_hr:79,
  hrv:24,
  sleep_hours:4.7,
  steps:2600,
  temperature_c:34.65,
  spo2:92.8,
  respiratory_rate:20.8
};
const state={points:[],hr:82,velocity:0,phase:0};

function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function seedInputs(){
  for(const [key,value] of Object.entries(LIVE)){
    const el=$(`c_${key}`); if(el) el.value=String(value);
  }
  const p=$('persistence'); if(p) p.value='5';
  document.dispatchEvent(new Event('input',{bubbles:true}));
}
function makePoint(){
  state.phase+=.18;
  state.velocity=state.velocity*.72+(Math.random()-.5)*1.1;
  const pull=(82-state.hr)*.09;
  const wave=Math.sin(state.phase)*1.6;
  state.hr=clamp(state.hr+state.velocity*.35+pull+wave*.12+(Math.random()<.035?Math.random()*4:0),72,103);
  state.points.push(state.hr);
  if(state.points.length>72)state.points.shift();
}
function pathFor(points,w,h,pad=9){
  if(!points.length)return'';
  const min=Math.min(...points)-4,max=Math.max(...points)+4,range=Math.max(1,max-min);
  return points.map((v,i)=>{
    const x=pad+(i/Math.max(1,points.length-1))*(w-pad*2);
    const y=pad+(1-(v-min)/range)*(h-pad*2);
    return`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
function render(){
  if(!$('hrTrace'))return;
  const path=pathFor(state.points,700,160);
  $('hrTrace').setAttribute('d',path);
  $('hrArea')?.setAttribute('d',path?`${path} L691,151 L9,151 Z`:'');
  $('hrNow').textContent=String(Math.round(state.hr));
  $('hrRange').textContent=`${Math.round(Math.min(...state.points))}–${Math.round(Math.max(...state.points))} bpm`;
  $('telemetrySource').textContent='SIMULATED LIVE';
  $('telemetryClock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  $('telemetryHrv').textContent=`${Math.round(LIVE.hrv+(Math.random()-.5)*1.6)} ms`;
  $('telemetryResp').textContent=`${(LIVE.respiratory_rate+(Math.random()-.5)*.3).toFixed(1)} /min`;
  $('telemetrySpo2').textContent=`${(LIVE.spo2+(Math.random()-.5)*.25).toFixed(1)}%`;
  $('telemetryTemp').textContent=`${(LIVE.temperature_c+(Math.random()-.5)*.04).toFixed(2)} °C`;
}
function boot(){
  seedInputs();
  state.hr=82;
  for(let i=0;i<72;i++){state.hr=clamp(82+Math.sin(i/6)*2.4+(Math.random()-.5)*3,72,103);state.points.push(state.hr);}
  render();
  setInterval(()=>{makePoint();render();},850);
}
setTimeout(boot,0);
