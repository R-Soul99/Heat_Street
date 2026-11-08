# Quick 261108-tjn: Issue #18 - blocker pursuers more effective at stopping the player

Branch: ai/blocker-effectiveness (off origin/main b4c7750). Code: src/core/pursuer-driver.ts. Tests: tests/pursuer-driver.test.ts.

## Problem
Blockers (slots 3, 4 of each ring of five) overtake, cut into the player's lane and slide broadside, but the player still gets past easily.
Known causes (from the issue, uninvestigated): same top speed means a flat-out player is never overtaken; a blocker that has been passed has to turn round and rejoin; slide window (6-25 m ahead, within 4 m of line) and BLOCK_HOLD_M (12 m) are untuned guesses.

## Tasks
1. Measure first. Add a headless "dodging player" probe to the pursuer-driver test harness (player steers to the open side of any car ahead). Metrics: time spent with a blocker ahead in lane, number of times the player gets past a blocker, minimum player speed. Record the baseline numbers.
2. Tune/change blocker behaviour against the probe: earlier commit, pairing of the two blockers to close the gap together, slide window and hold distance. Constants stay in PursuerParams so #9 debug sliders can expose them later.
3. Keep existing pursuer-driver tests green, run typecheck. Hand-drive on ?map=straight-test&pursuers=6 and 10 is done by the user (issue label needs-drive); do not close #18 until they confirm.

## Done when
Probe shows measurably fewer clean passes than baseline, no pursuer flips, tests and typecheck pass, user has been given the build to hand-drive.
