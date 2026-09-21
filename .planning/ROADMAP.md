# Roadmap: Heat Street

## Overview

Heat Street gets built from the tire contact patch outward. The fixed-timestep loop lands first because every medal time in the game is downstream of it and retrofitting it later invalidates all of them. Then the car itself — on a flat plane, with a tuning harness, because "weighty, cinematic, controllable oversteer" is the whole reason the project exists and it is cheapest to iterate on before any map or AI exists. Surfaces and the signature helicopter camera come next, together, because both only need a car and the camera carries a real risk of flattening the sense of speed the core value depends on — it gets an explicit go/no-go gate while a fallback chase cam is still cheap to keep. Only then the map pipeline (the largest unknown, and the source of the road graph that objectives, navigation and AI all consume), followed by the full time-attack vertical slice: checkpoints, navigation, instant restart, then medals and persistence. AI arrives once there is a real map and a proven car to drive it, unlocking Circuit racers. The chase pillar lands last as near-pure reuse: heat, pursuers, damage and dispatch chatter on top of systems that already work.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Engine Foundation** - Fixed-timestep loop, Rapier/Three.js wiring, profiler HUD, frozen map-data decision (completed 2026-09-08)
- [x] **Phase 2: Vehicle Feel Core** - One muscle car on a flat plane that feels weighty, plus the tuning harness to get it there (completed 2026-09-11)
- [x] **Phase 3: Surfaces & Helicopter Camera** - Per-wheel surface grip with A/V feedback, and the signature high-angle camera proven to convey speed (completed 2026-09-13)
- [x] **Phase 4: Map Pipeline & First Area** - Offline OSM map-compiler producing one drivable area with a road graph (completed 2026-09-15)
- [ ] **Phase 4.1: Flatten Terrain / Remove DEM Elevation** (INSERTED) - Replace real-world DEM elevation with hand-authored flat/near-flat terrain, eliminating oversized road-shoulder skirts; supersedes part of ADR 0001
- [ ] **Phase 5: Objectives, Navigation & Race Modes** - Checkpoints, two-layer navigation, respawn, instant restart, Point-to-Point and Circuit (no AI)
- [ ] **Phase 6: Medals & Time-Attack Loop** - Four-tier medals, persistent bests, live splits, post-run sector breakdown
- [ ] **Phase 7: NPC Driving AI & Circuit Racers** - Layered AI driving the same physics car, no rubber-banding, racers in Circuit
- [ ] **Phase 8: Getaway - Heat, Damage & Dispatch** - Pursuit heat system tiers 1-3, damage/destruction, radio chatter and mission briefs

## Phase Details

### Phase 1: Engine Foundation

**Goal**: The simulation runs on a timing foundation that makes every future run time trustworthy and framerate-independent
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: VEH-03
**Success Criteria** (what must be TRUE):

  1. The same recorded input produces the same elapsed time and the same end state at 30fps, 60fps and 144fps
  2. A physics object in the debug scene renders smoothly at any refresh rate (interpolated from the fixed tick, no judder)
  3. Alt-tabbing away for 60 seconds and returning does not teleport, explode, or fast-forward the simulation
  4. A profiler HUD toggled by a single key shows physics ms, draw calls, triangles and body count against a written frame budget
  5. The map-data decision (OpenStreetMap + open DEM, zero Google-sourced bytes) and the road-graph schema are recorded in the repo before any map work starts

