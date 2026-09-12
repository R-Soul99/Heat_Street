---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 3 context gathered
last_updated: "2026-09-12T01:51:54.003Z"
last_activity: 2026-09-11
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 17
  completed_plans: 17
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** The driving itself must feel weighty, cinematic, and replayable — big slides, tire smoke, jumps, and a heavy rear-wheel-drive-loose feel — with medal-time chasing giving every route long-term replay value.
**Current focus:** Phase 02 — vehicle-feel-core COMPLETE. Phase 03 (surfaces-and-helicopter-camera) not yet planned.

## Current Position

Phase: 02 (vehicle-feel-core) — COMPLETE (10/10 plans)
Phase: 03 (surfaces-and-helicopter-camera) — NOT STARTED (not yet broken into plans)
Last activity: 2026-09-11

Progress (phases 1-2 of 8, the only ones planned so far): [██████████] 100% of 17 known plans

## Performance Metrics

**Velocity:**

- Total plans completed: 14
- Average duration: 15 min
- Total execution time: 1.7 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 engine-foundation | 7 | 103 min | 15 min |
| 01 | 7 | - | - |

**Per-plan detail:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 13 min | 3 | 11 |
| Phase 01 P02 | 6 min | 3 | 7 |
| Phase 01 P03 | 11 min | 3 | 11 |
| Phase 01 P04 | 12 min | 3 | 5 |
| Phase 01 P05 | 7 min | 3 | 4 |
| Phase 01 P06 | 6 min | 2 | 5 |
| Phase 01 P07 | 48 min | 3 | 4 |

**Recent Trend:**

- Last 5 plans: 12 min, 7 min, 6 min, 48 min
- Trend: → P07's 48 min is dominated by wall-clock wait on the two-pass human browser-verification checkpoint (SC2/SC3/SC4), not active implementation time — the bug found on the first pass was fixed and re-verified within the same session. Phase 1 complete: 7/7 plans, 103 min total.

*Updated after each plan completion*

