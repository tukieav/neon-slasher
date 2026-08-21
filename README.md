# Neon Slasher

Arena katana slasher for CrazyGames — a lone neon warrior vs endless waves of
rogue robots. Zero blood: enemies burst into glowing particles and springs.

**Play:** https://tukieav.github.io/neon-slasher/

## Features
- 120° katana slash, bullet deflection, dash with i-frames
- Combo Fever meter/decay, deflect chain extensions, and clear chain-break feedback
- Fair, distinct telegraphs for melee, shooter, kamikaze, splitter, and boss attacks
- Electrified arena sector from wave 4 onward: visible warning, safe enemy spawns, dash positioning
- Fixed-step simulation and lifecycle pause/resume; bounded effects for long sessions
- Full CrazyGames SDK v3 integration (ads, data, mute, happytime)
- Procedural everything: Canvas 2D graphics + WebAudio sounds, ~21 KB bundle
- Mouse+keyboard and touch (virtual joystick, tap slash, swipe dash)

## Dev
```bash
npm install
npm run dev    # esbuild watch + server
npm run build  # dist/ self-contained bundle
node tests/e2e.mjs           # Playwright e2e (server on :8533 required)
node tests/viewport-gate.mjs # required DPR=1 viewport + touch gate
node tests/refresh-rate.mjs  # 60/144/165Hz deterministic gate
node tools/e2e-soak.cjs      # 120s accelerated soak + lifecycle/FPS bounds
node scripts/render-marketing.mjs  # covers + screenshots
node scripts/record-video.mjs landscape|portrait  # preview videos
```

## Controls
WASD move · mouse aim · click slash · space/RMB dash.
Mobile: left joystick · tap right = slash · swipe right = dash.
