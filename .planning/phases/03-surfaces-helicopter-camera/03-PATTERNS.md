# Phase 3: Surfaces & Helicopter Camera - Pattern Map

**Mapped:** 2026-09-12
**Files analyzed:** 15 (11 new, 2 modified, 6 new test files counted separately below)
**Analogs found:** 15 / 15 (all files have at least a role-match analog; several are exact-match against Phase 2 precedent)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/physics/surface.ts` | model/utility | transform (lookup table) | `src/physics/transform-cache.ts` (index/handle-keyed buffer built once, read every tick) + `src/core/vehicle-tuning.ts` (data-table-as-source-of-truth style) | role-match |
| `src/physics/vehicle.ts` (MODIFIED) | service (physics tick) | CRUD-ish per-tick mutation | itself — extend the existing friction-setting block | exact (same file) |
| `src/physics/surface-scene.ts` | model/scene-builder | CRUD (world construction) | `src/physics/vehicle-scene.ts` | exact |
| `src/render/surface-view.ts` | component (render/visual) | transform (physics->mesh mirror) | `src/render/vehicle-view.ts` | exact |
| `src/render/surface-fx.ts` | component (particle/decal FX) | event-driven (slip-threshold gated emission) | `src/render/vehicle-view.ts` (per-frame reusable scratch objects, dispose pattern); `three/addons/geometries/DecalGeometry.js` (bundled addon) | role-match |
| `src/render/camera/helicopter-camera.ts` | provider/controller (camera rig) | streaming (continuous per-frame damped follow) | `src/physics/vehicle.ts` (config-in/controller-out generic factory, D-09) + `src/render/interpolator.ts` (damp/slerp discipline) | role-match |
| `src/render/camera/occlusion.ts` | utility (raycast classification) | event-driven (hit/miss per frame) | `src/physics/vehicle-assists.ts` (free function, explicit params, pure/testable) | role-match |
| `src/audio/audio-bootstrap.ts` | provider (audio subsystem bootstrap) | event-driven (gesture-gated resume) | `src/render/renderer.ts` (one-time subsystem construction + resize/dispose lifecycle) | role-match |
| `src/audio/surface-audio.ts` | component (positional audio controller) | streaming (per-frame gain crossfade) | `src/render/vehicle-view.ts` (per-frame update method reading sampled state) | role-match |
| `src/core/surface-tuning.ts` | config | CRUD (clamp/persist) | `src/core/vehicle-tuning.ts` | exact |
| `src/core/camera-tuning.ts` | config | CRUD (clamp/persist) | `src/core/vehicle-tuning.ts` | exact |
| `src/core/tuning-utils.ts` (new, factored out) | utility | transform (generic clamp/copy) | `src/core/vehicle-tuning.ts`'s `clampNode`/`copyLeaves`/`isTuningRange` (to be extracted) | exact (extraction of existing code) |
| `src/debug/tuning-panel.ts` (MODIFIED — extend) | component (dev UI) | request-response (slider -> onApply) | itself — extend with new folders | exact (same file) |
| `src/main.ts` (MODIFIED) | composition root | request-response (wiring) | itself — extend, following the exact same construct-gate-toggle shape already used for HUD/panel/telemetry | exact (same file) |
| `tests/surface.test.ts` | test | CRUD (unit) | `tests/*.test.ts` pure-function style (see `vehicle-assists.ts`/`vehicle.test.ts` convention) | role-match |
| `tests/surface-telemetry.test.ts` | test | batch (routine sweep) | `src/physics/telemetry/routines.ts` + `tests/vehicle-telemetry.test.ts` | exact |
| `tests/camera-heading.test.ts`, `tests/camera-framing.test.ts` | test | transform (pure function) | `vehicle-assists.ts`'s "free function, explicit parameters" test style | role-match |
| `tests/camera-skin.test.ts` | test | request-response (state-isolation assertion) | `tests/debug-gate.test.ts` (hand-built-fake style) | role-match |
| `tests/occlusion.test.ts` | test | event-driven (fake raycast hits) | `tests/debug-gate.test.ts` (hand-built-fake style, Node-safe) | role-match |

## Pattern Assignments

### `src/physics/surface.ts` (model/utility, transform)

**Analogs:** `src/physics/transform-cache.ts` (index-keyed buffer/class pattern) and `src/core/vehicle-tuning.ts` (data-as-source-of-truth doc-comment style).

**Layering header pattern** (mirrors every `src/physics/` file, e.g. `transform-cache.ts` lines 1-18):
```typescript
/**
 * [One-line purpose.]
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
import type * as RAPIER from "@dimforge/rapier3d";
```

**Core pattern** — already fully specified in 03-RESEARCH.md's "Surface-to-Collider Mapping" section (verified against installed `.d.ts`, not a guess):
```typescript
export type SurfaceType = "tarmac" | "gravel" | "dirt_road" | "grass" | "sand" | "mud";
// MUST match docs/schemas/road-graph.v1.md's SURFACE_ENUM exactly (order and
// spelling, confirmed at docs/schemas/road-graph.v1.md:173:
// "SURFACE_ENUM = tarmac | gravel | dirt_road | grass | sand | mud"),
// including "dirt_road" (not "dirt") — tests/road-graph-schema.test.ts already
// asserts this exact array against that doc.

export interface SurfaceMap {
  register(colliderHandle: number, surface: SurfaceType): void;
  lookup(colliderHandle: number | undefined): SurfaceType;
}

export function createSurfaceMap(defaultSurface: SurfaceType = "tarmac"): SurfaceMap {
  const table = new Map<number, SurfaceType>();
  return {
    register(handle, surface) { table.set(handle, surface); },
    lookup(handle) {
      if (handle === undefined) return defaultSurface;
      return table.get(handle) ?? defaultSurface;
    },
  };
}
```

**Index/handle-keyed-buffer precedent to imitate** (`src/physics/transform-cache.ts` lines 30-31, 43-49):
```typescript
/** Flat typed arrays keyed by a dense body index rather than an array of objects. */
export const XFORM_STRIDE = 7;
export class TransformCache {
  private readonly bodies: readonly RAPIER.RigidBody[];
  constructor(bodies: readonly RAPIER.RigidBody[]) { /* built once at scene construction */ }
}
```
`SurfaceMap` should follow the same "built once at scene-build time, read every tick, zero per-tick allocation" discipline — `register()` calls happen inside `surface-scene.ts`'s zone-collider construction loop, exactly where `TransformCache` is constructed once in `src/main.ts`/`vehicle-scene.ts`.

**No error handling section** — this is pure data lookup with a safe default (`?? defaultSurface`), matching `vehicle.ts`'s own `?? 0` fallback-over-throw convention for wheel-index getters (see `src/render/vehicle-view.ts` lines 316-326 for the same "fallback rather than non-null assertion" idiom).

---

### `src/physics/vehicle.ts` (MODIFIED — service, per-tick mutation)

**Analog:** itself. Extend the existing friction-setting block, do not restructure tick order.

**Exact insertion point** (immediately before the existing rear-side-friction blend, `src/physics/vehicle.ts` lines 250-300, reading `wheelGroundObject` at the TOP of `tick()` per the documented one-tick-lag acceptance in 03-RESEARCH.md Pitfall 2):
```typescript
// 03-RESEARCH.md Pattern 1 — extend the existing per-wheel setter block,
// same call ordering discipline as the handbrake/power-oversteer blend below.
for (let i = 0; i < 4; i++) {
  const ground = vc.wheelGroundObject(i);
  const surface = surfaceMap.lookup(ground?.handle);
  const profile = SURFACE_PROFILES[surface];
  vc.setWheelFrictionSlip(i, t.wheels.frictionSlip * profile.forwardGrip);
  const baseSide = i < 2 ? t.wheels.frontSideFriction : t.wheels.rearSideFriction;
  vc.setWheelSideFrictionStiffness(i, baseSide * profile.lateralGrip);
}
// ... existing steering / engine force / brake / rear-side-friction blend
// (lines 256-300) / vc.updateVehicle(DT) — ORDER IS LOAD-BEARING, do not move
// updateVehicle earlier to get a "fresher" ground read (Pitfall 2).
```

**Error handling / defensive pattern already established** (lines 316-326 of `vehicle-view.ts`, and `vehicle.ts`'s own `?? 0` fallbacks): every Rapier getter that can return `null` for an out-of-range index falls back to a safe default rather than throwing — `surfaceMap.lookup(ground?.handle)` continues this exact idiom (`ground` is `Collider | null`, `?.handle` is `number | undefined`, `lookup` treats `undefined` as "use default surface", never throws).

**Anti-pattern flagged in research, must NOT be reintroduced:** do not add a second `updateVehicle` call or reorder this block relative to `updateVehicle` to "fix" the one-tick lag — see Pitfall 2 in 03-RESEARCH.md verbatim.

---

### `src/physics/surface-scene.ts` (model/scene-builder, CRUD)

**Analog:** `src/physics/vehicle-scene.ts` — exact structural match, explicitly named as the pattern to follow in CONTEXT.md's Reusable Assets section.

**Imports / layering header** (`vehicle-scene.ts` lines 1-23):
```typescript
/**
 * Phase 3 surface test scene: a patchwork of adjacent surface zones plus
 * placeholder occlusion buildings, and exactly one `Vehicle`.
 *
 * SUPERSEDES `src/physics/vehicle-scene.ts` at the composition root ONLY.
 * `vehicle-scene.ts` stays as a regression fixture (same precedent
 * `vehicle-scene.ts` itself set for `debug-scene.ts`) — do not delete it.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
import * as RAPIER from "@dimforge/rapier3d";
import type { InputFrame } from "../core/input-tape";
import type { VehicleTuning } from "../core/vehicle-tuning";
import { createVehicle, type Vehicle } from "./vehicle";
import { createSurfaceMap, type SurfaceMap } from "./surface";
```

**Core CRUD pattern — one zone-collider-builder per surface, each registering itself into the SurfaceMap** (mirrors `buildGround`/`buildRamp`, `vehicle-scene.ts` lines 72-155):
```typescript
function buildSurfaceZone(
  world: RAPIER.World,
  surfaceMap: SurfaceMap,
  surface: SurfaceType,
  extents: { x: number; y: number; z: number },
  center: { x: number; z: number },
): void {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, -extents.y, center.z),
  );
  // Ground-collider friction is a red herring for SURF-01 (03-RESEARCH.md) —
  // stays at a fixed convention value; per-wheel friction is what carries grip.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(extents.x, extents.y, extents.z).setFriction(1.0),
    body,
  );
  surfaceMap.register(collider.handle, surface);
}
```

**Scene contract interface** — copy `VehicleScene`'s shape verbatim, adding nothing to the public contract beyond what D-02/D-06/D-07 need (`vehicle-scene.ts` lines 157-196):
```typescript
export interface SurfaceScene {
  readonly bodies: readonly RAPIER.RigidBody[]; // chassis only; zones/buildings have no mesh counterpart
  readonly vehicle: Vehicle;
  readonly surfaceMap: SurfaceMap;
  preTick(tick: number): void;
  applyInput(frame: InputFrame): void;
  setTuning(t: VehicleTuning): void;
  dispose(): void;
}
```

**Building placeholders (D-06/D-07):** follow the exact same "fixed static body + cuboid collider, no mesh counterpart in `bodies`" shape `buildGround`/`buildRamp` already use — one function per density cluster (sparse, dense/urban-canyon), called from `createSurfaceScene`, not from a loop that would obscure the deliberate hand-placed layout D-07 calls for.

---

### `src/render/surface-view.ts` (component, transform)

**Analog:** `src/render/vehicle-view.ts` — exact structural match.

**MUST MATCH comment convention** (`vehicle-view.ts` lines 39-54):
```typescript
/**
 * Surface zone visual planes + placeholder building meshes matching
 * `src/physics/surface-scene.ts`'s physics geometry.
 *
 * MUST MATCH every zone half-extent/center and every building half-extent/
 * position declared in `src/physics/surface-scene.ts` — this file has no
 * import from that module (pure render concern; geometry passed at the
 * `src/main.ts` composition-root call site, mirroring `vehicle-view.ts`'s own
 * `RAMP_HALF_WIDTH` etc. constants).
 */
