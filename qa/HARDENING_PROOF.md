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

## Final polish verification — 2026-08-22

The final-polish build was rebuilt locally and served on port 8534 because
port 8533 was occupied by an unrelated worktree server. Every command below
targeted that fresh `dist/` output and exited 0.

| Command | Result |
| --- | --- |
| `npm run build` | PASS — fresh self-contained bundle. |
| `npm run test:e2e` | PASS — full menu, combat, shop, retry and persistence flow. |
| `npm run test:viewport` | PASS — all 10 official DPR=1 viewports plus 390x844 touch paths. |
| `npm run test:refresh` | PASS — 60/144/165 Hz deterministic outcomes and frame-count negative control. |
| `npm run test:telegraphs` | PASS — all specialist and boss warning contracts. |
| `npm run test:hazard` | PASS — warning and active-sector spawn fairness. |
| `npm run test:persistence` | PASS — malformed and partial save fallback/migration. |
| `npm run test:soak` | PASS — accelerated 120 s soak, bounds and pause/resume frame health. |
| `npm run test:polish` | PASS — queued late-wave cap, directional deflect marker, and left/right `touchcancel` regression checks; the queued-cap assertion is the mutation-style proof against legacy eviction. |

An additional accelerated 300 s mixed-roster run completed without browser
errors; its final entity/effect counts remained within the existing caps.

### Visual and media inspection

- Captured fresh menu, wave, combat and death states at 907x510, 1920x1080
  and 390x844; the retained visual evidence is the critically inspected combat
  trio: `qa/final-907-combat.png`, `qa/final-1920-combat.png`, and
  `qa/final-390-combat.png`. The canvas remained full viewport, the action
  stayed centered in portrait, and the returned green projectile has a visible
  arrow, streak and ring distinct from incoming circular fire.
- Regenerated `marketing/video-landscape.mp4` and
  `marketing/video-portrait.mp4` from the fresh build. Both are 19.0 seconds;
  their middle and end frames were inspected and show gameplay only.
- Tracked payload is 45 MB across 78 files (below the 50 MB / 1500-file
  limits). No raw recordings are retained.
