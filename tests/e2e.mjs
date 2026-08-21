// Neon Slasher — full functional test (Playwright + system Chrome)
import { chromium } from 'playwright';

const URL = 'http://localhost:8533/?debug=1';
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
const getMeta = () => page.evaluate(() => window.__astro.getMeta());
const bbox = await page.locator('#game').boundingBox();
const camInfo = await page.evaluate(() => window.__astro.getCam());
const gx = (x) => bbox.x + camInfo.ox + x * camInfo.scale;
const gy = (y) => bbox.y + camInfo.oy + y * camInfo.scale;
async function clickBtn(name) {
  const btns = await page.evaluate(() => window.__astro.getButtons());
  if (!btns[name]) return false;
  await page.mouse.click(gx(btns[name].x), gy(btns[name].y));
  return true;
}

// ---- boot & menu ----
let s = await getState();
check('boots to menu', s.state === 'menu');
check('daily streak initialized (day >= 1)', s.streak >= 1);

const bright = await page.evaluate(() => {
  const c = document.getElementById('game');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i+1] > 40 || d[i+2] > 40) n++;
  return n;
});
check('canvas renders pixels', bright > 0);

// ---- shop from menu ----
check('menu has UPGRADES button', await clickBtn('shop'));
await page.waitForTimeout(300);
s = await getState();
check('shop opens', s.state === 'shop');
// give cores via debug, buy first upgrade
const cores0 = (await getMeta()).cores;
await page.evaluate(() => window.__astro.addCores(500));
await page.waitForTimeout(200);
await clickBtn('up_hp');
await page.waitForTimeout(200);
let m = await getMeta();
check('buy HP upgrade → level 1, cores deducted', m.upgrades.hp === 1 && m.cores === cores0 + 500 - 40);
// katana tab: buy & equip katana 1
await clickBtn('tab1');
await page.waitForTimeout(200);
await clickBtn('kat_1');
await page.waitForTimeout(200);
m = await getMeta();
check('buy & equip katana PLASMA GOLD', m.katanasOwned[1] === true && m.katana === 1);
// perks tab: buy tank
await clickBtn('tab2');
await page.waitForTimeout(200);
await clickBtn('perk_tank');
await page.waitForTimeout(200);
m = await getMeta();
check('buy & select TANK perk', m.perksOwned.tank === true && m.perk === 'tank');
// persistence in localStorage
const metaStored = await page.evaluate(() => JSON.parse(localStorage.getItem('neonslasher.meta') || '{}'));
check('meta persisted to localStorage', metaStored.upgrades && metaStored.upgrades.hp === 1);
// back to menu
await clickBtn('back');
await page.waitForTimeout(200);
s = await getState();
check('back to menu from shop', s.state === 'menu');

// ---- start game: hp upgrade + tank perk → 5 hearts ----
await clickBtn('play');
await page.waitForTimeout(800);
s = await getState();
check('PLAY starts game (wave 1)', s.state === 'playing' && s.wave === 1);
check('hp upgrade + tank perk → hpMax 5', s.hpMax === 5 && s.hp === 5);

// WASD movement
const x0 = s.heroX, y0 = s.heroY;
await page.keyboard.down('d');
await page.waitForTimeout(500);
await page.keyboard.up('d');
s = await getState();
check('WASD moves hero (D → right)', s.heroX > x0 + 20);
await page.keyboard.down('w');
await page.waitForTimeout(400);
await page.keyboard.up('w');
s = await getState();
check('W moves hero up', s.heroY < y0 + 5);

// dash
await page.keyboard.down('a');
await page.keyboard.press('Space');
await page.waitForTimeout(250);
await page.keyboard.up('a');
s = await getState();
check('dash sets cooldown', s.dashCd > 0.5);

