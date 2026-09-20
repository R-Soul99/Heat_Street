---
quick_id: 260920-sm2
description: "Apply the developer's hand-tuned vehicle and camera values (live ?debug session, exported via quick task 260920-l94's Export feature)"
status: complete
completed: 2026-09-20
---

# Quick Task 260920-sm2: Apply the Developer's Hand-Tuned Vehicle and Camera Values Summary

**Transcribed ten hand-tuned constants (seven vehicle, three camera damping) from the developer's live `?debug` session into `defaultTuning()`/`defaultCameraTuning()`, with extended doc comments, synced test literals, and a synced tuning guide — closing STATE.md's `[Quick 260920-j4d, open]` blocker.**

## Performance

- **Tasks:** 3/3 completed
- **Files modified:** 5 (`src/core/vehicle-tuning.ts`, `src/core/camera-tuning.ts`, `tests/vehicle-tuning.test.ts`, `tests/tuning-persist.test.ts`, `docs/vehicle-tuning-guide.md`) — matches the plan's `files_modified` exactly, confirmed via `git diff --stat` against the plan's base commit
- **Completed:** 2026-09-20

## Accomplishments

- `defaultTuning()`: `chassis.mass` 1600->1390, `chassis.comOffset.y` -0.15->-0.25, `wheels.frontSideFriction` 1.0->1.21, `drive.engineForcePerRearWheel` 3650->4800, `drive.handbrakeRearSideFriction` 0.01->0.005, `assists.bodyRollGain` 0.12->0.075, `assists.slideCatchGain` 0.12->0.1
- `defaultCameraTuning()`: `damping.positionLambda` 6.0->3.3, `damping.headingLambda` 2.5->4.5, `damping.framingLambda` 1.5->1.9 — the three `[ASSUMED]` tags removed, since these are no longer assumed
- Every changed field's doc comment extended (never replaced) with old value, new value, a `[TUNED live, 260920-sm2]` tag, and provenance (the developer's own `?debug` panel session, exported via quick task 260920-l94's Export feature) — no invented telemetry figures for feel-tuned values
- Camera framing (`framing.*`), `heading`, `occlusion`, `chaseFallback` are byte-unchanged; a note in `src/core/camera-tuning.ts` records WHY the rest of the same exported JSON (new framing altitude/distance/FOV/speed values) was deliberately not applied — it would break the 45:8/90:16 pitch-invariant ratio quick task 260919-cam established and `tests/camera-tuning.test.ts` asserts
- `src/core/surface-tuning.ts` is byte-unchanged (confirmed via `git diff --stat`)
- `docs/vehicle-tuning-guide.md`'s Default column corrected for all ten changed fields plus the three stale inline-prose mentions and the `maxSuspensionForce` static-load arithmetic (now ~3409N/wheel at 1390kg, ~5.9x ceiling)
- `clampTuning(defaultTuning())` and `clampCameraTuning(defaultCameraTuning())` both confirmed to deep-equal their un-clamped inputs (mechanically verified via a throwaway test, not assumed) — every new default sits inside its own `TUNING_RANGES`/`CAMERA_TUNING_RANGES` entry

## Task Commits

Each task was committed atomically:

1. **Task 1: Apply the seven vehicle defaults and extend their doc comments** - `b72302e` (feat)
2. **Task 2: Apply the three camera damping lambdas and record the framing exclusion** - `240f732` (feat)
3. **Task 3: Full regression sweep and tuning-guide sync** - `5528045` (docs)

_No plan-metadata commit yet — SUMMARY.md/STATE.md commit is the orchestrator's responsibility per this execution's constraints._

## Files Created/Modified

