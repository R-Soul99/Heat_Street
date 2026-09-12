# Phase 3: Surfaces & Helicopter Camera - Context

**Gathered:** 2026-09-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The ground under the tires changes how the car drives and looks/sounds, and the player views the world through the project's signature permanent high-angle helicopter camera. Concretely: per-wheel surface friction (tarmac/gravel/grass/mud/sand/dirt) driving a measurable grip change plus distinct visual/audio feedback per surface, and a velocity-heading-tracking helicopter camera whose altitude/FOV convey speed, that stays stable through hard drifts, that can be skinned per mode context, and that never lets buildings permanently hide the car. No real map data (Phase 4 owns that), no NPC/pursuer AI (Phase 7/8), no game modes with real objective logic (Phase 5) — this phase builds the mechanisms and proves them on a placeholder test scene.

</domain>

<decisions>
## Implementation Decisions

### Surface Test Scene (no real map exists until Phase 4)
- **D-01:** The test scene is a **patchwork of adjacent surface zones** on one flat plane — tarmac, gravel, grass, mud, sand, dirt side by side — so a single straight drive crosses all 6 and directly demonstrates SC1's "driving from tarmac onto gravel produces a measurable grip change."
- **D-02:** This scene does **NOT** reuse Phase 2's ramp — it gets a fresh layout. Exact shape is Claude's discretion (informed by needing room for both the surface zones and the occlusion placeholder buildings below).
- **D-03:** This is a **dev/test fixture only**, matching the precedent of `src/physics/debug-scene.ts` (Phase 1) and `src/physics/vehicle-scene.ts` (Phase 2) — a placeholder proving the mechanism, explicitly superseded once Phase 4's real map pipeline lands. Not intended to survive as shipped content.

### Surface Grip & Feel
- **D-04:** The loosest surfaces (mud, sand) should be **noticeably slippery but stay controllable** — matches the project's "arcade-realistic hybrid" target (CLAUDE.md/PROJECT.md), not an authentically-treacherous simulation where the car can genuinely bog down or become undriveable with normal inputs.
- **D-05:** Overall grip ranking across the 6 surfaces is Claude's research-informed discretion, **with one explicit anchor**: dirt/gravel-style surfaces (the Dukes of Hazzard reference) must support a **pronounced, dramatic slide with heavy matching dust** — this is a specific feel target from the reference films, not just "somewhat loose." Verbatim from the user: *"if we're having dusty Dukes of Hazzard style levels they should have appropriate slide and dust!"*

### Occlusion Prototyping (SC6 — no real buildings until Phase 4)
- **D-06:** Build **placeholder box/cuboid buildings** in the test scene specifically to make SC6's occlusion mitigations genuinely testable this phase, per the roadmap's explicit "not a paper decision" requirement — do not defer the human playtest to Phase 4.
- **D-07:** Building layout is **a few clustered zones of varying density** (e.g. one sparse zone, one dense/urban-canyon-like zone) rather than a random scatter — deliberate enough to stress-test both the occlusion problem itself and the "relaxes in open areas" half of the steepen-camera mitigation.

### Surface FX & Audio
- **D-08:** Visual approach for this phase is **simple GPU particle sprites** (`THREE.Points`, soft puff textures, colored per surface: grey smoke/tarmac, tan dust/gravel-sand, brown spray/mud-dirt, green-tinted/grass) plus skid decals — matches the low-poly/stylized art direction and stays cheap at mid-to-far camera distance.
- **D-09:** All 6 surfaces get **fully distinct visual AND audio treatment** (SURF-02, taken literally) — not grouped/shared treatments across similar surfaces.
- **D-10:** Surface audio assets (tire chirp vs. muffled rumble per surface) are sourced by **researching CC0/royalty-free sources** (e.g. Freesound.org, itch.io packs) as part of this phase's research step — consistent with how the project already sources car models. This is the project's first audio system built from scratch (no `THREE.AudioListener`/`PositionalAudio` exists yet anywhere in `src/`).

