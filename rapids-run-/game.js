// ---- Constants ----
const CANVAS_W = 1280;
const CANVAS_H = 720;
const LANE_COUNT = 3;
const LANE_X = [320, 640, 960];
const RAFT_Y = 620;
const GATE_SPAWN_Y = 70;
const APPROACH_WINDOW = 3.2; // seconds a gate is visible before it resolves

const RUN_DURATION = 52;
// Arithmetic sequence of 8 approach-intervals summing to 52s, decreasing
// (8.6 -> 4.4) so the run visibly speeds up toward the end.
const GATE_TIMES = [8.6, 16.6, 24.0, 30.8, 37.0, 42.6, 47.6, 52.0];
const TOTAL_GATES = GATE_TIMES.length;

const START_SCORE = 1000;
const STEER_LERP = 10; // higher = snappier smoothing toward target lane
const DODGE_DURATION = 1;
const DODGE_COOLDOWN = 1.5;

const CHARACTERS = [
  { name: 'Blue Rafter', color: '#4da8ff' },
  { name: 'Red Rafter', color: '#ff5d5d' },
  { name: 'Green Rafter', color: '#4ddb8c' },
];

const LEADERBOARD_KEY = 'rapidsRunLeaderboard';

// ---- DOM refs ----
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const screens = {
  title: document.getElementById('screen-title'),
  setup: document.getElementById('screen-setup'),
  results: document.getElementById('screen-results'),
};
const nameInput = document.getElementById('player-name');
const characterButtons = Array.from(document.querySelectorAll('.character-option'));

// ---- Global state ----
let appState = 'TITLE'; // TITLE | SETUP | PLAY | RESULTS
let selectedCharacter = 0;
let playerName = '';

let run = null; // built when a PLAY run starts

function buildRun() {
  const pool = COMPANIES.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const gates = [];
  let cursor = 0;
  for (let g = 0; g < TOTAL_GATES; g++) {
    const picks = pool.slice(cursor, cursor + LANE_COUNT);
    cursor += LANE_COUNT;

    const hasGood = picks.some(c => c.type === 'good');
    const hasBad = picks.some(c => c.type === 'bad');
    if (!hasGood || !hasBad) {
      const wantType = hasGood ? 'bad' : 'good';
      const swapIdx = pool.findIndex((c, idx) => idx >= cursor && c.type === wantType);
      if (swapIdx !== -1) {
        const victimLane = Math.floor(Math.random() * LANE_COUNT);
        const tmp = picks[victimLane];
        picks[victimLane] = pool[swapIdx];
        pool[swapIdx] = tmp;
      }
    }

    gates.push({ time: GATE_TIMES[g], companies: picks, resolved: false });
  }
  return gates;
}

function newRunState() {
  return {
    t: 0,
    score: START_SCORE,
    gates: buildRun(),
    gatesCleared: 0,
    targetLane: 1,
    raftX: LANE_X[1],
    dodgeTimer: 0,
    dodgeCooldown: 0,
    popups: [],
    inputLeft: false,
    inputRight: false,
    ended: false,
    outcome: null, // 'win' | 'loss'
  };
}

// ---- Screen management ----
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
  document.body.classList.toggle('state-play', name === 'play');
  appState = name.toUpperCase();
}

function goTitle() {
  showScreen('title');
}

function goSetup() {
  showScreen('setup');
  nameInput.focus();
}

function startRun() {
  const raw = nameInput.value.trim().slice(0, 16);
  playerName = raw.length > 0 ? raw : 'Anonymous';
  run = newRunState();
  showScreen('play');
  lastFrameTime = performance.now();
  requestAnimationFrame(loop);
}

function endRun(outcome) {
  if (run.ended) return;
  run.ended = true;
  run.outcome = outcome;
  saveScore(playerName, selectedCharacter, run.score);
  renderResults(outcome);
  showScreen('results');
}