```

**Per-surface color convention** (D-08's "coloured per surface: grey/tarmac, tan/gravel-sand, brown/mud-dirt_road, green-tinted/grass"), following `vehicle-view.ts`'s flat `COLOUR_*` constant table (lines 56-62):
```typescript
const COLOUR_TARMAC = 0x2b2b33;   // matches existing COLOUR_GROUND — tarmac is the unchanged baseline
const COLOUR_GRAVEL = 0xa89a78;
const COLOUR_DIRT_ROAD = 0x8a6a4a;
const COLOUR_GRASS = 0x3f6b3a;
const COLOUR_SAND = 0xd9c48f;
const COLOUR_MUD = 0x4a3626;
```

**Shared-geometry/material discipline** (`vehicle-view.ts` lines 246-254, "one shared geometry and material across all four wheels ... `docs/frame-budget.md`'s draw-call and triangle targets"): each zone plane and each building instance should reuse one `THREE.PlaneGeometry`/`THREE.BoxGeometry` + one `MeshStandardMaterial` per surface/building-type, not one unique geometry per zone instance.

**Dispose pattern** (`vehicle-view.ts` lines 338-349): every geometry/material this module creates must be disposed in a `dispose()` method — copy the structure verbatim, one line per created resource.

---

### `src/render/surface-fx.ts` (component, event-driven particle/decal FX)

**Analogs:** `src/render/vehicle-view.ts` (module-scratch reused objects, dispose pattern) + `three/addons/geometries/DecalGeometry.js` (bundled, do-not-hand-roll per 03-RESEARCH.md "Don't Hand-Roll").

**Reused-scratch-object convention, avoid per-frame allocation** (`vehicle-view.ts` lines 160-164):
```typescript
/** Reused per-wheel scratch objects so per-frame update allocates nothing. */
const SCRATCH_AXLE = new THREE.Vector3();
```
Apply the same discipline to the particle pool: pre-allocate a fixed-size `THREE.BufferGeometry` position/opacity attribute array once per surface's `THREE.Points` system (per 03-RESEARCH.md's "fixed-size pools, never unbounded arrays" ASVS V5/DoS mitigation) and only ever write into it, never reallocate per-emission.

**Emission gating on slip magnitude** (03-RESEARCH.md "Surface Visual FX", reusing telemetry-style per-wheel slip reads already established in `vehicle.ts`'s `sampleVehicle`):
```typescript
// wheelSideImpulse(i)/wheelForwardImpulse(i) are already named in CLAUDE.md's
// Headline Finding table as "free per frame" — cross against a per-surface
// threshold so looser surfaces (gravel/dirt_road, the D-05 anchor) emit a
// visibly heavier plume without inventing a second slip metric.
```

**Decal pooling — do not hand-roll, per 03-RESEARCH.md "Don't Hand-Roll"**:
```typescript
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
// Fixed-size ring buffer of decal Mesh instances, reused not endlessly
// allocated — spawned when a wheel's slip angle crosses a per-surface
// threshold while grounded, fading opacity over a lifetime, recycled back
// into the pool (mirrors the fixed-size-pool ASVS V5 mitigation above).
```

**Layering note:** this file lives in `src/render/` and reads only sampled `VehicleSample`/surface state (per-wheel slip, current surface) — never `world.step`, never a Rapier write, matching the read-only contract `vehicle-view.ts`'s own module doc states for `src/render/`.

---

### `src/render/camera/helicopter-camera.ts` (provider, streaming/continuous)

**Analog:** `src/physics/vehicle.ts`'s "config-in / controller-out" generic factory shape (D-09 precedent, explicitly cited by this phase's own D-13) + `src/render/interpolator.ts`'s damp/slerp discipline.

**Generic-target pattern, mirroring D-09 exactly** (`vehicle.ts` lines 1-15, 116-139 — "names nothing 'the player' anywhere in its signature"):
```typescript
/**
 * Config-in / controller-out camera factory (D-13, mirrors 02-RESEARCH.md
 * Pattern 1 / D-09's vehicle-controller precedent). `createHelicopterCamera`
 * takes a `CameraTarget` and a tuning object and produces a rig — nothing in
 * its signature assumes "the player car" is the only caller, so a Phase 7/8
 * pursuer satisfies `CameraTarget` with zero change here.
 */
