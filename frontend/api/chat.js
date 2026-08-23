const MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const SYSTEM = `You are PulseLab Explainer, a conversational explanation layer on top of a research wearable-to-blood-testing model.

Your job is to explain the CURRENT PulseLab dashboard state supplied with each message. You are not the model that generated the score, and you must never pretend the chatbot itself diagnosed anything.

Critical rules:
- PulseLab's score estimates whether blood testing may be informative. It is NOT a diagnosis, a medical-clearance score, or a validated doctor/ER triage score.
- Never tell a user that they definitely do not need a doctor, that it is safe to stay home, or that a low PulseLab score rules out illness.
- If the user reports potentially urgent symptoms such as chest pain/pressure, severe trouble breathing, fainting, confusion, new one-sided weakness, severe bleeding, or another obviously severe acute symptom, advise prompt urgent/emergency medical evaluation rather than relying on PulseLab.
- For non-urgent questions about seeing a doctor, explain what the dashboard does and does not support. If symptoms are new, persistent, worsening, or concerning to the user, say that clinician evaluation can still be appropriate even when the model is quiet.
- Do not diagnose disease. Do not prescribe medications. Do not invent symptoms, measurements, lab values, or medical history.
- Treat anything explicitly marked synthetic/demo as visualization only, not real evidence about the user.
- Distinguish population-model probability, personalized calibration, physiology drift, and actual symptoms.
- When the dashboard says no event-triggered test, phrase it as "PulseLab does not currently see a strong wearable-driven reason for blood testing" rather than "you are fine."
- If the user asks why a test is suggested, connect the answer to the supplied model drivers and ranked panels, and mention uncertainty.
- Ask one concise follow-up question about symptoms when that would materially change a doctor/urgent-care answer.
- Be concise, plainspoken, and specific to the supplied dashboard. Usually 2-5 short paragraphs, under 180 words.
`;

function clamp(x, a = 0, b = 100) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : null;
}

function fallback(message, snapshot = {}) {
  const q = String(message || '').toLowerCase();
  const score = clamp(snapshot.score);
  const recommendation = snapshot.recommendation || 'No current recommendation';
  const summary = snapshot.summary || '';
  const severe = /(chest pain|chest pressure|can't breathe|cannot breathe|severe shortness of breath|faint(ed|ing)?|passed out|confusion|one[- ]sided weakness|severe bleeding)/i.test(message || '');

  if (severe) {
    return `Those symptoms can require prompt medical evaluation. PulseLab is not designed to decide whether an emergency symptom is safe to watch at home, so don't rely on its testing score for that decision. Seek urgent/emergency medical care now if the symptom is severe or ongoing.`;
  }

  if (/(doctor|physician|urgent care|er\b|emergency)/i.test(q)) {
    const modelLine = score == null
      ? `PulseLab does not currently have enough model state to answer from the dashboard.`
      : `PulseLab is currently showing ${recommendation.toLowerCase()} with a testing-priority score of ${score}/100.`;
    return `${modelLine} That score is about the expected usefulness of blood testing, not whether you medically need to see a doctor. A quiet score cannot rule out illness. If you have new, persistent, worsening, or concerning symptoms, clinician evaluation can still be appropriate. What symptoms, if any, are you having right now?`;
  }

  if (/(why.*(not|no)|shouldn.t|should not|no test|not recommending)/i.test(q)) {
    return `PulseLab is only saying it does not currently see a strong wearable-driven reason for blood testing. It is not saying that nothing is wrong or that you should avoid a doctor. ${summary || 'The decision combines the trained population model with deviation from the person’s learned baseline.'} A low trigger can happen when the wearable pattern is close to baseline or when the model has weak evidence for the available lab panels.`;
  }

  if (/(what changed|baseline|why now|driver)/i.test(q)) {
    const reasons = Array.isArray(snapshot.reasons) && snapshot.reasons.length ? snapshot.reasons.join(' ') : 'No model drivers are displayed yet.';
    return `The dashboard is comparing today's physiology with the person's learned baseline. The strongest displayed drivers are: ${reasons} Those shifts affect the event-trigger signal, while BloodNeedNet separately estimates which blood panels are likely to be informative.`;
  }

  return `${recommendation}. ${summary || 'PulseLab combines a population-trained blood-testing model with a personal wearable baseline.'} I can explain what changed, why a particular blood test is ranked highly, or what this result does—and does not—say about seeing a doctor.`;
}

function extractText(json) {
  const steps = Array.isArray(json?.steps) ? json.steps : [];
  const texts = [];
  for (const step of steps) {
    if (step?.type !== 'model_output') continue;
    for (const part of Array.isArray(step.content) ? step.content : []) {
      if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text);
    }
  }
  return texts.join('\n').trim();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const message = String(body.message || '').trim().slice(0, 2000);
  const snapshot = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : {};
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!message) return res.status(400).json({ error: 'Message is required.' });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(200).json({
      reply: fallback(message, snapshot),
      mode: 'local-safety-fallback',
      model: null,
    });
  }

  const compactHistory = history.map(turn => ({
    role: turn?.role === 'assistant' ? 'assistant' : 'user',
    text: String(turn?.text || '').slice(0, 1200),
  }));

  const input = [
    'CURRENT DASHBOARD SNAPSHOT (authoritative for this turn):',
    JSON.stringify(snapshot, null, 2),
    '',
    'RECENT CHAT:',
    JSON.stringify(compactHistory, null, 2),
    '',
    `USER MESSAGE: ${message}`,
  ].join('\n');

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        system_instruction: SYSTEM,
        input,
        store: false,
        generation_config: {
          max_output_tokens: 450,
          thinking_level: 'low',
        },
      }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Gemini chat error', response.status, json?.error?.message || json?.error || json);
      return res.status(200).json({
        reply: fallback(message, snapshot),
        mode: 'local-safety-fallback',
        model: null,
      });
    }

    const reply = extractText(json) || fallback(message, snapshot);
    return res.status(200).json({ reply, mode: 'gemini', model: MODEL });
  } catch (error) {
    console.error('PulseLab chat failure', error);
    return res.status(200).json({
      reply: fallback(message, snapshot),
      mode: 'local-safety-fallback',
      model: null,
    });
  }
}
