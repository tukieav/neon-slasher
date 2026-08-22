// Fresh Round 3 evidence: the same Fever kill-impact moment at every required size.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = [
  { width: 907, height: 510, out: 'round3-907x510-fever-impact.png' },
  { width: 1920, height: 1080, out: 'round3-1920x1080-fever-impact.png' },
  { width: 390, height: 844, out: 'round3-390x844-fever-impact.png' },
];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
for (const shot of shots) {
  const page = await browser.newPage({ viewport: shot, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  await page.evaluate(() => {
    window.__astro.testStart();
    window.__astro.setCombo(9);
    window.__astro.spawnAt('melee', 540, 320);
  });
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => window.__astro.getState());
  const enemy = state.enemies[0];
  const box = await page.locator('#game').boundingBox();
  const cam = await page.evaluate(() => window.__astro.getCam());
  const x = box.x + cam.ox + (state.heroX + enemy.dx) * cam.scale;
  const y = box.y + cam.oy + (state.heroY + enemy.dy) * cam.scale;
  await page.mouse.click(x, y);
  await page.waitForTimeout(35);
  await page.screenshot({ path: join(root, 'qa', shot.out) });
  if (errors.length) throw new Error(`${shot.out}: ${errors.join(' | ')}`);
  await page.close();
  console.log(shot.out);
}
await browser.close();
