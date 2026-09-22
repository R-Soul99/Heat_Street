# Phase 7: NPC Driving AI & Circuit Racers - Research

**Researched:** 2026-09-22
**Domain:** Path-following vehicle AI (pure pursuit + curvature speed profiling) over an existing Rapier raycast-vehicle / fixed-tick sim, wired through the codebase's own `InputSource` abstraction
**Confidence:** HIGH on architecture/wiring (read directly from shipped source), MEDIUM on the AI-algorithm tuning constants (well-established robotics formulas, but never run against this specific car/track)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Field & Start**
- D-01: Field is 3 AI racers + the player (4-car race).
- D-02: AI racers drive the exact same car and tune as the player, recolored with a distinct paint per racer. No different car classes, no different bodies.
- D-03: Player starts at the back of the grid. AI occupy the three grid slots ahead.
- D-04 (Claude's call): Circuit Race uses a staggered grid behind the start line with a 3-2-1-GO countdown; all cars launch on GO and the race timer starts on GO (sim-clock derived, per Phase 6 D-05). Solo Time Attack keeps Phase 6 D-04's start-on-first-movement unchanged.

**Modes, Medals & Placing**
- D-05: Separate modes. The existing Circuit stays a solo Time Attack with its current medals, reference runs and saved bests — untouched. "Circuit Race" (with AI) is its own course card with its own persisted bests. Traffic can never pollute a medal time.
- D-06: Finishing position is shown live and saved: live position on the HUD, final place on the results view, and best finish per course persisted alongside best time for Circuit Race (same local-only, schema-versioned, corruption-tolerant persistence rules as Phase 6 D-07/D-09). No unlocks.
- D-07: When the player finishes, AI keep driving until they finish, and the final order is shown as they cross. The player can interrupt at any moment to retry; interrupting immediately projects the remaining AI's placings from race progress (lap + checkpoint + distance along path) and ends the race. Retry must keep the Phase 5 fast-retry feel.
- D-08: Player respawn (checkpoint reset): AI keep racing — the respawn costs the player time and positions. Full restart: everyone resets to the grid and the countdown reruns.

**AI Pace & Temperament**
- D-09: One fixed difficulty at roughly Silver pace of the circuit's reference run: a clean Silver-level drive beats them, a messy one loses. Pace is fixed per race — no rubber-banding, catch-up, or speed multipliers anywhere in the code (CIRC-02, REQUIREMENTS anti-feature list).
- D-10: Temperament: race their own line with mild avoidance — they avoid rear-ending the player/other cars but do not yield, block or defend. Contact in tight corners is allowed to happen naturally. No deliberate ramming (that is Phase 8 PIT territory).
- D-11: AI follow a smoothed racing line derived from the road graph, cutting apexes within the road width (edge `widthM`) but never through scenery or off-road. No authored gravel shortcuts.
- D-12: AI aim for tidy grip driving. They slide when physics makes them (gravel, overcooked corners) and must recover, but they do not handbrake-drift or power-oversteer on purpose.

**Stuck Cars & Readability**
- D-13: Stuck/flipped/wedged recovery: first try to drive out (a few seconds of reverse + steer-out), then if still stuck, reset onto the road at its last checkpoint — the same rule as the player's respawn, including the same time cost. Prefer performing resets while the car is off-camera.
- D-14: AI racers appear on the existing minimap as dots colored to match their paint, with edge blips when outside the minimap radius (same treatment as checkpoints, Phase 5 D-10).
- D-15: The `?debug` AI overlay shows all four: each AI's planned racing line (world space), current look-ahead target plus steer/throttle/brake values, a state label (racing / avoiding / recovering / reset) above each car, and a stuck/no-progress timer.
- D-16: Race HUD shows position + lap + gap to car ahead (e.g. `P3/4 · Lap 2/3 · +1.4s`), placed in/near the existing top-right timing area without colliding with the speedometer or split display.

### Claude's Discretion
- Countdown presentation and exact grid spacing/stagger (D-04).
- How Circuit Race is represented in course data — a new `CourseMode`, a race-variant flag on the existing circuit, or a separate course entry reusing the same checkpoints — provided solo Time Attack IDs, references and saved bests are not invalidated.
- The AI controller algorithm (pure-pursuit vs. other path-follower, speed-profile planning from path curvature, how Silver pace is calibrated), provided it outputs `InputFrame`s only and is deterministic on the fixed tick.
- Exact stuck thresholds and drive-out duration (D-13), AI paint colors (D-02/D-14).
- How the "gap to car ahead" is computed (time at shared progress points is preferred over distance) and what shows when the player is P1.

### Deferred Ideas (OUT OF SCOPE)
- New maps: a city map, plus small areas with short tracks. Needs its own roadmap discussion.
- Author a shorter, tighter course on the Juliette map — deferred to the new-maps discussion; Phase 7 races the existing `juliette-three-lap-loop`.
- Support configurable drivetrain type per car class — not needed because AI drive the player's exact RWD car (D-02); stays deferred for a future car-classes phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CIRC-02 | AI racers compete in Circuit mode at a fixed difficulty with no rubber-banding | Architecture Patterns (AI-as-`InputSource`, racing-line pipeline, speed-profile-from-curvature), Common Pitfalls (rubber-banding traps), Code Examples (pure pursuit + curvature formulas), Runtime/perf grounding in Frame Budget section |
</phase_requirements>

## Summary

Phase 7 is almost entirely a **composition and algorithm problem**, not a new-subsystem problem. Every piece of infrastructure CIRC-02 needs already exists and was explicitly built generic for this phase: `createVehicle()` (`src/physics/vehicle.ts`) is a config-in/controller-out factory with a doc comment stating "Phase 7/8 constructs pursuers through this exact same call"; `InputSource`/`InputFrame` (`src/core/input-tape.ts`) is the sole channel that drives a vehicle, so an AI driver that only implements `sampleForTick(tick): InputFrame` structurally satisfies "nothing writes their transforms" — there is no other path into a vehicle's physics state; and `findRoadPath`/`buildNavigationGraph` (`src/core/navigation.ts`) already does A* over the exact road graph (`ngraph.path`, already a dependency) that a racing line derives from.

The real work is: (1) a pure-pursuit-style path follower that reads a precomputed racing-line polyline and a per-point target speed and emits `InputFrame`s deterministically; (2) building 3 more `createVehicle()` instances into the same Rapier `world` with staggered grid spawns, ticked inside the loop's existing `onTickBegin` hook (not by modifying `src/loop.ts` — see Architecture Patterns); (3) generalizing `createRaceState` to one instance per car for lap/checkpoint/placement tracking; (4) a small stuck/flip detector driving a 3-state recovery machine (racing → recovering (drive-out) → reset); (5) a lightweight forward-raycast avoidance term that composes with (never replaces) the pure-pursuit steering output; and (6) render/minimap/debug-overlay plumbing for 3 extra cars, recolored, which requires factoring the chassis+wheel-mesh builder out of `createVehicleView` (that function currently also builds an entire dedicated `THREE.Scene` + ground/grid — it must not be called 3 more times).

Silver pace (D-09) has a ready-made calibration source: `MEDAL_BANDS.silver = 1.15` (`src/core/medal-timing.ts`) applied to the reference run's own per-checkpoint cumulative splits (`medal-reference.ts`'s `MedalReferenceCourse.splits`). Scaling those splits by 1.15 gives per-checkpoint target cumulative times that already encode the course's real sector difficulty (tight corners take proportionally longer in the reference run too) — this is a better calibration anchor than inventing an independent "designer intended speed" model from scratch, and ties D-09 directly to infrastructure Phase 6 already shipped and tested.

