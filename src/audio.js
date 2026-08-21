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

// Lifecycle hooks deliberately suspend the context rather than rebuilding it.
// This keeps one audio graph alive across visibility, focus, ads and retries.
export function pauseAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function resumeAudio() {
  if (ctx && !muted && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

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

// combo fever activation
export function feverSound() {
  ensureCtx();
  [440, 554, 659, 880, 1109].forEach((f, i) => tone(f, 0.18, 'square', 0.18, i * 0.05));
}

// core pickup — short bright blip
export function coreSound() {
  ensureCtx();
  tone(988, 0.09, 'triangle', 0.14);
  tone(1319, 0.07, 'sine', 0.1, 0.03);
}

// shop purchase
export function buySound() {
  ensureCtx();
  [659, 880, 1319].forEach((f, i) => tone(f, 0.14, 'triangle', 0.2, i * 0.07));
}

export function errorSound() {
  ensureCtx();
  tone(180, 0.18, 'square', 0.18);
}

// ---------- background music: minimal procedural synthwave loop ----------
let musicOn = true;
let musicTimer = null;
let musicStep = 0;
const BASS = [55, 55, 65.4, 49];          // A1 A1 C2 G1
const ARP = [220, 261.6, 329.6, 261.6];   // Am arp

function musicTick() {
  if (muted || !musicOn || !ctx) return;
  const bar = Math.floor(musicStep / 8) % 4;
  const t0 = ctx.currentTime;
  // bass every step
  const osc = ctx.createOscillator(), gg = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = BASS[bar];
  gg.gain.setValueAtTime(0.05, t0);
  gg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  osc.connect(gg); gg.connect(masterGain);
  osc.start(t0); osc.stop(t0 + 0.25);
  // arp on even steps
  if (musicStep % 2 === 0) {
    const a = ctx.createOscillator(), ag = ctx.createGain();
    a.type = 'triangle';
    a.frequency.value = ARP[(musicStep / 2) % 4] * (bar === 2 ? 1.189 : 1);
    ag.gain.setValueAtTime(0.035, t0);
    ag.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    a.connect(ag); ag.connect(masterGain);
    a.start(t0); a.stop(t0 + 0.32);
  }
  musicStep++;
}

export function startMusic() {
  ensureCtx();
  if (musicTimer) return;
  musicTimer = setInterval(musicTick, 240);
}

export function setMusicOn(on) {
  musicOn = on;
  if (on) startMusic();
}

export function getMusicOn() { return musicOn; }
