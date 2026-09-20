# ADR 0001 — Map data comes from OpenStreetMap plus an open DEM

- **Status:** Accepted
- **Date:** 2026-09-08
- **Phase:** 01 engine-foundation (plan 01-03), satisfying ROADMAP Phase 1 success criterion SC5
- **Deciders:** Project owner (locked as a P0 legal decision at roadmap time; recorded in `.planning/STATE.md`)

> **Amended in phase 04.1 (2026-09-19):** the elevation sub-decision below is retired for v1 —
> elevation is no longer sampled from any DEM. The road-network decision, the Google
> prohibition, and every other section of this ADR are unchanged. See the new "flat,
> hand-authored terrain" subsection below for what changed, why, and what would justify
> reversing it. The original DEM decision is retained immediately above it as history, not
> deleted.

> **This document is the single authoritative answer to "where does Heat Street's map data
> come from?"** Any other document in this repository that says otherwise is superseded — see
> the Supersedes section below. If you are an agent about to build the Phase 4 map compiler,
> read this file first and stop reading whatever contradicted it.

## Context

Heat Street derives its road layouts from real-world places. Three things force this decision
to be frozen in Phase 1, before any map work starts:

1. **It is a legal decision, not a technical one.** The data licence dictates what may be
   distributed with the shipped game and what attribution the credits screen must carry.
   Discovering the constraint after Phase 4 has compiled a city means recompiling a city.
2. **Three documents in this repository previously gave two contradictory answers.**
   `heat-street-design-doc.md` section 5 and two lines in `CLAUDE.md` recommended a Google
   Maps extraction pipeline as *preferred*. `.planning/STATE.md` recorded the opposite. An
   autonomous agent reading the wrong one would have built Phase 4 against prohibited data.
3. **The schema depends on it.** `docs/schemas/road-graph.v1.md` makes an `attribution` block
   mandatory so the credits screen is generated from the data rather than hand-maintained.
   That block cannot be specified until the sources are named.

## Decision

### Road network — OpenStreetMap under ODbL v1.0

The road network for every shipped area is derived from **OpenStreetMap**, licensed under the
**Open Database License (ODbL) v1.0**.

- Licence reference: <https://www.openstreetmap.org/copyright>
- Attribution guidelines: <https://osmfoundation.org/wiki/Licence/Attribution_Guidelines>

Required attribution is to **"OpenStreetMap"**. The forms **"© OpenStreetMap contributors"**
and **"© OpenStreetMap"** are explicitly acceptable (the ASCII forms
`(c) OpenStreetMap contributors` / `(c) OpenStreetMap` are the same strings where the
copyright glyph is unavailable). For **games** specifically, the OSMF guidelines permit the
attribution to appear *"on the credits page, in the menu, or in another suitable location"*.
Where linking is not possible, the URL `https://www.openstreetmap.org/copyright` must be
included. Heat Street will ship both: the credit string and the URL, on the credits screen,
generated from each compiled map's `attribution` block.

Practical extract sources for Phase 4 (Geofabrik regional `.osm.pbf`, BBBike custom-area
extracts, or the Overpass API for small areas) are a Phase 4 implementation detail and are
**not** fixed by this ADR. Only the licence and the prohibition are fixed here.

### Elevation — an open DEM, chosen by an explicit selection rule (superseded, phase 04.1 — retained as history)

**This subsection describes the ORIGINAL decision and is no longer how the compiler gets
elevation.** It is retained verbatim, unabridged, because it records why an open DEM was chosen
in the first place and remains the ready-made answer if DEM elevation is ever reinstated (see
the amendment below for the condition under which that would happen). The current decision is
the next subsection.

Elevation comes from an open DEM. Both approved sources are recorded here with a selection
rule, so that Phase 1 is not blocked on Phase 4's choice of real-world area.

| Source | Resolution | Coverage | Licence | Mandatory notice |
|---|---|---|---|---|
| **USGS 3DEP** | 1 m / ⅓ arc-second | United States only | Public domain — *"available free of charge and without use restrictions"*; USGS *requests* but does not require acknowledgment | None (courtesy credit only) |
| **Copernicus DEM GLO-30** | 30 m | Global | Free worldwide licence, commercial use permitted, *"worldwide and without limitation in time"* | **Yes — see below** |

**Selection rule:** if the target area is inside the United States, use **USGS 3DEP** —
public domain with no mandatory notice is strictly simpler, and 1 m resolution is far better
than 30 m for road surfaces. Otherwise use **Copernicus DEM GLO-30** as the global fallback
and accept its mandatory credits line. Whichever is chosen is recorded in the compiled map's
`source.demSource` and `attribution.dem` fields.

