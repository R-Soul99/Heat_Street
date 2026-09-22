---
status: resolved
trigger: "check the directional arrows, they're very confusing and don't seem to point at the next checkpoint accurately. the minimap arrow is also quite weird. the circuit races aren't really 'circuits', more random points on the map. I can't test it in this state"
created: 2026-09-21T22:32:04Z
updated: 2026-09-22T00:00:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

reasoning_checkpoint:
  hypothesis: "The minimap's off-screen checkpoint projection (`projectMinimapPoint` in src/hud/minimap.ts) flips the sign of the Y component when clamping a point to the perimeter, so any checkpoint currently outside the minimap radius (common: checkpoints are 265m-943m apart, default radius is 420m) is drawn on the OPPOSITE edge of the minimap from its true direction. This, combined with the already-fixed (but not yet verified/committed) navigation-arrow bearing bug and minimap car-rotation bug from a prior session, is what made checkpoints feel like 'random points' rather than an ordered route — the player had no reliable directional cue at all, on top of the Circuit route itself being a real (topologically valid) but very elongated loop."
  confirming_evidence:
    - "Empirically ran projectMinimapPoint at dz=-99 (just inside radius 100) -> y=199 (bottom of canvas). At dz=-101 (just outside, 2m further) -> y=8 (top of canvas). A 2m change in world position causes a 191px teleport to the opposite edge — proves formula discontinuity/sign bug at the offscreen/onscreen boundary."
    - "Algebraic derivation: on-screen mapping is y = half - dz*scale (established/used consistently for player, remaining checkpoints, road edges). The offscreen clamp should preserve the same direction, i.e. y_clamped = half - (half-8)*dz/distance. Current code computes y = half - Math.cos(angleRad)*(half-8) which equals half - (half-8)*(-dz/distance) = half + (half-8)*dz/distance — sign-inverted from the correct formula."
    - "tests/minimap.test.ts already contains TWO tests ('clamps distant objectives to the perimeter with direction' and the newly-added 'does not project distant road points onto the map perimeter') that both assert the buggy value (y≈8) for a due-south point, meaning the bug is currently codified as 'expected' behavior and passing CI."
    - "Independently re-derived (via concrete numeric quaternion->heading examples) that the two already-applied, uncommitted fixes from a prior session — navigationArrowRotation in src/hud/navigation-arrow.ts and projectCarRotation in src/hud/minimap.ts — are mathematically correct and internally consistent with headingFromRotation's convention in race-coordinator.ts. These do not need further changes."
    - "Circuit route data (public/maps/juliette-ga.routes.json, 'juliette-three-lap-loop') was checked against the actual road graph (public/maps/juliette-ga.map.json): the 5 checkpoints (nodes 40,39,15,19,16) connect via 5 distinct edges (42,48,7,22,28) with no repeated/backtracked edge — a genuine, non-degenerate graph cycle. It is just very elongated (943m + 645m legs vs 85m/101m/266m legs) because that's the only loop available in this small demo road network near that area. race-state.ts's circuit target selection (selectP2PTarget is p2p-only; circuit mode advances currentTargetId strictly through course.checkpoints[] in array order, looping at lap boundaries) is correct and not randomized."
  falsification_test: "If the minimap y-sign fix is wrong, a due-north point (dz=+500) would NOT move to near the top (y~8) after the fix. Verified algebraically it does (y=8), and a due-south point moves to near bottom (y=192) as expected, matching the on-screen (non-clamped) directional convention for all four cardinal directions."
  fix_rationale: "Flip the sign of the Y component in the offscreen branch of projectMinimapPoint from `half - Math.cos(angleRad) * (half - 8)` to `half + Math.cos(angleRad) * (half - 8)` so offscreen clamping is continuous with (same directional sense as) the on-screen mapping used everywhere else in the minimap. This addresses the root cause (a sign error) directly, not a symptom. Also correct the two existing tests that encode the wrong expected value, and add a continuity regression test (point just inside vs just outside the radius must land on the same side)."
  blind_spots: "Have not yet run the game in a browser to visually confirm the arrow/minimap now look right (self-verification only via math + unit tests). Have not changed routes.json — leaving the Circuit route topology as-is since it is a genuine loop, not a data bug; if the user still finds Circuit mode's shape unsatisfying after the navigation fixes, that would be a level-design/content change, not a code bug, and should be raised separately."

