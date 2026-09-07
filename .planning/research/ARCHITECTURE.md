# Architecture Research

**Domain:** Browser-based 3D arcade driving / chase game (Three.js + Rapier + TypeScript/Vite), multi-mode single-player
**Researched:** 2026-09-07
**Confidence:** MEDIUM-HIGH (Rapier/Three.js API facts verified against official docs — HIGH; multi-mode structuring and AI layering synthesized from racing-AI literature and general game architecture practice — MEDIUM)

---

## The Two Load-Bearing Ideas

Everything below hangs off two decisions. If nothing else survives into the roadmap, these should:

1. **"One car, many drivers."** There is exactly one vehicle implementation. Player and every NPC use the same `VehicleActor` and the same physics. Control is expressed as a tiny `DriveInput` struct that *any* driver produces. Player driver reads a gamepad; AI driver runs pursuit logic. This is the mechanism that prevents four game modes from becoming four gameplay codebases.

2. **"The road graph is the single source of truth."** The map compiler builds one graph from the real-world data, and that same graph produces (a) collision geometry, (b) the AI navigation network, and (c) checkpoint/route placement. Building it once offline is what keeps AI, objectives, and drivable geometry from silently disagreeing.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRESENTATION  (render-rate, read-only, never writes sim state)      │
│  ┌────────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │ Renderer   │ │ Helicopter│ │  VFX     │ │ Audio  │ │  HUD /    │  │
│  │ (Three.js) │ │ CameraRig │ │ (smoke,  │ │ (engine│ │  Briefs   │  │
│  │            │ │ + skins   │ │  marks)  │ │ surface│ │           │  │
│  └────────────┘ └───────────┘ └──────────┘ └────────┘ └───────────┘  │
│         ▲              ▲            ▲           ▲           ▲        │
│         └──────────────┴────────────┴───────────┴───────────┘        │
│                         reads FrameState (interpolated)              │
├──────────────────────────────────────────────────────────────────────┤
│  GAME RULES  (thin, per-mode, data-driven — the ONLY per-mode code)  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ModeDirector  ← ModeDefinition (JSON)                         │  │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │Objective │ │   Heat    │ │  Spawn   │ │ Scoring / Medals │  │  │
│  │  │ System   │ │  System   │ │ Director │ │  / BestTimes     │  │  │
│  │  └──────────┘ └───────────┘ └──────────┘ └──────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  SIMULATION  (fixed 60 Hz, mode-agnostic, shared by all four modes)  │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐  │
│  │  Driver   │ │  Vehicle  │ │ Surface  │ │ Damage │ │  NavGraph  │  │
│  │  Layer    │→│  System   │←│  System  │ │ System │ │  (A*, line)│  │
│  │(Player/AI)│ │(VehicleAc-│ │(grip per │ │        │ │            │  │
│  │→DriveInput│ │ tor set)  │ │  wheel)  │ │        │ │            │  │
│  └───────────┘ └───────────┘ └──────────┘ └────────┘ └────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  PHYSICS                                                             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Rapier World + FixedStepScheduler (accumulator) + EventQueue  │  │
│  │  ColliderRegistry: Map<ColliderHandle, EntityRef | SurfaceId>  │  │
│  └────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  WORLD DATA  (produced offline by tools/map-compiler, loaded as-is)  │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Road mesh│ │ Colliders │ │ Surface  │ │RoadGraph │ │ Routes / │   │
│  │ (.glb)   │ │ (trimesh/ │ │  tags    │ │(nav+line)│ │checkpoint│   │
│  │          │ │  cuboid)  │ │          │ │          │ │  specs   │   │
│  └──────────┘ └───────────┘ └──────────┘ └──────────┘ └──────────┘   │
└──────────────────────────────────────────────────────────────────────┘

           OFFLINE (Node, build-time — never runs in browser)
   Google-Maps extractor output ──▶ map-compiler ──▶ .glb + .map.json
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `FixedStepScheduler` | Owns the accumulator; drains real time in fixed 1/60 chunks; caps catch-up steps; exposes `alpha` for render interpolation | Plain class in `core/`; Gaffer-style accumulator loop |
| `PhysicsWorld` | Thin wrapper over `RAPIER.World`; owns `EventQueue`; owns `ColliderRegistry` | Wrapper class; never leaks raw handles above the sim layer |
| `ColliderRegistry` | Maps `ColliderHandle → { entity?, surfaceId? }`. Required because rapier.js colliders expose **no** `userData` (only `RigidBody` does) | `Map<number, ColliderMeta>` populated at map load / spawn |
| `VehicleActor` | One car: chassis rigid body + `DynamicRayCastVehicleController` + 4 wheels + `VehicleTuning` + `VehicleCondition` | Wraps `world.createVehicleController(chassis)` |
| `VehicleSystem` | Per fixed tick: consume each actor's `DriveInput`, apply tuning × condition × surface, call `updateVehicle(dt)` | Iterates all actors — player and AI identical |
| `DriveInput` | The universal control contract: `{throttle, brake, steer, handbrake, gear?}`, all normalized −1..1 / 0..1 | Plain struct; the boundary between "who decides" and "how the car behaves" |
| `PlayerDriver` | Samples keyboard/gamepad → `DriveInput` | Action-mapping layer; sampled at fixed tick, not on DOM events |
| `AIDriver` | Tactics → path plan → pure-pursuit follow → avoidance → `DriveInput` | Layered; only the tactics layer varies by mode |
| `SurfaceSystem` | Per wheel per tick: resolve ground collider → `SurfaceId` → write `frictionSlip` / `sideFrictionStiffness`; publish `WheelContactState` | Reads `wheelGroundObject(i)`, writes into vehicle controller |
| `DamageSystem` | Drains contact-force events → per-zone damage → mutates `VehicleCondition` (which VehicleSystem reads as tuning modifiers) | Event-driven; owns destruction end-state |
| `NavGraph` | Runtime road graph: node/edge queries, A*, racing-line sampling, nearest-edge lookup | Loaded from `.map.json`; spatial hash for nearest-edge |
| `ObjectiveSystem` | Checkpoint/zone progression; ordered vs unordered driven by config | Rapier sensor colliders + `EventQueue` intersection events |
| `HeatSystem` | Heat 1–5: accumulates from spotted/proximity/ramming; decays on broken line-of-sight | Pure state machine over sim state; no rendering knowledge |
| `SpawnDirector` | Reads heat tier → dispatch table → spawns/despawns pursuers at graph nodes off-screen | Data table (`dispatch.json`-style), mirrors GTA's `dispatch.meta` pattern |
| `ModeDirector` | Loads a `ModeDefinition`, wires the mode's rules object, evaluates win/lose, emits results | ~200 lines + 4 small rules classes |
| `HelicopterRig` | Damped high-angle follow camera with velocity lookahead, orbit/zoom/pan, occlusion handling | `Object3D` chain updated in the render loop from interpolated transforms |
| `CameraSkin` | Presentation-only reskin (rotor shake, searchlight, overlay, chatter bus) | Swappable presenter; zero rules coupling |
| `map-compiler` | Offline: extractor output → projected metric road graph → ribbon meshes + intersections + colliders + surface tags + route specs | Node script in `tools/`, outputs versioned `.glb` + `.map.json` |

---

## Recommended Project Structure

```
src/
├── core/                      # Engine-agnostic plumbing
│   ├── loop.ts                # FixedStepScheduler (accumulator + alpha)
│   ├── FrameState.ts          # Read-only per-frame snapshot for presentation
│   └── events.ts              # Typed emitter (rules ↔ UI only, NOT sim internals)
├── engine/
│   ├── render/                # Renderer, scene, materials, post-processing
│   ├── physics/
│   │   ├── PhysicsWorld.ts    # Rapier world + EventQueue wrapper
│   │   └── ColliderRegistry.ts# handle → {entity, surfaceId}
│   ├── input/                 # Keyboard/gamepad → action map → DriveInput
│   ├── audio/                 # Buses: engine, surface, impacts, radio chatter
│   └── vfx/                   # Pooled particles (three.quarks), tire marks, debris
├── world/
│   ├── map/                   # MapLoader, WorldTile, streaming/activation
│   ├── surface/               # SurfaceRegistry + surface profile table
│   └── navgraph/              # RoadGraph runtime, A*, racing line, spatial hash
├── vehicle/
│   ├── VehicleActor.ts        # chassis + Rapier vehicle controller + wheels
│   ├── VehicleSystem.ts       # per-tick application of DriveInput
│   ├── VehicleTuning.ts       # data-driven handling presets per car
│   ├── DriveInput.ts          # the universal control contract
│   └── DamageSystem.ts
├── drivers/
│   ├── PlayerDriver.ts
│   └── ai/
│       ├── AIDriver.ts        # orchestrates the 4 AI layers
│       ├── tactics/           # RacerTactics, PursuerTactics, RoadblockTactics
│       ├── PathFollower.ts    # pure pursuit
│       ├── Avoidance.ts       # short-range shapecasts
│       └── Recovery.ts        # stuck/flip detection → reverse-and-realign
├── camera/
│   ├── HelicopterRig.ts
│   ├── springs.ts             # critically-damped SmoothDamp helpers
│   └── skins/                 # police / news / sports-broadcast presenters
├── modes/
│   ├── ModeDirector.ts
│   ├── rules/                 # RaceRules, CircuitRules, GetawayRules, SurvivalRules
│   ├── objectives/            # CheckpointSystem, ZoneSystem, EndureTimer
│   ├── heat/                  # HeatSystem, SpawnDirector
│   └── scoring/               # MedalSystem, BestTimes (localStorage)
├── ui/                        # HUD, mission briefs, menus
└── data/                      # JSON only — no logic
    ├── modes/*.json           # ModeDefinition per mode
    ├── tuning/*.json          # VehicleTuning per car
    ├── surfaces.json          # SurfaceProfile table
    ├── dispatch.json          # heat tier → pursuer composition
    └── levels/*.json          # level = map + mode + route + medal times

tools/
└── map-compiler/              # Node build script (never shipped to browser)
    ├── ingest.ts              # extractor output → normalized GeoJSON-ish
    ├── project.ts             # lat/lon → local metric ENU
    ├── topology.ts            # ways → RoadGraph (split at shared nodes)
    ├── geometry.ts            # centerline smoothing → ribbon + intersections
    ├── surfaces.ts            # OSM tags → SurfaceId per collider chunk
    └── emit.ts                # → .glb + .map.json
```

### Structure Rationale

- **`vehicle/` and `drivers/` are separate top-level folders.** This is the physical enforcement of "one car, many drivers." If AI logic ever needs to `import` from `vehicle/` beyond `VehicleActor` and `DriveInput`, that's a design smell.
- **`modes/` is small by design.** If `modes/` ever grows past ~15% of `src/`, the mode-config approach has failed and per-mode logic is leaking in.
- **`data/` contains JSON only.** Medal times, heat thresholds, dispatch tables, tuning, surface profiles — all of it lives here so tuning iterations don't touch code. This matters enormously for a solo project where "make the car feel right" will be dozens of iterations.
- **`tools/map-compiler/` is outside `src/`.** It must never be bundled. Runtime should not know that OSM exists.
- **No ECS library recommended for v1.** Community guidance (webgamedev.com, Overwatch GDC precedent) favours ECS for thousands of entities. Heat Street has ~2–20 vehicles plus static world. A plain system-oriented class design with explicit arrays and a fixed update order is simpler, easier to debug, and easier for Claude Code to reason about. Keep systems side-effect-explicit and the migration to `bitECS`/`miniplex` stays open if entity count ever explodes. *(MEDIUM confidence — this is an opinionated call, not an industry consensus.)*

---

## Architectural Patterns

### Pattern 1: Universal `DriveInput` (the "one car, many drivers" contract)

**What:** Every controllable entity is a `VehicleActor`. Nothing else in the codebase knows whether a car is player- or AI-controlled. Control is a value, not a class hierarchy.

**When to use:** Always here. Chase-cam gameplay puts AI cars on screen constantly and in constant contact with the player — divergent physics for AI would be immediately visible.

**Trade-offs:** AI must actually drive (harder than spline-following, needs recovery behaviours for getting stuck). In exchange you get free physical interaction — ramming, PIT manoeuvres, pileups, AI crashing into scenery — which is the *entire aesthetic* of the reference films.

```typescript
export interface DriveInput {
  throttle: number;   // 0..1
  brake: number;      // 0..1
  steer: number;      // -1..1
  handbrake: number;  // 0..1
}

export interface Driver {
  /** Called once per fixed tick. Must be pure w.r.t. physics state. */
  update(actor: VehicleActor, world: SimContext, dt: number): DriveInput;
}

// VehicleSystem does not care which one it got.
for (const actor of actors) {
  const input = actor.driver.update(actor, ctx, dt);
  applyInput(actor, input, dt);   // tuning × condition × surface
  actor.controller.updateVehicle(dt);
}
```

### Pattern 2: `ModeDefinition` data + thin `ModeRules` hooks

**What:** All four modes assemble the *same* scene from the *same* systems. What differs is a JSON record plus a small rules object with lifecycle hooks. Circuit racing and Getaway differ in configuration, not in code path.

**When to use:** From the first mode. Retrofitting this after building Point-to-Point as a bespoke "game class" is the single most likely way this project acquires four parallel codebases.

**Trade-offs:** Slight upfront over-engineering for mode #1 (~a day). Pays for itself completely at mode #2.

```typescript
export interface ModeDefinition {
  id: 'point-to-point' | 'circuit' | 'getaway' | 'survival';
  objective:
    | { kind: 'checkpoints'; ordered: boolean; laps?: number }
    | { kind: 'reach-zone'; zoneId: string }
    | { kind: 'endure' };
  opponents: { kind: 'racers'; count: number; skill: number }
            | { kind: 'pursuers'; dispatchTable: string }
            | { kind: 'none' };
  heat: { enabled: boolean; maxTier: number; decayDelayMs: number } | null;
  escalation: { kind: 'tiered' } | { kind: 'continuous'; rampPerMinute: number } | null;
  failure: Array<'destroyed' | 'busted' | 'timeout'>;
  camera: { skin: 'police' | 'news' | 'sports-broadcast' };
  medals: { gold: number; silver: number; bronze: number };  // seconds or survival ms
}

export interface ModeRules {
  onStart(ctx: ModeContext): void;
  onFixedTick(ctx: ModeContext, dt: number): void;
  onObjectiveEvent(ctx: ModeContext, e: ObjectiveEvent): void;
  evaluateEnd(ctx: ModeContext): ModeResult | null;
}
```

The four modes then collapse to:

| Mode | Objective | Opponents | Heat | Escalation | Rules class LOC (est.) |
|------|-----------|-----------|------|------------|------------------------|
| Point-to-Point | checkpoints, ordered:false | none | null | null | ~40 |
| Circuit | checkpoints, ordered:true, laps:N | racers | null | null | ~70 |
| Getaway | reach-zone | pursuers | tiered | tiered | ~90 |
| Survival | endure | pursuers | n/a | continuous | ~70 |

*Note:* the design doc's "Checkpoint Hunt" is not a fifth mode — it is Point-to-Point with `ordered: false`. PROJECT.md has already effectively merged them; the config confirms they're the same mode.

### Pattern 3: Layered AI driver (only the top layer is per-mode)

**What:** Four stacked layers, matching the standard racing-game AI architecture. Layers 2–4 are shared by racers and pursuers; only layer 1 (tactics) differs.

```
1. TACTICS       (per-mode) → chooses a GOAL
     Racer:    next checkpoint / overtake line
     Pursuer:  intercept point ahead of player / roadblock node / PIT position
                    ↓ goal node
2. PATH PLAN     (shared)  → A* over NavGraph, re-planned at 2–5 Hz (NOT per frame)
                    ↓ polyline path
3. PATH FOLLOW   (shared)  → pure pursuit: lookahead point at distance k·speed,
                             steer to the arc; target speed from upcoming curvature
                             × surface grip × difficulty modifier
                    ↓ desired steer + speed
4. REACTIVE      (shared)  → forward shapecasts, blend avoidance steer,
                             stuck/flip detection → recovery behaviour
                    ↓
                 DriveInput
```

**Why pure pursuit:** it is the standard, well-documented path-following controller for front-wheel-steered non-holonomic vehicles, and the lookahead-distance-proportional-to-speed heuristic gives naturally cinematic wide lines at speed. Adaptive lookahead (tuning `k` by speed and curvature) is the known refinement if cars cut corners or oscillate.

**Difficulty / rubber-banding:** applied as *modifiers on tuning and target speed* by the ModeDirector — never as branches inside the driver. Keeps difficulty tunable from `data/` and prevents AI code from acquiring mode knowledge.

**Trade-offs:** more moving parts than spline-following, and layer 4 (recovery) is genuinely fiddly — budget real time for "AI car wedged against a lamppost." Mitigate with a hard stuck-timer → teleport-to-nearest-node fallback, off-screen only.

### Pattern 4: Surface tagging via ground-collider lookup

**What:** Each drivable collider chunk is tagged with a `SurfaceId` at map-compile time. Each fixed tick, per wheel, the vehicle controller tells you which collider that wheel is standing on; you look up its profile and write the wheel's friction parameters.

**The critical fact (HIGH confidence, verified against Rapier docs):** Rapier's `DynamicRayCastVehicleController` computes tire grip from **per-wheel** parameters (`setWheelFrictionSlip`, `setWheelSideFrictionStiffness`), not from the ground collider's `friction` coefficient. Calling `collider.setFriction()` on road geometry will do essentially nothing to how the car drives. If the surface system is built on collider friction it will silently not work — this is the highest-value thing to know before writing a line of surface code.

```typescript
// world/surface/SurfaceProfile.ts — data-driven, lives in data/surfaces.json
export interface SurfaceProfile {
  id: SurfaceId;                  // 'tarmac' | 'gravel' | 'grass' | 'mud' | 'sand' | 'dirt'
  gripMul: number;                // → frictionSlip multiplier
  sideMul: number;                // → sideFrictionStiffness multiplier
  rollingResistance: number;      // → extra drag while in contact
  // presentation-only fields, read by VFX/Audio — never by physics:
  particleId: string;             // 'dust' | 'smoke' | 'grass-clippings'
  loopSfxId: string;
  tireMarkOpacity: number;
  cameraShake: number;
}

// vehicle/SurfaceSystem.ts — runs BEFORE updateVehicle each fixed tick
for (let i = 0; i < 4; i++) {
  if (!vc.wheelIsInContact(i)) { contact[i].inContact = false; continue; }

  const ground   = vc.wheelGroundObject(i);                 // Collider
  const surface  = surfaces.get(registry.surfaceOf(ground.handle));
  const cond     = actor.condition.tireHealth[i];

  vc.setWheelFrictionSlip(i, tuning.baseSlip * surface.gripMul * cond);
  vc.setWheelSideFrictionStiffness(i, tuning.baseSide * surface.sideMul * cond);

  // Publish for presentation — one-way, read-only downstream
  contact[i] = {
    inContact: true,
    surfaceId: surface.id,
    slip: estimateSlipRatio(actor, i),
    load: vc.wheelSuspensionForce?.(i) ?? 0,
  };
}
```

**Tagging granularity — recommended v1:** split the road/terrain mesh into **one collider per surface material** at compile time (a tarmac trimesh, a gravel trimesh, a grass trimesh, per tile). Lookup is then `O(1)` handle→id with zero extra raycasts. Per-triangle or texture-splat surface lookup is strictly better-looking but requires a second raycast plus barycentric UV sampling per wheel per tick — defer it; the low-poly art direction and mid-to-far camera make per-collider granularity visually sufficient.

**VFX/audio hookup:** `SurfaceSystem` *writes* `WheelContactState[]` into the frame state. `VFXSystem` and `AudioSystem` *read* it in the render loop and never call back into physics. This one-way flow means adding tire smoke can never destabilise handling — a real risk if effects are triggered from inside the physics tick.

### Pattern 5: Helicopter camera rig (damped follow + lookahead + orbit)

**What:** A pivot chain updated in the *render* loop from *interpolated* transforms, using critically-damped springs (SmoothDamp) with different time constants for position vs. aim.

```
anchor (Object3D, follows a smoothed target point)
  └── yawPivot   (auto-heading + player orbit offset)
        └── pitchPivot (auto-altitude + player pitch offset)
              └── camera (at −distance on local Z, always high angle)
```

```typescript
update(dt: number, car: InterpolatedTransform, input: CameraInput) {
  // 1. Lookahead: aim where the car is GOING, not where it is.
  const speed = car.velocity.length();
  const lead  = Math.min(speed * this.leadSeconds, this.maxLead);
  const focus = tmp.copy(car.position).addScaledVector(car.velocityDir, lead);

  // 2. Speed-driven framing — pull up and back as speed rises.
  const t        = smoothstep(0, this.topSpeed, speed);
  const distance = lerp(this.distMin, this.distMax, t);
  const height   = lerp(this.altMin,  this.altMax,  t);

  // 3. Auto-heading follows velocity, not car yaw — keeps the frame stable
  //    through drifts (car yaw swings wildly, velocity heading does not).
  const autoYaw = Math.atan2(car.velocityDir.x, car.velocityDir.z);

  // 4. Critically damped springs. Aim converges FASTER than position:
  //    the car stays framed while the rig lags cinematically behind.
  smoothDampVec3(this.anchor.position, focus,   this.posVel, this.posSmooth,  dt);
  this.yaw   = smoothDampAngle(this.yaw,   autoYaw + input.orbitYaw, this.yawVel,  this.yawSmooth,  dt);
  this.pitch = smoothDampAngle(this.pitch, this.autoPitch + input.orbitPitch, this.pitchVel, this.pitchSmooth, dt);
  this.dist  = smoothDamp(this.dist, distance * input.zoom, this.distVel, this.zoomSmooth, dt);

  // 5. Skin layer: rotor shake / searchlight / overlay — presentation only.
  this.skin.apply(this.camera, dt, ctx);
}
```

**Non-obvious details that matter:**

- **Aim at velocity heading, not car heading.** In a drift-heavy game the chassis yaw swings 40°+ while the car keeps travelling roughly straight. A rig that follows chassis yaw will make the camera lurch on every slide. Following the velocity vector produces the stable, "operator tracking the car" feel the reference films have.
- **Update in the render loop from interpolated transforms.** Driving the camera from raw physics transforms at 60 Hz while rendering at 144 Hz produces visible judder. This is why the fixed-step loop must expose an `alpha` and per-actor previous/current transforms.
- **Occlusion, not collision.** A conventional chase cam pushes in when geometry blocks the view. A helicopter cam must *not* — being shoved down to street level destroys the whole premise. Instead: enforce a minimum altitude above the road surface, then raycast anchor→camera and fade/dither out occluding buildings. This also solves urban chases where every corner would otherwise slam the camera into a rooftop.
- **Auto-recentre after manual orbit.** Player orbit/pan offsets decay back toward zero after an idle timeout so the rig always returns to the signature framing.
- **`camera-controls` (yomotsu) is a reference, not a dependency.** It already uses SmoothDamp and handles orbit/zoom/pan well, but it is built for orbiting a static target, not for velocity-driven cinematic framing. Read it for the SmoothDamp implementation; write the rig yourself (~250 lines). *(MEDIUM confidence — judgement call.)*
- **One rig, three skins.** PROJECT.md already committed to this. Enforce it in code: `CameraSkin` may only touch camera FOV, post-processing, additive shake noise, overlay elements, and its audio bus. It may not touch distance, damping, or targeting.

### Pattern 6: Map compiler (offline GIS → drivable world)

**What:** A Node build script converts the extractor's real-world output into shipped assets. **Nothing about OSM/GIS exists at runtime.**

```
extractor output (Google Maps area)
        │
   [1] INGEST      → normalize to { nodes, ways(tags), buildings, water, landuse }
        │
   [2] PROJECT     → lat/lon → local metric ENU, origin = map centre
        │            (keep everything within ~±10 km of origin for float precision)
   [3] TOPOLOGY    → split ways at every shared node → RoadGraph{Node[], Edge[]}
        │            edge carries: class, lanes, width, oneway, surface tag, speed
   [4] SMOOTH      → resample centerlines at fixed spacing + Chaikin/Catmull-Rom
        │            (raw OSM polylines have hard kinks that make cars judder)
   [5] GEOMETRY    → per edge: ribbon extrusion (left/right offset by half-width,
        │            triangle strip, mitred joins), CUT BACK near junctions
        │          → per junction: fill polygon from the cut-back endpoints
        │            (the standard "road sections + intersections separately" split)
   [6] TERRAIN     → heightfield from DEM (or flat); conform road verts;
        │            emit skirts so roads never float
   [7] SURFACES    → OSM `surface=` tag → SurfaceId; fall back by highway class.
        │            GROUP TRIANGLES BY SURFACE → one collider chunk per surface
   [8] COLLISION   → roads/terrain: trimesh (terrain preferably heightfield —
        │            far cheaper); buildings: cuboid/convex per footprint,
        │            NEVER trimesh; split everything into spatial tiles
   [9] ROUTES      → author/derive: checkpoint transforms along a graph path,
        │            racing line polyline, spawn nodes, escape zones
   [10] EMIT       → world.glb + map.json (versioned schema)
```

**Why offline is non-negotiable:** parsing and meshing a city's worth of OSM in the browser costs seconds-to-minutes and megabytes of transient garbage, blows the main thread, and makes level load times unpredictable. Compiling offline turns it into a plain `.glb` fetch.

**Why the road graph must be emitted, not just the mesh:** the same graph feeds three consumers.

```
                  ┌──▶ collision geometry (what you can drive on)
RoadGraph ────────┼──▶ NavGraph          (where AI can go)
                  └──▶ Route/Checkpoints (what the mode asks for)
```

If checkpoints are hand-placed in world space independently of the graph, they will drift off-road the first time the map is recompiled, and AI will path to places checkpoints aren't. Deriving all three from one graph makes recompilation safe.

**Junction handling is the hard part.** Naively ribboning every edge through shared nodes produces overlapping, z-fighting, physically bumpy intersections — the most common failure of OSM-to-game pipelines and the reason published approaches explicitly split "road sections" from "intersection geometry." Budget real time for step 5.

**Useful libraries (MEDIUM confidence — verify at implementation):** `@turf/turf` for GeoJSON ops (buffer, simplify, boolean), `osmtogeojson` if the extractor emits raw OSM, `three-mesh-bvh` for compile-time geometry queries and runtime occlusion raycasts. `three-geo` is a useful reference implementation for terrain tiling but is oriented at visualization, not drivable collision.

---

## Data Flow

### The fixed tick (60 Hz — authoritative)

```
accumulator += clamp(realDt, 0, maxFrameTime)
while (accumulator >= FIXED_DT && steps++ < MAX_CATCHUP) {

  1. InputSystem.sample()               → latched device state
  2. Drivers.update()                   → DriveInput per actor
       ├─ PlayerDriver: device → input
       └─ AIDriver:     tactics → A* (staggered, N per tick) → pure pursuit
                        → avoidance → input
  3. SurfaceSystem.apply()              → per-wheel frictionSlip / sideStiffness
                                          + publish WheelContactState
  4. VehicleSystem.apply()              → engine force / brake / steer
                                          + vc.updateVehicle(FIXED_DT)   ← per actor
  5. world.step(eventQueue)             ← THE physics step
  6. eventQueue.drain*()                → DamageSystem, ObjectiveSystem (sensors),
                                          HeatSystem (contact = ramming)
  7. HeatSystem.tick() / SpawnDirector.tick()
  8. ModeDirector.onFixedTick() → evaluateEnd()
  9. Snapshot prev/current transforms for interpolation

  accumulator -= FIXED_DT
}
alpha = accumulator / FIXED_DT
```

**Ordering note (MEDIUM confidence):** `updateVehicle(dt)` writes directly into the chassis rigid body's velocity, so it must run *before* `world.step()` within the same tick. The official three.js Rapier vehicle example calls `updateVehicle(1/60)` in its animation loop alongside the world step; verify the exact relative ordering empirically during the first prototype — it materially affects handling feel.

**AI staggering:** re-planning A* for every pursuer every tick is wasteful and unnecessary. Give the AI layer a per-tick budget (e.g. "at most 2 re-plans per tick") and round-robin. Pure pursuit and avoidance still run every tick for every AI — those are cheap and must not be staggered or steering will visibly stutter.

### The render frame (uncapped)

```
alpha from scheduler
      ↓
FrameState = interpolate(prev, current, alpha)   ← for every visible transform
      ↓
├─ Meshes: position/quaternion ← FrameState
├─ HelicopterRig.update(dt, FrameState.playerCar, cameraInput)
│     └─ CameraSkin.apply()  (shake, searchlight, overlay, chatter bus)
├─ VFXSystem.update()   ← reads WheelContactState (smoke/dust/marks by surfaceId)
├─ AudioSystem.update() ← reads WheelContactState + engine RPM + heat tier
└─ HUD.update()         ← reads ModeDirector state (objective, timer, heat, medal pace)
```

### Key data flows

1. **Control:** `device | AI tactics → DriveInput → VehicleSystem → Rapier chassis velocity`. One path, two producers.
2. **Grip:** `map-compiler surface tag → ColliderRegistry → wheelGroundObject() → SurfaceProfile → setWheelFrictionSlip()`. Compile-time data reaching the tire contact patch.
3. **Feedback:** `SurfaceSystem → WheelContactState → (VFX | Audio | camera shake)`. Strictly one-way; presentation never writes back.
4. **Objectives:** `sensor collider intersection → EventQueue → ObjectiveSystem → ModeRules.onObjectiveEvent → ModeDirector.evaluateEnd → result → MedalSystem → BestTimes`.
5. **Escalation:** `player actions → HeatSystem tier → dispatch table → SpawnDirector → new VehicleActor + PursuerTactics`. Adding a heat tier is a JSON edit, not a code change.
6. **Damage:** `contact force events → DamageSystem → VehicleCondition → tuning modifiers in VehicleSystem`, plus a presentation-only reader for visual deformation/smoke.

### Checkpoint detection: sensors, with ordering guards

Use Rapier **sensor colliders** sized to road width at each checkpoint (auto-generated from the road graph edge width, which the compiler already knows), read via `EventQueue` intersection events. Prefer this over plane-crossing math: plane algorithms are cheaper but break badly when players take shortcuts or approach off-axis — and Heat Street's Point-to-Point mode *explicitly encourages arbitrary routes*.

Ordering integrity for Circuit mode: track a monotonic index and require checkpoints in sequence; log a `wrong-way` state rather than silently ignoring. For unordered Point-to-Point, a simple visited set is sufficient. Give sensors generous vertical extent — jumps are a stated feature and a car flying over a checkpoint must still register.

---

## Scaling Considerations

Reinterpreting the usual "users" axis as **world and actor scale**, which is the actual constraint for a single-player browser game.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Prototype: flat plane, 1 car | No streaming, no LOD, single trimesh ground. Everything in one scene. Focus entirely on feel. |
| Small map (~1 km²), 1–6 cars | Whole map loaded at once. Static merged geometry per material. `InstancedMesh` for repeated props (lamp posts, trees, barriers). Single Rapier world, trimesh roads + heightfield terrain + cuboid buildings. This is almost certainly enough for v1. |
| Town/city (~4–25 km²), 6–20 cars | Tile the map (compiler already emits tiles). Activate colliders only for tiles near the player; keep distant tiles as visual-only or unloaded. Frustum culling + geometry LOD. Consider a cheap "sleeping AI" mode for pursuers outside a radius (advance them along the graph analytically instead of simulating physics). |
| Large multi-area world | Stream `.glb` tiles on demand with placeholders; move compiler output to per-tile files; consider running the physics world in a Web Worker with a `SharedArrayBuffer` transform ring buffer. Only do this if profiling demands it. |

### Scaling priorities

1. **First bottleneck: draw calls, not physics.** A naive OSM city emits thousands of separate road/building meshes. Fix in the *compiler*: merge geometry per material per tile, and instance repeated props. This is a build-step change, not a runtime one — another argument for a real compiler.
2. **Second bottleneck: trimesh collider construction cost.** Building large trimeshes stalls the main thread at load and on tile activation. Fix by pre-tiling in the compiler, using heightfields for terrain, and using cuboid/convex colliders for buildings rather than trimeshes.
3. **Third bottleneck: AI path planning.** Only once ~10+ pursuers exist. Fix with the staggered re-plan budget (already in the design) before reaching for anything fancier.
4. **Not a bottleneck: the vehicle controllers themselves.** Raycast vehicles are 4 rays each; 20 cars is 80 rays per tick. Ignore this.

**Do not** pre-build streaming, workers, or LOD systems for v1. Build the tiling *in the compiler output format* so streaming is addable later without a rewrite, but don't implement the streaming.

---

## Anti-Patterns

### Anti-Pattern 1: Per-mode game classes

**What people do:** `RaceGame.ts`, `ChaseGame.ts`, `SurvivalGame.ts`, each owning its own scene setup, camera handling, AI spawning and HUD.
**Why it's wrong:** the vehicle tuning fix you make in one is missing from the other three. This is the specific failure mode that turns a four-mode game into an unmaintainable solo project, and it is nearly always the result of building mode #1 "just to get something working."
**Do this instead:** `ModeDirector` + `ModeDefinition` JSON + small rules hooks, from mode #1. Accept the extra day.

### Anti-Pattern 2: Using collider friction for tire grip

**What people do:** `roadCollider.setFriction(1.0)`, `grassCollider.setFriction(0.4)` and expect the car to slide on grass.
**Why it's wrong:** Rapier's raycast vehicle controller derives grip from per-wheel `frictionSlip` / `sideFrictionStiffness`, not from the ground collider's friction coefficient. The setting is silently ineffective, producing hours of "why does grass feel identical to tarmac."
**Do this instead:** per-wheel writes each tick via `wheelGroundObject(i)` → `SurfaceProfile` → `setWheelFrictionSlip()`. (See Pattern 4.)

### Anti-Pattern 3: Camera driven from raw physics transforms

**What people do:** update the camera inside the physics tick, or read `rigidBody.translation()` directly in the render loop.
**Why it's wrong:** at any refresh rate other than exactly 60 Hz, the camera jitters — and because the camera is the *entire* visual identity of this game, jitter is fatal.
**Do this instead:** snapshot prev/current transforms each fixed tick, interpolate by `alpha` in the render loop, feed the rig the interpolated transform.

### Anti-Pattern 4: Spline-cheating AI

**What people do:** move AI cars along a spline with kinematic bodies, faking physics.
**Why it's wrong:** a permanent high-angle camera keeps AI cars on screen constantly and in constant contact with the player. Kinematic AI cars won't ram convincingly, can't be PIT-manoeuvred, and won't crash — removing the best moments of the reference films.
**Do this instead:** same `VehicleActor` for everyone, differentiated by tuning presets and driver skill parameters. Budget time for recovery behaviours; it's the price of the good version.

### Anti-Pattern 5: Runtime OSM/GIS processing

**What people do:** fetch and mesh road data in the browser at level load.
**Why it's wrong:** unpredictable multi-second stalls, large transient allocations, and it couples gameplay code to a data format it should never know about.
**Do this instead:** offline `tools/map-compiler` emitting versioned `.glb` + `.map.json`. Runtime only knows about meshes, colliders, surface ids and a graph.

### Anti-Pattern 6: Presentation systems reaching into physics

**What people do:** spawn tire smoke from inside the wheel-update code; trigger sounds from the collision-event handler on the physics thread.
**Why it's wrong:** effect work starts consuming the fixed-step budget, which causes catch-up steps, which changes handling. Physics timing becomes coupled to how many particles are on screen.
**Do this instead:** physics publishes `WheelContactState` / impact records into the frame state. VFX and audio read it in the render loop. Strictly one-way.

### Anti-Pattern 7: Constants in code

**What people do:** hard-code medal times, heat thresholds, grip values, pursuer counts.
**Why it's wrong:** tuning "weighty, cinematic, replayable" handling is a hundreds-of-iterations process, and every iteration that requires a code edit is slower and riskier than one that requires a JSON edit.
**Do this instead:** everything numeric that affects feel lives in `data/`. Add a dev-only tweak panel (`lil-gui`/`tweakpane`) bound directly to the loaded JSON, with a "copy current values to clipboard" button.

### Anti-Pattern 8: Keeping world coordinates in degrees or far from origin

**What people do:** carry lat/lon or a global projected coordinate into the scene.
**Why it's wrong:** float32 precision degrades visibly at large magnitudes — jittering geometry and unstable physics, at exactly the scale a real-world city map produces.
**Do this instead:** project to local metres in the compiler with the map centre as origin; keep everything within a few kilometres of zero.

---

## Integration Points

### External Services / Tooling

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| User's Google-Maps extractor | Offline file handoff into `tools/map-compiler/ingest.ts` | Define and freeze a normalized intermediate schema immediately, so the compiler is insulated from extractor changes. Highest-uncertainty integration in the project. |
| Elevation (DEM) data | Optional compiler input → heightfield | Flat maps are acceptable for v1; hills are a large feel win for chase cinema. Add as a compiler stage, not a runtime feature. |
| glTF assets (Kenney kit + muscle-car body) | `GLTFLoader` at runtime; naming convention drives wheel/chassis binding | Establish a strict node-naming convention (`chassis`, `wheel_fl`, …) so swapping car models is data, not code. |
| Persistence (best times, unlocks) | `localStorage` behind a `SaveStore` interface | Interface it now; swapping to IndexedDB or cloud later stays cheap. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Drivers ↔ VehicleSystem | `DriveInput` value struct | The most important boundary in the codebase. Nothing else crosses it. |
| Sim ↔ Presentation | `FrameState` (interpolated, read-only) | One-way. Presentation never mutates sim state. |
| Physics ↔ Sim | `PhysicsWorld` wrapper + `ColliderRegistry` | Raw Rapier handles must not escape into gameplay code. |
| SurfaceSystem ↔ VehicleSystem | Direct write of wheel params before `updateVehicle` | Tightly ordered by design; both live in `vehicle/`. |
| ObjectiveSystem ↔ ModeRules | Typed `ObjectiveEvent` callbacks | Keeps checkpoint logic generic and mode logic tiny. |
| ModeDirector ↔ UI | Typed event emitter | The one place a general event bus is appropriate; do not extend it into the sim. |
| Compiler ↔ Runtime | Versioned `.map.json` schema + `.glb` | Include a schema version and fail loudly on mismatch — the compiler will change often. |

---

## Suggested Build Order

Dependency-driven, front-loading the two biggest risks (car feel, map pipeline).

| # | Build | Depends on | De-risks |
|---|-------|------------|----------|
| 1 | Core loop: fixed step + accumulator + alpha interpolation; Rapier world; Three.js renderer; debug render | — | The timing foundation everything else assumes; retrofitting is painful |
| 2 | `VehicleActor` + `PlayerDriver` + `VehicleTuning` JSON + dev tweak panel, on a flat plane | 1 | **Core Value.** "Weighty, cinematic, controllable oversteer" either happens here or the project has no reason to exist |
| 3 | `SurfaceRegistry` + `SurfaceProfile` table, tested with surface patches on the flat plane | 2 | Validates the per-wheel friction approach before any real map exists |
| 4 | `HelicopterRig` + one skin | 2 (needs a car worth filming) | The signature visual identity; also reveals framing problems while they're cheap to fix |
| 5 | `map-compiler` v1 + one small real map (roads, junctions, colliders, surface tags, road graph) | 3 | **Biggest unknown.** Junction geometry and extractor-format surprises live here |
| 6 | `ObjectiveSystem` + `ModeDirector` + `ModeDefinition` → ships **Point-to-Point** and **Circuit (no AI)** | 5 | Proves the config-over-code mode approach with two modes at once |
| 7 | AI stack: NavGraph A* → pure pursuit → avoidance → recovery; `RacerTactics` → **Circuit with racers** | 6 | Hardest system; needs a real map and a proven vehicle to develop against |
| 8 | `HeatSystem` + `SpawnDirector` + `PursuerTactics` → **Getaway** | 7 | Pure reuse: swaps tactics + config, adds no new vehicle or camera work |
| 9 | `DamageSystem` + destruction end-state + continuous escalation → **Survival** | 8 | Reuses all of Getaway; only failure conditions and escalation curve differ |
| 10 | Medals, best times, area unlock, VFX/audio polish, radio chatter, mission briefs | 6–9 | Meta layer; touches no simulation code if boundaries held |

**Ordering rationale:**

- **2 before everything.** If the car doesn't feel right, nothing else matters. It's also the cheapest thing to iterate on (flat plane, no map, no AI).
- **3 before 5.** Prove the surface mechanism on a flat plane where you fully control the variables, *then* wire it to compiler output. Debugging "grass feels wrong" is far harder when the map pipeline is also new.
- **4 before 5.** The camera reveals what the map actually needs to look like at typical framing distance — informing LOD and detail decisions in the compiler.
- **5 before 6 and 7.** Both objectives and AI consume the road graph. Building either against hand-placed test data means building it twice.
- **6 delivers two modes.** If the ModeDefinition approach is going to fail, it fails here, cheaply, with two modes rather than four.
- **8 and 9 should be small.** If Getaway or Survival require significant new systems rather than new config plus one tactics class, the architecture didn't hold and it's worth stopping to fix rather than pushing through.

**Phases likely to need their own deeper research:** #5 (map compiler — junction geometry, extractor format), #7 (AI — pure pursuit tuning, recovery behaviours), #2 (vehicle tuning — arcade↔sim benchmarking is still an open question in PROJECT.md).

---

## Confidence Summary

| Claim | Confidence | Basis |
|-------|------------|-------|
| `DynamicRayCastVehicleController` API surface (`addWheel`, `setWheelFrictionSlip`, `setWheelSideFrictionStiffness`, `wheelIsInContact`, `wheelGroundObject`, `updateVehicle`, `currentVehicleSpeed`) | HIGH | Official Rapier JS API docs + Context7 |
| Wheel grip comes from per-wheel params, not collider friction | HIGH | Rapier docs: friction slip / side friction stiffness are wheel properties; collider friction documented separately as a rigid-body contact property |
| `wheelGroundObject(i)` returns the ground `Collider` — the surface-tagging hook | HIGH | Official Rapier JS API docs |
| rapier.js exposes `userData` on `RigidBody` but not on `Collider`; handle→data maps are the standard workaround | MEDIUM | rapier.js source/API references; verify at implementation |
| Official three.js Rapier vehicle example exists and demonstrates the wheel-sync pattern | HIGH | threejs.org/examples/physics_rapier_vehicle_controller.html |
| Fixed timestep + accumulator + alpha interpolation is the correct browser game loop | HIGH | Gaffer On Games (canonical) + multiple corroborating sources |
| `updateVehicle()` should be called before `world.step()` in the same tick | MEDIUM | Implied by "changes directly the rigid-body's velocity"; official example ordering not fully verified — confirm empirically |
| Pure pursuit with speed-proportional lookahead is the standard racing-AI path follower | HIGH | Multiple autonomous-racing papers + Game AI Pro racing architecture chapter |
| Layered racing AI (tactics → plan → follow → react) is standard | MEDIUM | Game AI Pro Ch. 38 (PDF not machine-readable in this session); corroborated by multiple secondary sources |
| Trigger volumes beat plane-crossing for shortcut-tolerant checkpoints | MEDIUM | Community consensus across multiple gamedev discussions; no single authoritative source |
| OSM→game pipelines separate road-section geometry from intersection geometry | MEDIUM-HIGH | KTH thesis on OSM road network geometry generation + multiple Unity/UE implementations |
| Skipping ECS is right for ~20 entities | MEDIUM | Opinionated judgement; webgamedev.com recommends ECS generally but frames its benefit around thousands of entities |

---

## Sources

**Official / HIGH confidence**
- [DynamicRayCastVehicleController — Rapier JS API](https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html)
- [Rapier Colliders — friction, collision groups, sensors, events (JS user guide)](https://www.rapier.rs/docs/user_guides/javascript/colliders)
- [Rapier Advanced Collision Detection (JS)](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/)
- [three.js official example — rapier3d vehicle controller](https://threejs.org/examples/physics_rapier_vehicle_controller.html)
- [rapier.js CHANGELOG](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md)
- [Fix Your Timestep! — Gaffer On Games](https://gafferongames.com/post/fix_your_timestep/)
- [Turf.js — buffer / polygonize](https://turfjs.org/docs/api/buffer)

**Architecture & AI / MEDIUM confidence**
- [An Architecture Overview for AI in Racing Games — Game AI Pro Ch. 38](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter38_An_Architecture_Overview_for_AI_in_Racing_Games.pdf)
- [Adaptive Lookahead Pure-Pursuit for Autonomous Racing (arXiv)](https://arxiv.org/pdf/2111.08873)
- [DeepRacing: Parameterized Trajectories for Autonomous Racing (arXiv)](https://arxiv.org/pdf/2005.05178)
- [OSM-Based Automatic Road Network Geometry Generation (KTH thesis)](https://kth.diva-portal.org/smash/get/diva2:1375175/FULLTEXT01.pdf)
- [OpenTwinMap: Open-Source Digital Twin Generator for Urban Autonomous Driving (arXiv)](https://arxiv.org/pdf/2511.21925)
- [OpenStreetMap-Open-Road — OSM-driven driving simulator](https://github.com/Dreitser/OpenStreetMap-Open-Road)
- [OSM-based 3D road network (Unity)](https://github.com/ShamnadAS/OSM-based-3D-road-network-Unity-)
- [ECS for browser games — Web Game Dev](https://www.webgamedev.com/code-architecture/ecs)
- [Wanted Level in GTA V — dispatch tiers, line of sight, decay](https://gta.fandom.com/wiki/Wanted_Level_in_GTA_V)
- [Racing checkpoints & lap completion patterns — Unity Discussions](https://discussions.unity.com/t/racing-checkpoints-and-lap-completions/552239)

**Reference implementations / LOW-MEDIUM confidence**
- [yomotsu/camera-controls — SmoothDamp-based camera controls](https://github.com/yomotsu/camera-controls)
- [Smooth chase camera discussion — three.js forum](https://discourse.threejs.org/t/solved-smooth-chase-camera-for-an-object/3216)
- [three.quarks — particle/VFX engine for three.js](https://github.com/Alchemist0823/three.quarks)
- [three-geo — geographic visualization for three.js](https://github.com/cuulee/three-geo)
- [Rapier dynamic raycast vehicle controller sketch — Isaac Mason](https://sketches.isaacmason.com/sketch/rapier/dynamic-raycast-vehicle-controller)
- [100 Three.js performance tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)

---
*Architecture research for: browser-based 3D multi-mode driving/chase game (Three.js + Rapier + TypeScript)*
*Researched: 2026-09-07*
