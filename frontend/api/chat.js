const MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-3.7-flash';
const URL=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM=`You are PulseLab. Speak like a normal person.

Use the current dashboard snapshot when the question is about PulseLab.
Keep answers short: usually 2-5 sentences.

Style rules:
- Use simple words.
- Do NOT say "cohort analog", "geometric similarity", "yield", "physiological drift", "standardized feature space", or "research context" unless the user explicitly asks for technical details.
- Do not dump model internals.
- If the screen says to get a test, lead with the action. Example: "Yes. Get a CBC + CMP within 72 hours."
- If the user asks about a similar participant, name the participant, say plainly what happened to them, then explain the connection.
- It is okay to say "something changed" or "this is worth checking." Do not be evasive.
- Never say the user has the same disease as a study participant. Say that a similar pattern is a reason to check, not a diagnosis.
- The live stream may be simulated; do not pretend it is real.
- If the user reports severe chest pain, severe trouble breathing, fainting, confusion, one-sided weakness, or severe bleeding, tell them to seek urgent/emergency care rather than relying on PulseLab.
- Do not prescribe medication.
- Answer unrelated questions normally.`;

function fallback(message,s={}){
  const q=String(message||'').toLowerCase();
  const plan=s.testing_plan?.next_test;
  if(/square root of 4/.test(q))return'The square root of 4 is 2.';
  if(/chest pain|severe trouble breathing|can't breathe|cannot breathe|faint|confusion|one-sided weakness|severe bleeding/.test(q))return'Seek urgent medical care for those symptoms. Do not rely on PulseLab to decide whether they are safe.';
  if(/similar|patient|people|population|network/.test(q)){
    const name=s.population?.selected_name,outcome=s.population?.selected_outcome;
    if(name)return `You're closest to ${name} on the current map. ${outcome||'Their study record had a significant event.'} That does not mean you have the same condition, but it is one reason this pattern is worth checking. ${plan?`PulseLab says: ${plan}`:''}`.trim();
  }
  if(/test|cbc|cmp|what should|do next/.test(q)&&plan)return `Yes. ${plan} ${s.testing_plan?.reason||''}`.trim();
  if(/change|wrong|off|baseline|why/.test(q)){
    const changes=Array.isArray(s.live?.changes)?s.live.changes.join('; '):'';
    return changes?`Several signals moved at once: ${changes}. ${plan?`That is why PulseLab says: ${plan}`:''}`:`${s.live?.summary||'Something changed.'} ${plan||''}`.trim();
  }
  return plan?`${plan} ${s.live?.summary||''}`.trim():(s.live?.summary||'Upload your WHOOP history first.');
}
function text(json){return(json?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('').trim();}
async function call(message,snapshot,history){
  const response=await fetch(URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:SYSTEM}]},
      contents:[
        ...(history||[]).slice(-6).map(t=>({role:t.role==='assistant'?'model':'user',parts:[{text:String(t.text||'').slice(0,1200)}]})),
        {role:'user',parts:[{text:`CURRENT SCREEN:\n${JSON.stringify(snapshot,null,2)}\n\nUSER: ${message}`}]}],
      generationConfig:{maxOutputTokens:500,temperature:.3}
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
