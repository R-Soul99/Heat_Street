# Phase 4: Map Pipeline & First Area - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Phase Boundary

One real-world-derived area, compiled offline by a repeatable command from OpenStreetMap +
open-DEM source data into a versioned `.glb` + `.map.json` conforming to
`docs/schemas/road-graph.v1.md`, drivable end to end with no seams/bumps/wedged intersections,
with surface types carried through automatically (no hand-tagging) and a validator confirming
every road is reachable. This phase delivers the map itself and the compiler that builds it —
it does NOT deliver checkpoints, navigation UI, race modes, medals, AI, or heat (those are
Phases 5-8, all consumers of this phase's road graph).

</domain>

<decisions>
## Implementation Decisions

### Target area & character

- **D-01:** The first (and, per the current roadmap, v1's ONLY) area is a small American town
  plus its surrounding rural county roads — not a dense city downtown, not a mixed
  edge-of-city area.
- **D-02:** No specific real town is named yet. The phase-researcher selects a real candidate
  against explicit criteria: genuine OSM `surface=gravel/dirt/unpaved/etc.` tagging present (not
  just `highway=residential` everywhere defaulting to tarmac), a workable size (see D-06), and
  decent junction/route variety. **The candidate must be confirmed with the user before the
  compiler is pointed at it for real** — this is not a fully autonomous choice.
- **D-03:** Regional flavor: rural US South specifically — the closest real match to the
  project's own Dukes-of-Hazzard reference point (dirt/gravel county roads, open farmland,
  small-town main street). This also secures the better DEM source under `docs/adr/0001`'s
  selection rule (US location → USGS 3DEP at 1m, not Copernicus GLO-30 at 30m).
- **D-04:** The area must include a real town center (an actual Main Street / town square to
  drive through) — not a pure rural road network with no landmark. This gives a visual
  orientation point and a denser junction cluster alongside the open county roads.

### Existing map tool's role

- **D-05:** The user has an existing tool, "Map Heightmap & 3D GLTF Generator," at
  **https://github.com/R-Soul99/Geomesh** (OSM/Overpass-based; `.planning/PROJECT.md` previously
  called it "the preferred pipeline," and `docs/adr/0001-map-data-source.md` confirms its
  exported game data is not Google-derived — only its on-screen preview imagery is, which never
  ships). Whether Phase 4's compiler is built around this tool's actual output, or built fresh
  directly against `road-graph.v1.md`, is **explicitly undecided** — the user does not know
  which is right without more information.
- **D-06:** The phase-researcher's job: read Geomesh's source (READ ONLY — do not attempt to
  run it; unknown setup/dependency state, and running it was explicitly deprioritized as
  higher-risk for lower marginal information this session) and report back what it actually
  emits — its output schema/format, how far that is from `road-graph.v1.md`'s normative shape,
  and a recommendation on build-around-it vs. build-fresh. This recommendation is an input to
  planning, not yet a locked decision.

### Area size/scope for v1

- **D-07:** Small — roughly 1-2 minutes to drive end to end. Held even after being explicitly
  told this is v1's only area (no Area 2/3 until v2) and must carry all three v1 modes (P2P,
  Circuit, Getaway) for long-term medal-time replay: the user's reasoning is that replay value
  comes from route/medal variety within a dense small area, not from raw map size.
- **D-08:** The road network must have genuine loops and alternate routes, not a mostly-linear
  layout with a few branches — required for P2P-01's "any route" checkpoint completion and for
  Getaway's evasion gameplay to have real choices. A real small town's grid naturally has this,
  so this is primarily a selection-criteria note for the researcher (reject candidates that are
  essentially one through-road), not extra construction work.
- **D-09:** The terrain should include some real rolling elevation/crests, not flat ground —
  tying back to the Core Value's explicit "jumps" callout (`.planning/PROJECT.md`) and Phase 2's
  already-proven ramp/jump mechanic (`02-06-SUMMARY.md`: monotonic climb, airborne launch past a
  1.6m crest). This is a candidate-selection factor, not a requirement to author artificial
  ramps.

### Claude's Discretion

Everything the researcher/planner would normally own without asking: junction geometry
generation algorithm, chunking/streaming strategy for collision colliders, exact OSM tag
resolution beyond what `road-graph.v1.md` already specifies, which OSM extract source
(Geofabrik/BBBike/Overpass) to pull from, library selection (e.g. `ngraph.path`/`ngraph.graph`
per `.planning/research/STACK.md`, `@gltf-transform/cli`), and the compiler's internal
architecture. None of this was discussed with the user — it is downstream research/planning
territory per this workflow's own philosophy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Map data & licensing (frozen, non-negotiable)
- `docs/adr/0001-map-data-source.md` — the single authoritative answer to where map data comes
  from (OpenStreetMap + open DEM only), the US-vs-non-US DEM selection rule, the Google-data
  prohibition, and the explicit note that Geomesh's exported game data is not Google-sourced
  (only its preview imagery is, and that never ships)
