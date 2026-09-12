# Phase 3: Surfaces & Helicopter Camera - Research

**Researched:** 2026-09-12
**Domain:** Rapier per-wheel surface friction, Three.js particle/decal/audio FX, follow-camera rigs with occlusion mitigation
**Confidence:** MEDIUM-HIGH (stack/API claims verified against the installed packages; grip-ranking numbers and camera-skin visual treatment are reasoned recommendations pending human playtest per CONTEXT.md)

## Summary

This phase has two independent halves that share almost no code: (1) per-wheel surface
friction driving grip/FX/audio, and (2) a velocity-heading-tracking helicopter camera with
speed-driven framing and building-occlusion mitigation. Both halves build on patterns already
established in Phases 1-2 (`src/physics/` vs `src/render/` layering, the `TUNING_RANGES` +
lil-gui + `clampTuning` persistence pipeline, the "physics scene builder + matching render
module with a MUST MATCH comment" convention) rather than needing new architecture.

The single most important, previously-undocumented finding: **Rapier's shipped
`@dimforge/rapier3d@0.20.0` JS bindings have no `userData` slot on `Collider`/`ColliderDesc`
at all** — only `RigidBody`/`RigidBodyDesc` expose `setUserData`/`.userData` (verified by
reading the installed package's `.d.ts` files directly). CLAUDE.md's open gap ("user data vs.
`Map<colliderHandle, SurfaceType>` vs. collision groups — all three are viable") is therefore
not actually three equally-viable options: collider-level userData does not exist in this
binding. The two real options are a `Map<ColliderHandle, SurfaceType>` keyed on
`collider.handle` (a plain `number`, zero extra WASM-wrapper allocation) or reading
`wheelGroundObject(i)?.parent()?.userData` (which works, since a zone can be its own fixed
`RigidBody` with `setUserData` called at construction, but allocates a fresh `RigidBody`
wrapper object on every call for every wheel every tick). **Recommendation: the
`Map<ColliderHandle, SurfaceType>` side-table**, populated once at scene-build time — cheaper
per-tick, and keeps the physics layer free of an ad-hoc "stash game data on a physics object"
pattern.

Second load-bearing finding: **the six surface names are already frozen** in
`docs/schemas/road-graph.v1.md` as a normative, test-enforced closed enum:
`tarmac | gravel | dirt_road | grass | sand | mud` (note: `dirt_road`, not `dirt` — CONTEXT.md
and REQUIREMENTS.md's prose shorthand "dirt" refers to this same value).
`tests/road-graph-schema.test.ts` already asserts this exact array, in this exact order, parsed
straight out of the doc. This phase's new `SurfaceType` must use these six literal strings —
using `"dirt"` instead of `"dirt_road"` would create a silent naming mismatch with the artifact
Phase 4's map compiler will eventually emit.

**Primary recommendation:** build a `Map<ColliderHandle, SurfaceType>` populated when the
surface-zone colliders are constructed; read each wheel's current surface via
`wheelGroundObject(i)?.handle` once per tick (accepting a one-tick lag, since that read
reflects the previous tick's raycast); scale `frictionSlip` and
`frontSideFriction`/`rearSideFriction` per wheel by a per-surface multiplier pair (forward grip,
lateral grip) before calling the existing Rapier setters — this is a direct, minimal extension
of the per-tick friction-setting code that already exists in `src/physics/vehicle.ts` for the
handbrake/power-oversteer blend, not a new mechanism.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-wheel surface friction (SURF-01) | Physics (Rapier, `src/physics/`) | — | Grip is a solver input; must never depend on render state |
| Surface-to-collider mapping | Physics (`src/physics/`) | — | Built alongside the colliders it describes; pure data, no `three` |
| Surface visual FX (smoke/dust/spray/decals) | Render (`src/render/`) | — | Reads sampled vehicle/surface state, writes only meshes/particles |
| Surface audio (tire chirp/rumble) | Render (`src/render/` or new `src/audio/`) | — | `THREE.PositionalAudio` is a scene-graph object; first audio system in the repo |
| Helicopter camera rig (CAM-01/02) | Render (`src/render/` or new `src/camera/`) | — | Pure read of sampled vehicle state + `THREE.PerspectiveCamera`, no physics writes |
| Camera skin presentation (CAM-03) | Render / DOM (CSS overlay on canvas + absolutely-positioned HUD chrome) | Render (Three scene, if any 3D prop differs) | CAM-03 says presentation-only; the cheapest presentation-only lever is CSS, matching the existing HUD's "DOM over canvas, zero draw calls" convention |
| Occlusion detection (CAM-04) | Render (`THREE.Raycaster` against building meshes) | — | Render-only geometry query; CLAUDE.md explicitly scopes `three-mesh-bvh` to exactly this later, not this phase's small building count |
| Occlusion mitigation (fade / steepen) | Render | — | Material opacity and camera pitch are both render-only state |
| Placeholder surface + building test scene | Physics (colliders/bodies) | Render (matching visual meshes) | Mirrors the existing `vehicle-scene.ts` / `vehicle-view.ts` split exactly |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The test scene is a patchwork of adjacent surface zones on one flat plane — tarmac, gravel, grass, mud, sand, dirt side by side — so a single straight drive crosses all 6 and directly demonstrates SC1.
- **D-02:** This scene does NOT reuse Phase 2's ramp — fresh layout, exact shape Claude's discretion.
- **D-03:** Dev/test fixture only, matching `src/physics/debug-scene.ts` / `src/physics/vehicle-scene.ts` precedent — superseded once Phase 4's real map pipeline lands.
- **D-04:** Loosest surfaces (mud, sand) noticeably slippery but stay controllable — arcade-realistic hybrid, not authentically treacherous.
- **D-05:** Overall grip ranking is Claude's research-informed discretion, with one explicit anchor: dirt/gravel-style surfaces must support a pronounced, dramatic slide with heavy matching dust (Dukes of Hazzard reference).
- **D-06:** Build placeholder box/cuboid buildings specifically to make SC6's occlusion mitigations genuinely testable this phase — no deferred playtest.
- **D-07:** Building layout is a few clustered zones of varying density (one sparse, one dense/urban-canyon) rather than a random scatter.
- **D-08:** Visual approach is simple GPU particle sprites (`THREE.Points`, soft puff textures, colour per surface) plus skid decals.
- **D-09:** All 6 surfaces get fully distinct visual AND audio treatment (SURF-02 taken literally) — not grouped.
- **D-10:** Surface audio assets sourced by researching CC0/royalty-free sources (Freesound.org, itch.io packs) as part of this phase's research step.
- **D-11:** "Stable through a full 40-degree drift" (SC3) means no shake/jitter, with a smooth lag as the camera catches up to velocity heading — not a near-zero-lag tight lock.
- **D-12:** If the helicopter camera genuinely fails SC4's go/no-go gate after real tuning effort, the low chase-cam fallback becomes the actual shipped/permanent camera, not a dev-only escape hatch.
- **D-13:** The camera's target-tracking mechanism should be built generic/swappable ("what am I following") even though only one car exists this phase — mirrors Phase 2's D-09 precedent.
- **D-14:** Build a dev-toggle to preview both the police/news and sports-broadcast skins this phase.
- **D-15:** Visual differentiation between the two skins is Claude's research-informed discretion.

### Claude's Discretion
- Exact fresh test-scene layout replacing the Phase 2 ramp (D-02).
- Surface grip ranking / per-surface friction multipliers, research-informed, respecting the Dukes-of-Hazzard dirt/gravel slide+dust anchor (D-05).
- Camera skin visual treatment specifics (D-15).
- Exact particle-system implementation details (texture, count, lifetime, emission rate) for surface FX (D-08).
- Helicopter camera altitude/FOV curve shape vs. speed, tuned against SC4's go/no-go gate.
- Surface-type-to-collider mapping mechanism (`wheelGroundObject` → surface type: user-data vs. a `Map<colliderHandle, SurfaceType>` vs. collision groups) — resolved concretely above (see Summary and "Surface-to-Collider Mapping" below): collider-level userData does not exist in the shipped binding, so the real choice is `Map<ColliderHandle, SurfaceType>` (recommended) vs. RigidBody-level userData via `.parent()`.

### Deferred Ideas (OUT OF SCOPE)
- Physics-based kicked-up surface debris (gravity-affected mud clods actually kicked up by tire contact) — explicitly a future evolution beyond this phase's sprite-based FX (D-08's caveat). This phase builds the simple particle-sprite version only.
- Full multi-car camera framing (chase target + pursuers simultaneously in frame) — Phase 7/8's problem once NPCs exist; this phase only ensures the targeting mechanism is generic (D-13).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SURF-01 | Tarmac/gravel/grass/mud/sand/dirt-road surfaces each provide distinct grip via per-wheel friction (not ground-collider friction) | "Surface-to-Collider Mapping" + "Per-Wheel Friction Application" sections give the exact API sequence and tick-ordering fix; "Surface Grip Ranking" gives starting multiplier values |
| SURF-02 | Each surface type has distinct visual feedback (smoke/dust/mud spray/skid decal) and audio (chirp vs. muffled rumble) | "Surface Visual FX" (THREE.Points sprite system + DecalGeometry pooling) and "Surface Audio" (PositionalAudio + CC0 source research) sections |
| CAM-01 | Permanent high-angle helicopter camera that smoothly follows velocity heading, not chassis yaw | "Helicopter Camera Rig" section: velocity-heading extraction, low-speed blend-to-chassis-forward, `THREE.MathUtils.damp` + quaternion slerp for smoothing |
| CAM-02 | Camera altitude and FOV adjust with speed | "Speed-Driven Framing" subsection: altitude/FOV curve pattern, `camera.fov` + `updateProjectionMatrix()` |
| CAM-03 | Camera contextually skinned per mode (police/news vs. sports-broadcast) | "Camera Skin Presentation" subsection: CSS-filter-on-canvas + DOM chrome overlay, zero effect on 3D targeting/damping |
| CAM-04 | Buildings never permanently block the car/road view; approach resolved by prototyping, not fixed in advance | "Occlusion Detection & Mitigation" section: `THREE.Raycaster` occlusion test, both mitigation code paths (fade / steepen), placeholder building layout guidance |

## Project Constraints (from CLAUDE.md)

- WebGLRenderer, not WebGPURenderer — locked project-wide; this phase's occlusion fade and
  camera-skin colour grade must use standard `MeshStandardMaterial`/CSS, never a custom
  `ShaderMaterial` that would complicate a future WebGPU migration.
- `THREE.AudioListener` + `THREE.PositionalAudio` for all spatial sound (engine, sirens, tire
  screech, impacts) — this is the first phase to actually build that system; no Howler.js.
- Raw Web Audio API (`GainNode`, `BiquadFilterNode`) permitted for RPM crossfade / distance
  low-pass — not needed for surface FX audio itself, but the audio bootstrap this phase adds
  is shared infrastructure Phase 6+ will reuse for engine sound.
- Meshopt over Draco for any future glTF assets — not triggered this phase (no new models;
  buildings are procedural box geometry, no glTF pipeline involved).
- Fixed-timestep physics is non-negotiable — surface friction lookups and multiplier
  application happen inside `Vehicle.tick()`, which runs on the fixed physics tick, never in
  `render()`.
- `three-mesh-bvh` is explicitly scoped by CLAUDE.md to "once you're querying render-only
  geometry" and named as a candidate specifically for "camera occlusion from the helicopter
  cam" — but at this phase's placeholder building count (a handful of boxes in two density
  clusters), a plain `THREE.Raycaster.intersectObjects()` is more than fast enough; adding
  `three-mesh-bvh` now would be premature optimisation against CLAUDE.md's own stated trigger
  condition ("once it doesn't scale").
- Debug-gated dev tooling: `?debug` + a dedicated hotkey (`src/debug/debug-gate.ts`'s
  `onDebugKey`) is the established convention this phase's camera-skin toggle and any
  surface-FX debug controls must follow — never player-facing, zero listeners registered in a
  normal build.
- `lil-gui` is imported from `three/addons/libs/lil-gui.module.min.js` (already bundled, zero
  net dependency) — any new surface-tuning or camera-tuning panel extends this same import,
  not a fresh `npm install lil-gui`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dimforge/rapier3d` | `0.20.0` (already installed) | `wheelGroundObject`, `setWheelFrictionSlip`, `setWheelSideFrictionStiffness`, `ColliderHandle` | Already the project's physics engine; this phase only adds new call sites, no new package |
| `three` | `0.185.1` (already installed) | `THREE.Points`/`PointsMaterial`, `THREE.PositionalAudio`/`AudioListener`/`AudioLoader`, `THREE.PerspectiveCamera`, `THREE.Raycaster`, `THREE.MathUtils.damp` | All required APIs are CORE three, verified present in the installed package (see Code Examples) — no addon needed for particles or audio |
| `three/addons/geometries/DecalGeometry.js` | bundled with three 0.185.1 | Skid-mark decal projection onto the ground plane | Bundled addon, zero net dependency, verified present at `node_modules/three/examples/jsm/geometries/DecalGeometry.js` |
| `three/addons/libs/lil-gui.module.min.js` | bundled with three 0.185.1 | Any new debug sliders (surface grip multipliers, camera altitude/FOV curve) | Already the project's tuning-panel library (Phase 2); zero net dependency |

### Supporting
No new npm/pip/cargo packages are required by this phase. Every capability (particle sprites,
decals, positional audio, camera raycasting, frame-rate-independent damping) is served by
`three` core or an already-bundled `three/addons` module.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `THREE.Points` sprite particles | A dedicated particle library (e.g. `three.quarks`) | More features (curves, GPU instancing, sub-emitters) but a new dependency for a D-08-scoped "simple particle sprites" requirement; revisit only if the deferred physics-based debris system needs it |
| `Map<ColliderHandle, SurfaceType>` | Collision groups (`InteractionGroups`, a 16-bit bitmask) repurposed to encode surface type | Technically fits (6 surfaces < 16 bits), but collision groups are a collision-filtering primitive with real filtering semantics already reserved for gameplay (e.g. future pursuer-vs-player exclusions); overloading it for surface tagging is a legibility/collision-risk hazard the Map avoids entirely |
| `Map<ColliderHandle, SurfaceType>` | `collider.parent()?.userData` (RigidBody-level) | Also viable — but `.parent()` constructs a fresh `RigidBody` WASM wrapper object on every call; doing this for up to 4 wheels every tick is avoidable per-frame allocation the Map approach has zero of |
| `THREE.Raycaster` for occlusion | `three-mesh-bvh` | Faster for large/complex geometry, but explicitly scoped by CLAUDE.md to real city-scale geometry (Phase 4+); premature here at a handful of placeholder boxes |
| CSS `filter` on the canvas for camera-skin colour grade | `EffectComposer` + a custom colour-correction shader pass | More "correct" post-processing, but adds a second render pass — `renderer.info.autoReset` and the profiler HUD's single-draw-call assumption (documented in `src/render/renderer.ts`) would need revisiting; CSS is presentation-only, zero extra WebGL draw calls, and directly matches CAM-03's "changing presentation only" requirement |

**Installation:**
No installation required — every dependency above is already present in `package.json` or
bundled inside the installed `three` package.

**Version verification:**
```
$ npm view @dimforge/rapier3d version   -> 0.20.0 (matches installed, package.json pin)
$ npm view three version                -> 0.185.1 (matches installed, package.json pin)
```
Both match the versions already pinned in `package.json`; no bump needed for this phase.

## Package Legitimacy Audit

No external packages are installed by this phase — every capability is served by the
already-installed `three`/`@dimforge/rapier3d` or a bundled `three/addons` module (verified by
reading the installed `node_modules` tree directly, not by trusting training data). The
Package Legitimacy Gate protocol therefore has nothing to audit for `npm install`.

**Packages removed due to slopcheck [SLOP] verdict:** none (n/a — no packages proposed)
**Packages flagged as suspicious [SUS]:** none (n/a — no packages proposed)

One non-package legitimacy concern *is* relevant and is flagged separately in "Common
Pitfalls" below: the CC0/royalty-free **audio assets** researched for D-10 are binary content
files, not npm packages, and slopcheck has nothing to say about them — their license text must
be verified by a human at the specific asset URL before the file is committed, not inferred
from a search-result summary (see Pitfall "Audio license summaries are not the license").

## Surface-to-Collider Mapping (resolves CLAUDE.md's open gap)

**Verified against the installed `@dimforge/rapier3d@0.20.0` `.d.ts` files:**

- `Collider` (in `geometry/collider.d.ts`) has no `userData` field and `ColliderDesc` has no
  `setUserData` method — grepping the entire package for `userData` finds it **only** on
  `RigidBodyDesc`/`RigidBody` (`dynamics/rigid_body.d.ts`, `setUserData(data?: unknown):
  RigidBodyDesc`). `[VERIFIED: read directly from installed package/rapier.d.ts]`
- `Collider.handle` is a `readonly ColliderHandle` and `ColliderHandle = number`
  (`geometry/collider.d.ts`). `[VERIFIED]`
- `DynamicRayCastVehicleController.wheelGroundObject(i): Collider | null`
  (`control/ray_cast_vehicle_controller.d.ts`) is the existing, already-documented (CLAUDE.md)
  per-wheel ground lookup. `[VERIFIED]`

**Recommended mechanism:**

```typescript
// src/physics/surface.ts (new module; pure, no `three` import)
export type SurfaceType = "tarmac" | "gravel" | "dirt_road" | "grass" | "sand" | "mud";
// ^ MUST match docs/schemas/road-graph.v1.md's SURFACE_ENUM exactly (order and spelling),
// including "dirt_road" (not "dirt") — tests/road-graph-schema.test.ts already asserts
// ["tarmac", "gravel", "dirt_road", "grass", "sand", "mud"] against that doc.

export interface SurfaceMap {
  register(colliderHandle: number, surface: SurfaceType): void;
  lookup(colliderHandle: number | undefined): SurfaceType;
}

export function createSurfaceMap(defaultSurface: SurfaceType = "tarmac"): SurfaceMap {
  const table = new Map<number, SurfaceType>();
  return {
    register(handle, surface) { table.set(handle, surface); },
    lookup(handle) {
      if (handle === undefined) return defaultSurface; // airborne wheel: hold last-known or default
      return table.get(handle) ?? defaultSurface;
    },
  };
}
```

The surface-zone scene builder calls `surfaceMap.register(collider.handle, "gravel")` (etc.)
immediately after `world.createCollider(...)` for each zone. `Vehicle.tick()` (or a thin wrapper
around it) then does, once per tick, for each of the 4 wheels:

```typescript
const groundCollider = vc.wheelGroundObject(i); // Collider | null
const surface = surfaceMap.lookup(groundCollider?.handle);
const profile = SURFACE_PROFILES[surface];
vc.setWheelFrictionSlip(i, baseFrictionSlip * profile.forwardGrip);
vc.setWheelSideFrictionStiffness(i, baseSideFriction * profile.lateralGrip);
```

**Ordering pitfall (non-obvious, verified against the shipped tick structure in
`src/physics/vehicle.ts`):** `wheelGroundObject(i)` only reflects a fresh raycast **after**
`vc.updateVehicle(DT)` has run for a given tick, but the friction setters must be called
**before** `updateVehicle` so they take effect in that same solve. Reading
`wheelGroundObject(i)` at the top of `tick()` (before this tick's own `updateVehicle` call)
therefore returns **last tick's** ground contact — a one-tick (≈16.6 ms) lag between crossing a
surface boundary and the new friction values taking effect. This is imperceptible at 60 Hz and
requires no extra bookkeeping; it should be documented as an intentional, accepted lag (mirrors
the project's existing acceptance of a similar one-tick lag pattern elsewhere), not "fixed" by
restructuring the tick loop.

**Ground-collider friction is a red herring for this requirement.** SURF-01 explicitly says
grip must come from per-wheel friction, "not ground-collider friction" — `ColliderDesc.setFriction()`
on the zone colliders can stay at whatever fixed value convention prefers (e.g. `1.0`, matching
the existing ground collider), because the raycast vehicle's tire model uses the wheel's own
`frictionSlip`/`sideFrictionStiffness` parameters, not a friction-combine rule against the
ground collider's coefficient, for the vehicle-controller's simplified tire model. `[MEDIUM
confidence — reasoned from the `.d.ts` doc comment wording plus the project's own explicit
requirement text; the shipped WASM's exact internal combine rule was not independently traced
through the Rust source, since only the JS bindings are available to inspect in this
environment]`.

## Architecture Patterns

### System Architecture Diagram

```
 [InputSource] --InputFrame--> [Vehicle.tick()] --writes--> [RigidBody impulses]
                                     |
                                     |  reads wheelGroundObject(i).handle each wheel
                                     v
                          [SurfaceMap: handle -> SurfaceType]
                                     |
                                     v
                     [SURFACE_PROFILES: forwardGrip/lateralGrip]
                                     |
                                     v
                 setWheelFrictionSlip / setWheelSideFrictionStiffness (per wheel)
                                     |
                                     v
                              world.step() (fixed tick)
                                     |
                     (render, once per animation frame, alpha-interpolated)
                                     v
        [sampleVehicle()] --VehicleSample (pos, linvel, slip, contacts)--> [render/]
           |                                    |                              |
           v                                    v                              v
   [SurfaceFxController]                [HelicopterCameraRig]           [SurfaceAudioController]
   spawns Points/decals                 tracks velocity heading,        crossfades PositionalAudio
   per-wheel per-surface                damps position/heading/FOV,     gain per wheel per surface
   (slip-threshold gated)               raycasts for occlusion
                                                |
                                                v
                                    [Occlusion mitigation: fade
                                     building materials OR steepen
                                     camera pitch] -- one active
                                     path, chosen by human playtest
```

### Recommended Project Structure
```
src/physics/
├── surface.ts            # SurfaceType, SurfaceMap, SURFACE_PROFILES (pure data + logic)
├── surface-scene.ts       # NEW test fixture: ground zones + placeholder buildings + one Vehicle
│                           # (replaces vehicle-scene.ts as the phase 3 composition-root scene;
│                           #  vehicle-scene.ts stays as a regression fixture, same precedent
│                           #  vehicle-scene.ts itself set for debug-scene.ts)
src/render/
├── surface-view.ts         # Visual zone planes + placeholder building meshes (MUST MATCH physics)
├── surface-fx.ts           # THREE.Points particle pools + DecalGeometry pooling, per surface
├── camera/
│   ├── helicopter-camera.ts # CameraTarget interface, heading/altitude/FOV damping, skin hook
│   └── occlusion.ts         # Raycaster-based detection + both mitigation implementations
src/audio/
├── audio-bootstrap.ts      # AudioListener creation, camera.add(listener), CC0 asset loading
└── surface-audio.ts        # Per-wheel per-surface PositionalAudio nodes + crossfade gain logic
src/core/
├── surface-tuning.ts        # SURFACE_PROFILES defaults/ranges/clamp, mirroring vehicle-tuning.ts
└── camera-tuning.ts         # Altitude/FOV curve constants, damping lambdas, mirroring same pattern
```

### Pattern 1: Per-Wheel Surface Friction Application
**What:** Look up each wheel's surface every tick and scale the base friction values before the
existing Rapier setters run.
**When to use:** Inside `Vehicle.tick()`, immediately before the existing friction-setting block
(the code that currently only handles the handbrake/power-oversteer rear-side-friction blend).
**Example:**
```typescript
// Source: verified against installed @dimforge/rapier3d@0.20.0 control/ray_cast_vehicle_controller.d.ts
for (let i = 0; i < 4; i++) {
  const ground = vc.wheelGroundObject(i);
  const surface = surfaceMap.lookup(ground?.handle);
  const profile = SURFACE_PROFILES[surface];
  vc.setWheelFrictionSlip(i, t.wheels.frictionSlip * profile.forwardGrip);
  const baseSide = i < 2 ? t.wheels.frontSideFriction : t.wheels.rearSideFriction;
  vc.setWheelSideFrictionStiffness(i, baseSide * profile.lateralGrip);
}
```

### Pattern 2: Generic Camera Target (D-13)
**What:** The camera rig takes a small `CameraTarget` interface, not a concrete `Vehicle`.
**When to use:** Building `createHelicopterCamera(target: CameraTarget, ...)`.
**Example:**
```typescript
// Mirrors D-09's "config-in / controller-out, generic vehicle factory" precedent exactly.
export interface CameraTarget {
  position(): { x: number; y: number; z: number };
  /** World-space XZ velocity; used to derive heading. Y component ignored for heading. */
  velocity(): { x: number; y: number; z: number };
}
// A pursuer built in Phase 7/8 satisfies this interface with zero change here.
```

### Pattern 3: Frame-Rate-Independent Camera Damping
**What:** Smooth the camera's position, heading and altitude/FOV toward their targets using
`THREE.MathUtils.damp` (scalars) and `THREE.Quaternion.slerp` with a damp-derived factor
(rotation), never a raw per-frame lerp constant.
**When to use:** Every camera update in `render(alpha, dtMs)` — this runs once per animation
frame at a **variable** rate (unlike the fixed physics tick), so any smoothing constant must be
expressed as a function of `dtMs`, not a fixed per-frame fraction.
**Example:**
```typescript
// Source: node_modules/three/src/math/MathUtils.js (installed, r185) — damp() is
// `lerp(x, y, 1 - Math.exp(-lambda * dt))`, the frame-rate-independent form
// (Rory Driscoll, "Frame rate independent damping using lerp").
camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, POSITION_LAMBDA, dtSec);
// For heading (wraps at 2*PI): build a target quaternion and slerp with a damp-derived t,
// exactly as src/render/interpolator.ts already does for body transforms — never hand-roll
// angle subtraction, which breaks at the wraparound (the project's own established rule).
const t = 1 - Math.exp(-HEADING_LAMBDA * dtSec);
camera.quaternion.slerp(targetHeadingQuat, t);
```

### Pattern 4: Camera Skin as Presentation-Only CSS
**What:** Implement the police/news vs. sports-broadcast skins as a CSS `filter` on the
`<canvas>` element plus absolutely-positioned DOM "chrome" overlays (channel bug, vignette),
never as a change to camera distance/damping/targeting or a WebGL post-process pass.
**When to use:** CAM-03's dev-toggle.
**Example:**
```typescript
// Mirrors the HUD's existing "absolutely-positioned HTML/CSS over canvas, zero draw calls"
// convention (CLAUDE.md "Game Loop, State & UI"). Swapping a CSS class list entry is the
// entire mechanism — nothing in the Three.js scene or the camera rig changes.
canvas.classList.remove("skin-police", "skin-sports");
canvas.classList.add(skin === "police" ? "skin-police" : "skin-sports");
```
```css
/* Presentation only — see CAM-03: "changing presentation only — never distance, damping or targeting" */
.skin-police { filter: saturate(0.85) contrast(1.05) hue-rotate(-4deg); }
.skin-sports { filter: saturate(1.25) contrast(1.1) brightness(1.05); }
```

### Pattern 5: Occlusion Detection via Raycaster (both mitigations share this)
**What:** Once per frame (or every N frames if profiling shows it matters), cast a ray from the
camera position to the target position against the building mesh array.
**When to use:** Drives BOTH candidate mitigations — the hit-set feeds the fade path, and a
density metric derived from repeated/offset rays feeds the steepen-angle path.
**Example:**
```typescript
// three.js core Raycaster — no addon needed at this building count (see CLAUDE.md's own
// explicit three-mesh-bvh scoping to real city-scale geometry, not this phase).
const ray = new THREE.Raycaster();
const dir = targetPos.clone().sub(camera.position);
const dist = dir.length();
ray.set(camera.position, dir.normalize());
ray.far = dist;
const hits = ray.intersectObjects(buildingMeshes, false);
```

### Anti-Patterns to Avoid
- **Reordering `Vehicle.tick()` to read `wheelGroundObject` "fresh" the same tick it's applied:**
  not possible without restructuring around `updateVehicle`'s raycast timing — accept the
  one-tick lag (Pattern 1) rather than inventing a two-pass tick.
- **Sharing one `PointsMaterial`/`Sprite` texture across all 6 surfaces to save a texture
  atlas:** D-09 requires fully distinct visuals per surface; colour alone (via
  `PointsMaterial.color` per system) is enough to differ without 6 separate textures, but each
  surface still needs its own `THREE.Points` object (different colour, size, emission rate,
  lifetime) — do not try to force one shared particle system with a per-particle surface
  attribute for this phase's simple sprite scope (that complexity belongs to the deferred
  physics-based debris system, not this one).
- **Building a parallel clamp/validate/persist pipeline for new surface or camera tuning
  values:** `src/core/vehicle-tuning.ts`'s `TuningRange`/`clampNode`/`copyLeaves` machinery is
  already generic over any nested numeric-leaf object shape — factor it into a shared helper
  (e.g. `src/core/tuning-utils.ts`) reused by a new `surface-tuning.ts`/`camera-tuning.ts`
  rather than hand-rolling a second ASVS V5 input-validation boundary for the same problem.
- **A second Three.js post-processing pass for the camera-skin colour grade:** breaks the
  `renderer.info.autoReset`/single-draw-call assumption documented in `src/render/renderer.ts`
  for no benefit CAM-03 actually needs (CSS achieves the same "presentation only" requirement
  more cheaply — see Pattern 4).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Quaternion/heading smoothing | A hand-rolled angle-lerp with manual wraparound handling | `THREE.Quaternion.slerp` + a `damp()`-derived `t` | The project's own `interpolator.ts` already states this exact rule for body transforms; the same wraparound bug (visible "long way round" spin once per revolution) applies identically to camera heading |
| Frame-rate-independent smoothing constant | A fixed per-frame `lerp(current, target, 0.1)` | `THREE.MathUtils.damp(x, y, lambda, dtSec)` | A fixed-fraction lerp is framerate-dependent (a 144 Hz session damps twice as fast as 60 Hz for the same nominal constant) — exactly the class of bug VEH-03's fixed-timestep physics discipline exists to avoid, now showing up on the render side instead |
| Decal projection math (clipping a mesh's geometry to a projector box) | A hand-rolled plane-clipping skid-mark decal | `three/addons/geometries/DecalGeometry.js` | Bundled, already solves the exact "project onto arbitrary mesh geometry" problem correctly (verified: reads the mesh's own position/normal/uv attributes and clips against 6 projector-space planes) |
| Tuning-value validation/persistence for any new surface or camera knobs | A second hand-rolled clamp+JSON-parse boundary | Extend `src/core/vehicle-tuning.ts`'s generic `TuningRange`/`clampNode` machinery (factored into a shared helper) | One ASVS V5 input-validation code path for the whole project, not two that can silently drift apart |
| Occlusion raycasting at this phase's building count | `three-mesh-bvh` | Plain `THREE.Raycaster.intersectObjects()` | CLAUDE.md itself scopes BVH to "once you're querying render-only geometry" at real scale — a handful of placeholder boxes does not meet that bar |

**Key insight:** every "don't hand-roll" item above already has an established, working
precedent somewhere in Phases 1-2's shipped code (`interpolator.ts`'s slerp rule,
`vehicle-tuning.ts`'s clamp pipeline). This phase's job is to extend those precedents to two
new domains (camera, surfaces), not invent parallel mechanisms.

## Surface Grip Ranking

**Real-world tire-friction coefficients (verified, cited source):**

| Surface | Peak μ | Sliding μ | Source |
|---|---|---|---|
| Asphalt/concrete (dry) | 0.80-0.90 | 0.75 | `[CITED: hpwizard.com/tire-friction-coefficient.html]` |
| Asphalt (wet) | 0.50-0.70 | 0.45-0.60 | `[CITED: same]` |
| Gravel | 0.60 | 0.55 | `[CITED: same]` |
| Earth/dirt road (dry) | 0.68 | 0.65 | `[CITED: same]` |
| Earth/dirt road (wet) | 0.55 | 0.40-0.50 | `[CITED: same]` |

No authoritative numeric source was found in this session for grass, sand or mud coefficients
specifically (a targeted search turned up rolling-resistance figures, not lateral/peak-friction
figures, for sand only). Those three surfaces' multipliers below are `[ASSUMED]` — reasoned
estimates for arcade feel, not measured physics, and are exactly the kind of value the project's
existing tuning-panel + telemetry-routine pattern (Phase 2's `[MEASURED]`/"TUNED in the feel
session" convention) expects to be swept and corrected in-browser, not trusted as shipped.

**Recommended starting `SURFACE_PROFILES` (two independent axes, not one scalar):**

| Surface | `forwardGrip` | `lateralGrip` | Rationale |
|---|---|---|---|
| `tarmac` | 1.00 | 1.00 | Baseline — matches the existing tuned default (`frictionSlip: 1.2`, `frontSideFriction: 1.0`) exactly, so tarmac driving is byte-for-byte unchanged from Phase 2 |
| `gravel` | 0.75 | 0.55 | Real-world peak μ ratio to asphalt is ~0.67 (0.60/0.90) → forwardGrip ~0.7 is well-grounded; lateralGrip is deliberately pushed LOWER than the real-world ratio would suggest — this is the D-05 anchor: gravel needs a pronounced, dramatic slide, which the game's rear-bias/oversteer system (already tuned around a "narrow useful band near zero" for `rearSideFriction`) will only produce if lateral grip is cut more aggressively than forward grip |
| `dirt_road` | 0.78 | 0.55 | Real-world dry-earth-road peak μ ratio to asphalt is ~0.76-0.85 → forwardGrip in that band; lateralGrip shares gravel's aggressive cut for the same D-05 dust-and-slide reason (dirt_road and gravel are the two surfaces the anchor names together) |
| `grass` | 0.55 | 0.6 | `[ASSUMED]` — grass is conventionally treated as looser than dirt/gravel in driving games but with less dramatic power-slide character (more "washes out" than "slides"), hence lateralGrip not pushed as low as gravel/dirt despite a lower forwardGrip |
| `sand` | 0.45 | 0.55 | `[ASSUMED]` — loose sand's real rolling-resistance figures (0.2-0.4) suggest heavy forward drag; D-04 requires "noticeably slippery but controllable," so forwardGrip is cut meaningfully but not so far the car bogs down, and lateralGrip is kept close to gravel's since sand sliding reads similarly on camera |
| `mud` | 0.40 | 0.50 | `[ASSUMED]` — the loosest surface per D-04's explicit ranking intent ("loosest surfaces (mud, sand)"), floored well above zero so the car never becomes genuinely undriveable, matching D-04's "stays controllable" requirement |

**Floors, not just multipliers — respecting D-04:** every multiplier above is bounded well away
from zero (minimum 0.40) specifically because D-04 rules out "authentically treacherous" surfaces
that can bog the car down with normal inputs. If the human feel-session (mirroring Phase 2's
plan 02-10 precedent) finds mud/sand still too grippy or too loose, retune the multiplier, not
the floor discipline itself — a multiplier at or near zero would reproduce the exact "spins out
uncontrollably rather than sliding" failure mode `handbrakeRearSideFriction`'s own doc comment
already warns against at its own zero point.

**This ranking is a starting point, not a locked decision** — CONTEXT.md D-05 explicitly leaves
it to research-informed discretion, refined via playtest, exactly like every other feel
parameter in this codebase (`rearSideFriction`, `powerOversteerGain`, `bodyRollGain` were all
corrected during a dedicated feel session in Phase 2, not shipped as first-guessed). Expose
`SURFACE_PROFILES` through the same lil-gui + `TUNING_RANGES` pattern so it can be swept live.

## Surface Visual FX

**Particle sprites (`THREE.Points`), per D-08:**
- One `THREE.Points` object per surface type per active emission point (or a shared pool sized
  to the max simultaneous emitters — 4 wheels), using `THREE.PointsMaterial` with
  `map: puffTexture, transparent: true, depthWrite: false, sizeAttenuation: true`, `vertexColors`
  disabled (each system gets one flat colour per D-08's "coloured per surface" spec: grey
  smoke/tarmac, tan dust/gravel-sand, brown spray/mud-dirt_road, green-tinted/grass).
- A soft circular puff texture can be generated at runtime with a small offscreen `<canvas>`
  radial gradient (no asset pipeline needed, no network dependency) — a common, well-established
  three.js community pattern for exactly this kind of sprite (`[ASSUMED — general technique,
  not sourced from an official three.js doc page this session]`), or a single small PNG shipped
  under `public/`.
- Emission gated on slip magnitude: use `wheelSideImpulse(i)`/`wheelForwardImpulse(i)` (already
  named in CLAUDE.md's Headline Finding table as "free per frame") crossed against a per-surface
  threshold, so heavier slip on looser surfaces (gravel/dirt_road, per the D-05 anchor) produces
  visibly heavier plume density/particle count — this is the mechanism that delivers "heavy
  matching dust" without inventing a second slip metric.
- Particle pool sizing and lifetime are Claude's discretion (D-08) — start conservative (e.g.
  ~40-80 live particles per active wheel-surface pair, ~0.6-1.2 s lifetime, additive or
  alpha-blended fade-out) and check against `docs/frame-budget.md`'s `renderCpuMs` budget in the
  existing profiler HUD; revise the budget doc itself if this phase's FX meaningfully change the
  render-time split (the budget file's own comment already anticipates revisiting the split "in
  Phase 3 when the shadow pass lands" — surface FX is a second reason to revisit it now).

**Skid decals:**
- `three/addons/geometries/DecalGeometry.js` (bundled, verified present) projects a decal mesh
  onto existing ground geometry given a position/orientation/size — exactly the "skid decal"
  requirement.
- Recommended pattern: a fixed-size ring buffer/pool of decal `Mesh` instances (reused, not
  endlessly allocated), spawned when a wheel's slip angle crosses a per-surface threshold while
  grounded, each fading its material opacity over a lifetime and recycling back into the pool —
  this is the standard approach for skid-mark systems in real-time 3D (`[ASSUMED — general
  technique; not independently verified against an official three.js example this session,
  since three ships no ready-made "decal pool" helper]`).
- Ground surface for this phase is flat (D-01's "one flat plane"), which sidesteps
  `DecalGeometry`'s documented distortion-at-corners caveat entirely.

## Surface Audio

**Mechanism (first audio system in the repo):**
```typescript
// Source: node_modules/three/src/audio/PositionalAudio.js (installed, r185) — verified API surface.
const listener = new THREE.AudioListener();
camera.add(listener); // camera must already exist; see src/render/renderer.ts
const sound = new THREE.PositionalAudio(listener);
sound.setRefDistance(8);      // tuned per-effect; smaller = falls off faster
sound.setRolloffFactor(1.5);
const loader = new THREE.AudioLoader();
loader.load(assetUrl, (buffer) => { sound.setBuffer(buffer); sound.setLoop(true); });
chassisOrWheelMesh.add(sound); // positional: moves with the car
```
- One looping `PositionalAudio` per surface-audio "channel" (not per-wheel — 4 simultaneous
  independent positional loops per car would be audibly redundant and wasteful; one
  chassis-attached channel, crossfaded by which surface the majority of grounded wheels are
  currently on, matches how the engine-RPM crossfade technique CLAUDE.md already describes for
  engine sound) is the recommended starting shape — `[ASSUMED]`, revisit if playtest finds a
  single blended channel reads as mushy during a two-wheels-on-gravel/two-on-tarmac transition.
- Crossfade gain between the 6 surface loops as a function of "how many grounded wheels are on
  this surface" (0/4, 1/4, 2/4 etc.), using the loop's own `gain` node (`sound.setVolume()`),
  updated once per **render** frame (not the physics tick) since audio is a presentation
  concern, not a simulation concern — this keeps `src/physics/` free of any `three`/Web Audio
  import per the existing layering rule.
- Browser autoplay policy: `AudioContext` starts suspended until a user gesture. The listener's
  underlying context must be resumed on the first keydown/click (a one-line
  `listener.context.resume()` behind the same kind of gesture-gated code the project already
  uses for `?debug` hotkeys) — this is a genuine, commonly-hit pitfall for a from-scratch audio
  bootstrap, not a Heat-Street-specific quirk. `[CITED: general Web Audio API autoplay-policy
  behavior, well-documented browser vendor behavior, not independently re-verified against a
  specific spec page this session]`.

**CC0/royalty-free source candidates researched this session (verify license text at the
asset's own page before committing any file — see Common Pitfalls):**

| Source | What it offers | License claim (verify before use) |
|---|---|---|
| Freesound.org | Individual clips, filterable by license; several gravel/dirt/tire-specific results found (e.g. "Braking on gravel (bike)", "Car Tires Start and Stop on Gravel Shoulder") | Per-clip — Freesound hosts a mix of CC0, CC-BY and CC-BY-NC; the license filter must be applied and each clip's own page checked, not assumed from the site as a whole |
| BigSoundBank.com | Whole-site claim of CC0 tire sound effects, no account/attribution required per the site's own description | `[CITED: search-result summary of the site's stated policy — verify on bigsoundbank.com itself before use]` |
| itch.io — "Essentials Series" (Nox_Sound_Design) | CC0-licensed footstep/surface pack covering 13 surfaces including Dirt, Grass, Gravel, Mud, Sand — footsteps, not tire audio, but a useful CC0-cleared surface-texture reference/fallback | `[CITED: itch.io listing's own stated CC0 license — verify at acquisition time]` |
| itch.io — "Skids & Surfaces" (Sound Armoury) | Purpose-built tire-on-surface driving/skid pack covering asphalt (wet/dry), gravel, grass, dirt, mud | **Paid** (~$19.99), not free/CC0 — listed for completeness only, not a D-10-compliant source |

`[CITED]` throughout this table, not `[VERIFIED]` — every claim here is a search-result summary
of a third-party site's stated policy, not independently confirmed by downloading and reading
the actual license file this session. See the matching Common Pitfall below.

## Helicopter Camera Rig

### Velocity-Heading Tracking (CAM-01)
- Derive heading from the sampled `linvel`'s XZ components (`Math.atan2(linvel.x, linvel.z)` or
  equivalent, matching the existing `slipAngleRad`/`groundSpeedMs` computation style already in
  `sampleVehicle()`), never from chassis yaw (`body.rotation()` alone) — this is CAM-01's
  literal requirement and mirrors the project's own existing "Pitfall 1" discipline of never
  reading `currentVehicleSpeed()` when a specific XZ-only quantity is needed.
- At near-zero speed, `atan2` on a near-zero vector is numerically unstable (tiny linvel noise
  produces large heading swings) — blend toward the chassis's own forward heading below a small
  speed threshold (e.g. `groundSpeedMs < 1.5`), using a smoothstep-style blend factor, not a hard
  cutoff, so parking/idling never produces a visible camera snap.
- Build a target quaternion from this blended heading and slerp the camera's own orientation
  toward it every render frame using a `damp()`-derived factor (Pattern 3) — this IS the D-11
  "no shake or jitter, with a smooth lag" requirement: the lag is the deliberate output of a
  single tunable lambda, not an accident to be tuned away.

### Speed-Driven Framing (CAM-02)
- `camera.fov` and camera altitude (distance along the "up" component of the offset from target)
  both interpolate from a low-speed value to a high-speed value as a function of
  `groundSpeedMs`, clamped to a speed cap (e.g. 120 mph, matching the existing speedometer's
  amber-transition ceiling) — `camera.fov = THREE.MathUtils.lerp(fovLow, fovHigh, speedFactor);
  camera.updateProjectionMatrix();` every frame the value changes (cheap; core three API,
  `[VERIFIED]` present and used exactly this way elsewhere in the codebase's own
  `renderer.ts`).
- Altitude and FOV should be damped with the SAME lambda family as heading (Pattern 3) so a rapid
  brake-to-accel doesn't produce a visible pop in framing — this is not explicitly required by
  CAM-02's text but is consistent with D-11's "no shake" spirit applied to the whole rig, not
  just heading.
- SC4's "a human playtester can tell 60mph from 110mph on sight" is an explicit go/no-go human
  gate (D-12) — no automated test can substitute for this; budget an actual browser
  playtest session, mirroring Phase 2's plan 02-10 precedent exactly (same team member, same
  kind of session, this time judging camera legibility instead of handling feel).

### Camera Skin Presentation (CAM-03)
- See Pattern 4 (CSS filter + DOM chrome). Recommended starting visual differentiation (D-15,
  `[ASSUMED]` — a reasoned design proposal from general broadcast-footage convention, not a
  verified industry standard; refine via playtest per D-15's own framing):
  - **Police/news:** slightly desaturated, higher contrast, a cooler colour temperature
    (`hue-rotate` toward blue), a corner "LIVE" chyron-style DOM overlay, a subtle vignette —
    evokes ENG (electronic news gathering) broadcast video, which industry sources describe as
    prioritizing clean, low-noise footage over stylization.
  - **Sports-broadcast:** higher saturation and contrast, warmer colour temperature, a
    lower-third-style DOM graphic placeholder (e.g. a stand-in for a speed/position graphic) —
    evokes the "sweeping, cinematic" sports-aerial convention search results describe.
  - Web research this session (see Sources) could not find a citable, specific breakdown of
    news-vs-sports aerial colour-grading conventions beyond general industry description — this
    remains squarely in "Claude's research-informed discretion, refined via playtest" territory
    per D-15, not a settled external fact.

### Occlusion Detection & Mitigation (CAM-04)
- **Detection (shared by both mitigations):** cast a ray from camera to target each frame
  against the building mesh array (Pattern 5). At the placeholder building counts D-06/D-07
  imply (a sparse zone + a dense "urban canyon" zone), this is trivially cheap — no BVH needed
  this phase (see Don't Hand-Roll).
- **Mitigation (a) — fade to translucent:** on a hit, animate the hit building's material
  `opacity` down (material needs `transparent: true`; consider `depthWrite: false` to avoid
  z-fighting/sorting artifacts between multiple simultaneously-faded buildings) toward a low but
  non-zero floor (fully invisible removes spatial context entirely), and back up when no longer
  hit — damped with the same `damp()` family, not a hard cut, to avoid a visible pop.
- **Mitigation (b) — dynamically steepen toward near-overhead:** derive a "density" signal —
  e.g., cast a small fan of rays (not just the single camera-to-target ray) from several
  candidate camera positions/angles toward the target and count how many are occluded, or
  simply count buildings within a radius of the direct camera-target line — and blend the
  camera's pitch angle from its baseline high angle toward near-vertical top-down as density
  rises, relaxing back in open areas (matching CAM-04's explicit "then relaxing in open areas"
  wording, and the GTA1/2 precedent CAM-04's own text cites, adapted from that game's
  camera-embedded-near-buildings problem to this project's camera-far-above-tracking-a-target
  problem).
- **Both are prototyped this phase, one is kept, per D-06.** This research does not pick a
  winner — CONTEXT.md is explicit that this is decided by human playtest feel, not on paper.
  Implement both behind a debug toggle (mirroring D-14's camera-skin toggle convention) so the
  playtest session can A/B them directly in the same session.
- Building layout for the playtest (D-07): one sparse cluster (a handful of widely-spaced boxes,
  enough to prove occlusion happens at all without swamping the effect) and one dense
  "urban-canyon" cluster (closely-packed boxes forming a corridor the car must drive through, so
  the "relaxes in open areas" half of mitigation (b) is genuinely exercised going in and out of
  it) — exact box count/placement is Claude's discretion.

## Common Pitfalls

### Pitfall 1: Trusting a search-result summary as the actual license text
**What goes wrong:** An asset gets committed under an assumed CC0/royalty-free license that
turns out to require attribution, or is non-commercial-only, or was mis-summarized by a search
tool.
**Why it happens:** Third-party site summaries (and this research session's own WebSearch
results) describe a site's *general* policy, not a specific asset's actual, current license
metadata.
**How to avoid:** Before committing any downloaded audio file, open the asset's own page
directly and read its license statement verbatim; record the source URL and license string in a
comment or a `CREDITS`/`LICENSES` file alongside the asset.
**Warning signs:** A pack description says "free" without naming a specific license (CC0 vs.
CC-BY vs. royalty-free-with-attribution are meaningfully different obligations).

### Pitfall 2: One-tick surface-friction lag mistaken for a bug
**What goes wrong:** A developer "fixes" the one-tick lag between crossing a surface boundary
and the new friction values taking effect by restructuring `Vehicle.tick()`'s call order,
accidentally breaking the existing, carefully-ordered Pattern from `02-RESEARCH.md`
("steering → engine force → brake → rear-side-friction → `updateVehicle` → telemetry →
assists").
**Why it happens:** `wheelGroundObject(i)` only reflects a fresh raycast after `updateVehicle`
runs, so reading it at the top of the SAME tick it's applied is structurally a one-tick-old read
— easy to mistake for an off-by-one bug rather than an inherent property of the raycast
vehicle's update order.
**How to avoid:** Document the lag explicitly at the call site (as this research does); do not
attempt a same-tick "fresh" read.
**Warning signs:** A "fix" that adds a second `updateVehicle` call per tick, or that reorders the
existing friction-setting block relative to `updateVehicle` in `src/physics/vehicle.ts`.

### Pitfall 3: Camera math leaking into the fixed physics tick
**What goes wrong:** Camera position/heading/FOV computation gets called from
`applyInput`/`onTickBegin` (the fixed-tick path) instead of `render()`, subtly coupling render
cadence to camera smoothness, or worse, coupling camera state to `DT` instead of `dtMs`.
**Why it happens:** The camera reads the same `VehicleSample` the physics layer produces, which
can make it feel natural to compute camera state "near" the physics code.
**How to avoid:** Camera update lives entirely in `src/main.ts`'s `render(alpha, dtMs)` callback
(or a helper it calls), reading already-sampled/interpolated state, exactly like the existing
placeholder chase camera in `src/main.ts` today — never inside `startLoop`'s per-tick loop body.
**Warning signs:** A camera-smoothing constant expressed in ticks rather than seconds, or a
`camera-tuning.ts` import appearing inside `src/physics/`.

### Pitfall 4: CSS-filter camera-skin cost invisible to the existing profiler HUD
**What goes wrong:** The camera-skin CSS filter (Pattern 4) regresses frame time on lower-end
GPUs, but `docs/frame-budget.md`'s existing `renderCpuMs`/`renderer.info`-based profiler HUD
never shows it, because the filter is applied by the browser compositor, outside three's own
`WebGLRenderer.render()` call.
**Why it happens:** `renderer.info` only accounts for what three itself submits to the GPU; a
CSS `filter` on the canvas element is a separate compositor operation the existing HUD has no
visibility into.
**How to avoid:** If a skin toggle is added, spot-check overall frame time (e.g. via the
browser's own performance panel, or `stats-gl` if adopted later) with the filter on vs. off, not
just the existing in-game HUD numbers.
**Warning signs:** The in-game profiler HUD reports a healthy budget while the game still feels
janky with a skin active.

### Pitfall 5: Six near-identical `THREE.Points` systems silently exceeding the draw-call/triangle
budget documented in `docs/frame-budget.md`
**What goes wrong:** D-09's "all 6 surfaces fully distinct" requirement, taken too literally,
spawns 6 always-live particle systems (even for surfaces the car isn't currently touching)
instead of only the 1-2 relevant to the wheels' current surfaces.
**Why it happens:** It's simpler to allocate one system per surface up front than to manage a
pooled/on-demand set.
**How to avoid:** Only emit from the systems whose surface at least one wheel is currently on
(gated by the slip-threshold check already recommended above); an idle system with zero live
particles costs effectively nothing, but SIX simultaneously *emitting* systems (e.g., during a
diagonal crossing of a zone boundary) is the real case to budget for, not the theoretical max of
36 particle systems across every zone type at once.
**Warning signs:** `renderer.info.render.calls` rising noticeably even when the car is parked on
tarmac far from any other surface zone.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (already configured, `environment: "node"`, no jsdom) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/<new-file>.test.ts` |
| Full suite command | `npm run check` (typecheck + lint + `vitest run`) |

**Environment constraint that shapes this phase's tests:** `vitest.config.ts` uses
`environment: "node"` with no jsdom — `document`, `HTMLCanvasElement`, `AudioContext` and
WebGL are all unavailable in tests. This means: `Map<ColliderHandle, SurfaceType>` logic,
`SURFACE_PROFILES` lookups, and the pure math behind camera heading/altitude/FOV damping are
all directly unit-testable (mirroring `vehicle.test.ts`/`vehicle-assists.ts`'s existing
pure-function style); anything touching `THREE.PositionalAudio`, `AudioContext`,
`THREE.WebGLRenderer`, or DOM class toggling is **not** unit-testable under this harness and
must be verified by the human browser playtest sessions this phase already requires (mirroring
`tuning-panel.ts`'s existing precedent of keeping DOM-touching code separate from the
Node-testable validation logic it wraps).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SURF-01 | Per-wheel friction differs measurably by surface (skidpad-style lateral-g per surface) | unit (extend `runRoutine` harness) | `npx vitest run tests/surface-telemetry.test.ts -t skidpad` | ❌ Wave 0 |
| SURF-01 | `SurfaceMap.lookup` returns the registered surface for a known handle and the default for an unknown/undefined handle | unit | `npx vitest run tests/surface.test.ts` | ❌ Wave 0 |
| SURF-02 | Visual/audio distinctness | manual-only | — (justification: requires seeing/hearing rendered output; no jsdom/AudioContext in the test harness) | n/a |
| CAM-01 | Heading derivation blends velocity-heading and chassis-forward correctly across the low-speed threshold | unit (pure function) | `npx vitest run tests/camera-heading.test.ts` | ❌ Wave 0 |
| CAM-02 | Altitude/FOV curve is monotonic in speed and clamps at the cap | unit (pure function) | `npx vitest run tests/camera-framing.test.ts` | ❌ Wave 0 |
| CAM-03 | Skin toggle only changes the CSS class / DOM chrome, never camera distance/damping/target | unit (assert the skin-switch function does not touch camera-rig state) | `npx vitest run tests/camera-skin.test.ts` | ❌ Wave 0 |
| CAM-04 | Occlusion-detection raycast hit/miss classification | unit (given fake `Raycaster`-shaped hit arrays, mirroring `debug-gate.test.ts`'s hand-built-fake style) | `npx vitest run tests/occlusion.test.ts` | ❌ Wave 0 |
| CAM-04 | Fade/steepen mitigation choice, visual legibility through a dense cluster | manual-only | — (justification: SC6 is an explicit human-playtest, "not a paper decision" gate per CONTEXT.md D-06) | n/a |
| SC3 (drift stability, no shake) | Camera reads as stable through a scripted 40-degree drift | manual-only | — (justification: "no shake or jitter" is a perceptual judgment, D-11) | n/a |
| SC4 (60 vs 110 mph legible) | — | manual-only | — (justification: explicit go/no-go human playtest gate, D-12) | n/a |

### Sampling Rate
- **Per task commit:** the relevant new pure-logic test file(s) above.
- **Per wave merge:** `npm run check`.
- **Phase gate:** full suite green before `/gsd-verify-work`, PLUS the human playtest sessions
  for SC3/SC4/SC6 (these cannot be automated away — budget real browser time for them, mirroring
  Phase 2's plan 02-10 precedent).

### Wave 0 Gaps
- [ ] `tests/surface.test.ts` — covers the `SurfaceMap` lookup/register logic.
- [ ] `tests/surface-telemetry.test.ts` — extends the existing `runRoutine`/`ROUTINES` telemetry
      harness (`src/physics/telemetry/run.ts`) with a per-surface skidpad sweep, the direct
      automated proof of SC1's "measurable grip change."
- [ ] `tests/camera-heading.test.ts`, `tests/camera-framing.test.ts` — pure-function tests for
      the heading-blend and altitude/FOV curve, following `vehicle-assists.ts`'s existing
      "free function, explicit parameters, hand-built inputs" test style.
- [ ] `tests/occlusion.test.ts` — pure-function test for the fade/steepen decision logic, fed
      hand-built fake raycast-hit arrays (mirroring `debug-gate.test.ts`'s Node-safe fake style),
      not a real `THREE.Raycaster`/scene.
- [ ] No new test framework/config needed — Vitest is already fully configured for this style of
      pure-logic test.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Single-player, no accounts, no network |
| V3 Session Management | No | No sessions |
| V4 Access Control | Yes (dev-tooling only) | The existing `DEBUG_ENABLED` gate + `onDebugKey` pattern must extend to any new surface-FX/camera-skin debug controls, exactly as Phase 2 established — never player-facing |
| V5 Input Validation | Yes | Any new persisted tunable (surface grip multipliers, camera damping lambdas) MUST go through the same clamp/parse/fallback pipeline `src/core/vehicle-tuning.ts` already implements (`clampTuning`, `parseSavedTuning`), extended or factored out, not reimplemented — a hostile/corrupted `localStorage` blob must never reach a Rapier setter or a `THREE` API unclamped |
| V6 Cryptography | No | No secrets, no crypto in scope |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hostile/corrupted `localStorage` blob for any new surface/camera tuning key | Tampering | Extend the existing `clampTuning`/`parseSavedTuning` pattern (finite-number check, range clamp, fallback to defaults on any structural mismatch) — already proven against exactly this threat for `VehicleTuning` |
| Non-finite number (`NaN`/`Infinity`) reaching a Rapier setter via a new surface multiplier | Tampering / Denial of Service | Same clamp pipeline — a `NaN` `frictionSlip` would corrupt the whole physics world's solver state, not just one vehicle, per the existing doc comment's own reasoning in `vehicle-tuning.ts` |
| Unbounded particle/decal pool growth from a malformed or adversarial slip signal | Denial of Service (resource exhaustion) | Fixed-size pools (ring buffers), never unbounded arrays, as recommended above for both particles and decals |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Rapier's raycast vehicle tire model does not combine the ground collider's own `.friction` coefficient into the wheel's effective grip (only the wheel's own `frictionSlip`/`sideFrictionStiffness` matter) | Surface-to-Collider Mapping | If wrong, ground-zone colliders would need distinct `.setFriction()` values too, and a friction-combine rule (default likely average or max) would double-count with the per-wheel multipliers — verify empirically in the first surface-telemetry test by comparing a zone with `setFriction(1.0)` vs. `setFriction(0.1)` under identical wheel settings |
| A2 | grass/sand/mud forward/lateral grip multipliers (0.40-0.60 band) | Surface Grip Ranking | If wrong in either direction, D-04's "controllable" requirement or D-05's "dramatic slide" anchor could be missed — mitigated by the existing tuning-panel + feel-session precedent; not a shipped-blind risk |
| A3 | A single chassis-attached crossfaded `PositionalAudio` channel (not 4 independent per-wheel channels) is the right granularity for surface audio | Surface Audio | If wrong (reads "mushy" at zone transitions), may need per-wheel or per-axle channels instead — low cost to change since it's an internal implementation detail, not an API contract |
| A4 | CSS `filter` on `<canvas>` is performant enough for the camera-skin colour grade at this project's target hardware | Camera Skin Presentation / Pitfall 4 | If wrong, fall back to a lightweight three.js post-process pass instead — CAM-03 only requires "presentation only," not a specific mechanism |
| A5 | Freesound.org / BigSoundBank.com / itch.io license summaries found via WebSearch accurately describe each specific asset's actual license | Surface Audio | If wrong, a non-CC0 asset could ship under an incorrect license claim — mitigated entirely by the explicit "verify at the asset's own page before committing" pitfall this research flags |
| A6 | A soft round particle-sprite texture can be generated at runtime via an offscreen canvas radial gradient, with no shipped PNG asset needed | Surface Visual FX | Low risk either way — if runtime generation proves awkward, a single small shipped texture is a trivial fallback with no architectural impact |

## Open Questions

1. **Does the Rapier tire model read the ground collider's own friction coefficient at all?**
   - What we know: the `.d.ts` doc comments describe `wheelFrictionSlip`/`wheelSideFrictionStiffness`
     as governing "traction"/"the multiplier of friction between a tire and the collider it's on
     top of" — wording that is ambiguous about whether the collider's own `.friction` value is a
     base that gets multiplied, or whether it's ignored entirely by this simplified tire model.
   - What's unclear: the exact internal combine rule, since only the JS/WASM bindings (not the
     Rust source) were available to inspect this session.
   - Recommendation: the first surface-telemetry test (Wave 0 gap above) should include an
     explicit A/B case varying ONLY the ground collider's `.friction` value with wheel settings
     held constant, to settle this empirically before the full `SURFACE_PROFILES` table is
     tuned against it (see Assumption A1).

2. **Which occlusion mitigation (fade vs. steepen) will the human playtest actually prefer?**
   - What we know: both are well-established techniques in their own right (third-person
     occlusion-fade is common in modern third-person games; GTA1/2's steepen-on-approach is a
     documented historical precedent) and both are straightforward to implement behind a shared
     raycast-detection layer.
   - What's unclear: which reads better for THIS project's permanent, far-above helicopter cam
     specifically — neither technique was originally designed for exactly this camera shape
     (third-person-occlusion-fade assumes a much closer follow-cam; GTA1/2's steepen problem was
     the reverse framing, buildings above/behind the camera itself, not between the camera and a
     distant target).
   - Recommendation: CONTEXT.md D-06 already settles this correctly — prototype both, decide by
     playtest, do not treat either technique's origin story as evidence it will transfer well to
     this specific camera geometry.

3. **Does adding surface FX/audio/camera raycasting blow the existing frame budget split?**
   - What we know: `docs/frame-budget.md`'s current split (`renderCpuMs: 6.0`, `gameLogicMs: 2.0`)
     already carries a comment anticipating revision "in Phase 3 when the shadow pass lands" —
     surface particles/decals and per-frame occlusion raycasts are additional load on exactly
     those two categories.
   - What's unclear: the actual measured cost at the target hardware/particle counts recommended
     above, since nothing has been implemented yet.
   - Recommendation: treat the recommended particle/decal counts as a starting point to be
     measured against the profiler HUD during implementation, and update `docs/frame-budget.md`'s
     split if the numbers don't fit — this is explicitly anticipated by that file's own comment,
     not a surprise regression.

## Environment Availability

No new external tools, runtimes, or services are required by this phase beyond what Phases 1-2
already established (Node ≥24, npm, Vite 8.2.2, the pinned `three`/`@dimforge/rapier3d`
versions — all already verified working in this repo). Audio asset acquisition (downloading CC0
files from Freesound/itch.io/BigSoundBank) requires one-time internet access during
implementation, not a runtime dependency of the shipped game — once the files are committed
under `public/`, the game loads them the same way it will load any other static asset, with no
network dependency at runtime.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build/test toolchain | ✓ (already verified, Phases 1-2) | ≥24 (per `package.json` engines) | — |
| `three` (installed) | All render/audio/camera work | ✓ | 0.185.1 | — |
| `@dimforge/rapier3d` (installed) | Surface friction, colliders | ✓ | 0.20.0 | — |
| Internet access (one-time, dev machine) | Downloading CC0 audio assets (D-10) | Assumed available on the implementer's machine | — | If unavailable, ship with synthesized/placeholder tones via raw Web Audio oscillators temporarily, matching the project's own noted fallback pattern for "placeholder/synthesized only for now" considered (and rejected in favor of real assets) during the CONTEXT.md discussion |
| Browser audio-gesture unlock | `AudioContext` playback (any browser) | Always required by browser policy, not a missing-tool risk | — | Resume the context on the first user keydown/click, as noted in Common Pitfalls |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none currently missing; the internet-access item above
is a one-time acquisition step, not a runtime dependency, and already has a documented fallback
if it becomes blocking.

## Sources

### Primary (HIGH confidence)
- Installed `node_modules/@dimforge/rapier3d/**/*.d.ts` (0.20.0) — read directly: `Collider`,
  `ColliderDesc`, `RigidBody`, `RigidBodyDesc`, `DynamicRayCastVehicleController`,
  `InteractionGroups`/`ColliderHandle` type definitions.
- Installed `node_modules/three/src/audio/{Audio,AudioListener,PositionalAudio}.js` (0.185.1) —
  read directly for the `PositionalAudio` API surface and usage example.
- Installed `node_modules/three/src/math/MathUtils.js` (0.185.1) — read directly, confirms
  `damp(x, y, lambda, dt)` exists exactly as documented (Rory Driscoll's frame-rate-independent
  damping formula).
- Installed `node_modules/three/examples/jsm/geometries/DecalGeometry.js` (bundled with
  0.185.1) — read directly for the decal-projection API and mechanism.
- `docs/schemas/road-graph.v1.md` and `tests/road-graph-schema.test.ts` (this repo, Phase 1) —
  read directly; the normative six-value `SURFACE_ENUM` and its test enforcement.
- This repo's own `src/physics/vehicle.ts`, `vehicle-assists.ts`, `vehicle-scene.ts`,
  `src/render/vehicle-view.ts`, `src/main.ts`, `src/render/renderer.ts`,
  `src/render/interpolator.ts`, `src/debug/debug-gate.ts`, `src/debug/tuning-panel.ts`,
  `src/core/vehicle-tuning.ts`, `src/physics/telemetry/{routines,run}.ts`, `src/loop.ts` — read
  directly for every existing convention this research extends.

### Secondary (MEDIUM confidence)
- `https://www.hpwizard.com/tire-friction-coefficient.html` — tire friction coefficient table
  (asphalt/concrete/gravel/earth road, dry and wet), cross-checked against the general shape of
  other search results (Quora/TRB documents agreeing gravel/sand/dirt sit below dry asphalt).

### Tertiary (LOW confidence)
- WebSearch summaries of Freesound.org, BigSoundBank.com, and itch.io asset license claims —
  not independently verified by visiting the actual asset pages; flagged explicitly as needing
  human verification before use (see Common Pitfalls and Assumptions Log A5).
- WebSearch summary of third-person camera occlusion-fade technique (lappaschen.com Unity
  article, three.js forum threads) — general technique description, not three.js-specific
  official documentation; adapted by reasoning to this project's camera shape.
- WebSearch summary of GTA1/2's top-down camera steepen-on-approach behavior (GTA/Grand Theft
  Wiki fan documentation) — historical game-design description, not a technical spec; used only
  as the origin-story context CAM-04's own requirement text already cites.
- News-vs-sports aerial broadcast visual convention research — general industry description
  found via WebSearch, no citable source broke down specific colour-grading differences; the
  camera-skin visual treatment recommendation is Claude's own reasoned proposal (D-15's explicit
  discretion), not a sourced external standard.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every API claim (Rapier collider/userData absence, `wheelGroundObject`,
  `THREE.MathUtils.damp`, `PositionalAudio`, `DecalGeometry`) was verified by reading the
  installed package source directly, not recalled from training data.
- Architecture: HIGH — every recommended pattern extends an already-shipped convention in this
  exact repo (layering split, tuning/clamp pipeline, MUST-MATCH physics/render pairing,
  generic-controller precedent), not a novel proposal.
- Surface grip ranking: MEDIUM (tarmac/gravel/dirt_road, grounded in cited real-world
  coefficients) / LOW (grass/sand/mud specifics, `[ASSUMED]`, explicitly flagged for the same
  playtest-and-correct process Phase 2 already used successfully.
- Camera skin visual treatment and occlusion-mitigation choice: LOW-MEDIUM — both are explicitly
  scoped by CONTEXT.md as prototype-and-playtest decisions, not settled by this research, which
  is itself the correct outcome per D-06/D-15's own framing.
- Audio asset licensing: LOW until a human verifies each specific asset page — flagged as a
  required pre-commit step, not resolved by this research session.

**Research date:** 2026-09-12
**Valid until:** 30 days for the stack/API claims (stable, verified against pinned versions
already frozen for this project); the grip-ranking and camera-skin recommendations are valid
until the phase's own human playtest sessions run, at which point measured/tuned values supersede
them exactly as Phase 2's research was superseded by its own feel-session findings.
