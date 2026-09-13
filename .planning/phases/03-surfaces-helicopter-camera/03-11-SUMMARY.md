---
phase: 03-surfaces-helicopter-camera
plan: 11
subsystem: audio
tags: [three.js, web-audio, positional-audio, biquad-filter, audio-synthesis]

# Dependency graph
requires:
  - phase: 03-surfaces-helicopter-camera (plan 03-03)
    provides: Vehicle.wheelSurfaces (FL/FR/RL/RR SurfaceType array), per-wheel wheelIsInContact/wheelSideImpulse/wheelForwardImpulse
  - phase: 03-surfaces-helicopter-camera (plan 03-02)
    provides: src/render/camera/camera-math.ts dampFactor, the shared frame-rate-independent damping helper
  - phase: 03-surfaces-helicopter-camera (plan 03-10)
    provides: src/main.ts's per-wheel render-callback loop and reused wheelFxInput array this plan's audio arrays are filled alongside
provides:
  - "src/audio/audio-bootstrap.ts: createAudioBootstrap -- camera-attached THREE.AudioListener plus a gesture-gated AudioContext.resume(), registered in every build (never behind the ?debug convention)"
  - "src/audio/surface-loops.ts: SURFACE_LOOP_SPECS (per-surface synthesis recipe), createSynthesizedSurfaceLoops (synchronous, hand-rolled biquad synthesis), loadSurfaceLoops (real-asset upgrade path, unused this plan)"
  - "src/audio/surface-audio.ts: surfaceGains (pure allocation-free gain mixer) and createSurfaceAudio (six crossfaded chassis-attached PositionalAudio channels)"
  - "Composition-root wiring in src/main.ts: audio always constructed, fed from three reused parallel arrays filled in plan 03-10's existing per-wheel loop"
  - "tests/layering.test.ts: new src/audio/** mechanical layering rule"
