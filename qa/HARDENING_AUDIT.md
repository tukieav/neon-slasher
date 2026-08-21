# Neon Slasher hardening audit

Audited 2026-08-21 before implementation. Baseline build completed and the
existing Playwright functional suite passed. I exercised the menu, a first run,
a forced fail/retry, and wave/progression states at DPR 1 in 907x510 and
1920x1080. Both rendered without console errors. The game has a strong,
readable neon-arena identity, but the technical gates below were not yet met.

## Core loop and current depth

One click on **PLAY** begins a wave survival run: move, aim/slash, dash, deflect
projectiles, survive specialist robots, build combos, collect Cores, then spend
them on persistent upgrades, katanas, and perks. Bosses appear every five waves
and Twin Cores at wave ten. The loop is immediately understandable, but threat
timing and combo state need clearer, fairer communication.

## Prioritized findings

1. **FAIL — no fixed-step / deterministic simulation gate.** The RAF loop sends
   variable `dt` directly to gameplay (`src/main.js:2189-2197`), so RNG, spawn
   queue behavior, effects, and state changes vary by presentation cadence.
2. **FAIL — no lifecycle handling.** `paused` is declared but has no
   visibility/blur/focus/ad event wiring (`src/main.js:67`, `2189-2197`), so a
   hidden tab can retain input/audio/gameplay state ambiguously.
3. **FAIL — unbounded high-churn entities.** `particles`, `debris`, `flashes`,
   beams, trail/ghost entries and bullets are pushed with no population caps
   (`src/main.js:158-162`, `185-199`, `288-302`, `530-631`, `660-691`).
4. **FAIL — no long-soak test.** Only the functional happy-path suite exists
   (`tests/e2e.mjs`); it does not run 120 seconds, assert entity/listener bounds,
   or check timer/heap health.
5. **FAIL — no full required viewport gate.** Existing screenshot helpers cover
   selected sizes only (`scripts/vision-shots.mjs:1-53`); no assertion covers all
   ten required DPR=1 viewports or control hit paths.
6. **FAIL — specialist telegraphs are visual fragments, not standardized combat
   contracts.** Shooter glow only begins during its final 0.6s
   (`src/main.js:1570-1578`); melee has no windup; kamikaze uses proximity blink
   (`src/main.js:1585-1608`); splitter lacks a pulse; boss charge is set and
   moves immediately (`src/main.js:578-590`).
7. **FAIL — no wave-linked arena hazard.** Waves only add spawn types
   (`src/main.js:114-146`) and do not introduce a readable positioning pressure
   after wave 3.
8. **PARTIAL — combo feedback is incomplete.** Fever and the combo bar exist
   (`src/main.js:264-281`, `1338-1364`), but deflects do not extend the chain and
   taking damage silently resets it (`src/main.js:329-337`).
9. **PARTIAL — ad path does not explicitly pause the simulation.** Ad callbacks
   only mute audio (`src/main.js:374-386`, `395-428`), and the SDK wrapper has no
   lifecycle bridge (`src/sdk.js:44-60`).
10. **PARTIAL — accessible motion is not supported.** The UI has readable
    contrast and a music toggle, but no `prefers-reduced-motion` behavior; shakes,
    flashes, intro sweep and rapid visual movement remain full strength
    (`src/main.js:37-49`, `641-691`, `1377-1413`).

## Likely player quit causes

| Moment | Risk |
| --- | --- |
| First 10 seconds | Action starts quickly, but melee and kamikaze threat timing is learned by damage rather than a consistent warning; the cinematic sweep can briefly obscure spatial setup. |
| First 60 seconds | The first shooter/boss pressures a player before a clear attack-contract vocabulary has been established; deflect has no chain reward. |
| Five minutes | Variable cadence, particle/debris accumulation, unbounded enemy scaling, and no soak-proven lifecycle can create stutter or an unfair late-run loss. |

## Requirement matrix before implementation

| Requirement | Status | Evidence |
| --- | --- | --- |
| At most one click to gameplay | PASS | Menu `PLAY` calls `startGame` (`src/main.js:2022-2026`). |
| Immediate local restart | PARTIAL | Retry is visually primary, but may await a midgame ad (`src/main.js:365-388`). |
| 10 DPR=1 viewport gate | FAIL | No comprehensive assertion test. |
| 60/144/165Hz determinism | FAIL | Variable RAF `dt`; no deterministic test. |
| Visibility/blur/ad lifecycle | FAIL | `paused` unwired. |
| Save/malformed fallback | PARTIAL | JSON fallback exists (`src/meta.js:54-67`), no migration test. |
| 120s soak with bounds | FAIL | No soak script. |
| Keyboard/mouse/touch | PARTIAL | Paths exist (`src/main.js:2081-2167`), no mobile control gate. |
| SDK/audio behavior | PARTIAL | Init/mute/throttle exist; explicit lifecycle pause missing. |
| Reduced motion / non-flashing | FAIL | No preference handling. |
| PEGI12 / no cross-promotion | PASS | Robot-only presentation and no cross-promotion code. |

## Taxonomy and submission audit

`marketing/SUBMISSION.md` is stale: it names secondary **Arcade** and invented
portal tags such as `slasher`, `katana`, `neon`, `one-hand`, and `bullet-time`
(`marketing/SUBMISSION.md:8-13`). The required `neon-slasher` map entry instead
requires primary **Action**, secondary discovery **Survival, Horde Survival**,
and exactly: **Survival, Horde Survival, Destroy, Robot, Mobile, 2D, Fighting**.
Its short description also needs the verified map copy or an accurate <=160-char
improvement.

## Baseline evidence

- `npm run build` — exit 0
- `node tests/e2e.mjs` — exit 0, 30 functional assertions passed
- `node scripts/vision-shots.mjs 907 510 audit-907` — exit 0, no errors
- `node scripts/vision-shots.mjs 1920 1080 audit-1920` — exit 0, no errors

The captured baseline frames were inspected: menu text/buttons are visible and
the arena fills the screen at both sizes; combat hierarchy is good but the HUD
is crowded during simultaneous wave/combo messages.
