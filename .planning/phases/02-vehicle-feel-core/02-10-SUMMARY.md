---
phase: 02-vehicle-feel-core
plan: 10
subsystem: vehicle-physics
tags: [tuning, human-verify, feel-session, rapier, vitest]

# Dependency graph
requires:
  - phase: 02-vehicle-feel-core
    provides: "src/physics/telemetry/run.ts's runAllRoutines (02-07), src/main.ts's composition root (02-08), src/debug/tuning-panel.ts + telemetry-hud.ts (02-09)"
provides:
  - "src/core/vehicle-tuning.ts: defaultTuning() updated to the human-approved values from the phase's feel session"
  - "tests/vehicle-tuning.test.ts: asserted default literals moved with them"
affects: [phase-03-surfaces-and-camera]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Headless diagnostic scripts (tests/_diag-*.test.ts, throwaway, never committed) used to root-cause a live-session finding instead of further live-browser slider guessing — isolates a mechanism in seconds via scripted ticks against the same createVehicle/sampleVehicle API the telemetry harness uses"

key-files:
  created: []
  modified:
    - src/core/vehicle-tuning.ts
    - tests/vehicle-tuning.test.ts
    - src/render/vehicle-view.ts
    - src/main.ts

key-decisions:
  - "rearSideFriction 0.12 -> 0.2: fixes a genuine emergent instability — sustained full-throttle straight-line driving (ZERO steering input) spontaneously spins out at ~89 mph at the old default. Root-caused headlessly: NOT the body-roll or slide-catch assists (identical onset with both forced to 0), NOT wheelspin/differential asymmetry (rear forward impulses stay bit-identical throughout), NOT a generic speed-based numerical instability (coasting at zero throttle is stable at every speed up to 120 mph). It IS specific to sustained throttle plus the low rearSideFriction multiplier: a symmetric, exponentially-growing lateral force builds on all four wheels under power, and a microscopic front-left/front-right asymmetry eventually couples it into yaw. A rearSideFriction sweep at full throttle showed the onset speed rising sharply with the value (0.06->67mph, 0.12->89mph, 0.2->128mph, 0.3->stable through 20s) -- 0.2 was chosen as comfortably above realistic sustained-chase speeds. Confirmed this does NOT blunt the deliberate full-lock power-oversteer move, since powerOversteerGain's lerp factor already reaches 1 at full throttle+full steer regardless of the baseline."
  - "powerOversteerGain 0.5 -> 1.1: swept live in-browser (0.5 produced no oversteer at full lock, 1.0 still none, 1.3 spun into a full doughnut); 1.1 gave a human-confirmed controllable, readable step-out."
  - "bodyRollGain 0.08 -> 0.12: raised toward the Bullitt-anchor target after the car read as too flat through corners at the plan 02-07 default; the roll-assist-stability CI gate still passes (measured 5.42deg max tilt, well under the 15deg cutoff)."
  - "slideCatchGain 0.1 -> 0.12: minor adjustment alongside the other changes. 0.3 was tried during the instability diagnosis and made the (unrelated) high-speed spin trigger EARLIER, not later -- confirming slideCatchGain was never the mechanism behind that bug and 0.3 was rejected."
  - "Mid-session usability fix (not part of the original plan, discovered as a blocker to completing the checkpoint): the phase 02-08 placeholder chase camera (0,5,9 offset) and the bare, featureless ground plane made it impossible to judge speed or slip visually. Pulled the camera back to (0,8,16) and added a THREE.GridHelper ground reference grid (src/render/vehicle-view.ts) -- both explicitly commented as temporary, superseded by Phase 3's real camera work."

requirements-completed: [VEH-01, VEH-02, VEH-04, NAV-01]

# Metrics
duration: 130min
completed: 2026-09-11
---

# Phase 02 Plan 10: Feel Session and Final Tuning Summary

**Ran the human feel session this whole phase exists to enable, found and root-caused a genuine emergent high-speed instability in the base vehicle model (not the authored assists), fixed it, and committed the session's approved values as the new defaults.**

## Performance