affects: [03-12-feel-session-playtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-rolled RBJ Audio-EQ-Cookbook biquad filter (lowpass/bandpass) applied in one synchronous pass to a Float32Array, used in place of a real OfflineAudioContext render because that API is unavoidably async and cannot back this module's required synchronous call-site signature"
    - "Loop-point crossfade: blend the tail into the head of a single buffer so a looping AudioBuffer has no audible seam, rather than extending buffer length"
    - "Pure, allocation-free per-surface gain mixer (surfaceGains) writing into a caller-supplied record, mirroring src/physics/vehicle-assists.ts's free-function-with-explicit-parameters shape"
    - "Six always-playing PositionalAudio channels crossfaded by gain only -- never started/stopped per transition, avoiding audible clicks and loop-phase restarts"

key-files:
  created:
    - src/audio/audio-bootstrap.ts
    - src/audio/surface-loops.ts
    - src/audio/surface-audio.ts
  modified:
    - src/main.ts
    - tests/layering.test.ts

key-decisions:
  - "Task 3's human checkpoint resolved as SKIP, decided in advance by the project owner: no external CC0 recordings sourced or downloaded, no public/audio/surfaces/ directory or CREDITS.md created, the shipped audio pipeline runs entirely on createSynthesizedSurfaceLoops"
  - "createSynthesizedSurfaceLoops kept as the plan's own specified SYNCHRONOUS signature by hand-rolling the RBJ cookbook biquad difference equation directly, rather than the plan's literal OfflineAudioContext wording, because OfflineAudioContext.startRendering() is unconditionally async (Promise<AudioBuffer>) and the function's own call site in src/main.ts is never awaited"
  - "surfaceGains' contribution model: WHEEL_SHARE=0.25 per grounded wheel, scaled by a clamped slip-intensity ramp between SLIP_AUDIBLE_THRESHOLD=5 and SLIP_FOR_MAX_GAIN=70 -- both [ASSUMED], retuneable by feel in a future playtest"

patterns-established:
  - "src/audio/ is a new tier alongside src/render/ and src/hud/: may import three and src/core/, must never import @dimforge/rapier3d or write simulation state, and update() runs only from the variable render frame, never the fixed physics tick"

requirements-completed: [SURF-02]

# Metrics
duration: 35min
completed: 2026-09-13
---

# Phase 3 Plan 11: Surface Audio Summary

**Six chassis-attached PositionalAudio channels crossfaded by grounded-wheel slip, playing procedurally-synthesized per-surface loops (a hand-rolled RBJ biquad filter, since a real OfflineAudioContext render can't back the plan's required synchronous call site) -- the project's first working audio system, shipped with no external asset dependency by design.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 automated tasks executed; Task 3 (human checkpoint) resolved as a pre-decided "skip"
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `src/audio/audio-bootstrap.ts`: `createAudioBootstrap` attaches a `THREE.AudioListener` to the camera and arms a gesture-gated `AudioContext.resume()` on `keydown`/`click`, registered directly (never through the `?debug` hotkey convention) so every normal build actually has sound the moment the player first interacts. `resumed()` lets a future playtest confirm the gate fired rather than inferring it from silence.
- `src/audio/surface-loops.ts`: `SURFACE_LOOP_SPECS`, one entry per `SurfaceType`, distinct on at least two of five numeric axes for every pair (D-09), with `tarmac` carrying the highest `cutoffHz` (a bright chirp) and `mud` the lowest (SURF-02's own "muffled rumble" wording, made literal). `createSynthesizedSurfaceLoops` synthesizes all six seamlessly-looping buffers at runtime with zero asset dependency.
- `src/audio/surface-audio.ts`: `surfaceGains`, a pure, allocation-free mixing function (grounded-wheel surface share scaled by clamped slip intensity, six gains summing to at most 1, non-finite slip mapped to 0), and `createSurfaceAudio`, six always-playing chassis-attached `PositionalAudio` channels whose volume is damped toward `surfaceGains`' target every render frame via the shared `dampFactor` helper (not re-derived).
- `src/main.ts`: constructs `audio`/`surfaceAudio` unconditionally (never `DEBUG_ENABLED`-gated, matching the speedometer/camera/surface-FX precedent), feeding `surfaceAudio.update` from three small reused parallel arrays filled in the exact same per-wheel loop plan 03-10 already built for `fx.update` -- no second per-frame object array.
- `tests/layering.test.ts`: a new `src/audio/**` mechanical rule banning `@dimforge/rapier3d` imports and the five simulation-write identifiers, floor raised 28 -> 31 for the three new files.
- Task 3's human checkpoint (sourcing real CC0 tire-surface recordings from Freesound/BigSoundBank/itch.io) was resolved as **SKIP**, per the project owner's advance decision documented in this plan's own launch instructions -- see "Task 3 Resolution" below.

## Task Commits

1. **Task 1: Audio bootstrap and per-surface loop buffers** - `655c158` (feat)
2. **Task 2: Crossfaded per-surface channels, composition wiring, src/audio layering rule** - `24b48dd` (feat)

**Plan metadata:** (this commit) `docs(03-11): complete surface audio plan`

## Task 3 Resolution: SKIP (pre-decided)

Plan 03-11 was launched with `autonomous: false` specifically because Task 3 is a
`checkpoint:human-action` requiring a human to read each candidate CC0 audio asset's own
license page verbatim (Freesound.org, BigSoundBank.com, itch.io's "Essentials Series") before
any file could be committed -- 03-RESEARCH.md's own Pitfall 1 is explicit that a search-result
summary of a site's stated policy is not a license.

The project owner resolved this checkpoint in advance, before execution began, with an explicit
instruction: **synthesize the six surface loops procedurally and skip sourcing external
recordings entirely.** Accordingly:

- No audio file was downloaded, fetched, or committed.
- No `public/audio/surfaces/` directory or `CREDITS.md` was created -- the plan's own acceptance
  criteria treat "no committed audio file, decision recorded" as a fully legitimate outcome, and
  the plan's own `<action>` text states this checkpoint is "never auto-approvable" for a human
  session, but "skip" requires no file changes at all to be a complete, valid resolution.
- `src/main.ts` calls `createSynthesizedSurfaceLoops(audio.listener.context)` directly.
  `loadSurfaceLoops` (the real-asset upgrade path) exists in `src/audio/surface-loops.ts` but has
  no call site anywhere in this plan's shipped code -- confirmed by `grep -rn "loadSurfaceLoops"
  src/main.ts` returning no matches.
- This decision is recorded here, in `STATE.md`'s Accumulated Context (added by the
  orchestrator after this SUMMARY is read), and is fully reversible: a future session can revisit
  Task 3 exactly as written in `03-11-PLAN.md` and wire `loadSurfaceLoops` in without touching any
  other file this plan created.

SURF-02's audio half is fully satisfied by the synthesized loops alone -- nothing is blocked or
stubbed by this decision.

## Files Created/Modified

- `src/audio/audio-bootstrap.ts` - new: `createAudioBootstrap`/`AudioBootstrap`, the gesture-gated listener lifecycle
- `src/audio/surface-loops.ts` - new: `SurfaceLoopSpec`/`SURFACE_LOOP_SPECS`/`createSynthesizedSurfaceLoops`/`loadSurfaceLoops`
- `src/audio/surface-audio.ts` - new: `surfaceGains`/`SurfaceAudio`/`createSurfaceAudio`
- `src/main.ts` - constructs `audio`/`surfaceAudio` unconditionally, fills three reused parallel audio-input arrays in the existing per-wheel FX loop, calls `surfaceAudio.update` after `fx.update` and before `renderer.render`
- `tests/layering.test.ts` - new `src/audio/**` block, `FILES.length` floor raised 28 -> 31

## Decisions Made

- **Task 3 resolved as SKIP** (pre-decided by the project owner) -- see "Task 3 Resolution" above.
- **`createSynthesizedSurfaceLoops` hand-rolls a biquad filter instead of using a real `OfflineAudioContext` render.** The plan's action text describes "rendering through an `OfflineAudioContext` with a `BiquadFilterNode`," but also specifies (and `src/main.ts`'s own un-awaited call site confirms) that this function must be SYNCHRONOUS. `OfflineAudioContext.startRendering()` unconditionally returns a `Promise<AudioBuffer>` per the Web Audio API spec -- there is no way to make a real offline render synchronous. Resolved by implementing the identical RBJ Audio-EQ-Cookbook coefficients a real `BiquadFilterNode` uses internally, applied directly to a `Float32Array` in one pass (`applyBiquadFilter` in `src/audio/surface-loops.ts`). The audible technique (lowpass/bandpass-shaped, grain-modulated, loop-crossfaded noise) is exactly what the plan asks for; only the mechanism avoids an API that is fundamentally incompatible with the plan's own required signature. Documented in the module's own header comment as a DEVIATION, not silently substituted.
- **`surfaceGains`' tuning constants** (`WHEEL_SHARE = 0.25`, `SLIP_AUDIBLE_THRESHOLD = 5`, `SLIP_FOR_MAX_GAIN = 70`) are `[ASSUMED]` starting values with no measured headless session behind them (unlike plan 03-10's particle-FX slip thresholds, which were measured). Retuneable by feel in a future playtest; not wired into `lil-gui` this plan since the plan's own action text does not call for a tuning-panel entry here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome import-order and object-literal formatting**
- **Found during:** Task 2 (`npm run check` / scoped `biome check`)
- **Issue:** Biome's formatter flagged `SURFACE_LOOP_SPECS`' single-line object literals (wanted multi-line) and a single-line array argument in a new test case in `src/audio/surface-loops.ts` and `tests/surface-audio.test.ts`.
- **Fix:** Ran `npx biome check --write` on both files; no behavioural change.
- **Files modified:** `src/audio/surface-loops.ts`, `tests/surface-audio.test.ts`
- **Verification:** `npx biome check` clean on all six files this plan touched; full Vitest suite and `npm run typecheck`/`npm run build` all still pass.
- **Committed in:** `24b48dd` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, mechanical formatting only). No scope creep. The synchronous-synthesis substitution above is documented as a resolved plan self-contradiction (Rule 1-adjacent: the literal API named would not compile into the required call shape), not a Rule 4 architectural question -- the audible technique and public API are unchanged from what the plan specifies.

## Issues Encountered

- **`grep -c "createAudioBootstrap\|createSurfaceAudio" src/main.ts` returns 4, not the plan's stated 2.** The two import statements and the two call-site lines each independently match the alternation, and `grep -c` counts matching LINES. This is the same self-contradictory acceptance-criteria-count issue plan 03-10's own SUMMARY documented for an analogous single-identifier case (`createSurfaceFx`). Manually confirmed: `createAudioBootstrap(` and `createSurfaceAudio(` each appear as a call exactly once, at the composition root, never inside the render callback or any loop.
- `npm run check`'s lint step fails repo-wide on the same pre-existing CRLF-vs-LF formatting issue already logged in `.planning/STATE.md`'s Blockers/Concerns and re-confirmed in plans 03-09/03-10's own SUMMARYs -- 46 errors across files this plan did not touch (`vite.config.ts`, `vitest.config.ts`, `src/core/frame-stats.ts`, `src/core/input-tape.ts`, `src/core/sim-clock.ts`, `src/debug/debug-gate.ts`, `src/debug/profiler-hud.ts`, `src/hud/speedometer.ts`, `src/input/gamepad.ts`, `src/input/keyboard.ts`, `src/input/live-input.ts`, `src/loop.ts`, `src/physics/transform-cache.ts`, and four `tests/vehicle*.test.ts` files). `npx biome check` scoped to this plan's own six touched files (`src/audio/audio-bootstrap.ts`, `src/audio/surface-loops.ts`, `src/audio/surface-audio.ts`, `src/main.ts`, `tests/surface-audio.test.ts`, `tests/layering.test.ts`) reports zero errors. `npm run typecheck`, the full Vitest suite (536/536 passing, up from 516 before this plan), and `npm run build` all exit 0 independently.
- **The actual audible character of the six synthesized loops (chirp vs. rumble distinctness, loop-seam inaudibility, crossfade smoothness during a surface transition) could not be verified this session** -- this is a headless worktree with no browser/Web Audio runtime available. All structural/mechanical acceptance criteria pass (spec-table distinctness, pairwise-difference count, tonal ordering, gain-mixer behaviour contract); the actual on-ear result is unverified until a real browser session (plan 03-12's playtest is the natural place to fill this in, alongside its own existing `?debug` frame-budget verification need).

## User Setup Required

None - no external service configuration required. (Task 3's optional external-asset sourcing was explicitly skipped by design; see "Task 3 Resolution" above.)

## Next Phase Readiness

- SURF-02's audio half is delivered for all six surfaces: distinct on at least two of five axes per pair (D-09), with tarmac/mud implementing the requirement's own "chirp vs. muffled rumble" wording literally via `cutoffHz` ordering.
- The project now has a working spatial-audio spine (`THREE.AudioListener` + `THREE.PositionalAudio`, gesture-unlocked in every build) that CLAUDE.md already names as shared infrastructure a later phase's engine-RPM crossfade will reuse directly.
- `npm run build`, `npm run typecheck`, and the full Vitest suite (536/536) all pass. `git diff --stat package.json` is empty -- no new dependency.
- **Open item for plan 03-12's playtest:** an actual browser session should (a) confirm the six loops genuinely read as chirp-vs-rumble distinct and that gravel/mud read as "heavy"/"muffled" respectively, (b) confirm the loop-point crossfade is inaudible, (c) confirm a two-wheels-on-gravel/two-on-tarmac transition doesn't read as mushy (03-RESEARCH.md Assumption A3's documented revisit trigger), and (d) exercise `audio.resumed()` to confirm the gesture gate fires on first click/keypress.
- `src/audio/surface-loops.ts`'s `SURFACE_LOOP_SPECS` table and `src/audio/surface-audio.ts`'s `SLIP_AUDIBLE_THRESHOLD`/`SLIP_FOR_MAX_GAIN`/`VOLUME_DAMP_LAMBDA` constants are the places a future playtest retunes by feel; none are yet wired into `lil-gui`.
- Task 3's real-CC0-asset upgrade path (`loadSurfaceLoops`) remains fully available and untouched for any future session that wants to revisit the skip decision.

---
*Phase: 03-surfaces-helicopter-camera*
*Completed: 2026-09-13*

## Self-Check: PASSED

All created/modified files verified present on disk (`src/audio/audio-bootstrap.ts`,
`src/audio/surface-loops.ts`, `src/audio/surface-audio.ts`, `src/main.ts`,
`tests/surface-audio.test.ts`, `tests/layering.test.ts`, this SUMMARY.md). Both task
commits (`655c158`, `24b48dd`) confirmed present in `git log`.
