# Neon Slasher

Arena katana slasher for CrazyGames — a lone neon warrior vs endless waves of
rogue robots. Zero blood: enemies burst into glowing particles and springs.

**Play:** https://tukieav.github.io/neon-slasher/

## Features
- 120° katana slash, bullet deflection, dash with i-frames
- Combo multiplier + bullet-time slow-mo on triple kills
- Waves with chasers / shooters / kamikaze bots, mini-boss every 5 waves
- Full CrazyGames SDK v3 integration (ads, data, mute, happytime)
- Procedural everything: Canvas 2D graphics + WebAudio sounds, ~21 KB bundle
- Mouse+keyboard and touch (virtual joystick, tap slash, swipe dash)

## Dev
```bash
npm install
npm run dev    # esbuild watch + server
npm run build  # dist/ self-contained bundle
node tests/e2e.mjs           # Playwright e2e (server on :8486 required)
node scripts/render-marketing.mjs  # covers + screenshots
node scripts/record-video.mjs landscape|portrait  # preview videos
```

## Controls
WASD move · mouse aim · click slash · space/RMB dash.
Mobile: left joystick · tap right = slash · swipe right = dash.