- **Duration:** ~130 min (mostly human drive time plus one headless root-cause investigation)
- **Tasks:** 2 (1 human-verify checkpoint + 1 automated transcription)
- **Files modified:** 4 (2 for the checkpoint's mid-session camera/grid fix, 2 for the final tuning commit)

## Accomplishments

- **SC5 part A (live retune loop) — fully signed off.** Sliders change behaviour immediately mid-drive with no reload; `mass` applies only on release with no discontinuity; the telemetry panel measurably reflects live-tuned values (confirmed by changing `frictionSlip` and re-running); persistence survives a reload; the two-click `Reset to defaults` works; typing `g`/`t` into a numeric field does not toggle either panel (the plan 02-05 focus guard holds).
- **SC1 (slide readable and recoverable) — fully signed off**, after finding and fixing a real bug along the way (see below). Handbrake slide at 60 mph: readable, recoverable. Throttle-only power oversteer: not present at the shipped default (`powerOversteerGain` 0.5), swept live to find 1.1 gives a controllable step-out. Brake-while-turning understeer: confirmed present.
- **SC2 (steering) — keyboard signed off; gamepad untested** (no hardware available this session). Flagged as an open item, not a failure.
- **SC5 part B (Bullitt sign-off) — signed off**, with the developer's own caveat that further tuning may follow later; this is consistent with the plan's scope (an approved starting feel, not a finished one).
- **Found, root-caused and fixed a real instability**, discovered because the developer reported difficulty holding a straight line under sustained acceleration. Headless diagnostic scripts (throwaway, never committed) proved: the base `DynamicRayCastVehicleController` + the shipped `rearSideFriction` (0.12) combination spontaneously spins the car out at ~89 mph under sustained full throttle with ZERO steering input — reproduced identically with both the body-roll and slide-catch assists forced to 0, and shown to require sustained throttle (coasting at any speed up to 120 mph, zero throttle, is perfectly stable). This was NOT something a slider in Assists could fix, which is why the developer's first two live attempts (raising `slideCatchGain`) made it worse rather than better — the actual lever was `rearSideFriction` itself, raised to 0.2.
- **Discovered and fixed a usability blocker mid-session**: the placeholder chase camera and bare ground plane from plan 02-08 made it impossible to judge speed or slide visually. Widened the camera and added a ground reference grid before the feel session could meaningfully proceed.

## Task Commits

1. **Mid-session usability fix (camera + grid)** - `82b31f5` (fix, applied before the checkpoint could proceed)
2. **Task 1: Feel session and SC1/SC2/SC5 sign-off** - human-verified across a multi-turn interactive session; no separate commit (checkpoint task, no files).
3. **Task 2: Commit the approved values as the new defaults and re-verify** - `7d01e66` (feat)

## Files Created/Modified

- `src/render/vehicle-view.ts` - added a `THREE.GridHelper` ground reference grid (10 m lines), disposed alongside the other scene geometry.
- `src/main.ts` - widened the temporary chase camera offset from `(0, 5, 9)` to `(0, 8, 16)`.
- `src/core/vehicle-tuning.ts` - `rearSideFriction` 0.12 -> 0.2, `powerOversteerGain` 0.5 -> 1.1, `bodyRollGain` 0.08 -> 0.12, `slideCatchGain` 0.1 -> 0.12, with each field's doc comment updated to name the plan 02-10 session as the source and record the measured rationale.
- `tests/vehicle-tuning.test.ts` - asserted literals for `rearSideFriction` and `bodyRollGain` updated to match (the only two of the four with a dedicated literal assertion in the "eight measured load-bearing default values" test).

## Final Telemetry Numbers (against the new committed defaults)

| Routine | Value | Target | Result |
|---|---|---|---|
| 0-60 mph | 6.50 s | 6.0-7.0 s | PASS |
| 60-0 braking | 123.68 ft | 110-135 ft | PASS |
| Skidpad | 1.03 g | 0.75-1.05 g | PASS |
| Slalom | 19.10 deg | no spin (<90 deg, recovers <5 deg) | PASS |
| Ramp landing | 3.02 deg | <20 deg tilt, >40 mph | PASS |
| Roll stability | 5.42 deg | <15 deg max tilt | PASS |

All 6 of 6 pass. Re-verified via `npx vitest run tests/vehicle-telemetry.test.ts` (23 cases, all green) against the newly committed `defaultTuning()`.

## Decisions Made

See `key-decisions` above for the full rationale on each of the four tuning changes. The most consequential: **`rearSideFriction` is the correct lever for high-speed straight-line stability, not any of the assist gains** — this was proven, not assumed, via a targeted headless sweep after two live in-browser attempts (raising `slideCatchGain`) moved the problem in the wrong direction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Placeholder camera/ground made the checkpoint unusable as shipped**
- **Found during:** the very start of task 1's human checkpoint.
- **Issue:** plan 02-08's temporary chase camera (0,5,9 offset) and the bare ground plane gave no visual reference for speed or lateral slide — the developer could not reliably judge what was happening.
- **Fix:** widened the camera offset to (0,8,16) and added a `THREE.GridHelper` ground grid, both explicitly commented as temporary pending Phase 3's real camera.
- **Files modified:** `src/render/vehicle-view.ts`, `src/main.ts`.
- **Verification:** `npm run typecheck`, `npx vitest run tests/vehicle-scene.test.ts tests/layering.test.ts`, `npm run test`, `npm run build` all green; human-confirmed the fix resolved the readability problem.
- **Committed in:** `82b31f5`.

**2. [Rule 1 - Bug] Unprovoked high-speed spin-out at the shipped `rearSideFriction` default**
- **Found during:** task 1, SC1 verification (step 8's follow-up).
- **Issue:** sustained full-throttle straight-line driving spontaneously spun the car out at ~89 mph, with zero steering input — not a "feel" question, a real instability.
- **Fix:** root-caused via throwaway headless diagnostic scripts (never committed) that isolated the mechanism to `rearSideFriction` under sustained throttle, independent of every assist; raised the default from 0.12 to 0.2, confirmed via a full sweep and re-confirmed live in-browser by the developer.
- **Files modified:** `src/core/vehicle-tuning.ts`, `tests/vehicle-tuning.test.ts`.
- **Verification:** `npx vitest run tests/vehicle-telemetry.test.ts` (23/23 green against the new default); human-confirmed straight-line stability past 100 mph and confirmed the deliberate full-lock power-oversteer move (step 7) is unaffected.
- **Committed in:** `7d01e66`.

---

**Total deviations:** 2 auto-fixed (both Rule 1 bug fixes: one a usability blocker discovered before the checkpoint could proceed, one a genuine physics instability discovered during SC1 verification and root-caused headlessly rather than guessed at live).
**Impact on plan:** Both are exactly the kind of finding this plan exists to surface — issues that only a real human driving session (not headless telemetry) could catch. No scope creep: fixes stayed within the vehicle-tuning/render-placeholder surface this plan and plan 02-08 already own.

## Issues Encountered

- **SC2's gamepad half is unverified** — no gamepad hardware was available this session. Recorded as an open item for Phase 3, not a failure: 02-RESEARCH.md's Open Item A1 (standard-mapping axis indices assumed, unverified) remains open.
- **D-04's brake-understeer effect (from plan 02-07) was not independently re-checked against the new defaults** — the session did check "brake while turning" qualitatively (SC1 step 8, passed) but did not re-run 02-07's isolated symmetric-friction diagnostic tuning. Not expected to matter (that finding was about the shipped RWD-loose bias dominating at low `frictionSlip`, and `rearSideFriction` moved further from symmetric, not closer), but worth a note for Phase 3.

## Known Stubs

- The chase camera remains an explicit placeholder (now wider, but still not the permanent helicopter camera) — Phase 3 owns the real one.

## Threat Flags

None new. T-02-22 (transcription error moving a default outside its tested band) is mitigated exactly as the plan's threat model anticipated: `tests/vehicle-tuning.test.ts`'s recursive `min <= default <= max` check passed against all four new values with no code change needed, and the full telemetry suite re-verified the committed result.

## User Setup Required

None.

## Next Phase Readiness

- Phase 3's surface work and permanent camera should start from these committed defaults, not from 02-RESEARCH.md's original Config A/B — several fields have now been measured-and-corrected twice (once in plan 02-07, again in this session).
- **Phase 3 should re-verify the `rearSideFriction`/high-speed-stability finding once real road surfaces exist** — this session's fix was proven on the phase's flat test ground; a lower-friction surface type could plausibly reopen the same instability at a lower speed.
- The gamepad half of SC2 needs a verification pass whenever hardware is available.

---
*Phase: 02-vehicle-feel-core*
*Completed: 2026-09-11*

## Self-Check: PASSED

`src/core/vehicle-tuning.ts`, `tests/vehicle-tuning.test.ts`, `src/render/vehicle-view.ts` and
`src/main.ts` confirmed modified on disk; commits `82b31f5` and `7d01e66` confirmed in `git log`.
`npx vitest run tests/vehicle-telemetry.test.ts` (23/23), the full suite (330/330), `npm run
typecheck` and `npm run build` all green against the final committed state. The human checkpoint
was performed live across a multi-turn session, with SC1/SC5 sign-off and a genuine bug found,
root-caused headlessly, and fixed rather than tuned around.
