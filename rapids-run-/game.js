// ---- Constants ----
const CANVAS_W = 1280;
const CANVAS_H = 720;
const LANE_COUNT = 3;
const LANE_X = [320, 640, 960];
const RAFT_Y = 620;
const GATE_SPAWN_Y = 70;
const APPROACH_WINDOW = 3.2; // seconds a gate is visible before it resolves

// Arithmetic sequence of 10 round-intervals starting at 5s and shrinking by 0.5s
// each round (5 -> 0.5), so the run visibly speeds up toward the end.
const GATE_TIMES = [5, 9.5, 13.5, 17, 20, 22.5, 24.5, 26, 27, 27.5];
const TOTAL_GATES = GATE_TIMES.length;
const RUN_DURATION = GATE_TIMES[TOTAL_GATES - 1];
// Per-gate visibility window: never longer than the gap since the previous gate
// resolved, so consecutive gates can't render on top of each other once rounds
// get shorter than APPROACH_WINDOW.
const GATE_INTERVALS = GATE_TIMES.map((t, i) => t - (i === 0 ? 0 : GATE_TIMES[i - 1]));
const GATE_APPROACH_WINDOWS = GATE_INTERVALS.map((iv) => Math.min(APPROACH_WINDOW, iv));

const START_SCORE = 1000;
const STEER_LERP = 10; // higher = snappier smoothing toward target lane
const DODGE_DURATION = 1;
const DODGE_COOLDOWN = 1.5;

// Vertical position (% of the leaderboard image's own box) of each rank row's
// blank line, read off assets/ui/Leaderboard.jpeg. The baked artwork already
// prints "#1".."#10" correctly at these slots (its 5th row duplicates "#4",
// so that slot is skipped here) — we only need to overlay name + score.
const LEADERBOARD_ROW_Y_PERCENTS = [26.6, 31.8, 37.0, 42.1, 52.5, 57.7, 62.9, 68.0, 73.2, 78.4];

const CHARACTERS = [
  { name: 'Blue Rafter', color: '#4da8ff', accent: '#1f6fae' },
  { name: 'Red Rafter', color: '#ff5d5d', accent: '#b23232' },
  { name: 'Green Rafter', color: '#4ddb8c', accent: '#2c9e64' },
];

const LEADERBOARD_KEY = 'rapidsRunLeaderboard';

// ---- Decorative river background (banks + ripples; purely visual, never touches lane/collision logic) ----
const BANK_MARGIN = 150;
const BANK_SWAY = 40;
let riverBanks = [];
let rippleStreaks = [];

function initRiverBackground() {
  riverBanks = [];
  for (let y = -60; y <= CANVAS_H + 60; y += 42) {
    riverBanks.push({ y, phase: y * 0.01 });
  }
  rippleStreaks = [];
  for (let i = 0; i < 40; i++) {
    rippleStreaks.push({
      x: BANK_MARGIN + 20 + Math.random() * (CANVAS_W - 2 * (BANK_MARGIN + 20)),
      y: Math.random() * CANVAS_H,
      length: Math.random() * 30 + 14,
      speed: Math.random() * 60 + 90,
    });
  }
}

// ---- Company logos (real per-company matches only; a company with no matching
// asset in assets/logos/ just shows its name, no logo). ----
const COMPANY_LOGO_FILES = {
  'Anthropic': 'Anthropic.png',
  'Personio': 'Personio.png',
  'Apple': 'Apple.png',
  'Microsoft': 'Microsoft.png',
  'Nvidia': 'Nvidia.png',
  'Spotify': 'spotify.png',
  'Costco': 'Costco.png',
  'Patagonia': 'patagonia.png',
  'Salesforce': 'Salesforce.png',
  'Google (Alphabet)': 'Google (Alphabet).png',
  'ASML': 'ASML.png',
  'Visa': 'visa.jpg',
  'Novo Nordisk': 'novo nordisk.png',
  'Siemens': 'Siemens.jpg',
  'Lego': 'LEGO.png',
  'Wirecard': 'wirecard.png',
  'Enron': 'Enron.png',
  'Lehman Brothers': 'lehman brothers.png',
  'FTX': 'ftx.png',
  'Theranos': 'Theranos.png',
  'Bernie Madoff Investment': 'Bernie Madoff Investment Securities.jpg',
  'WorldCom': 'worldcom.png',
  'Parmalat': 'Parmalat.png',
};

