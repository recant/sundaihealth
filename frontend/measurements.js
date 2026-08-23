const $ = id => document.getElementById(id);
const STORAGE_KEY = 'pulselab-personal-profile-v1';
let selectedMetric = 'hrv';
let selectedDate = null;
let lastSignature = '';

const METRICS = {
  resting_hr: { label: 'Resting heart rate', short: 'RHR', unit: 'bpm', decimals: 0, better: -1 },
  hrv: { label: 'Heart-rate variability', short: 'HRV', unit: 'ms', decimals: 0, better: 1 },
  sleep_hours: { label: 'Sleep duration', short: 'Sleep', unit: 'h', decimals: 1, better: 1 },
  steps: { label: 'Daily steps', short: 'Steps', unit: '', decimals: 0, better: 1 },
  temperature_c: { label: 'Skin temperature', short: 'Temp', unit: '°C', decimals: 2, better: 0 },
  spo2: { label: 'Blood oxygen', short: 'SpO₂', unit: '%', decimals: 1, better: 1 },
  respiratory_rate: { label: 'Respiratory rate', short: 'Resp.', unit: '/min', decimals: 1, better: 0 }
};

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function formatDate(key, long = false) {
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString([], long ? { month: 'long', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}
function formatValue(metric, value) {
  const meta = METRICS[metric];
  if (!meta || !Number.isFinite(value)) return '—';
  if (metric === 'steps') return Math.round(value).toLocaleString();
  return `${Number(value).toFixed(meta.decimals)}${meta.unit ? ` ${meta.unit}` : ''}`;
}
function profile() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {}; }
  catch (_) { return {}; }
}
function dayKey(date) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function demoHistory() {
  const out = {};
  const now = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const phase = (59 - i) / 59;
    const wobble = Math.sin(i * 0.57) + Math.cos(i * 0.19) * 0.45;
    const recentStress = i < 10 ? (10 - i) / 10 : 0;
    out[dayKey(d)] = {
      resting_hr: 58 + wobble * 1.1 + recentStress * 7,
      hrv: 56 - wobble * 1.7 - recentStress * 15,
      sleep_hours: 7.45 + wobble * 0.13 - recentStress * 1.1,
      steps: 9000 + wobble * 620 - recentStress * 2900,
      temperature_c: 36.5 + wobble * 0.025 + recentStress * 0.38,
      spo2: 98 - recentStress * 1.4,
      respiratory_rate: 14.1 + wobble * 0.08 + recentStress * 1.6,
      phase
    };
  }
  return out;
}
function historyData() {
  const p = profile();
  const entries = Object.entries(p.wearable_days || {}).filter(([, rec]) => rec && typeof rec === 'object').sort(([a], [b]) => a.localeCompare(b));
  if (entries.length) return { entries, synthetic: false, profile: p };
  return { entries: Object.entries(demoHistory()), synthetic: true, profile: p };
}
function labData(p) {
  const real = (p?.lab_feedback || []).map(x => ({
    date: String(x.at || '').slice(0, 10), panel: String(x.panel || 'blood panel').replaceAll('_', ' '), abnormal: Boolean(x.outcome), synthetic: false
  })).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date));
  if (real.length) return real.slice(-10).reverse();
  const now = new Date();
  return [
    [-92, 'CBC', false], [-61, 'CMP / metabolic', false], [-29, 'Hemoglobin A1c', true]
  ].map(([days, panel, abnormal]) => { const d = new Date(now); d.setDate(now.getDate() + days); return { date: dayKey(d), panel, abnormal, synthetic: true }; }).reverse();
}
function trend(metric, entries) {
  const values = entries.filter(([, rec]) => Number.isFinite(Number(rec?.[metric]))).map(([date, rec]) => ({ date, value: Number(rec[metric]) }));
  if (values.length < 2) return null;
  const recent = values.slice(-7);
  const prior = values.slice(Math.max(0, values.length - 21), Math.max(0, values.length - 7));
  const avg = xs => xs.reduce((s, x) => s + x.value, 0) / Math.max(1, xs.length);
  const base = prior.length ? avg(prior) : values[0].value;
  const current = avg(recent);
  return { delta: current - base, current, base };
}
function trendText(metric, t) {
  if (!t) return 'Not enough history yet';
  const meta = METRICS[metric], sign = t.delta >= 0 ? '+' : '';
  let change = metric === 'steps' ? `${sign}${Math.round(t.delta).toLocaleString()}` : `${sign}${t.delta.toFixed(meta.decimals)}`;
  let meaning = 'vs earlier baseline';
  if (meta.better !== 0 && Math.abs(t.delta) > 1e-9) meaning = t.delta * meta.better > 0 ? 'moving favorably' : 'moving unfavorably';
  return `${change}${meta.unit ? ` ${meta.unit}` : ''} · ${meaning}`;
}

