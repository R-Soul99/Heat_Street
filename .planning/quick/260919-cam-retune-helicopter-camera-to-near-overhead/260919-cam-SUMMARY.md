---
phase: quick
plan: 260919-cam
subsystem: camera
tags: [camera-tuning, helicopter-cam, occlusion]

# Dependency graph
requires:
  - phase: 03-surfaces-helicopter-camera
    provides: the permanent helicopter CameraRig, the speed-curve framing model, the CAM-04 occlusion fade/steepen mitigation
provides:
  - A near-overhead (~79.9 deg, constant across the speed curve) permanent helicopter camera baseline, replacing the old ~41 deg high-angle chase-cam pitch
  - occlusion.basePitchDeg/maxPitchDeg realigned (80/88) so the steepen mitigation still has headroom above the new baseline
  - Widened CAMERA_TUNING_RANGES.framing.{low,high}AltitudeM ceiling (80 -> 120) so the new default and future tuning both fit
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A framing low/high pair can hold pitch EXACTLY constant (not just close) across the whole framingForSpeed curve by scaling altitude and distance by the identical factor between low and high, since the interpolation is linear in both legs — used here (45:8 low, 90:16 high, both ratio 5.625) in place of the old curve's approximately-but-not-exactly-constant ratio"

key-files:
  created: []
  modified:
    - src/render/camera/camera-math.ts
    - src/core/camera-tuning.ts
    - tests/camera-tuning.test.ts
    - .planning/STATE.md

key-decisions:
  - "Target baseline pitch: ~79.9 degrees (atan(45/8)), inside the developer's requested 75-85 degree band, chosen as the ratio that lets low (45m/8m) and high (90m/16m) framing be an exact 2x scale-up of each other, holding pitch PERFECTLY constant (zero drift) across the whole speed curve rather than merely close at the two endpoints"
  - "occlusion.basePitchDeg raised 41 -> 80 (aligned to the new geometric baseline); occlusion.maxPitchDeg raised 78 -> 88 (kept strictly above basePitchDeg, using nearly all of the existing 10-89 range, so steepen still has real headroom toward vertical)"
  - "chaseFallback (D-12's debug fallback rig) deliberately left untouched — it exists to reproduce Phase 2 plan 02-10's signed-off feel-session view byte-for-byte, and is explicitly decoupled from the permanent rig's angle by design"
  - "tests/occlusion.test.ts's DENSE_BUILDINGS density-to-pitch anchor (quick task 260913-epf) left untouched — it hardcodes its own literal 41/78 degree inputs to document a historical investigation snapshot and does not read live tuning, so it is unaffected by this retune and correctly out of this plan's scope"
  - "fovDeg values left untouched despite the ~2.15x greater camera-to-target 3D distance (hypot(altitude,distance)) this produces — a smaller car with more visible surrounding context is the intended effect of a genuine area/route-visibility helicopter shot, not a regression needing FOV compensation"

patterns-established:
  - "When retuning a framing curve's altitude/distance pair for a target pitch, prefer scaling both legs by an identical low->high factor over independently choosing four numbers — it makes 'pitch held constant across the whole curve' an exact, test-provable property instead of an approximation only checked at the two speed endpoints"

requirements-completed: []

# Metrics
duration: ~20min
completed: 2026-09-19
---

# Quick Task 260919-cam: Retune helicopter camera to near-overhead Summary

**Retuned the permanent helicopter camera rig's baseline pitch from ~41 degrees (a high chase-cam angle) to a constant ~79.9 degrees (a near-overhead "news helicopter" angle), per the developer's direction that the permanent cam's job is area/route visibility, not a chase angle. Values-only change; no mechanics touched.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 1 completed
- **Files modified:** 4

## Accomplishments

