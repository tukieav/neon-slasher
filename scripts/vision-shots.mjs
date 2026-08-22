// Vision-gate screenshots: menu + wave1 spawn + mid-combat at given resolution
import { chromium } from 'playwright';
const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';
const [wArg, hArg, tag] = process.argv.slice(2);
const W2 = parseInt(wArg || '1280'), H2 = parseInt(hArg || '720');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W2, height: H2 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `qa/${tag}-menu.png` });
await page.evaluate(() => window.__astro.startGame());
await page.waitForTimeout(700); // during intro sweep + teleport beams
await page.screenshot({ path: `qa/${tag}-wave1.png` });
await page.evaluate(() => window.__astro.skipIntro());
// fight a bit
const cam = await page.evaluate(() => window.__astro.getCam());
const bbox = await page.locator('#game').boundingBox();
const gx = (x) => bbox.x + cam.ox + x * cam.scale;
const gy = (y) => bbox.y + cam.oy + y * cam.scale;
for (let i = 0; i < 12; i++) {
  const s = await page.evaluate(() => window.__astro.getState());
  if (s.state !== 'playing' || !s.enemies.length) break;
  let ne = null, nd = 1e9;
  for (const e of s.enemies) { const d = Math.hypot(e.dx, e.dy); if (d < nd) { nd = d; ne = e; } }
  const cx = Math.max(5, Math.min(955, s.heroX + ne.dx)), cy = Math.max(5, Math.min(635, s.heroY + ne.dy));
  await page.mouse.move(gx(cx), gy(cy));
  await page.mouse.click(gx(cx), gy(cy));
  await page.waitForTimeout(240);
}
await page.evaluate(() => { window.__astro.setCombo(5); for (const t of ['melee','shooter','kamikaze']) window.__astro.spawn(t); });
await page.waitForTimeout(500);
await page.screenshot({ path: `qa/${tag}-combat.png` });
// death shot
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(1300);
await page.screenshot({ path: `qa/${tag}-death.png` });
console.log('errors:', errors.length, errors.join(' | '));
await browser.close();
