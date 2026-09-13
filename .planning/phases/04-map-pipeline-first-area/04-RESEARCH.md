# Phase 4: Map Pipeline & First Area - Research

**Researched:** 2026-09-13 (Geomesh Investigation section updated same day, after the user made
the repository public mid-session)
**Domain:** Offline OSM-to-drivable-road-graph compilation (geodata processing, procedural mesh generation, physics collision authoring)
**Confidence:** MEDIUM-HIGH overall (HIGH on schema/licensing/library facts verified against source, and now HIGH on the Geomesh data-sourcing finding below, directly read from source; MEDIUM on junction-geometry findings, which are reasoned/adapted rather than copy-verified against a shipped implementation of this exact pipeline)

## Summary

Phase 4 builds a **Node-only, offline CLI tool** — not browser code — that turns a live Overpass
API query plus a USGS 3DEP elevation raster into the two artifacts `docs/schemas/road-graph.v1.md`
already specifies: a `.map.json` road graph and a companion `.glb`. Three findings dominate this
research pass.

**First:** the user's existing "Geomesh" tool at `https://github.com/R-Soul99/Geomesh` was
initially unreachable (404 at research time — the repo was private) but was made public mid-session
and then read directly. Verdict: **its road and building extraction is genuinely reusable, its
elevation pipeline is not.** `server.ts`'s `/api/roads/network` and `/api/buildings/structures`
endpoints are both pure OpenStreetMap Overpass queries (`highway=*` and
`building=*`/`man_made=*`/`amenity=*` respectively) returning GeoJSON — zero Google involvement,
confirmed by grepping `gltfExporter.ts`/`roadRenderer.ts`/`buildingRenderer.ts` for any mention of
"google" (none found) and by reading the road/building route handlers directly. The
`buildings/structures` endpoint already infers real height from OSM `height`/`building:levels`
tags — directly answering Open Question 2 below (building/landmark geometry is genuinely cheap to
add, not a from-scratch design problem). Google Maps Platform (`@vis.gl/react-google-maps`,
`GOOGLE_MAPS_API_KEY`) appears only as an **optional** elevation/geocoding accelerant with an
automatic open-data fallback (Terrarium DEM / Open-Meteo / Nominatim) when no key is set, and as
an allowed proxy host for on-screen satellite/Street View **preview** imagery — exactly the shape
ADR 0001 already anticipated and cleared ("its exported game data already comes from OpenStreetMap
via Overpass... What is prohibited is its Google satellite/Street View preview imagery ever being
baked into an export"). **User-confirmed decision:** port/adapt Geomesh's road + building Overpass
query logic into the new compiler (real reuse of working, license-clean code); do NOT reuse its
elevation pipeline — Geomesh defaults to 30m Terrarium tiles, which is not one of ADR 0001's two
approved DEM sources (USGS 3DEP / Copernicus GLO-30), so the compiler fetches USGS 3DEP 1m
directly instead, per the ADR's own selection rule for a US-based area. See "Geomesh Investigation"
below for the full source-reading evidence.

**Second:** a live Overpass API query against Juliette, GA (Monroe County — the real-world
inspiration for the "Whistle Stop Café" of *Fried Green Tomatoes*, a genuine small-town Main
Street) confirms it satisfies every one of D-01–D-09's candidate criteria with real, queried data:
gravel/unpaved surface tags genuinely present (not just untagged `residential` defaulting to
tarmac), a real town core, rolling Piedmont elevation (~33 m of relief across the candidate box),
and a road network with real junction/loop variety. **User-confirmed as the target area.**

**Third:** the existing runtime already dictates the collision-authoring granularity. Phase 3's
`src/physics/surface.ts` (`SurfaceMap`) is a `ColliderHandle -> SurfaceType` side-table with
**one surface per collider**, not per-triangle. This means the compiler cannot emit one giant
merged road trimesh — it **must** emit one collider per edge (or per contiguous same-surface
run), which conveniently also satisfies `.planning/research/STACK.md`'s "chunked colliders over
one giant mesh" guidance for an entirely different reason (broadphase performance) that turns out
to be the same answer. The render-side `.glb` has no such constraint and should be one merged
mesh for draw-call budget reasons — visual and physics geometry deliberately diverge in
granularity.

**Primary recommendation:** build a Node CLI at `tools/map-compiler/` (outside `src/`, so it can
use real `node:fs`/`node:https` without violating the browser-layering rules `tests/layering.test.ts`
enforces) that (1) queries Overpass for roads and buildings using query shapes ported from
Geomesh's `server.ts` (`/api/roads/network`, `/api/buildings/structures` — both already
production-tested Overpass QL against real areas including this session's own Juliette, GA
queries), (2) fetches a USGS 3DEP `exportImage` GeoTIFF directly for the confirmed bounding box
(NOT Geomesh's Terrarium/Google elevation path — see Geomesh Investigation), (3) builds the
node/edge graph with compiler-assigned dense ids, offset-ribbon + angle-sorted junction-fan
geometry for render and collision, DEM-sampled and endpoint-clamped-smoothed elevation, and the
locked surface-enum mapping table, plus lightweight building footprint geometry adapted from
Geomesh's height-inference logic for D-04's Main Street landmark, and (4) validates the result
(undirected reachability + geometry sanity) before writing `.map.json` + `.glb`.

## User Constraints

### Locked Decisions

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
- **D-05:** The user has an existing tool, "Map Heightmap & 3D GLTF Generator," at
  **https://github.com/R-Soul99/Geomesh** — whether Phase 4's compiler is built around this
  tool's actual output, or built fresh directly against `road-graph.v1.md`, was explicitly
  undecided pending this research.
- **D-06:** The phase-researcher's job: read Geomesh's source (READ ONLY) and report back what it
  actually emits, with a build-around-it vs. build-fresh recommendation. **See "Geomesh
  Investigation" below — the repository could not be located.**
- **D-07:** Small — roughly 1-2 minutes to drive end to end.
- **D-08:** The road network must have genuine loops and alternate routes, not a mostly-linear
  layout with a few branches.
- **D-09:** The terrain should include some real rolling elevation/crests, not flat ground.

### Claude's Discretion

Everything the researcher/planner would normally own without asking: junction geometry
generation algorithm, chunking/streaming strategy for collision colliders, exact OSM tag
resolution beyond what `road-graph.v1.md` already specifies, which OSM extract source
(Geofabrik/BBBike/Overpass) to pull from, library selection (e.g. `ngraph.path`/`ngraph.graph`
per `.planning/research/STACK.md`, `@gltf-transform/cli`), and the compiler's internal
architecture. None of this was discussed with the user — it is downstream research/planning
territory per this workflow's own philosophy.

### Deferred Ideas (OUT OF SCOPE)

None raised this session that belong to a different phase. Two unrelated seeds from Phase 3
(`night-stages-dynamic-headlights.md`, `dust-cloud-los-evasion.md`) and one background-music
seed remain relevant only once Phase 4's compiled geometry exists to build on — not re-discussed
this session.

## Phase Requirements

Phase 4 carries no requirement IDs of its own (confirmed in `REQUIREMENTS.md`'s traceability
table). It is enabling infrastructure for requirements verified in later phases:

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-03 | Always-on minimap showing checkpoints/position | `edges[].points` + `bounds` are drawn directly onto a 2D canvas (schema's own "Consumers" table) — no research gap. |
| NAV-04/05 | Road-aware directional arrow, nearest/next targeting | `ngraph.path`/`ngraph.graph` over the dense-integer node/edge ids (confirmed current on npm, see Standard Stack) is the pathfinding substrate; this phase must emit a graph ngraph can consume with zero adaptation. |
| P2P-01 | Any-order, any-route checkpoint completion | Requires D-08's genuine loops — validated live for the primary candidate (see Target Area Selection). |
| CIRC-01/02 | Ordered checkpoint loop, AI racers | Requires the same road graph topology; AI pathfinding consumes `edges[]` exactly as P2P/NAV do. |
| GET-01/03 | Pursuer pathfinding, roadblocks | Same graph topology; roadblock placement is a node/edge selection on this same structure. |

## Architectural Responsibility Map

This project has no server/CDN tiers — it is a browser-only runtime plus an offline Node build
tool. The tiers below are this project's actual shape.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OSM/DEM data fetch, graph construction, mesh/collider authoring | **Offline Compiler** (new `tools/map-compiler/`, Node CLI) | — | Needs real `node:fs`/network access; `src/core` is mechanically forbidden from touching either (`tests/layering.test.ts`). Must live outside `src/`. |
| Map validation (reachability/pathability) | **Offline Compiler** (build-time gate) | — | SC5 requires failures to be loud at build time, not discovered at runtime. |
| `.map.json` / `.glb` loading at runtime | **Browser Runtime — src/physics + src/render** | — | Existing `src/physics/surface.ts` (`SurfaceMap`) and `src/physics/surface-scene.ts` are the exact seam this phase's output must plug into; already built by Phase 3. |
| Per-edge collision colliders | **Browser Runtime — src/physics** | — | One `ColliderDesc.trimesh` (or convex ribbon) per edge/surface-run, registered into `SurfaceMap` by collider handle — dictated by Phase 3's existing side-table design, not a free choice. |
| Merged visual road mesh | **Browser Runtime — src/render** | Static Assets (`public/`) | Decoupled from collision granularity for draw-call budget; ships as the compiled `.glb`, loaded via `GLTFLoader` from `public/` (map data is per-level and lazy-loaded, per `.planning/research/STACK.md`'s asset-pipeline guidance). |
| Credits/attribution string | **Browser Runtime — src/hud (or a menu screen, Phase 5+)** | — | Generated from `attribution` block in `.map.json`, per ADR 0001/schema design decision 6. |

## Geomesh Investigation (D-05/D-06)

**Update, same session:** initially unreachable (404, three independent checks — see git history
of this document for that evidence), the repository was **made public by the user mid-session**
and then read directly via the GitHub REST API + `raw.githubusercontent.com`. This section
replaces the original "could not be located" finding with the real investigation.

### What Geomesh actually is

A React/Vite + Express single-page app ("Heightmap & 3D GLTF Studio" per its UI, `description:
"Take google maps data and convert to 3d map info"` in its repo metadata — a stale/inaccurate
description relative to what the code actually does, evidenced below). `package.json`'s
`name: "react-example"` and its AI-Studio-flavored `.env.example` comments ("AI Studio
automatically injects this...") indicate it was scaffolded from a Google AI Studio template,
which explains the `@vis.gl/react-google-maps` and `@google/genai` dependencies being present in
`package.json` without being load-bearing for the actual data pipeline (see below).

### What it emits, per endpoint (`server.ts`, read in full)

| Endpoint | Data source | Google involvement |
|---|---|---|
| `POST /api/roads/network` | Live Overpass query: `way["highway"~"^(motorway\|trunk\|primary\|secondary\|tertiary\|unclassified\|residential\|service\|living_street\|track)"]`, returns `{roads: RoadSegment[], geojson}` | **None.** |
| `POST /api/buildings/structures` | Live Overpass query: `way["building"]`, `way["man_made"~...]`, `way["amenity"~"^(fuel\|parking\|charging_station)"]`, returns `{buildings: BuildingStructure[], geojson, summary}` with real height inference from OSM `height`/`building:levels`/`levels` tags, falling back to type-based defaults (e.g. `commercial: 12.0m`, `residential: 6.8m`) | **None.** |
| `POST /api/elevation/grid` | Cascading: Google Elevation API (only if a key is configured AND active) → AWS-hosted Terrarium DEM tiles (Mapzen/SRTM-derived, 30m, no key) → Open-Meteo elevation API (no key) → flat 100m fallback | **Optional, not primary** — and even when active, Google is just one of four fallback tiers, never required. |
| `GET /api/geocode` | Cascading: raw coordinate parse → Google Geocoding (only if key present) → Open-Meteo Geocoding → OSM Nominatim | Same — optional convenience tier only. |
| `GET /api/proxy-image` | Proxies satellite/Street View tiles from an explicit allowlist (`maps.googleapis.com`, `streetviewpixels-pa.googleapis.com`, `*.ggpht.com`, plus `tile.openstreetmap.org`, ArcGIS, CartoDB) | **On-screen preview only** — grepped `gltfExporter.ts`, `roadRenderer.ts`, `buildingRenderer.ts` for "google": zero matches in all three. The export/render pipeline never touches this endpoint's output. |

`src/components/MapSelector.tsx` (the area-picker UI) renders via **Leaflet**, not the Google Maps
SDK — `@vis.gl/react-google-maps` is a `package.json` dependency but not used in the map-picker
component read this session; its actual call site (if any — e.g. inside `StreetViewModal.tsx`)
is out of scope for this investigation since it would only ever touch preview imagery per the
proxy allowlist above, not exported geometry.

### Verdict: matches ADR 0001's own prior framing exactly

ADR 0001 already recorded, before this investigation, that the tool's "exported game data already
comes from OpenStreetMap via Overpass with open-data elevation fallbacks... What is prohibited is
its Google satellite/Street View preview imagery ever being baked into an export." This session's
direct source read **confirms that framing was correct**, with one addition ADR 0001 didn't have
visibility into: Google Elevation/Geocoding APIs are also present as an *optional* convenience
tier, not just imagery preview — still never baked into exports, still always has a working
non-Google fallback, still doesn't change the ADR's conclusion.

### What this means for planning (user-confirmed decision)

1. **Port, don't wholesale-adopt.** Geomesh's `RoadSegment`/`BuildingStructure` output shapes
   (`src/types.ts`) are flat GeoJSON-adjacent structures — useful raw material, but NOT
   `road-graph.v1.md`'s shape (no dense compiler-assigned ids, no `oneway` resolution, no
   surface-enum mapping, no junction detection). The compiler's ingestion layer should reuse
   Geomesh's Overpass QL query strings and its OSM-tag-to-attributes mapping logic (particularly
   the building height-inference table) as a starting point, then build `road-graph.v1.md`'s
   actual node/edge/surface structure from that raw data — this is still real, meaningful reuse
   of working code, not a from-scratch reinvention of the Overpass query shape.
2. **Skip Geomesh's elevation pipeline entirely.** Its primary non-Google source (Terrarium 30m
   tiles) is not one of ADR 0001's two approved DEM sources. Fetch USGS 3DEP directly (1m,
   public domain, no mandatory notice) per the ADR's own selection rule for a US-based target —
   this document's "Code Examples" section already has the `exportImage` REST pattern for this.
