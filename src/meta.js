// Neon Slasher — persistent meta-progression (cores currency, upgrades, katanas, perks, streak)
// Saved via CrazyGames SDK data module (cloud) with localStorage fallback.
import { loadData, saveData } from './sdk.js';

const KEY = 'neonslasher.meta';

export const UPGRADES = [
  { id: 'hp',     name: 'HULL PLATING',  desc: '+1 heart',            max: 2, costs: [40, 140] },
  { id: 'slowmo', name: 'CHRONO CORE',   desc: '+50% slow-mo time',   max: 3, costs: [30, 80, 200] },
  { id: 'dash',   name: 'DASH COILS',    desc: '-12% dash cooldown',  max: 3, costs: [30, 80, 200] },
  { id: 'range',  name: 'EDGE EXTEND',   desc: '+12% slash range',    max: 3, costs: [35, 90, 220] },
  { id: 'magnet', name: 'CORE MAGNET',   desc: 'wider pickup pull',   max: 3, costs: [25, 60, 150] },
];

export const KATANAS = [
  { id: 0, name: 'NEON PINK',  hue: 300, cost: 0 },
  { id: 1, name: 'PLASMA GOLD', hue: 55,  cost: 80 },
  { id: 2, name: 'ION BLUE',   hue: 200, cost: 180 },
  { id: 3, name: 'VOID EMBER', hue: 15,  cost: 350 },
];

export const PERKS = [
  { id: 'none',    name: 'NO PERK',      desc: 'balanced run', cost: 0 },
  { id: 'glass',   name: 'GLASS CANNON', desc: '+50% score, max 2 hearts', cost: 120 },
  { id: 'tank',    name: 'TANK FRAME',   desc: '+1 heart, -12% speed', cost: 120 },
  { id: 'vampire', name: 'VAMPIRE EDGE', desc: '+1 heart every 20 kills', cost: 160 },
];

function defaults() {
  return {
    cores: 0,
    totalCores: 0,
    upgrades: { hp: 0, slowmo: 0, dash: 0, range: 0, magnet: 0 },
    katanasOwned: [true, false, false, false],
    katana: 0,
    perksOwned: { none: true, glass: false, tank: false, vampire: false },
    perk: 'none',
    bestWave: 0,
    plays: 0,
    streakCount: 0,
    streakLast: '',
  };
}

export let meta = defaults();

export function loadMeta() {
  try {
    const raw = loadData(KEY);
    if (raw) {
      const m = JSON.parse(raw);
      meta = Object.assign(defaults(), m);
      meta.upgrades = Object.assign(defaults().upgrades, m.upgrades || {});
      meta.perksOwned = Object.assign(defaults().perksOwned, m.perksOwned || {});
      if (!Array.isArray(meta.katanasOwned) || meta.katanasOwned.length !== 4) meta.katanasOwned = defaults().katanasOwned;
    }
  } catch (e) { meta = defaults(); }
  if (!meta.katanasOwned[meta.katana]) meta.katana = 0;
  if (!meta.perksOwned[meta.perk]) meta.perk = 'none';
  return meta;
}

export function saveMeta() {
  try { saveData(KEY, JSON.stringify(meta)); } catch (e) {}
}

// Daily streak: call once at boot. Returns {bonus, count, isNew} — bonus cores granted today.
export function checkDailyStreak() {
  const today = new Date().toISOString().slice(0, 10);
  if (meta.streakLast === today) return { bonus: 0, count: meta.streakCount, isNew: false };
  const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  meta.streakCount = (meta.streakLast === yest) ? meta.streakCount + 1 : 1;
  meta.streakLast = today;
  const bonus = 10 * Math.min(meta.streakCount, 7);
  meta.cores += bonus;
  meta.totalCores += bonus;
  saveMeta();
  return { bonus, count: meta.streakCount, isNew: true };
}

export function addCores(n) {
  meta.cores += n;
  meta.totalCores += n;
  saveMeta();
}

export function upgradeLevel(id) { return meta.upgrades[id] || 0; }

export function upgradeCost(id) {
  const u = UPGRADES.find(u => u.id === id);
  const lvl = upgradeLevel(id);
  return lvl >= u.max ? null : u.costs[lvl];
}

export function buyUpgrade(id) {
  const cost = upgradeCost(id);
  if (cost == null || meta.cores < cost) return false;
  meta.cores -= cost;
  meta.upgrades[id]++;
  saveMeta();
  return true;
}

export function buyKatana(i) {
  const k = KATANAS[i];
  if (!k || meta.katanasOwned[i] || meta.cores < k.cost) return false;
  meta.cores -= k.cost;
  meta.katanasOwned[i] = true;
  saveMeta();
  return true;
}

export function buyPerk(id) {
  const p = PERKS.find(p => p.id === id);
  if (!p || meta.perksOwned[id] || meta.cores < p.cost) return false;
  meta.cores -= p.cost;
  meta.perksOwned[id] = true;
  saveMeta();
  return true;
}

// Derived run stats from upgrades + perk
export function runStats() {
  const u = meta.upgrades;
  let hpMax = 3 + u.hp;
  let speed = 230;
  if (meta.perk === 'tank') { hpMax += 1; speed *= 0.88; }
  if (meta.perk === 'glass') hpMax = 2;
  return {
    hpMax,
    speed,
    slowmoDur: 0.3 * (1 + 0.5 * u.slowmo),
    dashCd: 2 * Math.pow(0.88, u.dash),
    range: 82 * (1 + 0.12 * u.range),
    magnet: 50 + 45 * u.magnet,
    scoreMul: meta.perk === 'glass' ? 1.5 : 1,
    vampire: meta.perk === 'vampire',
  };
}
