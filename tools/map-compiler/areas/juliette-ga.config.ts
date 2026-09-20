/**
 * Confirmed target-area config for the Phase 4 map compiler's first (and, for
 * v1, only) area: Juliette, Georgia — Monroe County.
 *
 * This is the user-confirmed candidate from 04-RESEARCH.md's "Target Area
 * Selection" section (D-01/D-02/D-03): a small American town plus its
 * surrounding rural county roads (D-01), researcher-selected against
 * explicit criteria and live-verified with real Overpass/Nominatim/
 * Open-Elevation queries rather than reasoned from training knowledge alone
 * (D-02), and squarely rural US South (D-03) — which is also what makes ADR
 * 0001's DEM selection rule ("if the target area is inside the United
 * States, use USGS 3DEP") resolve to `usgs-3dep-1m` rather than
 * `copernicus-glo30`.
 *
 * The bbox below is the Nominatim-geocoded CDP boundary box recorded in
 * 04-RESEARCH.md as `[VERIFIED: Nominatim, queried 2026-09-13]`:
 * `33.0963,-83.8242` to `33.1223,-83.7948` (~2.9km x 2.4km).
 *
 * Layering: this is a plain data module — no I/O, no network, no fs. Safe to
 * import from any later `tools/map-compiler/**` stage.
 */

/** The shape every area config in `tools/map-compiler/areas/` must satisfy. */
export interface AreaConfig {
  /** Stable machine id — becomes the compiled map's `areaId` and the key used by save data / area unlocking. */
  readonly areaId: string;
  /** Human-readable name, shown in UI and as the compiled map's `name`. */
  readonly name: string;
  /** WGS84 bounding box passed to the Overpass query in plan 04-02. */
  readonly bbox: {
    readonly south: number;
    readonly west: number;
    readonly north: number;
    readonly east: number;
  };
  /**
   * Which DEM source ADR 0001's US/non-US selection rule WOULD resolve to
   * for this area is no longer recorded here — phase 04.1 retired DEM
   * elevation for this area (D-01 through D-05). The value now records that
   * terrain elevation is flat and hand-authored; ADR 0001's amendment is the
   * normative record of why. `"usgs-3dep-1m"` and `"copernicus-glo30"`
   * remain valid union members because D-05 records DEM elevation as
   * retired for v1, not ruled out for a future area.
   */
  readonly demSource: "usgs-3dep-1m" | "copernicus-glo30" | "none-flat-authored";
  /**
   * The OSM data retrieval timestamp, ISO 8601 — copied verbatim from the
   * committed roads cache envelope's `fetchedAt`
   * (`tools/map-compiler/areas/juliette-ga.raw-osm.json`), which is also
   * what becomes the compiled map's `source.osmSnapshot`. Filled in by plan
   * 04-02's Task 2 after the real Overpass fetch; `null` was the placeholder
   * plan 04-01 left here.
   */
  readonly osmSnapshot: string | null;
  /**
   * Names the Overpass endpoint actually used to produce the committed raw
   * snapshot, in the schema's `overpass://<host>/<areaId>` style. Becomes
   * the compiled map's `source.osmExtract`. `null` is the placeholder until
   * a real fetch has happened.
   */
  readonly osmExtract: string | null;
  /**
   * OSM `highway=*` classes to exclude from the compiled road network.
   * `service` is excluded because 04-RESEARCH.md's live Overpass query found
   * 30 of 56 ways in this box are `service`-tagged driveway spurs — mostly
   * private driveways rather than through-roads, and their untagged-surface
   * rate makes the `highway=*` -> `tarmac` fallback (docs/schemas/road-graph.v1.md's
   * mapping table) a documented accuracy risk for anything that is actually
   * an unpaved forest-service track (04-RESEARCH.md "OSM Surface Tag
   * Reliability").
   */
  readonly excludeHighwayClasses: readonly string[];
  /**
   * Per-axis pixel cap for this area's USGS 3DEP `exportImage` request
   * (plan 04-05's D-P14). Recorded per-area (rather than only as
   * `sources/dem.ts`'s `DEM_MAX_SIZE_PX` default) so a later, larger area can
   * raise it deliberately without touching compiler internals.
   */
  readonly demSizePx: number;
}

export const julietteGaConfig: AreaConfig = {
  areaId: "juliette-ga",
  name: "Juliette, Georgia",
  bbox: { south: 33.0963, west: -83.8242, north: 33.1223, east: -83.7948 },
  // [VERIFIED: phase 04.1, plan 04.1-06] Terrain elevation is flat and
  // hand-authored for this area — DEM elevation is retired (D-01 through
  // D-05); see docs/adr/0001-map-data-source.md's phase-04.1 amendment.
  demSource: "none-flat-authored",
  // [VERIFIED: tools/map-compiler/areas/juliette-ga.raw-osm.json's committed
  // fetchedAt, captured 2026-09-13 against the primary public Overpass
  // instance — 56 tagged ways, highway breakdown service:30/tertiary:10/
  // residential:10/primary:3/unclassified:3, surface breakdown
  // asphalt:10/unpaved:9/paved:8/gravel:6/concrete:1, 22/56 with no surface
  // tag — matches 04-RESEARCH.md's live-queried sanity bounds exactly, not
  // just within the documented factor-of-two tolerance.]
  osmSnapshot: "2026-09-13T20:25:59.876Z",
  osmExtract: "overpass://overpass-api.de/juliette-ga",
  excludeHighwayClasses: ["service"],
  // [VERIFIED: plan 04-05 Task 1] 512px resolves to ~5.6 m/pixel for this
  // area's ~2.9km x 2.4km box — see sources/dem.ts's DEM_MAX_SIZE_PX comment.
  demSizePx: 512,
};