// ---- Input ----
document.addEventListener('keydown', (e) => {
  if (e.repeat) {
    if (appState === 'PLAY' && (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD')) {
      // allow held steering to keep target updated continuously
    } else {
      return;
    }
  }

  if (e.code === 'Enter') {
    if (appState === 'TITLE') goSetup();
    else if (appState === 'SETUP') startRun();
    else if (appState === 'RESULTS') goTitle();
    return;
  }

  if (appState !== 'PLAY') return;

  if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
    run.targetLane = Math.max(0, run.targetLane - 1);
  } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
    run.targetLane = Math.min(LANE_COUNT - 1, run.targetLane + 1);
  } else if (e.code === 'Space') {
    e.preventDefault();
    if (run.dodgeCooldown <= 0) {
      run.dodgeTimer = DODGE_DURATION;
      run.dodgeCooldown = DODGE_COOLDOWN;
    }
  }
});

screens.title.addEventListener('click', () => { if (appState === 'TITLE') goSetup(); });
document.getElementById('play-again-btn').addEventListener('click', () => { if (appState === 'RESULTS') goTitle(); });

characterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedCharacter = Number(btn.dataset.character);
    characterButtons.forEach(b => b.classList.toggle('selected', b === btn));
  });
});

// ---- Game loop ----
let lastFrameTime = 0;

function loop(now) {
  if (appState !== 'PLAY') return;
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  update(dt);
  render();

  if (appState === 'PLAY') requestAnimationFrame(loop);
}

function update(dt) {
  if (run.ended) return;
  run.t += dt;

  const smoothing = 1 - Math.exp(-STEER_LERP * dt);
  run.raftX += (LANE_X[run.targetLane] - run.raftX) * smoothing;

  if (run.dodgeTimer > 0) run.dodgeTimer -= dt;
  if (run.dodgeCooldown > 0) run.dodgeCooldown -= dt;

  run.popups.forEach(p => { p.life -= dt; p.y -= 40 * dt; });
  run.popups = run.popups.filter(p => p.life > 0);

  for (const gate of run.gates) {
    if (!gate.resolved && run.t >= gate.time) {
      resolveGate(gate);
    }
  }

  if (run.score <= 0) {
    run.score = Math.min(run.score, 0);
    endRun('loss');
  } else if (run.gatesCleared >= TOTAL_GATES) {
    endRun('win');
  }
}

function resolveGate(gate) {
  gate.resolved = true;
  run.gatesCleared += 1;

  const lane = Math.round((run.raftX - LANE_X[0]) / (LANE_X[1] - LANE_X[0]));
  const clampedLane = Math.max(0, Math.min(LANE_COUNT - 1, lane));
  const company = gate.companies[clampedLane];

  const dodged = run.dodgeTimer > 0 && company.points < 0;
  const pointsApplied = dodged ? 0 : company.points;
  run.score += pointsApplied;

  const label = dodged
    ? `DODGED ${company.name}`
    : `${pointsApplied > 0 ? '+' : ''}${pointsApplied} ${company.name}`;

  run.popups.push({
    text: label,
    sub: company.category,
    x: LANE_X[clampedLane],
    y: RAFT_Y - 40,
    life: 1.1,
    color: dodged ? '#ffd76a' : (pointsApplied >= 0 ? '#4ddb8c' : '#ff5d5d'),
  });
}

// ---- Rendering ----
function render() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // river background
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#0d2c40');
  grad.addColorStop(1, '#1c4b66');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawLaneDividers();
  drawGates();
  drawRaft();
  drawHud();
  drawPopups();
}

function drawLaneDividers() {
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 16]);
  const scroll = (run.t * 220) % 34;
  [480, 800].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, -34 + scroll);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

function drawGates() {
  for (const gate of run.gates) {
    if (gate.resolved) continue;
    const timeToGate = gate.time - run.t;
    if (timeToGate > APPROACH_WINDOW || timeToGate < -0.05) continue;

    const progress = 1 - Math.max(0, timeToGate) / APPROACH_WINDOW;
    const y = GATE_SPAWN_Y + (RAFT_Y - 90 - GATE_SPAWN_Y) * progress;
    const scale = 0.55 + 0.45 * progress;

    gate.companies.forEach((company, lane) => {
      drawCompanyCard(LANE_X[lane], y, company.name, scale);
    });
  }
}

