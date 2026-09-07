# Project Research Summary

**Project:** Heat Street
**Domain:** Browser-based 3D arcade driving / police-pursuit / time-attack hybrid (Three.js + Rapier WASM, TypeScript/Vite, solo dev via Claude Code, no visual editor)
**Researched:** 2026-09-07
**Confidence:** MEDIUM-HIGH

## Executive Summary

Heat Street is an arcade driving/chase game in the Bullitt/French Connection/NFS-Most-Wanted tradition, built as a code-only Three.js + Rapier project with no visual editor and no 3D modelling experience. The research is unusually convergent across all four files on one point: **Rapier ships a production-ready raycast vehicle controller (`DynamicRayCastVehicleController`) that must be used as-is, not reimplemented**, and it exposes exactly the per-wheel telemetry (ground collider, friction slip, side stiffness, slip impulse, contact state) that the surface-grip, drift, and damage requirements need. The recommended stack is deliberately narrow and boring by choice: vanilla Three.js/TypeScript classes (no ECS, no React), non-compat Rapier with Vite's native WASM ESM support, `THREE.PositionalAudio` over Howler, meshopt over Draco, and a DOM+2D-canvas HUD rather than in-canvas 3D UI — all judgement calls reasoned from this project's specific constraints (solo dev, AI-agent workflow, helicopter camera, low-poly art direction) rather than generic best practice.

