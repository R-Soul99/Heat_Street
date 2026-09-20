# Phase 5: Objectives, Navigation & Race Modes - Context

**Gathered:** 2026-09-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the first playable "game" layer on top of the compiled Juliette, GA map: one
Point-to-Point course (unordered checkpoints, any route) and one Circuit course (ordered
checkpoint loop, multiple laps), plus the always-on navigation UI that tells the player where
to go (world-space beacon, road-aware directional arrow, minimap) and fast-retry mechanics
(respawn at last checkpoint with a time penalty, instant full-level restart). This phase does
NOT deliver AI racers/pursuers (Phase 7), medal timing or best-time persistence (Phase 6), or
any additional map area — it is scoped entirely to making the one existing compiled area
actually playable as two race-mode shapes.

</domain>

<decisions>
## Implementation Decisions

### Checkpoint Authoring & Courses

- **D-01:** Checkpoints for both courses are hand-authored in a new sibling data file (e.g.
  `public/maps/juliette-ga.routes.json` or similar — exact name/location is Claude's
  discretion), not auto-generated from road-graph junction nodes. This follows the project's
  established hand-authored-deterministic philosophy (phase 04.1's terrain crests were
  hand-placed the same way) and directly resolves `docs/schemas/road-graph.v1.md`'s own note
  that "route/checkpoint authoring may move to a sibling file in Phase 5."
- **D-02:** Ship exactly one Point-to-Point course (~5-8 checkpoints) and one Circuit course
  (~4-6 checkpoints forming the lap) for Juliette, GA in this phase. Do not build a course
  editor or multiple course variants — that's future-phase scope if ever needed.
- **D-03:** Both courses should intentionally route across mixed surfaces — at least one
  gravel/dirt stretch per course, not tarmac-only — so the surface-grip mechanic (Phase 3) is
  actually exercised by the race modes that use it.
- **D-04:** Checkpoint and course placement MUST avoid the known open geometry defect
  coordinates recorded in `.planning/STATE.md`'s `[Phase 04.1, open]` items (from
  `04.1-10-SUMMARY.md`'s D-06 sign-off session), until those are fixed in a separate pass:
  - Road-texture rendering gap at (-633.25, -134.43)
  - Ragged/zigzag road-edge geometry at (-420.0, 102.2), (-1227.2, -1062.3) and (-384.66, 229.75)
  - Junction gravel-through-tarmac artifact at (1167.69, 195.84), (891.84, 240.86), (1048.35, 215.10)
  - Building with inverted-normals-looking geometry at (1039.58, 344.87)

  Course/checkpoint authoring should route around these coordinates with reasonable margin
  rather than through them.

### Checkpoint Feel & Detection

- **D-05:** The checkpoint beacon is a vertical light pillar — a tall, glowing translucent
  column rising well above building height — not a ring/gate the car drives through. Chosen for
  visibility from the permanent high-angle helicopter camera and to directly satisfy the "beacon
  visible over buildings" success criterion.
- **D-06:** Checkpoint detection uses a generous sensor volume — spanning the full road width
  and tall enough to catch a car airborne over that spot — rather than a precise plane-crossing
  test. This is a deliberate arcade-feel choice, not a simulation-precision one, and directly
  targets the "registers even at 150mph or mid-jump" success criterion.
- **D-07:** On checkpoint hit: a short audio chime plays, the beacon changes color (current
  target vs. visited — exact colors are Claude's discretion), and the arrow/minimap immediately
  retarget to the next objective. No screen flash or HUD counter-tick animation — feedback stays
  visual-first and doesn't interrupt the drive.
- **D-08:** Once visited, a checkpoint's beacon disappears entirely (not dimmed, not left
  visible) — keeps the world-space view and minimap uncluttered as courses progress.

### Minimap Presentation

- **D-09:** The minimap is north-up and does not rotate with the car's heading — the car icon
  rotates on a fixed map instead. Chosen deliberately over the more common heading-up rotating
  convention because it reads like a real broadcast/police map overlay, matching the permanent
  helicopter-camera framing established in Phase 3.
