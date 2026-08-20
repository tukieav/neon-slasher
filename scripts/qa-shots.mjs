// QA screenshots: menu + gameplay states
import { chromium } from 'playwright';
const shots = process.argv[2] || 'qa';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:8528/?debug=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `qa/${shots}-menu.png` });
// start game, spawn a roster of enemies
await page.evaluate(() => { window.__astro.startGame(); });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const a = window.__astro;
  for (const t of ['melee', 'shooter', 'kamikaze', 'shield', 'splitter']) a.spawn(t);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: `qa/${shots}-gameplay.png` });
// dash + slash burst for juice shot
const box = await page.locator('#game').boundingBox();
const gx = (x) => box.x + x * (box.width / 960), gy = (y) => box.y + y * (box.height / 640);
await page.mouse.move(gx(620), gy(320));
await page.keyboard.down('d');
await page.keyboard.press(' ');
await page.waitForTimeout(80);
await page.screenshot({ path: `qa/${shots}-dash.png` });
await page.keyboard.up('d');
await page.mouse.click(gx(620), gy(320));
await page.waitForTimeout(60);
await page.screenshot({ path: `qa/${shots}-slash.png` });
// fever
await page.evaluate(() => { window.__astro.setCombo(9); });
await page.mouse.click(gx(620), gy(320));
await page.waitForTimeout(300);
// force fever via combo path: spawn+kill until fever; simpler: spawn twin boss for boss shot
await page.evaluate(() => { window.__astro.setWave(10); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `qa/${shots}-boss.png` });
console.log('errors:', JSON.stringify(errors));
await browser.close();
