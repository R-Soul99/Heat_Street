---
status: resolved
trigger: "minimap arrow moves in the opposite direction to the car — when the car turns right, the arrow turns left"
created: 2026-09-22T00:00:00Z
updated: 2026-09-22T18:00:50Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

reasoning_checkpoint:
  hypothesis: "src/hud/minimap.ts's projectMinimapPoint uses screen-right = world +X paired with screen-up = world +Z. For a straight-down top-down camera (F=(0,-1,0)) that pairing is the MIRRORED (left-right flipped) top-down projection — the non-mirrored pairing for screen-right=+X requires screen-up = world -Z (verified via cross(forward,up)=right). projectCarRotation (`Math.PI/2 - headingRad`) is algebraically self-consistent with this mirrored point-projection (marker always points exactly at whatever's dead-ahead of the car, for all headings — proved algebraically, which is why the prior session's discrete-point check at heading=0/-pi/2 looked correct). But because the whole minimap is a mirror image of the real world, a physical RIGHT turn (which provably increases headingRad, derived from vehicle.ts's steering-sign comment + Rapier's quaternion integration) sweeps the marker COUNTERCLOCKWISE on screen instead of clockwise — i.e. it looks like it's turning the opposite way from the real car. This matches the reported symptom exactly, and also explains why it wasn't caught before: pointing-at-checkpoint correctness survives mirroring, only rotational SENSE (and absolute left/right placement) is inverted by it."
  confirming_evidence:
    - "node -e cross-product check: F=(0,-1,0) top-down camera with desired screen-up=world -Z gives screen-right=(+1,0,0) -- the non-mirrored pairing. The SAME check with screen-up=world +Z gives screen-right=(-1,0,0) -- meaning current code's screen-right=+X/screen-up=+Z combo (from `x: half+dx*scale`, `y: half-dz*scale`) is the mirrored pairing."
    - "src/hud/minimap.ts's own angleRad is `Math.atan2(dx, -dz)` -- the ONLY place in the codebase using this axis order. Every other bearing calc uses `Math.atan2(dz, dx)`: navigation-arrow.ts:30 (`Math.atan2(dz, dx) - carHeadingRad`, already verified correct by the prior session), race-coordinator.ts:61 (`Math.atan2(to.z - from.z, to.x - from.x)`), and headingFromRotation itself (`Math.atan2(forwardZ, forwardX)`). minimap.ts is the outlier -- independent confirmation of the same mirroring bug from a totally different angle (literal code-convention audit, not just physics derivation)."
    - "Derived (quaternion integration + vehicle.ts's steering-sign comment 'positive setWheelSteering -> positive angvel.y -> turns LEFT') that headingRad = -psi - pi/2 where psi is the physics yaw angle, giving: RIGHT turn -> psi decreases -> headingRad INCREASES, monotonically, for any current heading. This is a robust, heading-independent fact, not a one-point check."
    - "Algebraically re-derived projectCarRotation from scratch against the mirrored on-screen formula: solving 'marker tip direction must equal dead-ahead-checkpoint screen direction for all theta' independently reproduces the existing `Math.PI/2 - headingRad` formula exactly -- proving it is CORRECT relative to the mirrored map, i.e. the bug is in the point-projection axis pairing, not in projectCarRotation's algebra."
  falsification_test: "If this hypothesis is wrong, then re-deriving the non-mirrored on-screen formula (y: half + dz*scale instead of half - dz*scale) and its matching projectCarRotation (Math.PI/2 + headingRad instead of Math.PI/2 - headingRad) would NOT produce a clockwise arrow sweep for a physical right turn. Verified numerically: at heading=-pi/2 (car facing world -Z, baseline), rotation=0 (arrow up); nudging heading by +epsilon (a right turn) gives new rotation=+epsilon, and canvas context.rotate(+epsilon) sweeps the tip from straight-up toward up-right -- a clockwise sweep, matching a real right turn. This confirms the fix direction rather than refutes the hypothesis."
  fix_rationale: "Un-mirror the ENTIRE minimap by flipping the world-Z-to-screen-Y sign (screen-up becomes world -Z instead of +Z), and update projectCarRotation to match the new, non-mirrored pairing. This must be done as ONE coupled change (on-screen mapping, offscreen clamp, angleRad, and car rotation together) because projectCarRotation was algebraically consistent with the OLD mirrored mapping -- fixing only the rotation formula in isolation would make the arrow stop pointing at checkpoints correctly while still being wrong for turning sense; fixing only the point mapping in isolation would make the arrow point at the wrong checkpoint. Root cause addressed directly: the axis-pairing mismatch, not a symptom patch on the rotation formula alone."
  blind_spots: "Have not yet run the game in a browser to visually confirm continuous turning now looks correct (self-verified via algebra + unit-test-equivalent numeric checks only, consistent with this project's stated verification-checklist requirement for human confirmation before archiving). Have not checked whether any other consumer of MinimapProjection.angleRad depends on the OLD atan2(dx,-dz) convention (grep shows angleRad is only produced/consumed inside minimap.ts and its own exported interface, not read elsewhere in src/, but worth a final grep before commit)."