export interface CameraTarget {
  position(): { x: number; y: number; z: number };
  /** World-space XZ velocity; used to derive heading. Y component ignored. */
  velocity(): { x: number; y: number; z: number };
}
```

**Frame-rate-independent damping — never a raw per-frame lerp constant** (`src/render/interpolator.ts` lines 68-74's slerp rule, extended per 03-RESEARCH.md Pattern 3):
```typescript
// Source pattern: node_modules/three/src/math/MathUtils.js damp() —
// lerp(x, y, 1 - exp(-lambda*dt)), the frame-rate-independent form.
camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, POSITION_LAMBDA, dtSec);
const t = 1 - Math.exp(-HEADING_LAMBDA * dtSec);
camera.quaternion.slerp(targetHeadingQuat, t); // ALWAYS THREE.Quaternion.slerp, never hand-rolled — interpolator.ts's own stated rule
```

**Heading derivation, never chassis yaw** (mirrors `vehicle.ts`'s own `sampleVehicle`'s `slipAngleRad = Math.atan2(lateralSpeedMs, forwardSpeedMs)` idiom, lines 339-342):
```typescript
const heading = Math.atan2(velocity.x, velocity.z); // CAM-01: velocity heading, not body.rotation()
```

**Where it is called from** — `src/main.ts`'s `render(alpha, dtMs)` callback, exactly where the current placeholder chase camera already lives (`src/main.ts` lines 117-135, 143-160) — never inside the fixed-tick loop body (Pitfall 3).

**Error handling:** none needed beyond the near-zero-speed atan2 instability guard (blend toward chassis-forward below a speed threshold using a smoothstep, per 03-RESEARCH.md) — this is numerical robustness, not exception handling, matching the project's convention of guarding degenerate math inputs rather than throwing (see `sampleVehicle`'s `clamp(up.y, -1, 1)` before `Math.acos`, `vehicle.ts` line 343).

---

### `src/render/camera/occlusion.ts` (utility, event-driven raycast classification)

**Analog:** `src/physics/vehicle-assists.ts` — free function, explicit parameters, directly unit-testable with hand-built inputs (same shape this file's own doc comment states as its reason for existing, lines 16-21).

**Free-function-with-explicit-params pattern** (`vehicle-assists.ts` lines 16-21, adapted):
```typescript
/**
 * `detectOcclusion` is a FREE function taking every dependency explicitly
 * (camera position, target position, hit array) rather than a class method —
 * directly unit-testable from tests/occlusion.test.ts with hand-built fake
 * raycast-hit arrays (mirrors tests/debug-gate.test.ts's Node-safe fake
 * style), no real THREE.Raycaster/scene required for the pure decision logic.
 */