3. **Building/landmark geometry (Open Question 2, below) is resolved**, not still open: adapt
   Geomesh's `buildings/structures` endpoint logic for D-04's Main Street landmark. This was
   previously flagged as uncertain scope; it is now a concrete, cheap adaptation of already-working
   code, not a new design problem.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ngraph.graph` | `20.1.2` | Graph data structure over dense integer node/edge ids | Already recommended in `.planning/research/STACK.md`; confirmed still current via `npm view` (modified 2026-02-14). `[VERIFIED: npm registry]` |
| `ngraph.path` | `1.6.1` | A*/NBA* pathfinding for the validator's reachability check and Phase 5+'s consumer | Confirmed still current via `npm view` (modified 2025-11-18), and is the schema's own assumed consumer (design decision 2: "Phase 7's AI does a lot of graph traversal"). `[VERIFIED: npm registry]` |
| `geotiff` | `3.0.5` | Pure-JS GeoTIFF reader for the USGS 3DEP raster | Actively maintained (modified 2026-03-30 per npm), zero native/WASM toolchain dependency — important on this Windows dev machine, which has neither `gdal`/`ogr2ogr` nor `osmium` installed (`[VERIFIED: environment probe, this session]`). Avoids forcing a GDAL install for a solo Windows dev. `[VERIFIED: npm registry + slopcheck OK]` |
| `osmtogeojson` | `3.0.0-beta.5` (latest dist-tag) | Converts raw Overpass JSON response into GeoJSON geometry | The de facto standard for this conversion — it is what powers Overpass Turbo's own map view. The "latest" tag being a beta is a real but low-risk wrinkle (see Package Legitimacy Audit); the library has shipped this beta line for years as its de facto stable release. `[ASSUMED: package identity from training knowledge, existence VERIFIED via npm + slopcheck]` |
| `@gltf-transform/cli` | `4.5.0` | Offline optimization of the compiled `.glb` (weld, simplify, meshopt-compress) | Already recommended and pinned in `.planning/research/STACK.md`; confirmed current via `npm view` (modified 2026-09-01, i.e. this month). `[VERIFIED: npm registry]` |
| `@gltf-transform/core` + `@gltf-transform/functions` | `4.5.0` | Programmatic glTF authoring (building the merged road mesh document in-process, not just post-hoc CLI optimization) | The compiler needs to *build* a glTF document (nodes, meshes, accessors) before it can optimize one — `@gltf-transform/core`'s `Document`/`Accessor`/`Primitive` API is the standard way to do this in Node without going through Three.js's browser-oriented exporters. `[ASSUMED: package identity from training knowledge — see Package Legitimacy Audit]` |
| `@types/node` | latest matching Node 24 (`npm view` shows `26.5.1` as of this session — verify at install time) | TypeScript types for `node:fs`/`node:https`/`node:path` in the new `tools/` tree | Currently **absent from the repo entirely** (`[VERIFIED: package.json read this session]`). The Phase 1 "no new packages" threat model (T-01-SC) was scoped to that phase's browser code; it does not block a Node-only build tool from having real Node types. Must be added as a devDependency, exact-pinned per the project's existing version-pinning convention. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `4.5.4` (already recommended in STACK.md for persistence) | Runtime-validate the compiled `.map.json` against the schema shape at load time | Optional but cheap insurance: `tests/road-graph-schema.test.ts` already validates the *fixture*; a zod schema mirroring it lets the runtime loader reject a malformed compiled map at load time with a clear error instead of an undefined-property crash mid-drive. Not required for SC1-5, but low-cost and consistent with the project's existing zod usage plan. |
| Node's native TypeScript execution (no package) | Node `24.14.1` (installed, matches `engines: >=24`) | Run the compiler CLI directly as `.ts` with zero build step | Node 24 ships type-stripping execution of `.ts` files on by default (no `--experimental-strip-types` flag needed as of 23.6+/24). `node tools/map-compiler/cli.ts --area <id>` works with no `tsx`/`ts-node` dependency — SC3's "one command" is satisfiable with zero new runtime dependency. Node does not type-check on this path; `tsc --noEmit` (already a separate script) remains the type-check gate. `[VERIFIED: Node.js official docs / nodejs.org/api/typescript.html, cross-referenced with installed `node --version`]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Live Overpass API query | Geofabrik regional `.osm.pbf` | Geofabrik ships whole-region extracts (e.g. all of Georgia) — massive overkill for a ~3km area, and requires `osmium`/`ogr2ogr` to filter/convert, **neither of which is installed on this dev machine** (`[VERIFIED: environment probe]`). Rejected for this phase; keep in mind only if the area grows past what a single Overpass call can return within its timeout. |
| Live Overpass API query | BBBike custom-area extract | A legitimate alternative — supports arbitrary bounding boxes and many output formats including GeoJSON directly. Its 2-7 minute async turnaround (email notification) makes it a poor fit for a "rebuilds from source with one command" CI-style flow; keep as a documented fallback if the public Overpass API's rate limits become a real blocker (it visibly rate-limited this research session twice — see Common Pitfalls). |
| `@gltf-transform/core` building the mesh directly | Build the `.glb` via Three.js's `GLTFExporter` in a headless/jsdom-simulated scene | Three's `GLTFExporter` expects a live `THREE.Scene` graph, which pulls the browser rendering tier into what should be a pure Node build step, and headless-DOM-simulating Three in Node for a build tool is exactly the kind of test-environment fragility this repo's `vitest.config.ts` comments already show Rapier caused once. `@gltf-transform/core` is a pure-data glTF document builder with no DOM/WebGL dependency. |
| `ngraph.path`/`ngraph.graph` | `graphology` + `graphology-shortest-path` | A newer, actively maintained alternative with a larger API surface (multigraphs, attributes). Not chosen: `ngraph.path` is already the locked recommendation in `.planning/research/STACK.md` and is confirmed still current; switching now would be an unforced, undiscussed deviation from an existing decision. |

