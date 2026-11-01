# GSD Brief: Driveable Terrain (Phase 4.2) and Map Tools

Status: agreed in chat on 1 Nov 2026, **before any building**. Intended as input to GSD (`/gsd:insert-phase`, then `/gsd:discuss-phase`). This brief **supersedes the "Architecture" items 1-3 in Revision 2 of `claude/map-authoring-plan.md`** (the road-spline-first approach); everything else in that doc still stands.

## Why
- The user finds the 2D editor (`tools/map-editor`) hard to use: drawing roads point by point, moving things afterwards, no 3D view, clumsy navigation and panel.
- Wants Populous-style terrain sculpting, with hills you can **drive up and down**, not scenery.
- Wants ramps now, bridges and overpasses eventually, and mostly **hand-built maps** (invented towns, race tracks); real areas are a bonus.
- Phase 4.1 (flat terrain, no DEM) is still open on the roadmap and its core idea (everything flat) is being reversed.

## Why hills failed before (ADR 0001, phase 04.1 amendment)
Height was stored twice: the road followed its own smoothed centreline and the terrain came from a coarse grid (about 43m cells). They had to agree to within centimetres, but averaged a 5.09m gap, forcing a 20m shoulder skirt (median ramp grade 12.9 degrees, p95 26.9) and 123 terrain-above-road violations. Flattening everything removed the problem but also hills.

## Core design: terrain is the single source of truth
- **One surface.** Terrain is a grid. Every cell has a height and a surface type. There is **no separate road mesh on the ground**, so a road cannot float or sink.
- **Height grid:** configurable per area, default about 3m (2m for small maps, coarser for big ones). Stored as a compact binary file (16-bit heights), not JSON. Rendered and updated in chunks.
- **Surface paint map:** separate and finer (about 0.25-0.5m per pixel), rendered smoothed with soft edges. Physics reads the same map at each wheel position, so curves need no special corner pieces and edge grip is right even though the heights are coarser.
- **Sculpting (Populous-style):** raise/lower, smooth and flatten brushes; neighbours follow on a falloff; a slope limit prevents spikes. Smoothing and interpolated normals are required so the car does not jitter on hand-sculpted ground.
- **Road brush (the key tool).** Painting one stroke does three things at once:
  1. paints the surface type (tarmac, gravel, etc.) into the paint map;
  2. smooths and levels heights along the stroke, with optional banking;
  3. records the stroke's centreline as the **road graph** (nodes and edges, same schema fields: width, lanes, one-way, surface), used by AI pathfinding, minimap, checkpoints and route placement.
  Plain surface paint (mud, sand, grass) does not create graph edges. No road is ever drawn twice.
- **Bridges, overpasses, tunnels:** a heightfield has one height per spot, so these stay as **separate elevated ribbon meshes** (the schema already has `bridge`, `tunnel`, `layer`). Keep the existing ribbon/collision code; do not delete it. Later phase.
- **Ramps and other objects:** objects, not terrain. **Mesh ramps** (parametric: length, width, height, curve) with their own collider for sharp kicker lips and jumps, placed with a transform gizmo at any height or rotation. **Heightfield stamps** (wedge/mound brushes) for big earth ramps and hills. Each object stores type, x/z, rotation, scale, parameters and a height mode: "on ground" (follows terrain, re-seats if sculpted later, default) or "fixed". Sink mesh bases slightly into terrain (as `HEIGHTFIELD_SINK_M` does) to avoid seams. Existing authored crests use the same object model.

## Roadmap change (agreed)
1. **Insert Phase 4.2: Driveable Terrain** (absorbs and closes Phase 4.1) before Phase 5.
2. **Phases 5, 7, 8 unchanged**, but built on terrain with real heights so checkpoints, respawns, navigation and medal times are not reworked later.
3. **New milestone: Map Tools**: full 3D editor (snap-together and curved road pieces, mesh ramps, objects, drive-here), then bridges and overpasses. Newton Poppleford import is last and optional (the user's export is saved in chat; its terrain `.glb` would be ignored).

## Phase 4.2 goal and proposed success criteria
**Goal:** a hand-sculpted, hand-painted hilly area that a car can drive over smoothly, built with a small 3D sculpt page.
1. **Prototype gate on `feel-test` first:** a hill, a banked bend and a road climbing a slope drive smoothly (no jitter, no road floating or buried, no wheel catching on seams). **Hard checkpoint: if this fails, stop before touching the real pipeline.**
2. Binary heightfield and paint map load in the game; surface type under each wheel comes from the paint map; terrain renders in chunks within the frame budget (`docs/frame-budget.md`).
3. A small 3D sculpt page (orbit camera, top-down toggle, raise/lower/smooth/flatten/surface/road brushes, undo, **drive here**) can create a hilly map from scratch and save it.
4. Road brush produces a valid road graph that existing pathfinding, minimap and route code can consume.
5. Existing maps (`feel-test`, `grid-test`, `juliette-ga`) still compile and drive, or are migrated with documented differences.
6. Car handling tuning (docs/vehicle-tuning-guide.md) re-verified on slopes: no regressions on flat ground.

## Questions for GSD's discuss-phase (not yet decided)
- Target frame rate and minimum hardware; maximum area size per map.
- Steepest grade to allow, and whether the slope limit is global or per-brush.
- How many hand-built maps are in v1, and what race types they need.
- How bridge ends should meet the ground (ramps up to deck, abutment carve).
- Whether existing ribbon-based maps are migrated to the new terrain or kept on the old pipeline as a legacy path.
- Migration of existing medal times, routes and `.collision.json` once heights change.
- Undo depth and file format versioning for the new area files.

## Risks
- Phase 4.2 is bigger and riskier than a normal phase: it rewrites how roads meet terrain. Mitigated by the prototype gate.
- Finer grids raise render, physics and file-size costs (a 3.5 x 1.7km area at 3m is about 660k vertices); must be measured on the real build.
- Hand-sculpted ground feels bumpy to a raycast car unless smoothing and normal interpolation are built in from the start.
- Cannot represent overpasses in the heightfield; deliberate, see bridges above.