export function classifyOcclusion(hits: readonly { distance: number }[]): OcclusionState { ... }
```

**Raycaster call site itself (render-only, not unit-tested)** (03-RESEARCH.md Pattern 5):
```typescript
const ray = new THREE.Raycaster();
const dir = targetPos.clone().sub(camera.position);
const dist = dir.length();
ray.set(camera.position, dir.normalize());
ray.far = dist;
const hits = ray.intersectObjects(buildingMeshes, false);
```

**Anti-pattern flagged in research — do not add `three-mesh-bvh` this phase** (CLAUDE.md's own explicit scoping, restated in 03-RESEARCH.md "Don't Hand-Roll" and "Anti-Patterns"): plain `intersectObjects` is correct at this phase's placeholder building count.

---

### `src/audio/audio-bootstrap.ts` (provider, event-driven gesture-gated)

**Analog:** `src/render/renderer.ts` — one-time subsystem construction with a lifecycle (`dispose()`, event listener registered/removed), the closest existing "build once at composition root, return a handle with dispose" shape for a brand-new subsystem.

**Construction + resize/dispose lifecycle pattern** (`renderer.ts` lines 48-52, 96-110):
```typescript
export interface AudioContext_ {
  readonly listener: THREE.AudioListener;
  dispose(): void;
}
export function createAudioBootstrap(camera: THREE.Camera): AudioContext_ {
  const listener = new THREE.AudioListener();
  camera.add(listener);
  // Gesture-gated resume — a genuine, commonly-hit pitfall for a from-scratch
  // audio bootstrap (03-RESEARCH.md Surface Audio section): AudioContext
  // starts suspended until a user gesture.
  const resume = () => { listener.context.resume(); };
  addEventListener("keydown", resume, { once: true });
  addEventListener("click", resume, { once: true });
  return {
    listener,
    dispose(): void {
      removeEventListener("keydown", resume);
      removeEventListener("click", resume);
      camera.remove(listener);
    },
  };
}
```

**Debug-gating note:** audio bootstrap itself is ALWAYS constructed (player-facing, like `speedo` in `src/main.ts` line 81, "NOT gated on `DEBUG_ENABLED`") — only any dev-only volume/debug overlay would follow the `DEBUG_ENABLED` construct-then-toggle shape.

---

### `src/audio/surface-audio.ts` (component, streaming per-frame gain crossfade)

**Analog:** `src/render/vehicle-view.ts`'s `updateWheels(vc)` — a per-frame update method that reads sampled/controller state and writes only to owned objects (here: `PositionalAudio` gain nodes instead of mesh transforms).

**Per-frame update method shape** (`vehicle-view.ts` lines 148-151, 307-336 adapted):
```typescript
export interface SurfaceAudioController {
  /** Reads current per-wheel surface + contact state, writes only gain. Called once per RENDER frame, never the fixed tick (audio is presentation, not simulation — 03-RESEARCH.md). */
  update(groundedSurfacesByWheel: readonly SurfaceType[], contacts: readonly boolean[]): void;
  dispose(): void;
}
```

**PositionalAudio construction** (03-RESEARCH.md "Surface Audio", verified against installed `three/src/audio/PositionalAudio.js`):
```typescript
const sound = new THREE.PositionalAudio(listener);
sound.setRefDistance(8);
sound.setRolloffFactor(1.5);
new THREE.AudioLoader().load(assetUrl, (buffer) => { sound.setBuffer(buffer); sound.setLoop(true); });
chassisMesh.add(sound); // one chassis-attached channel per surface, crossfaded — not per-wheel (A3 in Assumptions Log)
```

**Layering:** lives in `src/render/`-equivalent territory (new `src/audio/` sibling, same rule) — reads sampled state, writes only `sound.setVolume()`; never imported by `src/physics/`.

---

### `src/core/surface-tuning.ts` and `src/core/camera-tuning.ts` (config, CRUD clamp/persist)

**Analog:** `src/core/vehicle-tuning.ts` — exact structural match; both new files should literally reuse its `TuningRange`/`clampNode`/`copyLeaves`/`parseSavedTuning` machinery via the factored-out `tuning-utils.ts` (see next entry) rather than duplicate it.

**Shape to copy** (`vehicle-tuning.ts` lines 29-36, 283-327, 346-388, 505-513):
```typescript
export interface TuningRange { readonly min: number; readonly max: number; readonly step: number; }

