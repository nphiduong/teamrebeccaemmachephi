// ---- Constants ----
const CANVAS_W = 1280;
const CANVAS_H = 720;
const LANE_COUNT = 3;
const LANE_X = [320, 640, 960];
const RAFT_Y = 620;
const GATE_SPAWN_Y = 70;
const APPROACH_WINDOW = 3.2; // seconds a gate is visible before it resolves

// Depth reference for the riverbank taper: banks narrow toward the horizon and
// reach full width by the time they're level with where gate items arrive.
const PERSPECTIVE_BASE_Y = RAFT_Y - 90;

// 12 round-intervals: starts at 4s and shrinks by 0.25s each round (4 -> 1.25).
const ROUND_DURATIONS = [4, 3.75, 3.5, 3.25, 3, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25];
const GATE_TIMES = ROUND_DURATIONS.reduce((acc, d, i) => {
  acc.push(d + (i === 0 ? 0 : acc[i - 1]));
  return acc;
}, []);
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
const DODGE_COOLDOWN = 0.5;

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
    riverBanks.push({
      y,
      phase: y * 0.01,
      // Stable per-node bush texture (generated once, not re-randomized every
      // frame) so the lush foliage detail doesn't flicker as the bank scrolls.
      bushes: Array.from({ length: 4 }, () => ({
        f: Math.random(), // 0..1 fraction across the bank's own width
        dy: Math.random() * 30,
        r: Math.random() * 4 + 3,
      })),
    });
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

