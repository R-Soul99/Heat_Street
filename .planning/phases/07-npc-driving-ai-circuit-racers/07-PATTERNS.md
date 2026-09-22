# Phase 7: NPC Driving AI & Circuit Racers - Pattern Map

**Mapped:** 2026-09-22
**Files analyzed:** 15 (new) + 8 (extended)
**Analogs found:** 21 / 23

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/racing-line.ts` (NEW) | utility (pure geometry) | transform | `src/core/navigation.ts` | exact (same tier, same `findRoadPath`/road-graph inputs) |
| `src/core/ai-driver.ts` (NEW) | controller (`InputSource` impl) | request-response (tick → frame) | `src/core/input-tape.ts` (`ReplayInput`) | exact (identical `InputSource` contract) |
| `src/core/ai-stuck-detector.ts` (NEW) | utility (state machine) | event-driven | `src/core/race-state.ts` (its internal wrong-way/lap state machine) | role-match (pure telemetry-in/state-out machine) |
| `src/core/multi-race-state.ts` (NEW) | store (wrapper) | CRUD-ish (per-car state) | `src/core/race-state.ts` (`createRaceState`) | exact (documented in RESEARCH.md as a thin N-instance wrapper) |
| `src/core/race-placement.ts` (NEW) | utility (pure arithmetic) | transform | `src/core/medal-timing.ts` (`SectorSplit`/`recordCheckpoint`) | role-match (same "milestone → cumulative time" pattern) |
| `src/physics/ai-avoidance.ts` (NEW) | service (Rapier query) | request-response | `src/physics/vehicle.ts` (its Rapier-reading/writing style + doc-comment conventions) | role-match (first `world.castRay()` consumer in the codebase — no exact raycast analog exists yet) |
| `src/physics/ai-fleet.ts` (NEW, sibling factory) | service (physics composition) | CRUD (build/tick/dispose N vehicles) | `src/physics/map-scene.ts` (`createMapScene`) | exact (same "config-in, controller-out, `tick`/`resetVehicle`/`dispose` contract" shape, generalized to N) |
| `src/render/vehicle-view.ts` (EXTENDED — factor `buildCarMeshes`) | component (render) | transform | itself (`createVehicleView`) | exact — refactor target |
| `src/render/ai-vehicle-view.ts` (NEW, or folded in) | component (render) | transform | `src/render/vehicle-view.ts` (post-refactor `buildCarMeshes`) | exact |
| `src/hud/minimap.ts` (EXTENDED) | component (canvas HUD) | request-response (snapshot → draw) | itself (existing checkpoint-dot/edge-blip code) | exact — extend in place |
| `src/hud/race-hud.ts` (EXTENDED) | component (DOM HUD) | request-response | itself (existing `timingPanel`/`status` blocks) | exact — extend in place |
| `src/debug/ai-debug-overlay.ts` (NEW) | component (debug overlay) | request-response | `src/debug/nav-pointer.ts` | exact (gate-free factory, pure-compute/DOM-write split) |
| `src/gameplay/circuit-race-coordinator.ts` (NEW, sibling) | controller (orchestration) | event-driven | `src/gameplay/race-coordinator.ts` | exact — same `onTickEnd`/`onCommands`/`render`/`snapshot` shape, generalized to N cars |
| `src/core/medal-persistence.ts` (EXTENDED — `bestFinish`) | model (persistence) | CRUD | itself (`MedalProgressRecord`/`parseMedalProgress`/`mergeMedalResult`) | exact — extend in place |
| `src/main.ts` (EXTENDED — Circuit Race wiring) | config (composition root) | event-driven | itself (existing course/mode selection ~line 294-350) | exact — extend in place |
| `tests/racing-line.test.ts` (NEW) | test | — | `tests/race-state.test.ts` (hand-built `RoadGraph` fixture pattern) | exact |
| `tests/ai-driver.test.ts` (NEW) | test | — | `tests/input-tape.test.ts` | exact |
| `tests/ai-stuck-detector.test.ts` (NEW) | test | — | `tests/race-state.test.ts` | role-match |
| `tests/race-hud.test.ts` (NEW) | test | — | `tests/minimap.test.ts` (DOM-light HUD test style) | role-match |
| Headless lap-time calibration harness | test/tool | batch | `src/physics/telemetry/run.ts` (`runRoutine`) | exact |

## Pattern Assignments

### `src/core/racing-line.ts` (utility, transform)

**Analog:** `src/core/navigation.ts` + `src/core/race-state.ts`'s `headingToNext`

**Imports pattern** (`src/core/navigation.ts` lines 1-4):
```typescript
import createGraph, { type Graph } from "ngraph.graph";
import { aStar } from "ngraph.path";
import type { CourseData } from "./course";
import type { RoadGraph, RoadGraphEdge } from "./road-graph";
```
Follow the same style for `racing-line.ts`: import `findRoadPath`/`NavigationGraph` from `./navigation`, `Course`/`CourseCheckpoint` from `./course`. No `three`, no Rapier — pure `src/core/` per `tests/layering.test.ts`.

**Path-per-leg pattern** (`src/core/race-state.ts` lines 46-57, `headingToNext`):
```typescript
function headingToNext(
  navigation: NavigationGraph,
  currentNodeId: number,
  checkpoint: CourseCheckpoint,
): number | null {
  const path = findRoadPath(navigation, currentNodeId, checkpoint.nodeId);
  if (path.length < 2) return null;
  const from = navigation.roadGraph.nodes.find((node) => node.id === path[0]);
  const to = navigation.roadGraph.nodes.find((node) => node.id === path[1]);
  if (from === undefined || to === undefined) return null;
  return Math.atan2(to.z - from.z, to.x - from.x);
}
```
`buildRacingLine` should walk `course.checkpoints` (circuit mode, `laps` from `Course.laps`) the same way, calling `findRoadPath(navigation, fromNodeId, toNodeId)` per leg and concatenating `navigation.edgesById.get(link.data.edgeId).points` for each traversed link — `NavigationLink.edgeId` (navigation.ts line 6-9) is exactly the join key.

**Defect-avoidance pattern to reuse verbatim** (`src/core/navigation.ts` lines 62-79):
```typescript
const DEFECT_COORDINATES: readonly (readonly [number, number])[] = [ /* ... */ ];
const DEFECT_CLEARANCE_M = 40;