> Note: `gsd-sdk query state.record-metric` appends its row AFTER this line rather
> than into the Per-plan detail table above. Move it up and refresh the velocity
> rollup by hand after each plan, as was done for P04, P05, P06 and P07.
| Phase 02 P01 | 20 min | 2 tasks | 3 files |
| Phase 02 P02 | 20 min | 3 tasks | 4 files |
| Phase 02 P03 | 9 min | 2 tasks | 2 files |
| Phase 02 P04 | 40 min | 2 tasks | 3 files |
| Phase 02 P05 | 15min | 2 tasks | 3 files |
| Phase 02 P06 | 23min | 2 tasks | 3 files |
| Phase 02 P07 | 55min | 3 tasks | 5 files |
| Phase 02 P08 | 35min | 3 tasks | 3 files |
| Phase 02 P09 | 20min | 3 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Map data source is OpenStreetMap + open DEM — no Google-sourced bytes may enter the shipped pipeline (P0 legal decision, must be frozen in Phase 1)
- [Roadmap]: Fixed-timestep physics from Phase 1, non-negotiable — variable timestep would invalidate the entire medal system
- [Roadmap]: Helicopter camera is prototyped in Phase 3 with an explicit go/no-go "does 100mph read as fast?" gate, with a low chase-cam fallback kept alive
- [Roadmap]: v1 scope frozen to one area, three modes (P2P/Circuit/Getaway), one car; Survival, area unlock and heat tiers 4-5 deferred to v2
- [Phase 01-01]: optimizeDeps.exclude for @dimforge/rapier3d is REQUIRED in vite.config.ts — Vite's esbuild pre-bundler duplicates the wasm-bindgen glue and breaks Rapier at runtime in dev; do not remove it
- [Phase 01-01]: All dependencies pinned to exact version literals (no caret/tilde) — a three or Rapier patch bump can alter solver behaviour and invalidate recorded medal times
- [Phase 01-02]: The run clock is SimClock.simTimeSec (tick * DT) and nothing else — src/core/ contains no wall-clock read, so medal times are reproducible by construction
- [Phase 01-02]: Fixed-step target is recomputed absolutely from nowMs every frame — an acc += frameDelta accumulator loses a tick at 144fps (599 vs 600, measured and now regression-tested) and must never be reintroduced
- [Phase 01-02]: Alt-tab handling is clamp AND rebaseline, not either/or — clamp alone fast-forwards 300 ticks into the first second back instead of 60; both numbers are asserted in tests/sim-clock.test.ts
- [Phase 01-02]: Doc/code mirroring tests must match values WITH their units ("4.0 ms", not "4") — String(4.0) is "4", which occurs incidentally in prose, so the naive form stays green through real drift
- [Phase 01-02]: Tests read repo files via Vite's ?raw transform rather than node:fs — @types/node is not installed and the phase threat model forbids new packages; later file-scanning tests should use import.meta.glob with query ?raw
- [Phase 01-03]: Map data is OpenStreetMap under ODbL 1.0 plus an open DEM (USGS 3DEP inside the US, Copernicus GLO-30 globally) — frozen in docs/adr/0001-map-data-source.md, which supersedes the design doc, CLAUDE.md and STACK.md
- [Phase 01-03]: Compiled *.map.json artifacts ship under ODbL 1.0 (LICENSE-MAPDATA) — the free safe path on the open Derivative Database question; compiled .glb is treated as a Produced Work
- [Phase 01-03]: surface is a closed six-value game enum parsed FROM docs/schemas/road-graph.v1.md by the test, not hardcoded — the Phase 4 compiler owns the OSM mapping and must fail the BUILD on an unmapped value
- [Phase 01-03]: CLAUDE.md lines 28-219 are GENERATED from .planning/research/STACK.md — always amend the source, or a regeneration silently reverts the edit
- [Phase 01-03]: Repo-scanning tests use import.meta.glob with an INLINE query ?raw eager literal — options must not be a named const, keys are directory-relative, and the importing module is excluded from its own glob
- [Phase 01-04]: VEH-03 is proven by byte-equality of world.takeSnapshot() bytes (FNV-1a fingerprint), never by comparing positions with an epsilon — a float comparison passes while islands, sleeping flags and contact caches have already diverged
- [Phase 01-04]: Rapier's Real is f32, so world.timestep reads back as Math.fround(DT) = 0.01666666753590107, not the f64 DT — assert against Math.fround(DT); it is a one-time constant rounding, not an accumulating error, and the run clock stays tick * DT
- [Phase 01-04]: The SC2 always-moving body is a kinematicPositionBased spinner rotated by an angle that is a pure function of the tick index (PATTERNS.md R2) — the six dynamic boxes all sleep by step 600, measured
- [Phase 01-04]: TransformCache exposes raw stride-7 Float64Array prev/cur buffers and never applies transforms to meshes, keeping src/physics/ free of three — src/render/interpolator.ts in plan 01-05 owns the lerp/slerp
- [Phase 01-05]: Interpolation is a free function in src/render/interpolator.ts reading TransformCache's raw buffers, not a TransformCache method — closes the placement question 01-PATTERNS.md left open and keeps src/physics/ free of three
- [Phase 01-05]: The short-arc slerp guard drives cur from the NEGATED quaternion — a plain 175-degree rotation is short-way under both slerp and a naive lerp, so that test would have been decorative; measured 87.5 vs exactly 92.5 degrees
- [Phase 01-05]: Never compare quaternions with angleTo when the expected angle is near zero — it is 2*acos(dot) and acos is ill-conditioned there, so one-ULP-apart quaternions report ~3e-8 rad; compare components instead
- [Phase 01-05]: renderer.info.autoReset stays at its default true, so the 01-06 HUD must read renderer.info AFTER the draw; it must become false with a manual reset() if any later phase draws more than once per frame
- [Phase 01-05]: The render mesh array order is a contract with DebugScene.bodies and TransformCache — createDebugRenderScene takes bodyCount and spinnerIndex as parameters and range-validates them, and the ground is excluded from meshes (T-01-16)
- [Phase 01-06]: The ?debug + Backquote hotkey convention in src/debug/debug-gate.ts is the exact shape Phase 2's lil-gui tuning panel should reuse
- [Phase 01-06]: Acceptance greps are design constraints on comments too — frame-stats.ts's doc comment avoids the literal substring "import" entirely, not just an actual import statement
- [Phase 01-07]: Stall handling needs a third, environment-agnostic mechanism beyond clamp + visibilitychange -- a same-frame wall-clock dt-spike (>2000ms) rebaselines immediately, before stepsFor runs, because visibilitychange is not guaranteed to fire promptly (or at all) in every OS/window-manager configuration
- [Phase 02-01]: CLAUDE.md's tuning table (mass 10, stiffness 24, frictionSlip 1000, engine force +/-30) is superseded by 02-RESEARCH.md's measured Config A/B -- documented as a DEVIATION comment in vehicle-tuning.ts; the fix belongs in .planning/research/STACK.md since CLAUDE.md lines 28-219 are generated
- [Phase 02-01]: serializeTuning persists the plain VehicleTuning object rather than lil-gui's own gui.save() format, because lil-gui cannot be imported under Vitest's node environment and that would make the D-17 security test suite unrunnable
- [Phase 02-02]: createKeyboard() returns an inert all-neutral handle rather than throwing when document is undefined, so new LiveInputSource() with zero injected deps is always safe to construct outside a browser
- [Phase 02-02]: Node's built-in navigator global is a partial object (no getGamepads), not absent -- readGamepad() must degrade to null in both cases, verified empirically rather than assumed
- [Phase 02-03]: Doc comments describe forbidden techniques (vehicle-controller speed getter, DOM-write throttling, CSS transitions) by behavior rather than literal identifier, resolving a plan self-contradiction between action-mandated warning comments and acceptance-criteria zero-count greps on those same identifiers
- [Phase 02-03]: src/hud/speedometer.ts builds every SVG element with a direct document.createElementNS(SVG_NS, tag) call at its own site rather than a private wrapper, keeping the literal createElementNS count auditable against the plan's >=8 acceptance floor
- [Phase 02-04]: Rapier setAdditionalMassProperties needs recomputeMassPropertiesFromColliders() to take effect before the next world.step() — Otherwise tick 0's applyTorqueImpulse divides by the tiny collider-default inertia instead of the cached principal inertia, inflating angular response ~180x on the first tick
- [Phase 02-04]: Auto-level assist torque axis corrected to (-up.z, 0, up.x), the negation of 02-RESEARCH.md/02-04-PLAN.md's stated (up.z, 0, -up.x) — Verified empirically: the documented sign drives a tilted chassis further from level instead of recovering
- [Phase 02-04]: boxPrincipalInertia's Config A test anchor corrected from the documented {3080,3480,512} to the formula-derived {3078.7,3426.7,614.7} — The stated anchor's I.y/I.z do not match evaluating the (correct, unambiguous) box-inertia formula against Config A's actual shipped mass/halfExtents
- [Phase 02-05]: isTextEntryFocused falls back to a duck-typed tagName/isContentEditable check when HTMLInputElement/HTMLTextAreaElement/HTMLElement are undefined (Node), rather than requiring jsdom
- [Phase 02-05]: src/hud/** layering rule deliberately omits a document. ban (HUD legitimately calls document.createElementNS) and does not duplicate the repo-wide performance. ban -- both omissions commented in place
- [Phase 02-06]: Ramp geometry (02-RESEARCH.md Open Question 2) solved as a ColliderDesc.convexHull wedge with a knife-edge leading edge flush at y=0 — Verified empirically: monotonic climb, airborne launch past the 1.6m crest, 1.68deg tilt / 42.4mph 0.5s after touchdown -- not assumed
- [Phase 02-06]: src/render/vehicle-view.ts hardcodes ground/ramp visual dimensions matching src/physics/vehicle-scene.ts rather than importing from it — Keeps the render module a pure, physics-import-free concern (mirroring debug-scene.ts's own ground-visual precedent), with a MUST MATCH comment as the cross-reference
- [Phase 02-07]: engineForcePerRearWheel corrected 4000N -> 3650N — the shipped vehicle.ts/vehicle-assists.ts code (post plan 02-04's inertia and auto-level-sign fixes) measures 5.9s 0-60 at 4000N, missing D-14's locked 6.0-7.0s band; 3650N measures 6.52s
- [Phase 02-07]: bodyRollGain corrected 0.1 -> 0.08 — at 0.1 the handbrake routine's own 34deg slide reaches 15.40deg of chassis tilt, over the roll-assist-stability gate's 15deg cutoff; 0.08 keeps all six canonical routines under 15deg (worst case 12.15deg) while the 0.20 companion still clearly fails
- [Phase 02-07]: D-04's brake-understeer does NOT emerge at the shipped default tuning — the RWD-loose rearSideFriction 0.12 bias dominates and braking measurably TIGHTENS the cornering radius (oversteer) at every steer angle/frictionSlip combination tried against literal defaultTuning(); isolated with a dedicated symmetric-friction, frictionSlip 0.5 test tuning instead, and flagged for the human playtest session (02-10) since it's a real divergence from 02-RESEARCH.md's assumption
- [Phase 02-07]: runRoutine/runAllRoutines in src/physics/telemetry/run.ts is the single shared harness both the Vitest suite (against defaultTuning()) and plan 02-09's browser tuning panel (against LIVE-tuned values) call — this is what makes SC5's "retuned live and re-verified with no code edit" literal rather than aspirational
- [Phase 02-08]: LoopDeps.render gained a second dtMs parameter rather than routing the speedometer through the existing DEBUG_ENABLED-gated hud callback — the speedometer is player-facing and always on, so that routing would have silently made the gauge a debug-only feature
- [Phase 02-08]: src/main.ts's camera is a temporary fixed-offset chase cam (behind/above the chassis, recomputed from live translation every frame) — explicitly a placeholder per 02-RESEARCH.md Open Question 1, replaced by Phase 3's permanent helicopter camera
- [Phase 02-08]: Human browser checkpoint passed all 10 steps on the first pass (steering direction, wheel spin/turn/suspension, braking dive, handbrake slide-and-recover, ramp climb-launch-land, speedometer tracking + 120mph amber transition, ?debug HUD gate) — no fixes required
- [Phase 02-09]: lil-gui imported from three's bundled `three/addons/libs/lil-gui.module.min.js`, not installed as a dependency — zero net package.json change, per 02-RESEARCH.md's Package Legitimacy Audit
- [Phase 02-09]: createTuningPanel/createTelemetryHud are gate-free (never check DEBUG_ENABLED internally) — src/main.ts does the gating, matching createHud's existing convention rather than 02-RESEARCH.md/02-UI-SPEC.md's originally-stated internal-null-return approach
- [Phase 02-09]: Wheel tuning properties bind on lil-gui's .onChange (live, per-frame safe); chassis.mass/comOffset/halfExtents bind on .onFinishChange only — a slider DRAG on those would call setAdditionalMassProperties mid-drag and invalidate the cached principal inertia (Pitfall 10)
- [Phase 02-09]: telemetry-hud's Run button does not auto-run on panel open — an unexpected ~100-300ms frame stall mid-drive would be a bad surprise; the run is always a deliberate button press
- [Phase 02-10]: rearSideFriction corrected 0.12 -> 0.2 — sustained full-throttle straight-line driving with ZERO steering input spontaneously spun the car out at ~89mph at the old default; root-caused headlessly (not the assists, not wheelspin/differential asymmetry, not a generic speed-based instability — coasting at any speed to 120mph is stable). It is specific to sustained throttle plus low rearSideFriction: a symmetric, exponentially-growing lateral force builds under power and a microscopic L/R asymmetry eventually couples it into yaw. 0.2 pushes the onset past 120mph+ and does not blunt the deliberate full-lock power-oversteer move (powerOversteerGain's lerp already reaches the handbrake value there regardless of baseline). Phase 3 should re-verify this on real road surfaces — a lower-friction surface type could reopen it at a lower speed.
- [Phase 02-10]: powerOversteerGain corrected 0.5 -> 1.1 (never swept before this session) — 0.5 and 1.0 produced no throttle-oversteer at full lock, 1.3 spun into a full doughnut; 1.1 gives a controllable, readable step-out
- [Phase 02-10]: bodyRollGain raised 0.08 -> 0.12 for the Bullitt-anchor feel (flat at 0.08); roll-assist-stability CI gate still passes (5.42deg max, under the 15deg cutoff)
- [Phase 02-10]: slideCatchGain raised 0.1 -> 0.12; raising it further to 0.3 during the instability diagnosis made the high-speed spin trigger EARLIER, confirming slideCatchGain was never the mechanism behind that bug
- [Phase 02-10]: src/main.ts's placeholder chase camera widened (0,5,9) -> (0,8,16) and src/render/vehicle-view.ts gained a THREE.GridHelper ground reference grid — the tighter camera and featureless ground from plan 02-08 made it impossible to judge speed/slip during the feel session; both still explicit placeholders pending Phase 3's real camera
- [Phase 02-10]: SC2's gamepad half is unverified (no hardware available this session) — open item for Phase 3, along with 02-RESEARCH.md's unverified standard-mapping axis assumption (A1)

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- REQUIREMENTS.md previously stated 29 v1 requirements; the actual traceability list is 30. Corrected during roadmap creation.
- RESOLVED (Phase 2, plan 02-10): Rapier's raycast vehicle DOES reach the "arcade-realistic hybrid" feel — human-signed-off on SC1/SC5 in the plan 02-10 feel session. The residual open risk is narrower: a genuine high-speed straight-line instability was found and fixed (rearSideFriction 0.12->0.2, see the Phase 02-10 decision above); Phase 3 should re-verify it holds once real road surfaces (lower friction than the flat test ground) exist.
- Open question (Phase 4): whether the existing extraction tool already emits usable road-graph topology, or whether the map-compiler must build it from scratch
- Open item (Phase 3): SC2's gamepad half was never verified in Phase 2 (no hardware available) — verify proportional steering and analog triggers, and 02-RESEARCH.md's unverified standard-mapping axis-index assumption (A1), once a gamepad is available
- [Phase 2, all plans] Repo-wide CRLF-vs-LF working-directory line-ending mismatch (`core.autocrlf=true` on this Windows checkout vs LF-normalized committed blobs) makes `npm run check`'s Biome step fail on files never touched by any Phase 2 plan. Confirmed pre-existing and cosmetic (committed content is correct LF); logged in `.planning/phases/02-vehicle-feel-core/deferred-items.md` with a fix path (`.gitattributes` with `* text=lf` + renormalize, or `biome.json`'s `formatter.lineEnding: "crlf"`). Worth resolving before Phase 3 so `npm run check` is trustworthy again as a single green/red signal.
- [01-01] 01-RESEARCH.md 'State of the Art' claims Vite 8.2.2 pre-bundles Rapier correctly — disproven at runtime (dev-only TypeError). That claim and 01-01-PLAN.md's 'no optimizeDeps.exclude anywhere' success criterion should be corrected at phase verification
- [01-03] Six Google-Maps-pipeline references remain in .planning/ (research/STACK.md 92/212/300, research/ARCHITECTURE.md 367, research/FEATURES.md 73/247, PROJECT.md 75) — deliberately outside the decided grep scope, covered by the STACK.md supersession banner. Upgrade path if ever needed is PATTERNS.md R1 option (b).
- [01-06] src/main.ts:21 contains the literal substring "innerHTML" inside a comment stating the DOM-XSS mitigation ("textContent only — never innerHTML"), pre-dating this plan. A repo-wide `grep -rn "innerHTML" src/` (the plan's own verification step 3) will surface this one line even though it documents a prohibition rather than a violation; src/debug/ itself is clean. Worth a note at phase verification.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-09-12T01:51:53.985Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-surfaces-helicopter-camera/03-CONTEXT.md
