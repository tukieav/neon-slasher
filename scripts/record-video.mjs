// Record current-spec previews. ffmpeg prepends the matching cover for 0.7s,
// then cuts directly to gameplay; raw menu/setup seconds are discarded.
import { chromium } from 'playwright';
const URL = process.env.GAME_URL || 'http://localhost:8533/?debug=1';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'landscape';
const size = mode === 'portrait' ? { width: 800, height: 1200 } : { width: 1920, height: 1080 };
const dir = join(root, 'marketing', 'rec-' + mode);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const W = 960, H = 640;
const bbox = await page.locator('#game').boundingBox();
const camInfo = await page.evaluate(() => window.__astro.getCam());
const gx = (x) => bbox.x + camInfo.ox + x * camInfo.scale;
const gy = (y) => bbox.y + camInfo.oy + y * camInfo.scale;
const getState = () => page.evaluate(() => window.__astro.getState());

// click PLAY (try several heights)
for (const yy of [H/2 + 90, H/2 + 80, H/2 + 100]) {
  await page.mouse.click(gx(W/2), gy(yy));
  await page.waitForTimeout(400);
  const s = await getState();
  if (s.state === 'playing') break;
}
let s = await getState();
if (s.state !== 'playing') { await page.evaluate(() => window.__astro.startGame()); await page.waitForTimeout(300); }
// Recording automation needs to demonstrate gameplay rather than a bot failure;
// this debug-only guard is not included in normal play.
await page.evaluate(() => window.__astro.setInvincible(25));

// bot: walk to enemies, slash toward them, dash away from kamikaze
const t0 = Date.now();
while (Date.now() - t0 < 19000) {
  s = await getState();
  if (s.state !== 'playing') break;
  if (!s.enemies.length) { await page.waitForTimeout(200); continue; }
  // nearest kamikaze threat?
  let kam = null, kd = 1e9, ne = null, nd = 1e9;
  for (const e of s.enemies) {
    const d = Math.hypot(e.dx, e.dy);
    if (e.type === 'kamikaze' && d < kd) { kd = d; kam = e; }
    if (d < nd) { nd = d; ne = e; }
  }
  if (kam && kd < 110 && s.dashCd <= 0) {
    // dash away from kamikaze
    const ax = -kam.dx, ay = -kam.dy;
    const keys = [];
    if (ax > 0) keys.push('d'); else keys.push('a');
    if (ay > 0) keys.push('s'); else keys.push('w');
    for (const k of keys) await page.keyboard.down(k);
    await page.keyboard.press('Space');
    await page.waitForTimeout(180);
    for (const k of keys) await page.keyboard.up(k);
    continue;
  }
  // crowded? dash away from center of mass of close enemies
  const close = s.enemies.filter(e => Math.hypot(e.dx, e.dy) < 85);
  if (close.length >= 3 && s.dashCd <= 0) {
    let mx2 = 0, my2 = 0;
    for (const e of close) { mx2 += e.dx; my2 += e.dy; }
    const keys = [];
    if (mx2 > 0) keys.push('a'); else keys.push('d');
    if (my2 > 0) keys.push('w'); else keys.push('s');
    for (const k of keys) await page.keyboard.down(k);
    await page.keyboard.press('Space');
    await page.waitForTimeout(180);
    for (const k of keys) await page.keyboard.up(k);
    continue;
  }
  // move toward nearest enemy, aim & slash
  const keys = [];
  if (nd > 65) {
    if (ne.dx > 20) keys.push('d'); if (ne.dx < -20) keys.push('a');
    if (ne.dy > 20) keys.push('s'); if (ne.dy < -20) keys.push('w');
  }
  for (const k of keys) await page.keyboard.down(k);
  const cx = Math.max(5, Math.min(W-5, s.heroX + ne.dx));
  const cy = Math.max(5, Math.min(H-5, s.heroY + ne.dy));
  await page.mouse.move(gx(cx), gy(cy));
  if (nd < 95) await page.mouse.click(gx(cx), gy(cy));
  await page.waitForTimeout(160);
  for (const k of keys) await page.keyboard.up(k);
}
const fin = await getState();
console.log('final state:', JSON.stringify({ state: fin.state, wave: fin.wave, score: fin.score, hp: fin.hp }));
await ctx.close();
await browser.close();
const webm = readdirSync(dir).find(f => f.endsWith('.webm'));
renameSync(join(dir, webm), join(root, 'marketing', 'raw-' + mode + '.webm'));
const raw = join(root, 'marketing', 'raw-' + mode + '.webm');
const cover = join(root, 'marketing', mode === 'portrait' ? 'cover-2x3.png' : 'cover-16x9.png');
const output = join(root, 'marketing', 'video-' + mode + '.mp4');
// 0.70s cover + 18.2s gameplay = 18.9s, with no menu, cursor, or audio.
execFileSync('ffmpeg', [
  '-y', '-loop', '1', '-framerate', '60', '-t', '0.7', '-i', cover,
  '-ss', '3.6', '-t', '18.2', '-i', raw,
  '-filter_complex', `[0:v]scale=${size.width}:${size.height},setsar=1[cover];[1:v]scale=${size.width}:${size.height},setsar=1[game];[cover][game]concat=n=2:v=1:a=0[v]`,
  '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '29', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
], { stdio: 'inherit' });
rmSync(raw);
rmSync(dir, { recursive: true, force: true });
console.log('saved ' + output + '; survived=' + (fin.state === 'playing'));
process.exit(fin.state === 'playing' ? 0 : 2);
