const $=id=>document.getElementById(id);
let busy=false;
const history=[];

function ensureStyles(){
  if(document.querySelector('link[data-pulselab-chat]'))return;
  const link=document.createElement('link');
  link.rel='stylesheet';link.href='./chat.css';link.dataset.pulselabChat='1';
  document.head.appendChild(link);
}
function text(id){return $(id)?.textContent?.trim()||'';}
function metric(key){const el=$(`c_${key}`);const n=Number(el?.value);return el&&el.value!==''&&Number.isFinite(n)?n:null;}
function list(selector,max=6){return [...document.querySelectorAll(selector)].map(x=>x.textContent.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,max);}
function snapshot(){
  return {
    testing_plan:{
      next_test:text('nextTestName'),timing:text('nextTestWindow'),status:text('testingUrgency'),reason:text('nextTestReason'),
      drivers:list('#testingChanges .test-change',6),possible_causes:list('#possibleCauses > div',4),
      cbc_reason:text('cbcReason'),cmp_reason:text('cmpReason'),timing_reason:text('whyNow')
    },
    live:{headline:text('liveAlertTitle'),summary:text('liveAlertBody'),changes:list('#liveAlertMetrics > div',6)},
    population:{
      nearest_people:list('#participantNetwork .network-node',5),
      selected_name:document.querySelector('#simpleCaseDetail .detail-head h2')?.textContent?.trim()||null,
      selected_kind:document.querySelector('#simpleCaseDetail .detail-kind')?.textContent?.trim()||null,
      selected_outcome:document.querySelector('#simpleCaseDetail .detail-outcome strong')?.textContent?.trim()||null,
      selected_summary:document.querySelector('#simpleCaseDetail .detail-summary')?.textContent?.trim()||null,
      selected_rationale:document.querySelector('#simpleCaseDetail .detail-rationale p')?.textContent?.trim()||null,
      selected_source:document.querySelector('#simpleCaseDetail .detail-source')?.textContent?.replace(/\s+/g,' ').trim()||null
    },
    current_metrics:{resting_hr:metric('resting_hr'),hrv:metric('hrv'),sleep_hours:metric('sleep_hours'),temperature_c:metric('temperature_c'),spo2:metric('spo2'),respiratory_rate:metric('respiratory_rate')},
    data_provenance:'Historical baseline: uploaded WHOOP CSV. Current live stream: simulated. Published participant outcomes: source studies. Similarity scores and network positions: PulseLab demo calculations, not disease probabilities.'
  };
}
function fallback(message,s=snapshot()){
  const q=message.toLowerCase(),plan=s.testing_plan?.next_test,timing=s.testing_plan?.timing;
  if(/square root of 4/.test(q))return'The square root of 4 is 2.';
  if(/chest pain|severe trouble breathing|can't breathe|cannot breathe|faint|confusion|one-sided weakness|severe bleeding/.test(q))return'Seek urgent medical evaluation for those symptoms rather than relying on PulseLab.';
  if(/what.*could|disease|condition|sick|infection|lyme|covid|diagnos/.test(q)){
    return `The pattern is most consistent with a broad infection/inflammation signal, but it is not specific. The published comparison set includes COVID-19, Lyme disease and other inflammatory illnesses, while acute stress can produce some of the same wearable changes. ${plan?`That is why PulseLab recommends ${plan}${timing?` ${timing.toLowerCase()}`:''}: the next step is to add blood measurements rather than guess the disease from the wearable pattern.`:''}`.trim();
  }
  if(/similar|people|patient|population|network|match/.test(q)){
    if(s.population.selected_name)return `The selected comparison is ${s.population.selected_name}${s.population.selected_kind?` (${s.population.selected_kind})`:''}. ${s.population.selected_rationale||''} In the study, ${s.population.selected_outcome||'the participant had a documented event'}. The match does not mean you have the same disease; it shows why that case is useful as a comparison.`.replace(/\s+/g,' ').trim();
    return 'The Population page ranks published participants by shared wearable changes. The match percentage is a similarity score, not a disease probability.';
  }
  if(/test|cbc|cmp|what should|do next/.test(q)){
    if(!plan)return'Upload enough WHOOP history to establish a personal baseline first.';
    return `${plan}${timing?` ${timing.toLowerCase()}`:''}. ${s.testing_plan.reason||''} CBC checks blood-cell changes; CMP checks chemistry, kidney and liver markers. Together they add information the wearable does not contain.`.replace(/\s+/g,' ').trim();
  }
  if(/change|wrong|off|baseline|why/.test(q)){
    const changes=s.live.changes?.length?s.live.changes.join('; '):'';
    return `${s.live.headline||''} ${changes?`The main changes are ${changes}.`:s.live.summary||''} ${plan?`Because several measurements changed together, PulseLab recommends ${plan}.`:''}`.replace(/\s+/g,' ').trim();
  }
  return `${s.live.headline||''} ${s.live.summary||''} ${plan?`Current recommendation: ${plan}${timing?` ${timing.toLowerCase()}`:''}.`:''}`.replace(/\s+/g,' ').trim();
}
function build(){
  const target=$('assistantContent');if(!target||$('pulseChat'))return;
  target.innerHTML=`<section id="pulseChat" class="card chat-card">
    <div class="chat-header"><div><div class="eyebrow">Ask PulseLab</div><h2>Explain the current result</h2></div></div>
    <div id="chatSuggestions" class="chat-suggestions">
      <button type="button" data-q="What could this pattern be?">What could this be?</button>
      <button type="button" data-q="Why are you recommending a CBC and CMP?">Why CBC + CMP?</button>
      <button type="button" data-q="Who is the closest published participant and what happened to them?">Closest study case</button>
    </div>
    <div id="chatMessages" class="chat-messages"><div class="chat-row assistant"><div class="chat-avatar">P</div><div class="chat-bubble">I can explain the likely categories, the testing recommendation, and the published cases used for comparison.</div></div></div>
    <form id="chatForm" class="chat-form"><textarea id="chatInput" rows="2" maxlength="1800" placeholder="Ask about this result…"></textarea><button id="chatSend" type="submit">Send</button></form>
    <div class="chat-foot"><span id="chatMode">Uses the current dashboard</span></div>
  </section>`;
  target.querySelectorAll('[data-q]').forEach(b=>b.addEventListener('click',()=>send(b.dataset.q)));
  $('chatForm').addEventListener('submit',e=>{e.preventDefault();const q=$('chatInput').value.trim();if(q)send(q);});
  $('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const q=$('chatInput').value.trim();if(q)send(q);}});
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
    $('chatMode').textContent=data.mode==='gemini'?'AI · current dashboard':'Local dashboard explanation';
  }catch(_){pending.textContent=fallback(message);}
  finally{busy=false;$('chatSend').disabled=false;$('chatInput').focus();}
}
ensureStyles();build();
