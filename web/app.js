import { Board, TACTORS, SECTORS, SECTOR_IDS, norm, sectorOf, encodingFor } from './protocol.js';
import { SEQUENCES, buildSequence, seedFrom, parseCustom } from './sequences.js';
import { summarize, verdict, jitterStats, toCSV, ORIGINAL } from './report.js';

const $ = id => document.getElementById(id);
const board = new Board();

/* ---------------- state ---------------- */
let trials = [], idx = 0, rows = [], replays = 0,
    played = false, playedAt = 0, lastPlay = null,
    seed = 0, sessionId = '', duty = 255;

/* ---------------- tabs ---------------- */
const TABS = [['tab-run','v-run'], ['tab-cal','v-cal'], ['tab-rep','v-rep']];
for (const [t, v] of TABS) {
  $(t).onclick = () => {
    for (const [t2, v2] of TABS) {
      $(t2).setAttribute('aria-selected', String(t2 === t));
      $(v2).classList.toggle('hidden', v2 !== v);
    }
    if (v === 'v-rep') renderReport();
  };
}

/* ---------------- connection ---------------- */
function setLink(txt, cls) { const e = $('link'); e.textContent = txt; e.className = 'pill ' + cls; }

if (!Board.supported) { setLink('no Web Serial', 'no'); }
else { $('serialWarn').classList.remove('banner'); $('serialWarn').classList.add('banner','warn'); }

$('connect').onclick = async () => {
  if (board.connected) { await board.disconnect(); return; }
  try { await board.connect(); } catch (e) { setLink('connect failed', 'no'); log('! ' + e.message); }
};
board.addEventListener('open', () => {
  setLink('connected', 'ok');
  $('connect').textContent = 'Disconnect';
  $('stop').disabled = false; $('calPlay').disabled = false;
  board.info();
  refresh();
});
board.addEventListener('close', () => {
  setLink('disconnected', 'no');
  $('connect').textContent = 'Connect board';
  $('stop').disabled = true; $('calPlay').disabled = true;
  refresh();
});
board.addEventListener('line', ev => log(ev.detail));
$('stop').onclick = () => board.stop();

function log(line) {
  const tb = $('log');
  const tr = document.createElement('tr');
  const t = new Date().toLocaleTimeString();
  tr.innerHTML = `<td style="color:var(--muted);width:90px">${t}</td><td>${line}</td>`;
  tb.prepend(tr);
  while (tb.children.length > 200) tb.lastChild.remove();
}

/* ---------------- sequence picker ---------------- */
for (const [key, spec] of Object.entries(SEQUENCES)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = spec.label;
  $('seq').appendChild(o);
}
$('seq').value = 'test';

function syncSeqUI() {
  const spec = SEQUENCES[$('seq').value];
  $('seqNote').textContent = spec.note;
  $('customWrap').classList.toggle('hidden', $('seq').value !== 'custom');
  $('reps').value = spec.defaultReps;
}
$('seq').onchange = syncSeqUI;
syncSeqUI();

$('build').onclick = () => {
  const pid = $('pid').value.trim();
  if (!pid) { alert('Enter a participant ID first.'); return; }
  const type = $('seq').value;
  const reps = Math.max(1, Math.min(10, +$('reps').value || 1));
  seed = seedFrom(`${pid}|${type}|${reps}`);
  trials = buildSequence({ type, reps, seed, customText: $('custom').value });
  if (!trials.length) { alert('That sequence is empty — check the custom angle list.'); return; }
  idx = 0; replays = 0; played = false;
  sessionId = `${pid}-${type}-${new Date().toISOString().slice(0,16).replace(/[:T-]/g,'')}`;
  $('seqInfo').textContent = `${trials.length} trials · seed ${seed} · session ${sessionId}`;
  $('feedback').textContent = '';
  refresh();
};

/* ---------------- running trials ---------------- */
const current = () => trials[idx] || null;

