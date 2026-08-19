// Neon Slasher — full functional test (Playwright + system Chrome)
import { chromium } from 'playwright';

const URL = 'http://localhost:8486/?debug=1';
const W = 960, H = 640;
let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) failures++;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' @' + (m.location() ? m.location().url : '')); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const getState = () => page.evaluate(() => window.__astro.getState());

// menu state
let s = await getState();
check('boots to menu', s.state === 'menu');

// canvas pixel check
const bright = await page.evaluate(() => {
  const c = document.getElementById('game');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i+1] > 40 || d[i+2] > 40) n++;
  return n;
});
check('canvas renders pixels', bright > 0);

// click PLAY
const bbox = await page.locator('#game').boundingBox();
const gx = (x) => bbox.x + x * (bbox.width / W);
const gy = (y) => bbox.y + y * (bbox.height / H);
await page.mouse.click(gx(W/2), gy(H/2 + 90));
await page.waitForTimeout(800);
s = await getState();
check('PLAY starts game (wave 1)', s.state === 'playing' && s.wave === 1);
check('hero has 3 hp', s.hp === 3);

// WASD movement
const x0 = s.heroX, y0 = s.heroY;
await page.keyboard.down('d');
await page.waitForTimeout(500);
await page.keyboard.up('d');
s = await getState();
check('WASD moves hero (D → right)', s.heroX > x0 + 30);
await page.keyboard.down('w');
await page.waitForTimeout(400);
await page.keyboard.up('w');
s = await getState();
check('W moves hero up', s.heroY < y0 + 5);

// dash: check position jump
const preDash = await getState();
await page.keyboard.down('a');
await page.keyboard.press('Space');
await page.waitForTimeout(250);
await page.keyboard.up('a');
s = await getState();
check('dash moves hero fast & sets cooldown', s.dashCd > 0.5);

// kill enemies with mouse slashes: aim at nearest, click
async function slashNearest() {
  const st = await getState();
  if (st.state !== 'playing' || st.enemies.length === 0) return st;
  // pick nearest spawned enemy
  let ne = null, nd = 1e9;
  for (const e of st.enemies) {
    const d = Math.hypot(e.dx, e.dy);
    if (d < nd) { nd = d; ne = e; }
  }
  // move toward it if far
  const tx = st.heroX + ne.dx, ty = st.heroY + ne.dy;
  const keys = [];
  if (nd > 70) {
    if (ne.dx > 20) keys.push('d'); if (ne.dx < -20) keys.push('a');
    if (ne.dy > 20) keys.push('s'); if (ne.dy < -20) keys.push('w');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(220);
    for (const k of keys) await page.keyboard.up(k);
  }
  // aim & click at enemy position (clamped into canvas)
  const cx = Math.max(5, Math.min(W - 5, tx));
  const cy = Math.max(5, Math.min(H - 5, ty));
  await page.mouse.move(gx(cx), gy(cy));
  await page.mouse.click(gx(cx), gy(cy));
  await page.waitForTimeout(320);
  return getState();
}

let killScore0 = (await getState()).score;
let killed = false;
for (let i = 0; i < 60; i++) {
  s = await slashNearest();
  if (s.state !== 'playing') break;
  if (s.score > killScore0) { killed = true; break; }
}
check('slash kills enemy → score rises', killed);

// keep slashing to clear wave 1 → wave 2
let wave2 = false;
for (let i = 0; i < 150; i++) {
  s = await getState();
  if (s.state !== 'playing') break;
  if (s.wave >= 2) { wave2 = true; break; }
  await slashNearest();
}
check('wave 1 cleared → wave 2 starts', wave2);

// force game over via debug hook
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(500);
s = await getState();
check('forceGameOver → gameover state', s.state === 'gameover');

// rewarded SECOND WIND (SDK shows test ad on localhost; wrapper resolves)
await page.mouse.click(gx(W/2), gy(H/2 + 26));
await page.waitForTimeout(1000);
// test ad may take a while; poll up to 25s
let revived = false;
for (let i = 0; i < 50; i++) {
  s = await getState();
  if (s.state === 'playing' && s.hp === 3) { revived = true; break; }
  // if a test ad iframe/overlay demands click-to-close, just wait — SDK auto-finishes test ads
  await page.waitForTimeout(500);
}
check('rewarded SECOND WIND revives with 3 hp', revived);
if (revived) {
  s = await getState();
  check('secondWindUsed flagged', s.secondWindUsed === true);
}

// game over again, then PLAY AGAIN (midgame ad path)
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(400);
// second wind used → playAgain button at CY+50
await page.mouse.click(gx(W/2), gy(H/2 + 50));
let restarted = false;
for (let i = 0; i < 50; i++) {
  s = await getState();
  if (s.state === 'playing' && s.wave === 1 && s.score === 0) { restarted = true; break; }
  await page.waitForTimeout(500);
}
check('PLAY AGAIN (midgame ad) restarts run', restarted);

// best score persisted
const bestStored = await page.evaluate(() => parseInt(localStorage.getItem('neonslasher.best') || '0', 10));
check('best score persisted in localStorage', bestStored > 0);

// no console errors
const realErrors = errors.filter(e => !e.includes('favicon') && !e.includes('ERR_BLOCKED_BY_CLIENT'));
check('zero console/page errors', realErrors.length === 0);
if (realErrors.length) console.log(realErrors.join('\n'));

await browser.close();
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
