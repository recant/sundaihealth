const CHAT_HISTORY_LIMIT = 8;
const chatHistory = [];
let chatBusy = false;

const $ = id => document.getElementById(id);

function text(id) {
  return $(id)?.textContent?.trim() || '';
}

function inputValue(id) {
  const el = $(id);
  if (!el || el.value === '') return null;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : el.value;
}

function collectCurrentMetrics() {
  const keys = [
    'resting_hr','hrv','sleep_hours','steps','temperature_c','spo2',
    'respiratory_rate','cgm_mean','cgm_cv'
  ];
  const out = {};
  for (const key of keys) {
    const value = inputValue(`c_${key}`);
    if (value !== null) out[key] = value;
  }
  return out;
}

function collectBaselineMetrics() {
  const keys = [
    'resting_hr','hrv','sleep_hours','steps','temperature_c','spo2',
    'respiratory_rate','cgm_mean','cgm_cv'
  ];
  const out = {};
  for (const key of keys) {
    const value = inputValue(`b_${key}`);
    if (value !== null) out[key] = value;
  }
  return out;
}

function collectList(selector, max = 5) {
  return [...document.querySelectorAll(selector)]
    .map(el => el.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max);
}

function dashboardSnapshot() {
  const score = Number(text('score'));
  const telemetrySource = text('telemetrySource');
  return {
    recommendation: text('recommendation') || 'No wearable-driven recommendation yet',
    score: Number.isFinite(score) ? score : null,
    headline: text('headline'),
    summary: text('summary'),
    model: text('modelUsed'),
    personalization_stage: text('profileStage'),
    personalization_confidence: text('profileConfidence'),
    wearable_days: text('profileDays'),
    blood_results_seen: text('profileLabs'),
    reasons: collectList('#reasons .reason'),
    ranked_tests: collectList('#tests .test-item'),
    current_metrics: collectCurrentMetrics(),
    manual_starting_baseline: collectBaselineMetrics(),
    persistence_days: inputValue('persistence'),
    days_since_last_blood_test: inputValue('lastBlood'),
    telemetry: {
      source: telemetrySource,
      synthetic: /synthetic/i.test(telemetrySource),
      heart_rate_now: text('hrNow') ? `${text('hrNow')} bpm` : null,
      hrv_display: text('telemetryHrv') || null,
      respiratory_rate_display: text('telemetryResp') || null,
      spo2_display: text('telemetrySpo2') || null,
      skin_temperature_display: text('telemetryTemp') || null,
    },
    important_interpretation: 'PulseLab predicts expected blood-testing yield. It is not a diagnosis or a validated doctor/ER triage score.'
  };
}

