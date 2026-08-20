// CrazyGames SDK v3 wrapper — safe no-op fallbacks when SDK unavailable (local dev)
let sdk = null;
let inited = false;

export async function initSDK() {
  try {
    if (window.CrazyGames && window.CrazyGames.SDK) {
      // SDK.init() may hang forever on non-whitelisted domains (sitelock),
      // e.g. GitHub Pages — race it against a timeout so the game always boots.
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('sdk init timeout')), 3000));
      await Promise.race([window.CrazyGames.SDK.init(), timeout]);
      sdk = window.CrazyGames.SDK;
      inited = true;
    }
  } catch (e) {
    console.warn('CrazyGames SDK unavailable (local dev / non-CG domain)', e);
    sdk = null;
    inited = false;
  }
  return inited;
}

export function sdkAvailable() { return inited; }

let lastGp = 0;
export function gameplayStart() {
  // SDK throttles gameplay calls to 1/s and logs a console error — defer if needed
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastGp));
  lastGp = now + wait;
  const call = () => { try { if (sdk) sdk.game.gameplayStart(); } catch (e) {} };
  if (wait > 0) setTimeout(call, wait); else call();
}

export function gameplayStop() {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastGp));
  lastGp = now + wait;
  const call = () => { try { if (sdk) sdk.game.gameplayStop(); } catch (e) {} };
  if (wait > 0) setTimeout(call, wait); else call();
}

export function loadingStart() {
  try { if (sdk) sdk.game.loadingStart(); } catch (e) {}
}

export function loadingStop() {
  try { if (sdk) sdk.game.loadingStop(); } catch (e) {}
}

let lastHappy = 0;
export function happytime() {
  // SDK throttles happytime() to 1/s and logs a console error — gate locally
  const now = Date.now();
  if (now - lastHappy < 1500) return;
  lastHappy = now;
  try { if (sdk) sdk.game.happytime(); } catch (e) {}
}

// Returns a promise resolving to true if the ad finished (grant reward), false otherwise.
export function requestAd(type, { onStart, onFinish } = {}) {
  return new Promise((resolve) => {
    if (!sdk) { resolve(type !== 'rewarded'); return; } // local dev: midgame "succeeds", rewarded fails
    const callbacks = {
      adStarted: () => { if (onStart) onStart(); },
      adFinished: () => { if (onFinish) onFinish(); resolve(true); },
      adError: (e) => { if (onFinish) onFinish(); resolve(false); },
    };
    try { sdk.ad.requestAd(type, callbacks); }
    catch (e) { if (onFinish) onFinish(); resolve(false); }
  });
}

export function getMuteSetting() {
  try { return sdk ? !!sdk.game.settings.muteAudio : false; } catch (e) { return false; }
}

export function onSettingsChange(fn) {
  try { if (sdk) sdk.game.addSettingsChangeListener(fn); } catch (e) {}
}

// Generic persistent data: SDK data module (cross-device) with localStorage fallback
export function loadData(key) {
  try {
    if (sdk) {
      const v = sdk.data.getItem(key);
      if (v != null) return v;
    }
  } catch (e) {}
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

export function saveData(key, val) {
  try { if (sdk) sdk.data.setItem(key, val); } catch (e) {}
  try { localStorage.setItem(key, val); } catch (e) {}
}

// Persistent best score: SDK data module (cross-device) with localStorage fallback
export function loadBest() {
  try {
    if (sdk) {
      const v = sdk.data.getItem('bestScore');
      if (v != null) return parseInt(v, 10) || 0;
    }
  } catch (e) {}
  try { return parseInt(localStorage.getItem('neonslasher.best') || '0', 10) || 0; } catch (e) { return 0; }
}

export function saveBest(score) {
  try { if (sdk) sdk.data.setItem('bestScore', String(score)); } catch (e) {}
  try { localStorage.setItem('neonslasher.best', String(score)); } catch (e) {}
}