**Installation:**
```bash
npm install --save ngraph.path@1.6.1 ngraph.graph@20.1.2 geotiff@3.0.5 osmtogeojson@3.0.0-beta.5
npm install --save-dev @gltf-transform/cli@4.5.0 @gltf-transform/core@4.5.0 @gltf-transform/functions@4.5.0 @gltf-transform/extensions@4.5.0 @types/node@<pin-to-installed-major>
```

**Version verification performed this session:**
```
npm view ngraph.path version time.modified        -> 1.6.1, 2025-11-18
npm view ngraph.graph version time.modified        -> 20.1.2, 2026-02-14
npm view @gltf-transform/cli version time.modified -> 4.5.0, 2026-09-01
npm view geotiff version time.modified             -> 3.0.5, 2026-03-30
npm view osmtogeojson dist-tags                    -> { latest: '3.0.0-beta.5' }
npm view @types/node version                       -> 26.5.1
```

## Package Legitimacy Audit

`slopcheck` (`0.6.1`) was installed and run this session (`pip install slopcheck`, executable
found at the user-scope Python Scripts directory, not on `PATH` by default — see Environment
Availability). Scanned via a probe `package.json` in the scratchpad directory (not the real repo)
listing every candidate package above.

| Package | Registry | slopcheck | Disposition |
|---------|----------|-----------|-------------|
| `ngraph.path` | npm | OK, no flags | Approved |
| `ngraph.graph` | npm | OK, no flags | Approved |
| `geotiff` | npm | OK, no flags | Approved |
| `osmtogeojson` | npm | OK, no flags | Approved (note: `latest` dist-tag is a long-running beta, `3.0.0-beta.5` — not a legitimacy red flag, but pin the exact beta string, not a caret range) |
| `@types/node` | npm | OK, no flags | Approved |
| `@gltf-transform/cli` | npm | OK, flagged `NO_REPO` (info) — "No source repository linked" | Approved — already independently verified as legitimate in `.planning/research/STACK.md` (installed via `npm pack`, docs at gltf-transform.dev). The `NO_REPO` signal is about slopcheck's own verification difficulty, not evidence of a problem. |
| `@gltf-transform/core` | npm | OK, flagged `NO_REPO` (info) | Approved — same package family as above |
| `@gltf-transform/functions` | npm | OK, flagged `NO_REPO` (info) | Approved — same package family as above |
| `@gltf-transform/extensions` | npm | OK, flagged `NO_REPO` (info) | Approved — same package family as above |

No `postinstall` scripts found on any candidate package (`npm view <pkg> scripts.postinstall`
returned empty for all nine). No `[SLOP]` or `[SUS]` verdicts — nothing removed, nothing needs a
`checkpoint:human-verify` gate on legitimacy grounds specifically. **Note:** `osmtogeojson` and
the `@gltf-transform/*` family names were recalled from training knowledge before verification
(not discovered via an authoritative doc first), so per this workflow's provenance rule they are
tagged `[ASSUMED]` for package-name provenance even though they passed both the registry check
and slopcheck — existence-on-registry does not upgrade an assumed name to verified. `ngraph.*` and
`geotiff` and `@gltf-transform/cli` were already named in `.planning/research/STACK.md` (an
existing project document, itself citing official sources), so those are treated as carrying that
document's provenance forward.

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none.

## Architecture Patterns

### System Architecture Diagram