function distanceXZ(a: readonly [number, number, number], b: readonly [number, number]): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}
```
`DEFECT_COORDINATES`/`DEFECT_CLEARANCE_M` are module-private in `navigation.ts` today — **export them** (or export a `isNearDefect(point)` helper) rather than re-declaring the coordinate list in `racing-line.ts`; two copies of "known geometry defects" WILL drift.

**Road width for apex-cutting clamp:** `RoadGraphEdge.widthM` (`src/core/road-graph.ts` line 84) — clamp any smoothing deviation to `edge.widthM / 2` of the centreline, per D-11.

**Error handling:** This tier throws loudly on malformed input rather than defaulting — see `src/core/course.ts`'s `fail()`/`required()` helpers (lines 45-57) for the house style of "throw a named, contextual `Error`", though `racing-line.ts` likely needs no new validation beyond what `parseCourseData`/`parseRoadGraph` already guarantee upstream.

---

### `src/core/ai-driver.ts` (controller, `InputSource` impl)

**Analog:** `src/core/input-tape.ts` (`ReplayInput`)

**Contract to copy exactly** (`src/core/input-tape.ts` lines 36-39, 84-97):
```typescript
export interface InputSource {
  /** Resolve this tick's immutable frame. Must be stable for a given tick index. */
  sampleForTick(tick: number): InputFrame;
}

