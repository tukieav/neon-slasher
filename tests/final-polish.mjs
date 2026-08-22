// Focused post-hardening regression contracts for the final polish fixes.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';
const errors = [];
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
  if (!ok) failures++;
};
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

async function boot() {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
}

await boot();
// A valid all-melee late-wave roll reaches the actor cap. The regression is
// that remaining queued threats must wait, never evict a live predecessor.
await page.evaluate(() => {
  window.__astro.testStart();
  window.__astro.setInvincible(30);
  Math.random = () => 0.99;
  window.__astro.setWave(31);
});
await page.waitForTimeout(18000);
let state = await page.evaluate(() => window.__astro.getState());
check('late-wave cap keeps queued threats instead of evicting live enemies', state.enemies.length === 48 && state.queuedSpawns > 0);
const queuedAtCap = state.queuedSpawns;
await page.evaluate(() => window.__astro.removeOneEnemyForTest());
await page.waitForTimeout(450);
state = await page.evaluate(() => window.__astro.getState());
check('a freed actor slot releases exactly one pending threat', state.enemies.length === 48 && state.queuedSpawns === queuedAtCap - 1);
// Mutation-style negative proof: the legacy unconditional queue drain would
// make queuedSpawns reach zero and this assertion fail while silently evicting.
check('legacy eviction mutation is detected by pending-queue assertion', queuedAtCap > 0);

await boot();
const box = await page.locator('#game').boundingBox();
const cam = await page.evaluate(() => window.__astro.getCam());
const gx = x => box.x + cam.ox + x * cam.scale;
const gy = y => box.y + cam.oy + y * cam.scale;
await page.evaluate(() => { window.__astro.testStart(); window.__astro.spawnIncomingBulletForTest(); });
await page.mouse.click(gx(700), gy(320));
await page.waitForTimeout(100);
state = await page.evaluate(() => window.__astro.getState());
check('deflection changes projectile ownership', state.friendlyBullets === 1);
check('deflected projectile renders an ownership-and-direction marker', state.renderedDeflectMarkers === 1);

await boot();
await page.evaluate(() => {
  window.__astro.testStart();
  const canvas = document.getElementById('game');
  const touch = (type, identifier, x, y) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'changedTouches', { value: [{ identifier, clientX: x, clientY: y }] });
    canvas.dispatchEvent(event);
  };
  touch('touchstart', 7, 90, 340);
  touch('touchmove', 7, 150, 340);
});
await page.waitForTimeout(120);
const moving = await page.evaluate(() => window.__astro.getState());
await page.evaluate(() => {
  const canvas = document.getElementById('game');
  const event = new Event('touchcancel', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 7, clientX: 150, clientY: 340 }] });
  canvas.dispatchEvent(event);
});
await page.waitForTimeout(180);
const cancelled = await page.evaluate(() => window.__astro.getState());
await page.waitForTimeout(180);
const settled = await page.evaluate(() => window.__astro.getState());
check('touchcancel clears a moving virtual joystick', moving.heroX > 480 && !cancelled.input.joyActive && cancelled.input.joyDx === 0 && settled.heroX === cancelled.heroX);
await page.evaluate(() => {
  const canvas = document.getElementById('game');
  const send = type => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 8, clientX: 700, clientY: 340 }] });
    canvas.dispatchEvent(event);
  };
  send('touchstart'); send('touchcancel');
});
state = await page.evaluate(() => window.__astro.getState());
check('touchcancel releases the right-side attack slot', !state.input.rightActive);

check('focused polish run has no browser errors', errors.length === 0);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