```
                     OFFLINE (build time, tools/map-compiler/, Node CLI)
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                                │
│  [Overpass API]         [USGS 3DEP ImageServer]                              │
│  live OSM query          exportImage GeoTIFF                                  │
│  (way+node, tagged)      (1m DEM, bbox-clipped)                              │
│        │                          │                                          │
│        ▼                          ▼                                         │
│  osmtogeojson            geotiff (parse raster)                              │
│  raw JSON -> GeoJSON      raster -> elevation sampler                        │
│        │                          │                                          │
│        └────────────┬─────────────┘                                          │
│                      ▼                                                       │
│           [Graph Builder]                                                    │
│           OSM nodes/ways -> dense int ids, undirected edges + oneway,        │
│           surface-enum mapping table (BUILD FAILS on unmapped OSM value),    │
│           DEM sample per node -> endpoint-clamped smoothing per edge         │
│                      │                                                       │
│                      ▼                                                       │
│         [Junction Geometry Generator]                                        │
│         per-edge offset ribbon (centerline +/- widthM/2)                     │
│         + angle-sorted fan polygon at every junction:true node               │
│                      │                                                       │
│         ┌────────────┴─────────────┐                                        │
│         ▼                          ▼                                        │
│  [Collision Authoring]      [Render Mesh Authoring]                         │
│  ONE trimesh collider        ONE merged glTF Document                       │
│  per edge/surface-run         (@gltf-transform/core),                       │
│  (FIX_INTERNAL_EDGES=144)     optimized+compressed                          │
│  -> collider metadata for     (@gltf-transform/cli:                         │
│     runtime SurfaceMap         weld, simplify, meshopt)                     │
│         │                          │                                        │
│         └────────────┬─────────────┘                                        │
│                      ▼                                                       │
│              [Map Validator]                                                 │
│         undirected reachability (ngraph) + geometry sanity                   │
│         (self-intersection, degenerate points, extreme gradient)             │
│         FAILS LOUDLY (nonzero exit, named node/edge ids) on any violation    │
│                      │                                                       │
│                      ▼                                                       │
│         area-01.map.json  +  area-01.glb                                     │
│                      │                                                       │
└──────────────────────┼────────────────────────────────────────────────────────┘
                        │  (written to public/maps/, hashed by neither — loaded
                        │   by URL at runtime, per STACK.md's "maps go in
                        │   public/, cars go through import ?url")
                        ▼
                  RUNTIME (browser, src/)
┌──────────────────────────────────────────────────────────────────────────────┐
│  fetch(map.json) --zod validate--> RoadGraph                                 │
│         │                                                                     │
│         ├──> src/physics: for each edge, ColliderDesc.trimesh(ribbon)        │
│         │    world.createCollider(...) -> SurfaceMap.register(handle, surf)  │
│         │    (EXISTING Phase 3 mechanism — no new pattern needed here)       │
│         │                                                                     │
│         └──> src/render: GLTFLoader loads the merged .glb, one draw call     │
│              (or a handful, batched by material) for the whole road network  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
tools/
└── map-compiler/
    ├── cli.ts                 # entry point; `node tools/map-compiler/cli.ts --area <id>`
    ├── areas/
    │   └── <area-id>.config.ts # bbox, osmSnapshot pin, demSource, output areaId/name
    ├── sources/
    │   ├── overpass.ts         # live query (roads/buildings QL ported from Geomesh's
    │   │                        #   server.ts, github.com/R-Soul99/Geomesh) + osmtogeojson
    │   │                        #   conversion, retry/backoff
    │   └── dem.ts               # USGS 3DEP exportImage fetch + geotiff sampling
    ├── graph/
    │   ├── build-graph.ts       # OSM ways/nodes -> dense-id RoadGraph nodes/edges
    │   ├── surface-mapping.ts   # the locked OSM surface=* -> game enum table; throws on unmapped
    │   └── elevation.ts         # DEM sample + endpoint-clamped smoothing per edge
    ├── geometry/
    │   ├── ribbon.ts             # per-edge offset-polyline ribbon builder
    │   └── junction-fan.ts       # angle-sorted junction polygon builder
    ├── author/
    │   ├── collision.ts          # per-edge ColliderDesc-ready trimesh buffers (metadata only —
    │   │                          #   actual Rapier collider creation happens at runtime)
    │   └── gltf.ts                # @gltf-transform/core Document assembly + CLI optimize step
    ├── validate/
    │   └── validator.ts           # reachability + geometry sanity, loud non-zero exit on failure
    └── *.test.ts                  # colocated Vitest tests; runs under the EXISTING root
                                    # vitest.config.ts (environment: "node" already, no new
                                    # config needed) — picked up automatically, no include change
public/
└── maps/
    └── <area-id>.map.json         # + <area-id>.glb — loaded by URL at runtime, not bundled
```

### Pattern 1: Offset-ribbon + angle-sorted junction fan

**What:** For every edge, build a ribbon by offsetting each polyline vertex left/right by
`widthM / 2` along the perpendicular to the local tangent (miter-joined at interior vertices —
the same technique used for stroke-to-fill conversion of any polyline). This produces a strip of
quads matching the edge's authored `y` values exactly (no runtime raycast — this is what
schema design decision 1 already locks in). At every node where `junction === true`, do **not**
extend the ribbons to a shared point — instead, sort the incoming edges by their approach angle
around the node and build a triangle fan (or convex hull, if the ribbons' near-corners are not
already convex-ordered) connecting each ribbon's two near-corner vertices to the node center,
sharing exact vertex positions with the ribbons so there is no seam. This is the same conceptual
approach `osm2streets` (a-b-street project) uses for lane-level intersections — "each lane
polygon meets the intersection at a right angle... intersection polygons are guessed from road
width" — adapted down to this schema's single-width-per-edge (not per-lane) granularity.
`[CITED: github.com/a-b-street/osm2streets README + State of the Map 2022 talk]`

**When to use:** Every junction node (degree >= 3). Degree-2 nodes (a `junction: false` node
where a way was simply split, e.g. at a surface-type change) need **no** fan — just butt the two
ribbons' matching corners together directly, since they share the exact same node coordinate.

**Why not pull in `osm2streets` itself:** it is a Rust library with no first-class JS/WASM
npm package at the time of this research, and its output shape is full per-lane street geometry —
far more detail than this schema's single-centerline-plus-width edges need. Use it as the
reference *algorithm*, not a dependency. This is a genuinely custom implementation — flagged
honestly as the least-verified pattern in this document (no existing shipped code was read to
confirm this exact approach works end-to-end; it is the standard approach reasoned from
first principles plus the osm2streets precedent, not copy-verified).

**Example (pseudocode, not copy-paste from a real source — reasoned pattern):**
```typescript
// tools/map-compiler/geometry/ribbon.ts
function buildRibbon(edge: Edge): { left: Vec3[]; right: Vec3[] } {
  const pts = edge.points; // already DEM-sampled + smoothed, y authoritative
  const halfWidth = edge.widthM / 2;
  const left: Vec3[] = [];
  const right: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const tangent = estimateTangent(pts, i); // averaged from neighbors at interior points
    const normal = perpendicularXZ(tangent); // stays in the XZ plane; y untouched
    left.push(addScaled(pts[i], normal, halfWidth));
    right.push(addScaled(pts[i], normal, -halfWidth));
  }
  return { left, right };
}
```

### Pattern 2: One merged render mesh, many small physics colliders

**What:** The `.glb`'s road geometry should be a single (or texture-atlas-batched few) merged
`THREE.BufferGeometry`-equivalent glTF primitive — surface *look* driven by vertex color or a
small surface-atlas texture, not per-surface separate materials/draw calls. Collision geometry is
the opposite: **one `ColliderDesc.trimesh` per edge** (or per contiguous same-surface run),
because `src/physics/surface.ts`'s `SurfaceMap` is a `ColliderHandle -> SurfaceType` map with
collider-level, not triangle-level, granularity — confirmed by reading that file this session.
A merged collision mesh spanning multiple surface types would make correct per-wheel friction
lookup structurally impossible without redesigning Phase 3's already-shipped mechanism.

**When to use:** Always, for this project. This is not a style choice — it is dictated by
existing, shipped runtime code (`[VERIFIED: src/physics/surface.ts, read this session]`) and
independently reinforced by `.planning/research/STACK.md`'s "chunked trimesh colliders... Rapier's
broadphase handles many static colliders far better than one enormous mesh" guidance. Both
reasons point at the same design, from unrelated angles — a strong signal it is correct rather
than a hedge.

**Junction-polygon surface assignment (reasoned, MEDIUM confidence, not user-decided):** a
junction fan collider needs exactly one `SurfaceType`, same constraint as an edge. Recommend
assigning it the surface of the **highest road-class connected edge** (tarmac beats gravel beats
dirt_road, matching real-world intersection paving practice — a paved road's junction apron stays
paved even where a dirt side road joins). This is a reasoned default, not verified against any
external source; flag it for a quick human feel-check once the first junction is actually
drivable, the same way Phase 3's `03-12` session tuned surface values by feel.

### Pattern 3: Endpoint-clamped elevation smoothing

**What:** Sample the DEM once per **node** (this becomes each node's authoritative `y` — shared
by every edge touching that node, guaranteeing junction continuity by construction). For each
edge's interior polyline points, sample the raw DEM then apply a smoothing pass (e.g. windowed
moving average or Catmull-Rom re-sample) **with both endpoints clamped to the node's authoritative
y** so smoothing can never introduce a seam at a junction. This directly satisfies schema design
decision 1 ("`y` authored by the compiler from a smoothed DEM sample... never sampled at runtime")
and is exactly the invariant `tests/road-graph-schema.test.ts`'s "matches each polyline's
endpoints to its from/to node coordinates" check already enforces on the fixture — the compiler
must satisfy the same test on real output.

**When to use:** Every edge, every rebuild. This is the single mechanism that prevents SC1's
"bumpy junctions" failure mode at the elevation level (Pattern 1 prevents it at the topology
level — the two failure modes are independent and both must be handled).

### Anti-Patterns to Avoid

- **Raw, unsmoothed per-vertex DEM sampling:** a 1m DEM has real per-pixel noise; sampling it
  directly at every polyline vertex without smoothing will produce a visibly bumpy road even
  with perfect junction topology. This is a distinct failure mode from Pattern 1's topology
  seams — both must be fixed, neither implies the other.
- **One monolithic trimesh for the whole road network:** breaks Phase 3's `SurfaceMap` (see
  Pattern 2) and fights Rapier's broadphase. Not a hypothetical risk — it is the natural first
  instinct ("just build one big mesh") and it is specifically wrong here for a documented,
  code-level reason.
