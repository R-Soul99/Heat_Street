# Phase 3: Surfaces & Helicopter Camera - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-12
**Phase:** 03-surfaces-helicopter-camera
**Areas discussed:** Surface test scene, Occlusion prototyping scope, Surface FX style & audio sourcing, Camera mode-skin scope, Drift stability & go/no-go fallback meaning, Surface grip ranking, Multi-car camera forward-compatibility

---

## Surface Test Scene

| Option | Description | Selected |
|--------|-------------|----------|
| Patchwork zones on one flat plane | Adjacent rectangular zones for all 6 surfaces on the existing ground, so a straight drive crosses all of them | ✓ |
| Separate isolated test pads | One small isolated patch per surface, no continuous transition | |
| Skip the visual scene, use telemetry only | Add a skidpad-per-surface telemetry routine, no new drivable scene | |

**User's choice:** Patchwork zones on one flat plane.
**Notes:** Directly demonstrates SC1's "driving from tarmac onto gravel" requirement.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, keep the Phase 2 ramp | Reuse it to also exercise VEH-04/airborne behavior across surfaces | |
| No, replace it with a fresh layout | Dedicated surfaces-focused layout for Phase 3 | ✓ |

**User's choice:** Replace with a fresh layout. Follow-up on specifics deferred to Claude's discretion ("Next area" chosen over "More questions").

| Option | Description | Selected |
|--------|-------------|----------|
| Noticeably slippery but still controllable | Mud/sand reduce grip distinctly but stay driveable | ✓ |
| Authentically treacherous | Mud/sand can genuinely bog down or spin the car with normal inputs | |
| You decide | Claude picks starting multipliers, refined during tuning | |

**User's choice:** Noticeably slippery but still controllable — matches the arcade-realistic hybrid target.

| Option | Description | Selected |
|--------|-------------|----------|
| Dev/test fixture only | Mirrors debug-scene.ts/vehicle-scene.ts — superseded by Phase 4 | ✓ |
| Keep it as a permanent debug/practice track | Worth keeping long-term even after Phase 4 ships real maps | |

**User's choice:** Dev/test fixture only.

---

## Occlusion Prototyping Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder box buildings | Scatter simple cuboid buildings to genuinely occlude the car and playtest both mitigations for real | ✓ |
| Build the mechanism only, defer the playtest to Phase 4 | Implement both code paths, treat the go/no-go as provisional until real geometry exists | |
| Pick one approach now, skip prototyping both | Choose one mitigation on paper, skip the comparative playtest | |

**User's choice:** Placeholder box buildings — per SC6's explicit "not a paper decision" requirement.

| Option | Description | Selected |
|--------|-------------|----------|
| A few clustered zones of varying density | One sparse zone, one dense/urban-canyon zone | ✓ |
| Random scatter across the whole test scene | Simpler, less deliberate about stress-testing occlusion | |
| Not applicable | Only relevant if mechanism-only or pick-one was chosen above | |

**User's choice:** A few clustered zones of varying density.

---

## Surface FX Style & Audio Sourcing

| Option | Description | Selected |
|--------|-------------|----------|
| Simple GPU particle sprites | THREE.Points with soft puff textures, colored per surface | ✓ (with a caveat) |
| Decal-only, no particles | Skid-mark decals only, no trailing smoke/dust | |
| You decide | Claude picks a visual approach informed by research | |

**User's choice:** Free-text — "particle sprites for now, but i'd like this to be partly gravity and physics based eventually i.e. on mud generate small lumps that get kicked up by the tyres."
**Notes:** Simple sprites are this phase's scope; physics-based kicked-up debris is captured as a deferred idea for a future phase, not built now.

| Option | Description | Selected |
|--------|-------------|----------|
| Research CC0/royalty-free sources | Claude sources free, properly-licensed sound effects as part of this phase's research | ✓ |
| I'll provide/record audio assets | User supplies specific audio sources | |
| Placeholder/synthesized only for now | Procedurally-generated tones via Web Audio, real audio later | |

**User's choice:** Research CC0/royalty-free sources.