next_action: awaiting human verification — user should load the dev server, drive the course, and confirm the minimap car marker now visually turns the same direction as the real car (right turn -> marker sweeps clockwise), and that the minimap checkpoint dots/road lines and on-screen navigation arrow (unchanged) still look correct.

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: The minimap's car marker should rotate to visually match the car's actual turn — turning right in the world should rotate the marker clockwise/right on the minimap, turning left should rotate it left.
actual: The minimap arrow/marker rotates in the mirrored direction — when the car turns right, the marker turns left, and (presumably, not yet confirmed) vice versa.
errors: None — console is clean, this is a silent visual-only inversion, not a crash.
reproduction: Run the dev server, drive the car in the browser, and watch the minimap's car marker while turning. It rotates opposite to the car's real turn direction.
started: Not clear whether this predates today's session or is a fresh regression from commit c2a4d69 (which touched this exact function, `projectCarRotation` in `src/hud/minimap.ts`, only hours ago and was only algebraically/discretely verified, not visually confirmed in-browser for continuous turning). User reports "always broken" as far as they've noticed, but has not specifically compared before/after c2a4d69.
scope: Minimap arrow/car-marker only — no separate on-screen navigation arrow was reported as affected; not otherwise checked since there's nothing else to compare against per the user.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-09-22T00:20:00Z
  checked: Read src/hud/minimap.ts (projectMinimapPoint, projectCarRotation, createMinimap), src/gameplay/race-coordinator.ts (headingFromRotation), src/physics/vehicle.ts (steering sign, resetPose quaternion), src/hud/navigation-arrow.ts (navigationArrowRotation, already-verified reference implementation)
  found: minimap.ts's on-screen point mapping is `x: half+dx*scale, y: half-dz*scale` and its bearing helper is `angleRad = Math.atan2(dx, -dz)` -- the only place in the codebase using this axis order/sign combo. Every other directional calc (navigation-arrow.ts, race-coordinator.ts's poseForCheckpoint, headingFromRotation itself) consistently uses `Math.atan2(dz, dx)`.
  implication: minimap.ts is an outlier convention, a strong signal of an axis-pairing bug independent of the physics derivation.

- timestamp: 2026-09-22T00:25:00Z
  checked: Cross-product derivation (node -e) of camera-right for a straight-down top-down camera (forward=(0,-1,0)) paired with candidate screen-up vectors world +Z and world -Z
  found: screen-up=world -Z pairs with screen-right=world +X (non-mirrored). screen-up=world +Z pairs with screen-right=world -X. Current code uses screen-right=world +X WITH screen-up=world +Z -- the mirrored (left-right flipped) combination.
  implication: The entire minimap (road edges, checkpoint dots, car marker) is drawn as a mirror image of the true top-down world, not just the car-rotation formula.

- timestamp: 2026-09-22T00:30:00Z
  checked: Derived headingRad's relationship to physical steering direction, chaining vehicle.ts's measured steering-sign comment (positive setWheelSteering -> positive angvel.y -> turns LEFT; steerAngle = -frame.steer*maxSteerLock so RIGHT input -> negative setWheelSteering -> negative angvel.y) through standard quaternion integration (dpsi/dt = angvel.y) and headingFromRotation's atan2(forwardZ, forwardX) definition
  found: headingRad = -psi - pi/2 (psi = physics yaw angle about +Y). Therefore a physical RIGHT turn (negative angvel.y) monotonically INCREASES headingRad, and a LEFT turn decreases it, for any current heading (not just at discrete test points).
  implication: Combined with the mirrored point-projection, a right turn (headingRad increasing) sweeps the marker counterclockwise on the mirrored minimap -- visually opposite to the real turn. This is the mechanism behind the reported symptom.