export interface SurfaceProfiles {
  readonly tarmac: { forwardGrip: number; lateralGrip: number };
  readonly gravel: { forwardGrip: number; lateralGrip: number };
  readonly dirt_road: { forwardGrip: number; lateralGrip: number };
  readonly grass: { forwardGrip: number; lateralGrip: number };
  readonly sand: { forwardGrip: number; lateralGrip: number };
  readonly mud: { forwardGrip: number; lateralGrip: number };
}

export function defaultSurfaceProfiles(): SurfaceProfiles { /* 03-RESEARCH.md "Surface Grip Ranking" table, verbatim starting values */ }

export const SURFACE_PROFILE_RANGES: { /* mirrors defaultSurfaceProfiles' shape */ } = { /* ... */ };

export function clampSurfaceProfiles(p: SurfaceProfiles): SurfaceProfiles { /* delegates to tuning-utils.clampNode */ }
```

**Doc-comment convention to imitate** (`vehicle-tuning.ts`'s per-field `[MEASURED]`/`[ASSUMED]` tags, e.g. lines 93-102, 454-478): every `SurfaceProfiles` default must carry the same "value / provenance tag / retune-in-session" comment style — 03-RESEARCH.md's own table already provides the exact `[ASSUMED]`/`[CITED]` tags to copy verbatim, e.g.:
```typescript
/**
 * `[ASSUMED]` — the loosest surface per D-04's explicit ranking intent; floored
 * well above zero so the car never becomes genuinely undriveable, matching
 * D-04's "stays controllable" requirement. Retune in the phase's feel session,
 * exactly like rearSideFriction/powerOversteerGain/bodyRollGain were in
 * Phase 2's plan 02-10.
 */
