# Project: Heat Street (working title)

## 1. Vision

A browser-based driving game blending point-to-point races, circuit races,
police-style getaways, and last-stand survival chases — all wrapped in a
70s cop-movie aesthetic (Bullitt, Starsky & Hutch, Dukes of Hazzard).
Cars are American 60s/70s muscle cars. Camera is a free-orbit "chase
helicopter" view: zoomable, pannable, not locked to a fixed isometric angle,
but defaulting to a high, angled follow shot.

The core feeling to chase: big slides, tire smoke, jumps off crests and
ramps, and cars that feel heavy and rear-wheel-drive-loose rather than
grippy and modern.

## 2. Tech Stack (proposed)

- **Rendering:** Three.js (WebGL)
- **Physics:** Rapier (rapier3d), via its WASM build — good vehicle
  raycast-wheel support, actively maintained, fast enough for many
  AI-driven cars at once
- **Language/tooling:** TypeScript + Vite
- **Target:** Desktop browser first (keyboard + gamepad), mobile not a
  launch requirement
- **Art pipeline:** low-poly / stylized models (glTF), favoring
  silhouette and color over surface detail, since camera is mid-to-far
  distance most of the time

This stack is chosen specifically because it's entirely code-driven —
no dependency on a visual editor GUI — which fits a Claude-Code-only
workflow with no Unity install.

## 3. Core Shared Systems

These underpin every game mode and should be built and proven first.

### 3.1 Vehicle Physics
- Raycast-wheel model (4 wheels, independent suspension) on top of a
  rigid body chassis
- Per-wheel slip calculation (longitudinal + lateral) feeding a
  Pacejka-lite or simplified slip-curve friction model
- Deliberately "loose" tuning knobs: high-speed oversteer on throttle
  lift, slow-in/fast-out drift behavior, weight transfer on braking and
  cornering
- Airborne handling: stable landing orientation assist, no physics
  explosion on jumps/ramps
- Damage-linked performance degradation (see 3.4)

### 3.2 Surface/Terrain Friction System
- A material-tagging layer on all ground meshes/colliders: `tarmac`,
  `gravel`, `grass`, `mud`, `sand`, `dirt_road`
- Each tag maps to a friction/grip multiplier and a slip threshold
  consumed by the vehicle physics
- Surface also drives particle/vfx choice (dust vs. tire smoke vs.
  mud spray) and audio (tire chirp vs. muffled dirt rumble)

### 3.3 Camera Rig
- Free orbit + zoom + pan, default framing behind/above the car
  ("chase helicopter")
- Smooth follow with lag/lookahead tuned for high-speed readability
- Snap-back/recenter control, and a manual override that gently
  relaxes back to auto framing when the player stops adjusting it

### 3.4 Damage & Destruction
- Visual damage stages (dents/deformation swaps or shader-based
  damage) tied to a numeric health value
- Performance degradation curve (top speed, handling) as damage
  increases — matters most for Survival mode
- Destruction event (final state) ends Survival/Getaway runs

### 3.5 NPC Driving AI
This is the single biggest shared investment — one system, three
behavior configs:
- **Racer AI:** path-follows a route/checkpoint chain with lookahead
  steering, overtakes, mild rubber-banding
- **Pursuer AI:** chases a moving target (the player), predictive
  intercept steering, obstacle/traffic avoidance, aggression tuning
  (ramming vs. boxing-in vs. cautious tailing)
- **Ambient traffic AI (stretch):** simple lane-following, mostly for
  atmosphere and as obstacles in chase modes

### 3.6 Checkpoint / Objective System
- Generic checkpoint manager: ordered (circuit) or unordered
  (point-to-point) checkpoint sets, each mode just configures it
  differently
- Minimap/waypoint UI pointing to next objective or, in
  getaway/survival, showing pursuer positions/heat

## 4. Game Modes

| Mode | Description | Win/Lose Condition |
|---|---|---|
| **Point-to-Point** | Series of checkpoints scattered across the map, player chooses their own route between them | All checkpoints hit, fastest time |
| **Circuit Race** | Ordered checkpoint loop following town road layout, AI racers present | First past finish after N laps |
| **Getaway** | AI police-style pursuers spawn and chase; player must break line-of-sight / distance for a sustained "escaped" timer | Escape = win, caught/destroyed = lose |
| **Survival** | Continuous escalating pursuit, waves of pursuers, no escape condition | Survive as long as possible / until destroyed |

All four modes reuse Section 3 systems; each mode's implementation
should be a thin config/rules layer, not a rewrite.

## 5. World / Maps

- Variety of terrain zones per map or across separate maps: dense
  city blocks, small town main-street layouts, rural roads with open
  fields
- Each zone uses the Section 3.2 surface tagging so a single map can
  transition from tarmac downtown to gravel/mud out in the country
- Road layout should support both a "lap-able" circuit subsection (for
  Circuit mode) and open-route traversal (for Point-to-Point/Getaway/
  Survival) — likely achieved by designing one larger map with a
  loop-able core road plus surrounding open terrain, rather than
  separate maps per mode

## 6. Art & Tone Direction

- Muscle car silhouettes: Dodge Charger/Challenger, Ford Mustang/
  Galaxie, Plymouth Barracuda-era shapes — generic/stylized versions
  to avoid IP issues, not licensed replicas
  (Note: avoid using real manufacturer names/logos or exact
  reproductions in shipped assets — treat these as inspiration for
  original stylized designs.)
- Color and lighting lean warm, sun-bleached, slightly grainy —
  70s film look
- Heavy emphasis on tire smoke, dust trails, and motion blur/speed
  lines during drifts and jumps for readability from the pulled-back
  camera

## 7. Suggested Build Order / Phases

1. **Foundation:** Three.js + Rapier project scaffold, one test car,
   one flat tarmac test plane — get raycast-wheel physics and drift
   feel right before anything else
2. **Surfaces:** implement material tagging + friction system, test
   map with mixed terrain (tarmac/gravel/grass/mud)
3. **Camera:** build the chase-helicopter free camera rig
4. **First playable mode:** Point-to-Point (simplest — validates
   checkpoint system + full car-driving loop end to end)
5. **Circuit mode:** add ordered checkpoints + basic Racer AI
6. **Chase modes:** build Pursuer AI, then Getaway, then Survival
   (Survival reuses Getaway's pursuer AI at higher aggression)
7. **Damage/destruction system:** layer in once Survival needs it
8. **Polish pass:** art direction, VFX, audio, UI/minimap refinement

## 8. Open Questions / Decisions Deferred to Implementation

- Exact number and layout of maps (one large mixed-terrain map vs.
  several smaller mode-specific maps)
- Multiplayer: out of scope for v1 unless revisited
- Save/progression system: not yet designed
- Audio: engine sound model (procedural vs. sample-based) undecided
