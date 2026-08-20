// Neon Slasher — arena katana slasher vs robot waves (CrazyGames)
// Zero blood: enemies are neon droids that burst into glowing particles & springs.
import { initSDK, loadingStart, loadingStop, gameplayStart, gameplayStop, happytime, requestAd, getMuteSetting, onSettingsChange, loadBest, saveBest } from './sdk.js';
import * as audio from './audio.js';
import { meta, loadMeta, saveMeta, checkDailyStreak, addCores, UPGRADES, KATANAS, PERKS, upgradeLevel, upgradeCost, buyUpgrade, buyKatana, buyPerk, runStats } from './meta.js';

const W = 960, H = 640;
const CX = W / 2, CY = H / 2;
const ARENA_R = 280;

const canvas = document.getElementById('game');
canvas.width = W; canvas.height = H;
const g = canvas.getContext('2d');

function resize() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = (W * scale) + 'px';
  canvas.style.height = (H * scale) + 'px';
}
window.addEventListener('resize', resize); resize();

// ---------- state ----------
let state = 'loading'; // loading -> menu -> playing -> gameover (+shop)
let score = 0, best = 0, wave = 0;
let hero, enemies, bullets, particles, floats, pickups, cores;
let combo = 0, comboTimer = 0, multiplier = 1;
let shake = 0, hurtFlash = 0, slowmo = 0, timeScale = 1;
let hitStop = 0;           // brief freeze on hit (juice)
let debris = [];           // sliced robot halves
let flashes = [];          // radial light flashes (deflect etc.)
let waveBanner = 0, waveBannerText = '';
let secondWindUsed = false, secondWindShield = 0;
let killsTotal = 0;
let adBusy = false;
let paused = false;
let tPulse = 0;
let spawnQueue = [];
let spawnTimer = 0;
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
  hitStop = 0; debris = []; flashes = [];
  secondWindUsed = false; secondWindShield = 0; killsTotal = 0;
  spawnQueue = []; spawnTimer = 0;
  runCores = 0; fever = 0; feverUsedAtCombo = 0; vampireKills = 0;
  hintT = 0; coresDoubled = false; newBestWave = false;
}

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
    // gentler ramp for the first ~minute (waves 1-3), then normal growth
    const count = n <= 3 ? 2 + n : 3 + n * 2;
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      if (n >= 4 && r < 0.12) q.push('shield');
      else if (n >= 6 && r < 0.24) q.push('splitter');
      else if (n >= 2 && r < 0.45) q.push('shooter');
      else if (n >= 3 && r < 0.62) q.push('kamikaze');
      else q.push('melee');
    }
  }
  spawnQueue = q; spawnTimer = 0.3;
  // heart pickup every 3 waves if hurt
  if (n > 1 && n % 3 === 0 && hero.hp < hero.hpMax) {
    const a = Math.random() * Math.PI * 2;
    pickups.push({ x: CX + Math.cos(a) * ARENA_R * 0.5, y: CY + Math.sin(a) * ARENA_R * 0.5, t: 0 });
  }
}