export class ReplayInput implements InputSource {
  private readonly tape: readonly InputFrame[];
  constructor(frames: readonly InputFrame[]) { this.tape = frames; }
  sampleForTick(tick: number): InputFrame {
    if (tick < 0 || tick >= this.tape.length) return NEUTRAL;
    return this.tape[tick];
  }
}
```
`createAiDriver(racingLine, tuningKnobs)` should return an object implementing `sampleForTick(tick): InputFrame` with **no internal Rapier/DOM/wall-clock reads** — same purity constraint `tests/layering.test.ts` already enforces for everything under `src/core/`. Telemetry (own position/heading/speed) must be a parameter the caller (the gameplay-tier fleet ticker) passes in each call, not read internally — RESEARCH.md Pattern 1/Anti-Pattern.

**`InputFrame` shape to emit** (`src/core/input-tape.ts` lines 16-34):
```typescript
export interface InputFrame {
  readonly steer: number;     // -1 full left .. 1 full right
  readonly throttle: number;  // 0..1
  readonly brake: number;     // 0..1
  readonly handbrake: boolean;
}
export const NEUTRAL: InputFrame = Object.freeze({ steer: 0, throttle: 0, brake: 0, handbrake: false });
```

**Steering sign convention — CRITICAL, cross-check against `src/physics/vehicle.ts` lines 346-352:**
```typescript
// InputFrame.steer is -1 = LEFT / +1 = RIGHT; ... Hence the leading minus.
const steerAngle = -frame.steer * t.drive.maxSteerLock;
```
The pure-pursuit formula in RESEARCH.md's Code Examples already accounts for this (its own comment states the function must return `steer` in "positive = right" — the SAME sign `src/input/*.ts` already uses, not raw steering-column radians). Do not re-derive the sign independently; copy the RESEARCH.md formula's stated convention.

**Reverse-derivation precedent** (`src/physics/vehicle.ts` lines 368-374, comment only — informs `ai-stuck-detector.ts`'s drive-out override, not `ai-driver.ts` itself): reverse is derived from physics state, never a new `InputFrame` field, because the frame shape is frozen by `tests/determinism.test.ts`.

---

### `src/core/ai-stuck-detector.ts` (utility, state machine)

**Analog:** `src/core/race-state.ts`'s internal wrong-way state machine

**State-machine shape to mirror** (`src/core/race-state.ts` lines 94-112):
```typescript
function updateWrongWay(): void {
  if (course.mode !== "circuit" || complete) { wrongWay = false; return; }
  const nextCheckpoint = course.checkpoints[...];
  if (nextCheckpoint === undefined) { wrongWay = false; return; }
  const desiredHeading = headingToNext(navigation, currentNodeId, nextCheckpoint);
  if (desiredHeading === null) { wrongWay = false; return; }
  const difference = angleDifference(headingRad, desiredHeading);
  wrongWay = wrongWay ? difference >= WRONG_WAY_EXIT_RAD : difference >= WRONG_WAY_ENTER_RAD;
}
```
Note the **hysteresis pattern**: separate ENTER/EXIT thresholds (`WRONG_WAY_ENTER_RAD` vs `WRONG_WAY_EXIT_RAD`, lines 6-7) to avoid flicker at the boundary. `ai-stuck-detector.ts`'s `racing ↔ recovering` transition should use the same two-threshold hysteresis shape for `STUCK_SPEED_THRESHOLD` (enter low, exit higher) rather than one threshold both ways.

**Telemetry fields already available** (`src/physics/vehicle.ts` `VehicleSample`, lines 103-120):
```typescript
readonly groundSpeedMs: number;  // hypot(linvel.x, linvel.z)
readonly tiltDeg: number;        // chassis-up vs world-up, always >= 0 — the "flipped" signal
```
Both are already computed every tick by `sampleVehicle()` — no new physics read is needed, only new pure logic consuming these numbers.

**Immutable snapshot pattern** (`src/core/race-state.ts` lines 59-61):
```typescript
function immutableSnapshot(snapshot: RaceSnapshot): RaceSnapshot {
  return Object.freeze({ ...snapshot, visitedIds: Object.freeze([...snapshot.visitedIds]) });
}
```
`StuckDetector.snapshot()` (feeding the D-15 debug overlay's state label) should freeze its returned object the same way.

**Reset-pose reuse** — do not re-derive: `poseForCheckpoint` (`src/gameplay/race-coordinator.ts` lines 48-68) already converts a `CourseCheckpoint` + `Course` + `NavigationGraph` into a `VehiclePose`. Export it (currently module-private) and call it verbatim for the `recovering → resetting` transition, exactly as the player's own respawn does (`race-coordinator.ts` line 192).

---

### `src/core/multi-race-state.ts` (store, wrapper)

**Analog:** `src/core/race-state.ts` (`createRaceState`), used N times

**Factory to wrap, unmodified** (`src/core/race-state.ts` line 63, full body already pure/player-agnostic):
```typescript
export function createRaceState(course: Course, navigation: NavigationGraph): RaceState { ... }
```
Confirmed nothing inside references "player" — it operates purely on `currentNodeId`/`headingRad` fed via `updateProgress`. The wrapper is additive:
```typescript
export function createMultiRaceState(course: Course, navigation: NavigationGraph, carCount: number) {
  const states = Array.from({ length: carCount }, () => createRaceState(course, navigation));
  return { states /* + placement/gap helpers from race-placement.ts */ };
}
```
This keeps the existing single-call-site in `src/main.ts` (solo Time Attack) byte-identical — D-05's isolation requirement is structural, not just conventional.

---

### `src/core/race-placement.ts` (utility, transform)

**Analog:** `src/core/medal-timing.ts`'s `SectorSplit`/`recordCheckpoint` (milestone → cumulative-time pattern)

**Milestone-pair pattern to mirror** (`src/core/medal-timing.ts` lines 53-62, 209-237):
```typescript
export interface SectorSplit {
  readonly checkpointId: string;
  readonly ordinal: number;
  readonly sectorElapsedSec: number;
  readonly cumulativeElapsedSec: number;
  readonly deltaSec: number | null;
}
```
For "gap to car ahead" (D-16, RESEARCH.md Pattern 7), record `(distanceMilestone, simTimeSec)` pairs per car exactly like `sectors` accumulates `(checkpointId, cumulativeElapsedSec)` pairs, then interpolate — same shape, one axis swapped (distance-along-line instead of checkpoint id).

**Freeze-on-return convention** (`src/core/medal-timing.ts` lines 100-115, `freezeSnapshot`): every snapshot returned from `src/core/` is `Object.freeze`d, including nested arrays/objects — apply the same discipline to a `PlacementSnapshot`.

---

### `src/physics/ai-avoidance.ts` (service, Rapier query)

**Analog:** `src/physics/vehicle.ts` (style/layering conventions — no exact raycast precedent exists yet in this codebase)

**Rapier read-only layering convention** (`src/physics/vehicle.ts` lines 11-15 doc comment):
```
Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
`three` and must not touch the DOM or any wall clock.
```
Apply identically to `ai-avoidance.ts`.

**Confirmed `castRay` signature** (RESEARCH.md Code Examples, sourced from the installed `.d.ts`):
```typescript
function forwardAvoidanceSlowdown(
  world: RAPIER.World, ownBody: RAPIER.RigidBody,
  origin: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number },
  maxDistanceM: number,
): number {
  const ray = new RAPIER.Ray(origin, forward);
  const hit = world.castRay(ray, maxDistanceM, true, undefined, undefined, undefined, ownBody);
  if (hit === null) return 1;
  return clamp(hit.timeOfImpact / maxDistanceM, 0.4, 1); // D-10: mild, never full stop
}
```
**Composition, not replacement** — mirror `src/physics/vehicle.ts`'s own documented discipline for surface grip (lines 404-412: "the surface's lateralGrip multiplier SCALES this already-blended value — it is COMPOSITION, not replacement"). The avoidance slowdown must multiply the pure-pursuit throttle, never touch steering.

---

### `src/physics/ai-fleet.ts` (service, physics composition — NEW sibling factory)

**Analog:** `src/physics/map-scene.ts` (`createMapScene`)

**Config-in/controller-out shape to mirror** (`src/physics/map-scene.ts` lines 89-119, 345-426):
```typescript
export interface MapScene {
  readonly bodies: readonly RAPIER.RigidBody[];
  readonly vehicle: Vehicle;
  readonly defaultSpawnPose: VehiclePose;
  readonly surfaces: SurfaceContext;
  preTick(tick: number): void;
  applyInput(frame: InputFrame): void;
  setTuning(t: VehicleTuning): void;
  resetVehicle(pose: VehiclePose): void;
  dispose(): void;
}
```
`createAiFleet(world, tuning, surfaces, gridSpawns: VehiclePose[])` should return an analogous shape generalized to N: `vehicles: readonly Vehicle[]`, `tick(tick, drivers)` (loops `createVehicle` instances calling `.tick(driver.sampleForTick(tick), tuning, surfaces)`), `resetVehicle(index, pose)`, `dispose()` (loop `vehicle.dispose()` for all N). **Reuse `createVehicle` unmodified** — never build a simplified AI vehicle model (RESEARCH.md "Don't Hand-Roll").

**Dispose-all pattern** (`src/physics/map-scene.ts` line 422-424):
```typescript
dispose(): void {
  vehicle.dispose();
},
```
Generalize to `for (const v of vehicles) v.dispose();`.

---

### `src/render/vehicle-view.ts` (EXTENDED — factor `buildCarMeshes`) / `src/render/ai-vehicle-view.ts` (NEW)

**Analog:** itself — `createVehicleView`'s own chassis/wheel-building code

**Extraction target** (`src/render/vehicle-view.ts` lines 349-399, chassis + wheel mesh construction): factor this block into a standalone `buildCarMeshes(wheelRadius, halfTrack, halfWheelbase, chassisHalfExtents, chassisColor): { chassis: THREE.Mesh; wheelMeshes: THREE.Mesh[] }` that does **not** create a `THREE.Scene`, ground, grid, or lights. `createVehicleView` calls it once (unchanged behavior — same defaults); a new `createAiVehicleView(scene, buildCarMeshes(...), color)` (or a loop in `ai-vehicle-view.ts`) calls it 3 more times, adding the returned meshes directly into the **existing** `view.scene` — never a 4th `new THREE.Scene()`. This is RESEARCH.md's explicit Anti-Pattern/Pitfall 6.

**Per-car recolor:** `chassisMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_CHASSIS, roughness: 0.5 })` (line 354) — parameterize `color` instead of the hardcoded `COLOUR_CHASSIS` constant (line 59) so each AI car gets a distinct paint (D-02/D-14).

**`updateWheels` per-car:** the existing `updateWheels(vc)` closure (lines 422-451) reads a `DynamicRayCastVehicleController` and writes only that car's own `wheelMeshes` — this already generalizes to being called once per AI car's own `vc` with no change, since it closes over its own local `wheelMeshes` array (no shared mutable state to worry about).

**Dispose:** each AI car's meshes need their own `dispose()` (geometries/materials) — follow the exact list at lines 453-464, but note wheel geometry/material are already SHARED across the 4 wheels of one car (`wheelGeometry`/`wheelMaterial`, lines 366-368) — decide whether AI cars share these across ALL 4 cars too (frame-budget-friendly) or per-car; either is consistent with the existing "shared geometry, shared material" reasoning at lines 360-365.

---

### `src/hud/minimap.ts` (EXTENDED)

**Analog:** itself — existing checkpoint-dot/edge-blip drawing loop

**Snapshot shape to extend** (`src/hud/minimap.ts` lines 15-20):
```typescript
export interface MinimapSnapshot {
  readonly player: MinimapPoint;
  readonly headingRad: number;
  readonly remaining: readonly MinimapPoint[];
  readonly target: MinimapPoint | null;
}
```
Add `readonly racers: readonly { point: MinimapPoint; color: string }[]` (D-14).

**Dot + edge-blip drawing pattern to copy verbatim** (`src/hud/minimap.ts` lines 114-120, the `remaining` checkpoint loop):
```typescript
for (const point of snapshot.remaining) {
  const projected = mapPoint(point, snapshot.player);
  context.fillStyle = projected.offscreen ? "#6ed7e8" : "#ff9b78";
  context.beginPath();
  context.arc(projected.x, projected.y, projected.offscreen ? 3 : 4, 0, Math.PI * 2);
  context.fill();
}
```
Add an equivalent loop over `snapshot.racers`, using each racer's own paint color for `fillStyle` instead of the fixed checkpoint colors, and the SAME `projectMinimapPoint`/`offscreen` edge-blip logic (`projectMinimapPoint`, lines 27-56) — this is exactly the "same treatment as checkpoints" D-14 asks for.

---

### `src/hud/race-hud.ts` (EXTENDED)

**Analog:** itself — existing `timingPanel`/`status` DOM blocks

**DOM-block-and-`update()` pattern to copy** (`src/hud/race-hud.ts` lines 27-36, 46-65):
```typescript
const timingPanel = document.createElement("div");
timingPanel.style.cssText =
  "position:fixed;top:78px;right:24px;min-width:180px;text-align:right;...";
