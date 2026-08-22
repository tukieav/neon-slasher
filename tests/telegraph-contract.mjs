import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
const isolatedSpawn = async (type, x, y) => page.evaluate(([t, px, py]) => { window.__astro.testStart(); window.__astro.spawnAt(t, px, py); }, [type, x, y]);
const check = async (name, predicate, wait = 0) => {
  if (wait) await page.waitForTimeout(wait);
  const ok = await page.evaluate(predicate);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
  return ok;
};
await isolatedSpawn('melee', 510, 320);
const melee = await check('melee exposes windup arc before contact', () => window.__astro.getState().enemies.some(e => e.type === 'melee' && e.windup > 0), 980);
await isolatedSpawn('shooter', 700, 320);
const shooter = await check('shooter exposes charge line before firing', () => window.__astro.getState().enemies.some(e => e.type === 'shooter' && e.charge > 0), 1550);
await isolatedSpawn('kamikaze', 560, 320);
const kamikaze = await check('kamikaze exposes countdown ring before detonation', () => window.__astro.getState().enemies.some(e => e.type === 'kamikaze' && e.fuseStarted && e.fuse > 0), 680);
await isolatedSpawn('splitter', 700, 320);
const splitter = await check('splitter exposes pulse before speed surge', () => window.__astro.getState().enemies.some(e => e.type === 'splitter' && e.pulse > 1.7), 2500);
await isolatedSpawn('boss', 700, 320);
const boss = await check('boss exposes phase warning before charge', () => window.__astro.getState().enemies.some(e => e.type === 'boss' && e.phaseWarn > 0), 5250);
await browser.close();
process.exit(melee && shooter && kamikaze && splitter && boss ? 0 : 1);