next_action: awaiting human verification — user should load the dev server, drive both P2P and Circuit courses, and confirm the directional arrow and minimap now point/track accurately, including when checkpoints are beyond the minimap's visible radius

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: The directional navigation arrow and the minimap arrow should point accurately at the player's actual next objective checkpoint (nearest unvisited for P2P, next-in-sequence for Circuit). Circuit mode should feel like an ordered lap loop — checkpoints visited in a consistent sequence that traces a real circuit, not scattered/random-feeling points.
actual: The navigation arrow and minimap arrow are confusing and don't appear to point accurately at the next checkpoint. Circuit races don't feel like real circuits — checkpoints feel like random points on the map rather than an ordered lap course. Combined, this makes the current build unplayable/untestable for the user.
errors: None reported — this is a behavioral/UX correctness issue, not a crash or console error.
reproduction: Run the dev server, load a Circuit-mode race (and P2P for comparison) in the browser, and observe the on-screen directional arrow, the minimap arrow, and the checkpoint sequence as the player drives.
started: Never worked right — this is the first real playtest since Phase 5 (05-04) wired checkpoints/arrow/minimap into the real composition root, and Phase 6 (06-04) layered timing/splits on top without changing checkpoint targeting logic.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "Circuit mode's checkpoint ordering/target-selection code is broken (scrambled/random order), causing the 'random points' feeling."
  evidence: "race-state.ts advances currentTargetId strictly through course.checkpoints[] array order for circuit mode (selectP2PTarget only runs for p2p). The authored circuit route (juliette-three-lap-loop) traces 5 distinct, non-repeated graph edges forming one real cycle — not a scrambled route. The 'random points' feel is far better explained by the arrow/minimap directional bugs found this session."
  timestamp: 2026-09-21T23:55:00Z

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-09-21T23:35:00Z
  checked: git diff of src/hud/minimap.ts and src/hud/navigation-arrow.ts (uncommitted working-tree changes present before this session started)
  found: A prior debugging pass already rewrote navigationArrowRotation (src/hud/navigation-arrow.ts) to use atan2(dz,dx) consistent with headingFromRotation's atan2(forwardZ,forwardX) convention, and rewrote projectCarRotation (src/hud/minimap.ts) from `-headingRad` to `Math.PI/2 - headingRad`. The debug file's Evidence/Resolution sections were never updated to record this work.
  implication: Need to independently verify these two fixes are correct before trusting them, since they were applied without recorded reasoning.

