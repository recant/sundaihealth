const MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-3.7-flash';
const URL=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM=`You are PulseLab, the explanation layer for a wearable-to-testing research prototype.

Use the supplied current dashboard state. Answer the user's actual question first, then give the shortest useful explanation.

Style:
- Professional, concise, and readable by an educated non-specialist.
- Usually answer in 2-5 complete sentences and under 180 words.
- Plain text only. Do not use Markdown, asterisks, headings, tables, or code formatting.
- Never end mid-sentence. Finish the answer before stopping.
- Prefer concrete sentences: what changed, what it could mean, which test answers which question, and why.
- Do not use "cohort analog", "geometric similarity", "yield", "physiological drift", "measurement modality", or "independent measurements" unless the user explicitly asks for technical detail.

Medical interpretation:
- Separate disease-specific testing from broad blood panels.
- If COVID-19 is plausible, say that an antigen test or NAAT/PCR is the targeted test for SARS-CoV-2. CBC and CMP do NOT diagnose COVID-19.
- CBC counts white cells, red cells, hemoglobin and platelets; it can show blood-cell changes associated with infection, inflammation, anemia and other conditions.
- CMP measures glucose, electrolytes, kidney markers, liver-associated markers and proteins; it can show metabolic disturbance, dehydration or organ involvement.
- If Lyme disease is discussed, do not imply CBC/CMP diagnose Lyme; Lyme requires condition-specific clinical evaluation/testing when exposure and symptoms make it plausible.
- Published comparison examples currently include COVID-19, Lyme disease, other inflammatory illness, and experimentally induced acute stress. Use them as examples only when relevant.
- Never say the wearable pattern proves the user has COVID-19, Lyme disease, or another specific condition.
- Participant similarity is a ranking score, not disease probability.
- The current live stream may be simulated. Never present simulated values as actual user measurements.
- Historical WHOOP CSV values are user-imported history.
- If the user reports severe chest pain, severe trouble breathing, fainting, confusion, one-sided weakness, or severe bleeding, advise urgent medical evaluation rather than relying on PulseLab.
- Do not prescribe medication.

A good answer to "why CBC + CMP if the closest case had COVID?" sounds like: "CBC and CMP do not test for COVID-19. If COVID is plausible, an antigen test or NAAT/PCR is the targeted test because it looks for SARS-CoV-2. CBC and CMP answer a different question: whether the illness is changing blood cells, electrolytes, kidney/liver markers, glucose, or other systemic measurements."`;

function fallback(message,s={}){
  const q=String(message||'').toLowerCase();
  const plan=s.testing_plan?.next_test,timing=s.testing_plan?.timing;
  if(/square root of 4/.test(q))return'The square root of 4 is 2.';
  if(/chest pain|severe trouble breathing|can't breathe|cannot breathe|faint|confusion|one-sided weakness|severe bleeding/.test(q))return'Seek urgent medical evaluation for those symptoms rather than relying on PulseLab.';
  if(/why.*cbc|why.*cmp|covid.*test|pcr|antigen/.test(q))return'CBC and CMP do not diagnose COVID-19. If COVID-19 is plausible, a COVID antigen test or NAAT/PCR is the targeted test because it detects the virus or its components. CBC can show blood-cell changes, while CMP can show electrolyte, glucose, kidney, liver, protein, or other metabolic changes caused by illness.';
  if(/what.*could|disease|condition|sick|infection|lyme|covid|diagnos/.test(q))return `The pattern is compatible with infection or inflammation, but it is not specific enough to name one disease. The closest published examples include COVID-19 and Lyme disease, while acute stress can create some of the same wearable changes. If COVID is plausible, use a COVID antigen or NAAT/PCR to test for the virus; broader blood work can then show how the body is responding.`.trim();
  if(/similar|patient|people|population|network|match/.test(q)){
    const name=s.population?.selected_name,kind=s.population?.selected_kind,outcome=s.population?.selected_outcome;
    if(name)return `${name}${kind?` had ${kind}`:''} in the source study. ${outcome||''} The case is nearby because some of the same wearable signals changed in the same direction. The match score is not the chance that you have that disease.`.replace(/\s+/g,' ').trim();
  }
  if(/test|what should|do next/.test(q)&&plan)return `Use a condition-specific test when the pattern points to a particular disease. For example, if COVID is plausible, use an antigen test or NAAT/PCR. CBC and CMP are broader supporting tests: CBC checks blood cells, and CMP checks electrolytes, glucose, kidney and liver markers.`;
  if(/change|wrong|off|baseline|why/.test(q)){
    const changes=Array.isArray(s.live?.changes)?s.live.changes.join('; '):'';
    return changes?`The main changes are ${changes}. Several changed at once, which is why the pattern is more concerning than a single unusual wearable reading.`:`${s.live?.summary||'The current pattern differs from baseline.'}`;
  }
  return plan?`${plan}${timing?` ${timing.toLowerCase()}`:''}. ${s.testing_plan?.reason||''}`:(s.live?.summary||'Upload WHOOP history first.');
}

function text(json){
  return (json?.candidates?.[0]?.content?.parts||[])
    .filter(p=>!p?.thought)
    .map(p=>p?.text||'')
    .join('')
    .trim();
}
function finishReason(json){return String(json?.candidates?.[0]?.finishReason||'').toUpperCase();}
function clean(reply){
  return String(reply||'')
    .replace(/\*\*(.*?)\*\*/g,'$1')
    .replace(/__(.*?)__/g,'$1')
    .replace(/`([^`]+)`/g,'$1')
    .replace(/^#{1,6}\s+/gm,'')
    .trim();
}

async function generate(contents,maxOutputTokens=8192){
  const response=await fetch(URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:SYSTEM}]},
      contents,
      generationConfig:{maxOutputTokens,temperature:.25}
    })
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json?.error?.message||`Gemini error ${response.status}`);
  return {json,reply:clean(text(json)),finish:finishReason(json)};
}

async function call(message,snapshot,history){
  const baseContents=[
    ...(history||[]).slice(-6).map(t=>({role:t.role==='assistant'?'model':'user',parts:[{text:String(t.text||'').slice(0,1200)}]})),
    {role:'user',parts:[{text:`CURRENT DASHBOARD:\n${JSON.stringify(snapshot,null,2)}\n\nUSER: ${message}`}]}]
  ];

  const first=await generate(baseContents,8192);
  if(first.reply && first.finish!=='MAX_TOKENS')return first.reply;

  const retryContents=[
    ...baseContents,
    ...(first.reply?[{role:'model',parts:[{text:first.reply}]}]:[]),
    {role:'user',parts:[{text:'Rewrite the answer from the beginning in no more than 120 words. Plain text only. Use complete sentences and make sure the final sentence is finished.'}]}
  ];
  const retry=await generate(retryContents,8192);
  if(retry.reply && retry.finish!=='MAX_TOKENS')return retry.reply;
  throw new Error(`Incomplete model response (${retry.finish||first.finish||'unknown finish reason'})`);
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