The recommended approach is architecturally unified around two ideas: "one car, many drivers" (player and every AI pursuer/racer drive the identical `VehicleActor` through a normalized `DriveInput` struct — no spline-cheating AI, ever) and "the road graph is the single source of truth" (an offline map-compiler turns the player's Google-Maps-derived extraction into one graph that feeds collision geometry, AI navigation, and checkpoint placement, so the three can never silently disagree). Feature research converges on a lean, opinionated MVP: one area, three modes (Point-to-Point, Circuit, Getaway heat-tiers-1-3), one car, medals that work — explicitly deferring Survival, ghost playback, additional cars, and heat tiers 4-5 to v1.x, and permanently rejecting car customization, rubber-band AI, rewind, and global leaderboards as scope traps that would each independently kill the medal-time core value.

The biggest risks are legal, physical, and process, not technical-in-the-narrow-sense. **Legally**, the player's existing Google Maps extraction pipeline cannot ship — Google's terms explicitly prohibit tracing roadways/buildings and building terrain from their APIs — and must be re-pointed at OpenStreetMap + an open DEM before any map is authored. **Physically**, the signature helicopter camera actively fights the core value ("driving must feel weighty and cinematic") by flattening the optical-flow cues that convey speed, and must be prototyped alongside the vehicle in the same phase, not bolted on after. **In process**, vehicle handling is a ~15-dimensional tuning problem that an AI agent cannot feel — this demands a dedicated tuning harness (hot-reloaded JSON config, live debug GUI, a scripted telemetry test track with numeric acceptance targets) as a first-class P1 deliverable, and every "feel" phase needs a mandatory human playtest gate that automated verification cannot substitute for. Architecture research independently flags the same two things (map pipeline, vehicle tuning) as the phases most likely to need dedicated research spikes during planning.

## Key Findings

### Recommended Stack

Core stack: **three@0.185.1** (WebGLRenderer, not WebGPU — the "WebGPU is now default" claim circulating online is false per the official migration guide, and WebGL's soft shadows/mature ecosystem/training-data depth all favor it here), **@dimforge/rapier3d@0.20.0** (non-compat variant, native WASM ESM via `vite.config` `target: 'esnext'`, never the bundled `RapierPhysics.js` demo glue which hardcodes a 3-versions-stale CDN fetch), **typescript@7.0.2**, **vite@8.2.2**. Rapier's built-in `DynamicRayCastVehicleController` is the single most load-bearing technology decision in the project — it removes what would otherwise be a multi-week hand-built-raycast-vehicle detour and directly serves surface grip, oversteer, jump telemetry, tire-smoke triggers, and speedo requirements from the PROJECT.md spec.

**Core technologies:**
- **three@0.185.1** — rendering, glTF loading, spatial audio, camera — largest 3D-web training corpus and ships an official Rapier-vehicle reference example
- **@dimforge/rapier3d@0.20.0 (non-compat)** — physics + built-in vehicle controller — removes the project's largest technical risk; non-compat avoids inflating the JS bundle with base64 WASM
- **Meshopt (not Draco)** for glTF compression — pure-JS module bundled with three, zero manual decoder-copy step that Draco/KTX2 require
- **THREE.PositionalAudio + raw Web Audio** (not Howler) — scene-graph attachment is architecturally correct for the permanent helicopter camera's spatialized sirens; Howler is 3 years stale
- **ngraph.path on a road-graph** (not a navmesh) — cars are road-constrained, and the map pipeline already produces graph topology
- **Plain TS classes, hand-rolled fixed-timestep loop, hand-rolled FSM** — no ECS, no React/R3F, no xstate — right-sized for ~2-20 entities and easier for Claude-Code iteration
- **lil-gui + a scripted telemetry test track** — not optional polish; the mechanism that makes vehicle tuning possible without an editor

Full detail: `.planning/research/STACK.md`

### Expected Features

Genre convention is well triangulated (NFS Most Wanted, Trackmania/PolyTrack, Midnight Club, Forza, Burnout Paradise-as-cautionary-tale). The floor is speed readout + live timer + minimap + checkpoint navigation + instant restart; chase modes additionally require a legible heat/pursuit HUD (NFS MW's pursuit bar is the explicit reference implementation). The highest-leverage differentiator is a 4th medal tier above gold ("Ace," Trackmania's Author-Time pattern) — it costs one number and one icon and is what sustains long-term replay after gold is achieved.

**Must have (table stakes):**
- Speed readout, live run timer, minimap with route/checkpoints, directional objective indicator
- Instant restart (<300ms, single key) — the load-bearing feature of the entire time-attack loop
- Reset-to-road/respawn, persistent best times, medal thresholds shown before/during run
- Surface-appropriate audio/visual feedback, RPM-tied engine audio
- Pursuer count + heat tier indicator, visible damage state, sirens with directional audio (chase modes)

**Should have (competitive):**
- 4th medal tier above gold ("Ace") — highest leverage-per-effort item in the whole feature set
- PB ghost playback, live split delta vs. target/PB, post-run sector breakdown with worst-sector flagged
- Signature helicopter camera with contextual reskin + news/police broadcast HUD framing (delivers the narrative requirement near-free)
- One new legible mechanic per heat tier (not just a stat bump), pursuit breakers, hiding spots, helicopter-LOS tunnel counter-play

**Defer (v2+):**
- Car customization/tuning trees — explicitly destroys medal-time comparability, reject permanently for v1
- Rubber-band AI, rewind/time-scrub — both structurally incompatible with medal-time integrity, reject permanently
- Global online leaderboards, free roam, component-level damage sim, full traffic sim, multiple cameras — all deferred or rejected; each multiplies scope without serving the core value

Full detail including deep dives on heat-system design, minimal HUD, medal psychology, and checkpoint UX pitfalls: `.planning/research/FEATURES.md`

### Architecture Approach

The architecture is a five-layer stack (Presentation -> Game Rules -> Simulation -> Physics -> World Data) held together by two contracts: every controllable vehicle — player or AI — is a `VehicleActor` driven by a normalized `DriveInput` struct, and all four game modes are the *same* systems wired by a small `ModeDefinition` JSON + thin `ModeRules` hooks rather than four parallel "GameClass" implementations. An offline `tools/map-compiler` (never bundled to the browser) turns the Google-Maps/OSM extraction into a versioned `.glb` + `.map.json` whose road graph is the single source that collision geometry, the AI nav graph, and checkpoint/route placement all derive from.

**Major components:**
1. **`FixedStepScheduler` + `PhysicsWorld`** — accumulator-driven 60Hz sim tick with render-only interpolation via `alpha`; the foundation every other system assumes
2. **`VehicleActor` / `VehicleSystem` / `DriveInput`** — the "one car, many drivers" contract; player and AI are indistinguishable to physics
3. **`SurfaceSystem`** — per-wheel-per-tick lookup from `wheelGroundObject()` -> `SurfaceProfile` -> `setWheelFrictionSlip()`; critically, grip comes from wheel params, not collider friction
4. **`AIDriver` (layered: tactics -> A* path plan -> pure pursuit follow -> reactive avoidance/recovery)** — only the top "tactics" layer differs between racers and pursuers
5. **`ModeDirector` + `ModeDefinition`** — the four modes collapse to ~40-90 LOC rules classes each, config-driven
6. **`HelicopterRig`** — damped follow camera aimed at velocity heading (not chassis yaw), updated from interpolated transforms only, with a swappable presentation-only `CameraSkin`
7. **`map-compiler`** (offline, Node) — ingest -> project to local metric ENU -> topology (road graph) -> geometry (ribbons + junction polygons) -> surfaces -> collision -> routes -> emit

Suggested build order front-loads the two biggest risks: core loop (P0) -> vehicle feel on a flat plane (P1, "core value or the project has no reason to exist") -> surface system -> helicopter camera -> map compiler -> objectives/two modes with no AI -> AI stack + Circuit -> Getaway (heat) -> Survival -> meta/polish.

Full detail including data-flow diagrams, anti-patterns, and scaling guidance: `.planning/research/ARCHITECTURE.md`

### Critical Pitfalls

1. **Google Maps data cannot legally ship** — the extraction tool's current data source violates Google's ToS (no tracing roads/buildings, no terrain from Elevation API, no scraping). Must re-point to OpenStreetMap (ODbL, attribution-only) + open DEM *before* any map is authored — this is a P0 decision, not a launch-day cleanup.
2. **The helicopter camera fights the core value.** A permanent high-angle camera flattens the optical-flow and FOV cues that convey speed — the exact mechanism the Core Value depends on. Must be prototyped in the same phase as the vehicle, with an explicit go/no-go acceptance test ("does 100mph read as fast from this camera?"), and a low chase-camera fallback kept alive as insurance.
3. **Blind vehicle tuning with an AI agent that cannot feel the car.** ~15-dimensional parameter space, no visual editor, easy to end up worse after weeks of ad-hoc changes. Requires a first-class tuning harness (hot-reloaded JSON, live debug GUI, scripted telemetry test track with numeric acceptance targets) *before* tuning begins.
4. **Rapier controller assumptions that break silently.** Ground-collider friction does nothing to grip (must use per-wheel `frictionSlip`/`sideFrictionStiffness`); there's no documented roll-influence parameter, so cars will flip in hard corners unless a manual anti-roll torque + low CoM is engineered deliberately.
5. **Variable-timestep physics invalidates the entire medal system.** Non-fixed `world.step()` per rAF makes lap times framerate-dependent — directly poisons the bronze/silver/gold/Ace progression that is the game's stated long-term value. Must be fixed-timestep-with-accumulator from P0, non-negotiable, expensive to retrofit.
6. **OSM road data is a 2D tagged line network, not drivable 3D geometry** — no elevation, no junction shape, ambiguous bridge/tunnel ordering, arbitrary way-splitting. Requires a real map-compiler stage (graph welding, junction polygon generation, terrain-under-road flattening) plus a hand-editing/validation pass, not a naive extrude-and-drape.
7. **Four modes built "in parallel because they share a core" is the most likely path to project failure.** Ship one full vertical slice (Point-to-Point + medals, zero AI) before starting mode #2; order remaining modes by shared-system dependency (racing AI -> Circuit -> heat -> Getaway -> Survival last, since it needs everything).

Full detail including 12 pitfalls, technical-debt table, performance traps, and a "looks done but isn't" checklist: `.planning/research/PITFALLS.md`

## Implications for Roadmap

Based on combined research (architecture's suggested build order and pitfalls' phase mapping are already closely aligned — both independently converge on the same ordering), suggested phase structure:

### Phase 1: Engine Foundation
**Rationale:** Fixed-timestep physics loop must exist before anything else is built on top of it — retrofitting variable-to-fixed timestep later requires re-tuning all physics and invalidating any recorded medal times (Pitfall 5).
**Delivers:** `FixedStepScheduler` (accumulator + alpha interpolation), `PhysicsWorld` wrapper over Rapier, Three.js renderer + debug scene, a profiler HUD with a hard frame-budget target set from day one.
**Avoids:** Pitfall 5 (variable timestep), sets up the budget referenced in Pitfall 9 (NPC frame cost).
**Also decides:** map-data-source decision (OSM, not Google Maps — Pitfall 1) and the road-graph schema, even though implementation happens later.

### Phase 2: Vehicle Feel Core
**Rationale:** "The entire product is downstream of this" (Architecture). Cheapest to iterate on flat ground, before any map or AI exists, and the single highest-risk unknown in the stack (community reports of the arcade-drift tuning tension between grip and controllability).
**Delivers:** `VehicleActor` wrapping `DynamicRayCastVehicleController`, `PlayerDriver`, data-driven `VehicleTuning` JSON, a hot-reloaded debug GUI (lil-gui), and a scripted telemetry test track (0-60, braking, skidpad, slalom, ramp) with numeric acceptance targets for a "weighty muscle car" feel.
**Addresses:** Core Value ("weighty, cinematic, controllable oversteer") from PROJECT.md; table-stakes speed feedback.
**Avoids:** Pitfall 3 (blind tuning), Pitfall 4 (roll-influence/friction assumptions), Pitfall 8 (jump/landing physics explosions).
**Human gate required:** playtest sign-off, not just passing telemetry (Pitfall 12).

### Phase 3: Surface System + Helicopter Camera
**Rationale:** Both depend only on Phase 2's car, both need to be proven before the map pipeline exists (surface on a flat test patch; camera reveals what the map needs to look like at framing distance).
**Delivers:** `SurfaceSystem` (per-wheel friction from `wheelGroundObject()`), `HelicopterRig` with one camera skin, speed-bound altitude/FOV compensation for sense-of-speed.
**Addresses:** Surface grip requirement, signature camera identity requirement.
**Avoids:** Pitfall 2 (camera killing sense of speed) — explicit go/no-go gate here; Pitfall 4's surface half.

### Phase 4: Map Pipeline
**Rationale:** Biggest unknown in the project (Architecture + Pitfalls both flag it for deep research). Needs Phase 3's surface system already proven and the camera's framing distance already known, to inform LOD/detail decisions.
**Delivers:** `tools/map-compiler` (OSM ingest -> project -> topology -> geometry/junctions -> surfaces -> collision -> routes -> emit), one small hand-trimmed real map with a road graph.
**Avoids:** Pitfall 1 (legal), Pitfall 6 (OSM-isn't-drivable-geometry), Pitfall 7 (ghost collisions on trimesh seams).

### Phase 5: Objectives + First Two Modes (Point-to-Point, Circuit-no-AI)
**Rationale:** Proves the config-over-code `ModeDefinition` approach with two modes at once, cheaply, before AI exists. Ships a full vertical slice.
**Delivers:** `ObjectiveSystem` (swept checkpoint detection), `ModeDirector`, two-layer navigation (beacon + road-aware arrow) + minimap, medal system (bronze/silver/gold/Ace from reference-run percentage bands), instant restart, persistent best times, live split delta + post-run sector table.
**Addresses:** Point-to-Point and Circuit(no AI racers) requirements, medal system requirement.
**Avoids:** Pitfall 11 (four-modes-in-parallel) — this phase is explicitly the "ship one full vertical slice before mode #2" checkpoint.

### Phase 6: NPC Driving AI
**Rationale:** Second-largest unknown after the map pipeline (flagged for deep research by both Architecture and Pitfalls). Needs a real map and a proven vehicle to develop against.
**Delivers:** Layered `AIDriver` (tactics -> A* plan -> pure pursuit -> reactive avoidance/recovery), debug overlay for AI paths/targets, `RacerTactics` -> Circuit gains AI racers.
**Avoids:** Pitfall 10 (oscillating/rubber-banding AI) — explicitly bans direct velocity/transform writes and speed-multiplier catch-up.

### Phase 7: Getaway Mode (Heat System)
**Rationale:** Pure reuse of Phase 6's AI stack — swaps tactics + config, adds no new vehicle or camera work. Ship heat tiers 1-3 only (cruiser -> pair+PIT -> roadblocks); defer tiers 4-5.
**Delivers:** `HeatSystem` (active/cooldown/clear state machine), `SpawnDirector` + dispatch table, `PursuerTactics`, heat HUD (unit count, backup ETA, bust-risk meter).
**Addresses:** Getaway mode requirement.

### Phase 8: Damage/Destruction + Survival Mode
**Rationale:** Reuses all of Getaway; only failure conditions and a continuous (not tiered) escalation curve differ. Survival is explicitly the *last* mode — it needs everything else to already work.
**Delivers:** `DamageSystem` + destruction end-state, continuous escalation curve, bounded-memory long-session handling.
**Addresses:** Survival mode requirement, damage requirement.

### Phase 9: Meta, Progression, Polish
**Rationale:** Touches no simulation code if system boundaries held in earlier phases — genuinely low-risk if the architecture worked.
**Delivers:** Area unlock progression, radio chatter/mission briefs over the event bus, audio polish, VFX polish, ghost playback (v1.x-flagged in Features research but can land here if time allows).

### Phase Ordering Rationale

- **Dependency-driven, front-loading the two biggest risks** (vehicle feel, map pipeline) — both Architecture's "Suggested Build Order" and Pitfalls' "Pitfall-to-Phase Mapping" independently arrive at the same sequence, which is a strong cross-validation signal.
- **Medal system requires stable vehicle physics** — do not author medal reference times until handling is locked (Features research, Dependency Notes); Phase 5 comes after Phase 2/3, not before.
- **Navigation, roadblocks, and respawn all require the road graph** — Phase 4 (map pipeline) must precede Phase 5 (objectives) and Phase 6 (AI), both of which consume it.
- **Getaway and Survival share ~90% of a system** — sequence adjacently, Getaway first, because a win condition is easier to tune than an endless curve (Features research).
- **This ordering is itself the primary mitigation for Pitfall 11** (four-mode scope creep) — enforcing "one full vertical slice before mode #2" at the Phase 5 gate.

### Research Flags

Phases likely needing deeper research during planning (`/gsd-plan-phase --research-phase <N>`):
- **Phase 2 (Vehicle Feel Core):** arcade<->sim handling benchmarking is an explicit open question in PROJECT.md; Rapier roll-influence/anti-roll behavior is undocumented and needs empirical verification against the installed version's `.d.ts`.
- **Phase 4 (Map Pipeline):** flagged by both Architecture and Pitfalls research as the single largest unknown — junction geometry generation, extractor-format handoff, OSM tag resolution (bridge/tunnel/layer) have no off-the-shelf solution.
- **Phase 6 (NPC Driving AI):** flagged as the second-largest unknown — pure-pursuit tuning against a heavy oversteering car with steering lag, recovery-from-stuck behaviors, and avoiding rubber-banding all need dedicated design work.

Phases with standard/well-documented patterns (research-phase likely skippable):
- **Phase 1 (Engine Foundation):** fixed-timestep-accumulator is a well-established, thoroughly documented pattern (Gaffer On Games canonical reference).
- **Phase 5 (Objectives + first modes):** checkpoint/medal/HUD patterns are well triangulated across multiple shipped genre references (NFS MW, Trackmania, Midnight Club, Forza).
- **Phase 7 (Getaway/Heat):** NFS Most Wanted's pursuit system is explicitly documented as the reference implementation to adopt near-wholesale.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH for core stack/vehicle physics (verified against shipped `.d.ts` files and official docs); MEDIUM for renderer/audio architecture judgement calls | Multiple facts read directly from `npm pack`'d packages, not training data |
| Features | MEDIUM-HIGH | No single authoritative "racing game spec" exists; triangulated across game wikis, design writeups, and player-reception sources, but consistent and convergent |
| Architecture | MEDIUM-HIGH | Rapier/Three.js API facts are HIGH (official docs); multi-mode structuring and AI layering are MEDIUM (synthesized from racing-AI literature and general practice, not a documented industry standard for this exact genre) |
| Pitfalls | MEDIUM-HIGH | Rapier behavior, OSM/Google licensing, ghost collisions, and determinism are HIGH (verified against official docs); game-feel and AI-design pitfalls are MEDIUM (community/practitioner consensus) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Whether Rapier's raycast vehicle can hit the "arcade-realistic hybrid" target feel at all.** Community reports consistently describe a tension between drift-enabling low friction and on-rails high friction. The mitigation (arcade-assist layering: yaw torque + downforce + lateral counter-force on top of the physical chassis) is the standard approach but is unverified for this specific controller — flagged as the single highest-risk item in the stack; should be a spike inside Phase 2, not an assumption carried forward.
- **Rapier trimesh/collider performance at real city-map scale.** No benchmarks found for Google/OSM-derived city-scale trimesh colliders; chunking is the known mitigation but the actual threshold is unmeasured — resolve empirically during Phase 4.
- **Surface-type-to-collider tagging mechanism** (user data vs. handle map vs. collision groups) — three viable options identified, no clear winner; a Phase 3 implementation decision, not a research gap that blocks planning.
- **Damage/deformation model** — Rapier has no built-in deformation; the likely approach (swap damaged mesh LODs + degrade vehicle-controller tuning parameters) is reasoned but not researched in depth — resolve during Phase 8 planning.
- **Numeric tuning starting points throughout** (heat-tier timing, medal percentage bands, restart-time targets, telemetry acceptance thresholds) are derived starting points, not sourced values, and must be validated by playtesting at each relevant phase.
- **Whether the extractor tool's output already includes usable road-graph topology**, or whether that has to be built from scratch in the map-compiler — an open question that determines Phase 4's actual scope; flagged in Architecture research as a "define and freeze the intermediate schema immediately" integration point.

## Sources

### Primary (HIGH confidence)
- `@dimforge/rapier3d-compat@0.20.0` / `@dimforge/rapier3d@0.20.0` — read directly via `npm pack` (`.d.ts` files, `README.md`, `package.json`)
- `three@0.185.1` — read directly via `npm pack` (exports map, `RapierPhysics.js` source, addons libs)
- Official Rapier JS API docs (rapier.rs/javascript3d) — `DynamicRayCastVehicleController`, colliders, determinism, mass properties
- Official three.js Migration Guide (r180-r186) and official Rapier vehicle example (threejs.org/examples/physics_rapier_vehicle_controller.html)
- Google Maps Platform Terms + Map Tiles API Policies; OSMF Licence & Legal FAQ — map data licensing determination
- Vite WebAssembly ESM integration docs
- npm registry / GitHub REST API — version and maintenance-activity facts (Howler staleness, current package versions)

### Secondary (MEDIUM confidence)
- Need for Speed: Most Wanted pursuit-system documentation (Wikibooks, NFS Wiki) — heat/pursuit HUD reference implementation
- Trackmania Wiki + official docs — medal-tier structure, difficulty-ladder gating pattern
- Game AI Pro Ch. 38 (racing AI architecture), MathWorks Pure Pursuit Controller docs, adaptive-lookahead autonomous-racing papers
- OSM-to-game pipeline references (KTH thesis, OpenTwinMap, multiple Unity/UE implementations) — junction/road-geometry generation patterns
- Midnight Club designer diary, Forza Horizon navigation support docs, Burnout Paradise post-mortems — checkpoint/navigation UX patterns
- Indie scope-creep survey data (wayline.io) — anti-feature/MVP prioritization rationale

### Tertiary (LOW confidence)
- pmndrs racing-game GitHub issue (double-render minimap cost) — single issue thread
- Community forum/anecdotal reports on raycast-vehicle arcade-drift tuning tension — consistent across sources but not authoritative, hence treated as a flagged spike rather than settled fact
- PolyTrack marketing/aggregator pages — feature corroboration only, not a primary design source

---
*Research completed: 2026-09-07*
*Ready for roadmap: yes*