// ---- Company logos (real per-company matches; every company in companies.js
// currently has one, but this stays a lookup — not a filename convention — so a
// future company with no matching asset just shows its name, no logo). ----
const COMPANY_LOGO_FILES = {
  'Anthropic': 'Anthropic.png',
  'Personio': 'Personio.png',
  'Apple': 'apple.svg',
  'Microsoft': 'Microsoft.png',
  'Nvidia': 'Nvidia.png',
  'Stripe': 'Stripe.png',
  'Spotify': 'Spotify.png',
  'Costco': 'Costco.png',
  'Patagonia': 'Patagonia.png',
  'Berkshire Hathaway': 'Berkshire Hathaway.png',
  'Salesforce': 'Salesforce.png',
  'Google (Alphabet)': 'Google (Alphabet).png',
  'ASML': 'ASML.png',
  'Shopify': 'Shopify.png',
  'Figma': 'Figma.jpeg',
  'Databricks': 'Databricks.png',
  'Canva': 'Canva.jpeg',
  'Duolingo': 'Duolingo.jpg',
  'OpenAI': 'OpenAI.jpg',
  'Visa': 'Visa.jpg',
  'Novo Nordisk': 'Novo Nordisk.png',
  'Siemens': 'Siemens.jpg',
  'Hubspot': 'Hubspot.jpeg',
  'AirBnB': 'AirBnB.png',
  'Lego': 'LEGO.png',
  'Wirecard': 'Wirecard.png',
  'Enron': 'Enron.png',
  'Lehman Brothers': 'Lehman Brothers.png',
  'FTX': 'FTX.png',
  'Theranos': 'Theranos.png',
  'WeWork': 'WeWork.jpg',
  'Bernie Madoff Investment': 'Bernie Madoff Investment.jpg',
  'WorldCom': 'WorldCom.png',
  'Parmalat': 'Parmalat.png',
  'Luckin Coffee': 'Luckin Coffee.png',
  'SVB (Silicon Valley Bank)': 'SVB (Silicon Valley Bank).jpeg',
  'Credit Suisse': 'Credit Suisse.png',
  'Tyco': 'Tyco.png',
  'HealthSouth': 'HealthSouth.png',
  'Bear Stearns': 'Bear Stearns.jpg',
  'Greensill Capital': 'Greensill Capital.jpg',
  'OneCoin': 'OneCoin.jpg',
  'Washington Mutual': 'Washington Mutual.png',
  'Nikola Motors': 'Nikola Motors.png',
  'Lordstown Motors': 'Lordstown Motors.jpg',
  'Sears': 'Sears.jpg',
  'BlockFi': 'BlockFi.png',
  'Celsius Network': 'Celsius Network.png',
  'Carillion': 'Carillion.jpg',
  'Thomas Cook': 'Thomas Cook.png',
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

// ---- Gate-item raft (each lane's floating item: this raft shape with the
// company's logo composited onto its deck, moving together as one sprite) ----
const cargoRaftSprite = new Image();
let cargoRaftReady = false;
cargoRaftSprite.onload = () => { cargoRaftReady = true; };
cargoRaftSprite.src = 'assets/characters/raft.svg';

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

const bgMusic = new Audio('assets/audio/theme.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.5;

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
  bgMusic.currentTime = 0;
  bgMusic.play().catch(() => {});
  showScreen('play');
  lastFrameTime = performance.now();
  requestAnimationFrame(loop);
}

function endRun(outcome) {
  if (run.ended) return;
  run.ended = true;
  bgMusic.pause();
  run.outcome = outcome;
  playSound(outcome === 'win' ? 'good' : 'hit');
  renderResultsSummary(outcome);
  showScreen('results');
  submitAndRenderLeaderboard(); // async: shows the summary immediately, rows fill in once the network call resolves
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

// If the player closes/navigates away mid-run, log whatever score they had —
// pagehide (not beforeunload) plus sendBeacon are the reliable way to get a
// write out during teardown, since a normal fetch() isn't guaranteed to finish.
window.addEventListener('pagehide', () => {
  if (appState !== 'PLAY' || !run || run.ended) return;
  const characterName = CHARACTERS[selectedCharacter].name;
  saveLocalScore(playerName, characterName, run.score);
  if (LEADERBOARD_API_URL && navigator.sendBeacon) {
    const blob = new Blob(
      [JSON.stringify({ name: playerName, score: run.score, character: characterName })],
      { type: 'text/plain;charset=utf-8' }
    );
    navigator.sendBeacon(LEADERBOARD_API_URL, blob);
  }
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
    r.y -= r.speed * dt;
    if (r.y < -20 - r.length) {
      r.y = CANVAS_H + 20;
      r.x = BANK_MARGIN + 20 + Math.random() * (CANVAS_W - 2 * (BANK_MARGIN + 20));
    }
  });

  for (const gate of run.gates) {
    if (!gate.resolved && run.t >= gate.time) {
      resolveGate(gate);
    }
  }

  if (run.gatesCleared >= TOTAL_GATES) {
    endRun(run.score > 0 ? 'win' : 'loss');
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
  const color = dodged ? '#ffd700' : (pointsApplied >= 0 ? '#00ff66' : '#ff3333');

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
  drawGates();
  drawRaft();
  drawSplashes();
  drawHud();
  drawPopups();
}

const BANK_MARGIN_HORIZON = 40; // riverbank width right at the vanishing point

function drawRiverBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#0077be');
  grad.addColorStop(1, '#1a5b8c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const scrollOffset = (run.t * 70) % 42;
  riverBanks.forEach((node) => {
    const y = node.y + scrollOffset;
    // Perspective taper: banks narrow toward the horizon, widen toward the raft.
    const t = Math.max(0, Math.min(1, (y - GATE_SPAWN_Y) / (PERSPECTIVE_BASE_Y - GATE_SPAWN_Y)));
    const margin = BANK_MARGIN_HORIZON + (BANK_MARGIN - BANK_MARGIN_HORIZON) * t;
    const sway = Math.sin(node.phase + run.t * 0.6) * BANK_SWAY * t;
    const leftW = margin + sway;
    const rightW = margin - sway;

    // Grass — deep, saturated green base
    ctx.fillStyle = '#1f7a3d';
    ctx.fillRect(0, y, leftW, 38);
    ctx.fillRect(CANVAS_W - rightW, y, rightW, 38);

    // Sunlit grass edge
    ctx.fillStyle = '#4cbf6b';
    ctx.fillRect(0, y, leftW, 7);
    ctx.fillRect(CANVAS_W - rightW, y, rightW, 7);

    // Scattered bush clumps for a denser, lusher look
    ctx.fillStyle = '#134d29';
    node.bushes.forEach((b) => {
      const r = b.r * (0.3 + 0.7 * t);
      if (r < 0.5) return;
      const by = y + 8 + b.dy * t;
      ctx.beginPath();
      ctx.arc(b.f * Math.max(0, leftW - 6) + 3, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(CANVAS_W - (b.f * Math.max(0, rightW - 6) + 3), by, r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Warm earth-toned rocky trim at the waterline
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(leftW - 6, y, 6, 38);
    ctx.fillRect(CANVAS_W - rightW, y, 6, 38);
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  rippleStreaks.forEach((r) => {
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x, r.y + r.length);
    ctx.stroke();
  });
}

function drawGates() {
  for (const gate of run.gates) {
    if (gate.resolved) continue;
    const timeToGate = gate.time - run.t;
    if (timeToGate > gate.approachWindow || timeToGate < -0.05) continue;

    const progress = 1 - Math.max(0, timeToGate) / gate.approachWindow;
    const y = GATE_SPAWN_Y + (RAFT_Y - 90 - GATE_SPAWN_Y) * progress;
    const scale = 1;

    gate.companies.forEach((company, lane) => {
      // Company items stay in their own fixed lane the whole time — only the
      // lane dividers/riverbanks use the vanishing-point perspective, not these.
      drawCompanyCard(LANE_X[lane], y, company, scale);
    });
  }
}

// Deck area of raft.svg as fractions of its own box (read off the 32x32 viewBox:
// deck planks span x=6..26, y=10..21) — the logo gets composited into this rect
// so it sits "on" the raft rather than floating over unrelated pixels.
const RAFT_DECK_RECT = { x: 6 / 32, y: 10 / 32, w: 20 / 32, h: 11 / 32 };

function drawCompanyCard(x, y, company, scale) {
  const size = 150 * scale; // raft.svg is square (32x32 viewBox)
  ctx.save();
  ctx.translate(x, y);

  if (cargoRaftReady) {
    ctx.drawImage(cargoRaftSprite, -size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = '#0f2839';
    ctx.strokeStyle = '#3d7a9e';
    ctx.lineWidth = 2;
    roundRect(ctx, -size / 2, -size / 2, size, size, 10 * scale);
    ctx.fill();
    ctx.stroke();
  }

  const logo = company.logo;
  const logoReady = logo && logo.ready;
  if (logoReady) {
    const deckX = -size / 2 + RAFT_DECK_RECT.x * size;
    const deckY = -size / 2 + RAFT_DECK_RECT.y * size;
    const deckW = RAFT_DECK_RECT.w * size;
    const deckH = RAFT_DECK_RECT.h * size;

    const logoAspect = (logo.naturalWidth && logo.naturalHeight) ? logo.naturalWidth / logo.naturalHeight : 1;
    let lw = deckW * 0.9;
    let lh = lw / logoAspect;
    if (lh > deckH * 0.9) {
      lh = deckH * 0.9;
      lw = lh * logoAspect;
    }
    ctx.drawImage(logo, deckX + (deckW - lw) / 2, deckY + (deckH - lh) / 2, lw, lh);
  }

  // Company name caption below the raft
  ctx.fillStyle = '#eaf2f8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(11, 13 * scale)}px -apple-system, sans-serif`;
  wrapText(ctx, company.name, 0, size / 2 + 12 * scale, size * 1.4, 14 * scale);

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
  ctx.fillStyle = '#ffd700';
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
    ctx.fillStyle = '#ffd700';
    ctx.fillText('Dodge ready (Space)', 24, 52);
  }
  ctx.restore();
}

// ---- Leaderboard ----
// Local copy always kept (and used as-is if no backend is configured, or if
// the network call fails). Paste a deployed Apps Script Web App /exec URL
// below to also read/write a shared, permanent leaderboard.
const LEADERBOARD_API_URL = 'https://script.google.com/a/macros/personio.de/s/AKfycby5O1s0FDYZal74vJJHVkWDiaQW7FLiSj1mzvigb3HJp0_s9wc_b7hHsBGgTtFi6Q/exec';

function loadLocalLeaderboard() {
  try {
    return JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveLocalScore(name, character, score) {
  const board = loadLocalLeaderboard();
  board.push({ name, character, score, timestamp: Date.now() });
  board.sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board.slice(0, 200)));
}

async function saveScore(name, character, score) {
  saveLocalScore(name, character, score);
  if (!LEADERBOARD_API_URL) return;
  try {
    await fetch(LEADERBOARD_API_URL, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script Web Apps don't handle.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ name, score, character }),
    });
  } catch (e) {
    console.warn('Leaderboard sync failed, score kept locally only:', e);
  }
}

async function fetchLeaderboard() {
  if (!LEADERBOARD_API_URL) return loadLocalLeaderboard();
  try {
    const res = await fetch(LEADERBOARD_API_URL);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Leaderboard fetch failed, showing local scores only:', e);
    return loadLocalLeaderboard();
  }
}

function renderResultsSummary(outcome) {
  document.getElementById('results-headline').textContent =
    outcome === 'win' ? 'You Win! River Cleared.' : 'PR Disaster! Run Over.';
  document.getElementById('results-score').textContent = run.score;
  document.getElementById('results-meta').textContent =
    `${playerName} · ${CHARACTERS[selectedCharacter].name}`;
}

async function submitAndRenderLeaderboard() {
  const characterName = CHARACTERS[selectedCharacter].name;
  await saveScore(playerName, characterName, run.score);
  const board = await fetchLeaderboard();
  renderLeaderboardRows(board, characterName);
}

function renderLeaderboardRows(board, characterName) {
  const top = board.slice(0, LEADERBOARD_ROW_Y_PERCENTS.length);

  const rowsContainer = document.getElementById('leaderboard-rows');
  rowsContainer.innerHTML = '';
  LEADERBOARD_ROW_Y_PERCENTS.forEach((yPercent, i) => {
    const entry = top[i];
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.style.top = `${yPercent}%`;

    const nameEl = document.createElement('span');
    const scoreEl = document.createElement('span');

    if (entry) {
      const isYou = entry.name === playerName && entry.score === run.score && entry.character === characterName;
      if (isYou) row.classList.add('is-you');
      nameEl.className = 'lb-name';
      nameEl.textContent = entry.name;
      scoreEl.className = 'lb-score';
      scoreEl.textContent = entry.score;
    } else {
      // No entry for this rank yet — mask the baked underscore placeholder.
      nameEl.className = 'lb-name lb-empty-mask';
      scoreEl.className = 'lb-score lb-empty-mask';
    }

    row.appendChild(nameEl);
    row.appendChild(scoreEl);
    rowsContainer.appendChild(row);
  });
}

// ---- Boot ----
goTitle();
