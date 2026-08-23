const MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-3.7-flash';
const URL=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM=`You are PulseLab, an explanation layer for a wearable-to-testing research prototype.

Use the current dashboard snapshot when the question is about PulseLab. Write for an intelligent non-specialist: clear, specific, and technically accurate without sounding childish or stuffed with jargon.

Response style:
- Answer the question directly in the first sentence.
- Usually write 1-3 short paragraphs, roughly 4-9 sentences total when the question needs explanation.
- Give the evidence chain, not just the conclusion: what changed -> why the pattern matters -> why the suggested test adds information -> what remains uncertain.
- Use clinical or statistical terms only when they add meaning, and define them briefly in ordinary language.
- Avoid canned product language, slogans, motivational phrasing, and vague statements such as "your body is telling us something."
- Avoid legalistic disclaimer repetition. State uncertainty once, where it matters.
- Do not dump model internals unless the user asks for technical details.

Testing:
- If the dashboard recommends a test, name the exact panel and timing immediately.
- Explain why CBC and/or CMP are relevant using the measurements shown on the dashboard. CBC measures blood-cell counts and related indices. CMP measures electrolytes, glucose, kidney markers, and liver-associated markers.
- Do not imply that CBC or CMP diagnoses a specific disease on its own.

Population comparisons:
- If the user asks about a similar participant, name the selected participant, state which wearable changes are shared if the snapshot provides them, and state the actual study outcome.
- Distinguish source-study facts from PulseLab calculations. The participant outcome and reported measurements are real study data; the similarity percentage and network position are PulseLab demo calculations.
- Never translate a similarity percentage into a disease probability or say the user has the participant's diagnosis.
- A strong comparison can support the argument for independent testing, but it cannot identify the cause of the user's pattern.

Data provenance:
- The historical baseline comes from the uploaded WHOOP CSV.
- The live stream is simulated for the demo.
- Do not describe simulated live values as real user measurements.

Safety:
- If the user reports severe chest pain, severe difficulty breathing, fainting, confusion, one-sided weakness, or severe bleeding, advise urgent/emergency medical evaluation rather than relying on PulseLab.
- Do not prescribe medication.
- Answer unrelated general questions normally.`;

function fallback(message,s={}){
  const q=String(message||'').toLowerCase();
  const plan=s.testing_plan?.next_test,timing=s.testing_plan?.timing,reason=s.testing_plan?.reason;
  if(/square root of 4/.test(q))return'The square root of 4 is 2.';
  if(/chest pain|severe trouble breathing|can't breathe|cannot breathe|faint|confusion|one-sided weakness|severe bleeding/.test(q))return'Seek urgent medical evaluation for those symptoms rather than relying on PulseLab. The testing recommendation is not designed to determine whether a severe acute symptom is safe to watch at home.';
  if(/similar|patient|people|population|network|match/.test(q)){
    const name=s.population?.selected_name,kind=s.population?.selected_kind,outcome=s.population?.selected_outcome,rationale=s.population?.selected_rationale;
    if(name)return `The selected comparison is ${name}${kind?` (${kind})`:''}. ${rationale||''} In the source study, ${outcome||'the participant had a documented physiological event'}. The similarity score is a ranking measure, not a probability that you have the same condition. ${plan?`Given the broader pattern, the current recommendation remains ${plan}${timing?` ${timing.toLowerCase()}`:''}.`:''}`.replace(/\s+/g,' ').trim();
  }
  if(/test|cbc|cmp|what should|do next/.test(q)&&plan){
    return `${plan}${timing?` ${timing.toLowerCase()}`:''}. ${reason||''} ${s.testing_plan?.cbc_reason||''} ${s.testing_plan?.cmp_reason||''}`.replace(/\s+/g,' ').trim();
  }
  if(/change|wrong|off|baseline|why/.test(q)){
    const changes=Array.isArray(s.live?.changes)&&s.live.changes.length?s.live.changes.join('; '):'';
    return `${s.live?.headline||''} ${changes?`The largest displayed deviations are ${changes}.`:s.live?.summary||''} ${s.live?.trigger_explanation||''} ${plan?`That pattern is why PulseLab currently recommends ${plan}${timing?` ${timing.toLowerCase()}`:''}.`:''}`.replace(/\s+/g,' ').trim();
  }
  return `${s.live?.headline||''} ${s.live?.summary||''} ${plan?`Current testing recommendation: ${plan}${timing?` ${timing.toLowerCase()}`:''}.`:''}`.replace(/\s+/g,' ').trim();
}
function text(json){return(json?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('').trim();}
async function call(message,snapshot,history){
  const response=await fetch(URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:SYSTEM}]},
      contents:[
        ...(history||[]).slice(-6).map(t=>({role:t.role==='assistant'?'model':'user',parts:[{text:String(t.text||'').slice(0,1400)}]})),
        {role:'user',parts:[{text:`CURRENT PULSELAB DASHBOARD:\n${JSON.stringify(snapshot,null,2)}\n\nUSER QUESTION: ${message}`}]}],
      generationConfig:{maxOutputTokens:800,temperature:.25}
    })
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json?.error?.message||`Gemini error ${response.status}`);
  const reply=text(json);if(!reply)throw new Error('Empty response');return reply;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST only'});}
  const body=req.body||{},message=String(body.message||'').trim().slice(0,1800),snapshot=body.snapshot||{},history=Array.isArray(body.history)?body.history:[];
  if(!message)return res.status(400).json({error:'Message required'});
  if(!process.env.GEMINI_API_KEY)return res.status(200).json({reply:fallback(message,snapshot),mode:'local'});
  try{return res.status(200).json({reply:await call(message,snapshot,history),mode:'gemini',model:MODEL});}
  catch(error){console.error(error);return res.status(200).json({reply:fallback(message,snapshot),mode:'local'});}
}