**Primary recommendation:** Build the AI driver as a pure `src/core/ai-driver.ts` `InputSource` implementation consuming a precomputed `RacingLine` (polyline + per-point target speed, derived once per course from `findRoadPath` + curvature), wire 3 extra `createVehicle()` instances into the existing world via a new sibling physics factory (not a modification to `map-scene.ts`), tick them from `onTickBegin` (zero changes to `src/loop.ts`), and generalize `createRaceState`/`race-coordinator.ts` into a per-car array wrapper.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Racing-line derivation (path + curvature + target speed) | `src/core/` (pure logic) | — | Depends only on `RoadGraph`/`NavigationGraph` data, no Rapier/DOM — same tier as `navigation.ts`/`race-state.ts`. Must be vitest-testable per this project's own layering convention. |
| AI steering/throttle decision (pure pursuit) | `src/core/` (pure logic, `InputSource` impl) | — | Same reasoning: `InputFrame` in, `InputFrame` out, no physics reads beyond plain position/heading/speed numbers passed in by the caller. Mirrors `input-tape.ts`'s existing `InputSource` contract exactly. |
| AI vehicle physics (per-tick suspension/tire solve) | `src/physics/` | — | Reuses `createVehicle()` unmodified — Rapier state lives here, never in `src/core/`. |
| Avoidance raycast (forward obstacle check) | `src/physics/` | `src/core/` (pure slowdown-curve math) | The raycast itself needs `world.castRay()` (Rapier), so the query lives in `src/physics/`; the "how much to slow down given distance" curve is a pure function belongs in `src/core/` and is unit-testable without Rapier. |
| Per-car race/lap/checkpoint state | `src/core/` (generalized `race-state.ts`) | — | Already pure and per-racer-shaped; Phase 7 needs N instances, not a new tier. |
| Placing/gap computation | `src/core/` or `src/gameplay/` | — | Pure arithmetic over N race snapshots + path-progress distances; belongs beside `race-coordinator.ts`'s existing comparison/placement logic. |
| Stuck/flip/recovery state machine | `src/core/` | — | Pure function of telemetry numbers (velocity, tilt, time), same shape as `RaceState`'s own state machine. |
| AI vehicle rendering (chassis+wheels, recolored) | `src/render/` | — | Reads Rapier transforms, writes only meshes — same contract `vehicle-view.ts` already has. Requires factoring a car-mesh builder out of `createVehicleView` (see Architecture Patterns). |
| Minimap AI dots | `src/hud/` (`minimap.ts`) | — | Existing `Minimap.update()` snapshot shape needs an additional `racers` array; same canvas, same edge-blip logic already built for checkpoints. |
| `?debug` AI overlay (lines, targets, state labels) | `src/debug/` | — | Gate-free factory constructed only under `DEBUG_ENABLED`, exactly like `nav-pointer.ts`/`telemetry-hud.ts`. |
| Race HUD (position/lap/gap) | `src/hud/` (`race-hud.ts`) | — | Extends the existing `timingPanel` DOM block; pure presentation over a snapshot the gameplay tier computes. |
| Grid/countdown/start sequencing | `src/gameplay/` (`race-coordinator.ts` or a sibling) | — | Orchestration across N vehicles + N race states + the sim clock — matches `race-coordinator.ts`'s existing responsibility (it already owns respawn/restart orchestration). |

## Standard Stack

### Core
No new runtime dependencies are required. Every capability Phase 7 needs is already installed and already used for an adjacent purpose:

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ngraph.path` | `1.6.1` [VERIFIED: package.json] | A* over the road graph — already used by `findRoadPath` | CLAUDE.md's own Stack doc names this as the recommended pursuer/AI pathfinder; `src/core/navigation.ts` already wraps it. Racing-line derivation reuses `findRoadPath` directly, no new dependency. |
| `ngraph.graph` | `20.1.2` [VERIFIED: package.json] | Graph structure `buildNavigationGraph` builds | Same as above. |
| `@dimforge/rapier3d` | `0.20.0` [VERIFIED: package.json] | Vehicle physics + `world.castRay()` for avoidance | Already the project's only physics engine; `world.castRay(ray, maxToi, solid, filterFlags?, filterGroups?, filterExcludeCollider?, filterExcludeRigidBody?, filterPredicate?)` is present in the installed `.d.ts` (`node_modules/@dimforge/rapier3d/pipeline/world.d.ts:330`) [VERIFIED: read directly from the installed package] and accepts a `filterExcludeRigidBody` parameter — exactly what's needed to exclude the AI's own chassis from its forward-avoidance ray. |
| `three` | `0.185.1` [VERIFIED: package.json] | AI car meshes, recoloring | Already the only renderer. |

### Supporting
No additional supporting libraries recommended. A hand-rolled pure-pursuit + curvature-speed-profile implementation (see Code Examples) is ~150-250 lines of `src/core/` TypeScript and is a far smaller, more auditable surface than any general-purpose steering/AI library — consistent with this project's own precedent of hand-rolling the vehicle wrapper instead of using `RapierPhysics.js`, and with CLAUDE.md's stated aversion to dependencies that don't pay for themselves at this project's scale (3 AI cars, one road graph).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled pure pursuit | Stanley controller / MPC-style path tracker | Both are more accurate at high lateral-slip regimes, but pure pursuit is the standard choice for this exact "cast-vehicle-controller, arcade-tuned" shape (used pervasively in kart/arcade-racer AI) and is dramatically simpler to reason about and unit-test deterministically. CONTEXT.md's own "Claude's Discretion" text explicitly names pure-pursuit-vs-other as the open question and does not require MPC-grade accuracy — D-12 wants "tidy grip driving," not competition-optimal lines. |
| Raycast-based mild avoidance | `@recast-navigation` crowd/local-avoidance (RVO-style) | CLAUDE.md's own Stack doc already rules this out for this project's scale ("wrong shape for this problem" for road-constrained racing) and D-10 explicitly wants avoidance that does not yield/block — a full local-avoidance solver is the wrong tool for "slow down a bit if something is dead ahead," which a single forward raycast plus a slowdown curve does adequately. |
| Reference-split-scaled Silver pace calibration | An independently authored "AI target speed per corner" table | Duplicates data that already exists (the reference run's own splits), and risks drifting out of sync with the medal thresholds Phase 6 already locked. Scaling the existing splits by `MEDAL_BANDS.silver` (1.15) is strictly less authored content and cannot silently disagree with the medal system. |

**Installation:** No new packages. `npm install` is not required for this phase.

**Version verification:** All three dependencies above were confirmed via `package.json` (already pinned, exact-literal per this project's own dependency-pinning rule) and the Rapier `castRay` signature was confirmed by reading the shipped `.d.ts` directly rather than trusting training-data memory of the API.

## Package Legitimacy Audit

Not applicable — this phase installs zero new external packages. Every capability is served by dependencies already present in `package.json` and already exercised elsewhere in the codebase (`ngraph.path`/`ngraph.graph` by `src/core/navigation.ts`, `@dimforge/rapier3d`'s `castRay` API confirmed present in the installed package's own `.d.ts`).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │  Course load (main.ts, once at boot)     │
                         │  routes.json → Course + NavigationGraph  │
                         └───────────────┬───────────────────────────┘
                                         │
                                         ▼
                         ┌─────────────────────────────────────────┐
                         │  buildRacingLine(course, navigation)     │  src/core/racing-line.ts (NEW)
                         │  findRoadPath per leg → smooth/cut apex  │  pure, vitest-tested
                         │  within widthM → curvature → target      │
                         │  speed per point (v = sqrt(aLatMax / k)) │
                         │  scaled to Silver pace via medal splits  │
                         └───────────────┬───────────────────────────┘
                                         │  RacingLine (readonly, shared by all 3 AI)
                                         ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  PER FIXED TICK (src/loop.ts, UNCHANGED — driven from onTickBegin hook)   │
   │                                                                            │
   │  Player:  LiveInputSource.sampleForTick(tick) ─► scene.applyInput() ─►    │
   │           vehicle.tick() [existing path, unchanged]                       │
   │                                                                            │
   │  AI x3:   onTickBegin(tick) callback (gameplay tier) loops 3 AI cars:     │
   │    AiDriver.sampleForTick(tick)   src/core/ai-driver.ts (NEW)             │
   │      reads: own position/heading/speed (from prior tick's telemetry),     │
   │             RacingLine, StuckState                                        │
   │      → look-ahead point on line → pure-pursuit steer angle                │
   │      → target speed at look-ahead point → throttle/brake                  │
   │      → composes: forward-avoidance raycast slowdown (mild, D-10)          │
   │      → composes: recovery override when StuckState = "recovering"         │
   │      ↓ InputFrame                                                         │
   │    aiVehicle[i].tick(frame, tuning, surfaces)   [SAME createVehicle() call│
   │                                                   the player uses]         │
   │  ALL 4 vehicles now hold pending impulses. world.step() runs ONCE.        │
   │                                                                            │
   │  onTickEnd(tick): for player AND each AI —                                │
   │    detectCheckpointHit + RaceState.updateProgress (existing per-car logic,│
   │    now called 4x against 4 RaceState instances)                           │
   │    StuckDetector.update(telemetry) → StuckState transition                │
   └──────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                         ┌─────────────────────────────────────────┐
                         │  RaceCoordinator (generalized, N cars)   │  src/gameplay/
                         │  placements, gap-to-ahead, countdown,    │  race-coordinator.ts
                         │  finish/interrupt/respawn/restart fan-out│  (extended) or a sibling
                         └───────┬─────────────┬─────────────┬──────┘
                                 ▼             ▼             ▼
                          Race HUD        Minimap dots   ?debug overlay
                          (position/lap/  (colored per   (lines, targets,
                           gap)            racer, D-14)   state labels, D-15)
```