**Plans**: 7 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Repo scaffold, exact-pinned install, Vite/Vitest configs, Rapier WASM proven in Node and browser (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Pure sim core: absolute-clock SimClock, per-tick InputTape, mirrored frame budget (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Map-data ADR, road-graph v1 schema + fixture, Google-pipeline supersession and grep gate (wave 3)
- [x] 01-04-PLAN.md — Rapier world, debug scene with never-sleeping spinner, transform cache, VEH-03 determinism harness (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-05-PLAN.md — WebGL renderer, interpolator, Three.js debug scene index-aligned with physics bodies (wave 4)
- [x] 01-06-PLAN.md — ?debug gate, single-key toggle, profiler HUD checked against the written budget (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-07-PLAN.md — rAF loop with clamp + rebaseline, composition root, layering gate, human SC2/SC3/SC4 sign-off (wave 5)

### Phase 2: Vehicle Feel Core

**Goal**: The player can drive one muscle car that feels heavy, momentum-driven and slideable — the core value, provable on a flat plane
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: VEH-01, VEH-02, VEH-04, NAV-01
**Success Criteria** (what must be TRUE):

  1. Player can provoke oversteer with throttle or handbrake and catch it with counter-steer — the slide is readable and recoverable, and late braking has visible consequences
  2. Player steers smoothly on both keyboard and gamepad (keyboard is ramped, not binary; gamepad is analog)
  3. Player can hit a ramp at 120mph and land driveable, and can take a full-lock 60mph turn without the car rolling or the physics exploding
  4. Player sees a live speedometer (needle + digital readout) that tracks actual vehicle speed
  5. Handling can be retuned live in an in-browser panel and re-verified against a scripted telemetry track (0-60, braking, skidpad, slalom, ramp) with no code edit — and a human playtest signs off that the car reads as a heavy muscle car

**Plans**: 10 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Vehicle tuning contract: VehicleTuning shape, measured Config A/B defaults, range table, hostile-blob parser (wave 1)
- [x] 02-02-PLAN.md — Live input layer: latched keyboard, polled gamepad, DT-driven analog steering ramp (wave 1)
- [x] 02-03-PLAN.md — New src/hud/ tier and the retro analog SVG speedometer, pure maths plus DOM half (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-04-PLAN.md — Vehicle factory over Rapier's raycast controller plus the four clamped arcade assists (wave 2)
- [x] 02-05-PLAN.md — onDebugKey with a text-entry focus guard, and layering rules for src/input and src/hud (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-06-PLAN.md — Vehicle scene with a drivable ramp, plus chassis and wheel meshes with the wheel rig (wave 3)
- [x] 02-07-PLAN.md — Telemetry harness, six scripted routines and the CI regression suite (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-08-PLAN.md — Composition root: driveable slice on screen with live input and gauge, plus browser checkpoint (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-09-PLAN.md — lil-gui tuning panel with persistence and the in-browser telemetry panel (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 02-10-PLAN.md — Feel session, SC1/SC2/SC5 human sign-off, tuned defaults committed and re-verified (wave 6)

### Phase 3: Surfaces & Helicopter Camera

**Goal**: The world under the tires changes how the car drives, and the game is viewed through its signature camera without losing the sense of speed
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SURF-01, SURF-02, CAM-01, CAM-02, CAM-03, CAM-04
**Success Criteria** (what must be TRUE):

  1. Driving from tarmac onto gravel, grass, mud, sand or dirt produces a distinct and measurable grip change (skidpad lateral-G differs per surface), driven by per-wheel friction rather than collider friction
  2. Each surface produces its own visual (tire smoke / dust plume / mud spray / skid decal) and audio (chirp vs. muffled rumble) feedback
  3. Player views the game through a permanent high-angle helicopter camera that tracks velocity heading and stays stable through a full 40-degree drift
  4. Camera altitude and FOV shift with speed such that a human playtester can tell 60mph from 110mph on sight (explicit go/no-go gate; a low chase-cam fallback remains selectable)
  5. The camera skin can be switched between police/news and sports-broadcast presentations, changing presentation only — never distance, damping or targeting
  6. Buildings between the camera and car never permanently hide the car or the road ahead — both candidate mitigations (fade occluding buildings to translucent; dynamically steepen toward near-overhead in dense areas, relaxing in open areas) are prototyped, and the one that reads best in a human playtest is kept. Not a paper decision

**Plans**: 12 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — LF normalisation, tuning-utils extraction, surface name contract and SurfaceProfiles (wave 1)
- [x] 03-02-PLAN.md — Camera pure maths: velocity-heading blend, speed framing curve, occlusion classification (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-03-PLAN.md — SurfaceMap side-table and per-wheel surface grip applied inside the fixed tick (wave 2)
- [x] 03-04-PLAN.md — CameraTuning contract, helicopter rig, D-12 chase fallback, and both presentation skins (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-05-PLAN.md — Six-band surface test scene with two building clusters, plus its matching visuals (wave 3)
- [x] 03-06-PLAN.md — Per-surface skidpad sweep, the collider-friction control, and the stability re-verification (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-07-PLAN.md — Composition root on the surface scene and helicopter camera, plus live surface/camera tuning (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03-08-PLAN.md — SC3/SC4 human playtest and the camera go/no-go decision, recorded as an ADR (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03-09-PLAN.md — Occlusion probe and both CAM-04 mitigations behind a debug A/B toggle (wave 6)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 03-10-PLAN.md — Per-surface particle FX and skid decals, and a revised frame budget (wave 7)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 03-11-PLAN.md — First audio system: gesture-gated listener and six crossfaded per-surface channels (wave 8)

**Wave 9** *(blocked on Wave 8 completion)*

- [ ] 03-12-PLAN.md — Full-phase feel session, SC6 occlusion decision, and tuned defaults committed (wave 9)

### Phase 4: Map Pipeline & First Area

**Goal**: One real-world-derived area is drivable end to end, built by a repeatable offline compiler whose road graph is the single source of truth
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: None directly — enabling infrastructure for NAV-03/04/05/06, P2P-01, CIRC-01/02, GET-01/03
**Success Criteria** (what must be TRUE):

  1. Player can drive every road in the area end to end without hitting invisible seams, floating road edges, bumpy junctions, or getting wedged at intersections
  2. Surface types carry through from source data, so dirt and tarmac sections already drive differently with no hand-tagging
  3. The whole area rebuilds from source with one command, emitting a versioned `.glb` + `.map.json` where collision geometry, nav graph and route/checkpoint placement all derive from the same road graph
  4. No Google-sourced data exists anywhere in the shipped pipeline, and "Map data (c) OpenStreetMap contributors" appears in the credits
  5. A map validator confirms every road is reachable and pathable end to end, and reports failures loudly rather than silently

**Plans**: 11 plans

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Compiler tooling seam (tsconfig, grep gate, pinned deps, CLI), RoadGraph contract and parser, OSM surface mapping (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — Overpass ingestion with Geomesh-ported queries, retry and disk cache, plus the committed Juliette, GA snapshot (wave 2)
- [x] 04-03-PLAN.md — Shared road geometry: offset ribbons with clamped miters and angle-sorted junction fans, proven watertight (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-04-PLAN.md — Local ENU projection, graph topology, edge attribute resolution, and the first real .map.json (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04-05-PLAN.md — USGS 3DEP raster fetch and sampling, node-authoritative endpoint-clamped elevation smoothing (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 04-06-PLAN.md — Map validator: ngraph reachability and oneway pathability, geometry sanity, loud named build gate (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 04-07-PLAN.md — Package legitimacy gate, OSM building OBB prisms, glTF authoring and the .glb emit (wave 6)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 04-08-PLAN.md — Collision sidecar and MapScene: per-edge trimesh colliders with FIX_INTERNAL_EDGES, SurfaceMap, spawn (wave 7)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 04-09-PLAN.md — GLTFLoader map view, composition root on the compiled area, first-drive human checkpoint (wave 8)

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 04-10-PLAN.md — DEM off-road heightfield ground, OpenStreetMap attribution credit, revised frame budget (wave 9)

**Wave 10** *(blocked on Wave 9 completion)*

- [x] 04-11-PLAN.md — Drive-every-road SC1 sign-off session, tuning fixes with regression tests, and the phase ADR (wave 10)

### Phase 04.1: Flatten Terrain / Remove DEM Elevation (INSERTED)

**Goal:** The compiled area uses hand-authored, deterministic flat/near-flat terrain instead of real-world DEM elevation (USGS 3DEP / Copernicus), eliminating the wide road-shoulder skirts DEM forces (up to ~20m in places, via `src/core/shoulder-clearance.ts`'s `TARGET_SHOULDER_WIDTH_M`) — OpenStreetMap remains the source for road topology. Supersedes part of ADR 0001 (`docs/adr/0001-map-data-source.md`); requires a new/updated ADR, rewriting `tools/map-compiler/graph/elevation.ts`, re-deriving shoulder/grounding constants now that terrain is flat, and recompiling the reference map area (Juliette, GA). Should land before Phase 5 planning since Phase 5+ build on the compiled map.
**Requirements**: D-01, D-02, D-02a, D-02b, D-03, D-04, D-05, D-06, D-07, D-08 (CONTEXT.md decision IDs — no v1.0 REQUIREMENTS.md ID applies to this inserted maintenance/architecture phase)
**Depends on:** Phase 4
**Plans:** 9/11 plans executed

Plans:
- [x] 04.1-01-PLAN.md — Flat road elevation stage: applyFlatElevation replaces DEM sampling/smoothing/densification (wave 1)
- [x] 04.1-02-PLAN.md — Shoulder-width retune 20m to 6m with the flat-terrain grade arithmetic and regression tests (wave 1)
- [x] 04.1-03-PLAN.md — Authored off-road crest table and dome builder, plus the distance-to-paved-edge query (wave 1)
- [x] 04.1-04-PLAN.md — Off-road relief generator: seeded value noise capped at +/-2m, fading to zero at the paved edge (wave 2)
- [x] 04.1-05-PLAN.md — Building ground-seating decoupled from the DEM onto a local-ENU sampler (wave 1)
- [x] 04.1-06-PLAN.md — Elevation provenance: none-flat-authored demSource, accurate credits line, compiler version 0.6.0 (wave 1)
- [x] 04.1-07-PLAN.md — Authored crests into the compiled .glb and the runtime trimesh colliders (wave 2)
- [x] 04.1-08-PLAN.md — Compiler CLI rewired onto the flat stages; DEM module, cache and geotiff dependency deleted (wave 3)
- [x] 04.1-09-PLAN.md — Recompile Juliette, GA; invert the real-artifact suite to exact flatness; record the measurement baseline (wave 4)
- [ ] 04.1-10-PLAN.md — D-06 drive-every-road human sign-off session and any retunes it forces (wave 5, checkpoint)
- [ ] 04.1-11-PLAN.md — ADR 0001 amended in place; ADR 0004 decision 7 marked superseded (wave 6)

### Phase 5: Objectives, Navigation & Race Modes

**Goal**: The player can actually play — two race modes on the real map, always knowing where to go and never more than a keypress from another attempt
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: NAV-03, NAV-04, NAV-05, NAV-06, NAV-07, P2P-01, CIRC-01
**Success Criteria** (what must be TRUE):

  1. Player can complete a Point-to-Point level by hitting all checkpoints in any order via any route, and a checkpoint registers even when crossed at 150mph or mid-jump
  2. Player can complete a Circuit level as an ordered multi-lap loop, with lap count and wrong-way state clearly signalled
  3. Player always knows where to go: a world-space beacon visible over buildings, a road-aware arrow (nearest unvisited when unordered, next in sequence when ordered), and an always-on minimap showing every remaining checkpoint plus their own position
  4. Player can respawn at the last checkpoint on a dedicated key — upright, on the road, facing the right way, with a time penalty
  5. Player can restart the current level with one key press in well under a second, with no confirmation dialog and no loading screen

**Plans**: TBD
**UI hint**: yes

### Phase 6: Medals & Time-Attack Loop

**Goal**: Every route becomes worth re-running — times are graded, persisted, and failure is localized to a corner rather than a number
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: NAV-02, MEDAL-01, MEDAL-02, MEDAL-03, MEDAL-04
**Success Criteria** (what must be TRUE):

  1. Player sees a live run timer with Bronze/Silver/Gold/Ace thresholds visible before and during the run
  2. Player earns one of four medals at run end, with thresholds derived as fixed percentage bands off a recorded designer reference run (consistent across every level, re-recordable after handling changes)
  3. Player's best time per level survives a browser restart and is visible on a medal grid at level select
  4. Player sees a live split delta vs. personal best or target medal at each checkpoint during a run
  5. Player sees a post-run sector breakdown table with the worst sector highlighted

**Plans**: TBD
**UI hint**: yes

### Phase 7: NPC Driving AI & Circuit Racers

**Goal**: Other cars share the road and actually drive — same physics, same contact, no cheating
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: CIRC-02
**Success Criteria** (what must be TRUE):

  1. AI racers drive the identical physics vehicle the player does — they can be rammed, spun and can crash, and nothing writes their transforms directly
  2. AI racers complete a Circuit at a fixed, repeatable pace with no rubber-banding or speed-multiplier catch-up anywhere in the code
  3. AI cars that get stuck, flipped or wedged detect it and recover (or despawn off-screen) rather than idling forever
  4. AI steering shows no visible oscillation on straights or corner-cutting through scenery, verifiable via an AI debug overlay showing paths and targets
  5. Adding AI racers changes nothing about the player's medal time — the clock is still the opponent

**Plans**: TBD

### Phase 8: Getaway - Heat, Damage & Dispatch

**Goal**: The chase pillar lands — escapable pursuit with legible escalation, real consequences for taking hits, and the chase-movie framing that carries the story
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: GET-01, GET-02, GET-03, GET-04, DMG-01, DMG-02, NARR-01
**Success Criteria** (what must be TRUE):

  1. Player can complete a Getaway run by shaking pursuers and reaching an escape point
  2. Pursuit visibly moves through Active -> Cooldown/Search -> Clear, and heat only begins decaying once the player is both out of line of sight and outside the search radius; units path to last-known position rather than giving up on contact loss
  3. Heat tiers 1-3 each introduce a new, learnable pursuer behavior (single cruiser -> pair with PIT attempts -> roadblocks), each announced by radio chatter a few seconds before the units actually arrive
  4. Player reads pursuer count, current heat tier, backup ETA and a bust-risk meter that fills when boxed in, slow or surrounded — a single contact never instantly ends the run
  5. Vehicle damage shows in three readable states (pristine / damaged / critical) that visibly change appearance and measurably degrade performance, with destruction ending a Getaway run; mission briefs and dispatch chatter both route through one shared game-event bus

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 4.1 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Engine Foundation | 7/7 | Complete   | 2026-09-08 |
| 2. Vehicle Feel Core | 10/10 | Complete   | 2026-09-11 |
| 3. Surfaces & Helicopter Camera | 12/12 | Complete   | 2026-09-13 |
| 4. Map Pipeline & First Area | 11/11 | Complete   | 2026-09-15 |
| 4.1. Flatten Terrain / Remove DEM Elevation (INSERTED) | 9/11 | In Progress|  |
| 5. Objectives, Navigation & Race Modes | 3/4 | In Progress|  |
| 6. Medals & Time-Attack Loop | 4/5 | In Progress|  |
| 7. NPC Driving AI & Circuit Racers | 0/TBD | Not started | - |
| 8. Getaway - Heat, Damage & Dispatch | 0/TBD | Not started | - |

## Notes

**Research flags** (phases likely to need `/gsd-plan-phase --research-phase N`):

- Phase 2 — arcade<->sim handling benchmarking is an open question; Rapier roll-influence behavior is undocumented and needs empirical verification
- Phase 4 — largest unknown in the project: junction geometry generation, extractor-format handoff, OSM tag resolution (bridge/tunnel/layer)
- Phase 7 — second-largest unknown: pure-pursuit tuning against a heavy oversteering car, recovery-from-stuck behaviors

**Hard ordering constraints carried from research:**

- Fixed timestep exists before anything else (Phase 1) — retrofitting invalidates every recorded medal time
- Medal reference times are only authored after handling is locked (Phase 6 follows Phase 2/3, never before)
- Navigation, respawn and roadblocks all consume the road graph (Phase 4 precedes Phases 5, 7, 8)
- Helicopter camera is prototyped early (Phase 3) with a go/no-go gate, not treated as late polish
- One mode fully shippable — including medals, HUD and audio — before mode #2 gains AI (the Phase 5/6 gate)

**Deferred to v2** (tracked in REQUIREMENTS.md, deliberately not in this roadmap): Survival mode, Areas 2-3 and area-unlock progression, heat tiers 4-5, pursuit breakers and hiding spots, PB ghost playback, additional cars, ambient traffic, post-run replay, structural building destruction (WORLD-02 — needs its own research pass; destroyed state must reset per-run to protect medal-time integrity).
