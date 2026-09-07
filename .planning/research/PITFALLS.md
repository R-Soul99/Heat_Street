# Pitfalls Research

**Domain:** Browser-based 3D driving / chase game (Three.js + Rapier WASM, solo dev, AI-agent-driven, no visual editor, no 3D modelling experience)
**Researched:** 2026-09-07
**Confidence:** MEDIUM-HIGH (Rapier API behaviour, OSM/Google licensing, ghost collisions, determinism verified against official docs; game-feel and AI-design pitfalls are community/practitioner consensus)

> Phase labels below are *proposed* names, not roadmap numbers. Suggested ordering:
> **P0** Engine Foundation (loop/timestep/debug) → **P1** Vehicle Feel Core → **P2** Camera & Game Feel →
> **P3** Map Pipeline → **P4** Race Modes + Medals → **P5** NPC Driving AI → **P6** Pursuit & Heat (Getaway) →
> **P7** Survival & Escalation → **P8** Damage & Destruction → **P9** Audio, Progression & Polish.

---

## Critical Pitfalls

### Pitfall 1: The map pipeline is built on Google Maps data and legally cannot ship

**What goes wrong:**
The project's stated preferred pipeline is a custom tool that "takes an area of Google Maps and exports it into files usable for game map creation." Google Maps Platform's policies explicitly prohibit *tracing or digitizing roadways and building outlines* from Maps imagery/Street View, *creating 3D building models* from 45° imagery, and *building terrain models based on Elevation API values*, plus a blanket ban on exporting/extracting/scraping Maps Content for use outside the Services. Every derived map in the game is a prohibited derivative. This is discovered at publish time, after 4 modes have been authored on top of the pipeline, and the fix is "re-source every map."

**Why it happens:**
The tool already exists and works, so it feels like a solved problem and gets treated as a fixed constraint rather than a decision to validate. Licensing feels like a launch-day concern, not a Phase-1 concern.

**How to avoid:**
Re-point the extraction tool at **OpenStreetMap** (via Overpass API or Geofabrik extracts) for road geometry plus an **open DEM** (SRTM / Copernicus GLO-30 / USGS 3DEP) for elevation, before any map is authored. OSM is ODbL: a game is a "Produced Work," so you may license the game however you like, provided you attribute "© OpenStreetMap contributors" and link to the licence — and be prepared, on request, to offer the derived database under ODbL. Keep Google Maps in the workflow only as a *visual reference for a human eye*, never as a data source that feeds files. Write the attribution string into the credits screen in the same phase as the pipeline so it can't be forgotten.

**Warning signs:**
Any tool output containing Google tile URLs, Elevation API responses, place IDs, or traced-from-satellite vector data. A `.gitignore`d folder of downloaded tiles. Anyone saying "we'll swap the data source later."

**Phase to address:**
**P3 Map Pipeline** — but the *decision* must be made in **P0**, because it determines the map data format everything else consumes.

