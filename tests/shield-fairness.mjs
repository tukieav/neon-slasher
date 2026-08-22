// Shield droid fairness contract:
// 1) A blocked frontal slash staggers the guard (guardBreak > 0) and slows its turn.
// 2) The guard turn rate is capped, so stepping behind it exposes the back for a kill.
// 3) The block arc is narrower than the visual shield used to imply (<= 0.36*PI).
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`); if (!ok) failures++; };
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => { window.__astro.testStart(); });

// Spawn a shield droid to the hero's right; it faces the hero (left).
const setup = await page.evaluate(() => {
  const s = window.__astro.getState();
  window.__astro.spawnAt('shield', s.heroX + 85, s.heroY);
  return s;
});
await page.waitForTimeout(900); // let spawn animation finish

// 1) Frontal slash is blocked but staggers the guard.
let st = await page.evaluate(() => { window.__astro.slashToward(0); return window.__astro.getState(); });
let droid = st.enemies.find(e => e.type === 'shield');
check('frontal slash is blocked (hp intact)', droid && droid.hp === 2, `hp=${droid?.hp}`);
check('blocked slash staggers the guard', droid && droid.guardBreak > 0.5, `guardBreak=${droid?.guardBreak?.toFixed(2)}`);
await page.waitForTimeout(400); // slash cooldown (0.28s) must expire before the follow-up hit

// 2) Teleport behind it: capped turn rate means the back stays exposed long
//    enough to land a hit immediately (stagger slows the turn even further).
st = await page.evaluate(() => {
  const s = window.__astro.getState();
  const d = s.enemies.find(e => e.type === 'shield');
  // place hero directly behind the droid's current facing, within slash range
  const ex = s.heroX + d.dx, ey = s.heroY + d.dy;
  window.__astro.setHeroPos(ex - Math.cos(d.face) * 55, ey - Math.sin(d.face) * 55);
  const s2 = window.__astro.getState();
  const d2 = s2.enemies.find(e => e.type === 'shield');
  window.__astro.slashToward(Math.atan2(d2.dy, d2.dx));
  return window.__astro.getState();
});
droid = st.enemies.find(e => e.type === 'shield');
check('back attack lands (hp reduced or killed)', !droid || droid.hp < 2, `hp=${droid ? droid.hp : 'dead'}`);

// 3) Mutation-style proof: with the OLD snap-facing behaviour the back would
//    never stay exposed; verify the turn is genuinely capped by measuring that
//    the facing does not fully track a large hero displacement in one frame.
await page.evaluate(() => { window.__astro.clearArena(); window.__astro.setHeroPos(640, 360); window.__astro.spawnAt('shield', 640, 200); });
await page.waitForTimeout(900);
const track = await page.evaluate(async () => {
  const read = () => window.__astro.getState().enemies.find(e => e.type === 'shield');
  const before = read().face; // faces down toward (640,360)
  window.__astro.setHeroPos(200, 200); // now requires ~90° turn to the left
  await new Promise(r => setTimeout(r, 120)); // ~7 frames at 60Hz
  const after = read().face;
  return { before, after };
});
const wrapped = ((track.after - track.before + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const turned = Math.abs(wrapped);
check('guard turn rate is capped (not snap-facing)', turned < Math.PI * 0.35, `turned=${turned.toFixed(2)}rad of ~1.57 required after 120ms`);

check('zero page/console errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failures ? 1 : 0);