const logoImageCache = {};
function getCompanyLogo(companyName) {
  const file = COMPANY_LOGO_FILES[companyName];
  if (!file) return null;
  if (!logoImageCache[file]) {
    const img = new Image();
    img.ready = false;
    img.onload = () => { img.ready = true; };
    img.src = `assets/logos/${encodeURIComponent(file)}`;
    logoImageCache[file] = img;
  }
  return logoImageCache[file];
}

// ---- Raft sprite (real art asset; falls back to procedural pixel raft if it can't load) ----
const raftSprite = new Image();
let raftSpriteReady = false;
raftSprite.onload = () => { raftSpriteReady = true; };
raftSprite.onerror = () => { console.warn('raft sprite failed to load, using procedural fallback'); };
raftSprite.src = 'assets/characters/shandalf-paddle-2.png';

// ---- Audio synth (Web Audio oscillators; no sound assets) ----
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioContextCtor) audioCtx = new AudioContextCtor();
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playSound(type) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'good') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'bad') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(250, now);
      osc.frequency.linearRampToValueAtTime(80, now + 0.25);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'dodge') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(1000, now + 0.12);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'hit') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.linearRampToValueAtTime(40, now + 0.3);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) {
    console.warn('Audio error:', e);
  }
}

// ---- DOM refs ----
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const screens = {
  title: document.getElementById('screen-title'),
  results: document.getElementById('screen-results'),
};
const nameInput = document.getElementById('player-name');

// ---- Global state ----
let appState = 'TITLE'; // TITLE | PLAY | RESULTS
let selectedCharacter = 0; // character selection UI is paused for now; always Blue Rafter
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

    const companiesWithLogos = picks.map((c) => ({ ...c, logo: getCompanyLogo(c.name) }));
    gates.push({
      time: GATE_TIMES[g],
      approachWindow: GATE_APPROACH_WINDOWS[g],
      companies: companiesWithLogos,
      resolved: false,
    });
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
    prevRaftX: LANE_X[1],
    tilt: 0,
    paddleAnim: 0,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    popups: [],
    splashes: [],
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
  nameInput.focus();
}

function startRun() {
  initAudio();
  const raw = nameInput.value.trim().slice(0, 16);
  playerName = raw.length > 0 ? raw : 'Anonymous';
  run = newRunState();
  initRiverBackground();
  showScreen('play');
  lastFrameTime = performance.now();
  requestAnimationFrame(loop);
}

function endRun(outcome) {
  if (run.ended) return;
  run.ended = true;
  run.outcome = outcome;
  playSound(outcome === 'win' ? 'good' : 'hit');
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
    if (appState === 'TITLE') startRun();
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

document.getElementById('play-again-btn').addEventListener('click', () => { if (appState === 'RESULTS') goTitle(); });

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

  const dx = run.raftX - run.prevRaftX;
  run.tilt = Math.max(-1, Math.min(1, dx * 0.5));
  run.prevRaftX = run.raftX;
  run.paddleAnim += dt * 8;

  if (run.dodgeTimer > 0) run.dodgeTimer -= dt;
  if (run.dodgeCooldown > 0) run.dodgeCooldown -= dt;

  run.popups.forEach(p => { p.life -= dt; p.y -= 40 * dt; });
  run.popups = run.popups.filter(p => p.life > 0);

  run.splashes.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 2.5; });
  run.splashes = run.splashes.filter(p => p.life > 0);

  rippleStreaks.forEach((r) => {
    r.y += r.speed * dt;
    if (r.y > CANVAS_H + 20) {
      r.y = -20;
      r.x = BANK_MARGIN + 20 + Math.random() * (CANVAS_W - 2 * (BANK_MARGIN + 20));
    }
  });

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
    ? `${company.points} ${company.name}`
    : `${pointsApplied > 0 ? '+' : ''}${pointsApplied} ${company.name}`;
  const sub = dodged ? `DODGED — ${company.category}` : company.category;
  const color = dodged ? '#ffd76a' : (pointsApplied >= 0 ? '#4ddb8c' : '#ff5d5d');

  run.popups.push({
    text: label,
    sub,
    x: LANE_X[clampedLane],
    y: RAFT_Y - 40,
    life: 1.1,
    color,
    strike: dodged,
  });

  createSplash(LANE_X[clampedLane], RAFT_Y - 20, color, dodged ? 10 : 14);
  playSound(dodged ? 'dodge' : (pointsApplied >= 0 ? 'good' : 'bad'));
}

