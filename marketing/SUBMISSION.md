# Neon Slasher — CrazyGames Submission Kit

Use this current, implementation-backed copy in the CrazyGames form.

## Game name

Neon Slasher

## Primary category and discovery paths

- Primary category: **Action** (`/c/action`)
- Secondary discovery paths: **Survival**, **Horde Survival**

## Verified tags

Survival, Horde Survival, Destroy, Robot, Mobile, 2D, Fighting

## Short description (149 characters)

Dash through a cyber arena, carve apart specialized robots, deflect bullets, and keep a deadly combo alive.

## Full description

Cut through teleported robot waves in a compact neon arena where every slash,
dash, and deflected shot buys a little more space. Build a kill chain to trigger
Combo Fever, then decide whether to chase Cores or reset your position before
the next threat arrives.

The core loop is move, aim, slash, dash, and survive escalating waves. Each
robot communicates its danger before it acts: melee bots wind up, shooters draw
charge lines, kamikaze bots count down, splitters pulse before speeding up, and
bosses announce their charge. Shield units reward flanking, reflected bullets
become player shots, and from wave four a warned electrified floor sector adds a
clear positioning problem without spawning enemies inside it.

Cores bank between runs for health, dash, slash-range, and magnet upgrades,
plus katana styles and selectable perks. Bosses arrive every five waves, with
Twin Core fights at wave ten. A typical run lasts a few minutes, with quick
retries for another attempt at a higher wave or score.

## Controls

- Desktop: WASD / ZQSD (AZERTY) or arrow keys to move; mouse to aim; left
  click to slash; Space, Shift, or right click to dash.
- Mobile: left-thumb joystick to move; tap the right side to slash; swipe the
  right side to dash.

## SDK, data, and ads

- CrazyGames SDK v3 initializes with a timeout fallback; loading calls happen
  after initialization.
- Gameplay start/stop is bounded to active gameplay and lifecycle transitions.
  Visibility, blur, focus, and ad lifecycle pause simulation/input/audio and
  resume the existing loop once.
- CrazyGames mute settings are respected. Audio is procedural WebAudio.
- Persistent Cores, upgrades, katanas, perks, scores, and wave records use the
  Data Module with localStorage fallback. Malformed and older partial saves
  safely fall back/migrate.
- Rewarded ads are optional for Second Wind and doubled Cores. Retry begins
  locally and immediately; no ad is mandatory to restart.
- `happytime()` is locally throttled and used for meaningful milestones.

## Audience, URL, and resubmission note

- PEGI 12 suitable: robot opponents, neon sparks, no blood/gore, no chat or
  user-generated content.
- Supports mobile devices; no online multiplayer.
- Live URL: https://tukieav.github.io/neon-slasher/
- Quality resubmission: hardened for the full required DPR=1 viewport matrix,
  fixed-step 60/144/165Hz simulation, lifecycle pause/resume, bounded long-run
  effects, specialist telegraphs, and a wave-linked arena hazard.

## Upload assets

- Build: `dist/index.html` and `dist/bundle.js`, or `neon-slasher.zip`
- Covers: `marketing/cover-16x9.png`, `marketing/cover-1x1.png`,
  `marketing/cover-2x3.png`
- Screenshots: `marketing/screenshot-combo.png`, `marketing/screenshot-wave2.png`
- Videos: `marketing/video-landscape.mp4` (1920x1080),
  `marketing/video-portrait.mp4` (800x1200)