async function play(isReplay) {
  const t = current();
  if (!t || !board.connected) return;
  $('play').disabled = $('replay').disabled = true;
  $('prompt').textContent = 'Playing…';
  try {
    lastPlay = await board.play(t.angle);
    played = true;
    playedAt = performance.now();
    if (isReplay) replays++;
    $('prompt').textContent = 'Click the direction you felt.';
  } catch (e) {
    $('prompt').textContent = 'No reply from the board — check the cable and try again.';
    log('! play: ' + e.message);
  }
  refresh();
}
$('play').onclick   = () => play(false);
$('replay').onclick = () => play(true);
$('skip').onclick   = () => { idx++; replays = 0; played = false; $('feedback').textContent = ''; refresh(); };

function record(responseAngle) {
  const t = current();
  if (!t || !played) return;
  const err = norm(responseAngle - t.angle);
  const spec = SEQUENCES[$('seq').value];

  rows.push({
    participant: $('pid').value.trim(),
    session_id: sessionId,
    sequence: $('seq').value,
    block_feedback: spec.feedback ? 1 : 0,
    trial: rows.length + 1,
    rep: t.rep,
    true_angle: t.angle,
    true_sector: sectorOf(t.angle),
    response_angle: Math.round(responseAngle),
    response_sector: sectorOf(responseAngle),
    signed_error: Math.round(err),
    abs_error: Math.abs(Math.round(err)),
    sector_correct: sectorOf(responseAngle) === sectorOf(t.angle) ? 1 : 0,
    within10: Math.abs(err) <= 10 ? 1 : 0,
    within20: Math.abs(err) <= 20 ? 1 : 0,
    replays,
    cmd_sent_ms: lastPlay ? Math.round(lastPlay.hostSendMs) : null,
    stim_start_us: lastPlay?.startUs ?? '',
    stim_end_us: lastPlay?.endUs ?? '',
    onset_latency_ms: lastPlay?.onsetLatencyMs != null
      ? +lastPlay.onsetLatencyMs.toFixed(1) : null,
    stim_duration_ms: lastPlay?.durationMs != null
      ? +lastPlay.durationMs.toFixed(1) : null,
    rt_ms: Math.round(performance.now() - playedAt),
    iso_time: new Date().toISOString(),
    order_seed: seed,
    drive_duty: duty,
  });
  save();

  const r = rows[rows.length - 1];
  $('feedback').innerHTML = spec.feedback
    ? `true <b>${t.angle}°</b> · response <b>${r.response_angle}°</b> · ` +
      `${r.sector_correct ? 'correct sector' : '<span style="color:var(--red)">wrong sector</span>'}` +
      ` · ${r.signed_error >= 0 ? '+' : ''}${r.signed_error}°`
    : `logged · ${rows.length} of ${trials.length}`;

  idx++; replays = 0; played = false;
  refresh();
  if (idx >= trials.length) $('prompt').textContent = 'Sequence complete — open the Report tab.';
}

function refresh() {
  const live = board.connected, more = idx < trials.length;
  $('play').disabled   = !(live && more && !played);
  $('replay').disabled = !(live && more && played);
  $('skip').disabled   = !more;
  $('counter').textContent = trials.length ? `${Math.min(idx + 1, trials.length)}/${trials.length}` : '—';
  $('nRows').textContent = rows.length ? `· ${rows.length} logged` : '';
  if (live && more && !played) $('prompt').textContent = 'Press play, then click the direction felt.';
  if (!live) $('prompt').textContent = 'Connect the board to begin.';
  renderLive();
}

function renderLive() {
  $('live').querySelector('tbody').innerHTML = rows.slice().reverse().slice(0, 120).map(r => `
    <tr><td>${r.trial}</td><td>${r.true_angle}°</td><td>${r.true_sector}</td>
    <td>${r.response_angle}°</td><td>${r.response_sector}</td>
    <td class="num">${r.signed_error >= 0 ? '+' : ''}${r.signed_error}°</td>
    <td>${r.within10 ? '✓' : ''}</td><td>${r.within20 ? '✓' : ''}</td>
    <td class="num">${r.rt_ms}</td><td class="num">${r.replays}</td></tr>`).join('');
}

/* ---------------- dial ---------------- */
const DIAL = $('dial'), CX = 180, CY = 180, R = 140;
const pol = (deg, r) => [CX + r * Math.sin(deg * Math.PI / 180), CY - r * Math.cos(deg * Math.PI / 180)];

