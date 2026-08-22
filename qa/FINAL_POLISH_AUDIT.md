# Final Polish audit — Neon Slasher

Audited 2026-08-22 against the current hardened build at 907x510, 1920x1080,
and 390x844. This record intentionally contains exactly the three reproduced
post-hardening defects addressed by the following implementation work.

## 1. Late-wave spawn cap silently deletes live threats

**Reproduction.** Start a non-boss wave above 22, keep the hero alive without
killing, and let its normal spawn queue drain. In an adversarial but valid
random sequence of melee rolls, wave 31 queues 65 enemies. The 49th spawn
removes the oldest live enemy rather than waiting for an available slot.

**Player impact.** Late-wave pressure becomes inconsistent: a player can lose
targets, score opportunities, and the intended pacing simply because the
hardening cap is reached. The wave is no longer a trustworthy survival
contract.

**Root cause.** `startWave` grows normal queues without considering active
capacity (`src/main.js:167-178`); `spawnEnemy` inserts enemies with
`pushBounded` (`src/main.js:210-230`), whose generic eviction deletes the
oldest entry (`src/main.js:121-124`); the queue drains regardless of occupancy
(`src/main.js:567-571`).

**Evidence state.** The reproduced debug state has `wave: 31`, 65 queued melee
spawns, and `enemies: 48`; spawning one more enemy leaves `enemies: 48` while
the original oldest actor disappears. This is a live-actor replacement, not a
visual-effect trim.

## 2. A deflected projectile has no readable direction or ownership shape

**Reproduction.** Spawn a shooter, wait for its charge, slash through the
bullet, then capture the active arena during a crowded wave at 907x510 or
390x844. Before and after deflection, a projectile is drawn only as the same
small glowing circle; its changed hue is the sole ownership cue.

**Player impact.** Under combo particles and core drops, the player cannot
quickly distinguish a safe, player-returning deflect from an incoming threat.
That hides the payoff of a core combat mechanic and makes the next target less
legible.

**Root cause.** Deflection changes simulation ownership and hue
(`src/main.js:291-302`), but the renderer ignores `friendly` and renders every
bullet as an identical disc (`src/main.js:1332-1339`).

**Evidence state.** After a successful slash, debug state reports the returned
projectile as `{ friendly: true, hue: 130 }`; the baseline draw path has no
heading, trail, ring, or other branch keyed by `friendly`.

## 3. An interrupted mobile touch can leave movement and attack input stuck

**Reproduction.** At 390x844, start a left-side virtual joystick drag, then
send `touchcancel` (the browser does this for an OS gesture, phone call, or
lost touch). The hero continues to move with the last joystick vector. A
cancelled right-side touch likewise remains occupied and rejects the next
attack touch.

**Player impact.** Mobile players can be moved into danger without touching
the screen and can lose their attack/dash control until another unrelated
state reset. This is especially harmful in the intended one-screen combat
loop.

**Root cause.** Input cleanup exists only in the `touchend` handler
(`src/main.js:2275-2302`); no `touchcancel` listener clears `joy` or
`rightTouch`.

**Evidence state.** After cancelling the left touch, the live input state
remains `joy.active: true` with its non-zero `dx/dy`; the next fixed update
continues to apply that vector through `src/main.js:509-526`.
