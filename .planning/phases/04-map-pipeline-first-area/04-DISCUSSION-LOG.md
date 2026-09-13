# Phase 4: Map Pipeline & First Area - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-13
**Phase:** 4-map-pipeline-first-area
**Areas discussed:** Target area & character, Existing map tool's role, Area size/scope for v1

---

## Target area & character

| Option | Description | Selected |
|--------|-------------|----------|
| Small American town + rural roads | Dukes-of-Hazzard energy: 2-lane roads, gravel/dirt shoulders, open countryside — naturally showcases all six surface types, and US location gets 1m USGS 3DEP elevation | ✓ |
| Dense US city downtown | Bullitt/French Connection urban chase energy: tight grid, one-ways, junctions everywhere — mostly tarmac | |
| Mixed edge-of-city area | Urban core blending into rural/industrial fringe — most surface variety AND junction density, most demanding first target | |
| A specific real place I have in mind | User names an actual location | |

**User's choice:** Small American town + rural roads.

| Option | Description | Selected |
|--------|-------------|----------|
| I'll name a specific place | User provides the actual town/county/region name | |
| Pick a good candidate against criteria | Research picks a real US small town/rural area with strong OSM gravel/dirt tagging and workable size — named and confirmed with the user before compiling | ✓ |

**User's choice:** Pick a good candidate against criteria (real OSM tagging, size, junction variety). No specific real place named — deliberately left to research, but with the candidate to be confirmed before compiling.

| Option | Description | Selected |
|--------|-------------|----------|
| Rural US South | Closest match to the literal Dukes of Hazzard reference — dirt/gravel county roads, open farmland, small-town main street | ✓ |
| Appalachian / hilly terrain | More elevation change and winding roads — harder first compile | |
| Flat Midwest farm-road grid | Simple, regular road network — easiest first compile, less dramatic | |
| No preference — fully open | Researcher picks any US small town satisfying criteria | |

**User's choice:** Rural US South.

| Option | Description | Selected |
|--------|-------------|----------|
| Include a real town center | Matches the "drive through town square" trope, visual landmark, denser junction cluster | ✓ |
| Pure rural county roads, no town center needed | Simpler candidate search, open countryside only | |

**User's choice:** Include a real town center.

**Notes:** The "specific real place" and "no preference" branches were both declined in favor of a middle path — criteria-driven candidate selection by the researcher, with US-South rural flavor and a town center as hard constraints, and final candidate confirmed with the user before compiling for real.

---

## Existing map tool's role

| Option | Description | Selected |
|--------|-------------|----------|
| Build around my existing tool's output | Reuses real working code instead of rebuilding OSM extraction from scratch | |
| Build fresh against the schema, tool as reference only | road-graph.v1.md as the sole contract, compiler written new | |
| Not sure — let the researcher assess the tool first and recommend | Researcher investigates, reports back before this decision locks | ✓ |

**User's choice:** Let the researcher assess first. User then provided the tool's location: **https://github.com/R-Soul99/Geomesh** ("Map Heightmap & 3D GLTF Generator"), after an initial round of confused AskUserQuestion options that didn't fit an open-ended "give me a URL" answer — corrected on the next turn.

| Option | Description | Selected |
|--------|-------------|----------|
| Read source only | Faster, lower risk — confirms output shape from code without needing the tool running | ✓ |
| Try running it for real output | More conclusive but riskier — unknown whether it currently runs, needs API keys, etc. | |

**User's choice:** Read source only.

**Notes:** This decision (build-around vs. build-fresh) is explicitly NOT locked — it's deferred to the researcher's report on what Geomesh actually emits, to be decided during planning.

---

## Area size/scope for v1

| Option | Description | Selected |
|--------|-------------|----------|
| Small, ~1-2 min end-to-end | Tight town + county-road loop — fast to compile/validate/iterate | ✓ |
| Medium, ~3-5 min end-to-end | More varied routes, bigger sense of place, longer compile cycle | |
| Large, open-world-ish sprawl | Most epic chase potential, riskiest first target | |

**User's choice:** Small, ~1-2 min end-to-end. Held even after being explicitly told this is v1's only area and must carry all three modes — user's reasoning: replay value comes from route/medal variety within a dense small area, not raw size.

| Option | Description | Selected |
|--------|-------------|----------|
| Genuine loops and alternate routes | Matches P2P-01's "any route" and gives Getaway evasion real choices | ✓ |
| Simple/mostly-linear is fine for v1 | Lower bar, fewer junctions to validate, weaker chase foundation | |

**User's choice:** Genuine loops and alternate routes.

| Option | Description | Selected |
|--------|-------------|----------|
| Some rolling elevation/crests | Gives the already-proven jump mechanic somewhere real to happen | ✓ |
| Flat is fine for v1 | Simpler DEM/terrain handling, jumps deferred to authored ramps | |

**User's choice:** Some rolling elevation/crests.

---

## Claude's Discretion

Junction geometry generation algorithm, chunking/streaming strategy for collision colliders,
OSM tag resolution beyond what road-graph.v1.md already specifies, OSM extract source
(Geofabrik/BBBike/Overpass), library selection (ngraph.path/ngraph.graph, @gltf-transform/cli),
and overall compiler architecture — none of this was discussed with the user, all left to
research/planning per this workflow's philosophy.

## Deferred Ideas

None raised this session that belong outside Phase 4. Three seeds from the prior Phase 3
session (night-stages-dynamic-headlights.md, dust-cloud-los-evasion.md,
background-music-genre-direction.md) remain relevant background but were not re-discussed.
