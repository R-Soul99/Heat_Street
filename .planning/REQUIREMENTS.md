# Requirements: Heat Street

**Defined:** 2026-09-08
**Core Value:** The driving itself must feel weighty, cinematic, and replayable — big slides, tire smoke, jumps, and a heavy rear-wheel-drive-loose feel — with medal-time chasing giving every route long-term replay value.

## v1 Requirements

Ruthless read from research: one area, three modes, one car, medals that work.

### Vehicle & Handling

- [x] **VEH-01**: Player can drive a car with weighty, momentum-driven handling — late braking has real consequences, understeer/oversteer are readable and controllable
- [ ] **VEH-02**: Player steers via smoothed/analog input on both keyboard and gamepad
- [x] **VEH-03**: Vehicle physics run on a fixed timestep so lap and medal times are framerate-independent
- [ ] **VEH-04**: Vehicle can go airborne off jumps/ramps and lands stably without the physics breaking

### Surfaces

- [ ] **SURF-01**: Tarmac, gravel, grass, mud, sand, and dirt-road surfaces each provide distinct grip via per-wheel friction values (not ground-collider friction)
- [ ] **SURF-02**: Each surface type has distinct visual feedback (tire smoke / dust plume / mud spray / skid decal) and audio (tire chirp vs. muffled rumble)

### Camera

- [ ] **CAM-01**: Player views the game through a permanent high-angle "helicopter" camera that smoothly follows the car's velocity heading, not chassis yaw
- [ ] **CAM-02**: Camera altitude and FOV adjust dynamically with vehicle speed to preserve sense of speed
- [ ] **CAM-03**: Camera is contextually skinned per mode (police/news chopper for Getaway, sports-broadcast chopper for Point-to-Point/Circuit)
- [ ] **CAM-04**: Buildings between the camera and the car never permanently block the view of the car or road. Exact approach resolved by prototyping during Phase 3, not fixed in advance — candidates are (a) fading occluding buildings to translucent/wireframe, and (b) dynamically steepening the camera toward near-overhead in dense areas (GTA1/2-style) then relaxing in open areas. Decided by human playtest feel, not on paper

### Navigation & HUD

- [ ] **NAV-01**: Player sees a live speedometer (needle + digital readout)
- [ ] **NAV-02**: Player sees a live run timer with medal thresholds visible before and during the run
- [ ] **NAV-03**: Player sees an always-on minimap showing remaining checkpoints and their own position
- [ ] **NAV-04**: Player is guided to the next objective via a world-space beacon (where) plus a road-aware directional arrow (how)
- [ ] **NAV-05**: In unordered checkpoint modes the arrow targets the nearest unvisited checkpoint; in ordered modes it targets the next checkpoint in sequence
- [ ] **NAV-06**: Player can respawn at the last checkpoint on a dedicated key, upright and facing the correct direction, with a small time penalty
- [ ] **NAV-07**: Player can instantly restart the current level with a single key press, well under a second, no confirmation dialog or loading screen

### Point-to-Point Mode

- [ ] **P2P-01**: Player can complete a Point-to-Point level by hitting all checkpoints in any order via any route

### Circuit Mode

- [ ] **CIRC-01**: Player can complete a Circuit level as an ordered checkpoint loop across N laps
- [ ] **CIRC-02**: AI racers compete in Circuit mode at a fixed difficulty with no rubber-banding

### Getaway Mode (Heat System)

- [ ] **GET-01**: Player can play Getaway mode, escaping AI police-style pursuers to reach an escape point
- [ ] **GET-02**: A heat system governs pursuit with three states — Active, Cooldown/Search, Clear — where cooldown requires both broken line-of-sight and being outside the search radius before heat begins decaying
- [ ] **GET-03**: Heat has tiers 1-3 for v1 (single cruiser → pair with PIT attempts → roadblocks), each introducing a new pursuer behavior, pre-announced via radio chatter before it triggers
- [ ] **GET-04**: Player sees a pursuit HUD showing pursuer count, current heat tier, backup ETA, and a bust-risk meter that fills when boxed in/slow/surrounded rather than instant-failing on contact

### Damage & Destruction

- [ ] **DMG-01**: Vehicle has a 3-threshold integrity state (pristine / damaged / critical) with a readable indicator, each threshold visibly affecting performance and appearance
- [ ] **DMG-02**: Reaching the destruction threshold ends a Getaway run

### Medals & Progression

- [ ] **MEDAL-01**: Player earns one of four medal tiers per level (Bronze / Silver / Gold / Ace) based on completion time, with thresholds derived from a fixed percentage of a designer reference run
- [ ] **MEDAL-02**: Player's best time per level persists across sessions and is visible on a medal grid at level select
- [ ] **MEDAL-03**: Player sees a live split-time delta (vs. personal best or target medal) at each checkpoint during a run
- [ ] **MEDAL-04**: Player sees a post-run sector breakdown table with the worst sector highlighted

### Narrative Framing

- [ ] **NARR-01**: Light narrative context is delivered via mission-brief text and radio/dispatch chatter routed through a single game-event bus — no cutscenes, dialogue trees, or characters

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Modes & Progression