**Copernicus mandatory notice — reproduce verbatim if GLO-30 is used:**

> © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

**For modified Copernicus data**, the required form is:

> produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

Citations: USGS national-map terms of use / licensing FAQ
(<https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map>)
and the Copernicus DEM `License-COPDEM-30.pdf` published at
<https://documentation.dataspace.copernicus.eu/>.

This selection rule is the recorded resolution of 01-RESEARCH.md Open Question 2.

### Elevation — amended (phase 04.1): flat, hand-authored terrain

**What changed.** Elevation is no longer sampled from any DEM. Every road node and every edge
centreline point is authored at `y = 0` — a literal constant, not smoothed, not sampled
(D-01/D-03). Off-road terrain gets a capped, deterministic, seeded procedural relief that fades
to exactly zero at every road's paved edge, so it can never create a bridging gap between road
and ground (D-02/D-02a/D-02b). Jumps come from Phase 2's already-proven hand-placed ramp
mechanic (explicit convex-hull wedge ramps) plus a small number of explicitly authored off-road
terrain crests placed at hand-picked spots — never from real-world elevation data (D-04).

**Why.** The developer's own framing, verbatim: *"the elevation as it currently stands causes
too many problems — adding skirts to the edges of the roads to meet the terrain results in
20m extra road width in places which just looks ridiculous. Want to use flatter terrain
throughout."* This was not a subjective complaint alone — Phase 4's own driving session (ADR
0004 decision 7) had measured an average 5.09m road-to-terrain gap forcing a 20m
`TARGET_SHOULDER_WIDTH_M`, with a median shoulder-ramp grade of 12.9 degrees and a 95th-percentile
grade of 26.9 degrees. Post-amendment, the same measurement methodology (`04.1-09-SUMMARY.md`)
recorded a median grade of 0.96 degrees and a p95 of 1.30 degrees, 0 terrain-above-road
violations (down from 123, worst case 3.25m), and a shoulder width of 6m — and a full human
drive-every-road re-verification (D-06, `04.1-10-SUMMARY.md`) directly confirmed the 20m-skirt
defect is gone by observation, not only by measurement.

**What is unchanged.** OpenStreetMap remains the frozen, sole source for road and building
topology, under the same licence terms as before — see "Road network" above, untouched by this
amendment. The Google prohibition below is untouched. `source.demSource` and
`attribution.dem` remain mandatory schema fields (`docs/schemas/road-graph.v1.md` is unchanged)
— only their VALUES changed, to `"none-flat-authored"` and a sentence stating terrain is flat
and hand-authored.

**Where the code lives.** `tools/map-compiler/graph/elevation.ts`'s `applyFlatElevation`
replaces DEM sampling with the literal `y = 0` baseline. `tools/map-compiler/author/heightfield.ts`'s
`buildOffRoadRelief` replaces DEM-grid sampling with a seeded, capped procedural generator.
`src/core/crest-geometry.ts` holds the three hand-authored terrain crests. The final,
human-signed-off constant values (`04.1-10-SUMMARY.md` — no retune was made during that
session) are:

| Constant | Value | File |
|---|---|---|
| Road/edge-point elevation | `y = 0`, exactly, everywhere | `tools/map-compiler/graph/elevation.ts` |
| `RELIEF_AMPLITUDE_M` | 2 (± metres) | `tools/map-compiler/author/heightfield.ts` |
| `RELIEF_FALLOFF_DISTANCE_M` | 130 | `tools/map-compiler/author/heightfield.ts` |
| `HEIGHTFIELD_SINK_M` | 0.1 | `tools/map-compiler/author/heightfield.ts` |
| `TARGET_SHOULDER_WIDTH_M` | 6 (was 20 pre-amendment) | `src/core/road-geometry.ts` |
| Authored crests | `juliette-north-ridge` (-779.7, 263.2, r45m, h9m), `juliette-main-street-rise` (-420.0, 102.2, r30m, h5m), `juliette-south-approach` (-1227.2, -1062.3, r28m, h6m) | `src/core/crest-geometry.ts` |
| `source.demSource` | `"none-flat-authored"` | compiled `*.map.json` |
| `source.compilerVersion` | `"0.6.0"` | compiled `*.map.json` |