- **Defaulting an unmapped OSM `surface=*` value to `tarmac` at runtime:** schema design decision
  4 requires the BUILD to fail instead. Any `try { mapSurface(v) } catch { return "tarmac" }`
  pattern anywhere in the compiler is exactly the bug the schema was written to prevent.
- **Treating `cobblestone` (bare, no `sett`/`unhewn_cobblestone` qualifier) as a mappable value:**
  the schema explicitly requires the build to fail on it — it is deliberately excluded from the
  fifteen documented values, not an oversight.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading a GeoTIFF DEM raster | A custom binary TIFF parser | `geotiff` (npm) | GeoTIFF has enough format variants (tiled vs. striped, various compression) that a hand-rolled reader is a multi-day trap for a one-time build-tool need. |
| Graph reachability / shortest-path | A hand-rolled BFS+priority-queue | `ngraph.path` + `ngraph.graph` | Already the locked recommendation; reimplementing A*/NBA* is pure risk for zero benefit when a maintained, already-adopted library exists. |
| glTF binary assembly (buffers, accessors, bufferViews, the JSON chunk layout) | Manual `.glb` byte-packing | `@gltf-transform/core` | glTF's binary layout has enough alignment/byte-offset rules that hand-rolling it is a classic source of "loads in some viewers, corrupt in others" bugs. |
| Overpass query retry/backoff and payload parsing | A bespoke Overpass client | `osmtogeojson` (parsing) + a small custom fetch wrapper (retry only — this part genuinely is thin enough to hand-roll, see Common Pitfalls) | The *parsing* of Overpass's JSON tag/geometry shape into usable geometry is exactly what `osmtogeojson` exists for; hand-rolling that specific piece duplicates a widely-used, battle-tested converter. |

**Key insight:** everything in this table has a narrow, well-scoped npm package that solves
exactly the sub-problem and nothing more — the risk in this phase is not "reach for a library
that's overkill," it's the opposite: junction geometry (Pattern 1) and the OSM-to-game-surface
mapping (already specified in the schema) have **no** off-the-shelf library that matches this
project's exact schema, so those two pieces are correctly custom code, not a hand-rolling mistake.

## Target Area Selection (D-01–D-04, D-07–D-09)

### Method used (concrete, checkable, reusable by the planner)

For each candidate: (1) geocode via Nominatim (`https://nominatim.openstreetmap.org/search?q=<place>&format=json&limit=1`,
`User-Agent` header required by Nominatim's usage policy), (2) run the following Overpass QL
against the returned bounding box or a tightened box around the town core:

```
[out:json][timeout:25];
(
  way["highway"](SOUTH,WEST,NORTH,EAST);
);
out tags geom qt;
```

(3) tabulate `highway=*` and `surface=*` tag frequency from the JSON response, (4) sum polyline
segment lengths (haversine between consecutive `geometry` points) for a rough network-length
sanity check, (5) sample a handful of points across the box via `https://api.open-elevation.com/api/v1/lookup?locations=lat,lon|lat,lon|...`
for a coarse relief check, (6) treat box diagonal (km) ÷ target arcade speed (~130 km/h) as a
rough "drive time end to end" sanity check against D-07's 1-2 minute target.

### Candidate 1 (PRIMARY): Juliette, GA — Monroe County

**HIGH confidence — live-verified this session**, not reasoned from training knowledge alone.

- Geocoded via Nominatim to a CDP boundary box `33.0963,-83.8242` to `33.1223,-83.7948`
  (~2.9km x 2.4km). `[VERIFIED: Nominatim, queried 2026-09-13]`
- Live Overpass query against that box returned 56 tagged ways: `highway` breakdown
  `tertiary:10, primary:3, residential:10, unclassified:3, service:30`; `surface` breakdown
  `asphalt:10, paved:8, unpaved:9, gravel:6, concrete:1`, with 22/56 ways carrying **no** explicit
  surface tag (see "OSM surface tag reliability" below for why this matters).
  `[VERIFIED: Overpass API, overpass-api.de, queried 2026-09-13]`
- Elevation samples across the box ranged 118m–151m (~33m of relief over ~2-3km) — genuine
  rolling Piedmont terrain, not flat. `[VERIFIED: Open-Elevation API, queried 2026-09-13]`
- Box diagonal ≈ 3.8km; at ~130 km/h that is ≈1.75 minutes — lands almost exactly inside D-07's
  1-2 minute target, though the compiler should trim to the genuine road network (excluding the
  ~30 `service`-tagged driveway spurs, which inflate the raw length figure) rather than compiling
  the box literally.
- Real Main Street: McCrakin Street, the actual filming location of the Whistle Stop Café from
  *Fried Green Tomatoes* — satisfies D-04's "recognizable landmark" framing directly.
  `[CITED: Wikipedia "Juliette, Georgia"; Explore Georgia tourism listing]`
- Immediately adjacent Piedmont National Wildlife Refuge (a ~10-minute drive from downtown, per
  tourism sources) has "more than 50 miles of gravel roads" — a rich source of additional gravel
  mileage if the compiled area needs to extend past the immediate town core to hit D-08's
  "genuine loops" bar more comfortably. `[CITED: TripAdvisor Piedmont NWR listing — LOW-confidence
  source type, but consistent with the live Overpass gravel/unpaved counts above]`

### Candidate 2 (SECONDARY): Ider, AL — DeKalb County (Sand Mountain)

**MEDIUM confidence — reasoned from web search, NOT live-verified this session.** Two attempts
to run the same Overpass query against this candidate's bounding box both hit "server is probably
too busy" errors (once against `overpass-api.de`, once against the `overpass.kumi.systems`
mirror) — a real rate-limiting pitfall documented below, not a data quality problem with this
candidate. A small town (~700 residents per secondary source) in wooded hill terrain near the
Georgia border, described as "buffered by a network of gravel roads" in the search source used.
**Must be live-verified with the method above before being seriously considered** — this session
could not complete that verification.

### Candidate 3 (TERTIARY, weakest): Georgia Piedmont foothills generally (e.g. near Apalachee/Morgan County)

**LOW confidence — single secondary source, not independently verified at all.** Offered only to
satisfy the "1-3 candidates" request; do not treat as a real option without the same live-query
treatment Candidate 1 received. If Candidate 1 is confirmed by the user (recommended), this
candidate can likely be dropped without further work.

### Recommendation

**Propose Juliette, GA to the user as the confirmed area** (per D-02, this still requires
explicit user confirmation before the compiler is pointed at it for real — this research
provides the evidence for that conversation, it does not substitute for it). It is the only
candidate this session actually queried live end-to-end, it satisfies every D-01–D-09 criterion
with real data, and it carries a genuine, recognizable landmark.

## OSM Surface Tag Reliability (locked mapping table — this is about data quality, not schema redesign)

The live Juliette query found **22 of 56 ways (39%) carry no explicit `surface=*` tag** in the
tight town-core box, rising to **130 of 205 (63%)** in a wider box that includes more Wildlife
Refuge service roads. This is the real-world weight the schema's `highway=*` fallback table
carries — it is not a rare edge case.

The fallback table (already locked, not redesigned here) maps untagged `service` to `tarmac`.
For the 30 `service`-tagged ways found in the Juliette box — plausibly driveways, but also
plausibly unpaved refuge/forest-service tracks given the area — this fallback is a **real
accuracy risk**: an actually-gravel forest service road with no `surface` tag will silently
compile as `tarmac` and drive wrong, with no build failure (untagged-to-fallback is not the same
failure mode as unmapped-and-thrown; the schema only guarantees a loud failure for values *present
but unrecognized*, not for values *absent*).

