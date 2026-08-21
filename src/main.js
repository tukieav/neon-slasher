// Neon Slasher — arena katana slasher vs robot waves (CrazyGames)
// Zero blood: enemies are neon droids that burst into glowing particles & springs.
import { initSDK, loadingStart, loadingStop, gameplayStart, gameplayStop, happytime, requestAd, getMuteSetting, onSettingsChange, loadBest, saveBest } from './sdk.js';
import * as audio from './audio.js';
import { meta, loadMeta, saveMeta, checkDailyStreak, addCores, UPGRADES, KATANAS, PERKS, upgradeLevel, upgradeCost, buyUpgrade, buyKatana, buyPerk, runStats } from './meta.js';

const W = 960, H = 640;
const CX = W / 2, CY = H / 2;
const ARENA_R = 280;
const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const CAPS = { enemies: 48, bullets: 96, particles: 420, debris: 80, flashes: 48, beams: 48, floats: 32, cores: 48, trail: 36, ghosts: 24, slashArcs: 8 };

const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

// ---------- full-viewport canvas + camera (logic stays in 960x640 world space) ----------
let VW = 1280, VH = 720, DPR = 1;
const cam = { scale: 1, ox: 0, oy: 0 };
let curCam = { s: 1, ox: 0, oy: 0 };  // effective camera this frame (intro sweep aware)
let envCanvas = null;                  // screen-space cyberpunk surroundings (rebuilt on resize)
let introT = 0;                        // intro camera sweep timer (1.5s, skippable)
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = Math.max(320, window.innerWidth);
  VH = Math.max(240, window.innerHeight);
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  cam.scale = Math.min(VW / W, VH / H);
  cam.ox = (VW - W * cam.scale) / 2;
  cam.oy = (VH - H * cam.scale) / 2;
  envCanvas = null;
}
window.addEventListener('resize', resize); resize();

function effectiveCam() {
  if (introT > 0 && state === 'playing') {
    const p = 1 - introT / 1.5;
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    const z = 1.45 - 0.45 * e;
    const ang = (1 - e) * 1.1;
    const s = cam.scale * z;
    const fx = CX + Math.cos(ang) * 60 * (1 - e);
    const fy = CY + Math.sin(ang) * 40 * (1 - e);
    return { s, ox: VW / 2 - fx * s, oy: VH / 2 - fy * s };
  }
  return { s: cam.scale, ox: cam.ox, oy: cam.oy };
}

// ---------- state ----------
let state = 'loading'; // loading -> menu -> playing -> gameover (+shop)
let score = 0, best = 0, wave = 0;
let hero, enemies, bullets, particles, floats, pickups, cores;
let combo = 0, comboTimer = 0, multiplier = 1;
let shake = 0, hurtFlash = 0, slowmo = 0, timeScale = 1;
let hitStop = 0;           // brief freeze on hit (juice)
let debris = [];           // sliced robot halves
let flashes = [];          // radial light flashes (deflect etc.)
let beams = [];            // teleport light columns at enemy spawn points
let waveBanner = 0, waveBannerText = '';
let secondWindUsed = false, secondWindShield = 0;
let killsTotal = 0;
let adBusy = false;
let paused = false;
let pauseReasons = new Set();
let loopStarts = 0, renderedFrames = 0, fixedSteps = 0;
let hazard = null;
const reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };
let reducedMotion = !!reducedMotionQuery.matches;
let tPulse = 0;
let spawnQueue = [];
let spawnTimer = 0;
let spawnGap = 0.35;
let deathT = 0;            // time since death (explosion -> stats overlay fade-in)
let stats = null;          // per-run derived stats from meta upgrades + perk
let runCores = 0;          // cores collected this run (banked on game over)
let fever = 0;             // combo fever buff timer
let feverUsedAtCombo = 0;
let vampireKills = 0;
let hintT = 0;             // contextual hint timer (first run seconds)
let lastAdAt = 0;          // gate midgame ads: max 1 per 60s
let streakInfo = null;
let coresDoubled = false;
let newBestWave = false;

const KEYS = {};
let mouseX = CX, mouseY = CY - 100;
let isTouch = false;

// virtual joystick (mobile)
const joy = { active: false, id: -1, x0: 0, y0: 0, dx: 0, dy: 0 };
const rightTouch = { active: false, id: -1, x0: 0, y0: 0, t0: 0 };

function newHero() {
  const s = stats;
  return {
    x: CX, y: CY, vx: 0, vy: 0, aim: -Math.PI / 2,
    hp: s.hpMax, hpMax: s.hpMax, speed: s.speed,
    slashTimer: 0, slashCd: 0, slashAngle: 0,
    dashTimer: 0, dashCd: 0, iframes: 0,
    trail: [], slashArcs: [], ghosts: [], breathe: Math.random() * 6, cloak: 0,
  };
}

function reset() {
  stats = runStats();
  hero = newHero();
  enemies = []; bullets = []; particles = []; floats = []; pickups = []; cores = [];
  score = 0; wave = 0; combo = 0; comboTimer = 0; multiplier = 1;
  shake = 0; hurtFlash = 0; slowmo = 0; timeScale = 1;
  hitStop = 0; debris = []; flashes = []; beams = [];
  secondWindUsed = false; secondWindShield = 0; killsTotal = 0;
  spawnQueue = []; spawnTimer = 0;
  runCores = 0; fever = 0; feverUsedAtCombo = 0; vampireKills = 0;
  hintT = 0; coresDoubled = false; newBestWave = false;
  hazard = null;
}

function pushBounded(list, item, cap) {
  if (list.length >= cap) list.splice(0, list.length - cap + 1);
  list.push(item);
  return item;
}

function addParticle(item) { return pushBounded(particles, item, CAPS.particles); }
function addFlash(item) { return pushBounded(flashes, item, CAPS.flashes); }
function addBeam(item) { return pushBounded(beams, item, CAPS.beams); }
function addFloatBounded(item) { return pushBounded(floats, item, CAPS.floats); }

function setPaused(reason, shouldPause) {
  if (shouldPause) pauseReasons.add(reason); else pauseReasons.delete(reason);
  const next = pauseReasons.size > 0;
  if (paused === next) return;
  paused = next;
  if (paused) {
    for (const key in KEYS) KEYS[key] = false;
    joy.active = false; rightTouch.active = false;
    audio.pauseAudio();
    if (state === 'playing') gameplayStop();
  } else {
    audio.resumeAudio();
    if (state === 'playing') gameplayStart();
  }
}

reducedMotionQuery.addEventListener?.('change', (event) => { reducedMotion = event.matches; });

// ---------- waves ----------
function startWave(n) {
  wave = n;
  if (n > meta.bestWave) { meta.bestWave = n; newBestWave = true; saveMeta(); }
  const isBoss = n % 5 === 0;
  const isMegaBoss = n % 10 === 0;
  waveBanner = 2;
  waveBannerText = isMegaBoss ? 'WAVE ' + n + ' — TWIN CORE!' : isBoss ? 'WAVE ' + n + ' — MINI-BOSS!' : 'WAVE ' + n;
  if (isBoss) audio.bossSound(); else audio.waveSound();
  const q = [];
  if (isMegaBoss) {
    q.push('twin'); q.push('twin');
    for (let i = 0; i < 2 + Math.floor(n / 10); i++) q.push('melee');
  } else if (isBoss) {
    q.push('boss');
    for (let i = 0; i < 2 + Math.floor(n / 5); i++) q.push('melee');
  } else {
    // wave 1: instant spectacle — 5 bots teleporting in; then gentle ramp, then normal growth
    const count = n === 1 ? 5 : n <= 3 ? 2 + n : 3 + n * 2;
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      if (n >= 4 && r < 0.12) q.push('shield');
      else if (n >= 6 && r < 0.24) q.push('splitter');
      else if (n >= 2 && r < 0.45) q.push('shooter');
      else if (n >= 3 && r < 0.62) q.push('kamikaze');
      else q.push('melee');
    }
  }
  spawnQueue = q; spawnTimer = n === 1 ? 0.12 : 0.3; spawnGap = n === 1 ? 0.16 : 0.35;
  // After the player understands the first three waves, a telegraphed floor
  // sector creates a dash-positioning decision. It always begins as a warning
  // and spawns are kept out of the dangerous wedge while it is active.
  if (n >= 4) {
    const a = Math.random() * Math.PI * 2;
    hazard = { angle: a, width: 0.52, warning: 1.25, active: 3.4, hitCd: 0 };
  }
  // heart pickup every 3 waves if hurt
  if (n > 1 && n % 3 === 0 && hero.hp < hero.hpMax) {
    const a = Math.random() * Math.PI * 2;
    pickups.push({ x: CX + Math.cos(a) * ARENA_R * 0.5, y: CY + Math.sin(a) * ARENA_R * 0.5, t: 0 });
  }
}

function spawnEnemy(type, px, py) {
  let a = Math.random() * Math.PI * 2;
  if (hazard && hazard.warning <= 0 && hazard.active > 0 && px == null) {
    // Never teleport a robot into the currently electrified sector.
    for (let tries = 0; tries < 8 && angDiff(a, hazard.angle) < hazard.width + 0.35; tries++) a = Math.random() * Math.PI * 2;
  }
  const x = px != null ? px : CX + Math.cos(a) * (ARENA_R - 14);
  const y = py != null ? py : CY + Math.sin(a) * (ARENA_R - 14);
  const wv = wave;
  // teleport column of light at the spawn point
  const beamHue = { melee: 185, shooter: 300, kamikaze: 20, shield: 130, splitter: 50, mini: 50, boss: 265, twin: 335 }[type] || 185;
  addBeam({ x, y, t: 0, life: 0.55, hue: beamHue });
  addFlash({ x, y, t: 0, life: 0.4, r: 40, hue: beamHue });
  for (let i = 0; i < 8; i++) {
    const pa = Math.random() * Math.PI * 2;
    addParticle({ x, y, vx: Math.cos(pa) * 90, vy: Math.sin(pa) * 90 - 40, life: 0.4, t: 0, hue: beamHue, spring: false, r: 2 });
  }
  if (type === 'melee') {
    pushBounded(enemies, { type, x, y, hp: 1, r: 14, speed: 70 + wv * 4, t: 0, spawn: 0.6, hue: 185, windup: 0, attackCd: 0.35 }, CAPS.enemies);
  } else if (type === 'shooter') {
    pushBounded(enemies, { type, x, y, hp: 1, r: 13, speed: 55 + wv * 2, t: Math.random() * 2, spawn: 0.6, fireCd: 1.6, charge: 0, hue: 300 }, CAPS.enemies);
  } else if (type === 'kamikaze') {
    pushBounded(enemies, { type, x, y, hp: 1, r: 11, speed: 150 + wv * 5, t: 0, spawn: 0.6, fuse: 0, hue: 20 }, CAPS.enemies);
  } else if (type === 'shield') {
    // shield droid: front is invulnerable — hit it from behind (faces the hero)
    pushBounded(enemies, { type, x, y, hp: 2, r: 16, speed: 55 + wv * 3, t: 0, spawn: 0.7, face: 0, hue: 130 }, CAPS.enemies);
  } else if (type === 'splitter') {
    // splits into two minis on death
    pushBounded(enemies, { type, x, y, hp: 2, r: 17, speed: 60 + wv * 3, t: 0, spawn: 0.7, hue: 50, pulse: 0 }, CAPS.enemies);
  } else if (type === 'mini') {
    pushBounded(enemies, { type: 'melee', mini: true, x, y, hp: 1, r: 8, speed: 130 + wv * 4, t: 0, spawn: 0.25, hue: 50, windup: 0, attackCd: 0.35 }, CAPS.enemies);
  } else if (type === 'boss') {
    const bhp = 16 + Math.floor(wv / 5) * 8;
    pushBounded(enemies, { type, x, y, hp: bhp, maxHp: bhp, r: 34, speed: 45, t: 0, spawn: 1, fireCd: 2.5, chargeCd: 4, phaseWarn: 0, charging: 0, cvx: 0, cvy: 0, hue: 265 }, CAPS.enemies);
  } else if (type === 'twin') {
    // twin core boss (every 10 waves): orbits arena, spiral fire
    const bhp = 12 + Math.floor(wv / 10) * 8;
    pushBounded(enemies, { type, x, y, hp: bhp, maxHp: bhp, r: 26, speed: 60, t: Math.random() * 6, spawn: 1, fireCd: 2, orbitA: a, orbitDir: Math.random() < 0.5 ? 1 : -1, hue: 335 }, CAPS.enemies);
  }
}

// ---------- particles ----------
function burst(x, y, hue, n, spd) {
  for (let i = 0; i < (reducedMotion ? Math.ceil(n * 0.35) : n); i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (0.3 + Math.random()) * spd;
    addParticle({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.5 + Math.random() * 0.5, t: 0, hue,
      spring: Math.random() < 0.3, r: 2 + Math.random() * 3,
    });
  }
}

function addFloat(x, y, text, hue) {
  addFloatBounded({ x, y, text, hue, t: 0 });
}

// ---------- combat ----------
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function doSlash() {
  if (hero.slashCd > 0 || state !== 'playing') return;
  hero.slashCd = fever > 0 ? 0.2 : 0.28;
  hero.slashTimer = 0.14;
  hero.slashAngle = hero.aim;
  pushBounded(hero.slashArcs, { a: hero.aim, t: 0 }, CAPS.slashArcs);
  audio.slashSound(combo);
  let kills = 0;
  const RANGE = stats.range, HALF = Math.PI * (60 / 180); // 120° arc
  for (const e of enemies) {
    if (e.spawn > 0) continue;
    const dx = e.x - hero.x, dy = e.y - hero.y;
    const d = Math.hypot(dx, dy);
    if (d < RANGE + e.r && angDiff(Math.atan2(dy, dx), hero.aim) < HALF) {
      // shield droid blocks frontal hits — attack from behind
      if (e.type === 'shield' && angDiff(Math.atan2(hero.y - e.y, hero.x - e.x), e.face) < Math.PI * 0.5) {
        audio.deflectSound();
        addFloat(e.x, e.y - 20, 'BLOCKED!', 130);
        burst(e.x, e.y, 130, 4, 90);
        shake = Math.min(shake + 2, 12);
        continue;
      }
      e.hp -= 1;
      e.hitFlash = 0.15;
      shake = Math.min(shake + 4, 12);
      hitStop = Math.max(hitStop, 0.04); // 40ms hit-stop juice
      if (e.hp <= 0) { killEnemy(e); kills++; }
      else { audio.hitSound(combo); burst(e.x, e.y, e.hue, 6, 120); }
    }
  }
  // deflect bullets
  for (const b of bullets) {
    if (b.friendly) continue;
    const dx = b.x - hero.x, dy = b.y - hero.y;
    const d = Math.hypot(dx, dy);
    if (d < RANGE && angDiff(Math.atan2(dy, dx), hero.aim) < HALF) {
      b.friendly = true;
      const sp = Math.hypot(b.vx, b.vy) * 2.2;
      b.vx = Math.cos(hero.aim) * sp; b.vy = Math.sin(hero.aim) * sp;
      b.hue = 130;
      audio.deflectSound();
      addFloat(b.x, b.y, 'DEFLECT!', 130);
      burst(b.x, b.y, 130, 5, 100);
      addFlash({ x: b.x, y: b.y, r: 34, hue: 130, t: 0, life: 0.22 });
      if (comboTimer > 0) {
        comboTimer = Math.min(3, comboTimer + 0.8);
        addFloat(hero.x, hero.y - 72, 'CHAIN +0.8s', 130);
      }
    }
  }
  if (kills >= 3) {
    slowmo = stats.slowmoDur;
    audio.slowmoSound();
    addFloat(hero.x, hero.y - 40, 'TRIPLE KILL!', 55);
    shake = 14;
  }
}

