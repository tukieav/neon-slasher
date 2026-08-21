import { chromium } from 'playwright';

const URL = 'http://localhost:8533/?debug=1';
const VIEWPORTS = [[907,510],[1216,684],[1077,606],[821,462],[1366,768],[1920,1080],[1536,864],[1280,720],[800,450],[1080,607]];
let failures = 0;
function check(name, ok) { console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`); if (!ok) failures++; }

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
for (const [width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  const box = await page.locator('#game').boundingBox();
  check(`${width}x${height} DPR=1 canvas covers viewport`, box.width >= width * 0.98 && box.height >= height * 0.98);
  const { cam, play } = await page.evaluate(() => ({ cam: window.__astro.getCam(), play: window.__astro.getButtons().play }));
  await page.mouse.click(box.x + cam.ox + play.x * cam.scale, box.y + cam.oy + play.y * cam.scale);
  await page.waitForTimeout(180);
  check(`${width}x${height} physical PLAY path enters gameplay`, (await page.evaluate(() => window.__astro.getState().state)) === 'playing');
  check(`${width}x${height} has no page errors`, errors.length === 0);
  await page.close();
}

// Portrait is a touch sanity gate, not a replacement for the required DPR=1 matrix.
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await mobile.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
const box = await page.locator('#game').boundingBox();
const { cam, play } = await page.evaluate(() => ({ cam: window.__astro.getCam(), play: window.__astro.getButtons().play }));
await page.touchscreen.tap(box.x + cam.ox + play.x * cam.scale, box.y + cam.oy + play.y * cam.scale);
await page.waitForTimeout(180);
check('390x844 touch PLAY enters gameplay', (await page.evaluate(() => window.__astro.getState().state)) === 'playing');
const cdp = await page.context().newCDPSession(page);
const toScreen = (x, y) => ({ x: box.x + cam.ox + x * cam.scale, y: box.y + cam.oy + y * cam.scale });
const left0 = toScreen(180, 320), left1 = toScreen(235, 320), right0 = toScreen(720, 360), right1 = toScreen(820, 360);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...left0, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...left1, id: 1 }] });
await page.waitForTimeout(180);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const moved = await page.evaluate(() => window.__astro.getState().heroX > 490);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...right0, id: 2 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...right1, id: 2 }] });
await page.waitForTimeout(80);
check('390x844 touch joystick moves hero', moved);
check('390x844 touch swipe triggers dash', (await page.evaluate(() => window.__astro.getState().dashCd)) > 0);
await mobile.close();
await browser.close();
console.log(failures ? `${failures} viewport failures` : 'VIEWPORT GATE PASSED');
process.exit(failures ? 1 : 0);
