// Required Round 4 proof captures: both first impressions at 907x510.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.GAME_URL || 'http://127.0.0.1:8541/?debug=1';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const cover = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
await cover.goto('file://' + join(root, 'marketing/cover.html') + '?w=907&h=510');
await cover.waitForFunction(() => document.title === 'ready');
await cover.locator('#cover').screenshot({ path: join(root, 'qa/round4-cover-907x510.png') });
const menu = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
const errors = [];
menu.on('pageerror', error => errors.push(error.message));
menu.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await menu.goto(URL, { waitUntil: 'networkidle' });
await menu.waitForFunction(() => window.__astro?.getState().state === 'menu');
await menu.waitForTimeout(1000);
await menu.screenshot({ path: join(root, 'qa/round4-menu-907x510.png') });
await browser.close();
if (errors.length) throw new Error(errors.join(' | '));
console.log('round4-cover-907x510.png and round4-menu-907x510.png captured');