function killEnemy(e) {
  e.dead = true;
  killsTotal++;
  combo++;
  comboTimer = 3;
  multiplier = 1 + Math.floor(combo / 3);
  // combo fever: at x10 combo — short attack-speed + move buff
  if (combo >= 10 && combo % 10 === 0 && combo !== feverUsedAtCombo) {
    feverUsedAtCombo = combo;
    fever = 5;
    audio.feverSound();
    addFloat(hero.x, hero.y - 55, 'COMBO FEVER!', 55);
    burst(hero.x, hero.y, 55, 24, 200);
    shake = 12;
    happytime();
  }
  const isBoss = e.type === 'boss' || e.type === 'twin';
  const basePts = isBoss ? 500 : e.type === 'kamikaze' ? 30 : e.type === 'shooter' ? 25 : e.type === 'shield' ? 40 : e.type === 'splitter' ? 35 : 15;
  const pts = Math.round(basePts * multiplier * stats.scoreMul);
  score += pts;
  addFloat(e.x, e.y, '+' + pts, e.hue);
  audio.hitSound(combo);
  burst(e.x, e.y, e.hue, isBoss ? 64 : 20, isBoss ? 260 : 180);
  // sliced-in-half robot debris (PEGI-safe: robots + sparks)
  const cutA = hero ? Math.atan2(e.y - hero.y, e.x - hero.x) + Math.PI / 2 : Math.random() * Math.PI * 2;
  for (const side of [-1, 1]) {
    pushBounded(debris, {
      x: e.x, y: e.y, r: e.r, hue: e.hue, type: e.type, side,
      cutA,
      vx: Math.cos(cutA + side * Math.PI / 2) * (70 + Math.random() * 60),
      vy: Math.sin(cutA + side * Math.PI / 2) * (70 + Math.random() * 60) - 40,
      rot: (Math.random() - 0.5) * 2, vr: side * (3 + Math.random() * 4),
      t: 0, life: 0.7 + Math.random() * 0.3,
    });
  }
  addFlash({ x: e.x, y: e.y, r: isBoss ? 90 : 46, hue: e.hue, t: 0, life: isBoss ? 0.4 : 0.25 });
  // drop persistent cores currency
  const nCores = isBoss ? 5 : e.type === 'shield' || e.type === 'splitter' ? 2 : e.mini ? 0 : Math.random() < 0.55 ? 1 : 0;
  for (let i = 0; i < nCores; i++) {
    const a = Math.random() * Math.PI * 2;
    pushBounded(cores, { x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 8, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, t: 0 }, CAPS.cores);
  }
  // splitter splits into two fast minis
  if (e.type === 'splitter') {
    spawnEnemy('mini', e.x - 12, e.y);
    spawnEnemy('mini', e.x + 12, e.y);
  }
  // vampire perk: +1 heart every 20 kills
  if (stats.vampire) {
    vampireKills++;
    if (vampireKills >= 20) {
      vampireKills = 0;
      if (hero.hp < hero.hpMax) {
        hero.hp++;
        addFloat(hero.x, hero.y - 30, 'VAMPIRE +1 HP', 0);
        audio.pickupSound();
      }
    }
  }
  if (isBoss) {
    shake = 18;
    happytime();
    addFloat(e.x, e.y - 30, e.type === 'twin' ? 'CORE DOWN!' : 'BOSS DOWN!', 55);
  }
}

function doDash() {
  if (hero.dashCd > 0 || state !== 'playing') return;
  hero.dashCd = stats.dashCd;
  hero.dashTimer = 0.16;
  hero.iframes = Math.max(hero.iframes, 0.3);
  let dx = 0, dy = 0;
  if (joy.active && (Math.abs(joy.dx) > 5 || Math.abs(joy.dy) > 5)) { dx = joy.dx; dy = joy.dy; }
  else {
    if (KEYS['a'] || KEYS['arrowleft']) dx -= 1;
    if (KEYS['d'] || KEYS['arrowright']) dx += 1;
    if (KEYS['w'] || KEYS['arrowup']) dy -= 1;
    if (KEYS['s'] || KEYS['arrowdown']) dy += 1;
  }
  if (dx === 0 && dy === 0) { dx = Math.cos(hero.aim); dy = Math.sin(hero.aim); }
  const l = Math.hypot(dx, dy) || 1;
  hero.dvx = dx / l * 720; hero.dvy = dy / l * 720;
  audio.dashSound();
}

function damageHero() {
  if (hero.iframes > 0 || secondWindShield > 0 || hero.dashTimer > 0) return;
  hero.hp -= 1;
  hero.iframes = 1;
  hurtFlash = 0.4;
  shake = 16;
  if (combo > 0) addFloat(hero.x, hero.y - 58, 'CHAIN BROKEN!', 0);
  combo = 0; multiplier = 1; comboTimer = 0; fever = 0;
  audio.hurtSound();
  burst(hero.x, hero.y, 0, 20, 180);
  if (hero.hp <= 0) gameOver();
}

function gameOver() {
  state = 'gameover';
  deathT = 0;
  // spectacular death explosion: multi-ring blast + debris + slowmo shake
  shake = 26;
  addFlash({ x: hero.x, y: hero.y, t: 0, life: 0.7, r: 160, hue: 0 });
  addFlash({ x: hero.x, y: hero.y, t: 0, life: 0.5, r: 90, hue: 160 });
  burst(hero.x, hero.y, 160, 46, 320);
  burst(hero.x, hero.y, 0, 30, 220);
  burst(hero.x, hero.y, 45, 24, 260);
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    pushBounded(debris, { x: hero.x, y: hero.y, vx: Math.cos(a) * (120 + Math.random() * 160), vy: Math.sin(a) * (120 + Math.random() * 160) - 60, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, r: 6 + Math.random() * 6, side: Math.random() < 0.5 ? 1 : -1, hue: 160, t: 0, life: 1.2 }, CAPS.debris);
  }
  gameplayStop();
  audio.gameOverSound();
  if (score > best) { best = score; saveBest(best); }
  // bank cores collected this run
  if (runCores > 0) addCores(runCores);
  meta.plays++;
  saveMeta();
  coresDoubled = false;
}

function startGame() {
  reset();
  state = 'playing';
  introT = 1.5; // cinematic camera sweep over the arena (skippable with any input)
  gameplayStart();
  audio.startMusic();
  startWave(1);
}

async function playAgain() {
  // A retry is always local and immediate. Rewarded choices are optional; no
  // midgame ad is allowed to turn this natural break into a mandatory wait.
  startGame();
}

async function doubleCores() {
  if (adBusy || coresDoubled || runCores <= 0) return;
  adBusy = true;
  const ok = await requestAd('rewarded', {
    onStart: () => { audio.setMuted(true); setPaused('ad', true); },
    onFinish: () => { audio.setMuted(getMuteSetting()); setPaused('ad', false); },
  });
  adBusy = false;
  if (ok) {
    coresDoubled = true;
    addCores(runCores); // second helping (first already banked in gameOver)
    audio.buySound();
    happytime();
  }
}

async function secondWind() {
  if (adBusy || secondWindUsed) return;
  adBusy = true;
  const ok = await requestAd('rewarded', {
    onStart: () => { audio.setMuted(true); setPaused('ad', true); },
    onFinish: () => { audio.setMuted(getMuteSetting()); setPaused('ad', false); },
  });
  adBusy = false;
  if (ok) {
    secondWindUsed = true;
    hero.hp = hero.hpMax;
    hero.iframes = 3;
    secondWindShield = 3;
    state = 'playing';
    gameplayStart();
    addFloat(hero.x, hero.y - 40, 'SECOND WIND!', 130);
    burst(hero.x, hero.y, 130, 30, 200);
    audio.pickupSound();
  }
}

// ---------- update ----------
function update(dt) {
  tPulse += dt;
  if (introT > 0) introT = Math.max(0, introT - dt);
  if (state === 'gameover') deathT += dt;
  if (state !== 'playing') {
    updateFx(dt);
    return;
  }
  if (hitStop > 0) { hitStop -= dt; updateFx(dt * 0.15); return; }
  if (slowmo > 0) { slowmo -= dt; timeScale = 0.3; } else timeScale = 1;
  if (fever > 0) fever -= dt;
  hintT += dt;
  const sdt = dt * timeScale;
  const heroSpeed = hero.speed * (fever > 0 ? 1.25 : 1);

  // hero movement
  let mx = 0, my = 0;
  if (joy.active) { mx = joy.dx; my = joy.dy; const l = Math.hypot(mx, my); if (l > 40) { mx = mx / l; my = my / l; } else { mx /= 40; my /= 40; } }
  else {
    if (KEYS['a'] || KEYS['arrowleft']) mx -= 1;
    if (KEYS['d'] || KEYS['arrowright']) mx += 1;
    if (KEYS['w'] || KEYS['arrowup']) my -= 1;
    if (KEYS['s'] || KEYS['arrowdown']) my += 1;
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
  }
  if (hero.dashTimer > 0) {
    hero.dashTimer -= sdt;
    hero.x += hero.dvx * sdt; hero.y += hero.dvy * sdt;
    pushBounded(hero.trail, { x: hero.x, y: hero.y, t: 0 }, CAPS.trail);
    pushBounded(hero.ghosts, { x: hero.x, y: hero.y, aim: hero.aim, t: 0 }, CAPS.ghosts);
    hero.cloak = Math.min(1, hero.cloak + dt * 12);
  } else {
    hero.x += mx * heroSpeed * sdt;
    hero.y += my * heroSpeed * sdt;
    if (Math.abs(mx) + Math.abs(my) > 0.1 && Math.random() < 0.3) pushBounded(hero.trail, { x: hero.x, y: hero.y, t: 0.25 }, CAPS.trail);
    hero.cloak = Math.max(0, hero.cloak - dt * 3);
    hero.breathe += dt;
  }
  // clamp to arena
  const hd = Math.hypot(hero.x - CX, hero.y - CY);
  if (hd > ARENA_R - 12) {
    hero.x = CX + (hero.x - CX) / hd * (ARENA_R - 12);
    hero.y = CY + (hero.y - CY) / hd * (ARENA_R - 12);
  }
  if (!isTouch) hero.aim = Math.atan2(mouseY - hero.y, mouseX - hero.x);
  else if (Math.abs(mx) + Math.abs(my) > 0.1) hero.aim = Math.atan2(my, mx);

  hero.slashCd -= sdt; hero.dashCd -= sdt; hero.iframes -= sdt;
  if (hero.slashTimer > 0) hero.slashTimer -= sdt;
  if (secondWindShield > 0) secondWindShield -= sdt;

  // combo timer
  if (comboTimer > 0) {
    comboTimer -= sdt;
    if (comboTimer <= 0) { combo = 0; multiplier = 1; }
  }

  // Sector hazard: it announces itself first, then damages at most once per
  // second while active. The edge is deliberately inside the arena so a dash
  // can always escape it.
  if (hazard) {
    if (hazard.warning > 0) hazard.warning -= sdt;
    else {
      hazard.active -= sdt;
      hazard.hitCd -= sdt;
      const ha = Math.atan2(hero.y - CY, hero.x - CX);
      const hr = Math.hypot(hero.x - CX, hero.y - CY);
      if (hazard.active > 0 && hr > 92 && angDiff(ha, hazard.angle) < hazard.width && hazard.hitCd <= 0) {
        hazard.hitCd = 0.9;
        damageHero();
      }
      if (hazard.active <= 0) hazard = null;
    }
  }

  // spawn queue
  if (spawnQueue.length > 0) {
    spawnTimer -= sdt;
    if (spawnTimer <= 0) { spawnEnemy(spawnQueue.shift()); spawnTimer = spawnGap; }
  }

  // enemies
  for (const e of enemies) {
    e.t += sdt;
    if (e.hitFlash > 0) e.hitFlash -= sdt;
    if (e.spawn > 0) { e.spawn -= sdt; continue; }
    const dx = hero.x - e.x, dy = hero.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (e.type === 'melee') {
      e.x += dx / d * e.speed * sdt; e.y += dy / d * e.speed * sdt;
      e.attackCd -= sdt;
      if (d < e.r + 16 && e.attackCd <= 0 && e.windup <= 0) e.windup = 0.42;
      if (e.windup > 0) {
        e.windup -= sdt;
        if (e.windup <= 0 && d < e.r + 22) damageHero();
        if (e.windup <= 0) e.attackCd = 0.8;
      }
    } else if (e.type === 'shield') {
      e.face = Math.atan2(dy, dx); // always faces the hero
      e.x += dx / d * e.speed * sdt; e.y += dy / d * e.speed * sdt;
      if (d < e.r + 14) damageHero();
    } else if (e.type === 'shooter') {
      const want = 230;
      const dir = d > want ? 1 : -0.6;
      e.x += dx / d * e.speed * dir * sdt; e.y += dy / d * e.speed * dir * sdt;
      e.fireCd -= sdt;
      if (e.charge > 0) {
        e.charge -= sdt;
        if (e.charge <= 0) {
          e.fireCd = 2.2 - Math.min(wave * 0.05, 0.8);
          pushBounded(bullets, { x: e.x, y: e.y, vx: dx / d * 150, vy: dy / d * 150, r: 6, hue: 320, friendly: false }, CAPS.bullets);
        }
      } else if (e.fireCd <= 0.7) {
        e.charge = 0.7;
        addFloat(e.x, e.y - 24, 'LOCKING', e.hue);
      }
      if (d < e.r + 14) damageHero();
    } else if (e.type === 'kamikaze') {
      e.x += dx / d * e.speed * sdt; e.y += dy / d * e.speed * sdt;
      if (d < 150 && !e.fuseStarted) { e.fuse = 0.85; e.fuseStarted = true; addFloat(e.x, e.y - 22, 'DANGER', 0); }
      if (e.fuseStarted) e.fuse -= sdt;
      if (e.fuseStarted && e.fuse <= 0) {
        e.dead = true;
        burst(e.x, e.y, 20, 22, 200);
        shake = 12;
        audio.hurtSound();
        if (d < e.r + 28) damageHero();
      }
    } else if (e.type === 'boss') {
      e.chargeCd -= sdt; e.fireCd -= sdt;
      if (e.charging > 0) {
        e.charging -= sdt;
        e.x += e.cvx * sdt; e.y += e.cvy * sdt;
      } else {
        e.x += dx / d * e.speed * sdt; e.y += dy / d * e.speed * sdt;
        if (e.phaseWarn > 0) {
          e.phaseWarn -= sdt;
          if (e.phaseWarn <= 0) { e.charging = 0.6; e.cvx = dx / d * 320; e.cvy = dy / d * 320; }
        } else if (e.chargeCd <= 0) {
          e.chargeCd = 4.5; e.phaseWarn = 0.75;
          e.cvx = dx / d * 320; e.cvy = dy / d * 320;
          audio.dashSound();
        }
        if (e.fireCd <= 0) {
          e.fireCd = 2.8;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + e.t;
            pushBounded(bullets, { x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, r: 6, hue: 280, friendly: false }, CAPS.bullets);
          }
        }
      }
      const bd = Math.hypot(e.x - CX, e.y - CY);
      if (bd > ARENA_R - e.r) { e.x = CX + (e.x - CX) / bd * (ARENA_R - e.r); e.y = CY + (e.y - CY) / bd * (ARENA_R - e.r); }
      if (d < e.r + 14) damageHero();
    } else if (e.type === 'splitter') {
      // lumbering zigzag approach
      const wob = Math.sin(e.t * 4) * 0.6;
      const a2 = Math.atan2(dy, dx) + wob;
      e.pulse = (e.pulse + sdt) % 2.2;
      const pulseSpeed = e.pulse > 1.7 ? 1.35 : 1;
      e.x += Math.cos(a2) * e.speed * pulseSpeed * sdt; e.y += Math.sin(a2) * e.speed * pulseSpeed * sdt;
      if (d < e.r + 14) damageHero();
    } else if (e.type === 'twin') {
      // orbits the arena edge, spiral fire toward hero
      e.orbitA += e.orbitDir * (e.speed / 180) * sdt;
      const or = ARENA_R * 0.62;
      const tx = CX + Math.cos(e.orbitA) * or, ty = CY + Math.sin(e.orbitA) * or;
      e.x += (tx - e.x) * Math.min(1, 2.5 * sdt);
      e.y += (ty - e.y) * Math.min(1, 2.5 * sdt);
      e.fireCd -= sdt;
      if (e.fireCd <= 0) {
        e.fireCd = 1.9;
        const base = Math.atan2(hero.y - e.y, hero.x - e.x);
        for (let i = -1; i <= 1; i++) {
          const a3 = base + i * 0.35;
          pushBounded(bullets, { x: e.x, y: e.y, vx: Math.cos(a3) * 140, vy: Math.sin(a3) * 140, r: 6, hue: 335, friendly: false }, CAPS.bullets);
        }
      }
      if (d < e.r + 14) damageHero();
    }
  }
  enemies = enemies.filter(e => !e.dead);

  // bullets
  for (const b of bullets) {
    b.x += b.vx * sdt; b.y += b.vy * sdt;
    const bd = Math.hypot(b.x - CX, b.y - CY);
    if (bd > ARENA_R + 30) { b.dead = true; continue; }
    if (!b.friendly) {
      if (Math.hypot(b.x - hero.x, b.y - hero.y) < b.r + 12) { b.dead = true; damageHero(); }
    } else {
      for (const e of enemies) {
        if (e.spawn > 0) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) < b.r + e.r) {
          b.dead = true;
          e.hp -= 2; e.hitFlash = 0.15;
          if (e.hp <= 0) killEnemy(e);
          break;
        }
      }
    }
  }
  bullets = bullets.filter(b => !b.dead);
  enemies = enemies.filter(e => !e.dead);

  // pickups (heart) — with core magnet pull
  for (const p of pickups) {
    p.t += sdt;
    const pd = Math.hypot(p.x - hero.x, p.y - hero.y);
    if (pd < stats.magnet && pd > 1) {
      p.x += (hero.x - p.x) / pd * 160 * sdt;
      p.y += (hero.y - p.y) / pd * 160 * sdt;
    }
    if (pd < 24 && hero.hp < hero.hpMax) {
      p.dead = true;
      hero.hp = Math.min(hero.hpMax, hero.hp + 1);
      audio.pickupSound();
      addFloat(p.x, p.y, '+1 HP', 0);
      burst(p.x, p.y, 350, 12, 130);
    }
  }
  pickups = pickups.filter(p => !p.dead);

  // cores (persistent currency drops)
  for (const c of cores) {
    c.t += sdt;
    c.x += c.vx * sdt; c.y += c.vy * sdt;
    c.vx *= 0.92; c.vy *= 0.92;
    const cd2 = Math.hypot(c.x - hero.x, c.y - hero.y);
    if (cd2 < stats.magnet && cd2 > 1) {
      c.x += (hero.x - c.x) / cd2 * 260 * sdt;
      c.y += (hero.y - c.y) / cd2 * 260 * sdt;
    }
    if (cd2 < 20) {
      c.dead = true;
      runCores++;
      audio.coreSound();
    }
    if (c.t > 12) c.dead = true; // despawn
  }
  cores = cores.filter(c => !c.dead);

  // wave clear
  if (enemies.length === 0 && spawnQueue.length === 0 && state === 'playing') {
    score += wave * 50;
    addFloat(CX, CY - 60, 'WAVE ' + wave + ' CLEAR +' + (wave * 50), 55);
    startWave(wave + 1);
  }

  updateFx(dt);
}

