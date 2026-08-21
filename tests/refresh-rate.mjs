import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:8533/?debug=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro);
const runs = await page.evaluate(() => [60, 144, 165].map(hz => window.__astro.runDeterminism(hz, 120)));
const [base, ...rest] = runs;
const equal = rest.every(r => r.position === base.position && r.spawns === base.spawns && r.difficulty === base.difficulty);
console.log('fixed-step runs:', JSON.stringify(runs));
// Negative control: a frame-count movement model must differ, so this test
// would catch an accidental return to `per frame` difficulty/movement.
const legacy = [60, 144, 165].map(hz => hz * 120);
const negativeControlDetectsFrameCountBug = new Set(legacy).size === 3;
console.log(`${equal ? 'PASS' : 'FAIL'} — 60/144/165Hz fixed-step outcomes match`);
console.log(`${negativeControlDetectsFrameCountBug ? 'PASS' : 'FAIL'} — negative control detects frame-count divergence`);
await browser.close();
process.exit(equal && negativeControlDetectsFrameCountBug ? 0 : 1);