function drawCompanyCard(x, y, name, scale) {
  const w = 200 * scale;
  const h = 74 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#0f2839';
  ctx.strokeStyle = '#3d7a9e';
  ctx.lineWidth = 2;
  roundRect(ctx, -w / 2, -h / 2, w, h, 10 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#eaf2f8';
  ctx.font = `${Math.max(12, 16 * scale)}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapText(ctx, name, 0, 0, w - 16, 16 * scale);
  ctx.restore();
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (context.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => context.fillText(line, x, startY + i * lineHeight));
}

function roundRect(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawRaft() {
  const isDodging = run.dodgeTimer > 0;
  const scale = isDodging ? 1.25 : 1;
  ctx.save();
  ctx.translate(run.raftX, RAFT_Y);
  ctx.scale(scale, scale);
  ctx.fillStyle = CHARACTERS[selectedCharacter].color;
  if (isDodging) ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.lineTo(24, 22);
  ctx.lineTo(-24, 22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPopups() {
  run.popups.forEach((p) => {
    const alpha = Math.max(0, Math.min(1, p.life / 1.1));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.font = 'bold 20px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x, p.y);
    if (p.sub) {
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillStyle = '#c9dbe8';
      ctx.fillText(p.sub, p.x, p.y + 18);
    }
    ctx.restore();
  });
}

function drawHud() {
  ctx.save();
  ctx.fillStyle = '#eaf2f8';
  ctx.font = 'bold 22px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Score: ${run.score}`, 24, 20);

  ctx.textAlign = 'center';
  ctx.fillText(`Gate ${Math.min(run.gatesCleared + 1, TOTAL_GATES)} / ${TOTAL_GATES}`, CANVAS_W / 2, 20);

  ctx.textAlign = 'right';
  const timeLeft = Math.max(0, RUN_DURATION - run.t);
  ctx.fillText(`${timeLeft.toFixed(1)}s`, CANVAS_W - 24, 20);

  if (run.dodgeCooldown > 0) {
    ctx.textAlign = 'left';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.fillStyle = '#8fa8ba';
    ctx.fillText(`Dodge ready in ${run.dodgeCooldown.toFixed(1)}s`, 24, 52);
  } else {
    ctx.textAlign = 'left';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText('Dodge ready (Space)', 24, 52);
  }
  ctx.restore();
}

// ---- Leaderboard (localStorage; swap for Apps Script fetch/post later) ----
function loadLeaderboard() {
  try {
    return JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveScore(name, character, score) {
  const board = loadLeaderboard();
  board.push({ name, character, score, timestamp: Date.now() });
  board.sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board.slice(0, 200)));
}

function renderResults(outcome) {
  document.getElementById('results-headline').textContent =
    outcome === 'win' ? 'You Win! River Cleared.' : 'PR Disaster! Run Over.';
  document.getElementById('results-score').textContent = run.score;
  document.getElementById('results-meta').textContent =
    `${playerName} · ${CHARACTERS[selectedCharacter].name}`;

  const board = loadLeaderboard();
  const top = board.slice(0, 10);

  let rank = 0;
  let lastScore = null;
  const body = document.getElementById('leaderboard-body');
  body.innerHTML = '';
  top.forEach((entry) => {
    if (entry.score !== lastScore) {
      rank += 1;
      lastScore = entry.score;
    }
    const row = document.createElement('tr');
    const isYou = entry.name === playerName && entry.score === run.score && entry.character === selectedCharacter;
    if (isYou) row.classList.add('is-you');
    row.innerHTML = `<td>${rank}</td><td>${escapeHtml(entry.name)}</td><td>${entry.score}</td>`;
    body.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Boot ----
goTitle();