- timestamp: 2026-09-21T23:40:00Z
  checked: Derived headingFromRotation's actual forward-vector convention using a pure-yaw quaternion (qx=0,qy=sin(ψ/2),qz=0,qw=cos(ψ/2)) and computed navigationArrowRotation/projectCarRotation outputs for concrete left/right/forward/back cases
  found: Both already-applied fixes produce geometrically correct results (verified numerically for facing-forward, target-to-left, target-to-right for the arrow; and heading=0/heading=-pi/2 for the minimap car marker, matching the canvas's world+X=right/world+Z=up drawing convention used by mapPoint)
  implication: navigation-arrow.ts and minimap.ts's projectCarRotation fixes are correct and can be kept as-is; no further change needed there

- timestamp: 2026-09-21T23:45:00Z
  checked: projectMinimapPoint's offscreen (clamped) branch in src/hud/minimap.ts, both algebraically and empirically (node -e reproduction at dz=-99 vs dz=-101, radius=100)
  found: Offscreen clamping uses `y: half - Math.cos(angleRad) * (half - 8)`, which is sign-inverted relative to the on-screen mapping (`y: half - dz*scale`) used for every other point on the minimap. Empirically, a point at dz=-99 (just inside radius) projects to y=199 (bottom); the same point at dz=-101 (2m further, just outside) projects to y=8 (top) — a 191px teleport for a 2m position change.
  implication: This is a genuine, previously-unfixed bug. Any checkpoint currently beyond the minimap's 420m default radius (common, since authored checkpoints are 85m-943m apart) is drawn on the WRONG side of the minimap. tests/minimap.test.ts contains two tests that assert the buggy value (y≈8) as correct, so this bug was passing CI undetected.

- timestamp: 2026-09-21T23:50:00Z
  checked: public/maps/juliette-ga.routes.json "juliette-three-lap-loop" checkpoints (nodes 40,39,15,19,16) cross-referenced against public/maps/juliette-ga.map.json edges, and src/core/race-state.ts's circuit target-advancement logic
  found: The 5 circuit checkpoints connect via 5 distinct, non-repeated graph edges (42,48,7,22,28) forming one genuine cycle back to the start node — not a scrambled/backtracking route. It's elongated (two long legs of 943m/645m vs three short legs of 85m/101m/266m) because that's the only loop the small demo road network offers near that area. race-state.ts advances currentTargetId strictly through course.checkpoints[] in authored array order for circuit mode (selectP2PTarget is p2p-only) — ordering logic is correct, not randomized.
  implication: "Circuit doesn't feel like a circuit" is very likely explained by the navigation-arrow/minimap bugs above (player had no reliable sense of direction to any checkpoint), not by a checkpoint-ordering or routing code bug. No routes.json change planned; flagged as a content/level-design follow-up if the complaint persists after the UI fix.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "Combination of (1) navigation arrow used an inconsistent atan2 axis convention vs. the car's heading calc (already fixed, uncommitted, verified correct this session), (2) minimap car-marker rotation used the wrong formula (`-headingRad`) instead of `Math.PI/2 - headingRad` (already fixed, uncommitted, verified correct this session), and (3) minimap's off-screen checkpoint-dot clamping has a Y-axis sign bug that places any checkpoint beyond the minimap radius on the opposite edge from its true direction (newly found this session, not yet fixed). Together these made both directional aids unreliable, which is what made checkpoints — including the topologically-valid but elongated Circuit loop — feel like random, untrackable points."
fix: |
  1. src/hud/navigation-arrow.ts (already applied by a prior session, verified correct this session, no change needed): extracted `navigationArrowRotation(carHeadingRad, carPosition, waypoint)` using `Math.atan2(dz, dx) - carHeadingRad`, matching race-coordinator.ts's `headingFromRotation` convention (was previously `Math.atan2(dx, -dz)`, a mismatched axis order/sign).
  2. src/hud/minimap.ts `projectCarRotation` (already applied by a prior session, verified correct this session, no change needed): `Math.PI / 2 - headingRad` instead of `-headingRad`, so the car marker's screen rotation matches the canvas's world+X=right/world+Z=up drawing convention.
  3. src/hud/minimap.ts `projectMinimapPoint` offscreen branch (fixed this session): changed `y: half - Math.cos(angleRad) * (half - 8)` to `y: half + Math.cos(angleRad) * (half - 8)`. The old formula was sign-inverted relative to the on-screen mapping (`y: half - dz*scale`), causing any checkpoint beyond the minimap radius to render on the opposite edge from its true direction (verified: a 2m position change from dz=-99 to dz=-101 previously teleported the dot from y=199 to y=8).
  4. tests/minimap.test.ts: corrected two tests that had encoded the buggy y=8 expectation to the correct y=192, and added a continuity regression test asserting a point just inside vs. just outside the radius stays on the same side of the minimap.
verification: |
  - `npx tsc --noEmit`: clean, no errors.
  - `npx vitest run tests/minimap.test.ts tests/race-coordinator.test.ts tests/race-state.test.ts`: 14/14 passed.
  - Full suite `npx vitest run`: 1114/1117 passed; the 3 failing tests (tests/vehicle-telemetry.test.ts accel/brake/runAllRoutines) are pre-existing and unrelated — confirmed identical failures on `git stash` (clean checkout) before any of this session's changes.
  - `npx biome check` on all 3 changed files: clean.
  - Root cause mechanism independently re-derived via concrete numeric quaternion/heading examples (not just "it compiles"); offscreen sign bug independently reproduced via direct `node -e` execution of the pre-fix formula.
  - Circuit checkpoint ordering (public/maps/juliette-ga.routes.json + src/core/race-state.ts) verified to be a genuine non-repeating graph cycle traversed in correct authored order — no code change made there; documented as likely a perceptual consequence of the arrow/minimap bugs, not a separate ordering bug.
  - Human in-browser confirmation (2026-09-22): user confirmed "arrows are much better now." No further arrow/minimap directional complaints. Remaining Circuit "long drive between checkpoints" feedback attributed to route/level design (elongated loop + slidey car physics), not a targeting bug — matches the pre-fix hypothesis; tracked separately, not part of this debug session's scope.
files_changed:
  - src/hud/minimap.ts
  - tests/minimap.test.ts
  - src/hud/navigation-arrow.ts (pre-existing uncommitted change from a prior session; reviewed and confirmed correct this session, not modified further)
