---
quick_id: 260920-j4d
description: "Vehicle handling feels too twitchy/unforgiving: RWD slide recovery too slow, small steering inputs at speed snowball into spin-out"
status: partial
completed: 2026-09-20
---

# Quick Task 260920-j4d: Vehicle Handling Retune Summary

**Partial completion.** The diagnostic tooling (two new headless telemetry routines measuring the exact two reported symptoms, plus locked pass bands proven against a candidate retune) landed on `main`. The actual retune itself — changing `defaultTuning()`'s `powerOversteerGain`/`rearSideFriction` — was explicitly deferred: the developer chose to hand-tune the feel live via the `?debug` panel instead of taking the automated candidate values, and will hand back a final tuning JSON (exportable via the panel's new Export/Import feature, quick task 260920-l94) for those values to be transcribed into `defaultTuning()` properly.

## What Landed on Main

- `src/physics/telemetry/routines.ts` — two new standalone routines (not added to `ROUTINES`, mirroring `handbrakeRoutine`'s precedent):
  - `powerSlideRecoveryRoutine` — measures power-on slide recovery time (the throttle+steer regime the six canonical routines never exercise)
  - `highSpeedPulseRoutine` — a small steering pulse at 90mph, then hands-off, measuring whether the resulting drift decays or diverges
  - `TELEMETRY_TARGETS.powerSlideRecovery` / `.highSpeedPulse` bands locked at `<2.5s` recovery / `<15deg` max, `<3deg` settled — proven against a candidate retune, not against the shipped defaults (see below)
- `tests/vehicle-recovery.test.ts` (new) — full coverage for both routines, including "anti-trivially-green companion" cases proving the gates can actually fail at the shipped (unretuned) values, and "passes the locked band" cases that construct their own tuning object with the candidate values rather than asserting against bare `defaultTuning()`

## What Did NOT Land (Deferred)

- `src/core/vehicle-tuning.ts`'s shipped defaults are **unchanged**: `powerOversteerGain` stays `1.1`, `wheels.rearSideFriction` stays `0.2`.
- The candidate retune found during this task's sweep (`powerOversteerGain: 0.95`, `wheels.rearSideFriction: 0.26`) is proven to clear both new bands (recorded in the routine/test doc comments above) but was never applied — the developer preferred to explore the live tuning panel directly rather than accept the automated candidate outright.
- The plan's Task 3 (human sign-off on the trade-off: `powerOversteerGain` below 1.0 measurably softens the deliberate full-lock power-oversteer move, 67.65° → 26.34° max slip) was never run to completion.

## Root Cause Findings (for whenever the retune is finalized)

Preserved here since the originating branch was deleted after its useful commits were cherry-picked onto main:

1. **`powerOversteerGain` saturates at full lock for any value >= 1.0** (`clamp(gain * throttle * |steer|, 0, 1)`) — the shipped 1.1 and a 1.0 are byte-identical at full throttle + full lock. The extra headroom above 1.0 only affects *partial* steering inputs, which is the reported small-tap oversensitivity.
2. **The oversteer term uses unsigned `|steer|`**, so counter-steering to correct a slide under throttle is treated identically to provoking one.
3. **`slideCatchGain`/`slideCatchDamping` measured zero effect** on the high-speed-pulse divergence, even at their `TUNING_RANGES` maximums (0.6/2.0) — ruling out the under-damped-oscillation hypothesis. The real mechanism is the permanent front/rear grip asymmetry (front `frontSideFriction: 1.0` vs. a much lower rear) sustaining a self-consistent low-angle drift equilibrium once perturbed.
4. **`rearSideFriction` is dispositive** for the high-speed-pulse symptom: nothing below 0.26 (within the plan's own last-resort ceiling) resolved it in the sweep.

## User Feedback From Manual Experimentation (this session)

- Raising `wheels.rearSideFriction` to `0.25` (live, via the tuning panel) "made it feel better" — close to the automated sweep's own 0.26 finding.
- Handbrake-induced slides don't kick the back out as much as expected — pointed at `drive.handbrakeRearSideFriction` (default `0.01`, range `0-0.05`), the rear-axle grip value the car snaps to while the handbrake is held, separate from the baseline `rearSideFriction`. Lower = more kick-out.

## Next Step

When the developer is satisfied with the live-tuned feel, export the tuning JSON from the `?debug` panel and hand it over. Transcribing it into `defaultTuning()` should: (1) update the changed constants with the established old-value/new-value/measured/why doc-comment style, (2) update `tests/vehicle-tuning.test.ts` literals, (3) re-verify `tests/vehicle-recovery.test.ts`'s "passes the locked band" cases against the NEW bare `defaultTuning()` (they can drop their explicit tuning overrides once the shipped defaults carry the final values), and (4) re-run the full telemetry suite to confirm no other gate regresses.

## Process Note

The original executor worktree (`worktree-agent-a2d9a3ca036d82df1`) was removed after its two commits (diagnostic routines, then the candidate retune) were cherry-picked onto `main` — the retune commit's `vehicle-tuning.ts`/`vehicle-tuning.test.ts` changes were deliberately excluded from the cherry-pick per the developer's instruction to defer the retune. The executor's own uncommitted `260920-j4d-SUMMARY.md` inside that worktree was lost when the worktree was removed (a cleanup-ordering mistake — it should have been rescued first, mirroring the quick-task workflow's own "rescue SUMMARY.md before worktree removal" step). This SUMMARY.md reconstructs the same information from the two commits' detailed messages, which were still present in the local object database at reconstruction time.

---
*Quick task: 260920-j4d*
*Status: partial — diagnostic tooling shipped, retune deferred to manual tuning*
