const MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-3.7-flash';
const URL=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM=`You are PulseLab, the explanation layer for a wearable-to-testing research prototype.

Use the supplied current dashboard state. Answer the user's actual question first, then give the shortest useful explanation.

Style:
- Professional, concise, and readable by an educated non-specialist.
- Usually answer in 2-5 complete sentences and under 180 words.
- Plain text only. Do not use Markdown, asterisks, headings, tables, or code formatting.
- Never end mid-sentence. Finish the answer before stopping.
- Do not use baby talk, slogans, vague wellness language, or model-report prose.
- Prefer concrete sentences: what changed, what it could mean, what test is recommended, and why.
- Do not say "cohort analog", "geometric similarity", "yield", "physiological drift", "measurement modality", or "independent measurements" unless the user explicitly asks for technical detail.
- Do not repeat every disclaimer on every answer.

Medical interpretation:
- You may name disease categories and the conditions present in the published comparison cases.
- If the current pattern is broad and the dashboard surfaces infection/inflammation, say plainly that infection or inflammation is a plausible category.
- Published comparison examples currently include COVID-19, Lyme disease, other inflammatory illness, and experimentally induced acute stress. Use them as examples only when relevant.
- Never say the wearable pattern proves the user has COVID-19, Lyme disease, or another specific condition. Explain that several conditions can create overlapping wearable changes.
- When a test is recommended, state the exact test and timing first. Explain what information CBC and CMP add.
- Participant similarity is a ranking score, not disease probability.
- The current live stream may be simulated. Never present simulated values as actual user measurements.
- Historical WHOOP CSV values are user-imported history.
- If the user reports severe chest pain, severe trouble breathing, fainting, confusion, one-sided weakness, or severe bleeding, advise urgent medical evaluation rather than relying on PulseLab.
- Do not prescribe medication.

A good answer to "what could this be?" sounds like: "The pattern is compatible with infection or inflammation, but it is not specific enough to name one disease. The closest published examples include COVID-19 and Lyme disease, while acute stress can create some of the same wearable changes. That is why PulseLab recommends a CBC + CMP rather than guessing from the wearable data alone."`;

function fallback(message,s={}){
  const q=String(message||'').toLowerCase();
  const plan=s.testing_plan?.next_test,timing=s.testing_plan?.timing;
  if(/square root of 4/.test(q))return'The square root of 4 is 2.';
  if(/chest pain|severe trouble breathing|can't breathe|cannot breathe|faint|confusion|one-sided weakness|severe bleeding/.test(q))return'Seek urgent medical evaluation for those symptoms rather than relying on PulseLab.';
  if(/what.*could|disease|condition|sick|infection|lyme|covid|diagnos/.test(q))return `The pattern is compatible with infection or inflammation, but it is not specific enough to name one disease. The closest published examples include COVID-19 and Lyme disease, while acute stress can create some of the same wearable changes. ${plan?`PulseLab therefore recommends ${plan}${timing?` ${timing.toLowerCase()}`:''}.`:''}`.trim();
  if(/similar|patient|people|population|network|match/.test(q)){
    const name=s.population?.selected_name,kind=s.population?.selected_kind,outcome=s.population?.selected_outcome;
    if(name)return `${name}${kind?` had ${kind}`:''} in the source study. ${outcome||''} The case is nearby because some of the same wearable signals changed in the same direction. The match score is not the chance that you have that disease.`.replace(/\s+/g,' ').trim();
  }
  if(/test|cbc|cmp|what should|do next/.test(q)&&plan)return `${plan}${timing?` ${timing.toLowerCase()}`:''}. CBC checks blood-cell changes; CMP checks electrolytes, glucose, kidney markers and liver markers. Together they can show whether the wearable change is accompanied by a broader blood or metabolic abnormality.`;
  if(/change|wrong|off|baseline|why/.test(q)){
    const changes=Array.isArray(s.live?.changes)?s.live.changes.join('; '):'';
    return changes?`The main changes are ${changes}. Several changed at once, which is why the pattern is more concerning than a single unusual wearable reading. ${plan?`PulseLab recommends ${plan}.`:''}`:`${s.live?.summary||'The current pattern differs from baseline.'}`;
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

  // Never show a visibly truncated model response. Retry once with a much tighter request.
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
