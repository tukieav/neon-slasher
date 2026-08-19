// Neon Slasher — arena katana slasher vs robot waves (CrazyGames)
// Zero blood: enemies are neon droids that burst into glowing particles & springs.
import { initSDK, loadingStart, loadingStop, gameplayStart, gameplayStop, happytime, requestAd, getMuteSetting, onSettingsChange, loadBest, saveBest } from './sdk.js';
import * as audio from './audio.js';

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
let state = 'loading'; // loading -> menu -> playing -> gameover
let score = 0, best = 0, wave = 0;
let hero, enemies, bullets, particles, floats, pickups;
let combo = 0, comboTimer = 0, multiplier = 1;
let shake = 0, hurtFlash = 0, slowmo = 0, timeScale = 1;
let waveBanner = 0, waveBannerText = '';
let secondWindUsed = false, secondWindShield = 0;
let killsTotal = 0;
let adBusy = false;
let paused = false;
let tPulse = 0;
let spawnQueue = [];
let spawnTimer = 0;

const KEYS = {};
let mouseX = CX, mouseY = CY - 100;
let isTouch = false;

// virtual joystick (mobile)
const joy = { active: false, id: -1, x0: 0, y0: 0, dx: 0, dy: 0 };
const rightTouch = { active: false, id: -1, x0: 0, y0: 0, t0: 0 };

function newHero() {
  return {
    x: CX, y: CY, vx: 0, vy: 0, aim: -Math.PI / 2,
    hp: 3, speed: 230,
    slashTimer: 0, slashCd: 0, slashAngle: 0,
    dashTimer: 0, dashCd: 0, iframes: 0,
    trail: [], slashArcs: [],
  };
}

function reset() {
  hero = newHero();
  enemies = []; bullets = []; particles = []; floats = []; pickups = [];
  score = 0; wave = 0; combo = 0; comboTimer = 0; multiplier = 1;
  shake = 0; hurtFlash = 0; slowmo = 0; timeScale = 1;
  secondWindUsed = false; secondWindShield = 0; killsTotal = 0;
  spawnQueue = []; spawnTimer = 0;
}

// ---------- waves ----------
function startWave(n) {
  wave = n;
  waveBanner = 2; waveBannerText = (n % 5 === 0) ? 'WAVE ' + n + ' — MINI-BOSS!' : 'WAVE ' + n;
  if (n % 5 === 0) audio.bossSound(); else audio.waveSound();
  const q = [];
  if (n % 5 === 0) {
    q.push('boss');
    for (let i = 0; i < 2 + Math.floor(n / 5); i++) q.push('melee');
  } else {
    const count = 3 + n * 2;
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      if (n >= 2 && r < 0.25) q.push('shooter');
      else if (n >= 3 && r < 0.45) q.push('kamikaze');
      else q.push('melee');
    }
  }
  spawnQueue = q; spawnTimer = 0.3;
  // heart pickup every 3 waves if hurt
  if (n > 1 && n % 3 === 0 && hero.hp < 3) {
    const a = Math.random() * Math.PI * 2;
    pickups.push({ x: CX + Math.cos(a) * ARENA_R * 0.5, y: CY + Math.sin(a) * ARENA_R * 0.5, t: 0 });
  }
}