**Recommendation (does not touch the locked enum or mapping table):** have the compiler emit a
build-time coverage report — every edge whose `surface` value came from the fallback path (no
explicit tag) versus an explicit OSM tag — as part of its normal output/log. Treat a high
fallback ratio on non-`residential` road classes (specifically `service`/`track`/`unclassified`
in a rural context) as a warning requiring a quick human visual spot-check (satellite/street-view
sanity check, or simply driving the compiled result and confirming it doesn't feel wrong) before
shipping, mirroring the "reports failures loudly rather than silently" spirit of SC5 even though
this particular gap (missing tag, not wrong tag) is not something the locked schema's BUILD-fail
rule catches by design.

`tracktype=*` (grade1-grade5) is a secondary OSM tag that could, in principle, refine confidence
on `highway=track` surface guesses — but the locked mapping table does not include it, and adding
a heuristic that isn't in the specified table would be redesigning the schema, which is explicitly
out of scope. Noting it here as a documented possibility for a future schema revision (a `v2` doc),
not an action for this phase.

## Common Pitfalls

### Pitfall 1: Overpass API public instance rate-limiting

**What goes wrong:** Live Overpass queries against the shared public instance
(`overpass-api.de`) return an HTML error page ("server is probably too busy") instead of JSON,
even for small, well-formed queries — hit twice in this research session within a few minutes of
each other, once against the primary instance and once against a mirror
(`overpass.kumi.systems`).
**Why it happens:** The public Overpass API instances are shared, rate-limited infrastructure
with no SLA.
**How to avoid:** For a build tool meant to be re-run repeatably (SC3), do not make the live
Overpass call part of every rebuild. Instead, fetch once, **cache the raw Overpass JSON response
to disk** (e.g. `tools/map-compiler/areas/<area-id>.raw-osm.json`, committed or at least
locally cached), and record its retrieval timestamp as `source.osmSnapshot`. Rebuilds then read
the cached snapshot unless a `--refresh` flag is explicitly passed. This is also what makes the
compiled artifact genuinely reproducible byte-for-byte, not just "reproducible if Overpass
answers the same way twice," which it demonstrably does not always do promptly.
**Warning signs:** An HTML response (starts with `<?xml` or `<html`) where JSON was expected —
detect this explicitly and fail loudly rather than let `JSON.parse` throw an opaque
`SyntaxError: Unexpected token '<'` (exactly what happened during this research session's own
probing).

### Pitfall 2: The `no-google-pipeline` grep gate does not currently scan the new compiler directory

**What goes wrong:** `tests/no-google-pipeline.test.ts`'s `SCANNED_GLOBS` is
`["*.md", "docs/**/*.md", "src/**/*.ts", "tests/**/*.ts"]` — a new `tools/map-compiler/**/*.ts`
tree, which this research recommends, is **not** covered. A future comment or doc string in the
compiler referencing "Google Maps" or "Google Earth" imagery (e.g. while writing a comment
explaining what NOT to do, or copy-pasting from an old design doc) would not trip the mechanical
enforcement ADR 0001 relies on. `[VERIFIED: tests/no-google-pipeline.test.ts, read this session]`
**Why it happens:** The scan scope was fixed at Phase 1, before Phase 4's compiler directory
existed, and the test's own comment explicitly says the scope is a decision recorded in
`01-03-PLAN.md`'s `grep_scope_decision` block — "Do not widen or narrow it here — amend the plan
and this comment together."
**How to avoid:** Phase 4's plan must include a task to extend `SCANNED_GLOBS` (and the
`import.meta.glob` calls, which Vite requires as inline literals) to include
`tools/**/*.ts`, updating both the array and the `import.meta.glob` calls together, per that
test file's own documented convention.
**Warning signs:** A code reviewer or `plan-checker` treating "the Google-pipeline gate already
exists" as sufficient coverage for new compiler code, without checking whether the new
directory is actually in scope.

### Pitfall 3: `tsconfig.json`'s `include` does not currently cover a new `tools/` directory

**What goes wrong:** The root `tsconfig.json` has `"include": ["src", "tests", "vite.config.ts",
"vitest.config.ts"]`. A new `tools/map-compiler/` tree would not be type-checked by
`npm run typecheck` (`tsc --noEmit`) unless `tools` is added to that array.
`[VERIFIED: tsconfig.json, read this session]`
**Why it happens:** The compiler directory doesn't exist yet; nobody has had a reason to add it.
**How to avoid:** Add `"tools"` to `tsconfig.json`'s `include` array as part of Phase 4's first
plan. Note this is compatible with `"lib": ["ES2022", "DOM", "DOM.Iterable"]` already being
present — DOM types being available inside `tools/` is harmless even though the compiler won't
use them; no separate tsconfig is needed for this project's scale.
**Warning signs:** `npm run check`'s typecheck step passing while the compiler has real type
errors — a false-green signal exactly like the CRLF/Biome issue already logged in `.planning/STATE.md`'s
Blockers section for a different reason.

### Pitfall 4: Collider-vs-render mesh granularity confusion

**What goes wrong:** Building the `.glb` and the collision geometry from the *same* merged mesh
data structure, because it feels natural to reuse one intermediate representation for both.
**Why it happens:** The schema's `edges[].points` is the single source for both, so it's easy to
default to "build one mesh, use it for both render and physics."
**How to avoid:** See Pattern 2 above — deliberately branch into two authoring paths after the
shared ribbon/fan geometry is computed: one merges everything for the `.glb`, the other keeps
per-edge (or per-surface-run) separation for collision. This is not a performance nicety, it is
required for `SurfaceMap` to function at all (confirmed against shipped `src/physics/surface.ts`).
**Warning signs:** A compiled map where every wheel reports the same surface regardless of which
visual road segment the car is actually on — the symptom of merged collision geometry losing
per-edge surface identity.

### Pitfall 5: `ColliderDesc.trimesh` without `FIX_INTERNAL_EDGES`

