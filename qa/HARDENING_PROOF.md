# Neon Slasher hardening proof

Final verification date: 2026-08-21

## Automated gates

All commands below exited 0 against the final `dist/` build served locally on
port 8533.

| Command | Result |
| --- | --- |
| `npm run build` | PASS — self-contained `dist/index.html` and `dist/bundle.js` created. |
| `npm run test:e2e` | PASS — 30 functional assertions, including menu, shop, combat, game-over/retry and reload persistence. |
| `npm run test:viewport` | PASS — all 10 required DPR=1 viewports have >=98% canvas coverage, visible physical PLAY path, and no browser errors; 390x844 touch play/joystick/swipe-dash also passed. |
| `npm run test:refresh` | PASS — 120 simulated seconds produce identical position, spawns, and difficulty at 60, 144, and 165Hz; a legacy frame-count negative control diverges. |
| `npm run test:telegraphs` | PASS — measured melee windup, shooter charge, kamikaze countdown, splitter pulse, and boss phase warning all occur before their attacks. |
| `npm run test:hazard` | PASS — wave 4 creates a warning period and active-hazard default spawns are outside its dangerous sector. |
| `npm run test:persistence` | PASS — malformed saves fall back; older partial saves migrate to safe defaults without losing valid fields. |
| `npm run test:soak` | PASS — 120-second accelerated mixed run keeps every actor/effect array within caps, pauses fixed updates during lifecycle pause, resumes one existing loop, reports >=100 frames over five real seconds, and emits no browser errors. |

## Visual and media proof

- Final menu and gameplay frames were captured and critically inspected at
  907x510, 1280x720, 1920x1080, and 390x844. The canvas fills the viewport;
  buttons/text remain visible; landscape HUD is legible and portrait retains a
  centered playable arena without clipping.
- `marketing/screenshot-combo.png` and `marketing/screenshot-wave2.png` were
  regenerated from the final build.
- `marketing/video-landscape.mp4` and `marketing/video-portrait.mp4` were
  regenerated, trimmed to 18.2 seconds each, and inspected at middle and end.
  All inspected frames show gameplay only: no menu, game-over, or ad.
- `neon-slasher.zip` was rebuilt from final `dist/index.html` and
  `dist/bundle.js` (ignored distributable artifact, 21.4 KB).

## Final package limits

- Largest tracked deliverable: `marketing/video-landscape.mp4`, 4.6 MB.
- Both videos plus all generated assets keep the initial payload below 50 MB;
  no raw recordings or temporary capture directories remain.
