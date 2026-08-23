const DEMO={
  b_resting_hr:58,c_resting_hr:78,
  b_hrv:56,c_hrv:25,
  b_sleep_hours:7.5,c_sleep_hours:4.6,
  b_steps:9200,c_steps:2100,
  b_temperature_c:36.5,c_temperature_c:37.7,
  b_spo2:98,c_spo2:93,
  b_respiratory_rate:14,c_respiratory_rate:21,
  persistence:'5',lastBlood:'240',age:'32',sex:'male'
};

function applyAlarmingDemo(){
  for(const [id,value] of Object.entries(DEMO)){
    const el=document.getElementById(id);
    if(el)el.value=String(value);
  }
  document.dispatchEvent(new Event('input',{bubbles:true}));
  document.dispatchEvent(new Event('change',{bubbles:true}));
}

document.addEventListener('click',event=>{
  if(event.target?.id==='sampleBtn') setTimeout(applyAlarmingDemo,40);
});
