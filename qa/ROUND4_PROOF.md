# Round 4 proof — Neon Slasher

Verified on 2026-08-22 from this worktree's freshly built `dist/`, served only
on `http://127.0.0.1:8541/?debug=1`.

## Cover brightness gate

The pre-change tracked covers were measured from `HEAD~1`; that expected
baseline run exited `1` because all covers violated the hard brightness gate.
The current assets passed with exit `0`.

| Cover | Before meanLum | Before darkFrac | Before meanSat | After meanLum | After darkFrac | After meanSat | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `cover-16x9.png` | 26.98 | 0.8778 | 0.7054 | 163.40 | 0.0000 | 0.4526 | PASS |
| `cover-1x1.png` | 30.85 | 0.8449 | 0.6943 | 155.86 | 0.0000 | 0.4885 | PASS |
| `cover-2x3.png` | 23.84 | 0.8966 | 0.7146 | 155.91 | 0.0000 | 0.4584 | PASS |

Gate limits: `meanLum >= 80`, `darkFrac <= 0.35`, and `meanSat >= 0.35`.

## Full gate suite

All of the following commands exited `0` against that isolated server:

| Command | Result |
| --- | --- |
| `npm run build` | PASS — fresh `dist/` bundle. |
| `npm run test:cover-brightness` | PASS — all three current cover assets. |
| `npm run test:compliance` | PASS — onboarding and AZERTY physical-key contract. |
| `npm run test:e2e` | PASS — menu, combat, progression, retry, persistence, and no browser errors. |
| `npm run test:viewport` | PASS — 10 desktop viewports plus 390x844 touch controls. |
| `npm run test:refresh` | PASS — matching 60/144/165 Hz fixed-step outcomes. |
| `npm run test:telegraphs` | PASS — all enemy-warning contracts. |
| `npm run test:hazard` | PASS — warned floor sector and spawn safety. |
| `npm run test:persistence` | PASS — malformed and partial-save recovery. |
| `npm run test:soak` | PASS — 120-second accelerated bounds, lifecycle, frame health, and no browser errors. |
| `npm run test:polish` | PASS — bounded actors, deflect readability, and touch-cancel regressions. |

## Media and first-impression evidence

`scripts/record-video.mjs` rebuilt both videos after the menu refresh. Its
first `0.70 s` is the matching new cover before gameplay; raw setup/menu
footage is trimmed, and encoding uses `-an`.

| File | ffprobe video | Duration | Result |
| --- | --- | ---: | --- |
| `marketing/video-landscape.mp4` | 1920x1080, video only | 18.853333 s | PASS — 16:9, silent, 15-20 s. |
| `marketing/video-portrait.mp4` | 800x1200, video only | 18.853333 s | PASS — 2:3, silent, 15-20 s. |

Required 907x510 screenshots:

- `qa/round4-cover-907x510.png`
- `qa/round4-menu-907x510.png`

No `raw-*.webm` or `rec-*` capture directories remain.