### Recommended Project Structure
```
src/core/
├── racing-line.ts       # NEW — pure: road-graph path -> smoothed line -> curvature -> target speed
├── ai-driver.ts          # NEW — pure: pure-pursuit InputSource implementation over a RacingLine
├── ai-stuck-detector.ts  # NEW — pure: telemetry -> StuckState (racing/recovering/reset) state machine
├── race-state.ts         # EXTENDED or wrapped — one instance per car; add a thin `createMultiRaceState`
├── race-placement.ts     # NEW — pure: N RaceSnapshots + path progress -> ordered placements + gap-to-ahead
└── navigation.ts         # UNCHANGED — findRoadPath/buildNavigationGraph reused as-is

src/physics/
├── vehicle.ts             # UNCHANGED — createVehicle() reused verbatim for every AI car
├── ai-avoidance.ts        # NEW — world.castRay() forward probe, returns a distance/slowdown pure input
└── map-scene.ts           # UNCHANGED (or minimally extended) — AI vehicles built by a NEW sibling
                            #   factory, not by modifying this file's single-vehicle contract

src/render/
├── vehicle-view.ts        # EXTENDED — factor chassis+wheel mesh building out of createVehicleView
│                           #   into a reusable buildCarMeshes(...) so it can be called 4x into ONE
│                           #   shared scene (see Pitfall "Don't call createVehicleView() per AI car")
└── ai-vehicle-view.ts     # NEW (or folded into vehicle-view.ts) — per-AI-car mesh set + paint color

src/hud/
├── minimap.ts             # EXTENDED — MinimapSnapshot gains a `racers` array (colored dots)
└── race-hud.ts            # EXTENDED — position/lap/gap block near existing timing panel (D-16)

src/debug/
└── ai-debug-overlay.ts    # NEW — gate-free factory, ?debug + DEBUG_ENABLED convention (D-15)

src/gameplay/
└── race-coordinator.ts    # EXTENDED (or a sibling `circuit-race-coordinator.ts`) — orchestrates
                            #   N vehicles/race-states/placements, grid/countdown, finish/interrupt
```

### Pattern 1: AI driver as a pure `InputSource`
**What:** `createAiDriver(racingLine, tuningKnobs): InputSource` — `sampleForTick(tick)` reads the AI's OWN last-known telemetry (position, heading, forward speed — passed in by the caller each tick, not read internally from Rapier) and returns an `InputFrame`. It never touches `RAPIER.RigidBody` directly.
**When to use:** For every one of the 3 AI cars, one instance each (different starting grid slot only — the algorithm and racing line are shared).
**Why this satisfies "no cheating" structurally:** `InputFrame` is the ONLY parameter `Vehicle.tick()` accepts for control input (`src/physics/vehicle.ts`'s `tick(frame, tuning, surfaces)`). An `AiDriver` that only ever returns `{steer, throttle, brake, handbrake}` computed from plain numbers cannot write a transform, teleport, or exceed the friction model the player is also bound by — verified by reading `createVehicle`'s full `tick()` body, which has exactly one write path (the Rapier vehicle controller's own setters) and no branch that skips the physics for any caller.
**Determinism:** Because the sim-clock/tick contract (`src/core/sim-clock.ts`, `src/loop.ts`) already guarantees the fixed-tick loop replays byte-identically (`tests/determinism.test.ts`), an `AiDriver.sampleForTick(tick)` that is a pure function of (own last telemetry, racing line, stuck state — all of which are themselves derived only from tick-indexed simulation state) is automatically deterministic. Do not read `Date.now()`, `Math.random()` without a seeded PRNG, or any wall clock inside `ai-driver.ts` — `tests/layering.test.ts` already forbids this for everything under `src/core/`.

### Pattern 2: Wiring AI vehicles WITHOUT touching `src/loop.ts`
**What:** `src/loop.ts`'s `LoopDeps.onTickBegin?(tick: number)` fires BEFORE `deps.applyInput(...)` and BEFORE `deps.world.step()` for that tick (confirmed by reading `src/loop.ts`'s `frame()` body: `deps.onTickBegin?.(tickIndex)` is the very first per-tick call, `deps.applyInput(...)` and `deps.world.step()` follow after). Because `Vehicle.tick()` itself only writes pending Rapier impulses/forces and does NOT call `world.step()` (that happens once, centrally, in `loop.ts`), calling all 3 AI vehicles' `.tick(frame, tuning, surfaces)` from inside the `onTickBegin` callback produces the exact same physics ordering the player's own `applyInput` → `vehicle.tick()` → (later, same tick) `world.step()` path already uses.
**Why this matters:** `src/loop.ts` is the single most heavily-guarded file in the codebase — its own doc comment calls out 3 independent stall-recovery mechanisms and `tests/determinism.test.ts`/`tests/layering.test.ts` pin its exact behavior. Every other phase has extended gameplay behavior via the existing `onTickBegin`/`onTickEnd`/`onRaceCommands` hooks rather than widening `LoopDeps`'s signature (confirmed: `race-coordinator.ts`'s `onCommands`/`onTickEnd` are the only consumers of those hooks today, and they were added in Phase 5 without changing the fixed-tick core). Phase 7 should follow the same discipline: a new gameplay-tier object holds `[playerVehicle, ...aiVehicles]` and is invoked from `onTickBegin`/`onTickEnd`, `src/loop.ts` itself needs zero code changes.
**Example (wiring shape, not literal code):**
```typescript
// src/gameplay/circuit-race-coordinator.ts (illustrative shape)
onTickBegin(tick: number): void {
  for (const ai of this.aiRacers) {
    if (ai.stuckState.phase === "reset") continue; // resetPose() already ran, skip a physics tick
    const frame = ai.driver.sampleForTick(tick);
    ai.vehicle.tick(frame, this.sharedTuning, this.surfaces);
  }
  // player's own applyInput() + vehicle.tick() still runs via loop.ts's normal path, unchanged
}
```

