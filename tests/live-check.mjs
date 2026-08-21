// Verify live GitHub Pages deploy: pixels + a few moves, no console errors
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('response', (r) => { if (r.status() >= 400) errors.push('http ' + r.status() + ': ' + r.url()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('console: ' + m.text()); });
await page.goto('https://tukieav.github.io/neon-slasher/?debug=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000); // SDK init timeout is 3s on non-whitelisted domain
const s0 = await page.evaluate(() => window.__astro.getState());
console.log('state after boot:', s0.state);
const bright = await page.evaluate(() => {
  const c = document.getElementById('game');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i+1] > 40 || d[i+2] > 40) n++;
  return n;
});
console.log('bright samples:', bright);
// play a bit
const cam = await page.evaluate(() => window.__astro.getCam());
const bbox = await page.locator('#game').boundingBox();
await page.mouse.click(bbox.x + cam.ox + (960/2) * cam.scale, bbox.y + cam.oy + (640/2 + 56) * cam.scale);
await page.waitForTimeout(800);
await page.keyboard.down('d'); await page.waitForTimeout(400); await page.keyboard.up('d');
await page.keyboard.press('Space');
await page.waitForTimeout(600);
const s1 = await page.evaluate(() => window.__astro.getState());
console.log('playing:', s1.state, 'wave:', s1.wave, 'heroX moved:', s1.heroX !== W/2);
const real = errors.filter(e => !e.includes('favicon'));
console.log('errors:', real.length, real.join(' | '));
await browser.close();
const ok = s0.state === 'menu' && bright > 0 && s1.state === 'playing' && real.length === 0;
console.log(ok ? 'LIVE VERIFIED' : 'LIVE FAILED');
process.exit(ok ? 0 : 1);
