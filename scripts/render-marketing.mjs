// Render covers (16:9, 1:1, 2:3) + gameplay screenshots
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

const covers = [
  { w: 1920, h: 1080, sq: 0, out: 'cover-16x9.png' },
  { w: 1080, h: 1080, sq: 1, out: 'cover-1x1.png' },
  { w: 800, h: 1200, sq: 1, out: 'cover-2x3.png' },
];
for (const c of covers) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
  await page.goto('file://' + join(root, 'marketing/cover.html') + `?w=${c.w}&h=${c.h}&sq=${c.sq}`);
  await page.waitForFunction(() => document.title === 'ready');
  await page.locator('#cover').screenshot({ path: join(root, 'marketing', c.out) });
  await page.close();
  console.log(c.out, 'done');
}

// gameplay screenshots — play via debug hook, capture combo moments
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:8486/?debug=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const W = 960, H = 640;
const bbox = await page.locator('#game').boundingBox();
const gx = (x) => bbox.x + x * (bbox.width / W);
const gy = (y) => bbox.y + y * (bbox.height / H);
await page.mouse.click(gx(W/2), gy(H/2 + 90)); // PLAY
await page.waitForTimeout(1500);

async function slashNearest() {
  const st = await page.evaluate(() => window.__astro.getState());
  if (st.state !== 'playing' || !st.enemies.length) return st;
  let ne = null, nd = 1e9;
  for (const e of st.enemies) { const d = Math.hypot(e.dx, e.dy); if (d < nd) { nd = d; ne = e; } }
  const keys = [];
  if (nd > 70) {
    if (ne.dx > 20) keys.push('d'); if (ne.dx < -20) keys.push('a');
    if (ne.dy > 20) keys.push('s'); if (ne.dy < -20) keys.push('w');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(200);
    for (const k of keys) await page.keyboard.up(k);
  }
  const cx = Math.max(5, Math.min(W-5, st.heroX + ne.dx));
  const cy = Math.max(5, Math.min(H-5, st.heroY + ne.dy));
  await page.mouse.move(gx(cx), gy(cy));
  await page.mouse.click(gx(cx), gy(cy));
  await page.waitForTimeout(280);
  return page.evaluate(() => window.__astro.getState());
}

// play until combo >= 3, screenshot mid-action
let shot1 = false;
for (let i = 0; i < 80; i++) {
  const s = await slashNearest();
  if (s.state !== 'playing') break;
  if (!shot1 && s.combo >= 3) {
    await page.locator('#game').screenshot({ path: join(root, 'marketing/screenshot-combo.png') });
    console.log('screenshot-combo.png done (combo', s.combo + ')');
    shot1 = true;
  }
  if (shot1 && s.wave >= 2) {
    await page.waitForTimeout(300);
    await page.locator('#game').screenshot({ path: join(root, 'marketing/screenshot-wave2.png') });
    console.log('screenshot-wave2.png done (wave', s.wave + ')');
    break;
  }
}
await browser.close();
console.log('marketing assets done');