**D-05's retirement note.** Phase 4's original area-selection criterion — favour real towns with
genuine rolling terrain when picking a target area (04-CONTEXT.md's D-09) — is retired as the
operative rule for v1's area. It is explicitly **not** permanently ruled out: it remains a
possible criterion to reconsider if a future v2 area is ever added, exactly as D-09's own
reasoning is left intact in `04-CONTEXT.md` rather than deleted.

**What would justify revisiting this.** A future v2 area whose terrain character is itself the
point (a mountain pass, a coastal cliff road) where flat ground would defeat the area's purpose;
a heightfield resolution/authoring budget that could represent real relief without recreating
the coarse-grid shoulder-bridging problem this amendment exists to remove; or a decision that
real-world vertical fidelity matters more than shoulder geometry for a specific future area. If
any of these are ever true, the retained DEM source table above (USGS 3DEP / Copernicus GLO-30,
selection rule, mandatory-notice text, citations) is the ready-made answer — it was kept
verbatim for exactly this reason, not deleted when this amendment was written.

### Prohibition — no Google-derived bytes, anywhere

**No bytes derived from Google Maps, Google Earth or Google Street View may enter this
repository, the asset pipeline, or the shipped build.** This includes road geometry *traced
from* Google imagery, which is derived data even though no Google file is copied.

The relevant terms are the Google Maps Platform Terms of Service:
<https://cloud.google.com/maps-platform/terms>. Section 3.2.4 ("Restrictions Against Misusing
the Services") is the directional reference — it addresses scraping, pre-fetching, storing,
resharing and rehosting Maps Content outside the Services, bulk-downloading roads or elevation
data, and creating content based on Maps Content. **The clause text could not be retrieved
verbatim when this ADR was written**, so it is cited as directional rather than paraphrased as
settled legal fact. Read the linked terms directly before relying on the summary.

**This is not legal advice.** It is a project policy chosen to keep the shipped game clearly
inside the licences of the data it uses.

The prohibition is enforced mechanically by `tests/no-google-pipeline.test.ts`, which fails
the build if a scanned file recommends the Google Maps pipeline without pointing at this ADR.

## Consequences

- **The credits screen is data-driven.** `docs/schemas/road-graph.v1.md` makes the
  `attribution` block mandatory on every compiled map, so shipping a map without its licence
  string is a schema violation rather than a thing someone forgot.
- **Compiled `*.map.json` road graphs are licensed under ODbL 1.0** — see `LICENSE-MAPDATA` at
  the repository root. This is the free safe path on the open Derivative Database question
  below; it costs nothing for a solo v1 and removes the ambiguity.
- **The existing "Map Heightmap & 3D GLTF Generator" tool is not prohibited** — its exported
  game data already comes from OpenStreetMap via Overpass with open-data elevation fallbacks.
  What is prohibited is its Google satellite / Street View *preview* imagery ever being baked
  into an export. Re-confirm at export time in Phase 4.
- **Supply chain: `three` and `@dimforge/rapier3d` are pinned to exact versions** (`0.185.1`
  and `0.20.0`, no caret or tilde). A patch bump in either can alter solver behaviour and
  therefore silently invalidate recorded medal times. Bumping either is a change that
  **requires re-recording the Phase 6 designer reference runs**, and should be treated as a
  gameplay change, not a maintenance chore.
- **Phase 4 cannot start map compilation without naming its area**, because the area selects
  the DEM. That is a deliberate, recorded dependency rather than a surprise.
- **(Phase 04.1 amendment)** No network dependency and no third-party GeoTIFF parser
  (`geotiff`) remain in the compiler build — one fewer fetched-and-parsed external input.
  Compiles are now fully reproducible offline (verified byte-identical across consecutive runs,
  `04.1-09-SUMMARY.md`). The accepted trade is the loss of real-world vertical fidelity: the
  compiled area's elevation is now a designer's approximation, not a survey.

## Supersedes

This ADR supersedes the following, each of which recommended or implied the retired Google
Maps extraction pipeline. All four have been amended to point here.

1. **`heat-street-design-doc.md` section 5 "Maps & Locations"** — the bullet reading *"Leroy
   has already built a separate tool that takes an area of Google Maps and exports it into
   files usable for game map creation. This is the preferred pipeline…"*. **SUPERSEDED.**
   Map data is compiled offline from OpenStreetMap plus an open DEM.
2. **`CLAUDE.md`, minimap bullet** — *"the road polylines you already have from the Google
   Maps extraction tool"*. **SUPERSEDED.** Polylines come from the OSM-derived road graph
   specified in `docs/schemas/road-graph.v1.md`.
3. **`CLAUDE.md`, Gaps / Open Items** — *"Google-Maps-derived city scale"* as a scale
   descriptor. **SUPERSEDED.** The descriptor is now OSM-derived city scale.
4. **`.planning/research/STACK.md`** — all references to the Google Maps extraction tool as a
   map source (its minimap line and its further map-source mentions). **SUPERSEDED wholesale
   by this ADR.** A banner at the top of that file records the supersession; its individual
   historical lines are deliberately left intact as a dated research record.

Note on scope: `.planning/**` is a frozen audit trail, not builder instructions, and is
therefore out of scope for the automated grep gate. Plan 01-03's `grep_scope_decision` block
is the decision record for that scope, and `.planning/research/STACK.md` carries a banner as
the compensating control. The **root** `PROJECT.md` contains no Google reference and needed no
change; `.planning/PROJECT.md` does, and is out of scope as historical record.

**Phase 04.1 self-supersession, of a different kind from the four above:** this ADR's own
elevation sub-decision ("Elevation — an open DEM…") is superseded IN PLACE by the "Elevation —
amended (phase 04.1)" subsection directly below it, rather than by an external document being
pointed here. `docs/adr/0004-first-area-and-compiler-decisions.md`'s decision 7 (the
DEM-derived, sunk off-road heightfield) is likewise superseded by this same amendment — see
that ADR's own updated decision 7 and Supersedes section.