- **D-10:** The minimap is zoomed in and follows the player within a fixed radius (not a
  whole-course fixed-zoom view), combined with off-screen edge indicators (blips at the map's
  edge) pointing toward any checkpoint that falls outside the visible radius. This was the
  developer's own explicit combination — chosen specifically to get close-in road detail without
  losing "always knows where every remaining checkpoint is."
- **D-11:** Minimap visual style is a dark (near-black) background with bright, high-contrast
  road polylines and colored dots for checkpoints — a tactical/broadcast-map look, not a
  translucent world-overlay.
- **D-12:** The minimap sits in the bottom-left corner of the screen. This deliberately reserves
  the top-right corner for the existing speedometer and Phase 6's planned medal-split HUD, and
  the top-left for future mission-brief text, so neither collides with the minimap later.

### Circuit & Fast-Retry Feel

- **D-13:** The Circuit course is 3 laps.
- **D-14:** Wrong-way state is signalled with a clear on-screen "WRONG WAY" HUD banner plus a
  subtle red vignette/tint at the screen edges — visual-first, matching D-07's feedback
  philosophy, strong enough to notice mid-corner without fully obscuring the view.
- **D-15:** Instant level restart includes a very brief (~100-150ms) screen flash/fade — not a
  true zero-transition hard cut — while still comfortably meeting the "well under a second, no
  loading screen" success criterion.

### Claude's Discretion

- **Respawn-at-last-checkpoint time penalty amount (D-16 placeholder):** the developer
  explicitly deferred this ("you decide"). Pick a specific flat penalty value (not proportional
  to distance — a flat penalty was the framing offered and not objected to) and document the
  reasoning for later tuning, the same way Phase 2/3/4 constants (`SMOOTHING_WINDOW`,
  `HEIGHTFIELD_SINK_M`, etc.) were introduced as reasoned defaults.
- **Exact sibling checkpoint-file name/location and its schema shape** (D-01) — follow
  `src/core/crest-geometry.ts`'s precedent (a small, hand-authored, well-commented data module)
  unless a JSON sidecar proves more consistent with `road-graph.v1.md`'s own file-family
  conventions; either is acceptable, just be consistent and documented.
- **The road-aware directional arrow's own visual presentation** (a 3D floating arrow above the
  car vs. a fixed HUD-corner compass-style widget) was NOT discussed this session — NAV-04
  locks that it must be "road-aware" (follows the actual road path via `ngraph.path`, not a
  straight-line compass bearing to the target), but its on-screen FORM is open. Pick something
  consistent with the beacon/minimap decisions above (visual-first, uncluttered) and document
  the choice.
- Exact checkpoint colors (current-target vs. visited), chime sound design, and edge-indicator
  blip visual style are all open — pick values consistent with the existing HUD/audio patterns
  from earlier phases.
