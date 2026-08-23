const $=id=>document.getElementById(id);
let busy=false;
const history=[];

function text(id){return $(id)?.textContent?.trim()||'';}
function metric(key){const el=$(`c_${key}`);const n=Number(el?.value);return el&&el.value!==''&&Number.isFinite(n)?n:null;}
function list(selector,max=4){return [...document.querySelectorAll(selector)].map(x=>x.textContent.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,max);}
function snapshot(){
  return {
    testing_plan:{next_test:text('nextTestName'),window:text('testingUrgency'),reason:text('nextTestReason')},
    live:{headline:text('liveAlertTitle'),summary:text('liveAlertBody'),changes:list('#liveAlertMetrics > div',5)},
    population:{
      nearest_people:list('#participantNetwork .network-node',4),
      selected_name:document.querySelector('#simpleCaseDetail .simple-detail-head h2')?.textContent?.trim()||null,
      selected_outcome:document.querySelector('#simpleCaseDetail .simple-outcome strong')?.textContent?.trim()||null,
      selected_summary:document.querySelector('#simpleCaseDetail .simple-case-warning span')?.textContent?.trim()||null
    },
    current_metrics:{
      resting_hr:metric('resting_hr'),hrv:metric('hrv'),sleep_hours:metric('sleep_hours'),
      temperature_c:metric('temperature_c'),spo2:metric('spo2'),respiratory_rate:metric('respiratory_rate')
    },
    note:'The live stream is simulated. WHOOP history is user-uploaded. Population participant outcomes are from cited studies; match distance is PulseLab demo math.'
  };
}
function fallback(message,s=snapshot()){
  const q=message.toLowerCase(), plan=s.testing_plan?.next_test;
  if(/square root of 4/.test(q))return'The square root of 4 is 2.';
  if(/similar|people|patient|population|network/.test(q)){
    if(s.population.selected_name)return `You're closest to ${s.population.selected_name} right now. ${s.population.selected_outcome||''} That does not mean you have the same condition, but your pattern is abnormal enough that PulseLab says: ${plan||'get checked'}.`;
    return `Your pattern is close to several real study participants. ${plan?`PulseLab says: ${plan}`:''}`;
  }
  if(/test|cbc|cmp|what should|do next/.test(q))return plan?`Yes. ${plan} ${s.testing_plan.reason||''}`:'Upload your WHOOP history first so PulseLab can learn your baseline.';
  if(/change|wrong|off|baseline|why/.test(q))return s.live.changes?.length?`Several things moved at once: ${s.live.changes.join('; ')}. ${plan?`That is why PulseLab says: ${plan}`:''}`:s.live.summary;
  return plan?`${plan} ${s.live.summary||''}`:(s.live.summary||'Upload your WHOOP history first.');
}
function build(){
  const target=$('assistantContent');if(!target||$('pulseChat'))return;
  target.innerHTML=`<section id="pulseChat" class="card chat-card">
    <div class="chat-header"><div><div class="eyebrow">Ask PulseLab</div><h2>What do you want to know?</h2></div></div>
    <div id="chatSuggestions" class="chat-suggestions">
      <button type="button" data-q="What changed?">What changed?</button>
      <button type="button" data-q="Why do I need a CBC and CMP?">Why this test?</button>
      <button type="button" data-q="Who am I most similar to and what happened to them?">Who am I like?</button>
    </div>
    <div id="chatMessages" class="chat-messages"><div class="chat-row assistant"><div class="chat-avatar">P</div><div class="chat-bubble">Ask me about today's signal.</div></div></div>
    <form id="chatForm" class="chat-form"><textarea id="chatInput" rows="2" maxlength="1800" placeholder="Ask a question…"></textarea><button id="chatSend" type="submit">Send</button></form>
    <div class="chat-foot"><span id="chatMode">Plain-English explanation</span></div>
  </section>`;
  document.querySelectorAll('[data-q]').forEach(b=>b.addEventListener('click',()=>send(b.dataset.q)));
  $('chatForm').addEventListener('submit',e=>{e.preventDefault();const q=$('chatInput').value.trim();if(q)send(q);});
}
function append(role,msg){
  const row=document.createElement('div');row.className=`chat-row ${role}`;
  if(role==='assistant'){const a=document.createElement('div');a.className='chat-avatar';a.textContent='P';row.appendChild(a);}
  const b=document.createElement('div');b.className='chat-bubble';b.textContent=msg;row.appendChild(b);$('chatMessages').appendChild(row);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;return b;
}
async function send(message){
  if(busy||!message)return;busy=true;$('chatSend').disabled=true;
  append('user',message);$('chatInput').value='';const pending=append('assistant','…');
  try{
    const s=snapshot();
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,snapshot:s,history:history.slice(-6)})});
    const data=await r.json().catch(()=>({}));
    const reply=String(data.reply||fallback(message,s)).trim();
    pending.textContent=reply;history.push({role:'user',text:message},{role:'assistant',text:reply});
    $('chatMode').textContent=data.mode==='gemini'?'AI · reads this screen':'Local explanation';
  }catch(_){pending.textContent=fallback(message);}
  finally{busy=false;$('chatSend').disabled=false;$('chatInput').focus();}
}
build();