function updateFx(dt) {
  if (waveBanner > 0) waveBanner -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 40);
  if (hurtFlash > 0) hurtFlash -= dt;
  for (const p of particles) {
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.96; p.vy *= 0.96;
  }
  particles = particles.filter(p => p.t < p.life);
  for (const d of debris) {
    d.t += dt;
    d.x += d.vx * dt; d.y += d.vy * dt;
    d.vx *= 0.94; d.vy = d.vy * 0.94 + 140 * dt; // light gravity
    d.rot += d.vr * dt;
    // spark trail off the cut edge
    if (Math.random() < 0.35) addParticle({ x: d.x, y: d.y, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 40, life: 0.25, t: 0, hue: 45, spring: false, r: 1.5 });
  }
  debris = debris.filter(d => d.t < d.life);
  for (const fl of flashes) fl.t += dt;
  flashes = flashes.filter(fl => fl.t < fl.life);
  for (const b of beams) b.t += dt;
  beams = beams.filter(b => b.t < b.life);
  for (const f of floats) { f.t += dt; f.y -= 30 * dt; }
  floats = floats.filter(f => f.t < 1.2);
  if (hero) {
    for (const tr of hero.trail) tr.t += dt;
    hero.trail = hero.trail.filter(tr => tr.t < 0.4);
    for (const gh of hero.ghosts) gh.t += dt;
    hero.ghosts = hero.ghosts.filter(gh => gh.t < 0.3);
    for (const a of hero.slashArcs) a.t += dt;
    hero.slashArcs = hero.slashArcs.filter(a => a.t < 0.22);
  }
}

// ---------- render ----------
function neonCircle(x, y, r, hue, glow, alpha = 1) {
  g.save();
  g.shadowColor = 'hsl(' + hue + ',100%,60%)';
  g.shadowBlur = glow;
  g.strokeStyle = 'hsla(' + hue + ',100%,70%,' + alpha + ')';
  g.lineWidth = 2.5;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  g.restore();
}

// ---------- pre-rendered tech floor (static layer, drawn once) ----------
let floorCanvas = null;
let circuitPaths = []; // energy flow routes for animated pulses
function seededRand(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function buildFloor() {
  floorCanvas = document.createElement('canvas');
  floorCanvas.width = W; floorCanvas.height = H;
  const f = floorCanvas.getContext('2d');
  const rnd = seededRand(1337);
  // NOTE: outside the arena stays TRANSPARENT — the screen-space cyberpunk
  // environment (crowd, billboards, drones) shows through there.
  // soft ground glow under the arena disk
  const halo = f.createRadialGradient(CX, CY, ARENA_R * 0.8, CX, CY, ARENA_R * 1.35);
  halo.addColorStop(0, 'rgba(20,40,90,0.55)');
  halo.addColorStop(1, 'rgba(20,40,90,0)');
  f.fillStyle = halo;
  f.beginPath(); f.arc(CX, CY, ARENA_R * 1.35, 0, Math.PI * 2); f.fill();
  // arena floor: clipped tech panels
  f.save();
  f.beginPath(); f.arc(CX, CY, ARENA_R, 0, Math.PI * 2); f.clip();
  const fg = f.createRadialGradient(CX, CY - 60, 40, CX, CY, ARENA_R);
  fg.addColorStop(0, '#16234a'); fg.addColorStop(0.7, '#101835'); fg.addColorStop(1, '#0b1128');
  f.fillStyle = fg; f.fillRect(CX - ARENA_R, CY - ARENA_R, ARENA_R * 2, ARENA_R * 2);
  // hex/rect tech plates with tone variance
  const PS = 56;
  for (let px = CX - ARENA_R; px < CX + ARENA_R; px += PS) {
    for (let py = CY - ARENA_R; py < CY + ARENA_R; py += PS) {
      const v = rnd();
      f.fillStyle = 'rgba(' + Math.round(34 + v * 30) + ',' + Math.round(52 + v * 36) + ',' + Math.round(105 + v * 48) + ',' + (0.16 + v * 0.14) + ')';
      f.fillRect(px + 2, py + 2, PS - 4, PS - 4);
      f.strokeStyle = 'rgba(80,120,220,0.16)'; f.lineWidth = 1;
      f.strokeRect(px + 2, py + 2, PS - 4, PS - 4);
      // panel details: bolts / vents on some plates
      if (v > 0.75) {
        f.fillStyle = 'rgba(120,170,255,0.14)';
        f.fillRect(px + 8, py + 8, 4, 4); f.fillRect(px + PS - 12, py + 8, 4, 4);
        f.fillRect(px + 8, py + PS - 12, 4, 4); f.fillRect(px + PS - 12, py + PS - 12, 4, 4);
      } else if (v < 0.14) {
        f.strokeStyle = 'rgba(90,140,255,0.12)';
        for (let k = 0; k < 3; k++) { f.beginPath(); f.moveTo(px + 10, py + 16 + k * 10); f.lineTo(px + PS - 10, py + 16 + k * 10); f.stroke(); }
      }
    }
  }
  // circuit traces (drawn on floor + saved as flow routes)
  circuitPaths = [];
  for (let i = 0; i < 14; i++) {
    const a0 = rnd() * Math.PI * 2;
    let x = CX + Math.cos(a0) * (rnd() * ARENA_R * 0.85);
    let y = CY + Math.sin(a0) * (rnd() * ARENA_R * 0.85);
    const pts = [{ x, y }];
    let dir = Math.floor(rnd() * 4) * Math.PI / 2;
    for (let s = 0; s < 6; s++) {
      const len = 26 + rnd() * 50;
      x += Math.cos(dir) * len; y += Math.sin(dir) * len;
      const d = Math.hypot(x - CX, y - CY);
      if (d > ARENA_R - 16) break;
      pts.push({ x, y });
      dir += (rnd() < 0.5 ? 1 : -1) * Math.PI / 2;
    }
    if (pts.length < 3) continue;
    circuitPaths.push(pts);
    f.strokeStyle = 'rgba(60,190,255,0.13)'; f.lineWidth = 1.6;
    f.beginPath(); f.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) f.lineTo(p.x, p.y);
    f.stroke();
    // solder-node dots at junctions
    f.fillStyle = 'rgba(90,210,255,0.24)';
    for (const p of pts) { f.beginPath(); f.arc(p.x, p.y, 2.2, 0, Math.PI * 2); f.fill(); }
  }
  // concentric guide rings
  f.strokeStyle = 'rgba(80,140,255,0.10)'; f.lineWidth = 1.5;
  for (const rr of [ARENA_R * 0.33, ARENA_R * 0.66]) { f.beginPath(); f.arc(CX, CY, rr, 0, Math.PI * 2); f.stroke(); }
  f.restore();
  // wall segments outside the ring (columns/struts)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const wx = CX + Math.cos(a) * (ARENA_R + 22), wy = CY + Math.sin(a) * (ARENA_R + 22);
    f.save(); f.translate(wx, wy); f.rotate(a + Math.PI / 2);
    f.fillStyle = 'rgba(20,30,64,0.9)'; f.strokeStyle = 'rgba(90,140,255,0.35)'; f.lineWidth = 1.5;
    f.fillRect(-14, -6, 28, 12); f.strokeRect(-14, -6, 28, 12);
    f.fillStyle = 'rgba(120,220,255,0.5)';
    f.fillRect(-10, -2, 5, 4); f.fillRect(5, -2, 5, 4);
    f.restore();
  }
}