// ---- combat: slash nearest until score rises ----
async function slashNearest() {
  const st = await getState();
  if (st.state !== 'playing' || st.enemies.length === 0) return st;
  let ne = null, nd = 1e9;
  for (const e of st.enemies) {
    const d = Math.hypot(e.dx, e.dy);
    if (d < nd) { nd = d; ne = e; }
  }
  const tx = st.heroX + ne.dx, ty = st.heroY + ne.dy;
  const keys = [];
  if (nd > 70) {
    if (ne.dx > 20) keys.push('d'); if (ne.dx < -20) keys.push('a');
    if (ne.dy > 20) keys.push('s'); if (ne.dy < -20) keys.push('w');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(220);
    for (const k of keys) await page.keyboard.up(k);
  }
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

// cores drop & collection (kills drop cores → runCores or coreDrops > 0)
let coresSeen = false;
for (let i = 0; i < 30; i++) {
  s = await getState();
  if (s.state !== 'playing') break;
  if (s.runCores > 0 || s.coreDrops > 0) { coresSeen = true; break; }
  await slashNearest();
}
check('kills drop collectible cores', coresSeen);

// clear wave 1 → wave 2
let wave2 = false;
for (let i = 0; i < 150; i++) {
  s = await getState();
  if (s.state !== 'playing') break;
  if (s.wave >= 2) { wave2 = true; break; }
  await slashNearest();
}
check('wave 1 cleared → wave 2 starts', wave2);
check('bestWave record tracked', (await getState()).bestWave >= 2);

// ---- combo fever via debug ----
await page.evaluate(() => { window.__astro.setCombo(9); window.__astro.spawn('melee'); });
let feverOn = false;
for (let i = 0; i < 40; i++) {
  s = await slashNearest();
  if (s.state !== 'playing') break;
  if (s.fever > 0) { feverOn = true; break; }
  if (s.enemies.length === 0) await page.evaluate(() => window.__astro.spawn('melee'));
}
check('combo x10 triggers COMBO FEVER', feverOn);

// ---- new enemy types spawn & are killable ----
await page.evaluate(() => { window.__astro.spawn('shield'); window.__astro.spawn('splitter'); });
await page.waitForTimeout(900);
s = await getState();
check('shield + splitter spawn', s.enemies.some(e => e.type === 'shield') && s.enemies.some(e => e.type === 'splitter'));
// twin boss wave 10
await page.evaluate(() => window.__astro.setWave(10));
await page.waitForTimeout(2500);
s = await getState();
check('wave 10 spawns TWIN CORE bosses', s.enemies.some(e => e.type === 'twin'));

// ---- game over: cores banked ----
const preOver = await getState();
await page.evaluate(() => window.__astro.addRunCores(7));
const metaCoresPre = (await getMeta()).cores;
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(500);
s = await getState();
check('forceGameOver → gameover state', s.state === 'gameover');
m = await getMeta();
check('run cores banked into meta on death', m.cores >= metaCoresPre + 7);

// ---- rewarded SECOND WIND ----
await clickBtn('secondWind');
await page.waitForTimeout(1000);
let revived = false;
for (let i = 0; i < 50; i++) {
  s = await getState();
  if (s.state === 'playing' && s.hp === s.hpMax) { revived = true; break; }
  await page.waitForTimeout(500);
}
check('rewarded SECOND WIND revives with full hp', revived);
if (revived) {
  s = await getState();
  check('secondWindUsed flagged', s.secondWindUsed === true);
}

// ---- game over again, PLAY AGAIN ----
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(400);
await clickBtn('playAgain');
let restarted = false;
for (let i = 0; i < 50; i++) {
  s = await getState();
  if (s.state === 'playing' && s.wave === 1 && s.score === 0) { restarted = true; break; }
  await page.waitForTimeout(500);
}
check('PLAY AGAIN restarts run', restarted);

// best score persisted
const bestStored = await page.evaluate(() => parseInt(localStorage.getItem('neonslasher.best') || '0', 10));
check('best score persisted in localStorage', bestStored > 0);

// ---- meta survives reload ----
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
m = await getMeta();
check('meta survives page reload (hp upgrade kept)', m.upgrades.hp === 1 && m.katana === 1 && m.perk === 'tank');

// no console errors
const realErrors = errors.filter(e => !e.includes('favicon') && !e.includes('ERR_BLOCKED_BY_CLIENT'));
check('zero console/page errors', realErrors.length === 0);
if (realErrors.length) console.log(realErrors.join('\n'));

await browser.close();
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