- Exact P2P/Circuit checkpoint node/coordinate picks on the real Juliette, GA map — the
  constraints (D-02's count, D-03's mixed-surface requirement, D-04's defect-avoidance) are
  locked; the specific nodes are a researcher/planner job against the real compiled artifact.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Road graph & checkpoint schema (the decision this phase resolves)
- `docs/schemas/road-graph.v1.md` — normative road-graph shape; explicitly notes checkpoint
  authoring "may move to a sibling file in Phase 5" (line 81) and lists the Consumers table
  (NAV-03/04/05, P2P-01, CIRC-01) this phase must satisfy
- `fixtures/road-graph.sample.json` — a conforming sample of the schema above
- `public/maps/juliette-ga.map.json` — the real compiled area: 50 nodes (36 junctions), 64
  edges, one existing spawn point at node 16

### Prior decisions this phase must not contradict
- `docs/adr/0004-first-area-and-compiler-decisions.md` — decision 5 (shared `src/core/`
  road-geometry algorithm between compiler and runtime), decision 7 (superseded by phase 04.1
  — see below), Open Question 1 (the node-45-class junction gravel bug, confirmed still present
  across three junctions per plan 04.1-10)
- `docs/adr/0001-map-data-source.md` — the phase 04.1 amendment; elevation/terrain context for
  where checkpoints and courses sit relative to authored crests and off-road relief
- `.planning/STATE.md` Blockers/Concerns — the four `[Phase 04.1, open]` defect coordinates
  (D-04 above) and the still-open node-45-class junction item

### Prior phase precedent for hand-authored data
- `src/core/crest-geometry.ts` — the phase 04.1 precedent for a small, hand-authored,
  well-commented data module (three named terrain crests with coordinates/radius/height) —
  the closest existing analog to D-01's checkpoint-course authoring

### Reusable HUD/camera systems
- `src/hud/speedometer.ts`, `src/hud/map-credit.ts` — the existing absolutely-positioned
  DOM-over-canvas HUD pattern (`pointer-events:none`) this phase's minimap/beacon-feedback/
  wrong-way banner should follow
- `src/render/camera/camera-skin.ts` — `CAMERA_SKINS = ["police", "sports"]` already exists
  from Phase 3; the "sports" skin is the race-mode camera reskin this phase needs to ACTIVATE,
  not build from scratch

### Requirements
- `.planning/REQUIREMENTS.md` — NAV-03 through NAV-07, P2P-01, CIRC-01 (this phase's scope);
  NAV-02 (Phase 6) and CIRC-02 (Phase 7) are explicitly NOT this phase's scope

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/render/camera/camera-skin.ts`'s `"sports"` camera skin — built in Phase 3, unused until
  now. Race modes should call `cameraSkin.set("sports")` (or equivalent) rather than building a
  new reskin mechanism.
- `ngraph.graph`/`ngraph.path` are already installed dependencies (`package.json`) — the
  road-graph schema's node-id design (dense compiler-assigned integers) was chosen specifically
  for this. NAV-04/05's road-aware arrow and pathfinding should use these directly, not a new
  pathfinding library.
- `src/hud/speedometer.ts` / `src/hud/map-credit.ts` — the established HUD DOM pattern to
  extend for the minimap, beacon-hit feedback, wrong-way banner, and lap counter.

### Established Patterns
- Hand-authored, well-commented, deterministic data modules for designer-placed content
  (`src/core/crest-geometry.ts`) — D-01 follows this same pattern for checkpoints/courses.
- Reasoned-default constants documented with their failure-mode bracket, retuned empirically
  against the real compiled area (`SMOOTHING_WINDOW`, `HEIGHTFIELD_SINK_M`,
  `TARGET_SHOULDER_WIDTH_M` from earlier phases) — applies to D-16's respawn penalty value.

### Integration Points
- The new checkpoint/route sibling file (D-01) sits alongside `public/maps/juliette-ga.map.json`
  and is loaded by `src/main.ts`'s composition root the same way the map graph/collision/glb are
  today.
- Minimap needs `edges[].points` and `bounds` from the road graph (already present); no
  road-graph schema change is required for the minimap itself.

</code_context>

<specifics>
## Specific Ideas

- Minimap: zoomed/follow-player with off-screen edge indicators for far checkpoints — the
  developer's own explicit combination, not one of the two originally offered options (D-10).
- Wrong-way signalling: HUD banner + red tint, matching the visual-first feedback philosophy
  used throughout this discussion (D-07, D-14).

</specifics>

<deferred>
## Deferred Ideas

None raised this session that belong to a different phase — all four discussed areas
(checkpoint authoring, checkpoint feel, minimap, circuit/retry feel) stayed within this phase's
own scope.

### Reviewed Todos (not folded)

`gsd-sdk query todo.match-phase 5` returned zero matches — no pending todos related to this
phase's scope.

</deferred>

---

*Phase: 05-objectives-navigation-race-modes*
*Context gathered: 2026-09-20*
