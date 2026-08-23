const $ = id => document.getElementById(id);

const state = {
  points: [],
  hr: 64,
  velocity: 0,
  phase: Math.random() * Math.PI * 2,
};

function finiteInput(id, fallback) {
  const el = $(id);
  const value = Number(el?.value);
  return Number.isFinite(value) && el?.value !== '' ? value : fallback;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function sourceLabel() {
  const connected = document.querySelector('.whoop-card')?.classList.contains('source-success');
  return connected ? 'WHOOP-ANCHORED · SYNTHETIC LIVE TRACE' : 'SYNTHETIC DEMO STREAM';
}

function makePoint() {
  const anchor = finiteInput('c_resting_hr', 64);
  state.phase += 0.14;
  state.velocity = state.velocity * 0.76 + (Math.random() - 0.5) * 1.2;
  const respiratoryWave = Math.sin(state.phase) * 1.7;
  const pull = (anchor - state.hr) * 0.08;
  const occasionalMotion = Math.random() < 0.025 ? 3 + Math.random() * 5 : 0;
  state.hr = clamp(state.hr + state.velocity * 0.35 + pull + respiratoryWave * 0.08 + occasionalMotion, 48, 118);
  state.points.push(state.hr);
  if (state.points.length > 72) state.points.shift();
}

function pathFor(points, width, height, pad = 9) {
  if (!points.length) return '';
  const min = Math.min(...points, 50) - 4;
  const max = Math.max(...points, 90) + 4;
  const range = Math.max(1, max - min);
  return points.map((value, index) => {
    const x = pad + (index / Math.max(1, points.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / range) * (height - pad * 2);
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function render() {
  if (!$('hrTrace')) return;
  const width = 700, height = 160;
  const path = pathFor(state.points, width, height);
  $('hrTrace').setAttribute('d', path);

  if ($('hrArea')) {
    const area = path ? `${path} L691,151 L9,151 Z` : '';
    $('hrArea').setAttribute('d', area);
  }

  const now = Math.round(state.hr);
  const min = Math.round(Math.min(...state.points));
  const max = Math.round(Math.max(...state.points));
  $('hrNow').textContent = now;
  $('hrRange').textContent = `${min}–${max} bpm over visible window`;
  $('telemetrySource').textContent = sourceLabel();
  $('telemetryClock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const hrvAnchor = finiteInput('c_hrv', 54);
  const respAnchor = finiteInput('c_respiratory_rate', 14.5);
  const spo2Anchor = finiteInput('c_spo2', 98);
  const tempAnchor = finiteInput('c_temperature_c', 36.6);
  $('telemetryHrv').textContent = `${Math.max(12, Math.round(hrvAnchor + (Math.random() - 0.5) * 2))} ms`;
  $('telemetryResp').textContent = `${clamp(respAnchor + (Math.random() - 0.5) * 0.25, 8, 28).toFixed(1)} /min`;
  $('telemetrySpo2').textContent = `${clamp(spo2Anchor + (Math.random() - 0.5) * 0.25, 88, 100).toFixed(1)}%`;
  $('telemetryTemp').textContent = `${clamp(tempAnchor + (Math.random() - 0.5) * 0.04, 32, 40).toFixed(2)} °C`;
}

function tick() {
  makePoint();
  render();
}

function bootTelemetry() {
  if (!$('hrTrace')) return;
  const anchor = finiteInput('c_resting_hr', 64);
  state.hr = anchor;
  for (let i = 0; i < 72; i += 1) {
    state.hr = clamp(anchor + Math.sin(i / 7) * 2 + (Math.random() - 0.5) * 2.6, 48, 118);
    state.points.push(state.hr);
  }
  render();
  setInterval(tick, 850);
}

bootTelemetry();
