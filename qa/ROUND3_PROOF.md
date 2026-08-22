# Round 3 proof — Neon Slasher

Verified on 2026-08-22 from this worktree's freshly built `dist/`, served only
on `http://127.0.0.1:8541/?debug=1`.

## Full gate suite

Every command below exited `0` against that isolated server.

| Command | Result |
| --- | --- |
| `npm run build` | PASS — fresh self-contained `dist/` bundle. |
| `npm run test:compliance` | PASS — visual first-run onboarding plus `code: KeyW` / `key: z` AZERTY regression. |
| `npm run test:e2e` | PASS — menu, run, combat, progression, retry, and persistence. |
| `npm run test:viewport` | PASS — 10 DPR=1 viewports plus 390x844 touch play, joystick, and dash. |
| `npm run test:refresh` | PASS — matching 60/144/165 Hz fixed-step outcomes and negative control. |
| `npm run test:telegraphs` | PASS — melee, shooter, kamikaze, splitter, and boss warnings. |
| `npm run test:hazard` | PASS — warned floor sector and spawn fairness. |
| `npm run test:persistence` | PASS — malformed and partial-save recovery. |
| `npm run test:soak` | PASS — 120 s accelerated bounds, pause/resume, and frame-health check. |
| `npm run test:polish` | PASS — actor-cap, deflect readability, and touch-cancel regressions. |

## Media measurement

`ffprobe` reports one video stream and no audio stream in each MP4. PNG
durations are not applicable.

| File | Dimensions | Ratio | Duration | Result |
| --- | ---: | ---: | ---: | --- |
| `marketing/cover-16x9.png` | 1920x1080 | 16:9 | — | PASS |
| `marketing/cover-1x1.png` | 800x800 | 1:1 | — | PASS |
| `marketing/cover-2x3.png` | 800x1200 | 2:3 | — | PASS |
| `marketing/video-landscape.mp4` | 1920x1080 | 16:9 | 18.853333 s | PASS |
| `marketing/video-portrait.mp4` | 800x1200 | 2:3 | 18.853333 s | PASS |

Both videos were freshly recorded by `scripts/record-video.mjs`. The matching
cover is held for 0.7 s, then the recording cuts to gameplay; raw setup footage
is trimmed before encoding. Start (cover), 0.8 s (gameplay), middle, and end
frames were inspected for each format: no menu, cursor, black frame, game-over,
or sound stream was retained after the opening cover.

## Screenshot evidence

- `qa/round3-907x510-fever-impact.png`
- `qa/round3-1920x1080-fever-impact.png`
- `qa/round3-390x844-fever-impact.png`

These fresh captures show the Fever floor pulse and kill-impact frame at the
required viewport sizes. No `raw-*.webm` or `rec-*` capture directory remains.

## Package limits

At verification, the tracked payload was 49.4 MB across 87 files, below the
50 MB and 1500-file limits.