## Open Questions

Recorded here so they cannot be lost. Neither blocks Phase 1.

1. **Is a compiled `.map.json` road graph an ODbL Derivative Database or a Produced Work?**
   ODbL distinguishes a *Produced Work* (attribution only) from a *Derivative Database* (must
   itself be released under ODbL). The compiled `.glb` mesh is almost certainly a Produced
   Work. The `.map.json` road graph — a structured, machine-readable extraction of OSM ways
   and nodes — is plausibly a **Derivative Database**. **Unresolved, but mitigated:**
   `LICENSE-MAPDATA` licenses all distributed `*.map.json` artifacts under ODbL 1.0 anyway, so
   the project is compliant under either reading. Revisit only if the licensing of map
   artifacts ever becomes commercially load-bearing.
2. **Which real-world area does Phase 4 target?** This determines DEM source and resolution
   under the selection rule above: a US area gets 3DEP at 1 m with no mandatory notice; a
   non-US area gets Copernicus GLO-30 at 30 m and the mandatory credits line. Deferred to
   Phase 4 by design, where it is a data-sourcing decision rather than a Phase 1 blocker.

## Enforcement

| Guarantee | Mechanism |
|---|---|
| This ADR and the schema doc cannot go missing or be stubbed | `tests/docs-present.test.ts` (existence plus a 1500-character floor) |
| The retired pipeline cannot be silently reintroduced | `tests/no-google-pipeline.test.ts` (scoped, comment-stripped grep requiring an ADR pointer within six lines of any match) |
| A shipped map can always be traced to its inputs | Mandatory `source.osmExtract` / `source.osmSnapshot` / `source.demSource` / `source.compilerVersion`, asserted by `tests/road-graph-schema.test.ts` |
| Licence strings ship with the data | Mandatory `attribution` block in `docs/schemas/road-graph.v1.md` |
| A compiled artifact can no longer claim DEM provenance (phase 04.1) | `tools/map-compiler/graph/build-graph.test.ts`'s provenance-string test and `tests/compiled-map.test.ts`'s exact-flatness assertions against the real `juliette-ga` artifact |

## References

- <https://www.openstreetmap.org/copyright>
- <https://osmfoundation.org/wiki/Licence/Attribution_Guidelines>
- <https://opendatacommons.org/licenses/odbl/1-0/>
- <https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map>
- <https://documentation.dataspace.copernicus.eu/> (`License-COPDEM-30.pdf`)
- <https://cloud.google.com/maps-platform/terms>
- <https://wiki.openstreetmap.org/wiki/Key:surface>
- `LICENSE-MAPDATA`, `docs/schemas/road-graph.v1.md`, `fixtures/road-graph.sample.json`
- `.planning/phases/04.1-flatten-terrain-remove-dem-elevation-drop-real-world-dem-der/04.1-CONTEXT.md`, `04.1-RESEARCH.md` (phase 04.1 planning artifacts behind this amendment)
- `.planning/phases/04.1-flatten-terrain-remove-dem-elevation-drop-real-world-dem-der/04.1-09-SUMMARY.md`, `04.1-10-SUMMARY.md` (the measurement baseline and human sign-off session this amendment cites)
- `docs/adr/0004-first-area-and-compiler-decisions.md` (decision 7, now superseded by this amendment)
