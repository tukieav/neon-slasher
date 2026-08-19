// Neon Slasher — procedural audio via WebAudio (no audio files)
let ctx = null;
let masterGain = null;
let muted = false;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 0.5;
}

export function unlockAudio() { ensureCtx(); }

function tone(freq, dur, type, vol, delay = 0) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noise(dur, vol, delay = 0, hp = 1000) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(masterGain);
  src.start(t0);
}

// blade swish — filtered noise sweep
export function slashSound(combo) {
  ensureCtx();
  noise(0.14, 0.3, 0, 2200 + Math.min(combo, 10) * 150);
  tone(700 + Math.min(combo, 10) * 60, 0.08, 'sawtooth', 0.06);
}

// enemy hit / kill — metallic pop, pitch rises with combo
export function hitSound(combo) {
  ensureCtx();
  const base = 320 + Math.min(combo, 12) * 45;
  tone(base, 0.14, 'square', 0.22);
  tone(base * 1.5, 0.1, 'triangle', 0.14, 0.02);
}

// dash whoosh — low sweep
export function dashSound() {
  ensureCtx();
  noise(0.22, 0.25, 0, 500);
  tone(180, 0.2, 'sine', 0.18);
}

// player hurt
export function hurtSound() {
  ensureCtx();
  tone(150, 0.3, 'sawtooth', 0.3);
  tone(110, 0.35, 'square', 0.2, 0.05);
}

// projectile deflect
export function deflectSound() {
  ensureCtx();
  tone(1200, 0.1, 'triangle', 0.25);
  tone(1600, 0.08, 'sine', 0.15, 0.03);
}

// wave fanfare
export function waveSound() {
  ensureCtx();
  [440, 554, 659, 880].forEach((f, i) => tone(f, 0.25, 'triangle', 0.22, i * 0.09));
}

// boss spawn
export function bossSound() {
  ensureCtx();
  [110, 138, 110, 165].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.25, i * 0.14));
}

// slow-mo triple kill
export function slowmoSound() {
  ensureCtx();
  [880, 660, 440, 330].forEach((f, i) => tone(f, 0.3, 'sine', 0.2, i * 0.05));
}

// heart pickup
export function pickupSound() {
  ensureCtx();
  [523, 784, 1047].forEach((f, i) => tone(f, 0.15, 'sine', 0.2, i * 0.06));
}

export function gameOverSound() {
  ensureCtx();
  [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, 'sawtooth', 0.15, i * 0.15));
}