### Helicopter Camera Behavior
- **D-11:** "Stable through a full 40-degree drift" (SC3) means **no shake or jitter, with a smooth lag** as the camera catches up to the car's changing velocity heading — should read like a real chopper pilot tracking a car, not a rigid instant lock. Not a near-zero-lag tight lock.
- **D-12:** If the helicopter camera genuinely fails SC4's go/no-go gate after real tuning effort (a human playtester still can't tell 60mph from 110mph on sight), the **low chase-cam fallback becomes the actual shipped/permanent camera**, not merely a dev escape hatch kept alive during tuning. This meaningfully reframes PROJECT.md's "permanent helicopter camera" line as the *target*, contingent on passing a genuine human playtest — not a foregone conclusion regardless of how testing goes.
- **D-13:** The camera's target-tracking mechanism should be built **generic/swappable** ("what am I following") even though only one car exists in the world this phase — reduces rework when Phase 7/8 introduces pursuers and multi-car framing. Mirrors Phase 2's D-09 precedent (vehicle controller built generically ahead of NPC reuse). Multi-car framing itself (keeping a chase target AND pursuers in frame) is explicitly NOT this phase's problem to solve — see Deferred Ideas.

### Camera Mode Skins
- **D-14:** Build a **dev-toggle to preview both** the police/news and sports-broadcast skins this phase, even though the real game modes that would trigger each automatically don't exist until Phase 5. Proves CAM-03's mechanism and lets a human compare the two skins directly.
- **D-15:** Visual differentiation between the two skins is Claude's research-informed discretion — research real news-chopper vs. sports-broadcast footage conventions (color grade, overlay chrome, spotlight/vignette effects, etc.) and propose a distinct treatment for each, refined via playtest.

### Claude's Discretion
- Exact fresh test-scene layout replacing the Phase 2 ramp (D-02).
- Surface grip ranking / per-surface friction multipliers, research-informed, respecting the Dukes-of-Hazzard dirt/gravel slide+dust anchor (D-05).
- Camera skin visual treatment specifics (D-15).
- Exact particle-system implementation details (texture, count, lifetime, emission rate) for surface FX (D-08).
- Helicopter camera altitude/FOV curve shape vs. speed, tuned against SC4's go/no-go gate.
- Surface-type-to-collider mapping mechanism (`wheelGroundObject` → surface type: user-data vs. a `Map<colliderHandle, SurfaceType>` vs. collision groups) — CLAUDE.md's Gaps/Open Items explicitly leaves this undecided; all three are viable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Scope & Decisions
- `.planning/PROJECT.md` — line 34 ("every mode instance uses a persistent high-angle helicopter camera"), line 40 (surfaces requirement), line 72 (camera design-decision table)
- `.planning/REQUIREMENTS.md` §Surfaces (SURF-01, SURF-02) and §Camera (CAM-01, CAM-02, CAM-03, CAM-04)
- `.planning/ROADMAP.md` §"Phase 3: Surfaces & Helicopter Camera" — goal, all 6 success criteria, MVP mode, requirements list
- `.planning/STATE.md` — [Phase 02-10] decision that `rearSideFriction`'s straight-line-stability fix was proven on flat test ground and **should be re-verified once real road surfaces exist** (directly relevant: lower-friction surfaces this phase could reopen that instability at a lower speed); also the open item that SC2's gamepad half remains unverified

### Stack & Technical Reference
- `CLAUDE.md` — the audio system section (`THREE.AudioListener`/`PositionalAudio`, RPM-crossfade technique) since this is the first phase to touch audio at all; the "surface-type → collider mapping" open design question (Gaps/Open Items); the `wheelGroundObject(i)` → per-wheel friction API surface in the Headline Finding table

### Design Reference (partially superseded)
- `heat-street-design-doc.md` §6 "Camera" — early draft (v0.1) reference for the police/news-chopper visual language and the Bullitt/Dukes-era tone; **note its "Getaway/Survival specifically" framing and "player-toggled vs. auto-triggered" open question are SUPERSEDED by PROJECT.md's later decision that the camera is permanent across every mode** — do not treat that draft's mode-specific/toggle framing as current