- `tests/no-google-pipeline.test.ts` — mechanically enforces the prohibition above

### Road graph contract (normative — the compiler's output shape)
- `docs/schemas/road-graph.v1.md` — the full normative schema this compiler must emit: node/edge
  shape, the six-value closed `surface` enum, the OSM `surface=*` → game-surface mapping table,
  provenance/attribution requirements, and the "unmapped OSM value fails the BUILD" rule
- `fixtures/road-graph.sample.json` — a conforming sample artifact
- `tests/road-graph-schema.test.ts` — machine-checks any generated artifact against the schema

### The existing extraction tool (role undecided — see D-05/D-06)
- **https://github.com/R-Soul99/Geomesh** — user's own OSM/Overpass-based extraction tool;
  researcher reads its source (does not run it) and reports actual output format

### Downstream consumers (why the road graph is shaped the way it is)
- `.planning/REQUIREMENTS.md` — NAV-03/04/05/06, P2P-01, CIRC-01/02, GET-01/03 all consume this
  phase's road graph (§"Map Pipeline" cross-reference note near the requirements traceability
  table)
- `src/core/surface-types.ts` — the runtime's `SurfaceType`/`SURFACE_TYPES` mirror of the
  schema's closed enum; any compiler surface-mapping output must resolve to exactly these six
  values

### Project-level
- `.planning/ROADMAP.md` Phase 4 section — goal, success criteria, and the "Notes" section
  flagging Phase 4 as "the largest unknown in the project" (junction geometry generation,
  extractor-format handoff, OSM tag resolution) — a strong signal to plan with
  `--research-phase`
- `.planning/PROJECT.md` — Core Value ("weighty, cinematic... big slides, tire smoke, jumps"),
  the Dukes-of-Hazzard/rural-chase-cinema tone references informing D-01/D-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docs/schemas/road-graph.v1.md` + `fixtures/road-graph.sample.json` +
  `tests/road-graph-schema.test.ts`: the contract, a conforming example, and a machine check are
  ALL already written (Phase 1). This phase implements the compiler that satisfies them, not the
  contract itself.
- `src/core/surface-types.ts`: the runtime enum the compiler's surface-mapping output must
  target exactly.

### Established Patterns
- `docs/schemas/road-graph.v1.md`'s own "Design decisions" section already locks several
  expensive-to-change choices the compiler must follow: local ENU metres Y-up with a recorded
  lat/lon origin; dense compiler-assigned integer node/edge ids (OSM ids kept for provenance
  only); edges stored undirected with a `oneway` flag (serves collision/minimap/pathfinding from
  one representation); `y` authored by the compiler from a smoothed DEM sample along each
  centreline, never sampled at runtime.
- `.planning/research/STACK.md` recommends `ngraph.path` + `ngraph.graph` for pathfinding
  against this exact graph shape, and `@gltf-transform/cli` for offline model optimisation —
  neither is installed yet (`package.json` currently has zero map/graph-related dependencies).

### Integration Points
- `src/physics/surface-scene.ts` is Phase 3's explicit placeholder fixture (14 hand-placed
  boxes, flat colored ground bands) — CONTEXT.md D-03 in Phase 3 already states it is
  "superseded by Phase 4's real map pipeline." This phase's compiled area replaces it as the
  scene the vehicle drives in; Phase 3's per-surface friction/FX/audio systems consume whatever
  `edges[].surface` values the compiled map emits, unchanged.
- `src/render/camera/occlusion-controller.ts`'s fade/steepen/off mitigation and
  `docs/adr/0003-occlusion-mitigation.md`'s decision (fade ships; steepen has a known, separately
  logged fan-ray bug) will need re-evaluating once real building density exists — flagged in
  that ADR's own "what would justify revisiting" section, not a Phase 4 requirement to act on
  now.

</code_context>

<specifics>
## Specific Ideas

- The "drive through the town square" moment is explicitly wanted (D-04) — a real Main Street
  the player recognizes as a landmark, not just abstract road segments.
- Rural US South specifically for tone (D-03) — this is a deliberate echo of the game's own
  Dukes-of-Hazzard chase-cinema reference, not an arbitrary regional pick.

</specifics>

<deferred>
## Deferred Ideas

None raised this session that belong to a different phase — all four areas discussed stayed
within Phase 4's own scope (target area, tool assessment, size/shape). Two unrelated ideas
captured as seeds in the prior Phase 3 session (`night-stages-dynamic-headlights.md`,
`dust-cloud-los-evasion.md`, `background-music-genre-direction.md`) remain relevant background
for whenever Phase 4's compiled geometry makes them buildable, but were not re-discussed here.

### Reviewed Todos (not folded)

None — `gsd-sdk query todo.match-phase 4` returned zero matches.

</deferred>

---

*Phase: 4-map-pipeline-first-area*
*Context gathered: 2026-09-13*
