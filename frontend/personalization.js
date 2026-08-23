const STORAGE_KEY = 'pulselab-personal-profile-v1';
const PANEL_KEYS = ['any_abnormal', 'glycemic', 'cbc', 'metabolic', 'lipid'];
const METRIC_KEYS = ['resting_hr','hrv','sleep_hours','steps','temperature_c','spo2','respiratory_rate','cgm_mean','cgm_cv'];

function clamp(x, a = 0, b = 1) { return Math.max(a, Math.min(b, x)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function logit(p) { const q = clamp(Number(p) || 0.5, 1e-5, 1 - 1e-5); return Math.log(q / (1 - q)); }
function median(xs) { const a = xs.filter(Number.isFinite).slice().sort((x,y)=>x-y); if (!a.length) return null; const m = Math.floor(a.length/2); return a.length%2 ? a[m] : (a[m-1]+a[m])/2; }
function localDateKey(date = new Date()) { const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,'0'); const d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }

function blankProfile() {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    wearable_days: {},
    panel_offsets: Object.fromEntries(PANEL_KEYS.map(k => [k, 0])),
    panel_feedback_counts: Object.fromEntries(PANEL_KEYS.map(k => [k, 0])),
    lab_feedback: [],
    last_import: null
  };
}

export function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1) return blankProfile();
    return { ...blankProfile(), ...parsed };
  } catch (_) { return blankProfile(); }
}

export function saveProfile(profile) { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }
export function clearProfile() { localStorage.removeItem(STORAGE_KEY); return blankProfile(); }

function cleanMetrics(current) {
  const clean = {};
  for (const k of METRIC_KEYS) if (Number.isFinite(current?.[k])) clean[k] = Number(current[k]);
  return clean;
}

function trimHistory(profile) {
  const keys = Object.keys(profile.wearable_days || {}).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - 180))) delete profile.wearable_days[old];
}

export function observeToday(profile, current, date = new Date()) {
  const clean = cleanMetrics(current);
  if (!Object.keys(clean).length) return profile;
  const key = localDateKey(date);
  profile.wearable_days ||= {};
  profile.wearable_days[key] = { ...(profile.wearable_days[key] || {}), ...clean };
  trimHistory(profile);
  saveProfile(profile);
  return profile;
}

export function importWearableHistory(profile, records, source = 'import') {
  profile.wearable_days ||= {};
  let imported = 0;
  for (const rec of records || []) {
    const date = rec?.date instanceof Date ? rec.date : new Date(rec?.date);
    if (!Number.isFinite(date.getTime())) continue;
    const clean = cleanMetrics(rec);
    if (!Object.keys(clean).length) continue;
    const key = localDateKey(date);
    profile.wearable_days[key] = { ...(profile.wearable_days[key] || {}), ...clean };
    imported += 1;
  }
  trimHistory(profile);
  profile.last_import = { source, rows: imported, at: new Date().toISOString() };
  saveProfile(profile);
  return { profile, imported };
}

function priorValues(profile, metric, today = localDateKey()) {
  return Object.entries(profile.wearable_days || {})
    .filter(([date, rec]) => date < today && Number.isFinite(rec?.[metric]))
    .sort(([a],[b]) => a.localeCompare(b))
    .slice(-60)
    .map(([, rec]) => Number(rec[metric]));
}

export function getPersonalBaseline(profile, manualBaseline = {}, current = {}) {
  const baseline = {};
  const stats = {};
  let learnedSignals = 0;
  for (const k of METRIC_KEYS) {
    const values = priorValues(profile, k);
    const med = median(values);
    const mad = med == null ? null : median(values.map(v => Math.abs(v - med)));
    const n = values.length;
    const confidence = clamp(n / 14);
    const fallback = Number.isFinite(manualBaseline?.[k]) ? Number(manualBaseline[k]) : (Number.isFinite(current?.[k]) ? Number(current[k]) : null);
    const value = med == null ? fallback : (fallback == null ? med : confidence * med + (1 - confidence) * fallback);
    if (Number.isFinite(value)) baseline[k] = value;
    stats[k] = { n, median: med, mad: mad == null ? null : mad * 1.4826, confidence };
    if (n >= 3) learnedSignals += 1;
  }
  return { baseline, stats, learnedSignals };
}

export function personalizeProbabilities(globalProbs, profile) {
  const out = {};
  for (const k of PANEL_KEYS) {
    const n = Number(profile.panel_feedback_counts?.[k] || 0);
    const alpha = n / (n + 4);
    const offset = Number(profile.panel_offsets?.[k] || 0);
    out[k] = sigmoid(logit(globalProbs[k]) + alpha * offset);
  }
  return out;
}

export function recordLabFeedback(profile, panel, outcome, globalProbs) {
  if (!PANEL_KEYS.includes(panel)) throw new Error('Unknown panel');
  const y = outcome === 'abnormal' || outcome === 1 || outcome === true ? 1 : 0;
  const pGlobal = clamp(Number(globalProbs?.[panel] ?? 0.5), 1e-4, 1 - 1e-4);
  const n = Number(profile.panel_feedback_counts?.[panel] || 0);
  const alpha = n / (n + 4);
  const currentOffset = Number(profile.panel_offsets?.[panel] || 0);
  const pPersonal = sigmoid(logit(pGlobal) + alpha * currentOffset);
  const eta = 1.1 / Math.sqrt(n + 1);
  const nextOffset = clamp(currentOffset + eta * (y - pPersonal) - 0.04 * currentOffset, -3, 3);
  profile.panel_offsets[panel] = nextOffset;
  profile.panel_feedback_counts[panel] = n + 1;
  profile.lab_feedback ||= [];
  profile.lab_feedback.push({ panel, outcome: y, p_global: pGlobal, p_before: pPersonal, at: new Date().toISOString() });
  profile.lab_feedback = profile.lab_feedback.slice(-100);
  saveProfile(profile);
  return profile;
}

export function personalizationStatus(profile) {
  const dayCount = Object.keys(profile.wearable_days || {}).length;
  const labCount = (profile.lab_feedback || []).length;
  let stage = 'Population prior';
  if (dayCount >= 3 || labCount >= 1) stage = 'Learning you';
  if (dayCount >= 14 || labCount >= 3) stage = 'Personalized';
  if (dayCount >= 30 && labCount >= 5) stage = 'Highly personalized';
  const wearableConfidence = clamp(dayCount / 21);
  const feedbackConfidence = clamp(labCount / 6);
  const confidence = Math.round((0.7 * wearableConfidence + 0.3 * feedbackConfidence) * 100);
  return { dayCount, labCount, stage, confidence };
}

export function seedDemoHistory(profile) {
  const today = new Date();
  const base = { resting_hr:58, hrv:56, sleep_hours:7.5, steps:9200, temperature_c:36.5, spo2:98, respiratory_rate:14 };
  for (let i = 14; i >= 1; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const wobble = (i % 5) - 2;
    profile.wearable_days[localDateKey(d)] = {
      resting_hr: base.resting_hr + wobble * 0.35,
      hrv: base.hrv - wobble * 0.8,
      sleep_hours: base.sleep_hours + wobble * 0.06,
      steps: base.steps + wobble * 180,
      temperature_c: base.temperature_c + wobble * 0.015,
      spo2: base.spo2,
      respiratory_rate: base.respiratory_rate + wobble * 0.05
    };
  }
  saveProfile(profile);
  return profile;
}
