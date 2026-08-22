// Round 3 control/onboarding contract: physical key codes must work on AZERTY.
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`); if (!ok) failures++; };
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => window.__astro.startGame());
await page.waitForTimeout(100);
check('first run shows the visual control onboarding', (await page.evaluate(() => window.__astro.getState().onboardingVisible)) === true);
const before = await page.evaluate(() => window.__astro.getState());
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'z', bubbles: true, cancelable: true })));
await page.waitForTimeout(240);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'z', bubbles: true, cancelable: true })));
const after = await page.evaluate(() => window.__astro.getState());
check("KeyW moves even when KeyboardEvent.key is AZERTY 'z'", after.heroY < before.heroY - 10);
check('first successful input dismisses onboarding', after.onboardingVisible === false);
check('onboarding completion persists in the save', (await page.evaluate(() => window.__astro.getMeta().onboardingSeen)) === true);
await browser.close();
process.exit(failures ? 1 : 0);