function spawnEnemy(type) {
  const a = Math.random() * Math.PI * 2;
  const x = CX + Math.cos(a) * (ARENA_R - 14);
  const y = CY + Math.sin(a) * (ARENA_R - 14);
  const wv = wave;
  if (type === 'melee') {
    enemies.push({ type, x, y, hp: 1, r: 14, speed: 70 + wv * 4, t: 0, spawn: 0.6, hue: 185 });
  } else if (type === 'shooter') {
    enemies.push({ type, x, y, hp: 1, r: 13, speed: 55 + wv * 2, t: Math.random() * 2, spawn: 0.6, fireCd: 1.6, hue: 300 });
  } else if (type === 'kamikaze') {
    enemies.push({ type, x, y, hp: 1, r: 11, speed: 150 + wv * 5, t: 0, spawn: 0.6, hue: 20 });
  } else if (type === 'boss') {
    const bhp = 16 + Math.floor(wv / 5) * 8;
    enemies.push({ type, x, y, hp: bhp, maxHp: bhp, r: 34, speed: 45, t: 0, spawn: 1, fireCd: 2.5, chargeCd: 4, charging: 0, cvx: 0, cvy: 0, hue: 265 });
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
  hero.slashCd = 0.28;
  hero.slashTimer = 0.14;
  hero.slashAngle = hero.aim;
  hero.slashArcs.push({ a: hero.aim, t: 0 });
  audio.slashSound(combo);
  let kills = 0;
  const RANGE = 82, HALF = Math.PI * (60 / 180); // 120° arc
  for (const e of enemies) {
    if (e.spawn > 0) continue;
    const dx = e.x - hero.x, dy = e.y - hero.y;
    const d = Math.hypot(dx, dy);
    if (d < RANGE + e.r && angDiff(Math.atan2(dy, dx), hero.aim) < HALF) {
      e.hp -= 1;
      e.hitFlash = 0.15;
      shake = Math.min(shake + 4, 12);
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
    }
  }
  if (kills >= 3) {
    slowmo = 0.3;
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
  const pts = (e.type === 'boss' ? 500 : e.type === 'kamikaze' ? 30 : e.type === 'shooter' ? 25 : 15) * multiplier;
  score += pts;
  addFloat(e.x, e.y, '+' + pts, e.hue);
  audio.hitSound(combo);
  burst(e.x, e.y, e.hue, e.type === 'boss' ? 40 : 14, e.type === 'boss' ? 220 : 160);
  if (e.type === 'boss') {
    shake = 18;
    happytime();
    addFloat(e.x, e.y - 30, 'BOSS DOWN!', 55);
  }
}

function doDash() {
  if (hero.dashCd > 0 || state !== 'playing') return;
  hero.dashCd = 2;
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
}

function startGame() {
  reset();
  state = 'playing';
  gameplayStart();
  startWave(1);
}

async function playAgain() {
  if (adBusy) return;
  adBusy = true;
  await requestAd('midgame', {
    onStart: () => { audio.setMuted(true); },
    onFinish: () => { audio.setMuted(getMuteSetting()); },
  });
  adBusy = false;
  startGame();
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
    hero.hp = 3;
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
  if (slowmo > 0) { slowmo -= dt; timeScale = 0.3; } else timeScale = 1;
  const sdt = dt * timeScale;

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
  } else {
    hero.x += mx * hero.speed * sdt;
    hero.y += my * hero.speed * sdt;
    if (Math.abs(mx) + Math.abs(my) > 0.1 && Math.random() < 0.3) hero.trail.push({ x: hero.x, y: hero.y, t: 0.25 });
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

  // pickups
  for (const p of pickups) {
    p.t += sdt;
    if (Math.hypot(p.x - hero.x, p.y - hero.y) < 24 && hero.hp < 3) {
      p.dead = true;
      hero.hp = Math.min(3, hero.hp + 1);
      audio.pickupSound();
      addFloat(p.x, p.y, '+1 HP', 0);
      burst(p.x, p.y, 350, 12, 130);
    }
  }
  pickups = pickups.filter(p => !p.dead);

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
  for (const f of floats) { f.t += dt; f.y -= 30 * dt; }
  floats = floats.filter(f => f.t < 1.2);
  if (hero) {
    for (const tr of hero.trail) tr.t += dt;
    hero.trail = hero.trail.filter(tr => tr.t < 0.4);
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

function render() {
  g.save();
  if (shake > 0) g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // bg
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05060f'); bg.addColorStop(1, '#0c0620');
  g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40);

  // grid
  g.strokeStyle = 'rgba(60,80,180,0.09)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  // pulsing arena
  const pulse = 1 + Math.sin(tPulse * 2.2) * 0.008;
  neonCircle(CX, CY, ARENA_R * pulse, 195, 22, 0.9);
  neonCircle(CX, CY, ARENA_R * pulse + 8, 265, 12, 0.35);
  g.fillStyle = 'rgba(20,30,70,0.22)';
  g.beginPath(); g.arc(CX, CY, ARENA_R, 0, Math.PI * 2); g.fill();

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
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = '#e8f4ff'; g.font = '700 26px "Segoe UI", sans-serif';
    g.fillText('SCORE ' + score, 18, 14);
    g.fillStyle = 'rgba(180,210,255,0.7)'; g.font = '600 16px "Segoe UI", sans-serif';
    g.fillText('BEST ' + best, 18, 46);
    g.textAlign = 'right';
    g.fillStyle = '#9ef0ff'; g.font = '700 22px "Segoe UI", sans-serif';
    g.fillText('WAVE ' + wave, W - 18, 14);
    // hearts
    for (let i = 0; i < 3; i++) {
      g.save(); g.translate(W - 30 - i * 30, 58);
      g.shadowColor = '#ff4d6d'; g.shadowBlur = 8;
      g.fillStyle = i < hero.hp ? '#ff4d6d' : 'rgba(120,120,140,0.3)';
      heartPath(0, 0, 9); g.fill();
      g.restore();
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
    g.fillRect(60, H - 32, 90 * (1 - Math.max(0, hero.dashCd) / 2), 10);
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

  if (state === 'menu') renderMenu();
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
  g.save();
  g.translate(h.x, h.y);
  // i-frames blink / shield
  if (secondWindShield > 0 || h.iframes > 0.05) {
    if (Math.floor(tPulse * 12) % 2 === 0 || secondWindShield > 0) {
      neonCircle(0, 0, 22, secondWindShield > 0 ? 130 : 195, 14, 0.6);
    }
  }
  g.rotate(h.aim);
  // body
  g.shadowColor = '#4dffd2'; g.shadowBlur = 18;
  g.fillStyle = '#0d2b26';
  g.strokeStyle = '#4dffd2'; g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(13, 0); g.lineTo(-9, -9); g.lineTo(-5, 0); g.lineTo(-9, 9);
  g.closePath(); g.fill(); g.stroke();
  // head glow
  g.fillStyle = '#b3fff0';
  g.beginPath(); g.arc(4, 0, 3.5, 0, Math.PI * 2); g.fill();
  // katana
  const sl = h.slashTimer > 0 ? 1 : 0;
  g.save();
  g.rotate(sl ? (-1 + (1 - h.slashTimer / 0.14) * 2) * 1.05 : 0.45);
  g.shadowColor = '#ff4dff'; g.shadowBlur = 14;
  g.strokeStyle = '#ffb3ff'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(8, 0); g.lineTo(38, 0); g.stroke();
  g.strokeStyle = '#ff4dff'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(8, 0); g.lineTo(38, 0); g.stroke();
  g.restore();
  g.restore();
  // slash arcs
  for (const a of hero.slashArcs) {
    const p = a.t / 0.22;
    g.save();
    g.translate(h.x, h.y);
    g.shadowColor = '#ff4dff'; g.shadowBlur = 20;
    g.strokeStyle = 'hsla(300,100%,75%,' + (1 - p) + ')';
    g.lineWidth = 8 * (1 - p) + 2;
    g.beginPath();
    g.arc(0, 0, 55 + p * 30, a.a - Math.PI / 3, a.a + Math.PI / 3);
    g.stroke();
    g.restore();
  }
}

function drawEnemy(e) {
  g.save();
  g.translate(e.x, e.y);
  const sp = e.spawn > 0 ? Math.max(0.1, 1 - e.spawn / 0.6) : 1;
  g.scale(sp, sp);
  g.globalAlpha = e.spawn > 0 ? 0.5 : 1;
  const flash = e.hitFlash > 0;
  g.shadowColor = 'hsl(' + e.hue + ',100%,60%)';
  g.shadowBlur = flash ? 26 : 14;
  g.strokeStyle = flash ? '#ffffff' : 'hsl(' + e.hue + ',100%,65%)';
  g.fillStyle = 'hsla(' + e.hue + ',80%,20%,0.85)';
  g.lineWidth = 2.5;
  if (e.type === 'melee') {
    g.rotate(e.t * 1.5);
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'hsl(' + e.hue + ',100%,70%)';
    g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
  } else if (e.type === 'shooter') {
    g.rotate(Math.sin(e.t * 2) * 0.3);
    g.beginPath(); g.rect(-e.r, -e.r, e.r * 2, e.r * 2);
    g.fill(); g.stroke();
    g.fillStyle = 'hsl(' + e.hue + ',100%,70%)';
    g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill();
  } else if (e.type === 'kamikaze') {
    g.rotate(e.t * 6);
    g.beginPath();
    g.moveTo(0, -e.r * 1.3); g.lineTo(e.r, e.r); g.lineTo(-e.r, e.r);
    g.closePath(); g.fill(); g.stroke();
    // warning pulse
    const d = Math.hypot(e.x - hero.x, e.y - hero.y);
    if (d < 130) { g.globalAlpha = 0.5 + Math.sin(e.t * 20) * 0.5; g.strokeStyle = '#ff3333'; g.stroke(); }
  } else if (e.type === 'boss') {
    g.rotate(e.t * 0.6);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 === 0 ? e.r : e.r * 0.75;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'hsl(' + e.hue + ',100%,70%)';
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // boss hp bar
  if (e.type === 'boss' && e.spawn <= 0) {
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
  roundRect(x - w2 / 2, y - h2 / 2, w2, h2, 12); g.fill(); g.stroke();
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
  g.save();
  g.shadowColor = '#4dffd2'; g.shadowBlur = 30;
  g.fillStyle = '#ffffff'; g.font = '900 72px "Segoe UI", sans-serif';
  g.fillText('NEON', CX, CY - 150);
  g.shadowColor = '#ff4dff';
  g.fillText('SLASHER', CX, CY - 80);
  g.restore();
  g.fillStyle = 'rgba(190,220,255,0.85)'; g.font = '600 20px "Segoe UI", sans-serif';
  g.fillText('WASD move · Mouse aim · Click slash · Space dash', CX, CY - 18);
  g.fillText('Deflect bullets with your blade. Survive the waves.', CX, CY + 12);
  uiButtons = { play: btn(CX, CY + 90, 240, 64, 'PLAY', 160) };
  g.fillStyle = 'rgba(160,200,255,0.6)'; g.font = '600 16px "Segoe UI", sans-serif';
  g.fillText('BEST ' + best, CX, CY + 150);
}

function renderGameOver() {
  g.fillStyle = 'rgba(4,6,18,0.72)';
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.shadowColor = '#ff4d6d'; g.shadowBlur = 26;
  g.fillStyle = '#ffffff'; g.font = '900 58px "Segoe UI", sans-serif';
  g.fillText('SYSTEM DOWN', CX, CY - 150);
  g.restore();
  g.fillStyle = '#e8f4ff'; g.font = '700 30px "Segoe UI", sans-serif';
  g.fillText('SCORE ' + score, CX, CY - 84);
  g.fillStyle = 'rgba(190,220,255,0.8)'; g.font = '600 20px "Segoe UI", sans-serif';
  g.fillText('BEST ' + best + '   ·   WAVE ' + wave + '   ·   ' + killsTotal + ' BOTS SLICED', CX, CY - 46);
  uiButtons = {};
  if (!secondWindUsed) {
    uiButtons.secondWind = btn(CX, CY + 26, 340, 60, '▶ SECOND WIND (AD)', 130);
    uiButtons.playAgain = btn(CX, CY + 106, 260, 56, 'PLAY AGAIN', 300);
  } else {
    uiButtons.playAgain = btn(CX, CY + 50, 280, 64, 'PLAY AGAIN', 300);
  }
  if (adBusy) {
    g.fillStyle = '#ffe14d'; g.font = '700 18px "Segoe UI", sans-serif';
    g.fillText('Loading ad...', CX, CY + 170);
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
  if (state === 'menu') {
    if (inBtn(p, uiButtons.play)) startGame();
    return true;
  }
  if (state === 'gameover') {
    if (inBtn(p, uiButtons.secondWind)) { secondWind(); return true; }
    if (inBtn(p, uiButtons.playAgain)) { playAgain(); return true; }
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
    getState: () => ({
      state, hp: hero ? hero.hp : 0, wave, score,
      heroX: hero ? hero.x : 0, heroY: hero ? hero.y : 0,
      dashCd: hero ? hero.dashCd : 0,
      combo, secondWindUsed,
      enemies: enemies ? enemies.map(e => ({ dx: e.x - hero.x, dy: e.y - hero.y, type: e.type, hp: e.hp })) : [],
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
  audio.setMuted(getMuteSetting());
  onSettingsChange((s) => { if (s && typeof s.muteAudio === 'boolean') audio.setMuted(s.muteAudio); });
  reset();
  state = 'menu';
  loadingStop();
  requestAnimationFrame(loop);
}
boot();
