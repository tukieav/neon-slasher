import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:8533/?debug=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => localStorage.setItem('neonslasher.meta', '{bad json'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
const malformedSafe = await page.evaluate(() => {
  const m = window.__astro.getMeta();
  return m.cores >= 0 && m.upgrades.hp === 0 && m.katanasOwned.length === 4;
});
const oldContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const oldPage = await oldContext.newPage();
await oldPage.addInitScript(() => localStorage.setItem('neonslasher.meta', JSON.stringify({ cores: 25, upgrades: { hp: 1 }, katanasOwned: [true], perk: 'unknown' })));
await oldPage.goto('http://localhost:8533/?debug=1', { waitUntil: 'networkidle' });
await oldPage.waitForFunction(() => window.__astro?.getState().state === 'menu');
const oldResult = await oldPage.evaluate(() => {
  const m = window.__astro.getMeta();
  return { ok: m.cores >= 25 && m.upgrades.hp === 1 && m.katanasOwned.length === 4 && m.perk === 'none', m };
});
const oldSaveMigrates = oldResult.ok;
console.log(`${malformedSafe ? 'PASS' : 'FAIL'} — malformed save safely falls back`);
console.log(`${oldSaveMigrates ? 'PASS' : 'FAIL'} — old partial save migrates to valid defaults`);
if (!oldSaveMigrates) console.log('migration result:', JSON.stringify(oldResult.m));
console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'} — persistence reload has no errors`);
await oldContext.close();
await browser.close();
process.exit(malformedSafe && oldSaveMigrates && errors.length === 0 ? 0 : 1);
