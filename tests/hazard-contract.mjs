import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => {
  window.__astro.testStart();
  window.__astro.setWave(4);
  // Isolate the active-hazard spawn: the wave's opening queue is allowed to
  // appear during its warning and is not the contract under test here.
  window.__astro.clearArena();
});
const announced = await page.evaluate(() => window.__astro.getState().hazard?.warning > 0);
await page.waitForTimeout(1400);
await page.evaluate(() => window.__astro.spawn('melee'));
const fairSpawn = await page.evaluate(() => {
  const s = window.__astro.getState(), e = s.enemies.find(x => x.type === 'melee');
  if (!s.hazard || !e) return false;
  const a = Math.atan2(e.dy, e.dx);
  let d = Math.abs(a - s.hazard.angle); if (d > Math.PI) d = Math.PI * 2 - d;
  return d >= s.hazard.width + 0.34;
});
console.log(`${announced ? 'PASS' : 'FAIL'} — wave 4 creates a visible pre-charge hazard warning`);
console.log(`${fairSpawn ? 'PASS' : 'FAIL'} — active hazard does not overlap default enemy spawn`);
await browser.close();
process.exit(announced && fairSpawn ? 0 : 1);