function spawnEnemy(type, px, py) {
  const a = Math.random() * Math.PI * 2;
  const x = px != null ? px : CX + Math.cos(a) * (ARENA_R - 14);
  const y = py != null ? py : CY + Math.sin(a) * (ARENA_R - 14);
  const wv = wave;
  if (type === 'melee') {
    enemies.push({ type, x, y, hp: 1, r: 14, speed: 70 + wv * 4, t: 0, spawn: 0.6, hue: 185 });
  } else if (type === 'shooter') {
    enemies.push({ type, x, y, hp: 1, r: 13, speed: 55 + wv * 2, t: Math.random() * 2, spawn: 0.6, fireCd: 1.6, hue: 300 });
  } else if (type === 'kamikaze') {
    enemies.push({ type, x, y, hp: 1, r: 11, speed: 150 + wv * 5, t: 0, spawn: 0.6, hue: 20 });
  } else if (type === 'shield') {
    // shield droid: front is invulnerable — hit it from behind (faces the hero)
    enemies.push({ type, x, y, hp: 2, r: 16, speed: 55 + wv * 3, t: 0, spawn: 0.7, face: 0, hue: 130 });
  } else if (type === 'splitter') {
    // splits into two minis on death
    enemies.push({ type, x, y, hp: 2, r: 17, speed: 60 + wv * 3, t: 0, spawn: 0.7, hue: 50 });
  } else if (type === 'mini') {
    enemies.push({ type: 'melee', mini: true, x, y, hp: 1, r: 8, speed: 130 + wv * 4, t: 0, spawn: 0.25, hue: 50 });
  } else if (type === 'boss') {
    const bhp = 16 + Math.floor(wv / 5) * 8;
    enemies.push({ type, x, y, hp: bhp, maxHp: bhp, r: 34, speed: 45, t: 0, spawn: 1, fireCd: 2.5, chargeCd: 4, charging: 0, cvx: 0, cvy: 0, hue: 265 });
  } else if (type === 'twin') {
    // twin core boss (every 10 waves): orbits arena, spiral fire
    const bhp = 12 + Math.floor(wv / 10) * 8;
    enemies.push({ type, x, y, hp: bhp, maxHp: bhp, r: 26, speed: 60, t: Math.random() * 6, spawn: 1, fireCd: 2, orbitA: a, orbitDir: Math.random() < 0.5 ? 1 : -1, hue: 335 });
  }
}

// ---------- particles ----------
function burst(x, y, hue, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (0.3 + Math.random()) * spd;
    particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.5 + Math.random() * 0.5, t: 0, hue,
      spring: Math.random() < 0.3, r: 2 + Math.random() * 3,
    });
  }
}

function addFloat(x, y, text, hue) {
  floats.push({ x, y, text, hue, t: 0 });
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
  hero.slashArcs.push({ a: hero.aim, t: 0 });
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
      flashes.push({ x: b.x, y: b.y, r: 34, hue: 130, t: 0, life: 0.22 });
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
    debris.push({
      x: e.x, y: e.y, r: e.r, hue: e.hue, type: e.type, side,
      cutA,
      vx: Math.cos(cutA + side * Math.PI / 2) * (70 + Math.random() * 60),
      vy: Math.sin(cutA + side * Math.PI / 2) * (70 + Math.random() * 60) - 40,
      rot: (Math.random() - 0.5) * 2, vr: side * (3 + Math.random() * 4),
      t: 0, life: 0.7 + Math.random() * 0.3,
    });
  }
  flashes.push({ x: e.x, y: e.y, r: isBoss ? 90 : 46, hue: e.hue, t: 0, life: isBoss ? 0.4 : 0.25 });
  // drop persistent cores currency
  const nCores = isBoss ? 5 : e.type === 'shield' || e.type === 'splitter' ? 2 : e.mini ? 0 : Math.random() < 0.55 ? 1 : 0;
  for (let i = 0; i < nCores; i++) {
    const a = Math.random() * Math.PI * 2;
    cores.push({ x: e.x + Math.cos(a) * 8, y: e.y + Math.sin(a) * 8, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, t: 0 });
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
  combo = 0; multiplier = 1; comboTimer = 0;
  audio.hurtSound();
  burst(hero.x, hero.y, 0, 20, 180);
  if (hero.hp <= 0) gameOver();
}

function gameOver() {
  state = 'gameover';
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
  gameplayStart();
  audio.startMusic();
  startWave(1);
}

async function playAgain() {
  if (adBusy) return;
  // instant restart if an ad ran recently — never make the player wait twice a minute
  if (performance.now() - lastAdAt < 60000) { startGame(); return; }
  adBusy = true;
  await requestAd('midgame', {
    onStart: () => { audio.setMuted(true); },
    onFinish: () => { audio.setMuted(getMuteSetting()); },
  });
  lastAdAt = performance.now();
  adBusy = false;
  startGame();
}