- `defaultCameraTuning()`'s `framing.{low,high}{Altitude,Distance}M` retuned so `atan(altitudeM/distanceM)` is a constant ~79.9 degrees at every point `framingForSpeed` interpolates (not just close at the two speed endpoints) — `lowAltitudeM: 45, lowDistanceM: 8` and `highAltitudeM: 90, highDistanceM: 16`, an exact 2x scale-up preserving the identical 5.625 ratio
- `occlusion.basePitchDeg`/`occlusion.maxPitchDeg` raised from 41/78 to 80/88, keeping the steepen mitigation's headroom above the (now much higher) baseline
- `CAMERA_TUNING_RANGES.framing.{low,high}AltitudeM.max` widened 80 -> 120 so the new 90m default (and future tuning) stays inside its declared clamp range
- `camera-math.ts`'s stale "high ANGLE, not a top-down" doc comment updated to describe the near-overhead "news chopper" framing
- `tests/camera-tuning.test.ts` gained an explicit 75-85 degree band assertion plus two new alignment/headroom assertions for the occlusion pitch fields, so the intent (not just "doesn't drift") is directly tested
- `.planning/STATE.md`'s `[Phase 04-11, open, low-cost]` "camera reads too low/close" item marked RESOLVED with the new values and the rationale for leaving `chaseFallback` untouched

## Files Created/Modified

- `src/render/camera/camera-math.ts` - Updated `CameraSpeedCurve`'s doc comment from "a high ANGLE, not a top-down" to "a near-overhead 'news chopper' shot, not a fixed pure top-down"; no code/logic change
- `src/core/camera-tuning.ts` - `framing.{low,high}{Altitude,Distance}M` values retuned; `CAMERA_TUNING_RANGES.framing.{low,high}AltitudeM.max` widened 80->120; `occlusion.basePitchDeg`/`maxPitchDeg` values and doc comments updated 41/78 -> 80/88; `highFovDeg`'s "SC4 separation proof" doc comment updated with the new arithmetic
- `tests/camera-tuning.test.ts` - Added a 75-85 degree band assertion (new test), an `occlusion.basePitchDeg` alignment assertion, and an `occlusion.maxPitchDeg > basePitchDeg` headroom assertion; kept the existing near-constant-pitch test (now proving a stronger, exact-zero-drift property)
- `.planning/STATE.md` - Marked the Phase 04-11 "camera reads too low" open item RESOLVED with a pointer to this quick task

## Decisions Made

- Chose the 45:8 (low) / 90:16 (high) altitude:distance pairing specifically because it is an exact 2x scale-up at an identical 5.625 ratio, which makes "pitch held constant across the whole speed curve" an EXACT property (verified: pitch is bit-for-bit identical at every interpolation fraction `t`, since `altitude(t) = 45*(1+t)` and `distance(t) = 8*(1+t)` share the same `(1+t)` factor) rather than the old curve's "close at both ends" approximation (41.19 deg vs 40.91 deg).
- `occlusion.basePitchDeg` set to 80 (a round number close to the geometric 79.9 deg), matching the existing convention where the old 41 was itself a round number close to the geometric 41.19/40.91.
- `occlusion.maxPitchDeg` set to 88 rather than the range's literal ceiling (89), leaving one degree of margin before the `CAMERA_TUNING_RANGES.occlusion.maxPitchDeg` clamp bound so a `?debug` lil-gui slider nudge doesn't immediately hit the wall.
- Left `chaseFallback` and `fovDeg` untouched — both explicitly reasoned about and excluded (see key-decisions above), not overlooked.
- Did not touch `tests/occlusion.test.ts` — confirmed it hardcodes its own 41/78 degree literals as direct function inputs rather than reading `defaultCameraTuning()`, so it remains a valid, decoupled historical record of the DENSE_BUILDINGS investigation and needs no update.

## Deviations from Plan

None — executed as planned. The plan's own investigation (picking a ratio that holds pitch exactly constant) was carried out as the single task, with no discovered blockers.

## Issues Encountered

The new `highAltitudeM: 90` default initially exceeded `CAMERA_TUNING_RANGES.framing.highAltitudeM`'s old `max: 80`, which `tests/camera-tuning.test.ts`'s range-bound test caught immediately (a default outside its own declared range gets silently clamped away by `clampCameraTuning`/`parseSavedCameraTuning` on the very next round-trip — exactly the failure mode that test exists to catch). Fixed by widening both `lowAltitudeM`/`highAltitudeM` ranges to `max: 120`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

This was a self-contained values-only retune; nothing downstream is blocked or newly unblocked by it. The developer should preview the new angle with `npm run dev` (optionally `?debug` to live-tune further via the lil-gui panel) and confirm it reads as the intended "news helicopter looking down" feel — these are `[ASSUMED]` starting values by the codebase's own convention (see `defaultCameraTuning()`'s doc comment), not a locked decision, exactly like the original ~41 degree values were before this retune.

---
*Phase: quick*
*Completed: 2026-09-19*
