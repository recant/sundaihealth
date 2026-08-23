const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    priority_score: { type: 'integer', minimum: 0, maximum: 100 },
    recommendation: { type: 'string', enum: ['NO_TEST', 'WATCH', 'CONSIDER_TESTING_SOON'] },
    headline: { type: 'string' },
    summary: { type: 'string' },
    reasons: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          signal: { type: 'string' },
          observed_change: { type: 'string' },
          interpretation: { type: 'string' }
        },
        required: ['signal', 'observed_change', 'interpretation']
      }
    },
    tests: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'optional'] },
          rationale: { type: 'string' }
        },
        required: ['name', 'priority', 'rationale']
      }
    },
    uncertainty: { type: 'array', maxItems: 5, items: { type: 'string' } },
    next_step: { type: 'string' },
    red_flag_notice: { type: 'string' }
  },
  required: [
    'priority_score', 'recommendation', 'headline', 'summary', 'reasons',
    'tests', 'uncertainty', 'next_step', 'red_flag_notice'
  ]
};

const METRICS = {
  resting_hr: { label: 'Resting heart rate', unit: 'bpm' },
  hrv: { label: 'HRV (RMSSD)', unit: 'ms' },
  sleep_hours: { label: 'Sleep duration', unit: 'h' },
  steps: { label: 'Daily steps', unit: 'steps' },
  temperature_c: { label: 'Temperature', unit: '°C' },
  spo2: { label: 'SpO₂', unit: '%' },
  respiratory_rate: { label: 'Respiratory rate', unit: '/min' },
  cgm_mean: { label: 'CGM mean glucose', unit: 'mg/dL' },
  cgm_cv: { label: 'CGM coefficient of variation', unit: '%' }
};

function asNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentChange(current, baseline) {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function deriveSignals(input) {
  const signals = [];
  for (const [key, meta] of Object.entries(METRICS)) {
    const current = asNumber(input.current?.[key]);
    const baseline = asNumber(input.baseline?.[key]);
    if (current == null && baseline == null) continue;
    const change = percentChange(current, baseline);
    signals.push({
      metric: key,
      label: meta.label,
      unit: meta.unit,
      baseline,
      current,
      percent_change: change == null ? null : Math.round(change * 10) / 10
    });
  }
  return signals;
}

function heuristicContext(signals, persistenceDays) {
  const weights = {
    resting_hr: 10,
    hrv: 20,
    sleep_hours: 20,
    steps: 40,
    temperature_c: null,
    spo2: null,
    respiratory_rate: 20,
    cgm_mean: 15,
    cgm_cv: 25
  };

  let total = 0;
  let count = 0;
  for (const s of signals) {
    let magnitude = 0;
    if (s.metric === 'temperature_c' && s.current != null && s.baseline != null) {
      magnitude = Math.min(Math.abs(s.current - s.baseline) / 0.7, 2);
    } else if (s.metric === 'spo2' && s.current != null && s.baseline != null) {
      magnitude = Math.min(Math.abs(s.current - s.baseline) / 2.0, 2);
    } else if (s.percent_change != null && weights[s.metric]) {
      magnitude = Math.min(Math.abs(s.percent_change) / weights[s.metric], 2);
    }
    if (magnitude > 0) {
      total += magnitude;
      count += 1;
    }
  }
  const base = count ? Math.min((total / count) * 50, 100) : 0;
  const persistence = Math.min(Math.max(Number(persistenceDays) || 1, 1), 14);
  return {
    deviation_index: Math.round(Math.min(base * (0.75 + Math.min(persistence, 7) * 0.05), 100)),
    persistence_days: persistence,
    note: 'deviation_index is a non-clinical preprocessing feature supplied to the language model'
  };
}

function extractOutputText(json) {
  const steps = Array.isArray(json?.steps) ? json.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    const text = step.content.filter(x => x?.type === 'text').map(x => x.text || '').join('');
    if (text) return text;
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not configured on the server.',
      setup: 'Add GEMINI_API_KEY in Vercel Project Settings → Environment Variables, then redeploy.'
    });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const signals = deriveSignals(body);
  if (!signals.length) return res.status(400).json({ error: 'Enter at least one wearable metric.' });

  const context = heuristicContext(signals, body.persistence_days);
  const payload = {
    wearable_signals: signals,
    persistence_days: context.persistence_days,
    preprocessing: context,
    symptoms_or_context: String(body.notes || '').slice(0, 2000),
    age: asNumber(body.age),
    sex: String(body.sex || 'not provided'),
    days_since_last_blood_test: asNumber(body.days_since_last_blood_test)
  };

  const systemInstruction = `You are the reasoning engine for a research prototype that estimates whether changes in wearable physiology make a routine blood test more informative now than at baseline.

Your job is NOT to diagnose disease and NOT to pretend wearable data can determine a blood abnormality. Use the user's personal baseline, current readings, persistence, concordance across signals, and context. Be conservative: if evidence is weak or explained by normal variation, choose NO_TEST or WATCH. If several persistent signals materially deviate together, you may choose CONSIDER_TESTING_SOON.

When suggesting tests, choose a small focused set of common, standard blood tests that could reasonably help clarify the observed pattern. Examples include CBC, CMP, TSH with reflex free T4, ferritin/iron studies, HbA1c or fasting glucose, and CRP/hs-CRP. Do not recommend exotic panels, broad screening batteries, genetic testing, tumor markers, hormone panels, or medications unless there is a clear reason in the supplied context. Explain why each proposed test relates to the pattern and acknowledge alternatives.

If the notes contain severe or potentially urgent symptoms (for example chest pain, severe shortness of breath, fainting, confusion, or very low oxygen), say clearly in red_flag_notice that wearable-driven blood-test triage is not appropriate and prompt medical evaluation may be more important than ordering labs.

The deviation_index is only a non-clinical feature-engineering summary. Never describe it as a validated medical score. Do not invent measurements the user did not provide. Return only JSON matching the schema.`;

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        system_instruction: systemInstruction,
        input: `Analyze this wearable record and decide whether blood testing appears more informative now.\n\n${JSON.stringify(payload, null, 2)}`,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: RESPONSE_SCHEMA
        },
        generation_config: {
          temperature: 0.2,
          max_output_tokens: 1800
        },
        store: false
      })
    });

    const raw = await response.json();
    if (!response.ok) {
      return res.status(502).json({
        error: 'Gemini request failed.',
        detail: raw?.error?.message || `HTTP ${response.status}`
      });
    }

    const text = extractOutputText(raw);
    if (!text) return res.status(502).json({ error: 'Gemini returned no text output.' });

    const analysis = JSON.parse(text);
    return res.status(200).json({
      ...analysis,
      model: MODEL,
      derived_signals: signals,
      preprocessing: context,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'Analysis failed.', detail: error?.message || String(error) });
  }
}