async function doubleCores() {
  if (adBusy || coresDoubled || runCores <= 0) return;
  adBusy = true;
  const ok = await requestAd('rewarded', {
    onStart: () => { audio.setMuted(true); },
    onFinish: () => { audio.setMuted(getMuteSetting()); },
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
    onStart: () => { audio.setMuted(true); },
    onFinish: () => { audio.setMuted(getMuteSetting()); },
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
    hero.trail.push({ x: hero.x, y: hero.y, t: 0 });
    hero.ghosts.push({ x: hero.x, y: hero.y, aim: hero.aim, t: 0 });
    hero.cloak = Math.min(1, hero.cloak + dt * 12);
  } else {
    hero.x += mx * heroSpeed * sdt;
    hero.y += my * heroSpeed * sdt;
    if (Math.abs(mx) + Math.abs(my) > 0.1 && Math.random() < 0.3) hero.trail.push({ x: hero.x, y: hero.y, t: 0.25 });
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

  // spawn queue
  if (spawnQueue.length > 0) {
    spawnTimer -= sdt;
    if (spawnTimer <= 0) { spawnEnemy(spawnQueue.shift()); spawnTimer = 0.35; }
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
      if (d < e.r + 14) damageHero();
    } else if (e.type === 'shield') {
      e.face = Math.atan2(dy, dx); // always faces the hero
      e.x += dx / d * e.speed * sdt; e.y += dy / d * e.speed * sdt;
      if (d < e.r + 14) damageHero();
    } else if (e.type === 'shooter') {
      const want = 230;
      const dir = d > want ? 1 : -0.6;
      e.x += dx / d * e.speed * dir * sdt; e.y += dy / d * e.speed * dir * sdt;
      e.fireCd -= sdt;
      if (e.fireCd <= 0) {
        e.fireCd = 2.2 - Math.min(wave * 0.05, 0.8);
        bullets.push({ x: e.x, y: e.y, vx: dx / d * 150, vy: dy / d * 150, r: 6, hue: 320, friendly: false });
      }
      if (d < e.r + 14) damageHero();
    } else if (e.type === 'kamikaze') {
      e.x += dx / d * e.speed * sdt; e.y += dy / d * e.speed * sdt;
      if (d < e.r + 16) {
        e.dead = true;
        burst(e.x, e.y, 20, 22, 200);
        shake = 12;
        audio.hurtSound();
        damageHero();
      }
    } else if (e.type === 'boss') {
      e.chargeCd -= sdt; e.fireCd -= sdt;
      if (e.charging > 0) {
        e.charging -= sdt;
        e.x += e.cvx * sdt; e.y += e.cvy * sdt;
      } else {
        e.x += dx / d * e.speed * sdt; e.y += dy / d * e.speed * sdt;
        if (e.chargeCd <= 0) {
          e.chargeCd = 4.5; e.charging = 0.6;
          e.cvx = dx / d * 320; e.cvy = dy / d * 320;
          audio.dashSound();
        }
        if (e.fireCd <= 0) {
          e.fireCd = 2.8;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + e.t;
            bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, r: 6, hue: 280, friendly: false });
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
      e.x += Math.cos(a2) * e.speed * sdt; e.y += Math.sin(a2) * e.speed * sdt;
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
          bullets.push({ x: e.x, y: e.y, vx: Math.cos(a3) * 140, vy: Math.sin(a3) * 140, r: 6, hue: 335, friendly: false });
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
    if (Math.random() < 0.35) particles.push({ x: d.x, y: d.y, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 40, life: 0.25, t: 0, hue: 45, spring: false, r: 1.5 });
  }
  debris = debris.filter(d => d.t < d.life);
  for (const fl of flashes) fl.t += dt;
  flashes = flashes.filter(fl => fl.t < fl.life);
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
  // deep gradient bg
  const bg = f.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#04050d'); bg.addColorStop(0.55, '#070818'); bg.addColorStop(1, '#0b0620');
  f.fillStyle = bg; f.fillRect(0, 0, W, H);
  // faint outer grid
  f.strokeStyle = 'rgba(50,70,160,0.06)'; f.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) { f.beginPath(); f.moveTo(x, 0); f.lineTo(x, H); f.stroke(); }
  for (let y = 0; y <= H; y += 48) { f.beginPath(); f.moveTo(0, y); f.lineTo(W, y); f.stroke(); }
  // arena floor: clipped tech panels
  f.save();
  f.beginPath(); f.arc(CX, CY, ARENA_R, 0, Math.PI * 2); f.clip();
  const fg = f.createRadialGradient(CX, CY - 60, 40, CX, CY, ARENA_R);
  fg.addColorStop(0, '#101a38'); fg.addColorStop(0.7, '#0b1228'); fg.addColorStop(1, '#080c1e');
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
  // vignette
  const vg = f.createRadialGradient(CX, CY, ARENA_R * 0.6, CX, CY, W * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,5,0.55)');
  f.fillStyle = vg; f.fillRect(0, 0, W, H);
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

function render() {
  g.save();
  if (shake > 0) g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // pre-rendered tech floor + animated circuit energy + neon reflections
  if (!floorCanvas) buildFloor();
  g.fillStyle = '#04050d'; g.fillRect(-20, -20, W + 40, H + 40);
  g.drawImage(floorCanvas, 0, 0);
  drawFloorDynamic();

  // pulsing arena ring (fever = golden overdrive)
  const pulse = 1 + Math.sin(tPulse * 2.2) * 0.008;
  const ringHue = fever > 0 ? 50 : 195;
  neonCircle(CX, CY, ARENA_R * pulse, ringHue, fever > 0 ? 34 : 22, 0.9);
  neonCircle(CX, CY, ARENA_R * pulse + 8, fever > 0 ? 35 : 265, 12, 0.35);

  if (state === 'playing' || state === 'gameover') {
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

    // hero
    drawHero();

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

  g.restore(); // shake

  // HUD
  if (state === 'playing' || state === 'gameover') {
    // cyberpunk HUD plates (chamfered, subtle)
    g.save();
    g.fillStyle = 'rgba(8,14,32,0.55)';
    g.strokeStyle = 'rgba(90,180,255,0.35)'; g.lineWidth = 1.5;
    // score plate (top-left, angled right edge)
    g.beginPath(); g.moveTo(0, 0); g.lineTo(230, 0); g.lineTo(206, 70); g.lineTo(0, 70); g.closePath(); g.fill(); g.stroke();
    // wave plate (top-right, angled left edge)
    g.beginPath(); g.moveTo(W, 0); g.lineTo(W - 190, 0); g.lineTo(W - 166, 84); g.lineTo(W, 84); g.closePath(); g.fill(); g.stroke();
    // accent ticks
    g.strokeStyle = 'rgba(77,255,210,0.6)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 70); g.lineTo(60, 70); g.stroke();
    g.beginPath(); g.moveTo(W, 84); g.lineTo(W - 60, 84); g.stroke();
    g.restore();
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = '#e8f4ff'; g.font = '700 26px "Segoe UI", sans-serif';
    g.fillText('SCORE ' + score, 18, 14);
    g.fillStyle = 'rgba(180,210,255,0.7)'; g.font = '600 16px "Segoe UI", sans-serif';
    g.fillText('BEST ' + best, 18, 46);
    g.textAlign = 'right';
    g.fillStyle = '#9ef0ff'; g.font = '700 22px "Segoe UI", sans-serif';
    g.fillText('WAVE ' + wave, W - 18, 14);
    // hearts
    for (let i = 0; i < hero.hpMax; i++) {
      g.save(); g.translate(W - 30 - i * 30, 58);
      g.shadowColor = '#ff4d6d'; g.shadowBlur = 8;
      g.fillStyle = i < hero.hp ? '#ff4d6d' : 'rgba(120,120,140,0.3)';
      heartPath(0, 0, 9); g.fill();
      g.restore();
    }
    // cores counter
    g.save(); g.translate(24, 82);
    g.shadowColor = '#4dd2ff'; g.shadowBlur = 8;
    g.strokeStyle = '#9ee8ff'; g.fillStyle = 'rgba(30,120,200,0.8)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -6); g.lineTo(5, 0); g.lineTo(0, 6); g.lineTo(-5, 0); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.textAlign = 'left';
    g.fillStyle = '#9ee8ff'; g.font = '700 16px "Segoe UI", sans-serif';
    g.fillText('' + runCores, 38, 74);
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
    if (combo >= 2) {
      g.textAlign = 'center';
      const cs = 1 + Math.min(combo, 10) * 0.03;
      g.save(); g.translate(CX, 30); g.scale(cs, cs);
      g.shadowColor = '#ffe14d'; g.shadowBlur = 16;
      g.fillStyle = '#ffe14d'; g.font = '900 26px "Segoe UI", sans-serif';
      g.fillText(combo + ' COMBO  x' + multiplier, 0, 0);
      g.restore();
      // combo timer bar
      g.fillStyle = 'rgba(255,225,77,0.8)';
      g.fillRect(CX - 60, 64, 120 * (comboTimer / 3), 4);
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
    g.fillStyle = 'rgba(255,40,80,' + (hurtFlash * 0.4) + ')';
    g.fillRect(0, 0, W, H);
  }
  // slowmo tint
  if (slowmo > 0) {
    g.fillStyle = 'rgba(80,200,255,0.08)';
    g.fillRect(0, 0, W, H);
  }
  // combo fever: full-screen neon overdrive
  if (fever > 0 && state === 'playing') {
    const fa = Math.min(1, fever);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const og = g.createRadialGradient(CX, CY, ARENA_R * 0.5, CX, CY, W * 0.7);
    og.addColorStop(0, 'rgba(255,220,80,0)');
    og.addColorStop(1, 'rgba(255,180,40,' + (0.10 * fa + Math.sin(tPulse * 8) * 0.03) + ')');
    g.fillStyle = og; g.fillRect(0, 0, W, H);
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
  g.fillRect(0, 0, W, H);
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
  g.fillStyle = 'rgba(4,6,18,0.72)';
  g.fillRect(0, 0, W, H);
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
  if (!secondWindUsed) {
    uiButtons.secondWind = btn(CX, y, 340, 56, '▶ SECOND WIND (AD)', 130);
    y += 68;
  }
  if (runCores > 0 && !coresDoubled) {
    uiButtons.doubleCores = btn(CX, y, 340, 52, '▶ DOUBLE CORES (AD)', 200);
    y += 64;
  }
  uiButtons.playAgain = btn(CX, y, 260, 56, 'PLAY AGAIN', 300);
  uiButtons.toShop = btn(CX, y + 66, 200, 44, 'UPGRADES', 200);
  if (adBusy) {
    g.fillStyle = '#ffe14d'; g.font = '700 18px "Segoe UI", sans-serif';
    g.fillText('Loading ad...', CX, H - 30);
  }
}

// ---------- input ----------
function canvasPos(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
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

// ---------- debug hook ----------
if (new URLSearchParams(location.search).get('debug') === '1') {
  window.__astro = {
    forceGameOver: () => { if (state === 'playing') { hero.hp = 0; gameOver(); } },
    addScore: (n) => { score += n; },
    addCores: (n) => { addCores(n); },
    addRunCores: (n) => { runCores += n; },
    setCombo: (n) => { combo = n; comboTimer = 3; multiplier = 1 + Math.floor(n / 3); },
    spawn: (type) => spawnEnemy(type),
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
      enemies: enemies ? enemies.map(e => ({ dx: e.x - hero.x, dy: e.y - hero.y, type: e.type, hp: e.hp })) : [],
      coreDrops: cores ? cores.length : 0,
      bullets: bullets ? bullets.length : 0,
    }),
    startGame: () => { if (state === 'menu') startGame(); },
  };
}

// ---------- boot ----------
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!paused) {
    update(dt);
    render();
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
  requestAnimationFrame(loop);
}
boot();
