const $ = (id) => document.getElementById(id);

async function boot() {
  const data = await fetch('demo_data.json').then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  const select = $('scenario');
  data.scenarios.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = s.name;
    select.appendChild(o);
  });
  select.value = data.scenarios.length - 1;
  select.addEventListener('change', () => render(data.scenarios[+select.value], data.sources));
  render(data.scenarios[+select.value], data.sources);
}

function pct(x) { return `${Math.round(x * 100)}%`; }
function statusClass(s) { return s === 'TEST NOW' ? 'status-test' : s === 'WATCH' ? 'status-watch' : 'status-no'; }

function render(s, sources) {
  const d = s.decision;
  $('status').textContent = d.status;
  $('status').className = statusClass(d.status);
  $('score').textContent = pct(d.priority);
  $('scoreRing').style.setProperty('--score-angle', `${d.priority * 360}deg`);
  $('subtitle').textContent = s.subtitle;
  $('confidence').textContent = pct(d.confidence);
  $('anomaly').textContent = pct(d.anomaly_score);
  $('days').textContent = `${s.days_since_last_draw} days ago`;
  $('recommendation').innerHTML = d.recommended_panel.length
    ? `<strong>Suggested next panel:</strong> ${d.recommended_panel.join(' + ')}`
    : `<strong>No immediate panel.</strong> Keep monitoring; retest only if the trajectory persists.`;
  renderTimeline(s.timeline);
  renderLabs(d.lab_predictions);
  renderReasons(d.evidence);
  renderSources(sources, d.evidence);
}

function renderTimeline(rows) {
  const W = 720, H = 230, pad = {l: 34, r: 14, t: 18, b: 27};
  const xs = rows.map((_, i) => pad.l + i * ((W - pad.l - pad.r) / (rows.length - 1)));
  const metrics = [
    {key:'rhr', cls:'line-rhr', min:50, max:78, point:'#1a2a21'},
    {key:'hrv', cls:'line-hrv', min:25, max:75, point:'#6f756e'},
    {key:'sleep', cls:'line-sleep', min:4.8, max:8.2, point:'#b8bdb5'}
  ];
  const y = (v, min, max) => pad.t + (max - v) / (max - min) * (H - pad.t - pad.b);
  const path = (m) => rows.map((r, i) => `${i ? 'L' : 'M'} ${xs[i].toFixed(1)} ${y(r[m.key], m.min, m.max).toFixed(1)}`).join(' ');
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  [0,.25,.5,.75,1].forEach(t => {
    const yy = pad.t + t * (H - pad.t - pad.b);
    svg += `<line class="gridline" x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/>`;
  });
  metrics.forEach(m => {
    svg += `<path d="${path(m)}" class="${m.cls}"/>`;
    rows.forEach((r, i) => svg += `<circle class="point" fill="${m.point}" cx="${xs[i]}" cy="${y(r[m.key],m.min,m.max)}" r="3.6"/>`);
  });
  rows.forEach((r, i) => svg += `<text class="axis-label" x="${xs[i]}" y="${H-6}" text-anchor="middle">${r.day === 0 ? 'Today' : `${Math.abs(r.day)}d`}</text>`);
  svg += `</svg>`;
  $('timeline').innerHTML = svg;
}

function renderLabs(labs) {
  $('labs').innerHTML = labs.slice().sort((a,b) => b.probability_changed - a.probability_changed).map(l => {
    const value = l.predicted_value == null ? '' : `${l.predicted_value}${l.unit ? ' ' + l.unit : ''}`;
    const previous = l.previous_value == null ? '' : `last ${l.previous_value}`;
    return `<div class="lab-row">
      <div><div class="lab-name">${l.lab}</div><div class="lab-meta">${l.domain}</div></div>
      <div><div class="bar"><span style="width:${Math.round(l.probability_changed*100)}%"></span></div><div class="lab-meta">predicted ${value} · ${previous}</div></div>
      <div class="lab-prob">${pct(l.probability_changed)} changed</div>
    </div>`;
  }).join('');
}

function renderReasons(evidence) {
  const sorted = evidence.slice().sort((a,b) => b.weighted - a.weighted).slice(0,5);
  $('reasons').innerHTML = sorted.map((e,i) => `<div class="reason"><div class="reason-icon">${i+1}</div><p><strong>${e.source}</strong><br>${e.reason}</p></div>`).join('');
}

function renderSources(sources, evidence) {
  const eMap = Object.fromEntries(evidence.map(e => [e.source.toLowerCase(), e]));
  $('sources').innerHTML = sources.map(s => {
    let strength = null;
    for (const [k,e] of Object.entries(eMap)) {
      if (s.name.toLowerCase().includes(k.split(' ')[0]) || k.includes(s.name.toLowerCase().split(' ')[0])) strength = e.score;
    }
    return `<div class="source">
      <div class="source-top"><strong>${s.name}</strong><span class="state ${s.public ? '' : 'restricted'}">${s.public ? 'public' : 'restricted'}</span></div>
      <p>${s.role}</p>
      <div class="modalities">${s.modalities.slice(0,4).join(' · ')}${s.modalities.length > 4 ? ' · …' : ''}</div>
      ${strength == null ? '' : `<div class="lab-meta" style="margin-top:8px">current evidence ${pct(strength)}</div>`}
    </div>`;
  }).join('');
}

boot().catch(err => {
  document.body.innerHTML = `<pre style="padding:30px">Could not load demo_data.json\n${err}\n\nRun: python -m http.server 8080 -d frontend</pre>`;
});
