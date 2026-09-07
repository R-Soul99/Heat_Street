# Stack Research

**Domain:** Browser-based 3D arcade-realistic driving/chase game (Three.js + Rapier, TypeScript, Vite)
**Researched:** 2026-09-07
**Confidence:** HIGH for core stack and vehicle physics (verified against shipped `.d.ts` files and official docs); MEDIUM for renderer choice and audio architecture (judgement calls, documented below)

---

## Headline Finding

**Rapier ships a production-ready built-in vehicle controller. Do not hand-build a raycast vehicle.**

`DynamicRayCastVehicleController` (a port of Bullet's `btRaycastVehicle`) is part of `@dimforge/rapier3d` and is created with a single call: `world.createVehicleController(chassisRigidBody)`. Verified directly from the shipped type definitions of `@dimforge/rapier3d-compat@0.20.0` (`dist/control/ray_cast_vehicle_controller.d.ts`).

Critically, it exposes exactly the per-wheel telemetry Heat Street's requirements need — this is not a toy:

| Requirement from PROJECT.md | API that serves it |
|---|---|
| Surfaces affect grip (tarmac/gravel/grass/mud/sand) | `wheelGroundObject(i)` returns the **Collider** each wheel is standing on → look up surface type → drive `setWheelFrictionSlip(i, …)` per wheel per frame |
| Controllable oversteer, big slides | `setWheelSideFrictionStiffness(i, …)` — the lateral grip knob, settable per wheel per frame (rear-only reduction = RWD-loose feel) |
| Jumps / airborne handling | `wheelIsInContact(i)` per wheel |
| Tire smoke + screech triggers | `wheelSideImpulse(i)` / `wheelForwardImpulse(i)` — slip magnitude, free per frame |
| Visual wheel rig (spin + suspension travel) | `wheelRotation(i)`, `wheelSuspensionLength(i)`, `wheelSteering(i)` |
| Weighty muscle-car feel | `RigidBodyDesc.setAdditionalMassProperties(mass, centerOfMass, principalAngularInertia, frame)` — low, rearward CoM is the single biggest lever on chase-movie handling |
| Speedo / HUD | `currentVehicleSpeed()` |

**Confidence: HIGH.** Read from the published package, not from docs prose or training data.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **three** | `0.185.1` (r185) | Rendering, scene graph, glTF loading, spatial audio, camera | The only realistic choice for a code-driven WebGL game with no editor. Ships GLTFLoader, PositionalAudio, BatchedMesh/InstancedMesh, and — decisively — an **official Rapier vehicle controller example** (`examples/physics_rapier_vehicle_controller.html`) that is a working reference implementation of the exact thing this project needs. Largest body of training data of any 3D web library, which matters materially for a Claude-Code-only workflow. |
| **@dimforge/rapier3d** | `0.20.0` (2026-08-08) | Physics: rigid bodies, colliders, raycasts, **built-in vehicle controller** | Rust/WASM, deterministic on a given machine, and the built-in `DynamicRayCastVehicleController` removes the single largest technical risk in the project. Actively released (latest is one month old). Use the **non-compat** package — see "Rapier package variant" below. |
| **typescript** | `7.0.2` | Type safety across physics/render/game-state boundaries | `latest` on npm. Vehicle tuning code is dense with `Vector`-vs-`Vector3` and index-based wheel APIs; types catch a whole class of silent physics bugs. TS 7 is the native (Go) compiler — dramatically faster `tsc --noEmit`, which matters when a solo dev typechecks constantly. |
| **vite** | `8.2.2` | Dev server, HMR, production bundling, WASM + asset handling | Native WebAssembly ESM integration (no plugin needed at `esnext` target), instant HMR for tuning iteration, and first-class static asset handling for `.glb`. Already a project constraint; research confirms it is also the right call. |

### Renderer choice: WebGLRenderer, not WebGPURenderer

**Recommendation: `WebGLRenderer`. Revisit at the milestone-2 boundary, not before.**

Multiple 2026 blog posts claim "r182 made WebGPURenderer the recommended renderer and WebGLRenderer the fallback." **This claim is false.** The official three.js Migration Guide (r180 → r186) shows no such change — both renderers coexist, WebGLRenderer is not deprecated, and r186 is still actively adding WebGL-specific classes (`LightProbeGrid` → `LightProbeGridWebGL`, with the unsuffixed names *reserved for future WebGPU versions* — i.e. WebGPU parity is still incomplete). Those blog posts are SEO-generated content and should not be trusted.

Why WebGL for Heat Street specifically:
- The art direction is **low-poly stylized at mid-to-far camera distance**. This is not a draw-call-bound or compute-bound workload. WebGPU's advantages (huge draw counts, compute shaders) don't apply.
- WebGPU pushes you toward TSL node materials. That is a smaller, newer API surface with far less training data — directly hostile to a Claude-Code-only workflow with no 3D experience.
- WebGPU has active regressions in this window: r185 changed premultiplied-alpha behaviour, r186 **removed `PCFSoftShadowMap` from WebGPURenderer**. Soft shadows are load-bearing for the cinematic look this project wants.
- Migration later is not a rewrite if you avoid custom `ShaderMaterial` and stick to `MeshStandardMaterial`/`MeshPhysicalMaterial`.

**Confidence: MEDIUM-HIGH.** The negative claim ("WebGPU is not the default") is HIGH — verified against the official migration guide. The recommendation itself is a judgement call.

### Vehicle & Physics Layer

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@dimforge/rapier3d` | `0.20.0` | Everything physics | Always. Import directly; write your own thin wrapper. |
| `@dimforge/rapier3d-simd` | `0.20.0` | SIMD-optimised build, drop-in identical API | Swap in during the perf-tuning phase if pursuer counts (Survival mode escalation) stress the solver. Requires `simd128` — universal on modern desktop browsers, which is this project's only target. |
| `@dimforge/rapier3d-deterministic` | `0.20.0` | Cross-platform deterministic build | **Not needed for v1** (no multiplayer, no replay system). Note it exists in case ghost-car replays are ever added for medal-time chasing. |

**Do NOT use `three/addons/physics/RapierPhysics.js`.** It exists and looks tempting, but reading the r185 source shows it is demo glue, not a library:
- It hardcodes `const RAPIER_PATH = 'https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3'` — a **runtime CDN fetch of a three-versions-stale Rapier** (0.17.3 vs current 0.20.0). Your game would depend on Skypack being up.
- It hardcodes `const frameRate = 60` and auto-syncs every mesh in the scene, which is the opposite of the explicit fixed-timestep control a driving game needs.

Use the official *example* (`physics_rapier_vehicle_controller.html`) as your reference for the controller math and the wheel-mesh sync quaternion work. Import Rapier yourself.

**Known-good starting tuning constants** (from the official three.js example — a starting point, not muscle-car values):

| Parameter | Example value | Heat Street direction |
|---|---|---|
| Chassis mass | 10 | Increase substantially — weight is the core value |
| Chassis friction | 0.8 | Keep |
| Wheel radius | 0.3 | Scale to car |
| Suspension rest length | 0.8 | Longer for 70s-era body roll |
| Suspension stiffness | 24.0 | **Lower** for visible weight transfer and dive under braking |
| Friction slip | 1000.0 | **Much lower** — 1000 is effectively infinite grip; this value is the primary drift dial |
| Steering | π/4 max, 0.25 lerp factor | Keep the lerp — it is what stops twitchiness |
| Engine force | ±30 | Scale with mass |
| Wheel offsets | ±1.0 lateral, ±1.5 longitudinal | Widen track + lengthen wheelbase for muscle-car proportions |

**Critical gotcha — trimesh roads:** Map geometry from the Google Maps extraction tool will become a `ColliderDesc.trimesh()`. Without a flag, the vehicle will hit invisible bumps at every triangle seam on flat road. You must pass `TriMeshFlags.FIX_INTERNAL_EDGES` (verified value: `144` in 0.20.0), documented as: *"a special treatment will be applied to contact manifold calculation to eliminate or fix contacts normals that could lead to incorrect bumps in physics simulation (especially on flat surfaces)."* Also consider OR-ing `MERGE_DUPLICATE_VERTICES (16)` and `DELETE_DEGENERATE_TRIANGLES (32)` — real-world-derived geometry is rarely clean.

For open rural terrain, prefer `ColliderDesc.heightfield()` over trimesh: cheaper, and it has its own `HeightFieldFlags.FIX_INTERNAL_EDGES` (value `1`).

### Rapier package variant: non-compat + Vite native WASM

Measured from the actual packages:

| Package | WASM delivery | Bundle impact | Init |
|---|---|---|---|
| `@dimforge/rapier3d` | separate `rapier_wasm3d_bg.wasm` (**2.02 MB**) | Vite emits it as a hashed asset — cached separately, brotli-compresses well | `import * as RAPIER from '@dimforge/rapier3d'` (async module) |
| `@dimforge/rapier3d-compat` | base64-inlined into JS (**9.8 MB `dist/`**) | Inflates the main JS bundle ~33%; base64 compresses poorly | `await RAPIER.init()` |

**Use non-compat.** Vite's docs confirm native WebAssembly ESM integration: *"A `.wasm` file can be imported directly. Vite reads the module's imports and exports from the binary, instantiates it, and re-exposes its exports as named ES module exports"* — with the caveat that it *"behaves as an async module and requires top-level `await` support."*

Since this project is **desktop-browser-only**, set `build.target: 'esnext'` and you need **no plugins at all**.

```ts
// vite.config.ts
export default defineConfig({
  build: {
    target: 'esnext',        // enables top-level await → native WASM ESM, no plugins
    assetsInlineLimit: 0,    // never base64-inline .glb/.wasm/audio
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d'], // keep esbuild's dep pre-bundler away from the WASM module
  },
});
```

Only if the dev server misbehaves, add `vite-plugin-wasm@3.6.0` + `vite-plugin-top-level-await@1.6.0`. Reach for `-compat` only as a last resort.

**Confidence: HIGH** on the size/init facts (measured from `npm pack`), **MEDIUM** on the zero-plugin claim (Vite docs are explicit, but Rapier + Vite has a long history of friction — budget an hour for this in the setup phase).

### Asset Pipeline (glTF)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `GLTFLoader` (`three/addons/loaders/GLTFLoader.js`) | bundled with three | Load all models | Always |
| `MeshoptDecoder` (`three/addons/libs/meshopt_decoder.module.js`) | bundled with three | Decompress meshopt geometry | **Always — this is the recommended compression path** |
| `KTX2Loader` (`three/addons/loaders/KTX2Loader.js`) | bundled with three | GPU-compressed textures | Once texture VRAM matters (large city maps) |
| `@gltf-transform/cli` | `4.5.0` | Offline model optimisation | Build-time / asset-prep script |
| `DRACOLoader` | bundled with three | Draco geometry | **Avoid** — see below |

**Use meshopt, not Draco.** This is a Vite-specific practical call verified by inspecting the three r185 package contents:
- `meshopt_decoder.module.js` is a **pure JS ES module inside three's addons** — you `import` it and it works. Zero build configuration.
- Draco requires copying `draco_decoder.wasm` + `draco_decoder.js` + `draco_wasm_wrapper.js` out of `node_modules/three/examples/jsm/libs/draco/` into `public/` and calling `setDecoderPath()`. Same for KTX2's `basis_transcoder.{js,wasm}`. That's a manual copy step that silently breaks on every `three` upgrade.
- Meshopt also decodes faster and compresses animation/morph data, not just geometry.

Additionally, r185 deprecated `DRACOLoader.setDecoderConfig()` ("In the future, DRACOLoader will always use WASM") — more churn on a path you don't need.

Build-time optimisation, run once per asset and commit the output:

```bash
npx @gltf-transform/cli optimize raw/car.glb public/models/car.glb \
  --compress meshopt \
  --texture-compress ktx2 \
  --texture-size 1024
```

If you adopt KTX2, you do have to copy the basis transcoder to `public/basis/` and call `ktx2Loader.setTranscoderPath('/basis/')` — accept that cost only when texture memory becomes a real problem, which for a low-poly stylized game may be never.

**Vite asset strategy:**
- **Map data + map `.glb` files → `public/`**, loaded by URL at runtime. Maps are large, per-level, and must be lazy-loaded when a player enters an area. Bundler-managed imports would force them into the dependency graph.
- **Car models, wheels, small props → `import carUrl from './assets/car.glb?url'`**, so Vite hashes them for cache-busting.
- **Set `assetsInlineLimit: 0`.** Vite's default base64-inlines small assets, which will silently corrupt binary `.glb`/audio handling assumptions and bloat the JS bundle.

### Audio

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `THREE.AudioListener` + `THREE.PositionalAudio` | bundled with three | All spatial/diegetic sound | Engine, sirens, tire screech, impacts, radio chatter |
| `THREE.Audio` | bundled with three | Non-positional sound | Music, UI, mission-brief VO |
| Raw Web Audio API (`GainNode`, `BiquadFilterNode`) | browser native | RPM crossfade blending, low-pass for chopper-distance effect | Engine sound system |

**Recommendation: build on `THREE.PositionalAudio` + raw Web Audio. Do not add Howler.js.**

Two reasons:

1. **Howler is drifting.** Last npm release is `2.2.4` on **2023-09-19** — three years stale. The repo has one commit since (2025-11-23) and **417 open issues**. Not archived, but not a dependency to build a game's audio spine on in 2026.
2. **Three's audio is architecturally correct for this game.** `PositionalAudio` is a scene-graph node. You `carMesh.add(engineSound)` and the `PannerNode` position updates automatically relative to the `AudioListener` on the camera. For Heat Street this is exactly right: the **permanent high-angle helicopter camera** means every pursuer siren must be spatialised relative to a camera that is far above and behind the action. Scene-graph attachment makes that free; a separate audio library means manually syncing positions every frame for every siren.

**Engine sound technique** (the standard approach, and what `setPlaybackRate` exists for): record/source 3–4 looping samples (idle, low, mid, high load), give each its own `PositionalAudio` + `GainNode`, then per frame:
- Compute a synthetic RPM from `vehicleController.currentVehicleSpeed()` + your gear model (the controller has no gearbox — you model gears yourself, which is *good*, because arcade-tuned gear ratios are a feel dial).
- `setPlaybackRate()` each sample proportional to RPM within its band.
- Crossfade gains between adjacent bands.

`THREE.Audio` also exposes `setFilter()`/`setFilters()`, so a low-pass filter driven by camera distance gives the "heard from the chopper" muffling almost for free.

**Confidence: HIGH** on Howler's staleness (npm/GitHub API data). **MEDIUM** on the architecture recommendation — it's a judgement call, but the helicopter-camera constraint makes it a strong one.

### Game Loop, State & UI

| Choice | Recommendation | Why |
|---|---|---|
| Game loop | Hand-rolled `requestAnimationFrame` with a **fixed-timestep accumulator** + render interpolation | Rapier must step at a fixed `dt` (1/60) or handling changes with framerate — unacceptable for a game whose entire long-term value is **medal times**. Variable-dt physics means a 144 Hz player gets different lap times than a 60 Hz player. Non-negotiable. |
| Architecture | **Plain TypeScript classes**, not an ECS library | ECS (`bitecs@0.4.0`, `miniplex@2.0.0`) pays off at thousands of homogeneous entities. Heat Street has one player car, a handful of pursuers, checkpoints, and props. ECS here adds indirection that makes Claude-Code-assisted iteration *harder*, for no measurable win. Revisit only if Survival-mode entity counts explode. |
| Mode/screen state | Hand-rolled finite state machine (~50 lines) | `xstate@5.32.6` is excellent but is a large conceptual dependency for `menu → briefing → driving → results`. |
| Reactive state | `nanostores@1.5.3` *if* you want HUD/DOM to auto-update; otherwise direct DOM writes | Do **not** reach for `zustand`/React. |
| UI framework | **None.** Vanilla TS + DOM | See below. |
| Persistence | `localStorage` + `zod@4.5.4` schema validation on read | Best times and medal state are the player's long-term investment. Validate on load so a schema change doesn't wipe progress or crash on malformed data. |
| Debug tuning UI | `lil-gui@0.21.0` (or `tweakpane@4.0.5`) | **Essential, not optional.** "Arcade-realistic hybrid" is found by feel, not calculation. You need live sliders for suspension stiffness, friction slip, side friction stiffness, CoM offset, and engine force while driving. Budget this into the first vehicle phase. |

**HUD and minimap: DOM overlay + a 2D canvas minimap. Not in-canvas 3D.**

- **HUD** (speed, timer, medal split, heat meter, radio chatter subtitles) → absolutely-positioned HTML/CSS over the WebGL canvas with `pointer-events: none`. Zero draw calls, zero texture uploads, real text rendering with real fonts, trivially restyled, and CSS animation gives you siren-flash and heat-escalation pulses for free. Rendering text in-canvas (`troika-three-text`, canvas-texture planes) is strictly worse here — you'd be reimplementing typography to solve a problem you don't have.
- **Minimap** → a separate `<canvas>` 2D context, drawing the **road polylines you already have from the Google Maps extraction tool**, plus dots for the player, checkpoints, and pursuers.

  This is the important call: the obvious approach is a second orthographic camera rendering the 3D scene to a render target. **Don't.** It roughly doubles draw calls and shadow/material work every frame for a small corner element, and it looks worse — a top-down render of low-poly city geometry reads as visual noise, whereas clean vector road lines read instantly at 150 px. The pmndrs `racing-game` project has an open issue on exactly this ("Minimap using double render"), which is a signal that the double-render approach is a known cost centre.

**Confidence: MEDIUM-HIGH.** Fixed timestep is HIGH (physics fundamentals + medal-time requirement). The DOM/2D-canvas UI call is a well-reasoned judgement, not a documented industry standard.

### Pursuer AI

| Library | Version | Purpose | Recommendation |
|---------|---------|---------|----------------|
| `ngraph.path` | `1.6.1` | A* / NBA* on an arbitrary graph | **Recommended.** Pair with `ngraph.graph@20.1.2`. |
| `@recast-navigation/three` | `0.43.1` (2026-04) | Navmesh generation + Detour crowd steering | Alternative — actively maintained, but wrong shape for this problem |
| `three-pathfinding` | `1.3.0` (2024-05) | Navmesh A* | Avoid — stale, superseded by recast-navigation |

**Use a road-graph A*, not a navmesh.** Cars are not free-roaming agents; they are constrained to a road network, and the Google Maps extraction tool **already produces that network as a graph**. Running Recast to bake a navmesh would discard the topology you already have and then approximate it back. A directed road graph additionally gives you one-way streets, junction costs, and — importantly for the heat system — cheap "which routes can cut the player off" queries for roadblock placement, which a navmesh makes awkward.

Pathfinding produces waypoints; a separate steering layer converts waypoints into the same `setWheelSteering` / `setWheelEngineForce` inputs the player uses. **Pursuers must drive the same vehicle controller as the player** — this is what makes rammable, crashable, physically-present cop cars possible, and it's what the damage/destruction requirement needs.

**Confidence: MEDIUM.** Library versions are HIGH; the graph-over-navmesh recommendation is reasoned from the project's stated map pipeline.

### Input

**No library.** Native `KeyboardEvent` + the `Gamepad` API, wrapped in a ~100-line input-mapping module that normalises both into a single `{ throttle, brake, steer, handbrake }` struct with analog values.

Two things to get right: (1) gamepad state must be **polled** in the game loop via `navigator.getGamepads()`, not event-driven; (2) keyboard input needs smoothing/ramping to analog before it reaches the steering lerp, or keyboard driving will feel binary and twitchy compared to a stick.

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `vite` | `8.2.2` | Dev server + build | `build.target: 'esnext'`, `assetsInlineLimit: 0` |
| `typescript` | `7.0.2` | Typecheck | Vite strips types via esbuild; run `tsc --noEmit` separately in CI/pre-commit |
| `@biomejs/biome` | `2.5.12` | Lint + format, single binary | One dependency instead of ESLint + Prettier + plugins. Fast, low-config — right for solo. |
| `vitest` | `5.0.0` | Unit tests | Test the *pure* parts: gear/RPM model, heat-level state machine, checkpoint validation, medal-time thresholds, save-file migration. Do **not** try to unit-test physics feel. |
| `lil-gui` | `0.21.0` | Live tuning panel | Gate behind a `?debug` query param |
| `stats-gl` | `4.2.3` | Frame timing overlay | WebGL/WebGPU-aware successor to `stats.js` |
| `vite-plugin-glsl` | `1.6.1` | GLSL imports with `#include` | Only if you write custom shaders (tire smoke, road shimmer). Skip initially. |

---

## Installation

```bash
# Core
npm install three@0.185.1 @dimforge/rapier3d@0.20.0

# Supporting (add as needed, not upfront)
npm install nanostores@1.5.3 zod@4.5.4 ngraph.path@1.6.1 ngraph.graph@20.1.2

# Dev dependencies
npm install -D typescript@7.0.2 vite@8.2.2 @types/three@0.185.4 \
               @biomejs/biome@2.5.12 vitest@5.0.0 \
               lil-gui@0.21.0 stats-gl@4.2.3

# Asset pipeline (run via npx, does not need to be a project dependency)
npx @gltf-transform/cli@4.5.0 optimize in.glb out.glb --compress meshopt
```

Note: `@types/three@0.185.4` tracks `three@0.185.1`. Three.js does not ship its own types; keep the minor versions aligned on every upgrade.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Vanilla Three.js | **React Three Fiber + react-three-rapier** | If you wanted declarative scene composition and a large component ecosystem. **Rejected here:** adds React + reconciler overhead to a 60 Hz imperative game loop, and `react-three-rapier` has an open issue (#323) for *"Create react api for DynamicRayCastVehicleController"* — meaning the vehicle controller, the one thing this project most needs, is **not** wrapped. You'd drop to imperative Rapier anyway, paying React's cost for nothing. |
| Rapier | **Jolt (`jolt-physics` WASM)** | Jolt has a more sophisticated `VehicleConstraint` (real differentials, engine/gearbox, anti-roll bars) and three ships `JoltPhysics.js`. Consider only if Rapier's raycast vehicle proves unable to hit the target feel after genuine tuning effort. Cost: smaller JS community, more complex API. |
| Rapier | **cannon-es** | Has `RaycastVehicle` and is simpler, but is materially slower (pure JS) and effectively unmaintained. No reason to choose it. |
| WebGLRenderer | **WebGPURenderer (`three/webgpu`)** | If you later need thousands of dynamic lights (dense night-time city with per-car headlights) or GPU-compute particles for large-scale tire smoke/debris. Revisit at a milestone boundary, and only after profiling shows a real bottleneck. |
| Plain classes | **`bitecs` / `miniplex` ECS** | If Survival mode's escalation pushes entity counts into the thousands (heavy traffic + many pursuers + debris). Not a v1 concern. |
| Road-graph A* | **`@recast-navigation/three`** | If off-road pursuit across open terrain (Mad Max-style rural chases) becomes a major mode where cars leave the road network entirely. A hybrid — graph on-road, navmesh off-road — is plausible later. |
| `THREE.PositionalAudio` | **Howler.js 2.2.4** | If you need audio sprites, HTML5-streaming for long music tracks, or broad mobile-unlock handling. Mobile is explicitly out of scope, so this mostly doesn't apply. |
| Biome | **ESLint + Prettier** | If you need a specific ESLint plugin Biome lacks. `oxlint@1.82.0` is a third option (faster still, less mature formatting). |
| `@dimforge/rapier3d` | **`@dimforge/rapier3d-simd`** | Drop-in perf swap once pursuer/entity counts stress the solver. Same API. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`three/addons/physics/RapierPhysics.js`** | Hardcodes a **runtime CDN fetch** of `@dimforge/rapier3d-compat@0.17.3` (three versions stale) from Skypack, and a fixed internal 60 Hz rate with automatic whole-scene mesh sync. It is demo glue, not a library. Verified by reading the r185 source. | Import `@dimforge/rapier3d` directly; write a ~150-line physics wrapper you control. Use the official *example* as a math reference only. |
| **Hand-built raycast vehicle** (4 manual `world.castRay()` calls + custom suspension springs) | This is what most Three.js tutorials show, and it's a multi-week detour that reimplements — worse — something Rapier already ships, including the friction/slip model, anti-roll behaviour, and the per-wheel telemetry the surface-grip and tire-smoke requirements depend on. | `world.createVehicleController(chassis)` |
| **`ColliderDesc.trimesh()` without `FIX_INTERNAL_EDGES`** | Invisible bumps at every triangle seam on flat road — will read as "the physics is broken" and is extremely hard to diagnose after the fact. | `ColliderDesc.trimesh(verts, indices, TriMeshFlags.FIX_INTERNAL_EDGES)` (value `144`) |
| **Variable-timestep physics** (`world.step()` with raw frame delta) | Handling and lap times become framerate-dependent. Directly destroys the medal-time system, which is the project's stated long-term replay value. | Fixed-timestep accumulator at 1/60, with render interpolation |
| **Howler.js** as the audio spine | Last npm release 2023-09-19 (3 years); 417 open issues. And it doesn't integrate with the scene graph, which matters a lot given the permanent helicopter camera. | `THREE.PositionalAudio` + raw Web Audio nodes |
| **Draco compression** | Requires manually copying three decoder files into `public/` and re-copying on every `three` upgrade; `setDecoderConfig()` deprecated in r185. | Meshopt — `three/addons/libs/meshopt_decoder.module.js` is a pure JS module you just import |
| **`three-pathfinding@1.3.0`** | Last published 2024-05; superseded. And navmesh is the wrong model for road-constrained vehicles. | `ngraph.path` on the road graph you already have |
| **`@dimforge/rapier3d-compat`** (as default) | Base64-inlines 2 MB of WASM into your JS bundle (`dist/` is 9.8 MB); base64 compresses poorly and defeats separate asset caching. | `@dimforge/rapier3d` + Vite's native WASM ESM at `target: 'esnext'` |
| **Second-camera 3D minimap** | Roughly doubles per-frame draw calls and shadow work for a small UI element, and reads as visual noise at minimap scale. | 2D `<canvas>` drawing road polylines from your existing map data |
| **`three/examples/jsm/...` import paths** | Legacy path style. | `three/addons/...` (an official alias in three's `exports` map) |
| **AI-generated "Three.js 2026 / WebGPU" blog posts** | Several assert that r182 made WebGPURenderer the default and deprecated WebGLRenderer. The official Migration Guide shows no such change. This category of content is confidently wrong and will send you down a costly migration path. | The official three.js Migration Guide and `examples/` directory |

---

## Stack Patterns by Variant

**If Rapier's vehicle controller can't reach the target "weighty muscle car" feel after real tuning:**
- First, exhaust the *layering* approach before switching engines: keep `DynamicRayCastVehicleController` for suspension and ground contact, but add a thin arcade-assist layer on top of the chassis rigid body each frame — a stabilising yaw torque proportional to `(desiredHeading − actualHeading)`, plus a downforce impulse scaled by speed, plus a lateral counter-force during intentional drifts. This is how most arcade racers get "responsive but heavy," and it's tuning code, not an engine swap.
- Only if that fails, evaluate `jolt-physics` (`three/addons/physics/JoltPhysics.js` exists as a starting point) for its full `VehicleConstraint` with real differentials and gearbox.

**If the map from the Google Maps tool is one large area rather than several small ones:**
- Split collision into **chunked trimesh colliders** loaded/unloaded around the player rather than one giant collider — Rapier's broadphase handles many static colliders far better than one enormous mesh, and it lets you stream map data.
- Use `BatchedMesh` (r185) or `InstancedMesh` for repeated building/prop geometry, and put the road surface on its own material for surface-type lookup.
- Add `three-mesh-bvh@0.9.14` if you need fast non-physics raycasts against map geometry (camera occlusion from the helicopter cam, checkpoint placement tooling, AI line-of-sight for the heat system). Note: Rapier's own raycasts cover most gameplay needs — only add this if you're querying render-only geometry.

**If pursuer counts in Survival mode cause frame drops:**
- Swap `@dimforge/rapier3d` → `@dimforge/rapier3d-simd` (identical API, `simd128` is fine on desktop).
- Run distant pursuers on a simplified kinematic model rather than a full vehicle controller; promote to full physics only within a radius of the player.
- Only then consider an ECS refactor.

**If you later want ghost cars / replays for medal-time chasing:**
- You do **not** need the deterministic build. Record the player's transform at a fixed rate and replay it as a kinematic body — far simpler and robust to physics-version changes. `@dimforge/rapier3d-deterministic` only matters for input-replay determinism across machines.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `three@0.185.1` | `@types/three@0.185.4` | Three ships no types; bump both together or you get phantom type errors |
| `three@0.185.1` | `@dimforge/rapier3d@0.20.0` | No direct dependency — you write the bridge. Three's bundled `RapierPhysics.js` targets 0.17.3, another reason not to use it. |
| `@dimforge/rapier3d@0.20.0` | `vite@8.2.2` with `build.target: 'esnext'` | Requires top-level-await support. Add `optimizeDeps.exclude: ['@dimforge/rapier3d']` if the dev server pre-bundler chokes. |
| `@dimforge/rapier3d@0.20.0` | older browsers / non-esnext target | Needs `vite-plugin-wasm@3.6.0` + `vite-plugin-top-level-await@1.6.0`, or fall back to `-compat` |
| `typescript@7.0.2` | `vite@8.2.2` | Vite transpiles via esbuild and ignores `tsc`; typecheck as a separate script. TS 7 is the native Go compiler — verify your editor's TS plugin version if you see odd IDE behaviour. |
| `three@0.185.1` addons | `three/addons/*` alias | Confirmed in three's `exports` map: `"./addons/*": "./examples/jsm/*"` |
| KTX2Loader / DRACOLoader | transcoder assets | Must copy from `node_modules/three/examples/jsm/libs/{basis,draco}/` into `public/` on every three upgrade. Meshopt has no such requirement. |

---

## Confidence Summary

| Claim | Confidence | Basis |
|---|---|---|
| Rapier ships `DynamicRayCastVehicleController` with per-wheel ground-collider, side-friction, slip-impulse, and contact telemetry | **HIGH** | Read directly from `@dimforge/rapier3d-compat@0.20.0/dist/control/ray_cast_vehicle_controller.d.ts` |
| `TriMeshFlags.FIX_INTERNAL_EDGES = 144` and what it fixes | **HIGH** | Read from `dist/geometry/shape.d.ts` in 0.20.0 |
| Current versions (three 0.185.1, rapier 0.20.0, vite 8.2.2, TS 7.0.2) | **HIGH** | npm registry, 2026-09-07 |
| `RapierPhysics.js` hardcodes a Skypack CDN fetch of rapier 0.17.3 | **HIGH** | Read from the three@0.185.1 tarball |
| WebGPURenderer is **not** the default and WebGLRenderer is **not** deprecated | **HIGH** | Official three.js Migration Guide (r180–r186), contradicting several 2026 blog posts |
| Meshopt needs no `public/` decoder copy; Draco and KTX2 do | **HIGH** | Inspected `three@0.185.1/examples/jsm/libs/` contents |
| Howler.js last released 2023-09-19, 417 open issues | **HIGH** | npm registry + GitHub API |
| Non-compat Rapier works in Vite 8 with zero plugins at `esnext` | **MEDIUM** | Vite docs are explicit about WASM ESM integration, but this combination has a history of friction — verify empirically in the setup phase |
| WebGL over WebGPU for this project | **MEDIUM-HIGH** | Reasoned from art direction + WebGPU's r185/r186 regressions; the negative claim it rests on is HIGH-confidence |
| `THREE.PositionalAudio` over Howler | **MEDIUM** | Strong reasoning from the helicopter-camera constraint; not a documented industry standard |
| Plain classes over ECS; DOM HUD; 2D-canvas minimap; road-graph A* over navmesh | **MEDIUM** | Reasoned judgement from this project's specific constraints, not verified best practice |
| Example tuning constants (mass 10, stiffness 24, frictionSlip 1000, etc.) | **MEDIUM** | From the official three.js example — correct as *starting values*, but they are demo values, not muscle-car values |

## Gaps / Open Items for Later Phases

- **Whether Rapier's raycast vehicle can hit the "arcade-realistic hybrid" target.** Community reports consistently describe the core tension: lowering wheel friction to enable drift causes loss of control; raising it makes the car feel on-rails. The arcade-assist layering approach (above) is the standard mitigation but is unverified for this specific controller. **This is the single highest-risk item in the stack and should be a spike in the first vehicle phase, not an assumption.**
- **Rapier trimesh performance at real city-map scale.** No benchmarks found for Rapier trimesh colliders at Google-Maps-derived city scale. Chunking is the mitigation, but the threshold is unknown.
- **Surface-type → collider mapping.** `wheelGroundObject(i)` returns a `Collider`; the mechanism for tagging colliders with a surface type (user data vs. a `Map<colliderHandle, SurfaceType>` vs. collision groups) needs a design decision. All three are viable; not researched in depth.
- **Engine audio source material.** The technique is clear; whether CC0 muscle-car engine loops at usable quality exist is an asset-sourcing question, not a stack question.
- **Damage/deformation model.** Requirement 13 mentions damage affecting performance and a destruction end-state. Rapier has no built-in deformation. Likely approach: swap damaged mesh LODs + degrade vehicle-controller parameters (reduced engine force, biased steering, softened suspension). Not researched.

## Sources

- **`@dimforge/rapier3d-compat@0.20.0` / `@dimforge/rapier3d@0.20.0`** — downloaded via `npm pack`; read `dist/control/ray_cast_vehicle_controller.d.ts`, `dist/geometry/shape.d.ts`, `dist/dynamics/rigid_body.d.ts`, `package.json`, `README.md` — HIGH
- **`three@0.185.1`** — downloaded via `npm pack`; read `package.json` exports map, `examples/jsm/physics/RapierPhysics.js`, `examples/jsm/libs/` contents — HIGH
- **npm registry** (`npm view`) — all version numbers and publish dates, 2026-09-07 — HIGH
- **GitHub REST API** — `goldfire/howler.js` commit/issue activity — HIGH
- Context7 `/websites/rapier_rs_javascript3d` — `createVehicleController`, `ColliderDesc.trimesh`, `ColliderDesc.heightfield` — HIGH
- Context7 `/dimforge/rapier.js` — changelog, control module docs (note: `_autodocs/control.md` shows a `WheelCollider`-returning `addWheel` API that does **not** match shipped 0.20.0; the shipped index-based API is authoritative) — MEDIUM
- Context7 `/mrdoob/three.js` — GLTFLoader / DRACOLoader / KTX2Loader imports, PositionalAudio, AudioListener, setPlaybackRate — HIGH
- https://github.com/mrdoob/three.js/wiki/Migration-Guide — r180→r186 changes; verified WebGPU is not default — HIGH
- https://threejs.org/examples/physics_rapier_vehicle_controller.html — official vehicle example and its tuning constants — HIGH
- https://rapier.rs/docs/user_guides/javascript/getting_started_js/ — official install/init guidance — HIGH
- https://vite.dev/guide/features.html — WebAssembly ESM integration and `?init` — HIGH
- https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html — API reference — HIGH
- https://gltf-transform.dev/ and https://www.npmjs.com/package/@gltf-transform/cli — optimisation commands — MEDIUM
- https://github.com/pmndrs/react-three-rapier/issues/323 — vehicle controller not wrapped in R3F — MEDIUM
- https://github.com/pmndrs/racing-game/issues/67 — double-render minimap cost — LOW (single issue thread)
- https://pybullet.org/Bullet/phpBB3/viewtopic.php?t=2047 and assorted dev write-ups — raycast-vehicle arcade-drift tuning tension — LOW (community anecdote; consistent across sources, hence flagged as a spike rather than ignored)

---
*Stack research for: browser-based 3D arcade-realistic driving/chase game*
*Researched: 2026-09-07*