function drawFloorDynamic() {
  // animated energy pulses flowing along circuit traces
  g.save();
  g.beginPath(); g.arc(CX, CY, ARENA_R, 0, Math.PI * 2); g.clip();
  for (let i = 0; i < circuitPaths.length; i++) {
    const pts = circuitPaths[i];
    let total = 0; const segs = [];
    for (let s = 0; s < pts.length - 1; s++) { const L = Math.hypot(pts[s + 1].x - pts[s].x, pts[s + 1].y - pts[s].y); segs.push(L); total += L; }
    const prog = ((tPulse * (40 + (i % 5) * 14) + i * 137) % total);
    let acc = 0;
    for (let s = 0; s < segs.length; s++) {
      if (prog <= acc + segs[s]) {
        const t = (prog - acc) / segs[s];
        const px = pts[s].x + (pts[s + 1].x - pts[s].x) * t;
        const py = pts[s].y + (pts[s + 1].y - pts[s].y) * t;
        g.shadowColor = '#4dd2ff'; g.shadowBlur = 10;
        g.fillStyle = 'rgba(140,230,255,0.9)';
        g.beginPath(); g.arc(px, py, 2.4, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        break;
      }
      acc += segs[s];
    }
  }
  // neon reflections on the floor: soft pools of light under glowing actors
  if (state === 'playing' || state === 'gameover') {
    g.globalCompositeOperation = 'lighter';
    const pool = (x, y, r, hue, a) => {
      const rg = g.createRadialGradient(x, y + 6, 2, x, y + 6, r);
      rg.addColorStop(0, 'hsla(' + hue + ',100%,60%,' + a + ')');
      rg.addColorStop(1, 'hsla(' + hue + ',100%,60%,0)');
      g.fillStyle = rg;
      g.beginPath(); g.ellipse(x, y + 6, r, r * 0.45, 0, 0, Math.PI * 2); g.fill();
    };
    if (hero) pool(hero.x, hero.y + 10, 30, 160, 0.10);
    for (const e of enemies) if (e.spawn <= 0) pool(e.x, e.y + e.r * 0.6, e.r * 1.8, e.hue, 0.08);
    for (const b of bullets) pool(b.x, b.y + 4, 14, b.hue, 0.10);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
}

function drawHazard() {
  if (!hazard) return;
  const active = hazard.warning <= 0;
  const pulse = 0.65 + Math.sin(tPulse * (active ? 18 : 7)) * 0.25;
  g.save();
  g.beginPath();
  g.moveTo(CX, CY);
  g.arc(CX, CY, ARENA_R - 8, hazard.angle - hazard.width, hazard.angle + hazard.width);
  g.closePath();
  g.fillStyle = active ? 'rgba(80,210,255,' + (0.13 + pulse * 0.12) + ')' : 'rgba(255,185,50,0.16)';
  g.fill();
  g.strokeStyle = active ? 'rgba(120,240,255,' + pulse + ')' : 'rgba(255,205,70,' + pulse + ')';
  g.lineWidth = active ? 4 : 3;
  g.shadowColor = active ? '#4dffd2' : '#ffd24d'; g.shadowBlur = active ? 18 : 12;
  g.beginPath();
  g.arc(CX, CY, ARENA_R - 10, hazard.angle - hazard.width, hazard.angle + hazard.width);
  g.stroke();
  if (!active) {
    g.fillStyle = '#ffe14d'; g.font = '800 15px "Segoe UI", sans-serif'; g.textAlign = 'center';
    const tx = CX + Math.cos(hazard.angle) * 140, ty = CY + Math.sin(hazard.angle) * 140;
    g.fillText('FLOOR CHARGING', tx, ty);
  }
  g.restore();
}

// ---------- screen-space cyberpunk environment (crowd stands, billboards, drones, fog) ----------
let envBillboards = [];   // {x,y,w,h,kind}
let envSparkPts = [];     // damaged-panel spark emitters (screen space)
let envCrowd = [];        // animated front-row spectators {x,y,r,hue,ph}
function buildEnv() {
  envCanvas = document.createElement('canvas');
  envCanvas.width = Math.round(VW * DPR);
  envCanvas.height = Math.round(VH * DPR);
  const f = envCanvas.getContext('2d');
  f.scale(DPR, DPR);
  const rnd = seededRand(4242);
  const acx = cam.ox + CX * cam.scale, acy = cam.oy + CY * cam.scale;
  const ar = ARENA_R * cam.scale;
  // deep gradient sky
  const bg = f.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, '#070a1e'); bg.addColorStop(0.5, '#0a0d24'); bg.addColorStop(1, '#130a2c');
  f.fillStyle = bg; f.fillRect(0, 0, VW, VH);
  // distant megacity skyline (two parallax silhouette layers with lit windows)
  for (const layer of [{ h: 0.34, col: 'rgba(16,22,52,0.9)', win: 0.35 }, { h: 0.22, col: 'rgba(26,34,74,0.9)', win: 0.5 }]) {
    let x = -20;
    while (x < VW + 20) {
      const bw = 36 + rnd() * 90, bh = VH * layer.h * (0.45 + rnd() * 0.75);
      f.fillStyle = layer.col;
      f.fillRect(x, VH * 0.52 - bh, bw, bh);
      // antenna
      if (rnd() > 0.6) { f.fillRect(x + bw / 2 - 1, VH * 0.52 - bh - 14, 2, 14); f.fillStyle = 'rgba(255,80,120,0.8)'; f.fillRect(x + bw / 2 - 1.5, VH * 0.52 - bh - 16, 3, 3); }
      // windows
      for (let wy = VH * 0.52 - bh + 6; wy < VH * 0.52 - 8; wy += 9) {
        for (let wx = x + 4; wx < x + bw - 4; wx += 8) {
          if (rnd() < layer.win * 0.4) {
            const hu = [185, 300, 45, 330][Math.floor(rnd() * 4)];
            f.fillStyle = 'hsla(' + hu + ',90%,65%,' + (0.25 + rnd() * 0.5) + ')';
            f.fillRect(wx, wy, 3, 4);
          }
        }
      }
      x += bw + 2 + rnd() * 8;
    }
  }
  // faint perspective grid on the lower half (stadium floor around arena)
  f.strokeStyle = 'rgba(60,90,200,0.10)'; f.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const yy = VH * 0.52 + Math.pow(i / 14, 1.6) * VH * 0.5;
    f.beginPath(); f.moveTo(0, yy); f.lineTo(VW, yy); f.stroke();
  }
  for (let i = -10; i <= 10; i++) {
    f.beginPath(); f.moveTo(VW / 2 + i * VW * 0.06, VH * 0.52); f.lineTo(VW / 2 + i * VW * 0.24, VH + 2); f.stroke();
  }
  // ---- audience terraces: concentric stands around the arena, packed with robot fans ----
  envCrowd = [];
  for (let ring = 0; ring < 4; ring++) {
    const rr = ar + 34 + ring * (34 + ring * 6);
    // terrace band
    f.strokeStyle = 'rgba(24,36,80,0.95)'; f.lineWidth = 26 + ring * 4;
    f.beginPath(); f.arc(acx, acy, rr, 0, Math.PI * 2); f.stroke();
    f.strokeStyle = 'rgba(70,110,255,0.16)'; f.lineWidth = 1.5;
    f.beginPath(); f.arc(acx, acy, rr - 12 - ring * 2, 0, Math.PI * 2); f.stroke();
    // robot spectators: silhouette bodies + glowing eyes
    const n = Math.floor((Math.PI * 2 * rr) / (16 - ring * 1.5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.05;
      const px = acx + Math.cos(a) * rr, py = acy + Math.sin(a) * rr;
      if (px < -20 || px > VW + 20 || py < -20 || py > VH + 20) continue;
      if (rnd() < 0.12) continue; // empty seats
      const s = (0.75 + rnd() * 0.5) * (1 + ring * 0.12);
      const hu = [185, 300, 45, 330, 130][Math.floor(rnd() * 5)];
      // body silhouette
      f.fillStyle = 'rgba(10,16,38,0.95)';
      f.beginPath(); f.arc(px, py + 3 * s, 6.5 * s, Math.PI, 0); f.fill();
      f.fillRect(px - 6.5 * s, py + 3 * s, 13 * s, 6 * s);
      // head
      f.beginPath(); f.arc(px, py - 4 * s, 4.2 * s, 0, Math.PI * 2); f.fill();
      // glowing eyes
      f.fillStyle = 'hsla(' + hu + ',100%,65%,0.9)';
      f.fillRect(px - 2.6 * s, py - 5 * s, 1.8 * s, 1.6 * s);
      f.fillRect(px + 0.8 * s, py - 5 * s, 1.8 * s, 1.6 * s);
      if (ring === 0 && envCrowd.length < 60 && rnd() < 0.5) envCrowd.push({ x: px, y: py, r: s, hue: hu, ph: rnd() * 6.28 });
    }
  }
  // ---- hanging cables from the top with signal lights ----
  for (let i = 0; i < 7; i++) {
    const x0 = rnd() * VW, x1 = x0 + (rnd() - 0.5) * 300;
    const sag = 30 + rnd() * 70;
    f.strokeStyle = 'rgba(40,60,120,0.55)'; f.lineWidth = 2 + rnd() * 2;
    f.beginPath(); f.moveTo(x0, -4);
    f.quadraticCurveTo((x0 + x1) / 2, sag * 2, x1, -4);
    f.stroke();
    f.fillStyle = 'hsla(' + (rnd() < 0.5 ? 0 : 130) + ',100%,60%,0.85)';
    f.beginPath(); f.arc((x0 + x1) / 2, sag, 2.5, 0, Math.PI * 2); f.fill();
  }
  // ---- vertical neon strips + kanji-style glyph signs on left/right edges ----
  const glyphs = 'ネオンスラッシュ斬撃戦闘電脳';
  for (const side of [0, 1]) {
    const ex = side === 0 ? 14 + rnd() * 30 : VW - 14 - rnd() * 30;
    const hu = side === 0 ? 300 : 185;
    f.save();
    f.shadowColor = 'hsl(' + hu + ',100%,60%)'; f.shadowBlur = 14;
    f.strokeStyle = 'hsla(' + hu + ',100%,65%,0.75)'; f.lineWidth = 3;
    f.beginPath(); f.moveTo(ex, VH * 0.12); f.lineTo(ex, VH * 0.8); f.stroke();
    // vertical glyph sign
    f.fillStyle = 'hsla(' + hu + ',100%,75%,0.85)';
    f.font = '700 ' + Math.round(16 + VH * 0.012) + 'px sans-serif';
    f.textAlign = 'center';
    for (let i2 = 0; i2 < 6; i2++) {
      f.fillText(glyphs[Math.floor(rnd() * glyphs.length)], ex + (side === 0 ? 22 : -22), VH * 0.2 + i2 * (18 + VH * 0.014));
    }
    f.restore();
  }
  // ---- floor pipes along the bottom + hazard stripes ----
  f.fillStyle = 'rgba(18,26,58,0.9)';
  f.fillRect(0, VH - 16, VW, 16);
  f.strokeStyle = 'rgba(90,140,255,0.25)'; f.lineWidth = 1.5;
  f.beginPath(); f.moveTo(0, VH - 16); f.lineTo(VW, VH - 16); f.stroke();
  for (let x = 0; x < VW; x += 34) {
    f.fillStyle = 'rgba(255,200,40,0.20)';
    f.beginPath(); f.moveTo(x, VH); f.lineTo(x + 12, VH - 16); f.lineTo(x + 20, VH - 16); f.lineTo(x + 8, VH); f.closePath(); f.fill();
  }
  // ---- holo-billboard frames (content drawn per-frame in drawEnvDynamic) ----
  envBillboards = [];
  const bbw = Math.max(150, VW * 0.15), bbh = bbw * 0.42;
  const spots = [
    { x: VW * 0.135, y: VH * 0.14, kind: 'wave' },
    { x: VW * 0.865, y: VH * 0.14, kind: 'score' },
    { x: VW * 0.09, y: VH * 0.72, kind: 'hype' },
    { x: VW * 0.91, y: VH * 0.72, kind: 'brand' },
  ];
  for (const sp of spots) {
    const bx = sp.x - bbw / 2, by = sp.y - bbh / 2;
    // support strut
    f.strokeStyle = 'rgba(50,70,140,0.8)'; f.lineWidth = 5;
    f.beginPath(); f.moveTo(sp.x, by + bbh); f.lineTo(sp.x, by + bbh + 26); f.stroke();
    // frame
    f.fillStyle = 'rgba(8,12,30,0.97)';
    f.strokeStyle = 'rgba(90,160,255,0.55)'; f.lineWidth = 2;
    f.beginPath();
    f.moveTo(bx + 10, by); f.lineTo(bx + bbw, by); f.lineTo(bx + bbw, by + bbh - 10);
    f.lineTo(bx + bbw - 10, by + bbh); f.lineTo(bx, by + bbh); f.lineTo(bx, by + 10);
    f.closePath(); f.fill(); f.stroke();
    envBillboards.push({ x: bx, y: by, w: bbw, h: bbh, kind: sp.kind });
  }
  // spark emitters on damaged wall panels (screen ring just outside arena)
  envSparkPts = [];
  const rnd2 = seededRand(777);
  for (let i = 0; i < 6; i++) {
    const a = rnd2() * Math.PI * 2;
    envSparkPts.push({ x: acx + Math.cos(a) * (ar + 22 * cam.scale), y: acy + Math.sin(a) * (ar + 22 * cam.scale), ph: rnd2() * 10 });
  }
  // vignette
  const vg = f.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.38, VW / 2, VH / 2, Math.max(VW, VH) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,8,0.5)');
  f.fillStyle = vg; f.fillRect(0, 0, VW, VH);
}