function createSplash(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    run.splashes.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 140,
      vy: (Math.random() - 0.5) * 140 - 40,
      size: Math.random() * 4 + 2,
      color,
      life: 1,
    });
  }
}

// ---- Rendering ----
function render() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawRiverBackground();
  drawLaneDividers();
  drawGates();
  drawRaft();
  drawSplashes();
  drawHud();
  drawPopups();
}

function drawRiverBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#2f86c9');
  grad.addColorStop(1, '#145a94');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const scrollOffset = (run.t * 70) % 42;
  riverBanks.forEach((node) => {
    const sway = Math.sin(node.phase + run.t * 0.6) * BANK_SWAY;
    const leftW = BANK_MARGIN + sway;
    const rightW = BANK_MARGIN - sway;
    const y = node.y - scrollOffset;

    // Grass
    ctx.fillStyle = '#2f7d3a';
    ctx.fillRect(0, y, leftW, 38);
    ctx.fillRect(CANVAS_W - rightW, y, rightW, 38);

    // Sunlit grass edge
    ctx.fillStyle = '#4bab52';
    ctx.fillRect(0, y, leftW, 7);
    ctx.fillRect(CANVAS_W - rightW, y, rightW, 7);

    // Dirt bank trim at the waterline
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(leftW - 6, y, 6, 38);
    ctx.fillRect(CANVAS_W - rightW, y, 6, 38);
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  rippleStreaks.forEach((r) => {
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x, r.y + r.length);
    ctx.stroke();
  });
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
    if (timeToGate > gate.approachWindow || timeToGate < -0.05) continue;

    const progress = 1 - Math.max(0, timeToGate) / gate.approachWindow;
    const y = GATE_SPAWN_Y + (RAFT_Y - 90 - GATE_SPAWN_Y) * progress;
    const scale = 0.55 + 0.45 * progress;

    gate.companies.forEach((company, lane) => {
      drawCompanyCard(LANE_X[lane], y, company, scale);
    });
  }
}

function drawCompanyCard(x, y, company, scale) {
  const w = 230 * scale;
  const h = 74 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#0f2839';
  ctx.strokeStyle = '#3d7a9e';
  ctx.lineWidth = 2;
  roundRect(ctx, -w / 2, -h / 2, w, h, 10 * scale);
  ctx.fill();
  ctx.stroke();

  const logo = company.logo;
  const logoReady = logo && logo.ready;

  ctx.fillStyle = '#eaf2f8';
  ctx.textBaseline = 'middle';

  if (logoReady) {
    const pad = 10 * scale;
    const logoSize = Math.min(h - 2 * pad, 54 * scale);
    const logoLeft = -w / 2 + pad;
    ctx.drawImage(logo, logoLeft, -logoSize / 2, logoSize, logoSize);

    const textX = logoLeft + logoSize + pad;
    const textWidth = (w / 2 - pad) - textX;
    ctx.textAlign = 'left';
    ctx.font = `${Math.max(12, 15 * scale)}px -apple-system, sans-serif`;
    wrapText(ctx, company.name, textX, 0, textWidth, 15 * scale);
  } else {
    ctx.textAlign = 'center';
    ctx.font = `${Math.max(12, 16 * scale)}px -apple-system, sans-serif`;
    wrapText(ctx, company.name, 0, 0, w - 16, 16 * scale);
  }
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
  const tilt = run.tilt || 0;
  const baseScale = raftSpriteReady ? 1 : 1.6;
  const scale = baseScale * (isDodging ? 1.15 : 1);

  ctx.save();
  ctx.translate(run.raftX, RAFT_Y);
  ctx.scale(scale, scale);
  ctx.rotate((tilt * 6 * Math.PI) / 180);
  if (isDodging) ctx.globalAlpha = 0.8;

  if (raftSpriteReady) {
    const w = 108;
    const h = w * (raftSprite.naturalHeight / raftSprite.naturalWidth);
    ctx.drawImage(raftSprite, -w / 2, -h / 2 + 8, w, h);
  } else {
    drawProceduralRaft();
  }

  ctx.restore();
}