(function drawDial() {
  let g = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="#fff" stroke="#D8DCF0"/>`;
  for (const s of SECTORS) {
    const [x1, y1] = pol(s.lo, R), [x2, y2] = pol(s.hi, R);
    g += `<path d="M${CX},${CY} L${x1},${y1} A${R},${R} 0 0,1 ${x2},${y2} Z"
           fill="${s.id === 'F' ? '#EDEFFA' : '#FCFDFF'}" stroke="#D8DCF0"/>`;
    const [lx, ly] = pol((s.lo + s.hi) / 2, R * 0.74);
    g += `<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="11"
           font-family="var(--mono)" fill="#6A6A8E">${s.id}</text>`;
  }
  for (const d of [0, 30, 90, 150, 180, -150, -90, -30]) {
    const [tx, ty] = pol(d, R + 14);
    g += `<text x="${tx}" y="${ty + 4}" text-anchor="middle" font-size="10"
           font-family="var(--mono)" fill="#6A6A8E">${d}°</text>`;
  }
  g += `<circle cx="${CX}" cy="${CY}" r="4" fill="#2A1DB5"/>`;
  g += `<text x="${CX}" y="${CY - R + 28}" text-anchor="middle" font-size="11"
         font-family="var(--mono)" fill="#2A1DB5">AHEAD</text><g id="mark"></g>`;
  DIAL.innerHTML = g;
})();

DIAL.addEventListener('click', ev => {
  if (!played) return;
  const b = DIAL.getBoundingClientRect();
  const x = (ev.clientX - b.left) * (360 / b.width) - CX;
  const y = (ev.clientY - b.top) * (360 / b.height) - CY;
  if (Math.hypot(x, y) > R) return;
  const a = norm(Math.atan2(x, -y) * 180 / Math.PI);
  const [mx, my] = pol(a, R * 0.92);
  DIAL.querySelector('#mark').innerHTML =
    `<line x1="${CX}" y1="${CY}" x2="${mx}" y2="${my}" stroke="#EE8B2B" stroke-width="3"/>`;
  record(a);
  setTimeout(() => { const m = DIAL.querySelector('#mark'); if (m) m.innerHTML = ''; }, 650);
});

/* ---------------- calibrate ---------------- */
for (const t of TACTORS) {
  const b = document.createElement('button');
  b.className = 'b ghost';
  b.textContent = `${t.id} · pin ${t.pin}`;
  b.onclick = () => board.testChannel(t.ch, +$('chMs').value || 600);
  $('chBtns').appendChild(b);
}
$('duty').oninput = e => { $('dutyVal').textContent = e.target.value; };
$('dutySend').onclick = () => { duty = +$('duty').value; board.setDuty(duty); };
$('calAngle').oninput = () => {
  const e = encodingFor(+$('calAngle').value || 0);
  $('calPreview').textContent = `${e.desc} · ${e.totalMs} ms total`;
};
$('calAngle').dispatchEvent(new Event('input'));
$('calPlay').onclick = () => board.play(+$('calAngle').value || 0).catch(e => log('! ' + e.message));

/* ---------------- report ---------------- */
function pct(x) { return (100 * x).toFixed(1) + '%'; }

function renderReport() {
  const s = summarize(rows);
  $('repEmpty').classList.toggle('hidden', !!s);
  $('repBody').classList.toggle('hidden', !s);
  if (!s) return;

  const claimCard = (id, value, ci, origKey) => {
    const o = ORIGINAL[origKey];
    const v = verdict(ci, o.value);
    return `<div class="claim">
      <div class="id">${id}</div>
      <div class="lbl">${o.label}</div>
      <div class="v">${pct(value)}</div>
      <div class="ci">${ci ? `95% CI ${pct(ci[0])} – ${pct(ci[1])}` : 'CI needs ≥ 2 trials'}</div>
      <div class="orig">original ${pct(o.value)} · ${v.text}</div>
    </div>`;
  };

  const c4 = s.C4;
  const c4card = `<div class="claim">
    <div class="id">C4</div>
    <div class="lbl">${ORIGINAL.C4.label}</div>
    <div class="v" style="font-size:19px">${
      c4.matches == null ? '—' : c4.matches ? 'pattern holds' : 'pattern differs'}</div>
    <div class="ci">top ${c4.topMean == null ? '—' : (c4.topMean >= 0 ? '+' : '') + c4.topMean.toFixed(1) + '°'}
      · bottom ${c4.botMean == null ? '—' : (c4.botMean >= 0 ? '+' : '') + c4.botMean.toFixed(1) + '°'}</div>
    <div class="orig">original: top negative, bottom positive</div>
  </div>`;

  $('claims').innerHTML =
    claimCard('C1', s.C1.value, s.C1.ci, 'C1') +
    claimCard('C2', s.C2.value, s.C2.ci, 'C2') +
    claimCard('C3', s.C3.value, s.C3.ci, 'C3') + c4card;

  const maxAbs = Math.max(1, ...s.bySector.map(b => Math.abs(b.meanSigned ?? 0)));
  $('bySector').querySelector('tbody').innerHTML = s.bySector.map(b => {
    if (!b.n) return `<tr><td>${b.name}</td><td class="num">0</td><td colspan="4"
      style="color:var(--muted)">no trials</td></tr>`;
    const w = Math.round(70 * Math.abs(b.meanSigned) / maxAbs);
    const bar = `<span class="bar ${b.meanSigned < 0 ? 'neg' : 'pos'}" style="width:${w}px"></span>`;
    return `<tr><td>${b.name}</td><td class="num">${b.n}</td>
      <td class="num">${b.meanSigned >= 0 ? '+' : ''}${b.meanSigned.toFixed(1)}°</td>
      <td>${bar}</td><td class="num">${b.meanAbs.toFixed(1)}°</td>
      <td class="num">${pct(b.acc)}</td></tr>`;
  }).join('');

  $('conf').querySelector('tbody').innerHTML =
    `<tr><th></th>${SECTOR_IDS.map(c => `<th class="num">${c}</th>`).join('')}</tr>` +
    s.confusion.map((row, i) => `<tr><th>${SECTOR_IDS[i]}</th>` +
      row.map((v, j) => `<td class="num ${i === j && v ? 'd' : v ? '' : 'z'}">${v || '·'}</td>`).join('') +
      '</tr>').join('');

  const j = jitterStats(rows);
  $('apparatus').querySelector('tbody').innerHTML = [
    ['trials logged', s.n],
    ['participants', s.participants.join(', ') || '—'],
    ['mean absolute error', s.meanAbsError.toFixed(1) + '°'],
    ['replays requested', s.replays],
    ['onset latency, mean', j ? j.mean.toFixed(1) + ' ms' : '—'],
    ['onset latency, sd', j ? j.sd.toFixed(1) + ' ms' : '—'],
    ['onset latency, p95', j ? j.p95.toFixed(1) + ' ms' : '—'],
    ['onset latency, max', j ? j.max.toFixed(1) + ' ms' : '—'],
    ['gate — p95 under 20 ms', j ? (j.p95 < 20 ? 'pass' : 'FAIL') : '—'],
  ].map(([k, v]) => `<tr><td style="color:var(--muted)">${k}</td><td class="num">${v}</td></tr>`).join('');
}

/* ---------------- persistence + export ---------------- */
const KEY = () => `g18:${$('pid').value.trim()}:${$('seq').value}`;
function save() { try { localStorage.setItem(KEY(), JSON.stringify(rows)); } catch (e) {} }
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
}
$('csv').onclick  = () => download(`${sessionId || 'session'}.csv`, toCSV(rows), 'text/csv');
$('json').onclick = () => download(`${sessionId || 'session'}.json`,
  JSON.stringify({ sessionId, seed, sequence: $('seq').value, duty,
                   generated: new Date().toISOString(), rows }, null, 2), 'application/json');
$('clear').onclick = () => {
  if (!confirm('Delete the responses logged in this session?')) return;
  rows = []; try { localStorage.removeItem(KEY()); } catch (e) {}
  renderLive(); renderReport(); refresh();
};

refresh();