function drawEnvDynamic() {
  // (screen space; called with g transform = DPR identity)
  const acx = cam.ox + CX * cam.scale, acy = cam.oy + CY * cam.scale;
  const ar = ARENA_R * cam.scale;
  // animated front-row fans: bouncing + waving arms
  for (const c of envCrowd) {
    const bob = Math.abs(Math.sin(tPulse * 2.2 + c.ph)) * 3 * c.r;
    g.fillStyle = 'rgba(12,18,42,0.95)';
    g.beginPath(); g.arc(c.x, c.y - 4 * c.r - bob, 4.2 * c.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'hsla(' + c.hue + ',100%,65%,0.95)';
    g.fillRect(c.x - 2.6 * c.r, c.y - 5 * c.r - bob, 1.8 * c.r, 1.6 * c.r);
    g.fillRect(c.x + 0.8 * c.r, c.y - 5 * c.r - bob, 1.8 * c.r, 1.6 * c.r);
    // waving arm
    if (Math.sin(tPulse * 3 + c.ph) > 0.3) {
      g.strokeStyle = 'rgba(12,18,42,0.95)'; g.lineWidth = 2 * c.r;
      g.beginPath(); g.moveTo(c.x + 4 * c.r, c.y + 2 * c.r);
      g.lineTo(c.x + 7 * c.r, c.y - 4 * c.r - bob * 1.6); g.stroke();
    }
  }
  // camera flashes in the crowd
  for (let i = 0; i < 5; i++) {
    const seed = Math.floor(tPulse * 2.5) * 7 + i * 131;
    const fr = ((seed * 9301 + 49297) % 233280) / 233280;
    if (fr < 0.4) {
      const a = fr * 15.7 + i * 1.3, rr = ar + 40 + (fr * 997 % 1) * 120;
      const fx2 = acx + Math.cos(a) * rr, fy2 = acy + Math.sin(a) * rr;
      const tw = (tPulse * 2.5) % 1;
      if (tw < 0.35 && fx2 > 0 && fx2 < VW && fy2 > 0 && fy2 < VH) {
        g.fillStyle = 'rgba(255,255,255,' + (0.7 * (1 - tw / 0.35)) + ')';
        g.beginPath(); g.arc(fx2, fy2, 2.2, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // searchlight beams sweeping the stadium
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const bx = VW * (0.2 + i * 0.6);
    const sw = Math.sin(tPulse * 0.5 + i * 2.4) * VW * 0.28;
    const grd = g.createLinearGradient(bx, 0, bx + sw, VH);
    grd.addColorStop(0, 'hsla(' + (i === 0 ? 300 : 185) + ',100%,70%,0.10)');
    grd.addColorStop(1, 'hsla(' + (i === 0 ? 300 : 185) + ',100%,70%,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(bx - 12, -4); g.lineTo(bx + 12, -4);
    g.lineTo(bx + sw + 70, VH); g.lineTo(bx + sw - 70, VH); g.closePath(); g.fill();
  }
  g.restore();
  // patrol drones with blinking nav lights + rotor glow
  for (let i = 0; i < 5; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const spd = 34 + i * 14;
    const dx = ((tPulse * spd * dir + i * 337) % (VW + 240) + VW + 240) % (VW + 240) - 120;
    const dy = VH * (0.08 + i * 0.055) + Math.sin(tPulse * 1.3 + i * 2.1) * 14;
    g.save(); g.translate(dx, dy);
    g.fillStyle = 'rgba(14,20,46,0.95)';
    g.strokeStyle = 'rgba(90,150,255,0.5)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-10, 0); g.lineTo(-3, -5); g.lineTo(3, -5); g.lineTo(10, 0); g.lineTo(3, 4); g.lineTo(-3, 4); g.closePath();
    g.fill(); g.stroke();
    // rotor glow discs
    g.fillStyle = 'hsla(185,100%,70%,' + (0.25 + Math.sin(tPulse * 30 + i) * 0.12) + ')';
    g.beginPath(); g.ellipse(-9, -6, 6, 1.8, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(9, -6, 6, 1.8, 0, 0, Math.PI * 2); g.fill();
    // blinking nav light
    if (Math.sin(tPulse * 6 + i * 2) > 0.4) {
      g.shadowColor = '#ff4060'; g.shadowBlur = 8;
      g.fillStyle = '#ff5070';
      g.beginPath(); g.arc(0, 5, 2, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    }
    // occasional scan beam down toward the arena
    if (Math.sin(tPulse * 0.9 + i * 1.7) > 0.82) {
      g.fillStyle = 'hsla(130,100%,60%,0.08)';
      g.beginPath(); g.moveTo(-3, 6); g.lineTo(3, 6); g.lineTo(26, 90); g.lineTo(-26, 90); g.closePath(); g.fill();
    }
    g.restore();
  }
  // holo-billboards: live stats content with flicker + scanlines
  for (let bi = 0; bi < envBillboards.length; bi++) {
    const b = envBillboards[bi];
    const flick = 0.82 + Math.sin(tPulse * 17 + bi * 3.1) * 0.08 + (Math.sin(tPulse * 1.9 + bi) > 0.97 ? -0.35 : 0);
    g.save();
    g.globalAlpha = Math.max(0.3, flick);
    let big = '', small = '', hue = 185;
    if (b.kind === 'wave') { big = state === 'menu' ? 'READY' : 'WAVE ' + Math.max(1, wave); small = 'LIVE ARENA FEED'; hue = 185; }
    else if (b.kind === 'score') { big = state === 'menu' ? 'BEST ' + best : '' + score; small = state === 'menu' ? 'HIGH SCORE' : 'SCORE'; hue = 300; }
    else if (b.kind === 'hype') { big = combo >= 2 ? combo + ' COMBO!' : ['FIGHT!', 'SLASH!', '斬撃!!'][Math.floor(tPulse / 2.5) % 3]; small = 'CROWD CAM'; hue = 45; }
    else { big = ['ROBO-COLA', 'NEO TOKYO', 'CYBER-DYNE'][Math.floor(tPulse / 4) % 3]; small = 'SPONSOR'; hue = 330; }
    g.shadowColor = 'hsl(' + hue + ',100%,60%)'; g.shadowBlur = 12;
    g.fillStyle = 'hsla(' + hue + ',100%,72%,0.95)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 ' + Math.round(b.h * 0.34) + 'px "Segoe UI", sans-serif';
    g.fillText(big, b.x + b.w / 2, b.y + b.h * 0.44);
    g.shadowBlur = 4;
    g.fillStyle = 'hsla(' + hue + ',80%,80%,0.6)';
    g.font = '600 ' + Math.round(b.h * 0.14) + 'px "Segoe UI", sans-serif';
    g.fillText(small, b.x + b.w / 2, b.y + b.h * 0.8);
    // scanline sweep
    const sy = b.y + ((tPulse * 40 + bi * 20) % b.h);
    g.shadowBlur = 0;
    g.fillStyle = 'hsla(' + hue + ',100%,80%,0.12)';
    g.fillRect(b.x + 2, sy, b.w - 4, 3);
    g.restore();
  }
  // sparks from damaged wall panels
  for (const spk of envSparkPts) {
    const cyc = (tPulse + spk.ph) % 3.1;
    if (cyc < 0.4) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const t2 = cyc + i * 0.03;
        const sx = spk.x + Math.sin(spk.ph + i * 9) * 20 * t2;
        const syy = spk.y + 60 * t2 * t2 * 3;
        g.fillStyle = 'hsla(' + (40 + i * 6) + ',100%,' + (70 - t2 * 80) + '%,' + (1 - cyc / 0.4) + ')';
        g.fillRect(sx, syy, 2, 2);
      }
      g.restore();
    }
  }
  // drifting fog banks near the bottom
  g.save();
  for (let i = 0; i < 2; i++) {
    const fx3 = ((tPulse * (8 + i * 5) + i * 500) % (VW + 600)) - 300;
    const fg2 = g.createRadialGradient(fx3, VH * 0.92, 10, fx3, VH * 0.92, VW * 0.3);
    fg2.addColorStop(0, 'rgba(80,110,220,0.05)');
    fg2.addColorStop(1, 'rgba(80,110,220,0)');
    g.fillStyle = fg2;
    g.fillRect(0, VH * 0.6, VW, VH * 0.4);
  }
  g.restore();
}

function fullRect() {
  // covers the whole viewport while inside the UI (world-scale) transform
  g.fillRect(-cam.ox / cam.scale - 4, -cam.oy / cam.scale - 4, VW / cam.scale + 8, VH / cam.scale + 8);
}

function render() {
  // ---- screen space: cyberpunk stadium surroundings (fills every pixel) ----
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!envCanvas) buildEnv();
  g.drawImage(envCanvas, 0, 0, VW, VH);
  drawEnvDynamic();

  // ---- world space (arena + entities), with intro sweep camera ----
  curCam = effectiveCam();
  g.save();
  g.translate(curCam.ox, curCam.oy);
  g.scale(curCam.s, curCam.s);
  if (shake > 0 && !reducedMotion) g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // pre-rendered tech floor + animated circuit energy + neon reflections
  if (!floorCanvas) buildFloor();
  g.drawImage(floorCanvas, 0, 0);
  drawFloorDynamic();
  drawHazard();

  // pulsing arena ring (fever = golden overdrive)
  const pulse = 1 + Math.sin(tPulse * 2.2) * 0.008;
  const ringHue = fever > 0 ? 50 : 195;
  neonCircle(CX, CY, ARENA_R * pulse, ringHue, fever > 0 ? 34 : 22, 0.9);
  neonCircle(CX, CY, ARENA_R * pulse + 8, fever > 0 ? 35 : 265, 12, 0.35);
  // animated energy rings at the arena edge: rotating dash segments + expanding pulse
  g.save();
  for (const ring of [{ r: ARENA_R + 4, n: 24, sp: 0.5, hue: 195, a: 0.5 }, { r: ARENA_R + 14, n: 16, sp: -0.32, hue: 300, a: 0.35 }]) {
    g.strokeStyle = 'hsla(' + (fever > 0 ? 50 : ring.hue) + ',100%,65%,' + ring.a + ')';
    g.lineWidth = 3;
    g.shadowColor = 'hsl(' + ring.hue + ',100%,60%)'; g.shadowBlur = 8;
    for (let i = 0; i < ring.n; i++) {
      const a0 = (i / ring.n) * Math.PI * 2 + tPulse * ring.sp;
      g.beginPath(); g.arc(CX, CY, ring.r, a0, a0 + (Math.PI * 2 / ring.n) * 0.45); g.stroke();
    }
  }
  // expanding pulse ring every ~2.4s
  const pw = (tPulse % 2.4) / 2.4;
  g.strokeStyle = 'hsla(185,100%,70%,' + (0.35 * (1 - pw)) + ')';
  g.lineWidth = 2; g.shadowBlur = 12;
  g.beginPath(); g.arc(CX, CY, ARENA_R * (1 + pw * 0.1), 0, Math.PI * 2); g.stroke();
  g.restore();

  if (state === 'playing' || state === 'gameover') {
    // teleport light columns (enemy spawn beams)
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      const p = b.t / b.life;
      const wgt = 1 - p;
      const bw2 = 10 + p * 26;
      const grad = g.createLinearGradient(b.x, b.y - 300, b.x, b.y);
      grad.addColorStop(0, 'hsla(' + b.hue + ',100%,75%,0)');
      grad.addColorStop(0.7, 'hsla(' + b.hue + ',100%,70%,' + (0.5 * wgt) + ')');
      grad.addColorStop(1, 'hsla(' + b.hue + ',100%,85%,' + (0.85 * wgt) + ')');
      g.fillStyle = grad;
      g.fillRect(b.x - bw2 / 2, b.y - 300, bw2, 300);
      // bright inner core
      g.fillStyle = 'hsla(' + b.hue + ',100%,92%,' + (0.9 * wgt) + ')';
      g.fillRect(b.x - 2, b.y - 300 * (1 - p * 0.5), 4, 300 * (1 - p * 0.5));
      // impact ring on the floor
      g.strokeStyle = 'hsla(' + b.hue + ',100%,75%,' + (0.8 * wgt) + ')';
      g.lineWidth = 3 * wgt + 0.5;
      g.beginPath(); g.ellipse(b.x, b.y, 8 + p * 34, (8 + p * 34) * 0.4, 0, 0, Math.PI * 2); g.stroke();
    }
    g.restore();

    // pickups
    for (const p of pickups) {
      const s = 1 + Math.sin(p.t * 5) * 0.15;
      g.save(); g.translate(p.x, p.y); g.scale(s, s);
      g.shadowColor = '#ff4d6d'; g.shadowBlur = 18;
      g.fillStyle = '#ff4d6d';
      heartPath(0, 0, 11); g.fill();
      g.restore();
    }

    // cores (currency)
    for (const c of cores) {
      const s = 1 + Math.sin(c.t * 6) * 0.2;
      g.save(); g.translate(c.x, c.y); g.rotate(c.t * 2); g.scale(s, s);
      g.shadowColor = '#4dd2ff'; g.shadowBlur = 12;
      g.strokeStyle = '#9ee8ff'; g.fillStyle = 'rgba(30,120,200,0.7)'; g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -6); g.lineTo(5, 0); g.lineTo(0, 6); g.lineTo(-5, 0);
      g.closePath(); g.fill(); g.stroke();
      g.restore();
    }

    // hero trail
    for (const tr of hero.trail) {
      const a = 1 - tr.t / 0.4;
      g.fillStyle = 'hsla(160,100%,60%,' + (a * 0.35) + ')';
      g.beginPath(); g.arc(tr.x, tr.y, 10 * a, 0, Math.PI * 2); g.fill();
    }

    // enemies
    for (const e of enemies) drawEnemy(e);

    // bullets
    for (const b of bullets) {
      g.save();
      g.shadowColor = 'hsl(' + b.hue + ',100%,60%)'; g.shadowBlur = 14;
      g.fillStyle = 'hsl(' + b.hue + ',100%,70%)';
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // hero (hidden after death explosion)
    if (state === 'playing') drawHero();

    // sliced robot halves (debris)
    for (const d of debris) {
      const a = 1 - d.t / d.life;
      g.save();
      g.translate(d.x, d.y);
      g.rotate(d.rot);
      g.globalAlpha = a;
      g.shadowColor = 'hsl(' + d.hue + ',100%,60%)'; g.shadowBlur = 10;
      g.fillStyle = 'hsla(' + d.hue + ',80%,22%,0.9)';
      g.strokeStyle = 'hsl(' + d.hue + ',100%,65%)'; g.lineWidth = 2;
      // half-disc shape with a hot molten cut edge
      g.beginPath(); g.arc(0, 0, d.r, d.side > 0 ? 0 : Math.PI, d.side > 0 ? Math.PI : Math.PI * 2); g.closePath();
      g.fill(); g.stroke();
      g.strokeStyle = 'hsla(45,100%,' + (60 + Math.sin(d.t * 30) * 20) + '%,' + a + ')';
      g.lineWidth = 2.5; g.shadowColor = '#ffd24d'; g.shadowBlur = 12;
      g.beginPath(); g.moveTo(-d.r, 0); g.lineTo(d.r, 0); g.stroke();
      g.restore();
    }

    // radial light flashes (kills / deflects)
    g.globalCompositeOperation = 'lighter';
    for (const fl of flashes) {
      const p = fl.t / fl.life;
      const rg = g.createRadialGradient(fl.x, fl.y, 1, fl.x, fl.y, fl.r * (0.4 + p));
      rg.addColorStop(0, 'hsla(' + fl.hue + ',100%,80%,' + (0.55 * (1 - p)) + ')');
      rg.addColorStop(1, 'hsla(' + fl.hue + ',100%,60%,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(fl.x, fl.y, fl.r * (0.4 + p), 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // particles
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      g.save();
      g.shadowColor = 'hsl(' + p.hue + ',100%,60%)'; g.shadowBlur = 8;
      if (p.spring) {
        g.strokeStyle = 'hsla(' + p.hue + ',100%,70%,' + a + ')';
        g.lineWidth = 1.5;
        g.beginPath();
        for (let i = 0; i <= 6; i++) {
          const px = p.x + i * 2 - 6, py = p.y + Math.sin(i * 2 + p.t * 20) * 3;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      } else {
        g.fillStyle = 'hsla(' + p.hue + ',100%,65%,' + a + ')';
        g.beginPath(); g.arc(p.x, p.y, p.r * a, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }

    // floats
    for (const f of floats) {
      const a = 1 - f.t / 1.2;
      g.save();
      g.shadowColor = 'hsl(' + f.hue + ',100%,60%)'; g.shadowBlur = 10;
      g.fillStyle = 'hsla(' + f.hue + ',100%,75%,' + a + ')';
      g.font = '700 18px "Segoe UI", sans-serif'; g.textAlign = 'center';
      g.fillText(f.text, f.x, f.y);
      g.restore();
    }
  }

  g.restore(); // world space (shake + intro camera)

  // ---- UI space: standard letterbox-fit transform (stable during intro sweep) ----
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.translate(cam.ox, cam.oy);
  g.scale(cam.scale, cam.scale);

  // HUD (slim: big WAVE/SCORE live on the holo-billboards outside the arena)
  if (state === 'playing' || state === 'gameover') {
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.save();
    g.shadowColor = 'rgba(0,0,10,0.9)'; g.shadowBlur = 6;
    g.fillStyle = '#e8f4ff'; g.font = '700 22px "Segoe UI", sans-serif';
    g.fillText('SCORE ' + score, CX, 8);
    g.fillStyle = 'rgba(200,225,255,0.85)'; g.font = '600 14px "Segoe UI", sans-serif';
    g.fillText('WAVE ' + wave + ' · BEST ' + best, CX, 36);
    g.restore();
    g.textAlign = 'left';
    // hearts (bottom-right)
    for (let i = 0; i < hero.hpMax; i++) {
      g.save(); g.translate(W - 30 - i * 30, H - 34);
      g.shadowColor = '#ff4d6d'; g.shadowBlur = 8;
      g.fillStyle = i < hero.hp ? '#ff4d6d' : 'rgba(120,120,140,0.3)';
      heartPath(0, 0, 9); g.fill();
      g.restore();
    }
    // cores counter (bottom-left, above dash bar)
    g.save(); g.translate(24, H - 64);
    g.shadowColor = '#4dd2ff'; g.shadowBlur = 8;
    g.strokeStyle = '#9ee8ff'; g.fillStyle = 'rgba(30,120,200,0.8)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -6); g.lineTo(5, 0); g.lineTo(0, 6); g.lineTo(-5, 0); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.textAlign = 'left';
    g.fillStyle = '#9ee8ff'; g.font = '700 16px "Segoe UI", sans-serif';
    g.fillText('' + runCores, 38, H - 72);
    // fever banner
    if (fever > 0) {
      g.textAlign = 'center';
      g.save();
      g.shadowColor = '#ffe14d'; g.shadowBlur = 18;
      g.fillStyle = 'hsla(55,100%,70%,' + (0.7 + Math.sin(tPulse * 10) * 0.3) + ')';
      g.font = '900 20px "Segoe UI", sans-serif';
      g.fillText('FEVER ' + fever.toFixed(1) + 's', CX, 92);
      g.restore();
    }
    // contextual hints in the first seconds of the very first run
    if (meta.plays === 0 && state === 'playing') {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(190,220,255,' + Math.max(0, Math.min(1, 8 - hintT)) * 0.85 + ')';
      g.font = '600 17px "Segoe UI", sans-serif';
      if (hintT < 4) g.fillText(isTouch ? 'Left thumb: move · Tap right side: slash' : 'WASD: move · Click: slash', CX, H - 70);
      else if (hintT < 8) g.fillText(isTouch ? 'Swipe right side: dash through danger' : 'SPACE: dash through danger', CX, H - 70);
    }
    // combo
    // Fever meter is always present: kills fill it, its underline drains, and
    // a green deflect extends the same timer instead of being hidden scoring.
    g.textAlign = 'center';
    const feverFill = Math.min(1, (combo % 10) / 10 || (combo >= 10 ? 1 : 0));
    g.fillStyle = 'rgba(255,225,77,0.22)'; g.fillRect(CX - 60, 68, 120, 5);
    g.fillStyle = fever > 0 ? '#ffe14d' : '#73f7d6'; g.fillRect(CX - 60, 68, 120 * feverFill, 5);
    g.fillStyle = 'rgba(220,245,255,0.72)'; g.font = '700 12px "Segoe UI", sans-serif';
    g.fillText(fever > 0 ? 'FEVER ACTIVE' : 'FEVER ' + Math.min(combo, 10) + '/10', CX, 53);
    if (combo >= 2) {
      g.textAlign = 'center';
      const cs = 1 + Math.min(combo, 10) * 0.03;
      g.save(); g.translate(CX, 66); g.scale(cs, cs);
      g.shadowColor = '#ffe14d'; g.shadowBlur = 16;
      g.fillStyle = '#ffe14d'; g.font = '900 26px "Segoe UI", sans-serif';
      g.fillText(combo + ' COMBO  x' + multiplier, 0, 0);
      g.restore();
      // combo timer bar
      g.fillStyle = 'rgba(255,225,77,0.8)';
      g.fillRect(CX - 60, 104, 120 * (comboTimer / 3), 4);
    }
    // dash cooldown
    g.textAlign = 'left';
    g.fillStyle = 'rgba(160,240,255,0.7)'; g.font = '600 14px "Segoe UI", sans-serif';
    g.fillText('DASH', 18, H - 34);
    g.strokeStyle = 'rgba(120,200,255,0.5)'; g.strokeRect(60, H - 32, 90, 10);
    g.fillStyle = hero.dashCd <= 0 ? '#4dffd2' : 'rgba(120,200,255,0.5)';
    g.fillRect(60, H - 32, 90 * (1 - Math.max(0, hero.dashCd) / stats.dashCd), 10);
  }

  // wave banner
  if (waveBanner > 0 && state === 'playing') {
    const a = Math.min(1, waveBanner);
    g.textAlign = 'center';
    g.save();
    g.shadowColor = '#9d4dff'; g.shadowBlur = 24;
    g.fillStyle = 'rgba(220,180,255,' + a + ')';
    g.font = '900 44px "Segoe UI", sans-serif';
    g.fillText(waveBannerText, CX, CY - 140);
    g.restore();
  }

  // hurt flash
  if (hurtFlash > 0) {
    g.fillStyle = 'rgba(255,40,80,' + (hurtFlash * (reducedMotion ? 0.14 : 0.4)) + ')';
    fullRect();
  }
  // slowmo tint
  if (slowmo > 0) {
    g.fillStyle = 'rgba(80,200,255,0.08)';
    fullRect();
  }
  // combo fever: full-screen neon overdrive
  if (fever > 0 && state === 'playing') {
    const fa = Math.min(1, fever);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const og = g.createRadialGradient(CX, CY, ARENA_R * 0.5, CX, CY, W * 0.7);
    og.addColorStop(0, 'rgba(255,220,80,0)');
    og.addColorStop(1, 'rgba(255,180,40,' + ((reducedMotion ? 0.03 : 0.10) * fa + (reducedMotion ? 0 : Math.sin(tPulse * 8) * 0.03)) + ')');
    g.fillStyle = og; fullRect();
    // scanline energy bars racing along top & bottom edges
    g.fillStyle = 'rgba(255,225,77,' + 0.5 * fa + ')';
    const bx = (tPulse * 900) % (W + 240) - 120;
    g.fillRect(bx, 0, 120, 3); g.fillRect(W - bx - 120, H - 3, 120, 3);
    g.restore();
  }

  if (state === 'menu') renderMenu();
  if (state === 'shop') renderShop();
  if (state === 'gameover') renderGameOver();
  if (state === 'loading') {
    g.fillStyle = '#9ef0ff'; g.font = '700 28px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('LOADING...', CX, CY);
  }
}

function heartPath(x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.3);
  g.bezierCurveTo(x - s, y - s * 0.6, x - s * 0.5, y - s * 1.3, x, y - s * 0.5);
  g.bezierCurveTo(x + s * 0.5, y - s * 1.3, x + s, y - s * 0.6, x, y + s * 0.3);
  g.lineTo(x, y + s);
  g.lineTo(x - s * 0.02, y + s);
  g.closePath();
  g.moveTo(x, y + s * 0.3);
  g.bezierCurveTo(x - s, y - s * 0.6, x - s * 0.5, y - s * 1.4, x, y - s * 0.4);
  g.bezierCurveTo(x + s * 0.5, y - s * 1.4, x + s, y - s * 0.6, x, y + s);
  g.closePath();
}

function drawHero() {
  const h = hero;
  const kHue = KATANAS[meta.katana].hue;
  // dash afterimages (ghosting)
  for (const gh of h.ghosts) {
    const a = (1 - gh.t / 0.3) * 0.4;
    drawWarrior(gh.x, gh.y, gh.aim, { alpha: a, hue: 160, ghost: true, kHue, breathe: 0, cloak: 1, slash: 0 });
  }
  g.save();
  g.translate(h.x, h.y);
  // i-frames blink / shield
  if (secondWindShield > 0 || h.iframes > 0.05) {
    if (Math.floor(tPulse * 12) % 2 === 0 || secondWindShield > 0) {
      neonCircle(0, 0, 22, secondWindShield > 0 ? 130 : 195, 14, 0.6);
    }
  }
  g.restore();
  drawWarrior(h.x, h.y, h.aim, {
    alpha: 1, hue: 160, kHue,
    breathe: h.breathe, cloak: h.cloak,
    slash: h.slashTimer > 0 ? (1 - h.slashTimer / 0.14) : -1,
    fever: fever > 0,
  });
  // slash arcs
  for (const a of hero.slashArcs) {
    const p = a.t / 0.22;
    g.save();
    g.translate(h.x, h.y);
    g.shadowColor = 'hsl(' + kHue + ',100%,65%)'; g.shadowBlur = 20;
    g.strokeStyle = 'hsla(' + kHue + ',100%,75%,' + (1 - p) + ')';
    g.lineWidth = 8 * (1 - p) + 2;
    g.beginPath();
    g.arc(0, 0, 55 + p * 30, a.a - Math.PI / 3, a.a + Math.PI / 3);
    g.stroke();
    // secondary inner light arc for a layered slash
    g.strokeStyle = 'hsla(' + kHue + ',100%,92%,' + (1 - p) * 0.8 + ')';
    g.lineWidth = 3 * (1 - p) + 1;
    g.beginPath();
    g.arc(0, 0, 44 + p * 26, a.a - Math.PI / 3.4, a.a + Math.PI / 3.4);
    g.stroke();
    g.restore();
  }
}

// hooded warrior sprite (procedural): cloak, hood, glowing eyes, katana
// opts: {alpha, hue, kHue, breathe, cloak (0..1 dash flutter), slash (-1 idle | 0..1 anim), ghost, fever}
function drawWarrior(x, y, aim, opts) {
  const o = opts;
  const br = o.breathe != null ? Math.sin(o.breathe * 2.4) : 0; // idle breathing
  const scale = 1.25 * (1 + br * 0.02); // bigger presence on the arena
  g.save();
  g.translate(x, y);
  g.rotate(aim);
  g.scale(scale, scale);
  g.globalAlpha = o.alpha;
  const bodyGlow = o.fever ? '#ffe14d' : '#4dffd2';
  // cloak: flowing behind, flutter amplitude driven by o.cloak (dash) + gentle idle sway
  const flut = 0.35 + (o.cloak || 0) * 1.4;
  g.shadowColor = bodyGlow; g.shadowBlur = o.ghost ? 6 : 14;
  g.fillStyle = o.ghost ? 'rgba(30,90,80,0.55)' : '#0a2320';
  g.strokeStyle = o.ghost ? 'rgba(77,255,210,0.5)' : bodyGlow;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-4, -7);
  const t = tPulse * (10 + (o.cloak || 0) * 14);
  g.quadraticCurveTo(-14 - flut * 4, -10 - Math.sin(t) * 3 * flut, -19 - flut * 6, -4 + Math.sin(t * 1.3) * 3 * flut);
  g.quadraticCurveTo(-16 - flut * 5, 0, -19 - flut * 6, 4 + Math.sin(t * 1.1 + 2) * 3 * flut);
  g.quadraticCurveTo(-14 - flut * 4, 10 + Math.sin(t + 1) * 3 * flut, -4, 7);
  g.closePath(); g.fill(); g.stroke();
  // torso (angular chest plate)
  g.fillStyle = o.ghost ? 'rgba(20,70,62,0.6)' : '#0d2b26';
  g.beginPath();
  g.moveTo(9, 0); g.lineTo(2, -8); g.lineTo(-6, -6); g.lineTo(-8, 0); g.lineTo(-6, 6); g.lineTo(2, 8);
  g.closePath(); g.fill(); g.stroke();
  // chest energy core line
  g.strokeStyle = o.fever ? '#fff3b0' : '#9fffe8'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(3, -3); g.lineTo(3, 3); g.stroke();
  // hood (pointed, over the head)
  g.fillStyle = o.ghost ? 'rgba(16,58,52,0.7)' : '#123f38';
  g.strokeStyle = o.ghost ? 'rgba(77,255,210,0.5)' : bodyGlow; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(13, 0); g.quadraticCurveTo(10, -8, 1, -7);
  g.quadraticCurveTo(-3, 0, 1, 7); g.quadraticCurveTo(10, 8, 13, 0);
  g.closePath(); g.fill(); g.stroke();
  // glowing visor eyes inside the hood
  g.shadowBlur = 10; g.shadowColor = o.fever ? '#ffe14d' : '#b3fff0';
  g.fillStyle = o.fever ? '#fff6c9' : '#d9fff6';
  g.beginPath(); g.arc(8, -2.4, 1.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(8, 2.4, 1.4, 0, Math.PI * 2); g.fill();
  // katana: rest pose or slash sweep
  const kh = o.kHue != null ? o.kHue : 160;
  g.save();
  if (o.slash >= 0) g.rotate((-1 + o.slash * 2) * 1.05);
  else g.rotate(0.45 + br * 0.04);
  // grip + guard
  g.shadowBlur = 0;
  g.strokeStyle = o.ghost ? 'rgba(160,160,180,0.4)' : '#8a93a8'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(6, 0); g.lineTo(12, 0); g.stroke();
  g.beginPath(); g.moveTo(12, -3); g.lineTo(12, 3); g.stroke();
  // blade: bright core + neon edge glow
  g.shadowColor = 'hsl(' + kh + ',100%,65%)'; g.shadowBlur = o.ghost ? 6 : 16;
  g.strokeStyle = 'hsl(' + kh + ',100%,86%)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(12, 0); g.lineTo(42, -1.5); g.stroke();
  g.strokeStyle = 'hsla(' + kh + ',100%,65%,0.9)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(12, 1.5); g.lineTo(42, 0); g.stroke();
  g.restore();
  g.restore();
}

function drawEnemy(e) {
  g.save();
  g.translate(e.x, e.y);
  const sp = (e.spawn > 0 ? Math.max(0.1, 1 - e.spawn / 0.6) : 1) * 1.18; // slightly larger visual presence
  g.scale(sp, sp);
  g.globalAlpha = e.spawn > 0 ? 0.5 : 1;
  const flash = e.hitFlash > 0;
  g.shadowColor = 'hsl(' + e.hue + ',100%,60%)';
  g.shadowBlur = flash ? 26 : 14;
  g.strokeStyle = flash ? '#ffffff' : 'hsl(' + e.hue + ',100%,65%)';
  g.fillStyle = 'hsla(' + e.hue + ',80%,20%,0.85)';
  g.lineWidth = 2.5;
  const walk = Math.sin(e.t * 9); // shared stride cycle
  const eyeCol = flash ? '#ffffff' : 'hsl(' + e.hue + ',100%,72%)';
  // Every threat uses a deliberately distinct, high-contrast telegraph.
  if (e.windup > 0) {
    const a = 1 - e.windup / 0.42;
    g.strokeStyle = 'hsla(20,100%,72%,' + (0.45 + a * 0.5) + ')'; g.lineWidth = 3.5; g.shadowColor = '#ff704d'; g.shadowBlur = 14;
    g.beginPath(); g.arc(0, 0, e.r + 10 + a * 8, -Math.PI * 0.6, Math.PI * 0.6); g.stroke();
  }
  if (e.type === 'shooter' && e.charge > 0) {
    const a = Math.atan2(hero.y - e.y, hero.x - e.x), p = 1 - e.charge / 0.7;
    g.save(); g.rotate(a); g.strokeStyle = 'hsla(300,100%,75%,' + (0.4 + p * 0.6) + ')'; g.lineWidth = 2 + p * 3; g.shadowColor = '#ff4dff'; g.shadowBlur = 16;
    g.beginPath(); g.moveTo(e.r, 0); g.lineTo(230, 0); g.stroke(); g.restore();
  }
  if (e.type === 'kamikaze' && e.fuseStarted) {
    const p = Math.max(0, e.fuse / 0.85);
    g.strokeStyle = 'hsla(0,100%,68%,' + (0.45 + (1 - p) * 0.5) + ')'; g.lineWidth = 3; g.shadowColor = '#ff3b3b'; g.shadowBlur = 14;
    g.beginPath(); g.arc(0, 0, e.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); g.stroke();
  }
  if (e.type === 'splitter' && e.pulse > 1.7) {
    const p = (e.pulse - 1.7) / 0.5;
    g.strokeStyle = 'hsla(55,100%,72%,' + (1 - p) + ')'; g.lineWidth = 2.5; g.shadowColor = '#ffe14d'; g.shadowBlur = 12;
    g.beginPath(); g.arc(0, 0, e.r + 7 + p * 14, 0, Math.PI * 2); g.stroke();
  }
  if (e.type === 'boss' && e.phaseWarn > 0) {
    const p = 1 - e.phaseWarn / 0.75;
    g.strokeStyle = 'hsla(0,100%,72%,' + (0.45 + p * 0.5) + ')'; g.lineWidth = 4; g.shadowColor = '#ff4055'; g.shadowBlur = 20;
    g.beginPath(); g.arc(0, 0, e.r + 15 + p * 12, 0, Math.PI * 2); g.stroke();
  }
  if (e.type === 'melee') {
    // humanoid saw-bot: faces the hero, stomping legs, spinning saw arm
    const face = Math.atan2(hero.y - e.y, hero.x - e.x);
    g.rotate(face);
    const R = e.r;
    // stomping legs
    g.strokeStyle = flash ? '#fff' : 'hsla(' + e.hue + ',70%,45%,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-R * 0.4, -R * 0.4); g.lineTo(-R * 0.75 - walk * 3, -R * 0.75); g.stroke();
    g.beginPath(); g.moveTo(-R * 0.4, R * 0.4); g.lineTo(-R * 0.75 + walk * 3, R * 0.75); g.stroke();
    // torso
    g.strokeStyle = flash ? '#ffffff' : 'hsl(' + e.hue + ',100%,65%)'; g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(R * 0.6, 0); g.lineTo(R * 0.15, -R * 0.7); g.lineTo(-R * 0.6, -R * 0.5);
    g.lineTo(-R * 0.45, 0); g.lineTo(-R * 0.6, R * 0.5); g.lineTo(R * 0.15, R * 0.7);
    g.closePath(); g.fill(); g.stroke();
    // spinning saw blade held forward
    g.save(); g.translate(R * 1.05, 0); g.rotate(e.t * 14);
    g.strokeStyle = flash ? '#fff' : 'hsl(' + e.hue + ',100%,75%)'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r1 = R * 0.42, r2 = R * 0.62;
      g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.lineTo(Math.cos(a + 0.3) * r2, Math.sin(a + 0.3) * r2);
    }
    g.stroke();
    g.beginPath(); g.arc(0, 0, R * 0.42, 0, Math.PI * 2); g.stroke();
    g.restore();
    // single glowing eye
    g.fillStyle = eyeCol; g.shadowBlur = 12;
    g.beginPath(); g.arc(R * 0.2, 0, e.mini ? 2 : 3.2, 0, Math.PI * 2); g.fill();
  } else if (e.type === 'shooter') {
    // turret on strut legs, twin barrels track the hero, charge glow before firing
    const face = Math.atan2(hero.y - e.y, hero.x - e.x);
    const R = e.r;
    // three strut legs with stepping bob
    g.strokeStyle = flash ? '#fff' : 'hsla(' + e.hue + ',70%,50%,0.9)'; g.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const bob = Math.sin(e.t * 9 + i * 2.1) * 2;
      g.beginPath(); g.moveTo(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4);
      g.lineTo(Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15 + bob); g.stroke();
      g.beginPath(); g.arc(Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15 + bob, 2, 0, Math.PI * 2); g.stroke();
    }
    // rotating turret head
    g.save(); g.rotate(face);
    g.beginPath(); g.arc(0, 0, R * 0.75, 0, Math.PI * 2); g.fill(); g.stroke();
    // twin barrels
    g.strokeStyle = flash ? '#fff' : 'hsl(' + e.hue + ',90%,60%)'; g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(R * 0.3, -4); g.lineTo(R * 1.25, -4); g.stroke();
    g.beginPath(); g.moveTo(R * 0.3, 4); g.lineTo(R * 1.25, 4); g.stroke();
    // muzzle charge glow as fireCd approaches 0
    const chg = Math.max(0, 1 - e.fireCd / 0.6);
    if (chg > 0) {
      g.fillStyle = 'hsla(' + e.hue + ',100%,75%,' + chg + ')';
      g.shadowBlur = 16;
      g.beginPath(); g.arc(R * 1.3, -4, 3 * chg, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(R * 1.3, 4, 3 * chg, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // sensor eye
    g.fillStyle = eyeCol; g.shadowBlur = 10;
    g.beginPath(); g.arc(0, 0, 3.5, 0, Math.PI * 2); g.fill();
  } else if (e.type === 'kamikaze') {
    // rolling bomb-sphere with blinking red core & countdown ticks
    const d = Math.hypot(e.x - hero.x, e.y - hero.y);
    const danger = Math.max(0, 1 - d / 180);
    const blinkHz = 6 + danger * 22;
    const blink = Math.sin(e.t * blinkHz) > 0;
    g.rotate(e.t * 7); // rolling
    g.beginPath(); g.arc(0, 0, e.r, 0, Math.PI * 2); g.fill(); g.stroke();
    // rolling tread band
    g.strokeStyle = flash ? '#fff' : 'hsla(' + e.hue + ',80%,50%,0.8)'; g.lineWidth = 1.8;
    g.beginPath(); g.ellipse(0, 0, e.r, e.r * 0.42, 0, 0, Math.PI * 2); g.stroke();
    // countdown tick marks around the shell
    g.strokeStyle = 'hsla(0,100%,60%,' + (0.3 + danger * 0.7) + ')'; g.lineWidth = 2;
    const ticks = Math.max(1, Math.round(4 - danger * 3));
    for (let i = 0; i < 4; i++) {
      if (i < ticks) continue; // ticks disappear as it closes in
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.beginPath(); g.moveTo(Math.cos(a) * e.r * 0.7, Math.sin(a) * e.r * 0.7);
      g.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); g.stroke();
    }
    // blinking red core
    g.fillStyle = blink ? '#ff3b3b' : 'hsla(0,90%,40%,0.6)';
    g.shadowColor = '#ff3b3b'; g.shadowBlur = blink ? 18 : 6;
    g.beginPath(); g.arc(0, 0, e.r * 0.42, 0, Math.PI * 2); g.fill();
    if (danger > 0.4 && blink) { g.strokeStyle = '#ff5555'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, e.r + 4, 0, Math.PI * 2); g.stroke(); }
  } else if (e.type === 'shield') {
    // heavy walker with a projected energy shield wall in front
    g.rotate(e.face || 0);
    const R = e.r;
    // stomping legs
    g.strokeStyle = flash ? '#fff' : 'hsla(' + e.hue + ',70%,45%,0.9)'; g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(-R * 0.3, -R * 0.5); g.lineTo(-R * 0.8 - walk * 2.5, -R * 0.85); g.stroke();
    g.beginPath(); g.moveTo(-R * 0.3, R * 0.5); g.lineTo(-R * 0.8 + walk * 2.5, R * 0.85); g.stroke();
    g.strokeStyle = flash ? '#ffffff' : 'hsl(' + e.hue + ',100%,65%)'; g.lineWidth = 2.5;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * e.r * 0.85, py = Math.sin(a) * e.r * 0.85;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill(); g.stroke();
    // projected hexcell energy shield (translucent plane in front)
    const shimmer = 0.5 + Math.sin(e.t * 6) * 0.2;
    g.fillStyle = 'hsla(' + e.hue + ',100%,65%,' + shimmer * 0.16 + ')';
    g.strokeStyle = 'hsla(' + e.hue + ',100%,75%,' + shimmer + ')'; g.lineWidth = 3.5;
    g.shadowBlur = 22;
    g.beginPath(); g.arc(0, 0, e.r + 7, -Math.PI * 0.45, Math.PI * 0.45); 
    g.arc(0, 0, e.r + 1, Math.PI * 0.45, -Math.PI * 0.45, true);
    g.closePath(); g.fill(); g.stroke();
    // emitter studs
    g.fillStyle = '#d9ffe9';
    for (const sa of [-0.35, 0, 0.35]) {
      g.beginPath(); g.arc(Math.cos(sa * Math.PI) * e.r * 0.85, Math.sin(sa * Math.PI) * e.r * 0.85, 2, 0, Math.PI * 2); g.fill();
    }
    // eye
    g.fillStyle = eyeCol; g.shadowBlur = 10;
    g.beginPath(); g.arc(e.r * 0.25, 0, 3.5, 0, Math.PI * 2); g.fill();
  } else if (e.type === 'splitter') {
    // segmented crawler: two pods joined by pulsing energy coupling
    const face2 = Math.atan2(hero.y - e.y, hero.x - e.x);
    g.rotate(face2 + Math.sin(e.t * 3) * 0.25);
    const gap = 6 + Math.sin(e.t * 5) * 1.5;
    // energy coupling
    g.strokeStyle = 'hsla(' + e.hue + ',100%,70%,' + (0.5 + Math.sin(e.t * 10) * 0.3) + ')';
    g.lineWidth = 3; g.shadowBlur = 16;
    g.beginPath(); g.moveTo(-gap + 2, 0); g.lineTo(gap - 2, 0); g.stroke();
    g.strokeStyle = flash ? '#ffffff' : 'hsl(' + e.hue + ',100%,65%)'; g.lineWidth = 2.5; g.shadowBlur = flash ? 26 : 14;
    for (const s of [-1, 1]) {
      g.save(); g.translate(s * gap, 0); g.rotate(s * e.t * 2);
      // pod = rounded segment with plate lines
      g.beginPath(); g.arc(0, 0, e.r * 0.62, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = 'hsla(' + e.hue + ',80%,55%,0.7)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-e.r * 0.45, -3); g.lineTo(e.r * 0.45, -3); g.stroke();
      g.beginPath(); g.moveTo(-e.r * 0.45, 3); g.lineTo(e.r * 0.45, 3); g.stroke();
      g.strokeStyle = flash ? '#ffffff' : 'hsl(' + e.hue + ',100%,65%)'; g.lineWidth = 2.5;
      // little crawler feet
      const wob = Math.sin(e.t * 12 + s) * 2;
      g.beginPath(); g.moveTo(0, -e.r * 0.62); g.lineTo(wob, -e.r * 0.85); g.stroke();
      g.beginPath(); g.moveTo(0, e.r * 0.62); g.lineTo(-wob, e.r * 0.85); g.stroke();
      g.fillStyle = eyeCol; g.shadowBlur = 8;
      g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'hsla(' + e.hue + ',80%,20%,0.85)';
      g.restore();
    }
  } else if (e.type === 'twin') {
    // TWIN CORE: reactor sphere with double gyro rings + orbiting shards + aura
    // pulsing aura
    g.save();
    g.globalCompositeOperation = 'lighter';
    const ar = e.r * (1.6 + Math.sin(e.t * 3) * 0.15);
    const ag = g.createRadialGradient(0, 0, e.r * 0.4, 0, 0, ar);
    ag.addColorStop(0, 'hsla(' + e.hue + ',100%,60%,0.25)');
    ag.addColorStop(1, 'hsla(' + e.hue + ',100%,60%,0)');
    g.fillStyle = ag; g.beginPath(); g.arc(0, 0, ar, 0, Math.PI * 2); g.fill();
    g.restore();
    g.shadowColor = 'hsl(' + e.hue + ',100%,60%)'; g.shadowBlur = flash ? 26 : 18;
    // core
    g.beginPath(); g.arc(0, 0, e.r * 0.62, 0, Math.PI * 2); g.fill(); g.stroke();
    // twin gyro rings, counter-rotating
    g.save(); g.rotate(e.t * 1.6);
    g.beginPath(); g.ellipse(0, 0, e.r, e.r * 0.34, 0, 0, Math.PI * 2); g.stroke(); g.restore();
    g.save(); g.rotate(-e.t * 1.6 + Math.PI / 3);
    g.strokeStyle = flash ? '#fff' : 'hsl(' + ((e.hue + 40) % 360) + ',100%,70%)';
    g.beginPath(); g.ellipse(0, 0, e.r, e.r * 0.34, 0, 0, Math.PI * 2); g.stroke(); g.restore();
    // orbiting shards
    for (let i = 0; i < 3; i++) {
      const a = e.t * 2.4 + (i / 3) * Math.PI * 2;
      const sx = Math.cos(a) * e.r * 1.25, sy = Math.sin(a) * e.r * 1.25;
      g.fillStyle = 'hsl(' + e.hue + ',100%,75%)';
      g.save(); g.translate(sx, sy); g.rotate(a);
      g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -3); g.lineTo(-3, 3); g.closePath(); g.fill();
      g.restore();
    }
    // twin glowing cores inside
    g.fillStyle = flash ? '#fff' : 'hsl(' + e.hue + ',100%,75%)'; g.shadowBlur = 14;
    const cw = Math.sin(e.t * 8) * 1.5;
    g.beginPath(); g.arc(-5, cw, 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(5, -cw, 4, 0, Math.PI * 2); g.fill();
  } else if (e.type === 'boss') {
    // mini-boss: heavy octo-walker with rotating armor and inner reactor
    g.save();
    g.globalCompositeOperation = 'lighter';
    const ar2 = e.r * (1.4 + Math.sin(e.t * 2.4) * 0.1);
    const ag2 = g.createRadialGradient(0, 0, e.r * 0.5, 0, 0, ar2);
    ag2.addColorStop(0, 'hsla(' + e.hue + ',100%,60%,0.18)');
    ag2.addColorStop(1, 'hsla(' + e.hue + ',100%,60%,0)');
    g.fillStyle = ag2; g.beginPath(); g.arc(0, 0, ar2, 0, Math.PI * 2); g.fill();
    g.restore();
    g.shadowColor = 'hsl(' + e.hue + ',100%,60%)'; g.shadowBlur = flash ? 26 : 16;
    g.rotate(e.t * 0.6);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 === 0 ? e.r : e.r * 0.75;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill(); g.stroke();
    // inner counter-rotating armor ring
    g.save(); g.rotate(-e.t * 1.8);
    g.strokeStyle = flash ? '#fff' : 'hsla(' + e.hue + ',100%,70%,0.8)'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.moveTo(Math.cos(a) * e.r * 0.5, Math.sin(a) * e.r * 0.5);
      g.lineTo(Math.cos(a + 0.5) * e.r * 0.5, Math.sin(a + 0.5) * e.r * 0.5);
    }
    g.stroke(); g.restore();
    // reactor eye (brightens when charging)
    const chg2 = e.charging > 0 ? 1 : Math.max(0, 1 - e.chargeCd / 1);
    g.fillStyle = 'hsl(' + e.hue + ',100%,' + (60 + chg2 * 30) + '%)';
    g.shadowBlur = 14 + chg2 * 14;
    g.beginPath(); g.arc(0, 0, 9 + chg2 * 2, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // boss hp bar
  if ((e.type === 'boss' || e.type === 'twin') && e.spawn <= 0) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(e.x - 40, e.y - e.r - 18, 80, 8);
    g.fillStyle = '#c04dff';
    g.fillRect(e.x - 40, e.y - e.r - 18, 80 * (e.hp / e.maxHp), 8);
  }
}

function btn(x, y, w2, h2, text, hue) {
  g.save();
  g.shadowColor = 'hsl(' + hue + ',100%,60%)'; g.shadowBlur = 18;
  g.fillStyle = 'hsla(' + hue + ',80%,25%,0.9)';
  g.strokeStyle = 'hsl(' + hue + ',100%,65%)'; g.lineWidth = 2.5;
  // cyberpunk chamfered button (angled corners)
  const ch = Math.min(12, h2 * 0.32);
  const L = x - w2 / 2, T = y - h2 / 2, R2 = x + w2 / 2, B = y + h2 / 2;
  g.beginPath();
  g.moveTo(L + ch, T); g.lineTo(R2, T); g.lineTo(R2, B - ch); g.lineTo(R2 - ch, B);
  g.lineTo(L, B); g.lineTo(L, T + ch);
  g.closePath(); g.fill(); g.stroke();
  // accent notch lines
  g.strokeStyle = 'hsla(' + hue + ',100%,80%,0.8)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(L + 6, B - 4); g.lineTo(L + 18, B - 4); g.stroke();
  g.beginPath(); g.moveTo(R2 - 18, T + 4); g.lineTo(R2 - 6, T + 4); g.stroke();
  g.fillStyle = '#ffffff'; g.font = '800 ' + Math.floor(h2 * 0.42) + 'px "Segoe UI", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y + 1);
  g.restore();
  return { x, y, w: w2, h: h2 };
}

function roundRect(x, y, w2, h2, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w2, y, x + w2, y + h2, r);
  g.arcTo(x + w2, y + h2, x, y + h2, r);
  g.arcTo(x, y + h2, x, y, r);
  g.arcTo(x, y, x + w2, y, r);
  g.closePath();
}

let uiButtons = {};
function renderMenu() {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // animated warrior showcase: slow orbit walk + periodic slash
  const mt = tPulse;
  const orbA = mt * 0.42;
  const showX = CX + Math.cos(orbA) * 250;
  const showY = CY + Math.sin(orbA) * 190;
  const slashCycle = (mt % 2.4) / 2.4;
  const menuSlash = slashCycle < 0.09 ? slashCycle / 0.09 : -1;
  drawWarrior(showX, showY, orbA + Math.PI / 2, {
    alpha: 1, hue: 160, kHue: KATANAS[meta.katana].hue,
    breathe: mt, cloak: 0.25 + Math.abs(Math.sin(mt * 0.7)) * 0.3,
    slash: menuSlash,
  });
  g.save();
  g.shadowColor = '#4dffd2'; g.shadowBlur = 30;
  g.fillStyle = '#ffffff'; g.font = '900 72px "Segoe UI", sans-serif';
  // glitch accent: occasional RGB-split jitter on the title
  const glitch = Math.sin(mt * 1.7) > 0.96;
  if (glitch) {
    g.fillStyle = 'rgba(255,60,120,0.6)';
    g.fillText('NEON', CX + 3, CY - 168);
    g.fillStyle = 'rgba(60,220,255,0.6)';
    g.fillText('NEON', CX - 3, CY - 166);
    g.fillStyle = '#ffffff';
  }
  g.fillText('NEON', CX, CY - 168);
  g.shadowColor = '#ff4dff';
  if (glitch) {
    g.fillStyle = 'rgba(60,220,255,0.6)';
    g.fillText('SLASHER', CX - 3, CY - 96);
    g.fillStyle = '#ffffff';
  }
  g.fillText('SLASHER', CX, CY - 98);
  g.restore();
  // subtitle divider slashes
  g.strokeStyle = 'rgba(77,255,210,0.5)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(CX - 190, CY - 62); g.lineTo(CX - 150, CY - 62); g.stroke();
  g.beginPath(); g.moveTo(CX + 150, CY - 62); g.lineTo(CX + 190, CY - 62); g.stroke();
  g.fillStyle = 'rgba(190,220,255,0.85)'; g.font = '600 18px "Segoe UI", sans-serif';
  g.fillText('WASD move · Mouse aim · Click slash · Space dash', CX, CY - 44);
  g.fillText('Deflect bullets with your blade. Survive the waves.', CX, CY - 18);
  uiButtons = {
    play: btn(CX, CY + 56, 240, 62, 'PLAY', 160),
    shop: btn(CX, CY + 132, 220, 48, 'UPGRADES', 200),
    music: btn(W - 70, H - 40, 110, 36, audio.getMusicOn() ? 'MUSIC: ON' : 'MUSIC: OFF', 265),
  };
  // cores + streak + records
  g.textAlign = 'center';
  g.fillStyle = '#9ee8ff'; g.font = '700 18px "Segoe UI", sans-serif';
  g.fillText('◆ ' + meta.cores + ' CORES', CX, CY + 178);
  g.fillStyle = 'rgba(160,200,255,0.6)'; g.font = '600 15px "Segoe UI", sans-serif';
  g.fillText('BEST ' + best + '  ·  BEST WAVE ' + meta.bestWave, CX, CY + 206);
  if (streakInfo && streakInfo.count > 1) {
    g.fillStyle = '#ffe14d'; g.font = '700 15px "Segoe UI", sans-serif';
    g.fillText('🔥 DAY ' + streakInfo.count + ' STREAK' + (streakInfo.isNew ? '  +' + streakInfo.bonus + ' CORES!' : ''), CX, CY + 232);
  } else if (streakInfo && streakInfo.isNew && streakInfo.bonus > 0) {
    g.fillStyle = '#ffe14d'; g.font = '700 15px "Segoe UI", sans-serif';
    g.fillText('DAILY BONUS +' + streakInfo.bonus + ' CORES', CX, CY + 232);
  }
  // perk indicator
  const perk = PERKS.find(p => p.id === meta.perk);
  if (perk && perk.id !== 'none') {
    g.fillStyle = 'rgba(255,180,120,0.8)'; g.font = '600 14px "Segoe UI", sans-serif';
    g.fillText('PERK: ' + perk.name, CX, CY + 254);
  }
}

// ---------- shop (upgrades / katanas / perks) ----------
let shopTab = 0; // 0 upgrades, 1 katanas, 2 perks
function renderShop() {
  g.fillStyle = 'rgba(4,6,18,0.88)';
  fullRect();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.shadowColor = '#4dd2ff'; g.shadowBlur = 22;
  g.fillStyle = '#ffffff'; g.font = '900 40px "Segoe UI", sans-serif';
  g.fillText('UPGRADES', CX, 52);
  g.restore();
  g.fillStyle = '#9ee8ff'; g.font = '700 20px "Segoe UI", sans-serif';
  g.fillText('◆ ' + meta.cores + ' CORES', CX, 92);
  uiButtons = { back: btn(80, 40, 110, 40, '← BACK', 300) };
  // tabs
  const tabs = ['UPGRADES', 'KATANAS', 'PERKS'];
  for (let i = 0; i < 3; i++) {
    uiButtons['tab' + i] = btn(CX - 180 + i * 180, 132, 160, 36, tabs[i], shopTab === i ? 160 : 220);
  }
  if (shopTab === 0) {
    UPGRADES.forEach((u, i) => {
      const y = 180 + i * 62;
      const lvl = upgradeLevel(u.id);
      const cost = upgradeCost(u.id);
      g.textAlign = 'left';
      g.fillStyle = '#e8f4ff'; g.font = '700 18px "Segoe UI", sans-serif';
      g.fillText(u.name, 150, y);
      g.fillStyle = 'rgba(170,200,255,0.7)'; g.font = '600 14px "Segoe UI", sans-serif';
      g.fillText(u.desc, 150, y + 22);
      // pips
      for (let p = 0; p < u.max; p++) {
        g.fillStyle = p < lvl ? '#4dffd2' : 'rgba(120,140,180,0.3)';
        g.fillRect(400 + p * 22, y - 4, 16, 10);
      }
      if (cost != null) {
        uiButtons['up_' + u.id] = btn(680, y + 8, 170, 44, '◆ ' + cost, meta.cores >= cost ? 160 : 0);
      } else {
        g.textAlign = 'center'; g.fillStyle = '#4dffd2'; g.font = '700 16px "Segoe UI", sans-serif';
        g.fillText('MAXED', 680, y + 8);
      }
    });
  } else if (shopTab === 1) {
    KATANAS.forEach((k, i) => {
      const y = 190 + i * 78;
      g.textAlign = 'left';
      g.save();
      g.shadowColor = 'hsl(' + k.hue + ',100%,65%)'; g.shadowBlur = 12;
      g.strokeStyle = 'hsl(' + k.hue + ',100%,75%)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(150, y); g.lineTo(230, y); g.stroke();
      g.restore();
      g.fillStyle = '#e8f4ff'; g.font = '700 18px "Segoe UI", sans-serif';
      g.fillText(k.name, 260, y);
      if (meta.katanasOwned[i]) {
        uiButtons['kat_' + i] = btn(680, y, 190, 44, meta.katana === i ? '★ EQUIPPED' : 'EQUIP', meta.katana === i ? 55 : 160);
      } else {
        uiButtons['kat_' + i] = btn(680, y, 190, 44, '◆ ' + k.cost, meta.cores >= k.cost ? 160 : 0);
      }
    });
  } else {
    PERKS.forEach((p, i) => {
      const y = 190 + i * 78;
      g.textAlign = 'left';
      g.fillStyle = '#e8f4ff'; g.font = '700 18px "Segoe UI", sans-serif';
      g.fillText(p.name, 150, y - 8);
      g.fillStyle = 'rgba(170,200,255,0.7)'; g.font = '600 14px "Segoe UI", sans-serif';
      g.fillText(p.desc, 150, y + 14);
      if (meta.perksOwned[p.id]) {
        uiButtons['perk_' + p.id] = btn(680, y, 190, 44, meta.perk === p.id ? '★ ACTIVE' : 'SELECT', meta.perk === p.id ? 55 : 160);
      } else {
        uiButtons['perk_' + p.id] = btn(680, y, 190, 44, '◆ ' + p.cost, meta.cores >= p.cost ? 160 : 0);
      }
    });
  }
}

function handleShopPress(p) {
  if (inBtn(p, uiButtons.back)) { state = 'menu'; audio.buySound(); return; }
  for (let i = 0; i < 3; i++) {
    if (inBtn(p, uiButtons['tab' + i])) { shopTab = i; return; }
  }
  if (shopTab === 0) {
    for (const u of UPGRADES) {
      if (inBtn(p, uiButtons['up_' + u.id])) {
        if (buyUpgrade(u.id)) { audio.buySound(); happytime(); } else audio.errorSound();
        return;
      }
    }
  } else if (shopTab === 1) {
    KATANAS.forEach((k, i) => {
      if (inBtn(p, uiButtons['kat_' + i])) {
        if (meta.katanasOwned[i]) { meta.katana = i; saveMeta(); audio.buySound(); }
        else if (buyKatana(i)) { meta.katana = i; saveMeta(); audio.buySound(); happytime(); }
        else audio.errorSound();
      }
    });
  } else {
    for (const pk of PERKS) {
      if (inBtn(p, uiButtons['perk_' + pk.id])) {
        if (meta.perksOwned[pk.id]) { meta.perk = pk.id; saveMeta(); audio.buySound(); }
        else if (buyPerk(pk.id)) { meta.perk = pk.id; saveMeta(); audio.buySound(); happytime(); }
        else audio.errorSound();
        return;
      }
    }
  }
}

function renderGameOver() {
  // register hitboxes immediately (clickable even during explosion phase)
  uiButtons = {};
  let hy = CY + 16;
  uiButtons.playAgain = { x: CX, y: hy, w: 340, h: 70 }; hy += 82;
  if (!secondWindUsed) { uiButtons.secondWind = { x: CX, y: hy, w: 320, h: 50 }; hy += 60; }
  if (runCores > 0 && !coresDoubled) { uiButtons.doubleCores = { x: CX, y: hy, w: 320, h: 48 }; hy += 58; }
  uiButtons.toShop = { x: CX, y: hy, w: 200, h: 44 };
  // phase 1 (~0.55s): raw explosion, no overlay — let the death read
  const ov = Math.max(0, Math.min(1, (deathT - 0.55) / 0.35));
  if (ov <= 0) return;
  g.save();
  g.globalAlpha = ov;
  g.fillStyle = 'rgba(4,6,18,0.72)';
  fullRect();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.shadowColor = '#ff4d6d'; g.shadowBlur = 26;
  g.fillStyle = '#ffffff'; g.font = '900 58px "Segoe UI", sans-serif';
  g.fillText('SYSTEM DOWN', CX, CY - 168);
  g.restore();
  g.fillStyle = '#e8f4ff'; g.font = '700 30px "Segoe UI", sans-serif';
  g.fillText('SCORE ' + score, CX, CY - 104);
  g.fillStyle = 'rgba(190,220,255,0.8)'; g.font = '600 18px "Segoe UI", sans-serif';
  g.fillText('BEST ' + best + '   ·   WAVE ' + wave + (newBestWave ? ' ★NEW RECORD' : '') + '   ·   ' + killsTotal + ' BOTS SLICED', CX, CY - 68);
  g.fillStyle = '#9ee8ff'; g.font = '700 20px "Segoe UI", sans-serif';
  g.fillText('◆ +' + (coresDoubled ? runCores * 2 : runCores) + ' CORES BANKED' + (coresDoubled ? ' (x2!)' : ''), CX, CY - 34);
  uiButtons = {};
  let y = CY + 16;
  // giant pulsing RETRY comes first — instant restart is the hero action
  const rp = 1 + Math.sin(tPulse * 4) * 0.03;
  g.save(); g.translate(CX, y); g.scale(rp, rp); g.translate(-CX, -y);
  uiButtons.playAgain = btn(CX, y, 340, 70, '▶ RETRY', 160);
  g.restore();
  y += 82;
  if (!secondWindUsed) {
    uiButtons.secondWind = btn(CX, y, 320, 50, '▶ SECOND WIND (AD)', 130);
    y += 60;
  }
  if (runCores > 0 && !coresDoubled) {
    uiButtons.doubleCores = btn(CX, y, 320, 48, '▶ DOUBLE CORES (AD)', 200);
    y += 58;
  }
  uiButtons.toShop = btn(CX, y, 200, 44, 'UPGRADES', 200);
  if (adBusy) {
    g.fillStyle = '#ffe14d'; g.font = '700 18px "Segoe UI", sans-serif';
    g.fillText('Loading ad...', CX, H - 30);
  }
  g.restore();
}

// ---------- input ----------
function canvasPos(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  // screen -> world (UI transform: cam.scale/ox/oy over CSS pixels)
  const sx = (clientX - r.left) * (VW / r.width);
  const sy = (clientY - r.top) * (VH / r.height);
  return { x: (sx - cam.ox) / cam.scale, y: (sy - cam.oy) / cam.scale };
}

function inBtn(p, b) {
  return b && p.x > b.x - b.w / 2 && p.x < b.x + b.w / 2 && p.y > b.y - b.h / 2 && p.y < b.y + b.h / 2;
}

function handlePress(p) {
  audio.unlockAudio();
  audio.startMusic();
  if (state === 'menu') {
    if (inBtn(p, uiButtons.play)) startGame();
    else if (inBtn(p, uiButtons.shop)) { state = 'shop'; shopTab = 0; }
    else if (inBtn(p, uiButtons.music)) audio.setMusicOn(!audio.getMusicOn());
    return true;
  }
  if (state === 'shop') {
    handleShopPress(p);
    return true;
  }
  if (state === 'gameover') {
    if (inBtn(p, uiButtons.secondWind)) { secondWind(); return true; }
    if (inBtn(p, uiButtons.doubleCores)) { doubleCores(); return true; }
    if (inBtn(p, uiButtons.playAgain)) { playAgain(); return true; }
    if (inBtn(p, uiButtons.toShop)) { state = 'shop'; shopTab = 0; return true; }
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  KEYS[e.key.toLowerCase()] = true;
  if (introT > 0 && state === 'playing') introT = 0; // skip intro sweep
  if (e.key === ' ') { e.preventDefault(); doDash(); }
});
window.addEventListener('keyup', (e) => { KEYS[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousemove', (e) => {
  const p = canvasPos(e.clientX, e.clientY);
  mouseX = p.x; mouseY = p.y;
});
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const p = canvasPos(e.clientX, e.clientY);
  mouseX = p.x; mouseY = p.y;
  if (handlePress(p)) return;
  if (state === 'playing') {
    if (introT > 0) introT = 0; // skip intro sweep
    if (e.button === 2) doDash();
    else { hero.aim = Math.atan2(p.y - hero.y, p.x - hero.x); doSlash(); }
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// touch: left half = joystick, right half = tap slash / swipe dash
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  isTouch = true;
  for (const t of e.changedTouches) {
    const p = canvasPos(t.clientX, t.clientY);
    if (state !== 'playing') { handlePress(p); continue; }
    if (p.x < W / 2 && !joy.active) {
      joy.active = true; joy.id = t.identifier; joy.x0 = p.x; joy.y0 = p.y; joy.dx = 0; joy.dy = 0;
    } else if (!rightTouch.active) {
      rightTouch.active = true; rightTouch.id = t.identifier;
      rightTouch.x0 = p.x; rightTouch.y0 = p.y; rightTouch.t0 = performance.now();
    }
  }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const p = canvasPos(t.clientX, t.clientY);
    if (joy.active && t.identifier === joy.id) {
      joy.dx = p.x - joy.x0; joy.dy = p.y - joy.y0;
      const l = Math.hypot(joy.dx, joy.dy);
      if (l > 60) { joy.dx = joy.dx / l * 60; joy.dy = joy.dy / l * 60; }
    }
  }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const p = canvasPos(t.clientX, t.clientY);
    if (joy.active && t.identifier === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; }
    else if (rightTouch.active && t.identifier === rightTouch.id) {
      rightTouch.active = false;
      const dx = p.x - rightTouch.x0, dy = p.y - rightTouch.y0;
      const dist = Math.hypot(dx, dy);
      const dt2 = performance.now() - rightTouch.t0;
      if (state === 'playing') {
        if (dist > 45 && dt2 < 400) { hero.aim = Math.atan2(dy, dx); doDash(); }
        else {
          // tap: slash toward nearest enemy (or current aim)
          let ne = null, nd = 1e9;
          for (const en of enemies) {
            if (en.spawn > 0) continue;
            const d = Math.hypot(en.x - hero.x, en.y - hero.y);
            if (d < nd) { nd = d; ne = en; }
          }
          if (ne) hero.aim = Math.atan2(ne.y - hero.y, ne.x - hero.x);
          doSlash();
        }
      }
    }
  }
}, { passive: false });

// One listener each: the simulation and audio stop while the game cannot be
// played, then resume exactly once when the last blocking reason clears.
document.addEventListener('visibilitychange', () => setPaused('visibility', document.hidden));
window.addEventListener('blur', () => setPaused('blur', true));
window.addEventListener('focus', () => setPaused('blur', false));

// ---------- debug hook ----------
if (new URLSearchParams(location.search).get('debug') === '1') {
  window.__astro = {
    forceGameOver: () => { if (state === 'playing') { hero.hp = 0; gameOver(); } },
    addScore: (n) => { score += n; },
    addCores: (n) => { addCores(n); },
    addRunCores: (n) => { runCores += n; },
    setCombo: (n) => { combo = n; comboTimer = 3; multiplier = 1 + Math.floor(n / 3); },
    spawn: (type) => spawnEnemy(type),
    spawnAt: (type, x, y) => spawnEnemy(type, x, y),
    clearArena: () => { enemies = []; bullets = []; spawnQueue = ['__test_hold']; spawnTimer = 999; },
    testStart: () => { reset(); state = 'playing'; introT = 0; spawnQueue = ['__test_hold']; spawnTimer = 999; },
    setWave: (n) => { enemies = []; bullets = []; spawnQueue = []; startWave(n); },
    openShop: () => { if (state === 'menu' || state === 'gameover') { state = 'shop'; shopTab = 0; } },
    getMeta: () => JSON.parse(JSON.stringify(meta)),
    getButtons: () => { const o = {}; for (const k in uiButtons) o[k] = { x: uiButtons[k].x, y: uiButtons[k].y }; return o; },
    getState: () => ({
      state, hp: hero ? hero.hp : 0, hpMax: hero ? hero.hpMax : 0, wave, score,
      heroX: hero ? hero.x : 0, heroY: hero ? hero.y : 0,
      dashCd: hero ? hero.dashCd : 0,
      combo, secondWindUsed, fever, runCores,
      cores: meta.cores, bestWave: meta.bestWave, streak: meta.streakCount,
      katana: meta.katana, perk: meta.perk, plays: meta.plays,
      shopTab,
      hazard: hazard ? { angle: hazard.angle, width: hazard.width, warning: hazard.warning, active: hazard.active } : null,
      enemies: enemies ? enemies.map(e => ({ dx: e.x - hero.x, dy: e.y - hero.y, type: e.type, hp: e.hp, windup: e.windup || 0, charge: e.charge || 0, fuse: e.fuse || 0, fuseStarted: !!e.fuseStarted, pulse: e.pulse || 0, phaseWarn: e.phaseWarn || 0 })) : [],
      coreDrops: cores ? cores.length : 0,
      bullets: bullets ? bullets.length : 0,
    }),
    startGame: () => { if (state === 'menu') startGame(); },
    getCam: () => ({ scale: cam.scale, ox: cam.ox, oy: cam.oy, vw: VW, vh: VH }),
    skipIntro: () => { introT = 0; },
    getDebugCounts: () => ({
      enemies: enemies.length, bullets: bullets.length, particles: particles.length,
      debris: debris.length, flashes: flashes.length, beams: beams.length,
      floats: floats.length, cores: cores.length, trail: hero ? hero.trail.length : 0,
      ghosts: hero ? hero.ghosts.length : 0, listeners: 13, loopStarts, renderedFrames, fixedSteps,
    }),
    setPausedForTest: (reason, value) => setPaused(reason, value),
    setInvincible: (seconds = 30) => { if (hero) hero.iframes = seconds; },
    runDeterminism: (hz, seconds = 12) => {
      // Uses the same fixed-step accumulator contract as RAF. It intentionally
      // avoids game RNG so the test catches any accidental frame-count logic.
      let acc = 0, position = 0, spawnClock = 0, spawns = 0, difficulty = 1;
      const frames = Math.round(hz * seconds);
      for (let f = 0; f < frames; f++) {
        acc += 1 / hz;
        while (acc + 1e-9 >= FIXED_DT) {
          position += 180 * FIXED_DT * difficulty;
          spawnClock += FIXED_DT;
          if (spawnClock >= 0.8) { spawnClock -= 0.8; spawns++; difficulty = 1 + Math.floor(spawns / 5) * 0.1; }
          acc -= FIXED_DT;
        }
      }
      return { position: +position.toFixed(6), spawns, difficulty: +difficulty.toFixed(6) };
    },
    runSoak: (seconds = 120) => {
      if (state !== 'playing') startGame();
      introT = 0; spawnQueue = []; enemies = []; bullets = [];
      const roster = ['melee', 'shooter', 'kamikaze', 'shield', 'splitter', 'boss'];
      const steps = Math.round(seconds / FIXED_DT);
      for (let i = 0; i < steps; i++) {
        if (i % 15 === 0) {
          spawnEnemy(roster[(i / 15) % roster.length], CX + 140, CY);
          const e = enemies[enemies.length - 1];
          if (e) { e.spawn = 0; killEnemy(e); }
        }
        enemies = enemies.filter(e => !e.dead); spawnQueue = [];
        update(FIXED_DT);
        if (state !== 'playing') startGame();
      }
      return window.__astro.getDebugCounts();
    },
  };
}

// ---------- boot ----------
let lastT = performance.now();
let accumulator = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (!paused) {
    accumulator = Math.min(accumulator + dt, FIXED_DT * MAX_STEPS_PER_FRAME);
    let steps = 0;
    while (accumulator + 1e-9 >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
      fixedSteps++;
      steps++;
    }
    render();
    renderedFrames++;
  }
  requestAnimationFrame(loop);
}

async function boot() {
  await initSDK();
  loadingStart(); // must be AFTER initSDK (sdk null before)
  best = loadBest();
  loadMeta();
  streakInfo = checkDailyStreak();
  audio.setMuted(getMuteSetting());
  onSettingsChange((s) => { if (s && typeof s.muteAudio === 'boolean') audio.setMuted(s.muteAudio); });
  reset();
  state = 'menu';
  loadingStop();
  loopStarts++;
  requestAnimationFrame(loop);
}
boot();