| Option | Description | Selected |
|--------|-------------|----------|
| All 6 visually and audibly distinct | Matches SURF-02 literally, own treatment per surface | ✓ |
| Group similar surfaces, fewer distinct treatments | e.g. sand/dirt share a treatment, mud/grass share another | |

**User's choice:** All 6 visually and audibly distinct.

---

## Camera Mode-Skin Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Dev-toggle preview of both skins | Build both presentations plus a debug control to switch between them | ✓ |
| Build one skin only, defer the second | Implement sports-broadcast only, police/news as a fast follow | |
| Build the mechanism, no visual skins yet | A "camera skin" interface with no actual visual differentiation yet | |

**User's choice:** Dev-toggle preview of both skins.

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay chrome + color grade | Distinct color grading and HUD chrome per skin, evoking real footage conventions | |
| Minimal — UI label/frame only | Only a small HUD label differs; 3D rendering identical | |
| You decide | Claude researches real footage conventions and proposes treatments | ✓ |

**User's choice:** You decide.

---

## Drift Stability & Go/No-Go Fallback Meaning

| Option | Description | Selected |
|--------|-------------|----------|
| No shake/jitter, smooth lag behind the slide | Camera never snaps/judders but is allowed smooth lag catching up during a fast slide | ✓ |
| Tight lock, near-zero lag | Camera tracks velocity heading almost instantly | |
| You decide | Claude picks a damping approach, tuned during playtest | |

**User's choice:** No shake/jitter, smooth lag behind the slide.

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent fallback if needed | If the helicopter cam genuinely can't convey speed after tuning, the low chase-cam becomes the actual shipped camera | ✓ |
| Dev-only escape hatch, never shippable | The helicopter cam MUST ship regardless; the fallback only unblocks dev/testing | |

**User's choice:** Permanent fallback if needed — a meaningful reframing of PROJECT.md's "permanent helicopter camera" as a target contingent on passing a real human playtest, not a foregone conclusion.

---

## Surface Grip Ranking

| Option | Description | Selected |
|--------|-------------|----------|
| Tarmac > Dirt > Gravel > Grass > Sand > Mud | A reasonable real-world-grounded default ranking | |
| You decide based on research | Claude researches real-world tire-grip coefficients and proposes a ranking | ✓ |
| I have a different order in mind | Custom ranking | |

**User's choice:** Free-text — "You decide - if we're having dusty Dukes of Hazzard style levels they should have appropriate slide and dust!"
**Notes:** Overall ranking is Claude's discretion, but dirt/gravel surfaces specifically must support a pronounced, dramatic slide with heavy matching dust, per the Dukes of Hazzard reference.

---

## Multi-Car Camera Forward-Compatibility

| Option | Description | Selected |
|--------|-------------|----------|
| No — single-car only for now | Design purely around tracking the one car; multi-car framing is Phase 7/8's problem | |
| Yes — keep the targeting mechanism generic | Build target-tracking as a swappable "what am I following" concept now | ✓ |

**User's choice:** Yes — keep the targeting mechanism generic. Mirrors Phase 2's D-09 precedent (vehicle controller built generically ahead of NPC reuse).

---

## Claude's Discretion

- Exact fresh test-scene layout replacing the Phase 2 ramp.
- Surface grip ranking / per-surface friction multipliers (research-informed), respecting the Dukes-of-Hazzard dirt/gravel slide+dust anchor.
- Camera skin visual treatment specifics (color grade, overlay chrome, etc.).
- Exact particle-system implementation details (texture, count, lifetime, emission rate).
- Helicopter camera altitude/FOV curve shape vs. speed.
- Surface-type-to-collider mapping mechanism (user-data vs. `Map<colliderHandle, SurfaceType>` vs. collision groups).

## Deferred Ideas

- Physics-based kicked-up surface debris (small gravity-affected lumps, e.g. mud clods actually kicked up by tire contact) — a future evolution beyond this phase's simple particle-sprite FX.
- Full multi-car camera framing (chase target + pursuers simultaneously in frame) — Phase 7/8's problem once NPCs exist; this phase only ensures the targeting mechanism is generic.