- **SURV-01**: Survival mode — continuous escalating pursuit with no escape condition, scored by time survived × heat tier × pursuers wrecked
- **AREA-01**: Areas 2-3 plus area-unlock progression (completing a level in the current area unlocks the next area/map)
- **GET-05**: Heat tiers 4-5 — heavy ram unit (SUV) and helicopter spotlight, defeatable via tunnel/covered geometry
- **GET-06**: Pursuit breakers (destructible roadside props) and hiding spots/cooldown zones
- **WORLD-02**: Structural building destruction (marketplaces, outdoor cafes, shopping malls sustain damage or partial collapse) — stretch goal, needs its own research pass (fracture/destruction system, damaged-mesh LOD swapping, rebuild-safe collision). Destroyed state must reset per-run rather than persisting, or a level's route — and therefore its medal times — would change permanently after the first successful smash-through

### Replay & Content

- **MEDAL-05**: Personal-best ghost playback during runs
- **VEH-05**: Second and third car with genuinely distinct handling profiles
- **WORLD-01**: Light rails-based ambient traffic (moving obstacles with simple braking/panic-swerve)
- **MEDAL-06**: Post-run chopper-cam replay of the run

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Car performance tuning/customization | Destroys medal-time comparability — a time would become a statement about a build, not about driving |
| Rubber-band/catch-up AI | Consistently disliked genre-wide; the medal time is the real opponent, not the AI |
| Rewind / time-scrub | Structurally incompatible with medal-time integrity; instant restart is the correct answer |
| Global online leaderboards (v1) | Needs a backend, accounts, and anti-cheat for client-authoritative timing — out of scope for a solo v1 |
| Free roam / cruise mode | Dilutes the level-select → run → restart loop that makes medal chasing work |
| Component-level damage simulation | Invisible and unreadable from helicopter-camera distance; a single integrity value is the right fidelity |
| Full civilian traffic simulation | Expensive, and fights the pursuer AI for the same road graph; light rails-based traffic is a v2 candidate instead |
| Multiple selectable cameras | Dissolves the single visual identity that makes this game recognizable |
| Weather/day-night as simulated systems | Per-level fixed lighting presets give the same visual variety without the validation burden |
| Procedurally generated maps | Ruled out from the project's start — medal times require stable, hand-tuned routes |
| Difficulty settings | Difficulty *is* the medal tier; separate driving-assist toggles are the accessibility answer instead |
| Nitrous/boost mechanic | Not period-appropriate for the 60s-70s chase-cinema vocabulary; flattens the momentum-driven handling pillar |
| Story cutscenes / dialogue trees | Replaced by light mission-brief and radio-chatter framing (matches the player's own stated preference) |
| Multiplayer | Not in v1; may revisit later |
| Mobile/touch support | Desktop browser first (keyboard + gamepad) |
| Licensed/exact car reproductions | Original stylized designs only, inspired by muscle-car silhouettes — no manufacturer names/logos |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VEH-01 | Phase 2 | Complete |
| VEH-02 | Phase 2 | Pending |
| VEH-03 | Phase 1 | Complete |
| VEH-04 | Phase 2 | Pending |
| SURF-01 | Phase 3 | Pending |
| SURF-02 | Phase 3 | Pending |
| CAM-01 | Phase 3 | Pending |
| CAM-02 | Phase 3 | Pending |
| CAM-03 | Phase 3 | Pending |
| CAM-04 | Phase 3 | Pending |
| NAV-01 | Phase 2 | Pending |
| NAV-02 | Phase 6 | Pending |
| NAV-03 | Phase 5 | Pending |
| NAV-04 | Phase 5 | Pending |
| NAV-05 | Phase 5 | Pending |
| NAV-06 | Phase 5 | Pending |
| NAV-07 | Phase 5 | Pending |
| P2P-01 | Phase 5 | Pending |
| CIRC-01 | Phase 5 | Pending |
| CIRC-02 | Phase 7 | Pending |
| GET-01 | Phase 8 | Pending |
| GET-02 | Phase 8 | Pending |
| GET-03 | Phase 8 | Pending |
| GET-04 | Phase 8 | Pending |
| DMG-01 | Phase 8 | Pending |
| DMG-02 | Phase 8 | Pending |
| MEDAL-01 | Phase 6 | Pending |
| MEDAL-02 | Phase 6 | Pending |
| MEDAL-03 | Phase 6 | Pending |
| MEDAL-04 | Phase 6 | Pending |
| NARR-01 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 31 total (CAM-04 added after roadmap creation, mapped directly to Phase 3)
- Mapped to phases: 31
- Unmapped: 0 - full coverage

**Phase 4 (Map Pipeline & First Area)** carries no requirement of its own. It is enabling
infrastructure: the road graph it emits is consumed by NAV-03/04/05/06, P2P-01, CIRC-01/02
and GET-01/03, all of which are verified in later phases.

---
*Requirements defined: 2026-09-08*
*Last updated: 2026-09-08 after roadmap creation (traceability mapped to 8 phases)*