function drawProceduralRaft() {
  const paddleFrame = run.paddleAnim;
  const shirt = CHARACTERS[selectedCharacter].color;
  const cap = CHARACTERS[selectedCharacter].accent;
  const paddleOffset = Math.sin(paddleFrame) * 6;

  // Wooden raft logs
  ctx.fillStyle = '#5c3a21';
  ctx.fillRect(-20, -30, 40, 60);
  ctx.fillStyle = '#8B5A2B';
  ctx.fillRect(-18, -28, 36, 56);
  for (let i = -17; i < 17; i += 7) {
    ctx.fillStyle = '#a26a35';
    ctx.fillRect(i, -27, 6, 54);
    ctx.fillStyle = '#bd7e42';
    ctx.fillRect(i + 1, -27, 2, 54);
    ctx.fillStyle = '#422817';
    ctx.fillRect(i + 5, -27, 1, 54);
  }
  ctx.fillStyle = '#e6c875';
  ctx.fillRect(-18, -18, 36, 3);
  ctx.fillRect(-18, 15, 36, 3);

  // Water wake
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillRect(-16, 28, 10, 4 + Math.sin(paddleFrame) * 3);
  ctx.fillRect(6, 28, 10, 4 + Math.cos(paddleFrame) * 3);

  // Rafter, rear view
  ctx.fillStyle = cap;
  ctx.fillRect(-6, -12, 12, 8);
  ctx.fillStyle = '#f4b183';
  ctx.fillRect(-5, -4, 10, 4);
  ctx.fillStyle = shirt;
  ctx.fillRect(-9, 0, 18, 14);

  ctx.fillStyle = '#fca5a5';
  ctx.fillRect(-14, 2 + paddleOffset, 5, 5);
  ctx.fillRect(9, 2 - paddleOffset, 5, 5);

  ctx.fillStyle = '#78350f';
  ctx.fillRect(-22, -10 + paddleOffset, 3, 28);
  ctx.fillStyle = '#b45309';
  ctx.fillRect(-24, 15 + paddleOffset, 7, 10);
  ctx.fillStyle = '#78350f';
  ctx.fillRect(19, -10 - paddleOffset, 3, 28);
  ctx.fillStyle = '#b45309';
  ctx.fillRect(17, 15 - paddleOffset, 7, 10);
}

function drawSplashes() {
  run.splashes.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.restore();
  });
}

function drawPopups() {
  run.popups.forEach((p) => {
    const alpha = Math.max(0, Math.min(1, p.life / 1.1));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.font = 'bold 20px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, p.x, p.y);

    if (p.strike) {
      const textWidth = ctx.measureText(p.text).width;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - textWidth / 2 - 3, p.y);
      ctx.lineTo(p.x + textWidth / 2 + 3, p.y);
      ctx.stroke();
    }

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
  const top = board.slice(0, LEADERBOARD_ROW_Y_PERCENTS.length);

  const rowsContainer = document.getElementById('leaderboard-rows');
  rowsContainer.innerHTML = '';
  top.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.style.top = `${LEADERBOARD_ROW_Y_PERCENTS[i]}%`;

    const isYou = entry.name === playerName && entry.score === run.score && entry.character === selectedCharacter;
    if (isYou) row.classList.add('is-you');

    const nameEl = document.createElement('span');
    nameEl.className = 'lb-name';
    nameEl.textContent = entry.name;

    const scoreEl = document.createElement('span');
    scoreEl.className = 'lb-score';
    scoreEl.textContent = entry.score;

    row.appendChild(nameEl);
    row.appendChild(scoreEl);
    rowsContainer.appendChild(row);
  });
}

// ---- Boot ----
goTitle();
