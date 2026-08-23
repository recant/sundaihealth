const MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.7-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM = `You are PulseLab Explainer, a conversational layer on top of a research wearable-to-blood-testing model.

When the user is asking about PulseLab, explain the CURRENT dashboard snapshot supplied with the message. You are not the model that generated its score.
When the user asks an unrelated general question (for example math, coding, or ordinary knowledge), answer that question normally and do not force a medical reminder into the answer.

Medical interpretation rules:
- PulseLab estimates whether a particular blood panel may be informative. It is NOT a diagnosis, medical-clearance score, or validated doctor/ER triage system.
- Never say a low PulseLab score proves the user is healthy, rules out illness, or proves they should not see a doctor.
- Never claim the current model predicts future heart disease or another disease unless the supplied snapshot explicitly says a longitudinal disease model supports that outcome.
- Similar-cohort analogs are only evidence for the outcome they were labeled with. If they are NHANES analogs, describe them as same-participant lab abnormalities, not later disease.
- If severe symptoms are reported (for example chest pressure, severe difficulty breathing, fainting, confusion, new one-sided weakness, or severe bleeding), advise prompt urgent/emergency evaluation rather than relying on PulseLab.
- Do not diagnose disease or prescribe medication.
- Treat anything marked synthetic/demo as visualization only.
- If a specific test is surfaced, name the exact panel and explain the model evidence and uncertainty.
- If the dashboard says no event-triggered test, say PulseLab does not currently see a strong wearable-driven reason for a new draw; do not translate that into "you are fine."
- Be concise and complete. Never end mid-sentence. Usually answer in 1-4 short paragraphs.
`;

function clamp(x,a=0,b=100){const n=Number(x);return Number.isFinite(n)?Math.max(a,Math.min(b,n)):null;}

function fallback(message,snapshot={}){
  const q=String(message||'').toLowerCase();
  const score=clamp(snapshot.score);const recommendation=snapshot.recommendation||'No current recommendation';const summary=snapshot.summary||'';
  const severe=/(chest pain|chest pressure|can't breathe|cannot breathe|severe shortness of breath|faint(ed|ing)?|passed out|confusion|one[- ]sided weakness|severe bleeding)/i.test(message||'');
  if(severe)return `Those symptoms can require prompt medical evaluation. PulseLab is not designed to decide whether a severe acute symptom is safe to watch at home, so do not rely on its testing score for that decision.`;
  if(/square root of 4/.test(q))return 'The square root of 4 is 2.';
  if(/(doctor|physician|urgent care|er\b|emergency)/i.test(q)){
    const modelLine=score==null?'PulseLab does not currently have enough model state to interpret the dashboard.':`PulseLab is showing ${recommendation.toLowerCase()} with a testing-priority score of ${score}/100.`;
    return `${modelLine} That score concerns the expected usefulness of blood testing, not whether you medically need to see a doctor. New, persistent, worsening, or concerning symptoms can still justify clinician evaluation.`;
  }
  if(/(why.*(not|no)|no test|not recommending)/i.test(q))return `PulseLab is only saying it does not currently see a strong wearable-driven reason for a new blood draw. ${summary || 'The decision combines the trained population model with deviation from the person’s learned baseline.'}`;
  if(/(what changed|baseline|why now|driver)/i.test(q)){
    const reasons=Array.isArray(snapshot.reasons)&&snapshot.reasons.length?snapshot.reasons.join(' '):'No model drivers are displayed yet.';
    return `The dashboard compares the latest physiology with the learned baseline. The strongest displayed drivers are: ${reasons}`;
  }
  const plan=snapshot.testing_plan?.next_test?` The current testing plan surfaces ${snapshot.testing_plan.next_test} ${snapshot.testing_plan.window||''}.`:'';
  return `${recommendation}. ${summary || 'PulseLab combines a population-trained blood-testing model with a personal wearable baseline.'}${plan}`;
}

function textFromResponse(json){
  return (json?.candidates?.[0]?.content?.parts||[]).map(p=>typeof p?.text==='string'?p.text:'').join('').trim();
}

function historyContents(history){
  return history.map(turn=>({
    role:turn?.role==='assistant'?'model':'user',
    parts:[{text:String(turn?.text||'').slice(0,1600)}],
  }));
}

async function callGemini(message,snapshot,history){
  const context=[
    'CURRENT PULSELAB DASHBOARD SNAPSHOT:',
    JSON.stringify(snapshot,null,2),
    '',
    'Interpret the snapshot only when relevant to the user question.',
    `USER MESSAGE: ${message}`,
  ].join('\n');
  const response=await fetch(GEMINI_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:SYSTEM}]},
      contents:[...historyContents(history),{role:'user',parts:[{text:context}]}],
      generationConfig:{maxOutputTokens:1200},
    }),
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json?.error?.message||`Gemini request failed (${response.status})`);
  const reply=textFromResponse(json);
  if(!reply)throw new Error('Gemini returned an empty response.');
  return {reply,finishReason:json?.candidates?.[0]?.finishReason||null};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  const body=req.body||{};const message=String(body.message||'').trim().slice(0,2000);const snapshot=body.snapshot&&typeof body.snapshot==='object'?body.snapshot:{};const history=Array.isArray(body.history)?body.history.slice(-8):[];
  if(!message)return res.status(400).json({error:'Message is required.'});
  if(!process.env.GEMINI_API_KEY)return res.status(200).json({reply:fallback(message,snapshot),mode:'local-safety-fallback',model:null});
  try{
    const result=await callGemini(message,snapshot,history);
    return res.status(200).json({reply:result.reply,mode:'gemini',model:MODEL,finishReason:result.finishReason});
  }catch(error){
    console.error('PulseLab chat failure',error);
    return res.status(200).json({reply:fallback(message,snapshot),mode:'local-safety-fallback',model:null});
  }
}