...
update(snapshot, timing): void {
  status.textContent = snapshot.mode === "circuit" ? `LAP ${...}` : `CHECKPOINT ${...}`;
  ...
}
```
Add a new `positionEl` (e.g. `top:78px` region, offset below/beside `timingPanel` per D-16's "without colliding with the speedometer or split display") and extend `update()`'s signature to accept a placement snapshot (`P3/4 · Lap 2/3 · +1.4s` format, per D-16's own example string). Follow the existing `formatTime` helper (lines 39-42) for any time formatting in the gap readout.

---

### `src/debug/ai-debug-overlay.ts` (NEW)

**Analog:** `src/debug/nav-pointer.ts`

**Gate-free factory + pure/DOM split convention** (`src/debug/nav-pointer.ts` lines 1-19 doc comment + lines 33-55, 78 signature):
```typescript
/**
 * ... Follows the same `?debug`-only, gate-free-factory convention as every
 * other file in this directory ... `src/main.ts` is the only place that
 * constructs it and owns the `DEBUG_ENABLED` gate and the `KeyN` toggle.
 *
 * The two halves are kept deliberately separate: `computeNavigation` is pure
 * and Node-testable, `createNavPointer` is the DOM half that only a browser
 * checkpoint can exercise.
 */
export function computeNavigation(...): { distanceM: number; relativeBearingDeg: number } { ... }
export function createNavPointer(): NavPointer { ... }
```
`ai-debug-overlay.ts` should follow this exactly: a pure function computing per-AI world-space line points / steer-throttle-brake readout / state label position from plain numbers (unit-testable), and a `createAiDebugOverlay()` DOM/canvas-drawing half that `src/main.ts` constructs ONLY under `DEBUG_ENABLED` (same as `nav-pointer.ts`, `telemetry-hud.ts`). Do not gate internally — the composition root owns the gate, per `src/debug/debug-gate.ts`'s documented convention (lines 1-9, 89-98 `onDebugKey`).

**Layering constraint** (`nav-pointer.ts` lines 16-19): "`src/debug/**` may import anything but must never affect simulation timing — this file only reads plain numbers the caller computed and writes its own DOM overlay." The AI debug overlay must not read Rapier/telemetry itself; the gameplay tier passes it a plain snapshot per frame.

---

### `src/gameplay/circuit-race-coordinator.ts` (NEW, sibling)

**Analog:** `src/gameplay/race-coordinator.ts`

**Deps/interface shape to mirror** (`src/gameplay/race-coordinator.ts` lines 17-40):
```typescript
export interface RaceCoordinatorDeps {
  readonly course: Course;
  readonly navigation: NavigationGraph;
  readonly scene: MapScene;
  readonly state: RaceState;
  readonly objectiveView: ObjectiveView;
  readonly minimap: Minimap;
  readonly navigationArrow: NavigationArrow;
  readonly raceHud: RaceHud;
  readonly chime: CheckpointChime;
  readonly simTimeSec: () => number;
  readonly timing: MedalTiming;
  readonly reference: MedalReferenceCourse;
  readonly personalBest?: MedalProgressRecord;
  readonly onCompleted?: (result) => void;
  readonly onRestart?: () => void;
}
export interface RaceCoordinator {
  onTickEnd(): void;
  onCommands(commands: RaceCommands): void;
  render(): void;
  snapshot(): RaceSnapshot;
}
```
`CircuitRaceCoordinatorDeps` generalizes `scene`/`state` to `readonly aiFleet: AiFleet` + `readonly multiState: MultiRaceState` (array-shaped), and adds `readonly aiDrivers: readonly AiDriver[]`, `readonly stuckDetectors: readonly StuckDetector[]`.

**`onTickEnd` checkpoint-hit loop to generalize** (`src/gameplay/race-coordinator.ts` lines 119-165): the existing single-car loop (`detectCheckpointHit` per checkpoint, `state.hitCheckpoint`, `timing.recordCheckpoint`, completion detection) is the exact per-car body; wrap it in an outer `for (const car of allCars)` loop, one `RaceState`/`MedalTiming`-equivalent instance per car (AI cars likely need only lap/checkpoint progress, not full `MedalTiming` — see Shared Patterns below).

**Respawn/restart command handling to reuse** (`src/gameplay/race-coordinator.ts` lines 167-197): `poseForCheckpoint` (lines 48-68) is the exact function AI stuck-recovery resets should call — export it from this file (currently module-private) rather than duplicating its A*-based heading derivation.

**`headingFromRotation` helper to reuse verbatim** (lines 42-46):
```typescript
function headingFromRotation(rotation: { x: number; y: number; z: number; w: number }): number {
  const forwardX = 2 * (rotation.x * rotation.z - rotation.w * rotation.y);
  const forwardZ = 2 * (rotation.x * rotation.x + rotation.y * rotation.y) - 1;
  return Math.atan2(forwardZ, forwardX);
}
```
Every AI car's heading (for its own `RaceState.updateProgress`, for the minimap, for the debug overlay) should be derived the same way — do not invent a second heading formula.

---

### `src/core/medal-persistence.ts` (EXTENDED — `bestFinish`)

**Analog:** itself — `MedalProgressRecord`/`isValidRecord`/`mergeMedalResult`

**Schema-versioned, corruption-tolerant envelope to extend, not replace** (`src/core/medal-persistence.ts` lines 4-27, 50-68, 138-172):
```typescript
export const MEDAL_PROGRESS_KEY = "heat-street.medals.v1";
export const MEDAL_PROGRESS_KIND = "heat-street.medal-progress";
export const MEDAL_PROGRESS_VERSION = 1;

export interface MedalProgressRecord {
  readonly courseId: string;
  readonly bestTimeSec: number;
  readonly medal: Medal;
}

function isValidRecord(value: unknown, courseId: string, knownCourseIds: KnownCourseIds): value is MedalProgressRecord {
  if (!isPlainObject(value) || value.courseId !== courseId || !isKnownCourse(courseId, knownCourseIds)) return false;
  return Number.isFinite(value.bestTimeSec) && typeof value.bestTimeSec === "number" && value.bestTimeSec > 0 && isRecognizedMedal(value.medal);
}
```
Add `bestFinish?: number` (1-4) to `MedalProgressRecord`, add its own `isValidRecord` range check (`Number.isInteger(value.bestFinish) && value.bestFinish >= 1 && value.bestFinish <= 4`, only when present — optional field, backward compatible with existing saved records that predate this phase), and extend `mergeMedalResult` (lines 138-172) with the same "only overwrite if better" comparison logic already used for `bestTimeSec` (line 156: `if (current !== undefined && result.effectiveTimeSec >= current.bestTimeSec) return progress;`). **Do not bump `MEDAL_PROGRESS_VERSION` or add a second storage key** — D-06 explicitly requires the SAME schema-versioned envelope, and an optional new field on an existing record is backward/forward compatible without a version bump (old saves simply lack `bestFinish` and `isValidRecord`'s field-presence check must tolerate that).

**Prototype-pollution-safe field-by-field reconstruction convention** (`src/core/road-graph.ts` lines 17-22 doc comment, same discipline `copyRecord`/`copyValidCourses` already follow in `medal-persistence.ts` lines 70-92): never spread untrusted parsed JSON into the result; copy only named fields.

---

### `src/main.ts` (EXTENDED — Circuit Race wiring)

**Analog:** itself — existing course/mode selection composition root (~lines 294-350, per RESEARCH.md's Integration Points)

**IMPORTANT CONSTRAINT surfaced during pattern mapping, not yet reflected in CONTEXT.md's "Claude's Discretion" framing:** `src/core/course.ts`'s `parseCourseData` (lines 209-234) **hardcodes exactly two courses per area file** —
```typescript
if (!Array.isArray(rawCourses) || rawCourses.length !== 2)
  fail(sourceLabel, "root.courses must contain exactly two courses");
...
if (courses.filter((course) => course.mode === "p2p").length !== 1 ||
    courses.filter((course) => course.mode === "circuit").length !== 1)
  fail(sourceLabel, "courses must contain exactly one p2p and one circuit course");
```
A brand-new third `Course` entry in `public/maps/juliette-ga.routes.json` (e.g. a `"circuit-race"` mode/id) will FAIL this parser as written. The planner must either (a) extend `CourseMode`/this validation to allow a 3rd course, or (b) represent Circuit Race as a runtime flag layered on the existing single `circuit`-mode `Course` object (no new course-data entry) rather than a new `CourseData` entry — this directly resolves CONTEXT.md's "Claude's Discretion" item on course-data representation and should be locked explicitly in planning, not left implicit.

**Composition-root wiring shape to extend** (inferred from `src/gameplay/race-coordinator.ts`'s `RaceCoordinatorDeps` construction pattern — `src/main.ts` builds `navigation`, `state = createRaceState(...)`, `scene = createMapScene(...)`, then `createRaceCoordinator({ course, navigation, scene, state, ... })`): Circuit Race mode builds the analogous set N+1 times (`aiFleet = createAiFleet(...)`, `multiState = createMultiRaceState(...)`, `racingLine = buildRacingLine(...)`, `aiDrivers = racingLine → createAiDriver(...) x3`) and constructs `createCircuitRaceCoordinator({...})` instead of `createRaceCoordinator({...})`, gated on the mode selection already present (`?mode=circuit` query convention, RESEARCH.md's `code_context`).

---

## Shared Patterns

### `InputSource` as the sole vehicle-control channel
**Source:** `src/core/input-tape.ts` lines 36-39
**Apply to:** `ai-driver.ts` (every AI car). This is the structural mechanism that makes "nothing writes their transforms" true — `Vehicle.tick(frame, tuning, surfaces)` (`src/physics/vehicle.ts` line 148) accepts exactly one control-input parameter shape, and an `AiDriver` that only ever returns `InputFrame` values built from plain numbers cannot bypass physics.

### Config-in / controller-out factory shape
**Source:** `src/physics/vehicle.ts` (`createVehicle`), `src/physics/map-scene.ts` (`createMapScene`)
**Apply to:** `ai-fleet.ts`, `ai-driver.ts`, `multi-race-state.ts`. Every constructor takes plain config + a world/course/navigation reference and returns a closure-based handle object with named methods (`tick`, `resetPose`, `dispose`, `snapshot`) — never a class hierarchy, never a global/module-singleton.

### Pure-tier vs. DOM/Rapier-tier split, enforced by `tests/layering.test.ts`
**Source:** `src/core/navigation.ts`, `src/core/race-state.ts` (pure) vs. `src/physics/vehicle.ts`, `src/render/vehicle-view.ts` (impure)
**Apply to:** every new file above — `src/core/*` may read only plain numbers/structures passed as parameters (no Rapier, no `three`, no DOM, no wall clock); `src/physics/*` may read/write Rapier but not `three`/DOM; `src/render/*` and `src/hud/*` may read simulation state and `three`/DOM but must not write Rapier state (`world.step`/`applyImpulse`/`setTranslation`/`setRotation`); `src/debug/*` may import anything but must never affect simulation timing.

### Freeze-on-return snapshots
**Source:** `src/core/race-state.ts` `immutableSnapshot` (lines 59-61), `src/core/medal-timing.ts` `freezeSnapshot` (lines 100-115)
**Apply to:** `ai-stuck-detector.ts`'s `StuckState` snapshot, `race-placement.ts`'s placement snapshot, `multi-race-state.ts`'s per-car array. Every snapshot object (and nested arrays) returned from `src/core/` is `Object.freeze`d before being handed to a caller.

### Schema-versioned, corruption-tolerant persistence
**Source:** `src/core/medal-persistence.ts` (`MEDAL_PROGRESS_KIND`/`MEDAL_PROGRESS_VERSION`, `parseMedalProgress`, `isValidRecord`, field-by-field reconstruction)
**Apply to:** the `bestFinish` extension (D-06). Reuse the SAME envelope/key — do not create a second `localStorage` key or an un-versioned shape.

### Wheel/body dense-index contracts (T-01-16 hazard class)
**Source:** `src/physics/vehicle.ts` `FL=0/FR=1/RL=2/RR=3` (lines 30-33), `src/render/vehicle-view.ts`'s matching `wheelMeshes`/`connectionsXZ` order (lines 159-167, 374-379)
**Apply to:** `ai-fleet.ts` (vehicle array index ↔ grid-slot ↔ paint-color ↔ AI-driver array index must all agree, position-for-position) and `ai-vehicle-view.ts` (each AI car's own 4-wheel index order must still be FL/FR/RL/RR). A mismatch reads as "the physics is broken" and is expensive to diagnose after the fact — keep one explicit "car index N ↔ driver N ↔ mesh-set N ↔ minimap-color N" array, never four separately-ordered collections.

### Composition, never replacement, for scaling factors
**Source:** `src/physics/vehicle.ts` lines 404-412 (surface `lateralGrip` scales the handbrake/oversteer blend, never overwrites it)
**Apply to:** `ai-avoidance.ts`'s throttle slowdown (must multiply the pure-pursuit throttle, never override steering — RESEARCH.md Pitfall 1) and the Silver-pace calibration gain (must scale the curvature-derived speed profile's shape, never replace it — RESEARCH.md Pitfall 5).

### Headless throwaway-world test harness
**Source:** `src/physics/telemetry/run.ts` (`runRoutine`, `buildTelemetryScene`) — always builds its OWN `createWorld()`, never the live game world; `world.free()` in a `finally` block
**Apply to:** the Silver-pace calibration harness (RESEARCH.md Wave 0 Gap: "headless lap-time harness"). Reuse this exact "fresh world in, `finally { world.free() }`" shape rather than building a second throwaway-world harness.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/physics/ai-avoidance.ts` | service | request-response | No existing `world.castRay()` consumer anywhere in the codebase yet (confirmed by RESEARCH.md's own sourcing — the `castRay` signature was read directly from the installed `.d.ts`, not from an existing call site). Follow `src/physics/vehicle.ts`'s general Rapier-reading/layering conventions and RESEARCH.md's own sourced Code Example for the call shape; there is no in-repo raycast precedent to copy structure from beyond that.
| `src/gameplay/circuit-race-coordinator.ts`'s N-car countdown/grid sequencing (D-04) | controller | event-driven | No existing "countdown" or "staggered grid" logic exists anywhere in the codebase (Phase 6's Time Attack starts on first movement, not a countdown). This is genuinely new orchestration logic with no direct analog; `race-coordinator.ts`'s general `onCommands`/`refresh` shape is the closest structural fit but the countdown state machine itself must be authored fresh.

## Metadata

**Analog search scope:** `src/core/`, `src/physics/`, `src/render/`, `src/hud/`, `src/debug/`, `src/gameplay/`, `tests/`
**Files scanned:** `src/physics/vehicle.ts`, `src/core/navigation.ts`, `src/core/input-tape.ts`, `src/core/race-state.ts`, `src/gameplay/race-coordinator.ts`, `src/core/medal-timing.ts`, `src/core/medal-persistence.ts`, `src/core/course.ts`, `src/core/road-graph.ts`, `src/core/checkpoint-detection.ts`, `src/render/vehicle-view.ts`, `src/hud/minimap.ts`, `src/hud/race-hud.ts`, `src/debug/nav-pointer.ts`, `src/debug/debug-gate.ts`, `src/loop.ts`, `src/physics/map-scene.ts`, `src/physics/telemetry/run.ts`, `src/physics/vehicle-assists.ts`, `tests/race-state.test.ts`
**Pattern extraction date:** 2026-09-22