function localFallback(message, snapshot = dashboardSnapshot()) {
  const q = String(message || '').toLowerCase();
  const severe = /(chest pain|chest pressure|can't breathe|cannot breathe|severe shortness of breath|faint(ed|ing)?|passed out|confusion|one[- ]sided weakness|severe bleeding)/i.test(message || '');
  if (severe) {
    return 'Those symptoms can require prompt medical evaluation. PulseLab is not designed to decide whether an emergency symptom is safe to watch at home, so do not rely on its testing score for that decision. Seek urgent/emergency medical care now if the symptom is severe or ongoing.';
  }
  if (/(doctor|physician|urgent care|\ber\b|emergency)/i.test(q)) {
    const scoreText = Number.isFinite(snapshot.score) ? ` Its testing-priority score is ${snapshot.score}/100.` : '';
    return `${snapshot.recommendation}.${scoreText} That result estimates whether blood testing may be informative; it does not determine whether you medically need a doctor. A quiet score cannot rule out illness. If you have new, persistent, worsening, or concerning symptoms, clinician evaluation can still be appropriate. What symptoms, if any, are you having right now?`;
  }
  if (/(why.*(not|no)|shouldn.t|should not|no test|not recommending)/i.test(q)) {
    return `PulseLab is only saying it does not currently see a strong wearable-driven reason for blood testing. It is not saying that nothing is wrong or that you should avoid a doctor. ${snapshot.summary || 'The model combines population-level prediction with deviation from the person’s baseline.'}`;
  }
  if (/(what changed|baseline|why now|driver)/i.test(q)) {
    const reasons = snapshot.reasons?.length ? snapshot.reasons.join(' ') : 'No model drivers are displayed yet.';
    return `PulseLab compares today's physiology with the learned personal baseline. The strongest displayed drivers are: ${reasons} The synthetic moving telemetry is visualization only and is not treated as clinical evidence.`;
  }
  if (/(which.*test|blood test|panel)/i.test(q) && snapshot.ranked_tests?.length) {
    return `The current ranking is: ${snapshot.ranked_tests.join(' ')} These are model estimates of expected testing yield, not medical orders.`;
  }
  return `${snapshot.recommendation}. ${snapshot.summary || 'PulseLab combines a population-trained blood-testing model with a personal wearable baseline.'} Ask me what changed, why a test is ranked highly, or what this result does—and does not—say about seeing a doctor.`;
}

function ensureChatStyles() {
  if (document.querySelector('link[data-pulselab-chat]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './chat.css';
  link.dataset.pulselabChat = '1';
  document.head.appendChild(link);
}

function buildChat() {
  const results = document.querySelector('.results');
  if (!results || $('pulseChat')) return;

  const card = document.createElement('section');
  card.id = 'pulseChat';
  card.className = 'card chat-card';
  card.innerHTML = `
    <div class="chat-header">
      <div>
        <div class="eyebrow">Ask PulseLab</div>
        <h2>Talk through the recommendation.</h2>
      </div>
      <span class="chat-context-pill">Reads current model state</span>
    </div>
    <div class="chat-intro">
      Ask whether the dashboard suggests seeing a doctor, what changed from your baseline, or why a blood test is—or is not—being surfaced. The chat explains BloodNeedNet; it does not replace medical care.
    </div>
    <div id="chatSuggestions" class="chat-suggestions">
      <button type="button" data-chat-prompt="Does this mean I should see a doctor?">Should I see a doctor?</button>
      <button type="button" data-chat-prompt="Why aren't you recommending blood testing right now?">Why no test?</button>
      <button type="button" data-chat-prompt="What changed from my baseline?">What changed?</button>
      <button type="button" data-chat-prompt="Which blood test is most relevant and why?">Which test matters?</button>
    </div>
    <div id="chatMessages" class="chat-messages" aria-live="polite">
      <div class="chat-row assistant">
        <div class="chat-avatar">P</div>
        <div class="chat-bubble">I can explain what the current PulseLab result means and what it does not mean. I won't treat a low score as proof that you don't need medical care.</div>
      </div>
    </div>
    <form id="chatForm" class="chat-form">
      <textarea id="chatInput" rows="2" maxlength="2000" placeholder="Ask about your current result…" aria-label="Ask PulseLab about the current result"></textarea>
      <button id="chatSend" type="submit">Send</button>
    </form>
    <div class="chat-foot">
      <span id="chatMode">Model-aware explanation layer</span>
      <span>For severe or rapidly worsening symptoms, seek medical care rather than relying on this prototype.</span>
    </div>
  `;
  results.appendChild(card);

  card.querySelectorAll('[data-chat-prompt]').forEach(button => {
    button.addEventListener('click', () => sendChat(button.dataset.chatPrompt || ''));
  });
  $('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    const message = $('chatInput').value.trim();
    if (message) sendChat(message);
  });
  $('chatInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const message = $('chatInput').value.trim();
      if (message) sendChat(message);
    }
  });
}

function appendMessage(role, content, pending = false) {
  const wrap = document.createElement('div');
  wrap.className = `chat-row ${role}${pending ? ' pending' : ''}`;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = 'P';
    wrap.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = content;
  wrap.appendChild(bubble);

  $('chatMessages').appendChild(wrap);
  $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
  return wrap;
}

function setBusy(value) {
  chatBusy = value;
  $('chatSend').disabled = value;
  $('chatInput').disabled = value;
  $('chatSend').textContent = value ? 'Thinking…' : 'Send';
}

async function sendChat(message) {
  const clean = String(message || '').trim();
  if (!clean || chatBusy) return;

  appendMessage('user', clean);
  chatHistory.push({ role: 'user', text: clean });
  while (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
  $('chatInput').value = '';
  setBusy(true);

  const snapshot = dashboardSnapshot();
  const pending = appendMessage('assistant', 'Reading the current model state…', true);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: clean,
        snapshot,
        history: chatHistory.slice(0, -1),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Chat failed (${response.status})`);

    const reply = String(data.reply || localFallback(clean, snapshot)).trim();
    pending.querySelector('.chat-bubble').textContent = reply;
    pending.classList.remove('pending');
    chatHistory.push({ role: 'assistant', text: reply });
    while (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
    $('chatMode').textContent = data.mode === 'gemini'
      ? `${data.model || 'Gemini'} · dashboard-aware explanation`
      : 'Local safety explainer · Gemini optional';
  } catch (_) {
    const reply = localFallback(clean, snapshot);
    pending.querySelector('.chat-bubble').textContent = reply;
    pending.classList.remove('pending');
    chatHistory.push({ role: 'assistant', text: reply });
    while (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
    $('chatMode').textContent = 'Local safety explainer · server chat unavailable';
  } finally {
    setBusy(false);
    $('chatInput').focus();
  }
}

function bootChat() {
  ensureChatStyles();
  buildChat();
}

bootChat();
