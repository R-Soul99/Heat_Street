---
status: incomplete
---
# Quick 261108-tjn: Issue #18 summary (first pass, awaiting hand-drive)

Done:
- Blockers get a physical speed edge: BLOCKER_SPEED_EDGE 1.1 on top speed and rear engine force, via new `speedEdge` option on createAiFleet (src/physics/ai-fleet.ts), wired in src/main.ts.
- Blocker swing-across now starts at carAlong 5-15 m (was 0-10). With the edge, the old value cut across while still beside the player, collided and spun the blocker out.
- tests/pursuer-driver.test.ts: harness applies the edge; "blocker slots" test loosened (180 per blocker -> 200 total, 60 each) because blockers now slide and are passed sooner.

Measured (headless, flat plane, flat-out dodging player 46.7 m/s):
- Baseline: blockers capped at the player's top speed never get ahead in its lane (0 ticks) - slide/hold tuning was never reached.
- With edge: a blocker gets ahead after ~30 s from a 40 m start (player accelerates away, 10% edge closes slowly). Player min speed drops to ~20 m/s when it does.
- Slow player sweep: one-shot handbrake stop holds the lane ~230 ticks (5 cars) / ~480 (10); a rolling block with no slide and blockSpeedFraction 0.35 held ~395 / ~2410. Slide/hold constants had no effect against the flat-out dodger because the blockers never reached the slide window.

Next candidates: (a) rolling block instead of handbrake stop, (b) catch-up edge scaling with gap so blockers get ahead in seconds, not 30 s, (c) pair the two blockers. Needs the user's hand-drive on ?map=straight-test&pursuers=6 / 10 before closing #18.