function buildShell() {
  const target = $('measurementsContent');
  if (!target || $('measurementsShell')) return;
  target.innerHTML = `<div id="measurementsShell" class="measurements-shell">
    <div id="measurementSummary" class="measurement-summary"></div>
    <div class="measurement-main">
      <section class="card measurement-chart-card">
        <div class="eyebrow">Longitudinal physiology</div><h2>Everything collected over time</h2>
        <div id="metricPicker" class="metric-picker"></div>
        <div class="measurement-chart-wrap"><svg id="measurementChart" class="measurement-chart" viewBox="0 0 760 270" preserveAspectRatio="none" role="img" aria-label="Measurement history chart"></svg></div>
        <div class="measurement-chart-caption"><span id="measurementRange">—</span><span>Click any point to inspect that day.</span></div>
      </section>
      <section class="card measurement-detail-card">
        <div class="eyebrow">Selected day</div><h2 id="measurementDetailTitle">Latest measurement</h2>
        <div id="measurementSelected" class="measurement-selected"></div>
        <div id="measurementMiniGrid" class="measurement-mini-grid"></div>
        <div id="measurementSourceNote" class="measurement-source-note"></div>
      </section>
    </div>
    <div class="history-grid">
      <section class="card"><div class="eyebrow">Recent measurements</div><h2>Day-by-day history</h2><div id="measurementTable"></div></section>
      <section class="card"><div class="eyebrow">Blood testing history</div><h2>Labs PulseLab has learned from</h2><div id="labHistory" class="lab-history"></div></section>
    </div>
  </div>`;
  $('metricPicker').innerHTML = Object.entries(METRICS).map(([key, meta]) => `<button type="button" class="metric-chip${key === selectedMetric ? ' active' : ''}" data-metric="${key}">${meta.short}</button>`).join('');
  $('metricPicker').addEventListener('click', event => {
    const button = event.target.closest('[data-metric]'); if (!button) return;
    selectedMetric = button.dataset.metric; selectedDate = null; render(true);
  });
}

function renderSummary(entries) {
  const picks = ['resting_hr', 'hrv', 'sleep_hours', 'steps'];
  $('measurementSummary').innerHTML = picks.map(metric => {
    const latest = [...entries].reverse().find(([, rec]) => Number.isFinite(Number(rec?.[metric])));
    const t = trend(metric, entries);
    return `<div class="measurement-summary-card"><span>${METRICS[metric].label}</span><strong>${latest ? formatValue(metric, Number(latest[1][metric])) : '—'}</strong><small>${trendText(metric, t)}</small></div>`;
  }).join('');
}

function chartSeries(entries, metric) {
  return entries.map(([date, rec]) => ({ date, value: Number(rec?.[metric]) })).filter(x => Number.isFinite(x.value)).slice(-90);
}
function renderChart(entries) {
  const svg = $('measurementChart'), data = chartSeries(entries, selectedMetric);
  const meta = METRICS[selectedMetric];
  document.querySelectorAll('.metric-chip').forEach(b => b.classList.toggle('active', b.dataset.metric === selectedMetric));
  if (!data.length) { svg.innerHTML = '<text x="380" y="135" text-anchor="middle" class="measurement-axis-label">No measurements for this signal yet.</text>'; return; }
  if (!selectedDate || !data.some(x => x.date === selectedDate)) selectedDate = data[data.length - 1].date;
  const W = 760, H = 270, pad = { l: 48, r: 18, t: 18, b: 30 };
  const values = data.map(x => x.value), rawMin = Math.min(...values), rawMax = Math.max(...values), span = Math.max(rawMax - rawMin, Math.abs(rawMax) * .03, 1e-3);
  const min = rawMin - span * .16, max = rawMax + span * .16;
  const x = i => pad.l + (W - pad.l - pad.r) * (data.length === 1 ? .5 : i / (data.length - 1));
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min));
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const grid = [0, .25, .5, .75, 1].map(frac => {
    const yy = pad.t + (H - pad.t - pad.b) * frac, val = max - (max - min) * frac;
    const label = selectedMetric === 'steps' ? Math.round(val).toLocaleString() : val.toFixed(meta.decimals);
    return `<line class="measurement-grid" x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}"></line><text class="measurement-axis-label" x="${pad.l - 8}" y="${yy + 3}" text-anchor="end">${label}</text>`;
  }).join('');
  const points = data.map((p, i) => `<circle class="measurement-point${p.date === selectedDate ? ' selected' : ''}" data-date="${p.date}" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${p.date === selectedDate ? 5.5 : 3.7}" tabindex="0" role="button"><title>${formatDate(p.date, true)}: ${formatValue(selectedMetric, p.value)}</title></circle>`).join('');
  svg.innerHTML = `${grid}<path class="measurement-area" d="${area}"></path><path class="measurement-line" d="${line}"></path>${points}<text class="measurement-axis-label" x="${pad.l}" y="${H - 8}">${formatDate(data[0].date)}</text><text class="measurement-axis-label" x="${W - pad.r}" y="${H - 8}" text-anchor="end">${formatDate(data[data.length - 1].date)}</text>`;
  svg.querySelectorAll('.measurement-point').forEach(point => {
    const select = () => { selectedDate = point.dataset.date; render(false); };
    point.addEventListener('click', select); point.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
  });
  $('measurementRange').textContent = `${meta.label} · ${data.length} recorded day${data.length === 1 ? '' : 's'} · ${trendText(selectedMetric, trend(selectedMetric, entries))}`;
}

