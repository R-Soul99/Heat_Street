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
   * Which DEM source ADR 0001's US/non-US selection rule resolves to for
   * this area. Recorded here explicitly rather than re-derived at compile
   * time, so a reader can see the decision without re-running the rule.
   */
  readonly demSource: "usgs-3dep-1m" | "copernicus-glo30";
  /**
   * The OSM data retrieval timestamp, ISO 8601. `null` here is an explicit
   * placeholder — plan 04-02 fills this in with the real snapshot time once
   * it performs the live Overpass fetch and caches the raw response
   * (04-RESEARCH.md Pitfall 1). Left `null` rather than a guessed date so a
   * stale placeholder can never be mistaken for a real provenance value.
   */
  readonly osmSnapshot: string | null;
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
}

export const julietteGaConfig: AreaConfig = {
  areaId: "juliette-ga",
  name: "Juliette, Georgia",
  bbox: { south: 33.0963, west: -83.8242, north: 33.1223, east: -83.7948 },
  demSource: "usgs-3dep-1m",
  osmSnapshot: null,
  excludeHighwayClasses: ["service"],
};
