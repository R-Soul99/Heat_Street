# Roadmap: Heat Street

## Overview

Heat Street gets built from the tire contact patch outward. The fixed-timestep loop lands first because every medal time in the game is downstream of it and retrofitting it later invalidates all of them. Then the car itself — on a flat plane, with a tuning harness, because "weighty, cinematic, controllable oversteer" is the whole reason the project exists and it is cheapest to iterate on before any map or AI exists. Surfaces and the signature helicopter camera come next, together, because both only need a car and the camera carries a real risk of flattening the sense of speed the core value depends on — it gets an explicit go/no-go gate while a fallback chase cam is still cheap to keep. Only then the map pipeline (the largest unknown, and the source of the road graph that objectives, navigation and AI all consume), followed by the full time-attack vertical slice: checkpoints, navigation, instant restart, then medals and persistence. AI arrives once there is a real map and a proven car to drive it, unlocking Circuit racers. The chase pillar lands last as near-pure reuse: heat, pursuers, damage and dispatch chatter on top of systems that already work.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Engine Foundation** - Fixed-timestep loop, Rapier/Three.js wiring, profiler HUD, frozen map-data decision
- [ ] **Phase 2: Vehicle Feel Core** - One muscle car on a flat plane that feels weighty, plus the tuning harness to get it there
- [ ] **Phase 3: Surfaces & Helicopter Camera** - Per-wheel surface grip with A/V feedback, and the signature high-angle camera proven to convey speed
- [ ] **Phase 4: Map Pipeline & First Area** - Offline OSM map-compiler producing one drivable area with a road graph
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
- [ ] 01-04-PLAN.md — Rapier world, debug scene with never-sleeping spinner, transform cache, VEH-03 determinism harness (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-05-PLAN.md — WebGL renderer, interpolator, Three.js debug scene index-aligned with physics bodies (wave 4)
- [ ] 01-06-PLAN.md — ?debug gate, single-key toggle, profiler HUD checked against the written budget (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 01-07-PLAN.md — rAF loop with clamp + rebaseline, composition root, layering gate, human SC2/SC3/SC4 sign-off (wave 5)

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

**Plans**: TBD
**UI hint**: yes

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

**Plans**: TBD

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

**Plans**: TBD

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
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Engine Foundation | 3/7 | In Progress|  |
| 2. Vehicle Feel Core | 0/TBD | Not started | - |
| 3. Surfaces & Helicopter Camera | 0/TBD | Not started | - |
| 4. Map Pipeline & First Area | 0/TBD | Not started | - |
| 5. Objectives, Navigation & Race Modes | 0/TBD | Not started | - |
| 6. Medals & Time-Attack Loop | 0/TBD | Not started | - |
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