*(Not legal advice — verify current terms at https://cloud.google.com/maps-platform/terms and https://developers.google.com/maps/documentation/tile/policies.)*

---

### Pitfall 2: The signature helicopter camera destroys the sense of speed the core value depends on

**What goes wrong:**
The project mandates a permanent high-angle "helicopter" camera across all four modes, while the Core Value is "the driving itself must feel weighty, cinematic." These fight each other. Sense of speed in games is largely a function of optical flow near the viewer and effective FOV — a distant, high-angle camera flattens optical flow, and top-down/high-angle racing cameras are a well-known "car speed problem" (the classic top-down GTAs fought it with tricks and still lost to a behind-car view). You ship a game where a 130mph muscle car reads as a slow-moving dot, drifts are unreadable, and the weighty handling you spent months tuning is invisible.

**Why it happens:**
The camera was chosen for *identity* (chase-cinema/news-chopper look) rather than for *feel*, and the decision is locked in PROJECT.md before any prototype exists. Camera and handling are then built in separate phases, so nobody ever evaluates them together.

**How to avoid:**
- Treat "helicopter cam" as a **camera family with a tunable height/pitch/FOV envelope**, not a fixed transform. Real chase-cinema chopper shots are much lower and tighter than a literal overhead view.
- Prototype the camera **in the same phase as the vehicle**, and make the acceptance criterion "does 100mph read as fast from this camera?" not "does the camera follow the car?"
- Budget explicit speed-cue systems as camera-phase work, not polish: speed-proportional FOV punch, camera lag/whip on lateral G, screen-space motion blur or radial streaks, ground-detail density (road markings, kerbs, roadside props) so there's *something* to flow past, tire smoke, dust and debris.
- Build a hard fallback: keep a conventional low chase camera behind a debug key from day one. If the chopper cam can't be made to read at speed, the game still works.

**Warning signs:**
Playtesters can't tell 60mph from 110mph. You keep increasing top speed to "make it feel fast." The car occupies fewer than ~8% of screen height. You find yourself zooming the camera in during play and never zooming back out.

**Phase to address:**
**P2 Camera & Game Feel**, gated immediately after **P1**. Should be an explicit go/no-go on the Key Decision in PROJECT.md.

---

### Pitfall 3: Tuning the raycast vehicle "by feel" with an AI agent that cannot feel it

**What goes wrong:**
Vehicle handling is a ~15-dimensional tuning problem (suspension stiffness, compression/relaxation damping, rest length, max travel, max force, friction slip, side friction stiffness, engine force, brake force, steering rate and limit, chassis mass, centre of mass, inertia, wheel radius/positions). Claude Code cannot drive the car. So the loop becomes: you say "it feels floaty," the agent changes three parameters at once, you say "now it's twitchy," and after six weeks you have a car that is bad in a *new* way and no record of what was already tried. This is the single most likely way this project stalls.

**Why it happens:**
No visual editor means no live inspector sliders — the normal way vehicle tuning is done in Unity/Unreal. Without that, tuning becomes a text-file-and-reload loop with a multi-second turnaround and no A/B comparison.

**How to avoid:**
Build the tuning *instrumentation* before tuning anything — this is a first-class deliverable, not scaffolding:
1. **Externalise every tuning value into a versioned JSON/TS config** (`tuning/muscle-v1.json`), hot-reloaded at runtime. Never let physics constants live inline in code where the agent will edit them ad hoc.
2. **An in-page debug UI** (lil-gui / tweakpane) exposing every parameter with live apply, plus save/load/diff of named presets. This restores the Unity inspector loop in the browser and lets *you* tune while the agent builds systems.
3. **A fixed test track**: a straight for 0–60/0–100 and braking distance, a constant-radius skidpad for lateral grip, a slalom, a 90° hairpin, a ramp, and a rough surface. Deterministic scripted input replays that run all of these and print a **telemetry table** (0–60 time, 60–0 distance, skidpad lateral G, max slip angle before spin, time-to-recover from a slide, airtime and landing stability).
4. **Numeric acceptance targets before tuning starts.** "Weighty 70s muscle car" must become numbers: ~0–60 in 6–7s, ~1.6–1.9 tonnes, understeer on entry, throttle-provoked oversteer, drift held at 15–35° slip. Benchmark by *measuring reference footage / known specs*, not vibes.
5. **One parameter at a time, with the telemetry delta recorded** in a tuning log file the agent appends to.

**Warning signs:**
Physics constants appearing as literals in more than one file. Commits titled "tweak handling." Re-testing by manually driving to "that one corner." No record of what a previous setting produced. The agent proposing a full physics rewrite as a fix for a feel problem.

**Phase to address:**
**P1 Vehicle Feel Core** — the harness ships *before* the tuning pass, and P1 does not exit until the telemetry targets are met.

---

### Pitfall 4: Assuming Rapier's vehicle controller has features it does not have

**What goes wrong:**
Rapier's `DynamicRayCastVehicleController` is a port of Bullet's `btRaycastVehicle`. Two assumptions break silently:

- **Ground material friction is ignored.** The wheels are raycasts, not colliders. Grip comes from `setWheelFrictionSlip(i, v)` and `setWheelSideFrictionStiffness(i, v)` per wheel. Setting `collider.setFriction()` on the tarmac/gravel/grass surfaces does **nothing** to the car. The "surfaces affect grip" requirement quietly does nothing, and the team spends days tuning collider friction values that are never read. (Same trap as Unity's WheelCollider ignoring PhysicMaterial.)
- **There is no roll-influence parameter.** Bullet's `m_rollInfluence` (which damps the lateral load transfer that flips cars) is **not exposed in Rapier's documented JS API**. Combined with `frictionSlip` — whose own docs warn "with the risk of causing the vehicle to flip if it's too strong" — you get a car that tips onto its roof in every hard corner, and the only lever you're offered (lowering friction slip) makes the car feel like it's on ice.

**Why it happens:**
Everyone's mental model comes from Unity WheelColliders or Unreal's Chaos Vehicles, both of which do these things for you. Tutorials for Rapier vehicles are thin and mostly demo-quality.

**How to avoid:**
- **Surface grip:** read the raycast hit from `wheelGroundObject(i)` / the wheel's raycast info each step, map the hit collider to a surface material (via a collider→material lookup table populated by the map pipeline), and set `frictionSlip` / `sideFrictionStiffness` per wheel per frame from that material. Design the surface system this way from the start; retrofitting it means touching every map asset.
- **Roll-over:** (a) push the chassis centre of mass well below geometric centre using `setAdditionalMassProperties(mass, com, principalInertia)` — Bullet-era practice is to sink it near or below the axle line; (b) apply a manual **anti-roll bar torque** each step proportional to the left/right suspension compression difference; (c) increase the chassis's roll-axis inertia. Verify against your installed `@dimforge/rapier3d` version — check `wheelRollInfluence`/`setWheelRollInfluence` exists before assuming it doesn't.
- Add "car survives a full-lock 60mph turn without rolling" and "gravel measurably reduces lateral G vs tarmac" to the P1 telemetry suite.

**Warning signs:**
Grass and tarmac produce identical skidpad numbers. Car flips in the slalom. Anyone tuning `ColliderDesc.setFriction()` to change handling.

**Phase to address:**
**P1 Vehicle Feel Core** (roll-over, per-wheel friction plumbing) and **P3 Map Pipeline** (surface tagging on exported geometry).

---

### Pitfall 5: Variable timestep physics — which silently invalidates the entire medal system

**What goes wrong:**
The obvious implementation is `world.step()` once per `requestAnimationFrame`. Then: a 144Hz monitor produces a different car than a 60Hz monitor; a background tab returns a 3-second delta and the car is launched into orbit; a GC hitch makes a jump land differently. Because the whole progression loop is **medal times (bronze/silver/gold, gold requiring near-perfect execution)**, non-reproducible physics means the game's core long-term value is built on an unfair, unrepeatable clock. A gold time achievable at 144fps but not at 60fps is a game-design bug that presents as a physics bug.

**Why it happens:**
Every beginner Three.js + Rapier tutorial does exactly this, and it looks fine for the first month because the dev has one machine at one refresh rate.

**How to avoid:**
- **Fixed timestep with an accumulator.** Set `world.timestep = 1/60` (or 1/120 for a high-speed vehicle) and step N times per frame from accumulated real time. Cap catch-up steps (e.g. max 5) to prevent the spiral of death, and **clamp `dt` to ~0.25s** to survive tab-switches.
- **Interpolate for rendering only.** Store previous/current body transforms and lerp/slerp into the Three.js `Object3D` by the accumulator remainder. Never let interpolated values feed back into gameplay state.
- Use `performance.now()`, not `Date.now()`.
- Rapier's JS build advertises **cross-platform determinism**, but only if initial conditions and the order of body/collider/joint creation are identical, and if you avoid `Math.sin`/`Math.cos` (not cross-platform deterministic) in setup values. Exploit this: verify determinism with `world.createSnapshot()` hashes after N steps in CI.
- Drive input sampling and *all* gameplay logic (heat, checkpoints, AI decisions, timers) off the fixed tick, not the render frame.
- Pause the simulation on `document.visibilitychange`, and handle `webglcontextlost`/`webglcontextrestored`.

**Warning signs:**
Lap times differ between machines. Physics behaves differently when you cap the framerate. Alt-tabbing teleports the car. `world.step()` appears once per rAF with no accumulator. Anything gameplay-relevant multiplied by `deltaTime` from rAF.

**Phase to address:**
**P0 Engine Foundation.** This is the cheapest pitfall to prevent and one of the most expensive to retrofit — every system built on top will assume the loop's shape.

---

### Pitfall 6: OSM road data is a 2D line network, not drivable 3D geometry

**What goes wrong:**
OSM gives you *centrelines with tags*. It does not give you: elevation, road width, lane geometry, junction shape, kerbs, camber, or which of two crossing ways is a bridge over the other. Naively extruding ways into ribbons produces a map where:
- Motorway overpasses and the roads beneath them become a **flat X intersection** that the car crashes into. (OSM's `layer`/`bridge`/`tunnel` tags carry ordering, but only if you read them — and they're inconsistently applied.)
- Every junction is a **Z-fighting pile of overlapping quads** with no proper junction polygon, so cars catch on seams and the road visually flickers.
- Draping ribbons onto a 30m-resolution DEM makes roads **undulate, submerge into hillsides, and float over valleys**, because DEMs sample terrain, not road surfaces.
- Ways are **split arbitrarily** at tag changes, so "one road" is 40 disconnected segments — fine for rendering, fatal for AI path graphs and checkpoint placement.
- Real road networks contain dead ends, service roads, footpaths, pedestrianised zones and tracks that are undrivable but present, so AI pursuers path into them.
- 1:1 real-world scale means a chase in a real town is mostly **long boring straights** — real geometry is not game geometry.

**Why it happens:**
The extraction tool "works" (it produces a mesh you can look at). The gap between "renders" and "is a fun, drivable, navigable racetrack" is invisible until you drive it.

**How to avoid:**
- Treat the pipeline output as an **intermediate authored format**, not final geometry: a road graph of nodes + edges with width, surface class, layer, and speed class, plus a separate terrain heightfield. Then generate mesh *and* collision *and* the AI navigation graph from that one source, so they can never disagree.
- **Resolve `layer`/`bridge`/`tunnel` explicitly** and separate crossing ways in Y; where data is missing, fall back to road-class ordering (motorway over residential) and flag the junction for manual review.
- **Snap and weld the graph**: merge coincident nodes, join split ways into continuous roads, delete orphan segments, and filter `highway=` values to a drivable allowlist (`motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track`) with an explicit blocklist for footway/path/steps/cycleway.
- **Flatten terrain under roads**: carve the DEM to the road surface with a smoothed corridor and blend shoulders, rather than draping the road onto the DEM. Smooth road elevation profiles along the way (a moving average) so cars don't launch off DEM noise.
- **Generate proper junction polygons** (a single capped disc/polygon at each node fitted to the incident road widths), not overlapping ribbons.
- **Budget a hand-editing step.** PROJECT.md already permits hand-authoring — use it. Real data gets you the layout; a human trims, closes, adds ramps, jumps, and shortcuts, and blocks off the boring 3km straight.
- **Validate automatically:** an offline checker that reports disconnected components, sub-minimum-radius corners, elevation discontinuities >X°, unwelded seams, and unreachable checkpoints. Fail the map build on violations.

**Warning signs:**
Cars falling through or catching at joins. Roads that end mid-air. A "bridge" you drive into. AI cars pathing into a footpath. A map you never actually drove end-to-end before building modes on it.

**Phase to address:**
**P3 Map Pipeline**, with the road-graph format defined in **P0**. Flag this phase as **needing deeper dedicated research** — it is the largest unknown in the project.

---

### Pitfall 7: Ghost collisions — the car bumps on invisible seams in the road mesh

**What goes wrong:**
Driving a rigid body across a triangle mesh produces spurious contacts at internal triangle edges, because the engine resolves each triangle independently and the separating plane at a shared edge is misaligned. The car jitters, bounces, catches, or is launched off a perfectly flat road. This is a documented, engine-agnostic problem (Unity Physics names it "Ghost Collision"; Jolt shipped an `InternalEdgeRemovingCollector` for it; Godot has multiple long-running issues). It is *worse* on OSM-derived roads, which are made of long thin triangle strips with lots of edges, and it is *worst* at high speed, which is the entire game.

**Why it happens:**
It doesn't show up on a box-and-plane test scene. It appears the moment you load a real map, and reads as "our vehicle physics is broken" rather than "our collision geometry is wrong."

**How to avoid:**
- The **wheels are raycasts** in a raycast vehicle, which sidesteps most of this for normal driving — but the **chassis collider** still contacts the road on compression, landings and scrapes. Keep the chassis collider a **single convex hull or cuboid** (raising ghost-collision resistance markedly) and keep it high enough that it only touches ground on genuine impacts.
- Prefer **heightfield colliders for terrain** (cheaper, less memory, no internal-edge issue) and reserve trimesh for road surfaces and structures.
- Generate road collision meshes with **long, well-conditioned triangles and welded vertices** — never a triangle soup with duplicated vertices at seams.
- Keep road collision geometry **separate and simpler than visual geometry** (no kerb detail, no decorative bevels).
- Test explicitly: drive a 100mph straight line across 20 mesh chunk boundaries and assert vertical velocity stays near zero.

**Warning signs:**
Random small vertical impulses on flat ground. Jitter that scales with speed. Bumps at chunk boundaries. The car catching on nothing.

**Phase to address:**
**P3 Map Pipeline** (geometry generation) with detection tests in **P1**.

---

### Pitfall 8: Physics explodes on jumps, ramps and landings

**What goes wrong:**
The reference films demand jumps. A raycast vehicle handles jumps badly by default: with all four wheels off the ground there are no suspension or friction forces, so the chassis is a free rigid body that keeps whatever angular velocity the ramp lip imparted — it tumbles. On landing, all four suspension springs compress simultaneously and, if stiffness is high and relaxation damping low, the car **pogo-bounces or is fired back into the air**. At high speed the chassis can also **tunnel through thin road/ramp colliders** entirely (a 60 m/s car moves 1m per 60Hz tick).

**Why it happens:**
All the tuning was done on flat ground. Airborne behaviour is a completely separate physical regime with none of the stabilising forces.

**How to avoid:**
- **Detect airborne state** (zero wheels with ground contact) and switch to an air-control regime: damp angular velocity toward zero, apply a self-righting torque toward level, allow limited player pitch/roll input (arcade air control), and optionally raise gravity to shorten hang time. A common practitioner trick is a gravity multiplier that is high when grounded (planted feel, harder to flip) and normal/lower when airborne.
- **Clamp angular velocity** on the chassis unconditionally (`setAngularDamping`, plus a hard cap) — this alone prevents most "car explodes" reports.
- Tune **suspension relaxation damping upward** (Rapier's docs: "increase this value if the suspension appears to overshoot") and give landings enough `maxSuspensionTravel` to absorb the hit rather than bottoming out.
- **Enable CCD on the chassis** and make ramp/road colliders thick solids, not zero-thickness sheets.
- Add "launch off the test ramp at 40/80/120mph, land, still under control" to the P1 telemetry suite, with automatic pass/fail on max angular velocity and time-to-recover.
- Provide a **reset/flip-over recovery** (auto-righting after N seconds inverted, or a manual reset key) — needed in a shipping game regardless.

**Warning signs:**
Cars that tumble after every ramp. NaN positions. Bodies vanishing (tunnelled). Bouncing on landing. Any physics value becoming `Infinity`.

**Phase to address:**
**P1 Vehicle Feel Core**, re-verified in **P3** once real map ramps exist.

---

### Pitfall 9: Every NPC pursuer is a full physics car, and the frame budget dies

**What goes wrong:**
The heat system escalates pursuer count. Survival mode escalates *without bound*. Circuit mode adds AI racers. So the design pushes toward 8–20 active vehicles. Each full raycast vehicle costs: 4 raycasts + suspension/friction solve + a dynamic body in the solver + a JS→WASM `updateVehicle` call + per-frame reads of position/rotation across the WASM boundary + a Three.js object graph with 5+ meshes and its own draw calls. At 60fps you have a **16.6ms total budget** for physics *and* rendering *and* AI *and* audio. Frame rate collapses exactly when the game is supposed to be at peak intensity.

**Why it happens:**
Tested with 2 pursuers on a dev machine with a good GPU. The escalation curve is a design number that nobody costed. The JS↔WASM boundary cost is invisible in a profiler that only shows "scripting."

**How to avoid:**
- **Set a hard budget in P0 and measure against it continuously**: e.g. ≤6ms physics, ≤6ms render, ≤2ms game logic at the target NPC count, with an on-screen profiler HUD (physics step ms, draw calls, triangles, body count) that is always available behind a key.
- **Tier the NPC simulation by relevance**, not uniformly:
  - *Full raycast vehicle*: only the player and the 2–4 pursuers actually on screen / within N metres.
  - *Simplified kinematic*: distant pursuers follow the road graph with a cheap point-mass/bicycle model and a kinematic body — visually identical at chopper-cam distance.
  - *Simulated-off-screen*: far pursuers are just a position advancing along the graph at a speed value, with no physics at all.
  - Promote/demote between tiers on distance and visibility, with hysteresis to avoid thrashing.
- **Cap concurrent full-physics vehicles as a hard constant.** Escalation should raise *aggression, roadblocks, and spawn pressure*, not just body count.
- **Batch the WASM boundary**: read transforms via Rapier's buffer APIs where available; never allocate objects per body per frame. Reuse `THREE.Vector3`/`Quaternion` instances.
- **Instance and pool everything**: `InstancedMesh` for road props, buildings, trees, street furniture; object pooling for pursuer cars, tire smoke, debris and particles. Target well under ~100–200 draw calls; 10,000 individual meshes = 10,000 draw calls, one `InstancedMesh` = 1.
- **Stream the world**: only keep a 3×3 tile neighbourhood around the player fully loaded with colliders instantiated; unload the rest. Never instantiate colliders for an entire city.
- Consider a **physics web worker** only if profiling demands it — it adds transferable-buffer complexity and a frame of latency, and is a large refactor if retrofitted, so decide in P0.

**Warning signs:**
Frame time rising linearly with pursuer count. GC sawtooth in the memory profiler. Physics step time >8ms. Draw calls in the thousands. Anything that reads "fine on my machine" but hasn't been tested at max heat.

**Phase to address:**
Budget and profiler HUD in **P0**; LOD tiering architecture designed in **P5 NPC Driving AI** *before* escalation is authored in **P6/P7**.

---

### Pitfall 10: Pursuit AI that oscillates, or cheats visibly

**What goes wrong:**
Two failure modes, both fatal to the chase fantasy:

*Oscillation/overshoot.* Naive "steer toward where the target will be" pursuit produces cars that weave down straights, saw the wheel, cut corners into buildings, and overshoot every turn. Pure-pursuit path following is documented to oscillate with a lookahead that's too short and to cut corners badly with one that's too long — and a heavy oversteering muscle car with steering lag makes both worse, because the controller assumes instantaneous steering response that the physics won't deliver.

*Visible cheating.* Rubber-banding is the standard fix for "our AI can't drive well enough," and players despise it: opponents that crawl when ahead and teleport back when behind, pursuers that stay glued to your bumper no matter how well you drive. It nullifies skill, which directly kills the medal-chasing core value — if the AI catches you regardless, gold medals feel arbitrary.

**Why it happens:**
Pursuit AI looks trivial ("drive at the player") and is budgeted as a small task. The difficulty curve then gets fixed with speed multipliers because the driving AI itself isn't good enough.

**How to avoid:**
- **Separate the layers**: (1) a *route planner* on the road graph (A*/Dijkstra to a target node, replanned on a timer, not per frame); (2) a *racing line / target point* sampler with a **speed-proportional lookahead** — lookahead ∝ speed, clamped to a min/max; (3) a *steering controller* that outputs the same normalised inputs the player has (steer/throttle/brake), never direct velocity or transform writes; (4) local *obstacle avoidance* as a short-horizon override.
- **AI drives the car, never the world.** If AI can set positions or velocities directly, collisions with the player will feel wrong and cheating becomes trivially easy to add.
- **Smooth and rate-limit steering output** (slew-rate limit + low-pass filter) to match real steering lag; add a small deadband so the controller doesn't chase sub-degree errors.
- **Brake for corners predictively**: compute the corner radius at the lookahead point and set target speed from it, rather than reacting after the apex.
- **Instead of rubber-banding, escalate honestly**: more pursuers, better pursuer vehicles at higher heat, roadblocks and spike strips, PIT-manoeuvre behaviours, helicopter spotting that removes your ability to break line-of-sight. All of these are *diegetic* and legible to the player; a speed multiplier is not.
- If catch-up is unavoidable, keep it **small, bounded, and applied to the AI's confidence/aggression rather than its top speed**, and never let it apply to the leading pursuer visible on screen.
- **Never rubber-band in race modes at all** — the medal system requires that a clean lap beats a scrappy one deterministically.
- Add a debug overlay: draw each AI's planned route, target point, lookahead, and desired vs actual steering. Without visualisation, AI debugging in a code-only workflow is guesswork.

**Warning signs:**
AI cars weaving on straights. Pursuers that never gain or lose ground. AI clipping corners into geometry. Difficulty being tuned by editing a speed multiplier. AI that is superhuman on one map and useless on another (a sign it's tuned to geometry, not principles).

**Phase to address:**
**P5 NPC Driving AI** (path following, avoidance, debug overlays) then **P6 Pursuit & Heat** (intercept, escalation). Flag **P5 as needing deeper research** — it is the second-largest unknown after the map pipeline.

---

### Pitfall 11: Four modes built in parallel because "they share a core"

**What goes wrong:**
PROJECT.md lists 5 mode variants (Point-to-Point, Circuit, Checkpoint Hunt, Getaway, Survival) plus heat, damage, medals, progression, area unlocks, radio chatter, and mission briefs. The plan says they share vehicle physics, camera, checkpoints and AI — which is true and misleading. Each mode has a hidden tail: Circuit needs racing AI + lap validation + a start grid; Point-to-Point needs route validation against shortcut abuse; Getaway needs heat, line-of-sight, escape zones and roadblocks; Survival needs unbounded escalation, boxing-in behaviour and a destruction end-state. Building the shared core "for all four" means designing for requirements you don't understand yet, over-abstracting, and reaching month nine with four half-modes and no fun. Over 70% of surveyed indie devs cite excessive scope as the reason projects miss deadlines or die.

**Why it happens:**
The shared-systems argument makes breadth feel cheap. Also, when an AI agent can generate a mode's scaffolding in an afternoon, *starting* modes is nearly free — it's finishing, tuning and content-filling them that isn't.

**How to avoid:**
- **One vertical slice first, end to end**: one car, one small hand-trimmed map, one mode (**Point-to-Point with medals** — it exercises physics, camera, checkpoints, timing and progression with *zero AI*), fully polished including audio and UI. Ship/playtest it before mode #2 exists.
- **Order modes by shared-system dependency, not by excitement**: race modes (no AI) → NPC driving AI → Circuit (AI racers) → Getaway (heat) → Survival (escalation). Survival is the *last* mode, not the first, because it needs everything.
- **Resist premature abstraction.** Write the second mode concretely and extract the shared abstraction only when you can see both. A "GameMode" framework designed before mode #2 exists will be wrong.
- **Freeze the requirement list at milestone boundaries.** Anything new goes to a parking lot file, not into the roadmap.
- **Content scope is the hidden multiplier**: N maps × M modes × 3 medal times each is a hand-tuning workload that scales multiplicatively. Decide the target (e.g. 3 maps × 3 modes) as a number early and treat it as a budget.
- Defer the whole car *roster* (European compacts, multiple handling profiles) — one great car beats five mediocre ones, and every extra car multiplies the P1 tuning problem.

**Warning signs:**
Multiple modes at 70% complete. A `GameMode` base class with one implementation. Work on Survival escalation before racing AI exists. New requirements appearing mid-phase. A map count that keeps growing.

**Phase to address:**
Roadmap structure itself — the phase ordering *is* the mitigation. Enforce at each phase gate.

---

### Pitfall 12: "Verified complete" phases that are technically correct and unplayable

**What goes wrong:**
In an AI-agent workflow with automated verification, a phase passes because the code compiles, tests pass, and the acceptance criteria are literally satisfied — while the car feels wrong, the camera reads badly, the AI is uncanny, and the mode isn't fun. Game development's actual acceptance criterion is subjective and cannot be automated. You end up with a fully "complete" roadmap and a game nobody enjoys, and the accumulated feel debt is now spread across a dozen interlocking systems.

**Why it happens:**
GSD-style verification rewards objective, checkable criteria. "Feels weighty" isn't one, so it gets replaced by "vehicle responds to input," which is not the same thing at all.

**How to avoid:**
- **Every game-feel phase gets a mandatory human play-test gate** in its verification, stated explicitly: "Leroy drives the test track for 10 minutes and signs off." Automated verification cannot close a feel phase.
- **Convert feel into numbers where possible** (the P1 telemetry table) so *some* of it is checkable, and be explicit that the numbers are necessary but not sufficient.
- **Keep a "feel regression" checklist** re-run at the end of every subsequent phase — damage, AI, streaming and map changes all quietly alter handling.
- **Record short video/GIF captures at each phase** so drift is visible over time (in a code-only workflow this is the only way to compare "then vs now").

**Warning signs:**
A phase marked complete that you haven't personally driven. Verification criteria that are all structural ("class exists," "event fires"). Discovering a feel problem three phases after it was introduced.

**Phase to address:**
Every phase from **P1** onward; encode as a standing verification requirement in the roadmap.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Physics constants inline in code | Fastest to write | Kills the tuning loop; every change is a code edit with no A/B or history — the #1 stall risk (Pitfall 3) | Never |
| `world.step()` once per rAF | 1 line, "works" | Non-deterministic medal times, tab-switch explosions; retrofitting touches every gameplay system | Only for a throwaway day-1 spike |
| Direct velocity/transform writes for AI cars | AI "works" in an afternoon | Player-vs-AI collisions feel fake; cheating becomes structural; can't reuse player vehicle code | Only for far-LOD off-screen NPCs, explicitly tiered |
| Whole map as one glTF + one trimesh collider | Simplest pipeline | Memory + step-time wall at real map scale; no streaming; can't LOD | Acceptable for the first small test map only |
| Individual `Mesh` per prop/building | Simple scene graph | Draw-call collapse at city scale | Until prop count >50 of the same type |
| One pitch-shifted engine loop | Ships audio in a day | Sounds like a hairdryer; undermines the "weighty V8" core value | Acceptable as a P1 placeholder, must be flagged as debt |
| Google-Maps-derived map data | Tool already exists | Cannot legally ship; full map re-source | Never for shipped assets; reference-only viewing is fine |
| Skipping the AI debug overlay | Saves a day | AI debugging becomes blind guesswork in a no-editor workflow | Never — it pays for itself in week one |
| Hardcoding medal times per map by hand | Fast | Doesn't scale past ~3 maps; times become inconsistent in difficulty | Acceptable if map count is capped at 3–5; otherwise derive from a recorded dev ghost lap × multipliers |
| Local-only best times in `localStorage` | Zero backend | Trivially editable; data lost on cache clear | Fine for v1 (single-player, no leaderboards) — but plan the schema for migration |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `@dimforge/rapier3d` (WASM) | Using the sync build and calling the API before the WASM module resolves; or bundler config that breaks the `.wasm` import under Vite | `await RAPIER.init()` (or use `rapier3d-compat`) before touching any API; configure Vite's `optimizeDeps.exclude` / wasm handling and verify a *production build* loads, not just dev |
| Rapier vehicle controller | Assuming ground collider friction affects grip; assuming a roll-influence parameter exists; calling `updateVehicle` with rAF delta instead of the world timestep | Set per-wheel `frictionSlip`/`sideFrictionStiffness` from a surface lookup each tick; implement manual anti-roll + low CoM; pass `world.timestep` and call in a fixed order relative to `world.step()` |
| Rapier ↔ Three.js | Allocating a new `Vector3`/`Quaternion` per body per frame; copying transforms of sleeping/inactive bodies | Preallocated scratch objects; iterate only active bodies; copy translation/rotation into `Object3D` and let Three compute matrices |
| Overpass API (OSM) | Hammering the public endpoint, unbounded bbox queries, no caching, no attribution | Cache raw responses to disk; use Geofabrik regional extracts for anything large; run extraction offline as a build step, never at game runtime; add "© OpenStreetMap contributors" to credits |
| DEM / elevation rasters | Mixing coordinate systems / datums with OSM lat-lon; sampling the DEM directly under roads | Reproject both into one local metric frame (e.g. UTM or a local ENU origin) as the very first pipeline step; carve and smooth terrain under road corridors |
| glTF car assets (Kenney / itch / AI-generated) | Wrong scale, origin not at the intended pivot, wheels not separable nodes, transforms baked onto children, oversized PBR textures | Validate on import: overall length ≈ 4.5–5.2m for a muscle car; named wheel nodes with origins at the wheel centre; run through `gltf-transform` (dedupe/prune/resize/Draco or Meshopt); mount wheels as separate `Object3D`s driven by `wheelChassisConnectionPointCs`/rotation from the controller, not baked into the body mesh |
| Web Audio | Starting the AudioContext before a user gesture (browsers block it); one pitch-shifted engine loop | Resume the context on first click/keypress with a "click to start" screen; layer 3–5 RPM-banded loops with crossfades (~250–500 RPM bands), plus separate on/off-throttle layers, road/tire/wind layers |
| Gamepad API | Polling from a listener rather than per frame; assuming a fixed button/axis mapping; no deadzone | Poll `navigator.getGamepads()` every fixed tick; handle both `standard` and non-standard mappings; radial deadzone + response curve on the steering axis |
| Keyboard steering | Feeding raw digital on/off into a steering angle | Ramp steering in/out with a rate limit and speed-sensitive steering limit — otherwise keyboard play feels twitchy no matter how good the physics is |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| One draw call per object | GPU-bound; frame rate independent of physics count | `InstancedMesh` for repeated props/buildings; merge static geometry; texture atlases | >~300–500 draw calls on mid-range GPUs |
| Full raycast vehicle for every NPC | Physics step time grows linearly with pursuer count | Tiered NPC simulation (full / simplified / off-screen) with a hard cap on full-physics cars | ~8+ full vehicles at 60Hz on a mid laptop |
| Whole-map trimesh collider | Long initial load, high WASM memory, slow broad-phase | Chunked colliders streamed with a 3×3 tile window; heightfield for terrain | City-scale maps (>~2km²) |
| Per-frame allocation in the hot loop | GC sawtooth; periodic 10–30ms stutters | Preallocate and reuse vectors/quaternions/arrays; pool particles, audio nodes, NPC entities | Immediately noticeable at 60fps; worse over long Survival runs |
| Dynamic shadow maps over an open world | Sudden GPU cost, shimmering, low-res shadows | Cascaded/limited shadow frustum around the player only; baked/blob shadows for distant objects; shadows off for instanced foliage | As soon as the shadow camera covers >~200m |
| No LOD on buildings/props | Vertex-bound at distance, especially under a high camera that sees a lot of world | `THREE.LOD` or per-LOD `InstancedMesh` sets; aggressive distance culling + fog | Chopper cam viewing >500m of city |
| Particle systems for smoke/dust per-vehicle | Fill-rate collapse when 6 cars drift at once | Shared pooled instanced particle system with a global cap; soft-particle-free simple sprites | Peak heat moments — exactly when it hurts most |
| Uncapped `devicePixelRatio` | 4K/Retina machines run at 1/4 the fps for no visual gain | Clamp `renderer.setPixelRatio(Math.min(dpr, 1.5))`; adaptive resolution scaling | Any high-DPI display |
| Audio node churn | Clicks, dropouts, memory growth | Pool `AudioBufferSourceNode`s / use looping sources with gain automation; cap concurrent voices | 10+ simultaneous vehicles/sirens |
| Long Survival sessions | Slow memory growth, degrading fps over 20+ minutes | Entity pooling, despawn of destroyed pursuers/debris, periodic assertion that body count is bounded | 15–30 minute runs — the exact mode premise |

## Security / Integrity Mistakes

Client-side single-player game — the relevant risks are integrity and licensing, not classic web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Best times / medals stored as plain `localStorage` numbers | Trivially editable; if leaderboards are ever added, all historical data is untrustworthy | Fine for v1, but store a versioned record including map hash, tuning-config hash and duration; if online times are ever added, require a server-validated input replay, never a submitted time |
| Trusting the client clock for lap timing | Times differ by machine/framerate; medals become meaningless | Time in **fixed physics ticks**, not wall-clock ms (this also makes runs reproducible and replayable) |
| No route/checkpoint validation | Players cut across terrain or skip checkpoints and get gold times, wrecking the progression loop | Ordered-checkpoint state machine with a "must pass through volume" test at the fixed tick rate (fast cars can pass through a thin trigger between frames — use swept/segment tests, not point-in-box) |
| Shipping asset licences unverified | Legal takedown; forced re-asset late in the project | Maintain `ASSETS.md` with source URL, licence, author and required attribution per asset from the first asset imported; CC0 (Kenney) is safe, "free on itch" often is not, AI-generated model terms vary by service |
| Real manufacturer badging/logos slipping into an imported model | IP exposure — already flagged as an explicit project constraint | Add a checklist item to asset import: strip badges, emblems, and named textures; keep silhouette only |
| Map data attribution missing | ODbL non-compliance | Credits screen with "© OpenStreetMap contributors" + licence link, added in the same phase as the map pipeline |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Chopper cam with no route guidance | Player has no idea where to go on an open real-world road network; frustration reads as "bad game" | Persistent route arrow / ground-projected racing line / next-checkpoint beacon + minimap; test navigation on a map you didn't author |
| Camera occlusion by buildings and overpasses | Player loses the car at the worst moment in a chase | Occlusion-aware camera (dither/fade occluders, raise on occlusion), plus a hard rule that the car silhouette is never fully hidden |
| Heat escalation without legible cause | Escalation feels arbitrary and unfair; the mode reads as random | Every heat change gets an immediate, distinct cue: siren layer change, radio chatter line, HUD star tick, on-screen "spotted" indicator; show *why* ("helicopter has visual") |
| Medal times set from dev skill | Gold is unattainable or trivial; the entire replay loop breaks | Derive from recorded dev ghost laps with multipliers (e.g. gold ≈ dev clean lap, silver +8%, bronze +20%), then validate with a second person |
| No instant restart | Medal-chasing requires dozens of attempts; a 10s reload per attempt kills the loop | Sub-1-second restart from a warm scene; never reload the map between attempts |
| Flipped/stuck car with no recovery | Run is dead but not over; player rage-quits | Auto-right after ~3s inverted or stationary-and-stuck; manual reset key that costs time rather than ending the run |
| Damage that only subtracts | Player feels punished into a death spiral with no agency | Make damage *readable and directional* (steering pull, engine misfire, visible panel loss) and give an escape route (repair pickups, heat cooldown), especially in Survival |
| Simulation-grade handling on keyboard | Uncontrollable on the platform most players will use | Speed-sensitive steering limit, steering rate ramp, mild countersteer assist; test keyboard-first, gamepad second |
| Radio chatter that repeats | Charming for 3 minutes, grating by minute 10 — Survival runs are long | Large-ish line pool, no-repeat window, contextual gating by heat/event, and a volume slider |

## "Looks Done But Isn't" Checklist

- [ ] **Vehicle physics:** often missing airborne handling, roll-over prevention, and reset/recovery — verify a 120mph ramp jump, a full-lock 60mph turn, and a deliberate roll all end in a driveable state
- [ ] **Game loop:** often missing dt clamping and tab-visibility handling — verify alt-tabbing for 60s then returning does not teleport or explode anything
- [ ] **Surface grip:** often wired to collider friction, which the raycast vehicle ignores — verify skidpad lateral G measurably differs between tarmac and gravel
- [ ] **Map pipeline:** often missing bridge/tunnel layering, junction geometry, and connectivity validation — verify by driving *and* AI-pathing every road on the map, and by running the map validator
- [ ] **Checkpoints:** often missing swept-volume tests — verify a checkpoint cannot be passed through at 150mph without registering
- [ ] **Timing:** often wall-clock based — verify identical times when the framerate is capped to 30 and uncapped
- [ ] **NPC AI:** often missing stuck detection and recovery — verify pursuers that hit a wall or flip re-path or despawn rather than idling forever
- [ ] **Heat system:** often missing decay tuning and player-facing cause cues — verify heat drops within a designed window after breaking line of sight, and that the player can tell why heat changed
- [ ] **Survival mode:** often missing bounded escalation — verify body count, particle count and memory are flat after a 30-minute run
- [ ] **Damage:** often applied visually but not to mass/handling, or applied to mass and quietly breaking the P1 tuning — verify telemetry re-run at each damage tier
- [ ] **Audio:** often missing the AudioContext user-gesture unlock and a mute/volume path — verify audio starts on a cold load in Chrome, Firefox and Safari
- [ ] **Build:** often only tested in `vite dev` — verify a `vite build` + preview loads the WASM, assets and models correctly, and measure the total download size
- [ ] **Assets:** often missing licence records and attribution — verify `ASSETS.md` covers every shipped file
- [ ] **Performance:** often only tested on the dev machine at 2 pursuers — verify at max heat, on the largest map, on an integrated-GPU laptop

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Google-derived map data already in use | HIGH | Re-point the extraction tool at OSM + open DEM; regenerate all maps; re-place checkpoints and re-set medal times. Cost scales with map count — a reason to keep map count low until the pipeline is settled |
| Variable timestep retrofitted late | HIGH | Introduce the accumulator, then audit every system for rAF-delta dependence (AI, heat, timers, particles, audio); re-tune physics (behaviour *will* change); invalidate and re-record all medal times |
| Handling tuned into a dead end | MEDIUM | Revert to the last preset that passed telemetry, not to "before"; resume one-parameter-at-a-time from there. Cheap **only if** the tuning harness and preset history from Pitfall 3 exist — otherwise HIGH |
| Frame budget blown by NPC count | MEDIUM | Introduce the LOD tiering behind the existing NPC interface; if AI already writes transforms directly, this becomes HIGH — hence enforcing input-only AI control from the start |
| Ghost collisions on road meshes | MEDIUM | Regenerate collision geometry with welded, well-conditioned triangles; simplify chassis collider to a convex hull; move terrain to heightfields |
| Helicopter camera doesn't convey speed | MEDIUM | Fall back to the debug chase camera as the default and demote the chopper cam to a heat-triggered/cinematic view — cheap if the fallback camera was kept alive from P2, expensive if the whole game was framed and tuned around one camera |
| Four half-finished modes | HIGH | Pick one, cut the others to a parking lot, finish it to shippable, then re-add. Painful but survivable; the alternative is abandonment |
| Rubber-banding baked into AI | MEDIUM | Remove catch-up entirely, then rebuild difficulty through pursuer count, vehicle class, roadblocks and aggression — requires the AI to actually drive well, which is why P5 must be a real phase |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Google Maps ToS | P0 decision, P3 implementation | No Google-sourced bytes in the pipeline; OSM attribution present in credits; `ASSETS.md` complete |
| 2. Chopper cam kills speed feel | P2 (gated after P1) | Human play-test: 60 vs 110mph distinguishable; fallback chase camera exists and works |
| 3. Blind handling tuning | P1 | Hot-reloaded tuning config + debug GUI + scripted telemetry suite exist and are used; tuning log has entries |
| 4. Rapier controller assumptions | P1 (+ P3 for surface tags) | Skidpad lateral G differs per surface; car survives full-lock 60mph turn without rolling |
| 5. Variable timestep | P0 | Identical lap times at 30/60/144fps; determinism snapshot hash test in CI; alt-tab test passes |
| 6. OSM road geometry | P3 (flag for deep research) | Map validator passes; every road drivable and AI-pathable end to end |
| 7. Ghost collisions | P3 (tests in P1) | 100mph straight-line run across chunk seams shows near-zero vertical velocity |
| 8. Jump/landing explosions | P1 (re-verified P3) | Ramp telemetry at 40/80/120mph passes angular-velocity and recovery-time thresholds |
| 9. NPC frame budget | P0 budget + P5 architecture | Profiler HUD stays within budget at max-heat pursuer count on an integrated GPU |
| 10. Pursuit AI oscillation / rubber-banding | P5 then P6 (flag for deep research) | AI debug overlay exists; no steering oscillation on straights; no speed-multiplier catch-up in code; race modes have zero rubber-banding |
| 11. Four-mode scope creep | Roadmap ordering + phase gates | One mode fully shippable (incl. audio/UI/medals) before mode #2 starts; requirement list frozen per milestone |
| 12. Verified-but-not-fun | Every phase from P1 | Human play-test sign-off is a named, mandatory verification criterion; video capture archived per phase |

## Sources

**HIGH confidence (official docs):**
- Rapier `DynamicRayCastVehicleController` API — https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html (per-wheel friction slip, side friction stiffness, suspension stiffness/compression/relaxation/travel/force; no roll-influence parameter documented)
- Rapier determinism guide — https://rapier.rs/docs/user_guides/javascript/determinism/ (cross-platform determinism conditions; `Math.sin`/`cos` caveat; snapshot hashing)
- Rapier colliders guide — https://rapier.rs/docs/user_guides/javascript/colliders/ (heightfield vs trimesh vs convex decomposition guidance)
- Rapier rigid-body mass properties — https://www.rapier.rs/docs/user_guides/javascript/rigid_body_mass_properties (explicit centre of mass / inertia override)
- Google Maps Platform Terms — https://cloud.google.com/maps-platform/terms and Map Tiles API Policies — https://developers.google.com/maps/documentation/tile/policies (prohibition on tracing/digitizing roadways, 3D models from imagery, terrain models from Elevation API, and extraction/scraping)
- OSMF Licence & Legal FAQ / Attribution Guidelines — https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ, https://wiki.openstreetmap.org/wiki/License/Use_Cases (games as ODbL "Produced Works"; attribution requirements)
- Unity Physics "Ghost Collision" — https://docs.unity3d.com/Packages/com.unity.physics@1.3/manual/ghost-collision.html; Jolt `InternalEdgeRemovingCollector` PR — https://github.com/godotengine/godot/pull/102614
- MathWorks Pure Pursuit Controller — https://www.mathworks.com/help/nav/ug/pure-pursuit-controller.html (lookahead too small → oscillation/overshoot; too large → corner cutting)
- three.js glTF loading manual — https://threejs.org/manual/en/load-gltf.html (car model transforms baked onto children; wheel node handling)

**MEDIUM confidence (multiple credible practitioner sources):**
- Bullet `btRaycastVehicle` community guidance on roll influence, low centre of mass, gravity multipliers and airborne stabilisation — pybullet.org forums, gamedev.net threads
- Racing AI architecture — Game AI Pro Ch. 38, "An Architecture Overview for AI in Racing Games" (racing lines, cut-down AI physics, computational cost of full-physics AI fields)
- Rubber-banding player reception — aggregated Steam/community discussions (GRIP, Hotshot Racing, The Crew 2); "developers rely on rubberbanding rather than better AI"
- Top-down / high-angle camera vs sense of speed — https://www.gamedeveloper.com/design/let-s-talk-about-top-down-view-camera-system-for-a-racing-game
- Engine audio: single-sample pitch shifting sounds artificial; layered RPM-banded crossfaded loops are standard — designingsound.org, audiokinetic.com, boomlibrary.com
- Three.js draw-call and instancing budgets (~100s of draw calls; InstancedMesh collapses N meshes to 1; instanced frustum-culling caveats) — utsubo.com, threejsroadmap.com, vrmeup.com
- OSM-for-simulation limitations (no elevation, overpasses as flat intersections, junctions as single nodes, misclassified attributes) — MathWorks RoadRunner OSM guide, arXiv intersection-imputation and elevation co-simulation papers
- Open-world streaming with 3×3 tile windows and moving heightfield colliders — community devlogs and streaming architecture write-ups
- Browser game loop hazards (clamp dt, `performance.now()`, background-tab rAF throttling to ~1fps, `webglcontextlost` recovery) — fsjs.dev, bugnet.io
- Indie scope creep (>70% of surveyed indie devs cite scope; vertical-slice-first advice) — wayline.io, gamedeveloper.com solo-dev postmortems

**LOW confidence / to validate during implementation:**
- Exact absence of a roll-influence parameter in the installed `@dimforge/rapier3d` version — check the shipped `.d.ts` before designing the manual anti-roll system
- Specific NPC-count thresholds (~8 full-physics vehicles) — a starting hypothesis, must be replaced with measured numbers from the P0 profiler HUD
- Rapier vehicle controller call ordering relative to `world.step()` — verify against the version's examples

---
*Pitfalls research for: browser-based 3D driving/chase game (Three.js + Rapier, solo dev, AI-agent workflow)*
*Researched: 2026-09-07*