### Pattern 3: Racing line = road-graph path + apex-cutting smooth + curvature-derived speed profile
**What:** A `RacingLine` is a dense polyline of `{x, z, targetSpeedMs, curvature}` points, precomputed ONCE per course at load time (not per tick), derived from:
1. `findRoadPath(navigation, fromNodeId, toNodeId)` for each leg of the course (checkpoint-to-checkpoint, exactly as `race-state.ts`'s own `headingToNext` already does for wrong-way detection) — this guarantees the AI never routes off the authored road network.
2. Concatenate each edge's `points` array (already a dense centreline polyline per `docs/schemas/road-graph.v1.md`) for the full lap.
3. Apply a smoothing pass (e.g., Catmull-Rom or a simple weighted-moving-average over a fixed window) that is CLAMPED to stay within `edge.widthM / 2` of the centreline at every point — this is what "cuts apexes within road width" (D-11) means concretely: the smoothed line may deviate from the centreline polyline, but never past the carriageway edge.
4. Compute per-point curvature `k` from three consecutive smoothed points (standard circumradius-from-3-points formula: `k = 4*Area / (|AB|*|BC|*|CA|)`), then target speed `v = sqrt(aLatMax / k)` (the same formula this research's grounding sources confirm — see Code Examples), clamped by a straight-line top-speed cap.
5. Scale the whole speed profile by a single calibration gain so the resulting total lap time matches Silver pace (`referenceSplit.cumulativeTimeSec * 1.15`, taken directly from the already-shipped `MedalReferenceCourse.splits`) — see Pitfall "Don't invent a second pace model."
6. Route the smoothed line CLEAR of `DEFECT_COORDINATES` (`src/core/navigation.ts`'s own `DEFECT_CLEARANCE_M = 40`, already enforced for checkpoint placement) — reuse that same constant/list rather than re-deriving it, and bias the smoothing pass away from any point that falls within `DEFECT_CLEARANCE_M` of a defect coordinate.
**When to use:** Once per course, at composition-root boot (alongside where `navigation`/`raceState` are already built in `src/main.ts`), shared read-only by all 3 `AiDriver` instances (D-02: identical car and tune, so an identical racing line for all 3 is correct — they differentiate only by grid-slot offset).

### Pattern 4: Pure pursuit steering
See Code Examples for the concrete formula. Key integration point: the "current position/heading" pure pursuit needs is EXACTLY the shape `VehicleSample` (`src/physics/vehicle.ts`) already exposes (`position`, `forwardSpeedMs`, and heading derivable from `rotation` the same way `headingFromRotation` in `race-coordinator.ts` already does it) — no new telemetry needs inventing.

### Pattern 5: Mild avoidance via forward raycast, composed onto (never replacing) pure pursuit output
**What:** Before computing final throttle, cast one ray from the AI chassis forward (`world.castRay(ray, maxToi, solid, undefined, undefined, undefined, ownRigidBody)`, using the confirmed `filterExcludeRigidBody` parameter to exclude self) against the other 3 vehicle chassis colliders. If a hit lands within a speed-scaled following distance, scale throttle down (never negative — no braking-to-a-stop, D-10 says "mild avoidance," not yielding) proportional to closing distance.
**Why compose, not replace:** Exactly the same discipline `vehicle.ts`'s own step 4 comment already documents for surface grip ("the surface's lateralGrip multiplier SCALES this already-blended value — it is COMPOSITION, not replacement") — avoidance should scale the pure-pursuit throttle output, never override the steering, so the AI never "fights" its own line-following logic (this is what keeps D-15's "no visible oscillation" true even with avoidance active).
**Layering:** The raycast itself (needs `RAPIER.World`) belongs in `src/physics/ai-avoidance.ts`; the pure "given this distance, what's the slowdown multiplier" curve belongs in `src/core/` so it stays vitest-testable without a Rapier world.

### Pattern 6: Stuck/flip detection and recovery as a 3-state machine
**What:** `StuckState = "racing" | "recovering" | "resetting"`, transitions driven by pure telemetry checks against a `StuckDetector` (`src/core/ai-stuck-detector.ts`):
- `racing → recovering`: `groundSpeedMs < STUCK_SPEED_THRESHOLD` for `STUCK_DURATION_TICKS` consecutive ticks WHILE throttle is being commanded (mirrors the exact "velocity near zero + throttle applied for N seconds" heuristic CONTEXT.md's own open-questions list names), OR `tiltDeg > FLIPPED_TILT_DEG` (chassis up-vector inverted — `VehicleSample.tiltDeg` already exists and is exactly this number) for any single tick.
- `recovering`: drive-out override commandeers the `InputFrame` output for up to `DRIVE_OUT_DURATION_TICKS` (reverse + steer toward the last known good racing-line point, i.e. steer AWAY from the direction the chassis is currently facing relative to the line) — same shape as the codebase's own reverse-derivation pattern in `vehicle.ts` step 2 ("Reverse is DERIVED from physics state... rather than from a new InputFrame field").
- `recovering → racing`: `groundSpeedMs` exceeds a clear threshold and `tiltDeg` is back under the flipped threshold.
- `recovering → resetting` (after `DRIVE_OUT_DURATION_TICKS` with no recovery): call `vehicle.resetPose(poseForCheckpoint(lastAnchor, course, navigation))` — REUSE `race-coordinator.ts`'s existing `poseForCheckpoint` helper verbatim (it is already exported-shape-compatible: checkpoint + course + navigation → pose) rather than re-deriving reset-pose math.
- `resetting → racing`: one tick after `resetPose()` runs (skip that tick's `vehicle.tick()` call, matching how `loop.ts` already handles a player reset: `deps.transforms.captureAsCurrent(); deps.transforms.prev.set(deps.transforms.cur);` — the render/interpolation buffers need the same treatment for an AI reset, or the AI car will visibly interpolate FROM its stuck position TO the checkpoint across one frame).
**"Off-camera" bias (D-13):** Since the permanent helicopter camera always frames the PLAYER (per Phase 3's camera work), any AI car more than the camera's effective framing distance from the player is already off-camera by construction — gate the `recovering → resetting` transition on `distanceToPlayer > CAMERA_FRAMING_DISTANCE_M` where practical (delay the reset a few ticks if the AI is currently near the player/camera), rather than building new camera-frustum math. This is a reasonable heuristic reuse, not a verified camera API — flag as [ASSUMED] (see Assumptions Log).

### Pattern 7: Generalizing `createRaceState` to N cars
**What:** `createRaceState(course, navigation): RaceState` is already a pure, self-contained closure with no player-specific state inside it (confirmed by reading the full file — nothing in `race-state.ts` references "player," it operates purely on `currentNodeId`/`headingRad` the caller feeds via `updateProgress`). The minimal-risk generalization is a NEW thin wrapper, not a rewrite:
```typescript
// src/core/multi-race-state.ts (illustrative)
export function createMultiRaceState(course: Course, navigation: NavigationGraph, carCount: number) {
  const states = Array.from({ length: carCount }, () => createRaceState(course, navigation));
  return { states, /* placement/gap derived from states[i].snapshot() + path-progress distance */ };
}
```
This keeps solo Time Attack's existing single-`createRaceState()` call site in `main.ts` completely untouched (D-05's "solo Time Attack... untouched" is satisfied structurally, not just by convention) — Circuit Race is an entirely separate composition-root code path that happens to reuse the same pure factory function 4 times.
**Gap-to-car-ahead:** CONTEXT.md's discretion note prefers "time at shared progress points... over distance." A practical implementation: track each car's cumulative distance-along-racing-line (sum of `RacingLine` segment lengths up to the car's current projected point) each tick; when the car ahead crosses a distance milestone the trailing car has not yet reached, record `(milestone, simTimeSec)` pairs per car (reusing the exact "checkpoint split" pattern `medal-timing.ts`'s `SectorSplit` already establishes) and interpolate the gap from those pairs — this avoids a naive "distance / current speed" estimate that would fluctuate wildly under braking.

### Anti-Patterns to Avoid
- **Reading Rapier state directly inside `ai-driver.ts`:** Breaks the `src/core/` layering rule (`tests/layering.test.ts`) and makes the AI driver untestable without a live Rapier world. Pass plain numbers in (telemetry snapshot), get an `InputFrame` out — exactly `input-tape.ts`'s existing contract.
- **A second "AI pace" tuning surface independent of the medal-reference splits:** Two sources of truth for "how fast is Silver" WILL drift (one gets retuned during a feel session, the other doesn't) and CIRC-02's own anti-rubber-banding intent is only meaningful if the AI's target pace is anchored to something the player also experiences (the medal system). Derive Silver pace from `MedalReferenceCourse.splits * MEDAL_BANDS.silver`, not from an independently authored number.
- **Calling `createVehicleView()` a 4th time for AI cars:** That function builds an entire fresh `THREE.Scene`, ground plane, and reference grid EVERY call — reading `main.ts` confirms only ONE `view.scene` exists and everything (map, FX, camera target) is added to it. 3 more calls would create 3 orphaned scenes never rendered, or (if their meshes were manually re-parented into the real scene) leave 3 disposed-never ground/grid meshes leaking memory. Factor a `buildCarMeshes(...)` helper out first.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| A* pathfinding on the road graph | A custom Dijkstra/A* | `findRoadPath` (`src/core/navigation.ts`, wraps `ngraph.path`) | Already built, already tested (`tests/navigation.test.ts`), already the CLAUDE.md-recommended library for exactly this. |
| Vehicle physics for AI cars | A simplified/kinematic AI vehicle model | `createVehicle()` (`src/physics/vehicle.ts`) unmodified | D-01/CIRC-02's core requirement IS that AI use the real physics vehicle ("they can be rammed, spun and can crash") — a simplified model would violate the phase's success criteria by construction, not just be worse engineering. |
| Reset-to-checkpoint pose math | New pose-from-checkpoint logic for AI | `poseForCheckpoint` (`src/gameplay/race-coordinator.ts`, currently module-private — export it) | Identical math already exists and is used for the player's own respawn (D-13 explicitly says "the same rule as the player's respawn"). |
| Local avoidance / crowd steering | RVO / `@recast-navigation` crowd module | A single forward `world.castRay()` + slowdown curve | CLAUDE.md's own Stack doc already rules out `@recast-navigation` for this project ("wrong shape for this problem"); D-10 wants mild avoidance only, not real crowd steering. |
| Persistence schema for best-finish-per-course | A new ad hoc localStorage format | Extend `MedalProgressRecord`/`medal-persistence.ts`'s existing `kind`/`version`-tagged, corruption-tolerant pattern | D-06 explicitly asks for "the same local-only, schema-versioned, corruption-tolerant persistence rules as Phase 6 D-07/D-09" — this is locked, not discretionary. |

**Key insight:** Every "don't hand-roll" item above already exists in this exact codebase, built by an earlier phase with this phase's needs in mind (several files literally say "Phase 7" in their own doc comments). The risk in this phase is NOT missing library research — it's re-deriving something that already ships, or (the opposite failure) bolting new behavior onto `src/loop.ts` when the existing hook contract already covers it.

## Common Pitfalls

### Pitfall 1: Treating `world.castRay`'s avoidance slowdown as steering input
**What goes wrong:** If the avoidance system is allowed to adjust `steer` (swerve around an obstacle) rather than only `throttle` (slow down), it will fight the pure-pursuit controller's own steering output every tick it's active, producing exactly the "visible oscillation" D-15's debug overlay is designed to catch.
**Why it happens:** Swerving feels like the more "intelligent" avoidance behavior, but D-10 explicitly scopes AI temperament to "race their own line with mild avoidance," not path deviation.
**How to avoid:** Avoidance is throttle-only (a multiplier in `[avoidanceFloor, 1]`, never negative/braking, per D-10's "not yielding or blocking"). Steering always comes from pure pursuit against the fixed racing line.
**Warning signs:** AI steer value flips sign rapidly tick-to-tick while another car is nearby — visible immediately in the D-15 debug overlay's per-tick steer readout.

### Pitfall 2: Recomputing the racing line per tick instead of once per course load
**What goes wrong:** `findRoadPath` + smoothing + curvature is not free (it's `ngraph.path`'s A* over the whole graph, run per leg); doing this every tick for 3 AI cars would be wasted CPU and — worse — could make the AI's target line subtly different tick to tick if any input to the computation drifts, breaking determinism.
**How to avoid:** Build the `RacingLine` exactly once, at composition-root time (same lifecycle as `navigation`/`raceState` in `main.ts`), as an immutable, shared, read-only structure all 3 `AiDriver` instances reference.

### Pitfall 3: Look-ahead distance fixed instead of speed-scaled
**What goes wrong:** A fixed look-ahead distance tuned for cornering speed will cause visible steering oscillation at higher straight-line speeds (this is a documented, well-known pure-pursuit failure mode, not project-specific — see Code Examples' sourced research). This directly threatens Success Criterion 4 ("no visible oscillation on straights").
**How to avoid:** `lookAheadM = clamp(LOOKAHEAD_GAIN * currentSpeedMs, LOOKAHEAD_MIN_M, LOOKAHEAD_MAX_M)` — the standard velocity-scaled lookahead fix, confirmed by multiple independent robotics sources (see Code Examples/Sources).

### Pitfall 4: Letting the "drive out and recover" override skip a physics tick incorrectly
**What goes wrong:** `Vehicle.resetPose()` calls `body.setTranslation`/`setRotation`/`setLinvel`/`setAngvel` directly — if `vehicle.tick()` is ALSO called that same tick (writing steer/engine-force impulses meant for the pre-reset position), the two writes can interact unpredictably, and the render interpolation buffer (`TransformCache`) will show the car sliding from its stuck position to the checkpoint across one visible frame instead of popping instantly.
**How to avoid:** Follow `loop.ts`'s own existing player-reset pattern exactly: on the tick a reset fires, skip that AI's `vehicle.tick()` call and instead force both interpolation buffer halves (`captureAsCurrent()` then `prev.set(cur)`) to the post-reset pose, same as `loop.ts` already does for player respawn/restart commands.

### Pitfall 5: Deriving "Silver pace" as a flat average speed instead of per-segment scaling
**What goes wrong:** A single flat target speed (e.g., "drive the whole lap at X m/s") ignores that tight corners and long straights need very different speeds — the AI would either be unrealistically slow on straights or unrealistically fast in corners, breaking D-12's "tidy grip driving" (it would either constantly slide or constantly look sluggish).
**How to avoid:** Scale the CURVATURE-DERIVED per-point speed profile (Pattern 3) by a single calibration gain chosen so the resulting simulated lap time (run the AI driver headlessly against the physics, exactly like `src/physics/telemetry/run.ts`'s existing harness already does for the player's tuning routines) matches the Silver-pace target from the medal reference splits. The shape of the speed profile comes from curvature; only its overall scale comes from Silver-pace calibration.

### Pitfall 6: Building AI meshes with a duplicate ground/grid via `createVehicleView`
**What goes wrong:** See Anti-Pattern above — orphaned scenes or leaked ground/grid geometry per AI car.
**How to avoid:** Factor a `buildCarMeshes(wheelRadius, halfTrack, halfWheelbase, chassisHalfExtents, chassisColor)` helper out of `createVehicleView`'s existing chassis/wheel-building code (lines building `chassisGeometry`/`chassisMaterial`/wheel meshes), call it once for the player (inside `createVehicleView`, unchanged behavior) and 3 more times directly into `view.scene` for the AI cars.

### Pitfall 7: Forgetting that `wheelGroundObject`/surface-grip lag applies to AI too
**What goes wrong:** `vehicle.ts`'s own comment notes a one-tick lag between crossing a surface boundary and new friction values taking effect (03-RESEARCH.md Pitfall 2, intentional). This is unchanged for AI cars and is not a bug to "fix" for AI — but AI tuning/testing sessions should not mistake this lag for an AI steering bug when driving across a tarmac/gravel boundary.
**How to avoid:** Document this explicitly in `ai-driver.ts`'s own comments (mirroring `vehicle.ts`'s existing comment) so a future debugging session doesn't re-diagnose an already-understood, accepted behavior.

## Code Examples

### Pure pursuit steering (formula, adapted to this codebase's InputFrame/steer sign convention)
```typescript
// Source: R. Craig Coulter, "Implementation of the Pure Pursuit Path Tracking
// Algorithm" (CMU-RI-TR-92-01, 1992) — the canonical citation for this
// algorithm; formula cross-checked against multiple current robotics sources
// (MathWorks Pure Pursuit Controller docs; ROS2 Nav2 "Regulated Pure Pursuit"
// paper, arXiv:2305.20026).
//
// alpha = angle between vehicle heading and the vector to the look-ahead
// point, in the vehicle's own frame. curvature = 2*sin(alpha) / lookAheadM.
// steerAngle = atan(wheelbaseM * curvature).
//
// This project's InputFrame.steer is -1 (full left) .. +1 (full right), and
// src/physics/vehicle.ts applies `steerAngle = -frame.steer * maxSteerLock`
// (note the negation — see that file's own "Steering sign, derived and
// measured" comment). So this function must return steer in the SAME sign
// convention src/input/*.ts already uses (positive = right), not raw
// steering-column radians.
function pursuitSteer(
  carX: number, carZ: number, headingRad: number,
  targetX: number, targetZ: number,
  lookAheadM: number, wheelbaseM: number, maxSteerLockRad: number,
): number {
  const dx = targetX - carX;
  const dz = targetZ - carZ;
  // Vehicle-forward-frame angle to target, using this codebase's existing
  // atan2(dz, dx) bearing convention (matches race-state.ts/minimap.ts).
  const bearingToTarget = Math.atan2(dz, dx);
  const alpha = bearingToTarget - headingRad; // wrap to (-pi, pi] before use
  const wrapped = Math.atan2(Math.sin(alpha), Math.cos(alpha));
  const curvature = (2 * Math.sin(wrapped)) / lookAheadM;
  const steerAngleRad = Math.atan(wheelbaseM * curvature);
  return clamp(steerAngleRad / maxSteerLockRad, -1, 1);
}
```

### Velocity-scaled look-ahead distance (fixes Pitfall 3 / oscillation on straights)
```typescript
// Source: multiple robotics sources agree a fixed lookahead trades off
// cornering accuracy against straight-line stability; the standard fix is a
// speed-proportional lookahead (MathWorks Pure Pursuit Controller docs;
// arXiv:2305.20026 "Regulated Pure Pursuit").
function lookAheadDistanceM(currentSpeedMs: number): number {
  const LOOKAHEAD_GAIN_SEC = 0.9; // tune: seconds of travel to look ahead
  const LOOKAHEAD_MIN_M = 6;
  const LOOKAHEAD_MAX_M = 40;
  return clamp(LOOKAHEAD_GAIN_SEC * currentSpeedMs, LOOKAHEAD_MIN_M, LOOKAHEAD_MAX_M);
}
```

### Curvature-derived target speed
```typescript
// Source: v = sqrt(a_lat_max / k) where k is path curvature (1/radius) —
// confirmed against multiple autonomous-racing sources (arXiv:2505.05157
// "Online Velocity Profile Generation... for Autonomous Racing";
// arXiv:2309.09186 "Spline-Based Minimum-Curvature Trajectory Optimization").
// aLatMaxMs2 should be chosen conservatively below this car's actual measured
// grip limit (Phase 3's skidpad figures: tarmac ~1.027g measured in
// STATE.md's Phase 03-12 entry) so the AI corners with margin, not at the
// limit — this is what makes D-12's "tidy grip driving" (not constantly
// sliding) achievable rather than aspirational.
function targetSpeedAtCurvature(curvature: number, aLatMaxMs2: number, topSpeedMs: number): number {
  if (curvature < 1e-6) return topSpeedMs; // effectively straight
  return Math.min(topSpeedMs, Math.sqrt(aLatMaxMs2 / curvature));
}
```

### Three-point curvature (circumradius formula)
```typescript
// Standard formula: curvature k = 4*Area(ABC) / (|AB| * |BC| * |CA|).
// Used per consecutive triple of smoothed racing-line points.
function curvatureFromThreePoints(
  a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number },
): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) return 0;
  return (4 * area) / (ab * bc * ca);
}
```

### Forward-raycast avoidance (Rapier, using the confirmed `filterExcludeRigidBody` param)
```typescript
// Source: node_modules/@dimforge/rapier3d/pipeline/world.d.ts, read directly
// from the installed package (line 330). Excludes the AI's own rigid body so
// it never "sees" its own chassis collider as an obstacle.
function forwardAvoidanceSlowdown(
  world: RAPIER.World, ownBody: RAPIER.RigidBody,
  origin: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number },
  maxDistanceM: number,
): number {
  const ray = new RAPIER.Ray(origin, forward);
  const hit = world.castRay(ray, maxDistanceM, true, undefined, undefined, undefined, ownBody);
  if (hit === null) return 1; // no slowdown
  const followDistanceM = maxDistanceM;
  return clamp(hit.timeOfImpact / followDistanceM, 0.4, 1); // D-10: mild, never full stop
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Rubber-band AI (opponent speed scales to stay close to player) | Fixed-pace AI calibrated once against a reference/medal time | Long-standing genre criticism, not a recent shift | Directly locked by CIRC-02's own requirement text and REQUIREMENTS.md's explicit anti-feature row ("Rubber-band/catch-up AI... consistently disliked genre-wide"). Nothing in this phase should read player state to adjust AI pace, ever. |

**Deprecated/outdated:** None specific to this phase's domain — pure pursuit (1992) and curvature-based velocity profiling are stable, foundational techniques still actively used in current (2024-2026) autonomous-racing research, per the arXiv sources cited above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The permanent helicopter camera's effective framing distance can be used as a proxy for "off-camera" to bias stuck-car resets (D-13) | Architecture Patterns, Pattern 6 | If the camera's actual framing logic doesn't expose (or can't cheaply expose) a "is point X currently visible" query, the planner needs a simpler proxy (e.g., a flat distance-from-player threshold) instead — low risk, easy fallback, not blocking. |
| A2 | A single shared `RacingLine` (identical for all 3 AI cars, differentiated only by start-grid offset) satisfies D-11/D-12 without per-car line variation | Architecture Patterns, Pattern 3 | If 3 cars following an identical line produce unrealistic single-file bunching, the planner may want small per-car lateral offset noise — a cheap addition, not a redesign, but not verified against real driving feel in this research session (no browser session was run). |
| A3 | `aLatMaxMs2` for the curvature speed-profile formula should be set conservatively below the Phase 3-measured tarmac skidpad figure (~1.027g) rather than at it | Code Examples, curvature-derived target speed | If set too close to the grip limit, AI will slide more than D-12 wants ("tidy grip driving"); if set too conservatively, AI will feel sluggish relative to Silver pace and the calibration gain (Pitfall 5) will have to compensate more aggressively. This is a tuning constant that genuinely needs an in-browser feel pass, not something research can lock. |
| A4 | Factoring `buildCarMeshes` out of `createVehicleView` is a safe, additive refactor that won't break the player's own rendering path or its existing tests (`tests/vehicle-scene.test.ts` and friends) | Architecture Patterns, Pitfall 6 | Read `vehicle-view.ts`'s full chassis/wheel-building code before implementing to confirm no other hidden coupling to the single-call, single-scene assumption; this research read the function signature and top of the body but not every line of the wheel-mesh construction. |

## Open Questions

1. **Exact stuck/flip thresholds (`STUCK_SPEED_THRESHOLD`, `STUCK_DURATION_TICKS`, `FLIPPED_TILT_DEG`, `DRIVE_OUT_DURATION_TICKS`)**
   - What we know: `VehicleSample.tiltDeg` already exists and is exactly the "chassis up-vector inverted" signal; `groundSpeedMs` already exists for the "near zero" signal. CONTEXT.md explicitly leaves exact thresholds to Claude's discretion.
   - What's unclear: Numeric values need an in-browser feel pass (stuck on gravel vs. wedged against a building read differently) — this is Assumption-adjacent territory, not something to lock from research alone.
   - Recommendation: Plan should schedule a `checkpoint:human-verify` or feel-session task specifically for these constants, mirroring how Phase 2/3 handled vehicle-tuning constants (measured, then feel-tuned).

2. **Whether `createRaceState`'s wrong-way detection (currently circuit-mode-only, single-racer) needs AI-specific handling**
   - What we know: `race-state.ts`'s `updateWrongWay` already special-cases `course.mode !== "circuit"`. AI always drives forward along its own racing line by construction (pure pursuit never targets a "behind" point), so wrong-way detection is likely a player-only concern that can be skipped for the generalized `createMultiRaceState` wrapper's AI instances.
   - What's unclear: Whether the AI's `RaceState.snapshot().wrongWay` flag should simply be ignored for AI cars (never read), or whether `createMultiRaceState` should short-circuit it to always `false` for non-player cars to avoid a confusing debug-overlay reading if a future dev wires it up by mistake.
   - Recommendation: Plan should decide explicitly rather than leave it implicit — a one-line decision, not a research gap.
   - (RESOLVED — see 07-02-PLAN.md: AI wrongWay is computed but intentionally never read/acted on for AI cars.)

3. **Exact `aLatMaxMs2` and lookahead-gain tuning constants**
   - Covered under Assumption A3 — genuinely needs an in-browser pass, flagged rather than guessed at a specific number.

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependencies. Everything needed (Node, Vite, Rapier WASM, the existing browser target) is already verified working by every prior phase's own shipped code and tests.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 [VERIFIED: package.json] |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/<new-file>.test.ts` |
| Full suite command | `npm run test` (= `vitest run`); `npm run check` runs typecheck + lint + test |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CIRC-02 (SC1: identical physics, rammable/spinnable, nothing writes transforms) | AI vehicle built via unmodified `createVehicle()`; AI driver only returns `InputFrame` | unit | `npx vitest run tests/ai-driver.test.ts` | ❌ Wave 0 — new file |
| CIRC-02 (SC2: fixed pace, no rubber-banding/speed multipliers) | `AiDriver`/`RacingLine` never read player state; lap time against Silver-pace target within tolerance when run headlessly | unit (headless sim harness, mirroring `src/physics/telemetry/run.ts`'s existing pattern) | `npx vitest run tests/racing-line.test.ts` and a new headless-lap-time harness test | ❌ Wave 0 — new file(s); reuse `run.ts`'s harness pattern |
| CIRC-02 (SC3: stuck/flipped/wedged detect-and-recover) | `StuckDetector` state transitions on synthetic telemetry sequences | unit | `npx vitest run tests/ai-stuck-detector.test.ts` | ❌ Wave 0 — new file |
| CIRC-02 (SC4: no oscillation on straights, no corner-cutting through scenery) | Pure-pursuit steer output stays within a small band on a synthetic straight; racing line stays within `widthM/2` of centreline at every point, clear of `DEFECT_COORDINATES` | unit | `npx vitest run tests/racing-line.test.ts` and `tests/ai-driver.test.ts` | ❌ Wave 0 — new files |
| CIRC-02 (SC5: player medal time unaffected by AI presence) | Solo Time Attack composition path (`main.ts` circuit mode without AI) unchanged; `createRaceState`'s single-call-site behavior byte-identical | regression (existing) | `npx vitest run tests/race-state.test.ts tests/medal-timing.test.ts` (must stay green, unmodified expectations) | ✅ existing |
| D-06 (best finish persisted) | Extended `MedalProgressRecord`/persistence round-trips a new `bestFinish` field, corruption-tolerant | unit | `npx vitest run tests/medal-persistence.test.ts` (extended) | ✅ existing, needs extension |
| D-16 (HUD gap/position/lap) | `RaceHud` renders position/lap/gap text from a snapshot | unit (DOM-light, matching `race-hud.ts`'s existing test style) | `npx vitest run tests/race-hud.test.ts` (new — no existing file found) | ❌ Wave 0 — new file |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test files>`
- **Per wave merge:** `npm run test` (full suite)
- **Phase gate:** `npm run check` (typecheck + lint + full suite) green before `/gsd-verify-work`, plus the human browser checkpoint(s) this phase's plan should schedule for feel-tuning (stuck thresholds, avoidance feel, Silver-pace calibration — none of these are meaningfully verifiable by automated test alone, matching this project's own established pattern for vehicle-feel work in Phases 2/3).

### Wave 0 Gaps
- [ ] `tests/racing-line.test.ts` — covers racing-line derivation, smoothing-within-widthM, curvature/speed-profile math, defect-coordinate avoidance
- [ ] `tests/ai-driver.test.ts` — covers pure-pursuit steer output, velocity-scaled lookahead, `InputFrame` shape/range compliance
- [ ] `tests/ai-stuck-detector.test.ts` — covers the 3-state stuck/recover/reset machine on synthetic telemetry
- [ ] `tests/race-hud.test.ts` — does not currently exist; D-16's HUD extension needs its own test file (no gap in framework — same DOM-light pattern `race-hud.ts`'s sibling files already use, just missing a dedicated test file today)
- [ ] A headless lap-time harness for calibrating/verifying Silver pace — reuse `src/physics/telemetry/run.ts`'s existing "drive N ticks against a fixed tuning, measure the result" pattern rather than building a new one from scratch

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json`, so this section is included per the default-enabled rule. This phase is entirely client-side, single-player, no network calls, no new user-facing input surface beyond what already exists (keyboard/gamepad, already covered by prior phases' input handling).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No accounts/auth in this project (v1 scope explicitly excludes multiplayer/leaderboards). |
| V3 Session Management | No | No sessions. |
| V4 Access Control | No | Single local player, no privilege boundaries. |
| V5 Input Validation | Yes | The ONLY new untrusted-input surface this phase plausibly touches is the extended `localStorage` persistence for best-finish-per-course (D-06). Reuse `medal-persistence.ts`'s existing pattern exactly: a `kind`/`version`-tagged envelope, parsed through a dedicated `parse*` function that validates every field and falls back to a safe default on any malformed input — never a bare `JSON.parse` result trusted directly (this is already this codebase's own established, tested convention, not a new control to design). |
| V6 Cryptography | No | No secrets, no crypto in this phase. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Corrupted/hand-edited `localStorage` best-finish record (same threat class Phase 6 already handled for best-time) | Tampering | Schema-versioned parse-or-default, exactly mirroring `parseMedalProgress`'s existing behavior (unknown `kind`/`version` → `emptyMedalProgress()`, per-field type/range validation via `isValidRecord`-shaped checks) — extend the SAME validated envelope, do not add a second, less-guarded storage key. |
| A malicious/corrupted `routes.json` course file causing the racing-line builder to route through unintended geometry | Tampering | Out of this phase's threat model in practice (the route file is a build-time authored artifact, not user-editable at runtime, and `validateCourseRoutes`/`parseCourseData` already throw loudly on structural violations at boot per `main.ts`'s existing "fail loudly, never a blank canvas" discipline) — no new control needed, the existing boot-time validation already covers it. |

## Sources

### Primary (HIGH confidence — read directly from this project's own shipped source or installed packages)
- `D:\Projects 2\Heat Street - Copy\src\physics\vehicle.ts` — `createVehicle()`, `Vehicle.tick()` full body, wheel index contract, steering sign convention
- `D:\Projects 2\Heat Street - Copy\src\core\input-tape.ts` — `InputSource`/`InputFrame` contract
- `D:\Projects 2\Heat Street - Copy\src\loop.ts` — fixed-tick ordering, `onTickBegin`/`onTickEnd`/`onRaceCommands` hook contract, reset-tick interpolation-buffer handling
- `D:\Projects 2\Heat Street - Copy\src\core\navigation.ts` — `findRoadPath`, `buildNavigationGraph`, `nearestRoadNode`, `DEFECT_COORDINATES`/`DEFECT_CLEARANCE_M`
- `D:\Projects 2\Heat Street - Copy\src\core\race-state.ts` — `createRaceState` full body, confirmed player-agnostic/pure
- `D:\Projects 2\Heat Street - Copy\src\gameplay\race-coordinator.ts` — `poseForCheckpoint`, respawn/restart command handling, `onTickEnd` checkpoint-hit loop
- `D:\Projects 2\Heat Street - Copy\src\core\medal-timing.ts` — `MEDAL_BANDS.silver = 1.15`
- `D:\Projects 2\Heat Street - Copy\src\core\medal-reference.ts` — `MedalReferenceCourse.splits` shape
- `D:\Projects 2\Heat Street - Copy\src\render\vehicle-view.ts` — `createVehicleView` builds its own `THREE.Scene`+ground+grid per call; `VehicleView` interface shape
- `D:\Projects 2\Heat Street - Copy\src\hud\minimap.ts` — existing checkpoint-dot/edge-blip pattern to extend for AI racers
- `D:\Projects 2\Heat Street - Copy\src\debug\nav-pointer.ts` — gate-free debug-overlay factory convention
- `D:\Projects 2\Heat Street - Copy\src\core\medal-persistence.ts` — schema-versioned, corruption-tolerant persistence pattern
- `D:\Projects 2\Heat Street - Copy\docs\schemas\road-graph.v1.md` — `edge.points`/`edge.widthM` feed "AI racing line" explicitly named as a consumer
- `D:\Projects 2\Heat Street - Copy\docs\frame-budget.md` — 4ms physics budget, "physics is unlikely to be the bottleneck before Phase 7" stated explicitly, real measured figures at 88 bodies/0.27ms
- `node_modules/@dimforge/rapier3d/pipeline/world.d.ts` (installed package, version 0.20.0 per `package.json`) — `castRay` signature including `filterExcludeRigidBody`
- `D:\Projects 2\Heat Street - Copy\package.json` — confirmed installed versions, no new dependencies needed
- `D:\Projects 2\Heat Street - Copy\.planning\config.json` — `nyquist_validation: true`, no `security_enforcement` override (defaults enabled)

### Secondary (MEDIUM confidence — WebSearch, cross-checked against multiple independent sources)
- [Implementation of the Pure Pursuit Path Tracking Algorithm (CMU-RI-TR-92-01)](https://www.ri.cmu.edu/pub_files/pub3/coulter_r_craig_1992_1/coulter_r_craig_1992_1.pdf) — canonical pure-pursuit source, steering formula
- [Pure Pursuit Controller - MATLAB & Simulink](https://www.mathworks.com/help/robotics/ug/pure-pursuit-controller.html) — lookahead distance tuning, velocity-scaled lookahead
- [Regulated Pure Pursuit for Robot Path Tracking (arXiv:2305.20026)](https://arxiv.org/pdf/2305.20026) — oscillation-on-straights failure mode and standard fix
- [Online Velocity Profile Generation and Tracking for Sampling-Based Local Planning in Autonomous Racing (arXiv:2505.05157)](https://arxiv.org/html/2505.05157) — curvature-to-speed formula, forward/backward propagation speed profiling
- [Spline-Based Minimum-Curvature Trajectory Optimization for Autonomous Racing (arXiv:2309.09186)](https://arxiv.org/pdf/2309.09186) — curvature-minimization racing-line approach, cross-checks the `v = sqrt(aLat/k)` relationship

### Tertiary (LOW confidence)
- None retained — every WebSearch finding used above was cross-checked against at least 2 independent sources or verified directly against this project's own installed code before being included.

## Metadata

**Confidence breakdown:**
- Standard stack (no new deps, reuse existing): HIGH — verified against `package.json` and installed `.d.ts` files directly, zero speculation
- Architecture (InputSource-as-AI-driver, onTickBegin wiring, race-state generalization, mesh-builder factoring): HIGH — every claim traced to a specific line/file read this session, not training-data assumption
- AI algorithm (pure pursuit, curvature speed profile): MEDIUM — the formulas themselves are HIGH confidence (textbook robotics, cross-verified against 2024-2026 academic sources), but the specific tuning constants (lookahead gain, aLatMax, stuck thresholds) are unavoidably MEDIUM/LOW until run against this car's real physics in a browser session
- Pitfalls: HIGH for the codebase-specific ones (reset-tick interpolation, avoidance composition-not-replacement, duplicate-scene risk — all traced to specific existing code), MEDIUM for the generic pure-pursuit oscillation pitfall (well-sourced externally, not yet observed in THIS project)

**Research date:** 2026-09-22
**Valid until:** No external dependency changes expected to affect this research (no new packages); the codebase itself may shift under active development — treat file/line references as valid as of this date, re-grep before implementing if significant time has passed.