- `src/core/vehicle-tuning.ts` - Seven retuned defaults, extended doc comments (old/new value, `[TUNED live, 260920-sm2]` provenance), module-header and `defaultTuning()`-doc supersession notes
- `src/core/camera-tuning.ts` - Three retuned damping lambdas, `[ASSUMED]` tags removed on those three leaves, framing-exclusion rationale recorded above the `damping` block
- `tests/vehicle-tuning.test.ts` - Updated four literal assertions (`comOffset.y`, `rearSideFriction`'s companion comment untouched, `handbrakeRearSideFriction`, `bodyRollGain`, `mass`) plus provenance comments
- `tests/tuning-persist.test.ts` - Updated the "null mass" test title and two `chassis.mass` assertions from 1600 to 1390
- `docs/vehicle-tuning-guide.md` - Default column for all ten fields, inline prose (`frontSideFriction`, `bodyRollGain`/roll-assist-gate result), and `maxSuspensionForce` static-load arithmetic

## Decisions Made

- Followed the plan's explicit values/range-check tables literally — no re-derivation of the ten hand-tuned numbers.
- Treated four failing regression-suite tests as **legitimate, diagnosed consequences** of the developer's own value changes (not bugs to auto-fix, not bands to loosen) and left them RED per the plan's STOP-AND-REPORT rule — see "Deviations from Plan" below for the full diagnosis of each.
- Explicitly did NOT touch `tests/vehicle.test.ts` (its `boxPrincipalInertia` "Config A anchor" test now fails because its hardcoded expected literal was computed against the old 1600kg mass) even though the fix is a trivial, provably-correct recompute — because that file is outside the plan's declared `files_modified` scope, and the plan's own `<verification>` step 2 requires `git diff --stat` to touch exactly the five declared files. Recomputed value provided below for whoever picks this up.

## Deviations from Plan

### Reported, Not Auto-Fixed (STOP-AND-REPORT rule, per the plan's own instruction)

**1. [Anticipated by the plan] D-14 accel band now misses at 4800N**
- **Found during:** Task 3's full regression sweep
- **Measured:** `tests/vehicle-telemetry.test.ts -t accel` now measures **4.15s 0-60mph** at the new `engineForcePerRearWheel: 4800` (and the new 1390kg mass) — outside D-14's locked 6.0-7.0s band (previously 6.52s at 3650N/1600kg).
- **Action taken:** None. Per the plan's explicit instruction, this band was NOT re-anchored and `engineForcePerRearWheel` was NOT adjusted. Reported here for a human decision: either accept the faster 0-60 as the new intended feel and relax D-14's band in a follow-up, or dial the engine force back down.
- **Test file:** unchanged (still red on this one assertion).

**2. [NOT anticipated by the plan, but same root cause] D-14 brake band now misses too**
- **Found during:** Task 3's full regression sweep
- **Measured:** `tests/vehicle-telemetry.test.ts -t brake` now measures **109.47 ft** 60-0mph stopping distance — 0.53 ft under D-14's locked 110-135ft floor (`brakeImpulsePerWheel` is unchanged at 60 N·s; the shorter distance is the direct, physically-expected effect of the mass drop 1600kg -> 1390kg: the same brake impulse decelerates a lighter car faster).
- **Action taken:** None — same STOP-AND-REPORT treatment as the accel band. Diagnosed, not fixed, not band-adjusted. Flagged for the same human decision as #1 (a mass this much lower may also want `brakeImpulsePerWheel` revisited, or the band widened).
- **Test file:** unchanged (still red on this one assertion).

**3. [Direct consequence of #1/#2] `runAllRoutines` aggregate test fails**
- **Found during:** Task 3's full regression sweep
- **Cause:** `tests/vehicle-telemetry.test.ts -t "returns exactly six results, every one passing"` fails purely because it aggregates the accel and brake routines above — no independent root cause.
- **Action taken:** None.

**4. [NOT anticipated by the plan, unrelated to design gates] `boxPrincipalInertia` "Config A anchor" test is stale**
- **Found during:** Task 3's full regression sweep
- **Found in:** `tests/vehicle.test.ts` (outside this plan's `files_modified`)
- **Cause:** This is a pure formula-verification test (not a feel/design gate) — it evaluates the shipped `boxPrincipalInertia(mass, halfExtents)` formula against a hardcoded expected literal that was computed for the OLD default mass (1600kg): `{x: 3078.67, y: 3426.67, z: 614.67}`. Since `chassis.mass` is now 1390kg, the CORRECT recomputed anchor (confirmed by direct computation with the shipped formula, not approximated) is **`{x: 2674.59, y: 2976.92, z: 533.99}`** — an exact linear scale by 1390/1600, consistent with the formula being linear in mass.
- **Action taken:** Diagnosed and the correct replacement literal computed and verified above, but the test file was deliberately left UNCHANGED and still red, because `tests/vehicle.test.ts` is not in this plan's declared `files_modified` list and touching it would violate the plan's own `<verification>` step 2 (git diff must touch exactly the five declared files). Recommend a trivial one-line-literal follow-up fix using the values above.

**Net effect:** `npm run check` is **NOT fully green** — 4 test failures across `tests/vehicle-telemetry.test.ts` (3, all downstream of the same two design-target bands) and `tests/vehicle.test.ts` (1, a stale test literal unrelated to any design gate). All four are fully diagnosed, none required or received a value/band/threshold/range edit, and none are silently worked around. This is the STOP-AND-REPORT rule's intended outcome for this task, not an incomplete execution.

### Confirmed Passing (re-verified, not assumed)

- **Roll-assist-stability gate** (`tests/vehicle-telemetry.test.ts -t "roll assist stability"`): all six canonical routines pass at `bodyRollGain: 0.075`. Worst measured tilt across the six: **9.84deg** on `ramp` (up from the old worst of 5.42deg at `bodyRollGain: 0.12` — driven by the new, much higher post-landing speeds from the stronger engine force, not by the lower roll gain itself), still comfortably under the 15deg cutoff. Confirms the plan's expectation that lowering `bodyRollGain` "should only make that gate easier" held for five of six routines; `ramp`'s post-landing tilt rose but stayed well clear of the cutoff.
- **`tests/vehicle-recovery.test.ts`** (260920-j4d's `powerSlideRecoveryRoutine`/`highSpeedPulseRoutine` locked bands): all 8 tests pass at the new baseline unchanged.
- **`tests/surface-telemetry.test.ts`, `tests/surface.test.ts`, `tests/vehicle-scene.test.ts`, `tests/tuning-guide-sync.test.ts`, `tests/determinism.test.ts`**: all green at the new baseline.
- **`clampTuning(defaultTuning())` / `clampCameraTuning(defaultCameraTuning())`** both confirmed to deep-equal their inputs — every one of the ten new defaults sits inside its own declared range; the hostile-blob clamp fallback path is unaffected.

## Issues Encountered

None beyond the four diagnosed test failures documented above. No architectural changes, no auth gates, no package installs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- STATE.md's `[Quick 260920-j4d, open]` blocker ("`src/core/vehicle-tuning.ts` is UNCHANGED... do not assume the shipped defaults reflect the current feel") is now CLOSED — the shipped defaults match the developer's live-tuned feel.
- Two open follow-ups for a human decision, both already reported above rather than silently resolved:
  1. D-14's accel (6.0-7.0s) and brake (110-135ft) bands both now miss at the new baseline (measured 4.15s / 109.47ft) — decide whether to accept the faster/shorter feel and widen the bands, or dial `engineForcePerRearWheel`/`brakeImpulsePerWheel` back toward the old targets.
  2. `tests/vehicle.test.ts`'s `boxPrincipalInertia` "Config A anchor" literal is stale (recomputed value provided above) — a one-line fix outside this plan's scope.

## Self-Check: PASSED

- `src/core/vehicle-tuning.ts` exists and contains the seven new values — FOUND
- `src/core/camera-tuning.ts` exists and contains the three new damping values — FOUND
- `tests/vehicle-tuning.test.ts` exists with updated literals — FOUND
- `tests/tuning-persist.test.ts` exists with updated literals — FOUND
- `docs/vehicle-tuning-guide.md` exists with synced Default column — FOUND
- Commit `b72302e` — FOUND in `git log --oneline`
- Commit `240f732` — FOUND in `git log --oneline`
- Commit `5528045` — FOUND in `git log --oneline`
- `git diff --stat` against the plan's base commit (`5a00247`) touches exactly the five declared files — CONFIRMED
- No deletions in any of the three task commits — CONFIRMED via `git diff --diff-filter=D`

---
*Quick task: 260920-sm2*
*Status: complete — ten values transcribed, doc comments extended, guide synced; two design-target bands and one stale test literal reported for human follow-up, none silently adjusted*
