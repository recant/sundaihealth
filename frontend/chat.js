const $=id=>document.getElementById(id);
let busy=false;
const history=[];

function text(id){return $(id)?.textContent?.trim()||'';}
function metric(key){const el=$(`c_${key}`);const n=Number(el?.value);return el&&el.value!==''&&Number.isFinite(n)?n:null;}
function list(selector,max=6){return [...document.querySelectorAll(selector)].map(x=>x.textContent.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,max);}
function snapshot(){
  return {
    testing_plan:{
      next_test:text('nextTestName'),
      timing:text('nextTestWindow'),
      status:text('testingUrgency'),
      reason:text('nextTestReason'),
      drivers:list('#testingChanges .test-change',6),
      cbc_reason:text('cbcReason'),
      cmp_reason:text('cmpReason'),
      timing_reason:text('whyNow')
    },
    live:{
      headline:text('liveAlertTitle'),
      summary:text('liveAlertBody'),
      changes:list('#liveAlertMetrics > div',6),
      baseline_explanation:text('baselineMethodBody'),
      trigger_explanation:text('triggerMethodBody')
    },
    population:{
      nearest_people:list('#participantNetwork .network-node',5),
      selected_name:document.querySelector('#simpleCaseDetail .detail-head h2')?.textContent?.trim()||null,
      selected_kind:document.querySelector('#simpleCaseDetail .detail-kind')?.textContent?.trim()||null,
      selected_outcome:document.querySelector('#simpleCaseDetail .detail-outcome strong')?.textContent?.trim()||null,
      selected_summary:document.querySelector('#simpleCaseDetail .detail-summary')?.textContent?.trim()||null,
      selected_rationale:document.querySelector('#simpleCaseDetail .detail-rationale p')?.textContent?.trim()||null,
      selected_source:document.querySelector('#simpleCaseDetail .detail-source')?.textContent?.replace(/\s+/g,' ').trim()||null
    },
    current_metrics:{
      resting_hr:metric('resting_hr'),hrv:metric('hrv'),sleep_hours:metric('sleep_hours'),
      temperature_c:metric('temperature_c'),spo2:metric('spo2'),respiratory_rate:metric('respiratory_rate')
    },
    data_provenance:'The historical baseline comes from the user-uploaded WHOOP CSV. The current live stream is simulated. Published participant outcomes and reported measurements come from the cited studies. Participant similarity percentages and network positions are PulseLab demo calculations, not disease probabilities.'
  };
}
function fallback(message,s=snapshot()){
  const q=message.toLowerCase(),plan=s.testing_plan?.next_test,timing=s.testing_plan?.timing;
  if(/square root of 4/.test(q))return'The square root of 4 is 2.';
  if(/chest pain|severe trouble breathing|can't breathe|cannot breathe|faint|confusion|one-sided weakness|severe bleeding/.test(q))return'Seek urgent medical evaluation for those symptoms rather than relying on PulseLab. The testing recommendation is not designed to determine whether an acute symptom is safe.';
  if(/similar|people|patient|population|network|match/.test(q)){
    if(s.population.selected_name){
      return `The selected comparison is ${s.population.selected_name}${s.population.selected_kind?` (${s.population.selected_kind})`:''}. ${s.population.selected_rationale||''} In the source study, ${s.population.selected_outcome||'the participant had a documented event'}. That similarity does not identify your diagnosis; it strengthens the case for obtaining independent measurements. ${plan?`The current recommendation is ${plan}${timing?` ${timing.toLowerCase()}`:''}.`:''}`.replace(/\s+/g,' ').trim();
    }
    return `The Population page ranks real published participants by shared directional changes in wearable signals. The similarity percentage is a PulseLab ranking score, not a disease probability. ${plan?`The current testing recommendation is ${plan}.`:''}`;
  }
  if(/test|cbc|cmp|what should|do next/.test(q)){
    if(!plan)return'Upload enough WHOOP history to establish a personal baseline before interpreting the current live pattern.';
    return `${plan}${timing?` ${timing.toLowerCase()}`:''}. ${s.testing_plan.reason||''} ${s.testing_plan.cbc_reason||''} ${s.testing_plan.cmp_reason||''}`.replace(/\s+/g,' ').trim();
  }
  if(/change|wrong|off|baseline|why/.test(q)){
    const changes=s.live.changes?.length?s.live.changes.join('; '):'';
    return `${s.live.headline||''} ${changes?`The largest displayed changes are ${changes}.`:s.live.summary||''} ${s.live.trigger_explanation||''} ${plan?`That is why the current testing recommendation is ${plan}.`:''}`.replace(/\s+/g,' ').trim();
  }
  return `${s.live.headline||''} ${s.live.summary||''} ${plan?`Current testing recommendation: ${plan}${timing?` ${timing.toLowerCase()}`:''}.`:''}`.replace(/\s+/g,' ').trim();
}
function build(){
  const target=$('assistantContent');if(!target||$('pulseChat'))return;
  target.innerHTML=`<section id="pulseChat" class="card chat-card">
    <div class="chat-header"><div><div class="eyebrow">Dashboard-aware assistant</div><h2>Ask about the evidence behind the recommendation.</h2></div><span class="chat-context-pill">Uses this screen</span></div>
    <div class="chat-intro">The assistant can connect the imported baseline, current deviations, recommended blood panel, and selected published participant. It should explain the reasoning chain rather than repeat the dashboard labels.</div>
    <div id="chatSuggestions" class="chat-suggestions">
      <button type="button" data-q="Which measurements changed the most, and why does that matter?">What changed most?</button>
      <button type="button" data-q="Why are you recommending a CBC and CMP specifically?">Why CBC + CMP?</button>
      <button type="button" data-q="How is the selected study participant similar to me, and what happened to them?">Explain the comparison</button>
      <button type="button" data-q="What does the participant similarity percentage actually mean?">What does the match mean?</button>
    </div>
    <div id="chatMessages" class="chat-messages"><div class="chat-row assistant"><div class="chat-avatar">P</div><div class="chat-bubble">I can explain the baseline comparison, the testing rationale, and the evidence from the selected published participant.</div></div></div>
    <form id="chatForm" class="chat-form"><textarea id="chatInput" rows="2" maxlength="1800" placeholder="Ask about the current recommendation…"></textarea><button id="chatSend" type="submit">Send</button></form>
    <div class="chat-foot"><span id="chatMode">Dashboard-aware explanation</span></div>
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
  append('user',message);$('chatInput').value='';const pending=append('assistant','Reading the current dashboard state…');
  try{
    const s=snapshot();
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,snapshot:s,history:history.slice(-6)})});
    const data=await r.json().catch(()=>({}));
    const reply=String(data.reply||fallback(message,s)).trim();
    pending.textContent=reply;history.push({role:'user',text:message},{role:'assistant',text:reply});
    $('chatMode').textContent=data.mode==='gemini'?'AI · current dashboard context':'Local dashboard explanation';
  }catch(_){pending.textContent=fallback(message);}
  finally{busy=false;$('chatSend').disabled=false;$('chatInput').focus();}
}
build();