### Prior Phase Foundations (Phase 2)
- `.planning/phases/02-vehicle-feel-core/02-CONTEXT.md` — D-09 precedent (build the vehicle controller generically ahead of NPC reuse) that this phase's D-13 camera-targeting decision mirrors
- `src/physics/vehicle-scene.ts`, `src/render/vehicle-view.ts` — the "physics scene builder + matching render module with a MUST MATCH comment" pattern this phase's surface/occlusion test scene should follow
- `src/debug/debug-gate.ts` — the `?debug` + dedicated hotkey convention to reuse for the camera-skin dev-toggle and any surface-FX debug controls
- `src/core/vehicle-tuning.ts`, `src/debug/tuning-panel.ts` — the `TUNING_RANGES` + lil-gui panel pattern that likely extends to per-surface friction multipliers and the camera altitude/FOV curve

No other ADRs/SPECs apply to this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/physics/vehicle-scene.ts`'s `buildGround`/`buildRamp` pattern — the new surface test scene follows this same "physics scene builder" shape, extended with per-zone colliders/friction instead of one uniform ground.
- `src/render/vehicle-view.ts`'s per-frame wheel rig and "MUST MATCH" hardcoded-dimension convention — surface visual zones should follow the same "render module mirrors physics constants via a comment, never cross-imports" precedent.
- `src/debug/debug-gate.ts`'s `onDebugKey` — reuse directly for the camera-skin toggle and any surface-FX debug controls.
- `src/core/vehicle-tuning.ts` + `src/debug/tuning-panel.ts` — the `TUNING_RANGES`/lil-gui pattern naturally extends to per-surface friction multipliers and camera tuning knobs.
- `src/physics/telemetry/routines.ts`'s `skidpad` routine — the pattern for a per-surface skidpad sweep (SC1's "measurable grip change" proof) already exists to extend from.

### Established Patterns
- `src/physics/` vs `src/render/` layering split (physics never imports `three`) — the surface-type-per-collider lookup must respect this; see the open discretion item on the exact mapping mechanism.
- Dev/test fixture convention (`debug-scene.ts`, `vehicle-scene.ts`) — this phase's combined surface+occlusion test scene follows the same "placeholder, not shipped content" pattern (D-03).
- `?debug` + dedicated hotkey convention for all dev-facing controls.

### Integration Points
- `src/main.ts` composition root — where the new surface/occlusion test scene replaces `vehicle-scene.ts`'s scene as the active one, and where the camera-skin toggle and the audio-system bootstrap get wired in.
- `src/physics/telemetry/run.ts`'s `runRoutine`/`runAllRoutines` — the shared two-runner harness this phase's per-surface telemetry checks should plug into, following Phase 2's precedent exactly.

</code_context>

<specifics>
## Specific Ideas

- Dukes of Hazzard-style dirt/gravel roads need a **pronounced, dramatic slide with heavy matching dust** — a specific feel anchor from the reference films, not generic looseness (D-05).
- Police/news vs. sports-broadcast camera skins should evoke real news-chopper footage vs. sports-broadcast coverage conventions (color grade, overlay chrome) — left to research, but the reference point is explicit.
- Surface particle effects (smoke/dust/mud spray) are wanted as a **future** physics-based system — small gravity-affected lumps of mud/dirt genuinely kicked up by the tires, not just billboard sprites. Not this phase's scope; see Deferred Ideas.

</specifics>

<deferred>
## Deferred Ideas

- **Physics-based kicked-up surface debris** — small, gravity-affected rigid-body-like lumps (e.g. mud clods) actually kicked up by tire contact, rather than billboard particle sprites. Explicitly a future evolution per the user ("particle sprites for now, but I'd like this to be partly gravity and physics based eventually"). This phase builds the simpler sprite-based version (D-08); the physics-debris version is a distinct, larger-scoped follow-up, not assigned to a specific future phase yet.
- **Multi-car camera framing** (keeping a chase target AND pursuers in frame simultaneously) — Phase 7/8's problem once NPC pursuers exist. This phase only ensures the targeting mechanism is generic (D-13); it does not attempt to solve multi-car framing itself.

None else — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-surfaces-helicopter-camera*
*Context gathered: 2026-09-12*
