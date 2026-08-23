const METRICS = [
  ['resting_hr', 'Resting heart rate', 'bpm'],
  ['hrv', 'HRV (RMSSD)', 'ms'],
  ['sleep_hours', 'Sleep duration', 'hours'],
  ['steps', 'Daily steps', 'steps'],
  ['temperature_c', 'Temperature', '°C'],
  ['spo2', 'SpO₂', '%'],
  ['respiratory_rate', 'Respiratory rate', '/min'],
  ['cgm_mean', 'CGM mean glucose', 'mg/dL'],
  ['cgm_cv', 'CGM variability (CV)', '%']
];

const $ = id => document.getElementById(id);

function makeMetricRows() {
  $('metricRows').innerHTML = METRICS.map(([key, label, unit]) => `
    <div class="metric-row">
      <label for="b_${key}"><strong>${label}</strong><small>${unit}</small></label>
      <input id="b_${key}" data-kind="baseline" data-key="${key}" type="number" step="any" placeholder="—" />
      <input id="c_${key}" data-kind="current" data-key="${key}" type="number" step="any" placeholder="—" />
    </div>`).join('');
}

function valueOf(id) {
  const v = $(id).value.trim();
  return v === '' ? null : Number(v);
}

function collectMetrics(kind) {
  const out = {};
  document.querySelectorAll(`[data-kind="${kind}"]`).forEach(el => {
    if (el.value.trim() !== '') out[el.dataset.key] = Number(el.value);
  });
  return out;
}

function collectPayload() {
  return {
    baseline: collectMetrics('baseline'),
    current: collectMetrics('current'),
    persistence_days: Number($('persistence').value),
    days_since_last_blood_test: valueOf('lastBlood'),
    age: valueOf('age'),
    sex: $('sex').value,
    notes: $('notes').value.trim()
  };
}

function loadExample() {
  const values = {
    b_resting_hr: 58, c_resting_hr: 69,
    b_hrv: 56, c_hrv: 37,
    b_sleep_hours: 7.5, c_sleep_hours: 5.9,
    b_steps: 9200, c_steps: 5100,
    b_temperature_c: 36.5, c_temperature_c: 37.1,
    b_spo2: 98, c_spo2: 96,
    b_respiratory_rate: 14, c_respiratory_rate: 17
  };
  for (const [id, value] of Object.entries(values)) $(id).value = value;
  $('persistence').value = '3';
  $('lastBlood').value = '150';
  $('notes').value = 'Unusually fatigued for three days. No hard workout or travel. Resting heart rate remains elevated even overnight.';
}

function setLoading(on) {
  $('analyzeBtn').disabled = on;
  $('buttonText').textContent = on ? 'Analyzing wearable pattern…' : 'Analyze with Gemini';
  $('spinner').classList.toggle('hidden', !on);
}

function recommendationLabel(value) {
  return {
    NO_TEST: 'NO TEST INDICATED BY THIS PATTERN',
    WATCH: 'WATCH THE TREND',
    CONSIDER_TESTING_SOON: 'CONSIDER BLOOD TESTING SOON'
  }[value] || value;
}

function render(data) {
  $('emptyState').classList.add('hidden');
  $('resultView').classList.remove('hidden');
  $('recommendation').textContent = recommendationLabel(data.recommendation);
  $('recommendation').dataset.level = data.recommendation || '';
  $('score').textContent = data.priority_score ?? '—';
  $('headline').textContent = data.headline || '';
  $('summary').textContent = data.summary || '';
  $('modelUsed').textContent = data.model ? `Model: ${data.model}` : '';
  $('generatedAt').textContent = data.generated_at ? new Date(data.generated_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

  const redFlag = $('redFlag');
  redFlag.textContent = data.red_flag_notice || '';
  redFlag.classList.toggle('hidden', !data.red_flag_notice);

  $('reasons').innerHTML = (data.reasons || []).map(r => `
    <div class="reason">
      <div class="signal-name">${escapeHtml(r.signal)}</div>
      <div><strong>${escapeHtml(r.observed_change)}</strong><p>${escapeHtml(r.interpretation)}</p></div>
    </div>`).join('') || '<p class="muted">No strong signal was identified.</p>';

  $('tests').innerHTML = (data.tests || []).map(t => `
    <article class="test-item">
      <div class="test-top"><h3>${escapeHtml(t.name)}</h3><span class="priority ${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</span></div>
      <p>${escapeHtml(t.rationale)}</p>
    </article>`).join('') || '<div class="no-tests"><strong>No blood tests suggested.</strong><br>The model did not find enough wearable evidence to justify a focused panel right now.</div>';

  $('nextStep').textContent = data.next_step || '';
  $('uncertainty').innerHTML = (data.uncertainty || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

async function analyze() {
  $('error').classList.add('hidden');
  const payload = collectPayload();
  if (!Object.keys(payload.baseline).length && !Object.keys(payload.current).length) {
    $('error').textContent = 'Enter at least one wearable metric, ideally both baseline and current.';
    $('error').classList.remove('hidden');
    return;
  }

  setLoading(true);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.setup ? `${data.error} ${data.setup}` : (data.detail || data.error || `HTTP ${res.status}`));
    render(data);
  } catch (err) {
    $('error').textContent = err.message || String(err);
    $('error').classList.remove('hidden');
  } finally {
    setLoading(false);
  }
}

makeMetricRows();
$('sampleBtn').addEventListener('click', loadExample);
$('analyzeBtn').addEventListener('click', analyze);
