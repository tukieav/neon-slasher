# Neon Slasher — CrazyGames Submission Kit

Wszystko poniżej wklejasz w formularz na https://developer.crazygames.com/

## Game name
Neon Slasher

## Category
Action (secondary: Arcade)

## Tags
slasher, katana, arena, waves, robots, neon, combo, dash, action, survival, one-hand, bullet-time

## Short description (max ~140 chars)
Slice waves of neon robots with your energy katana! Dash, deflect bullets, chain combos and take down mini-bosses in a glowing arena.

## Full description
Neon Slasher drops you into a pulsing neon arena as a lone energy-katana warrior
against endless waves of rogue robots. No blood, all glow — enemies shatter into
sparks and springs when sliced!

FEATURES
- Fast, satisfying katana combat with a wide 120° slash arc
- DASH with invincibility frames — dodge through danger, leave a neon trail
- DEFLECT enemy bullets with your blade and send them right back
- Combo multiplier: chain kills without getting hit for massive scores
- BULLET-TIME slow-mo when you slice 3+ robots in a single swing
- Mini-boss every 5 waves with attack patterns and HP bars
- 3 enemy types: chasers, shooters and explosive kamikaze bots
- Heart pickups, screen shake, particles — pure game-feel
- Mouse+keyboard AND full touch controls (virtual joystick + tap/swipe)
- Best score saved across devices

HOW TO PLAY
1. Move with WASD (or left-thumb virtual joystick)
2. Aim with mouse, click to slash (or tap right side of screen)
3. Space / right-click (or swipe) to DASH with i-frames
4. Deflect slow bullets with your slash
5. Survive the waves, defeat mini-bosses, chain that combo!

How long can your combo survive?

## Controls text
WASD — move. Mouse — aim. Click — slash. Space / right-click — dash.
Mobile: left thumb joystick — move, tap right — slash, swipe right — dash.

## SDK integration notes (QA reviewer info)
- HTML5 SDK v3, manual init before game start (with timeout fallback)
- gameplayStart/gameplayStop on play/game over/ad breaks
- loadingStart/loadingStop around boot
- Midgame ad on "Play Again" after game over
- Rewarded ad "SECOND WIND" (full HP revive + 3s shield, once per run)
- happytime() on mini-boss kills
- game.settings.muteAudio respected + settings change listener
- Best score via data module with localStorage fallback
- No external requests, all assets procedural (Canvas 2D + WebAudio), bundle ~21 KB
- Live demo: https://tukieav.github.io/neon-slasher/

## Files to upload
- Build: dist/index.html + dist/bundle.js (or neon-slasher.zip contents)
- Cover 16:9 (1920x1080): marketing/cover-16x9.png
- Cover 1:1 (1080x1080): marketing/cover-1x1.png
- Cover 2:3 (800x1200): marketing/cover-2x3.png
- Screenshots: marketing/screenshot-combo.png, marketing/screenshot-wave2.png
- Videos: marketing/video-landscape.mp4 (1280x720), marketing/video-portrait.mp4 (720x1280)

## Form answers
- "Does your game save progress?" -> "Yes, using the Data Module from the CrazyGames SDK"
- [x] supports mobile devices
- [x] supports CrazyGames muting audio through SDK
- [ ] online multiplayer (NO)

## Age rating / audience
All ages; designed for 10–16. No blood/gore (robots burst into neon particles),
no text chat, no user content.