mud: { forwardGrip: 0.40, lateralGrip: 0.50 },
```

**Persistence key convention** (`vehicle-tuning.ts` line 520): `export const SURFACE_TUNING_STORAGE_KEY = "heat-street.surface-tuning.v1";` / `export const CAMERA_TUNING_STORAGE_KEY = "heat-street.camera-tuning.v1";` — same `"heat-street.<domain>.v1"` naming shape, own distinct keys (never share `TUNING_STORAGE_KEY` with the vehicle blob).

---

### `src/core/tuning-utils.ts` (new — factored generic clamp/parse utility)

**Analog:** `src/core/vehicle-tuning.ts`'s own `isPlainObject`/`isTuningRange`/`clampNode`/`copyLeaves` functions (lines 449-556) — this is a refactor-extraction, not a new pattern. Per 03-RESEARCH.md's explicit "Don't Hand-Roll" and "Anti-Patterns to Avoid" guidance: *"Building a parallel clamp/validate/persist pipeline for new surface or camera tuning values ... factor it into a shared helper (e.g. `src/core/tuning-utils.ts`) reused by a new `surface-tuning.ts`/`camera-tuning.ts` rather than hand-rolling a second ASVS V5 input-validation boundary."*

**Extraction shape** (move verbatim from `vehicle-tuning.ts`, generalized over `Record<string, unknown>` — already written generically, no change needed beyond moving the functions and re-exporting):
```typescript
export interface TuningRange { readonly min: number; readonly max: number; readonly step: number; }
export function isPlainObject(v: unknown): v is Record<string, unknown> { ... }
export function isTuningRange(v: unknown): v is TuningRange { ... }
export function clampNode(valueNode, rangeNode, fallbackNode): void { ... }
export function copyLeaves(parsedNode, targetNode, rangeNode): void { ... }
```
`vehicle-tuning.ts` itself should be updated to import from `tuning-utils.ts` rather than duplicate — this is a cross-cutting refactor touching an existing Phase 2 file, called out explicitly so the planner assigns it as a task, not an incidental side effect.

---

### `src/debug/tuning-panel.ts` (MODIFIED — extend existing panel)

**Analog:** itself — extend the existing folder structure, do not create a second panel instance.

**Folder-order-is-a-contract convention** (`tuning-panel.ts` lines 161-170): append two new folders (`Surfaces`, `Camera`) AFTER the existing six (`Chassis -> Suspension -> Grip -> Drive -> Assists -> Telemetry`), never reordering the existing ones — muscle memory from Phase 2's tuning sessions must survive.

**onChange vs onFinishChange discipline** (lines 172-214): every new surface/camera slider is a plain per-wheel-safe numeric multiplier or damping lambda — none of them invalidate cached mass properties the way `chassis.mass`/`comOffset`/`halfExtents` do, so all new controls bind `.onChange(onApply)`, never `.onFinishChange`.

**Persistence bubbling** (lines 411-421): a single `gui.onChange` at the root already persists on ANY change anywhere in the tree — no new persistence wiring is needed when new folders are added, only new `store.set` keys if surface/camera tuning use their OWN storage key rather than being merged into the existing `VehicleTuning` blob (recommended: separate keys, per `surface-tuning.ts`/`camera-tuning.ts` above).

---

### `src/main.ts` (MODIFIED — composition root)

**Analog:** itself — extend using the exact established "construct only if `DEBUG_ENABLED`, then register a hotkey toggle" shape already used three times (HUD, tuning panel, telemetry HUD).

**Construct-gate-toggle shape to copy verbatim** (`main.ts` lines 83-115):
```typescript
const skinToggle = DEBUG_ENABLED ? createCameraSkinToggle(canvas) : null; // D-14
if (skinToggle) {
  onDebugKey("KeyS", () => skinToggle.cycle()); // police <-> sports <-> off
}
const occlusionDebug = DEBUG_ENABLED ? createOcclusionDebugToggle() : null; // D-06 A/B
if (occlusionDebug) {
  onDebugKey("KeyO", () => occlusionDebug.cycle()); // fade <-> steepen
}
```

**Scene swap** (mirrors `main.ts` line 51's `createVehicleScene(world, tuning)` call, replaced with `createSurfaceScene(world, tuning, surfaceTuning)`), and the render callback (`main.ts` lines 143-166) gains the camera rig's own `.update(dtMs)` call plus `surfaceAudio.update(...)`/`surfaceFx.update(...)` calls, in the same position the existing camera-follow code occupies today (lines 154-160) — REPLACING that placeholder chase-cam block, not appending alongside it (Phase 3 supersedes Phase 2's placeholder camera at the composition root exactly as Phase 2 superseded Phase 1's debug scene).

**Comment convention for a superseded predecessor** (`main.ts` lines 16-19, 54-60): document explicitly that `vehicle-scene.ts` and the placeholder chase camera stay in place as regression fixtures / Phase 2 feel-session artifacts, never deleted as a side effect of this phase.

---

### Test files (`tests/surface.test.ts`, `tests/camera-heading.test.ts`, `tests/camera-framing.test.ts`, `tests/camera-skin.test.ts`, `tests/occlusion.test.ts`)

**Analog:** the project's existing pure-function test style — hand-built inputs, no DOM/WebGL, asserting on explicit return values. `vehicle-assists.ts`'s design rationale (lines 16-21) IS this convention's justification, and `tests/debug-gate.test.ts`'s hand-built-fake style is the concrete template for anything touching "fake DOM-shaped" input (occlusion hits, skin toggle class lists).

**`tests/surface-telemetry.test.ts` analog:** `tests/vehicle-telemetry.test.ts` + `src/physics/telemetry/run.ts`'s `runRoutine` two-runner design — extend `ROUTINES`-style scripted routines with a per-surface skidpad sweep, reusing `runRoutine`'s exact throwaway-world-per-run discipline (`run.ts` lines 63-96) rather than inventing a second harness.

## Shared Patterns

### Layering discipline (`src/physics/` vs `src/render/` vs `src/core/`)
**Source:** every existing file's own doc-comment header (`vehicle-scene.ts` lines 14-18, `vehicle-view.ts` lines 16-27, `vehicle-tuning.ts` lines 23-27).
**Apply to:** ALL new files this phase. `src/physics/surface.ts` and `src/physics/surface-scene.ts` must not import `three`; `src/render/*` and `src/audio/*` may read Rapier types (`import type * as RAPIER`) but never write (`world.step`, `applyImpulse`, `setTranslation`, etc.); `src/core/*` must stay pure (no `three`, no `@dimforge/rapier3d`, no DOM, no wall clock) — `tests/layering.test.ts` mechanically enforces this and will fail CI on a violation.
```typescript
/**
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
```

### Debug-gated dev tooling
**Source:** `src/debug/debug-gate.ts`'s `onDebugKey`/`DEBUG_ENABLED`, applied identically three times already in `src/main.ts`.
**Apply to:** the camera-skin dev-toggle (D-14), the occlusion mitigation A/B toggle (D-06), and any surface-FX debug overlay.
```typescript
const thing = DEBUG_ENABLED ? createThing(...) : null;
if (thing) { onDebugKey("KeyX", () => thing.toggle()); }
```

### Generic config-in/controller-out factory (D-09 precedent, reused by D-13)
**Source:** `src/physics/vehicle.ts`'s `createVehicle(world, tuning, spawn): Vehicle`.
**Apply to:** `createHelicopterCamera(target: CameraTarget, tuning: CameraTuning): CameraRig` — must not hardcode "the player car" anywhere in its type signature.

### Frame-rate-independent damping, never a fixed-fraction lerp
**Source:** `src/render/interpolator.ts`'s `THREE.Quaternion.slerp` + alpha-blend discipline; `node_modules/three/src/math/MathUtils.js`'s `damp()`.
**Apply to:** every camera smoothing value (position, heading, altitude, FOV) and the occlusion fade/steepen transition — always `THREE.MathUtils.damp(x, y, lambda, dtSec)` or a `1 - exp(-lambda*dtSec)`-derived slerp `t`, never `lerp(x, y, fixedFraction)`.

### TUNING_RANGES + clamp + localStorage persistence pipeline
**Source:** `src/core/vehicle-tuning.ts`'s `TuningRange`/`clampNode`/`copyLeaves`/`parseSavedTuning`/`serializeTuning`, to be factored into `src/core/tuning-utils.ts` per 03-RESEARCH.md's explicit instruction.
**Apply to:** `src/core/surface-tuning.ts` (SURFACE_PROFILES) and `src/core/camera-tuning.ts` (damping lambdas, altitude/FOV curve constants) — one ASVS V5 input-validation code path for the whole project, not a third hand-rolled one.

### Physics-scene-builder + matching-render-module with "MUST MATCH" comment
**Source:** `src/physics/vehicle-scene.ts` <-> `src/render/vehicle-view.ts` pairing, explicitly cited in CONTEXT.md's Reusable Assets.
**Apply to:** `src/physics/surface-scene.ts` <-> `src/render/surface-view.ts` — every zone/building dimension declared once in the physics file, duplicated as a literal (not imported) in the render file with a `// MUST MATCH <physics file>` comment, exactly matching the established convention (never cross-import geometry constants between the two layers).

### Fixed-size resource pools (ASVS V5 / DoS mitigation)
**Source:** 03-RESEARCH.md's Security Domain table; no direct existing code precedent (first phase with particle/decal pools), but the PRINCIPLE mirrors `TransformCache`'s fixed-size typed-array allocation (`transform-cache.ts` lines 45-54: allocate once at construction, write in place forever, never grow).
**Apply to:** `surface-fx.ts`'s particle systems and decal pool — fixed capacity decided at construction, ring-buffer recycling, never an unbounded push.

## No Analog Found

None. Every file in this phase's scope has at least a role-match analog somewhere in Phases 1-2's shipped code, per 03-RESEARCH.md's own framing ("every recommended pattern extends an already-shipped convention in this exact repo... not a novel proposal"). The closest to a true gap is `src/render/surface-fx.ts`'s particle-pool/decal mechanism, which has no PRIOR EXAMPLE in this repo (first phase to touch `THREE.Points`/`DecalGeometry`) — its pattern is instead sourced directly from the bundled `three/addons/geometries/DecalGeometry.js` module and 03-RESEARCH.md's own worked recommendation, not from an existing project file. Flagged here for visibility, not left unassigned.

## Metadata

**Analog search scope:** `src/physics/`, `src/render/`, `src/core/`, `src/debug/`, `src/audio/` (does not yet exist), `src/main.ts`, `docs/schemas/road-graph.v1.md`, `node_modules/three` (bundled addons only, per CLAUDE.md-approved sources).
**Files scanned:** `src/physics/vehicle-scene.ts`, `src/physics/vehicle.ts`, `src/physics/vehicle-assists.ts`, `src/physics/transform-cache.ts`, `src/physics/telemetry/routines.ts`, `src/physics/telemetry/run.ts`, `src/render/vehicle-view.ts`, `src/render/renderer.ts`, `src/render/interpolator.ts`, `src/core/vehicle-tuning.ts`, `src/debug/tuning-panel.ts`, `src/debug/debug-gate.ts`, `src/main.ts`, `docs/schemas/road-graph.v1.md` (13 files read in full or targeted excerpt; 0 re-reads of the same range).
**Pattern extraction date:** 2026-09-12