function renderDetail(entries, synthetic) {
  const rec = entries.find(([date]) => date === selectedDate)?.[1] || entries[entries.length - 1]?.[1] || {};
  const date = selectedDate || entries[entries.length - 1]?.[0];
  const value = Number(rec?.[selectedMetric]);
  $('measurementDetailTitle').textContent = date ? formatDate(date, true) : 'No day selected';
  $('measurementSelected').innerHTML = `<div class="selected-date">${METRICS[selectedMetric].label}</div><strong>${formatValue(selectedMetric, value)}</strong><p>${trendText(selectedMetric, trend(selectedMetric, entries))}. This view is descriptive; it does not by itself diagnose a condition.</p>`;
  const minis = ['resting_hr', 'hrv', 'sleep_hours', 'steps'].filter(k => k !== selectedMetric).slice(0, 4);
  $('measurementMiniGrid').innerHTML = minis.map(metric => `<div class="measurement-mini"><span>${METRICS[metric].short}</span><strong>${formatValue(metric, Number(rec?.[metric]))}</strong></div>`).join('');
  $('measurementSourceNote').innerHTML = synthetic
    ? '<strong>Demo history:</strong> No saved wearable history was found, so this page is showing a clearly labeled synthetic longitudinal example. Connect WHOOP or load demo history to replace it with the profile stored by PulseLab.'
    : '<strong>Saved profile history:</strong> These points come from the wearable-day records stored by PulseLab in this browser (for example WHOOP sync or demo history you loaded).';
}
function renderTable(entries) {
  const rows = entries.slice(-14).reverse();
  $('measurementTable').innerHTML = rows.length ? `<table class="history-table"><thead><tr><th>Date</th><th>${METRICS[selectedMetric].short}</th><th>Sleep</th><th>Steps</th></tr></thead><tbody>${rows.map(([date, rec]) => `<tr><td>${formatDate(date)}</td><td>${formatValue(selectedMetric, Number(rec?.[selectedMetric]))}</td><td>${formatValue('sleep_hours', Number(rec?.sleep_hours))}</td><td>${formatValue('steps', Number(rec?.steps))}</td></tr>`).join('')}</tbody></table>` : '<div class="measurements-empty">No daily measurements have been collected yet.</div>';
}
function renderLabs(p) {
  const labs = labData(p);
  $('labHistory').innerHTML = labs.map(lab => `<div class="lab-history-row"><time>${formatDate(lab.date)}</time><div><strong>${lab.panel}</strong>${lab.synthetic ? '<div class="demo-tag">demo history</div>' : ''}</div><span class="lab-status${lab.abnormal ? ' abnormal' : ''}">${lab.abnormal ? 'abnormal' : 'normal'}</span></div>`).join('');
}

function render(force = false) {
  buildShell();
  const { entries, synthetic, profile: p } = historyData();
  const sig = `${selectedMetric}|${selectedDate || ''}|${entries.length}|${entries[entries.length - 1]?.[0] || ''}|${(p.lab_feedback || []).length}|${synthetic}`;
  if (!force && sig === lastSignature) return;
  lastSignature = sig;
  if (!entries.length) return;
  renderSummary(entries); renderChart(entries); renderDetail(entries, synthetic); renderTable(entries); renderLabs(p);
}

function boot() {
  buildShell(); render(true);
  window.addEventListener('pulselab:tab', e => { if (e.detail?.tab === 'measurements') render(true); });
  window.addEventListener('storage', render);
  document.addEventListener('input', () => setTimeout(() => render(true), 180));
  document.addEventListener('change', () => setTimeout(() => render(true), 180));
  setInterval(render, 1800);
}
boot();