- timestamp: 2026-09-22T00:32:00Z
  checked: Re-derived projectCarRotation from first principles against BOTH the current (mirrored) on-screen formula and a candidate non-mirrored formula (y: half+dz*scale), by solving "marker tip direction == dead-ahead-checkpoint screen direction, for all headingRad"
  found: Against the current mirrored mapping, this derivation independently reproduces the existing formula `Math.PI/2 - headingRad` exactly (so that formula is algebraically correct given the mirrored map -- explaining why the prior session's discrete-point check passed). Against the corrected non-mirrored mapping (y: half+dz*scale), the matching rotation formula is `Math.PI/2 + headingRad`.
  implication: The bug is in projectMinimapPoint's axis pairing, not in projectCarRotation's algebra in isolation. Both must change together, coupled.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "src/hud/minimap.ts's projectMinimapPoint maps world +Z to screen-up while also mapping world +X to screen-right (`y: half - dz*scale` paired with `x: half + dx*scale`). For a straight-down top-down camera, that specific pairing is the MIRRORED (left-right flipped) projection of the world -- the non-mirrored pairing for screen-right=+X requires screen-up=world -Z, not +Z (verified via cross(forward,up)=right). The previously-fixed `projectCarRotation` (`Math.PI/2 - headingRad`, from the resolved nav-arrow-and-circuit-order session) is algebraically self-consistent with this mirrored point-projection -- the marker always points exactly at whatever is dead-ahead of the car, for every heading, which is why that prior session's discrete checks (heading=0, -pi/2) looked correct. But because the whole minimap is a mirror image of the true world, and a physical RIGHT turn provably increases headingRad monotonically (derived from vehicle.ts's measured steering-sign convention), the marker sweeps COUNTERCLOCKWISE on the mirrored map for a real right turn -- i.e. it visually appears to turn the opposite way from the actual car. Rotational-sense correctness does not survive mirroring even though pointing-at-a-target correctness does, which is why this bug coexisted with (and was masked by) the prior session's verified-correct checkpoint-pointing fix."
fix: |
  Coupled, single change to src/hud/minimap.ts: un-mirror the on-screen mapping (screen-up becomes world -Z instead of world +Z: `y: half + dz*scale` instead of `half - dz*scale`), updated `angleRad` to the codebase-standard `Math.atan2(dz, dx)` (was the outlier `Math.atan2(dx, -dz)`), updated the offscreen clamp to match (`x: half + cos(angleRad)*(half-8)`, `y: half + sin(angleRad)*(half-8)`), and updated projectCarRotation to `Math.PI/2 + headingRad` (was `Math.PI/2 - headingRad`) so pointing-at-target correctness is preserved while turning-sense correctness is restored. Applying only one half of this change would break the other property.
verification: |
  - `npx tsc --noEmit`: clean, no errors.
  - `npx vitest run tests/minimap.test.ts tests/race-coordinator.test.ts tests/race-state.test.ts`: 15/15 passed (added a new coupling regression test: "points the car marker at a checkpoint that is directly ahead, for an arbitrary (non-axis-aligned) heading").
  - Full suite `npx vitest run`: 1115/1118 passed; the 3 failing tests (tests/vehicle-telemetry.test.ts accel/brake/runAllRoutines) are pre-existing and unrelated — confirmed identical failures on `git stash` (clean checkout) before this session's changes.
  - `npx biome check` on both changed files: clean.
  - Root cause mechanism verified via an independent cross-product derivation (non-mirrored top-down camera-right for a given screen-up), an independent codebase-convention audit (every other bearing calc uses atan2(dz,dx); minimap.ts was the only atan2(dx,-dz) outlier), and a from-scratch algebraic re-derivation of projectCarRotation against both the old (mirrored) and new (non-mirrored) point mappings.
  - Human in-browser confirmation (2026-09-22): user confirmed "confirmed fixed" after driving the course and watching the minimap car marker during real turns. No further directional complaints.
files_changed:
  - src/hud/minimap.ts
  - tests/minimap.test.ts