**What goes wrong:** Per-edge ribbon trimeshes built without the `TriMeshFlags.FIX_INTERNAL_EDGES`
flag (value `144`, per `CLAUDE.md`'s already-HIGH-confidence, source-verified finding) produce
invisible bumps at every internal triangle seam — precisely the "bumpy junctions" and mid-road
bumps SC1 explicitly forbids, and a bug that reads as "the physics is broken" rather than "a flag
was missing," making it hard to root-cause after the fact.
**Why it happens:** It's an easy-to-miss third constructor argument, and Rapier's default
behavior without it is exactly wrong for a flat road surface built from adjacent triangles.
**How to avoid:** Every `ColliderDesc.trimesh(vertices, indices, ...)` call in the runtime loader
(not the compiler — the compiler only emits vertex/index buffers; Rapier collider construction
happens at runtime load) must pass `RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES`.
**Warning signs:** A human playtest reporting "the car judders slightly even on a straight road,"
not just at visible junctions.

### Pitfall 6: Assuming `SURFACE_ENUM`'s `sett`/`cobblestone` distinction is a typo to "fix"

**What goes wrong:** A future contributor (or an AI agent under time pressure) sees `sett` mapped
to `tarmac` while bare `cobblestone` throws a build error, and "fixes" it by mapping `cobblestone`
to `tarmac` too, for consistency.
**Why it happens:** It looks inconsistent at a glance.
**How to avoid:** The schema document is explicit that this is deliberate — `cobblestone` is an
"unclear value" per the OSM wiki, and silently lumping it into tarmac would misrepresent a rough
historic street's grip. Read the schema's own explanation before "fixing" anything here.
**Warning signs:** A diff that adds `cobblestone` to the `tarmac` mapping row without an
accompanying discussion of why the schema explicitly excluded it.

## Code Examples

### USGS 3DEP raster fetch for a bounding box (ArcGIS ImageServer `exportImage`)

```typescript
// Source: pattern reasoned from The National Map's documented ImageServer REST API
// (elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer), which supports
// the standard ArcGIS ImageServer `exportImage` operation. [CITED: usgs.gov technical
// announcement + index.nationalmap.gov service directory, both fetched this session]
const url = new URL(
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage",
);
url.searchParams.set("bbox", `${west},${south},${east},${north}`);
url.searchParams.set("bboxSR", "4326");
url.searchParams.set("size", `${widthPx},${heightPx}`);
url.searchParams.set("format", "tiff");
url.searchParams.set("pixelType", "F32");
url.searchParams.set("interpolation", "RSP_BilinearInterpolation");
url.searchParams.set("f", "image");
const response = await fetch(url);
const buffer = Buffer.from(await response.arrayBuffer());
// Then parse `buffer` with `geotiff`'s `fromArrayBuffer` and read pixel values by lat/lon.
```

### Overpass QL for the confirmed area (reusable pattern from this session's live queries)

```
[out:json][timeout:25];
(
  way["highway"](SOUTH,WEST,NORTH,EAST);
);
out tags geom qt;
```
This is the exact query shape run against Juliette, GA this session — `out tags geom qt` returns
both the tag dictionary and the full node geometry per way in one response, which is what the
graph builder needs (tags for surface/class mapping, geometry for polylines). `[VERIFIED: this
session's own successful queries against overpass-api.de]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `ts-node`/`tsx` to run TypeScript build scripts in Node | Node 24's native, on-by-default type-stripping execution of `.ts` files | Node 23.6 (default on), Node 24 (current LTS, ships it) | The map compiler CLI needs zero new "run TypeScript" dependency — `node tools/map-compiler/cli.ts` just works, matching the installed Node `24.14.1`. `[VERIFIED: nodejs.org/api/typescript.html + nodejs.org/learn/typescript/run-natively]` |

**Deprecated/outdated:** Nothing else in this domain has materially changed recently enough to
matter for this phase — OSM/Overpass, the ODbL licence, and USGS 3DEP's REST API are all
long-stable, low-churn infrastructure.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `osmtogeojson` and the `@gltf-transform/core`/`functions`/`extensions` package names are correct (recalled from training, then registry+slopcheck confirmed to exist) | Standard Stack | If a name is subtly wrong (e.g. a similarly-named typosquat), `npm install` would still succeed since these names DO exist on the registry as scanned — the risk is a wrong *choice* of package for the intended purpose, not a nonexistent name. Low risk given both are well-known, long-standing libraries, but genuinely unverified against an official doc/Context7 source this session. |
| A2 | Junction fan geometry surface = highest-road-class connected edge | Pattern 2 | If wrong, a junction reads as a grip discontinuity exactly where players cross most often (every intersection) — should be feel-verified in a browser checkpoint, same as Phase 3's surface tuning. |
| A3 | RESOLVED, no longer a live assumption | Geomesh Investigation | The repository was private (not deleted/renamed) — user made it public mid-session, resolved by direct source read. See the updated Geomesh Investigation section. |
| A4 | Candidate 2 (Ider, AL) and Candidate 3 (GA Piedmont, general) are viable per their secondary/tertiary sourcing | Target Area Selection | Both are explicitly flagged LOW/MEDIUM confidence and marked "not live-verified" — the risk is already surfaced, not hidden. If Juliette, GA is rejected by the user, re-run this session's exact Overpass method against these before locking either. |
| A5 | `@types/node` version `26.5.1` (npm's current `latest` tag) is an appropriate pin for a Node `24.14.1` project | Standard Stack | `@types/node` major versions track Node majors loosely, not strictly; the planner should verify at install time whether a `24.x`-series `@types/node` exists and is preferred, or whether `latest` (`26.x`) is fine to use against Node 24 (TypeScript's `@types/node` packages are generally forward-compatible for the API surface this compiler needs — fs/path/https — so this is low risk either way). |

## Open Questions

1. ~~Can the user make the Geomesh repository accessible?~~ **RESOLVED mid-session** — the user
   made the repository public, it was read directly, and the finding is recorded in full in
   "Geomesh Investigation" above. No longer an open question.

2. ~~Does Phase 4's scope include any building/landmark geometry?~~ **RESOLVED mid-session** —
   Geomesh's `buildings/structures` endpoint already does real OSM building extraction with
   height inference; the compiler adapts that logic for D-04's landmark rather than treating
   building geometry as a from-scratch design question. Still worth the planner explicitly
   scoping HOW MUCH building detail (the original lightweight-placeholder-boxes framing below
   remains a reasonable ceiling — Geomesh's height/type inference is a nice-to-reuse bonus on top
   of simple boxes, not a mandate to build full architectural detail):
   - What we know: `road-graph.v1.md` specifies road-network fields only — no building schema
     exists anywhere in the repo, and Phase 4's SC1-5 mention only roads/surfaces/`.glb`+`.map.json`/
     the validator, not buildings. `docs/adr/0003-occlusion-mitigation.md` separately notes
     revisiting its fade/steepen choice "once real building density exists," implying some future
     phase expects real building density eventually — not necessarily this one.
   - Recommendation: minimal placeholder building boxes at OSM `building=*` footprints (now with a
     working Overpass query and height-inference logic to adapt from Geomesh, rather than
     building that from scratch), deferring real building art/density to whichever phase actually
     needs occlusion-testing-grade density per ADR 0003's own note.

3. **Does Phase 4 compile off-road terrain surface (grass/dirt outside the road ribbons), or is
   the area strictly road-network-only with an undefined/unshippable off-road void?**
   - What we know: the schema specifies road edges only. SURF-01 already supports off-road
     surfaces (grass/mud/sand) and Phase 8's Getaway mode implies real off-road evasion driving
     eventually.
   - What's unclear: whether "drivable end to end" (SC1) requires the space *between* roads to be
     solid/drivable ground at all, or whether the v1 area can get away with a road-only collision
     surface and treat everything else as backdrop.
   - Recommendation: build a simple DEM-derived heightfield (`ColliderDesc.heightfield`) covering
     the full bounding box as a fallback ground plane, defaulted to a single uniform off-road
     `SurfaceType` (e.g. `grass`), separate from and underneath the road ribbon colliders. Cheap
     to build (the DEM raster is already fetched for road elevation), prevents a "car falls
     through the world if it leaves the road" failure mode, and per-`landuse=*` surface variety
     can be added in a later pass without revisiting this phase's core architecture.

4. **Is `osmtogeojson`'s `3.0.0-beta.5` "latest" tag actually the version to pin, or does a
   different, more-stable release line exist that this session's tooling didn't surface?**
   - What we know: `npm view osmtogeojson dist-tags` returned only `latest: 3.0.0-beta.5`; no
     other dist-tag was present.
   - What's unclear: whether this beta has been the de facto stable release for years (common in
     small, mature OSM-tooling projects that never formalize a 3.0.0 GA) or whether it genuinely
     carries elevated risk.
   - Recommendation: the planner/executor should check the package's own changelog/GitHub releases
     at install time before locking the pin, since this session did not fetch that changelog
     directly (npm registry metadata alone was checked).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Compiler runtime, native `.ts` execution | ✓ | 24.14.1 | — |
| npm | Package installation | ✓ | 11.19.0 | — |
| Python + pip | `slopcheck` legitimacy tooling (dev-time only, not shipped) | ✓ | 3.14.4 | — |
| `slopcheck` CLI | Package Legitimacy Audit | ✓ (after `pip install`) | 0.6.1 | Installed to the user-scope Python Scripts directory, **not on `PATH` by default** — must be added to `PATH` explicitly per invocation (`export PATH="$PATH:.../Python/Python314/Scripts"` on this machine) or invoked via its full path. |
| `git` | Version control | ✓ | 2.52.0 | — |
| `ogr2ogr` (GDAL) | Would be needed for `.osm.pbf`/GeoTIFF conversion if Geofabrik or a raw-GDAL DEM path were chosen | ✗ | — | Not needed — this research recommends the live Overpass API (pure JSON/HTTP) and USGS 3DEP's `exportImage` REST endpoint (returns GeoTIFF directly, read via the pure-JS `geotiff` npm package) specifically to avoid needing GDAL on a Windows dev machine. |
| `osmium` | Would be needed to filter/convert a Geofabrik regional `.osm.pbf` | ✗ | — | Not needed — same reasoning as `ogr2ogr` above; Overpass API is recommended instead for this small an area. |
| `gh` CLI (authenticated) | Would have allowed reading a private Geomesh repo, or browsing GitHub more robustly | ✗ (installed but unauthenticated) | — | None — this is why the Geomesh investigation could not resolve private-vs-deleted-vs-renamed. The user's own GitHub access (or a shared source dump) is the only path to closing this gap. |

**Missing dependencies with no fallback:**
- Authenticated GitHub access to resolve the Geomesh repository's actual status — see Open
  Question 1. This blocks completing D-06 as scoped, not the phase's core build-fresh path.

**Missing dependencies with fallback:**
- `ogr2ogr`/`osmium` — both have a viable fallback already built into the recommended stack
  (live Overpass API + `geotiff` npm package instead of `.osm.pbf`/GDAL raster tooling).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `5.0.0` (already installed, project-wide) |
| Config file | `vitest.config.ts` (root) — `environment: "node"` already set repo-wide; no new config needed for `tools/map-compiler/**/*.test.ts`, which Vitest's default include glob picks up automatically |
| Quick run command | `npx vitest run tools/map-compiler` (scoped) or `npm run test` (full suite, already fast per Phase 1-3's `test.total_execution_time` metrics) |
| Full suite command | `npm run check` (typecheck + lint + test — already the project's standard gate) |

### Phase Requirements -> Test Map

Phase 4 has no REQ IDs of its own; mapping instead to its five success criteria.

| SC | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| SC1 (no seams/bumps/wedging) | Junction ribbon+fan topology is watertight; per-vertex endpoint coincidence | unit | `npx vitest run tools/map-compiler/geometry` | ❌ Wave 0 |
| SC1 (human-perceptible feel) | Actually drivable without judder | manual (browser checkpoint) | — human playtest, same pattern as Phase 2/3's `SC*` human sign-off steps | N/A — manual by nature |
| SC2 (surface carries through, no hand-tagging) | Compiler's surface-mapping table matches `road-graph.v1.md`'s locked enum exactly, throws on unmapped values, and a real compiled edge's `surface` field is one of the six enum values | unit | `npx vitest run tools/map-compiler/graph/surface-mapping` | ❌ Wave 0 |
| SC3 (one-command rebuild, `.glb`+`.map.json`, shared source) | End-to-end CLI run against a small fixture area produces both files, and `.map.json` passes the EXISTING `tests/road-graph-schema.test.ts` structural checks (that test already validates any conforming `RoadGraph`, not just the fixture — reusable as-is if the compiler's real output is swapped in for local smoke testing) | integration | `node tools/map-compiler/cli.ts --area <fixture-id>` then `npx vitest run tests/road-graph-schema.test.ts` against the real output | ❌ Wave 0 (compiler itself) — existing schema test already covers the output-shape half |
| SC4 (no Google data, correct attribution string) | `attribution.osm` exact string match; grep gate extended (Pitfall 2) covers the new directory | unit + existing mechanical gate | `npx vitest run tests/no-google-pipeline.test.ts` (once extended) | ⚠️ Existing file, needs SCANNED_GLOBS extension — see Pitfall 2 |
| SC5 (validator: reachable + pathable, loud failures) | Undirected reachability via `ngraph`; geometry sanity (self-intersection, degenerate points, extreme gradient); non-zero exit + named node/edge ids on failure | unit + integration | `npx vitest run tools/map-compiler/validate` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tools/map-compiler` (fast, scoped to the new tree)
- **Per wave merge:** `npm run check` (full typecheck+lint+test, matches project convention)
- **Phase gate:** Full suite green, plus the human SC1 browser checkpoint, before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tools/map-compiler/geometry/ribbon.test.ts` + `junction-fan.test.ts` — covers SC1's
      topology half
- [ ] `tools/map-compiler/graph/surface-mapping.test.ts` — covers SC2, mirrors
      `tests/road-graph-schema.test.ts`'s existing `surfaceEnumFromDoc` idiom (parse the doc,
      don't hardcode the enum) so the two tests can never silently drift from each other
- [ ] `tools/map-compiler/validate/validator.test.ts` — covers SC5
- [ ] `tests/no-google-pipeline.test.ts` — extend `SCANNED_GLOBS`/`import.meta.glob` calls to
      include `tools/**/*.ts` (Pitfall 2) — this is an edit to an existing file, not a new one,
      but is a genuine Wave 0 prerequisite for SC4 to mean anything for the new code
- [ ] `tsconfig.json` — add `"tools"` to `include` (Pitfall 3) — prerequisite for `npm run
      typecheck` to cover the new tree at all
- [ ] A small, committed fixture OSM+DEM sample (not a live network call) for the integration
      test above to run offline/deterministically in CI — mirrors `fixtures/road-graph.sample.json`'s
      existing role

## Security Domain

`security_enforcement` is absent from `.planning/config.json`'s `workflow` block, so per this
workflow's own default it is treated as enabled. This phase has an unusually small attack
surface: it is a single-player, client-only game with an offline build tool that has no server,
no user accounts, and no runtime network calls (the compiled `.map.json`/`.glb` are static files
fetched by URL, same trust level as any other static asset already in `public/`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No user accounts anywhere in this project (confirmed via REQUIREMENTS.md's Out of Scope table: "Global online leaderboards... out of scope"). |
| V3 Session Management | No | Same reasoning. |
| V4 Access Control | No | Same reasoning. |
| V5 Input Validation | Yes | The compiled `.map.json` is untrusted-ish input to the browser runtime (it's the project's own build output, but validating it at load time is still good practice against a corrupted/stale file). Use `zod` (already planned in `.planning/research/STACK.md` for persistence) to validate the loaded `RoadGraph` shape before use, matching the project's existing "`zod` schema validation on read" pattern for `localStorage`. |
| V6 Cryptography | No | Nothing in this phase touches secrets, tokens, or encrypted data. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Malicious/malformed `.map.json` served from a compromised or tampered `public/maps/` path causing a runtime crash or, in principle, prototype pollution via an unchecked `JSON.parse` merge | Tampering | zod schema validation at load (V5 above); this is defense-in-depth for a solo-dev project's own build output, not a response to an external threat actor, since there is no user-generated content path into `public/maps/` in v1. |
| Supply-chain risk from new npm packages (this phase adds several) | Tampering | Package Legitimacy Audit above (slopcheck + registry + postinstall-script check), consistent with this workflow's standard gate. |
| SSRF-adjacent risk: the compiler itself makes outbound HTTP calls (Overpass, USGS) at build time | Tampering / Information Disclosure | Low relevance — this is a developer-invoked build tool, not a server handling untrusted input; the URLs are hardcoded/config-driven by the developer, not user-supplied. Flagged for completeness, not because it's a real risk in this project's shape. |

## Sources

### Primary (HIGH confidence)
- `docs/adr/0001-map-data-source.md`, `docs/schemas/road-graph.v1.md`, `fixtures/road-graph.sample.json`,
  `src/core/surface-types.ts`, `src/physics/surface.ts`, `src/physics/surface-scene.ts`,
  `tests/road-graph-schema.test.ts`, `tests/no-google-pipeline.test.ts`, `tests/layering.test.ts`,
  `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `package.json`, `.planning/config.json`,
  `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, `CLAUDE.md` — all
  read directly this session
- GitHub REST API (`api.github.com/users/R-Soul99/repos`), queried directly, unauthenticated —
  initial Geomesh non-visibility finding (repo was private at that point)
- `github.com/R-Soul99/Geomesh` (`server.ts`, `package.json`, `.env.example`, `src/types.ts`,
  `src/components/MapSelector.tsx`, `src/utils/{gltfExporter,roadRenderer,buildingRenderer}.ts`),
  read directly via the GitHub API + `raw.githubusercontent.com` after the user made the
  repository public mid-session — the full Geomesh Investigation finding above
- `npm view` (registry) for `ngraph.path`, `ngraph.graph`, `@gltf-transform/cli`, `geotiff`,
  `osmtogeojson`, `@types/node` — versions and publish dates, this session
- `slopcheck 0.6.1` scan output, this session, against a scratchpad probe `package.json`
- Live Overpass API query (`overpass-api.de/api/interpreter`) against Juliette, GA — this session
- Nominatim geocoding (`nominatim.openstreetmap.org`) — this session
- Open-Elevation API (`api.open-elevation.com`) — this session
- Environment probe (`node --version`, `npm --version`, `python --version`, `command -v
  ogr2ogr/osmium/git`) — this session

### Secondary (MEDIUM confidence)
- `github.com/a-b-street/osm2streets` README + State of the Map 2022 talk slides/PDF — junction
  geometry algorithm precedent
- `nodejs.org/api/typescript.html` + `nodejs.org/learn/typescript/run-natively` — native TS
  execution
- `elevation.nationalmap.gov`/`index.nationalmap.gov` service directories, usgs.gov technical
  announcement — 3DEP ImageServer REST API shape
- `download.bbbike.org`/`extract.bbbike.org` — BBBike extract service capabilities (alternative
  considered, not chosen)
- Wikipedia "Juliette, Georgia"; Explore Georgia tourism listing — landmark/town-center framing

### Tertiary (LOW confidence)
- `homestratosphere.com` secluded-towns listicles — source for Candidate 2 (Ider, AL) and
  Candidate 3; explicitly flagged as unverified and requiring the same live-query treatment
  Candidate 1 received before being taken seriously
- TripAdvisor Piedmont National Wildlife Refuge listing — "50 miles of gravel roads" figure, used
  only as supporting color for Candidate 1, not as a load-bearing claim

## Metadata

**Confidence breakdown:**
- Standard stack (libraries/versions): HIGH — every package version was checked against the live
  npm registry this session, not recalled from training
- Target area selection: HIGH for Candidate 1 (live-queried), LOW-MEDIUM for Candidates 2-3
  (explicitly flagged, not hidden)
- Junction/collision geometry architecture: MEDIUM — reasoned from first principles plus the
  osm2streets precedent and this project's own shipped `SurfaceMap` code, but not copy-verified
  against a working implementation of this exact pipeline (none exists yet)
- Geomesh investigation: HIGH confidence in the negative finding (repo not publicly visible,
  verified three independent ways), but the finding itself blocks rather than resolves D-06
- DEM sourcing: MEDIUM — the ImageServer `exportImage` endpoint's existence and general shape is
  verified via official USGS sources, but the exact request was not executed this session (no
  DEM data was actually downloaded, only its geocoding/elevation-sample cousin, Open-Elevation,
  was live-tested)

**Research date:** 2026-09-13
**Valid until:** 30 days for library versions/npm data (fast-moving); OSM tag data and the
Juliette candidate's characteristics are stable for the life of the project (OSM data does drift
over time, so re-run the Overpass query immediately before locking `osmSnapshot` in the actual
build, not from this document's cached numbers)
